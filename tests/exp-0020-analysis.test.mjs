import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0020_CONFIG,
  EXP0020_ORDER_CLASSES,
  analyzeExp0020Campaign,
  classifyExp0020Order,
  createExp0020Report,
  validateExp0020Report
} from "../src/eval/exp-0020-stop-order.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { TrainingTraceRecorder } from
  "../web/training-trace-recorder.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;

function trainingTrace(turnId, renderMarkerAtMs, latencyMs) {
  const recorder = new TrainingTraceRecorder({
    sessionId: `session-${turnId}`,
    startedAtEpochMs: 1,
    locale: "pt-BR",
    candidate: "exp-0020-fixture",
    configHash: HASH_D
  });
  const decision = recorder.recordDecision({
    atMs: 323,
    turnId,
    epoch: 1,
    event: {
      type: "output-interruption.pause_requested",
      source: "local-audio-reflex",
      payload: {}
    },
    context: { state: { assistantSpeaking: true } },
    policy: {
      id: "output-interruption-lifecycle",
      version: "output-interruption-lifecycle-v0.1",
      mode: "authority"
    },
    transition: {
      previousStateVersion: 0,
      stateVersion: 1,
      previousPhase: "idle",
      phase: "held",
      reason: "output-held"
    },
    intents: [{ type: "PAUSE_OUTPUT", origin: "output-interruption-lifecycle" }]
  });
  const effectId = decision.effects[0].effectId;
  recorder.recordEffectStage(effectId, {
    stage: "dispatched",
    atMs: 323.1,
    evidence: { command: "HTMLMediaElement.pause" }
  });
  recorder.recordEffectStage(effectId, {
    stage: "player-received",
    atMs: 323.2,
    evidence: { audioPresent: true, paused: true }
  });
  recorder.recordEffectStage(effectId, {
    stage: "renderer-silent",
    atMs: renderMarkerAtMs - 0.2,
    evidence: {
      kind: "browser-render-stop",
      latencyMs,
      mapping: "audio-context-output-timestamp"
    }
  });
  recorder.recordEffectStage(effectId, {
    stage: "completed",
    atMs: renderMarkerAtMs - 0.1,
    evidence: { observation: "browser-render-stop" }
  });
  return recorder.snapshot;
}

function transitionDetail(turnId) {
  return JSON.stringify({
    lifecycleVersion: "output-interruption-lifecycle-v0.1",
    previousStateVersion: 0,
    stateVersion: 1,
    eventType: "PAUSE_REQUESTED",
    event: { type: "PAUSE_REQUESTED", turnId },
    previousPhase: "idle",
    phase: "held",
    reason: "output-held",
    turnId,
    outputEpoch: 2,
    pauseKind: "audible",
    resumeAttempt: 0,
    intents: [{ type: "PAUSE_OUTPUT", origin: "output-interruption-lifecycle" }]
  });
}

function trial(options = {}) {
  const navigationIndex = options.navigationIndex ?? 1;
  const trialIndex = options.trialIndex ?? 1;
  const turnId = `exp0020-${navigationIndex}-${trialIndex}`;
  const order = options.order ?? EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER;
  const latencyMs = options.latencyMs ?? 50;
  const renderObservedAtMs = 323 + latencyMs + 5;
  const renderMarkerAtMs = renderObservedAtMs + 1;
  const pauseMarkerAtMs =
    order === EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
      ? 330
      : renderMarkerAtMs + 2;
  const markers = order === EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
    ? [
        {
          atMs: pauseMarkerAtMs,
          type: "assistant.speech.paused",
          detail: "fixture"
        },
        {
          atMs: renderMarkerAtMs,
          type: "assistant.render.stopped",
          detail: "fixture"
        }
      ]
    : [
        {
          atMs: renderMarkerAtMs,
          type: "assistant.render.stopped",
          detail: "fixture"
        },
        {
          atMs: pauseMarkerAtMs,
          type: "assistant.speech.paused",
          detail: "fixture"
        }
      ];
  const latestMarkerAtMs = Math.max(renderMarkerAtMs, pauseMarkerAtMs);
  const finalObservedAtMs = latestMarkerAtMs + 250;
  const trace = [
    { atMs: 1, type: "assistant.render.active", detail: "fixture" },
    {
      atMs: 323,
      type: "output-interruption.transition",
      detail: transitionDetail(turnId)
    },
    ...markers
  ];
  if (options.reactivate === true) {
    trace.push({
      atMs: latestMarkerAtMs + 100,
      type: "assistant.render.active",
      detail: "bad"
    });
  }
  if (options.duplicatePause === true) {
    trace.push({
      atMs: latestMarkerAtMs + 1,
      type: "assistant.speech.paused",
      detail: "bad"
    });
  }
  const lastRenderStop = {
    kind: "browser-render-stop",
    triggerAtMs: 323,
    lastRenderedAtMs: 323 + latencyMs,
    observedAtMs: renderObservedAtMs,
    latencyMs,
    renderedThroughTrigger: true,
    mapping: "audio-context-output-timestamp",
    baseLatencyMs: 10,
    outputLatencyMs: 42,
    lastActiveEndContextTime: 0.1,
    observedContextTime: 0.106,
    requiredSilenceQuanta: 2,
    threshold: 0.0003,
    scope: "último quantum não silencioso no grafo Web Audio"
  };
  return {
    navigationIndex,
    trialIndex,
    turnId,
    tts: {
      wavSha256: options.wavSha256 ?? HASH_A,
      byteLength: 4_096,
      rate: EXP0020_CONFIG.ttsRate,
      requestText: EXP0020_CONFIG.phrase,
      requestUrl: "http://localhost:4173/api/tts",
      method: "POST",
      status: 200,
      mimeType: "audio/wav"
    },
    timing: {
      renderActiveAtMs: 1,
      plannedTriggerAtMs: 321,
      actualTriggerAtMs: 323,
      timerErrorMs: 2,
      latestStopMarkerAtMs: latestMarkerAtMs,
      postStopObservedAtMs: finalObservedAtMs,
      postLatestMarkerHorizonMs: 250
    },
    startSnapshot: {
      state: { assistantSpeaking: true },
      trace: [{ atMs: 1, type: "assistant.render.active", detail: "fixture" }]
    },
    renderStopAtMarkers: structuredClone(lastRenderStop),
    finalSnapshot: {
      observedAtMs: finalObservedAtMs,
      state: {
        assistantSpeaking: false,
        potentialBargeIn: "pending"
      },
      audio: {
        outputInterruptionLifecycle: {
          schemaVersion: 1,
          lifecycleVersion: "output-interruption-lifecycle-v0.1",
          version: 1,
          phase: "held",
          turnId,
          outputEpoch: 2,
          pauseKind: "audible",
          resumeAttempt: 0
        },
        renderProbe: {
          state: "ready",
          sampleRate: 48_000,
          pendingMeasurements: 0,
          threshold: 0.0003,
          requiredSilenceQuanta: 2,
          scope: "último quantum não silencioso no grafo Web Audio"
        },
        lastRenderStop
      },
      trainingTrace: trainingTrace(turnId, renderMarkerAtMs, latencyMs),
      trace
    }
  };
}

function health() {
  return {
    process: { runId: "run-1", runtimeFingerprint: { sha256: HASH_B } },
    brain: "local",
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    asr: { state: "disabled" },
    vadControl: { state: "ready", engine: "adaptive-energy-vad" },
    vadShadow: { state: "disabled", mode: "disabled" },
    tts: {
      state: "ready",
      engine: "windows-system-speech",
      voice: "Maria",
      culture: "pt-BR"
    }
  };
}

function campaign(options = {}) {
  const orderFor = options.orderFor ?? ((_, flatIndex) =>
    flatIndex % 2 === 0
      ? EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
      : EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE
  );
  const latencyFor = options.latencyFor ?? ((_, flatIndex) => 50 + flatIndex % 4);
  let flatIndex = 0;
  const navigations = Array.from(
    { length: EXP0020_CONFIG.navigations },
    (_, navIndex) => ({
      index: navIndex + 1,
      targetUrl: EXP0020_CONFIG.targetUrl,
      runtimeFingerprintSha256: HASH_B,
      browser: { product: "Chrome/150.0.0.0" },
      networkRequests: [
        EXP0020_CONFIG.targetUrl,
        "http://localhost:4173/app.mjs",
        "http://localhost:4173/api/tts"
      ],
      trials: Array.from(
        { length: EXP0020_CONFIG.stopsPerNavigation },
        (_, trialIndex) => {
          const current = flatIndex++;
          return trial({
            navigationIndex: navIndex + 1,
            trialIndex: trialIndex + 1,
            order: orderFor({ navIndex, trialIndex }, current),
            latencyMs: latencyFor({ navIndex, trialIndex }, current),
            wavSha256: options.wavFor?.(current) ?? HASH_A,
            reactivate: options.reactivateAt === current,
            duplicatePause: options.duplicatePauseAt === current
          });
        }
      )
    })
  );
  return {
    boundary: {
      attemptCanonicalSha256: HASH_A,
      attemptFileSha256: HASH_B,
      attemptPath: "eval/commitments/exp-0020-browser-attempt-v0.1.json",
      attemptVerified: true,
      freezeCanonicalSha256: HASH_C,
      freezeFileSha256: HASH_D,
      freezePath:
        "eval/commitments/exp-0020-instrumentation-freeze-v0.1.json",
      freezeVerified: true,
      receiptFileSha256: HASH_A,
      receiptPath:
        "eval/generated/exp-0020/browser-attempt-consumed-v0.1.json",
      rerunAllowed: false
    },
    health: { before: health(), after: health() },
    cost: { gpuRuns: 0 },
    authority: { canProduceNewEffects: false },
    diagnostics: { consoleErrors: [], runtimeErrors: [], httpErrors: [] },
    navigations
  };
}

test("classifica as duas ordens sem usar timestamps empatáveis", () => {
  assert.equal(
    classifyExp0020Order(trial().finalSnapshot.trace),
    EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
  );
  assert.equal(
    classifyExp0020Order(trial({
      order: EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE
    }).finalSnapshot.trace),
    EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE
  );
  assert.equal(
    classifyExp0020Order(trial({ duplicatePause: true }).finalSnapshot.trace),
    null
  );
});

test("campanha completa passa somente com equivalência categórica e temporal", () => {
  const analysis = analyzeExp0020Campaign(campaign());
  assert.equal(analysis.decision, "PASS_TELEMETRY_ORDER_EQUIVALENT");
  assert.equal(analysis.pass, true);
  assert.equal(analysis.metrics.classes.PAUSE_THEN_RENDER.count, 6);
  assert.equal(analysis.metrics.classes.RENDER_THEN_PAUSE.count, 6);
  assert.ok(analysis.metrics.classMedianDeltaMs <= 16.7);
  assert.ok(analysis.metrics.classP95DeltaMs <= 16.7);
  assert.ok(Object.values(analysis.gates).every((value) => value === true));
});

test("uma classe com menos de duas tentativas produz hold sem rerun", () => {
  const analysis = analyzeExp0020Campaign(campaign({
    orderFor: (_, index) => index === 0
      ? EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
      : EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE
  }));
  assert.equal(analysis.gates.orderDiversity, false);
  assert.equal(analysis.gates.classTemporalEquivalence, null);
  assert.equal(analysis.decision, "HOLD_ORDER_DIVERSITY");
});

test("latências 5 ms versus 240 ms não passam como telemetria equivalente", () => {
  const analysis = analyzeExp0020Campaign(campaign({
    orderFor: (_, index) => index < 6
      ? EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
      : EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE,
    latencyFor: (_, index) => index < 6 ? 5 : 240
  }));
  assert.equal(analysis.gates.classTemporalEquivalence, false);
  assert.equal(analysis.decision, "FIX_PHYSICAL_STOP_PATH");
});

test("reativação depois do marcador impede falso STOP físico", () => {
  const analysis = analyzeExp0020Campaign(campaign({ reactivateAt: 4 }));
  assert.equal(analysis.gates.terminalStopStable, false);
  assert.equal(analysis.decision, "FIX_PHYSICAL_STOP_PATH");
});

test("atividade entre render e pause não é confundida com reativação terminal", () => {
  const input = campaign();
  const candidate = input.navigations[0].trials[1];
  const renderAt = candidate.finalSnapshot.trace.find(
    (event) => event.type === "assistant.render.stopped"
  ).atMs;
  const pauseAt = candidate.finalSnapshot.trace.find(
    (event) => event.type === "assistant.speech.paused"
  ).atMs;
  candidate.finalSnapshot.trace.splice(3, 0, {
    atMs: (renderAt + pauseAt) / 2,
    type: "assistant.render.active",
    detail: "antes do marcador STOP mais tardio"
  });
  const analysis = analyzeExp0020Campaign(input);
  assert.equal(analysis.gates.terminalStopStable, true);
  assert.equal(analysis.decision, "PASS_TELEMETRY_ORDER_EQUIVALENT");
});

test("mudança do render stop após os marcadores exige correção física", () => {
  const input = campaign();
  input.navigations[0].trials[0].renderStopAtMarkers.latencyMs = 49;
  const analysis = analyzeExp0020Campaign(input);
  assert.equal(analysis.gates.terminalStopStable, false);
  assert.equal(analysis.decision, "FIX_PHYSICAL_STOP_PATH");
});

test("efeito e lifecycle precisam pertencer ao turnId do STOP", () => {
  const input = campaign();
  input.navigations[0].trials[0].finalSnapshot.audio
    .outputInterruptionLifecycle.turnId = "outro-turno";
  const analysis = analyzeExp0020Campaign(input);
  assert.equal(analysis.gates.trialIdentity, false);
  assert.equal(analysis.decision, "INVALIDATE_STOP_ORDER_INSTRUMENT");
});

test("evidência de render anterior ao trigger não passa como STOP atual", () => {
  const input = campaign();
  const candidate = input.navigations[0].trials[0];
  candidate.renderStopAtMarkers.triggerAtMs = 300;
  candidate.finalSnapshot.audio.lastRenderStop.triggerAtMs = 300;
  const analysis = analyzeExp0020Campaign(input);
  assert.equal(analysis.gates.terminalStopStable, false);
  assert.equal(analysis.decision, "FIX_PHYSICAL_STOP_PATH");
});

test("janela de coleta curta invalida o instrumento antes da física", () => {
  const input = campaign();
  const candidate = input.navigations[0].trials[0];
  candidate.timing.postStopObservedAtMs =
    candidate.timing.latestStopMarkerAtMs + 249;
  candidate.timing.postLatestMarkerHorizonMs = 249;
  candidate.finalSnapshot.observedAtMs =
    candidate.timing.postStopObservedAtMs;
  const analysis = analyzeExp0020Campaign(input);
  assert.equal(analysis.gates.collectionWindowValid, false);
  assert.equal(analysis.decision, "INVALIDATE_STOP_ORDER_INSTRUMENT");
});

test("trigger não pode deslocar silenciosamente o plano de 320 ms", () => {
  const input = campaign();
  const candidate = input.navigations[0].trials[0];
  candidate.timing.plannedTriggerAtMs = 331;
  candidate.timing.actualTriggerAtMs = 331;
  candidate.timing.timerErrorMs = 0;
  const analysis = analyzeExp0020Campaign(input);
  assert.equal(analysis.gates.controlledStimulus, false);
  assert.equal(analysis.decision, "INVALIDATE_STOP_ORDER_INSTRUMENT");
});

test("WAV variável e marcador duplicado invalidam antes de corrigir runtime", () => {
  const analysis = analyzeExp0020Campaign(campaign({
    wavFor: (index) => index === 11 ? HASH_C : HASH_A,
    duplicatePauseAt: 0,
    reactivateAt: 1
  }));
  assert.equal(analysis.gates.controlledStimulus, false);
  assert.equal(analysis.gates.markersCollected, false);
  assert.equal(analysis.decision, "INVALIDATE_STOP_ORDER_INSTRUMENT");
});

test("fingerprint das navegações precisa ser o fingerprint real da saúde", () => {
  const input = campaign();
  input.navigations[1].runtimeFingerprintSha256 = HASH_C;
  const analysis = analyzeExp0020Campaign(input);
  assert.equal(analysis.gates.sameRuntimeAndBrowser, false);
  assert.equal(analysis.decision, "INVALIDATE_STOP_ORDER_INSTRUMENT");
});

test("relatório canônico recalcula análise e rejeita interpretação rehasheada", () => {
  const report = createExp0020Report({
    startedAt: "2026-08-03T06:00:00.000Z",
    completedAt: "2026-08-03T06:01:00.000Z",
    campaign: campaign()
  });
  assert.equal(validateExp0020Report(report).valid, true);
  const tampered = structuredClone(report);
  tampered.claim = "pronto para produção";
  const core = structuredClone(tampered);
  delete core.reportSha256;
  // Um hash autoconsistente não pode reescrever a interpretação registrada.
  tampered.reportSha256 = `sha256:${canonicalSha256(core)}`;
  assert.equal(validateExp0020Report(tampered).valid, false);
});
