import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  EXP0025_SUPERVISOR_ACK_SCHEMA,
  EXP0025_SUPERVISOR_START_SCHEMA,
  EXP0025_WORKER_COMMAND,
  EXP0025_WORKER_IPC_SCHEMA,
  createExp0025IpcChannel,
  runExp0025Worker,
  validateExp0025SupervisorAck,
  validateExp0025SupervisorStart,
  validateExp0025WorkerMessage,
  waitForExp0025SupervisorStart
} from "../scripts/run-exp-0025-worker.mjs";

const NOW = "2026-08-03T12:00:00.000Z";

function diagnosticPayload(message = "diagnóstico") {
  return {
    category: "structural",
    code: "TEST_DIAGNOSTIC",
    message,
    navigationIndex: null,
    observedAt: NOW,
    trialId: null
  };
}

function message(payload = diagnosticPayload()) {
  return {
    schemaVersion: EXP0025_WORKER_IPC_SCHEMA,
    kind: "record",
    sequence: 1,
    type: "DIAGNOSTIC",
    payload
  };
}

test("IPC do worker possui schema fechado e reaproveita o validador do journal", () => {
  assert.equal(EXP0025_WORKER_COMMAND,
    "node scripts/run-exp-0025-worker.mjs");
  assert.equal(validateExp0025WorkerMessage(message()), true);
  assert.equal(validateExp0025WorkerMessage({ ...message(), extra: true }), false);
  assert.equal(validateExp0025WorkerMessage({
    ...message(),
    payload: { ...diagnosticPayload(), bytes: [1, 2] }
  }), false);
  assert.equal(validateExp0025SupervisorAck({
    schemaVersion: EXP0025_SUPERVISOR_ACK_SCHEMA,
    sequence: 1,
    status: "persisted"
  }, 1), true);
  assert.equal(validateExp0025SupervisorAck({
    schemaVersion: EXP0025_SUPERVISOR_ACK_SCHEMA,
    sequence: 2,
    status: "persisted"
  }, 1), false);
  assert.equal(validateExp0025SupervisorStart({
    schemaVersion: EXP0025_SUPERVISOR_START_SCHEMA,
    startedAt: NOW,
    status: "authorized"
  }), true);
});

test("worker não inicia antes da autorização tipada do supervisor", async () => {
  const input = new PassThrough();
  const pending = waitForExp0025SupervisorStart({ input, timeoutMs: 1_000 });
  input.write(`${JSON.stringify({
    schemaVersion: EXP0025_SUPERVISOR_START_SCHEMA,
    startedAt: NOW,
    status: "authorized"
  })}\n`);
  assert.deepEqual(await pending, {
    schemaVersion: EXP0025_SUPERVISOR_START_SCHEMA,
    startedAt: NOW,
    status: "authorized"
  });
  input.destroy();
});

test("canal de ACK assume o mesmo stdin depois da autorização", async () => {
  const input = new PassThrough();
  const startPending = waitForExp0025SupervisorStart({
    input,
    timeoutMs: 1_000
  });
  input.write(`${JSON.stringify({
    schemaVersion: EXP0025_SUPERVISOR_START_SCHEMA,
    startedAt: NOW,
    status: "authorized"
  })}\n`);
  await startPending;

  const output = {
    write(line) {
      const record = JSON.parse(line);
      setImmediate(() => input.write(`${JSON.stringify({
        schemaVersion: EXP0025_SUPERVISOR_ACK_SCHEMA,
        sequence: record.sequence,
        status: "persisted"
      })}\n`));
      return true;
    }
  };
  const channel = createExp0025IpcChannel({ input, output, timeoutMs: 1_000 });
  await channel.emitRecord("DIAGNOSTIC", diagnosticPayload());
  assert.equal(channel.sequence, 1);
  channel.close();
  input.destroy();
});

test("worker só resolve emissão depois do ACK de persistência correspondente", async () => {
  const input = new PassThrough();
  const records = [];
  let acknowledged = false;
  const output = {
    write(line) {
      records.push(JSON.parse(line));
      setImmediate(() => {
        acknowledged = true;
        input.write(`${JSON.stringify({
          schemaVersion: EXP0025_SUPERVISOR_ACK_SCHEMA,
          sequence: records.at(-1).sequence,
          status: "persisted"
        })}\n`);
      });
      return true;
    }
  };
  const channel = createExp0025IpcChannel({ input, output, timeoutMs: 1_000 });
  const pending = channel.emitRecord("DIAGNOSTIC", diagnosticPayload());
  assert.equal(acknowledged, false);
  await pending;
  assert.equal(acknowledged, true);
  assert.equal(records.length, 1);
  assert.equal(records[0].sequence, 1);
  channel.close();
  input.destroy();
});

test("ACK divergente falha fechado e encerra a emissão", async () => {
  const input = new PassThrough();
  const output = {
    write() {
      setImmediate(() => input.write(`${JSON.stringify({
        schemaVersion: EXP0025_SUPERVISOR_ACK_SCHEMA,
        sequence: 999,
        status: "persisted"
      })}\n`));
      return true;
    }
  };
  const channel = createExp0025IpcChannel({ input, output, timeoutMs: 1_000 });
  await assert.rejects(
    channel.emitRecord("DIAGNOSTIC", diagnosticPayload()),
    /ACK divergente/u
  );
  channel.close();
  input.destroy();
});

test("runExp0025Worker injeta início congelado e canal sem monólito stdout", async () => {
  const emitted = [];
  const channel = {
    emitRecord: async (type, payload) => emitted.push({ type, payload })
  };
  const result = await runExp0025Worker({
    channel,
    startedAt: NOW,
    runCampaign: async (options) => {
      assert.equal(options.startedAt, NOW);
      await options.emitRecord("DIAGNOSTIC", diagnosticPayload());
      return { status: "completed", startedAt: options.startedAt };
    }
  });
  assert.deepEqual(result, { status: "completed", startedAt: NOW });
  assert.deepEqual(emitted, [{
    type: "DIAGNOSTIC",
    payload: diagnosticPayload()
  }]);
});
