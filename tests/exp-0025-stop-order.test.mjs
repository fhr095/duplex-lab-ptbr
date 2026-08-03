import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0025_BOUNDARY_SUMMARY_KEYS,
  EXP0025_CONFIG,
  EXP0025_DECISIONS,
  EXP0025_EXECUTION_STATES,
  EXP0025_PATHS,
  analyzeExp0025Campaign,
  createExp0025Report,
  validateExp0025Report
} from "../src/eval/exp-0025-stop-order.mjs";
import {
  EXP0025_JOURNAL_FRAME_TYPES as T,
  createExp0025JournalFrame,
  inspectExp0025Journal,
  serializeExp0025Journal
} from "../src/eval/exp-0025-journal.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { EXP0020_ORDER_CLASSES } from
  "../src/eval/exp-0020-stop-order.mjs";
import {
  EXP0025_BROWSER_TRIAL_RESULT_SCHEMA,
  EXP0025_BROWSER_TRIAL_STATUSES
} from "../scripts/lib/exp-0025-browser-trial.mjs";
import { TrainingTraceRecorder } from
  "../web/training-trace-recorder.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const RUNTIME_HEX = "d".repeat(64);
const COMMIT = "e".repeat(40);
const STARTED_AT = "2026-08-03T12:00:00.000Z";
const WORKER_AT = "2026-08-03T12:00:01.000Z";
const COMPLETED_AT = "2026-08-03T12:01:00.000Z";

function idFor(navigationIndex, trialIndex) {
  return `exp0020-nav-${navigationIndex}-trial-${trialIndex}`;
}

function trainingTrace(turnId, renderMarkerAtMs, latencyMs) {
  const recorder = new TrainingTraceRecorder({
    sessionId: `session-${turnId}`,
    startedAtEpochMs: 1,
    locale: "pt-BR",
    candidate: "exp-0025-fixture",
    configHash: HASH_C
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

function physicalTrial(options = {}) {
  const navigationIndex = options.navigationIndex ?? 1;
  const trialIndex = options.trialIndex ?? 1;
  const turnId = idFor(navigationIndex, trialIndex);
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
  const renderActiveMarkers = [
    { atMs: 1, type: "assistant.render.active", detail: "anchor" },
    ...(options.activeCount === 1 ||
      (options.activeCount === undefined && trialIndex !== 1)
      ? []
      : [{ atMs: 5, type: "assistant.render.active", detail: "segment" }])
  ];
  const trace = [
    ...renderActiveMarkers,
    {
      atMs: 323,
      type: "output-interruption.transition",
      detail: transitionDetail(turnId)
    },
    ...markers
  ];
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
    schemaVersion: EXP0025_BROWSER_TRIAL_RESULT_SCHEMA,
    status: EXP0025_BROWSER_TRIAL_STATUSES.collected,
    phase: "complete",
    code: null,
    message: null,
    navigationIndex,
    trialIndex,
    turnId,
    resetAtPerformanceMs: 0,
    resetSnapshot: { observedAtMs: 0, trace: [] },
    activeSnapshot: {
      observedAtMs: 5,
      state: { assistantSpeaking: true },
      trace: structuredClone(renderActiveMarkers)
    },
    startSnapshot: {
      observedAtMs: 5,
      state: { assistantSpeaking: true },
      trace: structuredClone(renderActiveMarkers)
    },
    anchorTraceIndex: 0,
    activeMarker: structuredClone(renderActiveMarkers[0]),
    preTriggerSnapshot: {
      observedAtMs: 321,
      state: { assistantSpeaking: true },
      trace: structuredClone(renderActiveMarkers)
    },
    preTriggerActiveMarkers: structuredClone(renderActiveMarkers),
    plannedTriggerAtPerformanceMs: 321,
    triggerAtPerformanceMs: 323,
    timerErrorMs: 2,
    markerEvents: {
      paused: markers.filter((event) =>
        event.type === "assistant.speech.paused"),
      renderStopped: markers.filter((event) =>
        event.type === "assistant.render.stopped")
    },
    latestMarkerAtPerformanceMs: latestMarkerAtMs,
    latestStopMarkerTraceIndex: trace.length - 1,
    markerSnapshotObservedAtMs: latestMarkerAtMs,
    finalSnapshotAtPerformanceMs: finalObservedAtMs,
    postLatestMarkerHorizonMs: 250,
    renderStopAtMarkers: structuredClone(lastRenderStop),
    newRenderActiveMarkers: [],
    renderStopUnchanged: true,
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
    process: {
      runId: "run-exp0025",
      runtimeFingerprint: { sha256: RUNTIME_HEX, fileCount: 42 }
    },
    brain: "local",
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    asr: { state: "disabled" },
    vadControl: { state: "ready", engine: "adaptive-energy-vad" },
    vadShadow: { state: "disabled" },
    tts: {
      state: "ready",
      engine: "windows-system-speech",
      voice: "Maria",
      culture: "pt-BR"
    }
  };
}

function buildFrames(options = {}) {
  const frames = [];
  let cdpOrdinal = 0;
  const requestPayloads = [];
  const push = (type, payload) => {
    frames.push(createExp0025JournalFrame({
      ordinal: frames.length + 1,
      type,
      payload
    }));
  };
  const pushNetwork = ({
    navigationIndex,
    requestId,
    url,
    method,
    postData,
    trialId,
    frameId,
    loaderId,
    mimeType,
    status = 200,
    encodedDataLength,
    auditProbeHeader = null,
    responseAfterTerminal = false
  }) => {
    const requestOrdinal = ++cdpOrdinal;
    const requestTimestamp = 100 + requestOrdinal;
    const request = {
      auditProbeHeader,
      frameId,
      loaderId,
      method,
      navigationIndex,
      postData,
      redirected: false,
      requestId,
      requestOrdinal,
      resourceType: "Fetch",
      timestamp: requestTimestamp,
      trialId,
      url
    };
    requestPayloads.push(structuredClone(request));
    push(T.networkRequest, request);
    const responseOrdinal = ++cdpOrdinal;
    push(T.networkResponse, {
      frameId,
      fromDiskCache: false,
      fromServiceWorker: false,
      loaderId,
      mimeType,
      navigationIndex,
      requestId,
      responseOrdinal,
      status,
      timestamp: requestTimestamp + (responseAfterTerminal ? 0.3 : 0.1),
      trialId,
      url
    });
    const terminalOrdinal = ++cdpOrdinal;
    push(T.networkTerminal, {
      encodedDataLength,
      navigationIndex,
      requestId,
      terminalOrdinal,
      timestamp: requestTimestamp + (responseAfterTerminal ? 0.2 : 0.2),
      trialId
    });
    return { requestOrdinal, responseOrdinal, terminalOrdinal };
  };

  push(T.inProgress, {
    deadlineMs: 600_000,
    opening: {
      canonicalSha256: HASH_A,
      commit: COMMIT,
      fileSha256: HASH_B,
      path: EXP0025_PATHS.opening
    },
    pid: 101,
    startedAt: STARTED_AT
  });
  push(T.workerStarted, {
    command: "node scripts/run-exp-0025-worker.mjs",
    pid: 102,
    startedAt: WORKER_AT
  });
  const healthBefore = health();
  const healthAfter = health();
  push(T.healthBefore, { health: healthBefore, observedAt: WORKER_AT });
  push(T.browserBound, {
    browser: {
      product: EXP0025_CONFIG.chrome.product,
      protocolVersion: EXP0025_CONFIG.chrome.protocolVersion,
      revision: "fixture",
      userAgent: "fixture",
      jsVersion: "fixture"
    },
    observedAt: WORKER_AT
  });

  let flatIndex = 0;
  for (let navigationIndex = 1;
    navigationIndex <= EXP0025_CONFIG.navigations;
    navigationIndex += 1) {
    const frameId = `frame-${navigationIndex}`;
    const loaderId = `loader-${navigationIndex}`;
    push(T.navigationStarted, {
      navigationIndex,
      startedAt: WORKER_AT,
      targetUrl: EXP0025_CONFIG.targetUrl
    });
    const bootstrapId = `health-bootstrap-${navigationIndex}`;
    pushNetwork({
      navigationIndex,
      requestId: bootstrapId,
      url: "http://localhost:4173/api/health",
      method: "GET",
      postData: null,
      trialId: null,
      frameId,
      loaderId,
      mimeType: "application/json",
      encodedDataLength: 512,
      responseAfterTerminal: navigationIndex === 1
    });
    const auditId = `health-audit-${navigationIndex}`;
    pushNetwork({
      navigationIndex,
      requestId: auditId,
      url:
        `http://localhost:4173/api/health?exp0022_probe=nav-${navigationIndex}`,
      method: "GET",
      postData: null,
      trialId: null,
      frameId,
      loaderId,
      mimeType: "application/json",
      encodedDataLength: 512,
      auditProbeHeader: "audit-health-v0.1"
    });
    push(T.navigationAudited, {
      auditRequestId: auditId,
      bootstrapRequestId: bootstrapId,
      frameId,
      health: structuredClone(healthBefore),
      loaderId,
      navigationIndex,
      observedAt: WORKER_AT,
      probeId: `nav-${navigationIndex}`
    });

    for (let trialIndex = 1;
      trialIndex <= EXP0025_CONFIG.stopsPerNavigation;
      trialIndex += 1) {
      const current = flatIndex++;
      const trialId = idFor(navigationIndex, trialIndex);
      const requestId = `tts-request-${navigationIndex}-${trialIndex}`;
      pushNetwork({
        navigationIndex,
        requestId,
        url: "http://localhost:4173/api/tts",
        method: "POST",
        postData: { text: EXP0025_CONFIG.phrase },
        trialId,
        frameId,
        loaderId,
        mimeType: "audio/wav",
        encodedDataLength: EXP0025_CONFIG.expectedWavByteLength
      });
      const trial = physicalTrial({
        navigationIndex,
        trialIndex,
        order: options.orderFor?.(current) ??
          (current % 2 === 0
            ? EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
            : EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE),
        latencyMs: options.latencyFor?.(current) ?? 50 + current % 4
      });
      push(T.physicalTrialResult, {
        completedAt: "2026-08-03T12:00:30.000Z",
        navigationIndex,
        requestId,
        trial,
        trialId,
        trialIndex,
        turnId: trialId
      });
      const readCount = options.readCountFor?.(current) ?? 2;
      const accumulatedWaitMs = EXP0025_CONFIG.responseBodyRetryDelaysMs
        .slice(0, readCount).reduce((sum, delay) => sum + delay, 0);
      push(T.captureCompleted, {
        accumulatedWaitMs,
        byteLength: EXP0025_CONFIG.expectedWavByteLength,
        code: null,
        completedAt: "2026-08-03T12:00:31.000Z",
        navigationIndex,
        readCount,
        requestId,
        sha256: EXP0025_CONFIG.expectedWavSha256,
        status: "qualified",
        trialId,
        trialIndex,
        turnId: trialId
      });
    }
    push(T.navigationCompleted, {
      completedAt: "2026-08-03T12:00:40.000Z",
      navigationIndex
    });
  }
  push(T.healthAfter, { health: healthAfter, observedAt: COMPLETED_AT });
  push(T.budgetInputs, {
    inputs: {
      healthBefore: structuredClone(healthBefore),
      healthAfter: structuredClone(healthAfter),
      navigationAudits: [{ clean: true }, { clean: true }],
      navigationSnapshots: [{ clean: true }, { clean: true }],
      networkRequests: requestPayloads,
      declared: {
        gpuRuns: 0,
        challengerRuns: 0,
        backboneRuns: 0,
        canProduceNewAuthority: false
      }
    },
    observedAt: COMPLETED_AT
  });
  push(T.workerOutcome, {
    code: null,
    completedAt: COMPLETED_AT,
    exitCode: 0,
    outcome: {
      kind: "campaign-completed",
      protocolError: null,
      recordCount: frames.length - 2,
      stderrByteLength: 0,
      stderrSha256:
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      stderrTruncated: false
    },
    signal: null,
    status: "completed"
  });
  if (options.minimal === true) {
    const peripheral = new Set([
      T.healthBefore,
      T.healthAfter,
      T.navigationAudited,
      T.networkRequest,
      T.networkResponse,
      T.networkTerminal,
      T.networkFailure,
      T.captureCompleted,
      T.diagnostic,
      T.budgetInputs
    ]);
    const retained = frames.filter((frame) => !peripheral.has(frame.type));
    const minimal = retained.map((frame, index) => {
      const payload = structuredClone(frame.payload);
      if (frame.type === T.physicalTrialResult) payload.requestId = null;
      if (frame.type === T.workerOutcome) {
        payload.outcome.recordCount = retained.length - 3;
      }
      return createExp0025JournalFrame({
        ordinal: index + 1,
        type: frame.type,
        payload
      });
    });
    frames.splice(0, frames.length, ...minimal);
  }
  return frames;
}

function campaign(options = {}) {
  const serialized = serializeExp0025Journal(buildFrames(options));
  const journal = inspectExp0025Journal(Buffer.from(serialized));
  const boundary = {
    executionState: EXP0025_EXECUTION_STATES.fresh,
    expectedRuntimeFingerprintSha256: RUNTIME_HEX,
    failureCode: null,
    freezePath: EXP0025_PATHS.freeze,
    freezeVerified: true,
    gitTopologyVerified: true,
    journalAppendOnly: true,
    journalByteLength: journal.byteLength,
    journalFsyncBeforeAck: true,
    journalPath: EXP0025_PATHS.journal,
    journalSha256: journal.sha256,
    journalVerified: true,
    openingPath: EXP0025_PATHS.opening,
    openingVerified: true,
    receiptConsumedAt: STARTED_AT,
    receiptPath: EXP0025_PATHS.receipt,
    receiptVerified: true,
    receiptWriteOnce: true,
    recoveryOnly: false,
    rerunAllowed: false,
    runtimeBindingsVerified: true,
    sourceBindingsVerified: true,
    workerStartedAt: WORKER_AT
  };
  assert.deepEqual(
    Object.keys(boundary).toSorted(),
    [...EXP0025_BOUNDARY_SUMMARY_KEYS].toSorted()
  );
  return { boundary, journal };
}

function rebuild(input, mutateFrames) {
  const candidate = structuredClone(input);
  const frames = candidate.journal.frames;
  mutateFrames(frames);
  for (const [index, frame] of frames.entries()) frame.ordinal = index + 1;
  const serialized = serializeExp0025Journal(frames);
  candidate.journal = inspectExp0025Journal(Buffer.from(serialized));
  candidate.boundary.journalSha256 = candidate.journal.sha256;
  candidate.boundary.journalByteLength = candidate.journal.byteLength;
  return candidate;
}

function framesForRequest(frames, requestId) {
  return frames.filter((frame) =>
    frame.payload?.requestId === requestId &&
    [
      T.networkRequest,
      T.networkResponse,
      T.networkTerminal,
      T.networkFailure
    ].includes(frame.type));
}

test("journal causal mínimo fecha STOP-R sem health, rede ou WAV", () => {
  const analysis = analyzeExp0025Campaign(campaign({ minimal: true }));
  assert.equal(analysis.decision, EXP0025_DECISIONS.pass);
  assert.equal(analysis.pass, true);
  assert.equal(analysis.physicalMeasurementStatus, "EVALUATED");
  assert.equal(analysis.browserCdpByteIdentityStatus, "NOT_EVALUATED");
  assert.equal(analysis.gates.browserCdpByteIdentity, null);
  assert.equal(analysis.metrics.classes.PAUSE_THEN_RENDER.count, 6);
  assert.equal(analysis.metrics.classes.RENDER_THEN_PAUSE.count, 6);
  assert.equal(analysis.instrumentValid, true);
  assert.deepEqual(analysis.provenanceDiagnostics, {
    health: "NOT_COLLECTED",
    networkLedger: "NOT_COLLECTED",
    wavCapture: "NOT_COLLECTED",
    runtimeBudget: "NOT_COLLECTED",
    workerOutcome: "PASS",
    diagnosticCount: 0
  });
  assert.equal(analysis.authorityEligible, false);
  assert.equal(analysis.sameExperimentRerunAllowed, false);
});

test("coleção parcial não passa por vacuidade e anula todos os gates físicos", () => {
  const input = rebuild(campaign(), (frames) => {
    const id = idFor(2, 6);
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      if (
        frames[index].payload?.trialId === id &&
        [T.physicalTrialResult, T.captureCompleted].includes(
          frames[index].type
        )
      ) frames.splice(index, 1);
    }
  });
  const analysis = analyzeExp0025Campaign(input);
  assert.equal(analysis.decision, EXP0025_DECISIONS.invalidate);
  assert.equal(analysis.physicalMeasurementStatus, "NOT_EVALUATED");
  for (const gate of [
    "singleLifecycleAndEffect",
    "pauseReceiptBeforeMarkers",
    "terminalStopStable",
    "terminalProjectionEquivalent",
    "orderDiversity",
    "classTemporalEquivalence"
  ]) assert.equal(analysis.gates[gate], null);
});

test("ligação periférica divergente é diagnóstico e não apaga STOP-R", () => {
  const permuted = rebuild(campaign(), (frames) => {
    const firstId = idFor(1, 1);
    const secondId = idFor(1, 2);
    for (const frame of frames) {
      if (![T.networkRequest, T.networkResponse, T.networkTerminal]
        .includes(frame.type)) continue;
      if (frame.payload.trialId === firstId) {
        frame.payload.trialId = secondId;
      } else if (frame.payload.trialId === secondId) {
        frame.payload.trialId = firstId;
      }
    }
  });
  const duplicated = rebuild(campaign(), (frames) => {
    const firstId = idFor(1, 1);
    const secondId = idFor(1, 2);
    for (const frame of frames) {
      if (
        [T.networkRequest, T.networkResponse, T.networkTerminal]
          .includes(frame.type) && frame.payload.trialId === secondId
      ) frame.payload.trialId = firstId;
    }
  });
  for (const candidate of [permuted, duplicated]) {
    const analysis = analyzeExp0025Campaign(candidate);
    assert.equal(analysis.gates.networkLedgerValid, false);
    assert.equal(analysis.provenanceDiagnostics.networkLedger, "FAIL");
    assert.equal(analysis.decision, EXP0025_DECISIONS.pass);
    assert.equal(analysis.physicalMeasurementStatus, "EVALUATED");
  }
});

test("ordinais governam: inversões response/terminal e entre requests passam", () => {
  const input = rebuild(campaign(), (frames) => {
    const first = framesForRequest(frames, "tts-request-1-1");
    const second = framesForRequest(frames, "tts-request-1-2");
    first.find((frame) => frame.type === T.networkRequest)
      .payload.timestamp = 20;
    first.find((frame) => frame.type === T.networkResponse)
      .payload.timestamp = 22;
    first.find((frame) => frame.type === T.networkTerminal)
      .payload.timestamp = 21;
    second.find((frame) => frame.type === T.networkRequest)
      .payload.timestamp = 1;
    second.find((frame) => frame.type === T.networkResponse)
      .payload.timestamp = 2;
    second.find((frame) => frame.type === T.networkTerminal)
      .payload.timestamp = 3;
  });
  const analysis = analyzeExp0025Campaign(input);
  assert.equal(analysis.gates.networkLedgerValid, true);
  assert.equal(analysis.decision, EXP0025_DECISIONS.pass);
  assert.ok(analysis.metrics.network.responseAfterTerminalCount >= 2);
});

test("inversão de ordinal CDP falha só a proveniência", () => {
  const input = rebuild(campaign(), (frames) => {
    const requestFrames = framesForRequest(frames, "tts-request-1-1");
    const request = requestFrames.find((frame) =>
      frame.type === T.networkRequest);
    const response = requestFrames.find((frame) =>
      frame.type === T.networkResponse);
    response.payload.responseOrdinal = request.payload.requestOrdinal - 1;
  });
  const analysis = analyzeExp0025Campaign(input);
  assert.equal(analysis.gates.networkLedgerValid, false);
  assert.equal(analysis.provenanceDiagnostics.networkLedger, "FAIL");
  assert.equal(analysis.decision, EXP0025_DECISIONS.pass);
  assert.equal(analysis.physicalMeasurementStatus, "EVALUATED");
});

test("captura divergente não participa do gate STOP-R", () => {
  for (const mutation of [
    { accumulatedWaitMs: 9 },
    { sha256: HASH_A },
    { byteLength: EXP0025_CONFIG.expectedWavByteLength - 1 }
  ]) {
    const input = rebuild(campaign(), (frames) => {
      const capture = frames.find((frame) =>
        frame.type === T.captureCompleted);
      Object.assign(capture.payload, mutation);
    });
    const analysis = analyzeExp0025Campaign(input);
    assert.equal(analysis.gates.captureQualified, false);
    assert.equal(analysis.provenanceDiagnostics.wavCapture, "FAIL");
    assert.equal(analysis.decision, EXP0025_DECISIONS.pass);
    assert.equal(analysis.gates.terminalStopStable, true);
  }
});

test("marcador duplicado é estrutural; reativação é resultado físico", () => {
  const malformed = rebuild(campaign(), (frames) => {
    const record = frames.find((frame) =>
      frame.type === T.physicalTrialResult);
    record.payload.trial.finalSnapshot.trace.push({
      atMs: record.payload.trial.latestMarkerAtPerformanceMs + 1,
      type: "assistant.speech.paused",
      detail: "duplicado"
    });
  });
  const invalid = analyzeExp0025Campaign(malformed);
  assert.equal(invalid.gates.traceStructural, false);
  assert.equal(invalid.decision, EXP0025_DECISIONS.invalidate);
  assert.equal(invalid.gates.terminalStopStable, null);

  const reactivated = rebuild(campaign(), (frames) => {
    const record = frames.find((frame) =>
      frame.type === T.physicalTrialResult);
    record.payload.trial.finalSnapshot.trace.push({
      atMs: record.payload.trial.latestMarkerAtPerformanceMs + 100,
      type: "assistant.render.active",
      detail: "reativou"
    });
  });
  const physical = analyzeExp0025Campaign(reactivated);
  assert.equal(physical.gates.traceStructural, true);
  assert.equal(physical.physicalMeasurementStatus, "EVALUATED");
  assert.equal(physical.gates.terminalStopStable, false);
  assert.equal(physical.decision, EXP0025_DECISIONS.fix);
});

test("trace referencialmente malformado invalida antes da interpretação", () => {
  const input = rebuild(campaign(), (frames) => {
    const record = frames.find((frame) =>
      frame.type === T.physicalTrialResult);
    const trace = record.payload.trial.finalSnapshot.trainingTrace;
    trace.events.push(structuredClone(trace.events[0]));
  });
  const analysis = analyzeExp0025Campaign(input);
  assert.equal(analysis.gates.traceStructural, false);
  assert.equal(analysis.decision, EXP0025_DECISIONS.invalidate);
  assert.equal(analysis.physicalMeasurementStatus, "NOT_EVALUATED");
});

test("lifecycle/estado semanticamente errado produz FIX, não invalidação", () => {
  const input = rebuild(campaign(), (frames) => {
    const record = frames.find((frame) =>
      frame.type === T.physicalTrialResult);
    record.payload.trial.finalSnapshot.state.assistantSpeaking = true;
  });
  const analysis = analyzeExp0025Campaign(input);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.physicalMeasurementStatus, "EVALUATED");
  assert.equal(analysis.gates.terminalStopStable, false);
  assert.equal(analysis.decision, EXP0025_DECISIONS.fix);
});

test("diversidade insuficiente produz HOLD sem rerun", () => {
  const input = campaign({
    orderFor: (index) => index === 0
      ? EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
      : EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE
  });
  const analysis = analyzeExp0025Campaign(input);
  assert.equal(analysis.gates.orderDiversity, false);
  assert.equal(analysis.gates.classTemporalEquivalence, null);
  assert.equal(analysis.decision, EXP0025_DECISIONS.hold);
  assert.equal(analysis.sameExperimentRerunAllowed, false);
});

test("delta temporal acima de 16,7 ms rejeita só a normalização", () => {
  const input = campaign({
    orderFor: (index) => index < 6
      ? EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
      : EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE,
    latencyFor: (index) => index < 6 ? 5 : 240
  });
  const analysis = analyzeExp0025Campaign(input);
  assert.equal(analysis.gates.orderDiversity, true);
  assert.equal(analysis.gates.classTemporalEquivalence, false);
  assert.equal(analysis.decision, EXP0025_DECISIONS.rejectNormalization);
});

test("boundary é causal; diagnóstico e budget são não bloqueantes", () => {
  const wrongBoundary = structuredClone(campaign());
  wrongBoundary.boundary.receiptWriteOnce = false;
  const boundaryAnalysis = analyzeExp0025Campaign(wrongBoundary);
  assert.equal(boundaryAnalysis.gates.boundaryReconstructed, false);
  assert.equal(boundaryAnalysis.decision, EXP0025_DECISIONS.invalidate);

  const diagnostic = rebuild(campaign(), (frames) => {
    frames.splice(frames.length - 1, 0, {
      schemaVersion: frames[0].schemaVersion,
      nonce: frames[0].nonce,
      ordinal: 0,
      type: T.diagnostic,
      payload: {
        category: "runtime",
        code: "RUNTIME_ERROR",
        message: "fixture",
        navigationIndex: 1,
        observedAt: COMPLETED_AT,
        trialId: null
      }
    });
  });
  const diagnosticAnalysis = analyzeExp0025Campaign(diagnostic);
  assert.equal(diagnosticAnalysis.gates.diagnosticsLocalBudget, false);
  assert.equal(diagnosticAnalysis.provenanceDiagnostics.runtimeBudget, "FAIL");
  assert.equal(diagnosticAnalysis.decision, EXP0025_DECISIONS.pass);
  assert.equal(diagnosticAnalysis.physicalMeasurementStatus, "EVALUATED");
});

test("outcome tardio divergente não apaga doze resultados causais", () => {
  for (const mutate of [
    (outcome) => { outcome.outcome.stderrByteLength = 1; },
    (outcome) => { outcome.outcome.recordCount += 1; },
    (outcome) => { outcome.outcome.protocolError = "late protocol error"; },
    (outcome) => { outcome.outcome.kind = "unexpected-success"; }
  ]) {
    const input = rebuild(campaign(), (frames) => {
      const outcome = frames.find((frame) => frame.type === T.workerOutcome)
        .payload;
      mutate(outcome);
    });
    const analysis = analyzeExp0025Campaign(input);
    assert.equal(analysis.gates.journalReconstructible, true);
    assert.equal(analysis.provenanceDiagnostics.workerOutcome, "FAIL");
    assert.equal(analysis.physicalMeasurementStatus, "EVALUATED");
    assert.equal(analysis.decision, EXP0025_DECISIONS.pass);
  }
});

test("recovery nunca promove journal completo sobrevivente a medição", () => {
  const recovered = structuredClone(campaign());
  recovered.boundary.executionState =
    EXP0025_EXECUTION_STATES.recoveryValidJournal;
  recovered.boundary.recoveryOnly = true;
  recovered.boundary.failureCode = "RECOVERY_ONLY_VALID_JOURNAL";
  const analysis = analyzeExp0025Campaign(recovered);
  assert.equal(analysis.gates.journalReconstructible, true);
  assert.equal(analysis.gates.boundaryReconstructed, false);
  assert.equal(analysis.instrumentValid, false);
  assert.equal(analysis.physicalMeasurementStatus, "NOT_EVALUATED");
  assert.equal(analysis.gates.terminalStopStable, null);
  assert.equal(analysis.decision, EXP0025_DECISIONS.invalidate);
});

test("relatório é reconstruído e rejeita interpretação rehasheada", () => {
  const report = createExp0025Report({
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    campaign: campaign()
  });
  assert.equal(validateExp0025Report(report).valid, true);
  assert.equal(report.browserCdpByteIdentity, null);
  assert.equal(report.browserCdpByteIdentityStatus, "NOT_EVALUATED");
  assert.equal(report.authorityEligible, false);
  assert.equal(report.sameExperimentRerunAllowed, false);

  const tampered = structuredClone(report);
  tampered.claim = "pronto para produção";
  const core = structuredClone(tampered);
  delete core.reportSha256;
  tampered.reportSha256 = `sha256:${canonicalSha256(core)}`;
  assert.equal(validateExp0025Report(tampered).valid, false);
});
