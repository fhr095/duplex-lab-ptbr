import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  canonicalSha256
} from "../src/eval/factory/canonical-hash.mjs";
import {
  predictSoftmaxClassifier,
  trainSoftmaxClassifier
} from "../src/learning/softmax-classifier.mjs";
import {
  ACOUSTIC_REFLEX_CLASSES,
  ACOUSTIC_REFLEX_FEATURES,
  ACOUSTIC_REFLEX_SHADOW_VERSION,
  validateAcousticReflexCheckpoint
} from "../web/acoustic-reflex-shadow.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_CONFIG =
  "eval/experiments/exp-0014-acoustic-reflex.pt-BR.json";
const DEFAULT_DATASET =
  "eval/datasets/exp-0014-acoustic-reflex-v0.1.json";
const DEFAULT_CHECKPOINT = "web/acoustic-reflex-checkpoint.json";
const DEFAULT_REPORT =
  "eval/generated/exp-0014/offline-training-report.json";

function parseArgs(args) {
  const options = {
    config: DEFAULT_CONFIG,
    dataset: DEFAULT_DATASET,
    out: DEFAULT_CHECKPOINT,
    report: DEFAULT_REPORT,
    check: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
    } else if (
      ["--config", "--dataset", "--out", "--report"].includes(argument)
    ) {
      options[argument.slice(2)] = args[++index];
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function datasetCore(dataset) {
  const clone = structuredClone(dataset);
  delete clone.datasetSha256;
  return clone;
}

function validateDataset(dataset, config) {
  const errors = [];
  if (dataset?.schemaVersion !== "acoustic-reflex-dataset-v1") {
    errors.push("schemaVersion incompatível");
  }
  const observedHash = `sha256:${canonicalSha256(datasetCore(dataset))}`;
  if (dataset?.datasetSha256 !== observedHash) {
    errors.push("datasetSha256 divergente");
  }
  if (
    JSON.stringify(dataset?.featureNames) !==
      JSON.stringify(ACOUSTIC_REFLEX_FEATURES) ||
    JSON.stringify(dataset?.classes) !==
      JSON.stringify(ACOUSTIC_REFLEX_CLASSES)
  ) {
    errors.push("features ou classes incompatíveis");
  }
  const familyOwners = new Map();
  for (const [split, summary] of Object.entries(dataset?.splits ?? {})) {
    for (const family of summary.families ?? []) {
      if (familyOwners.has(family)) {
        errors.push(`família ${family} aparece em múltiplos splits`);
      }
      familyOwners.set(family, split);
    }
    for (const label of ACOUSTIC_REFLEX_CLASSES) {
      if (!(summary.labels?.[label] > 0)) {
        errors.push(`${split} não contém ${label}`);
      }
    }
  }
  for (const example of dataset?.examples ?? []) {
    if (familyOwners.get(example.family) !== example.split) {
      errors.push(`${example.exampleId} rompe o split por família`);
    }
    if (
      !ACOUSTIC_REFLEX_CLASSES.includes(example.label) ||
      !Array.isArray(example.features) ||
      example.features.length !== ACOUSTIC_REFLEX_FEATURES.length ||
      example.features.some((value) => !Number.isFinite(value))
    ) {
      errors.push(`${example.exampleId} é incompatível`);
    }
  }
  const byStream = Map.groupBy(
    dataset?.examples ?? [],
    (example) => example.streamId
  );
  for (const [streamId, examples] of byStream) {
    const monotonic = examples.every(
      (example, index) =>
        index === 0 ||
        example.sampleStart >= examples[index - 1].sampleStart
    );
    if (!monotonic) {
      errors.push(`${streamId} possui posições não monotônicas`);
    }
    const stream = dataset.streams.find(
      (candidate) => candidate.streamId === streamId
    );
    if (
      !stream ||
      examples.some(
        (example) =>
          example.sampleStart < 0 ||
          example.sampleEnd <= example.sampleStart ||
          example.sampleEnd > stream.sampleCount
      )
    ) {
      errors.push(`${streamId} possui posição fora da mídia`);
    }
  }
  if (dataset?.experimentConfig?.sha256 !==
    `sha256:${sha256(Buffer.from(JSON.stringify(config, null, 2) + "\n"))}`) {
    errors.push("configuração do dataset diverge do experimento");
  }
  return {
    valid: errors.length === 0,
    errors,
    observedHash,
    familyOwners: Object.fromEntries(familyOwners)
  };
}

function evaluateSplit(model, examples) {
  const confusion = Object.fromEntries(
    ACOUSTIC_REFLEX_CLASSES.map((expected) => [
      expected,
      Object.fromEntries(
        ACOUSTIC_REFLEX_CLASSES.map((predicted) => [predicted, 0])
      )
    ])
  );
  const observations = examples.map((example) => {
    const prediction = predictSoftmaxClassifier(model, example.features);
    confusion[example.label][prediction.label] += 1;
    return {
      exampleId: example.exampleId,
      expected: example.label,
      predicted: prediction.label,
      correct: prediction.label === example.label,
      confidence: prediction.probabilities[prediction.label]
    };
  });
  const classRecall = Object.fromEntries(
    ACOUSTIC_REFLEX_CLASSES.map((label) => {
      const total = Object.values(confusion[label]).reduce(
        (sum, count) => sum + count,
        0
      );
      return [label, total === 0 ? null : confusion[label][label] / total];
    })
  );
  const correct = observations.filter((item) => item.correct).length;
  return {
    observations: observations.length,
    correct,
    accuracy: observations.length === 0
      ? null
      : correct / observations.length,
    classRecall,
    confusion,
    errors: observations.filter((item) => !item.correct)
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

export async function trainExp0014(options = {}) {
  const configPath = resolve(PROJECT_ROOT, options.config ?? DEFAULT_CONFIG);
  const datasetPath = resolve(
    PROJECT_ROOT,
    options.dataset ?? DEFAULT_DATASET
  );
  const [configBytes, datasetBytes] = await Promise.all([
    readFile(configPath),
    readFile(datasetPath)
  ]);
  const config = JSON.parse(configBytes.toString("utf8"));
  const dataset = JSON.parse(datasetBytes.toString("utf8"));
  const datasetValidation = validateDataset(dataset, config);
  if (!datasetValidation.valid) {
    throw new Error(
      `dataset inválido: ${datasetValidation.errors.join("; ")}`
    );
  }
  const trainingExamples = dataset.examples
    .filter((example) => example.split === "train")
    .map((example) => ({
      label: example.label,
      features: example.features
    }));
  const trainingOptions = {
    examples: trainingExamples,
    classNames: ACOUSTIC_REFLEX_CLASSES,
    featureCount: ACOUSTIC_REFLEX_FEATURES.length,
    epochs: config.trainer.epochs,
    learningRate: config.trainer.learningRate,
    l2: config.trainer.l2
  };
  const first = trainSoftmaxClassifier(trainingOptions);
  const second = trainSoftmaxClassifier(trainingOptions);
  const reproducible = isDeepStrictEqual(first, second);
  if (!reproducible) {
    throw new Error("treino idêntico produziu pesos divergentes");
  }
  const model = {
    algorithm: first.algorithm,
    weights: first.weights
  };
  const modelSha256 = `sha256:${canonicalSha256(model)}`;
  const checkpoint = {
    schemaVersion: "acoustic-reflex-checkpoint-v1",
    checkpointId: `acoustic-reflex-m4a-${modelSha256.slice(7, 23)}`,
    featureVersion: ACOUSTIC_REFLEX_SHADOW_VERSION,
    featureNames: [...ACOUSTIC_REFLEX_FEATURES],
    classes: [...ACOUSTIC_REFLEX_CLASSES],
    modelSha256,
    model,
    training: {
      algorithm: first.algorithm,
      datasetPath: options.dataset ?? DEFAULT_DATASET,
      datasetSha256: dataset.datasetSha256,
      experimentConfigPath: options.config ?? DEFAULT_CONFIG,
      experimentConfigSha256: `sha256:${sha256(configBytes)}`,
      selectedSplit: "train",
      excludedFromFit: ["development", "holdout"],
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
  const checkpointValidation = validateAcousticReflexCheckpoint(checkpoint);
  if (!checkpointValidation.valid) {
    throw new Error(
      `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`
    );
  }
  const metrics = Object.fromEntries(
    Object.keys(config.splits).map((split) => [
      split,
      evaluateSplit(
        first,
        dataset.examples.filter((example) => example.split === split)
      )
    ])
  );
  const thresholdPass = Object.values(metrics).every(
    (metric) =>
      metric.accuracy >= config.gates.minimumSplitAccuracy &&
      Object.values(metric.classRecall).every(
        (recall) => recall >= config.gates.minimumClassRecall
      )
  );
  const report = {
    schemaVersion: "exp-0014-offline-training-report-v1",
    experimentId: config.id,
    dataset: {
      path: options.dataset ?? DEFAULT_DATASET,
      sha256: dataset.datasetSha256,
      fileSha256: `sha256:${sha256(datasetBytes)}`,
      examples: dataset.examples.length,
      streams: dataset.streams.length,
      validation: datasetValidation
    },
    checkpoint: {
      path: options.out ?? DEFAULT_CHECKPOINT,
      id: checkpoint.checkpointId,
      modelSha256,
      validation: checkpointValidation
    },
    reproducibility: {
      repeatedTrainingEqual: reproducible,
      initialization: first.training.initialization,
      ordering: first.training.ordering
    },
    metrics,
    gates: {
      datasetValid: datasetValidation.valid,
      familySplitDisjoint:
        Object.keys(datasetValidation.familyOwners).length ===
        Object.values(config.splits).flat().length,
      allClassesInEverySplit: Object.values(dataset.splits).every(
        (split) => ACOUSTIC_REFLEX_CLASSES.every(
          (label) => split.labels[label] > 0
        )
      ),
      repeatedTrainingEqual: reproducible,
      checkpointValid: checkpointValidation.valid,
      splitMetricsPass: thresholdPass,
      holdoutExcludedFromFit:
        checkpoint.training.selectedSplit === "train" &&
        checkpoint.training.excludedFromFit.includes("holdout")
    },
    limitations: [
      "M4a prova infraestrutura e imitação de regra; não prova ganho de qualidade",
      "WAV/PCM bruto permanece fora do Git; features e hashes permitem reproduzir exatamente o checkpoint",
      "nenhum rótulo humano participa desta rodada"
    ],
    paidApiCalls: 0
  };
  report.pass = Object.values(report.gates).every(Boolean);
  return { checkpoint, report };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { checkpoint, report } = await trainExp0014(options);
  await writeOrCheck(
    resolve(PROJECT_ROOT, options.out),
    checkpoint,
    options.check
  );
  if (!options.check) {
    await writeOrCheck(
      resolve(PROJECT_ROOT, options.report),
      report,
      false
    );
  }
  console.log(
    `EXP-0014 treino ${report.pass ? "PASS" : "HOLD"}: ` +
      `train=${report.metrics.train.accuracy}, ` +
      `dev=${report.metrics.development.accuracy}, ` +
      `holdout=${report.metrics.holdout.accuracy}, ` +
      `${report.checkpoint.modelSha256}`
  );
  if (!report.pass) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
