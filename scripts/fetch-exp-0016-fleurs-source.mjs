import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { createGunzip, inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import {
  canonicalSha256
} from "../src/eval/factory/canonical-hash.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const ARCHIVE = Object.freeze({
  url: "https://storage.googleapis.com/" +
    "xtreme_translations/FLEURS102/pt_br.tar.gz",
  etag: '"abdd3a3902269e1a588fe50b00950fcf"',
  contentLength: 2_682_883_058,
  lastModified: "Wed, 27 Apr 2022 02:57:44 GMT",
  huggingFaceRevision:
    "07bf13d2c724f7ec17d768316d9b85214b3b64f3"
});
const METADATA = Object.freeze({
  url: "https://huggingface.co/datasets/google/fleurs/resolve/" +
    `${ARCHIVE.huggingFaceRevision}/data/metadata.zip`,
  contentLength: 64_825_504,
  sha256: "aca40140670aeb810b5b0963b0a6c573e9bd5206c66e2fbab6ff2571f0f3d1b7"
});
const DEFAULTS = Object.freeze({
  count: 36,
  manifest: "eval/sources/exp-0016-fleurs-pt-br-v0.1.json",
  outputRoot: "eval/generated/exp-0016/source/fleurs-pt-br"
});

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (!["--count", "--manifest", "--output-root"].includes(argument)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const field = argument.slice(2).replace(
      /-([a-z])/gu,
      (_, letter) => letter.toUpperCase()
    );
    options[field] = argument === "--count"
      ? Number(args[++index])
      : args[++index];
  }
  if (!Number.isSafeInteger(options.count) || options.count < 12) {
    throw new RangeError("count precisa ser inteiro >= 12");
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes) {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function zipEntry(zip, target) {
  let eocd = -1;
  for (
    let offset = zip.length - 22;
    offset >= Math.max(0, zip.length - 65_557);
    offset -= 1
  ) {
    if (zip.readUInt32LE(offset) === 0x0605_4b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("metadata.zip não contém EOCD");
  }
  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x0201_4b50) {
      throw new Error("diretório central ZIP inválido");
    }
    const method = zip.readUInt16LE(offset + 10);
    const expectedCrc = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    if (name === target) {
      if (zip.readUInt32LE(localOffset) !== 0x0403_4b50) {
        throw new Error(`cabeçalho local ZIP inválido: ${target}`);
      }
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(
        dataOffset,
        dataOffset + compressedSize
      );
      const bytes = method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? inflateRawSync(compressed)
          : null;
      if (
        bytes === null ||
        bytes.length !== uncompressedSize ||
        crc32(bytes) !== expectedCrc
      ) {
        throw new Error(`entrada ZIP incompatível: ${target}`);
      }
      return bytes;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`entrada ZIP ausente: ${target}`);
}

function parseOctal(bytes) {
  const value = bytes.toString("ascii").replace(/\0.*$/u, "").trim();
  return value.length === 0 ? 0 : Number.parseInt(value, 8);
}

function tarHeader(buffer) {
  if (buffer.every((value) => value === 0)) {
    return null;
  }
  const storedChecksum = parseOctal(buffer.subarray(148, 156));
  let observedChecksum = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    observedChecksum += index >= 148 && index < 156
      ? 32
      : buffer[index];
  }
  if (storedChecksum !== observedChecksum) {
    throw new Error("checksum do cabeçalho TAR diverge");
  }
  const name = buffer.subarray(0, 100).toString("utf8")
    .replace(/\0.*$/u, "");
  const prefix = buffer.subarray(345, 500).toString("utf8")
    .replace(/\0.*$/u, "");
  const path = prefix.length > 0 ? `${prefix}/${name}` : name;
  const size = parseOctal(buffer.subarray(124, 136));
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`tamanho TAR inválido: ${path}`);
  }
  return { path, size, type: buffer[156] };
}

async function scanTarGzip(stream, handlers) {
  let pending = Buffer.alloc(0);
  let current = null;
  for await (const chunk of stream) {
    pending = pending.length === 0
      ? chunk
      : Buffer.concat([pending, chunk]);
    while (true) {
      if (current === null) {
        if (pending.length < 512) {
          break;
        }
        const header = tarHeader(pending.subarray(0, 512));
        pending = pending.subarray(512);
        if (header === null) {
          return;
        }
        current = {
          ...header,
          remaining: header.size,
          padding: (512 - header.size % 512) % 512,
          chunks: handlers.shouldCollect(header.path)
            ? []
            : null
        };
      }
      if (current.remaining > 0) {
        if (pending.length === 0) {
          break;
        }
        const consumed = Math.min(current.remaining, pending.length);
        if (current.chunks !== null) {
          current.chunks.push(pending.subarray(0, consumed));
        }
        pending = pending.subarray(consumed);
        current.remaining -= consumed;
        if (current.remaining > 0) {
          break;
        }
      }
      if (pending.length < current.padding) {
        break;
      }
      pending = pending.subarray(current.padding);
      const collected = current.chunks === null
        ? null
        : Buffer.concat(current.chunks, current.size);
      const stop = await handlers.onEntry({
        path: current.path,
        size: current.size,
        type: current.type,
        bytes: collected
      });
      current = null;
      if (stop) {
        return;
      }
    }
  }
  throw new Error("archive terminou antes da seleção requerida");
}

function metadataRows(bytes, upstreamSplit) {
  const rows = new Map();
  for (const line of bytes.toString("utf8").split(/\r?\n/gu)) {
    if (line.length === 0) {
      continue;
    }
    const fields = line.split("\t");
    if (fields.length !== 7) {
      throw new Error("linha inesperada em dev.tsv do FLEURS");
    }
    const [id, fileName, rawTranscript, transcript, , samples, gender] =
      fields;
    rows.set(fileName, {
      upstreamSplit,
      upstreamId: Number(id),
      fileName,
      samples: Number(samples),
      gender,
      rawTranscriptSha256: `sha256:${sha256(rawTranscript)}`,
      transcriptSha256: `sha256:${sha256(transcript)}`
    });
  }
  return rows;
}

function sourceSelection(devRows, testRows, count) {
  if (count % 4 !== 0) {
    throw new RangeError("count precisa ser múltiplo de 4");
  }
  const trainCount = count / 2;
  const evaluationCount = count - trainCount;
  const selected = [
    ...[...devRows.values()].slice(0, trainCount),
    ...[...testRows.values()].slice(0, evaluationCount)
  ];
  if (selected.length !== count) {
    throw new Error("metadados FLEURS não possuem seleção suficiente");
  }
  return selected;
}

function partition(index, count) {
  const trainEnd = Math.floor(count / 2);
  const developmentEnd = trainEnd + Math.floor((count - trainEnd) / 2);
  return index < trainEnd
    ? "train"
    : index < developmentEnd
      ? "development"
      : "holdout";
}

function manifestCore(files, options) {
  return {
    schemaVersion: "exp-0016-fleurs-source-manifest-v1",
    sourceId: "fleurs-pt-br-validation-prefix-v0.1",
    locale: "pt-BR",
    purpose: "fit-eligible-source-for-speaker-relevance-m4b",
    upstream: {
      dataset: "FLEURS",
      subset: "pt_br",
      splits: ["validation", "test"],
      archive: ARCHIVE,
      metadata: METADATA,
      datasetCard:
        "https://huggingface.co/datasets/google/fleurs/" +
        `tree/${ARCHIVE.huggingFaceRevision}`,
      license: "CC-BY-4.0",
      attribution:
        "FLEURS: Few-shot Learning Evaluation of Universal " +
        "Representations of Speech (Conneau et al., 2022)"
    },
    selection: {
      strategy:
        "pinned-validation-for-train-pinned-test-for-dev-holdout",
      requested: options.count,
      selected: files.length,
      sourceSpeakerIdentityAvailable: false,
      partitionsUseDisjointClipIds: true
    },
    retention: {
      rawAudioInGit: false,
      transcriptsInGit: false,
      featureDatasetMayBeCommitted: true,
      attributionRequired: true
    },
    files
  };
}

export function validateExp0016SourceManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !==
    "exp-0016-fleurs-source-manifest-v1") {
    errors.push("schemaVersion incompatível");
  }
  const core = structuredClone(manifest ?? {});
  delete core.manifestSha256;
  const observedHash = `sha256:${canonicalSha256(core)}`;
  if (manifest?.manifestSha256 !== observedHash) {
    errors.push("manifestSha256 divergente");
  }
  if (
    manifest?.upstream?.archive?.etag !== ARCHIVE.etag ||
    manifest?.upstream?.archive?.contentLength !== ARCHIVE.contentLength ||
    manifest?.upstream?.license !== "CC-BY-4.0"
  ) {
    errors.push("fonte/licença upstream divergente");
  }
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (
    files.length !== manifest?.selection?.requested ||
    files.length !== manifest?.selection?.selected ||
    new Set(files.map((file) => file.fileName)).size !== files.length
  ) {
    errors.push("seleção de arquivos inválida");
  }
  for (const file of files) {
    if (
      !["train", "development", "holdout"].includes(file.partition) ||
      !/^sha256:[a-f0-9]{64}$/u.test(file.waveSha256 ?? "") ||
      !/^sha256:[a-f0-9]{64}$/u.test(file.decodedPcmSha256 ?? "") ||
      typeof file.relativePath !== "string" ||
      file.sampleRate !== 16_000 ||
      file.channels < 1 ||
      file.sampleCount <= 0
    ) {
      errors.push(`${file?.fileName ?? "arquivo"} é incompatível`);
    }
  }
  for (const split of ["train", "development", "holdout"]) {
    if (!files.some((file) => file.partition === split)) {
      errors.push(`partição ausente: ${split}`);
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors,
    observedHash
  });
}

async function verifyLocal(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const validation = validateExp0016SourceManifest(manifest);
  const errors = [...validation.errors];
  for (const file of manifest.files ?? []) {
    const bytes = await readFile(resolve(PROJECT_ROOT, file.relativePath))
      .catch(() => null);
    if (bytes === null || `sha256:${sha256(bytes)}` !== file.waveSha256) {
      errors.push(`${file.fileName} ausente ou divergente`);
      continue;
    }
    const decoded = decodeWaveToPcm16(bytes, { targetSampleRate: 16_000 });
    if (
      `sha256:${sha256(decoded.pcm)}` !== file.decodedPcmSha256 ||
      decoded.pcm.length / 2 !== file.sampleCount
    ) {
      errors.push(`${file.fileName} PCM divergente`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`fonte EXP-0016 inválida: ${errors.join("; ")}`);
  }
  return manifest;
}

async function fetchSource(options) {
  const response = await fetch(ARCHIVE.url, {
    headers: { "Accept-Encoding": "identity" },
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok || response.body === null) {
    throw new Error(`FLEURS retornou HTTP ${response.status}`);
  }
  if (
    response.headers.get("etag") !== ARCHIVE.etag ||
    Number(response.headers.get("content-length")) !== ARCHIVE.contentLength
  ) {
    throw new Error("archive FLEURS diverge do objeto congelado");
  }
  const body = Readable.fromWeb(response.body);
  const gunzip = createGunzip();
  body.pipe(gunzip);
  const metadataResponse = await fetch(METADATA.url, {
    signal: AbortSignal.timeout(120_000)
  });
  if (!metadataResponse.ok) {
    throw new Error(`metadata FLEURS retornou HTTP ${metadataResponse.status}`);
  }
  const metadataZip = Buffer.from(await metadataResponse.arrayBuffer());
  if (
    metadataZip.length !== METADATA.contentLength ||
    sha256(metadataZip) !== METADATA.sha256
  ) {
    throw new Error("metadata.zip diverge do objeto congelado");
  }
  const devRows = metadataRows(
    zipEntry(metadataZip, "metadata/pt_br/dev.tsv"),
    "validation"
  );
  const testRows = metadataRows(
    zipEntry(metadataZip, "metadata/pt_br/test.tsv"),
    "test"
  );
  const selectedRows = sourceSelection(devRows, testRows, options.count);
  const selectedPaths = new Map(selectedRows.map((row) => [
    `pt_br/audio/${row.upstreamSplit === "validation" ? "dev" : "test"}/` +
      row.fileName,
    row
  ]));
  const files = [];
  try {
    await scanTarGzip(gunzip, {
      shouldCollect: (path) => selectedPaths.has(path),
      onEntry: async (entry) => {
        if (entry.bytes === null) {
          return false;
        }
        const fileName = entry.path.split("/").at(-1);
        const row = selectedPaths.get(entry.path);
        if (!row) {
          throw new Error(`${fileName} não existe em dev.tsv`);
        }
        const decoded = decodeWaveToPcm16(entry.bytes, {
          targetSampleRate: 16_000
        });
        const relativePath = `${options.outputRoot}/${fileName}`;
        await mkdir(dirname(resolve(PROJECT_ROOT, relativePath)), {
          recursive: true
        });
        await writeFile(resolve(PROJECT_ROOT, relativePath), entry.bytes);
        files.push({
          ...row,
          relativePath,
          waveSha256: `sha256:${sha256(entry.bytes)}`,
          decodedPcmSha256: `sha256:${sha256(decoded.pcm)}`,
          sourceSampleRate: decoded.source.sampleRate,
          sampleRate: decoded.sampleRate,
          channels: decoded.source.channels,
          sampleCount: decoded.pcm.length / 2
        });
        return files.length === options.count;
      }
    });
  } finally {
    gunzip.destroy();
    body.destroy();
  }
  if (files.length !== options.count) {
    throw new Error(
      `seleção incompleta: ${files.length}/${options.count} WAVs`
    );
  }
  const byName = new Map(files.map((file) => [file.fileName, file]));
  const orderedFiles = selectedRows.map((row, index) => ({
    ...byName.get(row.fileName),
    selectionIndex: index,
    partition: partition(index, options.count)
  }));
  const core = manifestCore(orderedFiles, options);
  const manifest = {
    ...core,
    manifestSha256: `sha256:${canonicalSha256(core)}`
  };
  const validation = validateExp0016SourceManifest(manifest);
  if (!validation.valid) {
    throw new Error(`manifest inválido: ${validation.errors.join("; ")}`);
  }
  const manifestPath = resolve(PROJECT_ROOT, options.manifest);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(PROJECT_ROOT, options.manifest);
  const manifest = options.check
    ? await verifyLocal(manifestPath)
    : await fetchSource(options);
  console.log(
    `EXP-0016 fonte ${options.check ? "CHECK" : "FETCH"}: ` +
      `${manifest.files.length} WAVs PT-BR, ${manifest.manifestSha256}`
  );
  console.log(
    "FLEURS CC-BY-4.0; áudio bruto local e fora do Git; zero API paga."
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
