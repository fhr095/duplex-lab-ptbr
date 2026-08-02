import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  validateSpeakerRelevanceDataset
} from "../src/eval/speaker-relevance-dataset.mjs";
import {
  predictSoftmaxClassifier,
  trainSoftmaxClassifier
} from "../src/learning/softmax-classifier.mjs";
import {
  canonicalSha256
} from "../src/eval/factory/canonical-hash.mjs";
import {
  SPEAKER_RELEVANCE_CLASSES,
  SPEAKER_RELEVANCE_FEATURES,
  SPEAKER_RELEVANCE_SHADOW_VERSION,
  predictSpeakerRelevance,
  validateSpeakerRelevanceCheckpoint
} from "../web/speaker-relevance-shadow.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  config: "eval/experiments/exp-0016-speaker-relevance-m4b.pt-BR.json",
  dataset: "eval/datasets/exp-0016-speaker-relevance-v0.1.json",
  out: "web/speaker-relevance-checkpoint.json",
  report: "eval/generated/exp-0016/offline-training-report.json"
});

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (!["--config", "--dataset", "--out", "--report"].includes(
      argument
    )) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    options[argument.slice(2)] = args[++index];
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function predictionFeatureSet(dataset, example) {
  return {
    featureVersion: dataset.featureVersion,
    names: dataset.featureNames,
    values: example.features,
    window: example.causalWindow
  };
}

function emptyConfusion() {
  return Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map((expected) => [
    expected,
    Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map(
      (predicted) => [predicted, 0]
    ))
  ]));
}

function summarizeObservations(observations) {
  const confusion = emptyConfusion();
  for (const observation of observations) {
    confusion[observation.expected][observation.predicted] += 1;
  }
  const correct = observations.filter((item) => item.correct).length;
  return {
    observations: observations.length,
    correct,
    accuracy: observations.length === 0
      ? null
      : correct / observations.length,
    classRecall: Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map(
      (label) => {
        const total = Object.values(confusion[label]).reduce(
          (sum, count) => sum + count,
          0
        );
        return [label, total === 0 ? null : confusion[label][label] / total];
      }
    )),
    confusion,
    errors: observations.filter((item) => !item.correct)
  };
}

function evaluateSplit(checkpoint, dataset, examples) {
  const candidate = examples.map((example) => {
    const prediction = predictSpeakerRelevance(
      checkpoint,
      predictionFeatureSet(dataset, example)
    );
    return {
      exampleId: example.exampleId,
      expected: example.label,
      raw: prediction.rawLabel,
      operational: prediction.operationalLabel,
      backgroundProbability:
        prediction.probabilities.BACKGROUND_OR_NOT_DIRECTED
    };
  });
  const baseline = summarizeObservations(candidate.map((item) => ({
    exampleId: item.exampleId,
    expected: item.expected,
    predicted: "DIRECTED_TO_ASSISTANT",
    correct: item.expected === "DIRECTED_TO_ASSISTANT"
  })));
  const raw = summarizeObservations(candidate.map((item) => ({
    exampleId: item.exampleId,
    expected: item.expected,
    predicted: item.raw,
    correct: item.raw === item.expected,
    backgroundProbability: item.backgroundProbability
  })));
  const safeVeto = summarizeObservations(candidate.map((item) => ({
    exampleId: item.exampleId,
    expected: item.expected,
    predicted: item.operational,
    correct: item.operational === item.expected,
    backgroundProbability: item.backgroundProbability
  })));
  return {
    baseline,
    candidate: { raw, safeVeto },
    gainOverBaseline: {
      rawAccuracy: raw.accuracy - baseline.accuracy,
      safeVetoAccuracy: safeVeto.accuracy - baseline.accuracy
    }
  };
}

async function writeOrCheck(path, value, check) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== content) {
      throw new Error(`artefato ausente ou divergente: ${path}`);
    }
    return;
  }
  await writeFile(path, content);
}

export async function trainExp0016(options = {}) {
  const configPath = resolve(PROJECT_ROOT, options.config ?? DEFAULTS.config);
  const datasetPath = resolve(
    PROJECT_ROOT,
    options.dataset ?? DEFAULTS.dataset
  );
  const [configBytes, datasetBytes] = await Promise.all([
    readFile(configPath),
    readFile(datasetPath)
  ]);
  const config = JSON.parse(configBytes.toString("utf8"));
  const dataset = JSON.parse(datasetBytes.toString("utf8"));
  const datasetValidation = validateSpeakerRelevanceDataset(dataset);
  if (!datasetValidation.valid) {
    throw new Error(
      `dataset inválido: ${datasetValidation.errors.join("; ")}`
    );
  }
  if (
    dataset.experimentConfig.sha256 !== `sha256:${sha256(configBytes)}` ||
    JSON.stringify(dataset.featureNames) !==
      JSON.stringify(SPEAKER_RELEVANCE_FEATURES) ||
    JSON.stringify(dataset.classes) !==
      JSON.stringify(SPEAKER_RELEVANCE_CLASSES)
  ) {
    throw new Error("dataset não está ligado à configuração vigente");
  }
  const trainingExamples = dataset.examples
    .filter((example) => example.split === "train")
    .map((example) => ({
      label: example.label,
      features: example.features
    }));
  const trainingOptions = {
    examples: trainingExamples,
    classNames: SPEAKER_RELEVANCE_CLASSES,
    featureCount: SPEAKER_RELEVANCE_FEATURES.length,
    epochs: config.trainer.epochs,
    learningRate: config.trainer.learningRate,
    l2: config.trainer.l2
  };
  const first = trainSoftmaxClassifier(trainingOptions);
  const second = trainSoftmaxClassifier(trainingOptions);
  const repeatedTrainingEqual = isDeepStrictEqual(first, second);
  if (!repeatedTrainingEqual) {
    throw new Error("treino repetido produziu pesos divergentes");
  }
  const model = {
    algorithm: first.algorithm,
    weights: first.weights
  };
  const modelSha256 = `sha256:${canonicalSha256(model)}`;
  const checkpoint = {
    schemaVersion: "speaker-relevance-checkpoint-v1",
    checkpointId: `speaker-relevance-m4b-${modelSha256.slice(7, 23)}`,
    featureVersion: SPEAKER_RELEVANCE_SHADOW_VERSION,
    featureNames: [...SPEAKER_RELEVANCE_FEATURES],
    classes: [...SPEAKER_RELEVANCE_CLASSES],
    modelSha256,
    model,
    decision: {
      backgroundVetoConfidence: config.task.backgroundVetoConfidence,
      backgroundAction: config.task.backgroundAction,
      directedAction: config.task.directedAction,
      lowConfidenceAction: config.task.lowConfidenceAction
    },
    runtime: {
      sampleRate: config.audio.sampleRate,
      decisionMs: config.task.shadowDecisionMs,
      decisionSamples: Math.round(
        config.audio.sampleRate * config.task.shadowDecisionMs / 1_000
      ),
      bufferSamples: config.audio.sampleRate * 3,
      futureSamplesAllowed: config.audio.futureSamplesAllowed
    },
    training: {
      algorithm: first.algorithm,
      datasetPath: options.dataset ?? DEFAULTS.dataset,
      datasetSha256: dataset.datasetSha256,
      experimentConfigPath: options.config ?? DEFAULTS.config,
      experimentConfigSha256: `sha256:${sha256(configBytes)}`,
      selectedSplit: "train",
      excludedFromFit: ["development", "holdout", config.calibration.packId],
      examples: trainingExamples.length,
      hyperparameters: {
        epochs: config.trainer.epochs,
        learningRate: config.trainer.learningRate,
        l2: config.trainer.l2,
        initialization: config.trainer.initialization,
        ordering: config.trainer.ordering
      },
      finalLoss: first.training.finalLoss,
      classCounts: first.training.classCounts,
      classWeights: first.training.classWeights
    },
    authority: {
      mode: "shadow",
      canProduceEffects: false
    },
    claims: {
      scope: config.claims.promotable,
      excluded: config.claims.excluded
    }
  };
  const checkpointValidation = validateSpeakerRelevanceCheckpoint(
    checkpoint
  );
  if (!checkpointValidation.valid) {
    throw new Error(
      `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`
    );
  }
  if (`sha256:${canonicalSha256(checkpoint.model)}` !== modelSha256) {
    throw new Error("modelSha256 não corresponde ao modelo");
  }
  const metrics = Object.fromEntries(
    ["train", "development", "holdout"].map((split) => [
      split,
      evaluateSplit(
        checkpoint,
        dataset,
        dataset.examples.filter((example) => example.split === split)
      )
    ])
  );
  const rawGates = {
    developmentAccuracy:
      metrics.development.candidate.raw.accuracy >=
        config.gates.minimumDevelopmentAccuracy,
    holdoutAccuracy:
      metrics.holdout.candidate.raw.accuracy >=
        config.gates.minimumHoldoutAccuracy,
    holdoutClassRecall: Object.values(
      metrics.holdout.candidate.raw.classRecall
    ).every((recall) => recall >= config.gates.minimumHoldoutClassRecall),
    holdoutGainOverBaseline:
      metrics.holdout.gainOverBaseline.rawAccuracy >=
        config.gates.minimumHoldoutGainOverBaseline
  };
  const safeVetoGates = {
    developmentAccuracy:
      metrics.development.candidate.safeVeto.accuracy >=
        config.gates.minimumDevelopmentAccuracy,
    holdoutAccuracy:
      metrics.holdout.candidate.safeVeto.accuracy >=
        config.gates.minimumHoldoutAccuracy,
    holdoutClassRecall: Object.values(
      metrics.holdout.candidate.safeVeto.classRecall
    ).every((recall) => recall >= config.gates.minimumHoldoutClassRecall),
    holdoutGainOverBaseline:
      metrics.holdout.gainOverBaseline.safeVetoAccuracy >=
        config.gates.minimumHoldoutGainOverBaseline,
    directedRecallIsPerfect:
      metrics.development.candidate.safeVeto.classRecall
        .DIRECTED_TO_ASSISTANT === 1 &&
      metrics.holdout.candidate.safeVeto.classRecall
        .DIRECTED_TO_ASSISTANT === 1
  };
  const gates = {
    datasetValid: datasetValidation.valid,
    sourceFitEligible:
      dataset.source.fitEligibility === "fit-eligible" &&
      dataset.source.license === "CC-BY-4.0",
    splitFamiliesDisjoint:
      new Set(Object.values(datasetValidation.familyOwners)).size === 3,
    sourceClipsDisjoint:
      new Set(Object.values(datasetValidation.clipOwners)).size === 3,
    humanCalibrationExcludedFromFit:
      dataset.calibration.usedForFit === false &&
      dataset.calibration.fitExamples === 0,
    repeatedTrainingEqual,
    checkpointValid: checkpointValidation.valid,
    modelHashBound:
      `sha256:${canonicalSha256(checkpoint.model)}` === modelSha256,
    holdoutExcludedFromFit:
      checkpoint.training.selectedSplit === "train" &&
      checkpoint.training.excludedFromFit.includes("holdout"),
    ...Object.fromEntries(Object.entries(rawGates).map(
      ([name, value]) => [`raw.${name}`, value]
    ))
  };
  const report = {
    schemaVersion: "exp-0016-offline-training-report-v1",
    experimentId: config.id,
    dataset: {
      path: options.dataset ?? DEFAULTS.dataset,
      sha256: dataset.datasetSha256,
      fileSha256: `sha256:${sha256(datasetBytes)}`,
      examples: dataset.examples.length,
      sourceClips: dataset.source.selectedClips,
      validation: datasetValidation
    },
    checkpoint: {
      path: options.out ?? DEFAULTS.out,
      id: checkpoint.checkpointId,
      modelSha256,
      validation: checkpointValidation
    },
    reproducibility: {
      repeatedTrainingEqual,
      initialization: first.training.initialization,
      ordering: first.training.ordering
    },
    metrics,
    gates,
    rawCapacityGates: rawGates,
    safeVetoGates,
    shadowCandidatePass: Object.values(gates).every(Boolean),
    safeVetoOfflineReady: Object.values(safeVetoGates).every(Boolean),
    authorityEligible: false,
    authorityBlockers: [
      "candidato ainda não percorreu inferência causal no navegador",
      ...(Object.values(safeVetoGates).every(Boolean)
        ? []
        : ["veto conservador ainda não passa os gates procedurais"])
    ],
    limitations: [
      "rótulos de treino são proxies procedurais, não intenção humana direta",
      "as 36 fontes selecionadas neste recorte do FLEURS são masculinas",
      "speakerId não está disponível; não há alegação ampla por falante",
      "EXP-0015 orienta política e avaliação, mas fornece zero exemplos de fit",
      "checkpoint permanece em shadow e não produz efeitos"
    ],
    paidApiCalls: 0
  };
  report.pass = report.shadowCandidatePass;
  return { checkpoint, report };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { checkpoint, report } = await trainExp0016(options);
  await Promise.all([
    writeOrCheck(resolve(PROJECT_ROOT, options.out), checkpoint, options.check),
    writeOrCheck(
      resolve(PROJECT_ROOT, options.report),
      report,
      options.check
    )
  ]);
  console.log(
    `EXP-0016 treino ${report.pass ? "SHADOW PASS" : "HOLD"}: ` +
      `dev=${report.metrics.development.candidate.raw.accuracy}, ` +
      `holdout=${report.metrics.holdout.candidate.raw.accuracy}, ` +
      `ganho=${report.metrics.holdout.gainOverBaseline.rawAccuracy}, ` +
      `vetoSeguro=${report.safeVetoOfflineReady ? "PASS" : "HOLD"}, ` +
      report.checkpoint.modelSha256
  );
  if (!report.pass) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
