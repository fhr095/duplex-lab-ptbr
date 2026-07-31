const PCM16_MIN = -32_768;
const PCM16_MAX = 32_767;
const PCM16_SCALE = 32_768;
const MIN_GAIN_DB = -120;
const MAX_GAIN_DB = 60;

function assertPcm16Buffer(pcm, name = 'pcm') {
  if (!Buffer.isBuffer(pcm)) {
    throw new TypeError(`${name} must be a Buffer`);
  }
  if (pcm.length % 2 !== 0) {
    throw new RangeError(`${name} must contain whole PCM16 samples`);
  }
}

function assertSampleRate(sampleRate) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be a positive integer');
  }
}

function assertGainDb(gainDb) {
  if (
    !Number.isFinite(gainDb)
    || gainDb < MIN_GAIN_DB
    || gainDb > MAX_GAIN_DB
  ) {
    throw new RangeError(
      `gainDb must be between ${MIN_GAIN_DB} and ${MAX_GAIN_DB}`,
    );
  }
}

function linearGain(gainDb) {
  assertGainDb(gainDb);
  return 10 ** (gainDb / 20);
}

function saturatePcm16(sample) {
  return Math.max(PCM16_MIN, Math.min(PCM16_MAX, sample));
}

function createPcm16Buffer(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    pcm.writeInt16LE(saturatePcm16(Math.round(samples[index])), index * 2);
  }
  return pcm;
}

/**
 * Measures mono little-endian PCM16 without changing it.
 * Levels are normalized to full scale, making metrics sample-rate independent.
 */
export function measurePcm16(pcm, { sampleRate = 16_000 } = {}) {
  assertPcm16Buffer(pcm);
  assertSampleRate(sampleRate);

  const sampleCount = pcm.length / 2;
  let sumSquares = 0;
  let peak = 0;
  let clippedSamples = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = pcm.readInt16LE(index * 2);
    const magnitude = Math.abs(sample);
    const normalized = sample / PCM16_SCALE;
    sumSquares += normalized * normalized;
    peak = Math.max(peak, magnitude);
    if (sample === PCM16_MIN || sample === PCM16_MAX) {
      clippedSamples += 1;
    }
  }

  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  const peakNormalized = peak / PCM16_SCALE;

  return {
    sampleRate,
    sampleCount,
    durationMs: (sampleCount / sampleRate) * 1000,
    rms,
    rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : null,
    peak,
    peakNormalized,
    peakDbfs: peakNormalized > 0 ? 20 * Math.log10(peakNormalized) : null,
    clippedSamples,
    clippedRatio: sampleCount > 0 ? clippedSamples / sampleCount : 0,
  };
}

/** Applies a gain in decibels and returns a new saturated PCM16 buffer. */
export function applyPcm16Gain(pcm, gainDb = 0) {
  assertPcm16Buffer(pcm);
  const gain = linearGain(gainDb);
  const samples = new Float64Array(pcm.length / 2);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = pcm.readInt16LE(index * 2) * gain;
  }

  return createPcm16Buffer(samples);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Generates repeatable, zero-mean white noise at the requested normalized RMS.
 * Throws instead of silently clipping when the requested level is impossible.
 */
export function generateSeededWhiteNoisePcm16({
  sampleCount,
  seed,
  targetRms = 0.05,
}) {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) {
    throw new RangeError('sampleCount must be a non-negative integer');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new RangeError('seed must be an unsigned 32-bit integer');
  }
  if (!Number.isFinite(targetRms) || targetRms < 0 || targetRms > 1) {
    throw new RangeError('targetRms must be between 0 and 1');
  }
  if (sampleCount === 0 || targetRms === 0) {
    return Buffer.alloc(sampleCount * 2);
  }
  if (sampleCount < 2) {
    throw new RangeError('non-silent noise needs at least two samples');
  }

  const random = mulberry32(seed);
  const values = new Float64Array(sampleCount);
  let mean = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    values[index] = random() * 2 - 1;
    mean += values[index];
  }
  mean /= sampleCount;

  let sumSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    values[index] -= mean;
    sumSquares += values[index] ** 2;
  }

  const sourceRms = Math.sqrt(sumSquares / sampleCount);
  if (sourceRms === 0) {
    throw new Error('seed produced degenerate noise');
  }

  const scale = targetRms / sourceRms;
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    values[index] *= scale;
    peak = Math.max(peak, Math.abs(values[index]));
  }
  if (peak >= 1) {
    throw new RangeError('targetRms would clip this seeded noise');
  }

  for (let index = 0; index < sampleCount; index += 1) {
    values[index] *= PCM16_SCALE;
  }
  return createPcm16Buffer(values);
}

/** Returns a finite RMS SNR in dB, or null when either stem is silent. */
export function measureSnrDb(signalPcm, noisePcm) {
  assertPcm16Buffer(signalPcm, 'signalPcm');
  assertPcm16Buffer(noisePcm, 'noisePcm');
  if (signalPcm.length !== noisePcm.length) {
    throw new RangeError('signal and noise must have the same sample count');
  }

  const signalRms = measurePcm16(signalPcm).rms;
  const noiseRms = measurePcm16(noisePcm).rms;
  if (signalRms === 0 || noiseRms === 0) {
    return null;
  }
  return 20 * Math.log10(signalRms / noiseRms);
}

/**
 * Renders sample-aligned mono PCM16 tracks. Accumulation happens before final
 * saturation so preClipSamples exposes overload that the output alone hides.
 */
export function renderPcm16Scene({
  tracks = [],
  sampleRate = 16_000,
  sampleCount,
} = {}) {
  if (!Array.isArray(tracks)) {
    throw new TypeError('tracks must be an array');
  }
  assertSampleRate(sampleRate);

  const ids = new Set();
  const normalizedTracks = tracks.map((track, index) => {
    if (track === null || typeof track !== 'object') {
      throw new TypeError(`tracks[${index}] must be an object`);
    }
    const { id, pcm, role = null, startSample = 0, gainDb = 0 } = track;
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(`tracks[${index}].id must be a non-empty string`);
    }
    if (ids.has(id)) {
      throw new RangeError('track ids must be unique');
    }
    ids.add(id);
    assertPcm16Buffer(pcm, `tracks[${index}].pcm`);
    if (!Number.isSafeInteger(startSample) || startSample < 0) {
      throw new RangeError(
        `tracks[${index}].startSample must be a non-negative integer`,
      );
    }
    const gain = linearGain(gainDb);
    const trackSampleCount = pcm.length / 2;

    return {
      id,
      role,
      pcm,
      startSample,
      endSample: startSample + trackSampleCount,
      gainDb,
      gain,
    };
  });

  const requiredSampleCount = normalizedTracks.reduce(
    (maximum, track) => Math.max(maximum, track.endSample),
    0,
  );
  const outputSampleCount = sampleCount ?? requiredSampleCount;
  if (!Number.isSafeInteger(outputSampleCount) || outputSampleCount < 0) {
    throw new RangeError('sampleCount must be a non-negative integer');
  }
  if (outputSampleCount < requiredSampleCount) {
    throw new RangeError('sampleCount is shorter than the placed tracks');
  }

  const accumulator = new Float64Array(outputSampleCount);
  for (const track of normalizedTracks) {
    const trackSampleCount = track.pcm.length / 2;
    for (let index = 0; index < trackSampleCount; index += 1) {
      accumulator[track.startSample + index] += (
        track.pcm.readInt16LE(index * 2) * track.gain
      );
    }
  }

  let preClipSamples = 0;
  for (let index = 0; index < accumulator.length; index += 1) {
    const rounded = Math.round(accumulator[index]);
    if (rounded < PCM16_MIN || rounded > PCM16_MAX) {
      preClipSamples += 1;
    }
  }

  const mix = createPcm16Buffer(accumulator);
  const stems = normalizedTracks.map((track) => {
    const pcm = applyPcm16Gain(track.pcm, track.gainDb);
    return {
      id: track.id,
      role: track.role,
      startSample: track.startSample,
      endSample: track.endSample,
      gainDb: track.gainDb,
      pcm,
      metrics: measurePcm16(pcm, { sampleRate }),
    };
  });
  const metrics = measurePcm16(mix, { sampleRate });

  return {
    sampleRate,
    sampleCount: outputSampleCount,
    mix,
    stems,
    metrics: {
      ...metrics,
      preClipSamples,
      preClipRatio: outputSampleCount > 0
        ? preClipSamples / outputSampleCount
        : 0,
    },
  };
}
