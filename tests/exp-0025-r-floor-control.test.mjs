import assert from "node:assert/strict";
import test from "node:test";

import { encodePcm16Wave } from "../src/audio/wav.mjs";
import {
  EXP0025_R_ACTIONS,
  EXP0025_R_TOKENS,
  analyzeExp0025RBaselineHeadroom,
  evaluateDuplexCascadeSentinels,
  interpretDuplexCascadeOutput,
  replayAdaptiveEndpoint,
  validateExp0025RFloorPack
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { buildExp0025RDevelopmentPack } from
  "../scripts/build-exp-0025-r-development-pack.mjs";
import { composeExp0025RPairAudio } from
  "../scripts/materialize-exp-0025-r-audio.mjs";

function voicedWave(durationMs, value = 2_000) {
  const samples = 16_000 * durationMs / 1_000;
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    pcm.writeInt16LE(value, index * 2);
  }
  return encodePcm16Wave(pcm, { sampleRate: 16_000, channels: 1 });
}

test("protocolo contextual não confunde backchannel com tomada do piso", () => {
  assert.equal(interpretDuplexCascadeOutput({
    assistantSpeaking: true,
    output: EXP0025_R_TOKENS.userBackchannel
  }).action, EXP0025_R_ACTIONS.keepAssistantFloor);
  assert.equal(interpretDuplexCascadeOutput({
    assistantSpeaking: false,
    output: EXP0025_R_TOKENS.userBackchannel
  }).action, EXP0025_R_ACTIONS.protocolFailure);
  assert.equal(interpretDuplexCascadeOutput({
    assistantSpeaking: true,
    output: EXP0025_R_TOKENS.userInterruption
  }).action, EXP0025_R_ACTIONS.yieldFloor);
  assert.equal(interpretDuplexCascadeOutput({
    assistantSpeaking: false,
    output: EXP0025_R_TOKENS.userFinish
  }).action, EXP0025_R_ACTIONS.takeFloor);
});

test("quatro sentinelas inglesas congelam transições antes de D", () => {
  const valid = evaluateDuplexCascadeSentinels([
    { id: "english-user-talking", output: EXP0025_R_TOKENS.userTalking },
    { id: "english-user-finished", output: EXP0025_R_TOKENS.userFinish },
    { id: "english-user-backchannel", output: EXP0025_R_TOKENS.userBackchannel },
    { id: "english-user-interruption", output: EXP0025_R_TOKENS.userInterruption }
  ]);
  assert.equal(valid.status, "PASS");
  assert.equal(valid.passed, 4);

  const wrong = evaluateDuplexCascadeSentinels([
    { id: "english-user-talking", output: EXP0025_R_TOKENS.userTalking },
    { id: "english-user-finished", output: EXP0025_R_TOKENS.userFinish },
    { id: "english-user-backchannel", output: EXP0025_R_TOKENS.userFinish },
    { id: "english-user-interruption", output: EXP0025_R_TOKENS.userInterruption }
  ]);
  assert.equal(wrong.status, "E_PROTOCOL_FAILURE");
});

test("pack D contém 16 pares realmente pareados em oito sessões", () => {
  const pack = buildExp0025RDevelopmentPack();
  assert.equal(validateExp0025RFloorPack(pack).valid, true);
  assert.equal(pack.pairs, 16);
  assert.equal(pack.utterances.length, 32);
  assert.equal(new Set(pack.utterances.map((item) => item.sessionId)).size, 8);
  for (const pairId of new Set(pack.utterances.map((item) => item.pairId))) {
    const pair = pack.utterances.filter((item) => item.pairId === pairId);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].prefix, pair[1].prefix);
    assert.deepEqual(pair[0].microturns, pair[1].microturns);
  }

  const leakedContext = structuredClone(pack);
  leakedContext.utterances[0].assistantSpeaking = true;
  assert.equal(validateExp0025RFloorPack(leakedContext).valid, false);
});

test("A0@600 projeta a mesma política sem virar challenger", () => {
  const pack = buildExp0025RDevelopmentPack();
  const completePair = pack.utterances.filter((item) =>
    item.pairId === "exp0025r-dev-p03");
  const continues = completePair.find((item) => item.outcome === "CONTINUES");
  const ends = completePair.find((item) => item.outcome === "ENDS");
  const nativeContinues = replayAdaptiveEndpoint(continues, { gridMs: 20 });
  const gridContinues = replayAdaptiveEndpoint(continues, { gridMs: 600 });
  const nativeEnds = replayAdaptiveEndpoint(ends, { gridMs: 20 });
  const gridEnds = replayAdaptiveEndpoint(ends, { gridMs: 600 });

  assert.equal(nativeContinues.prematureTakeover, true);
  assert.equal(gridContinues.prematureTakeover, true);
  assert.equal(nativeEnds.postFinalDecisionDelayMs, 520);
  assert.equal(gridEnds.postFinalDecisionDelayMs, 600);
});

test("composição WAV preserva prefixo físico idêntico no par", () => {
  const audio = composeExp0025RPairAudio({
    prefixWave: voicedWave(1_000),
    suffixWave: voicedWave(500, 3_000),
    pauseMs: 600
  });
  const prefixBytes = 2_400 * 16 * 2;
  const continuesPrefix = audio.continuesWave.subarray(44, 44 + prefixBytes);
  const endsPrefix = audio.endsWave.subarray(44, 44 + prefixBytes);
  assert.deepEqual(continuesPrefix, endsPrefix);
  assert.equal(audio.prefixPcmSha256.length, 64);
});

test("gate de headroom usa A0 native e mantém E sem autorização", () => {
  const report = analyzeExp0025RBaselineHeadroom(
    buildExp0025RDevelopmentPack()
  );
  assert.equal(report.gate.pass, true);
  assert.ok(report.gate.observedPrematureTakeovers >= 4);
  assert.equal(report.gate.protocolFailureCount, 0);
  assert.equal(report.a0At600.role, "CADENCE_DIAGNOSTIC_NOT_CHALLENGER");
  assert.equal(report.externalExecutionAuthorized, false);
  assert.equal(report.holdoutOpened, false);
  assert.equal(report.authorityEligible, false);
});
