import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadScenarioPack, readJson } from "../eval/io.mjs";
import {
  evaluateBaseline,
  evaluateTraceBundle
} from "../eval/runner.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function parseArgs(args) {
  const options = { json: false, out: null, trace: null };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--out") {
      options.out = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--trace") {
      options.trace = args[index + 1];
      index += 1;
      continue;
    }
    throw new TypeError(`argumento desconhecido: ${argument}`);
  }

  return options;
}

function printHumanReport(report) {
  const gateLabel = report.gate.pass ? "PASSOU" : "FALHOU";
  console.log(`\nDuplex Lab PT-BR — ${report.candidate}`);
  console.log(`Gate ${report.gate.id}: ${gateLabel}`);
  console.log(
    `Cenários: ${report.summary.passedScenarios}/${report.summary.scenarioCount}`
  );
  console.log(
    `Expectativas: ${report.summary.passedExpectations}/${report.summary.expectationCount}`
  );

  console.log("\nMétricas temporais");
  for (const [name, values] of Object.entries(report.metrics)) {
    console.log(
      `- ${name}: p50=${values.p50} ms, p95=${values.p95} ms, n=${values.count}`
    );
  }

  const failures = report.scenarios.flatMap((scenario) =>
    scenario.checks
      .filter((check) => !check.pass)
      .map((check) => `${scenario.id}/${check.id}: ${check.detail}`)
  );
  if (failures.length > 0) {
    console.log("\nFalhas");
    failures.forEach((failure) => console.log(`- ${failure}`));
  }
  console.log("");
}

const options = parseArgs(process.argv.slice(2));
const pack = await loadScenarioPack(
  resolve(PROJECT_ROOT, "eval/scenarios/mvp.pt-BR.json")
);
const gate = await readJson(resolve(PROJECT_ROOT, "eval/gates/mvp.json"));
const evaluation = options.trace
  ? evaluateTraceBundle(
      pack,
      gate,
      await readJson(resolve(PROJECT_ROOT, options.trace))
    )
  : evaluateBaseline(pack, gate);
const report = {
  generatedAt: new Date().toISOString(),
  ...evaluation
};

if (options.out) {
  const outputPath = resolve(PROJECT_ROOT, options.out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

if (!report.gate.pass) {
  process.exitCode = 1;
}
