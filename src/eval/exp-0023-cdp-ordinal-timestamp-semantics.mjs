import { isDeepStrictEqual } from "node:util";

import {
  EXP0022_ATTEMPT_PATH,
  EXP0022_AUDIT_KEYS,
  EXP0022_CONFIG,
  EXP0022_EXPERIMENT_ID,
  EXP0022_FREEZE_PATH,
  EXP0022_RECEIPT_PATH,
  EXP0022_WORKER_ENVELOPE_SCHEMA,
  analyzeExp0022Campaign
} from "./exp-0022-bootstrap-audit-health-binding.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0023_REPORT_SCHEMA =
  "exp-0023-cdp-ordinal-timestamp-semantics-report-v1";
export const EXP0023_EXPERIMENT_ID = "EXP-0023";
export const EXP0023_REPORT_PATH =
  "eval/reports/exp-0023-cdp-ordinal-timestamp-semantics-v0.1.json";
export const EXP0023_FREEZE_PATH =
  "eval/commitments/exp-0023-instrumentation-freeze-v0.1.json";
export const EXP0023_ATTEMPT_PATH =
  "eval/commitments/exp-0023-capture-attempt-v0.1.json";
export const EXP0023_RECEIPT_PATH =
  "eval/generated/exp-0023/capture-attempt-consumed-v0.1.json";
export const EXP0023_PREREGISTRATION_PATH =
  "docs/experiments/EXP-0023-cdp-ordinal-timestamp-semantics.md";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "base64",
  "base64Body",
  "body",
  "buffer",
  "bytes",
  "rawBytes",
  "wavBytes"
]);
const CAPTURE_GATE_NAMES = Object.freeze([
  "cdpChainAndResponse",
  "browserCdpByteIdentity",
  "payloadStabilityAndDistinction",
  "boundedFailClosedCapture",
  "firstResponsePerNavigation"
]);
const GATE_NAMES = Object.freeze([
  "boundaryAndSupervisor",
  "fixedCampaign",
  ...CAPTURE_GATE_NAMES,
  "environmentStable",
  "negativeBudgetExact",
  "diagnosticsNetworkAndBindings"
]);
const LEGACY_TIMESTAMP_STRUCTURAL_KEYS = new Set([
  "bootstrapAuditHealthBindingValid",
  "navigationAuditValid"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isHealthUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === new URL(EXP0022_CONFIG.targetUrl).origin &&
      url.pathname === "/api/health";
  } catch {
    return false;
  }
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
        value.every((item) =>
          Number.isInteger(item) && item >= 0 && item <= 255)
      ) return true;
      return value.some((item) => forbiddenPayloadPresent(item, null, seen));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) return true;
    return Object.entries(value).some(([nestedKey, nested]) =>
      forbiddenPayloadPresent(nested, nestedKey, seen));
  } finally {
    seen.delete(value);
  }
}

export const EXP0023_PATHS = deepFreeze({
  report: EXP0023_REPORT_PATH,
  freeze: EXP0023_FREEZE_PATH,
  attempt: EXP0023_ATTEMPT_PATH,
  receipt: EXP0023_RECEIPT_PATH,
  preregistration: EXP0023_PREREGISTRATION_PATH
});

export const EXP0023_DECISIONS = deepFreeze({
  invalidate: "INVALIDATE_CDP_LIFECYCLE_ORDER_SEMANTICS",
  fix: "FIX_CDP_TTS_CAPTURE_AFTER_ORDINAL_BINDING",
  pass: "PASS_CDP_TTS_CAPTURE_AFTER_ORDINAL_BINDING"
});

export const EXP0023_NEXT_MOVES = deepFreeze({
  [EXP0023_DECISIONS.invalidate]: {
    action: "REPAIR_REAUDIT_AND_PREREGISTER_NEW_ORDINAL_INSTRUMENT",
    physicalStopPreregistrationAllowed: false,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0023_DECISIONS.fix]: {
    action: "DIAGNOSE_AND_PREREGISTER_CAPTURE_AFTER_ORDINAL_BINDING",
    physicalStopPreregistrationAllowed: false,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  },
  [EXP0023_DECISIONS.pass]: {
    action: "PREREGISTER_NEW_PHYSICAL_STOP_EXPERIMENT_ONLY",
    physicalStopPreregistrationAllowed: true,
    physicalStopExecutionAllowed: false,
    sameExperimentRerunAllowed: false
  }
});

export const EXP0023_AUDIT_KEYS = deepFreeze([
  "instrumentationFreezeValid",
  "openingValid",
  "receiptValid",
  "receiptWriteOnce",
  "receiptBeforeNetwork",
  "supervisorFrozen",
  "inheritedWorkerFrozen",
  "inheritedAdapterFrozen",
  "analyzerFrozen",
  "sourceBindingsValid",
  "rerunRefused"
]);

export const EXP0023_POST_COMMIT_AUDIT_KEYS = deepFreeze([
  "reportBindingValid",
  "canonicalHashValid",
  "gitTopologyValid",
  "evidenceCommitIsolated"
]);

export const EXP0023_CONFIG = deepFreeze({
  orderingAuthority: "cdp-delivery-ordinal-v1",
  legacyCompatibilityProjection:
    "tracked-cdp-lifecycle-timestamps-from-delivery-ordinals-v1",
  inheritedExperimentId: EXP0022_EXPERIMENT_ID,
  inheritedWorkerEnvelopeSchema: EXP0022_WORKER_ENVELOPE_SCHEMA,
  inheritedCampaignCanonicalSha256:
    `sha256:${canonicalSha256(EXP0022_CONFIG)}`,
  targetUrl: EXP0022_CONFIG.targetUrl,
  campaign: structuredClone(EXP0022_CONFIG),
  timestampPolicy: {
    finiteRequired: true,
    requestNotAfterResponse: true,
    requestNotAfterTerminal: true,
    responseTerminalOrderingRequired: false,
    minimumHealthResponseAfterTerminal: 1,
    epsilonMs: null
  },
  authority: {
    mode: "measurement-only",
    canProduceNewEffects: false
  }
});

export const EXP0023_PASS_CLAIM =
  "Qualificação limitada: neste Chrome, processo e dois textos locais, " +
  "ordinais do stream CDP qualificaram o binding de health e 4/4 capturas " +
  "TTS, inclusive com timestamp response/finish invertido, mantendo os " +
  "mesmos bytes observados no browser.";

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
  ]) && boundary?.freezePath === EXP0023_FREEZE_PATH &&
    boundary?.attemptPath === EXP0023_ATTEMPT_PATH &&
    boundary?.receiptPath === EXP0023_RECEIPT_PATH &&
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
  return exactKeys(audits, EXP0023_AUDIT_KEYS) &&
    EXP0023_AUDIT_KEYS.every((key) => audits[key] === true);
}

function legacyOuterCampaign(campaign) {
  const boundary = campaign?.boundary ?? {};
  return {
    boundary: {
      ...structuredClone(boundary),
      freezePath: EXP0022_FREEZE_PATH,
      attemptPath: EXP0022_ATTEMPT_PATH,
      receiptPath: EXP0022_RECEIPT_PATH
    },
    workerEnvelope: structuredClone(campaign?.workerEnvelope),
    audits: Object.fromEntries(EXP0022_AUDIT_KEYS.map((key) => [key, true]))
  };
}

function terminalObservation(request) {
  if (request?.loadingFinishedCount === 1 &&
      request?.loadingFailedCount === 0) {
    return {
      timestamp: request.finishedTimestamp,
      ordinal: request.finishedOrdinal,
      kind: "finished"
    };
  }
  if (request?.loadingFinishedCount === 0 &&
      request?.loadingFailedCount === 1) {
    return {
      timestamp: request.failedTimestamp,
      ordinal: request.failedOrdinal,
      kind: "failed"
    };
  }
  return null;
}

function healthTimestampSummariesBound(workerCampaign) {
  const navigations = workerCampaign?.navigations;
  if (!Array.isArray(navigations)) return false;
  return navigations.every((navigation) => {
    const requests = navigation?.networkRequests;
    if (!Array.isArray(requests)) return false;
    return ["bootstrap", "audit"].every((summaryName) => {
      const summary = navigation?.healthBinding?.[summaryName];
      const matching = requests.filter((request) =>
        request?.requestId === summary?.requestId);
      return matching.length === 1 &&
        summary.requestTimestamp === matching[0].timestamp &&
        summary.responseTimestamp === matching[0].responseTimestamp &&
        summary.finishedTimestamp === matching[0].finishedTimestamp;
    });
  });
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function inspectExp0023TimestampPolicy(workerCampaign) {
  const navigations = workerCampaign?.navigations;
  if (!Array.isArray(navigations)) {
    return deepFreeze({
      valid: false,
      trackedRequests: 0,
      recordedEventOrdinals: 0,
      uniqueRecordedEventOrdinals: 0,
      ordinalLedgerUnique: false,
      navigationOrdinalOrderValid: false,
      responseAfterTerminalCount: 0,
      healthResponseAfterTerminalCount: 0,
      skewMs: { min: null, median: null, p95: null, max: null }
    });
  }
  const requests = navigations.flatMap((navigation) =>
    Array.isArray(navigation?.networkRequests)
      ? navigation.networkRequests
      : []);
  const tracked = requests.filter((request) =>
    request?.tracksLoadingLifecycle === true);
  const eventOrdinals = [];
  let ordinalLedgerValid = requests.length > 0;
  for (const request of requests) {
    if (!Number.isSafeInteger(request?.requestOrdinal) ||
        request.requestOrdinal <= 0) {
      ordinalLedgerValid = false;
    } else {
      eventOrdinals.push(request.requestOrdinal);
    }
    if (request?.tracksLoadingLifecycle !== true) continue;
    const terminal = terminalObservation(request);
    for (const ordinal of [request?.responseOrdinal, terminal?.ordinal]) {
      if (!Number.isSafeInteger(ordinal) || ordinal <= 0) {
        ordinalLedgerValid = false;
      } else {
        eventOrdinals.push(ordinal);
      }
    }
  }
  const uniqueEventOrdinals = new Set(eventOrdinals);
  const ordinalLedgerUnique = ordinalLedgerValid &&
    uniqueEventOrdinals.size === eventOrdinals.length;
  const navigationOrdinalRanges = navigations.map((navigation) => {
    const navigationRequests = Array.isArray(navigation?.networkRequests)
      ? navigation.networkRequests
      : [];
    const ordinals = navigationRequests.flatMap((request) => {
      const terminal = terminalObservation(request);
      return [
        request?.requestOrdinal,
        ...(request?.tracksLoadingLifecycle === true
          ? [request?.responseOrdinal, terminal?.ordinal]
          : [])
      ].filter(Number.isSafeInteger);
    });
    return ordinals.length === 0
      ? null
      : { min: Math.min(...ordinals), max: Math.max(...ordinals) };
  });
  const navigationOrdinalOrderValid = navigationOrdinalRanges.length > 0 &&
    navigationOrdinalRanges.every((range) => range !== null) &&
    navigationOrdinalRanges.every((range, index) => index === 0 ||
      navigationOrdinalRanges[index - 1].max < range.min);
  let valid = tracked.length > 0 && ordinalLedgerUnique &&
    navigationOrdinalOrderValid;
  const inversions = [];
  let healthResponseAfterTerminalCount = 0;
  for (const request of tracked) {
    const terminal = terminalObservation(request);
    const recordValid = terminal !== null &&
      request.responseReceivedCount === 1 &&
      finite(request.timestamp) && finite(request.responseTimestamp) &&
      finite(terminal.timestamp) &&
      Number.isSafeInteger(request.requestOrdinal) &&
      Number.isSafeInteger(request.responseOrdinal) &&
      Number.isSafeInteger(terminal.ordinal) &&
      request.requestOrdinal < request.responseOrdinal &&
      request.responseOrdinal < terminal.ordinal &&
      request.timestamp <= request.responseTimestamp &&
      request.timestamp <= terminal.timestamp;
    valid &&= recordValid;
    if (recordValid && request.responseTimestamp > terminal.timestamp) {
      inversions.push((request.responseTimestamp - terminal.timestamp) * 1000);
      if (isHealthUrl(request.url)) healthResponseAfterTerminalCount += 1;
    }
  }
  return deepFreeze({
    valid,
    trackedRequests: tracked.length,
    recordedEventOrdinals: eventOrdinals.length,
    uniqueRecordedEventOrdinals: uniqueEventOrdinals.size,
    ordinalLedgerUnique,
    navigationOrdinalOrderValid,
    responseAfterTerminalCount: inversions.length,
    healthResponseAfterTerminalCount,
    skewMs: {
      min: inversions.length === 0 ? null : Math.min(...inversions),
      median: percentile(inversions, 0.5),
      p95: percentile(inversions, 0.95),
      max: inversions.length === 0 ? null : Math.max(...inversions)
    }
  });
}

export function createExp0023LegacyCompatibleView(campaign) {
  const legacy = legacyOuterCampaign(campaign);
  const adjustments = [];
  const navigations = legacy?.workerEnvelope?.campaign?.navigations;
  if (!Array.isArray(navigations)) {
    return deepFreeze({ campaign: legacy, adjustments });
  }
  for (const [navigationOffset, navigation] of navigations.entries()) {
    if (!Array.isArray(navigation?.networkRequests)) continue;
    for (const [requestOffset, request] of
      navigation.networkRequests.entries()) {
      const terminal = terminalObservation(request);
      if (
        request?.tracksLoadingLifecycle !== true || terminal === null ||
        !Number.isSafeInteger(request.requestOrdinal) ||
        !Number.isSafeInteger(request.responseOrdinal) ||
        !Number.isSafeInteger(terminal.ordinal)
      ) continue;
      const original = {
        requestTimestamp: request.timestamp,
        responseTimestamp: request.responseTimestamp,
        terminalTimestamp: terminal.timestamp
      };
      request.timestamp = request.requestOrdinal;
      request.responseTimestamp = request.responseOrdinal;
      if (terminal.kind === "finished") {
        request.finishedTimestamp = terminal.ordinal;
      } else {
        request.failedTimestamp = terminal.ordinal;
      }
      adjustments.push({
        navigationIndex: navigationOffset + 1,
        requestIndex: requestOffset,
        requestId: request.requestId,
        kind: terminal.kind,
        from: original,
        to: {
          requestTimestamp: request.requestOrdinal,
          responseTimestamp: request.responseOrdinal,
          terminalTimestamp: terminal.ordinal
        }
      });
      for (const summaryName of ["bootstrap", "audit"]) {
        const summary = navigation?.healthBinding?.[summaryName];
        if (summary?.requestId !== request.requestId) continue;
        summary.requestTimestamp = request.requestOrdinal;
        summary.responseTimestamp = request.responseOrdinal;
        summary.finishedTimestamp = terminal.ordinal;
      }
    }
  }
  return deepFreeze({ campaign: legacy, adjustments });
}

function legacyDeltaIsolated(original, normalized) {
  if (
    original.measurementStatus !== normalized.measurementStatus ||
    !isDeepStrictEqual(original.units, normalized.units) ||
    !isDeepStrictEqual(original.metrics, normalized.metrics)
  ) return false;
  for (const key of Object.keys(original.structural)) {
    if (
      !LEGACY_TIMESTAMP_STRUCTURAL_KEYS.has(key) &&
      original.structural[key] !== normalized.structural[key]
    ) return false;
  }
  for (const key of Object.keys(original.gates)) {
    if (
      key !== "diagnosticsNetworkAndBindings" &&
      original.gates[key] !== normalized.gates[key]
    ) return false;
  }
  return true;
}

export function analyzeExp0023Campaign(campaign) {
  const outerCampaignShapeValid = exactKeys(campaign, [
    "audits", "boundary", "workerEnvelope"
  ]);
  const legacyOriginalCampaign = legacyOuterCampaign(campaign);
  const legacyOriginal = analyzeExp0022Campaign(legacyOriginalCampaign);
  const compatibleView = createExp0023LegacyCompatibleView(campaign);
  const legacyNormalized = analyzeExp0022Campaign(compatibleView.campaign);
  const timestampDiagnostics = inspectExp0023TimestampPolicy(
    campaign?.workerEnvelope?.campaign
  );
  const timestampPolicyValid = timestampDiagnostics.valid;
  const healthSummariesBound = healthTimestampSummariesBound(
    campaign?.workerEnvelope?.campaign
  );
  const prospectiveHealthInversionObserved =
    timestampDiagnostics.healthResponseAfterTerminalCount >=
      EXP0023_CONFIG.timestampPolicy.minimumHealthResponseAfterTerminal;
  const projectionCoverageExact = compatibleView.adjustments.length ===
    timestampDiagnostics.trackedRequests;
  const legacyIsolationValid = projectionCoverageExact &&
    legacyDeltaIsolated(legacyOriginal, legacyNormalized);
  const measurementStatus = outerCampaignShapeValid &&
    legacyOriginal.measurementStatus === "EVALUATED"
    ? "EVALUATED"
    : "NOT_EVALUATED";
  const evaluated = measurementStatus === "EVALUATED";
  const legacyStructural = legacyOriginal.structural;
  const normalizedStructural = legacyNormalized.structural;
  const ownBoundaryValid = boundaryValid(campaign?.boundary);
  const ownAuditsValid = auditsValid(campaign?.audits);
  const noEmbeddedPayload = forbiddenPayloadPresent(campaign) === false;
  const gates = {
    boundaryAndSupervisor:
      ownBoundaryValid && legacyStructural.workerEnvelopeValid,
    fixedCampaign: legacyStructural.fixedCampaign,
    cdpChainAndResponse: evaluated
      ? legacyOriginal.gates.cdpChainAndResponse
      : null,
    browserCdpByteIdentity: evaluated
      ? legacyOriginal.gates.browserCdpByteIdentity
      : null,
    payloadStabilityAndDistinction: evaluated
      ? legacyOriginal.gates.payloadStabilityAndDistinction
      : null,
    boundedFailClosedCapture: evaluated
      ? legacyOriginal.gates.boundedFailClosedCapture
      : null,
    firstResponsePerNavigation: evaluated
      ? legacyOriginal.gates.firstResponsePerNavigation
      : null,
    environmentStable: legacyOriginal.gates.environmentStable,
    negativeBudgetExact: legacyOriginal.gates.negativeBudgetExact,
    diagnosticsNetworkAndBindings:
      ownAuditsValid && timestampPolicyValid &&
      prospectiveHealthInversionObserved && healthSummariesBound &&
      legacyIsolationValid &&
      normalizedStructural.bootstrapAuditHealthBindingValid === true &&
      normalizedStructural.navigationAuditValid === true &&
      legacyNormalized.gates.diagnosticsNetworkAndBindings === true &&
      noEmbeddedPayload
  };
  const structural = {
    outerCampaignShapeValid,
    boundaryValid: ownBoundaryValid,
    workerEnvelopeValid: legacyStructural.workerEnvelopeValid,
    fixedCampaign: legacyStructural.fixedCampaign,
    requestBindingsValid: legacyStructural.requestBindingsValid,
    attemptBindingsValid: legacyStructural.attemptBindingsValid,
    environmentStable: legacyStructural.environmentStable,
    negativeBudgetExact: legacyStructural.negativeBudgetExact,
    auditsValid: ownAuditsValid,
    diagnosticsValid: legacyStructural.diagnosticsValid,
    timestampPolicyValid,
    healthTimestampSummariesBound: healthSummariesBound,
    prospectiveHealthInversionObserved,
    legacyDeltaIsolated: legacyIsolationValid,
    bootstrapAuditHealthBindingValid:
      normalizedStructural.bootstrapAuditHealthBindingValid,
    navigationAuditValid: normalizedStructural.navigationAuditValid,
    noEmbeddedPayload
  };
  const instrumentValid = Object.values(structural).every(
    (value) => value === true
  );
  let decision;
  if (!instrumentValid) {
    decision = EXP0023_DECISIONS.invalidate;
  } else if (CAPTURE_GATE_NAMES.some((name) => gates[name] !== true)) {
    decision = EXP0023_DECISIONS.fix;
  } else if (GATE_NAMES.every((name) => gates[name] === true)) {
    decision = EXP0023_DECISIONS.pass;
  } else {
    decision = EXP0023_DECISIONS.invalidate;
  }
  const units = evaluated ? structuredClone(legacyOriginal.units) : [];
  const metrics = {
    ...structuredClone(legacyOriginal.metrics),
    successfulCaptures: evaluated
      ? legacyOriginal.metrics.successfulCaptures
      : 0,
    totalReads: evaluated ? legacyOriginal.metrics.totalReads : 0,
    transientRecoveries: evaluated
      ? legacyOriginal.metrics.transientRecoveries
      : 0,
    timestampDiagnostics: structuredClone(timestampDiagnostics)
  };
  return deepFreeze({
    measurementStatus,
    units,
    metrics,
    structural,
    gates,
    decision,
    nextMove: EXP0023_NEXT_MOVES[decision],
    pass: decision === EXP0023_DECISIONS.pass,
    instrumentValid,
    transientRecoveryObserved: evaluated &&
      legacyOriginal.transientRecoveryObserved
  });
}

function reportCore(input, campaign, analysis) {
  return {
    schemaVersion: EXP0023_REPORT_SCHEMA,
    experimentId: EXP0023_EXPERIMENT_ID,
    startedAt: input?.startedAt,
    completedAt: input?.completedAt,
    contract: structuredClone(EXP0023_CONFIG),
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
    claim: analysis.pass ? EXP0023_PASS_CLAIM : null,
    evidenceAcceptance: {
      status: "PENDING_POST_COMMIT_CHECK",
      requiredChecks: structuredClone(EXP0023_POST_COMMIT_AUDIT_KEYS)
    },
    limitations: [
      "qualifica somente a semântica ordinal e a captura TTS local neste processo e Chrome",
      "timestamps response/terminal permanecem diagnóstico, não autoridade causal",
      "não mede renderização, STOP, ASR, acústica, conversa ou percepção humana",
      "não autoriza repetir EXP-0020/0021/0022 nem promover runtime ou modelo"
    ]
  };
}

export function createExp0023Report(input = {}) {
  if (forbiddenPayloadPresent(input?.campaign)) {
    throw new TypeError("relatório EXP-0023 não pode incorporar bytes/base64");
  }
  const campaign = structuredClone(input?.campaign ?? {});
  const analysis = analyzeExp0023Campaign(campaign);
  const timing = {
    startedAt: input?.startedAt ?? campaign?.workerEnvelope?.startedAt,
    completedAt: input?.completedAt ?? campaign?.workerEnvelope?.completedAt
  };
  const core = reportCore(timing, campaign, analysis);
  const report = deepFreeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0023Report(report);
  if (!validation.valid) {
    throw new TypeError(
      `relatório EXP-0023 inválido: ${validation.errors.join("; ")}`
    );
  }
  return report;
}

export function validateExp0023Report(report) {
  const errors = [];
  try {
    if (
      report?.schemaVersion !== EXP0023_REPORT_SCHEMA ||
      report?.experimentId !== EXP0023_EXPERIMENT_ID ||
      !isDeepStrictEqual(report?.contract, EXP0023_CONFIG) ||
      !validDate(report?.startedAt) || !validDate(report?.completedAt) ||
      Date.parse(report.completedAt) < Date.parse(report.startedAt) ||
      (validDate(report?.campaign?.workerEnvelope?.startedAt) &&
        report.startedAt !== report.campaign.workerEnvelope.startedAt) ||
      (validDate(report?.campaign?.workerEnvelope?.completedAt) &&
        report.completedAt !== report.campaign.workerEnvelope.completedAt) ||
      forbiddenPayloadPresent(report)
    ) errors.push("identidade, datas, contrato ou política sem bytes divergiram");
    const expected = analyzeExp0023Campaign(report?.campaign);
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
        requiredChecks: EXP0023_POST_COMMIT_AUDIT_KEYS
      }) ||
      report?.transientRecoveryObserved !==
        expected.transientRecoveryObserved ||
      (expected.pass
        ? report?.claim !== EXP0023_PASS_CLAIM
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
