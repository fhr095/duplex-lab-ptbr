import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXP0021_ATTEMPT_NONCE,
  EXP0021_BOUNDARY_PATHS,
  EXP0021_OFFICIAL_COMMAND,
  EXP0021_RUNTIME_FINGERPRINT_ROOTS
} from "../src/eval/exp-0021-boundary.mjs";
import {
  EXP0021_CONFIG,
  EXP0021_DECISIONS,
  EXP0021_WORKER_ENVELOPE_SCHEMA
} from "../src/eval/exp-0021-capture-qualification.mjs";
import {
  classifyExp0021WorkerResult,
  consumeExp0021Attempt,
  createExp0021AttemptReceipt,
  createExp0021RuntimeFingerprintRecord,
  parseExp0021SupervisorArgs,
  runExp0021Supervisor,
  validateExp0021AttemptReceipt,
  validateExp0021WorkerEnvelopeShape
} from "../scripts/run-exp-0021-supervisor.mjs";
import { createSourceFingerprint } from
  "../src/eval/source-fingerprint.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const COMMIT_A = "a".repeat(40);

function boundary() {
  return {
    projectRoot: "/tmp/exp-0021-test",
    attemptCommit: COMMIT_A,
    attemptRecord: {
      path: EXP0021_BOUNDARY_PATHS.attempt,
      fileSha256: HASH_A,
      canonicalSha256: HASH_B
    },
    freezeRecord: {
      path: EXP0021_BOUNDARY_PATHS.freeze,
      fileSha256: HASH_B,
      canonicalSha256: HASH_A
    },
    freeze: {
      runtimeBinding: { sha256: "c".repeat(64) }
    },
    attempt: {
      campaign: {
        nonce: EXP0021_ATTEMPT_NONCE,
        command: EXP0021_OFFICIAL_COMMAND,
        targetUrl: EXP0021_CONFIG.targetUrl,
        reportPath: EXP0021_BOUNDARY_PATHS.report
      }
    }
  };
}

test("fingerprint Git do C0 replica exatamente o algoritmo do servidor", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "exp-0021-runtime-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const files = [
    ["src/a.mjs", "export const a = 1;\n"],
    ["web/index.html", "<!doctype html>\n"],
    ["package.json", "{}\n"],
    ["package-lock.json", "{}\n"],
    ["requirements-asr.txt", "\n"]
  ];
  for (const [path, content] of files) {
    await mkdir(join(projectRoot, path.split("/").slice(0, -1).join("/")), {
      recursive: true
    });
    await writeFile(join(projectRoot, path), content);
  }
  const serverFingerprint = await createSourceFingerprint(projectRoot, {
    roots: EXP0021_RUNTIME_FINGERPRINT_ROOTS
  });
  const gitProjection = createExp0021RuntimeFingerprintRecord(
    files.map(([path, content]) => ({ path, bytes: Buffer.from(content) }))
  );
  assert.deepEqual(gitProjection, serverFingerprint);
});

function receiptRecord(boundaryFixture, startedAt) {
  const receipt = createExp0021AttemptReceipt({
    boundary: boundaryFixture,
    startedAt,
    processId: 1234
  });
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  return {
    receipt,
    bytes,
    fileSha256:
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  };
}

function invalidResult(overrides = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "not-json",
    stderr: "",
    ...overrides
  };
}

test("receipt é canônico, write-once e ligado à abertura", () => {
  const fixture = boundary();
  const receipt = createExp0021AttemptReceipt({
    boundary: fixture,
    startedAt: "2026-08-03T00:00:00.000Z",
    processId: 42
  });
  assert.equal(validateExp0021AttemptReceipt(receipt, fixture), true);
  assert.equal(receipt.executionCommit, COMMIT_A);
  assert.equal(receipt.rerunAllowed, false);

  const widened = structuredClone(receipt);
  widened.rerunAllowed = true;
  assert.equal(validateExp0021AttemptReceipt(widened, fixture), false);
});

test("consumo publica receipt completo atomicamente e recusa segundo writer", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "exp-0021-receipt-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const fixture = { ...boundary(), projectRoot };
  const first = await consumeExp0021Attempt(fixture, {
    startedAt: "2026-08-03T00:00:00.000Z",
    processId: 42
  });
  const target = join(projectRoot, EXP0021_BOUNDARY_PATHS.receipt);
  assert.deepEqual(JSON.parse((await readFile(target)).toString("utf8")),
    first.receipt);
  await assert.rejects(
    consumeExp0021Attempt(fixture, {
      startedAt: "2026-08-03T00:00:01.000Z",
      processId: 43
    }),
    (error) => error?.code === "EEXIST"
  );
  assert.deepEqual(JSON.parse((await readFile(target)).toString("utf8")),
    first.receipt);
});

test("timeout, signal, exit e envelope malformado invalidam com causa tipada", () => {
  const startedAt = "2026-08-03T00:00:00.000Z";
  const completedAt = "2026-08-03T00:00:01.000Z";
  const cases = [
    [invalidResult({ timedOut: true, signal: "SIGTERM" }), "WORKER_TIMEOUT"],
    [invalidResult({ signal: "SIGKILL" }), "WORKER_SIGNAL"],
    [invalidResult({ exitCode: 1, stderr: "boom" }), "WORKER_EXIT"],
    [invalidResult(), "WORKER_MALFORMED_ENVELOPE"],
    [invalidResult({ stdout: "{}" }), "WORKER_MALFORMED_ENVELOPE"]
  ];
  for (const [result, code] of cases) {
    const envelope = classifyExp0021WorkerResult(
      result,
      startedAt,
      completedAt
    );
    assert.equal(envelope.status, "invalidated");
    assert.equal(envelope.failure.code, code);
    assert.equal(validateExp0021WorkerEnvelopeShape(envelope), false);
  }
});

test("envelope worker bem formado atravessa supervisor sem reinterpretação", () => {
  const envelope = {
    schemaVersion: EXP0021_WORKER_ENVELOPE_SCHEMA,
    status: "completed",
    startedAt: "2026-08-03T00:00:00.000Z",
    completedAt: "2026-08-03T00:00:01.000Z",
    campaign: {},
    failure: null
  };
  const result = invalidResult({ stdout: JSON.stringify(envelope) });
  assert.equal(validateExp0021WorkerEnvelopeShape(envelope), true);
  assert.deepEqual(
    classifyExp0021WorkerResult(
      result,
      envelope.startedAt,
      envelope.completedAt
    ),
    envelope
  );
});

function clock(values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1);
}

test("fresh cria receipt antes do worker e persiste crash como INVALIDATE", async () => {
  const boundaryFixture = boundary();
  const startedAt = "2026-08-03T00:00:00.000Z";
  const calls = [];
  let writtenReport = null;
  const result = await runExp0021Supervisor({
    projectRoot: boundaryFixture.projectRoot,
    preparedState: {
      mode: "fresh",
      boundary: boundaryFixture,
      receiptRecord: null
    },
    now: clock([
      startedAt,
      "2026-08-03T00:00:01.000Z",
      "2026-08-03T00:00:02.000Z"
    ]),
    consumeAttempt: async (receivedBoundary, { startedAt: consumedAt }) => {
      calls.push("receipt");
      assert.equal(receivedBoundary, boundaryFixture);
      return receiptRecord(boundaryFixture, consumedAt);
    },
    runWorker: async () => {
      calls.push("worker");
      return invalidResult({ exitCode: 1, stderr: "unclassified crash" });
    },
    writeReport: async (_projectRoot, report) => {
      calls.push("report");
      writtenReport = report;
      return Buffer.from(`${JSON.stringify(report)}\n`);
    }
  });
  assert.deepEqual(calls, ["receipt", "worker", "report"]);
  assert.equal(result.state, "fresh");
  assert.equal(writtenReport.decision, EXP0021_DECISIONS.invalidate);
  assert.equal(writtenReport.measurementStatus, "NOT_EVALUATED");
  assert.equal(
    writtenReport.campaign.workerEnvelope.failure.code,
    "WORKER_EXIT"
  );
});

test("receipt órfão entra só em recovery e nunca chama worker/rede/Chrome", async () => {
  const boundaryFixture = boundary();
  const startedAt = "2026-08-03T00:00:00.000Z";
  const existingReceipt = receiptRecord(boundaryFixture, startedAt);
  let workerCalls = 0;
  let reportWrites = 0;
  const result = await runExp0021Supervisor({
    projectRoot: boundaryFixture.projectRoot,
    preparedState: {
      mode: "orphan",
      boundary: boundaryFixture,
      receiptRecord: existingReceipt
    },
    now: clock([
      "2026-08-03T00:00:01.000Z",
      "2026-08-03T00:00:02.000Z"
    ]),
    runWorker: async () => {
      workerCalls += 1;
      throw new Error("não deveria abrir health, rede ou Chrome");
    },
    writeReport: async (_projectRoot, report) => {
      reportWrites += 1;
      return Buffer.from(`${JSON.stringify(report)}\n`);
    }
  });
  assert.equal(workerCalls, 0);
  assert.equal(reportWrites, 1);
  assert.equal(result.state, "orphan");
  assert.equal(result.report.decision, EXP0021_DECISIONS.invalidate);
  assert.equal(
    result.report.campaign.workerEnvelope.failure.code,
    "ORPHANED_RECEIPT_RECOVERY"
  );
});

test("CLI recusa parâmetros que poderiam ampliar a campanha", () => {
  assert.deepEqual(parseExp0021SupervisorArgs([]), { check: false });
  assert.deepEqual(parseExp0021SupervisorArgs(["--check"]), { check: true });
  assert.throws(() => parseExp0021SupervisorArgs(["--cdp-url", "x"]));
  assert.throws(() => parseExp0021SupervisorArgs(["--check", "--check"]));
});
