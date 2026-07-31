import test from "node:test";
import assert from "node:assert/strict";

import { simulateScenario } from "../src/eval/simulator.mjs";
import { BaselineInteractionPolicy } from "../src/policies/baseline-policy.mjs";

function scenario(timeline) {
  return {
    id: "teste",
    category: "unit",
    description: "Cenário unitário da política.",
    timeline,
    expectations: [
      {
        id: "contrato-minimo",
        kind: "required",
        event: "user.speech.started"
      }
    ]
  };
}

function first(trace, type) {
  return trace.find((event) => event.type === type);
}

test("interrompe a própria fala em 80 ms", () => {
  const trace = simulateScenario(
    scenario([
      {
        atMs: 0,
        type: "assistant.speech.started",
        payload: { durationMs: 5_000 }
      },
      { atMs: 1_000, type: "user.speech.started" }
    ]),
    new BaselineInteractionPolicy()
  );

  assert.equal(first(trace, "assistant.speech.stopped").atMs, 1_080);
  assert.equal(
    trace.some(
      (event) =>
        event.type === "assistant.speech.finished" && event.atMs === 5_000
    ),
    false
  );
});

test("usa backchannel sem transformar hesitação em fim de turno", () => {
  const trace = simulateScenario(
    scenario([
      { atMs: 0, type: "user.speech.started" },
      { atMs: 700, type: "user.speech.paused" },
      { atMs: 1_000, type: "user.speech.resumed" },
      {
        atMs: 1_300,
        type: "user.transcript.final",
        payload: { text: "Eu ainda não terminei." }
      },
      { atMs: 1_600, type: "user.speech.ended" }
    ]),
    new BaselineInteractionPolicy()
  );

  assert.equal(first(trace, "assistant.backchannel").atMs, 820);
  const response = first(trace, "assistant.speech.started");
  assert.equal(response.atMs, 1_880);
});

test("delega trabalho complexo e cancela a tarefa explicitamente", () => {
  const trace = simulateScenario(
    scenario([
      { atMs: 0, type: "user.speech.started" },
      {
        atMs: 300,
        type: "user.transcript.final",
        payload: { text: "Pesquise e compare essas opções." }
      },
      { atMs: 700, type: "user.speech.ended" },
      { atMs: 1_200, type: "user.cancelled" }
    ]),
    new BaselineInteractionPolicy()
  );

  assert.equal(first(trace, "task.delegated").atMs, 760);
  assert.equal(first(trace, "task.cancelled").atMs, 1_220);
  assert.equal(first(trace, "task.cancelled").payload.taskId, "task-1");
});

test("registra rollback e preserva a última correção", () => {
  const trace = simulateScenario(
    scenario([
      { atMs: 0, type: "user.speech.started" },
      {
        atMs: 500,
        type: "user.correction",
        payload: { previous: "sexta", current: "sábado" }
      },
      {
        atMs: 800,
        type: "user.correction",
        payload: { previous: "sábado", current: "domingo" }
      },
      { atMs: 1_000, type: "user.speech.ended" }
    ]),
    new BaselineInteractionPolicy()
  );

  const rollbacks = trace.filter((event) => event.type === "state.rollback");
  assert.deepEqual(
    rollbacks.map((event) => event.payload.current),
    ["sábado", "domingo"]
  );
});
