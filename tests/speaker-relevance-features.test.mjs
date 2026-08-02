import assert from "node:assert/strict";
import test from "node:test";

import {
  SPEAKER_RELEVANCE_FEATURES,
  extractSpeakerRelevanceFeatures,
  findPcm16SpeechOnset,
  renderSpeakerRelevanceRecipe
} from "../src/eval/speaker-relevance-features.mjs";
import {
  extractBrowserSpeakerRelevanceFeatures
} from "../web/speaker-relevance-shadow.mjs";

function voicedPcm(sampleCount = 16_000, start = 1_600) {
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = start; index < sampleCount; index += 1) {
    const value = Math.round(
      Math.sin(2 * Math.PI * 180 * index / 16_000) * 8_000 +
      Math.sin(2 * Math.PI * 620 * index / 16_000) * 2_000
    );
    pcm.writeInt16LE(value, index * 2);
  }
  return pcm;
}

test("features de relevância são causais e ignoram amostras futuras", () => {
  const source = voicedPcm();
  const recipe = renderSpeakerRelevanceRecipe({
    sourcePcm: source,
    decisionMs: 480,
    durationMs: 1_000,
    targetRmsDb: -24,
    echoDelayMs: 45,
    echoGain: 0.2
  });
  const first = extractSpeakerRelevanceFeatures(recipe);
  const mutated = Buffer.from(recipe.pcm);
  for (
    let sample = recipe.decisionSample;
    sample < mutated.length / 2;
    sample += 1
  ) {
    mutated.writeInt16LE(sample % 2 === 0 ? 30_000 : -30_000, sample * 2);
  }
  const second = extractSpeakerRelevanceFeatures({
    ...recipe,
    pcm: mutated
  });

  assert.deepEqual(first.values, second.values);
  assert.equal(first.values.length, SPEAKER_RELEVANCE_FEATURES.length);
  assert.equal(first.window.futureSamplesUsed, 0);
});

test("receitas são determinísticas e preservam diferenças acústicas", () => {
  const source = voicedPcm();
  const clean = renderSpeakerRelevanceRecipe({
    sourcePcm: source,
    decisionMs: 400,
    targetRmsDb: -20,
    seed: 7
  });
  const repeated = renderSpeakerRelevanceRecipe({
    sourcePcm: source,
    decisionMs: 400,
    targetRmsDb: -20,
    seed: 7
  });
  const distant = renderSpeakerRelevanceRecipe({
    sourcePcm: source,
    decisionMs: 400,
    targetRmsDb: -31,
    lowPassAlpha: 0.12,
    echoDelayMs: 80,
    echoGain: 0.35,
    seed: 7
  });

  assert.deepEqual(clean.pcm, repeated.pcm);
  assert.notDeepEqual(clean.pcm, distant.pcm);
  assert.notDeepEqual(
    extractSpeakerRelevanceFeatures(clean).values,
    extractSpeakerRelevanceFeatures(distant).values
  );
});

test("onset exige atividade sustentada e janela inválida falha fechado", () => {
  const source = voicedPcm(8_000, 1_600);
  assert.equal(findPcm16SpeechOnset(source), 1_600);
  assert.equal(findPcm16SpeechOnset(Buffer.alloc(8_000 * 2)), null);
  assert.throws(
    () => extractSpeakerRelevanceFeatures({
      pcm: source,
      onsetSample: 2_000,
      decisionSample: 1_000
    }),
    /janela causal/u
  );
});

test("extratores Node e navegador são numericamente idênticos", () => {
  const sourcePcm = voicedPcm();
  const rendered = renderSpeakerRelevanceRecipe({
    sourcePcm,
    sampleRate: 16_000,
    durationMs: 1_000,
    decisionMs: 560,
    targetRmsDb: -28,
    lowPassAlpha: 0.28,
    echoDelayMs: 70,
    echoGain: 0.3,
    noiseSnrDb: 18,
    seed: 42
  });
  const node = extractSpeakerRelevanceFeatures(rendered);
  const pcm16 = new Int16Array(
    rendered.pcm.buffer,
    rendered.pcm.byteOffset,
    rendered.pcm.length / 2
  ).slice(0, rendered.decisionSample);
  const browser = extractBrowserSpeakerRelevanceFeatures(pcm16, {
    sampleRate: rendered.sampleRate
  });
  assert.deepEqual(browser.values, node.values);
  assert.equal(browser.window.futureSamplesUsed, 0);
});
