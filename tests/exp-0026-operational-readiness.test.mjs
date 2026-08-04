import assert from "node:assert/strict";
import test from "node:test";

import {
  createExp0026OperationalReadinessReport,
  evaluateExp0026AcousticQualification
} from "../src/eval/exp-0026-operational-readiness.mjs";

function observation(overrides = {}) {
  return {
    schemaVersion: "exp-0026-acoustic-observation-v1",
    attemptId: "EXP-0026-OQ-A-ONE",
    observedAt: "2026-08-03T12:00:00.000Z",
    browser: { isolatedContext: true, secureOrigin: true },
    microphone: {
      permission: "granted",
      trackReadyState: "live",
      deviceIdSha256: `sha256:${"f".repeat(64)}`,
      sampleRate: 48_000,
      channelCount: 1
    },
    capture: {
      receivedFrames: 500,
      deliveredFrames: 500,
      observedSequenceGaps: 0,
      observedSampleGaps: 0,
      protocolErrors: 0
    },
    fixedSpeech: { speechStartObserved: true, nonemptyFinalObserved: true },
    tts: {
      rendererStarted: true,
      rendererFinished: true,
      operatorAudibleAck: true,
      microphoneCaptureNonSilent: true
    },
    overlap: { captureAdvanced: true, turnDecisionObserved: true },
    recorder: {
      decodable: true,
      rawDeleted: true,
      durationMs: 12_000,
      rms: 0.02,
      bytes: 12_345,
      sha256: `sha256:${"a".repeat(64)}`
    },
    noise: {
      artifactHashMatched: true,
      playedThroughPhysicalOutput: true,
      silenceRms: 0.001,
      noiseRms: 0.01
    },
    ...overrides
  };
}

test("PASS acústico prova observabilidade sem julgar conteúdo ou interrupção", () => {
  const result = evaluateExp0026AcousticQualification(observation());
  assert.equal(result.pass, true);
  assert.equal(result.scopeProtections.asrContentOrCerGate, false);
  assert.equal(result.scopeProtections.interruptionQualityGate, false);
  assert.equal(result.scopeProtections.perceptualProductQualityGate, false);
});

test("elo físico ausente falha terminalmente sem inventar gate de qualidade", () => {
  const value = observation();
  value.tts.operatorAudibleAck = false;
  const result = evaluateExp0026AcousticQualification(value);
  assert.equal(result.pass, false);
  assert.equal(result.decision, "PHYSICAL_CHAIN_NOT_QUALIFIED_TERMINAL");
});

test("readiness exige os quatro fechamentos, sem consenso discricionário", () => {
  const acoustic = evaluateExp0026AcousticQualification(observation());
  const automated = {
    frozenSignatureVocabulary: true,
    deterministicRanking: true,
    unknownRemainsUnattributed: true,
    postCompleteWithdrawal: true,
    postOpenReanalysis: true,
    postCloseoutArtifactInvalidation: true,
    retentionPurge: true,
    exhaustiveDiversityValidation: true,
    administrativeOnlyReplacement: true,
    startedSessionRequiresWithdrawal: true,
    maximumTwoActivations: true,
    withinTerminalBudget: true
  };
  const report = createExp0026OperationalReadinessReport({
    acoustic,
    automated,
    amendment: { path: "docs/amendment", sha256: `sha256:${"b".repeat(64)}` },
    sourceCommit: "c".repeat(40),
    openingCommitment: { path: "opening", sha256: `sha256:${"d".repeat(64)}` },
    completedAt: "2026-08-03T12:15:00.000Z",
    timebox: { wallMinutes: 10, physicalAttempts: 1 },
    automatedEvidence: [],
    prohibitedScopeRemainedClosed: true
  });
  assert.equal(report.decision, "READY_TO_FREEZE_EXP_0026");
  assert.equal(report.executionDisposition, "COMPLETED");
  automated.retentionPurge = false;
  assert.equal(createExp0026OperationalReadinessReport({
    acoustic,
    automated,
    amendment: {}, sourceCommit: "c".repeat(40), openingCommitment: {},
    completedAt: "2026-08-03T12:15:00.000Z", timebox: {},
    automatedEvidence: [], prohibitedScopeRemainedClosed: true
  }).decision, "NOT_READY_FOR_FREEZE_TERMINAL");
});
