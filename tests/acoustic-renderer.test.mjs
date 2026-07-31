import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPcm16Gain,
  generateSeededWhiteNoisePcm16,
  measurePcm16,
  measureSnrDb,
  renderPcm16Scene,
} from '../src/audio/acoustic-renderer.mjs';

function pcm16(...samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer;
}

function samplesOf(buffer) {
  const samples = [];
  for (let offset = 0; offset < buffer.length; offset += 2) {
    samples.push(buffer.readInt16LE(offset));
  }
  return samples;
}

function approximately(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test('measurePcm16 reports normalized level, clipping, and duration', () => {
  const metrics = measurePcm16(pcm16(0, 16384, -16384, -32768, 32767), {
    sampleRate: 10_000,
  });

  assert.equal(metrics.sampleCount, 5);
  assert.equal(metrics.durationMs, 0.5);
  assert.equal(metrics.peak, 32768);
  assert.equal(metrics.peakNormalized, 1);
  assert.equal(metrics.peakDbfs, 0);
  assert.equal(metrics.clippedSamples, 2);
  assert.equal(metrics.clippedRatio, 0.4);
  approximately(
    metrics.rms,
    Math.sqrt((0.5 ** 2 + 0.5 ** 2 + 1 + (32767 / 32768) ** 2) / 5),
  );

  const silence = measurePcm16(pcm16(0, 0));
  assert.equal(silence.rms, 0);
  assert.equal(silence.rmsDbfs, null);
  assert.equal(silence.peakDbfs, null);
});

test('applyPcm16Gain applies dB gain without mutating input and saturates safely', () => {
  const source = pcm16(10_000, -10_000, 32_767, -32_768);
  const original = Buffer.from(source);

  const halved = applyPcm16Gain(source, -20 * Math.log10(2));
  assert.deepEqual(samplesOf(halved), [5_000, -5_000, 16_384, -16_384]);
  assert.deepEqual(source, original);

  const saturated = applyPcm16Gain(
    pcm16(20_000, -20_000),
    20 * Math.log10(2),
  );
  assert.deepEqual(samplesOf(saturated), [32_767, -32_768]);
});

test('seeded white noise is repeatable, seed-sensitive, and level-controlled', () => {
  const options = { sampleCount: 4096, seed: 0, targetRms: 0.08 };
  const first = generateSeededWhiteNoisePcm16(options);
  const repeated = generateSeededWhiteNoisePcm16(options);
  const different = generateSeededWhiteNoisePcm16({ ...options, seed: 1 });

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, different);
  assert.ok(samplesOf(first).some((sample) => sample !== 0));

  const metrics = measurePcm16(first);
  approximately(metrics.rms, 0.08, 1 / 32_768);
  assert.equal(metrics.clippedSamples, 0);
});

test('renderPcm16Scene places, gains, and mixes tracks sample-aligned', () => {
  const rendered = renderPcm16Scene({
    sampleRate: 16_000,
    sampleCount: 3,
    tracks: [
      {
        id: 'speech',
        role: 'speech',
        pcm: pcm16(10_000, 10_000),
      },
      {
        id: 'noise',
        role: 'noise',
        pcm: pcm16(-5_000, 5_000),
        startSample: 1,
      },
    ],
  });

  assert.deepEqual(samplesOf(rendered.mix), [10_000, 5_000, 5_000]);
  assert.equal(rendered.sampleRate, 16_000);
  assert.equal(rendered.sampleCount, 3);
  assert.equal(rendered.metrics.durationMs, 0.1875);
  assert.equal(rendered.metrics.preClipSamples, 0);
  assert.deepEqual(
    rendered.stems.map(({ id, role, startSample, endSample }) => ({
      id,
      role,
      startSample,
      endSample,
    })),
    [
      { id: 'speech', role: 'speech', startSample: 0, endSample: 2 },
      { id: 'noise', role: 'noise', startSample: 1, endSample: 3 },
    ],
  );
});

test('renderPcm16Scene reports pre-saturation clipping', () => {
  const rendered = renderPcm16Scene({
    tracks: [
      { id: 'one', pcm: pcm16(30_000) },
      { id: 'two', pcm: pcm16(30_000) },
    ],
  });

  assert.deepEqual(samplesOf(rendered.mix), [32_767]);
  assert.equal(rendered.metrics.preClipSamples, 1);
  assert.equal(rendered.metrics.preClipRatio, 1);
  assert.equal(rendered.metrics.clippedSamples, 1);
});

test('measureSnrDb reports the RMS ratio and rejects misaligned stems', () => {
  approximately(
    measureSnrDb(pcm16(10_000, -10_000), pcm16(1_000, -1_000)),
    20,
  );
  assert.equal(measureSnrDb(pcm16(100), pcm16(0)), null);
  assert.throws(
    () => measureSnrDb(pcm16(100), pcm16(100, 100)),
    /same sample count/,
  );
});

test('renderer rejects ambiguous or invalid scene definitions', () => {
  assert.throws(
    () => measurePcm16(Buffer.alloc(1)),
    /whole PCM16 samples/,
  );
  assert.throws(
    () => generateSeededWhiteNoisePcm16({
      sampleCount: 8,
      seed: -1,
      targetRms: 0.1,
    }),
    /seed/,
  );
  assert.throws(
    () => renderPcm16Scene({
      tracks: [
        { id: 'same', pcm: pcm16(1) },
        { id: 'same', pcm: pcm16(2) },
      ],
    }),
    /unique/,
  );
  assert.throws(
    () => renderPcm16Scene({
      sampleCount: 1,
      tracks: [{ id: 'too-long', pcm: pcm16(1, 2) }],
    }),
    /shorter/,
  );
});
