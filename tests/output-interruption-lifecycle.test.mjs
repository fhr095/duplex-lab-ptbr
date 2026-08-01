import assert from "node:assert/strict";
import test from "node:test";

import {
  OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
  OutputInterruptionLifecycle,
  createOutputInterruptionState,
  reduceOutputInterruption
} from "../web/output-interruption-lifecycle.mjs";

function pause(overrides = {}) {
  return {
    type: "PAUSE_REQUESTED",
    turnId: "turn-1",
    outputEpoch: 4,
    hasAudibleOutput: true,
    hasAcousticOutput: true,
    hasActiveResponse: true,
    ...overrides
  };
}

function heldState(overrides = {}) {
  return reduceOutputInterruption(
    createOutputInterruptionState(),
    pause(overrides)
  ).state;
}

test("pausa audível vira um hold explícito e versionado", () => {
  const lifecycle = new OutputInterruptionLifecycle();
  const transition = lifecycle.dispatch(pause());

  assert.equal(
    transition.lifecycleVersion,
    OUTPUT_INTERRUPTION_LIFECYCLE_VERSION
  );
  assert.equal(transition.previousStateVersion, 0);
  assert.equal(transition.state.version, 1);
  assert.equal(transition.state.phase, "held");
  assert.equal(transition.state.turnId, "turn-1");
  assert.equal(transition.state.outputEpoch, 4);
  assert.equal(transition.state.pauseKind, "audible");
  assert.deepEqual(
    transition.intents.map((intent) => intent.type),
    ["PAUSE_OUTPUT"]
  );
  assert.equal(Object.isFrozen(transition), true);
  assert.equal(Object.isFrozen(transition.state), true);
});

test("preparação e resposta pendente são seguradas sem fingir áudio audível", () => {
  const acoustic = reduceOutputInterruption(
    createOutputInterruptionState(),
    pause({ hasAudibleOutput: false })
  );
  assert.equal(acoustic.state.phase, "held");
  assert.equal(acoustic.state.pauseKind, "acoustic-pending");
  assert.equal(acoustic.intents[0].type, "HOLD_OUTPUT");

  const response = reduceOutputInterruption(
    createOutputInterruptionState(),
    pause({
      hasAudibleOutput: false,
      hasAcousticOutput: false,
      hasActiveResponse: true
    })
  );
  assert.equal(response.state.pauseKind, "response-pending");
  assert.equal(response.intents[0].type, "HOLD_OUTPUT");
});

test("sem saída do assistente o lifecycle não toma autoridade", () => {
  const initial = createOutputInterruptionState();
  const transition = reduceOutputInterruption(initial, pause({
    hasAudibleOutput: false,
    hasAcousticOutput: false,
    hasActiveResponse: false
  }));

  assert.equal(transition.state.phase, "idle");
  assert.equal(transition.state.version, 0);
  assert.deepEqual(transition.intents, []);
  assert.equal(transition.reason, "no-output-to-hold");
});

test("backchannel retoma somente o mesmo áudio e a mesma época", () => {
  const lifecycle = new OutputInterruptionLifecycle();
  lifecycle.dispatch(pause());
  const requested = lifecycle.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 4,
    hasResumableAudio: true
  });

  assert.equal(requested.state.phase, "resuming");
  assert.equal(requested.state.resumeAttempt, 1);
  assert.equal(requested.intents[0].type, "RESUME_OUTPUT");
  assert.equal(requested.intents[0].resumeAttempt, 1);

  const resumed = lifecycle.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: 1
  });
  assert.equal(resumed.state.phase, "idle");
  assert.equal(resumed.intents[0].type, "SETTLE_RESUMED");
});

test("áudio obsoleto é liberado sem tentativa de retomada", () => {
  for (const event of [
    {
      type: "DISMISS_REQUESTED",
      currentOutputEpoch: 5,
      hasResumableAudio: true
    },
    {
      type: "DISMISS_REQUESTED",
      currentOutputEpoch: 4,
      hasResumableAudio: false
    }
  ]) {
    const transition = reduceOutputInterruption(heldState(), event);
    assert.equal(transition.state.phase, "idle");
    assert.equal(transition.intents[0].type, "SETTLE_WITHOUT_RESUME");
    assert.equal(transition.reason, "output-no-longer-resumable");
  }
});

test("nova fala durante play cancela retomada e invalida seu resultado", () => {
  const lifecycle = new OutputInterruptionLifecycle();
  lifecycle.dispatch(pause());
  lifecycle.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 4,
    hasResumableAudio: true
  });

  const repaused = lifecycle.dispatch(pause({ turnId: "turn-2" }));
  assert.equal(repaused.state.phase, "held");
  assert.equal(repaused.state.resumeAttempt, 2);
  assert.equal(repaused.intents[0].type, "CANCEL_RESUME_AND_PAUSE");

  const stale = lifecycle.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: 1
  });
  assert.equal(stale.state.phase, "held");
  assert.equal(stale.intents[0].type, "PAUSE_STALE_RESUME");
  assert.equal(stale.reason, "stale-resume-result");
});

test("confirmação durante play mantém resultado tardio incapaz de reabrir voz", () => {
  const lifecycle = new OutputInterruptionLifecycle();
  lifecycle.dispatch(pause());
  lifecycle.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 4,
    hasResumableAudio: true
  });
  const confirmed = lifecycle.dispatch({
    type: "CONFIRM_REQUESTED",
    reason: "fala útil"
  });

  assert.equal(confirmed.state.phase, "confirmed");
  assert.equal(confirmed.intents[0].type, "CONFIRM_INTERRUPTION");

  const stale = lifecycle.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: 1
  });
  assert.equal(stale.state.phase, "confirmed");
  assert.equal(stale.intents[0].type, "PAUSE_STALE_RESUME");
});

test("resultado antigo não sabota uma retomada mais nova", () => {
  const lifecycle = new OutputInterruptionLifecycle();
  lifecycle.dispatch(pause());
  lifecycle.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 4,
    hasResumableAudio: true
  });
  lifecycle.dispatch(pause({ turnId: "turn-2" }));
  lifecycle.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 4,
    hasResumableAudio: true
  });

  const oldResult = lifecycle.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: 1
  });
  assert.equal(oldResult.state.phase, "resuming");
  assert.equal(oldResult.state.resumeAttempt, 3);
  assert.equal(oldResult.intents[0].type, "IGNORE_STALE_RESUME");

  const currentResult = lifecycle.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: 3
  });
  assert.equal(currentResult.state.phase, "idle");
  assert.equal(currentResult.intents[0].type, "SETTLE_RESUMED");
});

test("falha de play libera o hold e não deixa promessa pendurada", () => {
  const lifecycle = new OutputInterruptionLifecycle();
  lifecycle.dispatch(pause());
  lifecycle.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 4,
    hasResumableAudio: true
  });
  const failed = lifecycle.dispatch({
    type: "RESUME_FAILED",
    resumeAttempt: 1
  });

  assert.equal(failed.state.phase, "idle");
  assert.equal(failed.intents[0].type, "RELEASE_OUTPUT");
});

test("clear é idempotente e encerra qualquer fase não ociosa", () => {
  const lifecycle = new OutputInterruptionLifecycle();
  assert.equal(lifecycle.clear().state.version, 0);

  lifecycle.dispatch(pause());
  const cleared = lifecycle.clear("session-ended");
  assert.equal(cleared.state.phase, "idle");
  assert.equal(cleared.intents[0].type, "SETTLE_CLEARED");
  assert.equal(cleared.intents[0].reason, "session-ended");

  const repeated = lifecycle.clear("again");
  assert.equal(repeated.state.version, cleared.state.version);
  assert.deepEqual(repeated.intents, []);
});

test("eventos e estados inválidos falham fechados", () => {
  assert.throws(
    () => reduceOutputInterruption({}, pause()),
    /estado/iu
  );
  assert.throws(
    () => reduceOutputInterruption(
      createOutputInterruptionState(),
      { type: "MAGIC" }
    ),
    /não suportado/iu
  );
  assert.throws(
    () => reduceOutputInterruption(
      createOutputInterruptionState(),
      pause({ outputEpoch: -1 })
    ),
    /outputEpoch/iu
  );
  assert.throws(
    () => reduceOutputInterruption(
      {
        ...createOutputInterruptionState(),
        resumeAttempt: -1
      },
      pause()
    ),
    /resumeAttempt/iu
  );
});
