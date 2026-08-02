import {
  predictSoftmaxClassifier
} from "../learning/softmax-classifier.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0017_SEMANTIC_PROBE_VERSION =
  "exp-0017-semantic-probe-v1";
export const EXP0017_SEMANTIC_OBSERVATION_VERSION =
  "exp-0017-semantic-observation-v1";
export const EXP0017_SEMANTIC_CHECKPOINT_VERSION =
  "exp-0017-semantic-checkpoint-v1";
export const EXP0017_SEMANTIC_HASH_DIMENSION = 64;

export const EXP0017_SEMANTIC_CLASSES = Object.freeze([
  "BACKGROUND_OR_NOT_DIRECTED",
  "DIRECTED_TO_ASSISTANT"
]);

const BASE_FEATURE_NAMES = Object.freeze([
  "bias",
  "aRefBackgroundProbability",
  "aRefBackgroundSignal",
  "textPresent",
  "textLength",
  "assistantSpeaking",
  "assistantHeld"
]);

export const EXP0017_SEMANTIC_FEATURE_NAMES = Object.freeze([
  ...BASE_FEATURE_NAMES,
  ...Array.from(
    { length: EXP0017_SEMANTIC_HASH_DIMENSION },
    (_, index) => `charNgramHash${String(index).padStart(2, "0")}`
  )
]);

const CLASS_SET = new Set(EXP0017_SEMANTIC_CLASSES);
const TEXT_SOURCES = new Set(["asr-partial", "oracle-prefix"]);
const A_REF_ACTIONS = new Set([
  "CONTINUE_OUTPUT",
  "DEFER_TO_DETERMINISTIC"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validClassifier(classifier) {
  return (
    classifier?.algorithm ===
      "full-batch-multinomial-logistic-regression-v1" &&
    sameArray(classifier?.classNames, EXP0017_SEMANTIC_CLASSES) &&
    classifier?.featureCount === EXP0017_SEMANTIC_FEATURE_NAMES.length &&
    Array.isArray(classifier?.weights) &&
    classifier.weights.length === EXP0017_SEMANTIC_CLASSES.length &&
    classifier.weights.every(
      (row) =>
        Array.isArray(row) &&
        row.length === EXP0017_SEMANTIC_FEATURE_NAMES.length &&
        row.every(Number.isFinite)
    )
  );
}

export function normalizeExp0017SemanticText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashExp0017SemanticNgram(ngram) {
  const normalized = String(ngram);
  if (normalized.length === 0) {
    throw new TypeError("ngram precisa ser não vazio");
  }
  const hash = fnv1a32(normalized);
  return Object.freeze({
    hash,
    index: hash % EXP0017_SEMANTIC_HASH_DIMENSION,
    sign: (hash & 0x8000_0000) === 0 ? 1 : -1
  });
}

function hashedCharacterNgrams(text) {
  const bins = Array(EXP0017_SEMANTIC_HASH_DIMENSION).fill(0);
  if (!text) {
    return bins;
  }
  const bounded = `^${text}$`;
  let count = 0;
  for (let size = 3; size <= 5; size += 1) {
    for (let start = 0; start + size <= bounded.length; start += 1) {
      const { index, sign } = hashExp0017SemanticNgram(
        bounded.slice(start, start + size)
      );
      bins[index] += sign;
      count += 1;
    }
  }
  if (count === 0) {
    return bins;
  }
  return bins.map((value) => value / count);
}

function validateARef(aRef, errors) {
  if (!aRef || typeof aRef !== "object" || Array.isArray(aRef)) {
    errors.push("aRef ausente ou inválida");
    return;
  }
  if (
    aRef.authority !== false ||
    !CLASS_SET.has(aRef.rawLabel) ||
    !CLASS_SET.has(aRef.operationalLabel) ||
    !A_REF_ACTIONS.has(aRef.suggestedAction) ||
    !finiteProbability(
      aRef.probabilities?.BACKGROUND_OR_NOT_DIRECTED
    ) ||
    !finiteProbability(aRef.probabilities?.DIRECTED_TO_ASSISTANT)
  ) {
    errors.push("aRef rompe classe, probabilidade, ação ou autoridade");
    return;
  }
  const probabilityTotal =
    aRef.probabilities.BACKGROUND_OR_NOT_DIRECTED +
    aRef.probabilities.DIRECTED_TO_ASSISTANT;
  if (Math.abs(probabilityTotal - 1) > 1e-9) {
    errors.push("probabilidades de aRef não somam 1");
  }
}

export function validateExp0017SemanticObservation(observation) {
  const errors = [];
  if (
    observation?.schemaVersion !== EXP0017_SEMANTIC_OBSERVATION_VERSION
  ) {
    errors.push("schemaVersion de observação incompatível");
  }
  if (
    typeof observation?.observationId !== "string" ||
    observation.observationId.length === 0
  ) {
    errors.push("observationId ausente");
  }

  const window = observation?.causalWindow;
  if (
    window?.sampleRate !== 16_000 ||
    !Number.isSafeInteger(window?.onsetSample) ||
    window.onsetSample < 0 ||
    !Number.isSafeInteger(window?.decisionSample) ||
    window.decisionSample <= window.onsetSample ||
    window.futureSamplesUsed !== 0
  ) {
    errors.push("janela causal inválida ou com amostras futuras");
  }

  const assistant = observation?.assistant;
  if (
    typeof assistant?.speaking !== "boolean" ||
    typeof assistant?.held !== "boolean"
  ) {
    errors.push("estado do assistente inválido");
  }

  const text = observation?.text;
  if (text !== null && text !== undefined) {
    if (
      typeof text !== "object" ||
      Array.isArray(text) ||
      typeof text.value !== "string" ||
      text.value.length > 2_000 ||
      !TEXT_SOURCES.has(text.source) ||
      !Number.isSafeInteger(text.audioEndSample) ||
      text.audioEndSample < (window?.onsetSample ?? 0) ||
      text.audioEndSample > (window?.decisionSample ?? -1)
    ) {
      errors.push("prefixo textual inválido ou posterior à decisão");
    }
  }

  validateARef(observation?.aRef, errors);
  return deepFreeze({ valid: errors.length === 0, errors });
}

function assertValidObservation(observation) {
  const validation = validateExp0017SemanticObservation(observation);
  if (!validation.valid) {
    throw new TypeError(
      `observação semântica inválida: ${validation.errors.join("; ")}`
    );
  }
}

export function extractExp0017SemanticFeatures(observation) {
  assertValidObservation(observation);
  const normalizedText = normalizeExp0017SemanticText(
    observation.text?.value
  );
  const textPresent = normalizedText.length > 0;
  const aRefBackgroundProbability =
    observation.aRef.probabilities.BACKGROUND_OR_NOT_DIRECTED;
  const values = [
    1,
    aRefBackgroundProbability,
    observation.aRef.operationalLabel ===
      "BACKGROUND_OR_NOT_DIRECTED" ? 1 : 0,
    textPresent ? 1 : 0,
    clamp([...normalizedText].length / 120),
    observation.assistant.speaking ? 1 : 0,
    observation.assistant.held ? 1 : 0,
    ...hashedCharacterNgrams(normalizedText)
  ];
  if (
    values.length !== EXP0017_SEMANTIC_FEATURE_NAMES.length ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("extrator semântico produziu features inválidas");
  }
  return deepFreeze({
    schemaVersion: 1,
    featureVersion: EXP0017_SEMANTIC_PROBE_VERSION,
    names: [...EXP0017_SEMANTIC_FEATURE_NAMES],
    values,
    normalizedText,
    window: {
      onsetSample: observation.causalWindow.onsetSample,
      decisionSample: observation.causalWindow.decisionSample,
      textAudioEndSample: observation.text?.audioEndSample ?? null,
      sampleRate: observation.causalWindow.sampleRate,
      futureSamplesUsed: 0
    }
  });
}

export function createExp0017SemanticCheckpoint(input = {}) {
  if (!validClassifier(input.classifier)) {
    throw new TypeError("classificador semântico incompatível");
  }
  const backgroundVetoConfidence =
    input.backgroundVetoConfidence ?? 0.8;
  if (
    !Number.isFinite(backgroundVetoConfidence) ||
    backgroundVetoConfidence < 0.5 ||
    backgroundVetoConfidence > 1
  ) {
    throw new TypeError("backgroundVetoConfidence inválido");
  }
  const classifier = structuredClone(input.classifier);
  return deepFreeze({
    schemaVersion: EXP0017_SEMANTIC_CHECKPOINT_VERSION,
    checkpointId: String(input.checkpointId ?? "exp-0017-semantic-probe"),
    featureVersion: EXP0017_SEMANTIC_PROBE_VERSION,
    featureNames: [...EXP0017_SEMANTIC_FEATURE_NAMES],
    hashDimension: EXP0017_SEMANTIC_HASH_DIMENSION,
    classes: [...EXP0017_SEMANTIC_CLASSES],
    classifier,
    classifierSha256: `sha256:${canonicalSha256(classifier)}`,
    decision: {
      backgroundVetoConfidence,
      backgroundAction: "CONTINUE_OUTPUT",
      lowConfidenceAction: "DEFER_TO_DETERMINISTIC"
    },
    authority: { mode: "shadow", canProduceEffects: false }
  });
}

export function validateExp0017SemanticCheckpoint(checkpoint) {
  const errors = [];
  if (checkpoint?.schemaVersion !== EXP0017_SEMANTIC_CHECKPOINT_VERSION) {
    errors.push("schemaVersion de checkpoint incompatível");
  }
  if (
    checkpoint?.featureVersion !== EXP0017_SEMANTIC_PROBE_VERSION ||
    !sameArray(checkpoint?.featureNames, EXP0017_SEMANTIC_FEATURE_NAMES) ||
    checkpoint?.hashDimension !== EXP0017_SEMANTIC_HASH_DIMENSION ||
    !sameArray(checkpoint?.classes, EXP0017_SEMANTIC_CLASSES)
  ) {
    errors.push("contrato de features do checkpoint incompatível");
  }
  if (!validClassifier(checkpoint?.classifier)) {
    errors.push("classificador do checkpoint incompatível");
  } else if (
    checkpoint.classifierSha256 !==
      `sha256:${canonicalSha256(checkpoint.classifier)}`
  ) {
    errors.push("hash do classificador divergente");
  }
  const threshold = checkpoint?.decision?.backgroundVetoConfidence;
  if (
    !Number.isFinite(threshold) ||
    threshold < 0.5 ||
    threshold > 1 ||
    checkpoint?.decision?.backgroundAction !== "CONTINUE_OUTPUT" ||
    checkpoint?.decision?.lowConfidenceAction !==
      "DEFER_TO_DETERMINISTIC"
  ) {
    errors.push("regra operacional do checkpoint incompatível");
  }
  if (
    checkpoint?.authority?.mode !== "shadow" ||
    checkpoint?.authority?.canProduceEffects !== false
  ) {
    errors.push("checkpoint semântico precisa permanecer sem autoridade");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

function measuredLatency(now, operation) {
  const startedAtMs = now();
  const value = operation();
  const endedAtMs = now();
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(endedAtMs) ||
    endedAtMs < startedAtMs
  ) {
    throw new TypeError("relógio local de inferência inválido");
  }
  return { latencyMs: endedAtMs - startedAtMs, value };
}

export function runExp0017SemanticProbe(input = {}) {
  const observation = input.observation;
  assertValidObservation(observation);
  const now = input.now ?? (() => performance.now());
  const normalizedText = normalizeExp0017SemanticText(
    observation.text?.value
  );

  if (!normalizedText) {
    const measured = measuredLatency(now, () => observation.aRef);
    return Object.freeze({
      schemaVersion: 1,
      probeVersion: EXP0017_SEMANTIC_PROBE_VERSION,
      mode: "a-ref-fallback",
      usedSemanticText: false,
      prediction: measured.value,
      features: null,
      latencyMs: measured.latencyMs,
      futureSamplesUsed: 0,
      authority: false
    });
  }

  const checkpointValidation = validateExp0017SemanticCheckpoint(
    input.checkpoint
  );
  if (!checkpointValidation.valid) {
    throw new TypeError(
      `checkpoint semântico inválido: ` +
        checkpointValidation.errors.join("; ")
    );
  }
  const measured = measuredLatency(now, () => {
    const features = extractExp0017SemanticFeatures(observation);
    const prediction = predictSoftmaxClassifier(
      input.checkpoint.classifier,
      features.values
    );
    return { features, prediction };
  });
  const backgroundProbability =
    measured.value.prediction.probabilities.BACKGROUND_OR_NOT_DIRECTED;
  const backgroundConfident =
    backgroundProbability >=
      input.checkpoint.decision.backgroundVetoConfidence;
  const prediction = deepFreeze({
    rawLabel: measured.value.prediction.label,
    operationalLabel: backgroundConfident
      ? "BACKGROUND_OR_NOT_DIRECTED"
      : "DIRECTED_TO_ASSISTANT",
    suggestedAction: backgroundConfident
      ? input.checkpoint.decision.backgroundAction
      : input.checkpoint.decision.lowConfidenceAction,
    probabilities: measured.value.prediction.probabilities,
    threshold: input.checkpoint.decision.backgroundVetoConfidence,
    authority: false
  });
  return Object.freeze({
    schemaVersion: 1,
    probeVersion: EXP0017_SEMANTIC_PROBE_VERSION,
    mode: "semantic-shadow",
    usedSemanticText: true,
    prediction,
    features: measured.value.features,
    latencyMs: measured.latencyMs,
    futureSamplesUsed: measured.value.features.window.futureSamplesUsed,
    authority: false
  });
}
