import assert from "node:assert/strict";
import test from "node:test";

import {
  selectFinalCommitGraceMs
} from "../src/interaction/commit-grace.mjs";

test("mantém conversa comum no commit rápido", () => {
  assert.equal(
    selectFinalCommitGraceMs({
      baseMs: 220,
      effectfulMs: 500,
      transcript: "Oi, tudo bem?"
    }),
    220
  );
});

test("reserva janela de correção para ação com efeito", () => {
  for (const transcript of [
    "Marque para sexta.",
    "Não envie esse e-mail.",
    "Quero que você mude a reunião.",
    "Autoriza no nome de Ana.",
    "Executa às oito horas.",
    "O pagamento é de oitenta reais."
  ]) {
    assert.equal(
      selectFinalCommitGraceMs({
        baseMs: 220,
        effectfulMs: 500,
        transcript
      }),
      500
    );
  }
});
