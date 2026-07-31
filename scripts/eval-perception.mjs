import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadScenarioPack, readJson } from "../src/eval/io.mjs";
import {
  evaluatePerception,
  traceBundleFromEvaluationReport
} from "../src/eval/perception-runner.mjs";
import { evaluateBaseline } from "../src/eval/runner.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function parseArgs(args) {
  const options = {
    json: false,
    out: "eval/reports/perception-latest.json"
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--json") {
      options.json = true;
    } else if (args[index] === "--out") {
      options.out = args[++index];
    } else {
      throw new TypeError(`argumento desconhecido: ${args[index]}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const [mvpPack, mvpGate, perceptionPack, perceptionGate] =
  await Promise.all([
    loadScenarioPack(resolve(
      PROJECT_ROOT,
      "eval/scenarios/mvp.pt-BR.json"
    )),
    readJson(resolve(PROJECT_ROOT, "eval/gates/mvp.json")),
    readJson(resolve(
      PROJECT_ROOT,
      "eval/scenarios/perception.pt-BR.json"
    )),
    readJson(resolve(PROJECT_ROOT, "eval/gates/perception.json"))
  ]);
const baseline = evaluateBaseline(mvpPack, mvpGate);
const evaluation = evaluatePerception(
  perceptionPack,
  perceptionGate,
  traceBundleFromEvaluationReport(baseline)
);
const report = {
  generatedAt: new Date().toISOString(),
  ...evaluation
};
const outputPath = resolve(PROJECT_ROOT, options.out);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    JSON.stringify({
      automatedDecision: report.gate.decision,
      automatedPassRate: report.summary.automatedPassRate,
      criticalFailures: report.gate.criticalFailures.length,
      userFacingDecision: report.gate.userFacingReadiness.decision,
      userFacingBlockers:
        report.gate.userFacingReadiness.blockers.map((item) => item.id),
      report: outputPath
    })
  );
}
if (!report.gate.pass) {
  process.exitCode = 1;
}
