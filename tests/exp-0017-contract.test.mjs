import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0017_CLASSES,
  EXP0017_DEVELOPMENT_DATASET_SCHEMA,
  EXP0017_DEVELOPMENT_REPORT_SCHEMA,
  EXP0017_MANIFEST_SCHEMA,
  finalizeExp0017DevelopmentDataset,
  finalizeExp0017DevelopmentReport,
  finalizeExp0017Manifest,
  validateExp0017DevelopmentDataset,
  validateExp0017DevelopmentReport,
  validateExp0017Manifest
} from "../src/eval/exp-0017-contract.mjs";
import {
  SPEAKER_RELEVANCE_FEATURES,
  SPEAKER_RELEVANCE_FEATURE_VERSION
} from "../src/eval/speaker-relevance-features.mjs";

const BACKGROUND = EXP0017_CLASSES[0];
const DIRECTED = EXP0017_CLASSES[1];

function hash(character) {
  return `sha256:${character.repeat(64)}`;
}

function manifestItem(index, partition, label) {
  const token = `${partition}-${index}`;
  return {
    artifactId: `artifact-${token}`,
    sourceId: "fixture-open-source",
    sourceArtifactId: `source-${token}`,
    partition,
    lineageRootId: `lineage-${token}`,
    speakerGroupId: `speaker-${token}`,
    semanticGroupId: `semantic-${token}`,
    templateGroupId: `template-${token}`,
    recipeFamilyId: `recipe-${token}`,
    waveSha256: hash((index + 1).toString(16)),
    pcmSha256: hash((index + 7).toString(16)),
    secondaryLineageRootIds: [],
    label,
    fitEligibility: "fit-eligible"
  };
}

function manifestFixture() {
  return finalizeExp0017Manifest({
    schemaVersion: EXP0017_MANIFEST_SCHEMA,
    experimentId: "exp-0017-contract-test",
    locale: "pt-BR",
    sources: [{
      sourceId: "fixture-open-source",
      revision: "fixture-r1",
      license: "OpenRAIL-M"
    }],
    retention: { rawAudioInGit: false },
    items: [
      manifestItem(0, "train", BACKGROUND),
      manifestItem(1, "train", DIRECTED),
      manifestItem(2, "development", BACKGROUND),
      manifestItem(3, "development", DIRECTED)
    ]
  });
}

function featureExample(item) {
  return {
    exampleId: `example-${item.artifactId}`,
    artifactId: item.artifactId,
    split: item.partition,
    lineageRootId: item.lineageRootId,
    speakerGroupId: item.speakerGroupId,
    semanticGroupId: item.semanticGroupId,
    templateGroupId: item.templateGroupId,
    recipeFamilyId: item.recipeFamilyId,
    secondaryLineageRootIds: [...item.secondaryLineageRootIds],
    label: item.label,
    labelSource: { kind: "procedural-proxy", ref: "fixture-r1" },
    fitEligibility: "fit-eligible",
    features: SPEAKER_RELEVANCE_FEATURES.map((_, index) =>
      index === 0 ? 1 : (index + item.artifactId.length) / 100
    ),
    causalWindow: {
      onsetSample: 0,
      decisionSample: 8_960,
      sampleRate: 16_000,
      futureSamplesUsed: 0
    }
  };
}

function splitSummary(examples) {
  return {
    examples: examples.length,
    labels: Object.fromEntries(EXP0017_CLASSES.map((label) => [
      label,
      examples.filter((example) => example.label === label).length
    ]))
  };
}

function evidenceFixture() {
  const manifest = manifestFixture();
  const examples = manifest.items.map(featureExample);
  const dataset = finalizeExp0017DevelopmentDataset({
    schemaVersion: EXP0017_DEVELOPMENT_DATASET_SCHEMA,
    experimentId: manifest.experimentId,
    locale: "pt-BR",
    manifestSha256: manifest.manifestSha256,
    featureVersion: SPEAKER_RELEVANCE_FEATURE_VERSION,
    featureNames: [...SPEAKER_RELEVANCE_FEATURES],
    classes: [...EXP0017_CLASSES],
    decisionSamples: 8_960,
    fitBoundary: {
      selectedSplit: "train",
      calibrationSplit: "development",
      excluded: [],
      holdoutRead: false
    },
    splits: Object.fromEntries(["train", "development"].map((split) => [
      split,
      splitSummary(examples.filter((example) => example.split === split))
    ])),
    examples
  });
  return { dataset, manifest };
}

test("manifest e dataset development-only preservam bindings e splits", () => {
  const evidence = evidenceFixture();
  assert.equal(validateExp0017Manifest(evidence.manifest).valid, true);
  assert.equal(validateExp0017DevelopmentDataset(evidence.dataset, {
    manifest: evidence.manifest
  }).valid, true);
});

test("manifest rejeita vazamento de grupo entre treino e desenvolvimento", () => {
  for (const field of [
    "lineageRootId",
    "speakerGroupId",
    "semanticGroupId",
    "templateGroupId",
    "recipeFamilyId"
  ]) {
    const manifest = structuredClone(manifestFixture());
    const train = manifest.items.find((item) => item.partition === "train");
    const development = manifest.items.find(
      (item) => item.partition === "development"
    );
    development[field] = train[field];
    const result = validateExp0017Manifest(
      finalizeExp0017Manifest(manifest)
    );
    assert.equal(result.valid, false, field);
    assert.match(result.errors.join("; "), new RegExp(field, "iu"));
  }
});

test("manifest rejeita ancestral secundário cruzado e hashes falsos", () => {
  const secondary = structuredClone(manifestFixture());
  const train = secondary.items.find((item) => item.partition === "train");
  secondary.items.find(
    (item) => item.partition === "development"
  ).secondaryLineageRootIds.push(train.lineageRootId);
  assert.match(
    validateExp0017Manifest(
      finalizeExp0017Manifest(secondary)
    ).errors.join("; "),
    /secondaryLineageRootIds|linhagem/iu
  );

  const invalid = structuredClone(manifestFixture());
  invalid.items[0].waveSha256 = "sha256:invalido";
  assert.equal(validateExp0017Manifest(
    finalizeExp0017Manifest(invalid)
  ).valid, false);
});

test("dataset rejeita holdout, futuro e linhagem divergente", () => {
  const evidence = evidenceFixture();
  for (const mutate of [
    (dataset) => { dataset.examples[0].split = "holdout-core"; },
    (dataset) => { dataset.examples[0].causalWindow.futureSamplesUsed = 1; },
    (dataset) => { dataset.examples[0].lineageRootId = "adulterada"; }
  ]) {
    const dataset = structuredClone(evidence.dataset);
    mutate(dataset);
    const result = validateExp0017DevelopmentDataset(
      finalizeExp0017DevelopmentDataset(dataset),
      { manifest: evidence.manifest }
    );
    assert.equal(result.valid, false);
  }
});

function developmentReportFixture(evidence) {
  return finalizeExp0017DevelopmentReport({
    schemaVersion: EXP0017_DEVELOPMENT_REPORT_SCHEMA,
    experimentId: evidence.manifest.experimentId,
    evidenceLevel: "development-screen",
    confirmatory: false,
    holdoutRead: false,
    authorityEligible: false,
    authority: { mode: "shadow", canProduceEffects: false },
    evidence: {
      manifestSha256: evidence.manifest.manifestSha256,
      developmentDatasetSha256: evidence.dataset.datasetSha256,
      a0ModelSha256: hash("a"),
      aModelSha256: hash("b")
    },
    fitBoundary: {
      selectedSplit: "train",
      calibrationSplit: "development",
      holdoutConstructed: false,
      holdoutPayloadPathRead: false,
      inputReadAllowlist: [
        "config.json",
        "manifest-development.json",
        "dataset-development.json",
        "a0.json"
      ],
      futureSamplesUsed: 0
    },
    core: {
      stage: "development",
      aQualified: false,
      aRef: "A0",
      decision: "retain-a0-and-cut-acoustic-core",
      calibrationSafeSolution: true
    },
    calibration: {
      split: "development",
      selected: { threshold: 0.9 }
    },
    gateCriteria: {
      pairedDecisionUnit: "lineage-root-all-descendants-correct",
      minimumDirectedRecall: 1,
      minimumAccuracy: 0.75,
      minimumClassRecall: 0.75,
      minimumGainOverAllDirected: 0.2,
      minimumPairedNetGainAgainstA0: 1,
      futureSamplesUsed: 0,
      canProduceEffects: false
    },
    metrics: {
      development: {
        A: {
          accuracy: 0.5,
          classRecall: {
            [BACKGROUND]: 0,
            [DIRECTED]: 1
          }
        },
        pairedAAgainstA0ByLineage: {
          unit: "lineage-root-all-descendants-correct",
          netGain: 0
        },
        gainOverAllDirected: 0
      }
    },
    gates: {
      manifestValid: true,
      matrixValid: true,
      developmentDatasetValid: true,
      noHoldoutConstructedOrRead: true,
      fitAndCalibrationSplitsFrozen: true,
      repeatedTrainingEqual: true,
      checkpointValid: true,
      modelHashBound: true,
      thresholdSelectedOnDevelopment: true,
      directedRecallIsPerfect: true,
      minimumAccuracy: false,
      minimumClassRecall: false,
      minimumGainOverAllDirected: false,
      minimumPairedNetGainAgainstA0: false,
      causalWindow: true,
      shadowOnly: true,
      allPassed: false
    },
    r: {
      evaluationRole: "development-screen-only",
      confirmatory: false,
      holdoutCoreConsumed: false,
      promoted: false
    },
    claims: {
      coreConfirmatoryEvidence: false,
      rConfirmatoryEvidence: false,
      authorityGranted: false,
      rPromoted: false
    }
  });
}

test("relatório dev permanece exploratório, em shadow e sem holdout", () => {
  const evidence = evidenceFixture();
  const report = developmentReportFixture(evidence);
  assert.equal(validateExp0017DevelopmentReport(report, {
    manifestSha256: evidence.manifest.manifestSha256,
    developmentDatasetSha256: evidence.dataset.datasetSha256
  }).valid, true);

  for (const mutate of [
    (value) => { value.confirmatory = true; },
    (value) => { value.authorityEligible = true; },
    (value) => { value.authority.canProduceEffects = true; },
    (value) => { value.r.confirmatory = true; },
    (value) => { value.r.holdoutCoreConsumed = true; },
    (value) => { value.claims.rPromoted = true; },
    (value) => { value.core.aRef = "A"; },
    (value) => { value.gates.minimumAccuracy = true; }
  ]) {
    const invalid = structuredClone(report);
    mutate(invalid);
    assert.equal(validateExp0017DevelopmentReport(
      finalizeExp0017DevelopmentReport(invalid)
    ).valid, false);
  }
});
