import test from "node:test";
import assert from "node:assert/strict";

import {
  editDistance,
  normalizeTranscript,
  scoreTranscript
} from "../src/eval/transcript-metrics.mjs";

test("mede inserções, remoções e substituições por palavra", () => {
  assert.equal(editDistance(["um", "dois"], ["um", "três"]), 1);
  assert.equal(editDistance(["um"], ["um", "dois"]), 1);
  assert.equal(editDistance(["um", "dois"], ["um"]), 1);
});

test("normaliza números escritos e em algarismos sem ocultar o WER literal", () => {
  const score = scoreTranscript(
    "Mude do dia quinze para o dia vinte e três.",
    "Mude do dia 15 para o dia 23."
  );

  assert.equal(score.wer, 0);
  assert.ok(score.literalWer > 0);
});

test("normaliza a grafia soletrada de uma hesitação", () => {
  assert.equal(normalizeTranscript("ahn"), normalizeTranscript("A.H.N."));
});

test("normaliza formas faladas equivalentes de moeda e horário", () => {
  assert.equal(scoreTranscript("R$ 80", "80 reais").wer, 0);
  assert.equal(scoreTranscript("R$ 18", "R$ 18,00").wer, 0);
  assert.equal(scoreTranscript("às 14h", "às 14 horas").wer, 0);
  assert.equal(scoreTranscript("às 09:00", "às 9 horas").wer, 0);
});

test("não trata palavras semanticamente distintas como equivalentes", () => {
  const score = scoreTranscript("sexta-feira", "domingo");
  assert.equal(score.wer, 1);
});
