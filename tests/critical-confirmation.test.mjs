import assert from "node:assert/strict";
import test from "node:test";

import {
  planCriticalConfirmation
} from "../src/interaction/critical-confirmation.mjs";

test("protege valor corrigido em ação monetária irreversível", () => {
  const plan = planCriticalConfirmation(
    "Transfere 1500 reais, não, 150 reais",
    { slot: "amount", current: "BRL 150" }
  );
  assert.equal(plan.confirmationRequired, true);
  assert.equal(plan.proposedValue, "BRL 150");
  assert.doesNotMatch(plan.prompt, /\b150\b/u);
});

test("não adiciona atrito a horário ou menção monetária sem ação", () => {
  assert.equal(
    planCriticalConfirmation("Agenda às 16h", {
      slot: "time",
      current: "16:00"
    }),
    null
  );
  assert.equal(
    planCriticalConfirmation("O orçamento agora é 150 reais", {
      slot: "amount",
      current: "BRL 150"
    }),
    null
  );
});
