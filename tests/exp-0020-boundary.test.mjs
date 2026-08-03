import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0020_ATTEMPT_NONCE,
  EXP0020_BOUNDARY_PATHS,
  EXP0020_INSTRUMENTATION_SOURCE_PATHS,
  EXP0020_PRODUCTION_SOURCE_PATHS,
  createExp0020BrowserAttempt,
  createExp0020InstrumentationFreeze,
  validateExp0020BrowserAttempt,
  validateExp0020InstrumentationFreeze
} from "../src/eval/exp-0020-boundary.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function freezeFixture() {
  return createExp0020InstrumentationFreeze({
    runnerSourceCommit: COMMIT_A,
    nodeVersion: "v22.0.0",
    artifacts: {
      preregistration: {
        path: EXP0020_BOUNDARY_PATHS.preregistration,
        fileSha256: HASH_A
      },
      exp0019Report: {
        path: EXP0020_BOUNDARY_PATHS.exp0019Report,
        fileSha256: HASH_B
      }
    },
    productionSources: EXP0020_PRODUCTION_SOURCE_PATHS.map((path) => ({
      path,
      fileSha256: HASH_A,
      exp0019FileSha256: HASH_A
    })),
    instrumentationSources: EXP0020_INSTRUMENTATION_SOURCE_PATHS.map(
      (path) => ({ path, fileSha256: HASH_B })
    )
  });
}

test("freeze liga fontes de produção ao EXP-0019 e instrumentação ao commit", () => {
  const freeze = freezeFixture();
  assert.equal(validateExp0020InstrumentationFreeze(freeze).valid, true);
  assert.equal(freeze.boundary.browserCampaignsBeforeFreeze, 0);
  assert.equal(freeze.authority.canProduceNewEffects, false);
});

test("freeze rejeita drift de produção mesmo com hash canônico refeito", () => {
  const freeze = structuredClone(freezeFixture());
  freeze.productionSources[0].fileSha256 = HASH_B;
  const core = structuredClone(freeze);
  delete core.instrumentationFreezeSha256;
  freeze.instrumentationFreezeSha256 = `sha256:${canonicalSha256(core)}`;
  assert.equal(validateExp0020InstrumentationFreeze(freeze).valid, false);
});

test("tentativa única fixa freeze, cardinalidade, output e proíbe rerun", () => {
  const freeze = freezeFixture();
  const attempt = createExp0020BrowserAttempt({
    openingSourceCommit: COMMIT_B,
    openedAt: "2026-08-03T06:00:00.000Z",
    freeze: {
      path: EXP0020_BOUNDARY_PATHS.freeze,
      fileSha256: HASH_A,
      instrumentationFreezeSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    }
  });
  assert.equal(validateExp0020BrowserAttempt(attempt).valid, true);
  assert.equal(attempt.campaign.nonce, EXP0020_ATTEMPT_NONCE);
  assert.equal(attempt.boundary.rerunAllowed, false);
  assert.equal(attempt.campaign.reportPath, EXP0020_BOUNDARY_PATHS.report);
  assert.equal(attempt.campaign.receiptPath, EXP0020_BOUNDARY_PATHS.receipt);
});

test("tentativa adulterada não pode ampliar cardinalidade ou liberar rerun", () => {
  const freeze = freezeFixture();
  const attempt = createExp0020BrowserAttempt({
    openingSourceCommit: COMMIT_B,
    openedAt: "2026-08-03T06:00:00.000Z",
    freeze: {
      path: EXP0020_BOUNDARY_PATHS.freeze,
      fileSha256: HASH_A,
      instrumentationFreezeSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    }
  });
  const expanded = structuredClone(attempt);
  expanded.campaign.totalStops = 24;
  expanded.boundary.rerunAllowed = true;
  const core = structuredClone(expanded);
  delete core.browserAttemptSha256;
  expanded.browserAttemptSha256 = `sha256:${canonicalSha256(core)}`;
  assert.equal(validateExp0020BrowserAttempt(expanded).valid, false);
});
