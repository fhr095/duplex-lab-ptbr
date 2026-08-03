import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0024_BOUNDARY_PATHS,
  EXP0024_CONFIG
} from "./exp-0024-boundary.mjs";
import {
  EXP0024_JOURNAL_FRAME_TYPES,
  EXP0024_JOURNAL_INSPECTION_STATES,
  serializeExp0024Journal,
  validateExp0024JournalFrame
} from "./exp-0024-journal.mjs";
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

export { EXP0024_CONFIG };

export const EXP0024_REPORT_SCHEMA =
  "exp-0024-physical-stop-after-capture-qualification-report-v1";
export const EXP0024_EXPERIMENT_ID = "EXP-0024";
export const EXP0024_PATHS = EXP0024_BOUNDARY_PATHS;

export const EXP0024_DECISIONS = deepFreeze({
  invalidate: "INVALIDATE_PHYSICAL_STOP_AFTER_CAPTURE_QUALIFICATION",
  fix: "FIX_PHYSICAL_STOP_PATH",
  hold: "HOLD_ORDER_DIVERSITY",
  pass: "PASS_TELEMETRY_ORDER_EQUIVALENT"
});

export const EXP0024_NEXT_MOVES = deepFreeze({
  [EXP0024_DECISIONS.invalidate]: {
    action: "REPAIR_AND_PREREGISTER_NEW_PHYSICAL_STOP_INSTRUMENT",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0024_DECISIONS.fix]: {
    action: "ISOLATE_SMALLEST_PHYSICAL_STOP_MECHANISM",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0024_DECISIONS.hold]: {
    action: "DECIDE_IF_CONTROLLED_SCHEDULER_PERTURBATION_IS_WORTH_IT",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0024_DECISIONS.pass]: {
    action: "PREREGISTER_MINIMAL_CAUSAL_NORMALIZATION",
    authorityEligible: false,
    sameExperimentRerunAllowed: false
  }
});

export const EXP0024_EXECUTION_STATES = deepFreeze({
  fresh: "FRESH",
  recoveryWithoutJournal: "RECOVERY_WITHOUT_JOURNAL",
  recoveryValidJournal: "RECOVERY_VALID_JOURNAL",
  recoveryTruncatedTail: "RECOVERY_TRUNCATED_TAIL"
});

export const EXP0024_BOUNDARY_SUMMARY_KEYS = deepFreeze([
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
const TTS_URL = new URL("/api/tts", EXP0024_CONFIG.targetUrl).href;
const HEALTH_URL = new URL("/api/health", EXP0024_CONFIG.targetUrl).href;
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
const INSTRUMENT_GATE_NAMES = Object.freeze([
  "boundaryReconstructed",
  "journalReconstructible",
  "campaignCardinality",
  "environmentStable",
  "networkLedgerValid",
  "trialRequestBijection",
  "captureQualified",
  "traceStructural",
  "diagnosticsLocalBudget"
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
    const target = new URL(EXP0024_CONFIG.targetUrl);
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
    return url.origin === new URL(EXP0024_CONFIG.targetUrl).origin &&
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
    serialized = serializeExp0024Journal(frames);
    serializable = true;
  } catch {
    // A invalidação é materializada abaixo sem interpretar prefixos parciais.
  }
  const frameSchemasValid = frames.every((frame, index) =>
    validateExp0024JournalFrame(frame, {
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
    journal.status === EXP0024_JOURNAL_INSPECTION_STATES.valid &&
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
  const T = EXP0024_JOURNAL_FRAME_TYPES;
  const inProgress = oneFrame(frames, T.inProgress);
  const worker = oneFrame(frames, T.workerStarted);
  const healthBefore = oneFrame(frames, T.healthBefore);
  const browser = oneFrame(frames, T.browserBound);
  const healthAfter = oneFrame(frames, T.healthAfter);
  const budget = oneFrame(frames, T.budgetInputs);
  const outcome = oneFrame(frames, T.workerOutcome);
  const starts = framePayloads(frames, T.navigationStarted);
  const audits = framePayloads(frames, T.navigationAudited);
  const completed = framePayloads(frames, T.navigationCompleted);
  if (
    !inProgress || !worker || !healthBefore || !browser || !healthAfter ||
    !budget || !outcome || starts.length !== EXP0024_CONFIG.navigations ||
    audits.length !== EXP0024_CONFIG.navigations ||
    completed.length !== EXP0024_CONFIG.navigations ||
    frames[0] !== inProgress.frame || frames[1] !== worker.frame ||
    frames.at(-1) !== outcome.frame ||
    inProgress.payload.deadlineMs !== EXP0024_CONFIG.attemptDeadlineMs ||
    inProgress.payload.opening?.path !== EXP0024_PATHS.opening ||
    outcome.payload.status !== "completed" || outcome.payload.code !== null ||
    outcome.payload.exitCode !== 0 || outcome.payload.signal !== null ||
    !exactKeys(outcome.payload.outcome, [
      "kind",
      "protocolError",
      "recordCount",
      "stderrByteLength",
      "stderrSha256",
      "stderrTruncated"
    ]) || outcome.payload.outcome.kind !== "campaign-completed" ||
    outcome.payload.outcome.protocolError !== null ||
    outcome.payload.outcome.recordCount !== frames.length - 3 ||
    outcome.payload.outcome.stderrByteLength !== 0 ||
    outcome.payload.outcome.stderrSha256 !== EMPTY_SHA256 ||
    outcome.payload.outcome.stderrTruncated !== false ||
    Date.parse(worker.payload.startedAt) >
      Date.parse(outcome.payload.completedAt)
  ) return false;

  const fixedFrames = [
    worker.frame,
    healthBefore.frame,
    browser.frame,
    healthAfter.frame,
    budget.frame,
    outcome.frame
  ];
  if (!fixedFrames.every((frame, index) =>
    index === 0 || fixedFrames[index - 1].ordinal < frame.ordinal
  )) return false;

  for (let index = 1; index <= EXP0024_CONFIG.navigations; index += 1) {
    const start = starts.filter(({ payload }) =>
      payload.navigationIndex === index);
    const audit = audits.filter(({ payload }) =>
      payload.navigationIndex === index);
    const finish = completed.filter(({ payload }) =>
      payload.navigationIndex === index);
    if (
      start.length !== 1 || audit.length !== 1 || finish.length !== 1 ||
      start[0].payload.targetUrl !== EXP0024_CONFIG.targetUrl ||
      !(browser.frame.ordinal < start[0].frame.ordinal &&
        start[0].frame.ordinal < audit[0].frame.ordinal &&
        audit[0].frame.ordinal < finish[0].frame.ordinal &&
        finish[0].frame.ordinal < healthAfter.frame.ordinal)
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
    EXP0024_JOURNAL_FRAME_TYPES.workerStarted
  );
  return exactKeys(boundary, EXP0024_BOUNDARY_SUMMARY_KEYS) &&
    boundary.freezePath === EXP0024_PATHS.freeze &&
    boundary.openingPath === EXP0024_PATHS.opening &&
    boundary.receiptPath === EXP0024_PATHS.receipt &&
    boundary.journalPath === EXP0024_PATHS.journal &&
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
    boundary.executionState === EXP0024_EXECUTION_STATES.fresh &&
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
  const T = EXP0024_JOURNAL_FRAME_TYPES;
  if (entry.frame.type === T.networkRequest) {
    return entry.payload.requestOrdinal;
  }
  if (entry.frame.type === T.networkResponse) {
    return entry.payload.responseOrdinal;
  }
  return entry.payload.terminalOrdinal;
}

function networkGroups(frames) {
  const T = EXP0024_JOURNAL_FRAME_TYPES;
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
    isDeepStrictEqual(request.postData, { text: EXP0024_CONFIG.phrase }) &&
    request.redirected !== true &&
    response.url === TTS_URL && response.status === 200 &&
    response.mimeType === "audio/wav" &&
    response.fromDiskCache !== true &&
    response.fromServiceWorker !== true &&
    finite(terminal.encodedDataLength) &&
    terminal.encodedDataLength > 44 &&
    terminal.encodedDataLength <
      EXP0024_CONFIG.networkEnable.maxResourceBufferSize;
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
    { length: EXP0024_CONFIG.navigations },
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
  const ttsProtocol = ttsGroups.length === EXP0024_CONFIG.totalStops &&
    ttsGroups.every(ttsProtocolValid);
  let healthProtocol = healthGroups.length ===
    EXP0024_CONFIG.navigations * 2 && healthGroups.every(healthProtocolValid);
  const audits = framePayloads(
    frames,
    EXP0024_JOURNAL_FRAME_TYPES.navigationAudited
  );
  for (let navigationIndex = 1;
    navigationIndex <= EXP0024_CONFIG.navigations;
    navigationIndex += 1) {
    const auditFrames = audits.filter(({ payload }) =>
      payload.navigationIndex === navigationIndex);
    const scopedHealth = healthGroups.filter((group) =>
      group.requests[0]?.payload?.navigationIndex === navigationIndex);
    const scopedTts = ttsGroups.filter((group) =>
      group.requests[0]?.payload?.navigationIndex === navigationIndex);
    if (
      auditFrames.length !== 1 || scopedHealth.length !== 2 ||
      scopedTts.length !== EXP0024_CONFIG.stopsPerNavigation
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
  const ttsSerial = orderedTts.length === EXP0024_CONFIG.totalStops &&
    orderedTts.every((group, index) => index === 0 ||
      orderedTts[index - 1].terminals[0].payload.terminalOrdinal <
        group.requests[0].payload.requestOrdinal) &&
    isDeepStrictEqual(
      orderedTts.map((group) => group.requests[0].payload.trialId),
      Array.from(
        { length: EXP0024_CONFIG.totalStops },
        (_, index) => expectedTrialId(
          Math.floor(index / EXP0024_CONFIG.stopsPerNavigation) + 1,
          index % EXP0024_CONFIG.stopsPerNavigation + 1
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
      EXP0024_CONFIG.triggerAfterRenderActiveMs &&
    finite(offset) &&
    offset >= EXP0024_CONFIG.triggerAfterRenderActiveMs &&
    offset <= EXP0024_CONFIG.triggerAfterRenderActiveMs +
      EXP0024_CONFIG.triggerTimerErrorMaxMs + 0.02 &&
    finite(error) && error >= 0 &&
    error <= EXP0024_CONFIG.triggerTimerErrorMaxMs &&
    timing.timerErrorMs === error &&
    Array.isArray(markerTimes) && markerTimes.length === 2 &&
    markerTimes.every((atMs) =>
      finite(atMs) && atMs >= timing.actualTriggerAtMs);
}

function traceStructuralValid(record, trial, analysis) {
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
  const T = EXP0024_JOURNAL_FRAME_TYPES;
  const physical = framePayloads(frames, T.physicalTrialCompleted);
  const captures = framePayloads(frames, T.captureCompleted);
  const reconstructed = [];
  let bindingValid = physical.length === EXP0024_CONFIG.totalStops &&
    captures.length === EXP0024_CONFIG.totalStops &&
    network.ttsGroups.length === EXP0024_CONFIG.totalStops;
  const physicalKeys = new Set();
  const captureKeys = new Set();
  const requestIds = new Set();
  for (let navigationIndex = 1;
    navigationIndex <= EXP0024_CONFIG.navigations;
    navigationIndex += 1) {
    for (let trialIndex = 1;
      trialIndex <= EXP0024_CONFIG.stopsPerNavigation;
      trialIndex += 1) {
      const key = trialKey(navigationIndex, trialIndex);
      const id = expectedTrialId(navigationIndex, trialIndex);
      const physicalMatches = physical.filter(({ payload }) =>
        trialKey(payload.navigationIndex, payload.trialIndex) === key);
      const captureMatches = captures.filter(({ payload }) =>
        trialKey(payload.navigationIndex, payload.trialIndex) === key);
      const ttsMatches = network.ttsGroups.filter((group) =>
        group.requests[0]?.payload?.trialId === id);
      if (
        physicalMatches.length !== 1 || captureMatches.length !== 1 ||
        ttsMatches.length !== 1
      ) {
        bindingValid = false;
        continue;
      }
      const physicalRecord = physicalMatches[0];
      const captureRecord = captureMatches[0];
      const tts = ttsMatches[0];
      const requestId = physicalRecord.payload.requestId;
      const identityValid = physicalRecord.payload.trialId === id &&
        physicalRecord.payload.turnId === id &&
        captureRecord.payload.trialId === id &&
        captureRecord.payload.turnId === id &&
        captureRecord.payload.requestId === requestId &&
        tts.requestId === requestId && nonEmptyString(requestId) &&
        tts.responses[0]?.payload?.trialId === id &&
        tts.terminals[0]?.payload?.trialId === id &&
        tts.terminals[0]?.frame?.ordinal < physicalRecord.frame.ordinal &&
        physicalRecord.frame.ordinal < captureRecord.frame.ordinal &&
        Date.parse(physicalRecord.payload.completedAt) <=
          Date.parse(captureRecord.payload.completedAt);
      bindingValid &&= identityValid;
      physicalKeys.add(key);
      captureKeys.add(key);
      if (nonEmptyString(requestId)) requestIds.add(requestId);
      const trial = normalizePhysicalTrial(physicalRecord.payload);
      reconstructed.push({
        key,
        id,
        requestId,
        physicalRecord,
        captureRecord,
        tts,
        trial,
        analysis: analyzeExp0020Trial(trial)
      });
    }
  }
  bindingValid &&=
    reconstructed.length === EXP0024_CONFIG.totalStops &&
    physicalKeys.size === EXP0024_CONFIG.totalStops &&
    captureKeys.size === EXP0024_CONFIG.totalStops &&
    requestIds.size === EXP0024_CONFIG.totalStops;
  for (let index = 1; index < reconstructed.length; index += 1) {
    bindingValid &&=
      reconstructed[index - 1].captureRecord.frame.ordinal <
        reconstructed[index].tts.requests[0].frame.ordinal &&
      reconstructed[index - 1].tts.requests[0].payload.requestOrdinal <
        reconstructed[index].tts.requests[0].payload.requestOrdinal;
  }
  return { physical, captures, reconstructed, bindingValid };
}

function captureQualified(reconstruction) {
  const delays = EXP0024_CONFIG.responseBodyRetryDelaysMs;
  return reconstruction.reconstructed.length === EXP0024_CONFIG.totalStops &&
    reconstruction.reconstructed.every(({ captureRecord }) => {
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
        capture.sha256 === EXP0024_CONFIG.expectedWavSha256 &&
        capture.byteLength === EXP0024_CONFIG.expectedWavByteLength;
    });
}

function campaignCardinalityValid(frames, reconstruction) {
  const T = EXP0024_JOURNAL_FRAME_TYPES;
  const starts = framePayloads(frames, T.navigationStarted);
  const audits = framePayloads(frames, T.navigationAudited);
  const completed = framePayloads(frames, T.navigationCompleted);
  return starts.length === EXP0024_CONFIG.navigations &&
    audits.length === EXP0024_CONFIG.navigations &&
    completed.length === EXP0024_CONFIG.navigations &&
    reconstruction.physical.length === EXP0024_CONFIG.totalStops &&
    reconstruction.captures.length === EXP0024_CONFIG.totalStops &&
    reconstruction.reconstructed.length === EXP0024_CONFIG.totalStops;
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
  const T = EXP0024_JOURNAL_FRAME_TYPES;
  const before = oneFrame(frames, T.healthBefore)?.payload?.health;
  const after = oneFrame(frames, T.healthAfter)?.payload?.health;
  const browser = oneFrame(frames, T.browserBound)?.payload?.browser;
  const auditHealth = framePayloads(frames, T.navigationAudited).map(
    ({ payload }) => payload.health
  );
  try {
    const delta = measureUsageDelta(before, after);
    const beforeIdentity = healthIdentity(before);
    const afterIdentity = healthIdentity(after);
    const expectedFingerprint = normalizeHash(
      boundary?.expectedRuntimeFingerprintSha256
    );
    const valid = beforeIdentity !== null &&
      isDeepStrictEqual(beforeIdentity, afterIdentity) &&
      beforeIdentity.runtimeFingerprintSha256 === expectedFingerprint &&
      beforeIdentity.brain === EXP0024_CONFIG.provider &&
      beforeIdentity.asrState === EXP0024_CONFIG.asrState &&
      beforeIdentity.vadControlEngine ===
        EXP0024_CONFIG.vadControlEngine &&
      beforeIdentity.vadControlState === "ready" &&
      beforeIdentity.vadShadowState === EXP0024_CONFIG.vadShadowState &&
      beforeIdentity.ttsState === "ready" &&
      beforeIdentity.ttsEngine === EXP0024_CONFIG.ttsEngine &&
      browser?.product === EXP0024_CONFIG.chrome.product &&
      browser?.protocolVersion === EXP0024_CONFIG.chrome.protocolVersion &&
      auditHealth.length === EXP0024_CONFIG.navigations &&
      auditHealth.every((health) =>
        isDeepStrictEqual(healthIdentity(health), beforeIdentity)) &&
      delta.requests === 0 && delta.inputTokens === 0 &&
      delta.outputTokens === 0 && delta.totalTokens === 0 &&
      delta.paidApiCalls === EXP0024_CONFIG.paidApiCalls &&
      delta.externalLlmUsed === false;
    return { valid, delta };
  } catch (error) {
    return { valid: false, delta: null, error: error.message };
  }
}

function budgetValid(frames, network) {
  const T = EXP0024_JOURNAL_FRAME_TYPES;
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
    budget.navigationAudits.length === EXP0024_CONFIG.navigations &&
    Array.isArray(budget.navigationSnapshots) &&
    budget.navigationSnapshots.length === EXP0024_CONFIG.navigations &&
    Array.isArray(budget.networkRequests) &&
    budget.networkRequests.length === network.groups.length &&
    isDeepStrictEqual(
      budget.networkRequests.map((request) => request?.requestId).toSorted(),
      network.groups.map((group) => group.requestId).toSorted()
    ) &&
    isDeepStrictEqual(budget.declared, {
      gpuRuns: EXP0024_CONFIG.gpuRuns,
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
    stats.count >= EXP0024_CONFIG.classMinimumCount);
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

export function analyzeExp0024Campaign(campaign) {
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
        entry.analysis
      ));
  const diagnostics = framePayloads(
    frames,
    EXP0024_JOURNAL_FRAME_TYPES.diagnostic
  );
  const instrumentGates = {
    boundaryReconstructed: outerShapeValid && boundaryValid(
      campaign?.boundary,
      journalState,
      frames
    ),
    journalReconstructible: journalState.valid && sequenceValid,
    campaignCardinality: cardinality,
    environmentStable: environment.valid,
    networkLedgerValid: network.valid,
    trialRequestBijection: reconstruction.bindingValid,
    captureQualified: reconstruction.bindingValid &&
      captureQualified(reconstruction),
    traceStructural: tracesStructural,
    diagnosticsLocalBudget:
      diagnostics.length === 0 && network.localOnly &&
      budgetValid(frames, network)
  };
  const instrumentValid = INSTRUMENT_GATE_NAMES.every((name) =>
    instrumentGates[name] === true);
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
          projectionHashes.length === EXP0024_CONFIG.totalStops &&
          projectionHashes.every((value) => HASH_PATTERN.test(value ?? "")) &&
          new Set(projectionHashes).size === 1,
        orderDiversity: Object.values(metrics.classes).every((stats) =>
          stats.count >= EXP0024_CONFIG.classMinimumCount),
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
        EXP0024_CONFIG.classLatencyEquivalenceMarginMs &&
      metrics.classP95DeltaMs <=
        EXP0024_CONFIG.classLatencyEquivalenceMarginMs;
  }
  const gates = {
    ...instrumentGates,
    browserCdpByteIdentity: null,
    ...physicalGates
  };

  let decision;
  if (!instrumentValid) {
    decision = EXP0024_DECISIONS.invalidate;
  } else if (PHYSICAL_GATE_NAMES.some((name) => gates[name] !== true)) {
    decision = EXP0024_DECISIONS.fix;
  } else if (gates.orderDiversity !== true) {
    decision = EXP0024_DECISIONS.hold;
  } else if (gates.classTemporalEquivalence !== true) {
    decision = EXP0024_DECISIONS.fix;
  } else {
    decision = EXP0024_DECISIONS.pass;
  }

  return deepFreeze({
    physicalMeasurementStatus: evaluated ? "EVALUATED" : "NOT_EVALUATED",
    browserCdpByteIdentityStatus: "NOT_EVALUATED",
    trials: analyses,
    metrics,
    structural: {
      outerShapeValid,
      journalInspectionValid: journalState.valid,
      journalSequenceValid: sequenceValid,
      reconstructedTrialCount: reconstruction.reconstructed.length,
      diagnosticCount: diagnostics.length
    },
    gates,
    instrumentValid,
    decision,
    pass: decision === EXP0024_DECISIONS.pass,
    authorityEligible: false,
    sameExperimentRerunAllowed: false,
    nextMove: structuredClone(EXP0024_NEXT_MOVES[decision])
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
    schemaVersion: EXP0024_REPORT_SCHEMA,
    experimentId: EXP0024_EXPERIMENT_ID,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    contract: structuredClone(EXP0024_CONFIG),
    paths: structuredClone(EXP0024_PATHS),
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

export function createExp0024Report(input) {
  const analysis = analyzeExp0024Campaign(input?.campaign);
  const core = reportCore(input ?? {}, analysis);
  const report = deepFreeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0024Report(report);
  if (!validation.valid) {
    throw new TypeError(
      `relatório EXP-0024 inválido: ${validation.errors.join("; ")}`
    );
  }
  return report;
}

export function validateExp0024Report(report) {
  const errors = [];
  try {
    if (
      report?.schemaVersion !== EXP0024_REPORT_SCHEMA ||
      report?.experimentId !== EXP0024_EXPERIMENT_ID ||
      !isDeepStrictEqual(report?.contract, EXP0024_CONFIG) ||
      !isDeepStrictEqual(report?.paths, EXP0024_PATHS) ||
      !validDate(report?.startedAt) || !validDate(report?.completedAt) ||
      Date.parse(report.startedAt) > Date.parse(report.completedAt)
    ) errors.push("identidade, datas, paths ou contrato incompatíveis");

    const expected = analyzeExp0024Campaign(report?.campaign);
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
