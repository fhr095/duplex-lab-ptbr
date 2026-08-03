import { isDeepStrictEqual } from "node:util";

import {
  EXP0018_CLASSES,
  EXP0018_FEATURE_NAMES,
  EXP0018_FEATURE_VERSION,
  EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
  extractExp0018ContextFeatures,
  normalizeExp0018Text,
  projectExp0018ModelInput,
  validateExp0018Dataset
} from "./exp-0018-context.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import { EXP0018_STAGE_CONTRACTS } from "./exp-0018-boundary.mjs";
import {
  predictSoftmaxClassifier,
  trainSoftmaxClassifier
} from "../learning/softmax-classifier.mjs";

export const EXP0018_FIT_CANDIDATE_VERSION =
  "exp-0018-context-fit-candidate-v1";
export const EXP0018_CHECKPOINT_VERSION =
  "exp-0018-context-checkpoint-v1";
export const EXP0018_DEVELOPMENT_REPORT_VERSION =
  "exp-0018-context-development-report-v1";
export const EXP0018_DEVELOPMENT_INVALIDATION_VERSION =
  "exp-0018-development-invalidation-v1";

export const EXP0018_BACKGROUND = "BACKGROUND_OR_NOT_DIRECTED";
export const EXP0018_DIRECTED = "DIRECTED_TO_ASSISTANT";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validSha256(value) {
  return SHA256_PATTERN.test(value ?? "");
}

function validCommit(value) {
  return COMMIT_PATTERN.test(value ?? "");
}

function validFilesystemBoundary(boundary, stageName, executionCommit) {
  const contract = EXP0018_STAGE_CONTRACTS[stageName];
  return boundary?.permissionModelEnabled === true &&
    boundary?.environmentSanitized === true &&
    boundary?.denialProbesPassed === true &&
    boundary?.preflightCommit === executionCommit &&
    typeof boundary?.nodeVersion === "string" &&
    same(boundary?.allowedDataReads, contract.dataReads) &&
    same(boundary?.deniedDataReads, contract.prohibitedDataReads) &&
    same(boundary?.allowedWrites, contract.writes);
}

function validModelShape(model) {
  return model?.algorithm ===
      "full-batch-multinomial-logistic-regression-v1" &&
    same(model?.classNames, EXP0018_CLASSES) &&
    model?.featureCount === EXP0018_FEATURE_NAMES.length &&
    Array.isArray(model?.weights) &&
    model.weights.length === EXP0018_CLASSES.length &&
    model.weights.every((row) =>
      Array.isArray(row) &&
      row.length === EXP0018_FEATURE_NAMES.length &&
      row.every(Number.isFinite)
    ) &&
    Number.isFinite(model?.training?.finalLoss) &&
    model.training.finalLoss >= 0;
}

function validRate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validThresholdSelection(selection, threshold) {
  if (
    selection?.schemaVersion !== "exp-0018-threshold-selection-v1" ||
    selection?.objective !==
      "maximize-background-recall-subject-to-perfect-directed-recall" ||
    selection?.tieBreak !== "highest-threshold" ||
    selection?.safeSolution !== true ||
    !Array.isArray(selection?.candidates) ||
    selection.candidates.length === 0
  ) {
    return false;
  }
  const candidates = selection.candidates;
  if (candidates.some((item) =>
    !Number.isFinite(item?.threshold) ||
    item.threshold < 0.5 || item.threshold > 1 ||
    !validRate(item?.directedRecall) ||
    !validRate(item?.backgroundRecall) ||
    !validRate(item?.accuracy)
  )) {
    return false;
  }
  const thresholds = candidates.map((item) => item.threshold);
  if (
    new Set(thresholds).size !== thresholds.length ||
    !same(thresholds, [...thresholds].sort((left, right) => left - right)) ||
    thresholds.at(-1) !== 1
  ) {
    return false;
  }
  const safe = candidates.filter((item) => item.directedRecall === 1)
    .toSorted((left, right) =>
      right.backgroundRecall - left.backgroundRecall ||
      right.threshold - left.threshold
    );
  const expected = safe[0];
  return safe.length > 0 &&
    selection.safeCandidates === safe.length &&
    selection.selected?.threshold === expected.threshold &&
    selection.selected?.directedRecall === expected.directedRecall &&
    selection.selected?.backgroundRecall === expected.backgroundRecall &&
    selection.selected?.accuracy === expected.accuracy &&
    threshold === expected.threshold;
}

function withoutHash(value, hashKey) {
  const core = structuredClone(value ?? {});
  delete core[hashKey];
  return core;
}

function assertConfig(config) {
  assert(
    `sha256:${canonicalSha256(config)}` ===
      EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
    "configuração EXP-0018 diverge do compromisso prefit"
  );
  assert(
    config?.trainer?.algorithm ===
      "full-batch-multinomial-logistic-regression-v1" &&
    config.trainer.modelFamiliesAllowed === 1 &&
    config.trainer.repeatedFits === 2 &&
    config.trainer.fitRole === "fit" &&
    config.trainer.calibrationUsedForWeights === false &&
    config.trainer.developmentUsedForWeights === false,
    "contrato de treino EXP-0018 inválido"
  );
}

function featureValues(example, contextEnabled) {
  const projected = projectExp0018ModelInput(example.modelInput, {
    contextEnabled
  });
  return extractExp0018ContextFeatures(projected, {
    contextEnabled
  }).values;
}

function trainArm(dataset, config, contextEnabled) {
  const options = {
    examples: dataset.examples.map((example) => ({
      label: example.label,
      features: featureValues(example, contextEnabled)
    })),
    classNames: EXP0018_CLASSES,
    featureCount: EXP0018_FEATURE_NAMES.length,
    epochs: config.trainer.epochs,
    learningRate: config.trainer.learningRate,
    l2: config.trainer.l2
  };
  const first = trainSoftmaxClassifier(options);
  const second = trainSoftmaxClassifier(options);
  return deepFreeze({
    model: first,
    repeatedFitEqual: isDeepStrictEqual(first, second),
    modelSha256: `sha256:${canonicalSha256(first)}`
  });
}

function rawObservation(model, example, contextEnabled) {
  const values = featureValues(example, contextEnabled);
  const prediction = predictSoftmaxClassifier(
    model,
    values
  );
  return deepFreeze({
    exampleId: example.exampleId,
    pairRootId: example.pairRootId,
    crossBlockRootId: example.crossBlockRootId,
    family: example.family,
    expected: example.label,
    featureValues: values,
    rawPredicted: prediction.label,
    backgroundProbability: prediction.probabilities[EXP0018_BACKGROUND]
  });
}

function backgroundProbabilityFromTrace(model, values) {
  const logits = model.weights.map((row) => row.reduce(
    (sum, weight, index) => sum + weight * values[index],
    0
  ));
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials[model.classNames.indexOf(EXP0018_BACKGROUND)] / total;
}

export function rawExp0018Observations(
  model,
  dataset,
  contextEnabled
) {
  return deepFreeze(dataset.examples.map((example) =>
    rawObservation(model, example, contextEnabled)
  ).toSorted((left, right) => left.exampleId.localeCompare(right.exampleId)));
}

export function summarizeExp0018Observations(observations) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new TypeError("observations precisa conter casos");
  }
  const confusion = Object.fromEntries(EXP0018_CLASSES.map((expected) => [
    expected,
    Object.fromEntries(EXP0018_CLASSES.map((predicted) => [predicted, 0]))
  ]));
  for (const observation of observations) {
    if (
      !EXP0018_CLASSES.includes(observation?.expected) ||
      !EXP0018_CLASSES.includes(observation?.predicted)
    ) {
      throw new TypeError("observação EXP-0018 incompatível");
    }
    confusion[observation.expected][observation.predicted] += 1;
  }
  const correct = observations.filter(
    (item) => item.expected === item.predicted
  ).length;
  const classRecall = Object.fromEntries(EXP0018_CLASSES.map((label) => {
    const total = Object.values(confusion[label]).reduce(
      (sum, value) => sum + value,
      0
    );
    return [label, total === 0 ? null : confusion[label][label] / total];
  }));
  return deepFreeze({
    observations: observations.length,
    correct,
    accuracy: correct / observations.length,
    classRecall,
    confusion
  });
}

export function evaluateExp0018Threshold(observations, threshold) {
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) {
    throw new RangeError("threshold precisa estar em [0.5, 1]");
  }
  const evaluated = observations.map((observation) => {
    if (
      !Number.isFinite(observation?.backgroundProbability) ||
      observation.backgroundProbability < 0 ||
      observation.backgroundProbability > 1
    ) {
      throw new TypeError("probabilidade de calibração inválida");
    }
    const predicted = observation.backgroundProbability >= threshold
      ? EXP0018_BACKGROUND
      : EXP0018_DIRECTED;
    return deepFreeze({ ...observation, predicted });
  });
  const summary = summarizeExp0018Observations(evaluated);
  return deepFreeze({ threshold, observations: evaluated, summary });
}

export function selectExp0018Threshold(observations) {
  const candidates = [...new Set([
    1,
    ...observations.map((item) => item.backgroundProbability)
      .filter((value) => value >= 0.5 && value <= 1)
  ])].sort((left, right) => left - right);
  const evaluated = candidates.map((threshold) =>
    evaluateExp0018Threshold(observations, threshold)
  );
  const safe = evaluated.filter((item) =>
    item.summary.classRecall[EXP0018_DIRECTED] === 1
  ).toSorted((left, right) =>
    right.summary.classRecall[EXP0018_BACKGROUND] -
      left.summary.classRecall[EXP0018_BACKGROUND] ||
    right.threshold - left.threshold
  );
  return deepFreeze({
    schemaVersion: "exp-0018-threshold-selection-v1",
    objective:
      "maximize-background-recall-subject-to-perfect-directed-recall",
    tieBreak: "highest-threshold",
    candidates: evaluated.map((item) => ({
      threshold: item.threshold,
      directedRecall: item.summary.classRecall[EXP0018_DIRECTED],
      backgroundRecall: item.summary.classRecall[EXP0018_BACKGROUND],
      accuracy: item.summary.accuracy
    })),
    safeCandidates: safe.length,
    safeSolution: safe.length > 0,
    selected: safe.length === 0 ? null : {
      threshold: safe[0].threshold,
      directedRecall: safe[0].summary.classRecall[EXP0018_DIRECTED],
      backgroundRecall: safe[0].summary.classRecall[EXP0018_BACKGROUND],
      accuracy: safe[0].summary.accuracy
    }
  });
}

export function fitExp0018ContextModels(input = {}) {
  assertConfig(input.config);
  const validation = validateExp0018Dataset(input.dataset);
  assert(validation.valid, `fit dataset inválido: ${validation.errors.join("; ")}`);
  assert(input.dataset.role === "fit", "fitter aceita somente role=fit");
  const b0 = trainArm(input.dataset, input.config, false);
  const b1 = trainArm(input.dataset, input.config, true);
  assert(b0.repeatedFitEqual && b1.repeatedFitEqual,
    "fits repetidos produziram pesos divergentes");
  const b0Observations = rawExp0018Observations(
    b0.model,
    input.dataset,
    false
  );
  const b1Observations = rawExp0018Observations(
    b1.model,
    input.dataset,
    true
  );
  return deepFreeze({
    arms: { B0: b0, B1: b1 },
    fitPredictionSha256: {
      B0: `sha256:${canonicalSha256(b0Observations)}`,
      B1: `sha256:${canonicalSha256(b1Observations)}`
    }
  });
}

export function createExp0018FitCandidate(input = {}) {
  assert(validSha256(input.prefitFreezeSha256),
    "prefitFreezeSha256 é obrigatório");
  assert(validSha256(input.configFileSha256),
    "configFileSha256 é obrigatório");
  assert(validSha256(input.fitDatasetFileSha256),
    "fitDatasetFileSha256 é obrigatório");
  assert(validCommit(input.fitExecutionCommit),
    "fitExecutionCommit é obrigatório");
  const fitted = fitExp0018ContextModels({
    config: input.config,
    dataset: input.fitDataset
  });
  const core = {
    schemaVersion: EXP0018_FIT_CANDIDATE_VERSION,
    experimentId: "EXP-0018",
    featureVersion: EXP0018_FEATURE_VERSION,
    featureNames: [...EXP0018_FEATURE_NAMES],
    classes: [...EXP0018_CLASSES],
    bindings: {
      prefitFreezeSha256: input.prefitFreezeSha256,
      configFileSha256: input.configFileSha256,
      configCanonicalSha256: EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
      fitDatasetFileSha256: input.fitDatasetFileSha256,
      fitDatasetCanonicalSha256: input.fitDataset.datasetSha256,
      fitExecutionCommit: input.fitExecutionCommit
    },
    trainer: {
      algorithm: input.config.trainer.algorithm,
      epochs: input.config.trainer.epochs,
      learningRate: input.config.trainer.learningRate,
      l2: input.config.trainer.l2,
      initialization: input.config.trainer.initialization,
      ordering: input.config.trainer.ordering,
      examples: input.fitDataset.examples.length,
      repeatedFits: input.config.trainer.repeatedFits
    },
    arms: {
      B0: {
        contextEnabled: false,
        modelSha256: fitted.arms.B0.modelSha256,
        model: fitted.arms.B0.model,
        repeatedFitEqual: fitted.arms.B0.repeatedFitEqual,
        fitPredictionSha256: fitted.fitPredictionSha256.B0
      },
      B1: {
        contextEnabled: true,
        modelSha256: fitted.arms.B1.modelSha256,
        model: fitted.arms.B1.model,
        repeatedFitEqual: fitted.arms.B1.repeatedFitEqual,
        fitPredictionSha256: fitted.fitPredictionSha256.B1
      }
    },
    boundary: {
      calibrationRead: false,
      developmentRead: false,
      thresholdSelected: false,
      canProduceEffects: false
    },
    authority: { mode: "offline-shadow-only", canProduceEffects: false }
  };
  return deepFreeze({
    ...core,
    fitCandidateSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0018FitCandidate(candidate) {
  const errors = [];
  if (candidate?.schemaVersion !== EXP0018_FIT_CANDIDATE_VERSION) {
    errors.push("schemaVersion de fit candidate incompatível");
  }
  if (
    candidate?.featureVersion !== EXP0018_FEATURE_VERSION ||
    !same(candidate?.featureNames, EXP0018_FEATURE_NAMES) ||
    !same(candidate?.classes, EXP0018_CLASSES)
  ) {
    errors.push("features/classes do fit candidate incompatíveis");
  }
  if (
    candidate?.experimentId !== "EXP-0018" ||
    !validSha256(candidate?.bindings?.prefitFreezeSha256) ||
    !validSha256(candidate?.bindings?.configFileSha256) ||
    candidate?.bindings?.configCanonicalSha256 !==
      EXP0018_PREFIT_CONFIG_CANONICAL_SHA256 ||
    !validSha256(candidate?.bindings?.fitDatasetFileSha256) ||
    !validSha256(candidate?.bindings?.fitDatasetCanonicalSha256) ||
    !validCommit(candidate?.bindings?.fitExecutionCommit)
  ) {
    errors.push("bindings do fit candidate incompatíveis");
  }
  if (
    candidate?.fitCandidateSha256 !==
      `sha256:${canonicalSha256(withoutHash(
        candidate,
        "fitCandidateSha256"
      ))}`
  ) {
    errors.push("fitCandidateSha256 divergente");
  }
  for (const [name, contextEnabled] of [["B0", false], ["B1", true]]) {
    const arm = candidate?.arms?.[name];
    if (
      arm?.contextEnabled !== contextEnabled ||
      arm?.repeatedFitEqual !== true ||
      arm?.modelSha256 !== `sha256:${canonicalSha256(arm?.model)}` ||
      !validModelShape(arm?.model) ||
      !validSha256(arm?.fitPredictionSha256) ||
      !same(arm?.model?.training, {
        epochs: candidate?.trainer?.epochs,
        learningRate: candidate?.trainer?.learningRate,
        l2: candidate?.trainer?.l2,
        classCounts: Object.fromEntries(
          EXP0018_CLASSES.map((label) => [label, 24])
        ),
        classWeights: Object.fromEntries(
          EXP0018_CLASSES.map((label) => [label, 1])
        ),
        finalLoss: arm?.model?.training?.finalLoss,
        ordering: candidate?.trainer?.ordering,
        initialization: candidate?.trainer?.initialization
      })
    ) {
      errors.push(`${name} do fit candidate é incompatível`);
    }
  }
  if (
    candidate?.trainer?.algorithm !==
      "full-batch-multinomial-logistic-regression-v1" ||
    candidate?.trainer?.epochs !== 3000 ||
    candidate?.trainer?.learningRate !== 0.25 ||
    candidate?.trainer?.l2 !== 0.001 ||
    candidate?.trainer?.initialization !== "all-zero" ||
    candidate?.trainer?.ordering !== "input-order/full-batch" ||
    candidate?.trainer?.examples !== 48 ||
    candidate?.trainer?.repeatedFits !== 2
  ) {
    errors.push("trainer do fit candidate incompatível");
  }
  if (
    candidate?.boundary?.calibrationRead !== false ||
    candidate?.boundary?.developmentRead !== false ||
    candidate?.boundary?.thresholdSelected !== false ||
    candidate?.boundary?.canProduceEffects !== false ||
    candidate?.authority?.mode !== "offline-shadow-only" ||
    candidate?.authority?.canProduceEffects !== false
  ) {
    errors.push("fit candidate rompe fronteira ou autoridade");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

function nearestRank(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("percentil exige valores");
  }
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * ordered.length) - 1);
  return ordered[index];
}

function measureOperation(now, operation) {
  const start = now();
  operation();
  const end = now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new TypeError("relógio monotônico inválido");
  }
  return end - start;
}

function durationSummary(values) {
  return {
    minimumMs: Math.min(...values),
    maximumMs: Math.max(...values),
    p95Ms: nearestRank(values, 0.95)
  };
}

function validLatencySamples(latency) {
  const samples = latency?.samples;
  const b0 = samples?.B0Ms;
  const b1 = samples?.B1Ms;
  const deltas = samples?.deltaB1MinusB0Ms;
  const expectedLength = latency?.measurementsPerArm;
  if (
    !Number.isSafeInteger(expectedLength) || expectedLength < 1 ||
    !Array.isArray(b0) || !Array.isArray(b1) || !Array.isArray(deltas) ||
    b0.length !== expectedLength || b1.length !== expectedLength ||
    deltas.length !== expectedLength ||
    b0.some((value) => !Number.isFinite(value) || value < 0) ||
    b1.some((value) => !Number.isFinite(value) || value < 0) ||
    deltas.some((value) => !Number.isFinite(value)) ||
    !b0.some((value) => value > 0) ||
    !b1.some((value) => value > 0) ||
    deltas.some((value, index) => value !== b1[index] - b0[index])
  ) {
    return false;
  }
  const sampleCore = {
    B0Ms: b0,
    B1Ms: b1,
    deltaB1MinusB0Ms: deltas
  };
  return latency.samplesSha256 ===
      `sha256:${canonicalSha256(sampleCore)}` &&
    isDeepStrictEqual(latency.B0, durationSummary(b0)) &&
    isDeepStrictEqual(latency.B1, durationSummary(b1)) &&
    isDeepStrictEqual(
      latency.deltaB1MinusB0,
      durationSummary(deltas)
    );
}

export function measureExp0018LocalLatency(input = {}) {
  const now = input.now ?? (() => performance.now());
  const warmups = input.warmups ?? 20;
  const repetitions = input.repetitions ?? 200;
  if (
    !Number.isSafeInteger(warmups) || warmups < 0 ||
    !Number.isSafeInteger(repetitions) || repetitions < 1
  ) {
    throw new TypeError("plano de latência inválido");
  }
  const b0Durations = [];
  const b1Durations = [];
  const deltas = [];
  for (const example of input.dataset.examples) {
    const b0Input = projectExp0018ModelInput(example.modelInput, {
      contextEnabled: false
    });
    const b1Input = projectExp0018ModelInput(example.modelInput, {
      contextEnabled: true
    });
    const run = (name) => {
      const contextEnabled = name === "B1";
      const projected = contextEnabled ? b1Input : b0Input;
      const model = input.models[name];
      return measureOperation(now, () => {
        const features = extractExp0018ContextFeatures(projected, {
          contextEnabled
        });
        predictSoftmaxClassifier(model, features.values);
      });
    };
    for (let index = 0; index < warmups; index += 1) {
      run(index % 2 === 0 ? "B0" : "B1");
      run(index % 2 === 0 ? "B1" : "B0");
    }
    for (let index = 0; index < repetitions; index += 1) {
      let b0;
      let b1;
      if (index % 2 === 0) {
        b0 = run("B0");
        b1 = run("B1");
      } else {
        b1 = run("B1");
        b0 = run("B0");
      }
      b0Durations.push(b0);
      b1Durations.push(b1);
      deltas.push(b1 - b0);
    }
  }
  const samples = {
    B0Ms: b0Durations,
    B1Ms: b1Durations,
    deltaB1MinusB0Ms: deltas
  };
  return deepFreeze({
    schemaVersion: "exp-0018-local-latency-v1",
    operation: "feature-extraction-plus-softmax-prediction",
    schedule: "interleaved-alternating-order",
    examples: input.dataset.examples.length,
    warmupsPerArmPerExample: warmups,
    measuredRepetitionsPerArmPerExample: repetitions,
    measurementsPerArm: b0Durations.length,
    percentileMethod: "nearest-rank",
    B0: durationSummary(b0Durations),
    B1: durationSummary(b1Durations),
    deltaB1MinusB0: durationSummary(deltas),
    samples,
    samplesSha256: `sha256:${canonicalSha256(samples)}`,
    interpretation: "local-only-not-end-to-end"
  });
}

export function createExp0018Checkpoint(input = {}) {
  assertConfig(input.config);
  for (const [name, value] of Object.entries({
    prefitFreezeSha256: input.prefitFreezeSha256,
    fitAttestationSha256: input.fitAttestationSha256,
    configFileSha256: input.configFileSha256,
    calibrationDatasetFileSha256: input.calibrationDatasetFileSha256
  })) {
    assert(validSha256(value), `${name} é obrigatório`);
  }
  assert(validCommit(input.calibrationExecutionCommit),
    "calibrationExecutionCommit é obrigatório");
  const candidateValidation = validateExp0018FitCandidate(input.fitCandidate);
  assert(candidateValidation.valid,
    `fit candidate inválido: ${candidateValidation.errors.join("; ")}`);
  assert(
    input.fitCandidate.bindings.prefitFreezeSha256 ===
      input.prefitFreezeSha256 &&
    input.fitCandidate.bindings.configFileSha256 === input.configFileSha256 &&
    input.fitCandidate.bindings.configCanonicalSha256 ===
      EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
    "fit candidate diverge das bindings do calibrador"
  );
  const datasetValidation = validateExp0018Dataset(input.calibrationDataset);
  assert(datasetValidation.valid,
    `calibration dataset inválido: ${datasetValidation.errors.join("; ")}`);
  assert(input.calibrationDataset.role === "calibration",
    "calibrador aceita somente role=calibration");

  const raw = {
    B0: rawExp0018Observations(
      input.fitCandidate.arms.B0.model,
      input.calibrationDataset,
      false
    ),
    B1: rawExp0018Observations(
      input.fitCandidate.arms.B1.model,
      input.calibrationDataset,
      true
    )
  };
  const repeatedRaw = {
    B0: rawExp0018Observations(
      input.fitCandidate.arms.B0.model,
      input.calibrationDataset,
      false
    ),
    B1: rawExp0018Observations(
      input.fitCandidate.arms.B1.model,
      input.calibrationDataset,
      true
    )
  };
  assert(isDeepStrictEqual(raw, repeatedRaw),
    "predições repetidas de calibração divergiram");
  const selections = {
    B0: selectExp0018Threshold(raw.B0),
    B1: selectExp0018Threshold(raw.B1)
  };
  const repeatedSelections = {
    B0: selectExp0018Threshold(repeatedRaw.B0),
    B1: selectExp0018Threshold(repeatedRaw.B1)
  };
  assert(isDeepStrictEqual(selections, repeatedSelections),
    "seleções repetidas de limiar divergiram");
  assert(selections.B0.safeSolution && selections.B1.safeSolution,
    "nenhum limiar train-only preserva recall dirigido perfeito");
  const latency = measureExp0018LocalLatency({
    dataset: input.calibrationDataset,
    models: {
      B0: input.fitCandidate.arms.B0.model,
      B1: input.fitCandidate.arms.B1.model
    },
    warmups: input.config.metrics.latency.warmupsPerArmPerExample,
    repetitions:
      input.config.metrics.latency.measuredRepetitionsPerArmPerExample,
    now: input.now
  });
  const core = {
    schemaVersion: EXP0018_CHECKPOINT_VERSION,
    checkpointId: `exp-0018-context-${input.fitCandidate.arms.B1
      .modelSha256.slice(7, 23)}`,
    experimentId: "EXP-0018",
    featureVersion: EXP0018_FEATURE_VERSION,
    featureNames: [...EXP0018_FEATURE_NAMES],
    classes: [...EXP0018_CLASSES],
    bindings: {
      prefitFreezeSha256: input.prefitFreezeSha256,
      fitCandidateSha256: input.fitCandidate.fitCandidateSha256,
      fitAttestationSha256: input.fitAttestationSha256,
      configFileSha256: input.configFileSha256,
      configCanonicalSha256: EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
      fitDatasetCanonicalSha256:
        input.fitCandidate.bindings.fitDatasetCanonicalSha256,
      calibrationDatasetFileSha256: input.calibrationDatasetFileSha256,
      calibrationDatasetCanonicalSha256:
        input.calibrationDataset.datasetSha256,
      calibrationExecutionCommit: input.calibrationExecutionCommit
    },
    arms: {
      B0: {
        contextEnabled: false,
        modelSha256: input.fitCandidate.arms.B0.modelSha256,
        model: input.fitCandidate.arms.B0.model,
        threshold: selections.B0.selected.threshold,
        calibration: selections.B0
      },
      B1: {
        contextEnabled: true,
        modelSha256: input.fitCandidate.arms.B1.modelSha256,
        model: input.fitCandidate.arms.B1.model,
        threshold: selections.B1.selected.threshold,
        calibration: selections.B1
      }
    },
    reproducibility: {
      repeatedFitsEqual:
        input.fitCandidate.arms.B0.repeatedFitEqual &&
        input.fitCandidate.arms.B1.repeatedFitEqual,
      repeatedCalibrationPredictionsEqual: true,
      repeatedCalibrationSelectionsEqual: true,
      calibrationPredictionSha256: {
        B0: `sha256:${canonicalSha256(raw.B0)}`,
        B1: `sha256:${canonicalSha256(raw.B1)}`
      }
    },
    latency,
    filesystemBoundary: structuredClone(input.filesystemBoundary),
    boundary: {
      fitRead: true,
      calibrationRead: true,
      developmentRead: false,
      developmentOpeningsUsed: 0,
      canProduceEffects: false
    },
    authority: { mode: "offline-shadow-only", canProduceEffects: false },
    claims: {
      developmentQualityKnown: false,
      mechanismPassed: null,
      maximumClaim: input.config.maximumClaim
    }
  };
  return deepFreeze({
    ...core,
    checkpointSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0018Checkpoint(checkpoint) {
  const errors = [];
  if (checkpoint?.schemaVersion !== EXP0018_CHECKPOINT_VERSION) {
    errors.push("schemaVersion de checkpoint incompatível");
  }
  if (
    checkpoint?.featureVersion !== EXP0018_FEATURE_VERSION ||
    !same(checkpoint?.featureNames, EXP0018_FEATURE_NAMES) ||
    !same(checkpoint?.classes, EXP0018_CLASSES)
  ) {
    errors.push("features/classes de checkpoint incompatíveis");
  }
  if (
    checkpoint?.experimentId !== "EXP-0018" ||
    checkpoint?.checkpointId !== `exp-0018-context-${checkpoint?.arms?.B1
      ?.modelSha256?.slice(7, 23)}` ||
    !validSha256(checkpoint?.bindings?.prefitFreezeSha256) ||
    !validSha256(checkpoint?.bindings?.fitCandidateSha256) ||
    !validSha256(checkpoint?.bindings?.fitAttestationSha256) ||
    !validSha256(checkpoint?.bindings?.configFileSha256) ||
    checkpoint?.bindings?.configCanonicalSha256 !==
      EXP0018_PREFIT_CONFIG_CANONICAL_SHA256 ||
    !validSha256(checkpoint?.bindings?.fitDatasetCanonicalSha256) ||
    !validSha256(checkpoint?.bindings?.calibrationDatasetFileSha256) ||
    !validSha256(checkpoint?.bindings?.calibrationDatasetCanonicalSha256) ||
    !validCommit(checkpoint?.bindings?.calibrationExecutionCommit)
  ) {
    errors.push("bindings do checkpoint incompatíveis");
  }
  if (
    checkpoint?.checkpointSha256 !==
      `sha256:${canonicalSha256(withoutHash(
        checkpoint,
        "checkpointSha256"
      ))}`
  ) {
    errors.push("checkpointSha256 divergente");
  }
  for (const [name, contextEnabled] of [["B0", false], ["B1", true]]) {
    const arm = checkpoint?.arms?.[name];
    if (
      arm?.contextEnabled !== contextEnabled ||
      arm?.modelSha256 !== `sha256:${canonicalSha256(arm?.model)}` ||
      !validModelShape(arm?.model) ||
      !Number.isFinite(arm?.threshold) ||
      arm.threshold < 0.5 || arm.threshold > 1 ||
      !validThresholdSelection(arm?.calibration, arm?.threshold)
    ) {
      errors.push(`${name} do checkpoint é incompatível`);
    }
  }
  if (
    checkpoint?.reproducibility?.repeatedFitsEqual !== true ||
    checkpoint?.reproducibility?.repeatedCalibrationPredictionsEqual !== true ||
    checkpoint?.reproducibility?.repeatedCalibrationSelectionsEqual !== true ||
    checkpoint?.boundary?.fitRead !== true ||
    checkpoint?.boundary?.calibrationRead !== true ||
    checkpoint?.boundary?.developmentRead !== false ||
    checkpoint?.boundary?.developmentOpeningsUsed !== 0 ||
    checkpoint?.boundary?.canProduceEffects !== false ||
    checkpoint?.authority?.mode !== "offline-shadow-only" ||
    checkpoint?.authority?.canProduceEffects !== false ||
    checkpoint?.claims?.developmentQualityKnown !== false ||
    checkpoint?.claims?.mechanismPassed !== null ||
    typeof checkpoint?.claims?.maximumClaim !== "string"
  ) {
    errors.push("checkpoint rompe reprodutibilidade, boundary ou claims");
  }
  if (
    checkpoint?.latency?.schemaVersion !== "exp-0018-local-latency-v1" ||
    checkpoint?.latency?.operation !==
      "feature-extraction-plus-softmax-prediction" ||
    checkpoint?.latency?.schedule !== "interleaved-alternating-order" ||
    checkpoint?.latency?.examples !== 16 ||
    checkpoint?.latency?.warmupsPerArmPerExample !== 20 ||
    checkpoint?.latency?.measuredRepetitionsPerArmPerExample !== 200 ||
    checkpoint?.latency?.measurementsPerArm !== 3200 ||
    checkpoint?.latency?.percentileMethod !== "nearest-rank" ||
    !Number.isFinite(checkpoint?.latency?.B0?.minimumMs) ||
    !Number.isFinite(checkpoint?.latency?.B0?.maximumMs) ||
    !Number.isFinite(checkpoint?.latency?.B0?.p95Ms) ||
    !Number.isFinite(checkpoint?.latency?.B1?.minimumMs) ||
    !Number.isFinite(checkpoint?.latency?.B1?.maximumMs) ||
    !Number.isFinite(checkpoint?.latency?.B1?.p95Ms) ||
    checkpoint.latency.B0.minimumMs < 0 ||
    checkpoint.latency.B1.minimumMs < 0 ||
    checkpoint.latency.B0.minimumMs > checkpoint.latency.B0.p95Ms ||
    checkpoint.latency.B0.p95Ms > checkpoint.latency.B0.maximumMs ||
    checkpoint.latency.B1.minimumMs > checkpoint.latency.B1.p95Ms ||
    checkpoint.latency.B1.p95Ms > checkpoint.latency.B1.maximumMs ||
    !Number.isFinite(
      checkpoint?.latency?.deltaB1MinusB0?.minimumMs
    ) ||
    !Number.isFinite(
      checkpoint?.latency?.deltaB1MinusB0?.maximumMs
    ) ||
    !Number.isFinite(checkpoint?.latency?.deltaB1MinusB0?.p95Ms) ||
    checkpoint.latency.deltaB1MinusB0.minimumMs >
      checkpoint.latency.deltaB1MinusB0.p95Ms ||
    checkpoint.latency.deltaB1MinusB0.p95Ms >
      checkpoint.latency.deltaB1MinusB0.maximumMs ||
    checkpoint.latency.deltaB1MinusB0.minimumMs <
      -checkpoint.latency.B0.maximumMs ||
    checkpoint.latency.deltaB1MinusB0.maximumMs >
      checkpoint.latency.B1.maximumMs ||
    !validLatencySamples(checkpoint?.latency) ||
    checkpoint?.latency?.interpretation !== "local-only-not-end-to-end"
  ) {
    errors.push("latência do checkpoint incompatível");
  }
  if (!validFilesystemBoundary(
    checkpoint?.filesystemBoundary,
    "calibration",
    checkpoint?.bindings?.calibrationExecutionCommit
  )) {
    errors.push("fronteira física de calibração incompatível");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function validateExp0018CheckpointAgainstCalibration(
  checkpoint,
  input = {}
) {
  const errors = [];
  const structural = validateExp0018Checkpoint(checkpoint);
  if (!structural.valid) {
    errors.push(...structural.errors);
  }
  try {
    assertConfig(input.config);
    const datasetValidation = validateExp0018Dataset(
      input.calibrationDataset
    );
    assert(datasetValidation.valid,
      `calibration dataset inválido: ${datasetValidation.errors.join("; ")}`);
    assert(input.calibrationDataset.role === "calibration",
      "validação autoritativa exige role=calibration");
    assert(
      checkpoint?.bindings?.calibrationDatasetCanonicalSha256 ===
        input.calibrationDataset.datasetSha256,
      "checkpoint diverge do dataset canônico de calibração"
    );
    for (const [name, contextEnabled] of [["B0", false], ["B1", true]]) {
      const observations = rawExp0018Observations(
        checkpoint.arms[name].model,
        input.calibrationDataset,
        contextEnabled
      );
      const selection = selectExp0018Threshold(observations);
      assert(
        checkpoint.reproducibility.calibrationPredictionSha256[name] ===
          `sha256:${canonicalSha256(observations)}`,
        `${name} diverge das predições autoritativas de calibração`
      );
      assert(
        isDeepStrictEqual(checkpoint.arms[name].calibration, selection) &&
        checkpoint.arms[name].threshold === selection.selected?.threshold,
        `${name} diverge da seleção autoritativa de limiar`
      );
    }
  } catch (error) {
    errors.push(error.message);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function predictExp0018Checkpoint(checkpoint, example, armName) {
  const validation = validateExp0018Checkpoint(checkpoint);
  if (!validation.valid) {
    throw new TypeError(`checkpoint inválido: ${validation.errors.join("; ")}`);
  }
  const arm = checkpoint.arms[armName];
  if (!arm) {
    throw new TypeError(`arm desconhecido: ${armName}`);
  }
  const raw = rawObservation(arm.model, example, arm.contextEnabled);
  const predicted = raw.backgroundProbability >= arm.threshold
    ? EXP0018_BACKGROUND
    : EXP0018_DIRECTED;
  return deepFreeze({ ...raw, predicted });
}

function deterministicObservation(example, predicted) {
  return deepFreeze({
    exampleId: example.exampleId,
    pairRootId: example.pairRootId,
    crossBlockRootId: example.crossBlockRootId,
    family: example.family,
    expected: example.label,
    predicted
  });
}

function pairedComparison(b0, b1) {
  const byIdB0 = new Map(b0.map((item) => [item.exampleId, item]));
  const groups = Map.groupBy(b1, (item) => item.pairRootId);
  const pairs = [...groups.entries()].map(([pairRootId, descendants]) => {
    const b1Correct = descendants.filter(
      (item) => item.expected === item.predicted
    ).length;
    const b0Correct = descendants.filter((item) => {
      const control = byIdB0.get(item.exampleId);
      return control?.expected === control?.predicted;
    }).length;
    return {
      pairRootId,
      B0Correct: b0Correct,
      B1Correct: b1Correct,
      outcome: b1Correct > b0Correct ? "B1_WIN" :
        b1Correct < b0Correct ? "B1_LOSS" : "TIE"
    };
  }).toSorted((left, right) => left.pairRootId.localeCompare(right.pairRootId));
  const wins = pairs.filter((item) => item.outcome === "B1_WIN").length;
  const losses = pairs.filter((item) => item.outcome === "B1_LOSS").length;
  const complete = pairs.filter((item) => item.B1Correct === 2).length;
  return deepFreeze({
    pairs: pairs.length,
    wins,
    losses,
    ties: pairs.length - wins - losses,
    netWins: wins - losses,
    B1CompletePairs: complete,
    B1CompletePairShare: complete / pairs.length,
    outcomes: pairs
  });
}

function crossBlockComparison(b0, b1) {
  const byIdB0 = new Map(b0.map((item) => [item.exampleId, item]));
  const groups = Map.groupBy(b1, (item) => item.crossBlockRootId);
  const blocks = [...groups.entries()].map(([crossBlockRootId, descendants]) => {
    const B1Correct = descendants.filter(
      (item) => item.expected === item.predicted
    ).length;
    const B0Correct = descendants.filter((item) => {
      const control = byIdB0.get(item.exampleId);
      return control?.expected === control?.predicted;
    }).length;
    return {
      crossBlockRootId,
      family: descendants[0].family,
      B0Correct,
      B1Correct,
      netGain: B1Correct - B0Correct,
      positive: B1Correct > B0Correct
    };
  }).toSorted((left, right) =>
    left.crossBlockRootId.localeCompare(right.crossBlockRootId)
  );
  const positive = blocks.filter((item) => item.positive);
  return deepFreeze({
    blocks: blocks.length,
    positiveBlocks: positive.length,
    familiesWithPositiveBlock:
      new Set(positive.map((item) => item.family)).size,
    outcomes: blocks
  });
}

function b0PairIdentity(dataset, predictions) {
  const predictedById = new Map(
    predictions.map((item) => [item.exampleId, item.predicted])
  );
  const groups = Map.groupBy(dataset.examples, (item) => item.pairRootId);
  return [...groups.values()].every((descendants) => {
    const projected = descendants.map((item) =>
      projectExp0018ModelInput(item.modelInput, { contextEnabled: false })
    );
    return isDeepStrictEqual(projected[0], projected[1]) &&
      predictedById.get(descendants[0].exampleId) ===
        predictedById.get(descendants[1].exampleId);
  });
}

function marginalControl(dataset, keyOf) {
  const groups = Map.groupBy(dataset.examples, keyOf);
  let bestCorrect = 0;
  let oppositeLabelsEverywhere = true;
  for (const examples of groups.values()) {
    const counts = Object.fromEntries(
      EXP0018_CLASSES.map((label) => [
        label,
        examples.filter((item) => item.label === label).length
      ])
    );
    bestCorrect += Math.max(...Object.values(counts));
    if (Object.values(counts).some((count) => count === 0)) {
      oppositeLabelsEverywhere = false;
    }
  }
  return deepFreeze({
    groups: groups.size,
    examples: dataset.examples.length,
    bestCorrect,
    ceiling: bestCorrect / dataset.examples.length,
    oppositeLabelsEverywhere
  });
}

function exp0018StructuralControls(dataset) {
  const normalizedContext = (example) =>
    `assistant:${normalizeExp0018Text(
      example.modelInput.assistantAudiblePrefixAtDecision
    )}|inbound:${example.modelInput.recentInbound
      .map(normalizeExp0018Text).join("|")}`;
  return deepFreeze({
    targetOnly: marginalControl(
      dataset,
      (item) => normalizeExp0018Text(item.modelInput.targetText)
    ),
    contextOnlyC0: marginalControl(dataset, normalizedContext),
    pairRootMetadataOnly: marginalControl(dataset, (item) => item.pairRootId),
    crossBlockMetadataOnly: marginalControl(
      dataset,
      (item) => item.crossBlockRootId
    ),
    familyMetadataOnly: marginalControl(dataset, (item) => item.family)
  });
}

export function evaluateExp0018DevelopmentGates(input = {}) {
  const marginalCeiling =
    input.config.gates.targetAndContextMarginalCeiling;
  return deepFreeze({
    pairIntegrity: input.datasetValid === true,
    b0PairInputAndPredictionIdentity: input.b0Identity === true,
    targetContextAndMetadataMarginalCeiling:
      Object.values(input.structuralControls ?? {}).length === 5 &&
      Object.values(input.structuralControls).every((control) =>
        control.ceiling === marginalCeiling &&
        control.oppositeLabelsEverywhere === true
      ),
    b1DirectedRecall:
      input.summaries.B1.classRecall[EXP0018_DIRECTED] ===
        input.config.gates.b1DirectedRecall,
    b1BackgroundRecall:
      input.summaries.B1.classRecall[EXP0018_BACKGROUND] >=
        input.config.gates.minimumB1BackgroundRecall,
    completePairShare:
      input.paired.B1CompletePairShare >=
        input.config.gates.minimumCompletePairShare,
    netPairWinsOverB0:
      input.paired.netWins >= input.config.gates.minimumNetPairWinsOverB0,
    positiveCrossBlocks:
      input.crossBlocks.positiveBlocks >=
        input.config.gates.minimumPositiveCrossBlocks,
    familyBreadth:
      input.crossBlocks.familiesWithPositiveBlock >=
        input.config.gates.minimumFamiliesWithPositiveCrossBlock,
    localContextDeltaP95:
      input.checkpoint.latency.deltaB1MinusB0.p95Ms <=
        input.config.gates.maximumLocalContextDeltaP95Ms,
    deterministicWeightsAndPredictions:
      input.checkpoint.reproducibility.repeatedFitsEqual === true &&
      input.checkpoint.reproducibility
        .repeatedCalibrationPredictionsEqual === true &&
      input.checkpoint.reproducibility
        .repeatedCalibrationSelectionsEqual === true,
    authorityIsZero:
      input.checkpoint.authority.canProduceEffects === false &&
      input.config.authority.canProduceEffects === false
  });
}

function validateDevelopmentReportInput(input) {
  assertConfig(input.config);
  const checkpointValidation = validateExp0018Checkpoint(input.checkpoint);
  assert(checkpointValidation.valid,
    `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`);
  const datasetValidation = validateExp0018Dataset(input.developmentDataset);
  assert(datasetValidation.valid,
    `development dataset inválido: ${datasetValidation.errors.join("; ")}`);
  assert(input.developmentDataset.role === "development",
    "evaluator aceita somente role=development");
  for (const [name, value] of Object.entries({
    prefitFreezeSha256: input.prefitFreezeSha256,
    developmentActivationFileSha256:
      input.developmentActivationFileSha256,
    developmentActivationSha256: input.developmentActivationSha256,
    developmentOpeningFileSha256: input.developmentOpeningFileSha256,
    developmentOpeningSha256: input.developmentOpeningSha256,
    developmentAttemptFileSha256: input.developmentAttemptFileSha256,
    developmentAttemptSha256: input.developmentAttemptSha256,
    configFileSha256: input.configFileSha256,
    developmentDatasetFileSha256: input.developmentDatasetFileSha256
  })) {
    assert(validSha256(value), `${name} é obrigatório`);
  }
  assert(validCommit(input.developmentExecutionCommit),
    "developmentExecutionCommit é obrigatório");
  return datasetValidation;
}

function assembleExp0018DevelopmentReport(
  input,
  predictions,
  datasetValidation
) {
  const { D0, B0, B1 } = predictions;
  const summaries = {
    D0: summarizeExp0018Observations(D0),
    B0: summarizeExp0018Observations(B0),
    B1: summarizeExp0018Observations(B1)
  };
  const paired = pairedComparison(B0, B1);
  const crossBlocks = crossBlockComparison(B0, B1);
  const b0Identity = b0PairIdentity(input.developmentDataset, B0);
  const structuralControls = exp0018StructuralControls(
    input.developmentDataset
  );
  const gates = evaluateExp0018DevelopmentGates({
    config: input.config,
    datasetValid: datasetValidation.valid,
    b0Identity,
    summaries,
    paired,
    crossBlocks,
    structuralControls,
    checkpoint: input.checkpoint
  });
  const passed = Object.values(gates).every(Boolean);
  const core = {
    schemaVersion: EXP0018_DEVELOPMENT_REPORT_VERSION,
    experimentId: "EXP-0018",
    status: passed ? "passed-textual-mechanism-screen" :
      "cut-textual-mechanism-screen",
    decision: passed ? "PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN" :
      "CUT_CONTEXT_MATCHER_IN_THIS_DESIGN",
    bindings: {
      prefitFreezeSha256: input.prefitFreezeSha256,
      developmentActivationFileSha256:
        input.developmentActivationFileSha256,
      developmentActivationSha256: input.developmentActivationSha256,
      developmentOpeningFileSha256: input.developmentOpeningFileSha256,
      developmentOpeningSha256: input.developmentOpeningSha256,
      developmentAttemptFileSha256: input.developmentAttemptFileSha256,
      developmentAttemptSha256: input.developmentAttemptSha256,
      checkpointSha256: input.checkpoint.checkpointSha256,
      configFileSha256: input.configFileSha256,
      configCanonicalSha256: EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
      developmentDatasetFileSha256: input.developmentDatasetFileSha256,
      developmentDatasetCanonicalSha256:
        input.developmentDataset.datasetSha256,
      developmentExecutionCommit: input.developmentExecutionCommit
    },
    protocol: {
      developmentOpeningsUsed: 1,
      developmentAttemptsUsed: 1,
      predictionRuns: 1,
      repeatedDevelopmentPredictionRunPerformed: false,
      confirmatoryClaimAllowed: false,
      holdoutOpenings: 0
    },
    filesystemBoundary: structuredClone(input.filesystemBoundary),
    summaries,
    paired,
    crossBlocks,
    structuralControls,
    latency: input.checkpoint.latency,
    gates,
    allGatesPassed: passed,
    predictions,
    authority: { mode: "offline-shadow-only", canProduceEffects: false },
    claim: passed ? input.config.maximumClaim : null,
    limitations: [...input.config.excludedClaims]
  };
  return deepFreeze({
    ...core,
    developmentReportSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function createExp0018DevelopmentReport(input = {}) {
  const datasetValidation = validateDevelopmentReportInput(input);
  const predict = input.predict ?? predictExp0018Checkpoint;
  const B0 = input.developmentDataset.examples.map((example) =>
    predict(input.checkpoint, example, "B0")
  ).toSorted((left, right) => left.exampleId.localeCompare(right.exampleId));
  const B1 = input.developmentDataset.examples.map((example) =>
    predict(input.checkpoint, example, "B1")
  ).toSorted((left, right) => left.exampleId.localeCompare(right.exampleId));
  const D0 = input.developmentDataset.examples.map((example) =>
    deterministicObservation(example, EXP0018_DIRECTED)
  ).toSorted((left, right) => left.exampleId.localeCompare(right.exampleId));
  return assembleExp0018DevelopmentReport(
    input,
    deepFreeze({ D0, B0, B1 }),
    datasetValidation
  );
}

function validateStoredDevelopmentPredictions(report, input) {
  const predictions = report?.predictions;
  if (
    !predictions ||
    !same(Object.keys(predictions).sort(), ["B0", "B1", "D0"])
  ) {
    return false;
  }
  const examples = [...input.developmentDataset.examples]
    .sort((left, right) => left.exampleId.localeCompare(right.exampleId));
  if ([predictions.D0, predictions.B0, predictions.B1].some((items) =>
    !Array.isArray(items) || items.length !== examples.length
  )) {
    return false;
  }
  const armKeys = [
    "backgroundProbability",
    "crossBlockRootId",
    "exampleId",
    "expected",
    "family",
    "featureValues",
    "pairRootId",
    "predicted",
    "rawPredicted"
  ];
  for (let index = 0; index < examples.length; index += 1) {
    const example = examples[index];
    if (!isDeepStrictEqual(
      predictions.D0[index],
      deterministicObservation(example, EXP0018_DIRECTED)
    )) {
      return false;
    }
    for (const name of ["B0", "B1"]) {
      const observation = predictions[name][index];
      const arm = input.checkpoint.arms[name];
      const expectedFeatureValues = featureValues(
        example,
        arm.contextEnabled
      );
      const expectedBackgroundProbability = backgroundProbabilityFromTrace(
        arm.model,
        expectedFeatureValues
      );
      const expectedMetadata = {
        exampleId: example.exampleId,
        pairRootId: example.pairRootId,
        crossBlockRootId: example.crossBlockRootId,
        family: example.family,
        expected: example.label
      };
      if (
        !same(Object.keys(observation ?? {}).sort(), armKeys) ||
        Object.entries(expectedMetadata).some(
          ([key, value]) => observation?.[key] !== value
        ) ||
        !isDeepStrictEqual(
          observation?.featureValues,
          expectedFeatureValues
        ) ||
        !validRate(observation?.backgroundProbability) ||
        observation.backgroundProbability !==
          expectedBackgroundProbability ||
        observation?.rawPredicted !== (
          observation.backgroundProbability >= 0.5
            ? EXP0018_BACKGROUND
            : EXP0018_DIRECTED
        ) ||
        observation?.predicted !== (
          observation.backgroundProbability >= arm.threshold
            ? EXP0018_BACKGROUND
            : EXP0018_DIRECTED
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

export function validateExp0018DevelopmentReport(report, expected = null) {
  const errors = [];
  if (
    report?.schemaVersion !== EXP0018_DEVELOPMENT_REPORT_VERSION ||
    report?.experimentId !== "EXP-0018"
  ) {
    errors.push("identidade do report incompatível");
  }
  if (
    report?.developmentReportSha256 !==
      `sha256:${canonicalSha256(withoutHash(
        report,
        "developmentReportSha256"
      ))}`
  ) {
    errors.push("developmentReportSha256 divergente");
  }
  const bindingKeys = [
    "prefitFreezeSha256",
    "developmentActivationFileSha256",
    "developmentActivationSha256",
    "developmentOpeningFileSha256",
    "developmentOpeningSha256",
    "developmentAttemptFileSha256",
    "developmentAttemptSha256",
    "checkpointSha256",
    "configFileSha256",
    "developmentDatasetFileSha256",
    "developmentDatasetCanonicalSha256"
  ];
  if (
    bindingKeys.some((key) => !validSha256(report?.bindings?.[key])) ||
    !validCommit(report?.bindings?.developmentExecutionCommit) ||
    report?.bindings?.configCanonicalSha256 !==
      EXP0018_PREFIT_CONFIG_CANONICAL_SHA256
  ) {
    errors.push("bindings do report incompatíveis");
  }
  const gateKeys = [
    "authorityIsZero",
    "b0PairInputAndPredictionIdentity",
    "b1BackgroundRecall",
    "b1DirectedRecall",
    "completePairShare",
    "deterministicWeightsAndPredictions",
    "familyBreadth",
    "localContextDeltaP95",
    "netPairWinsOverB0",
    "pairIntegrity",
    "positiveCrossBlocks",
    "targetContextAndMetadataMarginalCeiling"
  ];
  const gatesExact = same(Object.keys(report?.gates ?? {}).sort(), gateKeys) &&
    Object.values(report?.gates ?? {}).every(
      (value) => typeof value === "boolean"
    );
  const allGatesPassed = gatesExact &&
    Object.values(report.gates).every((value) => value === true);
  if (
    report?.allGatesPassed !== allGatesPassed ||
    report?.status !== (allGatesPassed ?
      "passed-textual-mechanism-screen" : "cut-textual-mechanism-screen") ||
    report?.decision !== (allGatesPassed ?
      "PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN" :
      "CUT_CONTEXT_MATCHER_IN_THIS_DESIGN") ||
    report?.protocol?.developmentOpeningsUsed !== 1 ||
    report?.protocol?.developmentAttemptsUsed !== 1 ||
    report?.protocol?.predictionRuns !== 1 ||
    report?.protocol?.repeatedDevelopmentPredictionRunPerformed !== false ||
    report?.protocol?.confirmatoryClaimAllowed !== false ||
    report?.authority?.canProduceEffects !== false ||
    report?.claim !== (allGatesPassed ? report?.claim : null) ||
    (allGatesPassed && typeof report?.claim !== "string")
  ) {
    errors.push("decisão, protocolo ou autoridade do report incompatível");
  }
  if (!validFilesystemBoundary(
    report?.filesystemBoundary,
    "development",
    report?.bindings?.developmentExecutionCommit
  )) {
    errors.push("fronteira física de development incompatível");
  }
  if (expected === null) {
    errors.push("recomputação autoritativa é obrigatória para validar o report");
  } else {
    try {
      const datasetValidation = validateDevelopmentReportInput(expected);
      if (!validateStoredDevelopmentPredictions(report, expected)) {
        throw new Error("trace de predição armazenado é incompatível");
      }
      const authoritative = assembleExp0018DevelopmentReport(
        expected,
        report.predictions,
        datasetValidation
      );
      if (!isDeepStrictEqual(report, authoritative)) {
        errors.push("report diverge da recomputação autoritativa");
      }
    } catch (error) {
      errors.push(`recomputação autoritativa falhou: ${error.message}`);
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function createExp0018DevelopmentInvalidation(input = {}) {
  assertConfig(input.config);
  for (const [name, value] of Object.entries({
    prefitFreezeSha256: input.prefitFreezeSha256,
    developmentActivationFileSha256:
      input.developmentActivationFileSha256,
    developmentActivationSha256: input.developmentActivationSha256,
    developmentOpeningFileSha256: input.developmentOpeningFileSha256,
    developmentOpeningSha256: input.developmentOpeningSha256,
    developmentAttemptFileSha256: input.developmentAttemptFileSha256,
    developmentAttemptSha256: input.developmentAttemptSha256,
    checkpointSha256: input.checkpointSha256,
    configFileSha256: input.configFileSha256,
    developmentDatasetFileSha256: input.developmentDatasetFileSha256,
    developmentDatasetCanonicalSha256:
      input.developmentDatasetCanonicalSha256
  })) {
    assert(validSha256(value), `${name} é obrigatório`);
  }
  assert(validCommit(input.invalidationExecutionCommit),
    "invalidationExecutionCommit é obrigatório");
  const core = {
    schemaVersion: EXP0018_DEVELOPMENT_INVALIDATION_VERSION,
    experimentId: "EXP-0018",
    status: "invalidated-development-attempt",
    decision: "INVALIDATED_SINGLE_DEVELOPMENT_ATTEMPT",
    bindings: {
      prefitFreezeSha256: input.prefitFreezeSha256,
      developmentActivationFileSha256:
        input.developmentActivationFileSha256,
      developmentActivationSha256: input.developmentActivationSha256,
      developmentOpeningFileSha256: input.developmentOpeningFileSha256,
      developmentOpeningSha256: input.developmentOpeningSha256,
      developmentAttemptFileSha256: input.developmentAttemptFileSha256,
      developmentAttemptSha256: input.developmentAttemptSha256,
      checkpointSha256: input.checkpointSha256,
      configFileSha256: input.configFileSha256,
      configCanonicalSha256: EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
      developmentDatasetFileSha256: input.developmentDatasetFileSha256,
      developmentDatasetCanonicalSha256:
        input.developmentDatasetCanonicalSha256,
      invalidationExecutionCommit: input.invalidationExecutionCommit
    },
    protocol: {
      developmentOpeningsUsed: 1,
      developmentAttemptsUsed: 1,
      canonicalPredictionReportProduced: false,
      qualityOutcomeAvailable: false,
      retryAuthorized: false,
      confirmatoryClaimAllowed: false,
      developmentDatasetReadByInvalidator: false,
      attemptMayHavePartiallyExecuted: true
    },
    filesystemBoundary: structuredClone(input.filesystemBoundary),
    allGatesPassed: null,
    gates: null,
    authority: { mode: "offline-shadow-only", canProduceEffects: false },
    claim: null,
    limitations: [
      "A tentativa única terminou sem relatório canônico de predições.",
      "Nenhuma conclusão de qualidade, passe ou corte do mecanismo é permitida.",
      "Qualquer nova abertura exige um novo experimento pré-registrado."
    ]
  };
  return deepFreeze({
    ...core,
    developmentInvalidationSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0018DevelopmentInvalidation(
  invalidation,
  expected = null
) {
  const errors = [];
  if (
    invalidation?.schemaVersion !==
      EXP0018_DEVELOPMENT_INVALIDATION_VERSION ||
    invalidation?.experimentId !== "EXP-0018" ||
    invalidation?.status !== "invalidated-development-attempt" ||
    invalidation?.decision !== "INVALIDATED_SINGLE_DEVELOPMENT_ATTEMPT" ||
    invalidation?.developmentInvalidationSha256 !==
      `sha256:${canonicalSha256(withoutHash(
        invalidation,
        "developmentInvalidationSha256"
      ))}`
  ) {
    errors.push("identidade ou hash da invalidação incompatível");
  }
  const shaBindings = [
    "prefitFreezeSha256",
    "developmentActivationFileSha256",
    "developmentActivationSha256",
    "developmentOpeningFileSha256",
    "developmentOpeningSha256",
    "developmentAttemptFileSha256",
    "developmentAttemptSha256",
    "checkpointSha256",
    "configFileSha256",
    "developmentDatasetFileSha256",
    "developmentDatasetCanonicalSha256"
  ];
  if (
    shaBindings.some((key) =>
      !validSha256(invalidation?.bindings?.[key])
    ) ||
    invalidation?.bindings?.configCanonicalSha256 !==
      EXP0018_PREFIT_CONFIG_CANONICAL_SHA256 ||
    !validCommit(invalidation?.bindings?.invalidationExecutionCommit)
  ) {
    errors.push("bindings da invalidação incompatíveis");
  }
  if (
    invalidation?.protocol?.developmentOpeningsUsed !== 1 ||
    invalidation?.protocol?.developmentAttemptsUsed !== 1 ||
    invalidation?.protocol?.canonicalPredictionReportProduced !== false ||
    invalidation?.protocol?.qualityOutcomeAvailable !== false ||
    invalidation?.protocol?.retryAuthorized !== false ||
    invalidation?.protocol?.confirmatoryClaimAllowed !== false ||
    invalidation?.protocol?.developmentDatasetReadByInvalidator !== false ||
    invalidation?.protocol?.attemptMayHavePartiallyExecuted !== true ||
    invalidation?.allGatesPassed !== null ||
    invalidation?.gates !== null ||
    invalidation?.claim !== null ||
    invalidation?.authority?.canProduceEffects !== false ||
    !validFilesystemBoundary(
      invalidation?.filesystemBoundary,
      "invalidation",
      invalidation?.bindings?.invalidationExecutionCommit
    )
  ) {
    errors.push("protocolo, fronteira ou claim da invalidação incompatível");
  }
  if (expected !== null) {
    try {
      const authoritative = createExp0018DevelopmentInvalidation(expected);
      if (!isDeepStrictEqual(invalidation, authoritative)) {
        errors.push("invalidação diverge da recomputação autoritativa");
      }
    } catch (error) {
      errors.push(`recomputação da invalidação falhou: ${error.message}`);
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}
