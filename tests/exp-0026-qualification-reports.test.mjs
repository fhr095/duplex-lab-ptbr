import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function report(name) {
  return JSON.parse(await readFile(new URL(
    `../eval/reports/${name}`,
    import.meta.url
  ), "utf8"));
}

test("smoke de lifecycle prova isolamento depois de contaminar cada ciclo", async () => {
  const value = await report("exp-0026-lifecycle-smoke-v0.1.json");
  assert.equal(value.schemaVersion, "exp-0026-lifecycle-smoke-v1");
  assert.equal(value.analysisEligibility, "excluded-technical-smoke");
  assert.equal(value.pass, true);
  assert.equal(value.observations.length, 6);
  assert.equal(new Set(value.observations.map((item) => item.processRunId)).size, 6);
  assert.equal(new Set(value.observations.map((item) => item.browserContextId)).size, 6);
  assert.deepEqual(value.gates, {
    sixDistinctProcesses: true,
    sixDistinctBrowserContexts: true,
    usageStartsAtZeroOf25: true,
    historyStartsEmpty: true,
    storageStartsEmpty: true,
    kernelStartsEmpty: true,
    eachPriorCycleWasContaminated: true,
    cleanShutdown: true
  });
});

test("dry-run qualifica o instrumento sem produzir evidência humana", async () => {
  const value = await report("exp-0026-instrument-dry-run-v0.1.json");
  assert.equal(value.schemaVersion, "exp-0026-instrument-dry-run-v1");
  assert.equal(value.status, "PASS_EXCLUDED_DRY_RUN");
  assert.equal(value.analysisEligibility, "excluded-dry-run");
  assert.equal(value.fitEligibility, "evaluation-only");
  assert.equal(value.pass, true);
  assert.equal(value.executionEvidence.blocksCompleted, 7);
  assert.equal(value.executionEvidence.traceHashesVerified, 7);
  assert.equal(value.executionEvidence.audioPersisted, false);
  assert.equal(value.executionEvidence.commercialEvaluated, false);
  assert.equal(value.gates.f0TwoMinuteGuardAccepted, true);
  assert.equal(value.gates.callBudgetStructurallyRespected, true);
  assert.equal(
    value.operationalPostMortem.constructOrDominanceGateChanged,
    false
  );
  assert.match(value.limitations.join(" "), /não contém julgamento humano/iu);
});

test("dry-run terminal não pode ser repetido nem contornado pelo supervisor", () => {
  const repeated = spawnSync(process.execPath, [
    "scripts/run-exp-0026-dry-run.mjs"
  ], { cwd: projectRoot, encoding: "utf8" });
  assert.notEqual(repeated.status, 0);
  assert.match(
    `${repeated.stdout}${repeated.stderr}`,
    /segunda execução é proibida/iu
  );

  const bypass = spawnSync(process.execPath, [
    "scripts/run-exp-0026-session.mjs",
    "--role", "dry-run",
    "--participant", "DRY-BYPASS",
    "--order", "0"
  ], { cwd: projectRoot, encoding: "utf8" });
  assert.notEqual(bypass.status, 0);
  assert.match(
    `${bypass.stdout}${bypass.stderr}`,
    /supervisor abre somente sessões externas/iu
  );
});

test("smoke cego bloqueia percepção até o selo técnico", async () => {
  const value = await report("exp-0026-blind-order-smoke-v0.1.json");
  assert.equal(value.schemaVersion, "exp-0026-blind-order-smoke-v1");
  assert.equal(value.analysisEligibility, "excluded-technical-smoke");
  assert.equal(value.pass, true);
  assert.deepEqual(value.gates, {
    humanFieldsAbsentFromTechnicalBundle: true,
    openBlockedBeforeTechnicalSeal: true,
    technicalCodingCoveredEveryBlock: true,
    hashesVerifiedBeforeJoin: true,
    humanDataOpenedOnlyAfterSeal: true
  });
});
