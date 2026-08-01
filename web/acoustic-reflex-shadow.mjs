export const ACOUSTIC_REFLEX_SHADOW_VERSION =
  "acoustic-reflex-shadow-v0.1";

export const ACOUSTIC_REFLEX_CLASSES = Object.freeze([
  "WAIT_FOR_EVIDENCE",
  "PAUSE_OUTPUT",
  "CONTINUE_OUTPUT"
]);

export const ACOUSTIC_REFLEX_FEATURES = Object.freeze([
  "bias",
  "eventStarted",
  "eventWindow",
  "eventPaused",
  "probability",
  "previousObservedWindows",
  "previousSupportingWindows",
  "currentSupports",
  "previousArmed"
]);

const SUPPORTED_EVENTS = new Set([
  "USER_SPEECH_STARTED",
  "VAD_CONTROL_WINDOW",
  "USER_SPEECH_PAUSED"
]);

function finiteProbability(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new TypeError(`${label} precisa estar no intervalo [0, 1]`);
  }
  return number;
}

function boundedCount(value, maximum, label) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${label} precisa ser inteiro não negativo`);
  }
  return Math.min(number, maximum) / maximum;
}

function softmax(logits) {
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

export function acousticReflexTeacherLabel(previousState, event, transition) {
  const intentTypes = new Set(
    (transition?.intents ?? []).map((intent) => intent.type)
  );
  for (const label of ACOUSTIC_REFLEX_CLASSES) {
    if (intentTypes.has(label)) {
      return label;
    }
  }
  if (
    previousState?.status === "armed" &&
    event?.type === "VAD_CONTROL_WINDOW" &&
    transition?.reason === "collecting-evidence"
  ) {
    return "WAIT_FOR_EVIDENCE";
  }
  return null;
}

export function isAcousticReflexDecisionPoint(previousState, event) {
  if (!SUPPORTED_EVENTS.has(event?.type)) {
    return false;
  }
  if (event.type === "USER_SPEECH_STARTED") {
    return (
      event.assistantAudible === true &&
      event.detector === "silero-vad-v6.2" &&
      Number.isFinite(event.probability) &&
      Number.isSafeInteger(event.triggerSampleStart)
    );
  }
  return previousState?.status === "armed";
}

export function extractAcousticReflexFeatures(previousState, event) {
  if (!isAcousticReflexDecisionPoint(previousState, event)) {
    throw new TypeError("evento não é um ponto de decisão acústica");
  }
  const probability = event.probability === null ||
    event.probability === undefined
    ? 0
    : finiteProbability(event.probability, "event.probability");
  const supportProbability = finiteProbability(
    previousState?.config?.supportProbability ?? 0.75,
    "supportProbability"
  );
  const values = [
    1,
    event.type === "USER_SPEECH_STARTED" ? 1 : 0,
    event.type === "VAD_CONTROL_WINDOW" ? 1 : 0,
    event.type === "USER_SPEECH_PAUSED" ? 1 : 0,
    probability,
    boundedCount(
      previousState?.observedWindows,
      4,
      "previousObservedWindows"
    ),
    boundedCount(
      previousState?.supportingWindows,
      2,
      "previousSupportingWindows"
    ),
    event.type === "VAD_CONTROL_WINDOW" &&
      probability >= supportProbability
      ? 1
      : 0,
    previousState?.status === "armed" ? 1 : 0
  ];
  return Object.freeze({
    schemaVersion: 1,
    featureVersion: ACOUSTIC_REFLEX_SHADOW_VERSION,
    names: ACOUSTIC_REFLEX_FEATURES,
    values: Object.freeze(values)
  });
}

export function validateAcousticReflexCheckpoint(checkpoint) {
  const errors = [];
  if (checkpoint?.schemaVersion !== "acoustic-reflex-checkpoint-v1") {
    errors.push("schemaVersion incompatível");
  }
  if (checkpoint?.featureVersion !== ACOUSTIC_REFLEX_SHADOW_VERSION) {
    errors.push("featureVersion incompatível");
  }
  if (
    JSON.stringify(checkpoint?.featureNames) !==
    JSON.stringify(ACOUSTIC_REFLEX_FEATURES)
  ) {
    errors.push("featureNames incompatíveis");
  }
  if (
    JSON.stringify(checkpoint?.classes) !==
    JSON.stringify(ACOUSTIC_REFLEX_CLASSES)
  ) {
    errors.push("classes incompatíveis");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(checkpoint?.modelSha256 ?? "")) {
    errors.push("modelSha256 inválido");
  }
  const weights = checkpoint?.model?.weights;
  if (
    !Array.isArray(weights) ||
    weights.length !== ACOUSTIC_REFLEX_CLASSES.length ||
    weights.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== ACOUSTIC_REFLEX_FEATURES.length ||
        row.some((value) => !Number.isFinite(value))
    )
  ) {
    errors.push("matriz de pesos incompatível");
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

export function predictAcousticReflex(checkpoint, previousState, event) {
  const validation = validateAcousticReflexCheckpoint(checkpoint);
  if (!validation.valid) {
    throw new TypeError(
      `checkpoint acústico inválido: ${validation.errors.join("; ")}`
    );
  }
  const features = extractAcousticReflexFeatures(previousState, event);
  const logits = checkpoint.model.weights.map((row) =>
    row.reduce(
      (sum, weight, index) => sum + weight * features.values[index],
      0
    )
  );
  const probabilities = softmax(logits);
  let winningIndex = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[winningIndex]) {
      winningIndex = index;
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    shadowVersion: ACOUSTIC_REFLEX_SHADOW_VERSION,
    checkpointId: checkpoint.checkpointId,
    modelSha256: checkpoint.modelSha256,
    proposal: ACOUSTIC_REFLEX_CLASSES[winningIndex],
    probabilities: Object.freeze(Object.fromEntries(
      ACOUSTIC_REFLEX_CLASSES.map((label, index) => [
        label,
        probabilities[index]
      ])
    )),
    features
  });
}

export class AcousticReflexShadow {
  #checkpoint;

  constructor(checkpoint) {
    const validation = validateAcousticReflexCheckpoint(checkpoint);
    if (!validation.valid) {
      throw new TypeError(
        `checkpoint acústico inválido: ${validation.errors.join("; ")}`
      );
    }
    this.#checkpoint = structuredClone(checkpoint);
  }

  get snapshot() {
    return Object.freeze({
      state: "ready",
      shadowVersion: ACOUSTIC_REFLEX_SHADOW_VERSION,
      checkpointId: this.#checkpoint.checkpointId,
      modelSha256: this.#checkpoint.modelSha256,
      authority: false
    });
  }

  predict(previousState, event) {
    return predictAcousticReflex(this.#checkpoint, previousState, event);
  }
}
