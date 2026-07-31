import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERACTION_KERNEL_VERSION,
  createInteractionState,
  reduceInteraction
} from "../src/interaction/interaction-kernel.mjs";

function event(id, text) {
  return { type: "USER_TURN_FINAL", id, text };
}

test("correção reversível produz rollback e estado semântico determinísticos", () => {
  const initial = createInteractionState();
  const input = event("turn-1", "Marca para terça... não, sexta.");
  const first = reduceInteraction(initial, input);
  const replay = reduceInteraction(initial, input);

  assert.deepEqual(first, replay);
  assert.equal(first.kernelVersion, INTERACTION_KERNEL_VERSION);
  assert.equal(first.previousStateVersion, 0);
  assert.equal(first.state.version, 1);
  assert.deepEqual(first.state.semantic.committed, {
    slot: "weekday",
    value: "sexta",
    revisionId: "revision-1"
  });
  assert.equal(first.state.semantic.pendingConfirmation, null);
  assert.equal(first.state.semantic.revisions.length, 1);
  assert.equal(first.intents[0].type, "ROLLBACK");
  assert.equal(first.intents[0].current, "sexta");
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.state.semantic), true);
});

test("valor monetário corrigido abre confirmação sem commit nem eco", () => {
  const transition = reduceInteraction(
    createInteractionState(),
    event("turn-1", "Transfere 1500 reais... não, 150 reais.")
  );

  assert.equal(transition.state.semantic.committed, null);
  assert.equal(
    transition.state.semantic.pendingConfirmation.policy,
    "repeat-critical-value-before-commit"
  );
  assert.equal(
    transition.state.semantic.pendingConfirmation.proposedValue,
    "BRL 150"
  );
  assert.deepEqual(
    transition.intents.map((intent) => intent.type),
    ["WAIT", "SPEAK"]
  );
  const prompt = transition.intents.find(
    (intent) => intent.type === "SPEAK"
  ).content;
  assert.match(prompt, /qual é o valor final/iu);
  assert.doesNotMatch(prompt, /\b150\b/u);
});

test("repetição em novo turno confirma o valor e encerra a pendência", () => {
  const pending = reduceInteraction(
    createInteractionState(),
    event("turn-1", "Transfere 1500 reais... não, 150 reais.")
  );
  const confirmed = reduceInteraction(
    pending.state,
    event("turn-2", "O valor final é mil cento e cinquenta reais.")
  );

  assert.equal(confirmed.state.semantic.pendingConfirmation, null);
  assert.deepEqual(confirmed.state.semantic.committed, {
    slot: "amount",
    value: "BRL 1150",
    revisionId: "revision-1"
  });
  assert.equal(confirmed.state.semantic.revisions[0].obsolete, "BRL 1500");
  assert.equal(confirmed.state.semantic.revisions[0].current, "BRL 1150");
  assert.deepEqual(
    confirmed.intents.map((intent) => intent.type),
    ["ROLLBACK", "SPEAK"]
  );
  assert.match(
    confirmed.intents.find((intent) => intent.type === "SPEAK").content,
    /1150/u
  );
});

test("resposta ambígua mantém abstention e cancelamento limpa sem commit", () => {
  const pending = reduceInteraction(
    createInteractionState(),
    event("turn-1", "Faz um pix de 500 reais... não, 50 reais.")
  );
  const ambiguous = reduceInteraction(
    pending.state,
    event("turn-2", "Acho que é isso mesmo.")
  );

  assert.equal(ambiguous.state.semantic.committed, null);
  assert.equal(
    ambiguous.state.semantic.pendingConfirmation.id,
    pending.state.semantic.pendingConfirmation.id
  );
  assert.deepEqual(
    ambiguous.intents.map((intent) => intent.type),
    ["WAIT", "SPEAK"]
  );

  const cancelled = reduceInteraction(
    ambiguous.state,
    event("turn-3", "Cancela, deixa para lá.")
  );
  assert.equal(cancelled.state.semantic.committed, null);
  assert.equal(cancelled.state.semantic.pendingConfirmation, null);
  assert.deepEqual(
    cancelled.intents.map((intent) => intent.type),
    ["CANCEL", "SPEAK"]
  );
});

test("negação, dúvida e alternativa monetária não confirmam efeito", () => {
  const pending = reduceInteraction(
    createInteractionState(),
    event("turn-1", "Faz um pix de 500 reais... não, 50 reais.")
  );

  for (const [index, text] of [
    "O valor final não é 50 reais.",
    "Acho que é 50 reais.",
    "É 50 ou 500 reais?"
  ].entries()) {
    const transition = reduceInteraction(
      pending.state,
      event(`turn-uncertain-${index + 1}`, text)
    );
    assert.equal(transition.state.semantic.committed, null, text);
    assert.notEqual(
      transition.state.semantic.pendingConfirmation,
      null,
      text
    );
    assert.deepEqual(
      transition.intents.map((intent) => intent.type),
      ["WAIT", "SPEAK"],
      text
    );
  }
});

test("estado ou evento inválido falha fechado", () => {
  assert.throws(
    () => reduceInteraction({}, event("turn-1", "Oi")),
    /estado do kernel/iu
  );
  assert.throws(
    () => reduceInteraction(createInteractionState(), {
      type: "USER_TURN_FINAL",
      id: "turn-1",
      text: ""
    }),
    /texto/iu
  );
  assert.throws(
    () => reduceInteraction(createInteractionState(), {
      type: "EVENTO_DESCONHECIDO",
      id: "turn-1",
      text: "Oi"
    }),
    /evento/iu
  );
});
