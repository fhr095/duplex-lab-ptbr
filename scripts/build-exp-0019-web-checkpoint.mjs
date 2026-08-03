import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateExp0018Checkpoint } from
  "../src/eval/exp-0018-training.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  CONTEXT_RELEVANCE_AVAILABILITY_KEYS,
  CONTEXT_RELEVANCE_CHECKPOINT_VERSION,
  CONTEXT_RELEVANCE_PAYLOAD_KEYS,
  CONTEXT_RELEVANCE_SHADOW_VERSION,
  EXP0019_SOURCE_CHECKPOINT,
  validateContextRelevanceCheckpoint
} from "../web/context-relevance-shadow.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const SOURCE_PATH = EXP0019_SOURCE_CHECKPOINT.path;
const OUTPUT_PATH = "web/context-relevance-checkpoint.json";

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`EXP-0019 browser checkpoint: ${message}`);
  }
}

function compactArm(sourceArm) {
  return {
    contextEnabled: sourceArm.contextEnabled,
    algorithm: sourceArm.model.algorithm,
    modelSha256: sourceArm.modelSha256,
    weightsSha256:
      `sha256:${canonicalSha256(sourceArm.model.weights)}`,
    weights: structuredClone(sourceArm.model.weights),
    threshold: sourceArm.threshold
  };
}

export function deriveExp0019WebCheckpoint(source, sourceFileSha256) {
  const sourceValidation = validateExp0018Checkpoint(source);
  assert(sourceValidation.valid,
    `checkpoint EXP-0018 inválido: ${sourceValidation.errors.join("; ")}`);
  assert(sourceFileSha256 === EXP0019_SOURCE_CHECKPOINT.fileSha256,
    "bytes do checkpoint EXP-0018 divergiram do binding congelado");
  assert(
    source.checkpointSha256 === EXP0019_SOURCE_CHECKPOINT.checkpointSha256,
    "hash canônico do checkpoint EXP-0018 divergiu"
  );
  for (const name of ["B0", "B1"]) {
    assert(
      source.arms[name].modelSha256 ===
        EXP0019_SOURCE_CHECKPOINT.modelSha256[name],
      `${name} divergiu do modelo EXP-0018 congelado`
    );
    assert(
      source.arms[name].threshold === EXP0019_SOURCE_CHECKPOINT.threshold[name],
      `${name} divergiu do limiar EXP-0018 congelado`
    );
    assert(
      isDeepStrictEqual(source.arms[name].model.classNames, source.classes),
      `${name} divergiu das classes globais`
    );
    assert(
      source.arms[name].model.featureCount === source.featureNames.length,
      `${name} divergiu do contrato de features`
    );
  }

  const core = {
    schemaVersion: CONTEXT_RELEVANCE_CHECKPOINT_VERSION,
    shadowVersion: CONTEXT_RELEVANCE_SHADOW_VERSION,
    checkpointId: source.checkpointId,
    source: {
      path: SOURCE_PATH,
      fileSha256: sourceFileSha256,
      checkpointSha256: source.checkpointSha256,
      checkpointId: source.checkpointId
    },
    featureVersion: source.featureVersion,
    featureNames: structuredClone(source.featureNames),
    classes: structuredClone(source.classes),
    arms: {
      B0: compactArm(source.arms.B0),
      B1: compactArm(source.arms.B1)
    },
    adapter: {
      payloadKeys: [...CONTEXT_RELEVANCE_PAYLOAD_KEYS],
      availabilityKeys: [...CONTEXT_RELEVANCE_AVAILABILITY_KEYS],
      deferStatus: "DEFER_CAUSAL_EVIDENCE",
      proposalStatus: "SHADOW_PROPOSAL",
      classifierCallsPerProposal: 2,
      effectsAllowed: false
    },
    authority: { mode: "shadow-only", canProduceEffects: false }
  };
  const checkpoint = {
    ...core,
    browserCheckpointSha256: `sha256:${canonicalSha256(core)}`
  };
  const validation = validateContextRelevanceCheckpoint(checkpoint);
  assert(validation.valid,
    `artefato derivado inválido: ${validation.errors.join("; ")}`);
  return checkpoint;
}

export async function buildExp0019WebCheckpoint(options = {}) {
  const sourceBytes = await readFile(resolve(PROJECT_ROOT, SOURCE_PATH));
  const source = JSON.parse(sourceBytes.toString("utf8"));
  const checkpoint = deriveExp0019WebCheckpoint(
    source,
    sha256Bytes(sourceBytes)
  );
  const bytes = `${JSON.stringify(checkpoint, null, 2)}\n`;
  const output = resolve(PROJECT_ROOT, OUTPUT_PATH);
  if (options.check === true) {
    const current = await readFile(output, "utf8");
    assert(current === bytes, `${OUTPUT_PATH} não é reproduzível`);
  } else {
    await writeFile(output, bytes);
  }
  return checkpoint;
}

async function main() {
  const unknown = process.argv.slice(2).filter((value) => value !== "--check");
  assert(unknown.length === 0, `argumentos desconhecidos: ${unknown.join(", ")}`);
  const check = process.argv.includes("--check");
  const checkpoint = await buildExp0019WebCheckpoint({ check });
  console.log(
    `${check ? "EXP-0019 browser checkpoint OK" :
      "EXP-0019 browser checkpoint materializado"}: ` +
      checkpoint.browserCheckpointSha256
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
