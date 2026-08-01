import assert from "node:assert/strict";
import test from "node:test";

import { encodePcm16Wave } from "../src/audio/wav.mjs";
import {
  finalizeTimingCalibrationPack,
  validateTimingCalibrationPack
} from "../src/eval/calibration/blind-session.mjs";
import {
  buildTimingCalibrationPack
} from "../src/eval/calibration/pack-builder.mjs";

function constantWave(milliseconds, value = 8_000) {
  const samples = milliseconds * 16;
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    pcm.writeInt16LE(value, index * 2);
  }
  return encodePcm16Wave(pcm, { sampleRate: 16_000 });
}

function configFixture() {
  return {
    schemaVersion: 1,
    id: "exp-0015-pack-test-v1",
    locale: "pt-BR",
    assistantPrompts: [{
      id: "prompt",
      text: "uma fala longa de teste",
      rate: 1
    }],
    audio: {
      sampleRate: 16_000,
      fadeMs: 20,
      assistantGainDb: -10,
      userGainDb: -10,
      crossfeedGainDb: -30,
      decisionEvidenceFrameMs: 20,
      decisionEvidenceLookbackMs: 200,
      decisionEvidenceLookaheadMs: 40,
      decisionEvidenceMinimumRmsDb: -40
    },
    protocol: {
      minimumCompletedPlaybacksPerOption: 1,
      allowedReasonTags: [],
      minimumParticipants: 3,
      minimumVotesPerScene: 3,
      minimumConsensusShare: 2 / 3,
      minimumLabelCoverage: 1,
      minimumAttentionPassRate: 0.8,
      unitOfAnalysis: "participant",
      identityPolicy:
        "pseudonymous-local-token-hashed-before-persistence"
    },
    scenes: [
      {
        id: "human-scene",
        family: "human",
        assistantPromptId: "prompt",
        userSource: { kind: "coraa", caseId: "human/one" },
        fitEligibility: "evaluation-only",
        durationMs: 1_000,
        userStartMs: 200,
        maximumUserMs: 400,
        decisionOffsetMs: 100,
        waitDelayMs: 150,
        waitTrajectory: "pause"
      },
      {
        id: "synthetic-scene",
        family: "synthetic",
        assistantPromptId: "prompt",
        userSource: { kind: "tts", text: "sim", rate: 2 },
        fitEligibility: "development-synthetic",
        durationMs: 1_000,
        userStartMs: 200,
        maximumUserMs: 400,
        decisionOffsetMs: 100,
        waitDelayMs: 150,
        waitTrajectory: "continue",
        attentionControl: {
          expectedActions: ["WAIT_FOR_EVIDENCE", "CONTINUE_OUTPUT"]
        }
      }
    ],
    gates: {
      expectedScenes: 2,
      minimumHumanAnchorScenes: 1,
      minimumAttentionControls: 1
    }
  };
}

test("builder materializa pack determinístico sem redistribuir áudio humano", async () => {
  const config = configFixture();
  const humanManifest = {
    source: { license: "test-evaluation-only" },
    cases: [{
      id: "human/one",
      category: "spontaneous",
      audio: "human.wav",
      expected: "conteúdo humano que não deve ir ao pack",
      metadata: { dataset: "fixture" }
    }]
  };
  const input = {
    config,
    configBytes: Buffer.from(`${JSON.stringify(config, null, 2)}\n`),
    configPath: "eval/experiments/test.json",
    humanManifest,
    outputRoot: "eval/generated/test-calibration",
    engine: { id: "fake-tts", voice: "fixture", culture: "pt-BR" },
    readWave: async () => constantWave(350, 6_000),
    synthesize: async (text) => text === "sim"
      ? constantWave(250, 5_000)
      : constantWave(1_500, 8_000)
  };
  const first = await buildTimingCalibrationPack(input);
  const repeated = await buildTimingCalibrationPack(input);

  assert.deepEqual(first, repeated);
  assert.equal(first.pack.buildGate.pass, true);
  assert.equal(first.artifacts.length, 6);
  assert.equal(validateTimingCalibrationPack(first.pack).valid, true);
  assert.equal(
    JSON.stringify(first.pack).includes("conteúdo humano"),
    false
  );
  assert.equal(
    first.pack.scenes[0].fitEligibility,
    "evaluation-only"
  );
  assert.ok(first.pack.scenes.every((scene) => scene.checks.noClipping));
  assert.ok(first.pack.scenes.every(
    (scene) => scene.checks.decisionHasAcousticEvidence
  ));

  const unsafeCore = structuredClone(first.pack);
  delete unsafeCore.packSha256;
  unsafeCore.protocol.minimumParticipants = 1;
  const unsafe = finalizeTimingCalibrationPack(unsafeCore);
  assert.equal(validateTimingCalibrationPack(unsafe).valid, false);

  const unsafeConfig = structuredClone(config);
  unsafeConfig.protocol.minimumParticipants = 1;
  await assert.rejects(
    buildTimingCalibrationPack({ ...input, config: unsafeConfig }),
    /pack de calibração construído é inválido/u
  );
});
