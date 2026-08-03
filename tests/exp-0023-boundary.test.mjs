import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0023_ATTEMPT_NONCE,
  EXP0023_BOUNDARY_PATHS,
  EXP0023_C0_CHANGED_PATHS,
  EXP0023_EXP0022_SOURCE_COMMIT,
  EXP0023_IMPLEMENTATION_BASE_COMMIT,
  EXP0023_INHERITED_INSTRUMENTATION_SOURCE_PATHS,
  EXP0023_INHERITED_WORKER_COMMAND,
  EXP0023_INSTRUMENTATION_SOURCE_PATHS,
  EXP0023_OFFICIAL_COMMAND,
  EXP0023_PRODUCTION_SOURCE_PATHS,
  EXP0023_RUNTIME_ALLOWED_DRIFT_PATHS,
  EXP0023_RUNTIME_FINGERPRINT_ALGORITHM,
  EXP0023_RUNTIME_FINGERPRINT_ROOTS,
  createExp0023CaptureAttempt,
  createExp0023InstrumentationFreeze,
  validateExp0023C0Boundary,
  validateExp0023CaptureAttempt,
  validateExp0023InstrumentationFreeze
} from "../src/eval/exp-0023-boundary.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function sourceRecords(paths, inherited = false) {
  const inheritedPaths = new Set(
    inherited ? EXP0023_INHERITED_INSTRUMENTATION_SOURCE_PATHS : paths
  );
  return paths.map((path) => ({
    path,
    fileSha256: HASH_A,
    ...(inheritedPaths.has(path) ? { exp0022FileSha256: HASH_A } : {})
  }));
}

function freezeInput() {
  return {
    runnerSourceCommit: COMMIT_A,
    nodeVersion: "v24.0.0",
    runtimeBinding: {
      algorithm: EXP0023_RUNTIME_FINGERPRINT_ALGORITHM,
      sha256: "c".repeat(64),
      fileCount: 123,
      roots: [...EXP0023_RUNTIME_FINGERPRINT_ROOTS]
    },
    artifacts: {
      preregistration: {
        path: EXP0023_BOUNDARY_PATHS.preregistration,
        fileSha256: HASH_A
      },
      exp0022Report: {
        path: EXP0023_BOUNDARY_PATHS.exp0022Report,
        fileSha256: HASH_A
      },
      exp0022Closeout: {
        path: EXP0023_BOUNDARY_PATHS.exp0022Closeout,
        fileSha256: HASH_A
      }
    },
    productionSources: sourceRecords(EXP0023_PRODUCTION_SOURCE_PATHS),
    instrumentationSources: sourceRecords(
      EXP0023_INSTRUMENTATION_SOURCE_PATHS,
      true
    )
  };
}

function createFreeze() {
  return createExp0023InstrumentationFreeze(freezeInput());
}

function attemptInput() {
  const freeze = createFreeze();
  return {
    openingSourceCommit: COMMIT_B,
    openedAt: "2026-08-03T10:00:00.000Z",
    freeze: {
      path: EXP0023_BOUNDARY_PATHS.freeze,
      fileSha256: HASH_B,
      instrumentationFreezeSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    }
  };
}

test("C0 exige parent e diffs exatos", () => {
  const valid = {
    runnerSourceCommit: COMMIT_A,
    parentCommit: EXP0023_IMPLEMENTATION_BASE_COMMIT,
    changedPaths: [...EXP0023_C0_CHANGED_PATHS],
    runtimeChangedPaths: [...EXP0023_RUNTIME_ALLOWED_DRIFT_PATHS]
  };
  assert.equal(validateExp0023C0Boundary(valid), true);
  assert.equal(validateExp0023C0Boundary({
    ...valid,
    parentCommit: EXP0023_EXP0022_SOURCE_COMMIT
  }), false);
  assert.equal(validateExp0023C0Boundary({
    ...valid,
    changedPaths: [...valid.changedPaths, "src/extra.mjs"]
  }), false);
  assert.equal(validateExp0023C0Boundary({
    ...valid,
    runtimeChangedPaths: ["package.json"]
  }), false);
});

test("freeze liga config, baseline, fontes herdadas e topologia", () => {
  const freeze = createFreeze();
  assert.equal(validateExp0023InstrumentationFreeze(freeze).valid, true);
  assert.equal(freeze.sourceBaseline.experimentId, "EXP-0022");
  assert.equal(
    freeze.sourceBaseline.sourceCommit,
    EXP0023_EXP0022_SOURCE_COMMIT
  );
  assert.deepEqual(
    freeze.implementationBoundary.c0ChangedPaths,
    EXP0023_C0_CHANGED_PATHS
  );
  assert.ok(Object.isFrozen(freeze));
});

test("freeze rejeita drift produtivo e herdado mesmo rehasheado", () => {
  const driftedProduction = freezeInput();
  driftedProduction.productionSources[0].fileSha256 = HASH_B;
  assert.throws(
    () => createExp0023InstrumentationFreeze(driftedProduction),
    /fontes produtivas divergiram/u
  );

  const driftedWorker = freezeInput();
  const worker = driftedWorker.instrumentationSources.find(
    ({ path }) => path === "scripts/run-exp-0022-worker.mjs"
  );
  worker.fileSha256 = HASH_B;
  assert.throws(
    () => createExp0023InstrumentationFreeze(driftedWorker),
    /fontes de instrumentação/u
  );
});

test("freeze rejeita path extra, artefato trocado e hash canônico falso", () => {
  const extra = structuredClone(createFreeze());
  extra.extra = true;
  assert.equal(validateExp0023InstrumentationFreeze(extra).valid, false);

  const artifact = structuredClone(createFreeze());
  artifact.artifacts.preregistration.path =
    "docs/experiments/EXP-0022-bootstrap-audit-health-binding.md";
  assert.equal(validateExp0023InstrumentationFreeze(artifact).valid, false);

  const rehashed = structuredClone(createFreeze());
  rehashed.instrumentationFreezeSha256 = HASH_B;
  assert.equal(validateExp0023InstrumentationFreeze(rehashed).valid, false);
});

test("tentativa liga freeze, worker herdado e campanha única", () => {
  const attempt = createExp0023CaptureAttempt(attemptInput());
  assert.equal(validateExp0023CaptureAttempt(attempt).valid, true);
  assert.equal(attempt.campaign.nonce, EXP0023_ATTEMPT_NONCE);
  assert.equal(attempt.campaign.command, EXP0023_OFFICIAL_COMMAND);
  assert.equal(
    attempt.campaign.inheritedWorkerCommand,
    EXP0023_INHERITED_WORKER_COMMAND
  );
  assert.equal(attempt.campaign.targetUrl.includes("experiment=0022"), true);
  assert.equal(attempt.campaign.navigations, 2);
  assert.equal(attempt.campaign.totalRequests, 4);
  assert.deepEqual(
    attempt.campaign.trialOrder.map(({ trialId }) => trialId),
    ["A1", "B1", "B2", "A2"]
  );
  assert.equal(attempt.boundary.rerunAllowed, false);
  assert.equal(attempt.authority.canProduceNewEffects, false);
});

test("tentativa rejeita comando, cardinalidade, outputs e chaves extras", () => {
  for (const mutate of [
    (attempt) => { attempt.campaign.command = "node other.mjs"; },
    (attempt) => { attempt.campaign.navigations = 3; },
    (attempt) => { attempt.campaign.reportPath = "eval/reports/other.json"; },
    (attempt) => { attempt.boundary.rerunAllowed = true; },
    (attempt) => { attempt.extra = true; }
  ]) {
    const attempt = structuredClone(createExp0023CaptureAttempt(attemptInput()));
    mutate(attempt);
    assert.equal(validateExp0023CaptureAttempt(attempt).valid, false);
  }
});

test("tentativa exige freezeCommit igual ao commit de abertura", () => {
  const attempt = structuredClone(createExp0023CaptureAttempt(attemptInput()));
  attempt.freeze.freezeCommit = COMMIT_A;
  assert.equal(validateExp0023CaptureAttempt(attempt).valid, false);
});
