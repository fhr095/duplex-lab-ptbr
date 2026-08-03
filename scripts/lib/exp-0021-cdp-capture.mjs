import { createHash } from "node:crypto";

export const EXP0021_RESPONSE_BODY_RETRY_DELAYS_MS = Object.freeze([
  0,
  8,
  24,
  64
]);

export const EXP0021_NETWORK_ENABLE_OPTIONS = Object.freeze({
  maxTotalBufferSize: 16 * 1024 * 1024,
  maxResourceBufferSize: 2 * 1024 * 1024,
  maxPostDataSize: 64 * 1024,
  enableDurableMessages: false
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteTimestamp(value) {
  return Number.isFinite(value) && value >= 0;
}

function failure(requestId, code, attempts, details = {}) {
  return Object.freeze({
    status: "capture-failure",
    code,
    requestId,
    readCount: attempts.length,
    emptyResponsesBeforeFailure: attempts.filter(
      (attempt) => attempt.outcome === "empty"
    ).length,
    attempts: Object.freeze(attempts.map((attempt) =>
      Object.freeze({ ...attempt })
    )),
    ...details
  });
}

function wavStructureValid(bytes) {
  let cursor = 12;
  let formatSeen = false;
  let dataSeen = false;
  let formatBlockAlign = null;

  while (cursor < bytes.byteLength) {
    if (cursor + 8 > bytes.byteLength) return false;
    const chunkId = bytes.subarray(cursor, cursor + 4).toString("ascii");
    const chunkSize = bytes.readUInt32LE(cursor + 4);
    const chunkStart = cursor + 8;
    const chunkEnd = chunkStart + chunkSize;
    const paddedEnd = chunkEnd + (chunkSize % 2);
    if (chunkEnd < chunkStart || paddedEnd > bytes.byteLength) return false;

    if (chunkId === "fmt ") {
      if (formatSeen || chunkSize < 16) return false;
      const audioFormat = bytes.readUInt16LE(chunkStart);
      const channels = bytes.readUInt16LE(chunkStart + 2);
      const sampleRate = bytes.readUInt32LE(chunkStart + 4);
      const byteRate = bytes.readUInt32LE(chunkStart + 8);
      const blockAlign = bytes.readUInt16LE(chunkStart + 12);
      const bitsPerSample = bytes.readUInt16LE(chunkStart + 14);
      if (
        audioFormat === 0 || channels === 0 || sampleRate === 0 ||
        byteRate === 0 || blockAlign === 0 || bitsPerSample === 0
      ) return false;
      if (
        audioFormat === 1 &&
        (bitsPerSample % 8 !== 0 ||
          blockAlign !== channels * (bitsPerSample / 8) ||
          byteRate !== sampleRate * blockAlign)
      ) return false;
      formatBlockAlign = blockAlign;
      formatSeen = true;
    } else if (chunkId === "data") {
      if (
        !formatSeen || dataSeen || chunkSize === 0 ||
        chunkSize % formatBlockAlign !== 0
      ) return false;
      dataSeen = true;
    }
    cursor = paddedEnd;
  }

  return cursor === bytes.byteLength && formatSeen && dataSeen;
}

export function decodeExp0021WavBody(payload) {
  if (payload === null || typeof payload !== "object") {
    return Object.freeze({
      valid: false,
      code: "CDP_RESPONSE_MALFORMED",
      error: "Network.getResponseBody não retornou um objeto"
    });
  }
  if (payload.base64Encoded !== true) {
    return Object.freeze({
      valid: false,
      code: "CDP_RESPONSE_NOT_BASE64",
      error: "payload WAV precisa declarar base64Encoded=true"
    });
  }
  if (payload.body === "") {
    return Object.freeze({ valid: false, code: "CDP_RESPONSE_BODY_EMPTY" });
  }
  if (!nonEmptyText(payload.body)) {
    return Object.freeze({
      valid: false,
      code: "CDP_RESPONSE_MALFORMED",
      error: "Network.getResponseBody não retornou body textual"
    });
  }
  if (
    payload.body.length % 4 !== 0 ||
    !BASE64_PATTERN.test(payload.body)
  ) {
    return Object.freeze({
      valid: false,
      code: "CDP_RESPONSE_BASE64_INVALID",
      error: "payload WAV contém base64 inválido"
    });
  }
  const bytes = Buffer.from(payload.body, "base64");
  if (bytes.toString("base64") !== payload.body) {
    return Object.freeze({
      valid: false,
      code: "CDP_RESPONSE_BASE64_INVALID",
      error: "round-trip base64 divergiu"
    });
  }
  if (bytes.byteLength >= EXP0021_NETWORK_ENABLE_OPTIONS.maxResourceBufferSize) {
    return Object.freeze({
      valid: false,
      code: "CDP_RESOURCE_BUFFER_EXCEEDED",
      error: "payload WAV atingiu ou excedeu o buffer máximo por recurso"
    });
  }
  if (
    bytes.byteLength <= 44 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 !== bytes.byteLength ||
    !wavStructureValid(bytes)
  ) {
    return Object.freeze({
      valid: false,
      code: "CDP_RESPONSE_WAV_INVALID",
      error: "payload não contém WAV RIFF/WAVE íntegro"
    });
  }
  const sha256 =
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (!HASH_PATTERN.test(sha256)) {
    throw new Error("EXP-0021 invariant: SHA-256 interno inválido");
  }
  return Object.freeze({
    valid: true,
    base64Encoded: true,
    bytes,
    byteLength: bytes.byteLength,
    sha256
  });
}

export async function captureExp0021ResponseBody(options = {}) {
  const requestId = options.requestId;
  const send = options.send;
  const wait = options.wait ?? ((delayMs) => new Promise(
    (resolveWait) => setTimeout(resolveWait, delayMs)
  ));
  const now = options.now ?? (() => performance.now());

  if (!nonEmptyText(requestId)) {
    throw new TypeError("EXP-0021 capture exige requestId não vazio");
  }
  if (typeof send !== "function" || typeof wait !== "function" ||
    typeof now !== "function") {
    throw new TypeError("EXP-0021 capture exige send, wait e now");
  }

  const attempts = [];
  for (const [index, delayBeforeReadMs] of
    EXP0021_RESPONSE_BODY_RETRY_DELAYS_MS.entries()) {
    await wait(delayBeforeReadMs);
    const requestedAtMs = now();
    if (!finiteTimestamp(requestedAtMs)) {
      throw new TypeError("EXP-0021 capture recebeu relógio inválido");
    }
    let payload;
    try {
      payload = await send("Network.getResponseBody", { requestId });
    } catch (error) {
      const completedAtMs = now();
      attempts.push({
        index: index + 1,
        delayBeforeReadMs,
        requestedAtMs,
        completedAtMs,
        outcome: "command-error"
      });
      return failure(requestId, "CDP_COMMAND_ERROR", attempts, {
        error: String(error?.message ?? error).slice(0, 500)
      });
    }
    const completedAtMs = now();
    if (!finiteTimestamp(completedAtMs) || completedAtMs < requestedAtMs) {
      throw new TypeError("EXP-0021 capture recebeu relógio regressivo");
    }
    const decoded = decodeExp0021WavBody(payload);
    if (!decoded.valid && decoded.code === "CDP_RESPONSE_BODY_EMPTY") {
      attempts.push({
        index: index + 1,
        delayBeforeReadMs,
        requestedAtMs,
        completedAtMs,
        outcome: "empty"
      });
      if (index + 1 === EXP0021_RESPONSE_BODY_RETRY_DELAYS_MS.length) {
        return failure(
          requestId,
          "CDP_RESPONSE_BODY_EMPTY_EXHAUSTED",
          attempts
        );
      }
      continue;
    }
    if (!decoded.valid) {
      attempts.push({
        index: index + 1,
        delayBeforeReadMs,
        requestedAtMs,
        completedAtMs,
        outcome: "invalid"
      });
      return failure(requestId, decoded.code, attempts, {
        error: decoded.error ?? null
      });
    }
    attempts.push({
      index: index + 1,
      delayBeforeReadMs,
      requestedAtMs,
      completedAtMs,
      outcome: "captured"
    });
    return Object.freeze({
      status: "captured",
      code: null,
      requestId,
      readCount: attempts.length,
      emptyResponsesBeforeSuccess: attempts.filter(
        (attempt) => attempt.outcome === "empty"
      ).length,
      attempts: Object.freeze(attempts.map((attempt) =>
        Object.freeze({ ...attempt })
      )),
      base64Encoded: decoded.base64Encoded,
      byteLength: decoded.byteLength,
      sha256: decoded.sha256,
      bytes: decoded.bytes
    });
  }
  throw new Error("EXP-0021 invariant: retry terminou sem outcome");
}
