import { once } from "node:events";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { runExp0024BrowserCampaign } from
  "./lib/exp-0024-browser-harness.mjs";
import { createExp0024JournalFrame } from
  "../src/eval/exp-0024-journal.mjs";
import { canonicalJson } from
  "../src/eval/factory/canonical-hash.mjs";

export const EXP0024_WORKER_IPC_SCHEMA = "exp-0024-worker-ipc-v1";
export const EXP0024_SUPERVISOR_ACK_SCHEMA =
  "exp-0024-supervisor-ack-v1";
export const EXP0024_SUPERVISOR_START_SCHEMA =
  "exp-0024-supervisor-start-v1";
export const EXP0024_WORKER_COMMAND =
  "node scripts/run-exp-0024-worker.mjs";

const ACK_TIMEOUT_MS = 30_000;
const MAX_IPC_LINE_CHARS = 5 * 1024 * 1024;

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0024 worker: ${message}`);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).toSorted(), [...keys].toSorted());
}

function writeLine(output, line) {
  invariant(typeof output?.write === "function", "stdout IPC inválido");
  if (output.write(line)) return Promise.resolve();
  return once(output, "drain").then(() => undefined);
}

export function validateExp0024WorkerMessage(message) {
  if (!exactKeys(message, [
    "kind", "payload", "schemaVersion", "sequence", "type"
  ]) || message.schemaVersion !== EXP0024_WORKER_IPC_SCHEMA ||
    message.kind !== "record" ||
    !Number.isSafeInteger(message.sequence) || message.sequence <= 0 ||
    typeof message.type !== "string") return false;
  try {
    createExp0024JournalFrame({
      ordinal: 1,
      type: message.type,
      payload: message.payload
    });
    return true;
  } catch {
    return false;
  }
}

export function validateExp0024SupervisorAck(ack, expectedSequence) {
  return exactKeys(ack, ["schemaVersion", "sequence", "status"]) &&
    ack.schemaVersion === EXP0024_SUPERVISOR_ACK_SCHEMA &&
    ack.sequence === expectedSequence && ack.status === "persisted";
}

export function validateExp0024SupervisorStart(message) {
  return exactKeys(message, ["schemaVersion", "startedAt", "status"]) &&
    message.schemaVersion === EXP0024_SUPERVISOR_START_SCHEMA &&
    message.status === "authorized" &&
    typeof message.startedAt === "string" &&
    Number.isFinite(Date.parse(message.startedAt));
}

export function waitForExp0024SupervisorStart(options = {}) {
  const input = options.input ?? process.stdin;
  const timeoutMs = options.timeoutMs ?? ACK_TIMEOUT_MS;
  invariant(typeof input?.on === "function", "stdin de start inválido");
  invariant(Number.isSafeInteger(timeoutMs) && timeoutMs > 0,
    "timeout de start inválido");
  return new Promise((resolveStart, rejectStart) => {
    const reader = createInterface({ input, crlfDelay: Infinity });
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reader.close();
      rejectStart(new Error("timeout aguardando autorização do supervisor"));
    }, timeoutMs);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.close();
      if (error) rejectStart(error);
      else resolveStart(value);
    };
    reader.once("line", (line) => {
      if (line.length > MAX_IPC_LINE_CHARS) {
        finish(new Error("autorização excedeu limite"));
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        finish(new Error("autorização não é JSON"));
        return;
      }
      if (!validateExp0024SupervisorStart(message)) {
        finish(new Error("autorização divergente"));
        return;
      }
      finish(null, Object.freeze({ ...message }));
    });
    reader.once("error", (error) => finish(error));
    reader.once("close", () => {
      if (!settled) finish(new Error("stdin fechou antes da autorização"));
    });
  });
}

export function createExp0024IpcChannel(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const timeoutMs = options.timeoutMs ?? ACK_TIMEOUT_MS;
  invariant(typeof input?.on === "function", "stdin IPC inválido");
  invariant(Number.isSafeInteger(timeoutMs) && timeoutMs > 0,
    "timeout de ACK inválido");
  const reader = createInterface({ input, crlfDelay: Infinity });
  let sequence = 0;
  let pending = null;
  let closed = false;

  function rejectPending(error) {
    if (pending === null) return;
    clearTimeout(pending.timer);
    const { reject } = pending;
    pending = null;
    reject(error);
  }

  reader.on("line", (line) => {
    if (pending === null) {
      closed = true;
      reader.close();
      return;
    }
    if (line.length > MAX_IPC_LINE_CHARS) {
      rejectPending(new Error("ACK excedeu limite"));
      return;
    }
    let ack;
    try {
      ack = JSON.parse(line);
    } catch {
      rejectPending(new Error("ACK não é JSON"));
      return;
    }
    if (!validateExp0024SupervisorAck(ack, pending.sequence)) {
      rejectPending(new Error("ACK divergente"));
      return;
    }
    clearTimeout(pending.timer);
    const { resolve: resolveAck } = pending;
    pending = null;
    resolveAck();
  });
  reader.on("close", () => {
    closed = true;
    rejectPending(new Error("stdin IPC fechou antes do ACK"));
  });
  reader.on("error", (error) => {
    closed = true;
    rejectPending(error);
  });

  async function emitRecord(type, payload) {
    invariant(!closed, "canal IPC fechado");
    invariant(pending === null, "somente um registro IPC pode ficar em voo");
    sequence += 1;
    const message = {
      schemaVersion: EXP0024_WORKER_IPC_SCHEMA,
      kind: "record",
      sequence,
      type,
      payload
    };
    invariant(validateExp0024WorkerMessage(message),
      `registro IPC ${sequence} inválido`);
    const ack = new Promise((resolveAck, rejectAck) => {
      const timer = setTimeout(() => {
        pending = null;
        rejectAck(new Error(`timeout aguardando ACK ${sequence}`));
      }, timeoutMs);
      pending = { sequence, resolve: resolveAck, reject: rejectAck, timer };
    });
    try {
      await writeLine(output, `${canonicalJson(message)}\n`);
    } catch (error) {
      rejectPending(error);
      throw error;
    }
    await ack;
  }

  return Object.freeze({
    emitRecord,
    get sequence() { return sequence; },
    close() { reader.close(); }
  });
}

export async function runExp0024Worker(options = {}) {
  const startedAt = options.startedAt ??
    process.env.EXP0024_WORKER_STARTED_AT ?? new Date().toISOString();
  const channel = options.channel ?? createExp0024IpcChannel(options.ipc);
  invariant(typeof channel?.emitRecord === "function",
    "channel.emitRecord ausente");
  return (options.runCampaign ?? runExp0024BrowserCampaign)({
    ...options.campaign,
    startedAt,
    emitRecord: channel.emitRecord
  });
}

function errorMessage(error) {
  return String(error?.message ?? error).slice(0, 500);
}

async function main() {
  invariant(process.argv.length === 2, "não aceita argumentos livres");
  const start = await waitForExp0024SupervisorStart();
  const channel = createExp0024IpcChannel();
  try {
    await runExp0024Worker({ channel, startedAt: start.startedAt });
  } catch (error) {
    try {
      await channel.emitRecord("DIAGNOSTIC", {
        category: "structural",
        code: "WORKER_UNCAUGHT",
        message: errorMessage(error),
        navigationIndex: null,
        observedAt: new Date().toISOString(),
        trialId: null
      });
    } catch {
      // O supervisor ainda materializa WORKER_OUTCOME pelo exit do processo.
    }
    process.stderr.write("EXP-0024 worker encerrou com falha\n");
    process.exitCode = 1;
  } finally {
    channel.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) await main();
