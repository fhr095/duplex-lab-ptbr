import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0017_MANIFEST_SCHEMA,
  finalizeExp0017Manifest
} from "../src/eval/exp-0017-contract.mjs";
import {
  validateExp0017Matrix
} from "../src/eval/exp-0017-matrix.mjs";

const BACKGROUND = "BACKGROUND_OR_NOT_DIRECTED";
const DIRECTED = "DIRECTED_TO_ASSISTANT";

function hash(index, offset = 0) {
  return `sha256:${(index + offset).toString(16).padStart(64, "0")}`;
}

function matrixFixture() {
  const items = [];
  let artifact = 1;
  for (const [splitIndex, partition] of [
    "train",
    "development"
  ].entries()) {
    for (let sourceIndex = 0; sourceIndex < 30; sourceIndex += 1) {
      const directed = sourceIndex < 15;
      const label = directed ? DIRECTED : BACKGROUND;
      const classIndex = directed ? sourceIndex : sourceIndex - 15;
      const family = directed
        ? ["correction", "short", "direct-generic", "direct-other"][
          Math.min(3, Math.floor(classIndex / 4))
        ]
        : ["backchannel", "lateral", "broadcast", "assistant-leakage"][
          Math.min(3, Math.floor(classIndex / 4))
        ];
      for (let conditionIndex = 0; conditionIndex < 4; conditionIndex += 1) {
        const token = `${partition}-${sourceIndex}-${conditionIndex}`;
        const hardDirectedStrata = directed
          ? [
            ...(conditionIndex === 1 ? ["low-distant"] : []),
            ...(conditionIndex === 3 ? ["partially-overlapped"] : []),
            ...(family === "correction" ? ["correction"] : []),
            ...(family === "short" ? ["short"] : [])
          ]
          : [];
        items.push({
          artifactId: `artifact-${token}`,
          sourceId: "supertonic-synthetic",
          sourceArtifactId: `source-artifact-${token}`,
          partition,
          lineageRootId: `lineage-${partition}-${sourceIndex}`,
          speakerGroupId: `speaker-${partition}-${sourceIndex % 8}`,
          semanticGroupId: `semantic-${partition}-${sourceIndex}`,
          templateGroupId: `template-${partition}-${sourceIndex}`,
          recipeFamilyId: `recipe-${partition}-${conditionIndex}`,
          waveSha256: hash(artifact, 1_000),
          pcmSha256: hash(artifact, 10_000),
          secondaryLineageRootIds: conditionIndex === 3
            ? [`lineage-${partition}-${(sourceIndex + 1) % 30}`]
            : [],
          label,
          fitEligibility: "fit-eligible",
          sourceKind: "synthetic-ai",
          conversationFamilyId: `${partition}-${family}`,
          voiceProfileId: `voice-${partition}-${sourceIndex % 4}`,
          acousticConditionId: `condition-${conditionIndex}`,
          hardDirectedStrata,
          decisionSamples: 8_960,
          sampleRate: 16_000,
          futureSamplesUsed: 0
        });
        artifact += 1;
      }
    }
  }
  return finalizeExp0017Manifest({
    schemaVersion: EXP0017_MANIFEST_SCHEMA,
    experimentId: "exp-0017-matrix-test",
    locale: "pt-BR",
    sources: [{
      sourceId: "supertonic-synthetic",
      revision: "fixture-r1",
      license: "OpenRAIL-M",
      kind: "synthetic-ai"
    }],
    retention: { rawAudioInGit: false },
    items
  });
}

test("matriz mínima cruza condições e fecha todos os denominadores", () => {
  const result = validateExp0017Matrix(matrixFixture());
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.summaries.development.examples, 120);
  assert.equal(result.summaries.development.labels[DIRECTED], 60);
  assert.equal(result.summaries.development.labels[BACKGROUND], 60);
  assert.equal(result.summaries.development.voiceProfiles, 4);
  assert.equal(result.summaries.development.maximumLineageShare, 4 / 120);
});

test("matriz rejeita denominador reduzido no desenvolvimento", () => {
  const reduced = structuredClone(matrixFixture());
  reduced.items = reduced.items.filter((item) => !(
    item.partition === "development" && item.lineageRootId.endsWith("-29")
  ));
  const result = validateExp0017Matrix(finalizeExp0017Manifest(reduced));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("; "), /denominador|abaixo do mínimo/iu);
});

test("matriz rejeita condição confundida com classe e hard negatives ausentes", () => {
  const confounded = structuredClone(matrixFixture());
  for (const item of confounded.items) {
    if (
      item.partition === "development" &&
      item.label === BACKGROUND &&
      item.acousticConditionId === "condition-0"
    ) {
      item.acousticConditionId = "condition-background-only";
    }
  }
  let result = validateExp0017Matrix(finalizeExp0017Manifest(confounded));
  assert.match(result.errors.join("; "), /correlacionada à classe/iu);

  const missingHard = structuredClone(matrixFixture());
  for (const item of missingHard.items) {
    if (item.partition === "development") {
      item.hardDirectedStrata = item.hardDirectedStrata.filter(
        (stratum) => stratum !== "correction"
      );
    }
  }
  result = validateExp0017Matrix(finalizeExp0017Manifest(missingHard));
  assert.match(result.errors.join("; "), /correction abaixo do mínimo/iu);
});

test("matriz rejeita pseudorreplicação acima de 25%", () => {
  const manifest = structuredClone(matrixFixture());
  for (const item of manifest.items.filter(
    (candidate) => candidate.partition === "development"
  ).slice(0, 32)) {
    item.lineageRootId = "lineage-development-dominant";
  }
  const result = validateExp0017Matrix(finalizeExp0017Manifest(manifest));
  assert.match(result.errors.join("; "), /teto de participação/iu);
});
