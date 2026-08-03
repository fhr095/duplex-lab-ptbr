import { isDeepStrictEqual } from "node:util";

import { validateTrainingTraceBundle } from
  "../../web/training-trace-recorder.mjs";
import { measureUsageDelta } from "./runtime-provenance.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0020_REPORT_SCHEMA = "exp-0020-stop-order-report-v1";
export const EXP0020_EXPERIMENT_ID = "EXP-0020";
export const EXP0020_REPORT_PATH =
  "eval/reports/exp-0020-stop-order-v0.1.json";
export const EXP0020_FREEZE_PATH =
  "eval/commitments/exp-0020-instrumentation-freeze-v0.1.json";
export const EXP0020_ATTEMPT_PATH =
  "eval/commitments/exp-0020-browser-attempt-v0.1.json";
export const EXP0020_RECEIPT_PATH =
  "eval/generated/exp-0020/browser-attempt-consumed-v0.1.json";
export const EXP0020_PREREGISTRATION_PATH =
  "docs/experiments/EXP-0020-physical-stop-order.md";
export const EXP0020_EXP0019_EVIDENCE_COMMIT =
  "0127322ad18a5b1d98de53d9e45898249e05888d";

export const EXP0020_ORDER_CLASSES = Object.freeze({
  PAUSE_THEN_RENDER: "PAUSE_THEN_RENDER",
  RENDER_THEN_PAUSE: "RENDER_THEN_PAUSE"
});

export const EXP0020_CONFIG = deepFreeze({
  targetUrl: "http://localhost:4173/?automation=1&experiment=0020",
  navigations: 2,
  stopsPerNavigation: 6,
  totalStops: 12,
  phrase:
    "Esta fala contínua mede uma única parada física do assistente.",
  ttsRate: 1,
  triggerAfterRenderActiveMs: 320,
  triggerTimerErrorMaxMs: 10,
  postStopObservationMs: 250,
  renderStopLimitMs: 250,
  classMinimumCount: 2,
  classLatencyEquivalenceMarginMs: 16.7,
  provider: "local",
  asrState: "disabled",
  vadControlEngine: "adaptive-energy-vad",
  vadShadowState: "disabled",
  ttsEngine: "windows-system-speech",
  paidApiCalls: 0,
  gpuRuns: 0,
  canProduceNewEffects: false
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ORDER_VALUES = new Set(Object.values(EXP0020_ORDER_CLASSES));
const MARKER_TYPES = Object.freeze([
  "assistant.speech.paused",
  "assistant.render.stopped"
]);
const EXPECTED_EFFECT_STAGES = Object.freeze([
  "accepted",
  "dispatched",
  "player-received",
  "renderer-silent",
  "completed"
]);
const INSTRUMENT_GATE_NAMES = Object.freeze([
  "boundaryBound",
  "campaignCardinality",
  "trialIdentity",
  "markersCollected",
  "collectionWindowValid",
  "sameRuntimeAndBrowser",
  "localNetworkOnly",
  "controlledStimulus",
  "trainingTraceValid",
  "diagnosticsClean",
  "zeroExternalCostAndNewAuthority"
]);
const PHYSICAL_GATE_NAMES = Object.freeze([
  "singleLifecycleAndEffect",
  "pauseReceiptBeforeMarkers",
  "terminalStopStable",
  "terminalProjectionEquivalent"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function finite(value) {
  return Number.isFinite(value);
}

function roundHundredth(value) {
  return Math.round(value * 100) / 100;
}

function eventType(event) {
  return typeof event?.type === "string" ? event.type : null;
}

function traceOf(trial) {
  return Array.isArray(trial?.finalSnapshot?.trace)
    ? trial.finalSnapshot.trace
    : [];
}

function markerRecords(trace) {
  return MARKER_TYPES.map((type) => ({
    type,
    records: trace
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => eventType(event) === type)
  }));
}

export function classifyExp0020Order(trace) {
  if (!Array.isArray(trace)) return null;
  const markers = markerRecords(trace);
  if (markers.some(({ records }) => records.length !== 1)) return null;
  const pauseIndex = markers[0].records[0].index;
  const renderIndex = markers[1].records[0].index;
  if (pauseIndex === renderIndex) return null;
  return pauseIndex < renderIndex
    ? EXP0020_ORDER_CLASSES.PAUSE_THEN_RENDER
    : EXP0020_ORDER_CLASSES.RENDER_THEN_PAUSE;
}

function parseTransitions(trace) {
  return trace
    .filter((event) => eventType(event) === "output-interruption.transition")
    .map((event) => {
      try {
        return { event, detail: JSON.parse(event.detail) };
      } catch {
        return { event, detail: null };
      }
    });
}

function pauseEffects(snapshot) {
  return (snapshot?.trainingTrace?.effects ?? []).filter(
    (effect) => effect?.effectType === "PAUSE_OUTPUT"
  );
}

function stage(effect, name) {
  return effect?.stages?.find((candidate) => candidate?.stage === name) ?? null;
}

function normalizedStageEvidence(entry) {
  const evidence = entry?.evidence ?? {};
  if (entry?.stage === "dispatched") {
    return { command: evidence.command ?? null };
  }
  if (entry?.stage === "player-received") {
    return {
      audioPresent: evidence.audioPresent ?? null,
      paused: evidence.paused ?? null
    };
  }
  if (entry?.stage === "renderer-silent") {
    return { kind: evidence.kind ?? null };
  }
  if (entry?.stage === "completed") {
    return { observation: evidence.observation ?? null };
  }
  return {};
}

function normalizedProjection(trial, transition, effect) {
  const snapshot = trial.finalSnapshot;
  const lifecycle = snapshot?.audio?.outputInterruptionLifecycle ?? {};
  const probe = snapshot?.audio?.renderProbe ?? {};
  const stop = snapshot?.audio?.lastRenderStop ?? {};
  return {
    transition: transition === null ? null : {
      eventType: transition.eventType ?? null,
      previousPhase: transition.previousPhase ?? null,
      phase: transition.phase ?? null,
      reason: transition.reason ?? null,
      pauseKind: transition.pauseKind ?? null,
      intents: (transition.intents ?? []).map((intent) =>
        typeof intent === "string" ? intent : intent?.type
      )
    },
    state: {
      assistantSpeaking: snapshot?.state?.assistantSpeaking ?? null,
      potentialBargeIn: snapshot?.state?.potentialBargeIn ?? null
    },
    lifecycle: {
      schemaVersion: lifecycle.schemaVersion ?? null,
      lifecycleVersion: lifecycle.lifecycleVersion ?? null,
      phase: lifecycle.phase ?? null,
      pauseKind: lifecycle.pauseKind ?? null,
      resumeAttempt: lifecycle.resumeAttempt ?? null
    },
    renderProbe: {
      state: probe.state ?? null,
      pendingMeasurements: probe.pendingMeasurements ?? null,
      threshold: probe.threshold ?? null,
      requiredSilenceQuanta: probe.requiredSilenceQuanta ?? null,
      scope: probe.scope ?? null
    },
    renderStop: {
      kind: stop.kind ?? null,
      renderedThroughTrigger: stop.renderedThroughTrigger ?? null,
      threshold: stop.threshold ?? null,
      requiredSilenceQuanta: stop.requiredSilenceQuanta ?? null,
      scope: stop.scope ?? null
    },
    effect: effect === null ? null : {
      effectType: effect.effectType ?? null,
      status: effect.status ?? null,
      stages: (effect.stages ?? []).map((entry) => ({
        stage: entry.stage,
        evidence: normalizedStageEvidence(entry)
      }))
    }
  };
}

function traceDiagnosticsClean(trace) {
  const forbidden = new Set([
    "assistant.render.stop.error",
    "output-interruption.invariant.error",
    "training-trace.decision.error",
    "training-trace.effect.error"
  ]);
  return trace.every((event) => !forbidden.has(eventType(event)));
}

export function analyzeExp0020Trial(trial) {
  const trace = traceOf(trial);
  const markers = markerRecords(trace);
  const markersCollected = markers.every(
    ({ records }) => records.length === 1
  );
  const order = classifyExp0020Order(trace);
  const pauseMarker = markers[0].records[0] ?? null;
  const renderMarker = markers[1].records[0] ?? null;
  const markerAtMs = [pauseMarker, renderMarker].map(
    (record) => record?.event?.atMs
  );
  const laterMarkerAtMs = markerAtMs.every(finite)
    ? Math.max(...markerAtMs)
    : null;
  const transitions = parseTransitions(trace);
  const pauseTransitions = transitions.filter(
    ({ detail }) => detail?.eventType === "PAUSE_REQUESTED"
  );
  const transition = pauseTransitions.length === 1
    ? pauseTransitions[0].detail
    : null;
  const effects = pauseEffects(trial?.finalSnapshot);
  const effect = effects.length === 1 ? effects[0] : null;
  const stageNames = effect?.stages?.map((entry) => entry.stage) ?? [];
  const accepted = stage(effect, "accepted");
  const dispatched = stage(effect, "dispatched");
  const received = stage(effect, "player-received");
  const rendererSilent = stage(effect, "renderer-silent");
  const completed = stage(effect, "completed");
  const traceValidation = validateTrainingTraceBundle(
    trial?.finalSnapshot?.trainingTrace
  );
  const traceDecisions = trial?.finalSnapshot?.trainingTrace?.decisions ?? [];
  const traceEvents = trial?.finalSnapshot?.trainingTrace?.events ?? [];
  const effectDecision = effect === null
    ? null
    : traceDecisions.find(
      (candidate) => candidate?.decisionId === effect.decisionId
    ) ?? null;
  const effectEvents = effect === null
    ? []
    : traceEvents.filter((candidate) =>
      (effect.triggeredBy ?? []).includes(candidate?.eventId)
    );
  const lifecycle = trial?.finalSnapshot?.audio
    ?.outputInterruptionLifecycle ?? {};
  const renderProbe = trial?.finalSnapshot?.audio?.renderProbe ?? {};
  const renderStop = trial?.finalSnapshot?.audio?.lastRenderStop ?? {};
  const latestMarkerIndex = markers.every(
    ({ records }) => records.length === 1
  )
    ? Math.max(...markers.map(({ records }) => records[0].index))
    : null;
  const activeAfterStop = latestMarkerIndex === null
    ? []
    : trace.slice(latestMarkerIndex + 1).filter(
      (event) => eventType(event) === "assistant.render.active"
    );
  const startActiveMarkers = (trial?.startSnapshot?.trace ?? []).filter(
    (event) => eventType(event) === "assistant.render.active"
  );
  const startActive =
    trial?.startSnapshot?.state?.assistantSpeaking === true &&
    startActiveMarkers.length === 1 &&
    finite(startActiveMarkers[0]?.atMs) &&
    startActiveMarkers[0].atMs === trial?.timing?.renderActiveAtMs;
  const triggerOffsetMs = finite(trial?.timing?.actualTriggerAtMs) &&
      finite(trial?.timing?.renderActiveAtMs)
    ? trial.timing.actualTriggerAtMs - trial.timing.renderActiveAtMs
    : null;
  const triggerTimerErrorMs = finite(trial?.timing?.actualTriggerAtMs) &&
      finite(trial?.timing?.plannedTriggerAtMs)
    ? trial.timing.actualTriggerAtMs - trial.timing.plannedTriggerAtMs
    : null;
  const postStopObservationMs = finite(
    trial?.timing?.postStopObservedAtMs
  ) && finite(laterMarkerAtMs)
    ? trial.timing.postStopObservedAtMs - laterMarkerAtMs
    : null;
  const collectionWindowValid =
    finite(laterMarkerAtMs) &&
    trial?.timing?.latestStopMarkerAtMs === laterMarkerAtMs &&
    finite(trial?.timing?.postStopObservedAtMs) &&
    trial.timing.postStopObservedAtMs ===
      trial?.finalSnapshot?.observedAtMs &&
    finite(trial?.timing?.postLatestMarkerHorizonMs) &&
    trial.timing.postLatestMarkerHorizonMs === postStopObservationMs &&
    postStopObservationMs >= EXP0020_CONFIG.postStopObservationMs;
  const firstMarkerAtMs = markerAtMs.every(finite)
    ? Math.min(...markerAtMs)
    : null;
  const latencyMs = renderStop?.latencyMs;
  const renderEvidenceConsistent =
    finite(trial?.timing?.actualTriggerAtMs) &&
    finite(renderStop?.triggerAtMs) &&
    renderStop.triggerAtMs >= trial.timing.actualTriggerAtMs &&
    renderStop.triggerAtMs >= pauseTransitions[0]?.event?.atMs &&
    renderStop.triggerAtMs >= accepted?.atMs &&
    finite(firstMarkerAtMs) &&
    renderStop.triggerAtMs <= firstMarkerAtMs &&
    finite(renderStop?.lastRenderedAtMs) &&
    renderStop.lastRenderedAtMs >= renderStop.triggerAtMs &&
    finite(renderStop?.observedAtMs) &&
    renderStop.observedAtMs >= renderStop.lastRenderedAtMs &&
    finite(latencyMs) &&
    Math.abs(
      renderStop.lastRenderedAtMs - renderStop.triggerAtMs - latencyMs
    ) <= 0.02 &&
    rendererSilent?.evidence?.latencyMs === latencyMs &&
    finite(renderMarker?.event?.atMs) &&
    renderMarker.event.atMs >= renderStop.observedAtMs;
  const pauseReceivedBeforeMarkers = finite(received?.atMs) &&
    finite(firstMarkerAtMs) &&
    roundHundredth(received.atMs) <= roundHundredth(firstMarkerAtMs);
  const projection = transition !== null && effect !== null
    ? normalizedProjection(trial, transition, effect)
    : null;
  const markerGapMs = markerAtMs.every(finite)
    ? Math.abs(markerAtMs[0] - markerAtMs[1])
    : null;

  const gates = {
    identity:
      Number.isSafeInteger(trial?.navigationIndex) &&
      Number.isSafeInteger(trial?.trialIndex) &&
      typeof trial?.turnId === "string" && trial.turnId.length > 0 &&
      transition?.turnId === trial.turnId &&
      transition?.event?.turnId === trial.turnId &&
      lifecycle.turnId === trial.turnId &&
      effectDecision?.turnId === trial.turnId &&
      effectEvents.length === 1 &&
      effectEvents[0]?.turnId === trial.turnId,
    markersCollected,
    startActive,
    controlledPhase:
      finite(triggerOffsetMs) &&
      finite(triggerTimerErrorMs) &&
      trial?.timing?.plannedTriggerAtMs ===
        trial?.timing?.renderActiveAtMs +
          EXP0020_CONFIG.triggerAfterRenderActiveMs &&
      triggerOffsetMs >= EXP0020_CONFIG.triggerAfterRenderActiveMs &&
      triggerOffsetMs <= EXP0020_CONFIG.triggerAfterRenderActiveMs +
        EXP0020_CONFIG.triggerTimerErrorMaxMs + 0.02 &&
      triggerTimerErrorMs >= 0 &&
      triggerTimerErrorMs <= EXP0020_CONFIG.triggerTimerErrorMaxMs &&
      trial?.timing?.timerErrorMs === triggerTimerErrorMs &&
      markerAtMs.every((atMs) =>
        finite(atMs) && atMs >= trial.timing.actualTriggerAtMs
      ) &&
      pauseTransitions.length === 1 &&
      finite(pauseTransitions[0]?.event?.atMs) &&
      pauseTransitions[0].event.atMs >= trial.timing.actualTriggerAtMs &&
      finite(accepted?.atMs) &&
      accepted.atMs >= trial.timing.actualTriggerAtMs,
    collectionWindowValid,
    trainingTraceValid:
      traceValidation.valid && traceDiagnosticsClean(trace),
    singleLifecycleAndEffect:
      pauseTransitions.length === 1 &&
      transitions.length === 1 &&
      transition?.previousPhase === "idle" &&
      transition?.phase === "held" &&
      transition?.reason === "output-held" &&
      transition?.pauseKind === "audible" &&
      isDeepStrictEqual(
        (transition?.intents ?? []).map((intent) => intent.type),
        ["PAUSE_OUTPUT"]
      ) &&
      effects.length === 1 &&
      isDeepStrictEqual(stageNames, EXPECTED_EFFECT_STAGES),
    pauseReceiptBeforeMarkers:
      dispatched?.evidence?.command === "HTMLMediaElement.pause" &&
      received?.evidence?.audioPresent === true &&
      received?.evidence?.paused === true &&
      rendererSilent?.evidence?.kind === "browser-render-stop" &&
      completed?.evidence?.observation === "browser-render-stop" &&
      pauseReceivedBeforeMarkers,
    terminalStopStable:
      trial?.finalSnapshot?.state?.assistantSpeaking === false &&
      trial?.finalSnapshot?.state?.potentialBargeIn === "pending" &&
      lifecycle.phase === "held" &&
      lifecycle.pauseKind === "audible" &&
      renderProbe.state === "ready" &&
      renderProbe.pendingMeasurements === 0 &&
      renderStop.kind === "browser-render-stop" &&
      renderStop.renderedThroughTrigger === true &&
      renderEvidenceConsistent &&
      isDeepStrictEqual(trial?.renderStopAtMarkers, renderStop) &&
      finite(latencyMs) && latencyMs >= 0 &&
      latencyMs <= EXP0020_CONFIG.renderStopLimitMs &&
      activeAfterStop.length === 0
  };

  return deepFreeze({
    navigationIndex: trial?.navigationIndex ?? null,
    trialIndex: trial?.trialIndex ?? null,
    turnId: trial?.turnId ?? null,
    order,
    projection,
    projectionSha256: projection === null
      ? null
      : `sha256:${canonicalSha256(projection)}`,
    metrics: {
      renderStopLatencyMs: finite(latencyMs) ? latencyMs : null,
      markerGapMs,
      triggerOffsetMs,
      triggerTimerErrorMs,
      postStopObservationMs
    },
    evidence: {
      markerAtMs,
      pauseReceivedAtMs: received?.atMs ?? null,
      activeAfterStopCount: activeAfterStop.length,
      effectCount: effects.length,
      transitionCount: transitions.length,
      pauseTransitionCount: pauseTransitions.length,
      traceValidationErrors: [...(traceValidation.errors ?? [])]
    },
    gates
  });
}

export function median(values) {
  if (
    !Array.isArray(values) || values.length === 0 ||
    values.some((value) => !finite(value))
  ) {
    throw new TypeError("mediana exige amostras finitas");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function nearestRankP95(values) {
  if (
    !Array.isArray(values) || values.length === 0 ||
    values.some((value) => !finite(value) || value < 0)
  ) {
    throw new TypeError("p95 exige amostras finitas não negativas");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function distribution(values) {
  if (values.length === 0) {
    return { count: 0, minimum: null, median: null, p95: null, maximum: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minimum: sorted[0],
    median: median(sorted),
    p95: nearestRankP95(sorted),
    maximum: sorted.at(-1)
  };
}

function localResource(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "data:") return true;
    if (url.protocol === "blob:") {
      const inner = new URL(url.pathname);
      return ["localhost", "127.0.0.1"].includes(inner.hostname);
    }
    return url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function diagnosticsClean(diagnostics) {
  return ["consoleErrors", "runtimeErrors", "httpErrors"].every(
    (name) => Array.isArray(diagnostics?.[name]) &&
      diagnostics[name].length === 0
  );
}

function healthAndCost(campaign) {
  const before = campaign?.health?.before;
  const after = campaign?.health?.after;
  try {
    const delta = measureUsageDelta(before, after);
    const valid = before.brain === EXP0020_CONFIG.provider &&
      after.brain === EXP0020_CONFIG.provider &&
      before.process.runtimeFingerprint?.sha256 ===
        after.process.runtimeFingerprint?.sha256 &&
      before.asr?.state === EXP0020_CONFIG.asrState &&
      after.asr?.state === EXP0020_CONFIG.asrState &&
      before.vadControl?.engine === EXP0020_CONFIG.vadControlEngine &&
      after.vadControl?.engine === EXP0020_CONFIG.vadControlEngine &&
      before.vadControl?.state === "ready" &&
      after.vadControl?.state === "ready" &&
      before.vadShadow?.state === EXP0020_CONFIG.vadShadowState &&
      after.vadShadow?.state === EXP0020_CONFIG.vadShadowState &&
      before.tts?.state === "ready" && after.tts?.state === "ready" &&
    before.tts?.engine === EXP0020_CONFIG.ttsEngine &&
      after.tts?.engine === EXP0020_CONFIG.ttsEngine &&
      typeof before.tts?.voice === "string" && before.tts.voice.length > 0 &&
      before.tts.voice === after.tts.voice &&
      typeof before.tts?.culture === "string" &&
      before.tts.culture.length > 0 &&
      before.tts?.culture === after.tts?.culture &&
      delta.requests === 0 && delta.inputTokens === 0 &&
      delta.outputTokens === 0 && delta.totalTokens === 0 &&
      delta.paidApiCalls === 0 && delta.externalLlmUsed === false &&
      campaign?.cost?.gpuRuns === EXP0020_CONFIG.gpuRuns &&
      campaign?.authority?.canProduceNewEffects === false;
    return { valid, delta };
  } catch (error) {
    return { valid: false, error: error.message, delta: null };
  }
}

function campaignCardinality(campaign, trials) {
  if (
    !Array.isArray(campaign?.navigations) ||
    campaign.navigations.length !== EXP0020_CONFIG.navigations ||
    trials.length !== EXP0020_CONFIG.totalStops
  ) return false;
  return campaign.navigations.every((navigation, navIndex) =>
    navigation?.index === navIndex + 1 &&
    Array.isArray(navigation.trials) &&
    navigation.trials.length === EXP0020_CONFIG.stopsPerNavigation &&
    navigation.trials.every((trial, trialIndex) =>
      trial?.navigationIndex === navIndex + 1 &&
      trial?.trialIndex === trialIndex + 1
    )
  );
}

function sameRuntimeAndBrowser(campaign) {
  const fingerprints = (campaign?.navigations ?? []).map(
    (navigation) => navigation?.runtimeFingerprintSha256
  );
  const browserProducts = (campaign?.navigations ?? []).map(
    (navigation) => navigation?.browser?.product
  );
  const targetUrls = (campaign?.navigations ?? []).map(
    (navigation) => navigation?.targetUrl
  );
  const healthFingerprints = [
    campaign?.health?.before?.process?.runtimeFingerprint?.sha256,
    campaign?.health?.after?.process?.runtimeFingerprint?.sha256
  ].map((value) => {
    if (typeof value !== "string") return null;
    const normalized = value.startsWith("sha256:")
      ? value.toLowerCase()
      : `sha256:${value.toLowerCase()}`;
    return HASH_PATTERN.test(normalized) ? normalized : null;
  });
  return fingerprints.length === EXP0020_CONFIG.navigations &&
    fingerprints.every((value) => HASH_PATTERN.test(value ?? "")) &&
    healthFingerprints.every((value) => value !== null) &&
    new Set([...fingerprints, ...healthFingerprints]).size === 1 &&
    browserProducts.every(
      (value) => typeof value === "string" && value.length > 0
    ) &&
    new Set(browserProducts).size === 1 &&
    targetUrls.every((value) => value === EXP0020_CONFIG.targetUrl);
}

function expectedBoundary(boundary) {
  return exactKeys(boundary, [
    "attemptCanonicalSha256",
    "attemptFileSha256",
    "attemptPath",
    "attemptVerified",
    "freezeCanonicalSha256",
    "freezeFileSha256",
    "freezePath",
    "freezeVerified",
    "receiptFileSha256",
    "receiptPath",
    "rerunAllowed"
  ]) &&
    boundary.attemptPath === EXP0020_ATTEMPT_PATH &&
    boundary.freezePath === EXP0020_FREEZE_PATH &&
    boundary.receiptPath === EXP0020_RECEIPT_PATH &&
    boundary.attemptVerified === true &&
    boundary.freezeVerified === true &&
    boundary.rerunAllowed === false &&
    [
      boundary.attemptCanonicalSha256,
      boundary.attemptFileSha256,
      boundary.freezeCanonicalSha256,
      boundary.freezeFileSha256,
      boundary.receiptFileSha256
    ].every((value) => HASH_PATTERN.test(value ?? ""));
}

export function analyzeExp0020Campaign(campaign) {
  const trials = (campaign?.navigations ?? []).flatMap(
    (navigation) => navigation?.trials ?? []
  );
  const analyses = trials.map(analyzeExp0020Trial);
  const turnIds = analyses.map((analysis) => analysis.turnId);
  const wavHashes = trials.map((trial) => trial?.tts?.wavSha256);
  const wavControlled = wavHashes.length === EXP0020_CONFIG.totalStops &&
    wavHashes.every((value) => HASH_PATTERN.test(value ?? "")) &&
    new Set(wavHashes).size === 1 &&
    trials.every((trial) =>
      trial?.tts?.rate === EXP0020_CONFIG.ttsRate &&
      trial?.tts?.requestText === EXP0020_CONFIG.phrase &&
      trial?.tts?.requestUrl ===
        new URL("/api/tts", EXP0020_CONFIG.targetUrl).href &&
      trial?.tts?.method === "POST" &&
      trial?.tts?.status === 200 &&
      trial?.tts?.mimeType === "audio/wav" &&
      Number.isSafeInteger(trial?.tts?.byteLength) &&
      trial.tts.byteLength > 44
    );
  const resources = (campaign?.navigations ?? []).flatMap(
    (navigation) => navigation?.networkRequests ?? []
  );
  const healthCost = healthAndCost(campaign);
  const classLatencies = Object.fromEntries(
    Object.values(EXP0020_ORDER_CLASSES).map((order) => [
      order,
      analyses
        .filter((analysis) => analysis.order === order)
        .map((analysis) => analysis.metrics.renderStopLatencyMs)
        .filter(finite)
    ])
  );
  const classMetrics = Object.fromEntries(
    Object.entries(classLatencies).map(([order, values]) => [
      order,
      distribution(values)
    ])
  );
  const diversity = Object.values(classMetrics).every(
    (stats) => stats.count >= EXP0020_CONFIG.classMinimumCount
  );
  const classMedianDeltaMs = diversity
    ? Math.abs(
      classMetrics.PAUSE_THEN_RENDER.median -
      classMetrics.RENDER_THEN_PAUSE.median
    )
    : null;
  const classP95DeltaMs = diversity
    ? Math.abs(
      classMetrics.PAUSE_THEN_RENDER.p95 -
      classMetrics.RENDER_THEN_PAUSE.p95
    )
    : null;
  const temporalEquivalent = diversity
    ? classMedianDeltaMs <=
        EXP0020_CONFIG.classLatencyEquivalenceMarginMs &&
      classP95DeltaMs <= EXP0020_CONFIG.classLatencyEquivalenceMarginMs
    : null;
  const projectionHashes = analyses.map(
    (analysis) => analysis.projectionSha256
  );
  const gates = {
    boundaryBound: expectedBoundary(campaign?.boundary),
    campaignCardinality: campaignCardinality(campaign, trials),
    trialIdentity:
      analyses.every((analysis) => analysis.gates.identity) &&
      turnIds.every((turnId) => typeof turnId === "string") &&
      new Set(turnIds).size === EXP0020_CONFIG.totalStops,
    markersCollected:
      analyses.every((analysis) => analysis.gates.markersCollected),
    collectionWindowValid:
      analyses.every((analysis) => analysis.gates.collectionWindowValid),
    sameRuntimeAndBrowser: sameRuntimeAndBrowser(campaign),
    localNetworkOnly:
      resources.length > 0 && resources.every(localResource) &&
      (campaign?.navigations ?? []).every((navigation) => {
        const urls = navigation?.networkRequests;
        return Array.isArray(urls) && urls.length > 0 &&
          urls.every(localResource) &&
          urls.includes(EXP0020_CONFIG.targetUrl) &&
          urls.includes(new URL("/api/tts", EXP0020_CONFIG.targetUrl).href);
      }),
    controlledStimulus:
      wavControlled &&
      analyses.every((analysis) =>
        analysis.gates.startActive && analysis.gates.controlledPhase
      ),
    trainingTraceValid:
      analyses.every((analysis) => analysis.gates.trainingTraceValid),
    diagnosticsClean: diagnosticsClean(campaign?.diagnostics),
    zeroExternalCostAndNewAuthority: healthCost.valid,
    singleLifecycleAndEffect:
      analyses.every(
        (analysis) => analysis.gates.singleLifecycleAndEffect
      ),
    pauseReceiptBeforeMarkers:
      analyses.every(
        (analysis) => analysis.gates.pauseReceiptBeforeMarkers
      ),
    terminalStopStable:
      analyses.every((analysis) => analysis.gates.terminalStopStable),
    terminalProjectionEquivalent:
      projectionHashes.length === EXP0020_CONFIG.totalStops &&
      projectionHashes.every((value) => HASH_PATTERN.test(value ?? "")) &&
      new Set(projectionHashes).size === 1,
    orderDiversity: diversity,
    classTemporalEquivalence: temporalEquivalent
  };

  let decision;
  if (INSTRUMENT_GATE_NAMES.some((name) => gates[name] !== true)) {
    decision = "INVALIDATE_STOP_ORDER_INSTRUMENT";
  } else if (PHYSICAL_GATE_NAMES.some((name) => gates[name] !== true)) {
    decision = "FIX_PHYSICAL_STOP_PATH";
  } else if (!diversity) {
    decision = "HOLD_ORDER_DIVERSITY";
  } else if (temporalEquivalent !== true) {
    decision = "FIX_PHYSICAL_STOP_PATH";
  } else {
    decision = "PASS_TELEMETRY_ORDER_EQUIVALENT";
  }

  return deepFreeze({
    trials: analyses,
    metrics: {
      classes: classMetrics,
      aggregate: {
        renderStopLatencyMs: distribution(
          analyses
            .map((analysis) => analysis.metrics.renderStopLatencyMs)
            .filter(finite)
        ),
        markerGapMs: distribution(
          analyses
            .map((analysis) => analysis.metrics.markerGapMs)
            .filter(finite)
        )
      },
      classMedianDeltaMs,
      classP95DeltaMs,
      wavSha256: wavControlled ? wavHashes[0] : null,
      usageDelta: healthCost.delta ?? null
    },
    gates,
    decision,
    pass: decision === "PASS_TELEMETRY_ORDER_EQUIVALENT"
  });
}

function reportCore(input, analysis) {
  return {
    schemaVersion: EXP0020_REPORT_SCHEMA,
    experimentId: EXP0020_EXPERIMENT_ID,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    contract: structuredClone(EXP0020_CONFIG),
    campaign: structuredClone(input.campaign),
    analysis,
    gates: structuredClone(analysis.gates),
    decision: analysis.decision,
    pass: analysis.pass,
    instrumentValid:
      INSTRUMENT_GATE_NAMES.every((name) => analysis.gates[name] === true),
    authorityEligible: false,
    claim: analysis.pass
      ? "Neste fingerprint e no grafo Web Audio, as duas ordens observadas " +
        "preservaram pausa, estado, silêncio pós-STOP e margem temporal."
      : null,
    limitations: [
      "não mede alto-falante, sala ou percepção humana",
      "não mede ASR, conversa espontânea ou outros schedulers",
      "player-received é telemetria de software, não sensor físico independente"
    ]
  };
}

export function createExp0020Report(input) {
  const analysis = analyzeExp0020Campaign(input?.campaign);
  const core = reportCore(input, analysis);
  const report = deepFreeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0020Report(report);
  if (!validation.valid) {
    throw new TypeError(
      `relatório EXP-0020 inválido: ${validation.errors.join("; ")}`
    );
  }
  return report;
}

export function validateExp0020Report(report) {
  const errors = [];
  try {
    if (
      report?.schemaVersion !== EXP0020_REPORT_SCHEMA ||
      report?.experimentId !== EXP0020_EXPERIMENT_ID ||
      !isDeepStrictEqual(report?.contract, EXP0020_CONFIG) ||
      !Number.isFinite(Date.parse(report?.startedAt ?? "")) ||
      !Number.isFinite(Date.parse(report?.completedAt ?? ""))
    ) {
      errors.push("identidade, datas ou contrato incompatíveis");
    }
    const expected = analyzeExp0020Campaign(report?.campaign);
    if (!isDeepStrictEqual(report?.analysis, expected)) {
      errors.push("análise não corresponde à evidência bruta");
    }
    const expectedCore = reportCore({
      startedAt: report?.startedAt,
      completedAt: report?.completedAt,
      campaign: report?.campaign
    }, expected);
    const observedCore = structuredClone(report ?? {});
    delete observedCore.reportSha256;
    if (!isDeepStrictEqual(observedCore, expectedCore)) {
      errors.push("estrutura ou interpretação canônica divergiram");
    }
    if (
      !isDeepStrictEqual(report?.gates, expected.gates) ||
      report?.decision !== expected.decision ||
      report?.pass !== expected.pass ||
      report?.instrumentValid !== INSTRUMENT_GATE_NAMES.every(
        (name) => expected.gates[name] === true
      ) ||
      report?.authorityEligible !== false ||
      (expected.pass
        ? typeof report?.claim !== "string" || report.claim.length === 0
        : report?.claim !== null)
    ) {
      errors.push("decisão, gates, claim ou autoridade divergiram");
    }
    const core = structuredClone(report ?? {});
    delete core.reportSha256;
    if (
      report?.reportSha256 !== `sha256:${canonicalSha256(core)}`
    ) {
      errors.push("reportSha256 divergente");
    }
  } catch (error) {
    errors.push(`relatório malformado: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}
