import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { compareAsrReports } from "../src/eval/asr-comparison.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const defaults = {
  baseline: "eval/reports/asr-human-base-latest.json",
  candidate: "eval/reports/asr-human-parakeet-latest.json",
  gate: "eval/gates/asr-promotion.json",
  out: "eval/reports/asr-comparison-latest.json"
};

function parseArgs(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new TypeError("use pares --opção valor");
    }
    const key = name.slice(2);
    if (!(key in options)) {
      throw new TypeError(`argumento desconhecido: ${name}`);
    }
    options[key] = value;
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(PROJECT_ROOT, path), "utf8"));
}

const options = parseArgs(process.argv.slice(2));
const [baseline, candidate, gate] = await Promise.all([
  readJson(options.baseline),
  readJson(options.candidate),
  readJson(options.gate)
]);
const report = compareAsrReports(baseline, candidate, gate);
const outputPath = resolve(PROJECT_ROOT, options.out);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    decision: report.decision,
    baseline: report.baseline,
    candidate: report.candidate,
    checks: report.checks,
    deltas: report.deltas,
    report: options.out
  })
);

if (!report.pass) {
  process.exitCode = 1;
}
