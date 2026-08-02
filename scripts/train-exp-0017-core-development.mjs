import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  compareExp0017Paired,
  selectExp0017SafeVetoThreshold,
  summarizeExp0017Observations
} from "../src/eval/exp-0017-calibration.mjs";
import {
  EXP0017_DEVELOPMENT_REPORT_SCHEMA,
  finalizeExp0017DevelopmentReport,
  validateExp0017DevelopmentDataset,
  validateExp0017DevelopmentReport,
  validateExp0017Manifest
} from "../src/eval/exp-0017-contract.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";
import { validateExp0017Matrix } from "../src/eval/exp-0017-matrix.mjs";
import {
  SPEAKER_RELEVANCE_CLASSES,
  SPEAKER_RELEVANCE_FEATURES
} from "../src/eval/speaker-relevance-features.mjs";
import {
  predictSoftmaxClassifier,
  trainSoftmaxClassifier
} from "../src/learning/softmax-classifier.mjs";
import {
  SPEAKER_RELEVANCE_SHADOW_VERSION,
  predictSpeakerRelevance,
  validateSpeakerRelevanceCheckpoint
} from "../web/speaker-relevance-shadow.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  config: "eval/experiments/exp-0017-safe-veto-core-v0.1.json"
});
const BACKGROUND = "BACKGROUND_OR_NOT_DIRECTED";
const DIRECTED = "DIRECTED_TO_ASSISTANT";

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument !== "--config") {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    options.config = args[++index];
  }
  return options;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(relativePath, observedReads = null) {
  observedReads?.push(relativePath);
  const path = resolve(PROJECT_ROOT, relativePath);
  const bytes = await readFile(path);
  return { path, bytes, value: JSON.parse(bytes.toString("utf8")) };
}

export function exp0017DevelopmentInputPaths(configRelative, config) {
  const paths = [
    configRelative,
    config?.outputs?.manifest,
    config?.outputs?.developmentDataset,
    config?.referenceA0?.checkpoint
  ];
  if (
    paths.some((path) => typeof path !== "string" || path.length === 0) ||
    paths.some((path) => /holdout|commitment|mswc/iu.test(path)) ||
    new Set(paths).size !== paths.length
  ) {
    throw new TypeError("allowlist de inputs de desenvolvimento inválida");
  }
  return Object.freeze(paths);
}

async function writeOrCheck(relativePath, value, check) {
  const path = resolve(PROJECT_ROOT, relativePath);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== content) {
      throw new Error(`artefato ausente ou divergente: ${relativePath}`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function featureSet(dataset, example) {
  return {
    featureVersion: dataset.featureVersion,
    names: dataset.featureNames,
    values: example.features,
    window: example.causalWindow
  };
}

function checkpointObservations(checkpoint, dataset, examples) {
  return examples.map((example) => {
    const prediction = predictSpeakerRelevance(
      checkpoint,
      featureSet(dataset, example)
    );
    return {
      exampleId: example.exampleId,
      expected: example.label,
      predicted: prediction.operationalLabel,
      rawPredicted: prediction.rawLabel,
      backgroundProbability:
        prediction.probabilities.BACKGROUND_OR_NOT_DIRECTED
    };
  });
}

function allDirectedObservations(examples) {
  return examples.map((example) => ({
    exampleId: example.exampleId,
    expected: example.label,
    predicted: DIRECTED
  }));
}

function lineageObservations(observations, examples) {
  const observationById = new Map(observations.map((item) => [
    item.exampleId,
    item
  ]));
  const groups = new Map();
  for (const example of examples) {
    const selected = groups.get(example.lineageRootId) ?? [];
    selected.push(observationById.get(example.exampleId));
    groups.set(example.lineageRootId, selected);
  }
  return [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  ).map(([lineageRootId, selected]) => {
    const expected = selected[0].expected;
    assert(
      selected.length > 0 &&
        selected.every((item) => item.expected === expected),
      `linhagem inválida: ${lineageRootId}`
    );
    const allDescendantsCorrect = selected.every(
      (item) => item.predicted === expected
    );
    return {
      exampleId: lineageRootId,
      expected,
      predicted: allDescendantsCorrect
        ? expected
        : expected === DIRECTED ? BACKGROUND : DIRECTED
    };
  });
}

function summarizeSlices(observations, examples) {
  const byId = new Map(observations.map((item) => [item.exampleId, item]));
  const summarizeSelected = (selected) => summarizeExp0017Observations(
    selected.map((example) => byId.get(example.exampleId))
  );
  const conditions = [...new Set(examples.map(
    (example) => example.strata.acousticConditionId
  ))].sort();
  const hardStrata = [...new Set(examples.flatMap(
    (example) => example.strata.hardDirected
  ))].sort();
  return {
    acousticCondition: Object.fromEntries(conditions.map((condition) => [
      condition,
      summarizeSelected(examples.filter(
        (example) => example.strata.acousticConditionId === condition
      ))
    ])),
    hardDirected: Object.fromEntries(hardStrata.map((stratum) => [
      stratum,
      summarizeSelected(examples.filter(
        (example) => example.strata.hardDirected.includes(stratum)
      ))
    ]))
  };
}

function compactSummary(summary) {
  return {
    observations: summary.observations,
    correct: summary.correct,
    accuracy: summary.accuracy,
    classRecall: summary.classRecall,
    confusion: summary.confusion,
    errorExampleIds: summary.errors.map((item) => item.exampleId)
  };
}

function compactSlices(slices) {
  return Object.fromEntries(Object.entries(slices).map(([group, values]) => [
    group,
    Object.fromEntries(Object.entries(values).map(([name, summary]) => [
      name,
      compactSummary(summary)
    ]))
  ]));
}

export function evaluateExp0017DevelopmentGates(input) {
  const { candidate, pairedAgainstA0, gainOverAllDirected, config } = input;
  const classRecalls = Object.values(candidate.classRecall);
  const gates = {
    manifestValid: input.manifestValid === true,
    matrixValid: input.matrixValid === true,
    developmentDatasetValid: input.developmentDatasetValid === true,
    noHoldoutConstructedOrRead:
      input.holdoutConstructed === false && input.holdoutRead === false,
    fitAndCalibrationSplitsFrozen:
      input.selectedFitSplit === "train" &&
      input.selectedCalibrationSplit === "development",
    repeatedTrainingEqual: input.repeatedTrainingEqual === true,
    checkpointValid: input.checkpointValid === true,
    modelHashBound: input.modelHashBound === true,
    thresholdSelectedOnDevelopment: input.thresholdSelected === true,
    directedRecallIsPerfect:
      candidate.classRecall[DIRECTED] >=
        config.gates.minimumDirectedRecall,
    minimumAccuracy: candidate.accuracy >= config.gates.minimumAccuracy,
    minimumClassRecall: classRecalls.every(
      (recall) => recall !== null &&
        recall >= config.gates.minimumClassRecall
    ),
    minimumGainOverAllDirected:
      gainOverAllDirected >= config.gates.minimumGainOverAllDirected,
    minimumPairedNetGainAgainstA0:
      pairedAgainstA0.netGain >=
        config.gates.minimumPairedNetGainAgainstA0,
    causalWindow: input.futureSamplesUsed === 0,
    shadowOnly: input.canProduceEffects === false
  };
  return Object.freeze({
    ...gates,
    allPassed: Object.values(gates).every(Boolean)
  });
}

function createCheckpoint(input) {
  const {
    classifier,
    config,
    configRelative,
    dataset,
    configFileSha256,
    threshold
  } = input;
  const model = {
    algorithm: classifier.algorithm,
    weights: classifier.weights
  };
  const modelSha256 = `sha256:${canonicalSha256(model)}`;
  return {
    schemaVersion: "speaker-relevance-checkpoint-v1",
    checkpointId: `speaker-relevance-exp0017-a-${modelSha256.slice(7, 23)}`,
    featureVersion: SPEAKER_RELEVANCE_SHADOW_VERSION,
    featureNames: [...SPEAKER_RELEVANCE_FEATURES],
    classes: [...SPEAKER_RELEVANCE_CLASSES],
    modelSha256,
    model,
    decision: {
      backgroundVetoConfidence: threshold,
      backgroundAction: config.task.backgroundAction,
      directedAction: config.task.directedAction,
      lowConfidenceAction: config.task.lowConfidenceAction
    },
    runtime: {
      sampleRate: config.audio.sampleRate,
      decisionMs: config.audio.decisionMs,
      decisionSamples: config.audio.decisionSamples,
      bufferSamples: config.audio.sampleRate * 3,
      futureSamplesAllowed: 0
    },
    training: {
      algorithm: classifier.algorithm,
      datasetPath: config.outputs.developmentDataset,
      datasetSha256: dataset.datasetSha256,
      manifestSha256: dataset.manifestSha256,
      experimentConfigPath: configRelative,
      experimentConfigSha256: configFileSha256,
      selectedSplit: "train",
      calibrationSplit: "development",
      excludedFromFit: ["development"],
      excludedFromCalibration: ["train"],
      holdoutRead: false,
      examples: input.trainingExamples,
      calibrationExamples: input.calibrationExamples,
      hyperparameters: {
        epochs: config.trainer.epochs,
        learningRate: config.trainer.learningRate,
        l2: config.trainer.l2,
        initialization: config.trainer.initialization,
        ordering: config.trainer.ordering,
        repetitions: config.trainer.repetitions
      },
      finalLoss: classifier.training.finalLoss,
      classCounts: classifier.training.classCounts,
      classWeights: classifier.training.classWeights
    },
    authority: {
      mode: "shadow",
      canProduceEffects: false
    },
    claims: {
      scope: config.claims.maximumIfCorePasses,
      excluded: config.claims.excluded
    }
  };
}

function validateReferenceA0(config, bytes, checkpoint) {
  const errors = [];
  const checkpointValidation = validateSpeakerRelevanceCheckpoint(checkpoint);
  if (!checkpointValidation.valid) {
    errors.push(...checkpointValidation.errors);
  }
  if (sha256(bytes) !== config.referenceA0.fileSha256) {
    errors.push("fileSha256 de A0 divergente");
  }
  if (
    checkpoint.modelSha256 !== config.referenceA0.modelSha256 ||
    checkpoint.checkpointId !== config.referenceA0.checkpointId ||
    checkpoint.decision.backgroundVetoConfidence !==
      config.referenceA0.backgroundVetoConfidence ||
    `sha256:${canonicalSha256(checkpoint.model)}` !== checkpoint.modelSha256
  ) {
    errors.push("identidade, limiar ou modelSha256 de A0 divergente");
  }
  return { valid: errors.length === 0, errors };
}

export async function trainExp0017CoreDevelopment(options = {}) {
  const configRelative = options.config ?? DEFAULTS.config;
  const observedInputReads = [];
  const configBundle = await readJson(configRelative, observedInputReads);
  const config = configBundle.value;
  assert(config.status === "frozen-before-fit", "configuração não congelada");
  assert(
    config.outputs.holdoutPayload === undefined &&
      config.outputs.holdoutCommitment === undefined &&
      config.budget.holdoutOpenings === 0,
    "execução de desenvolvimento não pode declarar holdout"
  );
  const inputReadAllowlist = exp0017DevelopmentInputPaths(
    configRelative,
    config
  );

  // Allowlist deliberada: config, manifest dev, dataset dev e A0.
  const [manifestBundle, datasetBundle, a0Bundle] =
    await Promise.all([
      readJson(config.outputs.manifest, observedInputReads),
      readJson(config.outputs.developmentDataset, observedInputReads),
      readJson(config.referenceA0.checkpoint, observedInputReads)
    ]);
  assert(
    JSON.stringify(observedInputReads) === JSON.stringify(inputReadAllowlist),
    "leituras de input divergiram da allowlist de desenvolvimento"
  );
  const manifest = manifestBundle.value;
  const dataset = datasetBundle.value;
  const a0 = a0Bundle.value;

  const manifestValidation = validateExp0017Manifest(manifest);
  const matrixValidation = validateExp0017Matrix(manifest);
  const datasetValidation = validateExp0017DevelopmentDataset(dataset, {
    manifest
  });
  const a0Validation = validateReferenceA0(config, a0Bundle.bytes, a0);
  for (const [name, validation] of [
    ["manifest", manifestValidation],
    ["matriz", matrixValidation],
    ["dataset", datasetValidation],
    ["A0", a0Validation]
  ]) {
    assert(validation.valid, `${name} inválido: ${validation.errors.join("; ")}`);
  }
  assert(manifest.experimentId === config.id, "manifest/config divergentes");
  assert(
    manifest.experimentConfig.fileSha256 === sha256(configBundle.bytes) &&
      manifest.experimentConfig.canonicalSha256 ===
        `sha256:${canonicalSha256(config)}`,
    "manifest não está ligado à configuração vigente"
  );
  assert(
    dataset.fitBoundary.selectedSplit === "train" &&
      dataset.fitBoundary.calibrationSplit === "development" &&
      dataset.fitBoundary.holdoutRead === false &&
      dataset.fitBoundary.excluded.length === 0 &&
      dataset.examples.every((example) =>
        ["train", "development"].includes(example.split)
      ),
    "fronteira física de treino/desenvolvimento inválida"
  );

  const trainingExamples = dataset.examples.filter(
    (example) => example.split === "train"
  );
  const developmentExamples = dataset.examples.filter(
    (example) => example.split === "development"
  );
  const trainingInput = {
    examples: trainingExamples.map((example) => ({
      label: example.label,
      features: example.features
    })),
    classNames: SPEAKER_RELEVANCE_CLASSES,
    featureCount: SPEAKER_RELEVANCE_FEATURES.length,
    epochs: config.trainer.epochs,
    learningRate: config.trainer.learningRate,
    l2: config.trainer.l2
  };
  const first = trainSoftmaxClassifier(trainingInput);
  const second = trainSoftmaxClassifier(trainingInput);
  const repeatedTrainingEqual = isDeepStrictEqual(first, second);
  assert(repeatedTrainingEqual, "treino repetido produziu pesos divergentes");

  const calibrationObservations = developmentExamples.map((example) => {
    const prediction = predictSoftmaxClassifier(first, example.features);
    return {
      exampleId: example.exampleId,
      expected: example.label,
      backgroundProbability: prediction.probabilities[BACKGROUND]
    };
  });
  const thresholdSelection = selectExp0017SafeVetoThreshold(
    calibrationObservations,
    { minimumThreshold: config.calibration.minimumThreshold }
  );
  const threshold = thresholdSelection.selected?.threshold ?? 1;
  const checkpoint = createCheckpoint({
    classifier: first,
    config,
    configRelative,
    dataset,
    configFileSha256: sha256(configBundle.bytes),
    threshold,
    trainingExamples: trainingExamples.length,
    calibrationExamples: developmentExamples.length
  });
  const checkpointValidation = validateSpeakerRelevanceCheckpoint(checkpoint);
  const modelHashBound =
    `sha256:${canonicalSha256(checkpoint.model)}` === checkpoint.modelSha256;

  const allDirected = allDirectedObservations(developmentExamples);
  const a0Observations = checkpointObservations(
    a0,
    dataset,
    developmentExamples
  );
  const aObservations = checkpointObservations(
    checkpoint,
    dataset,
    developmentExamples
  );
  const summaries = {
    allDirected: summarizeExp0017Observations(allDirected),
    A0: summarizeExp0017Observations(a0Observations),
    A: summarizeExp0017Observations(aObservations)
  };
  const pairedExamplesAgainstA0 = compareExp0017Paired(
    a0Observations,
    aObservations
  );
  const pairedLineagesAgainstA0 = compareExp0017Paired(
    lineageObservations(a0Observations, developmentExamples),
    lineageObservations(aObservations, developmentExamples)
  );
  const gainOverAllDirected =
    summaries.A.accuracy - summaries.allDirected.accuracy;
  const futureSamplesUsed = Math.max(
    ...developmentExamples.map(
      (example) => example.causalWindow.futureSamplesUsed
    )
  );
  const gates = evaluateExp0017DevelopmentGates({
    candidate: summaries.A,
    pairedAgainstA0: pairedLineagesAgainstA0,
    gainOverAllDirected,
    config,
    manifestValid: manifestValidation.valid,
    matrixValid: matrixValidation.valid,
    developmentDatasetValid: datasetValidation.valid,
    holdoutConstructed: false,
    holdoutRead: false,
    selectedFitSplit: dataset.fitBoundary.selectedSplit,
    selectedCalibrationSplit: dataset.fitBoundary.calibrationSplit,
    repeatedTrainingEqual,
    checkpointValid: checkpointValidation.valid,
    modelHashBound,
    thresholdSelected: thresholdSelection.safeSolution,
    futureSamplesUsed,
    canProduceEffects: checkpoint.authority.canProduceEffects
  });
  const aRef = gates.allPassed ? "A" : "A0";

  const report = finalizeExp0017DevelopmentReport({
    schemaVersion: EXP0017_DEVELOPMENT_REPORT_SCHEMA,
    experimentId: config.id,
    evidenceLevel: "development-screen",
    confirmatory: false,
    holdoutRead: false,
    authorityEligible: false,
    authority: {
      mode: "shadow",
      canProduceEffects: false
    },
    evidence: {
      experimentConfigFileSha256: sha256(configBundle.bytes),
      manifestSha256: manifest.manifestSha256,
      developmentDatasetSha256: dataset.datasetSha256,
      a0FileSha256: sha256(a0Bundle.bytes),
      a0ModelSha256: a0.modelSha256,
      aModelSha256: checkpoint.modelSha256
    },
    fitBoundary: {
      selectedSplit: "train",
      calibrationSplit: "development",
      excludedFromFit: ["development"],
      excludedFromCalibration: ["train"],
      holdoutConstructed: false,
      holdoutPayloadPathRead: false,
      inputReadAllowlist,
      trainingExamples: trainingExamples.length,
      developmentExamples: developmentExamples.length,
      futureSamplesUsed
    },
    core: {
      stage: "development",
      aQualified: gates.allPassed,
      aRef,
      decision: gates.allPassed
        ? "qualify-a-for-new-opaque-holdout-preregistration"
        : "retain-a0-and-cut-acoustic-core",
      calibratedThreshold: checkpoint.decision.backgroundVetoConfidence,
      calibrationSafeSolution: thresholdSelection.safeSolution
    },
    calibration: {
      split: "development",
      objective: thresholdSelection.objective,
      minimumThreshold: thresholdSelection.minimumThreshold,
      candidateThresholds: thresholdSelection.candidateThresholds.length,
      safeCandidates: thresholdSelection.safeCandidates,
      selected: thresholdSelection.selected === null ? null : {
        threshold: thresholdSelection.selected.threshold,
        directedRecall: thresholdSelection.selected.directedRecall,
        backgroundCoverage: thresholdSelection.selected.backgroundCoverage,
        accuracy: thresholdSelection.selected.accuracy,
        falseDirectedVetoes:
          thresholdSelection.selected.falseDirectedVetoes,
        backgroundVetoes: thresholdSelection.selected.backgroundVetoes
      }
    },
    gateCriteria: config.gates,
    metrics: {
      development: {
        allDirected: compactSummary(summaries.allDirected),
        A0: compactSummary(summaries.A0),
        A: compactSummary(summaries.A),
        pairedAAgainstA0ByExample: {
          observations: pairedExamplesAgainstA0.observations,
          wins: pairedExamplesAgainstA0.wins,
          losses: pairedExamplesAgainstA0.losses,
          ties: pairedExamplesAgainstA0.ties,
          netGain: pairedExamplesAgainstA0.netGain,
          accuracyGain: pairedExamplesAgainstA0.accuracyGain,
          winExampleIds: pairedExamplesAgainstA0.winExampleIds,
          lossExampleIds: pairedExamplesAgainstA0.lossExampleIds
        },
        pairedAAgainstA0ByLineage: {
          unit: config.gates.pairedDecisionUnit,
          observations: pairedLineagesAgainstA0.observations,
          wins: pairedLineagesAgainstA0.wins,
          losses: pairedLineagesAgainstA0.losses,
          ties: pairedLineagesAgainstA0.ties,
          netGain: pairedLineagesAgainstA0.netGain,
          accuracyGain: pairedLineagesAgainstA0.accuracyGain,
          winLineageRootIds: pairedLineagesAgainstA0.winExampleIds,
          lossLineageRootIds: pairedLineagesAgainstA0.lossExampleIds
        },
        gainOverAllDirected,
        slicesA: compactSlices(summarizeSlices(
          aObservations,
          developmentExamples
        ))
      }
    },
    gates,
    r: {
      status: "not-run",
      evaluationRole: "development-screen-only",
      confirmatory: false,
      holdoutCoreConsumed: false,
      promoted: false
    },
    claims: {
      authorityGranted: false,
      coreConfirmatoryEvidence: false,
      rConfirmatoryEvidence: false,
      rPromoted: false,
      maximumIfDevelopmentPasses:
        "A pode justificar novo pré-registro com holdout opaco e válido; " +
        "não há confirmação nem autoridade de runtime",
      excluded: config.claims.excluded
    }
  });
  const reportValidation = validateExp0017DevelopmentReport(report, {
    manifestSha256: manifest.manifestSha256,
    developmentDatasetSha256: dataset.datasetSha256,
    a0ModelSha256: a0.modelSha256,
    aModelSha256: checkpoint.modelSha256
  });
  assert(checkpointValidation.valid,
    `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`);
  assert(modelHashBound, "modelSha256 do checkpoint A divergente");
  assert(reportValidation.valid,
    `relatório inválido: ${reportValidation.errors.join("; ")}`);

  if (options.write !== false) {
    await writeOrCheck(
      config.outputs.developmentCheckpoint,
      checkpoint,
      options.check ?? false
    );
    await writeOrCheck(
      config.outputs.developmentReport,
      report,
      options.check ?? false
    );
  }
  return {
    checkpoint,
    report,
    gates,
    reportValidation,
    checkpointValidation
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await trainExp0017CoreDevelopment(options);
  const metrics = result.report.metrics.development;
  console.log(
    `EXP-0017 Core DEV ${options.check ? "CHECK" : "FIT"}: ` +
      `A=${metrics.A.accuracy.toFixed(3)}; ` +
      `A0=${metrics.A0.accuracy.toFixed(3)}; ` +
      `directed-recall=${metrics.A.classRecall[DIRECTED].toFixed(3)}; ` +
      `net-lineage=${metrics.pairedAAgainstA0ByLineage.netGain}; ` +
      `qualified=${result.gates.allPassed}`
  );
  console.log(
    "holdout: NÃO CONSTRUÍDO; métricas confirmatórias: zero; " +
      `A-ref=${result.report.core.aRef}`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
