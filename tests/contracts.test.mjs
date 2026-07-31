import test from "node:test";
import assert from "node:assert/strict";

import { validateEvent } from "../src/contracts/events.mjs";
import {
  validateScenario,
  validateScenarioPack
} from "../src/eval/scenario.mjs";

test("aceita um evento temporal válido", () => {
  const event = {
    atMs: 120,
    type: "user.speech.started",
    payload: {}
  };

  assert.equal(validateEvent(event), event);
});

test("rejeita tipo de evento fora do contrato", () => {
  assert.throws(
    () => validateEvent({ atMs: 0, type: "user.maybe.finished" }),
    /desconhecido/
  );
});

test("rejeita timeline fora de ordem", () => {
  assert.throws(
    () =>
      validateScenario({
        id: "fora-de-ordem",
        category: "contract",
        description: "Cenário inválido de propósito.",
        timeline: [
          { atMs: 100, type: "user.speech.started" },
          { atMs: 50, type: "user.speech.ended" }
        ],
        expectations: [
          {
            id: "alguma-resposta",
            kind: "required",
            event: "assistant.speech.started"
          }
        ]
      }),
    /ordenada/
  );
});

test("rejeita ids de cenário duplicados no pack congelado", () => {
  const scenario = {
    id: "duplicado",
    category: "contract",
    description: "Cenário mínimo.",
    timeline: [{ atMs: 0, type: "user.speech.started" }],
    expectations: [
      {
        id: "sem-resposta",
        kind: "forbidden",
        event: "assistant.speech.started"
      }
    ]
  };

  assert.throws(
    () =>
      validateScenarioPack({
        schemaVersion: 1,
        id: "pack",
        scenarios: [scenario, structuredClone(scenario)]
      }),
    /duplicado/
  );
});
