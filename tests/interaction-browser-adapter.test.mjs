import assert from "node:assert/strict";
import test from "node:test";

import {
  createInteractionState,
  reduceInteraction
} from "../src/interaction/interaction-kernel.mjs";
import {
  projectInteractionTransition
} from "../web/interaction-browser-adapter.mjs";

function event(id, text) {
  return { type: "USER_TURN_FINAL", id, text };
}

test("navegador projeta a decisão crítica sem manter política paralela", () => {
  const transition = reduceInteraction(
    createInteractionState(),
    event("turn-1", "Transfere 1500 reais, não, 150 reais.")
  );
  const projection = projectInteractionTransition(transition);

  assert.equal(projection.authority, "backend-interaction-runtime");
  assert.equal(projection.semanticState, null);
  assert.equal(projection.semanticRevisions.length, 0);
  assert.equal(
    projection.pendingConfirmation.policy,
    "repeat-critical-value-before-commit"
  );
  assert.deepEqual(
    projection.traceEvents.map((eventItem) => eventItem.type),
    ["state.pending-confirmation", "assistant.safety-confirmation"]
  );
});

test("runtime, kernel e projeção browser preservam a mesma revisão", () => {
  const pending = reduceInteraction(
    createInteractionState(),
    event("turn-1", "Transfere 1500 reais, não, 150 reais.")
  );
  const confirmed = reduceInteraction(
    pending.state,
    event("turn-2", "O valor final é 1150 reais.")
  );
  const projection = projectInteractionTransition(confirmed);
  const rollback = JSON.parse(
    projection.traceEvents.find(
      (eventItem) => eventItem.type === "state.rollback"
    ).detail
  );

  assert.deepEqual(projection.semanticState, confirmed.state.semantic.committed);
  assert.deepEqual(
    projection.semanticRevisions,
    confirmed.state.semantic.revisions
  );
  assert.equal(rollback.revisionId, projection.semanticState.revisionId);
  assert.equal(rollback.current, "BRL 1150");
  assert.equal(
    projection.traceEvents.some(
      (eventItem) => eventItem.type === "assistant.safety-confirmed"
    ),
    true
  );
});

test("transição ausente ou adulterada não ganha autoridade no browser", () => {
  assert.throws(
    () => projectInteractionTransition(null),
    /transição/iu
  );
  assert.throws(
    () => projectInteractionTransition({
      kernelVersion: "desconhecido",
      state: {},
      intents: []
    }),
    /kernel/iu
  );
});
