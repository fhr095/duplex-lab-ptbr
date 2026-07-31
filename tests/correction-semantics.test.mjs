import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeCorrection
} from "../src/interaction/correction-semantics.mjs";
import { createLocalBrain } from "../src/brain/local-brain.mjs";

const cases = [
  {
    text: "Marca para terça... não, sexta.",
    slot: "weekday",
    obsolete: "terça",
    current: "sexta"
  },
  {
    text: "Agenda às 14h; na verdade, às 16h.",
    slot: "time",
    obsolete: "14:00",
    current: "16:00"
  },
  {
    text: "O valor é R$ 80... quer dizer, R$ 18.",
    slot: "amount",
    obsolete: "BRL 80",
    current: "BRL 18"
  },
  {
    text: "Sete mil e quinhentos reais... não, mil centro e cinquenta reais.",
    slot: "amount",
    obsolete: "BRL 7500",
    current: "BRL 1150"
  },
  {
    text: "Fale com Ana... não, com Marina.",
    slot: "name",
    obsolete: "Ana",
    current: "Marina"
  },
  {
    text: "Fala com o Bruno... melhor, com Caio.",
    slot: "name",
    obsolete: "Bruno",
    current: "Caio"
  }
];

test("extrai a última revisão de slots críticos em PT-BR", () => {
  for (const item of cases) {
    const result = analyzeCorrection(item.text);
    assert.equal(result.isCorrection, true, item.text);
    assert.equal(result.revisions.at(-1).slot, item.slot, item.text);
    assert.equal(result.revisions.at(-1).obsolete, item.obsolete, item.text);
    assert.equal(result.revisions.at(-1).current, item.current, item.text);
    assert.doesNotMatch(
      result.effectiveText,
      new RegExp(item.obsolete.replace("BRL ", "R\\$?\\s*"), "iu")
    );
  }
});

test("negação comum não inventa rollback", () => {
  for (const text of [
    "Não tenho preferência por sexta.",
    "Eu não quero pesquisar agora.",
    "Na verdade isso já estava certo."
  ]) {
    assert.equal(analyzeCorrection(text).isCorrection, false, text);
  }
});

test("cérebro local confirma correção reversível e usa texto efetivo", () => {
  const brain = createLocalBrain({ idFactory: () => "task-fixed" });
  const direct = brain.planTurn("Marca para terça... não, sexta.");
  assert.equal(direct.mode, "direct");
  assert.equal(direct.semantic.correction.current, "sexta");
  assert.match(direct.response, /sexta/iu);
  assert.doesNotMatch(direct.effectiveText, /terça/iu);

  const delegated = brain.planTurn(
    "Pesquise passagens para terça... não, sexta."
  );
  assert.equal(delegated.mode, "delegate");
  assert.match(delegated.task.query, /sexta/iu);
  assert.doesNotMatch(delegated.task.query, /terça/iu);
});

test("cérebro local pede repetição antes de afirmar transferência corrigida", () => {
  const brain = createLocalBrain();
  const plan = brain.planTurn(
    "Transfere 1500 reais... não, 150 reais."
  );
  assert.equal(plan.safety.confirmationRequired, true);
  assert.equal(
    plan.safety.policy,
    "repeat-critical-value-before-commit"
  );
  assert.match(plan.response, /qual é o valor final/iu);
  assert.doesNotMatch(plan.response, /\b150\b/u);
});
