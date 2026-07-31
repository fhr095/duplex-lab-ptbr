import assert from "node:assert/strict";
import test from "node:test";

import { simulateScenario } from "../src/eval/simulator.mjs";
import { BaselineInteractionPolicy } from "../src/policies/baseline-policy.mjs";

test("resultado que chega durante a fala espera e reentra uma única vez", () => {
  const scenario = {
    id: "late-result-user-floor",
    category: "delegation-race",
    description: "Resultado pronto enquanto o usuário mantém o turno.",
    timeline: [
      { atMs: 0, type: "user.speech.started" },
      {
        atMs: 200,
        type: "user.transcript.final",
        payload: { text: "Pesquise opções para mim." }
      },
      { atMs: 500, type: "user.speech.ended" },
      { atMs: 900, type: "user.speech.started" },
      {
        atMs: 1_050,
        type: "task.result",
        payload: { taskId: "task-1", summary: "Achei três opções." }
      },
      {
        atMs: 1_300,
        type: "user.transcript.final",
        payload: { text: "Enquanto isso, me diga oi." }
      },
      { atMs: 1_500, type: "user.speech.ended" }
    ],
    expectations: [
      {
        id: "resultado-reentra",
        kind: "required",
        event: "assistant.speech.started",
        occurrence: 3,
        after: "task.result",
        withinMs: 2_200
      }
    ]
  };

  const trace = simulateScenario(scenario, new BaselineInteractionPolicy());
  const results = trace.filter(
    (event) =>
      event.type === "assistant.speech.started" &&
      event.payload?.kind === "delegated-result"
  );
  const result = results[0];
  const userEnd = trace.findLast(
    (event) => event.type === "user.speech.ended"
  );

  assert.equal(results.length, 1);
  assert.ok(result.atMs > userEnd.atMs);
  assert.equal(result.payload.text, "Achei três opções.");
});
