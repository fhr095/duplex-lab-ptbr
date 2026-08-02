import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { encodePcm16Wave } from "../src/audio/wav.mjs";
import {
  deriveHumanSpeakerRelevanceAnchors,
  extractPcm16WaveChannel
} from "../src/eval/speaker-relevance-human-anchor.mjs";

const pack = JSON.parse(await readFile(new URL(
  "../eval/calibration/exp-0015-timing-pack-v0.2.json",
  import.meta.url
)));
const calibration = JSON.parse(await readFile(new URL(
  "../eval/reports/exp-0015-timing-calibration-instrument-v4.json",
  import.meta.url
)));
test("agregado humano produz nove âncoras e nunca exemplos de fit", () => {
  const anchors = deriveHumanSpeakerRelevanceAnchors(
    pack,
    calibration.aggregate
  );
  assert.equal(anchors.length, 9);
  assert.equal(
    anchors.filter((item) => item.expected === "DIRECTED_TO_ASSISTANT").length,
    5
  );
  assert.ok(anchors.every((item) => item.eligibleForDirectFit === false));
  assert.ok(!anchors.some((item) => item.sceneId === "noisy-speech-mid"));
});

test("extração seleciona o canal direito sem misturá-lo ao assistente", () => {
  const interleaved = Buffer.alloc(640 * 2 * 2);
  for (let frame = 0; frame < 640; frame += 1) {
    interleaved.writeInt16LE(frame % 100, frame * 4);
    interleaved.writeInt16LE(-(frame % 80), frame * 4 + 2);
  }
  const wave = encodePcm16Wave(interleaved, {
    sampleRate: 16_000,
    channels: 2
  });
  const left = extractPcm16WaveChannel(wave, 0);
  const right = extractPcm16WaveChannel(wave, 1);
  assert.equal(left.sampleRate, 16_000);
  assert.equal(right.channels, 2);
  assert.equal(left.sampleCount, right.sampleCount);
  assert.equal(left.pcm.equals(right.pcm), false);
  assert.throws(() => extractPcm16WaveChannel(wave, 2), /canal/iu);
});
