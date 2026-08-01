import assert from "node:assert/strict";
import test from "node:test";

import {
  ACOUSTIC_REFLEX_CLASSES,
  ACOUSTIC_REFLEX_FEATURES,
  AcousticReflexShadow,
  acousticReflexTeacherLabel,
  extractAcousticReflexFeatures,
  isAcousticReflexDecisionPoint,
  predictAcousticReflex,
  validateAcousticReflexCheckpoint
} from "../web/acoustic-reflex-shadow.mjs";
import {
  createLocalAudioReflexState,
  reduceLocalAudioReflex
} from "../web/local-audio-reflex.mjs";

function checkpoint() {
  return {
    schemaVersion: "acoustic-reflex-checkpoint-v1",
    checkpointId: "test-checkpoint",
    featureVersion: "acoustic-reflex-shadow-v0.1",
    featureNames: [...ACOUSTIC_REFLEX_FEATURES],
    classes: [...ACOUSTIC_REFLEX_CLASSES],
    modelSha256: `sha256:${"a".repeat(64)}`,
    model: {
      weights: [
        [0, 2, 1, 0, 0, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0, 3, 3, 0],
        [0, 0, 0, 4, 0, 0, 0, 0, 0]
      ]
    }
  };
}

function startEvent(overrides = {}) {
  return {
    type: "USER_SPEECH_STARTED",
    assistantAudible: true,
    assistantPending: true,
    detector: "silero-vad-v6.2",
    probability: 0.91,
    triggerSampleStart: 512,
    turnId: "turn-1",
    ...overrides
  };
}

test("features acústicas usam somente estado anterior e evento corrente", () => {
  const state = createLocalAudioReflexState({ mode: "evidence-gated" });
  const features = extractAcousticReflexFeatures(state, startEvent());

  assert.deepEqual(features.names, ACOUSTIC_REFLEX_FEATURES);
  assert.deepEqual(features.values, [1, 1, 0, 0, 0.91, 0, 0, 0, 0]);
  assert.equal(isAcousticReflexDecisionPoint(state, startEvent()), true);
  assert.equal(
    isAcousticReflexDecisionPoint(state, {
      ...startEvent(),
      assistantAudible: false
    }),
    false
  );
});

test("oráculo traduz coleta, pausa e continuação sem olhar o futuro", () => {
  const initial = createLocalAudioReflexState({ mode: "evidence-gated" });
  const started = reduceLocalAudioReflex(initial, startEvent());
  assert.equal(
    acousticReflexTeacherLabel(initial, startEvent(), started),
    "WAIT_FOR_EVIDENCE"
  );

  const firstWindow = {
    type: "VAD_CONTROL_WINDOW",
    turnId: "turn-1",
    probability: 0.8,
    sampleStart: 1024
  };
  const collecting = reduceLocalAudioReflex(started.state, firstWindow);
  assert.equal(
    acousticReflexTeacherLabel(started.state, firstWindow, collecting),
    "WAIT_FOR_EVIDENCE"
  );

  const paused = reduceLocalAudioReflex(collecting.state, {
    type: "USER_SPEECH_PAUSED",
    turnId: "turn-1"
  });
  assert.equal(
    acousticReflexTeacherLabel(
      collecting.state,
      { type: "USER_SPEECH_PAUSED", turnId: "turn-1" },
      paused
    ),
    "CONTINUE_OUTPUT"
  );
});

test("checkpoint produz distribuição determinística e nunca autoridade", () => {
  const state = createLocalAudioReflexState({ mode: "evidence-gated" });
  const prediction = predictAcousticReflex(
    checkpoint(),
    state,
    startEvent()
  );
  const shadow = new AcousticReflexShadow(checkpoint());

  assert.equal(prediction.proposal, "WAIT_FOR_EVIDENCE");
  assert.ok(Math.abs(
    Object.values(prediction.probabilities).reduce(
      (sum, value) => sum + value,
      0
    ) - 1
  ) < 1e-12);
  assert.deepEqual(shadow.predict(state, startEvent()), prediction);
  assert.equal(shadow.snapshot.authority, false);
  assert.equal(validateAcousticReflexCheckpoint(checkpoint()).valid, true);
});

test("checkpoint adulterado e evento não causal falham fechados", () => {
  const invalid = checkpoint();
  invalid.model.weights[0].pop();
  assert.equal(validateAcousticReflexCheckpoint(invalid).valid, false);
  assert.throws(() => new AcousticReflexShadow(invalid), /inválido/iu);
  assert.throws(
    () => extractAcousticReflexFeatures(
      createLocalAudioReflexState({ mode: "evidence-gated" }),
      { type: "TRANSCRIPT_FINAL" }
    ),
    /ponto de decisão/iu
  );
});
