import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_AUDIO_REFLEX_MODES,
  LocalAudioReflex,
  createLocalAudioReflexState,
  reduceLocalAudioReflex
} from "../web/local-audio-reflex.mjs";

function start(overrides = {}) {
  return {
    type: "USER_SPEECH_STARTED",
    assistantAudible: true,
    assistantPending: true,
    detector: "silero-vad-v6.2",
    probability: 0.87,
    triggerSampleStart: 1_000,
    turnId: "turn-1",
    ...overrides
  };
}

function window(sampleStart, probability, overrides = {}) {
  return {
    type: "VAD_CONTROL_WINDOW",
    sampleStart,
    probability,
    turnId: "turn-1",
    ...overrides
  };
}

test("baseline imediata preserva a pausa física existente", () => {
  const reflex = new LocalAudioReflex({
    mode: LOCAL_AUDIO_REFLEX_MODES.IMMEDIATE
  });
  const transition = reflex.dispatch(start());

  assert.equal(transition.state.status, "paused");
  assert.equal(transition.intents[0].type, "PAUSE_OUTPUT");
  assert.equal(transition.intents[0].reason, "immediate-or-non-gateable");
});

test("candidato exige duas janelas novas de evidência sustentada", () => {
  const initial = createLocalAudioReflexState({
    mode: LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED
  });
  const armed = reduceLocalAudioReflex(initial, start());

  assert.equal(armed.state.status, "armed");
  assert.equal(armed.intents[0].type, "WAIT_FOR_EVIDENCE");

  const duplicate = reduceLocalAudioReflex(
    armed.state,
    window(1_000, 0.99)
  );
  assert.deepEqual(duplicate.state, armed.state);
  assert.deepEqual(duplicate.intents, []);

  const first = reduceLocalAudioReflex(
    armed.state,
    window(1_512, 0.8)
  );
  assert.equal(first.state.status, "armed");
  assert.equal(first.state.supportingWindows, 1);
  assert.deepEqual(first.intents, []);

  const confirmed = reduceLocalAudioReflex(
    first.state,
    window(2_024, 0.81)
  );
  assert.equal(confirmed.state.status, "paused");
  assert.equal(confirmed.intents[0].type, "PAUSE_OUTPUT");
  assert.equal(confirmed.intents[0].reason, "sustained-acoustic-evidence");
  assert.equal(confirmed.intents[0].evidence.observedWindows, 2);
  assert.equal(Object.isFrozen(confirmed), true);
});

test("pico isolado não produz pausa perceptível", () => {
  const reflex = new LocalAudioReflex({
    mode: LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED
  });
  reflex.dispatch(start());
  reflex.dispatch(window(1_512, 0.79));
  reflex.dispatch(window(2_024, 0.71));
  const suppressed = reflex.dispatch({
    type: "USER_SPEECH_PAUSED",
    turnId: "turn-1"
  });

  assert.equal(suppressed.state.status, "suppressed");
  assert.equal(suppressed.intents[0].type, "CONTINUE_OUTPUT");
  assert.equal(
    suppressed.intents[0].reason,
    "insufficient-acoustic-evidence"
  );
});

test("final tardio de turno acusticamente rejeitado não vira novo turno", () => {
  const reflex = new LocalAudioReflex({
    mode: LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED
  });
  reflex.dispatch(start());
  reflex.dispatch(window(1_512, 0.73));
  reflex.dispatch(window(2_024, 0.71));
  reflex.dispatch({
    type: "USER_SPEECH_PAUSED",
    turnId: "turn-1"
  });
  const final = reflex.dispatch({
    type: "TRANSCRIPT_FINAL",
    turnId: "turn-1",
    text: "I'm"
  });

  assert.equal(final.state.status, "idle");
  assert.equal(final.intents[0].type, "SUPPRESS_TRANSCRIPT");
  assert.equal(final.intents[0].reason, "unconfirmed-acoustic-turn");
  assert.equal(final.intents[0].evidence.text, "I'm");
});

test("parcial útil tardia ainda recupera fala suave", () => {
  const reflex = new LocalAudioReflex({
    mode: LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED
  });
  reflex.dispatch(start());
  reflex.dispatch(window(1_512, 0.73));
  reflex.dispatch({
    type: "USER_SPEECH_PAUSED",
    turnId: "turn-1"
  });
  const delayed = reflex.dispatch({
    type: "TRANSCRIPT_PARTIAL",
    turnId: "turn-1",
    text: "espera"
  });

  assert.equal(delayed.state.status, "paused");
  assert.equal(delayed.intents[0].type, "PAUSE_OUTPUT");
  assert.equal(
    delayed.intents[0].reason,
    "delayed-transcript-evidence"
  );
});

test("parcial textual útil preserva fala suave que não sustentou o limiar", () => {
  const reflex = new LocalAudioReflex({
    mode: LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED
  });
  reflex.dispatch(start());
  const empty = reflex.dispatch({
    type: "TRANSCRIPT_PARTIAL",
    turnId: "turn-1",
    text: ""
  });
  assert.equal(empty.state.status, "armed");

  const useful = reflex.dispatch({
    type: "TRANSCRIPT_PARTIAL",
    turnId: "turn-1",
    text: "espera"
  });
  assert.equal(useful.state.status, "paused");
  assert.equal(useful.intents[0].type, "PAUSE_OUTPUT");
  assert.equal(useful.intents[0].reason, "transcript-evidence");
});

test("fala antes do primeiro áudio segura preparação sem esperar evidência", () => {
  const reflex = new LocalAudioReflex({
    mode: LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED
  });
  const transition = reflex.dispatch(start({
    assistantAudible: false,
    assistantPending: true
  }));

  assert.equal(transition.state.status, "paused");
  assert.equal(transition.intents[0].type, "PAUSE_OUTPUT");
});

test("sem saída do assistente o reflexo não toma autoridade", () => {
  const state = createLocalAudioReflexState({
    mode: LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED
  });
  const transition = reduceLocalAudioReflex(state, start({
    assistantAudible: false,
    assistantPending: false
  }));

  assert.deepEqual(transition.state, state);
  assert.deepEqual(transition.intents, []);
});

test("configuração e eventos inválidos falham fechados", () => {
  assert.throws(
    () => createLocalAudioReflexState({ mode: "mágico" }),
    /modo/iu
  );
  assert.throws(
    () => reduceLocalAudioReflex({}, start()),
    /estado/iu
  );
  assert.throws(
    () => reduceLocalAudioReflex(
      createLocalAudioReflexState(),
      { type: "EVENTO_DESCONHECIDO" }
    ),
    /não suportado/iu
  );
  assert.throws(
    () => reduceLocalAudioReflex(
      {
        ...createLocalAudioReflexState(),
        observedWindows: -1
      },
      start()
    ),
    /observedWindows/iu
  );
});
