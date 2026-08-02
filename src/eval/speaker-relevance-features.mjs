import {
  generateSeededWhiteNoisePcm16,
  measurePcm16
} from "../audio/acoustic-renderer.mjs";

export const SPEAKER_RELEVANCE_FEATURE_VERSION =
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

function pcm16(value, label = "pcm") {
  if (!Buffer.isBuffer(value) || value.length % 2 !== 0) {
    throw new TypeError(`${label} precisa ser PCM16 alinhado`);
  }
  return value;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function samples(pcm) {
  const output = new Float64Array(pcm.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = pcm.readInt16LE(index * 2) / 32_768;
  }
  return output;
}

function encode(values) {
  let peak = 0;
  for (const value of values) {
    peak = Math.max(peak, Math.abs(value));
  }
  const scale = peak >= 1 ? 0.98 / peak : 1;
  const pcm = Buffer.alloc(values.length * 2);
  for (let index = 0; index < values.length; index += 1) {
    const value = clamp(values[index] * scale, -1, 1);
    pcm.writeInt16LE(
      value < 0
        ? Math.round(value * 32_768)
        : Math.round(value * 32_767),
      index * 2
    );
  }
  return pcm;
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

export function findPcm16SpeechOnset(pcm, options = {}) {
  pcm16(pcm);
  const sampleRate = options.sampleRate ?? 16_000;
  const frameSamples = Math.round(
    sampleRate * (options.frameMs ?? 20) / 1_000
  );
  const thresholdDb = options.thresholdDb ?? -45;
  const consecutiveFrames = options.consecutiveFrames ?? 2;
  if (
    !Number.isSafeInteger(sampleRate) || sampleRate <= 0 ||
    frameSamples < 1 ||
    !Number.isSafeInteger(consecutiveFrames) || consecutiveFrames < 1
  ) {
    throw new TypeError("configuração de onset inválida");
  }
  const values = samples(pcm);
  let run = 0;
  for (let start = 0; start < values.length; start += frameSamples) {
    const level = rms(values, start, Math.min(values.length, start + frameSamples));
    const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
    run = db >= thresholdDb ? run + 1 : 0;
    if (run >= consecutiveFrames) {
      return Math.max(0, start - (consecutiveFrames - 1) * frameSamples);
    }
  }
  return null;
}

function normalizeRms(values, targetDb) {
  const observed = rms(values);
  if (observed === 0) {
    return values;
  }
  const target = 10 ** (targetDb / 20);
  const gain = target / observed;
  return Float64Array.from(values, (value) => value * gain);
}

function lowPass(values, alpha) {
  if (alpha === null || alpha === undefined) {
    return values;
  }
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw new RangeError("lowPassAlpha precisa estar em (0, 1]");
  }
  const output = new Float64Array(values.length);
  let previous = 0;
  for (let index = 0; index < values.length; index += 1) {
    previous += alpha * (values[index] - previous);
    output[index] = previous;
  }
  return output;
}

function echo(values, sampleRate, delayMs, gain) {
  if (!delayMs || !gain) {
    return values;
  }
  const delay = Math.round(sampleRate * delayMs / 1_000);
  const output = Float64Array.from(values);
  for (let index = delay; index < output.length; index += 1) {
    output[index] += values[index - delay] * gain;
  }
  return output;
}

function mix(values, other, gain = 1) {
  if (other === null || other === undefined) {
    return values;
  }
  const output = Float64Array.from(values);
  for (let index = 0; index < output.length; index += 1) {
    output[index] += (other[index] ?? 0) * gain;
  }
  return output;
}

export function renderSpeakerRelevanceRecipe(input) {
  const sourcePcm = pcm16(input.sourcePcm, "sourcePcm");
  const sampleRate = input.sampleRate ?? 16_000;
  const durationMs = input.durationMs ?? 1_000;
  const sampleCount = Math.round(sampleRate * durationMs / 1_000);
  const onset = findPcm16SpeechOnset(sourcePcm, { sampleRate });
  if (onset === null) {
    throw new Error("fonte não contém onset de fala observável");
  }
  const source = samples(sourcePcm);
  let values = new Float64Array(sampleCount);
  values.set(source.subarray(onset, onset + sampleCount));
  values = normalizeRms(values, input.targetRmsDb ?? -24);
  values = lowPass(values, input.lowPassAlpha);
  values = echo(
    values,
    sampleRate,
    input.echoDelayMs ?? null,
    input.echoGain ?? null
  );
  if (input.secondaryPcm) {
    const secondaryOnset = findPcm16SpeechOnset(input.secondaryPcm, {
      sampleRate
    });
    if (secondaryOnset === null) {
      throw new Error("fonte secundária sem onset");
    }
    const secondarySource = samples(input.secondaryPcm);
    const secondary = new Float64Array(sampleCount);
    secondary.set(secondarySource.subarray(
      secondaryOnset,
      secondaryOnset + sampleCount
    ));
    values = mix(
      values,
      normalizeRms(secondary, input.secondaryRmsDb ?? -31),
      1
    );
  }
  if (Number.isFinite(input.noiseSnrDb)) {
    const signalRms = rms(values);
    const noiseRms = signalRms / (10 ** (input.noiseSnrDb / 20));
    const noise = samples(generateSeededWhiteNoisePcm16({
      sampleCount,
      seed: input.seed ?? 1,
      targetRms: noiseRms
    }));
    values = mix(values, noise);
  }
  values = normalizeRms(values, input.finalRmsDb ?? input.targetRmsDb ?? -24);
  return Object.freeze({
    pcm: encode(values),
    sampleRate,
    onsetSample: 0,
    decisionSample: Math.round(
      sampleRate * (input.decisionMs ?? 480) / 1_000
    )
  });
}

function frameLevels(values, sampleRate) {
  const frameSamples = Math.round(sampleRate * 0.02);
  const levels = [];
  for (let start = 0; start < values.length; start += frameSamples) {
    levels.push(rms(values, start, Math.min(values.length, start + frameSamples)));
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

export function extractSpeakerRelevanceFeatures(input) {
  const pcm = pcm16(input.pcm);
  const sampleRate = input.sampleRate ?? 16_000;
  const onsetSample = input.onsetSample ?? 0;
  const decisionSample = input.decisionSample;
  if (
    !Number.isSafeInteger(sampleRate) || sampleRate <= 0 ||
    !Number.isSafeInteger(onsetSample) || onsetSample < 0 ||
    !Number.isSafeInteger(decisionSample) ||
    decisionSample <= onsetSample ||
    decisionSample > pcm.length / 2
  ) {
    throw new RangeError("janela causal de features é inválida");
  }
  const all = samples(pcm);
  const context = all.subarray(onsetSample, decisionSample);
  const recentSamples = Math.min(context.length, Math.round(sampleRate * 0.12));
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
    clamp((decisionSample - onsetSample) / sampleRate),
    normalizedDb(contextRms),
    normalizedDb(recentRms),
    levels.length === 0 ? 0 : active / levels.length,
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
    featureVersion: SPEAKER_RELEVANCE_FEATURE_VERSION,
    names: SPEAKER_RELEVANCE_FEATURES,
    values: Object.freeze(values),
    window: Object.freeze({
      onsetSample,
      decisionSample,
      sampleRate,
      futureSamplesUsed: 0
    }),
    diagnostics: Object.freeze({
      contextRmsDb: measurePcm16(
        pcm.subarray(onsetSample * 2, decisionSample * 2),
        { sampleRate }
      ).rmsDbfs,
      recentRmsDb: recentRms > 0 ? 20 * Math.log10(recentRms) : null
    })
  });
}
