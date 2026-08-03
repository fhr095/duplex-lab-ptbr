import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0025_BOUNDARY_PATHS,
  EXP0025_CONFIG
} from "./exp-0025-boundary.mjs";
import {
  EXP0025_JOURNAL_FRAME_TYPES,
  EXP0025_JOURNAL_INSPECTION_STATES,
  serializeExp0025Journal,
  validateExp0025JournalFrame
} from "./exp-0025-journal.mjs";
import {
  EXP0020_ORDER_CLASSES,
  analyzeExp0020Trial,
  median,
  nearestRankP95
} from "./exp-0020-stop-order.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import { measureUsageDelta } from "./runtime-provenance.mjs";
import { validateTrainingTraceBundle } from
  "../../web/training-trace-recorder.mjs";
import {
  EXP0025_BROWSER_TRIAL_STATUSES,
  validateExp0025BrowserTrialResult,
  validateExp0025CausalRenderOnset
} from "../../scripts/lib/exp-0025-browser-trial.mjs";

export { EXP0025_CONFIG };

export const EXP0025_REPORT_SCHEMA =
  "exp-0025-causal-render-onset-physical-stop-report-v1";
export const EXP0025_EXPERIMENT_ID = "EXP-0025";
export const EXP0025_PATHS = EXP0025_BOUNDARY_PATHS;

export const EXP0025_DECISIONS = deepFreeze({
  invalidate: "CUT_RENDER_STOP_INSTRUMENT_LINEAGE",
  holdOnset: "PASS_RENDER_STOP_HOLD_ANCHOR_DELTA_NOT_EXERCISED",
  fix: "FIX_RENDER_STOP_PATH",
  hold: "PASS_RENDER_STOP_HOLD_TELEMETRY_ORDER",
  rejectNormalization: "PASS_RENDER_STOP_REJECT_TELEMETRY_NORMALIZATION",
  pass: "PASS_RENDER_STOP_AND_TELEMETRY_ORDER_EQUIVALENT"
});

export const EXP0025_NEXT_MOVES = deepFreeze({
  [EXP0025_DECISIONS.invalidate]: {
    action: "CUT_RENDER_STOP_INSTRUMENT_LINEAGE",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0025_DECISIONS.holdOnset]: {
    action: "CLOSE_STOP_R_WITHOUT_CLAIMING_ANCHOR_DELTA",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0025_DECISIONS.fix]: {
    action: "ISOLATE_SMALLEST_RENDER_STOP_MECHANISM",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0025_DECISIONS.hold]: {
    action: "CLOSE_STOP_R_AND_HOLD_TELEMETRY_ORDER",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0025_DECISIONS.rejectNormalization]: {
    action: "REJECT_TELEMETRY_ORDER_NORMALIZATION",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0025_DECISIONS.pass]: {
    action: "SELECT_NEXT_USER_PERCEIVED_FULL_DUPLEX_GAP",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  }
});

export const EXP0025_EXECUTION_STATES = deepFreeze({
  fresh: "FRESH",
  recoveryWithoutJournal: "RECOVERY_WITHOUT_JOURNAL",
  recoveryValidJournal: "RECOVERY_VALID_JOURNAL",
  recoveryTruncatedTail: "RECOVERY_TRUNCATED_TAIL"
});

export const EXP0025_BOUNDARY_SUMMARY_KEYS = deepFreeze([
  "executionState",
  "expectedRuntimeFingerprintSha256",
  "failureCode",
  "freezePath",
  "freezeVerified",
  "gitTopologyVerified",
  "journalAppendOnly",
  "journalByteLength",
  "journalFsyncBeforeAck",
  "journalPath",
  "journalSha256",
  "journalVerified",
  "openingPath",
  "openingVerified",
  "receiptConsumedAt",
  "receiptPath",
  "receiptVerified",
  "receiptWriteOnce",
  "recoveryOnly",
  "rerunAllowed",
  "runtimeBindingsVerified",
  "sourceBindingsVerified",
  "workerStartedAt"
]);

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HEX_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const TTS_URL = new URL("/api/tts", EXP0025_CONFIG.targetUrl).href;
const HEALTH_URL = new URL("/api/health", EXP0025_CONFIG.targetUrl).href;
const AUDIT_QUERY_NAME = "exp0022_probe";
const AUDIT_HEADER_VALUE = "audit-health-v0.1";
const EMPTY_SHA256 =
  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const PHYSICAL_GATE_NAMES = Object.freeze([
  "singleLifecycleAndEffect",
  "pauseReceiptBeforeMarkers",
  "terminalStopStable",
  "terminalProjectionEquivalent"
]);
const CORE_INSTRUMENT_GATE_NAMES = Object.freeze([
  "boundaryReconstructed",
  "journalReconstructible",
  "campaignCardinality",
  "environmentStable",
  "typedTrialResults",
  "causalRenderOnset",
  "traceStructural"
]);
const FORBIDDEN_TRACE_TYPES = new Set([
  "assistant.render.stop.error",
  "output-interruption.invariant.error",
  "training-trace.decision.error",
  "training-trace.effect.error"
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

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeHash(value) {
  if (typeof value !== "string") return null;
  const candidate = value.toLowerCase();
  if (HASH_PATTERN.test(candidate)) return candidate;
  return HEX_HASH_PATTERN.test(candidate) ? `sha256:${candidate}` : null;
}

function sha256Utf8(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function framePayloads(frames, type) {
  return frames
    .filter((frame) => frame?.type === type)
    .map((frame) => ({ frame, payload: frame.payload }));
}

function oneFrame(frames, type) {
  const matching = framePayloads(frames, type);
  return matching.length === 1 ? matching[0] : null;
}

function expectedTrialId(navigationIndex, trialIndex) {
  return `exp0020-nav-${navigationIndex}-trial-${trialIndex}`;
}

function trialKey(navigationIndex, trialIndex) {
  return `${navigationIndex}:${trialIndex}`;
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    const target = new URL(EXP0025_CONFIG.targetUrl);
    if (["about:", "data:"].includes(url.protocol)) return true;
    if (url.protocol === "blob:") return url.origin === target.origin;
    if (!["http:", "ws:"].includes(url.protocol)) return false;
    const port = url.port || "80";
    const targetPort = target.port || "80";
    return ["localhost", "127.0.0.1"].includes(url.hostname) &&
      port === targetPort;
  } catch {
    return false;
  }
}

function isTtsUrl(value) {
  try {
    return new URL(value).href === TTS_URL;
  } catch {
    return false;
  }
}

function isHealthUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === new URL(EXP0025_CONFIG.targetUrl).origin &&
      url.pathname === "/api/health";
  } catch {
    return false;
  }
}

function journalInspection(journal) {
  const frames = Array.isArray(journal?.frames) ? journal.frames : [];
  let serialized = null;
  let serializable = false;
  try {
    serialized = serializeExp0025Journal(frames);
    serializable = true;
  } catch {
    // A invalidação é materializada abaixo sem interpretar prefixos parciais.
  }
  const frameSchemasValid = frames.every((frame, index) =>
    validateExp0025JournalFrame(frame, {
      expectedOrdinal: index + 1
    }).valid
  );
  const expectedByteLength = serialized === null
    ? null
    : Buffer.byteLength(serialized);
  const expectedSha256 = serialized === null ? null : sha256Utf8(serialized);
  const exactShape = exactKeys(journal, [
    "byteLength",
    "completeFrameCount",
    "errors",
    "frames",
    "nextOrdinal",
    "sha256",
    "status",
    "tailByteLength",
    "tailSha256",
    "valid"
  ]);
  const valid = exactShape &&
    journal.status === EXP0025_JOURNAL_INSPECTION_STATES.valid &&
    journal.valid === true &&
    Array.isArray(journal.errors) && journal.errors.length === 0 &&
    journal.tailByteLength === 0 &&
    journal.tailSha256 === sha256Utf8("") &&
    journal.completeFrameCount === frames.length &&
    journal.nextOrdinal === frames.length + 1 &&
    serializable && frameSchemasValid &&
    journal.byteLength === expectedByteLength &&
    journal.sha256 === expectedSha256;
  return {
    valid,
    frames,
    expectedByteLength,
    expectedSha256
  };
}

function journalSequenceValid(frames) {
  const T = EXP0025_JOURNAL_FRAME_TYPES;
  const inProgress = oneFrame(frames, T.inProgress);
  const worker = oneFrame(frames, T.workerStarted);
  const browser = oneFrame(frames, T.browserBound);
  const outcome = oneFrame(frames, T.workerOutcome);
  const starts = framePayloads(frames, T.navigationStarted);
  const completed = framePayloads(frames, T.navigationCompleted);
  if (
    !inProgress || !worker || !browser || !outcome ||
    starts.length !== EXP0025_CONFIG.navigations ||
    completed.length !== EXP0025_CONFIG.navigations ||
    frames[0] !== inProgress.frame || frames[1] !== worker.frame ||
    frames.at(-1) !== outcome.frame ||
    inProgress.payload.deadlineMs !== EXP0025_CONFIG.attemptDeadlineMs ||
    inProgress.payload.opening?.path !== EXP0025_PATHS.opening ||
    Date.parse(worker.payload.startedAt) >
      Date.parse(outcome.payload.completedAt)
  ) return false;

  if (!(worker.frame.ordinal < browser.frame.ordinal &&
    browser.frame.ordinal < outcome.frame.ordinal)) return false;

  for (let index = 1; index <= EXP0025_CONFIG.navigations; index += 1) {
    const start = starts.filter(({ payload }) =>
      payload.navigationIndex === index);
    const finish = completed.filter(({ payload }) =>
      payload.navigationIndex === index);
    const trials = framePayloads(frames, T.physicalTrialResult).filter(
      ({ payload }) => payload.navigationIndex === index
    );
    if (
      start.length !== 1 || finish.length !== 1 ||
      start[0].payload.targetUrl !== EXP0025_CONFIG.targetUrl ||
      !(browser.frame.ordinal < start[0].frame.ordinal &&
        start[0].frame.ordinal < finish[0].frame.ordinal &&
        finish[0].frame.ordinal < outcome.frame.ordinal) ||
      trials.some(({ frame }) => !(
        start[0].frame.ordinal < frame.ordinal &&
        frame.ordinal < finish[0].frame.ordinal
      ))
    ) return false;
    if (index > 1) {
      const previous = completed.find(({ payload }) =>
        payload.navigationIndex === index - 1);
      if (!(previous.frame.ordinal < start[0].frame.ordinal)) return false;
    }
  }
  return true;
}

function boundaryValid(boundary, journalState, frames) {
  const worker = oneFrame(
    frames,
    EXP0025_JOURNAL_FRAME_TYPES.workerStarted
  );
  return exactKeys(boundary, EXP0025_BOUNDARY_SUMMARY_KEYS) &&
    boundary.freezePath === EXP0025_PATHS.freeze &&
    boundary.openingPath === EXP0025_PATHS.opening &&
    boundary.receiptPath === EXP0025_PATHS.receipt &&
    boundary.journalPath === EXP0025_PATHS.journal &&
    boundary.freezeVerified === true &&
    boundary.openingVerified === true &&
    boundary.receiptVerified === true &&
    boundary.receiptWriteOnce === true &&
    boundary.journalVerified === true &&
    boundary.journalAppendOnly === true &&
    boundary.journalFsyncBeforeAck === true &&
    boundary.sourceBindingsVerified === true &&
    boundary.runtimeBindingsVerified === true &&
    boundary.gitTopologyVerified === true &&
    boundary.executionState === EXP0025_EXECUTION_STATES.fresh &&
    boundary.recoveryOnly === false && boundary.failureCode === null &&
    boundary.rerunAllowed === false &&
    validDate(boundary.receiptConsumedAt) &&
    validDate(boundary.workerStartedAt) &&
    Date.parse(boundary.receiptConsumedAt) <=
      Date.parse(boundary.workerStartedAt) &&
    worker?.payload?.startedAt === boundary.workerStartedAt &&
    normalizeHash(boundary.expectedRuntimeFingerprintSha256) !== null &&
    boundary.journalSha256 === journalState.expectedSha256 &&
    boundary.journalByteLength === journalState.expectedByteLength &&
    journalState.valid;
}

function eventOrdinal(entry) {
  const T = EXP0025_JOURNAL_FRAME_TYPES;
  if (entry.frame.type === T.networkRequest) {
    return entry.payload.requestOrdinal;
  }
  if (entry.frame.type === T.networkResponse) {
    return entry.payload.responseOrdinal;
  }
  return entry.payload.terminalOrdinal;
}

function networkGroups(frames) {
  const T = EXP0025_JOURNAL_FRAME_TYPES;
  const networkTypes = new Set([
    T.networkRequest,
    T.networkResponse,
    T.networkTerminal,
    T.networkFailure
  ]);
  const entries = frames
    .filter((frame) => networkTypes.has(frame?.type))
    .map((frame) => ({ frame, payload: frame.payload }));
  const groups = new Map();
  for (const entry of entries) {
    const requestId = entry.payload?.requestId;
    if (!groups.has(requestId)) {
      groups.set(requestId, {
        requestId,
        requests: [],
        responses: [],
        terminals: [],
        failures: []
      });
    }
    const group = groups.get(requestId);
    if (entry.frame.type === T.networkRequest) group.requests.push(entry);
    if (entry.frame.type === T.networkResponse) group.responses.push(entry);
    if (entry.frame.type === T.networkTerminal) group.terminals.push(entry);
    if (entry.frame.type === T.networkFailure) group.failures.push(entry);
  }
  return { entries, groups: [...groups.values()] };
}

function completeNetworkGroup(group) {
  if (
    !nonEmptyString(group.requestId) || group.requests.length !== 1 ||
    group.responses.length !== 1 || group.terminals.length !== 1 ||
    group.failures.length !== 0
  ) return false;
  const request = group.requests[0].payload;
  const response = group.responses[0].payload;
  const terminal = group.terminals[0].payload;
  return request.navigationIndex === response.navigationIndex &&
    request.navigationIndex === terminal.navigationIndex &&
    request.trialId === response.trialId &&
    request.trialId === terminal.trialId &&
    request.url === response.url &&
    request.frameId === response.frameId &&
    request.loaderId === response.loaderId &&
    positiveInteger(request.requestOrdinal) &&
    positiveInteger(response.responseOrdinal) &&
    positiveInteger(terminal.terminalOrdinal) &&
    request.requestOrdinal < response.responseOrdinal &&
    response.responseOrdinal < terminal.terminalOrdinal &&
    group.requests[0].frame.ordinal < group.responses[0].frame.ordinal &&
    group.responses[0].frame.ordinal < group.terminals[0].frame.ordinal &&
    finite(request.timestamp) && finite(response.timestamp) &&
    finite(terminal.timestamp) &&
    request.timestamp <= response.timestamp &&
    request.timestamp <= terminal.timestamp;
}

function expectedAuditUrl(navigationIndex) {
  const url = new URL(HEALTH_URL);
  url.searchParams.set(AUDIT_QUERY_NAME, `nav-${navigationIndex}`);
  return url.href;
}

function ttsProtocolValid(group) {
  const request = group.requests[0]?.payload;
  const response = group.responses[0]?.payload;
  const terminal = group.terminals[0]?.payload;
  return completeNetworkGroup(group) &&
    isTtsUrl(request?.url) && request.method === "POST" &&
    isDeepStrictEqual(request.postData, { text: EXP0025_CONFIG.phrase }) &&
    request.redirected !== true &&
    response.url === TTS_URL && response.status === 200 &&
    response.mimeType === "audio/wav" &&
    response.fromDiskCache !== true &&
    response.fromServiceWorker !== true &&
    finite(terminal.encodedDataLength) &&
    terminal.encodedDataLength > 44 &&
    terminal.encodedDataLength <
      EXP0025_CONFIG.networkEnable.maxResourceBufferSize;
}

function healthProtocolValid(group) {
  const request = group.requests[0]?.payload;
  const response = group.responses[0]?.payload;
  return completeNetworkGroup(group) && isHealthUrl(request?.url) &&
    request.method === "GET" && request.postData === null &&
    request.trialId === null && response.status === 200 &&
    response.mimeType === "application/json";
}

function analyzeNetwork(frames) {
  const { entries, groups } = networkGroups(frames);
  const eventOrdinals = entries.map(eventOrdinal);
  const ordinalLedgerUnique = entries.length > 0 &&
    eventOrdinals.every(positiveInteger) &&
    new Set(eventOrdinals).size === eventOrdinals.length;
  const ordinalStreamIncreasing = eventOrdinals.every(
    (ordinal, index) => index === 0 || eventOrdinals[index - 1] < ordinal
  );
  const lifecycleValid = groups.length > 0 &&
    groups.every(completeNetworkGroup);
  const ranges = Array.from(
    { length: EXP0025_CONFIG.navigations },
    (_, offset) => {
      const ordinals = entries
        .filter(({ payload }) => payload.navigationIndex === offset + 1)
        .map(eventOrdinal)
        .filter(positiveInteger);
      return ordinals.length === 0
        ? null
        : { minimum: Math.min(...ordinals), maximum: Math.max(...ordinals) };
    }
  );
  const navigationRangesSerial = ranges.every((range) => range !== null) &&
    ranges.every((range, index) => index === 0 ||
      ranges[index - 1].maximum < range.minimum);
  const localOnly = groups.every((group) =>
    group.requests.length === 1 && isLocalUrl(group.requests[0].payload.url));
  const ttsGroups = groups.filter((group) =>
    isTtsUrl(group.requests[0]?.payload?.url));
  const healthGroups = groups.filter((group) =>
    isHealthUrl(group.requests[0]?.payload?.url));
  const ttsProtocol = ttsGroups.length === EXP0025_CONFIG.totalStops &&
    ttsGroups.every(ttsProtocolValid);
  let healthProtocol = healthGroups.length ===
    EXP0025_CONFIG.navigations * 2 && healthGroups.every(healthProtocolValid);
  const audits = framePayloads(
    frames,
    EXP0025_JOURNAL_FRAME_TYPES.navigationAudited
  );
  for (let navigationIndex = 1;
    navigationIndex <= EXP0025_CONFIG.navigations;
    navigationIndex += 1) {
    const auditFrames = audits.filter(({ payload }) =>
      payload.navigationIndex === navigationIndex);
    const scopedHealth = healthGroups.filter((group) =>
      group.requests[0]?.payload?.navigationIndex === navigationIndex);
    const scopedTts = ttsGroups.filter((group) =>
      group.requests[0]?.payload?.navigationIndex === navigationIndex);
    if (
      auditFrames.length !== 1 || scopedHealth.length !== 2 ||
      scopedTts.length !== EXP0025_CONFIG.stopsPerNavigation
    ) {
      healthProtocol = false;
      continue;
    }
    const audit = auditFrames[0].payload;
    const bootstrap = scopedHealth.find((group) =>
      group.requestId === audit.bootstrapRequestId);
    const explicitAudit = scopedHealth.find((group) =>
      group.requestId === audit.auditRequestId);
    const firstTtsOrdinal = Math.min(...scopedTts.map((group) =>
      group.requests[0].payload.requestOrdinal));
    const bootstrapRequest = bootstrap?.requests[0]?.payload;
    const explicitRequest = explicitAudit?.requests[0]?.payload;
    const bootstrapTerminal = bootstrap?.terminals[0]?.payload;
    const explicitTerminal = explicitAudit?.terminals[0]?.payload;
    healthProtocol &&= Boolean(
      bootstrap && explicitAudit && bootstrap !== explicitAudit &&
      bootstrapRequest.url === HEALTH_URL &&
      explicitRequest.url === expectedAuditUrl(navigationIndex) &&
      ("auditProbeHeader" in bootstrapRequest
        ? bootstrapRequest.auditProbeHeader === null &&
          explicitRequest.auditProbeHeader === AUDIT_HEADER_VALUE
        : true) &&
      audit.probeId === `nav-${navigationIndex}` &&
      audit.frameId === bootstrapRequest.frameId &&
      audit.frameId === explicitRequest.frameId &&
      audit.loaderId === bootstrapRequest.loaderId &&
      audit.loaderId === explicitRequest.loaderId &&
      bootstrapTerminal.terminalOrdinal < explicitRequest.requestOrdinal &&
      explicitTerminal.terminalOrdinal < firstTtsOrdinal &&
      scopedTts.every((group) =>
        group.requests[0].payload.frameId === audit.frameId &&
        group.requests[0].payload.loaderId === audit.loaderId)
    );
  }
  const orderedTts = [...ttsGroups].sort((left, right) =>
    left.requests[0].payload.requestOrdinal -
      right.requests[0].payload.requestOrdinal);
  const ttsSerial = orderedTts.length === EXP0025_CONFIG.totalStops &&
    orderedTts.every((group, index) => index === 0 ||
      orderedTts[index - 1].terminals[0].payload.terminalOrdinal <
        group.requests[0].payload.requestOrdinal) &&
    isDeepStrictEqual(
      orderedTts.map((group) => group.requests[0].payload.trialId),
      Array.from(
        { length: EXP0025_CONFIG.totalStops },
        (_, index) => expectedTrialId(
          Math.floor(index / EXP0025_CONFIG.stopsPerNavigation) + 1,
          index % EXP0025_CONFIG.stopsPerNavigation + 1
        )
      )
    );
  const nonTtsTrialIdsNull = groups.every((group) =>
    isTtsUrl(group.requests[0]?.payload?.url) ||
      group.requests[0]?.payload?.trialId === null);
  return {
    valid: ordinalLedgerUnique && ordinalStreamIncreasing && lifecycleValid &&
      navigationRangesSerial && ttsProtocol && healthProtocol && ttsSerial &&
      nonTtsTrialIdsNull,
    localOnly,
    groups,
    ttsGroups,
    healthGroups,
    eventOrdinalCount: eventOrdinals.length,
    responseAfterTerminalCount: groups.filter((group) =>
      completeNetworkGroup(group) &&
      group.responses[0].payload.timestamp >
        group.terminals[0].payload.timestamp).length
  };
}

function normalizePhysicalTrial(payload) {
  if (!plainObject(payload?.trial)) return payload?.trial;
  const raw = structuredClone(payload.trial);
  return {
    ...raw,
    navigationIndex: payload.navigationIndex,
    trialIndex: payload.trialIndex,
    turnId: payload.turnId,
    timing: raw.timing ?? {
      renderActiveAtMs: raw.activeMarker?.atMs ?? null,
      plannedTriggerAtMs: raw.plannedTriggerAtPerformanceMs ?? null,
      actualTriggerAtMs: raw.triggerAtPerformanceMs ?? null,
      timerErrorMs: raw.timerErrorMs ?? null,
      latestStopMarkerAtMs: raw.latestMarkerAtPerformanceMs ?? null,
      postStopObservedAtMs: raw.finalSnapshotAtPerformanceMs ?? null,
      postLatestMarkerHorizonMs: raw.postLatestMarkerHorizonMs ?? null
    }
  };
}

function inheritedPhysicalProjection(trial) {
  const projected = structuredClone(trial);
  if (plainObject(projected?.startSnapshot) &&
    plainObject(projected?.activeMarker)) {
    projected.startSnapshot.trace = [structuredClone(projected.activeMarker)];
  }
  return projected;
}

function traceReferencesUseTrial(trial, turnId) {
  const trace = trial?.finalSnapshot?.trace;
  if (!Array.isArray(trace)) return false;
  for (const event of trace) {
    if (event?.type !== "output-interruption.transition") continue;
    let detail;
    try {
      detail = JSON.parse(event.detail);
    } catch {
      return false;
    }
    if (
      detail?.turnId !== turnId ||
      detail?.event?.turnId !== turnId
    ) return false;
  }
  const lifecycle = trial?.finalSnapshot?.audio
    ?.outputInterruptionLifecycle;
  if (lifecycle?.turnId !== undefined && lifecycle.turnId !== turnId) {
    return false;
  }
  const trainingTrace = trial?.finalSnapshot?.trainingTrace;
  for (const collection of ["events", "contexts", "decisions"]) {
    for (const record of trainingTrace?.[collection] ?? []) {
      if (record?.turnId !== undefined && record.turnId !== turnId) {
        return false;
      }
    }
  }
  return true;
}

function controlledTimingValid(trial, analysis) {
  const timing = trial?.timing;
  const markerTimes = analysis?.evidence?.markerAtMs;
  const offset = analysis?.metrics?.triggerOffsetMs;
  const error = analysis?.metrics?.triggerTimerErrorMs;
  return finite(timing?.renderActiveAtMs) &&
    finite(timing?.plannedTriggerAtMs) &&
    finite(timing?.actualTriggerAtMs) &&
    timing.plannedTriggerAtMs === timing.renderActiveAtMs +
      EXP0025_CONFIG.triggerAfterRenderActiveMs &&
    finite(offset) &&
    offset >= EXP0025_CONFIG.triggerAfterRenderActiveMs &&
    offset <= EXP0025_CONFIG.triggerAfterRenderActiveMs +
      EXP0025_CONFIG.triggerTimerErrorMaxMs + 0.02 &&
    finite(error) && error >= 0 &&
    error <= EXP0025_CONFIG.triggerTimerErrorMaxMs &&
    timing.timerErrorMs === error &&
    Array.isArray(markerTimes) && markerTimes.length === 2 &&
    markerTimes.every((atMs) =>
      finite(atMs) && atMs >= timing.actualTriggerAtMs);
}

function traceStructuralValid(record, trial, analysis, causal) {
  const expectedId = expectedTrialId(
    record?.payload?.navigationIndex,
    record?.payload?.trialIndex
  );
  const trace = trial?.finalSnapshot?.trace;
  const traceValidation = validateTrainingTraceBundle(
    trial?.finalSnapshot?.trainingTrace
  );
  return record?.payload?.trialId === expectedId &&
    record?.payload?.turnId === expectedId &&
    trial?.navigationIndex === record.payload.navigationIndex &&
    trial?.trialIndex === record.payload.trialIndex &&
    trial?.turnId === expectedId &&
    record?.payload?.trial?.status ===
      EXP0025_BROWSER_TRIAL_STATUSES.collected &&
    causal?.valid === true &&
    traceReferencesUseTrial(trial, expectedId) &&
    traceValidation.valid === true &&
    Array.isArray(trace) && trace.every((event) =>
      !FORBIDDEN_TRACE_TYPES.has(event?.type)) &&
    analysis.gates.markersCollected === true &&
    analysis.order !== null &&
    analysis.gates.startActive === true &&
    controlledTimingValid(trial, analysis) &&
    analysis.gates.collectionWindowValid === true;
}

function reconstructTrials(frames, network) {
  const T = EXP0025_JOURNAL_FRAME_TYPES;
  const physical = framePayloads(frames, T.physicalTrialResult);
  const captures = framePayloads(frames, T.captureCompleted);
  const reconstructed = [];
  let bindingValid = physical.length === EXP0025_CONFIG.totalStops;
  const physicalKeys = new Set();
  for (let navigationIndex = 1;
    navigationIndex <= EXP0025_CONFIG.navigations;
    navigationIndex += 1) {
    for (let trialIndex = 1;
      trialIndex <= EXP0025_CONFIG.stopsPerNavigation;
      trialIndex += 1) {
      const key = trialKey(navigationIndex, trialIndex);
      const id = expectedTrialId(navigationIndex, trialIndex);
      const physicalMatches = physical.filter(({ payload }) =>
        trialKey(payload.navigationIndex, payload.trialIndex) === key);
      const captureMatches = captures.filter(({ payload }) =>
        trialKey(payload.navigationIndex, payload.trialIndex) === key);
      const ttsMatches = network.ttsGroups.filter((group) =>
        group.requests[0]?.payload?.trialId === id);
      if (physicalMatches.length !== 1) {
        bindingValid = false;
        continue;
      }
      const physicalRecord = physicalMatches[0];
      const captureRecord = captureMatches.length === 1
        ? captureMatches[0]
        : null;
      const tts = ttsMatches.length === 1 ? ttsMatches[0] : null;
      const requestId = physicalRecord.payload.requestId;
      const identityValid = physicalRecord.payload.trialId === id &&
        physicalRecord.payload.turnId === id &&
        validDate(physicalRecord.payload.completedAt);
      bindingValid &&= identityValid;
      physicalKeys.add(key);
      const rawTrial = physicalRecord.payload.trial;
      const trial = normalizePhysicalTrial(physicalRecord.payload);
      const resultValidation = validateExp0025BrowserTrialResult(rawTrial);
      const causal = validateExp0025CausalRenderOnset(rawTrial);
      reconstructed.push({
        key,
        id,
        requestId,
        physicalRecord,
        captureRecord,
        tts,
        rawTrial,
        trial,
        resultValidation,
        causal,
        analysis: analyzeExp0020Trial(inheritedPhysicalProjection(trial))
      });
    }
  }
  bindingValid &&=
    reconstructed.length === EXP0025_CONFIG.totalStops &&
    physicalKeys.size === EXP0025_CONFIG.totalStops;
  for (let index = 1; index < reconstructed.length; index += 1) {
    bindingValid &&=
      reconstructed[index - 1].physicalRecord.frame.ordinal <
        reconstructed[index].physicalRecord.frame.ordinal;
  }
  return { physical, captures, reconstructed, bindingValid };
}

function captureQualified(reconstruction) {
  const delays = EXP0025_CONFIG.responseBodyRetryDelaysMs;
  if (reconstruction.captures.length === 0) return null;
  if (reconstruction.captures.length !== EXP0025_CONFIG.totalStops) {
    return false;
  }
  return reconstruction.reconstructed.length === EXP0025_CONFIG.totalStops &&
    reconstruction.reconstructed.every(({ captureRecord }) => {
      if (captureRecord === null) return false;
      const capture = captureRecord.payload;
      const expectedWait = positiveInteger(capture?.readCount)
        ? delays.slice(0, capture.readCount).reduce(
          (sum, delay) => sum + delay,
          0
        )
        : null;
      return capture?.status === "qualified" && capture.code === null &&
        capture.readCount >= 1 && capture.readCount <= delays.length &&
        capture.accumulatedWaitMs === expectedWait &&
        capture.sha256 === EXP0025_CONFIG.expectedWavSha256 &&
        capture.byteLength === EXP0025_CONFIG.expectedWavByteLength;
    });
}

function campaignCardinalityValid(frames, reconstruction) {
  const T = EXP0025_JOURNAL_FRAME_TYPES;
  const starts = framePayloads(frames, T.navigationStarted);
  const completed = framePayloads(frames, T.navigationCompleted);
  return starts.length === EXP0025_CONFIG.navigations &&
    completed.length === EXP0025_CONFIG.navigations &&
    reconstruction.physical.length === EXP0025_CONFIG.totalStops &&
    reconstruction.reconstructed.length === EXP0025_CONFIG.totalStops &&
    reconstruction.bindingValid;
}

function healthIdentity(health) {
  const fingerprint = normalizeHash(
    health?.process?.runtimeFingerprint?.sha256
  );
  if (
    !nonEmptyString(health?.process?.runId) || fingerprint === null ||
    !nonEmptyString(health?.tts?.voice) ||
    !nonEmptyString(health?.tts?.culture)
  ) return null;
  return {
    runId: health.process.runId,
    runtimeFingerprintSha256: fingerprint,
    brain: health.brain,
    asrState: health?.asr?.state,
    vadControlEngine: health?.vadControl?.engine,
    vadControlState: health?.vadControl?.state,
    vadShadowState: health?.vadShadow?.state,
    ttsState: health?.tts?.state,
    ttsEngine: health?.tts?.engine,
    ttsVoice: health.tts.voice,
    ttsCulture: health.tts.culture
  };
}

function environmentValid(frames, boundary) {
  const T = EXP0025_JOURNAL_FRAME_TYPES;
  const before = oneFrame(frames, T.healthBefore)?.payload?.health;
  const after = oneFrame(frames, T.healthAfter)?.payload?.health;
  const browser = oneFrame(frames, T.browserBound)?.payload?.browser;
  const auditHealth = framePayloads(frames, T.navigationAudited).map(
    ({ payload }) => payload.health
  );
  try {
    const expectedFingerprint = normalizeHash(
      boundary?.expectedRuntimeFingerprintSha256
    );
    const healthCollected = before !== undefined || after !== undefined ||
      auditHealth.length > 0;
    const healthPairValid = !healthCollected || (
      before !== undefined && after !== undefined &&
      healthIdentity(before) !== null &&
      isDeepStrictEqual(healthIdentity(before), healthIdentity(after)) &&
      auditHealth.every((health) =>
        isDeepStrictEqual(healthIdentity(health), healthIdentity(before)))
    );
    const delta = before !== undefined && after !== undefined
      ? measureUsageDelta(before, after)
      : null;
    const valid = expectedFingerprint !== null &&
      browser?.product === EXP0025_CONFIG.chrome.product &&
      browser?.protocolVersion === EXP0025_CONFIG.chrome.protocolVersion;
    return { valid, delta, healthCollected, healthPairValid };
  } catch (error) {
    return { valid: false, delta: null, error: error.message };
  }
}

function budgetValid(frames, network) {
  const T = EXP0025_JOURNAL_FRAME_TYPES;
  const budget = oneFrame(frames, T.budgetInputs)?.payload?.inputs;
  const before = oneFrame(frames, T.healthBefore)?.payload?.health;
  const after = oneFrame(frames, T.healthAfter)?.payload?.health;
  return exactKeys(budget, [
    "declared",
    "healthAfter",
    "healthBefore",
    "navigationAudits",
    "navigationSnapshots",
    "networkRequests"
  ]) && isDeepStrictEqual(budget.healthBefore, before) &&
    isDeepStrictEqual(budget.healthAfter, after) &&
    Array.isArray(budget.navigationAudits) &&
    budget.navigationAudits.length === EXP0025_CONFIG.navigations &&
    Array.isArray(budget.navigationSnapshots) &&
    budget.navigationSnapshots.length === EXP0025_CONFIG.navigations &&
    Array.isArray(budget.networkRequests) &&
    budget.networkRequests.length === network.groups.length &&
    isDeepStrictEqual(
      budget.networkRequests.map((request) => request?.requestId).toSorted(),
      network.groups.map((group) => group.requestId).toSorted()
    ) &&
    isDeepStrictEqual(budget.declared, {
      gpuRuns: EXP0025_CONFIG.gpuRuns,
      challengerRuns: 0,
      backboneRuns: 0,
      canProduceNewAuthority: false
    });
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

function renderOnsetMetrics(reconstructed) {
  const activeMarkerCounts = reconstructed.map(
    (entry) => entry.causal?.activeMarkerCount
  ).filter((value) => Number.isSafeInteger(value) && value >= 0);
  return {
    resultCount: reconstructed.length,
    collectedCount: reconstructed.filter((entry) =>
      entry.rawTrial?.status === EXP0025_BROWSER_TRIAL_STATUSES.collected
    ).length,
    instrumentFailureCount: reconstructed.filter((entry) =>
      entry.rawTrial?.status ===
        EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure
    ).length,
    activeMarkerCount: distribution(activeMarkerCounts),
    multiplicityTrialCount: activeMarkerCounts.filter((count) => count > 1)
      .length,
    failures: reconstructed.flatMap((entry) =>
      entry.rawTrial?.status ===
        EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure
        ? [{
            trialId: entry.id,
            phase: entry.rawTrial.phase,
            code: entry.rawTrial.code
          }]
        : [])
  };
}

function evaluatedMetrics(reconstructed, usageDelta, network) {
  const analyses = reconstructed.map((entry) => entry.analysis);
  const classes = Object.fromEntries(
    Object.values(EXP0020_ORDER_CLASSES).map((order) => {
      const values = analyses
        .filter((analysis) => analysis.order === order)
        .map((analysis) => analysis.metrics.renderStopLatencyMs)
        .filter(finite);
      return [order, distribution(values)];
    })
  );
  const diversity = Object.values(classes).every((stats) =>
    stats.count >= EXP0025_CONFIG.classMinimumCount);
  const classMedianDeltaMs = diversity
    ? Math.abs(
      classes.PAUSE_THEN_RENDER.median -
        classes.RENDER_THEN_PAUSE.median
    )
    : null;
  const classP95DeltaMs = diversity
    ? Math.abs(
      classes.PAUSE_THEN_RENDER.p95 -
        classes.RENDER_THEN_PAUSE.p95
    )
    : null;
  return {
    renderOnset: renderOnsetMetrics(reconstructed),
    classes,
    aggregate: {
      renderStopLatencyMs: distribution(analyses.map((analysis) =>
        analysis.metrics.renderStopLatencyMs).filter(finite)),
      markerGapMs: distribution(analyses.map((analysis) =>
        analysis.metrics.markerGapMs).filter(finite))
    },
    classMedianDeltaMs,
    classP95DeltaMs,
    usageDelta,
    network: {
      requestCount: network.groups.length,
      ttsRequestCount: network.ttsGroups.length,
      healthRequestCount: network.healthGroups.length,
      recordedEventOrdinals: network.eventOrdinalCount,
      responseAfterTerminalCount: network.responseAfterTerminalCount
    }
  };
}

export function analyzeExp0025Campaign(campaign) {
  const outerShapeValid = exactKeys(campaign, ["boundary", "journal"]);
  const journalState = journalInspection(campaign?.journal);
  const frames = journalState.frames;
  const sequenceValid = journalSequenceValid(frames);
  const network = analyzeNetwork(frames);
  const reconstruction = reconstructTrials(frames, network);
  const environment = environmentValid(frames, campaign?.boundary);
  const cardinality = campaignCardinalityValid(frames, reconstruction);
  const tracesStructural = cardinality &&
    reconstruction.reconstructed.every((entry) =>
      traceStructuralValid(
        entry.physicalRecord,
        entry.trial,
        entry.analysis,
        entry.causal
      ));
  const typedTrialResults = cardinality &&
    reconstruction.reconstructed.every((entry) =>
      entry.resultValidation.valid);
  const causalRenderOnset = typedTrialResults &&
    reconstruction.reconstructed.every((entry) => entry.causal.valid);
  const renderOnsetDeltaExercised = causalRenderOnset &&
    reconstruction.reconstructed.some((entry) =>
      entry.causal.multiplicityObserved === true);
  const diagnostics = framePayloads(
    frames,
    EXP0025_JOURNAL_FRAME_TYPES.diagnostic
  );
  const coreInstrumentGates = {
    boundaryReconstructed: outerShapeValid && boundaryValid(
      campaign?.boundary,
      journalState,
      frames
    ),
    journalReconstructible: journalState.valid && sequenceValid,
    campaignCardinality: cardinality,
    environmentStable: environment.valid,
    typedTrialResults,
    causalRenderOnset,
    traceStructural: tracesStructural
  };
  const captureStatus = captureQualified(reconstruction);
  const networkCollected = network.groups.length > 0;
  const budgetCollected = oneFrame(
    frames,
    EXP0025_JOURNAL_FRAME_TYPES.budgetInputs
  ) !== null;
  const workerOutcome = oneFrame(
    frames,
    EXP0025_JOURNAL_FRAME_TYPES.workerOutcome
  )?.payload;
  const workerOutcomeClean = workerOutcome?.status === "completed" &&
    workerOutcome?.code === null && workerOutcome?.exitCode === 0 &&
    workerOutcome?.signal === null &&
    workerOutcome?.outcome?.kind === "campaign-completed" &&
    workerOutcome?.outcome?.protocolError === null &&
    workerOutcome?.outcome?.recordCount === frames.length - 3 &&
    workerOutcome?.outcome?.stderrByteLength === 0 &&
    workerOutcome?.outcome?.stderrSha256 === EMPTY_SHA256 &&
    workerOutcome?.outcome?.stderrTruncated === false;
  const provenanceDiagnostics = {
    health: environment.healthCollected
      ? (environment.healthPairValid ? "PASS" : "FAIL")
      : "NOT_COLLECTED",
    networkLedger: networkCollected
      ? (network.valid ? "PASS" : "FAIL")
      : "NOT_COLLECTED",
    wavCapture: captureStatus === null
      ? "NOT_COLLECTED"
      : (captureStatus ? "PASS" : "FAIL"),
    runtimeBudget: budgetCollected
      ? (diagnostics.length === 0 && network.localOnly &&
          budgetValid(frames, network) ? "PASS" : "FAIL")
      : "NOT_COLLECTED",
    workerOutcome: workerOutcome === undefined
      ? "NOT_COLLECTED"
      : (workerOutcomeClean ? "PASS" : "FAIL"),
    diagnosticCount: diagnostics.length
  };
  const instrumentValid = CORE_INSTRUMENT_GATE_NAMES.every((name) =>
    coreInstrumentGates[name] === true);
  const analyses = reconstruction.reconstructed.map((entry) => entry.analysis);
  const projectionHashes = analyses.map((analysis) =>
    analysis.projectionSha256);
  const evaluated = instrumentValid;
  const metrics = evaluated
    ? evaluatedMetrics(
      reconstruction.reconstructed,
      environment.delta,
      network
    )
    : {
        renderOnset: renderOnsetMetrics(reconstruction.reconstructed),
        classes: null,
        aggregate: null,
        classMedianDeltaMs: null,
        classP95DeltaMs: null,
        usageDelta: environment.delta,
        network: {
          requestCount: network.groups.length,
          ttsRequestCount: network.ttsGroups.length,
          healthRequestCount: network.healthGroups.length,
          recordedEventOrdinals: network.eventOrdinalCount,
          responseAfterTerminalCount: network.responseAfterTerminalCount
        }
      };
  const physicalGates = evaluated
    ? {
        singleLifecycleAndEffect: analyses.every((analysis) =>
          analysis.gates.singleLifecycleAndEffect &&
          analysis.gates.controlledPhase),
        pauseReceiptBeforeMarkers: analyses.every((analysis) =>
          analysis.gates.pauseReceiptBeforeMarkers),
        terminalStopStable: analyses.every((analysis) =>
          analysis.gates.terminalStopStable),
        terminalProjectionEquivalent:
          projectionHashes.length === EXP0025_CONFIG.totalStops &&
          projectionHashes.every((value) => HASH_PATTERN.test(value ?? "")) &&
          new Set(projectionHashes).size === 1,
        orderDiversity: Object.values(metrics.classes).every((stats) =>
          stats.count >= EXP0025_CONFIG.classMinimumCount),
        classTemporalEquivalence: null
      }
    : {
        singleLifecycleAndEffect: null,
        pauseReceiptBeforeMarkers: null,
        terminalStopStable: null,
        terminalProjectionEquivalent: null,
        orderDiversity: null,
        classTemporalEquivalence: null
      };
  if (evaluated && physicalGates.orderDiversity) {
    physicalGates.classTemporalEquivalence =
      metrics.classMedianDeltaMs <=
        EXP0025_CONFIG.classLatencyEquivalenceMarginMs &&
      metrics.classP95DeltaMs <=
        EXP0025_CONFIG.classLatencyEquivalenceMarginMs;
  }
  const gates = {
    ...coreInstrumentGates,
    networkLedgerValid: networkCollected ? network.valid : null,
    trialRequestBijection: networkCollected ||
      reconstruction.captures.length > 0
      ? reconstruction.bindingValid
      : null,
    captureQualified: captureStatus,
    diagnosticsLocalBudget: budgetCollected
      ? provenanceDiagnostics.runtimeBudget === "PASS"
      : null,
    renderOnsetDeltaExercised,
    browserCdpByteIdentity: null,
    ...physicalGates
  };

  let decision;
  if (!instrumentValid) {
    decision = EXP0025_DECISIONS.invalidate;
  } else if (PHYSICAL_GATE_NAMES.some((name) => gates[name] !== true)) {
    decision = EXP0025_DECISIONS.fix;
  } else if (gates.renderOnsetDeltaExercised !== true) {
    decision = EXP0025_DECISIONS.holdOnset;
  } else if (gates.orderDiversity !== true) {
    decision = EXP0025_DECISIONS.hold;
  } else if (gates.classTemporalEquivalence !== true) {
    decision = EXP0025_DECISIONS.rejectNormalization;
  } else {
    decision = EXP0025_DECISIONS.pass;
  }

  return deepFreeze({
    physicalMeasurementStatus: evaluated ? "EVALUATED" : "NOT_EVALUATED",
    browserCdpByteIdentityStatus: "NOT_EVALUATED",
    trials: reconstruction.reconstructed.map((entry) => ({
      ...entry.analysis,
      resultStatus: entry.rawTrial?.status ?? null,
      instrumentFailurePhase: entry.rawTrial?.phase ?? null,
      instrumentFailureCode: entry.rawTrial?.code ?? null,
      renderOnset: {
        activeMarkerCount: entry.causal?.activeMarkerCount ?? null,
        multiplicityObserved: entry.causal?.multiplicityObserved ?? false
      }
    })),
    metrics,
    provenanceDiagnostics,
    structural: {
      outerShapeValid,
      journalInspectionValid: journalState.valid,
      journalSequenceValid: sequenceValid,
      reconstructedTrialCount: reconstruction.reconstructed.length,
      collectedTrialCount: reconstruction.reconstructed.filter((entry) =>
        entry.rawTrial?.status === EXP0025_BROWSER_TRIAL_STATUSES.collected
      ).length,
      instrumentFailureCount: reconstruction.reconstructed.filter((entry) =>
        entry.rawTrial?.status ===
          EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure
      ).length,
      diagnosticCount: diagnostics.length
    },
    gates,
    instrumentValid,
    decision,
    pass: decision === EXP0025_DECISIONS.pass,
    authorityEligible: false,
    sameExperimentRerunAllowed: false,
    nextMove: structuredClone(EXP0025_NEXT_MOVES[decision])
  });
}

function reportClaim(analysis) {
  return analysis.pass
    ? "Neste Chrome, runtime e estímulo local, as duas ordens de telemetria " +
      "produziram o mesmo aceite de pausa, silêncio observado e projeção " +
      "terminal em 12 STOPs, sem reativação por pelo menos 250 ms."
    : null;
}

function reportCore(input, analysis) {
  return {
    schemaVersion: EXP0025_REPORT_SCHEMA,
    experimentId: EXP0025_EXPERIMENT_ID,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    contract: structuredClone(EXP0025_CONFIG),
    paths: structuredClone(EXP0025_PATHS),
    campaign: structuredClone(input.campaign),
    analysis,
    physicalMeasurementStatus: analysis.physicalMeasurementStatus,
    browserCdpByteIdentityStatus: "NOT_EVALUATED",
    browserCdpByteIdentity: null,
    gates: structuredClone(analysis.gates),
    decision: analysis.decision,
    pass: analysis.pass,
    instrumentValid: analysis.instrumentValid,
    authorityEligible: false,
    sameExperimentRerunAllowed: false,
    evidenceAcceptance: "PENDING_POST_COMMIT_CHECK",
    nextMove: structuredClone(analysis.nextMove),
    claim: reportClaim(analysis),
    limitations: [
      "não mede alto-falante, sala ou percepção humana",
      "não mede microfone, ASR, fala espontânea ou outros schedulers",
      "browserCdpByteIdentity não foi reavaliado neste experimento",
      "player-received é telemetria de software, não sensor físico independente"
    ]
  };
}

export function createExp0025Report(input) {
  const analysis = analyzeExp0025Campaign(input?.campaign);
  const core = reportCore(input ?? {}, analysis);
  const report = deepFreeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0025Report(report);
  if (!validation.valid) {
    throw new TypeError(
      `relatório EXP-0025 inválido: ${validation.errors.join("; ")}`
    );
  }
  return report;
}

export function validateExp0025Report(report) {
  const errors = [];
  try {
    if (
      report?.schemaVersion !== EXP0025_REPORT_SCHEMA ||
      report?.experimentId !== EXP0025_EXPERIMENT_ID ||
      !isDeepStrictEqual(report?.contract, EXP0025_CONFIG) ||
      !isDeepStrictEqual(report?.paths, EXP0025_PATHS) ||
      !validDate(report?.startedAt) || !validDate(report?.completedAt) ||
      Date.parse(report.startedAt) > Date.parse(report.completedAt)
    ) errors.push("identidade, datas, paths ou contrato incompatíveis");

    const expected = analyzeExp0025Campaign(report?.campaign);
    if (!isDeepStrictEqual(report?.analysis, expected)) {
      errors.push("análise não corresponde ao journal bruto");
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
      report?.physicalMeasurementStatus !==
        expected.physicalMeasurementStatus ||
      report?.browserCdpByteIdentityStatus !== "NOT_EVALUATED" ||
      report?.browserCdpByteIdentity !== null ||
      !isDeepStrictEqual(report?.gates, expected.gates) ||
      report?.decision !== expected.decision ||
      report?.pass !== expected.pass ||
      report?.instrumentValid !== expected.instrumentValid ||
      report?.authorityEligible !== false ||
      report?.sameExperimentRerunAllowed !== false ||
      (expected.pass
        ? !nonEmptyString(report?.claim)
        : report?.claim !== null)
    ) errors.push("status, decisão, gates, claim ou autoridade divergiram");
    const core = structuredClone(report ?? {});
    delete core.reportSha256;
    if (report?.reportSha256 !== `sha256:${canonicalSha256(core)}`) {
      errors.push("reportSha256 divergente");
    }
  } catch (error) {
    errors.push(`relatório malformado: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}
