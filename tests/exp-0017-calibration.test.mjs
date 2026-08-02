import assert from "node:assert/strict";
import test from "node:test";

import {
  compareExp0017Paired,
  evaluateExp0017SafeVetoThreshold,
  selectExp0017SafeVetoThreshold,
  summarizeExp0017Observations
} from "../src/eval/exp-0017-calibration.mjs";

const BACKGROUND = "BACKGROUND_OR_NOT_DIRECTED";
const DIRECTED = "DIRECTED_TO_ASSISTANT";

function calibrationFixture() {
  return [
    { exampleId: "background-high", expected: BACKGROUND,
      backgroundProbability: 0.9 },
    { exampleId: "background-boundary", expected: BACKGROUND,
      backgroundProbability: 0.8 },
    { exampleId: "directed-boundary", expected: DIRECTED,
      backgroundProbability: 0.79 },
    { exampleId: "directed-low", expected: DIRECTED,
      backgroundProbability: 0.2 }
  ];
}

test("calibração escolhe deterministicamente máxima cobertura segura", () => {
  const first = selectExp0017SafeVetoThreshold(calibrationFixture());
  const second = selectExp0017SafeVetoThreshold(
    calibrationFixture().toReversed()
  );

  assert.equal(first.safeSolution, true);
  assert.equal(first.noSafeSolution, false);
  assert.equal(first.selected.threshold, 0.8);
  assert.equal(first.selected.backgroundCoverage, 1);
  assert.equal(first.selected.directedRecall, 1);
  assert.deepEqual(second, first);
});

test("calibração explicita ausência de qualquer threshold seguro", () => {
  const result = selectExp0017SafeVetoThreshold([
    { exampleId: "background", expected: BACKGROUND,
      backgroundProbability: 1 },
    { exampleId: "directed", expected: DIRECTED,
      backgroundProbability: 1 }
  ]);

  assert.equal(result.safeSolution, false);
  assert.equal(result.noSafeSolution, true);
  assert.equal(result.selected, null);
  assert.equal(result.safeCandidates, 0);
});

test("sumário e comparação pareada preservam casos e ganho líquido", () => {
  const selected = selectExp0017SafeVetoThreshold(calibrationFixture());
  const candidate = evaluateExp0017SafeVetoThreshold(
    calibrationFixture(),
    selected.selected.threshold
  );
  const reference = candidate.observations.map((observation) => ({
    exampleId: observation.exampleId,
    expected: observation.expected,
    predicted: DIRECTED
  }));
  const summary = summarizeExp0017Observations(candidate.observations);
  const paired = compareExp0017Paired(reference, candidate.observations);

  assert.equal(summary.accuracy, 1);
  assert.equal(summary.classRecall[BACKGROUND], 1);
  assert.equal(summary.classRecall[DIRECTED], 1);
  assert.equal(paired.wins, 2);
  assert.equal(paired.losses, 0);
  assert.equal(paired.netGain, 2);
  assert.deepEqual(paired.winExampleIds, [
    "background-boundary",
    "background-high"
  ]);
});

test("comparação pareada rejeita universos ou gabaritos divergentes", () => {
  const reference = [
    { exampleId: "one", expected: BACKGROUND, predicted: DIRECTED }
  ];
  assert.throws(
    () => compareExp0017Paired(reference, []),
    /universos pareados/iu
  );
  assert.throws(
    () => compareExp0017Paired(reference, [
      { exampleId: "one", expected: DIRECTED, predicted: DIRECTED }
    ]),
    /gabarito/iu
  );
});
