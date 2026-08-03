import { isDeepStrictEqual } from "node:util";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import { measureUsageDelta } from "./runtime-provenance.mjs";

export const EXP0021_REPORT_SCHEMA =
  "exp-0021-cdp-tts-capture-qualification-report-v1";
export const EXP0021_WORKER_ENVELOPE_SCHEMA =
  "exp-0021-worker-envelope-v1";
export const EXP0021_EXPERIMENT_ID = "EXP-0021";
export const EXP0021_REPORT_PATH =
  "eval/reports/exp-0021-cdp-capture-qualification-v0.1.json";
export const EXP0021_FREEZE_PATH =
  "eval/commitments/exp-0021-instrumentation-freeze-v0.1.json";
export const EXP0021_ATTEMPT_PATH =
  "eval/commitments/exp-0021-capture-attempt-v0.1.json";
export const EXP0021_RECEIPT_PATH =
  "eval/generated/exp-0021/capture-attempt-consumed-v0.1.json";
export const EXP0021_PREREGISTRATION_PATH =
  "docs/experiments/EXP-0021-cdp-capture-recovery.md";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const EXP0021_PATHS = deepFreeze({
  report: EXP0021_REPORT_PATH,
  freeze: EXP0021_FREEZE_PATH,
  attempt: EXP0021_ATTEMPT_PATH,
  receipt: EXP0021_RECEIPT_PATH,
  preregistration: EXP0021_PREREGISTRATION_PATH
});

export const EXP0021_PAYLOAD_A = deepFreeze({
  id: "A",
  text: "Esta fala contínua mede uma única parada física do assistente.",
  rate: 1,
  postData: {
    text: "Esta fala contínua mede uma única parada física do assistente."
  }
});

export const EXP0021_PAYLOAD_B = deepFreeze({
  id: "B",
  text: "Esta resposta diferente verifica o vínculo correto da captura local.",
  rate: 1,
  postData: {
    text:
      "Esta resposta diferente verifica o vínculo correto da captura local."
  }
});

export const EXP0021_PAYLOADS = deepFreeze({
  A: EXP0021_PAYLOAD_A,
  B: EXP0021_PAYLOAD_B
});

export const EXP0021_ORDER = deepFreeze([
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

export const EXP0021_CAPTURE_FAILURE_CODES = deepFreeze({
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

export const EXP0021_DECISIONS = deepFreeze({
  invalidate: "INVALIDATE_CDP_TTS_CAPTURE_QUALIFICATION",
  fix: "FIX_CDP_TTS_CAPTURE_QUALIFICATION",
  pass: "PASS_CDP_TTS_CAPTURE_QUALIFICATION"
});

export const EXP0021_NEXT_MOVES = deepFreeze({
  [EXP0021_DECISIONS.invalidate]: {
    action: "REPAIR_REAUDIT_AND_PREREGISTER_NEW_CAPTURE_INSTRUMENT",
    physicalStopPreregistrationAllowed: false,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0021_DECISIONS.fix]: {
    action: "DIAGNOSE_AND_PREREGISTER_MINIMAL_CAPTURE_CHALLENGER",
    physicalStopPreregistrationAllowed: false,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0021_DECISIONS.pass]: {
    action: "PREREGISTER_NEW_PHYSICAL_STOP_EXPERIMENT",
    physicalStopPreregistrationAllowed: true,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  }
});

export const EXP0021_CONFIG = deepFreeze({
  targetUrl: "http://localhost:4173/?automation=1&experiment=0021",
  ttsUrl: "http://localhost:4173/api/tts",
  navigationCount: 2,
  unitsPerNavigation: 2,
  totalUnits: 4,
  ttsRate: 1,
  payloadOrder: EXP0021_ORDER.map((entry) => entry.trialId),
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

export const EXP0021_AUDIT_KEYS = deepFreeze([
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
  "reportBindingValid",
  "canonicalHashValid",
  "gitTopologyValid",
  "rerunRefused"
]);

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TYPED_CAPTURE_FAILURES = new Set(
  Object.values(EXP0021_CAPTURE_FAILURE_CODES)
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
    return unit && error?.url === EXP0021_CONFIG.ttsUrl &&
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
    const target = new URL(EXP0021_CONFIG.targetUrl);
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
    const expected = new URL(EXP0021_CONFIG.ttsUrl);
    return url.href === expected.href &&
      [null, "POST"].includes(networkMethod(record));
  } catch {
    return false;
  }
}

function boundaryValid(boundary) {
  return boundary?.freezePath === EXP0021_FREEZE_PATH &&
    boundary?.attemptPath === EXP0021_ATTEMPT_PATH &&
    boundary?.receiptPath === EXP0021_RECEIPT_PATH &&
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
  return exactKeys(audits, EXP0021_AUDIT_KEYS) &&
    EXP0021_AUDIT_KEYS.every((key) => audits[key] === true);
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
    workerCampaign.navigations.length !== EXP0021_CONFIG.navigationCount ||
    units.length !== EXP0021_CONFIG.totalUnits
  ) return false;
  let flatIndex = 0;
  return workerCampaign.navigations.every((navigation, navigationIndex) =>
    navigation?.index === navigationIndex + 1 &&
    navigation?.targetUrl === EXP0021_CONFIG.targetUrl &&
    Array.isArray(navigation?.units) &&
    navigation.units.length === EXP0021_CONFIG.unitsPerNavigation &&
    navigation.units.every((unit, unitIndex) => {
      const expected = EXP0021_ORDER[flatIndex++];
      const payload = EXP0021_PAYLOADS[expected.payloadId];
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
    envelope?.schemaVersion !== EXP0021_WORKER_ENVELOPE_SCHEMA ||
    !["completed", "capture-failure"].includes(envelope?.status) ||
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
  const maximum = EXP0021_CONFIG.networkEnable.maxResourceBufferSize;
  return unit?.browser?.status === 200 &&
    unit?.browser?.mimeType === "audio/wav" &&
    unit?.cdp?.status === 200 && unit?.cdp?.mimeType === "audio/wav" &&
    finite(encodedDataLength) && encodedDataLength > 0 &&
    encodedDataLength < maximum;
}

function requestBinding(unit, expected) {
  const payload = EXP0021_PAYLOADS[expected.payloadId];
  const requestId = unit?.cdp?.requestId;
  return nonEmptyString(requestId) &&
    Array.isArray(unit?.cdp?.observedRequestIds) &&
    isDeepStrictEqual(unit.cdp.observedRequestIds, [requestId]) &&
    unit.cdp.requestWillBeSentCount === 1 &&
    unit.cdp.responseReceivedCount === 1 &&
    unit.cdp.loadingFinishedCount === 1 &&
    unit.cdp.url === EXP0021_CONFIG.ttsUrl &&
    unit.cdp.method === "POST" &&
    isDeepStrictEqual(unit.cdp.postData, payload.postData) &&
    unit?.browser?.url === EXP0021_CONFIG.ttsUrl;
}

function attemptProtocol(capture, requestId) {
  const attempts = capture?.attempts;
  if (
    !["success", "failure"].includes(capture?.status) ||
    !Number.isSafeInteger(capture?.readCount) ||
    capture.readCount < 0 || capture.readCount > EXP0021_CONFIG.capture.maxReads ||
    !Array.isArray(attempts) || attempts.length !== capture.readCount
  ) return false;

  let previousCompletedAtMs = -Infinity;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (
      attempt?.index !== index + 1 || attempt?.requestId !== requestId ||
      attempt?.delayBeforeMs !==
        EXP0021_CONFIG.capture.delayBeforeReadMs[index] ||
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
      capture.byteLength > EXP0021_CONFIG.capture.minimumWavBytesExclusive &&
      capture.byteLength < EXP0021_CONFIG.capture.maximumWavBytesExclusive;
  }

  if (!TYPED_CAPTURE_FAILURES.has(capture.code)) return false;
  if (capture.code === EXP0021_CAPTURE_FAILURE_CODES.bodyEmpty) {
    return attempts.length === EXP0021_CONFIG.capture.maxReads &&
      attempts.every((attempt) => attempt.outcome === "empty") &&
      capture.emptyReadsBeforeSuccess === null &&
      capture.base64Encoded === null && capture.byteLength === null &&
      capture.sha256 === null && capture.wavValid === false;
  }
  const preReadFailures = new Set([
    EXP0021_CAPTURE_FAILURE_CODES.statusInvalid,
    EXP0021_CAPTURE_FAILURE_CODES.mimeInvalid,
    EXP0021_CAPTURE_FAILURE_CODES.encodedLengthInvalid
  ]);
  if (preReadFailures.has(capture.code)) {
    return attempts.length === 0 && capture.emptyReadsBeforeSuccess === null &&
      capture.base64Encoded === null && capture.byteLength === null &&
      capture.sha256 === null && capture.wavValid === false;
  }
  if (
    capture.code === EXP0021_CAPTURE_FAILURE_CODES.resourceBufferExceeded &&
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
    unit.browser.byteLength > EXP0021_CONFIG.capture.minimumWavBytesExclusive &&
    unit.browser.byteLength < EXP0021_CONFIG.capture.maximumWavBytesExclusive;
  const cdpDigestValid = capture?.status === "success" &&
    HASH_PATTERN.test(capture?.sha256 ?? "") &&
    Number.isSafeInteger(capture?.byteLength) &&
    capture.byteLength > EXP0021_CONFIG.capture.minimumWavBytesExclusive &&
    capture.byteLength < EXP0021_CONFIG.capture.maximumWavBytesExclusive;
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
  if (units.length !== EXP0021_CONFIG.totalUnits) return false;
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
      browserHealthBindings.length === EXP0021_CONFIG.navigationCount &&
      browserHealthBindings.every((binding) =>
        browserHealthBindingValid(binding, beforeIdentity)) &&
      cdpBindingValid(workerCampaign?.browser?.cdpBinding) &&
      fingerprint !== null && fingerprint === afterFingerprint &&
      nonEmptyString(browserProduct) &&
      nonEmptyString(workerCampaign?.browser?.protocolVersion) &&
      before?.brain === EXP0021_CONFIG.provider &&
      after?.brain === EXP0021_CONFIG.provider &&
      before?.asr?.state === EXP0021_CONFIG.asrState &&
      after?.asr?.state === EXP0021_CONFIG.asrState &&
      before?.vadControl?.engine === EXP0021_CONFIG.vadControlEngine &&
      after?.vadControl?.engine === EXP0021_CONFIG.vadControlEngine &&
      before?.vadShadow?.state === EXP0021_CONFIG.vadShadowState &&
      after?.vadShadow?.state === EXP0021_CONFIG.vadShadowState &&
      before?.tts?.state === "ready" && after?.tts?.state === "ready" &&
      before?.tts?.engine === EXP0021_CONFIG.ttsEngine &&
      after?.tts?.engine === EXP0021_CONFIG.ttsEngine &&
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

function browserHealthBindingValid(binding, expectedIdentity) {
  let expectedUrl;
  try {
    expectedUrl = new URL("/api/health", EXP0021_CONFIG.targetUrl).href;
  } catch {
    return false;
  }
  return binding?.url === expectedUrl && binding?.status === 200 &&
    binding?.mimeType === "application/json" &&
    isDeepStrictEqual(healthIdentity(binding?.health), expectedIdentity);
}

function cdpBindingValid(binding) {
  try {
    const endpoint = new URL(binding?.endpoint);
    return binding?.hostPolicy === EXP0021_CONFIG.cdp.hostPolicy &&
      endpoint.protocol === EXP0021_CONFIG.cdp.protocol &&
      endpoint.port === EXP0021_CONFIG.cdp.port &&
      /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(endpoint.hostname) &&
      endpoint.pathname === "/" && endpoint.search === "" &&
      endpoint.hash === "" && endpoint.username === "" &&
      endpoint.password === "" &&
      binding?.initialTarget === EXP0021_CONFIG.cdp.initialTarget &&
      nonEmptyString(binding?.targetId) &&
      binding?.webSocketPath ===
        `${EXP0021_CONFIG.cdp.webSocketPathPrefix}${binding.targetId}`;
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
  return audit?.schemaVersion === "exp-0021-browser-negative-budget-v1" &&
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

function networkAndNavigationAudits(workerCampaign) {
  const navigations = workerCampaign?.navigations;
  if (
    !Array.isArray(navigations) ||
    navigations.length !== EXP0021_CONFIG.navigationCount
  ) return false;
  return navigations.every((navigation, index) => {
    const requests = navigation?.networkRequests;
    const expectedFirst = EXP0021_ORDER[index * 2].trialId;
    const unitRequestIds = (navigation?.units ?? []).map(
      (unit) => unit?.cdp?.requestId
    );
    const ttsRequests = Array.isArray(requests)
      ? requests.filter(isTtsNetworkRecord)
      : [];
    const expectedHealthUrl = new URL(
      "/api/health",
      EXP0021_CONFIG.targetUrl
    ).href;
    const healthRequests = Array.isArray(requests)
      ? requests.filter((request) =>
        networkUrl(request) === expectedHealthUrl &&
        request?.method === "GET")
      : [];
    return Array.isArray(requests) && requests.length > 0 &&
      requests.every((request) => isAllowedLocalUrl(networkUrl(request))) &&
      healthRequests.length === 1 &&
      ttsRequests.length === EXP0021_CONFIG.unitsPerNavigation &&
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
    EXP0021_CONFIG.negativeBudget
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
        value.length > EXP0021_CONFIG.capture.minimumWavBytesExclusive &&
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

export function analyzeExp0021Campaign(campaign) {
  const envelope = campaign?.workerEnvelope;
  const workerCampaign = envelope?.campaign;
  const rawUnits = flattenUnits(workerCampaign);
  const fixedCampaign = fixedCampaignValid(workerCampaign, rawUnits);
  const workerEnvelopeValid = envelopeValid(envelope, rawUnits);
  const measurementStatus = fixedCampaign && workerEnvelopeValid
    ? "EVALUATED"
    : "NOT_EVALUATED";
  const unitAnalyses = measurementStatus === "EVALUATED"
    ? rawUnits.map((unit, index) => analyzeUnit(unit, EXP0021_ORDER[index]))
    : [];
  const requestBindingsValid = measurementStatus === "EVALUATED" &&
    unitAnalyses.length === EXP0021_CONFIG.totalUnits &&
    unitAnalyses.every((unit) => unit.bindingValid) &&
    new Set(unitAnalyses.map((unit) => unit.requestId)).size ===
      EXP0021_CONFIG.totalUnits;
  const attemptBindingsValid = measurementStatus === "EVALUATED" &&
    unitAnalyses.length === EXP0021_CONFIG.totalUnits &&
    unitAnalyses.every((unit) => unit.attemptBindingValid);
  const environment = healthAndEnvironment(
    workerCampaign,
    campaign?.boundary?.expectedRuntimeFingerprintSha256
  );
  const navigationAuditValid = networkAndNavigationAudits(workerCampaign);
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
    boundaryValid: boundaryValid(campaign?.boundary),
    workerEnvelopeValid,
    fixedCampaign,
    requestBindingsValid,
    attemptBindingsValid,
    environmentStable: environment.valid,
    negativeBudgetExact: budgetValid(workerCampaign),
    auditsValid: auditsValid(campaign?.audits),
    diagnosticsValid: campaignDiagnosticsValid,
    navigationAuditValid,
    noEmbeddedPayload: forbiddenPayloadPresent(campaign) === false
  };
  const instrumentValid = Object.values(structural).every(
    (value) => value === true
  );
  let decision;
  if (!instrumentValid) {
    decision = EXP0021_DECISIONS.invalidate;
  } else if (CAPTURE_GATE_NAMES.some((name) => gates[name] !== true)) {
    decision = EXP0021_DECISIONS.fix;
  } else if (GATE_NAMES.every((name) => gates[name] === true)) {
    decision = EXP0021_DECISIONS.pass;
  } else {
    decision = EXP0021_DECISIONS.invalidate;
  }
  const transientRecoveryObserved = unitAnalyses.some(
    (unit) => unit.transientRecoveryObserved
  );
  const nextMove = EXP0021_NEXT_MOVES[decision];
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
    pass: decision === EXP0021_DECISIONS.pass,
    instrumentValid,
    transientRecoveryObserved
  });
}

function reportCore(input, campaign, analysis) {
  return {
    schemaVersion: EXP0021_REPORT_SCHEMA,
    experimentId: EXP0021_EXPERIMENT_ID,
    startedAt: input?.startedAt,
    completedAt: input?.completedAt,
    contract: structuredClone(EXP0021_CONFIG),
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
    claim: analysis.pass
      ? "Qualificação limitada: neste Chrome, processo e dois textos locais, " +
        "4/4 respostas TTS em duas navegações foram associadas e capturadas " +
        "pelo CDP com os mesmos bytes observados no browser, sob retry " +
        "limitado e fail-closed."
      : null,
    limitations: [
      "qualifica somente a captura TTS local pelo CDP neste processo e Chrome",
      "não mede recovery transitório quando nenhum vazio precede um sucesso",
      "não mede renderização, STOP, ASR, acústica, conversa ou percepção humana",
      "não autoriza repetir o EXP-0020 nem promover runtime ou modelo"
    ]
  };
}

export function createExp0021Report(input = {}) {
  if (forbiddenPayloadPresent(input?.campaign)) {
    throw new TypeError("relatório EXP-0021 não pode incorporar bytes/base64");
  }
  const campaign = structuredClone(input?.campaign ?? {});
  const analysis = analyzeExp0021Campaign(campaign);
  const timing = {
    startedAt: input?.startedAt ?? campaign?.workerEnvelope?.startedAt,
    completedAt: input?.completedAt ?? campaign?.workerEnvelope?.completedAt
  };
  const core = reportCore(timing, campaign, analysis);
  const report = deepFreeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0021Report(report);
  if (!validation.valid) {
    throw new TypeError(
      `relatório EXP-0021 inválido: ${validation.errors.join("; ")}`
    );
  }
  return report;
}

export function validateExp0021Report(report) {
  const errors = [];
  try {
    if (
      report?.schemaVersion !== EXP0021_REPORT_SCHEMA ||
      report?.experimentId !== EXP0021_EXPERIMENT_ID ||
      !isDeepStrictEqual(report?.contract, EXP0021_CONFIG) ||
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
    const expected = analyzeExp0021Campaign(report?.campaign);
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
      report?.transientRecoveryObserved !==
        expected.transientRecoveryObserved ||
      (expected.pass
        ? !nonEmptyString(report?.claim) ||
          !report.claim.toLocaleLowerCase("pt-BR").includes("qualifica")
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
