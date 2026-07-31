import test from "node:test";
import assert from "node:assert/strict";

import { createLocalBrain } from "../src/brain/local-brain.mjs";

test("resposta simples não cria trabalho assíncrono", () => {
  const brain = createLocalBrain({ idFactory: () => "fixed-id" });
  const plan = brain.planTurn("Oi, tudo bem?");

  assert.equal(plan.mode, "direct");
  assert.match(plan.response, /ouvindo/);
});

test("pesquisa vira delegação substituível por qualquer LLM", () => {
  const brain = createLocalBrain({
    idFactory: () => "fixed-id",
    taskDelayMs: 123
  });
  const plan = brain.planTurn("Pesquise e compare as opções.");

  assert.equal(plan.mode, "delegate");
  assert.equal(plan.task.id, "fixed-id");
  assert.equal(plan.task.delayMs, 123);
  assert.equal(plan.task.simulated, true);
});
