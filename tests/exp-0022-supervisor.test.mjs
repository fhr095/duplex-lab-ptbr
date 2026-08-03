import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXP0022_ATTEMPT_NONCE,
  EXP0022_BOUNDARY_PATHS,
  EXP0022_OFFICIAL_COMMAND,
  EXP0022_RUNTIME_FINGERPRINT_ROOTS
} from "../src/eval/exp-0022-boundary.mjs";
import {
  EXP0022_CONFIG,
  EXP0022_DECISIONS,
  EXP0022_POST_COMMIT_AUDIT_KEYS,
  EXP0022_WORKER_ENVELOPE_SCHEMA
} from "../src/eval/exp-0022-bootstrap-audit-health-binding.mjs";
import {
  classifyExp0022WorkerResult,
  consumeExp0022Attempt,
  createExp0022AttemptReceipt,
  createExp0022RuntimeFingerprintRecord,
  evaluateExp0022PostCommitEvidence,
  formatExp0022CheckSuccess,
  parseExp0022SupervisorArgs,
  runExp0022Supervisor,
  validateExp0022AttemptReceipt,
  validateExp0022WorkerEnvelopeShape
} from "../scripts/run-exp-0022-supervisor.mjs";
import { createSourceFingerprint } from
  "../src/eval/source-fingerprint.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function boundary() {
  return {
    projectRoot: "/tmp/exp-0022-test",
    attemptCommit: COMMIT_A,
    attemptRecord: {
      path: EXP0022_BOUNDARY_PATHS.attempt,
      fileSha256: HASH_A,
      canonicalSha256: HASH_B
    },
    freezeRecord: {
      path: EXP0022_BOUNDARY_PATHS.freeze,
      fileSha256: HASH_B,
      canonicalSha256: HASH_A
    },
    freeze: {
      runtimeBinding: { sha256: "c".repeat(64) }
    },
    attempt: {
      campaign: {
        nonce: EXP0022_ATTEMPT_NONCE,
        command: EXP0022_OFFICIAL_COMMAND,
        targetUrl: EXP0022_CONFIG.targetUrl,
        reportPath: EXP0022_BOUNDARY_PATHS.report
      }
    }
  };
}

test("fingerprint Git do C0 replica exatamente o algoritmo do servidor", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "exp-0022-runtime-"));
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
    roots: EXP0022_RUNTIME_FINGERPRINT_ROOTS
  });
  const gitProjection = createExp0022RuntimeFingerprintRecord(
    files.map(([path, content]) => ({ path, bytes: Buffer.from(content) }))
  );
  assert.deepEqual(gitProjection, serverFingerprint);
});

function receiptRecord(boundaryFixture, startedAt) {
  const receipt = createExp0022AttemptReceipt({
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
  const receipt = createExp0022AttemptReceipt({
    boundary: fixture,
    startedAt: "2026-08-03T00:00:00.000Z",
    processId: 42
  });
  assert.equal(validateExp0022AttemptReceipt(receipt, fixture), true);
  assert.equal(receipt.executionCommit, COMMIT_A);
  assert.equal(receipt.rerunAllowed, false);

  const widened = structuredClone(receipt);
  widened.rerunAllowed = true;
  assert.equal(validateExp0022AttemptReceipt(widened, fixture), false);
});

test("consumo publica receipt completo atomicamente e recusa segundo writer", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "exp-0022-receipt-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const fixture = { ...boundary(), projectRoot };
  const first = await consumeExp0022Attempt(fixture, {
    startedAt: "2026-08-03T00:00:00.000Z",
    processId: 42
  });
  const target = join(projectRoot, EXP0022_BOUNDARY_PATHS.receipt);
  assert.deepEqual(JSON.parse((await readFile(target)).toString("utf8")),
    first.receipt);
  await assert.rejects(
    consumeExp0022Attempt(fixture, {
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
    const envelope = classifyExp0022WorkerResult(
      result,
      startedAt,
      completedAt
    );
    assert.equal(envelope.status, "invalidated");
    assert.equal(envelope.failure.code, code);
    assert.equal(validateExp0022WorkerEnvelopeShape(envelope), false);
  }
});

test("envelope superficial sem campanha exata é recusado pelo supervisor", () => {
  const envelope = {
    schemaVersion: EXP0022_WORKER_ENVELOPE_SCHEMA,
    status: "completed",
    startedAt: "2026-08-03T00:00:00.000Z",
    completedAt: "2026-08-03T00:00:01.000Z",
    campaign: {},
    failure: null
  };
  const result = invalidResult({ stdout: JSON.stringify(envelope) });
  assert.equal(validateExp0022WorkerEnvelopeShape(envelope), false);
  const classified = classifyExp0022WorkerResult(
    result,
    envelope.startedAt,
    envelope.completedAt
  );
  assert.equal(classified.status, "invalidated");
  assert.equal(classified.failure.code, "WORKER_MALFORMED_ENVELOPE");
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
  const result = await runExp0022Supervisor({
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
  assert.equal(writtenReport.decision, EXP0022_DECISIONS.invalidate);
  assert.equal(writtenReport.measurementStatus, "NOT_EVALUATED");
  assert.deepEqual(writtenReport.evidenceAcceptance, {
    status: "PENDING_POST_COMMIT_CHECK",
    requiredChecks: EXP0022_POST_COMMIT_AUDIT_KEYS
  });
  assert.equal(EXP0022_POST_COMMIT_AUDIT_KEYS.some((key) =>
    Object.hasOwn(writtenReport.campaign.audits, key)), false);
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
  const result = await runExp0022Supervisor({
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
  assert.equal(result.report.decision, EXP0022_DECISIONS.invalidate);
  assert.equal(
    result.report.campaign.workerEnvelope.failure.code,
    "ORPHANED_RECEIPT_RECOVERY"
  );
});

test("CLI recusa parâmetros que poderiam ampliar a campanha", () => {
  assert.deepEqual(parseExp0022SupervisorArgs([]), { check: false });
  assert.deepEqual(parseExp0022SupervisorArgs(["--check"]), { check: true });
  assert.throws(() => parseExp0022SupervisorArgs(["--cdp-url", "x"]));
  assert.throws(() => parseExp0022SupervisorArgs(["--check", "--check"]));
});

function postCommitFixture() {
  const receiptBytes = Buffer.from("receipt-canônico\n");
  const reportBytes = Buffer.from("report-canônico\n");
  return {
    attemptCommit: COMMIT_B,
    receiptCommit: COMMIT_A,
    reportCommit: COMMIT_A,
    reportCommitParent: COMMIT_B,
    reportCommitAncestor: true,
    changedPaths: [
      EXP0022_BOUNDARY_PATHS.receipt,
      EXP0022_BOUNDARY_PATHS.report
    ].toSorted(),
    receiptBytes,
    reportBytes,
    committedReceipt: Buffer.from(receiptBytes),
    committedReport: Buffer.from(reportBytes),
    headReceipt: Buffer.from(receiptBytes),
    headReport: Buffer.from(reportBytes),
    reportBindingValid: true,
    canonicalHashValid: true
  };
}

test("checker pós-commit prova binding, hash, topologia, allowlist e blobs", () => {
  const result = evaluateExp0022PostCommitEvidence(postCommitFixture());
  assert.equal(result.valid, true);
  assert.deepEqual(result.checks, Object.fromEntries(
    EXP0022_POST_COMMIT_AUDIT_KEYS.map((key) => [key, true])
  ));

  const cases = [
    ["parent", (input) => { input.reportCommitParent = COMMIT_A; }],
    ["allowlist", (input) => {
      input.changedPaths.push("trace-extra.json");
    }],
    ["blob", (input) => {
      input.committedReport = Buffer.from("report-adulterado\n");
    }],
    ["binding", (input) => { input.reportBindingValid = false; }],
    ["hash", (input) => { input.canonicalHashValid = false; }]
  ];
  for (const [name, mutate] of cases) {
    const input = postCommitFixture();
    mutate(input);
    const rejected = evaluateExp0022PostCommitEvidence(input);
    assert.equal(rejected.valid, false, name);
    assert.ok(rejected.errors.length > 0, name);
  }
});

test("saída do --check separa aceite técnico de decisão INVALIDATE", () => {
  const output = formatExp0022CheckSuccess({
    decision: EXP0022_DECISIONS.invalidate,
    reportSha256: HASH_A
  });
  assert.equal(
    output,
    `EXP-0022 CHECK PASS · decision=${EXP0022_DECISIONS.invalidate} · ${HASH_A}`
  );
  assert.doesNotMatch(output, /report PASS/iu);
});
