export const SPEAKER_RELEVANCE_SHADOW_VERSION =
  "speaker-relevance-causal-features-v0.1";

export const SPEAKER_RELEVANCE_CLASSES = Object.freeze([
  "BACKGROUND_OR_NOT_DIRECTED",
  "DIRECTED_TO_ASSISTANT"
]);

export const SPEAKER_RELEVANCE_FEATURES = Object.freeze([
  "bias",
  "elapsedMs",
  "contextRms",
  "recentRms",
  "activeFrameShare",
  "frameLevelVariation",
  "zeroCrossingRate",
  "crestFactor",
  "pitchPeriodicity",
  "spectralCentroid",
  "spectralFlatness",
  "highBandShare"
]);

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validWeights(weights) {
  return Array.isArray(weights) &&
    weights.length === SPEAKER_RELEVANCE_CLASSES.length &&
    weights.every(
      (row) => Array.isArray(row) &&
        row.length === SPEAKER_RELEVANCE_FEATURES.length &&
        row.every(Number.isFinite)
    );
}

export function validateSpeakerRelevanceCheckpoint(checkpoint) {
  const errors = [];
  if (checkpoint?.schemaVersion !== "speaker-relevance-checkpoint-v1") {
    errors.push("schemaVersion incompatível");
  }
  if (checkpoint?.featureVersion !== SPEAKER_RELEVANCE_SHADOW_VERSION) {
    errors.push("featureVersion incompatível");
  }
  if (!sameArray(checkpoint?.featureNames, SPEAKER_RELEVANCE_FEATURES)) {
    errors.push("featureNames incompatíveis");
  }
  if (!sameArray(checkpoint?.classes, SPEAKER_RELEVANCE_CLASSES)) {
    errors.push("classes incompatíveis");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(checkpoint?.modelSha256 ?? "")) {
    errors.push("modelSha256 inválido");
  }
  if (!validWeights(checkpoint?.model?.weights)) {
    errors.push("matriz de pesos incompatível");
  }
  const threshold = checkpoint?.decision?.backgroundVetoConfidence;
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) {
    errors.push("backgroundVetoConfidence inválido");
  }
  if (
    checkpoint?.decision?.backgroundAction !== "CONTINUE_OUTPUT" ||
    checkpoint?.decision?.directedAction !== "DEFER_TO_DETERMINISTIC" ||
    checkpoint?.decision?.lowConfidenceAction !==
      "DEFER_TO_DETERMINISTIC"
  ) {
    errors.push("mapeamento operacional incompatível");
  }
  if (
    checkpoint?.authority?.mode !== "shadow" ||
    checkpoint?.authority?.canProduceEffects !== false
  ) {
    errors.push("checkpoint precisa permanecer sem autoridade");
  }
  if (
    checkpoint?.runtime?.sampleRate !== 16_000 ||
    !Number.isFinite(checkpoint?.runtime?.decisionMs) ||
    checkpoint.runtime.decisionMs <= 0 ||
    !Number.isSafeInteger(checkpoint?.runtime?.decisionSamples) ||
    checkpoint.runtime.decisionSamples < 1 ||
    checkpoint.runtime.decisionSamples !== Math.round(
      checkpoint.runtime.sampleRate * checkpoint.runtime.decisionMs / 1_000
    ) ||
    !Number.isSafeInteger(checkpoint?.runtime?.bufferSamples) ||
    checkpoint.runtime.bufferSamples < checkpoint.runtime.decisionSamples ||
    checkpoint.runtime.futureSamplesAllowed !== 0
  ) {
    errors.push("contrato causal de runtime incompatível");
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

function validateFeatureSet(featureSet) {
  const errors = [];
  if (featureSet?.featureVersion !== SPEAKER_RELEVANCE_SHADOW_VERSION) {
    errors.push("featureVersion incompatível");
  }
  if (!sameArray(featureSet?.names, SPEAKER_RELEVANCE_FEATURES)) {
    errors.push("nomes de features incompatíveis");
  }
  if (
    !Array.isArray(featureSet?.values) ||
    featureSet.values.length !== SPEAKER_RELEVANCE_FEATURES.length ||
    featureSet.values.some((value) => !Number.isFinite(value))
  ) {
    errors.push("valores de features incompatíveis");
  }
  if (featureSet?.window?.futureSamplesUsed !== 0) {
    errors.push("janela de features não é causal");
  }
  return { valid: errors.length === 0, errors };
}

function softmax(logits) {
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedPcm16(pcm16) {
  if (!(pcm16 instanceof Int16Array) || pcm16.length < 1) {
    throw new TypeError("pcm16 precisa ser Int16Array não vazio");
  }
  return Float64Array.from(pcm16, (value) => value / 32_768);
}

function rms(values, start = 0, end = values.length) {
  if (end <= start) {
    return 0;
  }
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    sum += values[index] ** 2;
  }
  return Math.sqrt(sum / (end - start));
}

function normalizedDb(value) {
  const db = value > 0 ? 20 * Math.log10(value) : -80;
  return clamp((db + 60) / 60);
}

function frameLevels(values, sampleRate) {
  const frameSamples = Math.round(sampleRate * 0.02);
  const levels = [];
  for (let start = 0; start < values.length; start += frameSamples) {
    levels.push(rms(
      values,
      start,
      Math.min(values.length, start + frameSamples)
    ));
  }
  return levels;
}

function pitchPeriodicity(values, sampleRate) {
  if (values.length < Math.round(sampleRate * 0.04)) {
    return 0;
  }
  let energy = 0;
  for (const value of values) {
    energy += value ** 2;
  }
  if (energy === 0) {
    return 0;
  }
  let best = 0;
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.min(
    Math.ceil(sampleRate / 70),
    values.length - 1
  );
  for (let lag = minLag; lag <= maxLag; lag += 2) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = lag; index < values.length; index += 1) {
      correlation += values[index] * values[index - lag];
      leftEnergy += values[index] ** 2;
      rightEnergy += values[index - lag] ** 2;
    }
    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    if (denominator > 0) {
      best = Math.max(best, correlation / denominator);
    }
  }
  return clamp(best);
}

function spectrum(values, sampleRate) {
  const size = Math.min(512, values.length);
  if (size < 32) {
    return { centroid: 0, flatness: 0, highShare: 0 };
  }
  const start = values.length - size;
  const bins = Math.floor(size / 2);
  const powers = [];
  let total = 0;
  let weighted = 0;
  let high = 0;
  for (let bin = 1; bin <= bins; bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < size; index += 1) {
      const window = 0.5 - 0.5 * Math.cos(
        2 * Math.PI * index / (size - 1)
      );
      const angle = 2 * Math.PI * bin * index / size;
      const value = values[start + index] * window;
      real += value * Math.cos(angle);
      imaginary -= value * Math.sin(angle);
    }
    const power = real ** 2 + imaginary ** 2 + 1e-18;
    const frequency = bin * sampleRate / size;
    powers.push(power);
    total += power;
    weighted += power * frequency;
    if (frequency >= 3_000) {
      high += power;
    }
  }
  const arithmetic = total / powers.length;
  const geometric = Math.exp(
    powers.reduce((sum, power) => sum + Math.log(power), 0) /
      powers.length
  );
  return {
    centroid: total === 0 ? 0 : clamp(weighted / total / (sampleRate / 2)),
    flatness: arithmetic === 0 ? 0 : clamp(geometric / arithmetic),
    highShare: total === 0 ? 0 : clamp(high / total)
  };
}

export function extractBrowserSpeakerRelevanceFeatures(
  pcm16,
  options = {}
) {
  const sampleRate = options.sampleRate ?? 16_000;
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new TypeError("sampleRate inválido");
  }
  const context = normalizedPcm16(pcm16);
  const recentSamples = Math.min(
    context.length,
    Math.round(sampleRate * 0.12)
  );
  const recent = context.subarray(context.length - recentSamples);
  const contextRms = rms(context);
  const recentRms = rms(recent);
  const levels = frameLevels(context, sampleRate);
  const active = levels.filter((level) =>
    level > 0 && 20 * Math.log10(level) >= -45
  ).length;
  const meanLevel = levels.reduce((sum, level) => sum + level, 0) /
    levels.length;
  const levelStd = Math.sqrt(levels.reduce(
    (sum, level) => sum + (level - meanLevel) ** 2,
    0
  ) / levels.length);
  let crossings = 0;
  let peak = 0;
  for (let index = 0; index < context.length; index += 1) {
    peak = Math.max(peak, Math.abs(context[index]));
    if (
      index > 0 &&
      (context[index] >= 0) !== (context[index - 1] >= 0)
    ) {
      crossings += 1;
    }
  }
  const spectral = spectrum(context, sampleRate);
  const values = [
    1,
    clamp(context.length / sampleRate),
    normalizedDb(contextRms),
    normalizedDb(recentRms),
    active / levels.length,
    clamp(levelStd / 0.15),
    context.length < 2 ? 0 : crossings / (context.length - 1),
    contextRms === 0 ? 0 : clamp(peak / contextRms / 10),
    pitchPeriodicity(recent, sampleRate),
    spectral.centroid,
    spectral.flatness,
    spectral.highShare
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("extrator produziu feature não finita");
  }
  return Object.freeze({
    schemaVersion: 1,
    featureVersion: SPEAKER_RELEVANCE_SHADOW_VERSION,
    names: SPEAKER_RELEVANCE_FEATURES,
    values: Object.freeze(values),
    window: Object.freeze({
      onsetSample: 0,
      decisionSample: pcm16.length,
      sampleRate,
      futureSamplesUsed: 0
    })
  });
}

export function predictSpeakerRelevance(checkpoint, featureSet) {
  const checkpointValidation = validateSpeakerRelevanceCheckpoint(
    checkpoint
  );
  if (!checkpointValidation.valid) {
    throw new TypeError(
      `checkpoint de relevância inválido: ` +
        checkpointValidation.errors.join("; ")
    );
  }
  const featureValidation = validateFeatureSet(featureSet);
  if (!featureValidation.valid) {
    throw new TypeError(
      `features de relevância inválidas: ` +
        featureValidation.errors.join("; ")
    );
  }
  const logits = checkpoint.model.weights.map((row) => row.reduce(
    (sum, weight, index) => sum + weight * featureSet.values[index],
    0
  ));
  const values = softmax(logits);
  const probabilities = Object.freeze(Object.fromEntries(
    SPEAKER_RELEVANCE_CLASSES.map((label, index) => [label, values[index]])
  ));
  const rawLabel = values[0] >= values[1]
    ? SPEAKER_RELEVANCE_CLASSES[0]
    : SPEAKER_RELEVANCE_CLASSES[1];
  const backgroundConfident =
    probabilities.BACKGROUND_OR_NOT_DIRECTED >=
      checkpoint.decision.backgroundVetoConfidence;
  const operationalLabel = backgroundConfident
    ? "BACKGROUND_OR_NOT_DIRECTED"
    : "DIRECTED_TO_ASSISTANT";
  return Object.freeze({
    schemaVersion: 1,
    shadowVersion: SPEAKER_RELEVANCE_SHADOW_VERSION,
    checkpointId: checkpoint.checkpointId,
    modelSha256: checkpoint.modelSha256,
    rawLabel,
    operationalLabel,
    suggestedAction: backgroundConfident
      ? checkpoint.decision.backgroundAction
      : checkpoint.decision.lowConfidenceAction,
    probabilities,
    threshold: checkpoint.decision.backgroundVetoConfidence,
    authority: false
  });
}

export class SpeakerRelevanceShadow {
  #checkpoint;

  constructor(checkpoint) {
    const validation = validateSpeakerRelevanceCheckpoint(checkpoint);
    if (!validation.valid) {
      throw new TypeError(
        `checkpoint de relevância inválido: ${validation.errors.join("; ")}`
      );
    }
    this.#checkpoint = structuredClone(checkpoint);
  }

  get snapshot() {
    return Object.freeze({
      state: "ready",
      shadowVersion: SPEAKER_RELEVANCE_SHADOW_VERSION,
      checkpointId: this.#checkpoint.checkpointId,
      modelSha256: this.#checkpoint.modelSha256,
      backgroundVetoConfidence:
        this.#checkpoint.decision.backgroundVetoConfidence,
      authority: false
    });
  }

  predict(featureSet) {
    return predictSpeakerRelevance(this.#checkpoint, featureSet);
  }
}

function assembleRange(frames, start, end) {
  const output = new Int16Array(end - start);
  const covered = new Uint8Array(end - start);
  for (const frame of frames) {
    const frameStart = frame.sampleStart;
    const frameEnd = frameStart + frame.pcm16.length;
    const overlapStart = Math.max(start, frameStart);
    const overlapEnd = Math.min(end, frameEnd);
    if (overlapEnd <= overlapStart) {
      continue;
    }
    const sourceStart = overlapStart - frameStart;
    const targetStart = overlapStart - start;
    const count = overlapEnd - overlapStart;
    output.set(
      frame.pcm16.subarray(sourceStart, sourceStart + count),
      targetStart
    );
    covered.fill(1, targetStart, targetStart + count);
  }
  return covered.every((value) => value === 1) ? output : null;
}

export class SpeakerRelevanceCausalRuntime {
  #checkpoint;
  #decisions = [];
  #errors = 0;
  #frames = [];
  #pending = [];

  constructor(checkpoint) {
    const validation = validateSpeakerRelevanceCheckpoint(checkpoint);
    if (!validation.valid) {
      throw new TypeError(
        `checkpoint de relevância inválido: ${validation.errors.join("; ")}`
      );
    }
    this.#checkpoint = structuredClone(checkpoint);
  }

  #drain() {
    const completed = [];
    const latestSampleEnd = Math.max(
      0,
      ...this.#frames.map(
        (frame) => frame.sampleStart + frame.pcm16.length
      )
    );
    const remaining = [];
    for (const pending of this.#pending) {
      if (latestSampleEnd < pending.decisionSample) {
        remaining.push(pending);
        continue;
      }
      const pcm16 = assembleRange(
        this.#frames,
        pending.onsetSample,
        pending.decisionSample
      );
      if (pcm16 === null) {
        const earliest = Math.min(
          Infinity,
          ...this.#frames.map((frame) => frame.sampleStart)
        );
        if (earliest <= pending.onsetSample) {
          remaining.push(pending);
        } else {
          this.#errors += 1;
        }
        continue;
      }
      const startedAt = globalThis.performance?.now?.() ?? Date.now();
      const features = extractBrowserSpeakerRelevanceFeatures(pcm16, {
        sampleRate: this.#checkpoint.runtime.sampleRate
      });
      const prediction = predictSpeakerRelevance(
        this.#checkpoint,
        features
      );
      const endedAt = globalThis.performance?.now?.() ?? Date.now();
      const decision = Object.freeze({
        turnId: pending.turnId,
        onsetSample: pending.onsetSample,
        decisionSample: pending.decisionSample,
        observedSampleEnd: latestSampleEnd,
        inferenceMs: endedAt - startedAt,
        rawLabel: prediction.rawLabel,
        operationalLabel: prediction.operationalLabel,
        suggestedAction: prediction.suggestedAction,
        probabilities: prediction.probabilities,
        context: pending.context,
        futureSamplesUsed: features.window.futureSamplesUsed,
        authority: false
      });
      this.#decisions.push(decision);
      this.#decisions = this.#decisions.slice(-100);
      completed.push(decision);
    }
    this.#pending = remaining.slice(-20);
    return completed;
  }

  pushFrame(frame) {
    if (
      !Number.isSafeInteger(frame?.sampleStart) ||
      frame.sampleStart < 0 ||
      !(frame?.pcm16 instanceof Int16Array) ||
      frame.pcm16.length < 1 ||
      (
        frame.sampleRate !== undefined &&
        frame.sampleRate !== this.#checkpoint.runtime.sampleRate
      )
    ) {
      throw new TypeError("frame PCM de relevância inválido");
    }
    this.#frames.push({
      sampleStart: frame.sampleStart,
      pcm16: frame.pcm16.slice()
    });
    const latestSampleEnd = frame.sampleStart + frame.pcm16.length;
    const retainFrom = latestSampleEnd - this.#checkpoint.runtime.bufferSamples;
    this.#frames = this.#frames.filter(
      (item) => item.sampleStart + item.pcm16.length > retainFrom
    );
    return Object.freeze(this.#drain());
  }

  observeSpeechStart(event, context = {}) {
    const onsetSample = event?.onsetSampleStart ?? event?.triggerSampleStart;
    if (!Number.isSafeInteger(onsetSample) || onsetSample < 0) {
      this.#errors += 1;
      return Object.freeze([]);
    }
    const turnId = event.turnId ?? `sample-${onsetSample}`;
    const key = `${turnId}/${onsetSample}`;
    if (
      this.#pending.some((item) => item.key === key) ||
      this.#decisions.some(
        (item) => item.turnId === turnId && item.onsetSample === onsetSample
      )
    ) {
      return Object.freeze([]);
    }
    this.#pending.push({
      key,
      turnId,
      onsetSample,
      decisionSample:
        onsetSample + this.#checkpoint.runtime.decisionSamples,
      context: Object.freeze({ ...context })
    });
    this.#pending = this.#pending.slice(-20);
    return Object.freeze(this.#drain());
  }

  reset() {
    this.#frames = [];
    this.#pending = [];
    this.#decisions = [];
    this.#errors = 0;
  }

  get snapshot() {
    const inference = this.#decisions
      .map((item) => item.inferenceMs)
      .sort((left, right) => left - right);
    const rank = (ratio) => inference.length === 0
      ? null
      : inference[Math.max(0, Math.ceil(inference.length * ratio) - 1)];
    return Object.freeze({
      state: "ready",
      checkpointId: this.#checkpoint.checkpointId,
      modelSha256: this.#checkpoint.modelSha256,
      authority: false,
      bufferedFrames: this.#frames.length,
      pending: this.#pending.length,
      errors: this.#errors,
      decisionCount: this.#decisions.length,
      inferenceMs: {
        n: inference.length,
        p50: rank(0.5),
        p95: rank(0.95),
        max: rank(1)
      },
      decisions: this.#decisions.map((item) => ({ ...item }))
    });
  }
}
