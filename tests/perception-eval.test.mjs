import test from "node:test";
import assert from "node:assert/strict";

import { loadScenarioPack, readJson } from "../src/eval/io.mjs";
import {
  evaluateBaseline
} from "../src/eval/runner.mjs";
import {
  evaluatePerception,
  traceBundleFromEvaluationReport
} from "../src/eval/perception-runner.mjs";

const mvpPackUrl = new URL(
  "../eval/scenarios/mvp.pt-BR.json",
  import.meta.url
);
const mvpGateUrl = new URL("../eval/gates/mvp.json", import.meta.url);
const perceptionPackUrl = new URL(
  "../eval/scenarios/perception.pt-BR.json",
  import.meta.url
);
const perceptionGateUrl = new URL(
  "../eval/gates/perception.json",
  import.meta.url
);

async function baselineBundle() {
  const [mvpPack, mvpGate] = await Promise.all([
    loadScenarioPack(mvpPackUrl),
    readJson(mvpGateUrl)
  ]);
  return traceBundleFromEvaluationReport(
    evaluateBaseline(mvpPack, mvpGate)
  );
}

async function perceptionInputs() {
  return Promise.all([
    readJson(perceptionPackUrl),
    readJson(perceptionGateUrl)
  ]);
}

function clone(value) {
  return structuredClone(value);
}

function insertOrdered(trace, event) {
  trace.push(event);
  trace.sort((left, right) => left.atMs - right.atMs);
}

test("baseline recebe promote apenas no escopo automatizado", async () => {
  const [[pack, gate], bundle] = await Promise.all([
    perceptionInputs(),
    baselineBundle()
  ]);
  const report = evaluatePerception(pack, gate, bundle);

  assert.equal(report.decision, "promote");
  assert.equal(report.gate.scope, "autonomous-experiment");
  assert.equal(report.gate.criticalFailures.length, 0);
  assert.equal(report.summary.failedAutomatedChecks, 0);
  assert.equal(report.summary.diagnosticImpactScoreIsAuthoritative, false);
  assert.equal(report.gate.userFacingReadiness.decision, "hold");
  assert.ok(report.gate.userFacingReadiness.blockers.length >= 2);
  assert.deepEqual(
    new Set(
      report.evidence.deferredMeasurements.map(
        (measurement) => measurement.evidence
      )
    ),
    new Set(["physical_audio", "human_judgment"])
  );
});

test("um falso corte crítico bloqueia mesmo com média automatizada alta", async () => {
  const [[pack, gate], originalBundle] = await Promise.all([
    perceptionInputs(),
    baselineBundle()
  ]);
  const bundle = clone(originalBundle);
  insertOrdered(bundle.traces["hesitacao-nao-e-fim"], {
    atMs: 900,
    type: "assistant.speech.started",
    payload: {
      kind: "direct",
      text: "Pode continuar."
    },
    source: "candidate-regression"
  });

  const report = evaluatePerception(pack, gate, bundle);
  const falseCut = report.scenarios
    .find((scenario) => scenario.id === "pausa-natural")
    .checks.find((check) => check.id === "nao-toma-o-turno-na-pausa");

  assert.equal(falseCut.pass, false);
  assert.ok(
    report.summary.automatedPassRate >= gate.minAutomatedPassRate,
    "a média ainda deve parecer boa para provar que não governa o gate"
  );
  assert.equal(report.gate.decision, "hold");
  assert.equal(report.gate.checks[0].id, "no-critical-failures");
  assert.equal(report.gate.checks[0].pass, false);
  assert.match(report.gate.rule, /falha crítica sempre bloqueia/);
});

test("rollback com valor errado reprova a preservação de correção", async () => {
  const [[pack, gate], originalBundle] = await Promise.all([
    perceptionInputs(),
    baselineBundle()
  ]);
  const bundle = clone(originalBundle);
  const rollbacks = bundle.traces["autocorrecao-com-rollback"].filter(
    (event) => event.type === "state.rollback"
  );
  rollbacks[1].payload.current = "sexta";

  const report = evaluatePerception(pack, gate, bundle);
  const correction = report.scenarios
    .find((scenario) => scenario.id === "correcao-preservada")
    .checks.find((check) => check.id === "ultima-versao-vence");

  assert.equal(correction.pass, false);
  assert.equal(report.decision, "hold");
  assert.ok(
    report.gate.criticalFailures.some(
      (failure) => failure.checkId === "ultima-versao-vence"
    )
  );
});

test("backchannel verboso falha como guardrail sem fingir evidência humana", async () => {
  const [[pack, gate], originalBundle] = await Promise.all([
    perceptionInputs(),
    baselineBundle()
  ]);
  const bundle = clone(originalBundle);
  const backchannel = bundle.traces["hesitacao-nao-e-fim"].find(
    (event) => event.type === "assistant.backchannel"
  );
  backchannel.payload.text = "Sim, já entendi tudo";

  const report = evaluatePerception(pack, gate, bundle);
  const check = report.scenarios
    .find((scenario) => scenario.id === "pausa-natural")
    .checks.find((item) => item.id === "backchannel-no-ritmo");

  assert.equal(check.pass, false);
  assert.equal(check.evidence, "automated_proxy");
  assert.equal(report.gate.criticalFailures.length, 0);
  assert.equal(report.gate.decision, "hold");
  assert.equal(report.gate.userFacingReadiness.decision, "hold");
});

test("resultado obsoleto durante a janela de cancelamento é falha crítica", async () => {
  const [[pack, gate], originalBundle] = await Promise.all([
    perceptionInputs(),
    baselineBundle()
  ]);
  const bundle = clone(originalBundle);
  insertOrdered(bundle.traces["delegacao-e-cancelamento"], {
    atMs: 1460,
    type: "task.result",
    payload: {
      taskId: "task-1",
      summary: "Resultado que não deveria mais aparecer."
    },
    source: "candidate-regression"
  });

  const report = evaluatePerception(pack, gate, bundle);
  const cancellation = report.scenarios
    .find((scenario) => scenario.id === "delegacao-cancelavel")
    .checks.find((check) => check.id === "cancela-a-mesma-tarefa");

  assert.equal(cancellation.pass, false);
  assert.match(cancellation.detail, /resultado obsoleto=true/);
  assert.equal(report.decision, "hold");
});

test("bundle incompatível com o pack de traces é rejeitado", async () => {
  const [[pack, gate], bundle] = await Promise.all([
    perceptionInputs(),
    baselineBundle()
  ]);
  bundle.packId = "outro-pack";

  assert.throws(
    () => evaluatePerception(pack, gate, bundle),
    /esperado: mvp-ptbr-v0\.1/
  );
});
