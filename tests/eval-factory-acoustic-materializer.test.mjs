import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  encodeWaveArtifact,
  renderFactoryAcousticVariant
} from "../src/eval/factory/acoustic-materializer.mjs";

function sinePcm(sampleCount = 16_000) {
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    pcm.writeInt16LE(
      Math.round(Math.sin(index / 12) * 8_000),
      index * 2
    );
  }
  return pcm;
}

test("variante ruidosa é determinística, atinge SNR e não clipa", () => {
  const input = {
    pcm: sinePcm(),
    condition: { kind: "noise", signalGainDb: -6, snrDb: 10 },
    seed: 4173
  };
  const first = renderFactoryAcousticVariant(input);
  const second = renderFactoryAcousticVariant(input);

  assert.deepEqual(first.mix, second.mix);
  assert.notDeepEqual(first.mix, input.pcm);
  assert.ok(Math.abs(first.achievedSnrDb - 10) <= 0.05);
  assert.equal(first.metrics.preClipSamples, 0);
  assert.equal(first.metrics.clippedSamples, 0);
});

test("variante quiet reduz nível sem inventar ruído", () => {
  const result = renderFactoryAcousticVariant({
    pcm: sinePcm(1_600),
    condition: { kind: "quiet", signalGainDb: -12 },
    seed: 1
  });
  assert.equal(result.stems.length, 1);
  assert.equal(result.noisePcm, null);
  assert.equal(result.achievedSnrDb, null);
  assert.ok(result.metrics.rms < 0.1);
});

test("evidência do artefato referencia os bytes WAV, não o PCM bruto", () => {
  const pcm = sinePcm(1_600);
  const artifact = encodeWaveArtifact(pcm);
  const digest = (value) => createHash("sha256").update(value).digest("hex");

  assert.equal(artifact.sha256, digest(artifact.wave));
  assert.equal(artifact.pcmSha256, digest(pcm));
  assert.notEqual(artifact.sha256, artifact.pcmSha256);
});
