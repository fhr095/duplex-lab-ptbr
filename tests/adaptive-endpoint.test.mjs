import test from "node:test";
import assert from "node:assert/strict";

import {
  decideEndpoint,
  looksIncompletePtBr
} from "../src/interaction/adaptive-endpoint.mjs";

test("encerra uma fala completa sem impor uma cauda longa", () => {
  assert.equal(
    decideEndpoint({
      silenceMs: 520,
      speechMs: 1_200,
      transcript: "Pode mudar a reunião para amanhã."
    }).action,
    "commit"
  );
});

test("não corta hesitação ou conectivo aberto como fim de turno", () => {
  for (const transcript of ["Eu queria, ahn", "Muda a reunião para"]) {
    const decision = decideEndpoint({
      silenceMs: 700,
      speechMs: 1_200,
      transcript
    });
    assert.equal(decision.action, "wait");
    assert.equal(decision.incomplete, true);
  }
});

test("espera a continuação de uma correção ainda aberta", () => {
  assert.equal(looksIncompletePtBr("sexta, não, na verdade"), true);
  assert.equal(
    decideEndpoint({
      silenceMs: 800,
      speechMs: 1_500,
      transcript: "sexta, não, na verdade"
    }).action,
    "wait"
  );
});

test("evento acústico curto sem texto não dispara resposta", () => {
  const decision = decideEndpoint({
    silenceMs: 600,
    speechMs: 180,
    transcript: ""
  });
  assert.equal(decision.action, "wait");
  assert.equal(decision.reason, "awaiting-transcript");
});

test("limite duro impede espera infinita mesmo com frase incompleta", () => {
  assert.equal(
    decideEndpoint({
      silenceMs: 1_500,
      speechMs: 1_500,
      transcript: "Eu queria mas"
    }).action,
    "commit"
  );
});
