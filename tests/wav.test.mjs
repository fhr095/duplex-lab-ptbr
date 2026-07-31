import test from "node:test";
import assert from "node:assert/strict";

import {
  encodePcm16Wave,
  inspectWave
} from "../src/audio/wav.mjs";

function makePcm16Wave(samples, sampleRate = 8_000) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
  return buffer;
}

test("inspeciona duração e atividade de WAV PCM16", () => {
  const samples = [
    ...Array(80).fill(0),
    ...Array(80).fill(1_000),
    ...Array(80).fill(0)
  ];
  const analysis = inspectWave(makePcm16Wave(samples));

  assert.equal(analysis.durationMs, 30);
  assert.equal(analysis.activeStartMs, 10);
  assert.ok(analysis.activeEndMs >= 19.8);
  assert.equal(analysis.peak, 1_000);
});

test("rejeita conteúdo que não é WAV", () => {
  assert.throws(() => inspectWave(Buffer.from("não é wav")), /RIFF\/WAVE/);
});

test("codifica PCM16 mono em WAV reproduzível", () => {
  const pcm = Buffer.from(new Int16Array([
    0,
    1_000,
    -1_000,
    0
  ]).buffer);
  const wave = encodePcm16Wave(pcm, { sampleRate: 16_000 });
  const inspected = inspectWave(wave);

  assert.equal(wave.subarray(44).equals(pcm), true);
  assert.equal(inspected.sampleRate, 16_000);
  assert.equal(inspected.channels, 1);
  assert.equal(inspected.dataBytes, pcm.length);
});
