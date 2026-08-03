#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const RAW_PATH =
  "eval/evidence/exp-0025-r-external-development-raw-v0.1.json";
const OUTPUT_PATH =
  "eval/evidence/exp-0025-r-external-peft-base-equivalence-v0.1.json";
const EXTERNAL_REVISION = "dca21cb1309bb533d80f5aa5600c7b0cc2c470e3";
const BASE_REVISION = "f2826a00ceef68f0f2b946d945ecc0477ce4450c";
const EXTERNAL_FILE_URL =
  `https://huggingface.co/sbintuitions/DuplexCascade/resolve/` +
  `${EXTERNAL_REVISION}/model_state.safetensors`;
const BASE_ROOT =
  `https://huggingface.co/Qwen/Qwen2-7B-Instruct/resolve/${BASE_REVISION}`;
const MAX_DOWNLOAD_BYTES = 40 * 1024 ** 3;
const PRIOR_TRANSFER_BYTES_UPPER_BOUND = 3_400_000_000;
const FROZEN_ARTIFACT_BYTES = 32_662_348_987;
const CONCURRENCY = 4;

if (process.argv.length > 2) {
  throw new Error("este diagnóstico one-shot não aceita argumentos");
}
try {
  await readFile(resolve(OUTPUT_PATH));
  throw new Error(
    `evidência já existe em ${OUTPUT_PATH}; rerun e novo gasto são proibidos`
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchRange(url, start, end) {
  const response = await fetch(url, {
    headers: { range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(120_000)
  });
  if (response.status !== 206) {
    throw new Error(`range HTTP ${response.status}: ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = end - start + 1;
  if (bytes.length !== expected) {
    throw new Error(`range truncado: ${bytes.length} != ${expected}`);
  }
  return bytes;
}

async function safetensorsHeader(url) {
  let prefix = await fetchRange(url, 0, 1024 * 1024 - 1);
  const headerBytes = Number(prefix.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerBytes) || headerBytes <= 0) {
    throw new Error(`header safetensors inválido: ${url}`);
  }
  if (prefix.length < 8 + headerBytes) {
    prefix = await fetchRange(url, 0, 8 + headerBytes - 1);
  }
  return {
    dataStart: 8 + headerBytes,
    tensors: JSON.parse(prefix.subarray(8, 8 + headerBytes).toString("utf8"))
  };
}

function tensorDescriptor(header, key) {
  const descriptor = header.tensors[key];
  if (!descriptor || !Array.isArray(descriptor.data_offsets) ||
    descriptor.data_offsets.length !== 2) {
    throw new Error(`tensor ausente: ${key}`);
  }
  return descriptor;
}

function tensorBytes(descriptor) {
  return descriptor.data_offsets[1] - descriptor.data_offsets[0];
}

async function hashRemoteTensor(url, header, descriptor) {
  const start = header.dataStart + descriptor.data_offsets[0];
  const end = header.dataStart + descriptor.data_offsets[1] - 1;
  const bytes = await fetchRange(url, start, end);
  return { sha256: sha256(bytes), byteLength: bytes.length };
}

async function parallelMap(values, concurrency, callback) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await callback(values[index], index);
      if ((index + 1) % 8 === 0 || index + 1 === values.length) {
        process.stdout.write(
          `[peft-equivalence] ${index + 1}/${values.length}\n`
        );
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker()
  ));
  return results;
}

const rawBytes = await readFile(resolve(RAW_PATH));
const raw = JSON.parse(rawBytes.toString("utf8"));
const missing = raw.modelLoad?.missingKeys ?? [];
const unexpected = raw.modelLoad?.unexpectedKeys ?? [];
if (missing.length !== 112 || unexpected.length !== 112) {
  throw new Error(
    `cardinalidade PEFT inesperada: missing=${missing.length} ` +
    `unexpected=${unexpected.length}`
  );
}

const pairs = unexpected.map((checkpointKey) => {
  const baseKey = checkpointKey.replace(/^llm\.base_model\.model\./u, "");
  const missingKey = checkpointKey.replace(
    /\.(q_proj|v_proj)\.(weight|bias)$/u,
    ".$1.base_layer.$2"
  );
  if (baseKey === checkpointKey || !missing.includes(missingKey)) {
    throw new Error(`par de rename PEFT não encontrado: ${checkpointKey}`);
  }
  return { checkpointKey, missingKey, baseKey };
});

const indexResponse = await fetch(
  `${BASE_ROOT}/model.safetensors.index.json`,
  { signal: AbortSignal.timeout(30_000) }
);
if (!indexResponse.ok) {
  throw new Error(`índice base HTTP ${indexResponse.status}`);
}
const index = await indexResponse.json();
const externalHeader = await safetensorsHeader(EXTERNAL_FILE_URL);
const shardNames = [...new Set(pairs.map(({ baseKey }) => {
  const shard = index.weight_map?.[baseKey];
  if (!shard) throw new Error(`shard base ausente: ${baseKey}`);
  return shard;
}))];
const baseHeaders = new Map();
for (const shard of shardNames) {
  const url = `${BASE_ROOT}/${shard}`;
  baseHeaders.set(shard, { url, header: await safetensorsHeader(url) });
}

let oneSideTensorBytes = 0;
for (const pair of pairs) {
  const checkpoint = tensorDescriptor(externalHeader, pair.checkpointKey);
  const shard = index.weight_map[pair.baseKey];
  const base = tensorDescriptor(baseHeaders.get(shard).header, pair.baseKey);
  if (checkpoint.dtype !== base.dtype ||
    JSON.stringify(checkpoint.shape) !== JSON.stringify(base.shape) ||
    tensorBytes(checkpoint) !== tensorBytes(base)) {
    throw new Error(`shape/dtype divergente: ${pair.checkpointKey}`);
  }
  oneSideTensorBytes += tensorBytes(checkpoint);
}
const diagnosticTransferBytes = oneSideTensorBytes * 2;
const projectedCumulativeTransferBytes =
  PRIOR_TRANSFER_BYTES_UPPER_BOUND +
  FROZEN_ARTIFACT_BYTES +
  diagnosticTransferBytes;
if (projectedCumulativeTransferBytes > MAX_DOWNLOAD_BYTES) {
  throw new Error("diagnóstico excederia o teto cumulativo de 40 GiB");
}

const comparisons = await parallelMap(pairs, CONCURRENCY, async (pair) => {
  const checkpointDescriptor = tensorDescriptor(
    externalHeader,
    pair.checkpointKey
  );
  const shard = index.weight_map[pair.baseKey];
  const baseSource = baseHeaders.get(shard);
  const baseDescriptor = tensorDescriptor(baseSource.header, pair.baseKey);
  const checkpoint = await hashRemoteTensor(
    EXTERNAL_FILE_URL,
    externalHeader,
    checkpointDescriptor
  );
  const base = await hashRemoteTensor(
    baseSource.url,
    baseSource.header,
    baseDescriptor
  );
  return {
    ...pair,
    baseShard: shard,
    dtype: checkpointDescriptor.dtype,
    shape: checkpointDescriptor.shape,
    byteLength: checkpoint.byteLength,
    checkpointSha256: checkpoint.sha256,
    baseSha256: base.sha256,
    equal: checkpoint.sha256 === base.sha256
  };
});

const mismatches = comparisons.filter((item) => !item.equal);
const report = {
  schemaVersion: "exp-0025-r-peft-base-equivalence-v1",
  experimentId: "EXP-0025-R",
  candidateId: "E-official-duplexcascade-v0.1",
  role: "POST_RUN_LOAD_VALIDITY_DIAGNOSTIC_NOT_CANDIDATE_INFERENCE",
  createdAt: new Date().toISOString(),
  sourceEvidence: {
    path: RAW_PATH,
    fileSha256: sha256(rawBytes),
    evidenceSha256: raw.evidenceSha256
  },
  checkpoint: {
    externalRevision: EXTERNAL_REVISION,
    baseRevision: BASE_REVISION
  },
  observedLoadDifference: {
    missingKeyCount: missing.length,
    unexpectedKeyCount: unexpected.length,
    relation: "ONE_TO_ONE_PEFT_BASE_LAYER_RENAME"
  },
  budget: {
    priorTransferBytesUpperBound: PRIOR_TRANSFER_BYTES_UPPER_BOUND,
    frozenArtifactBytes: FROZEN_ARTIFACT_BYTES,
    diagnosticTransferBytes,
    projectedCumulativeTransferBytes,
    maximumDownloadBytes: MAX_DOWNLOAD_BYTES,
    withinLimit: projectedCumulativeTransferBytes <= MAX_DOWNLOAD_BYTES
  },
  comparison: {
    tensorCount: comparisons.length,
    oneSideTensorBytes,
    equalCount: comparisons.length - mismatches.length,
    mismatchCount: mismatches.length,
    allEqual: mismatches.length === 0,
    comparisons
  },
  interpretation: mismatches.length === 0
    ? "IGNORED_CHECKPOINT_KEYS_EQUAL_PINNED_BASE_INITIALIZATION"
    : "MODEL_LOAD_NOT_EQUIVALENT_TO_CHECKPOINT"
};
const destination = resolve(OUTPUT_PATH);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx"
});
process.stdout.write(JSON.stringify({
  allEqual: report.comparison.allEqual,
  tensorCount: report.comparison.tensorCount,
  diagnosticTransferBytes,
  projectedCumulativeTransferBytes,
  output: OUTPUT_PATH
}) + "\n");
