import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0019_CRITICAL_SOURCE_PATHS,
  EXP0019_FROZEN_ARTIFACT_PATHS,
  EXP0019_TTS_CONFIG,
  createExp0019InstrumentationFreeze,
  validateExp0019InstrumentationFreeze
} from "../src/eval/exp-0019-boundary.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function modelArtifactBinding() {
  const paths = [
    "LICENSE",
    "config.json",
    "onnx/duration_predictor.onnx",
    "onnx/text_encoder.onnx",
    "onnx/tts.json",
    "onnx/unicode_indexer.json",
    "onnx/vector_estimator.onnx",
    "onnx/vocoder.onnx",
    "voice_styles/F4.json",
    "voice_styles/M4.json"
  ];
  const files = Object.fromEntries(paths.map((path) => [path, HASH_A]));
  return {
    files,
    canonicalSha256: `sha256:${canonicalSha256(files)}`
  };
}

function input() {
  return {
    runnerSourceCommit: "1".repeat(40),
    nodeVersion: "v22.0.0-test",
    artifacts: {
      preregistration: {
        path: EXP0019_FROZEN_ARTIFACT_PATHS.preregistration,
        fileSha256: HASH_A
      },
      plan: {
        path: EXP0019_FROZEN_ARTIFACT_PATHS.plan,
        fileSha256: HASH_A,
        canonicalSha256: HASH_B
      },
      browserCheckpoint: {
        path: EXP0019_FROZEN_ARTIFACT_PATHS.browserCheckpoint,
        fileSha256: HASH_A,
        canonicalSha256: HASH_B
      },
      sourceCheckpoint: {
        path: EXP0019_FROZEN_ARTIFACT_PATHS.sourceCheckpoint,
        fileSha256: HASH_A,
        canonicalSha256: HASH_B
      }
    },
    modelArtifactBinding: modelArtifactBinding(),
    toolchainBinding: {
      command: "uvx",
      executableSha256: HASH_A,
      version: "uvx 0.11.18 (test)"
    },
    criticalSources: EXP0019_CRITICAL_SOURCE_PATHS.map((path) => ({
      path,
      fileSha256: HASH_A
    }))
  };
}

function rehash(value) {
  delete value.instrumentationFreezeSha256;
  value.instrumentationFreezeSha256 =
    `sha256:${canonicalSha256(value)}`;
  return value;
}

test("freeze sela fontes, configuração, pesos locais e autoridade zero", () => {
  const freeze = createExp0019InstrumentationFreeze(input());
  assert.deepEqual(validateExp0019InstrumentationFreeze(freeze), {
    valid: true,
    errors: []
  });
  assert.deepEqual(freeze.tts.config, EXP0019_TTS_CONFIG);
  assert.equal(freeze.boundary.audioMaterializationsBeforeFreeze, 0);
  assert.equal(freeze.boundary.nodeReplaysBeforeFreeze, 0);
  assert.equal(freeze.boundary.browserCampaignsBeforeFreeze, 0);
  assert.equal(freeze.authority.canProduceEffects, false);
});

test("rehash externo não corrige violações estruturais do freeze", () => {
  for (const mutate of [
    (value) => { value.criticalSources[0].path = "src/other.mjs"; },
    (value) => { value.tts.config.voiceStyles.assistant = "F5"; },
    (value) => { value.boundary.audioMaterializationsBeforeFreeze = 1; },
    (value) => { value.authority.canProduceEffects = true; }
  ]) {
    const candidate = structuredClone(
      createExp0019InstrumentationFreeze(input())
    );
    mutate(candidate);
    rehash(candidate);
    assert.equal(
      validateExp0019InstrumentationFreeze(candidate).valid,
      false
    );
  }
});

test("binding de pesos com hash interno divergente é recusado", () => {
  const candidate = structuredClone(
    createExp0019InstrumentationFreeze(input())
  );
  candidate.tts.modelArtifactBinding.files.LICENSE = HASH_B;
  rehash(candidate);
  assert.equal(
    validateExp0019InstrumentationFreeze(candidate).valid,
    false
  );
});

test("construtor recusa binding TTS incompleto", () => {
  const candidate = input();
  delete candidate.modelArtifactBinding.files["voice_styles/M4.json"];
  candidate.modelArtifactBinding.canonicalSha256 =
    `sha256:${canonicalSha256(candidate.modelArtifactBinding.files)}`;
  assert.throws(
    () => createExp0019InstrumentationFreeze(candidate),
    /binding dos pesos TTS/iu
  );
});
