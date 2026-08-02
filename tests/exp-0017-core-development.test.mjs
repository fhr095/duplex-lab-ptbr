import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateExp0017DevelopmentGates,
  exp0017DevelopmentInputPaths
} from "../scripts/train-exp-0017-core-development.mjs";

const BACKGROUND = "BACKGROUND_OR_NOT_DIRECTED";
const DIRECTED = "DIRECTED_TO_ASSISTANT";

function fixture(overrides = {}) {
  return {
    candidate: {
      accuracy: 0.9,
      classRecall: {
        [BACKGROUND]: 0.8,
        [DIRECTED]: 1
      }
    },
    pairedAgainstA0: { netGain: 2 },
    gainOverAllDirected: 0.4,
    config: {
      gates: {
        pairedDecisionUnit: "lineage-root-all-descendants-correct",
        minimumDirectedRecall: 1,
        minimumAccuracy: 0.75,
        minimumClassRecall: 0.75,
        minimumGainOverAllDirected: 0.2,
        minimumPairedNetGainAgainstA0: 1
      }
    },
    manifestValid: true,
    matrixValid: true,
    developmentDatasetValid: true,
    holdoutConstructed: false,
    holdoutRead: false,
    selectedFitSplit: "train",
    selectedCalibrationSplit: "development",
    repeatedTrainingEqual: true,
    checkpointValid: true,
    modelHashBound: true,
    thresholdSelected: true,
    futureSamplesUsed: 0,
    canProduceEffects: false,
    ...overrides
  };
}

test("gate de desenvolvimento qualifica somente o conjunto completo", () => {
  const gates = evaluateExp0017DevelopmentGates(fixture());
  assert.equal(gates.allPassed, true);
  assert.equal(Object.values(gates).every(Boolean), true);
});

test("um veto dirigido ou ausência de ganho retém A0", () => {
  const directedVeto = evaluateExp0017DevelopmentGates(fixture({
    candidate: {
      accuracy: 0.9,
      classRecall: {
        [BACKGROUND]: 0.8,
        [DIRECTED]: 0.99
      }
    }
  }));
  assert.equal(directedVeto.directedRecallIsPerfect, false);
  assert.equal(directedVeto.allPassed, false);

  const noNetGain = evaluateExp0017DevelopmentGates(fixture({
    pairedAgainstA0: { netGain: 0 }
  }));
  assert.equal(noNetGain.minimumPairedNetGainAgainstA0, false);
  assert.equal(noNetGain.allPassed, false);
});

test("qualquer leitura de holdout, futuro ou autoridade falha fechado", () => {
  for (const overrides of [
    { holdoutRead: true },
    { futureSamplesUsed: 1 },
    { canProduceEffects: true },
    { selectedFitSplit: "holdout-core" },
    { selectedCalibrationSplit: "holdout-core" }
  ]) {
    assert.equal(
      evaluateExp0017DevelopmentGates(fixture(overrides)).allPassed,
      false
    );
  }
});

test("allowlist física contém somente config, manifest dev, dataset dev e A0", () => {
  const paths = exp0017DevelopmentInputPaths("config.json", {
    outputs: {
      manifest: "manifest-development.json",
      developmentDataset: "dataset-development.json"
    },
    referenceA0: { checkpoint: "a0.json" }
  });
  assert.deepEqual(paths, [
    "config.json",
    "manifest-development.json",
    "dataset-development.json",
    "a0.json"
  ]);
  assert.throws(() => exp0017DevelopmentInputPaths("config.json", {
    outputs: {
      manifest: "holdout-manifest.json",
      developmentDataset: "dataset-development.json"
    },
    referenceA0: { checkpoint: "a0.json" }
  }), /allowlist/iu);
});
