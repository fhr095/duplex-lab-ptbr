import { isDeepStrictEqual } from "node:util";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import { measureUsageDelta } from "./runtime-provenance.mjs";

export const EXP0022_REPORT_SCHEMA =
  "exp-0022-bootstrap-audit-health-binding-report-v1";
export const EXP0022_WORKER_ENVELOPE_SCHEMA =
  "exp-0022-worker-envelope-v1";
export const EXP0022_EXPERIMENT_ID = "EXP-0022";
export const EXP0022_REPORT_PATH =
  "eval/reports/exp-0022-bootstrap-audit-health-binding-v0.1.json";
export const EXP0022_FREEZE_PATH =
  "eval/commitments/exp-0022-instrumentation-freeze-v0.1.json";
export const EXP0022_ATTEMPT_PATH =
  "eval/commitments/exp-0022-capture-attempt-v0.1.json";
export const EXP0022_RECEIPT_PATH =
  "eval/generated/exp-0022/capture-attempt-consumed-v0.1.json";
export const EXP0022_PREREGISTRATION_PATH =
  "docs/experiments/EXP-0022-bootstrap-audit-health-binding.md";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const EXP0022_PATHS = deepFreeze({
  report: EXP0022_REPORT_PATH,
  freeze: EXP0022_FREEZE_PATH,
  attempt: EXP0022_ATTEMPT_PATH,
  receipt: EXP0022_RECEIPT_PATH,
  preregistration: EXP0022_PREREGISTRATION_PATH
});

export const EXP0022_PAYLOAD_A = deepFreeze({
  id: "A",
  text: "Esta fala contínua mede uma única parada física do assistente.",
  rate: 1,
  postData: {
    text: "Esta fala contínua mede uma única parada física do assistente."
  }
});

export const EXP0022_PAYLOAD_B = deepFreeze({
  id: "B",
  text: "Esta resposta diferente verifica o vínculo correto da captura local.",
  rate: 1,
  postData: {
    text:
      "Esta resposta diferente verifica o vínculo correto da captura local."
  }
});

export const EXP0022_PAYLOADS = deepFreeze({
  A: EXP0022_PAYLOAD_A,
  B: EXP0022_PAYLOAD_B
});

export const EXP0022_ORDER = deepFreeze([
  {
    navigationIndex: 1,
    unitIndex: 1,
    sequence: 1,
    trialId: "A1",
    payloadId: "A"
  },
  {
    navigationIndex: 1,
    unitIndex: 2,
    sequence: 2,
    trialId: "B1",
    payloadId: "B"
  },
  {
    navigationIndex: 2,
    unitIndex: 1,
    sequence: 3,
    trialId: "B2",
    payloadId: "B"
  },
  {
    navigationIndex: 2,
    unitIndex: 2,
    sequence: 4,
    trialId: "A2",
    payloadId: "A"
  }
]);

export const EXP0022_CAPTURE_FAILURE_CODES = deepFreeze({
  commandError: "CDP_COMMAND_ERROR",
  bodyEmpty: "CDP_RESPONSE_BODY_EMPTY_EXHAUSTED",
  malformed: "CDP_RESPONSE_MALFORMED",
  base64FlagInvalid: "CDP_RESPONSE_NOT_BASE64",
  base64Invalid: "CDP_RESPONSE_BASE64_INVALID",
  wavInvalid: "CDP_RESPONSE_WAV_INVALID",
  statusInvalid: "TTS_HTTP_STATUS_INVALID",
  mimeInvalid: "TTS_MIME_TYPE_INVALID",
  encodedLengthInvalid: "CDP_ENCODED_LENGTH_INVALID",
  resourceBufferExceeded: "CDP_RESOURCE_BUFFER_EXCEEDED"
});

export const EXP0022_DECISIONS = deepFreeze({
  invalidate: "INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING",
  fix: "FIX_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING",
  pass: "PASS_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING"
});

export const EXP0022_NEXT_MOVES = deepFreeze({
  [EXP0022_DECISIONS.invalidate]: {
    action: "REPAIR_REAUDIT_AND_PREREGISTER_NEW_HEALTH_BINDING_INSTRUMENT",
    physicalStopPreregistrationAllowed: false,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0022_DECISIONS.fix]: {
    action: "DIAGNOSE_AND_PREREGISTER_CAPTURE_AFTER_HEALTH_BINDING",
    physicalStopPreregistrationAllowed: false,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0022_DECISIONS.pass]: {
    action: "PREREGISTER_NEW_PHYSICAL_STOP_EXPERIMENT",
    physicalStopPreregistrationAllowed: true,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  }
});

export const EXP0022_CONFIG = deepFreeze({
  targetUrl: "http://localhost:4173/?automation=1&experiment=0022",
  ttsUrl: "http://localhost:4173/api/tts",
  navigationCount: 2,
  unitsPerNavigation: 2,
  totalUnits: 4,
  ttsRate: 1,
  payloadOrder: EXP0022_ORDER.map((entry) => entry.trialId),
  healthBinding: {
    bootstrapRequestsPerNavigation: 1,
    auditRequestsPerNavigation: 1,
    totalHealthRequestsPerNavigation: 2,
    auditQueryName: "exp0022_probe",
    auditProbeIds: ["nav-1", "nav-2"],
    auditHeaderName: "x-duplex-exp-0022-audit",
    auditHeaderValue: "audit-health-v0.1"
  },
  networkEnable: {
    maxTotalBufferSize: 16 * 1024 * 1024,
    maxResourceBufferSize: 2 * 1024 * 1024,
    maxPostDataSize: 64 * 1024,
    enableDurableMessages: false
  },
  capture: {
    delayBeforeReadMs: [0, 8, 24, 64],
    maxReads: 4,
    maximumAccumulatedDelayMs: 96,
    minimumWavBytesExclusive: 44,
    maximumWavBytesExclusive: 2 * 1024 * 1024
  },
  provider: "local",
  cdp: {
    protocol: "http:",
    port: "9223",
    hostPolicy: "wsl-default-gateway",
    initialTarget: "about:blank",
    webSocketPathPrefix: "/devtools/page/"
  },
  asrState: "disabled",
  vadControlEngine: "adaptive-energy-vad",
  vadShadowState: "disabled",
  ttsEngine: "windows-system-speech",
  negativeBudget: {
    ttsRequests: 4,
    localTtsSyntheses: 4,
    audioConstructors: {
      Audio: 0,
      AudioContext: 0,
      webkitAudioContext: 0
    },
    calls: {
      htmlMediaElementPlay: 0,
      speechSynthesisSpeak: 0
    },
    lifecycle: { bargeIn: 0, stop: 0, transitions: 0 },
    trainingTrace: { decisions: 0, effects: 0 },
    inputActivations: 0,
    externalRequests: 0,
    usageDelta: {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    },
    gpuRuns: 0,
    challengerRuns: 0,
    backboneRuns: 0,
    canProduceNewEffects: false
  }
});

export const EXP0022_AUDIT_KEYS = deepFreeze([
  "instrumentationFreezeValid",
  "openingValid",
  "receiptValid",
  "receiptWriteOnce",
  "receiptBeforeNetwork",
  "supervisorFrozen",
  "workerFrozen",
  "adapterFrozen",
  "analyzerFrozen",
  "sourceBindingsValid",
  "rerunRefused"
]);

export const EXP0022_POST_COMMIT_AUDIT_KEYS = deepFreeze([
  "reportBindingValid",
  "canonicalHashValid",
  "gitTopologyValid",
  "evidenceCommitIsolated"
]);

export const EXP0022_PASS_CLAIM =
  "Qualificação limitada: neste Chrome, processo e dois textos locais, " +
  "um health de bootstrap e um health explícito foram distinguidos " +
  "causalmente em cada navegação; 4/4 respostas TTS foram capturadas " +
  "pelo CDP com os mesmos bytes observados no browser.";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TYPED_CAPTURE_FAILURES = new Set(
  Object.values(EXP0022_CAPTURE_FAILURE_CODES)
);
const CAPTURE_GATE_NAMES = deepFreeze([
  "cdpChainAndResponse",
  "browserCdpByteIdentity",
  "payloadStabilityAndDistinction",
  "boundedFailClosedCapture",
  "firstResponsePerNavigation"
]);
const GATE_NAMES = deepFreeze([
  "boundaryAndSupervisor",
  "fixedCampaign",
  ...CAPTURE_GATE_NAMES,
  "environmentStable",
  "negativeBudgetExact",
  "diagnosticsNetworkAndBindings"
]);
const DIAGNOSTIC_ARRAYS = deepFreeze([
  "structuralErrors",
  "consoleErrors",
  "runtimeErrors",
  "httpErrors",
  "networkViolations"
]);
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "base64",
  "base64Body",
  "body",
  "buffer",
  "bytes",
  "rawBytes",
  "wavBytes"
]);
const WORKER_ENVELOPE_KEYS = deepFreeze([
  "campaign",
  "completedAt",
  "failure",
  "schemaVersion",
  "startedAt",
  "status"
]);
const WORKER_CAMPAIGN_KEYS = deepFreeze([
  "browser",
  "budget",
  "diagnostics",
  "health",
  "navigations"
]);
const NAVIGATION_KEYS = deepFreeze([
  "audit",
  "browserHealth",
  "diagnostics",
  "healthBinding",
  "index",
  "networkRequests",
  "snapshot",
  "targetUrl",
  "units"
]);
const UNIT_KEYS = deepFreeze([
  "browser",
  "cdp",
  "navigationIndex",
  "payloadId",
  "sequence",
  "text",
  "trialId",
  "unitIndex"
]);
const RAW_NETWORK_REQUEST_KEYS = deepFreeze([
  "auditProbeHeader",
  "encodedDataLength",
  "failedOrdinal",
  "failedTimestamp",
  "finishedOrdinal",
  "finishedTimestamp",
  "frameId",
  "loaderId",
  "loadingFailedCount",
  "loadingFinishedCount",
  "method",
  "mimeType",
  "postData",
  "redirected",
  "requestId",
  "requestOrdinal",
  "responseOrdinal",
  "responseReceivedCount",
  "responseTimestamp",
  "responseUrl",
  "status",
  "timestamp",
  "tracksLoadingLifecycle",
  "type",
  "url"
]);

function finite(value) {
  return Number.isFinite(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validDate(value) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function exactObjectShape(value, template) {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    return true;
  }
  if (!exactKeys(value, Object.keys(template))) return false;
  return Object.entries(template).every(([key, nested]) =>
    exactObjectShape(value[key], nested));
}

function diagnosticsShapeValid(value) {
  return exactKeys(value, DIAGNOSTIC_ARRAYS) &&
    DIAGNOSTIC_ARRAYS.every((key) => Array.isArray(value[key]));
}

function healthObservationShapeValid(value) {
  return exactKeys(value, [
    "asr", "brain", "process", "tts", "usage", "vadControl", "vadShadow"
  ]) && exactKeys(value.process, ["runId", "runtimeFingerprint"]) &&
    exactKeys(value.process.runtimeFingerprint, ["sha256"]) &&
    exactKeys(value.usage, [
      "inputTokens", "outputTokens", "requests", "totalTokens"
    ]) && exactKeys(value.asr, ["state"]) &&
    exactKeys(value.vadControl, ["engine"]) &&
    exactKeys(value.vadShadow, ["state"]) &&
    exactKeys(value.tts, ["culture", "engine", "state", "voice"]);
}

function captureAttemptShapeValid(value) {
  return exactKeys(value, [
    "completedAtMs",
    "delayBeforeMs",
    "index",
    "outcome",
    "requestId",
    "startedAtMs"
  ]);
}

function captureShapeValid(value) {
  return exactKeys(value, [
    "attempts",
    "base64Encoded",
    "byteLength",
    "code",
    "emptyReadsBeforeSuccess",
    "readCount",
    "sha256",
    "status",
    "wavValid"
  ]) && Array.isArray(value.attempts) &&
    value.attempts.every(captureAttemptShapeValid);
}

function unitShapeValid(value) {
  return exactKeys(value, UNIT_KEYS) &&
    exactKeys(value.browser, [
      "byteLength", "mimeType", "sha256", "status", "url"
    ]) && exactKeys(value.cdp, [
      "capture",
      "encodedDataLength",
      "loadingFinishedCount",
      "method",
      "mimeType",
      "observedRequestIds",
      "postData",
      "requestId",
      "requestOrdinal",
      "requestWillBeSentCount",
      "responseReceivedCount",
      "status",
      "url"
    ]) && Array.isArray(value.cdp.observedRequestIds) &&
    captureShapeValid(value.cdp.capture);
}

function snapshotShapeValid(value) {
  return exactKeys(value, [
    "audio", "reflexTrainingTrace", "state", "traceEventTypes",
    "trainingTrace"
  ]) && exactKeys(value.state, [
    "active", "assistantSpeaking", "inputMode"
  ]) && Array.isArray(value.traceEventTypes) &&
    exactKeys(value.trainingTrace, ["decisions", "effects"]) &&
    exactKeys(value.reflexTrainingTrace, ["decisions", "effects"]) &&
    exactKeys(value.audio, [
      "capture", "outputInterruptionLifecycle", "transport", "vadControl",
      "vadShadow"
    ]) && exactKeys(value.audio.transport, ["socketReadyState"]) &&
    exactKeys(value.audio.vadControl, ["state"]) &&
    exactKeys(value.audio.vadShadow, ["health"]) &&
    exactKeys(value.audio.vadShadow.health, ["state"]) &&
    exactKeys(value.audio.outputInterruptionLifecycle, ["phase"]);
}

function browserAuditShapeValid(value) {
  return exactKeys(value, [
    "audioConstructors",
    "calls",
    "firstUnitTrialId",
    "installedAtMs",
    "instrumentationInstalled",
    "retryIssuedRequest",
    "schemaVersion",
    "singleTtsInFlight"
  ]) && exactKeys(value.audioConstructors, [
    "Audio", "AudioContext", "webkitAudioContext"
  ]) && exactKeys(value.calls, [
    "htmlMediaElementPlay", "speechSynthesisSpeak"
  ]);
}

function lifecycleShapeValid(value) {
  return exactKeys(value, [
    "auditProbeHeader",
    "finishedOrdinal",
    "finishedTimestamp",
    "frameId",
    "loaderId",
    "loadingFailedCount",
    "loadingFinishedCount",
    "method",
    "mimeType",
    "redirectCount",
    "requestId",
    "requestOrdinal",
    "requestTimestamp",
    "requestWillBeSentCount",
    "resourceType",
    "responseOrdinal",
    "responseReceivedCount",
    "responseTimestamp",
    "status",
    "url"
  ]);
}

function networkSnapshotShapeValid(value) {
  return exactKeys(value, [
    "boundaryOrdinal", "healthRequestIds", "networkRequestIds",
    "pendingRequestIds"
  ]) && [
    value.healthRequestIds,
    value.networkRequestIds,
    value.pendingRequestIds
  ].every(Array.isArray);
}

function healthBindingShapeValid(value) {
  return exactKeys(value, [
    "afterAudit",
    "audit",
    "auditHealthRequestId",
    "beforeAudit",
    "bootstrap",
    "bootstrapFinishedBeforeAudit",
    "bootstrapHealthRequestId",
    "newHealthRequestIds",
    "newNetworkRequestIds",
    "schemaVersion"
  ]) && networkSnapshotShapeValid(value.beforeAudit) &&
    networkSnapshotShapeValid(value.afterAudit) &&
    Array.isArray(value.newHealthRequestIds) &&
    Array.isArray(value.newNetworkRequestIds) &&
    lifecycleShapeValid(value.bootstrap) && lifecycleShapeValid(value.audit);
}

function rawNetworkRequestShapeValid(value) {
  return exactKeys(value, RAW_NETWORK_REQUEST_KEYS);
}

function navigationShapeValid(value) {
  return exactKeys(value, NAVIGATION_KEYS) &&
    exactKeys(value.browserHealth, [
      "health", "mimeType", "probeId", "status", "url"
    ]) && healthObservationShapeValid(value.browserHealth.health) &&
    healthBindingShapeValid(value.healthBinding) &&
    Array.isArray(value.units) && value.units.every(unitShapeValid) &&
    browserAuditShapeValid(value.audit) && snapshotShapeValid(value.snapshot) &&
    Array.isArray(value.networkRequests) &&
    value.networkRequests.every(rawNetworkRequestShapeValid) &&
    diagnosticsShapeValid(value.diagnostics);
}

function workerCampaignShapeValid(value) {
  return exactKeys(value, WORKER_CAMPAIGN_KEYS) &&
    exactKeys(value.health, ["after", "before"]) &&
    healthObservationShapeValid(value.health.before) &&
    healthObservationShapeValid(value.health.after) &&
    exactKeys(value.browser, [
      "cdpBinding", "jsVersion", "product", "protocolVersion", "revision",
      "userAgent"
    ]) && exactKeys(value.browser.cdpBinding, [
      "endpoint", "hostPolicy", "initialTarget", "targetId", "webSocketPath"
    ]) && Array.isArray(value.navigations) &&
    value.navigations.every(navigationShapeValid) &&
    diagnosticsShapeValid(value.diagnostics) &&
    exactObjectShape(value.budget, EXP0022_CONFIG.negativeBudget);
}

export function validateExp0022WorkerEnvelopeSchema(envelope) {
  return exactKeys(envelope, WORKER_ENVELOPE_KEYS) &&
    envelope?.schemaVersion === EXP0022_WORKER_ENVELOPE_SCHEMA &&
    ["completed", "capture-failure"].includes(envelope?.status) &&
    workerCampaignShapeValid(envelope?.campaign) &&
    (envelope.failure === null || exactKeys(envelope.failure, [
      "code", "message"
    ]));
}

function normalizeHash(value) {
  if (typeof value !== "string") return null;
  const normalized = value.startsWith("sha256:")
    ? value.toLowerCase()
    : `sha256:${value.toLowerCase()}`;
  return HASH_PATTERN.test(normalized) ? normalized : null;
}

function diagnosticsValid(value, units = []) {
  if (!DIAGNOSTIC_ARRAYS.every((key) => Array.isArray(value?.[key]))) {
    return false;
  }
  if ([
    "structuralErrors",
    "consoleErrors",
    "runtimeErrors",
    "networkViolations"
  ].some((key) => value[key].length !== 0)) return false;
  const byRequestId = new Map(units.map((unit) => [
    unit?.cdp?.requestId,
    unit
  ]));
  return value.httpErrors.every((error) => {
    const unit = byRequestId.get(error?.requestId);
    return unit && error?.url === EXP0022_CONFIG.ttsUrl &&
      finite(error?.status) && error.status !== 200 &&
      unit?.cdp?.status === error.status;
  });
}

function networkUrl(record) {
  return typeof record === "string" ? record : record?.url;
}

function networkMethod(record) {
  return typeof record === "string" ? null : record?.method ?? null;
}

function isAllowedLocalUrl(value) {
  try {
    const url = new URL(value);
    const target = new URL(EXP0022_CONFIG.targetUrl);
    if (["about:", "data:"].includes(url.protocol)) return true;
    if (url.protocol === "blob:") return url.origin === target.origin;
    return ["http:", "ws:"].includes(url.protocol) &&
      url.hostname === target.hostname &&
      (url.port || "80") === (target.port || "80");
  } catch {
    return false;
  }
}

function isTtsNetworkRecord(record) {
  try {
    const url = new URL(networkUrl(record));
    const expected = new URL(EXP0022_CONFIG.ttsUrl);
    return url.href === expected.href &&
      [null, "POST"].includes(networkMethod(record));
  } catch {
    return false;
  }
}

function isHealthNetworkRecord(record) {
  try {
    const url = new URL(networkUrl(record));
    const expected = new URL("/api/health", EXP0022_CONFIG.targetUrl);
    return url.origin === expected.origin &&
      url.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function expectedAuditHealthUrl(navigationIndex) {
  const url = new URL("/api/health", EXP0022_CONFIG.targetUrl);
  url.searchParams.set(
    EXP0022_CONFIG.healthBinding.auditQueryName,
    EXP0022_CONFIG.healthBinding.auditProbeIds[navigationIndex - 1]
  );
  return url.href;
}

function boundaryValid(boundary) {
  return exactKeys(boundary, [
    "attemptCanonicalSha256",
    "attemptFileSha256",
    "attemptPath",
    "attemptVerified",
    "expectedRuntimeFingerprintSha256",
    "freezeCanonicalSha256",
    "freezeFileSha256",
    "freezePath",
    "freezeVerified",
    "receiptBeforeNetwork",
    "receiptFileSha256",
    "receiptPath",
    "receiptVerified",
    "receiptWriteOnce",
    "rerunAllowed"
  ]) && boundary?.freezePath === EXP0022_FREEZE_PATH &&
    boundary?.attemptPath === EXP0022_ATTEMPT_PATH &&
    boundary?.receiptPath === EXP0022_RECEIPT_PATH &&
    boundary?.freezeVerified === true &&
    boundary?.attemptVerified === true &&
    boundary?.receiptVerified === true &&
    boundary?.receiptWriteOnce === true &&
    boundary?.receiptBeforeNetwork === true &&
    boundary?.rerunAllowed === false &&
    [
      boundary?.freezeCanonicalSha256,
      boundary?.freezeFileSha256,
      boundary?.attemptCanonicalSha256,
      boundary?.attemptFileSha256,
      boundary?.receiptFileSha256,
      boundary?.expectedRuntimeFingerprintSha256
    ].every((value) => HASH_PATTERN.test(value ?? ""));
}

function auditsValid(audits) {
  return exactKeys(audits, EXP0022_AUDIT_KEYS) &&
    EXP0022_AUDIT_KEYS.every((key) => audits[key] === true);
}

function flattenUnits(workerCampaign) {
  if (!Array.isArray(workerCampaign?.navigations)) return [];
  return workerCampaign.navigations.flatMap((navigation) =>
    Array.isArray(navigation?.units) ? navigation.units : []
  );
}

function fixedCampaignValid(workerCampaign, units) {
  if (
    !Array.isArray(workerCampaign?.navigations) ||
    workerCampaign.navigations.length !== EXP0022_CONFIG.navigationCount ||
    units.length !== EXP0022_CONFIG.totalUnits
  ) return false;
  let flatIndex = 0;
  return workerCampaign.navigations.every((navigation, navigationIndex) =>
    navigation?.index === navigationIndex + 1 &&
    navigation?.targetUrl === EXP0022_CONFIG.targetUrl &&
    Array.isArray(navigation?.units) &&
    navigation.units.length === EXP0022_CONFIG.unitsPerNavigation &&
    navigation.units.every((unit, unitIndex) => {
      const expected = EXP0022_ORDER[flatIndex++];
      const payload = EXP0022_PAYLOADS[expected.payloadId];
      return unit?.navigationIndex === expected.navigationIndex &&
        unit?.unitIndex === unitIndex + 1 &&
        unit?.sequence === expected.sequence &&
        unit?.trialId === expected.trialId &&
        unit?.payloadId === expected.payloadId &&
        unit?.text === payload.text;
    })
  );
}

function typedCaptureFailures(units) {
  return units.filter((unit) => unit?.cdp?.capture?.status === "failure");
}

function envelopeValid(envelope, units) {
  if (
    !validateExp0022WorkerEnvelopeSchema(envelope) ||
    !validDate(envelope?.startedAt) || !validDate(envelope?.completedAt) ||
    Date.parse(envelope.completedAt) < Date.parse(envelope.startedAt) ||
    !envelope?.campaign || typeof envelope.campaign !== "object"
  ) return false;
  const failures = typedCaptureFailures(units);
  if (envelope.status === "completed") {
    return envelope.failure === null && failures.length === 0;
  }
  return envelope.failure !== null &&
    TYPED_CAPTURE_FAILURES.has(envelope.failure?.code) &&
    nonEmptyString(envelope.failure?.message) &&
    failures.length > 0 && failures.some(
      (unit) => unit.cdp.capture.code === envelope.failure.code
    );
}

function responseMetadata(unit) {
  const encodedDataLength = unit?.cdp?.encodedDataLength;
  const maximum = EXP0022_CONFIG.networkEnable.maxResourceBufferSize;
  return unit?.browser?.status === 200 &&
    unit?.browser?.mimeType === "audio/wav" &&
    unit?.cdp?.status === 200 && unit?.cdp?.mimeType === "audio/wav" &&
    finite(encodedDataLength) && encodedDataLength > 0 &&
    encodedDataLength < maximum;
}

function requestBinding(unit, expected) {
  const payload = EXP0022_PAYLOADS[expected.payloadId];
  const requestId = unit?.cdp?.requestId;
  return nonEmptyString(requestId) &&
    Array.isArray(unit?.cdp?.observedRequestIds) &&
    isDeepStrictEqual(unit.cdp.observedRequestIds, [requestId]) &&
    unit.cdp.requestWillBeSentCount === 1 &&
    unit.cdp.responseReceivedCount === 1 &&
    unit.cdp.loadingFinishedCount === 1 &&
    unit.cdp.url === EXP0022_CONFIG.ttsUrl &&
    unit.cdp.method === "POST" &&
    isDeepStrictEqual(unit.cdp.postData, payload.postData) &&
    unit?.browser?.url === EXP0022_CONFIG.ttsUrl;
}

function attemptProtocol(capture, requestId) {
  const attempts = capture?.attempts;
  if (
    !["success", "failure"].includes(capture?.status) ||
    !Number.isSafeInteger(capture?.readCount) ||
    capture.readCount < 0 || capture.readCount > EXP0022_CONFIG.capture.maxReads ||
    !Array.isArray(attempts) || attempts.length !== capture.readCount
  ) return false;

  let previousCompletedAtMs = -Infinity;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (
      attempt?.index !== index + 1 || attempt?.requestId !== requestId ||
      attempt?.delayBeforeMs !==
        EXP0022_CONFIG.capture.delayBeforeReadMs[index] ||
      !finite(attempt?.startedAtMs) || !finite(attempt?.completedAtMs) ||
      attempt.startedAtMs < 0 || attempt.completedAtMs < 0 ||
      attempt.startedAtMs < previousCompletedAtMs ||
      (index > 0 && attempt.startedAtMs - previousCompletedAtMs <
        attempt.delayBeforeMs) ||
      attempt.completedAtMs < attempt.startedAtMs ||
      !["empty", "success", "error"].includes(attempt?.outcome)
    ) return false;
    previousCompletedAtMs = attempt.completedAtMs;
  }

  if (capture.status === "success") {
    return Number.isSafeInteger(capture.emptyReadsBeforeSuccess) &&
      capture.emptyReadsBeforeSuccess >= 0 &&
      capture.code === null && attempts.length >= 1 &&
      attempts.at(-1)?.outcome === "success" &&
      attempts.slice(0, -1).every((attempt) => attempt.outcome === "empty") &&
      capture.emptyReadsBeforeSuccess === attempts.length - 1 &&
      capture.base64Encoded === true && capture.wavValid === true &&
      HASH_PATTERN.test(capture.sha256 ?? "") &&
      Number.isSafeInteger(capture.byteLength) &&
      capture.byteLength > EXP0022_CONFIG.capture.minimumWavBytesExclusive &&
      capture.byteLength < EXP0022_CONFIG.capture.maximumWavBytesExclusive;
  }

  if (!TYPED_CAPTURE_FAILURES.has(capture.code)) return false;
  if (capture.code === EXP0022_CAPTURE_FAILURE_CODES.bodyEmpty) {
    return attempts.length === EXP0022_CONFIG.capture.maxReads &&
      attempts.every((attempt) => attempt.outcome === "empty") &&
      capture.emptyReadsBeforeSuccess === null &&
      capture.base64Encoded === null && capture.byteLength === null &&
      capture.sha256 === null && capture.wavValid === false;
  }
  const preReadFailures = new Set([
    EXP0022_CAPTURE_FAILURE_CODES.statusInvalid,
    EXP0022_CAPTURE_FAILURE_CODES.mimeInvalid,
    EXP0022_CAPTURE_FAILURE_CODES.encodedLengthInvalid
  ]);
  if (preReadFailures.has(capture.code)) {
    return attempts.length === 0 && capture.emptyReadsBeforeSuccess === null &&
      capture.base64Encoded === null && capture.byteLength === null &&
      capture.sha256 === null && capture.wavValid === false;
  }
  if (
    capture.code === EXP0022_CAPTURE_FAILURE_CODES.resourceBufferExceeded &&
    attempts.length === 0
  ) {
    return capture.emptyReadsBeforeSuccess === null &&
      capture.base64Encoded === null && capture.byteLength === null &&
      capture.sha256 === null && capture.wavValid === false;
  }
  return attempts.length >= 1 && attempts.at(-1)?.outcome === "error" &&
    attempts.slice(0, -1).every((attempt) => attempt.outcome === "empty") &&
    capture.emptyReadsBeforeSuccess === null &&
    capture.base64Encoded === null &&
    capture.byteLength === null && capture.sha256 === null &&
    capture.wavValid === false;
}

function analyzeUnit(unit, expected) {
  const capture = unit?.cdp?.capture;
  const bindingValid = requestBinding(unit, expected);
  const attemptBindingValid = attemptProtocol(capture, unit?.cdp?.requestId);
  const metadataValid = responseMetadata(unit);
  const browserDigestValid = HASH_PATTERN.test(unit?.browser?.sha256 ?? "") &&
    Number.isSafeInteger(unit?.browser?.byteLength) &&
    unit.browser.byteLength > EXP0022_CONFIG.capture.minimumWavBytesExclusive &&
    unit.browser.byteLength < EXP0022_CONFIG.capture.maximumWavBytesExclusive;
  const cdpDigestValid = capture?.status === "success" &&
    HASH_PATTERN.test(capture?.sha256 ?? "") &&
    Number.isSafeInteger(capture?.byteLength) &&
    capture.byteLength > EXP0022_CONFIG.capture.minimumWavBytesExclusive &&
    capture.byteLength < EXP0022_CONFIG.capture.maximumWavBytesExclusive;
  const byteIdentity = browserDigestValid && cdpDigestValid &&
    unit.browser.sha256 === capture.sha256 &&
    unit.browser.byteLength === capture.byteLength;
  const captureQualified = metadataValid && attemptBindingValid &&
    capture?.status === "success" && byteIdentity;
  return deepFreeze({
    navigationIndex: unit?.navigationIndex ?? null,
    unitIndex: unit?.unitIndex ?? null,
    sequence: unit?.sequence ?? null,
    trialId: unit?.trialId ?? null,
    payloadId: unit?.payloadId ?? null,
    requestId: unit?.cdp?.requestId ?? null,
    captureStatus: capture?.status ?? null,
    captureCode: capture?.code ?? null,
    readCount: Number.isSafeInteger(capture?.readCount)
      ? capture.readCount
      : null,
    emptyReadsBeforeSuccess:
      Number.isSafeInteger(capture?.emptyReadsBeforeSuccess)
        ? capture.emptyReadsBeforeSuccess
        : null,
    browserSha256: browserDigestValid ? unit.browser.sha256 : null,
    browserByteLength: browserDigestValid ? unit.browser.byteLength : null,
    cdpSha256: cdpDigestValid ? capture.sha256 : null,
    cdpByteLength: cdpDigestValid ? capture.byteLength : null,
    bindingValid,
    attemptBindingValid,
    metadataValid,
    byteIdentity,
    captureQualified,
    transientRecoveryObserved:
      captureQualified && capture.emptyReadsBeforeSuccess > 0
  });
}

function payloadStability(units) {
  if (units.length !== EXP0022_CONFIG.totalUnits) return false;
  const byId = new Map(units.map((unit) => [unit.trialId, unit]));
  const a1 = byId.get("A1");
  const a2 = byId.get("A2");
  const b1 = byId.get("B1");
  const b2 = byId.get("B2");
  return [a1, a2, b1, b2].every(
    (unit) => HASH_PATTERN.test(unit?.browserSha256 ?? "") &&
      Number.isSafeInteger(unit?.browserByteLength)
  ) && a1.browserSha256 === a2.browserSha256 &&
    a1.browserByteLength === a2.browserByteLength &&
    b1.browserSha256 === b2.browserSha256 &&
    b1.browserByteLength === b2.browserByteLength &&
    a1.browserSha256 !== b1.browserSha256;
}

function healthAndEnvironment(workerCampaign, expectedRuntimeFingerprint) {
  const before = workerCampaign?.health?.before;
  const after = workerCampaign?.health?.after;
  try {
    const delta = measureUsageDelta(before, after);
    const fingerprint = normalizeHash(
      before?.process?.runtimeFingerprint?.sha256
    );
    const afterFingerprint = normalizeHash(
      after?.process?.runtimeFingerprint?.sha256
    );
    const browserProduct = workerCampaign?.browser?.product;
    const beforeIdentity = healthIdentity(before);
    const afterIdentity = healthIdentity(after);
    const navigations = workerCampaign?.navigations;
    const browserHealthBindings = Array.isArray(navigations)
      ? navigations.map((navigation) => navigation?.browserHealth)
      : [];
    const valid = HASH_PATTERN.test(expectedRuntimeFingerprint ?? "") &&
      beforeIdentity?.runtimeFingerprintSha256 ===
        expectedRuntimeFingerprint &&
      beforeIdentity !== null &&
      isDeepStrictEqual(beforeIdentity, afterIdentity) &&
      browserHealthBindings.length === EXP0022_CONFIG.navigationCount &&
      browserHealthBindings.every((binding, index) =>
        browserHealthBindingValid(binding, beforeIdentity, index + 1)) &&
      cdpBindingValid(workerCampaign?.browser?.cdpBinding) &&
      fingerprint !== null && fingerprint === afterFingerprint &&
      nonEmptyString(browserProduct) &&
      nonEmptyString(workerCampaign?.browser?.protocolVersion) &&
      before?.brain === EXP0022_CONFIG.provider &&
      after?.brain === EXP0022_CONFIG.provider &&
      before?.asr?.state === EXP0022_CONFIG.asrState &&
      after?.asr?.state === EXP0022_CONFIG.asrState &&
      before?.vadControl?.engine === EXP0022_CONFIG.vadControlEngine &&
      after?.vadControl?.engine === EXP0022_CONFIG.vadControlEngine &&
      before?.vadShadow?.state === EXP0022_CONFIG.vadShadowState &&
      after?.vadShadow?.state === EXP0022_CONFIG.vadShadowState &&
      before?.tts?.state === "ready" && after?.tts?.state === "ready" &&
      before?.tts?.engine === EXP0022_CONFIG.ttsEngine &&
      after?.tts?.engine === EXP0022_CONFIG.ttsEngine &&
      nonEmptyString(before?.tts?.voice) &&
      before.tts.voice === after.tts.voice &&
      nonEmptyString(before?.tts?.culture) &&
      before.tts.culture === after.tts.culture &&
      delta.requests === 0 && delta.inputTokens === 0 &&
      delta.outputTokens === 0 && delta.totalTokens === 0 &&
      delta.paidApiCalls === 0 && delta.externalLlmUsed === false;
    return { valid, delta };
  } catch (error) {
    return { valid: false, delta: null, error: error.message };
  }
}

function healthIdentity(health) {
  const fingerprint = normalizeHash(
    health?.process?.runtimeFingerprint?.sha256
  );
  if (
    !nonEmptyString(health?.process?.runId) || fingerprint === null ||
    !nonEmptyString(health?.brain) || !nonEmptyString(health?.asr?.state) ||
    !nonEmptyString(health?.vadControl?.engine) ||
    !nonEmptyString(health?.vadShadow?.state) ||
    !nonEmptyString(health?.tts?.state) ||
    !nonEmptyString(health?.tts?.engine) ||
    !nonEmptyString(health?.tts?.voice) ||
    !nonEmptyString(health?.tts?.culture)
  ) return null;
  return {
    runId: health.process.runId,
    runtimeFingerprintSha256: fingerprint,
    brain: health.brain,
    asrState: health.asr.state,
    vadControlEngine: health.vadControl.engine,
    vadShadowState: health.vadShadow.state,
    ttsState: health.tts.state,
    ttsEngine: health.tts.engine,
    ttsVoice: health.tts.voice,
    ttsCulture: health.tts.culture
  };
}

function browserHealthBindingValid(
  binding,
  expectedIdentity,
  navigationIndex
) {
  return binding?.probeId ===
      EXP0022_CONFIG.healthBinding.auditProbeIds[navigationIndex - 1] &&
    binding?.url === expectedAuditHealthUrl(navigationIndex) &&
    binding?.status === 200 &&
    binding?.mimeType === "application/json" &&
    isDeepStrictEqual(healthIdentity(binding?.health), expectedIdentity);
}

function cdpBindingValid(binding) {
  try {
    const endpoint = new URL(binding?.endpoint);
    return binding?.hostPolicy === EXP0022_CONFIG.cdp.hostPolicy &&
      endpoint.protocol === EXP0022_CONFIG.cdp.protocol &&
      endpoint.port === EXP0022_CONFIG.cdp.port &&
      /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(endpoint.hostname) &&
      endpoint.pathname === "/" && endpoint.search === "" &&
      endpoint.hash === "" && endpoint.username === "" &&
      endpoint.password === "" &&
      binding?.initialTarget === EXP0022_CONFIG.cdp.initialTarget &&
      nonEmptyString(binding?.targetId) &&
      binding?.webSocketPath ===
        `${EXP0022_CONFIG.cdp.webSocketPathPrefix}${binding.targetId}`;
  } catch {
    return false;
  }
}

function navigationSnapshotClean(snapshot) {
  const traceEventTypes = snapshot?.traceEventTypes;
  const forbiddenTrace = /barge|render\.stopped|speech\.paused|output-interruption/iu;
  return snapshot?.state?.active === false &&
    snapshot?.state?.inputMode === null &&
    snapshot?.state?.assistantSpeaking === false &&
    Array.isArray(traceEventTypes) &&
    traceEventTypes.every(
      (type) => typeof type === "string" && !forbiddenTrace.test(type)
    ) && snapshot?.trainingTrace?.decisions === 0 &&
    snapshot?.trainingTrace?.effects === 0 &&
    snapshot?.reflexTrainingTrace?.decisions === 0 &&
    snapshot?.reflexTrainingTrace?.effects === 0 &&
    snapshot?.audio?.capture === null &&
    snapshot?.audio?.outputInterruptionLifecycle?.phase === "idle";
}

function browserAuditClean(audit, expectedFirst) {
  return audit?.schemaVersion === "exp-0022-browser-negative-budget-v1" &&
    finite(audit?.installedAtMs) &&
    isDeepStrictEqual(audit?.audioConstructors, {
      Audio: 0,
      AudioContext: 0,
      webkitAudioContext: 0
    }) && isDeepStrictEqual(audit?.calls, {
      htmlMediaElementPlay: 0,
      speechSynthesisSpeak: 0
    }) && audit?.singleTtsInFlight === true &&
    audit?.retryIssuedRequest === false &&
    audit?.firstUnitTrialId === expectedFirst &&
    audit?.instrumentationInstalled === true;
}

function uniqueNonEmptyStrings(values) {
  return Array.isArray(values) && values.every(nonEmptyString) &&
    new Set(values).size === values.length;
}

function healthLifecycleRecordValid(
  record,
  expectedRequestId,
  expectedUrl,
  expectedHeader
) {
  return record?.requestId === expectedRequestId &&
    record?.url === expectedUrl && record?.method === "GET" &&
    record?.auditProbeHeader === expectedHeader &&
    record?.resourceType === "Fetch" &&
    nonEmptyString(record?.loaderId) && nonEmptyString(record?.frameId) &&
    record?.redirectCount === 0 &&
    record?.requestWillBeSentCount === 1 &&
    record?.responseReceivedCount === 1 &&
    record?.loadingFinishedCount === 1 &&
    record?.loadingFailedCount === 0 &&
    record?.status === 200 && record?.mimeType === "application/json" &&
    finite(record?.requestTimestamp) && finite(record?.responseTimestamp) &&
    finite(record?.finishedTimestamp) &&
    Number.isSafeInteger(record?.requestOrdinal) &&
    Number.isSafeInteger(record?.responseOrdinal) &&
    Number.isSafeInteger(record?.finishedOrdinal) &&
    record.requestOrdinal > 0 &&
    record.requestOrdinal < record.responseOrdinal &&
    record.responseOrdinal < record.finishedOrdinal &&
    record.requestTimestamp <= record.responseTimestamp &&
    record.responseTimestamp <= record.finishedTimestamp;
}

function rawHealthLifecycle(record) {
  return {
    requestId: record?.requestId ?? null,
    requestWillBeSentCount: 1,
    responseReceivedCount: record?.responseReceivedCount ?? null,
    loadingFinishedCount: record?.loadingFinishedCount ?? null,
    loadingFailedCount: record?.loadingFailedCount ?? null,
    redirectCount: record?.redirected === true ? 1 : 0,
    url: record?.url ?? null,
    method: record?.method ?? null,
    auditProbeHeader: record?.auditProbeHeader ?? null,
    resourceType: record?.type ?? null,
    loaderId: record?.loaderId ?? null,
    frameId: record?.frameId ?? null,
    status: record?.status ?? null,
    mimeType: record?.mimeType ?? null,
    requestTimestamp: record?.timestamp ?? null,
    responseTimestamp: record?.responseTimestamp ?? null,
    finishedTimestamp: record?.finishedTimestamp ?? null,
    requestOrdinal: record?.requestOrdinal ?? null,
    responseOrdinal: record?.responseOrdinal ?? null,
    finishedOrdinal: record?.finishedOrdinal ?? null
  };
}

function rawRequestTerminalBy(record, boundaryOrdinal) {
  return [record?.finishedOrdinal, record?.failedOrdinal].some((ordinal) =>
    Number.isSafeInteger(ordinal) && ordinal <= boundaryOrdinal);
}

function networkSnapshotFromRaw(requests, boundaryOrdinal) {
  if (!Number.isSafeInteger(boundaryOrdinal)) return null;
  const visible = requests.filter((request) =>
    Number.isSafeInteger(request?.requestOrdinal) &&
    request.requestOrdinal <= boundaryOrdinal);
  const networkRequestIds = [...new Set(visible.map((request) =>
    request.requestId))];
  const healthRequestIds = visible.filter(isHealthNetworkRecord)
    .map((request) => request.requestId);
  const pendingRequestIds = networkRequestIds.filter((requestId) =>
    visible.some((request) =>
      request.requestId === requestId &&
      request.tracksLoadingLifecycle === true &&
      !rawRequestTerminalBy(request, boundaryOrdinal)));
  return {
    boundaryOrdinal,
    networkRequestIds,
    healthRequestIds,
    pendingRequestIds
  };
}

function rawNetworkRequestEvidenceValid(requests) {
  if (
    !Array.isArray(requests) || requests.length === 0 ||
    !requests.every(rawNetworkRequestShapeValid) ||
    !uniqueNonEmptyStrings(requests.map((request) => request.requestId))
  ) return false;
  let previousOrdinal = -Infinity;
  return requests.every((request) => {
    const ordinalValid = Number.isSafeInteger(request.requestOrdinal) &&
      request.requestOrdinal > previousOrdinal;
    previousOrdinal = request.requestOrdinal;
    const lifecycleFlagValid =
      typeof request.tracksLoadingLifecycle === "boolean";
    const requestFieldsValid = nonEmptyString(request.url) &&
      nonEmptyString(request.method) && nonEmptyString(request.type) &&
      finite(request.timestamp) &&
      typeof request.redirected === "boolean" &&
      [null, "string"].includes(request.postData === null
        ? null
        : typeof request.postData);
    if (!ordinalValid || !lifecycleFlagValid || !requestFieldsValid) {
      return false;
    }
    if (request.tracksLoadingLifecycle === false) {
      return request.responseReceivedCount === 0 &&
        request.loadingFinishedCount === 0 &&
        request.loadingFailedCount === 0 &&
        [
          request.responseUrl,
          request.status,
          request.mimeType,
          request.responseTimestamp,
          request.responseOrdinal,
          request.encodedDataLength,
          request.finishedTimestamp,
          request.finishedOrdinal,
          request.failedTimestamp,
          request.failedOrdinal
        ].every((value) => value === null);
    }
    const countsValid = [
      request.responseReceivedCount,
      request.loadingFinishedCount,
      request.loadingFailedCount
    ].every((count) => count === 0 || count === 1) &&
      request.loadingFinishedCount + request.loadingFailedCount === 1;
    const responseFields = [
      request.responseUrl,
      request.status,
      request.mimeType,
      request.responseTimestamp,
      request.responseOrdinal
    ];
    const responseValid = request.responseReceivedCount === 0
      ? responseFields.every((value) => value === null)
      : nonEmptyString(request.responseUrl) && finite(request.status) &&
        nonEmptyString(request.mimeType) && finite(request.responseTimestamp) &&
        Number.isSafeInteger(request.responseOrdinal) &&
        request.responseTimestamp >= request.timestamp &&
        request.responseOrdinal > request.requestOrdinal;
    const finishFields = [
      request.encodedDataLength,
      request.finishedTimestamp,
      request.finishedOrdinal
    ];
    const finishValid = request.loadingFinishedCount === 0
      ? finishFields.every((value) => value === null)
      : finite(request.encodedDataLength) && request.encodedDataLength >= 0 &&
        finite(request.finishedTimestamp) &&
        Number.isSafeInteger(request.finishedOrdinal) &&
        request.finishedTimestamp >= request.timestamp &&
        request.finishedOrdinal > request.requestOrdinal;
    const failureFields = [request.failedTimestamp, request.failedOrdinal];
    const failureValid = request.loadingFailedCount === 0
      ? failureFields.every((value) => value === null)
      : finite(request.failedTimestamp) &&
        Number.isSafeInteger(request.failedOrdinal) &&
        request.failedTimestamp >= request.timestamp &&
        request.failedOrdinal > request.requestOrdinal;
    const terminalOrdinal = request.loadingFinishedCount === 1
      ? request.finishedOrdinal
      : request.failedOrdinal;
    const responseBeforeTerminal = request.responseReceivedCount === 0 ||
      (request.responseOrdinal < terminalOrdinal &&
        request.responseTimestamp <= (request.loadingFinishedCount === 1
          ? request.finishedTimestamp
          : request.failedTimestamp));
    return countsValid && responseValid && finishValid && failureValid &&
      responseBeforeTerminal;
  });
}

function ttsRawBindingValid(raw, unit) {
  let parsedPostData = null;
  try {
    parsedPostData = JSON.parse(raw?.postData);
  } catch {
    return false;
  }
  return raw?.tracksLoadingLifecycle === true &&
    raw?.redirected === false && raw?.method === "POST" &&
    raw?.url === EXP0022_CONFIG.ttsUrl &&
    raw?.responseUrl === EXP0022_CONFIG.ttsUrl &&
    raw?.requestId === unit?.cdp?.requestId &&
    raw?.requestOrdinal === unit?.cdp?.requestOrdinal &&
    raw?.responseReceivedCount === unit?.cdp?.responseReceivedCount &&
    raw?.loadingFinishedCount === unit?.cdp?.loadingFinishedCount &&
    raw?.loadingFailedCount === 0 &&
    raw?.failedTimestamp === null && raw?.failedOrdinal === null &&
    raw?.status === unit?.cdp?.status &&
    raw?.mimeType === unit?.cdp?.mimeType &&
    raw?.encodedDataLength === unit?.cdp?.encodedDataLength &&
    isDeepStrictEqual(parsedPostData, unit?.cdp?.postData);
}

function bootstrapAuditHealthBindingValid(navigation) {
  const binding = navigation?.healthBinding;
  const before = binding?.beforeAudit;
  const after = binding?.afterAudit;
  const bootstrapId = binding?.bootstrapHealthRequestId;
  const auditId = binding?.auditHealthRequestId;
  if (
    binding?.schemaVersion !==
      "exp-0022-bootstrap-audit-health-binding-v1" ||
    !nonEmptyString(bootstrapId) || !nonEmptyString(auditId) ||
    bootstrapId === auditId || binding?.bootstrapFinishedBeforeAudit !== true ||
    !uniqueNonEmptyStrings(before?.networkRequestIds) ||
    !uniqueNonEmptyStrings(after?.networkRequestIds) ||
    !uniqueNonEmptyStrings(before?.healthRequestIds) ||
    !uniqueNonEmptyStrings(after?.healthRequestIds) ||
    !uniqueNonEmptyStrings(binding?.newNetworkRequestIds) ||
    !uniqueNonEmptyStrings(binding?.newHealthRequestIds) ||
    !Number.isSafeInteger(before?.boundaryOrdinal) ||
    !Number.isSafeInteger(after?.boundaryOrdinal) ||
    !Array.isArray(before?.pendingRequestIds) ||
    !Array.isArray(after?.pendingRequestIds) ||
    before.pendingRequestIds.length !== 0 || after.pendingRequestIds.length !== 0
  ) return false;

  if (
    !isDeepStrictEqual(before.healthRequestIds, [bootstrapId]) ||
    !isDeepStrictEqual(after.healthRequestIds, [bootstrapId, auditId]) ||
    !isDeepStrictEqual(binding.newHealthRequestIds, [auditId]) ||
    !isDeepStrictEqual(binding.newNetworkRequestIds, [auditId]) ||
    before.networkRequestIds.includes(auditId) ||
    !after.networkRequestIds.includes(bootstrapId) ||
    !after.networkRequestIds.includes(auditId) ||
    !before.networkRequestIds.every((id) =>
      after.networkRequestIds.includes(id))
  ) return false;

  const requests = navigation?.networkRequests;
  if (!rawNetworkRequestEvidenceValid(requests)) return false;
  const reconstructedBefore = networkSnapshotFromRaw(
    requests,
    before.boundaryOrdinal
  );
  const reconstructedAfter = networkSnapshotFromRaw(
    requests,
    after.boundaryOrdinal
  );
  if (
    !isDeepStrictEqual(reconstructedBefore, before) ||
    !isDeepStrictEqual(reconstructedAfter, after)
  ) return false;
  const derivedNewNetworkIds = reconstructedAfter.networkRequestIds.filter(
    (requestId) => !reconstructedBefore.networkRequestIds.includes(requestId)
  );
  const derivedNewHealthIds = reconstructedAfter.healthRequestIds.filter(
    (requestId) => !reconstructedBefore.healthRequestIds.includes(requestId)
  );
  if (
    !isDeepStrictEqual(derivedNewNetworkIds, binding.newNetworkRequestIds) ||
    !isDeepStrictEqual(derivedNewHealthIds, binding.newHealthRequestIds)
  ) return false;

  const bootstrap = binding?.bootstrap;
  const audit = binding?.audit;
  const bootstrapUrl = new URL(
    "/api/health",
    EXP0022_CONFIG.targetUrl
  ).href;
  const auditUrl = expectedAuditHealthUrl(navigation?.index);
  const networkHealth = requests.filter(isHealthNetworkRecord);
  if (networkHealth.length !==
      EXP0022_CONFIG.healthBinding.totalHealthRequestsPerNavigation) {
    return false;
  }
  const rawBootstrap = networkHealth[0];
  const rawAudit = networkHealth[1];
  const derivedBootstrap = rawHealthLifecycle(rawBootstrap);
  const derivedAudit = rawHealthLifecycle(rawAudit);
  if (
    !healthLifecycleRecordValid(
      bootstrap,
      bootstrapId,
      bootstrapUrl,
      null
    ) ||
    !healthLifecycleRecordValid(
      audit,
      auditId,
      auditUrl,
      EXP0022_CONFIG.healthBinding.auditHeaderValue
    ) ||
    !isDeepStrictEqual(derivedBootstrap, bootstrap) ||
    !isDeepStrictEqual(derivedAudit, audit) ||
    rawBootstrap.responseUrl !== bootstrapUrl ||
    rawAudit.responseUrl !== auditUrl ||
    rawBootstrap.postData !== null || rawAudit.postData !== null ||
    rawBootstrap.tracksLoadingLifecycle !== true ||
    rawAudit.tracksLoadingLifecycle !== true ||
    bootstrap.loaderId !== audit.loaderId ||
    bootstrap.frameId !== audit.frameId ||
    !(bootstrap.finishedTimestamp < audit.requestTimestamp) ||
    !(bootstrap.finishedOrdinal <= before.boundaryOrdinal) ||
    !(before.boundaryOrdinal < audit.requestOrdinal) ||
    !(audit.finishedOrdinal <= after.boundaryOrdinal) ||
    !(before.boundaryOrdinal < after.boundaryOrdinal) ||
    navigation?.browserHealth?.url !== audit.url
  ) return false;

  const ttsRequests = requests.filter(isTtsNetworkRecord);
  const ttsSequential = ttsRequests.every((request, index) => index === 0 ||
    (ttsRequests[index - 1].finishedOrdinal < request.requestOrdinal &&
      ttsRequests[index - 1].finishedTimestamp <= request.timestamp));
  return isDeepStrictEqual(
      networkHealth.map((request) => request?.requestId),
      [bootstrapId, auditId]
    ) && networkHealth[0]?.auditProbeHeader === null &&
    networkHealth[1]?.auditProbeHeader ===
      EXP0022_CONFIG.healthBinding.auditHeaderValue &&
    ttsRequests.length === EXP0022_CONFIG.unitsPerNavigation &&
    ttsSequential &&
    ttsRequests.every((request, index) =>
      ttsRawBindingValid(request, navigation?.units?.[index]) &&
      Number.isSafeInteger(request?.requestOrdinal) &&
      request.requestOrdinal > audit.finishedOrdinal) &&
    (navigation?.units ?? []).every((unit) =>
      Number.isSafeInteger(unit?.cdp?.requestOrdinal) &&
      unit.cdp.requestOrdinal > audit.finishedOrdinal);
}

function bootstrapAuditHealthBindingsValid(workerCampaign) {
  const navigations = workerCampaign?.navigations;
  if (
    !Array.isArray(navigations) ||
    navigations.length !== EXP0022_CONFIG.navigationCount
  ) return false;
  const allHealthIds = navigations.flatMap((navigation) => [
    navigation?.healthBinding?.bootstrapHealthRequestId,
    navigation?.healthBinding?.auditHealthRequestId
  ]);
  const allTtsIds = navigations.flatMap((navigation) =>
    (navigation?.units ?? []).map((unit) => unit?.cdp?.requestId));
  if (
    !uniqueNonEmptyStrings(allHealthIds) ||
    allHealthIds.length !== EXP0022_CONFIG.navigationCount * 2 ||
    !uniqueNonEmptyStrings([...allHealthIds, ...allTtsIds]) ||
    allTtsIds.length !== EXP0022_CONFIG.totalUnits
  ) return false;
  return navigations.every(bootstrapAuditHealthBindingValid);
}

function networkAndNavigationAudits(workerCampaign) {
  const navigations = workerCampaign?.navigations;
  if (!bootstrapAuditHealthBindingsValid(workerCampaign)) return false;
  return navigations.every((navigation, index) => {
    const requests = navigation?.networkRequests;
    const expectedFirst = EXP0022_ORDER[index * 2].trialId;
    const unitRequestIds = (navigation?.units ?? []).map(
      (unit) => unit?.cdp?.requestId
    );
    const ttsRequests = Array.isArray(requests)
      ? requests.filter(isTtsNetworkRecord)
      : [];
    const healthRequests = Array.isArray(requests)
      ? requests.filter(isHealthNetworkRecord)
      : [];
    return Array.isArray(requests) && requests.length > 0 &&
      requests.every((request) => isAllowedLocalUrl(networkUrl(request))) &&
      requests.every((request) =>
        request.tracksLoadingLifecycle !== true ||
        (request.loadingFinishedCount === 1 &&
          request.loadingFailedCount === 0)) &&
      healthRequests.length ===
        EXP0022_CONFIG.healthBinding.totalHealthRequestsPerNavigation &&
      ttsRequests.length === EXP0022_CONFIG.unitsPerNavigation &&
      isDeepStrictEqual(
        ttsRequests.map((request) => request?.requestId),
        unitRequestIds
      ) &&
      browserAuditClean(navigation?.audit, expectedFirst) &&
      navigationSnapshotClean(navigation?.snapshot) &&
      diagnosticsValid(navigation?.diagnostics, navigation?.units);
  });
}

function budgetValid(workerCampaign) {
  return isDeepStrictEqual(
    workerCampaign?.budget,
    EXP0022_CONFIG.negativeBudget
  );
}

function forbiddenPayloadPresent(value, key = null, seen = new Set()) {
  if (key !== null && FORBIDDEN_PAYLOAD_KEYS.has(key)) return true;
  if (
    typeof value === "string" && value.length >= 128 &&
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
      .test(value)
  ) return true;
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        value.length > EXP0022_CONFIG.capture.minimumWavBytesExclusive &&
        value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
      ) return true;
      return value.some((item) => forbiddenPayloadPresent(item, null, seen));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) return true;
    return Object.entries(value).some(([nestedKey, nested]) =>
      forbiddenPayloadPresent(nested, nestedKey, seen)
    );
  } finally {
    seen.delete(value);
  }
}

export function analyzeExp0022Campaign(campaign) {
  const outerCampaignShapeValid = exactKeys(campaign, [
    "audits", "boundary", "workerEnvelope"
  ]);
  const envelope = campaign?.workerEnvelope;
  const workerCampaign = envelope?.campaign;
  const rawUnits = flattenUnits(workerCampaign);
  const fixedCampaign = fixedCampaignValid(workerCampaign, rawUnits);
  const workerEnvelopeValid = envelopeValid(envelope, rawUnits);
  const measurementStatus = outerCampaignShapeValid && fixedCampaign &&
    workerEnvelopeValid
    ? "EVALUATED"
    : "NOT_EVALUATED";
  const unitAnalyses = measurementStatus === "EVALUATED"
    ? rawUnits.map((unit, index) => analyzeUnit(unit, EXP0022_ORDER[index]))
    : [];
  const requestBindingsValid = measurementStatus === "EVALUATED" &&
    unitAnalyses.length === EXP0022_CONFIG.totalUnits &&
    unitAnalyses.every((unit) => unit.bindingValid) &&
    new Set(unitAnalyses.map((unit) => unit.requestId)).size ===
      EXP0022_CONFIG.totalUnits;
  const attemptBindingsValid = measurementStatus === "EVALUATED" &&
    unitAnalyses.length === EXP0022_CONFIG.totalUnits &&
    unitAnalyses.every((unit) => unit.attemptBindingValid);
  const environment = healthAndEnvironment(
    workerCampaign,
    campaign?.boundary?.expectedRuntimeFingerprintSha256
  );
  const navigationAuditValid = networkAndNavigationAudits(workerCampaign);
  const healthBindingValid =
    bootstrapAuditHealthBindingsValid(workerCampaign);
  const campaignDiagnosticsValid = diagnosticsValid(
    workerCampaign?.diagnostics,
    rawUnits
  );
  const allCaptureQualified = measurementStatus === "EVALUATED" &&
    unitAnalyses.every((unit) => unit.captureQualified);
  const firstTrialIds = new Set(["A1", "B2"]);
  const firstResponsesPass = measurementStatus === "EVALUATED" &&
    unitAnalyses.filter((unit) => firstTrialIds.has(unit.trialId)).length === 2 &&
    unitAnalyses.filter((unit) => firstTrialIds.has(unit.trialId))
      .every((unit) => unit.captureQualified);
  const gates = {
    boundaryAndSupervisor:
      boundaryValid(campaign?.boundary) && workerEnvelopeValid,
    fixedCampaign,
    cdpChainAndResponse: measurementStatus === "EVALUATED"
      ? requestBindingsValid &&
        unitAnalyses.every((unit) => unit.metadataValid)
      : null,
    browserCdpByteIdentity: measurementStatus === "EVALUATED"
      ? unitAnalyses.every((unit) => unit.byteIdentity)
      : null,
    payloadStabilityAndDistinction: measurementStatus === "EVALUATED"
      ? payloadStability(unitAnalyses)
      : null,
    boundedFailClosedCapture: measurementStatus === "EVALUATED"
      ? attemptBindingsValid && allCaptureQualified
      : null,
    firstResponsePerNavigation: measurementStatus === "EVALUATED"
      ? firstResponsesPass
      : null,
    environmentStable: environment.valid,
    negativeBudgetExact: budgetValid(workerCampaign),
    diagnosticsNetworkAndBindings:
      auditsValid(campaign?.audits) && campaignDiagnosticsValid &&
      navigationAuditValid && forbiddenPayloadPresent(campaign) === false
  };
  const structural = {
    outerCampaignShapeValid,
    boundaryValid: boundaryValid(campaign?.boundary),
    workerEnvelopeValid,
    fixedCampaign,
    requestBindingsValid,
    attemptBindingsValid,
    environmentStable: environment.valid,
    negativeBudgetExact: budgetValid(workerCampaign),
    auditsValid: auditsValid(campaign?.audits),
    diagnosticsValid: campaignDiagnosticsValid,
    bootstrapAuditHealthBindingValid: healthBindingValid,
    navigationAuditValid,
    noEmbeddedPayload: forbiddenPayloadPresent(campaign) === false
  };
  const instrumentValid = Object.values(structural).every(
    (value) => value === true
  );
  let decision;
  if (!instrumentValid) {
    decision = EXP0022_DECISIONS.invalidate;
  } else if (CAPTURE_GATE_NAMES.some((name) => gates[name] !== true)) {
    decision = EXP0022_DECISIONS.fix;
  } else if (GATE_NAMES.every((name) => gates[name] === true)) {
    decision = EXP0022_DECISIONS.pass;
  } else {
    decision = EXP0022_DECISIONS.invalidate;
  }
  const transientRecoveryObserved = unitAnalyses.some(
    (unit) => unit.transientRecoveryObserved
  );
  const nextMove = EXP0022_NEXT_MOVES[decision];
  return deepFreeze({
    measurementStatus,
    units: unitAnalyses,
    metrics: {
      navigationCount: Array.isArray(workerCampaign?.navigations)
        ? workerCampaign.navigations.length
        : 0,
      unitCount: rawUnits.length,
      successfulCaptures: unitAnalyses.filter(
        (unit) => unit.captureQualified
      ).length,
      totalReads: unitAnalyses.reduce(
        (total, unit) => total + (unit.readCount ?? 0),
        0
      ),
      transientRecoveries: unitAnalyses.filter(
        (unit) => unit.transientRecoveryObserved
      ).length,
      usageDelta: environment.delta
    },
    structural,
    gates,
    decision,
    nextMove,
    pass: decision === EXP0022_DECISIONS.pass,
    instrumentValid,
    transientRecoveryObserved
  });
}

function reportCore(input, campaign, analysis) {
  return {
    schemaVersion: EXP0022_REPORT_SCHEMA,
    experimentId: EXP0022_EXPERIMENT_ID,
    startedAt: input?.startedAt,
    completedAt: input?.completedAt,
    contract: structuredClone(EXP0022_CONFIG),
    campaign: structuredClone(campaign),
    analysis,
    measurementStatus: analysis.measurementStatus,
    gates: structuredClone(analysis.gates),
    decision: analysis.decision,
    nextMove: structuredClone(analysis.nextMove),
    pass: analysis.pass,
    instrumentValid: analysis.instrumentValid,
    authorityEligible: false,
    transientRecoveryObserved: analysis.transientRecoveryObserved,
    claim: analysis.pass ? EXP0022_PASS_CLAIM : null,
    evidenceAcceptance: {
      status: "PENDING_POST_COMMIT_CHECK",
      requiredChecks: structuredClone(EXP0022_POST_COMMIT_AUDIT_KEYS)
    },
    limitations: [
      "qualifica somente o binding de health e a captura TTS local neste processo e Chrome",
      "não mede recovery transitório quando nenhum vazio precede um sucesso",
      "não mede renderização, STOP, ASR, acústica, conversa ou percepção humana",
      "não autoriza repetir os EXP-0020/0021 nem promover runtime ou modelo"
    ]
  };
}

export function createExp0022Report(input = {}) {
  if (forbiddenPayloadPresent(input?.campaign)) {
    throw new TypeError("relatório EXP-0022 não pode incorporar bytes/base64");
  }
  const campaign = structuredClone(input?.campaign ?? {});
  const analysis = analyzeExp0022Campaign(campaign);
  const timing = {
    startedAt: input?.startedAt ?? campaign?.workerEnvelope?.startedAt,
    completedAt: input?.completedAt ?? campaign?.workerEnvelope?.completedAt
  };
  const core = reportCore(timing, campaign, analysis);
  const report = deepFreeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0022Report(report);
  if (!validation.valid) {
    throw new TypeError(
      `relatório EXP-0022 inválido: ${validation.errors.join("; ")}`
    );
  }
  return report;
}

export function validateExp0022Report(report) {
  const errors = [];
  try {
    if (
      report?.schemaVersion !== EXP0022_REPORT_SCHEMA ||
      report?.experimentId !== EXP0022_EXPERIMENT_ID ||
      !isDeepStrictEqual(report?.contract, EXP0022_CONFIG) ||
      !validDate(report?.startedAt) || !validDate(report?.completedAt) ||
      Date.parse(report.completedAt) < Date.parse(report.startedAt) ||
      (validDate(report?.campaign?.workerEnvelope?.startedAt) &&
        report?.startedAt !== report.campaign.workerEnvelope.startedAt) ||
      (validDate(report?.campaign?.workerEnvelope?.completedAt) &&
        report?.completedAt !== report.campaign.workerEnvelope.completedAt) ||
      forbiddenPayloadPresent(report)
    ) {
      errors.push("identidade, datas, contrato ou política sem bytes divergiram");
    }
    const expected = analyzeExp0022Campaign(report?.campaign);
    if (!isDeepStrictEqual(report?.analysis, expected)) {
      errors.push("análise não corresponde à campanha bruta");
    }
    const expectedCore = reportCore({
      startedAt: report?.startedAt,
      completedAt: report?.completedAt
    }, report?.campaign, expected);
    const observedCore = structuredClone(report ?? {});
    delete observedCore.reportSha256;
    if (!isDeepStrictEqual(observedCore, expectedCore)) {
      errors.push("estrutura ou interpretação canônica divergiram");
    }
    if (
      report?.measurementStatus !== expected.measurementStatus ||
      !isDeepStrictEqual(report?.gates, expected.gates) ||
      report?.decision !== expected.decision ||
      !isDeepStrictEqual(report?.nextMove, expected.nextMove) ||
      report?.pass !== expected.pass ||
      report?.instrumentValid !== expected.instrumentValid ||
      report?.authorityEligible !== false ||
      !isDeepStrictEqual(report?.evidenceAcceptance, {
        status: "PENDING_POST_COMMIT_CHECK",
        requiredChecks: EXP0022_POST_COMMIT_AUDIT_KEYS
      }) ||
      report?.transientRecoveryObserved !==
        expected.transientRecoveryObserved ||
      (expected.pass
        ? report?.claim !== EXP0022_PASS_CLAIM
        : report?.claim !== null)
    ) {
      errors.push("status, decisão, gates, claim ou autoridade divergiram");
    }
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
