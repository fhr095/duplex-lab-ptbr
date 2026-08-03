import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { EXP0023_BOUNDARY_PATHS } from
  "../src/eval/exp-0023-boundary.mjs";
import { createExp0023Report, EXP0023_DECISIONS } from
  "../src/eval/exp-0023-cdp-ordinal-timestamp-semantics.mjs";
import {
  classifyExp0023WorkerResult,
  consumeExp0023Attempt,
  createExp0023AttemptReceipt,
  createExp0023RuntimeFingerprintRecord,
  evaluateExp0023PostCommitEvidence,
  evaluateExp0023ReportBindings,
  exp0023FileRecordMatchesBytes,
  formatExp0023CheckSuccess,
  parseExp0023SupervisorArgs,
  runExp0023Supervisor,
  validateExp0023AttemptReceipt
} from "../scripts/run-exp-0023-supervisor.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const COMMIT_A = "a".repeat(40);
const FIXTURE_RECEIPT_AT = "2026-08-03T09:49:08.000Z";

async function workerEnvelope() {
  const report = JSON.parse(await readFile(new URL(
    "../eval/reports/exp-0022-bootstrap-audit-health-binding-v0.1.json",
    import.meta.url
  ), "utf8"));
  return structuredClone(report.campaign.workerEnvelope);
}

function fakeBoundary(
  projectRoot = "/tmp/exp0023",
  expectedRuntimeFingerprintSha256 = HASH_A
) {
  const attemptBytes = Buffer.from("attempt\n");
  return {
    projectRoot,
    freeze: { instrumentationFreezeSha256: HASH_A },
    freezeBytes: Buffer.from("freeze\n"),
    freezeCommit: "b".repeat(40),
    attempt: { captureAttemptSha256: HASH_A },
    attemptBytes,
    attemptCommit: COMMIT_A,
    expectedRuntimeFingerprintSha256
  };
}

test("fingerprint replica algoritmo do runtime e rejeita duplicata", () => {
  const first = createExp0023RuntimeFingerprintRecord([
    { path: "b", bytes: Buffer.from("2") },
    { path: "a", bytes: Buffer.from("1") }
  ]);
  const second = createExp0023RuntimeFingerprintRecord([
    { path: "a", bytes: Buffer.from("1") },
    { path: "b", bytes: Buffer.from("2") }
  ]);
  assert.deepEqual(first, second);
  assert.match(first.sha256, /^[a-f0-9]{64}$/u);
  assert.throws(() => createExp0023RuntimeFingerprintRecord([
    { path: "a", bytes: Buffer.from("1") },
    { path: "a", bytes: Buffer.from("2") }
  ]), /duplicado/u);
});

test("binding de arquivo recalcula bytes em vez de confiar no freeze", () => {
  const bytes = Buffer.from("artefato congelado\n");
  const record = {
    path: "docs/artefato.md",
    fileSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  };
  assert.equal(exp0023FileRecordMatchesBytes(record, bytes), true);
  assert.equal(exp0023FileRecordMatchesBytes({
    ...record,
    fileSha256: HASH_A
  }, bytes), false);
  assert.equal(exp0023FileRecordMatchesBytes(record, Buffer.alloc(0)), false);
});

test("receipt é canônico, pré-worker e ligado à abertura", () => {
  const boundary = fakeBoundary();
  const receipt = createExp0023AttemptReceipt({
    boundary,
    consumedAt: FIXTURE_RECEIPT_AT
  });
  assert.equal(validateExp0023AttemptReceipt(receipt, boundary), true);
  assert.equal(receipt.boundary.receiptBeforeWorker, true);
  assert.equal(receipt.boundary.receiptBeforeNetwork, true);
  assert.equal(receipt.boundary.rerunAllowed, false);

  const altered = structuredClone(receipt);
  altered.attempt.attemptCommit = "c".repeat(40);
  assert.equal(validateExp0023AttemptReceipt(altered, boundary), false);
});

test("consumo materializa receipt write-once e recusa repetição", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "exp0023-receipt-"));
  try {
    const boundary = fakeBoundary(root);
    const consumed = await consumeExp0023Attempt(boundary, {
      consumedAt: "2026-08-03T10:00:00.000Z"
    });
    assert.equal(validateExp0023AttemptReceipt(consumed.receipt, boundary), true);
    assert.deepEqual(
      await readFile(resolve(root, EXP0023_BOUNDARY_PATHS.receipt)),
      consumed.receiptBytes
    );
    await assert.rejects(
      consumeExp0023Attempt(boundary),
      /tentativa já consumida/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker completo produz PASS novo sem reclassificar EXP-0022", async () => {
  const envelope = await workerEnvelope();
  const boundary = fakeBoundary(
    "/tmp/exp0023",
    `sha256:${envelope.campaign.health.before.process.runtimeFingerprint.sha256}`
  );
  const receipt = createExp0023AttemptReceipt({
    boundary,
    consumedAt: FIXTURE_RECEIPT_AT
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const report = classifyExp0023WorkerResult({
    kind: "success",
    envelope,
    startedAt: envelope.startedAt,
    completedAt: envelope.completedAt
  }, boundary, receiptBytes);
  assert.equal(report.decision, EXP0023_DECISIONS.pass);
  assert.equal(report.pass, true);
  assert.equal(report.authorityEligible, false);
  assert.equal(report.analysis.metrics.timestampDiagnostics.trackedRequests, 40);
  assert.equal(evaluateExp0023ReportBindings({
    report,
    receiptBytes,
    boundary
  }).valid, true);
  assert.equal(evaluateExp0023ReportBindings({
    report,
    receiptBytes,
    boundary: {
      ...boundary,
      freeze: {
        instrumentationFreezeSha256: `sha256:${"b".repeat(64)}`
      }
    }
  }).valid, false);
  assert.equal(evaluateExp0023ReportBindings({
    report,
    receiptBytes,
    boundary: {
      ...boundary,
      expectedRuntimeFingerprintSha256: `sha256:${"b".repeat(64)}`
    }
  }).valid, false);
});

test("receipt posterior ao worker invalida e bindings são reconstruídos", async () => {
  const envelope = await workerEnvelope();
  const boundary = fakeBoundary(
    "/tmp/exp0023",
    `sha256:${envelope.campaign.health.before.process.runtimeFingerprint.sha256}`
  );
  const receipt = createExp0023AttemptReceipt({
    boundary,
    consumedAt: "2026-08-03T10:00:00.000Z"
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const report = classifyExp0023WorkerResult({
    kind: "success",
    envelope,
    startedAt: envelope.startedAt,
    completedAt: envelope.completedAt
  }, boundary, receiptBytes);
  assert.equal(report.decision, EXP0023_DECISIONS.invalidate);
  assert.equal(report.campaign.boundary.receiptBeforeNetwork, false);
  assert.equal(evaluateExp0023ReportBindings({
    report,
    receiptBytes,
    boundary
  }).valid, true);
  const forgedCampaign = structuredClone(report.campaign);
  forgedCampaign.boundary.receiptBeforeNetwork = true;
  forgedCampaign.audits.receiptBeforeNetwork = true;
  const forgedPass = createExp0023Report({
    startedAt: envelope.startedAt,
    completedAt: envelope.completedAt,
    campaign: forgedCampaign
  });
  assert.equal(forgedPass.decision, EXP0023_DECISIONS.pass);
  assert.equal(evaluateExp0023ReportBindings({
    report: forgedPass,
    receiptBytes,
    boundary
  }).valid, false);
});

test("timeout e envelope malformado viram INVALIDATE NOT_EVALUATED", () => {
  const boundary = fakeBoundary();
  const receiptBytes = Buffer.from("receipt\n");
  for (const kind of ["timeout", "malformed-output", "exit-error"]) {
    const report = classifyExp0023WorkerResult({
      kind,
      startedAt: "2026-08-03T10:00:00.000Z",
      completedAt: "2026-08-03T10:00:01.000Z"
    }, boundary, receiptBytes);
    assert.equal(report.decision, EXP0023_DECISIONS.invalidate);
    assert.equal(report.measurementStatus, "NOT_EVALUATED");
    assert.equal(report.claim, null);
  }
});

test("fresh escreve receipt antes de chamar worker e report", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "exp0023-fresh-"));
  const order = [];
  try {
    const envelope = await workerEnvelope();
    const boundary = fakeBoundary(
      root,
      `sha256:${envelope.campaign.health.before.process.runtimeFingerprint.sha256}`
    );
    const receipt = createExp0023AttemptReceipt({
      boundary,
      consumedAt: FIXTURE_RECEIPT_AT
    });
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const result = await runExp0023Supervisor({
      projectRoot: root,
      verifyBoundary: async () => boundary,
      consumeAttempt: async () => {
        order.push("receipt");
        return { receipt, receiptBytes };
      },
      runWorker: async () => {
        order.push("worker");
        return {
          kind: "success",
          envelope,
          startedAt: envelope.startedAt,
          completedAt: envelope.completedAt
        };
      },
      writeReport: async () => { order.push("report"); }
    });
    assert.deepEqual(order, ["receipt", "worker", "report"]);
    assert.equal(result.state, "fresh");
    assert.equal(result.report.decision, EXP0023_DECISIONS.pass);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt órfão invalida sem chamar worker", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "exp0023-orphan-"));
  try {
    const boundary = fakeBoundary(root);
    const receipt = createExp0023AttemptReceipt({
      boundary,
      consumedAt: "2026-08-03T10:00:00.000Z"
    });
    const receiptPath = resolve(root, EXP0023_BOUNDARY_PATHS.receipt);
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    let workerCalled = false;
    const result = await runExp0023Supervisor({
      projectRoot: root,
      verifyBoundary: async () => boundary,
      runWorker: async () => { workerCalled = true; },
      writeReport: async () => {}
    });
    assert.equal(workerCalled, false);
    assert.equal(result.state, "orphan-recovery-no-worker");
    assert.equal(result.report.decision, EXP0023_DECISIONS.invalidate);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checker pós-commit exige parent, allowlist e blobs idênticos", () => {
  const bytes = Buffer.from("same");
  const valid = {
    attemptCommit: COMMIT_A,
    receiptCommit: "b".repeat(40),
    reportCommit: "b".repeat(40),
    reportCommitParent: COMMIT_A,
    reportCommitAncestor: true,
    changedPaths: [
      EXP0023_BOUNDARY_PATHS.receipt,
      EXP0023_BOUNDARY_PATHS.report
    ].toSorted(),
    receiptBytes: bytes,
    reportBytes: bytes,
    committedReceipt: bytes,
    committedReport: bytes,
    headReceipt: bytes,
    headReport: bytes,
    reportBindingValid: true,
    canonicalHashValid: true
  };
  assert.equal(evaluateExp0023PostCommitEvidence(valid).valid, true);
  for (const change of [
    { reportCommitParent: "c".repeat(40) },
    { receiptCommit: "não-é-commit" },
    { changedPaths: [EXP0023_BOUNDARY_PATHS.report] },
    { committedReport: Buffer.from("different") },
    {
      receiptBytes: undefined,
      reportBytes: undefined,
      committedReceipt: undefined,
      committedReport: undefined,
      headReceipt: undefined,
      headReport: undefined
    },
    { reportBindingValid: false }
  ]) assert.equal(evaluateExp0023PostCommitEvidence({
    ...valid,
    ...change
  }).valid, false);
});

test("saída do check separa aceite técnico da decisão", () => {
  assert.equal(
    formatExp0023CheckSuccess({
      decision: EXP0023_DECISIONS.invalidate,
      reportSha256: HASH_A
    }),
    `EXP-0023 CHECK PASS · decision=${EXP0023_DECISIONS.invalidate} · ${HASH_A}`
  );
  assert.deepEqual(parseExp0023SupervisorArgs([]), { check: false });
  assert.deepEqual(parseExp0023SupervisorArgs(["--check"]), { check: true });
  assert.throws(() => parseExp0023SupervisorArgs(["--rerun"]),
    /aceita somente --check/u);
});
