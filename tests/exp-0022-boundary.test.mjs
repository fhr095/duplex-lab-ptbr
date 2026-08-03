import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0022_ATTEMPT_NONCE,
  EXP0022_BOUNDARY_PATHS,
  EXP0022_C0_CHANGED_PATHS,
  EXP0022_EXP0021_SOURCE_COMMIT,
  EXP0022_GIT_TOPOLOGY,
  EXP0022_IMPLEMENTATION_BASE_COMMIT,
  EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS,
  EXP0022_INSTRUMENTATION_SOURCE_PATHS,
  EXP0022_OFFICIAL_COMMAND,
  EXP0022_PRODUCTION_SOURCE_PATHS,
  EXP0022_RUNTIME_ALLOWED_DRIFT_PATHS,
  EXP0022_RUNTIME_FINGERPRINT_ALGORITHM,
  EXP0022_RUNTIME_FINGERPRINT_ROOTS,
  EXP0022_TRIAL_ORDER,
  createExp0022CaptureAttempt,
  createExp0022InstrumentationFreeze,
  validateExp0022C0Boundary,
  validateExp0022CaptureAttempt,
  validateExp0022InstrumentationFreeze
} from "../src/eval/exp-0022-boundary.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { RUNTIME_FINGERPRINT_ROOTS } from
  "../src/eval/runtime-provenance.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function freezeFixture() {
  return createExp0022InstrumentationFreeze({
    runnerSourceCommit: COMMIT_A,
    nodeVersion: "v22.0.0",
    runtimeBinding: {
      algorithm: EXP0022_RUNTIME_FINGERPRINT_ALGORITHM,
      sha256: "c".repeat(64),
      fileCount: 123,
      roots: [...EXP0022_RUNTIME_FINGERPRINT_ROOTS]
    },
    artifacts: {
      preregistration: {
        path: EXP0022_BOUNDARY_PATHS.preregistration,
        fileSha256: HASH_A
      },
      exp0021Report: {
        path: EXP0022_BOUNDARY_PATHS.exp0021Report,
        fileSha256: HASH_B
      },
      exp0021Closeout: {
        path: EXP0022_BOUNDARY_PATHS.exp0021Closeout,
        fileSha256: HASH_A
      }
    },
    productionSources: EXP0022_PRODUCTION_SOURCE_PATHS.map((path) => ({
      path,
      fileSha256: HASH_A,
      exp0021FileSha256: HASH_A
    })),
    instrumentationSources: EXP0022_INSTRUMENTATION_SOURCE_PATHS.map(
      (path) => ({
        path,
        fileSha256: HASH_B,
        ...(EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS.includes(path)
          ? { exp0021FileSha256: HASH_B }
          : {})
      })
    )
  });
}

function attemptFixture() {
  const freeze = freezeFixture();
  return createExp0022CaptureAttempt({
    openingSourceCommit: COMMIT_B,
    openedAt: "2026-08-03T12:00:00.000Z",
    freeze: {
      path: EXP0022_BOUNDARY_PATHS.freeze,
      fileSha256: HASH_A,
      instrumentationFreezeSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    }
  });
}

function rehashFreeze(freeze) {
  const core = structuredClone(freeze);
  delete core.instrumentationFreezeSha256;
  freeze.instrumentationFreezeSha256 = `sha256:${canonicalSha256(core)}`;
}

function rehashAttempt(attempt) {
  const core = structuredClone(attempt);
  delete core.captureAttemptSha256;
  attempt.captureAttemptSha256 = `sha256:${canonicalSha256(core)}`;
}

test("freeze liga C0, config, artefatos e baseline produtivo EXP-0021", () => {
  const freeze = freezeFixture();
  assert.equal(validateExp0022InstrumentationFreeze(freeze).valid, true);
  assert.equal(
    freeze.sourceBaseline.evidenceCommit,
    EXP0022_EXP0021_SOURCE_COMMIT
  );
  assert.deepEqual(
    freeze.productionSources.map(({ fileSha256, exp0021FileSha256 }) =>
      [fileSha256, exp0021FileSha256]),
    EXP0022_PRODUCTION_SOURCE_PATHS.map(() => [HASH_A, HASH_A])
  );
  assert.equal(freeze.runnerSourceCommit, COMMIT_A);
  assert.equal(freeze.runtimeBinding.sha256, "c".repeat(64));
  assert.deepEqual(
    EXP0022_RUNTIME_FINGERPRINT_ROOTS,
    RUNTIME_FINGERPRINT_ROOTS
  );
  assert.equal(freeze.boundary.captureCampaignsBeforeFreeze, 0);
  assert.equal(freeze.authority.canProduceNewEffects, false);
});

test("freeze rejeita drift produtivo mesmo quando o hash canônico é refeito", () => {
  const freeze = structuredClone(freezeFixture());
  freeze.productionSources[0].fileSha256 = HASH_B;
  rehashFreeze(freeze);
  assert.equal(validateExp0022InstrumentationFreeze(freeze).valid, false);
});

test("freeze rejeita drift no adaptador ou teste de captura herdado", () => {
  const freeze = structuredClone(freezeFixture());
  const inherited = freeze.instrumentationSources.find(({ path }) =>
    EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS.includes(path));
  inherited.fileSha256 = HASH_A;
  rehashFreeze(freeze);
  assert.equal(validateExp0022InstrumentationFreeze(freeze).valid, false);
});

test("freeze rejeita ampliação dos allowlists e chaves não registradas", () => {
  const expanded = structuredClone(freezeFixture());
  expanded.instrumentationSources.push({
    path: "scripts/exp-0022-unregistered.mjs",
    fileSha256: HASH_A
  });
  expanded.boundary.unregisteredAuthority = 0;
  rehashFreeze(expanded);
  assert.equal(validateExp0022InstrumentationFreeze(expanded).valid, false);
});

test("C0 exige parent e deltas exatos, inclusive em todo o runtime", () => {
  const valid = {
    runnerSourceCommit: COMMIT_A,
    parentCommit: EXP0022_IMPLEMENTATION_BASE_COMMIT,
    changedPaths: [...EXP0022_C0_CHANGED_PATHS],
    runtimeChangedPaths: [...EXP0022_RUNTIME_ALLOWED_DRIFT_PATHS]
  };
  assert.equal(validateExp0022C0Boundary(valid), true);
  for (const mutate of [
    (input) => { input.parentCommit = COMMIT_B; },
    (input) => { input.changedPaths.push("web/stream-utils.mjs"); },
    (input) => { input.runtimeChangedPaths.push("src/brain/local-brain.mjs"); }
  ]) {
    const input = structuredClone(valid);
    mutate(input);
    assert.equal(validateExp0022C0Boundary(input), false);
  }

  const freeze = structuredClone(freezeFixture());
  freeze.implementationBoundary.c0ChangedPaths.push("src/efeito-extra.mjs");
  rehashFreeze(freeze);
  assert.equal(validateExp0022InstrumentationFreeze(freeze).valid, false);
});

test("freeze rejeita drift de config, artefato ou topologia", () => {
  for (const mutate of [
    (freeze) => { freeze.config.navigations = 3; },
    (freeze) => { freeze.artifacts.exp0021Report.path = "outro.json"; },
    (freeze) => { freeze.gitTopology.evidenceDirectParent = "FREEZE"; }
  ]) {
    const freeze = structuredClone(freezeFixture());
    mutate(freeze);
    rehashFreeze(freeze);
    assert.equal(validateExp0022InstrumentationFreeze(freeze).valid, false);
  }
});

test("tentativa liga freeze, comando oficial e campanha 2x2 balanceada", () => {
  const attempt = attemptFixture();
  assert.equal(validateExp0022CaptureAttempt(attempt).valid, true);
  assert.equal(attempt.campaign.nonce, EXP0022_ATTEMPT_NONCE);
  assert.equal(attempt.campaign.command, EXP0022_OFFICIAL_COMMAND);
  assert.equal(attempt.campaign.navigations, 2);
  assert.equal(attempt.campaign.requestsPerNavigation, 2);
  assert.equal(attempt.campaign.totalRequests, 4);
  assert.deepEqual(attempt.campaign.trialOrder, EXP0022_TRIAL_ORDER);
  assert.deepEqual(
    attempt.campaign.trialOrder.map(({ trialId }) => trialId),
    ["A1", "B1", "B2", "A2"]
  );
  assert.equal(attempt.freeze.freezeCommit, COMMIT_B);
  assert.equal(attempt.freeze.runnerSourceCommit, COMMIT_A);
  assert.equal(attempt.campaign.reportPath, EXP0022_BOUNDARY_PATHS.report);
  assert.equal(attempt.campaign.receiptPath, EXP0022_BOUNDARY_PATHS.receipt);
  assert.equal(attempt.boundary.rerunAllowed, false);
});

test("tentativa rejeita ampliação de cardinalidade, ordem ou rerun", () => {
  for (const mutate of [
    (attempt) => { attempt.campaign.totalRequests = 5; },
    (attempt) => { attempt.campaign.trialOrder[1].trialId = "A2"; },
    (attempt) => { attempt.boundary.rerunAllowed = true; }
  ]) {
    const attempt = structuredClone(attemptFixture());
    mutate(attempt);
    rehashAttempt(attempt);
    assert.equal(validateExp0022CaptureAttempt(attempt).valid, false);
  }
});

test("tentativa rejeita troca de comando, outputs ou chaves extras", () => {
  for (const mutate of [
    (attempt) => { attempt.campaign.command = "node outro.mjs"; },
    (attempt) => { attempt.campaign.receiptPath = "receipt-alternativo.json"; },
    (attempt) => { attempt.campaign.reportPath = "report-alternativo.json"; },
    (attempt) => { attempt.freeze.extra = true; }
  ]) {
    const attempt = structuredClone(attemptFixture());
    mutate(attempt);
    rehashAttempt(attempt);
    assert.equal(validateExp0022CaptureAttempt(attempt).valid, false);
  }
});

test("topologia lógica exige C0 distinto do freeze e evidence só após opening", () => {
  assert.deepEqual(EXP0022_GIT_TOPOLOGY.order, [
    "C0_INSTRUMENT",
    "FREEZE",
    "OPENING",
    "EVIDENCE"
  ]);
  assert.deepEqual(EXP0022_GIT_TOPOLOGY.evidenceAllowedPaths, [
    EXP0022_BOUNDARY_PATHS.receipt,
    EXP0022_BOUNDARY_PATHS.report
  ]);

  const sameCommit = structuredClone(attemptFixture());
  sameCommit.openingSourceCommit = COMMIT_A;
  sameCommit.freeze.freezeCommit = COMMIT_A;
  rehashAttempt(sameCommit);
  assert.equal(validateExp0022CaptureAttempt(sameCommit).valid, false);

  const widenedEvidence = structuredClone(attemptFixture());
  widenedEvidence.gitTopology.evidenceAllowedPaths.push("trace-extra.json");
  rehashAttempt(widenedEvidence);
  assert.equal(validateExp0022CaptureAttempt(widenedEvidence).valid, false);
});
