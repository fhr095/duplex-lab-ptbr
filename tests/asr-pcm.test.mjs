import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeWaveToPcm16,
  float32ToPcm16
} from "../src/asr/pcm.mjs";
import { encodePcm16Wave } from "../src/audio/wav.mjs";

function floatWave(samples, sampleRate = 16_000) {
  const dataBytes = samples.length * 4;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(3, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(32, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => {
    wav.writeFloatLE(sample, 44 + index * 4);
  });
  return wav;
}

test("converte Float32 para PCM16 e reduz sample rate", () => {
  const source = new Float32Array([
    -1, -0.5, 0, 0.5, 1, 0.5, 0, -0.5
  ]);
  const pcm = float32ToPcm16(source, {
    sourceSampleRate: 8,
    targetSampleRate: 4
  });

  assert.equal(pcm.length, 8);
  assert.equal(pcm.readInt16LE(0), -32_768);
  assert.equal(pcm.readInt16LE(2), 0);
  assert.equal(pcm.readInt16LE(4), 32_767);
  assert.equal(pcm.readInt16LE(6), 0);
});

test("decodifica WAV float usado pelo corpus humano", () => {
  const decoded = decodeWaveToPcm16(
    floatWave([0, 0.25, -0.25, 1], 16_000)
  );

  assert.equal(decoded.sampleRate, 16_000);
  assert.equal(decoded.pcm.length, 8);
  assert.equal(decoded.pcm.readInt16LE(2), 8_192);
  assert.equal(decoded.pcm.readInt16LE(4), -8_192);
});

test("preserva PCM16 mono bit a bit quando a taxa já é a taxa alvo", () => {
  const samples = [-32_768, -12_345, -1, 0, 1, 12_345, 32_767];
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  const decoded = decodeWaveToPcm16(
    encodePcm16Wave(pcm, { sampleRate: 16_000, channels: 1 }),
    { targetSampleRate: 16_000 }
  );

  assert.equal(decoded.sampleRate, 16_000);
  assert.deepEqual(decoded.pcm, pcm);
});
