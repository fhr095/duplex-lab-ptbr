import assert from "node:assert/strict";
import test from "node:test";

import {
  SPEAKER_RELEVANCE_CLASSES as SOURCE_CLASSES,
  SPEAKER_RELEVANCE_FEATURES as SOURCE_FEATURES,
  SPEAKER_RELEVANCE_FEATURE_VERSION
} from "../src/eval/speaker-relevance-features.mjs";
import {
  SPEAKER_RELEVANCE_CLASSES,
  SPEAKER_RELEVANCE_FEATURES,
  SPEAKER_RELEVANCE_SHADOW_VERSION,
  SpeakerRelevanceShadow,
  SpeakerRelevanceCausalRuntime,
  extractBrowserSpeakerRelevanceFeatures,
  predictSpeakerRelevance,
  validateSpeakerRelevanceCheckpoint
} from "../web/speaker-relevance-shadow.mjs";

function checkpoint() {
  return {
    schemaVersion: "speaker-relevance-checkpoint-v1",
    checkpointId: "speaker-relevance-test",
    featureVersion: SPEAKER_RELEVANCE_SHADOW_VERSION,
    featureNames: [...SPEAKER_RELEVANCE_FEATURES],
    classes: [...SPEAKER_RELEVANCE_CLASSES],
    modelSha256: `sha256:${"a".repeat(64)}`,
    model: {
      weights: [
        [2, ...Array(SPEAKER_RELEVANCE_FEATURES.length - 1).fill(0)],
        [-2, ...Array(SPEAKER_RELEVANCE_FEATURES.length - 1).fill(0)]
      ]
    },
    decision: {
      backgroundVetoConfidence: 0.8,
      backgroundAction: "CONTINUE_OUTPUT",
      directedAction: "DEFER_TO_DETERMINISTIC",
      lowConfidenceAction: "DEFER_TO_DETERMINISTIC"
    },
    runtime: {
      sampleRate: 16_000,
      decisionMs: 20,
      decisionSamples: 320,
      bufferSamples: 960,
      futureSamplesAllowed: 0
    },
    authority: { mode: "shadow", canProduceEffects: false }
  };
}

function features() {
  return {
    featureVersion: SPEAKER_RELEVANCE_SHADOW_VERSION,
    names: [...SPEAKER_RELEVANCE_FEATURES],
    values: [1, ...Array(SPEAKER_RELEVANCE_FEATURES.length - 1).fill(0)],
    window: { futureSamplesUsed: 0 }
  };
}

test("contrato de features é idêntico no treino e no runtime", () => {
  assert.equal(SPEAKER_RELEVANCE_SHADOW_VERSION, SPEAKER_RELEVANCE_FEATURE_VERSION);
  assert.deepEqual(SPEAKER_RELEVANCE_FEATURES, SOURCE_FEATURES);
  assert.deepEqual(SPEAKER_RELEVANCE_CLASSES, SOURCE_CLASSES);
});

test("checkpoint propõe em shadow e mapeia apenas fundo confiante", () => {
  const prediction = predictSpeakerRelevance(checkpoint(), features());
  const shadow = new SpeakerRelevanceShadow(checkpoint());

  assert.equal(prediction.rawLabel, "BACKGROUND_OR_NOT_DIRECTED");
  assert.equal(prediction.operationalLabel, "BACKGROUND_OR_NOT_DIRECTED");
  assert.equal(prediction.suggestedAction, "CONTINUE_OUTPUT");
  assert.equal(prediction.authority, false);
  assert.deepEqual(shadow.predict(features()), prediction);
  assert.equal(shadow.snapshot.authority, false);
});

test("baixo nível de confiança adia à regra e dados não causais falham", () => {
  const value = checkpoint();
  value.model.weights = value.model.weights.map(() =>
    Array(SPEAKER_RELEVANCE_FEATURES.length).fill(0)
  );
  const prediction = predictSpeakerRelevance(value, features());
  assert.equal(prediction.operationalLabel, "DIRECTED_TO_ASSISTANT");
  assert.equal(prediction.suggestedAction, "DEFER_TO_DETERMINISTIC");

  const future = features();
  future.window.futureSamplesUsed = 1;
  assert.throws(
    () => predictSpeakerRelevance(value, future),
    /não é causal/iu
  );
});

test("checkpoint com autoridade ou matriz adulterada falha fechado", () => {
  const authority = checkpoint();
  authority.authority.canProduceEffects = true;
  assert.equal(validateSpeakerRelevanceCheckpoint(authority).valid, false);
  assert.throws(() => new SpeakerRelevanceShadow(authority), /inválido/iu);

  const matrix = checkpoint();
  matrix.model.weights[0].pop();
  assert.equal(validateSpeakerRelevanceCheckpoint(matrix).valid, false);
});

test("runtime espera a janela causal completa e nunca produz efeitos", () => {
  const value = checkpoint();
  const runtime = new SpeakerRelevanceCausalRuntime(value);
  assert.deepEqual(runtime.observeSpeechStart({
    turnId: "turn-1",
    onsetSampleStart: 100
  }), []);
  assert.deepEqual(runtime.pushFrame({
    sampleStart: 0,
    pcm16: new Int16Array(320).fill(1_000)
  }), []);
  const completed = runtime.pushFrame({
    sampleStart: 320,
    pcm16: new Int16Array(320).fill(1_000)
  });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].decisionSample, 420);
  assert.equal(completed[0].futureSamplesUsed, 0);
  assert.equal(completed[0].authority, false);
  assert.equal(runtime.snapshot.decisionCount, 1);
  assert.throws(() => runtime.pushFrame({
    sampleStart: 640,
    sampleRate: 8_000,
    pcm16: new Int16Array(320)
  }), /inválido/iu);
  runtime.reset();
  assert.equal(runtime.snapshot.decisionCount, 0);
});

test("extrator browser retorna contrato causal completo", () => {
  const values = new Int16Array(8_960);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = Math.round(Math.sin(index / 7) * 8_000);
  }
  const extracted = extractBrowserSpeakerRelevanceFeatures(values);
  assert.equal(extracted.values.length, SPEAKER_RELEVANCE_FEATURES.length);
  assert.equal(extracted.window.decisionSample, 8_960);
  assert.equal(extracted.window.futureSamplesUsed, 0);
});
