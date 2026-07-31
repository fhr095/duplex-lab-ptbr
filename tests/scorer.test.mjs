import test from "node:test";
import assert from "node:assert/strict";

import { applyGate } from "../src/eval/gate.mjs";
import { scorePack, scoreScenario } from "../src/eval/scorer.mjs";

const scenario = {
  id: "latencia",
  category: "unit",
  description: "Mede latência de resposta.",
  timeline: [{ atMs: 0, type: "user.speech.started" }],
  expectations: [
    {
      id: "resposta",
      kind: "latency",
      from: "user.speech.ended",
      to: "assistant.speech.started",
      maxMs: 500,
      metric: "response_start_latency_ms"
    }
  ]
};

test("mede a latência entre eventos, não o tempo absoluto", () => {
  const score = scoreScenario(scenario, [
    { atMs: 1_000, type: "user.speech.ended", payload: {} },
    { atMs: 1_340, type: "assistant.speech.started", payload: {} }
  ]);

  assert.equal(score.pass, true);
  assert.equal(score.checks[0].value, 340);
});

test("falha quando o evento final não existe", () => {
  const score = scoreScenario(scenario, [
    { atMs: 1_000, type: "user.speech.ended", payload: {} }
  ]);

  assert.equal(score.pass, false);
  assert.equal(score.checks[0].value, null);
});

test("gate falha se a p95 ultrapassar o teto", () => {
  const pack = {
    id: "pack",
    scenarios: [scenario]
  };
  const score = scorePack(
    pack,
    new Map([
      [
        "latencia",
        [
          { atMs: 1_000, type: "user.speech.ended", payload: {} },
          { atMs: 1_700, type: "assistant.speech.started", payload: {} }
        ]
      ]
    ])
  );
  const gate = applyGate(score, {
    id: "gate",
    requiredPassRate: 1,
    metricLimits: {
      response_start_latency_ms: { stat: "p95", max: 500 }
    }
  });

  assert.equal(gate.pass, false);
  assert.equal(gate.checks.at(-1).actual, 700);
});
