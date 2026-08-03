import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXP0019_BROWSER_REPETITIONS,
  EXP0019_NODE_REPLAY_SCHEMA,
  exp0019BrowserTargetUrl,
  normalizeExp0019BrowserTrace,
  parseExp0019BrowserArgs,
  runExp0019BrowserCampaign,
  validateExp0019BrowserReport,
  validateExp0019BrowserReplayInput
} from "../scripts/smoke-exp-0019-browser.mjs";
import {
  canonicalSha256
} from "../src/eval/factory/canonical-hash.mjs";
import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_CRITICAL_SOURCE_PATHS,
  EXP0019_INSTRUMENTATION_FREEZE_PATH,
  EXP0019_TTS_CONFIG,
  createExp0019InstrumentationFreeze
} from "../src/eval/exp-0019-boundary.mjs";
import {
  EXP0019_ONSET_CONFIG,
  EXP0019_RUNTIME_FINGERPRINT_SCHEMA
} from "../src/eval/exp-0019-replay.mjs";
import {
  ContextRelevanceShadow
} from "../web/context-relevance-shadow.mjs";

const CHECKPOINT_PATH = "web/context-relevance-checkpoint.json";
const CHECKPOINT_URL = new URL(
  `../${CHECKPOINT_PATH}`,
  import.meta.url
);
const PLAN_URL = new URL(
  "../eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
  import.meta.url
);
const HEALTH_FINGERPRINT = `sha256:${"a".repeat(64)}`;

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fixture() {
  const [checkpointBytes, planBytes] = await Promise.all([
    readFile(CHECKPOINT_URL),
    readFile(PLAN_URL)
  ]);
  const checkpoint = JSON.parse(checkpointBytes.toString("utf8"));
  const plan = JSON.parse(planBytes.toString("utf8"));
  const scenes = plan.scenes.map((scene, sceneIndex) => {
    const availability = {
      recentInboundAvailableAtSample: 16_000 + sceneIndex * 1_000,
      assistantAudiblePrefixAvailableAtSample: 32_000 + sceneIndex * 1_000,
      targetAvailableAtSample: 48_000 + sceneIndex * 1_000
    };
    const payloadAt = (currentSample) => ({
      assistantAudiblePrefixAtDecision: currentSample >=
        availability.assistantAudiblePrefixAvailableAtSample
        ? scene.oracleText.assistantAudiblePrefixAtDecision
        : null,
      assistantAudiblePrefixAvailableAtSample:
        availability.assistantAudiblePrefixAvailableAtSample,
      assistantSpeaking: true,
      currentSample,
      recentInbound: currentSample >=
        availability.recentInboundAvailableAtSample
        ? [...scene.oracleText.recentInbound]
        : [],
      recentInboundAvailableAtSample:
        availability.recentInboundAvailableAtSample,
      targetAvailableAtSample: availability.targetAvailableAtSample,
      targetText: currentSample >= availability.targetAvailableAtSample
        ? scene.oracleText.targetText
        : null
    });
    const deferArm = () => ({
      status: "DEFER_CAUSAL_EVIDENCE",
      classifierExecuted: false,
      inferenceCountDelta: 0,
      canProduceEffects: false,
      missingEvidence: ["fixture"]
    });
    const readyPayload = payloadAt(availability.targetAvailableAtSample);
    const expected = new ContextRelevanceShadow(checkpoint).evaluate(
      readyPayload
    );
    const readyArms = Object.fromEntries(["B0", "B1"].map((name) => {
      const arm = expected.proposal.arms[name];
      return [name, {
        status: "SHADOW_PROPOSAL",
        classifierExecuted: true,
        inferenceCountDelta: 1,
        canProduceEffects: false,
        modelInput: name === "B0"
          ? {
              assistantSpeaking: true,
              targetText: readyPayload.targetText
            }
          : {
              assistantAudiblePrefixAtDecision:
                readyPayload.assistantAudiblePrefixAtDecision,
              assistantSpeaking: true,
              recentInbound: [...readyPayload.recentInbound],
              targetText: readyPayload.targetText
            },
        trace: {
          contextEnabled: arm.contextEnabled,
          modelSha256: arm.modelSha256,
          threshold: arm.threshold,
          featureValues: [...arm.features.values],
          probabilities: { ...arm.probabilities },
          backgroundProbability: arm.backgroundProbability,
          rawPredicted: arm.rawPredicted,
          predicted: arm.predicted
        },
        computeMs: 0.5,
        frozenTraceExact: true
      }];
    }));
    return {
      sceneId: scene.sceneId,
      pairRootId: scene.scorer.pairRootId,
      scorer: structuredClone(scene.scorer),
      streamBindings: structuredClone(scene.streamBindings),
      normalization: { sampleRate: 16_000 },
      scheduleSha256: `sha256:${String(sceneIndex).padStart(64, "0")}`,
      probes: [
        [
          "recentInboundAvailableAtSample",
          availability.recentInboundAvailableAtSample - 1
        ],
        [
          "assistantAudiblePrefixAvailableAtSample",
          availability.assistantAudiblePrefixAvailableAtSample - 1
        ],
        [
          "targetAvailableAtSample",
          availability.targetAvailableAtSample - 1
        ]
      ].map(([boundary, currentSample]) => {
        const payload = payloadAt(currentSample);
        return {
          boundary,
          currentSample,
          payload,
          payloadSha256: `sha256:${canonicalSha256(payload)}`,
          arms: { B0: deferArm(), B1: deferArm() }
        };
      }),
      ready: {
        currentSample: availability.targetAvailableAtSample,
        payload: readyPayload,
        arms: readyArms
      }
    };
  });
  const criticalSourceBytes = new Map(
    EXP0019_CRITICAL_SOURCE_PATHS.map((path) => [
      path,
      Buffer.from(`fixture critical source: ${path}\n`)
    ])
  );
  const modelFiles = Object.fromEntries([
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
  ].map((path) => [path, `sha256:${"9".repeat(64)}`]));
  const freeze = createExp0019InstrumentationFreeze({
    runnerSourceCommit: "1".repeat(40),
    nodeVersion: process.version,
    artifacts: {
      preregistration: {
        path: "docs/experiments/EXP-0019-causal-audio-context-bridge.md",
        fileSha256: `sha256:${"2".repeat(64)}`
      },
      plan: {
        path: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
        fileSha256: sha256Bytes(planBytes),
        canonicalSha256: plan.planSha256
      },
      browserCheckpoint: {
        path: CHECKPOINT_PATH,
        fileSha256: sha256Bytes(checkpointBytes),
        canonicalSha256: checkpoint.browserCheckpointSha256
      },
      sourceCheckpoint: {
        path: checkpoint.source.path,
        fileSha256: checkpoint.source.fileSha256,
        canonicalSha256: checkpoint.source.checkpointSha256
      }
    },
    modelArtifactBinding: {
      files: modelFiles,
      canonicalSha256: `sha256:${canonicalSha256(modelFiles)}`
    },
    toolchainBinding: {
      command: "uvx",
      executableSha256: `sha256:${"9".repeat(64)}`,
      version: "uvx 0.11.18 (test)"
    },
    criticalSources: EXP0019_CRITICAL_SOURCE_PATHS.map((path) => ({
      path,
      fileSha256: sha256Bytes(criticalSourceBytes.get(path))
    }))
  });
  const freezeBytes = Buffer.from(`${JSON.stringify(freeze, null, 2)}\n`);
  const configuration = {
    sampleRate: 16_000,
    onset: structuredClone(EXP0019_ONSET_CONFIG),
    fixedGapSamples: 1_600,
    targetAfterPrefixSamples: 1_280,
    assistantTailAfterTargetSamplesAtLeast: 4_800,
    pairNormalization:
      "leading-silence-aligns-observed-ends;spoken-tail-truncated-to-common-horizon"
  };
  const bindings = {
    instrumentationFreeze: {
      path: EXP0019_INSTRUMENTATION_FREEZE_PATH,
      fileSha256: sha256Bytes(freezeBytes),
      canonicalSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    },
    audioAttempt: {
      path: EXP0019_AUDIO_ATTEMPT_PATH,
      fileSha256: `sha256:${"7".repeat(64)}`,
      canonicalSha256: `sha256:${"8".repeat(64)}`,
      executionHeadCommit: freeze.runnerSourceCommit
    },
    plan: {
      path: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
      fileSha256: sha256Bytes(planBytes),
      canonicalSha256: plan.planSha256
    },
    manifest: {
      path: "eval/sources/exp-0019-causal-audio-v0.1.json",
      fileSha256: `sha256:${"c".repeat(64)}`,
      canonicalSha256: `sha256:${"d".repeat(64)}`
    },
    checkpoint: {
      path: checkpoint.source.path,
      fileSha256: checkpoint.source.fileSha256,
      canonicalSha256: checkpoint.source.checkpointSha256
    }
  };
  const fingerprintCore = {
    schemaVersion: EXP0019_RUNTIME_FINGERPRINT_SCHEMA,
    instrumentationFreezeSha256:
      bindings.instrumentationFreeze.canonicalSha256,
    audioAttemptSha256: bindings.audioAttempt.canonicalSha256,
    planSha256: bindings.plan.canonicalSha256,
    manifestSha256: bindings.manifest.canonicalSha256,
    checkpointSha256: bindings.checkpoint.canonicalSha256,
    sampleRate: configuration.sampleRate,
    onset: configuration.onset,
    fixedGapSamples: configuration.fixedGapSamples,
    targetAfterPrefixSamples: configuration.targetAfterPrefixSamples,
    assistantTailAfterTargetSamplesAtLeast:
      configuration.assistantTailAfterTargetSamplesAtLeast
  };
  bindings.runtimeFingerprint = {
    schemaVersion: EXP0019_RUNTIME_FINGERPRINT_SCHEMA,
    sha256: `sha256:${canonicalSha256(fingerprintCore)}`
  };
  const replayCore = {
    schemaVersion: EXP0019_NODE_REPLAY_SCHEMA,
    experimentId: "EXP-0019",
    status: "NODE_REPLAY_COMPLETE",
    bindings,
    configuration,
    runtime: { engine: "node", nodeVersion: process.version },
    audio: {
      streams: [],
      targetPairEqualityExact: true,
      assistantTailAudibleThroughBudget: true
    },
    pairs: [],
    scenes,
    summary: {
      scenes: 8,
      pairs: 4,
      proposals: 16,
      preBoundaryArmProbes: 48,
      preBoundaryInferences: 0,
      frozenTraceParity: "16/16",
      nodeComputeP95Ms: 0.5,
      nodeComputeBudgetMs: 50,
      nodeComputeWithinBudget: true
    },
    authority: {
      mode: "offline-shadow-only",
      canProduceEffects: false,
      effectsDispatched: 0
    }
  };
  const replay = {
    ...replayCore,
    replaySha256: `sha256:${canonicalSha256(replayCore)}`
  };
  return {
    checkpoint,
    criticalSourceBytes,
    freeze,
    freezeFileSha256: sha256Bytes(freezeBytes),
    replay
  };
}

function checkpointIdentity(checkpoint) {
  return {
    schemaVersion: checkpoint.schemaVersion,
    checkpointId: checkpoint.checkpointId,
    browserCheckpointSha256: checkpoint.browserCheckpointSha256,
    sourceCheckpointSha256: checkpoint.source.checkpointSha256,
    arms: Object.fromEntries(["B0", "B1"].map((name) => [name, {
      modelSha256: checkpoint.arms[name].modelSha256,
      threshold: checkpoint.arms[name].threshold
    }])),
    authority: structuredClone(checkpoint.authority),
    adapter: structuredClone(checkpoint.adapter)
  };
}

function extractJson(expression, declaration, delimiter = ";\n") {
  const start = expression.indexOf(declaration);
  assert.ok(start >= 0, `declaração ausente: ${declaration}`);
  const valueStart = start + declaration.length;
  const valueEnd = expression.indexOf(delimiter, valueStart);
  return JSON.parse(expression.slice(valueStart, valueEnd));
}

function createFakeCdp(checkpoint, options = {}) {
  const commands = [];
  const timeline = [];
  const diagnostics = {
    consoleErrors: [],
    runtimeErrors: [],
    httpErrors: []
  };
  let closed = false;
  let repetition = 0;
  let runtime = null;
  let performanceMs = 0;
  let release = null;
  let readyInRepetition = 0;

  const chrome = {
    diagnostics,
    commands,
    timeline,
    get closed() {
      return closed;
    },
    clearDiagnostics() {
      diagnostics.consoleErrors.length = 0;
      diagnostics.runtimeErrors.length = 0;
      diagnostics.httpErrors.length = 0;
    },
    async send(method, params = {}) {
      commands.push({ method, params });
      if (method === "Page.navigate") {
        timeline.push("navigate");
        repetition += 1;
        readyInRepetition = 0;
        runtime = new ContextRelevanceShadow(checkpoint);
      }
      return {};
    },
    async waitFor(probe) {
      const value = await probe();
      assert.ok(value);
      return value;
    },
    async evaluate(expression) {
      if (expression.includes("EXP0019_WAIT_READY")) return true;
      if (expression.includes("EXP0019_CHECKPOINT_READY")) {
        performanceMs += repetition * 100;
        return {
          checkpointReadyAtPerformanceMs: performanceMs,
          snapshot: runtime.snapshot,
          servedCheckpoint: checkpointIdentity(checkpoint)
        };
      }
      if (expression.includes("EXP0019_PHYSICAL_RESET")) {
        return { reset: true };
      }
      if (expression.includes("EXP0019_PHYSICAL_START")) {
        const stage = extractJson(expression, "stage: ", ",\n");
        timeline.push(stage);
        return {
          stage,
          requestedAtPerformanceMs: performanceMs += 5,
          contextCountersBefore: {
            deferCount: runtime.snapshot.deferCount,
            inferenceCount: runtime.snapshot.inferenceCount,
            invalidCount: runtime.snapshot.invalidCount,
            proposalCount: runtime.snapshot.proposalCount,
            effectsDispatched: runtime.snapshot.effectsDispatched
          }
        };
      }
      const physicalSnapshot = (stopped) => ({
        state: { assistantSpeaking: !stopped },
        audio: {
          contextRelevanceShadow: runtime.snapshot,
          outputInterruptionLifecycle: {
            phase: stopped ? "held" : "idle",
            pauseKind: stopped ? "audible" : null
          },
          lastRenderStop: stopped
            ? {
                kind: "browser-render-stop",
                triggerAtMs: performanceMs,
                lastRenderedAtMs: performanceMs + 40,
                observedAtMs: performanceMs + 42,
                latencyMs: 40,
                renderedThroughTrigger: true,
                mapping: "getOutputTimestamp",
                baseLatencyMs: 10,
                outputLatencyMs: 5,
                lastActiveEndContextTime: 2,
                observedContextTime: 2.1,
                requiredSilenceQuanta: 2,
                threshold: 0.001,
                scope: "fixture physical render"
              }
            : null
        },
        metrics: { stopRenderedMs: stopped ? 40 : null },
        trace: stopped
          ? [
              { type: "assistant.render.active", detail: "fixture" },
              {
                type: "output-interruption.transition",
                detail: JSON.stringify({
                  eventType: "PAUSE_REQUESTED",
                  previousPhase: "idle",
                  phase: "held",
                  reason: "hold-created",
                  pauseKind: "audible",
                  intents: [{ type: "PAUSE_OUTPUT" }]
                })
              },
              { type: "assistant.speech.paused", detail: "fixture" },
              { type: "assistant.render.stopped", detail: "fixture" }
            ]
          : [{ type: "assistant.render.active", detail: "fixture" }]
      });
      if (expression.includes("EXP0019_PHYSICAL_WAIT_SPEAKING")) {
        return physicalSnapshot(false);
      }
      if (expression.includes("EXP0019_PHYSICAL_TRIGGER")) {
        return physicalSnapshot(false);
      }
      if (expression.includes("EXP0019_PHYSICAL_WAIT_STOP")) {
        if (options.physicalUnavailable === true) {
          throw new Error("renderer físico indisponível");
        }
        performanceMs += 40;
        return physicalSnapshot(true);
      }
      if (expression.includes("EXP0019_PHYSICAL_DIAGNOSTIC")) {
        return physicalSnapshot(false);
      }
      if (expression.includes("EXP0019_RELEASE_EVIDENCE")) {
        release = {
          sceneId: extractJson(
            expression,
            "const release = {\n      sceneId: ",
            ",\n"
          ),
          currentSample: extractJson(expression, "currentSample: ", ",\n"),
          lastEvidenceAtPerformanceMs: performanceMs += 10
        };
        return structuredClone(release);
      }
      const ready = expression.includes("EXP0019_EVALUATE_READY");
      const probe = expression.includes("EXP0019_EVALUATE_PROBE");
      assert.equal(ready || probe, true, "expressão CDP desconhecida");
      timeline.push("shadow-evaluation");
      const sceneId = extractJson(expression, "const sceneId = ");
      const payload = extractJson(expression, "const payload = ");
      const calculationStartedAtPerformanceMs = performanceMs += 0.25;
      const evaluated = runtime.evaluate(payload);
      const proposalAtPerformanceMs = performanceMs += 0.75;
      if (ready) readyInRepetition += 1;
      const result = structuredClone(evaluated);
      if (
        options.semanticDriftOnSecond === true &&
        repetition === 2 && ready && readyInRepetition === 1
      ) {
        result.proposal.arms.B1.predicted =
          result.proposal.arms.B1.predicted === "DIRECTED_TO_ASSISTANT"
            ? "BACKGROUND_OR_NOT_DIRECTED"
            : "DIRECTED_TO_ASSISTANT";
      }
      const lifecycle = { phase: "idle", authority: "deterministic" };
      return {
        sceneId,
        phase: ready ? "ready" : "probe",
        payload,
        result,
        snapshot: runtime.snapshot,
        lifecycle: { before: lifecycle, after: { ...lifecycle } },
        timing: {
          lastEvidenceAtPerformanceMs: ready
            ? release.lastEvidenceAtPerformanceMs
            : null,
          calculationStartedAtPerformanceMs,
          calculationCompletedAtPerformanceMs: proposalAtPerformanceMs,
          proposalAtPerformanceMs,
          proposalLatencyMs: ready
            ? proposalAtPerformanceMs - release.lastEvidenceAtPerformanceMs
            : null,
          calculationMs:
            proposalAtPerformanceMs - calculationStartedAtPerformanceMs
        }
      };
    },
    close() {
      closed = true;
    }
  };
  return chrome;
}

function healthFetch(fingerprints, calls) {
  return async (url) => {
    calls.push(String(url));
    const value = fingerprints[Math.min(calls.length - 1,
      fingerprints.length - 1)];
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          process: {
            runtimeFingerprint: { sha256: value.replace("sha256:", "") }
          }
        };
      }
    };
  };
}

function frozenOptions(data) {
  return {
    instrumentationFreeze: data.freeze,
    instrumentationFreezeFileSha256: data.freezeFileSha256,
    replayFileSha256: sha256Bytes(Buffer.from(JSON.stringify(data.replay))),
    readCriticalSource: async (absolutePath) => {
      const found = [...data.criticalSourceBytes].find(([path]) =>
        String(absolutePath).endsWith(`/${path}`)
      );
      if (!found) throw new Error(`fonte fake ausente: ${absolutePath}`);
      return found[1];
    }
  };
}

test("CLI fixa localhost EXP-0019 e nega terceira execução", () => {
  const parsed = parseExp0019BrowserArgs([]);
  assert.equal(parsed.repetitions, EXP0019_BROWSER_REPETITIONS);
  assert.equal(
    parsed.targetUrl,
    "http://localhost:4173/?automation=1&experiment=0019"
  );
  assert.equal(
    exp0019BrowserTargetUrl("http://127.0.0.1:4173/?foo=bar"),
    "http://127.0.0.1:4173/?foo=bar&automation=1&experiment=0019"
  );
  assert.throws(
    () => parseExp0019BrowserArgs(["--repetitions", "3"]),
    /exatamente duas|terceira/iu
  );
  assert.throws(
    () => exp0019BrowserTargetUrl("http://example.com:4173/"),
    /somente localhost/iu
  );
});

test("duas campanhas fake preservam causalidade, paridade e zero efeitos", async () => {
  const data = await fixture();
  const { checkpoint, replay } = data;
  assert.deepEqual(validateExp0019BrowserReplayInput(replay), {
    valid: true,
    errors: []
  });
  const chrome = createFakeCdp(checkpoint);
  const fetchCalls = [];
  const instants = [
    "2026-08-03T12:00:00.000Z",
    "2026-08-03T12:00:01.000Z"
  ];
  const report = await runExp0019BrowserCampaign({
    ...frozenOptions(data),
    replay,
    cdpUrl: "http://fake-cdp:9223",
    connectChrome: async () => chrome,
    fetchImpl: healthFetch([
      HEALTH_FINGERPRINT,
      HEALTH_FINGERPRINT
    ], fetchCalls),
    nowIso: () => instants.shift(),
    validateNodeReplay: () => ({ valid: true, errors: [] })
  });

  assert.equal(report.pass, true);
  assert.equal(report.experimentDecisionEligible, false);
  assert.equal(report.authorityEligible, false);
  assert.equal(report.repetitions.length, 2);
  assert.equal(
    chrome.commands.filter((item) => item.method === "Page.navigate").length,
    2
  );
  const navigationIndexes = chrome.timeline.flatMap((entry, index) =>
    entry === "navigate" ? [index] : []
  );
  for (const [campaignIndex, navigationIndex] of
    navigationIndexes.entries()) {
    const nextNavigation = navigationIndexes[campaignIndex + 1] ??
      chrome.timeline.length;
    const segment = chrome.timeline.slice(navigationIndex, nextNavigation);
    const controlIndex = segment.indexOf("control-before-shadow");
    const shadowIndex = segment.indexOf("after-shadow");
    const evaluationIndexes = segment.flatMap((entry, index) =>
      entry === "shadow-evaluation" ? [index] : []
    );
    assert.equal(evaluationIndexes.length, 32);
    assert.ok(controlIndex > 0 && controlIndex < evaluationIndexes[0]);
    assert.ok(shadowIndex > evaluationIndexes.at(-1));
  }
  assert.equal(fetchCalls.length, 2);
  assert.ok(fetchCalls.every((url) => url.endsWith("/api/health")));
  assert.equal(report.metrics.causalProbeEvaluations, 48);
  assert.equal(report.metrics.readyEvaluations, 16);
  assert.equal(report.metrics.armPredictions, 32);
  assert.equal(report.metrics.effectsDispatched, 0);
  assert.equal(report.metrics.maximumFeatureRelativeError, 0);
  assert.equal(report.metrics.maximumProbabilityRelativeError, 0);
  assert.deepEqual(
    new Set(report.normalizedTraceSha256).size,
    1
  );
  assert.equal(
    Object.values(report.gates).every(Boolean),
    true
  );
  assert.match(report.browserReportSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(
    validateExp0019BrowserReport(report, {
      replay,
      checkpoint,
      instrumentationFreeze: data.freeze,
      validateNodeReplay: () => ({ valid: true, errors: [] })
    }),
    { valid: true, errors: [] }
  );

  assert.equal(chrome.closed, true);
});

test("tamper de gate continua inválido após recalcular o hash", async () => {
  const data = await fixture();
  const report = await runExp0019BrowserCampaign({
    ...frozenOptions(data),
    replay: data.replay,
    cdpUrl: "http://fake-cdp:9223",
    connectChrome: async () => createFakeCdp(data.checkpoint),
    fetchImpl: healthFetch([
      HEALTH_FINGERPRINT,
      HEALTH_FINGERPRINT
    ], []),
    validateNodeReplay: () => ({ valid: true, errors: [] })
  });
  const tampered = structuredClone(report);
  tampered.gates.zeroEffects = false;
  tampered.pass = false;
  tampered.decision = "CUT_CAUSAL_AUDIO_BRIDGE";
  delete tampered.browserReportSha256;
  tampered.browserReportSha256 = `sha256:${canonicalSha256(tampered)}`;

  const validation = validateExp0019BrowserReport(tampered, {
    replay: data.replay,
    checkpoint: data.checkpoint,
    instrumentationFreeze: data.freeze,
    validateNodeReplay: () => ({ valid: true, errors: [] })
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /gates editáveis/iu);
});

test("STOP físico indisponível falha fechado e corta a ponte", async () => {
  const data = await fixture();
  const chrome = createFakeCdp(data.checkpoint, {
    physicalUnavailable: true
  });
  const report = await runExp0019BrowserCampaign({
    ...frozenOptions(data),
    replay: data.replay,
    cdpUrl: "http://fake-cdp:9223",
    connectChrome: async () => chrome,
    fetchImpl: healthFetch([
      HEALTH_FINGERPRINT,
      HEALTH_FINGERPRINT
    ], []),
    nowIso: () => "2026-08-03T12:00:00.000Z",
    validateNodeReplay: () => ({ valid: true, errors: [] })
  });

  assert.equal(report.pass, false);
  assert.equal(report.gates.lifecycleShadowOnOffEquivalent, false);
  assert.equal(report.gates.rendererStopP95WithinBudget, false);
  assert.equal(report.decision, "CUT_CAUSAL_AUDIO_BRIDGE");
  assert.equal(
    chrome.commands.filter((item) => item.method === "Page.navigate").length,
    2
  );
  assert.deepEqual(
    validateExp0019BrowserReport(report, {
      replay: data.replay,
      checkpoint: data.checkpoint,
      instrumentationFreeze: data.freeze,
      validateNodeReplay: () => ({ valid: true, errors: [] })
    }),
    { valid: true, errors: [] }
  );
});

test("normalização remove só clocks; drift semântico continua visível", () => {
  const left = {
    timing: {
      proposalAtPerformanceMs: 10,
      proposalLatencyMs: 2,
      calculationMs: 1
    },
    renderClock: {
      baseLatencyMs: 8,
      outputLatencyMs: 12
    },
    currentSample: 48_000,
    predicted: "DIRECTED_TO_ASSISTANT"
  };
  const clocksOnly = structuredClone(left);
  clocksOnly.timing.proposalAtPerformanceMs = 100;
  clocksOnly.timing.proposalLatencyMs = 20;
  clocksOnly.timing.calculationMs = 10;
  clocksOnly.renderClock.baseLatencyMs = 80;
  clocksOnly.renderClock.outputLatencyMs = 120;
  assert.deepEqual(
    normalizeExp0019BrowserTrace(left),
    normalizeExp0019BrowserTrace(clocksOnly)
  );
  const semanticDrift = structuredClone(clocksOnly);
  semanticDrift.predicted = "BACKGROUND_OR_NOT_DIRECTED";
  assert.notDeepEqual(
    normalizeExp0019BrowserTrace(left),
    normalizeExp0019BrowserTrace(semanticDrift)
  );
});

test("texto futuro invalida replay antes de qualquer conexão Chrome", async () => {
  const data = await fixture();
  const { replay } = data;
  const poisoned = structuredClone(replay);
  const scene = poisoned.scenes[0];
  scene.probes[2].payload.targetText = scene.ready.payload.targetText;
  delete poisoned.replaySha256;
  poisoned.replaySha256 = `sha256:${canonicalSha256(poisoned)}`;
  const validation = validateExp0019BrowserReplayInput(poisoned);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /probe|causal/iu);

  let connects = 0;
  await assert.rejects(
    runExp0019BrowserCampaign({
      ...frozenOptions(data),
      replay: poisoned,
      repetitions: 2,
      cdpUrl: "http://fake-cdp:9223",
      connectChrome: async () => {
        connects += 1;
        throw new Error("não deveria conectar");
      }
    }),
    /probe|causal/iu
  );
  assert.equal(connects, 0);
});

test("todos os hashes críticos são verificados antes do CDP", async () => {
  const data = await fixture();
  const reads = [];
  let connects = 0;
  await assert.rejects(
    runExp0019BrowserCampaign({
      ...frozenOptions(data),
      replay: data.replay,
      cdpUrl: "http://fake-cdp:9223",
      readCriticalSource: async (absolutePath) => {
        const path = EXP0019_CRITICAL_SOURCE_PATHS.find((candidate) =>
          String(absolutePath).endsWith(`/${candidate}`)
        );
        assert.ok(path);
        reads.push(path);
        return path === "scripts/smoke-exp-0019-browser.mjs"
          ? Buffer.from("runner adulterado\n")
          : data.criticalSourceBytes.get(path);
      },
      connectChrome: async () => {
        connects += 1;
        throw new Error("não deveria conectar");
      }
    }),
    /smoke-exp-0019-browser\.mjs: bytes pós-lacre/iu
  );
  assert.deepEqual(reads, [...EXP0019_CRITICAL_SOURCE_PATHS]);
  assert.equal(connects, 0);
});

test("fingerprint divergente ou drift semântico não passa determinismo", async () => {
  const data = await fixture();
  const { checkpoint, replay } = data;
  const chrome = createFakeCdp(checkpoint, {
    semanticDriftOnSecond: true
  });
  const report = await runExp0019BrowserCampaign({
    ...frozenOptions(data),
    replay,
    cdpUrl: "http://fake-cdp:9223",
    connectChrome: async () => chrome,
    fetchImpl: healthFetch([
      HEALTH_FINGERPRINT,
      `sha256:${"e".repeat(64)}`
    ], []),
    validateNodeReplay: () => ({ valid: true, errors: [] })
  });
  assert.equal(report.pass, false);
  assert.equal(report.gates.sameRuntimeFingerprint, false);
  assert.equal(report.gates.nodeBrowserParity, false);
  assert.equal(report.gates.frozenSignature, false);
  assert.equal(report.gates.deterministicNormalizedTrace, false);
  assert.equal(report.decision, "CUT_CAUSAL_AUDIO_BRIDGE");
  assert.equal(report.authorityEligible, false);
});

test("API de campanha recusa repetitions=3 antes de I/O", async () => {
  let connected = false;
  await assert.rejects(
    runExp0019BrowserCampaign({
      repetitions: 3,
      connectChrome: async () => {
        connected = true;
      }
    }),
    /exatamente duas|terceira/iu
  );
  assert.equal(connected, false);
});
