import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateExp0016BrowserReport,
  validateExp0016CanonicalReport
} from "../scripts/lib/exp-0016-analysis.mjs";

const canonical = JSON.parse(await readFile(new URL(
  "../eval/reports/exp-0016-speaker-relevance-m4b-v1.json",
  import.meta.url
)));

test("relatório canônico promove shadow e bloqueia autoridade", () => {
  const validation = validateExp0016CanonicalReport(canonical);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(canonical.metrics.offline.holdout.candidate.raw.accuracy, 7 / 9);
  assert.equal(canonical.metrics.humanAnchor.baseline.correct, 5);
  assert.equal(canonical.metrics.humanAnchor.candidate.safeVeto.correct, 7);
  assert.equal(
    canonical.metrics.humanAnchor.candidate.safeVeto.classRecall
      .DIRECTED_TO_ASSISTANT,
    1
  );
});

test("validador browser rejeita futuro, autoridade e falsa paridade", () => {
  const baseCase = {
    probeId: "probe",
    evaluationRole: "browser-runtime-contract-only",
    fitEligibility: "excluded-from-fit",
    artifact: { waveSha256: `sha256:${"a".repeat(64)}` },
    browser: {
      probabilities: {
        BACKGROUND_OR_NOT_DIRECTED: 0.25,
        DIRECTED_TO_ASSISTANT: 0.75
      },
      futureSamplesUsed: 0,
      authority: false
    },
    node: {
      probabilities: {
        BACKGROUND_OR_NOT_DIRECTED: 0.25,
        DIRECTED_TO_ASSISTANT: 0.75
      }
    },
    parity: { labels: true, probabilities: true }
  };
  const cases = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(baseCase),
    probeId: `probe-${index}`,
    artifact: { waveSha256: `sha256:${String(index).repeat(64)}` }
  }));
  const value = {
    schemaVersion: "exp-0016-browser-shadow-report-v1",
    experimentId: "exp",
    checkpoint: { modelSha256: `sha256:${"b".repeat(64)}` },
    dataset: {
      sha256: `sha256:${"c".repeat(64)}`,
      fitExamplesFromBrowserProbes: 0
    },
    cases,
    metrics: { cases: 4, maximumFutureSamplesUsed: 0 },
    gates: {
      checkpointLoaded: true,
      fourRuntimeCases: true,
      distinctAudio: true,
      causal: true,
      nodeBrowserParity: true,
      noAuthority: true
    },
    pass: true,
    authorityEligible: false
  };
  const expected = {
    experimentId: "exp",
    datasetSha256: `sha256:${"c".repeat(64)}`,
    modelSha256: `sha256:${"b".repeat(64)}`
  };
  assert.equal(validateExp0016BrowserReport(value, expected).valid, true);
  value.cases[0].browser.futureSamplesUsed = 1;
  value.cases[1].browser.authority = true;
  value.cases[2].parity.probabilities = false;
  assert.equal(validateExp0016BrowserReport(value, expected).valid, false);
});
