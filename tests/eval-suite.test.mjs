import test from "node:test";
import assert from "node:assert/strict";

import { loadScenarioPack, readJson } from "../src/eval/io.mjs";
import {
  evaluateBaseline,
  evaluateTraceBundle
} from "../src/eval/runner.mjs";

const packUrl = new URL("../eval/scenarios/mvp.pt-BR.json", import.meta.url);
const gateUrl = new URL("../eval/gates/mvp.json", import.meta.url);

test("baseline passa pelo pack PT-BR congelado", async () => {
  const pack = await loadScenarioPack(packUrl);
  const gate = await readJson(gateUrl);
  const report = evaluateBaseline(pack, gate);

  assert.equal(report.gate.pass, true);
  assert.equal(
    report.summary.passedExpectations,
    report.summary.expectationCount
  );
  assert.equal(report.summary.scenarioCount, 7);
});

test("uma regressão de interrupção é bloqueada pelo gate", async () => {
  const pack = await loadScenarioPack(packUrl);
  const gate = await readJson(gateUrl);
  const report = evaluateBaseline(pack, gate, {
    bargeInStopDelayMs: 600
  });

  assert.equal(report.gate.pass, false);
  assert.equal(
    report.scenarios
      .find((scenario) => scenario.id === "interrupcao-barge-in")
      .checks.find((check) => check.id === "para-rapido").pass,
    false
  );
});

test("qualquer adaptador pode ser avaliado apenas entregando traces", async () => {
  const pack = await loadScenarioPack(packUrl);
  const gate = await readJson(gateUrl);
  const baseline = evaluateBaseline(pack, gate);
  const bundle = {
    candidate: "adaptador-de-teste",
    packId: pack.id,
    traces: Object.fromEntries(
      baseline.scenarios.map((scenario) => [scenario.id, scenario.trace])
    )
  };

  const report = evaluateTraceBundle(pack, gate, bundle);
  assert.equal(report.candidate, "adaptador-de-teste");
  assert.equal(report.gate.pass, true);
});
