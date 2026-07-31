import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileFinalTranscript
} from "../src/asr/final-reconciliation.mjs";

test("preserva a final Parakeet quando ela permanece em português", () => {
  assert.deepEqual(
    reconcileFinalTranscript({
      engine: "parakeet",
      finalText: "Pode continuar.",
      provisionalText: "Pode continuar"
    }),
    {
      text: "Pode continuar.",
      source: "final",
      reason: null
    }
  );
});

test("recupera parcial local quando Parakeet troca claramente para inglês", () => {
  assert.deepEqual(
    reconcileFinalTranscript({
      engine: "parakeet",
      finalText: "Yeah, good time to me.",
      provisionalText: "Legal, gostava também."
    }),
    {
      text: "Legal, gostava também.",
      source: "partial-fallback",
      reason: "english-language-flip"
    }
  );
});

test("recupera parcial em final vazia ou no ambíguo", () => {
  assert.equal(
    reconcileFinalTranscript({
      engine: "parakeet",
      finalText: "",
      provisionalText: "E o modo de"
    }).reason,
    "empty-parakeet-final"
  );
  assert.equal(
    reconcileFinalTranscript({
      engine: "parakeet",
      finalText: "No.",
      provisionalText: "Não, eu..."
    }).reason,
    "ambiguous-no-language-flip"
  );
});

test("não aplica heurística de um engine a outro", () => {
  assert.equal(
    reconcileFinalTranscript({
      engine: "whisper",
      finalText: "You know",
      provisionalText: "Que nós"
    }).text,
    "You know"
  );
});

test("expõe conflito numérico crítico entre parcial e final sem escolher silenciosamente", () => {
  assert.deepEqual(
    reconcileFinalTranscript({
      engine: "parakeet",
      finalText: "Transfere 1500 reais. Não, 150 reais.",
      provisionalText: "Não, mil cento e cinquenta"
    }),
    {
      text: "Transfere 1500 reais. Não, 150 reais.",
      source: "final",
      reason: null,
      criticalConflict: {
        kind: "numeric-correction-conflict",
        finalValue: 150,
        provisionalValue: 1150,
        alternatives: [150, 1150],
        policy: "clarify-before-commit"
      }
    }
  );
});

test("detecta o mesmo conflito quando a hipótese parcial usa algarismos", () => {
  assert.deepEqual(
    reconcileFinalTranscript({
      engine: "parakeet",
      finalText: "Transfere 1500 reais. Não, 150 reais.",
      provisionalText: "Não, 1550."
    }).criticalConflict,
    {
      kind: "numeric-correction-conflict",
      finalValue: 150,
      provisionalValue: 1550,
      alternatives: [150, 1550],
      policy: "clarify-before-commit"
    }
  );
});

test("marca número crítico instável mesmo quando o verbo da ação sumiu", () => {
  assert.deepEqual(
    reconcileFinalTranscript({
      engine: "parakeet",
      finalText: "Sete mil e quinhentos reais.",
      provisionalText: "Eu não sei o que ele ia."
    }).criticalInstability,
    {
      kind: "low-agreement-critical-number",
      overlapRatio: 0,
      policy: "extend-commit-grace"
    }
  );
});
