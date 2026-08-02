import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0017_SEMANTIC_CLASSES,
  EXP0017_SEMANTIC_FEATURE_NAMES,
  EXP0017_SEMANTIC_HASH_DIMENSION,
  EXP0017_SEMANTIC_OBSERVATION_VERSION,
  createExp0017SemanticCheckpoint,
  extractExp0017SemanticFeatures,
  hashExp0017SemanticNgram,
  runExp0017SemanticProbe,
  validateExp0017SemanticCheckpoint,
  validateExp0017SemanticObservation
} from "../src/eval/exp-0017-semantic-probe.mjs";

function aRef() {
  return {
    rawLabel: "DIRECTED_TO_ASSISTANT",
    operationalLabel: "DIRECTED_TO_ASSISTANT",
    suggestedAction: "DEFER_TO_DETERMINISTIC",
    probabilities: {
      BACKGROUND_OR_NOT_DIRECTED: 0.3,
      DIRECTED_TO_ASSISTANT: 0.7
    },
    authority: false
  };
}

function observation(overrides = {}) {
  return {
    schemaVersion: EXP0017_SEMANTIC_OBSERVATION_VERSION,
    observationId: "semantic-probe-1",
    causalWindow: {
      onsetSample: 1_000,
      decisionSample: 9_960,
      sampleRate: 16_000,
      futureSamplesUsed: 0
    },
    text: {
      source: "oracle-prefix",
      value: "Aham, entendi.",
      audioEndSample: 8_000
    },
    assistant: { speaking: true, held: false },
    aRef: aRef(),
    ...overrides
  };
}

function classifier() {
  const featureCount = EXP0017_SEMANTIC_FEATURE_NAMES.length;
  const background = Array(featureCount).fill(0);
  const directed = Array(featureCount).fill(0);
  const textPresent = EXP0017_SEMANTIC_FEATURE_NAMES.indexOf("textPresent");
  background[textPresent] = 4;
  directed[textPresent] = -4;
  return {
    algorithm: "full-batch-multinomial-logistic-regression-v1",
    classNames: [...EXP0017_SEMANTIC_CLASSES],
    featureCount,
    weights: [background, directed]
  };
}

function checkpoint() {
  return createExp0017SemanticCheckpoint({
    checkpointId: "semantic-test",
    classifier: classifier(),
    backgroundVetoConfidence: 0.8
  });
}

test("features textuais são determinísticas, pequenas e estritamente causais", () => {
  const first = extractExp0017SemanticFeatures(observation());
  const second = extractExp0017SemanticFeatures(observation());

  assert.deepEqual(first, second);
  assert.equal(first.values.length, 7 + EXP0017_SEMANTIC_HASH_DIMENSION);
  assert.deepEqual(first.names, EXP0017_SEMANTIC_FEATURE_NAMES);
  assert.equal(first.normalizedText, "aham entendi");
  assert.equal(first.window.textAudioEndSample, 8_000);
  assert.equal(first.window.futureSamplesUsed, 0);
});

test("texto posterior à decisão e futuro declarado falham fechado", () => {
  const lateText = observation({
    text: {
      source: "oracle-prefix",
      value: "texto futuro",
      audioEndSample: 9_961
    }
  });
  assert.equal(validateExp0017SemanticObservation(lateText).valid, false);
  assert.throws(
    () => extractExp0017SemanticFeatures(lateText),
    /posterior à decisão/iu
  );

  const future = observation({
    causalWindow: {
      onsetSample: 1_000,
      decisionSample: 9_960,
      sampleRate: 16_000,
      futureSamplesUsed: 1
    }
  });
  assert.equal(validateExp0017SemanticObservation(future).valid, false);
  assert.throws(
    () => extractExp0017SemanticFeatures(future),
    /amostras futuras/iu
  );
});

test("ausência de texto devolve exatamente a proposta A-ref", () => {
  const reference = aRef();
  const input = observation({ text: null, aRef: reference });
  const ticks = [10, 10.2];
  const result = runExp0017SemanticProbe({
    observation: input,
    now: () => ticks.shift()
  });

  assert.equal(result.mode, "a-ref-fallback");
  assert.equal(result.usedSemanticText, false);
  assert.equal(result.prediction, reference);
  assert.equal(result.features, null);
  assert.ok(Math.abs(result.latencyMs - 0.2) < 1e-12);
  assert.equal(result.authority, false);
});

test("estado speaking/held ocupa features explícitas e independentes", () => {
  const speaking = extractExp0017SemanticFeatures(observation());
  const held = extractExp0017SemanticFeatures(observation({
    assistant: { speaking: false, held: true }
  }));
  const speakingIndex = EXP0017_SEMANTIC_FEATURE_NAMES.indexOf(
    "assistantSpeaking"
  );
  const heldIndex = EXP0017_SEMANTIC_FEATURE_NAMES.indexOf("assistantHeld");

  assert.equal(speaking.values[speakingIndex], 1);
  assert.equal(speaking.values[heldIndex], 0);
  assert.equal(held.values[speakingIndex], 0);
  assert.equal(held.values[heldIndex], 1);
});

test("colisões do hashing permanecem determinísticas e com sinal estável", () => {
  const byIndex = new Map();
  let collision = null;
  for (let value = 0; value < 1_000 && collision === null; value += 1) {
    const ngram = `tri${value}`;
    const hashed = hashExp0017SemanticNgram(ngram);
    const previous = byIndex.get(hashed.index);
    if (previous && previous.ngram !== ngram) {
      collision = { first: previous, second: { ngram, hashed } };
    } else {
      byIndex.set(hashed.index, { ngram, hashed });
    }
  }

  assert.ok(collision, "o teste precisa encontrar ao menos uma colisão");
  assert.equal(collision.first.hashed.index, collision.second.hashed.index);
  assert.deepEqual(
    hashExp0017SemanticNgram(collision.first.ngram),
    collision.first.hashed
  );
  assert.deepEqual(
    hashExp0017SemanticNgram(collision.second.ngram),
    collision.second.hashed
  );
});

test("probe consome o softmax existente, mede latência e fica em shadow", () => {
  const ticks = [100, 101.25];
  const result = runExp0017SemanticProbe({
    observation: observation(),
    checkpoint: checkpoint(),
    now: () => ticks.shift()
  });

  assert.equal(result.mode, "semantic-shadow");
  assert.equal(result.usedSemanticText, true);
  assert.equal(result.prediction.rawLabel, "BACKGROUND_OR_NOT_DIRECTED");
  assert.equal(
    result.prediction.operationalLabel,
    "BACKGROUND_OR_NOT_DIRECTED"
  );
  assert.equal(result.prediction.suggestedAction, "CONTINUE_OUTPUT");
  assert.equal(result.latencyMs, 1.25);
  assert.equal(result.futureSamplesUsed, 0);
  assert.equal(result.prediction.authority, false);
  assert.equal(result.authority, false);
});

test("tampering de pesos, contrato, autoridade e A-ref é rejeitado", () => {
  const weights = structuredClone(checkpoint());
  weights.classifier.weights[0][0] = 999;
  assert.equal(validateExp0017SemanticCheckpoint(weights).valid, false);
  assert.throws(
    () => runExp0017SemanticProbe({
      observation: observation(),
      checkpoint: weights
    }),
    /hash do classificador divergente/iu
  );

  const authority = structuredClone(checkpoint());
  authority.authority.canProduceEffects = true;
  assert.equal(validateExp0017SemanticCheckpoint(authority).valid, false);

  const reference = aRef();
  reference.authority = true;
  const invalidObservation = observation({ aRef: reference });
  assert.equal(
    validateExp0017SemanticObservation(invalidObservation).valid,
    false
  );
  assert.throws(
    () => runExp0017SemanticProbe({
      observation: invalidObservation,
      checkpoint: checkpoint()
    }),
    /aRef rompe/iu
  );
});
