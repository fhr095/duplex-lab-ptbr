import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { canonicalJson } from "./factory/canonical-hash.mjs";
import { validateExp0025BrowserTrialResult } from
  "../../scripts/lib/exp-0025-browser-trial.mjs";

export const EXP0025_JOURNAL_SCHEMA = "exp-0025-journal-frame-v1";
export const EXP0025_JOURNAL_NONCE = "exp-0025-official-v0.1";

export const EXP0025_JOURNAL_FRAME_TYPES = deepFreeze({
  inProgress: "IN_PROGRESS",
  workerStarted: "WORKER_STARTED",
  healthBefore: "HEALTH_BEFORE",
  browserBound: "BROWSER_BOUND",
  navigationStarted: "NAVIGATION_STARTED",
  navigationAudited: "NAVIGATION_AUDITED",
  networkRequest: "NETWORK_REQUEST",
  networkResponse: "NETWORK_RESPONSE",
  networkTerminal: "NETWORK_TERMINAL",
  networkFailure: "NETWORK_FAILURE",
  diagnostic: "DIAGNOSTIC",
  physicalTrialResult: "PHYSICAL_TRIAL_RESULT",
  captureCompleted: "CAPTURE_COMPLETED",
  navigationCompleted: "NAVIGATION_COMPLETED",
  healthAfter: "HEALTH_AFTER",
  budgetInputs: "BUDGET_INPUTS",
  workerOutcome: "WORKER_OUTCOME"
});

export const EXP0025_JOURNAL_INSPECTION_STATES = deepFreeze({
  empty: "EMPTY",
  valid: "VALID",
  truncatedTail: "TRUNCATED_TAIL",
  invalidCompleteFrame: "INVALID_COMPLETE_FRAME"
});

export const EXP0025_JOURNAL_FORBIDDEN_KEYS = deepFreeze([
  "body",
  "bodyBase64",
  "base64Body",
  "base64",
  "bytes",
  "rawBytes",
  "wavBytes",
  "buffer",
  "Buffer",
  "Uint8Array"
]);

export const EXP0025_JOURNAL_PAYLOAD_KEYS = deepFreeze({
  IN_PROGRESS: ["deadlineMs", "opening", "pid", "startedAt"],
  WORKER_STARTED: ["command", "pid", "startedAt"],
  HEALTH_BEFORE: ["health", "observedAt"],
  BROWSER_BOUND: ["browser", "observedAt"],
  NAVIGATION_STARTED: ["navigationIndex", "startedAt", "targetUrl"],
  NAVIGATION_AUDITED: [
    "auditRequestId",
    "bootstrapRequestId",
    "frameId",
    "health",
    "loaderId",
    "navigationIndex",
    "observedAt",
    "probeId"
  ],
  NETWORK_REQUEST: [
    "auditProbeHeader",
    "frameId",
    "loaderId",
    "method",
    "navigationIndex",
    "postData",
    "redirected",
    "requestId",
    "requestOrdinal",
    "resourceType",
    "timestamp",
    "trialId",
    "url"
  ],
  NETWORK_RESPONSE: [
    "frameId",
    "fromDiskCache",
    "fromServiceWorker",
    "loaderId",
    "mimeType",
    "navigationIndex",
    "requestId",
    "responseOrdinal",
    "status",
    "timestamp",
    "trialId",
    "url"
  ],
  NETWORK_TERMINAL: [
    "encodedDataLength",
    "navigationIndex",
    "requestId",
    "terminalOrdinal",
    "timestamp",
    "trialId"
  ],
  NETWORK_FAILURE: [
    "blockedReason",
    "canceled",
    "errorText",
    "navigationIndex",
    "requestId",
    "terminalOrdinal",
    "timestamp",
    "trialId"
  ],
  DIAGNOSTIC: [
    "category",
    "code",
    "message",
    "navigationIndex",
    "observedAt",
    "trialId"
  ],
  PHYSICAL_TRIAL_RESULT: [
    "completedAt",
    "navigationIndex",
    "requestId",
    "trial",
    "trialId",
    "trialIndex",
    "turnId"
  ],
  CAPTURE_COMPLETED: [
    "accumulatedWaitMs",
    "byteLength",
    "code",
    "completedAt",
    "navigationIndex",
    "readCount",
    "requestId",
    "sha256",
    "status",
    "trialId",
    "trialIndex",
    "turnId"
  ],
  NAVIGATION_COMPLETED: ["completedAt", "navigationIndex"],
  HEALTH_AFTER: ["health", "observedAt"],
  BUDGET_INPUTS: ["inputs", "observedAt"],
  WORKER_OUTCOME: [
    "code",
    "completedAt",
    "exitCode",
    "outcome",
    "signal",
    "status"
  ]
});

const FRAME_KEYS = Object.freeze([
  "nonce",
  "ordinal",
  "payload",
  "schemaVersion",
  "type"
]);
const FRAME_TYPE_SET = new Set(Object.values(EXP0025_JOURNAL_FRAME_TYPES));
const FORBIDDEN_KEY_SET = new Set(
  EXP0025_JOURNAL_FORBIDDEN_KEYS.map((key) => key.toLowerCase())
);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const CAPTURE_STATUSES = new Set(["qualified", "failed"]);
const WORKER_STATUSES = new Set([
  "completed",
  "failed",
  "timed-out",
  "canceled"
]);
const DIAGNOSTIC_CATEGORIES = new Set([
  "console",
  "runtime",
  "http",
  "network",
  "structural"
]);
const WORKER_OUTCOME_KEYS = Object.freeze([
  "kind",
  "protocolError",
  "recordCount",
  "stderrByteLength",
  "stderrSha256",
  "stderrTruncated"
]);
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const NETWORK_PROTOCOLS = new Set([
  ...HTTP_PROTOCOLS,
  "ws:",
  "wss:",
  "about:",
  "blob:",
  "data:"
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

function exactKeys(value, expected) {
  return plainObject(value) &&
    JSON.stringify(Object.keys(value).toSorted()) ===
      JSON.stringify([...expected].toSorted());
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function nullableString(value) {
  return value === null || nonEmptyString(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validUrl(value, protocols = HTTP_PROTOCOLS) {
  if (!nonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return protocols.has(url.protocol);
  } catch {
    return false;
  }
}

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

function inspectJsonSafety(value, path, key, seen, errors) {
  if (key !== null && FORBIDDEN_KEY_SET.has(key.toLowerCase())) {
    errors.push(`${path} usa chave proibida ${key}`);
    return;
  }
  if (
    typeof value === "string" && value.length >= 128 &&
    value.length % 4 === 0 && BASE64_PATTERN.test(value)
  ) {
    errors.push(`${path} contém string compatível com payload base64`);
    return;
  }
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} contém número não finito`);
    return;
  }
  if (typeof value !== "object") {
    errors.push(`${path} contém tipo JSON inválido: ${typeof value}`);
    return;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    errors.push(`${path} contém bytes tipados`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${path} contém referência circular`);
    return;
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        value.length > 44 && value.every((item) =>
          Number.isInteger(item) && item >= 0 && item <= 255)
      ) {
        errors.push(`${path} contém vetor compatível com bytes de áudio`);
        return;
      }
      for (const [index, nested] of value.entries()) {
        inspectJsonSafety(nested, `${path}[${index}]`, null, seen, errors);
      }
      return;
    }
    if (!plainObject(value)) {
      errors.push(`${path} precisa ser objeto JSON simples`);
      return;
    }
    for (const [nestedKey, nested] of Object.entries(value)) {
      inspectJsonSafety(
        nested,
        `${path}.${nestedKey}`,
        nestedKey,
        seen,
        errors
      );
    }
  } finally {
    seen.delete(value);
  }
}

function validateOpening(opening, errors) {
  add(errors, exactKeys(opening, [
    "canonicalSha256",
    "commit",
    "fileSha256",
    "path"
  ]), "payload.opening possui schema inválido");
  if (!plainObject(opening)) return;
  add(errors, nonEmptyString(opening.path), "opening.path inválido");
  add(errors, HASH_PATTERN.test(opening.fileSha256 ?? ""),
    "opening.fileSha256 inválido");
  add(errors, HASH_PATTERN.test(opening.canonicalSha256 ?? ""),
    "opening.canonicalSha256 inválido");
  add(errors, COMMIT_PATTERN.test(opening.commit ?? ""),
    "opening.commit inválido");
}

function validatePostData(postData, errors) {
  if (postData === null) return;
  add(errors, exactKeys(postData, ["text"]), "postData possui schema inválido");
  if (plainObject(postData)) {
    add(errors, nonEmptyString(postData.text), "postData.text inválido");
  }
}

function validateTrialIdentity(payload, errors) {
  add(errors, positiveInteger(payload.navigationIndex),
    "navigationIndex precisa ser inteiro positivo");
  add(errors, positiveInteger(payload.trialIndex),
    "trialIndex precisa ser inteiro positivo");
  add(errors, nonEmptyString(payload.trialId), "trialId inválido");
  add(errors, nonEmptyString(payload.turnId), "turnId inválido");
}

function validateNetworkIdentity(payload, errors) {
  add(errors, positiveInteger(payload.navigationIndex),
    "navigationIndex precisa ser inteiro positivo");
  add(errors, nullableString(payload.trialId), "trialId de rede inválido");
  add(errors, nonEmptyString(payload.requestId), "requestId de rede inválido");
}

function validatePayload(type, payload, errors) {
  const keys = EXP0025_JOURNAL_PAYLOAD_KEYS[type];
  add(errors, Array.isArray(keys) && exactKeys(payload, keys),
    `payload ${String(type)} possui chaves divergentes`);
  if (!plainObject(payload) || !Array.isArray(keys)) return;

  switch (type) {
    case EXP0025_JOURNAL_FRAME_TYPES.inProgress:
      add(errors, validDate(payload.startedAt), "IN_PROGRESS.startedAt inválido");
      add(errors, positiveInteger(payload.pid), "IN_PROGRESS.pid inválido");
      add(errors, payload.deadlineMs === 600_000,
        "IN_PROGRESS.deadlineMs precisa ser 600000");
      validateOpening(payload.opening, errors);
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.workerStarted:
      add(errors, validDate(payload.startedAt), "WORKER_STARTED.startedAt inválido");
      add(errors, positiveInteger(payload.pid), "WORKER_STARTED.pid inválido");
      add(errors, nonEmptyString(payload.command), "WORKER_STARTED.command inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.healthBefore:
    case EXP0025_JOURNAL_FRAME_TYPES.healthAfter:
      add(errors, validDate(payload.observedAt), `${type}.observedAt inválido`);
      add(errors, plainObject(payload.health) &&
        Object.keys(payload.health).length > 0, `${type}.health inválido`);
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.browserBound:
      add(errors, validDate(payload.observedAt),
        "BROWSER_BOUND.observedAt inválido");
      add(errors, plainObject(payload.browser) &&
        Object.keys(payload.browser).length > 0,
      "BROWSER_BOUND.browser inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.navigationStarted:
      add(errors, positiveInteger(payload.navigationIndex),
        "NAVIGATION_STARTED.navigationIndex inválido");
      add(errors, validDate(payload.startedAt),
        "NAVIGATION_STARTED.startedAt inválido");
      add(errors, validUrl(payload.targetUrl),
        "NAVIGATION_STARTED.targetUrl inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.navigationAudited:
      add(errors, positiveInteger(payload.navigationIndex),
        "NAVIGATION_AUDITED.navigationIndex inválido");
      add(errors, validDate(payload.observedAt),
        "NAVIGATION_AUDITED.observedAt inválido");
      for (const key of [
        "probeId",
        "bootstrapRequestId",
        "auditRequestId",
        "frameId",
        "loaderId"
      ]) add(errors, nonEmptyString(payload[key]), `${key} inválido`);
      add(errors, plainObject(payload.health) &&
        Object.keys(payload.health).length > 0,
      "NAVIGATION_AUDITED.health inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.networkRequest:
      validateNetworkIdentity(payload, errors);
      add(errors, positiveInteger(payload.requestOrdinal),
        "NETWORK_REQUEST.requestOrdinal inválido");
      add(errors, nonNegativeFinite(payload.timestamp),
        "NETWORK_REQUEST.timestamp inválido");
      add(errors, validUrl(payload.url, NETWORK_PROTOCOLS),
        "NETWORK_REQUEST.url inválido");
      add(errors, nonEmptyString(payload.method) &&
        payload.method === payload.method.toUpperCase(),
      "NETWORK_REQUEST.method inválido");
      add(errors, nullableString(payload.auditProbeHeader),
        "NETWORK_REQUEST.auditProbeHeader inválido");
      add(errors, typeof payload.redirected === "boolean",
        "NETWORK_REQUEST.redirected inválido");
      for (const key of ["frameId", "loaderId", "resourceType"]) {
        add(errors, nullableString(payload[key]), `NETWORK_REQUEST.${key} inválido`);
      }
      validatePostData(payload.postData, errors);
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.networkResponse:
      validateNetworkIdentity(payload, errors);
      add(errors, positiveInteger(payload.responseOrdinal),
        "NETWORK_RESPONSE.responseOrdinal inválido");
      add(errors, nonNegativeFinite(payload.timestamp),
        "NETWORK_RESPONSE.timestamp inválido");
      add(errors, validUrl(payload.url, NETWORK_PROTOCOLS),
        "NETWORK_RESPONSE.url inválido");
      add(errors, Number.isInteger(payload.status) &&
        payload.status >= 100 && payload.status <= 599,
      "NETWORK_RESPONSE.status inválido");
      add(errors, nonEmptyString(payload.mimeType),
        "NETWORK_RESPONSE.mimeType inválido");
      for (const key of ["frameId", "loaderId"]) {
        add(errors, nullableString(payload[key]), `NETWORK_RESPONSE.${key} inválido`);
      }
      add(errors, typeof payload.fromDiskCache === "boolean",
        "NETWORK_RESPONSE.fromDiskCache inválido");
      add(errors, typeof payload.fromServiceWorker === "boolean",
        "NETWORK_RESPONSE.fromServiceWorker inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.networkTerminal:
      validateNetworkIdentity(payload, errors);
      add(errors, positiveInteger(payload.terminalOrdinal),
        "NETWORK_TERMINAL.terminalOrdinal inválido");
      add(errors, nonNegativeFinite(payload.timestamp),
        "NETWORK_TERMINAL.timestamp inválido");
      add(errors, nonNegativeFinite(payload.encodedDataLength),
        "NETWORK_TERMINAL.encodedDataLength inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.networkFailure:
      validateNetworkIdentity(payload, errors);
      add(errors, positiveInteger(payload.terminalOrdinal),
        "NETWORK_FAILURE.terminalOrdinal inválido");
      add(errors, nonNegativeFinite(payload.timestamp),
        "NETWORK_FAILURE.timestamp inválido");
      add(errors, nonEmptyString(payload.errorText),
        "NETWORK_FAILURE.errorText inválido");
      add(errors, typeof payload.canceled === "boolean",
        "NETWORK_FAILURE.canceled inválido");
      add(errors, nullableString(payload.blockedReason),
        "NETWORK_FAILURE.blockedReason inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.diagnostic:
      add(errors, DIAGNOSTIC_CATEGORIES.has(payload.category),
        "DIAGNOSTIC.category inválido");
      add(errors, nonEmptyString(payload.code), "DIAGNOSTIC.code inválido");
      add(errors, typeof payload.message === "string",
        "DIAGNOSTIC.message inválido");
      add(errors, payload.navigationIndex === null ||
        positiveInteger(payload.navigationIndex),
      "DIAGNOSTIC.navigationIndex inválido");
      add(errors, nullableString(payload.trialId),
        "DIAGNOSTIC.trialId inválido");
      add(errors, validDate(payload.observedAt),
        "DIAGNOSTIC.observedAt inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.physicalTrialResult:
      validateTrialIdentity(payload, errors);
      add(errors, nullableString(payload.requestId),
        "PHYSICAL_TRIAL_RESULT.requestId inválido");
      add(errors, validDate(payload.completedAt),
        "PHYSICAL_TRIAL_RESULT.completedAt inválido");
      add(errors, validateExp0025BrowserTrialResult(payload.trial).valid,
        "PHYSICAL_TRIAL_RESULT.trial tipado inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.captureCompleted: {
      validateTrialIdentity(payload, errors);
      add(errors, validDate(payload.completedAt),
        "CAPTURE_COMPLETED.completedAt inválido");
      add(errors, CAPTURE_STATUSES.has(payload.status),
        "CAPTURE_COMPLETED.status inválido");
      add(errors, nonNegativeInteger(payload.readCount) &&
        payload.readCount <= 4, "CAPTURE_COMPLETED.readCount inválido");
      add(errors, nonNegativeFinite(payload.accumulatedWaitMs) &&
        payload.accumulatedWaitMs <= 96,
      "CAPTURE_COMPLETED.accumulatedWaitMs inválido");
      const hashValid = payload.sha256 === null ||
        HASH_PATTERN.test(payload.sha256 ?? "");
      const lengthValid = payload.byteLength === null ||
        nonNegativeInteger(payload.byteLength);
      add(errors, hashValid, "CAPTURE_COMPLETED.sha256 inválido");
      add(errors, lengthValid, "CAPTURE_COMPLETED.byteLength inválido");
      add(errors, (payload.sha256 === null) === (payload.byteLength === null),
        "CAPTURE_COMPLETED hash/tamanho precisam coexistir");
      if (payload.status === "qualified") {
        add(errors, nonEmptyString(payload.requestId),
          "captura qualificada exige requestId");
        add(errors, payload.code === null, "captura qualificada não aceita code");
        add(errors, payload.readCount >= 1,
          "captura qualificada exige ao menos uma leitura");
        add(errors, HASH_PATTERN.test(payload.sha256 ?? ""),
          "captura qualificada exige SHA-256");
        add(errors, nonNegativeInteger(payload.byteLength) &&
          payload.byteLength > 44 && payload.byteLength < 2_097_152,
        "captura qualificada exige tamanho WAV limitado");
      } else if (payload.status === "failed") {
        add(errors, nullableString(payload.requestId),
          "captura falha possui requestId inválido");
        add(errors, nonEmptyString(payload.code),
          "captura falha exige code");
      }
      break;
    }
    case EXP0025_JOURNAL_FRAME_TYPES.navigationCompleted:
      add(errors, positiveInteger(payload.navigationIndex),
        "NAVIGATION_COMPLETED.navigationIndex inválido");
      add(errors, validDate(payload.completedAt),
        "NAVIGATION_COMPLETED.completedAt inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.budgetInputs:
      add(errors, validDate(payload.observedAt),
        "BUDGET_INPUTS.observedAt inválido");
      add(errors, plainObject(payload.inputs) &&
        Object.keys(payload.inputs).length > 0,
      "BUDGET_INPUTS.inputs inválido");
      break;
    case EXP0025_JOURNAL_FRAME_TYPES.workerOutcome:
      add(errors, validDate(payload.completedAt),
        "WORKER_OUTCOME.completedAt inválido");
      add(errors, WORKER_STATUSES.has(payload.status),
        "WORKER_OUTCOME.status inválido");
      add(errors, payload.exitCode === null || Number.isSafeInteger(payload.exitCode),
        "WORKER_OUTCOME.exitCode inválido");
      add(errors, nullableString(payload.signal),
        "WORKER_OUTCOME.signal inválido");
      add(errors, nullableString(payload.code), "WORKER_OUTCOME.code inválido");
      add(errors, exactKeys(payload.outcome, WORKER_OUTCOME_KEYS),
        "WORKER_OUTCOME.outcome possui schema inválido");
      if (plainObject(payload.outcome)) {
        add(errors, nonEmptyString(payload.outcome.kind),
          "WORKER_OUTCOME.outcome.kind inválido");
        add(errors, nullableString(payload.outcome.protocolError),
          "WORKER_OUTCOME.outcome.protocolError inválido");
        add(errors, nonNegativeInteger(payload.outcome.recordCount),
          "WORKER_OUTCOME.outcome.recordCount inválido");
        add(errors, nonNegativeInteger(payload.outcome.stderrByteLength),
          "WORKER_OUTCOME.outcome.stderrByteLength inválido");
        add(errors, HASH_PATTERN.test(payload.outcome.stderrSha256 ?? ""),
          "WORKER_OUTCOME.outcome.stderrSha256 inválido");
        add(errors, typeof payload.outcome.stderrTruncated === "boolean",
          "WORKER_OUTCOME.outcome.stderrTruncated inválido");
      }
      break;
    default:
      errors.push(`tipo de frame desconhecido: ${String(type)}`);
  }
}

export function validateExp0025JournalFrame(frame, options = {}) {
  const errors = [];
  try {
    inspectJsonSafety(frame, "$", null, new Set(), errors);
    add(errors, exactKeys(frame, FRAME_KEYS), "frame possui chaves divergentes");
    if (!plainObject(frame)) {
      return deepFreeze({ valid: false, errors });
    }
    add(errors, frame.schemaVersion === EXP0025_JOURNAL_SCHEMA,
      "schemaVersion divergente");
    add(errors, frame.nonce === EXP0025_JOURNAL_NONCE,
      "nonce divergente");
    add(errors, positiveInteger(frame.ordinal), "ordinal precisa ser positivo");
    if (options.expectedOrdinal !== undefined) {
      add(errors, frame.ordinal === options.expectedOrdinal,
        `ordinal esperado ${options.expectedOrdinal}`);
    }
    add(errors, FRAME_TYPE_SET.has(frame.type), "type desconhecido");
    validatePayload(frame.type, frame.payload, errors);
  } catch (error) {
    errors.push(`frame malformado: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function createExp0025JournalFrame(input = {}) {
  const candidate = {
    schemaVersion: input.schemaVersion ?? EXP0025_JOURNAL_SCHEMA,
    nonce: input.nonce ?? EXP0025_JOURNAL_NONCE,
    ordinal: input.ordinal,
    type: input.type,
    payload: input.payload
  };
  const validation = validateExp0025JournalFrame(candidate, {
    expectedOrdinal: input.expectedOrdinal
  });
  if (!validation.valid) {
    throw new TypeError(
      `frame EXP-0025 inválido: ${validation.errors.join("; ")}`
    );
  }
  return deepFreeze(JSON.parse(canonicalJson(candidate)));
}

function validateFrameSequence(frames) {
  const errors = [];
  if (frames.length === 0) return errors;
  if (frames[0]?.type !== EXP0025_JOURNAL_FRAME_TYPES.inProgress) {
    errors.push("primeiro frame precisa ser IN_PROGRESS");
  }
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index]?.type === EXP0025_JOURNAL_FRAME_TYPES.inProgress) {
      errors.push("IN_PROGRESS só pode ocupar o primeiro frame");
    }
  }
  const outcomes = frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) =>
      frame?.type === EXP0025_JOURNAL_FRAME_TYPES.workerOutcome);
  if (outcomes.length > 1) errors.push("WORKER_OUTCOME não pode se repetir");
  if (outcomes.length === 1 && outcomes[0].index !== frames.length - 1) {
    errors.push("WORKER_OUTCOME precisa ser o último frame");
  }
  return errors;
}

export function serializeExp0025JournalFrame(frame, options = {}) {
  const validation = validateExp0025JournalFrame(frame, options);
  if (!validation.valid) {
    throw new TypeError(
      `frame EXP-0025 inválido: ${validation.errors.join("; ")}`
    );
  }
  return `${canonicalJson(frame)}\n`;
}

export function serializeExp0025Journal(frames) {
  if (!Array.isArray(frames)) {
    throw new TypeError("journal EXP-0025 exige array de frames");
  }
  const normalized = frames.map((frame, index) => {
    const validation = validateExp0025JournalFrame(frame, {
      expectedOrdinal: index + 1
    });
    if (!validation.valid) {
      throw new TypeError(
        `frame ${index + 1} inválido: ${validation.errors.join("; ")}`
      );
    }
    return frame;
  });
  const sequenceErrors = validateFrameSequence(normalized);
  if (sequenceErrors.length > 0) {
    throw new TypeError(`sequência EXP-0025 inválida: ${sequenceErrors.join("; ")}`);
  }
  return normalized.map((frame) => `${canonicalJson(frame)}\n`).join("");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function resultFor(bytes, tail, status, frames, errors) {
  return deepFreeze({
    status,
    valid: status === EXP0025_JOURNAL_INSPECTION_STATES.valid,
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
    tailSha256: sha256(tail),
    tailByteLength: tail.byteLength,
    completeFrameCount: frames.length,
    nextOrdinal: frames.length + 1,
    frames: JSON.parse(canonicalJson(frames)),
    errors: [...errors]
  });
}

export function inspectExp0025Journal(bytes) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) {
    throw new TypeError("inspectExp0025Journal exige Buffer ou Uint8Array");
  }
  const journal = Buffer.from(bytes);
  const empty = Buffer.alloc(0);
  if (journal.byteLength === 0) {
    return resultFor(
      journal,
      empty,
      EXP0025_JOURNAL_INSPECTION_STATES.empty,
      [],
      []
    );
  }

  const frames = [];
  const errors = [];
  let lineStart = 0;
  let invalid = false;
  for (let index = 0; index < journal.byteLength; index += 1) {
    if (journal[index] !== 0x0a) continue;
    const lineBytes = journal.subarray(lineStart, index);
    lineStart = index + 1;
    let text;
    try {
      text = UTF8_DECODER.decode(lineBytes);
    } catch {
      errors.push(`frame completo ${frames.length + 1} não é UTF-8 válido`);
      invalid = true;
      break;
    }
    if (text.length === 0) {
      errors.push(`frame completo ${frames.length + 1} está vazio`);
      invalid = true;
      break;
    }
    let frame;
    try {
      frame = JSON.parse(text);
    } catch (error) {
      errors.push(
        `frame completo ${frames.length + 1} não é JSON: ${error.message}`
      );
      invalid = true;
      break;
    }
    const validation = validateExp0025JournalFrame(frame, {
      expectedOrdinal: frames.length + 1
    });
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) =>
        `frame completo ${frames.length + 1}: ${error}`));
      invalid = true;
      break;
    }
    let canonical;
    try {
      canonical = canonicalJson(frame);
    } catch (error) {
      errors.push(`frame completo ${frames.length + 1}: ${error.message}`);
      invalid = true;
      break;
    }
    if (text !== canonical) {
      errors.push(`frame completo ${frames.length + 1} não é JSON canônico`);
      invalid = true;
      break;
    }
    frames.push(JSON.parse(canonical));
  }

  const lastNewline = journal.lastIndexOf(0x0a);
  const tail = lastNewline === journal.byteLength - 1
    ? empty
    : journal.subarray(lastNewline + 1);
  if (!invalid) {
    errors.push(...validateFrameSequence(frames));
    invalid = errors.length > 0;
  }
  if (invalid) {
    return resultFor(
      journal,
      tail,
      EXP0025_JOURNAL_INSPECTION_STATES.invalidCompleteFrame,
      frames,
      errors
    );
  }
  if (tail.byteLength > 0) {
    return resultFor(
      journal,
      tail,
      EXP0025_JOURNAL_INSPECTION_STATES.truncatedTail,
      frames,
      []
    );
  }
  return resultFor(
    journal,
    empty,
    EXP0025_JOURNAL_INSPECTION_STATES.valid,
    frames,
    []
  );
}
