import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0024_ATTEMPT_NONCE,
  EXP0024_BOUNDARY_PATHS,
  EXP0024_C0_CHANGED_PATHS,
  EXP0024_CONFIG,
  EXP0024_EXP0019_EVIDENCE_COMMIT,
  EXP0024_EXP0023_EVIDENCE_COMMIT,
  EXP0024_GIT_TOPOLOGY,
  EXP0024_IMPLEMENTATION_BASE_COMMIT,
  EXP0024_INSTRUMENTATION_SOURCE_PATHS,
  EXP0024_OFFICIAL_COMMAND,
  EXP0024_PRODUCTION_SOURCE_PATHS,
  EXP0024_REQUIRED_CHROME,
  EXP0024_REQUIRED_NODE_VERSION,
  EXP0024_RUNTIME_ALLOWED_DRIFT_PATHS,
  EXP0024_RUNTIME_FINGERPRINT_ALGORITHM,
  EXP0024_RUNTIME_FINGERPRINT_ROOTS,
  createExp0024InstrumentationFreeze,
  createExp0024PhysicalStopAttempt,
  validateExp0024C0Boundary,
  validateExp0024EvidenceCommitBoundary,
  validateExp0024FreezeCommitBoundary,
  validateExp0024InstrumentationFreeze,
  validateExp0024OpeningCommitBoundary,
  validateExp0024PhysicalStopAttempt
} from "../src/eval/exp-0024-boundary.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HEX_C = "c".repeat(64);
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const COMMIT_C = "c".repeat(40);

function productionRecords() {
  return EXP0024_PRODUCTION_SOURCE_PATHS.map((path) => ({
    path,
    fileSha256: HASH_A,
    exp0019FileSha256: HASH_A
  }));
}

function instrumentationRecords() {
  return EXP0024_INSTRUMENTATION_SOURCE_PATHS.map((path) => ({
    path,
    fileSha256: HASH_A
  }));
}

function artifact(path) {
  return { path, fileSha256: HASH_A };
}

function freezeInput() {
  return {
    runnerSourceCommit: COMMIT_A,
    nodeVersion: EXP0024_REQUIRED_NODE_VERSION,
    runtimeBinding: {
      algorithm: EXP0024_RUNTIME_FINGERPRINT_ALGORITHM,
      sha256: HEX_C,
      fileCount: 321,
      roots: [...EXP0024_RUNTIME_FINGERPRINT_ROOTS]
    },
    artifacts: {
      preregistration: artifact(EXP0024_BOUNDARY_PATHS.preregistration),
      exp0019Report: artifact(EXP0024_BOUNDARY_PATHS.exp0019Report),
      exp0019Closeout: artifact(EXP0024_BOUNDARY_PATHS.exp0019Closeout),
      exp0023Report: artifact(EXP0024_BOUNDARY_PATHS.exp0023Report),
      exp0023Closeout: artifact(EXP0024_BOUNDARY_PATHS.exp0023Closeout)
    },
    productionSources: productionRecords(),
    instrumentationSources: instrumentationRecords()
  };
}

function createFreeze() {
  return createExp0024InstrumentationFreeze(freezeInput());
}

function attemptInput() {
  const freeze = createFreeze();
  return {
    freezeCommit: COMMIT_B,
    openedAt: "2026-08-03T12:00:00.000Z",
    freeze: {
      path: EXP0024_BOUNDARY_PATHS.freeze,
      fileSha256: HASH_B,
      instrumentationFreezeSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit,
      freezeCommit: COMMIT_B,
      nodeVersion: freeze.nodeVersion,
      expectedRuntimeFingerprintSha256: freeze.runtimeBinding.sha256
    },
    preflight: {
      completedAt: "2026-08-03T12:01:00.000Z",
      nodeVersion: EXP0024_REQUIRED_NODE_VERSION,
      chrome: structuredClone(EXP0024_REQUIRED_CHROME),
      runtimeFingerprintSha256: freeze.runtimeBinding.sha256,
      provider: "local",
      targetAutomationNavigations: 0,
      physicalStops: 0,
      paidApiCalls: 0,
      gpuRuns: 0
    }
  };
}

test("config e paths congelam a campanha 2x6 e o flock oficial", () => {
  assert.equal(EXP0024_CONFIG.targetUrl,
    "http://localhost:4173/?automation=1&experiment=0024");
  assert.equal(EXP0024_CONFIG.navigations, 2);
  assert.equal(EXP0024_CONFIG.stopsPerNavigation, 6);
  assert.equal(EXP0024_CONFIG.totalStops, 12);
  assert.equal(EXP0024_CONFIG.provider, "local");
  assert.equal(EXP0024_CONFIG.sameExperimentRerunAllowed, false);
  assert.equal(EXP0024_CONFIG.browserCdpByteIdentity, "NOT_EVALUATED");
  assert.deepEqual(EXP0024_CONFIG.responseBodyRetryDelaysMs, [0, 8, 24, 64]);
  assert.match(
    EXP0024_OFFICIAL_COMMAND,
    /^flock --exclusive --nonblock .*\.lock node scripts\/run-exp-0024-supervisor\.mjs$/u
  );
  assert.equal(EXP0024_OFFICIAL_COMMAND.includes(EXP0024_BOUNDARY_PATHS.lock), true);
  assert.equal(EXP0024_BOUNDARY_PATHS.opening.includes("exp-0024"), true);
  assert.equal(EXP0024_BOUNDARY_PATHS.journal.endsWith(".ndjson"), true);
  assert.equal(EXP0024_ATTEMPT_NONCE, "exp-0024-official-v0.1");
  assert.equal(EXP0024_INSTRUMENTATION_SOURCE_PATHS.length, 16);
  assert.deepEqual(EXP0024_C0_CHANGED_PATHS,
    EXP0024_INSTRUMENTATION_SOURCE_PATHS);
});

test("C0 exige base e diffs exatos sem drift produtivo", () => {
  const valid = {
    runnerSourceCommit: COMMIT_A,
    parentCommit: EXP0024_IMPLEMENTATION_BASE_COMMIT,
    changedPaths: [...EXP0024_C0_CHANGED_PATHS],
    runtimeChangedPaths: [...EXP0024_RUNTIME_ALLOWED_DRIFT_PATHS]
  };
  assert.equal(validateExp0024C0Boundary(valid), true);
  for (const candidate of [
    { ...valid, parentCommit: COMMIT_B },
    { ...valid, changedPaths: [...valid.changedPaths, "web/app.mjs"] },
    { ...valid, runtimeChangedPaths: ["package.json"] },
    { ...valid, extra: true }
  ]) assert.equal(validateExp0024C0Boundary(candidate), false);
});

test("commits freeze, opening e evidence exigem parent e allowlist exatos", () => {
  assert.equal(validateExp0024FreezeCommitBoundary({
    c0Commit: COMMIT_A,
    freezeCommit: COMMIT_B,
    parentCommit: COMMIT_A,
    changedPaths: [EXP0024_BOUNDARY_PATHS.freeze]
  }), true);
  assert.equal(validateExp0024OpeningCommitBoundary({
    freezeCommit: COMMIT_B,
    openingCommit: COMMIT_C,
    parentCommit: COMMIT_B,
    changedPaths: [EXP0024_BOUNDARY_PATHS.opening]
  }), true);
  assert.equal(validateExp0024EvidenceCommitBoundary({
    evidenceCommit: COMMIT_A,
    openingCommit: COMMIT_C,
    parentCommit: COMMIT_C,
    changedPaths: [...EXP0024_GIT_TOPOLOGY.normalEvidenceAllowedPaths],
    recoveryBeforeJournal: false
  }), true);
  assert.equal(validateExp0024EvidenceCommitBoundary({
    evidenceCommit: COMMIT_A,
    openingCommit: COMMIT_C,
    parentCommit: COMMIT_C,
    changedPaths: [
      ...EXP0024_GIT_TOPOLOGY.recoveryBeforeJournalAllowedPaths
    ],
    recoveryBeforeJournal: true
  }), true);
  assert.equal(validateExp0024EvidenceCommitBoundary({
    evidenceCommit: COMMIT_A,
    openingCommit: COMMIT_C,
    parentCommit: COMMIT_B,
    changedPaths: [...EXP0024_GIT_TOPOLOGY.normalEvidenceAllowedPaths],
    recoveryBeforeJournal: false
  }), false);
});

test("freeze liga EXP-0019, EXP-0023, runtime, outputs e autoridade", () => {
  const freeze = createFreeze();
  assert.equal(validateExp0024InstrumentationFreeze(freeze).valid, true);
  assert.equal(
    freeze.sourceBaseline.physicalRuntime.evidenceCommit,
    EXP0024_EXP0019_EVIDENCE_COMMIT
  );
  assert.equal(
    freeze.sourceBaseline.captureQualification.evidenceCommit,
    EXP0024_EXP0023_EVIDENCE_COMMIT
  );
  assert.equal(freeze.nodeVersion, EXP0024_REQUIRED_NODE_VERSION);
  assert.equal(freeze.boundary.openingAbsent, true);
  assert.equal(freeze.boundary.receiptAbsent, true);
  assert.equal(freeze.boundary.journalAbsent, true);
  assert.equal(freeze.boundary.reportAbsent, true);
  assert.equal(freeze.boundary.lockAbsent, true);
  assert.equal(freeze.authority.canProduceNewEffects, false);
  assert.ok(Object.isFrozen(freeze));
});

test("freeze rejeita drift produtivo, allowlist ou interpretação rehasheada", () => {
  const productionDrift = freezeInput();
  productionDrift.productionSources[0].fileSha256 = HASH_B;
  assert.throws(
    () => createExp0024InstrumentationFreeze(productionDrift),
    /fontes produtivas divergiram/u
  );

  const instrumentationExtra = freezeInput();
  instrumentationExtra.instrumentationSources.push({
    path: "scripts/extra.mjs",
    fileSha256: HASH_A
  });
  assert.throws(
    () => createExp0024InstrumentationFreeze(instrumentationExtra),
    /fontes de instrumentação/u
  );

  const wrongNode = freezeInput();
  wrongNode.nodeVersion = "v99.0.0";
  assert.throws(
    () => createExp0024InstrumentationFreeze(wrongNode),
    /Node do freeze/u
  );

  const rehashed = structuredClone(createFreeze());
  rehashed.boundary.reportAbsent = false;
  rehashed.instrumentationFreezeSha256 = HASH_B;
  assert.equal(validateExp0024InstrumentationFreeze(rehashed).valid, false);
});

test("opening vincula freeze, preflight e campanha oficial sem outputs", () => {
  const attempt = createExp0024PhysicalStopAttempt(attemptInput());
  assert.equal(validateExp0024PhysicalStopAttempt(attempt).valid, true);
  assert.equal(attempt.openingParentCommit, COMMIT_B);
  assert.equal(attempt.campaign.command, EXP0024_OFFICIAL_COMMAND);
  assert.equal(attempt.campaign.nonce, EXP0024_ATTEMPT_NONCE);
  assert.equal(attempt.campaign.targetUrl.includes("experiment=0024"), true);
  assert.equal(attempt.campaign.navigations, 2);
  assert.equal(attempt.campaign.stopsPerNavigation, 6);
  assert.equal(attempt.campaign.totalStops, 12);
  assert.equal(attempt.campaign.rerunAllowed, false);
  assert.deepEqual(attempt.preflight.chrome, EXP0024_REQUIRED_CHROME);
  assert.equal(attempt.preflight.provider, "local");
  assert.equal(attempt.boundary.receiptAbsent, true);
  assert.equal(attempt.boundary.journalAbsent, true);
  assert.equal(attempt.boundary.reportAbsent, true);
  assert.equal(attempt.boundary.lockAbsent, true);
});

test("opening falha fechado para ambiente, cardinalidade, rerun e outputs", () => {
  for (const mutate of [
    (attempt) => { attempt.preflight.provider = "openai"; },
    (attempt) => { attempt.preflight.chrome.product = "Chrome/other"; },
    (attempt) => { attempt.preflight.runtimeFingerprintSha256 = "d".repeat(64); },
    (attempt) => { attempt.preflight.targetAutomationNavigations = 1; },
    (attempt) => { attempt.campaign.totalStops = 13; },
    (attempt) => { attempt.campaign.command = "node other.mjs"; },
    (attempt) => { attempt.campaign.rerunAllowed = true; },
    (attempt) => { attempt.boundary.journalAbsent = false; },
    (attempt) => { attempt.freeze.freezeCommit = COMMIT_A; },
    (attempt) => { attempt.extra = true; }
  ]) {
    const attempt = structuredClone(
      createExp0024PhysicalStopAttempt(attemptInput())
    );
    mutate(attempt);
    assert.equal(validateExp0024PhysicalStopAttempt(attempt).valid, false);
  }
});
