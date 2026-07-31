import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateExp0009
} from "../scripts/lib/exp-0009-analysis.mjs";

function fixture() {
  const results = [1, 2, 3, 4, 5].map((repetition) => ({
    id: "corr-amount-nao-barge-surface-a",
    repetition,
    guardedConfirmationPass: true,
    safeOutcomePass: true,
    behaviorPass: true,
    responseLatencyMs: 120,
    transcript: "Transfere 1500 reais. Não, 150 reais.",
    assistantText:
      "Só para confirmar com segurança: qual é o valor final da transferência?",
    semantic: { state: null, revisions: [] },
    trace: []
  }));
  return {
    browser: {
      runtime: { comparable: true },
      execution: { paidApiCalls: 0 },
      results
    },
    acoustic: {
      results: results.map((item) => ({
        ...item,
        guardedConfirmationPass: false,
        safeRepairPass: true
      }))
    }
  };
}

test("promove abstention segura sem fingir recuperação semântica", () => {
  const report = evaluateExp0009(fixture());
  assert.equal(report.decision, "promote-safety-guard");
  assert.equal(report.metrics.guardedObservations, 5);
  assert.match(report.limitations[0], /não recuperação/u);
});

test("valor ecoado ou commit semântico prematuro bloqueiam o guardrail", () => {
  const input = fixture();
  input.browser.results[2].assistantText = "Confirma R$ 150?";
  assert.equal(evaluateExp0009(input).pass, false);

  const committed = fixture();
  committed.browser.results[1].semantic.state = {
    slot: "amount",
    value: "BRL 150"
  };
  assert.equal(evaluateExp0009(committed).pass, false);
});
