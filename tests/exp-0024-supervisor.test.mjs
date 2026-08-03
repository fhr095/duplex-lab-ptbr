import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  EXP0024_BOUNDARY_PATHS,
  EXP0024_CONFIG
} from "../src/eval/exp-0024-boundary.mjs";
import {
  EXP0024_JOURNAL_FRAME_TYPES,
  EXP0024_JOURNAL_INSPECTION_STATES,
  inspectExp0024Journal
} from "../src/eval/exp-0024-journal.mjs";
import {
  EXP0024_DECISIONS,
  EXP0024_EXECUTION_STATES
} from "../src/eval/exp-0024-stop-order.mjs";
import {
  EXP0024_RECEIPT_SCHEMA,
  consumeExp0024Attempt,
  createExp0024AttemptReceipt,
  createExp0024JournalWriter,
  createExp0024ReportFromArtifacts,
  runExp0024Supervisor,
  runExp0024WorkerProcess,
  validateExp0024AttemptReceipt,
  writeExp0024AtomicWriteOnce
} from "../scripts/run-exp-0024-supervisor.mjs";
import {
  EXP0024_SUPERVISOR_ACK_SCHEMA,
  EXP0024_SUPERVISOR_START_SCHEMA,
  EXP0024_WORKER_IPC_SCHEMA
} from "../scripts/run-exp-0024-worker.mjs";
import {
  runExp0024Preflight,
  validateExp0024PreflightHealth
} from "../scripts/open-exp-0024-physical-stop-attempt.mjs";

const NOW = "2026-08-03T12:00:00.000Z";
const COMMIT = "a".repeat(40);
const OPENING_HASH = `sha256:${"b".repeat(64)}`;

function fakeBoundary(projectRoot = "/tmp/exp0024-fixture") {
  const opening = {
    campaign: { nonce: "exp-0024-official-v0.1" },
    physicalStopAttemptSha256: OPENING_HASH
  };
  const openingBytes = Buffer.from(`${JSON.stringify(opening)}\n`);
  return {
    projectRoot,
    freeze: { runtimeBinding: { sha256: "c".repeat(64) } },
    freezeBytes: Buffer.from("freeze\n"),
    freezeCommit: "d".repeat(40),
    opening,
    openingBytes,
    openingCommit: COMMIT,
    expectedRuntimeFingerprintSha256: "c".repeat(64)
  };
}

function receipt(boundary, input = {}) {
  return createExp0024AttemptReceipt(boundary, {
    consumedAt: input.consumedAt ?? NOW,
    supervisorPid: input.supervisorPid ?? 123
  });
}

function inProgress(boundary, attempt) {
  return {
    deadlineMs: EXP0024_CONFIG.attemptDeadlineMs,
    opening: structuredClone(attempt.opening),
    pid: attempt.supervisorPid,
    startedAt: attempt.consumedAt
  };
}

function preflightHealth() {
  return {
    process: {
      runId: "runtime-1",
      runtimeFingerprint: { sha256: "c".repeat(64), fileCount: 321 }
    },
    brain: "local",
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    asr: { state: "disabled" },
    vadControl: { engine: "adaptive-energy-vad", state: "ready" },
    vadShadow: { state: "disabled" },
    tts: {
      state: "ready",
      engine: "windows-system-speech",
      voice: "Microsoft Maria Desktop",
      culture: "pt-BR"
    }
  };
}

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "exp0024-supervisor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeProjectFile(root, relative, bytes) {
  const path = join(root, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

test("receipt write-once liga opening, nonce, PID e deadline", async (t) => {
  const root = await temporaryRoot(t);
  const boundary = fakeBoundary(root);
  const attempt = receipt(boundary);
  assert.equal(attempt.schemaVersion, EXP0024_RECEIPT_SCHEMA);
  assert.equal(validateExp0024AttemptReceipt(attempt, boundary), true);
  assert.equal(attempt.opening.commit, COMMIT);
  assert.equal(attempt.deadlineMs, 600_000);
  assert.equal(attempt.rerunAllowed, false);
  const consumed = await consumeExp0024Attempt(boundary, {
    consumedAt: NOW,
    supervisorPid: 123
  });
  assert.deepEqual(consumed.receipt, attempt);
  await assert.rejects(
    consumeExp0024Attempt(boundary, { consumedAt: NOW, supervisorPid: 123 }),
    /EEXIST/u
  );
});

test("preflight lê apenas health/CDP version e não abre target ou STOP", async () => {
  const health = preflightHealth();
  assert.equal(validateExp0024PreflightHealth(health, "c".repeat(64)), true);
  assert.equal(validateExp0024PreflightHealth({
    ...health,
    brain: "openai"
  }, "c".repeat(64)), false);
  const urls = [];
  const result = await runExp0024Preflight({
    freeze: {
      nodeVersion: process.version,
      runtimeBinding: { sha256: "c".repeat(64) }
    },
    fetchHealth: async () => health,
    cdpUrl: "http://172.20.32.1:9223/",
    fetchImpl: async (url) => {
      urls.push(new URL(url).href);
      return {
        ok: true,
        async json() {
          return {
            Browser: "Chrome/150.0.7871.187",
            "Protocol-Version": "1.3"
          };
        }
      };
    },
    completedAt: NOW
  });
  assert.deepEqual(urls, ["http://172.20.32.1:9223/json/version"]);
  assert.equal(result.targetAutomationNavigations, 0);
  assert.equal(result.physicalStops, 0);
  assert.equal(result.paidApiCalls, 0);
});

test("journal nasce atomicamente com IN_PROGRESS e fsynca append", async (t) => {
  const root = await temporaryRoot(t);
  const boundary = fakeBoundary(root);
  const attempt = receipt(boundary);
  const path = join(root, EXP0024_BOUNDARY_PATHS.journal);
  const writer = await createExp0024JournalWriter({
    path,
    inProgress: inProgress(boundary, attempt)
  });
  await writer.append(EXP0024_JOURNAL_FRAME_TYPES.workerStarted, {
    command: "node scripts/run-exp-0024-worker.mjs",
    pid: 456,
    startedAt: NOW
  });
  await writer.close();
  const inspected = inspectExp0024Journal(await readFile(path));
  assert.equal(inspected.status, EXP0024_JOURNAL_INSPECTION_STATES.valid);
  assert.deepEqual(inspected.frames.map((frame) => frame.type), [
    "IN_PROGRESS",
    "WORKER_STARTED"
  ]);
  await assert.rejects(createExp0024JournalWriter({
    path,
    inProgress: inProgress(boundary, attempt)
  }), /EEXIST/u);
});

test("recovery sem journal produz invalidação canônica e não avalia físico", () => {
  const boundary = fakeBoundary();
  const attempt = receipt(boundary);
  const inspection = inspectExp0024Journal(Buffer.alloc(0));
  const report = createExp0024ReportFromArtifacts({
    boundary,
    receipt: attempt,
    journalBytes: Buffer.alloc(0),
    journalPresent: false,
    inspection,
    executionState: EXP0024_EXECUTION_STATES.recoveryWithoutJournal,
    failureCode: "RECOVERY_RECEIPT_WITHOUT_JOURNAL"
  });
  assert.equal(report.decision, EXP0024_DECISIONS.invalidate);
  assert.equal(report.physicalMeasurementStatus, "NOT_EVALUATED");
  assert.equal(report.campaign.boundary.recoveryOnly, true);
  assert.equal(report.campaign.journal.byteLength, 0);
});

test("supervisor recovery nunca chama worker e grava um único relatório", async (t) => {
  const root = await temporaryRoot(t);
  const boundary = fakeBoundary(root);
  const attempt = receipt(boundary);
  const receiptBytes = Buffer.from(`${JSON.stringify(attempt, null, 2)}\n`);
  await writeProjectFile(root, EXP0024_BOUNDARY_PATHS.receipt, receiptBytes);
  let workerCalled = false;
  let reportWrites = 0;
  const result = await runExp0024Supervisor({
    projectRoot: root,
    verifyBoundary: async () => boundary,
    runWorker: async () => { workerCalled = true; },
    writeReport: async (_path, bytes) => {
      reportWrites += 1;
      assert.ok(bytes.byteLength > 0);
    }
  });
  assert.equal(workerCalled, false);
  assert.equal(reportWrites, 1);
  assert.equal(result.state,
    EXP0024_EXECUTION_STATES.recoveryWithoutJournal);
  assert.equal(result.report.decision, EXP0024_DECISIONS.invalidate);
});

test("recovery recusa frame completo malformado sem escrever report", async (t) => {
  const root = await temporaryRoot(t);
  const boundary = fakeBoundary(root);
  const attempt = receipt(boundary);
  await writeProjectFile(
    root,
    EXP0024_BOUNDARY_PATHS.receipt,
    Buffer.from(`${JSON.stringify(attempt, null, 2)}\n`)
  );
  await writeProjectFile(
    root,
    EXP0024_BOUNDARY_PATHS.journal,
    Buffer.from("{}\n")
  );
  let reportWrites = 0;
  await assert.rejects(runExp0024Supervisor({
    projectRoot: root,
    verifyBoundary: async () => boundary,
    writeReport: async () => { reportWrites += 1; }
  }), /frame completo inválido|estado não permitido/u);
  assert.equal(reportWrites, 0);
});

test("execução fresca ordena receipt → journal → worker → outcome → report", async (t) => {
  const root = await temporaryRoot(t);
  const boundary = fakeBoundary(root);
  const attempt = receipt(boundary);
  const events = [];
  const result = await runExp0024Supervisor({
    projectRoot: root,
    verifyBoundary: async () => boundary,
    consumeAttempt: async () => {
      events.push("receipt");
      const bytes = Buffer.from(`${JSON.stringify(attempt, null, 2)}\n`);
      await writeProjectFile(root, EXP0024_BOUNDARY_PATHS.receipt, bytes);
      return { receipt: attempt, receiptBytes: bytes };
    },
    runWorker: async ({ append }) => {
      events.push("worker");
      await append(EXP0024_JOURNAL_FRAME_TYPES.workerStarted, {
        command: "node scripts/run-exp-0024-worker.mjs",
        pid: 456,
        startedAt: NOW
      });
      return {
        status: "failed",
        code: "FIXTURE_INCOMPLETE",
        completedAt: NOW,
        exitCode: 1,
        signal: null,
        kind: "fixture",
        protocolError: null,
        recordCount: 0,
        stderrByteLength: 0,
        stderrSha256: `sha256:${"0".repeat(64)}`,
        stderrTruncated: false
      };
    },
    writeReport: async (_path, bytes) => {
      events.push("report");
      assert.ok(bytes.byteLength > 0);
    }
  });
  assert.deepEqual(events, ["receipt", "worker", "report"]);
  assert.equal(result.state, EXP0024_EXECUTION_STATES.fresh);
  assert.equal(result.inspection.frames[0].type, "IN_PROGRESS");
  assert.equal(result.inspection.frames.at(-1).type, "WORKER_OUTCOME");
  assert.equal(result.report.decision, EXP0024_DECISIONS.invalidate);
});

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 789;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit("close", null, "SIGTERM"));
    return true;
  };
  return child;
}

test("processo worker recebe start só após WORKER_STARTED e ACK só após append", async () => {
  const child = fakeChild();
  const events = [];
  let workerSequence = 0;
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (line) => {
    const message = JSON.parse(line);
    if (message.schemaVersion === EXP0024_SUPERVISOR_START_SCHEMA) {
      events.push("start");
      workerSequence += 1;
      child.stdout.write(`${JSON.stringify({
        schemaVersion: EXP0024_WORKER_IPC_SCHEMA,
        kind: "record",
        sequence: workerSequence,
        type: "DIAGNOSTIC",
        payload: {
          category: "structural",
          code: "FIXTURE",
          message: "fixture",
          navigationIndex: null,
          observedAt: NOW,
          trialId: null
        }
      })}\n`);
    } else if (message.schemaVersion === EXP0024_SUPERVISOR_ACK_SCHEMA) {
      events.push("ack");
      queueMicrotask(() => child.emit("close", 0, null));
    }
  });
  const result = await runExp0024WorkerProcess({
    projectRoot: "/tmp",
    spawn: () => child,
    startedAt: NOW,
    deadlineMs: 1_000,
    append: async (type) => {
      events.push(`append:${type}`);
    }
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(events, [
    "append:WORKER_STARTED",
    "start",
    "append:DIAGNOSTIC",
    "ack"
  ]);
  assert.equal(result.recordCount, 1);
});

test("atomic write-once nunca sobrescreve target existente", async (t) => {
  const root = await temporaryRoot(t);
  const path = join(root, "artifact.json");
  await writeExp0024AtomicWriteOnce(path, Buffer.from("primeiro\n"));
  await assert.rejects(
    writeExp0024AtomicWriteOnce(path, Buffer.from("segundo\n")),
    /EEXIST/u
  );
  assert.equal((await readFile(path)).toString("utf8"), "primeiro\n");
});
