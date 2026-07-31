import assert from "node:assert/strict";
import test from "node:test";

import {
  assessTranscriptPlausibility
} from "../src/asr/transcript-plausibility.mjs";

test("aceita fala curta e conversa em velocidade humana", () => {
  assert.equal(
    assessTranscriptPlausibility({
      text: "sim",
      audioMs: 300
    }).pass,
    true
  );
  assert.equal(
    assessTranscriptPlausibility({
      text: "Espera, eu quis dizer outra coisa.",
      audioMs: 2_200
    }).pass,
    true
  );
});

test("bloqueia texto impossível e repetição degenerada do ASR", () => {
  const text = `Ainda que ${"o que é ".repeat(70)}`;
  const result = assessTranscriptPlausibility({ text, audioMs: 1_100 });

  assert.equal(result.pass, false);
  assert.ok(result.reasons.includes("impossible-speaking-rate"));
  assert.ok(result.reasons.includes("degenerate-phrase-repetition"));
});

test("não pune repetição legítima curta", () => {
  const result = assessTranscriptPlausibility({
    text: "não, não, espera",
    audioMs: 1_000
  });
  assert.equal(result.pass, true);
});
