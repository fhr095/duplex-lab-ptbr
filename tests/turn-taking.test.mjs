import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPotentialBargeIn,
  isExplicitTaskCancellation
} from "../web/turn-taking.mjs";

test("ruído sem transcrição não confirma interrupção", () => {
  assert.deepEqual(classifyPotentialBargeIn(""), {
    kind: "empty",
    shouldInterrupt: false,
    tokens: []
  });
});

test("backchannels curtos acompanham a fala sem cancelá-la", () => {
  for (const text of ["Mm.", "Aham", "hm", "Uhum.", "Uh-huh."]) {
    assert.equal(
      classifyPotentialBargeIn(text).shouldInterrupt,
      false,
      text
    );
  }
});

test("negação, correção e conteúdo novo confirmam barge-in", () => {
  for (const text of [
    "não",
    "espera",
    "sim",
    "ok",
    "certo",
    "entendi",
    "tá certo",
    "eu quis dizer sexta",
    "sim, mas muda o horário"
  ]) {
    assert.equal(
      classifyPotentialBargeIn(text).shouldInterrupt,
      true,
      text
    );
  }
});

test("cancelamento explícito de tarefa usa vocabulário estreito", () => {
  for (const text of [
    "Deixa para lá.",
    "Deixa isso pra lá",
    "Cancela essa tarefa.",
    "Não precisa mais.",
    "Pode parar."
  ]) {
    assert.equal(isExplicitTaskCancellation(text), true, text);
  }

  for (const text of [
    "para domingo",
    "cancela a reunião de amanhã",
    "não, continua",
    "pesquise como cancelar a reserva"
  ]) {
    assert.equal(isExplicitTaskCancellation(text), false, text);
  }
});
