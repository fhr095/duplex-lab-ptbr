import test from "node:test";
import assert from "node:assert/strict";

import {
  downmixToMono,
  floatToPcm16,
  StreamingPcmDownsampler,
  StreamingPcmFramer
} from "../web/pcm-dsp.mjs";

function sineWave({
  sampleRate,
  frequency = 440,
  seconds = 1,
  amplitude = 0.5
}) {
  const samples = new Float32Array(sampleRate * seconds);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] =
      amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate);
  }
  return samples;
}

function concatenate(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

function rms(samples, start = 0) {
  let squareSum = 0;
  for (let index = start; index < samples.length; index += 1) {
    squareSum += samples[index] ** 2;
  }
  return Math.sqrt(squareSum / (samples.length - start));
}

test("downmix mono preserva média dos canais e neutraliza não finitos", () => {
  const mono = downmixToMono([
    Float32Array.from([1, 0.5, Number.NaN]),
    Float32Array.from([-1, 0.5, 0.25])
  ]);

  assert.deepEqual(
    Array.from(mono),
    [0, 0.5, 0.125]
  );
  assert.throws(
    () => downmixToMono([
      new Float32Array(2),
      new Float32Array(3)
    ]),
    /mesmo comprimento/
  );
});

test("conversão PCM16 satura extremos e preserva o zero", () => {
  const pcm = floatToPcm16(
    Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2, Number.NaN])
  );

  assert.deepEqual(Array.from(pcm), [
    -32_768,
    -32_768,
    -16_384,
    0,
    16_384,
    32_767,
    32_767,
    0
  ]);
});

test("downsample 48 kHz para 16 kHz mantém duração e nível DC", () => {
  const downsampler = new StreamingPcmDownsampler({
    inputSampleRate: 48_000,
    outputSampleRate: 16_000
  });
  const output = downsampler.push(
    Float32Array.from({ length: 48_000 }, () => 0.25)
  );

  assert.equal(output.length, 16_000);
  assert.ok(
    output
      .subarray(32)
      .every((sample) => Math.abs(sample - 0.25) < 1e-7)
  );
  assert.deepEqual(downsampler.stats, {
    inputSamples: 48_000,
    outputSamples: 16_000,
    filterTaps: 31,
    groupDelayInputSamples: 15,
    partialOutputProgress: 0
  });
});

test("filtro anti-alias rejeita conteúdo acima do Nyquist de saída", () => {
  const passband = new StreamingPcmDownsampler({
    inputSampleRate: 48_000,
    outputSampleRate: 16_000
  }).push(sineWave({
    sampleRate: 48_000,
    frequency: 1_000,
    seconds: 1
  }));
  const stopband = new StreamingPcmDownsampler({
    inputSampleRate: 48_000,
    outputSampleRate: 16_000
  }).push(sineWave({
    sampleRate: 48_000,
    frequency: 12_000,
    seconds: 1
  }));

  const passbandRms = rms(passband, 64);
  const stopbandRms = rms(stopband, 64);

  assert.ok(passbandRms > 0.34);
  assert.ok(
    stopbandRms / passbandRms < 0.01,
    `alias relativo observado: ${stopbandRms / passbandRms}`
  );
});

test("downsample streaming independe dos limites dos quanta", () => {
  const source = sineWave({
    sampleRate: 44_100,
    frequency: 997,
    seconds: 1
  });
  const whole = new StreamingPcmDownsampler({
    inputSampleRate: 44_100,
    outputSampleRate: 16_000
  }).push(source);

  const streamedResampler = new StreamingPcmDownsampler({
    inputSampleRate: 44_100,
    outputSampleRate: 16_000
  });
  const chunks = [];
  for (let offset = 0; offset < source.length; offset += 127) {
    chunks.push(streamedResampler.push(source.subarray(offset, offset + 127)));
  }
  const streamed = concatenate(chunks);

  assert.equal(streamed.length, 16_000);
  assert.deepEqual(streamed, whole);
});

test("framing de um segundo é monotônico e sem lacunas", () => {
  const framer = new StreamingPcmFramer({
    inputSampleRate: 48_000,
    targetSampleRate: 16_000,
    frameDurationMs: 20
  });
  const source = sineWave({
    sampleRate: 48_000,
    frequency: 220,
    seconds: 1
  });
  const frames = [];

  for (let offset = 0; offset < source.length; offset += 128) {
    frames.push(...framer.pushChannels([
      source.subarray(offset, offset + 128)
    ]));
  }

  assert.equal(frames.length, 50);
  for (const [index, frame] of frames.entries()) {
    assert.equal(frame.sequence, index);
    assert.equal(frame.sampleStart, index * 320);
    assert.equal(frame.sampleEnd, (index + 1) * 320);
    assert.equal(frame.sampleRate, 16_000);
    assert.equal(frame.durationMs, 20);
    assert.equal(frame.pcm16.length, 320);
  }
  assert.equal(framer.stats.generatedFrames, 50);
  assert.equal(framer.stats.bufferedOutputSamples, 0);
  assert.equal(framer.stats.framedOutputSamples, 16_000);
});

test("framer rejeita upsampling e duração não integral", () => {
  assert.throws(
    () => new StreamingPcmFramer({
      inputSampleRate: 8_000,
      targetSampleRate: 16_000
    }),
    /upsampling/
  );
  assert.throws(
    () => new StreamingPcmFramer({
      inputSampleRate: 48_000,
      targetSampleRate: 16_000,
      frameDurationMs: 20.01
    }),
    /número inteiro/
  );
});
