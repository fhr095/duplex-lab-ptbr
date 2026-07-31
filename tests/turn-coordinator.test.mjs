import assert from "node:assert/strict";
import test from "node:test";

import { createLocalBrain } from "../src/brain/local-brain.mjs";
import {
  createTurnCoordinator
} from "../src/interaction/turn-coordinator.mjs";

test("coordenador fecha confirmação crítica em dois turnos da mesma sessão", () => {
  const coordinator = createTurnCoordinator({
    planner: createLocalBrain({ idFactory: () => "task-fixed" })
  });
  const pending = coordinator.planTurn({
    sessionId: "session-a",
    turnId: "turn-1",
    text: "Transfere 1500 reais... não, 150 reais."
  });

  assert.equal(pending.safety.confirmationRequired, true);
  assert.equal(pending.interaction.state.semantic.committed, null);
  assert.match(pending.response, /qual é o valor final/iu);

  const confirmed = coordinator.planTurn({
    sessionId: "session-a",
    turnId: "turn-2",
    text: "O valor final é 1150 reais."
  });
  assert.equal(confirmed.safety.confirmationRequired, false);
  assert.equal(confirmed.safety.providerBypass, true);
  assert.equal(
    confirmed.interaction.state.semantic.committed.value,
    "BRL 1150"
  );
  assert.match(confirmed.response, /1150/u);
  assert.equal(coordinator.sessionCount, 1);
});

test("mesmo turnId não duplica revisão e sessões não compartilham estado", () => {
  const coordinator = createTurnCoordinator();
  const input = {
    sessionId: "session-a",
    turnId: "turn-1",
    text: "Marca terça, não, sexta."
  };
  const first = coordinator.planTurn(input);
  const retry = coordinator.planTurn({ ...input });
  const other = coordinator.planTurn({
    sessionId: "session-b",
    turnId: "turn-1",
    text: "Oi"
  });

  assert.deepEqual(retry.interaction, first.interaction);
  assert.equal(
    coordinator.snapshot("session-a").semantic.revisions.length,
    1
  );
  assert.equal(other.interaction.state.semantic.revisions.length, 0);
});

test("reset encerra a autoridade da sessão anterior", () => {
  const coordinator = createTurnCoordinator();
  coordinator.planTurn({
    sessionId: "session-a",
    turnId: "turn-1",
    text: "Faz um pix de 500 reais, não, 50 reais."
  });
  assert.equal(coordinator.reset("session-a"), true);
  assert.equal(coordinator.snapshot("session-a"), null);
});
