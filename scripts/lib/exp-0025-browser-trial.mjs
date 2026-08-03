import { isDeepStrictEqual } from "node:util";

import { EXP0025_CONFIG } from "../../src/eval/exp-0025-boundary.mjs";
import { validateExp0020TrialCollection } from
  "./exp-0020-browser-harness.mjs";

export const EXP0025_BROWSER_TRIAL_RESULT_SCHEMA =
  "exp-0025-browser-trial-result-v1";
export const EXP0025_BROWSER_TRIAL_STATUSES = Object.freeze({
  collected: "COLLECTED",
  instrumentFailure: "INSTRUMENT_FAILURE"
});

const RESULT_KEYS = Object.freeze([
  "activeMarker",
  "activeSnapshot",
  "anchorTraceIndex",
  "code",
  "finalSnapshot",
  "finalSnapshotAtPerformanceMs",
  "latestMarkerAtPerformanceMs",
  "latestStopMarkerTraceIndex",
  "markerEvents",
  "markerSnapshotObservedAtMs",
  "message",
  "navigationIndex",
  "newRenderActiveMarkers",
  "phase",
  "plannedTriggerAtPerformanceMs",
  "postLatestMarkerHorizonMs",
  "preTriggerActiveMarkers",
  "preTriggerSnapshot",
  "renderStopAtMarkers",
  "renderStopUnchanged",
  "resetAtPerformanceMs",
  "resetSnapshot",
  "schemaVersion",
  "startSnapshot",
  "status",
  "timerErrorMs",
  "trialIndex",
  "triggerAtPerformanceMs",
  "turnId"
]);
const PHASES = new Set([
  "bootstrap",
  "reset",
  "render-onset",
  "trigger-scheduling",
  "stop-markers",
  "terminal-horizon",
  "complete"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function plainObject(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys) {
  return plainObject(value) && isDeepStrictEqual(
    Object.keys(value).toSorted(),
    [...keys].toSorted()
  );
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function expectedTurnId(navigationIndex, trialIndex) {
  return `exp0020-nav-${navigationIndex}-trial-${trialIndex}`;
}

function snapshotWithTrace(value) {
  return plainObject(value) && Array.isArray(value.trace);
}

function activeMarkers(snapshot) {
  return snapshot?.trace?.filter(
    (event) => event?.type === "assistant.render.active"
  ) ?? [];
}

function emptyResult(navigationIndex, trialIndex) {
  return {
    schemaVersion: EXP0025_BROWSER_TRIAL_RESULT_SCHEMA,
    status: EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure,
    phase: "bootstrap",
    code: null,
    message: null,
    navigationIndex,
    trialIndex,
    turnId: expectedTurnId(navigationIndex, trialIndex),
    resetAtPerformanceMs: null,
    resetSnapshot: null,
    activeSnapshot: null,
    startSnapshot: null,
    anchorTraceIndex: null,
    activeMarker: null,
    preTriggerSnapshot: null,
    preTriggerActiveMarkers: [],
    plannedTriggerAtPerformanceMs: null,
    triggerAtPerformanceMs: null,
    timerErrorMs: null,
    markerEvents: { paused: [], renderStopped: [] },
    latestMarkerAtPerformanceMs: null,
    latestStopMarkerTraceIndex: null,
    markerSnapshotObservedAtMs: null,
    renderStopAtMarkers: null,
    finalSnapshotAtPerformanceMs: null,
    postLatestMarkerHorizonMs: null,
    newRenderActiveMarkers: [],
    renderStopUnchanged: null,
    finalSnapshot: null
  };
}

export function createExp0025InstrumentFailure(input = {}) {
  if (!positiveInteger(input.navigationIndex) ||
    !positiveInteger(input.trialIndex) || !nonEmptyString(input.code)) {
    throw new TypeError("falha EXP-0025 exige identidade e code");
  }
  const partial = plainObject(input.partial) ? input.partial : {};
  const result = emptyResult(input.navigationIndex, input.trialIndex);
  for (const key of RESULT_KEYS) {
    if (!Object.hasOwn(partial, key) || [
      "schemaVersion", "status", "phase", "code", "message",
      "navigationIndex", "trialIndex", "turnId"
    ].includes(key)) continue;
    result[key] = structuredClone(partial[key]);
  }
  Object.assign(result, {
    status: EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure,
    phase: PHASES.has(input.phase) && input.phase !== "complete"
      ? input.phase
      : "bootstrap",
    code: input.code,
    message: String(input.message ?? input.code).slice(0, 500)
  });
  const validation = validateExp0025BrowserTrialResult(result);
  if (!validation.valid) {
    const fallback = emptyResult(input.navigationIndex, input.trialIndex);
    Object.assign(fallback, {
      status: EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure,
      phase: "bootstrap",
      code: input.code,
      message: String(input.message ?? input.code).slice(0, 500)
    });
    return deepFreeze(fallback);
  }
  return deepFreeze(result);
}

export function normalizeExp0025BrowserTrialResult(
  value,
  identity = {}
) {
  const validation = validateExp0025BrowserTrialResult(value);
  if (validation.valid) return deepFreeze(structuredClone(value));
  return createExp0025InstrumentFailure({
    navigationIndex: identity.navigationIndex,
    trialIndex: identity.trialIndex,
    phase: value?.phase,
    code: "MALFORMED_BROWSER_TRIAL_RESULT",
    message: validation.errors.join("; "),
    partial: value
  });
}

export function exp0025TrialExpression(input = {}) {
  const navigationIndex = input.navigationIndex;
  const trialIndex = input.trialIndex;
  if (!positiveInteger(navigationIndex) || !positiveInteger(trialIndex)) {
    throw new TypeError("EXP-0025 trial exige índices inteiros positivos");
  }
  const turnId = expectedTurnId(navigationIndex, trialIndex);
  return `/*EXP0025_RUN_STOP_TRIAL*/ (async () => {
    const result = {
      schemaVersion: ${JSON.stringify(EXP0025_BROWSER_TRIAL_RESULT_SCHEMA)},
      status: ${JSON.stringify(EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure)},
      phase: "bootstrap",
      code: null,
      message: null,
      navigationIndex: ${navigationIndex},
      trialIndex: ${trialIndex},
      turnId: ${JSON.stringify(turnId)},
      resetAtPerformanceMs: null,
      resetSnapshot: null,
      activeSnapshot: null,
      startSnapshot: null,
      anchorTraceIndex: null,
      activeMarker: null,
      preTriggerSnapshot: null,
      preTriggerActiveMarkers: [],
      plannedTriggerAtPerformanceMs: null,
      triggerAtPerformanceMs: null,
      timerErrorMs: null,
      markerEvents: { paused: [], renderStopped: [] },
      latestMarkerAtPerformanceMs: null,
      latestStopMarkerTraceIndex: null,
      markerSnapshotObservedAtMs: null,
      renderStopAtMarkers: null,
      finalSnapshotAtPerformanceMs: null,
      postLatestMarkerHorizonMs: null,
      newRenderActiveMarkers: [],
      renderStopUnchanged: null,
      finalSnapshot: null
    };
    const limitedMessage = (value) => String(value ?? "falha sem mensagem")
      .slice(0, 500);
    const fail = (code, message) => ({
      ...result,
      status: ${JSON.stringify(EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure)},
      code,
      message: limitedMessage(message)
    });
    const instrumentError = (code, message) => {
      const error = new Error(message);
      error.instrumentCode = code;
      throw error;
    };
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForSnapshot = async (lab, predicate, timeoutMs, label, code) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() <= deadline) {
        const snapshot = lab.snapshot();
        if (predicate(snapshot)) return snapshot;
        await delay(4);
      }
      instrumentError(code, "timeout aguardando " + label);
    };
    const waitUntil = async (targetAtMs) => {
      while (performance.now() < targetAtMs) {
        await delay(Math.max(0, targetAtMs - performance.now()));
      }
    };
    let lab = null;
    try {
      lab = window.__duplexLab;
      if (!lab || typeof lab.reset !== "function" ||
        typeof lab.snapshot !== "function" ||
        typeof lab.speakLoop !== "function" ||
        typeof lab.simulateAudioEvent !== "function") {
        return fail("AUTOMATION_UNAVAILABLE", "automação indisponível");
      }

      result.phase = "reset";
      result.resetAtPerformanceMs = performance.now();
      result.resetSnapshot = lab.reset();

      result.phase = "render-onset";
      lab.speakLoop(${JSON.stringify(EXP0025_CONFIG.phrase)});
      result.activeSnapshot = await waitForSnapshot(
        lab,
        (snapshot) => snapshot.trace.some(
          (event) => event.type === "assistant.render.active"
        ),
        60000,
        "primeiro assistant.render.active",
        "RENDER_ONSET_TIMEOUT"
      );
      result.startSnapshot = result.activeSnapshot;
      result.anchorTraceIndex = result.startSnapshot.trace.findIndex(
        (event) => event.type === "assistant.render.active"
      );
      result.activeMarker = result.startSnapshot.trace[result.anchorTraceIndex];
      result.plannedTriggerAtPerformanceMs =
        result.activeMarker.atMs + ${EXP0025_CONFIG.triggerAfterRenderActiveMs};

      result.phase = "trigger-scheduling";
      result.preTriggerSnapshot = lab.snapshot();
      result.preTriggerActiveMarkers = result.preTriggerSnapshot.trace.filter(
        (event) => event.type === "assistant.render.active"
      );
      if (performance.now() - result.plannedTriggerAtPerformanceMs >
        ${EXP0025_CONFIG.triggerTimerErrorMaxMs}) {
        return fail(
          "CAUSAL_ANCHOR_OBSERVED_TOO_LATE",
          "primeiro render.active observado depois da janela causal"
        );
      }
      await waitUntil(result.plannedTriggerAtPerformanceMs);
      result.preTriggerSnapshot = lab.snapshot();
      result.preTriggerActiveMarkers = result.preTriggerSnapshot.trace.filter(
        (event) => event.type === "assistant.render.active"
      );
      result.triggerAtPerformanceMs = performance.now();
      result.timerErrorMs = result.triggerAtPerformanceMs -
        result.plannedTriggerAtPerformanceMs;
      if (result.timerErrorMs < 0 || result.timerErrorMs >
        ${EXP0025_CONFIG.triggerTimerErrorMaxMs}) {
        return fail(
          "TRIGGER_TIMER_OUT_OF_WINDOW",
          "trigger não respeitou a janela causal de 0 a 10 ms"
        );
      }

      lab.simulateAudioEvent({
        type: "user.speech.started",
        turnId: ${JSON.stringify(turnId)},
        rms: 0.06,
        threshold: 0.025
      });

      result.phase = "stop-markers";
      const markerSnapshot = await waitForSnapshot(
        lab,
        (snapshot) => {
          const paused = snapshot.trace.filter(
            (event) => event.type === "assistant.speech.paused"
          );
          const stopped = snapshot.trace.filter(
            (event) => event.type === "assistant.render.stopped"
          );
          return paused.length >= 1 && stopped.length >= 1;
        },
        30000,
        "marcadores concorrentes de STOP",
        "STOP_MARKERS_TIMEOUT"
      );
      const pausedAtMarkers = markerSnapshot.trace.filter(
        (event) => event.type === "assistant.speech.paused"
      );
      const stoppedAtMarkers = markerSnapshot.trace.filter(
        (event) => event.type === "assistant.render.stopped"
      );
      let latestMarkerAtPerformanceMs = Math.max(
        ...pausedAtMarkers.map((event) => event.atMs),
        ...stoppedAtMarkers.map((event) => event.atMs)
      );
      let latestMarkerSnapshot = markerSnapshot;
      let finalSnapshot = null;

      result.phase = "terminal-horizon";
      while (finalSnapshot === null) {
        await waitUntil(
          latestMarkerAtPerformanceMs +
            ${EXP0025_CONFIG.postStopObservationMs} + 1
        );
        const candidate = lab.snapshot();
        const candidateMarkers = candidate.trace.filter(
          (event) => event.type === "assistant.speech.paused" ||
            event.type === "assistant.render.stopped"
        );
        const candidateLatest = Math.max(
          ...candidateMarkers.map((event) => event.atMs)
        );
        if (candidateLatest > latestMarkerAtPerformanceMs) {
          latestMarkerAtPerformanceMs = candidateLatest;
          latestMarkerSnapshot = candidate;
        } else {
          finalSnapshot = candidate;
        }
      }

      const finalPausedMarkers = finalSnapshot.trace.filter(
        (event) => event.type === "assistant.speech.paused"
      );
      const finalStoppedMarkers = finalSnapshot.trace.filter(
        (event) => event.type === "assistant.render.stopped"
      );
      const latestStopMarkerTraceIndex = Math.max(
        ...finalSnapshot.trace.flatMap((event, index) =>
          event.type === "assistant.speech.paused" ||
            event.type === "assistant.render.stopped"
            ? [index]
            : []
        )
      );

      Object.assign(result, {
        status: ${JSON.stringify(EXP0025_BROWSER_TRIAL_STATUSES.collected)},
        phase: "complete",
        code: null,
        message: null,
        markerEvents: {
          paused: finalPausedMarkers,
          renderStopped: finalStoppedMarkers
        },
        latestMarkerAtPerformanceMs,
        latestStopMarkerTraceIndex,
        markerSnapshotObservedAtMs: latestMarkerSnapshot.observedAtMs,
        renderStopAtMarkers: latestMarkerSnapshot.audio.lastRenderStop,
        finalSnapshotAtPerformanceMs: finalSnapshot.observedAtMs,
        postLatestMarkerHorizonMs:
          finalSnapshot.observedAtMs - latestMarkerAtPerformanceMs,
        newRenderActiveMarkers: finalSnapshot.trace
          .slice(latestStopMarkerTraceIndex + 1)
          .filter((event) => event.type === "assistant.render.active"),
        renderStopUnchanged: JSON.stringify(
          latestMarkerSnapshot.audio.lastRenderStop
        ) === JSON.stringify(finalSnapshot.audio.lastRenderStop),
        finalSnapshot
      });
      return result;
    } catch (error) {
      if (lab && result.preTriggerSnapshot === null) {
        try {
          result.preTriggerSnapshot = lab.snapshot();
          result.preTriggerActiveMarkers =
            result.preTriggerSnapshot.trace?.filter(
              (event) => event.type === "assistant.render.active"
            ) ?? [];
        } catch {
          // Preserva somente os snapshots obtidos antes da falha.
        }
      }
      return fail(
        error?.instrumentCode ?? "BROWSER_TRIAL_UNCAUGHT",
        error?.message ?? error
      );
    }
  })()`;
}

export function validateExp0025BrowserTrialResult(result) {
  const errors = [];
  try {
    if (!exactKeys(result, RESULT_KEYS)) {
      errors.push("resultado possui chaves divergentes");
    }
    if (result?.schemaVersion !== EXP0025_BROWSER_TRIAL_RESULT_SCHEMA) {
      errors.push("schemaVersion divergente");
    }
    if (!Object.values(EXP0025_BROWSER_TRIAL_STATUSES).includes(
      result?.status
    )) errors.push("status divergente");
    if (!PHASES.has(result?.phase)) errors.push("phase divergente");
    if (!positiveInteger(result?.navigationIndex) ||
      !positiveInteger(result?.trialIndex) ||
      result?.turnId !== expectedTurnId(
        result?.navigationIndex,
        result?.trialIndex
      )) errors.push("identidade do trial divergente");
    if (!Array.isArray(result?.preTriggerActiveMarkers) ||
      !Array.isArray(result?.newRenderActiveMarkers) ||
      !plainObject(result?.markerEvents) ||
      !Array.isArray(result?.markerEvents?.paused) ||
      !Array.isArray(result?.markerEvents?.renderStopped)) {
      errors.push("coleções do resultado divergentes");
    }
    if (result?.status === EXP0025_BROWSER_TRIAL_STATUSES.collected) {
      if (result.phase !== "complete" || result.code !== null ||
        result.message !== null || !finite(result.resetAtPerformanceMs) ||
        !snapshotWithTrace(result.resetSnapshot) ||
        !snapshotWithTrace(result.activeSnapshot) ||
        !snapshotWithTrace(result.startSnapshot) ||
        !snapshotWithTrace(result.preTriggerSnapshot) ||
        !snapshotWithTrace(result.finalSnapshot) ||
        !Number.isSafeInteger(result.anchorTraceIndex) ||
        !plainObject(result.activeMarker)) {
        errors.push("resultado COLLECTED incompleto");
      }
    } else if (
      result?.phase === "complete" || !nonEmptyString(result?.code) ||
      !nonEmptyString(result?.message) || result.message.length > 500
    ) {
      errors.push("INSTRUMENT_FAILURE sem causa limitada");
    }
    if (Number.isSafeInteger(result?.anchorTraceIndex) &&
      (!snapshotWithTrace(result?.startSnapshot) ||
        !snapshotWithTrace(result?.preTriggerSnapshot) ||
        !plainObject(result?.activeMarker))) {
      errors.push("falha pós-âncora perdeu snapshots causais");
    }
  } catch (error) {
    errors.push(`resultado malformado: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function validateExp0025CausalRenderOnset(result) {
  const errors = [];
  const shape = validateExp0025BrowserTrialResult(result);
  if (!shape.valid) errors.push(...shape.errors);
  if (result?.status !== EXP0025_BROWSER_TRIAL_STATUSES.collected) {
    errors.push("resultado físico não foi COLLECTED");
    return deepFreeze({ valid: false, errors });
  }
  const startMarkers = activeMarkers(result.startSnapshot);
  const preTriggerMarkers = activeMarkers(result.preTriggerSnapshot);
  const firstIndex = result.startSnapshot?.trace?.findIndex(
    (event) => event?.type === "assistant.render.active"
  );
  if (
    firstIndex < 0 || result.anchorTraceIndex !== firstIndex ||
    !isDeepStrictEqual(
      result.activeMarker,
      result.startSnapshot?.trace?.[firstIndex]
    ) || !isDeepStrictEqual(result.activeMarker, startMarkers[0]) ||
    !isDeepStrictEqual(result.activeMarker, preTriggerMarkers[0])
  ) errors.push("âncora não é o primeiro render.active por posição causal");
  if (!isDeepStrictEqual(
    result.preTriggerActiveMarkers,
    preTriggerMarkers
  )) errors.push("multiplicidade pré-trigger não corresponde ao trace bruto");
  if (!snapshotWithTrace(result.resetSnapshot) ||
    result.resetSnapshot.trace.length !== 0) {
    errors.push("reset não iniciou com trace vazio");
  }
  if (!finite(result.activeMarker?.atMs) ||
    result.plannedTriggerAtPerformanceMs !== result.activeMarker?.atMs +
      EXP0025_CONFIG.triggerAfterRenderActiveMs ||
    !finite(result.triggerAtPerformanceMs) ||
    result.timerErrorMs !== result.triggerAtPerformanceMs -
      result.plannedTriggerAtPerformanceMs ||
    result.timerErrorMs < 0 ||
    result.timerErrorMs > EXP0025_CONFIG.triggerTimerErrorMaxMs) {
    errors.push("trigger diverge da janela causal congelada");
  }
  if (preTriggerMarkers.length < 1 || preTriggerMarkers.some(
    (event) => !finite(event?.atMs) ||
      event.atMs > result.triggerAtPerformanceMs
  )) errors.push("render.active pré-trigger ausente ou posterior ao trigger");
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    activeMarkerCount: preTriggerMarkers.length,
    multiplicityObserved: preTriggerMarkers.length > 1
  });
}

export function validateExp0025TrialCollection(result) {
  const causal = validateExp0025CausalRenderOnset(result);
  const inherited = result?.status === EXP0025_BROWSER_TRIAL_STATUSES.collected
    ? validateExp0020TrialCollection(result)
    : { valid: false, errors: ["resultado físico não foi COLLECTED"] };
  const errors = [...causal.errors, ...inherited.errors];
  return deepFreeze({
    valid: causal.valid && inherited.valid,
    errors,
    causal,
    inherited
  });
}
