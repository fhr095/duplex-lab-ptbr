import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateFactoryCampaign
} from "../src/eval/factory/campaign-summary.mjs";

function fixture() {
  const packSha256 = "a".repeat(64);
  const assessment = {
    checks: [
      "final-transcript-current",
      "final-semantic-state",
      "single-commit",
      "single-semantic-revision",
      "no-premature-main-speech",
      "causal-event-order",
      "assistant-confirms-current",
      "audible-confirms-current",
      "no-obsolete-delegation"
    ].map((id) => ({ id, status: "pass" })).concat([
      { id: "causal-rollback", status: "pass" },
      { id: "no-obsolete-effect", status: "unmeasured" }
    ])
  };
  const browserResult = {
    id: "browser-1",
    timingPattern: "cross-turn",
    semanticPass: true,
    currentValueSafetyPass: true,
    safeOutcomePass: true,
    safeRepairPass: false,
    behaviorPass: true,
    renderStopPass: true,
    responseLatencyMs: 500,
    metrics: { stopRenderedMs: 40 },
    assessment,
    browserErrors: [],
    trace: [],
    observation: { commitCount: 1 }
  };
  const speechCase = {
    id: "speech-1",
    cohort: "synthetic",
    expectSpeech: true,
    actual: "sexta",
    transcript: { errors: 0, expectedWords: 1, wer: 0 },
    criticalPhrases: {
      required: ["sexta"], matched: ["sexta"], recall: 1
    },
    eventCounts: { speechStarts: 1, endpoints: 1, finals: 1 },
    turnIntegrity: { coherentSingleTurn: true, prematureEndpoint: false },
    timing: { realtimeEvidence: true },
    transport: {
      clientUnsentFrames: 0,
      serverLostFrames: 0,
      rejectedFrames: 0,
      protocolErrors: 0,
      audioDrainVerified: true
    }
  };
  const controlCase = {
    id: "control-1",
    cohort: "control",
    expectSpeech: false,
    eventCounts: { speechStarts: 0, finals: 0 },
    transport: {
      clientUnsentFrames: 0,
      serverLostFrames: 0,
      rejectedFrames: 0,
      protocolErrors: 0,
      audioDrainVerified: true
    }
  };
  const execution = {
    paidApiCalls: 0,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    externalLlmUsed: false
  };
  return {
    build: {
      build: {
        packId: "pack",
        packSha256,
        buildSha256: "b".repeat(64),
        caseCount: 1,
        liveAudioCaseCount: 1,
        browserCaseCount: 1
      },
      gates: { factoryIntegrity: { pass: true } },
      oracleMutationAudit: { killed: 8, total: 8 },
      coverage: { pass: true, pairwise: { ratio: 1 } }
    },
    audio: {
      sourcePack: { sha256: packSha256 },
      gate: { pass: true },
      summary: { caseCount: 1, uniqueWaveCount: 1 },
      entries: [{ waveSha256: "c".repeat(64) }]
    },
    acousticBuild: {
      source: { packSha256 },
      gate: { pass: true },
      entries: [{ deterministic: true, checks: { integrity: true } }]
    },
    live: {
      execution: structuredClone(execution),
      cases: [structuredClone(speechCase), structuredClone(controlCase)]
    },
    acousticLive: {
      execution: structuredClone(execution),
      cases: [structuredClone(speechCase), structuredClone(controlCase)]
    },
    browserText: {
      provenance: { sourcePackSha256: packSha256 },
      execution: structuredClone(execution),
      diagnostics: { consoleErrors: [], runtimeErrors: [], httpErrors: [] },
      results: [structuredClone(browserResult)]
    },
    browserPcm: {
      provenance: { sourcePackSha256: packSha256 },
      execution: structuredClone(execution),
      diagnostics: { consoleErrors: [], runtimeErrors: [], httpErrors: [] },
      results: [structuredClone(browserResult)]
    },
    browserPcmNoise: null,
    expectedBrowserCaseIds: ["browser-1"],
    expectedLiveCaseIds: ["speech-1", "control-1"],
    expectedAcousticCaseIds: ["speech-1", "control-1"],
    integrity: { manifest: true, reports: true, audio: true },
    inputArtifacts: []
  };
}

test("agregado promove toolchain, mas mantém prontidão em hold", () => {
  const report = aggregateFactoryCampaign(fixture());
  assert.equal(report.decisions.factoryToolchain, "promote");
  assert.equal(report.decisions.runtimeEngineering, "hold");
  assert.equal(report.gates.criticalSlotSafety.status, "pass");
  assert.equal(report.gates.responsiveness.status, "hold");
});

test("falha crítica observada não é apagada por médias verdes", () => {
  const input = fixture();
  input.live.cases[0].criticalPhrases = {
    required: ["Luiza", "Marina"],
    matched: ["Marina"],
    recall: 0.5
  };
  input.live.cases[0].actual = "Luísa";
  const report = aggregateFactoryCampaign(input);
  assert.equal(report.gates.websocketTranscriptFidelity.status, "fail");
  assert.equal(report.observedFailures.length, 1);
  assert.equal(report.observedFailures[0].finalTranscript, "Luísa");
});

test("booleans verdes não escondem resultados browser contraditórios", () => {
  const input = fixture();
  input.browserText.gates = {
    browserSemanticCorrection: { pass: true }
  };
  input.browserPcm.gates = {
    browserSemanticCorrection: { pass: true },
    criticalSlotSafety: { pass: true },
    browserRenderStop: { pass: true }
  };
  input.browserText.results[0].semanticPass = false;
  input.browserPcm.results[0].semanticPass = false;
  input.browserPcm.results[0].currentValueSafetyPass = false;
  input.browserPcm.results[0].safeOutcomePass = false;
  input.browserPcm.results[0].renderStopPass = false;
  input.browserPcm.results[0].metrics.stopRenderedMs = null;

  const report = aggregateFactoryCampaign(input);
  assert.equal(report.gates.browserTextSemanticCorrection.status, "fail");
  assert.equal(report.gates.browserPcmSemanticCompletion.status, "hold");
  assert.equal(report.gates.criticalSlotSafety.status, "fail");
  assert.equal(report.gates.browserRenderStop.status, "fail");
  assert.deepEqual(
    report.observedFailures
      .filter((item) => item.kind === "unsafe-current-value")
      .map((item) => item.source),
    ["browser-pcm-clean"]
  );
  assert.ok(
    report.honestHolds.some(
      (item) =>
        item.id === "browserTextSemanticCorrection" &&
        item.status === "fail"
    )
  );
});

test("honestHolds inclui gates falhos cuja decisão agregada é hold", () => {
  const input = fixture();
  input.live.cases[0].criticalPhrases.recall = 0;
  input.live.cases[0].criticalPhrases.matched = [];

  const report = aggregateFactoryCampaign(input);

  assert.ok(
    report.honestHolds.some(
      (item) =>
        item.id === "websocketTranscriptFidelity" &&
        item.status === "fail"
    )
  );
});

test("checks vazios, duplicados e reparo não audível falham fechados", () => {
  const input = fixture();
  input.browserText.results[0].assessment.checks = [];

  const pcm = input.browserPcm.results[0];
  pcm.semanticPass = false;
  pcm.currentValueSafetyPass = false;
  pcm.safeRepairPass = true;
  pcm.safeOutcomePass = true;
  pcm.criticalConflict = {
    policy: "clarify-before-commit",
    alternatives: ["not-number", 1150]
  };
  pcm.observation.commitCount = 0;
  pcm.trace = [{ type: "assistant.clarification", detail: "repita" }];

  const report = aggregateFactoryCampaign(input);
  assert.equal(report.gates.browserTextSemanticCorrection.status, "fail");
  assert.equal(report.gates.criticalSlotSafety.status, "fail");
});

test("IDs live duplicados não substituem casos esperados", () => {
  const input = fixture();
  const duplicate = structuredClone(input.live.cases[0]);
  duplicate.id = input.live.cases[0].id;
  input.live.cases = [input.live.cases[0], duplicate, input.live.cases[1]];
  input.expectedLiveCaseIds = ["speech-1", "speech-2", "control-1"];
  input.build.build.liveAudioCaseCount = 2;

  const acousticSecond = structuredClone(input.acousticLive.cases[0]);
  acousticSecond.id = "speech-2";
  input.acousticLive.cases.splice(1, 0, acousticSecond);
  input.expectedAcousticCaseIds = ["speech-1", "speech-2", "control-1"];

  const report = aggregateFactoryCampaign(input);
  assert.equal(report.gates.pcmPipelineOperability.status, "fail");
});

test("hash de pack divergente bloqueia o agregado", () => {
  const input = fixture();
  input.audio.sourcePack.sha256 = "c".repeat(64);
  assert.throws(
    () => aggregateFactoryCampaign(input),
    /audio.sourcePack/u
  );
});
