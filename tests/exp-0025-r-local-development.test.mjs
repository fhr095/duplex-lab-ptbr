import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExp0025RLocalDevelopmentReport,
  validateExp0025RLocalDevelopmentReport
} from "../scripts/run-exp-0025-r-local-development.mjs";

test("relatório D congela um único L sem abrir H ou autorizar E", async () => {
  const report = await buildExp0025RLocalDevelopmentReport();
  assert.equal(validateExp0025RLocalDevelopmentReport(report), true);
  assert.equal(report.analysis.againstNative.correctedPrematureTakeovers, 4);
  assert.equal(report.analysis.againstNative.introducedPrematureTakeovers, 0);
  assert.equal(report.analysis.againstNative.sessionsImproved, 3);
  assert.equal(report.analysis.candidate.postFinalDecisionDelayMs.p95, 1_200);
  assert.equal(
    report.analysis.cadenceAttribution,
    "CANDIDATE_EQUIVALENT_TO_A0_AT_600"
  );
  assert.equal(report.externalReference.executionAuthorized, false);
  assert.equal(report.holdoutOpened, false);
  assert.equal(report.authorityEligible, false);
});

test("relatório D preserva trajetória e diagnóstico por fala", async () => {
  const report = await buildExp0025RLocalDevelopmentReport();
  assert.equal(report.analysis.utteranceResults.native.length, 32);
  assert.equal(report.analysis.utteranceResults.a0At600.length, 32);
  assert.equal(report.analysis.utteranceResults.candidate.length, 32);
  assert.equal(report.analysis.cadenceDiagnostics.length, 32);
  assert.deepEqual(
    report.analysis.againstNative.correctedUtteranceIds,
    [
      "exp0025r-dev-p02-continues",
      "exp0025r-dev-p07-continues",
      "exp0025r-dev-p09-continues",
      "exp0025r-dev-p13-continues"
    ]
  );
});
