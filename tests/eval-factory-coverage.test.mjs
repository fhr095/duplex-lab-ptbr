import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateFactoryCoverage
} from "../src/eval/factory/coverage.mjs";

function makeCase(id, marker, timingPattern) {
  return {
    id,
    familyRootId: id,
    split: "development",
    stimulus: {
      text: `${id} terça ${marker} sexta`,
      slotType: "weekday",
      marker,
      timingPattern,
      effectRisk: "reversible"
    }
  };
}

test("cobertura conta diversidade real e combinações pairwise", () => {
  const pack = {
    coverage: {
      dimensions: {
        "stimulus.marker": ["não", "na verdade"],
        "stimulus.timingPattern": ["continuous", "pause"]
      },
      minCases: 4,
      minPerValue: 1,
      minUniqueTextRatio: 1,
      minPairwiseRatio: 1
    },
    cases: [
      makeCase("a", "não", "continuous"),
      makeCase("b", "não", "pause"),
      makeCase("c", "na verdade", "continuous"),
      makeCase("d", "na verdade", "pause")
    ]
  };

  const report = evaluateFactoryCoverage(pack);
  assert.equal(report.pass, true);
  assert.equal(report.pairwise.ratio, 1);
  assert.equal(report.uniqueTextRatio, 1);
});

test("volume duplicado não mascara monocultura", () => {
  const repeated = makeCase("a", "não", "continuous");
  const pack = {
    coverage: {
      dimensions: {
        "stimulus.marker": ["não", "na verdade"],
        "stimulus.timingPattern": ["continuous", "pause"]
      },
      minCases: 2,
      minPerValue: 1,
      minUniqueTextRatio: 1,
      minPairwiseRatio: 1
    },
    cases: [repeated, { ...repeated, id: "b", familyRootId: "b" }]
  };

  const report = evaluateFactoryCoverage(pack);
  assert.equal(report.pass, false);
  assert.ok(report.failures.some((failure) => failure.id === "unique-text"));
  assert.ok(report.failures.some((failure) => failure.id === "pairwise"));
});

