import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EXP0021_NETWORK_ENABLE_OPTIONS,
  EXP0021_RESPONSE_BODY_RETRY_DELAYS_MS,
  captureExp0021ResponseBody,
  decodeExp0021WavBody
} from "../scripts/lib/exp-0021-cdp-capture.mjs";

function wavBytes(seed = 7) {
  const bytes = Buffer.alloc(64, 0);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(20, 40);
  bytes.fill(seed, 44);
  return bytes;
}

function payload(seed = 7) {
  return {
    body: wavBytes(seed).toString("base64"),
    base64Encoded: true
  };
}

function fixture(responses) {
  let time = 100;
  const waits = [];
  const commands = [];
  let responseIndex = 0;
  return {
    waits,
    commands,
    now: () => time++,
    wait: async (delayMs) => {
      waits.push(delayMs);
      time += delayMs;
    },
    send: async (method, params) => {
      commands.push({ method, params });
      const next = responses[responseIndex++];
      if (next instanceof Error) throw next;
      return next;
    }
  };
}

test("configuração congela buffers e quatro delays pré-leitura", () => {
  assert.deepEqual(EXP0021_NETWORK_ENABLE_OPTIONS, {
    maxTotalBufferSize: 16 * 1024 * 1024,
    maxResourceBufferSize: 2 * 1024 * 1024,
    maxPostDataSize: 64 * 1024,
    enableDurableMessages: false
  });
  assert.deepEqual(EXP0021_RESPONSE_BODY_RETRY_DELAYS_MS, [0, 8, 24, 64]);
  assert.equal(EXP0021_RESPONSE_BODY_RETRY_DELAYS_MS.reduce(
    (sum, value) => sum + value, 0
  ), 96);
});

test("sucesso na primeira leitura não cria timer ou comando posterior", async () => {
  const io = fixture([payload(1)]);
  const result = await captureExp0021ResponseBody({
    requestId: "req-a1",
    send: io.send,
    wait: io.wait,
    now: io.now
  });
  assert.equal(result.status, "captured");
  assert.equal(result.readCount, 1);
  assert.equal(result.emptyResponsesBeforeSuccess, 0);
  assert.deepEqual(io.waits, [0]);
  assert.deepEqual(io.commands, [{
    method: "Network.getResponseBody",
    params: { requestId: "req-a1" }
  }]);
  assert.equal(result.byteLength, 64);
  assert.equal(
    result.sha256,
    `sha256:${createHash("sha256").update(wavBytes(1)).digest("hex")}`
  );
});

test("vazio seguido de sucesso relê somente o mesmo requestId", async () => {
  const io = fixture([
    { body: "", base64Encoded: true },
    payload(2)
  ]);
  const result = await captureExp0021ResponseBody({
    requestId: "req-b1",
    send: io.send,
    wait: io.wait,
    now: io.now
  });
  assert.equal(result.status, "captured");
  assert.equal(result.readCount, 2);
  assert.equal(result.emptyResponsesBeforeSuccess, 1);
  assert.deepEqual(io.waits, [0, 8]);
  assert.deepEqual(io.commands.map(({ params }) => params.requestId), [
    "req-b1",
    "req-b1"
  ]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), [
    "empty",
    "captured"
  ]);
});

test("quatro vazios falham sem quinto timer ou comando", async () => {
  const io = fixture(Array.from({ length: 4 }, () => ({
    body: "",
    base64Encoded: true
  })));
  const result = await captureExp0021ResponseBody({
    requestId: "req-empty",
    send: io.send,
    wait: io.wait,
    now: io.now
  });
  assert.equal(result.status, "capture-failure");
  assert.equal(result.code, "CDP_RESPONSE_BODY_EMPTY_EXHAUSTED");
  assert.equal(result.readCount, 4);
  assert.equal(result.emptyResponsesBeforeFailure, 4);
  assert.deepEqual(io.waits, [0, 8, 24, 64]);
  assert.equal(io.commands.length, 4);
  assert.equal(new Set(io.commands.map(({ params }) => params.requestId)).size, 1);
});

test("erro de comando vira falha tipada sem retry", async () => {
  const io = fixture([new Error("CDP disconnected")]);
  const result = await captureExp0021ResponseBody({
    requestId: "req-error",
    send: io.send,
    wait: io.wait,
    now: io.now
  });
  assert.equal(result.status, "capture-failure");
  assert.equal(result.code, "CDP_COMMAND_ERROR");
  assert.equal(result.error, "CDP disconnected");
  assert.deepEqual(io.waits, [0]);
  assert.equal(io.commands.length, 1);
});

test("representação e WAV inválidos falham sem retry", async () => {
  for (const [input, code] of [
    [{ body: "", base64Encoded: false },
      "CDP_RESPONSE_NOT_BASE64"],
    [{ body: payload().body, base64Encoded: false },
      "CDP_RESPONSE_NOT_BASE64"],
    [{ body: "@@@@", base64Encoded: true },
      "CDP_RESPONSE_BASE64_INVALID"],
    [{ body: Buffer.alloc(64).toString("base64"), base64Encoded: true },
      "CDP_RESPONSE_WAV_INVALID"]
  ]) {
    const io = fixture([input]);
    const result = await captureExp0021ResponseBody({
      requestId: `req-${code}`,
      send: io.send,
      wait: io.wait,
      now: io.now
    });
    assert.equal(result.status, "capture-failure");
    assert.equal(result.code, code);
    assert.deepEqual(io.waits, [0]);
    assert.equal(io.commands.length, 1);
  }
});

test("decoder não aceita objeto ausente, body ausente ou RIFF truncado", () => {
  assert.equal(decodeExp0021WavBody(null).code, "CDP_RESPONSE_MALFORMED");
  assert.equal(decodeExp0021WavBody({
    base64Encoded: true
  }).code, "CDP_RESPONSE_MALFORMED");
  const truncated = wavBytes();
  truncated.writeUInt32LE(999, 4);
  assert.equal(decodeExp0021WavBody({
    body: truncated.toString("base64"),
    base64Encoded: true
  }).code, "CDP_RESPONSE_WAV_INVALID");

  const headerOnly = Buffer.alloc(64, 0);
  headerOnly.write("RIFF", 0, "ascii");
  headerOnly.writeUInt32LE(headerOnly.byteLength - 8, 4);
  headerOnly.write("WAVE", 8, "ascii");
  assert.equal(decodeExp0021WavBody({
    body: headerOnly.toString("base64"),
    base64Encoded: true
  }).code, "CDP_RESPONSE_WAV_INVALID");

  const noData = wavBytes();
  noData.write("JUNK", 36, "ascii");
  assert.equal(decodeExp0021WavBody({
    body: noData.toString("base64"),
    base64Encoded: true
  }).code, "CDP_RESPONSE_WAV_INVALID");

  const truncatedFrame = Buffer.alloc(46, 0);
  truncatedFrame.write("RIFF", 0, "ascii");
  truncatedFrame.writeUInt32LE(truncatedFrame.byteLength - 8, 4);
  truncatedFrame.write("WAVE", 8, "ascii");
  truncatedFrame.write("fmt ", 12, "ascii");
  truncatedFrame.writeUInt32LE(16, 16);
  truncatedFrame.writeUInt16LE(1, 20);
  truncatedFrame.writeUInt16LE(1, 22);
  truncatedFrame.writeUInt32LE(16_000, 24);
  truncatedFrame.writeUInt32LE(32_000, 28);
  truncatedFrame.writeUInt16LE(2, 32);
  truncatedFrame.writeUInt16LE(16, 34);
  truncatedFrame.write("data", 36, "ascii");
  truncatedFrame.writeUInt32LE(1, 40);
  assert.equal(decodeExp0021WavBody({
    body: truncatedFrame.toString("base64"),
    base64Encoded: true
  }).code, "CDP_RESPONSE_WAV_INVALID");

  const oversized = Buffer.alloc(
    EXP0021_NETWORK_ENABLE_OPTIONS.maxResourceBufferSize,
    1
  );
  oversized.write("RIFF", 0, "ascii");
  oversized.writeUInt32LE(oversized.byteLength - 8, 4);
  oversized.write("WAVE", 8, "ascii");
  assert.equal(decodeExp0021WavBody({
    body: oversized.toString("base64"),
    base64Encoded: true
  }).code, "CDP_RESOURCE_BUFFER_EXCEEDED");
});

test("argumentos e relógio inválidos falham antes de mascarar contrato", async () => {
  await assert.rejects(
    captureExp0021ResponseBody({ requestId: "", send() {} }),
    /requestId/iu
  );
  await assert.rejects(
    captureExp0021ResponseBody({
      requestId: "req-clock",
      send: async () => payload(),
      wait: async () => {},
      now: () => Number.NaN
    }),
    /relógio/iu
  );
});
