import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  evaluateExp0014
} from "./lib/exp-0014-analysis.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_ROOTS = [
  "src",
  "web",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
];
const DEFAULTS = Object.freeze({
  browser: "eval/reports/exp-0014-browser-current.json",
  checkpoint: "web/acoustic-reflex-checkpoint.json",
  config: "eval/experiments/exp-0014-acoustic-reflex.pt-BR.json",
  dataset: "eval/datasets/exp-0014-acoustic-reflex-v0.1.json",
  offline: "eval/generated/exp-0014/offline-training-report.json",
  out: "eval/reports/exp-0014-acoustic-reflex-m4a-v1.json",
  healthUrl: "http://127.0.0.1:4173/api/health"
});

function parseArgs(args) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const field = argument.slice(2).replace(
      /-([a-z])/gu,
      (_, letter) => letter.toUpperCase()
    );
    if (!(field in options)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    options[field] = args[++index];
  }
  return options;
}

async function readJson(relativePath) {
  const bytes = await readFile(resolve(PROJECT_ROOT, relativePath));
  return {
    path: relativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

const options = parseArgs(process.argv.slice(2));
const [
  browser,
  checkpoint,
  config,
  dataset,
  offline,
  healthResponse,
  campaignFingerprint,
  runtimeFingerprint
] = await Promise.all([
  readJson(options.browser),
  readJson(options.checkpoint),
  readJson(options.config),
  readJson(options.dataset),
  readJson(options.offline),
  fetch(options.healthUrl, { signal: AbortSignal.timeout(5_000) }),
  createSourceFingerprint(PROJECT_ROOT),
  createSourceFingerprint(PROJECT_ROOT, { roots: RUNTIME_ROOTS })
]);
if (!healthResponse.ok) {
  throw new Error(`health retornou HTTP ${healthResponse.status}`);
}
const health = await healthResponse.json();
const report = evaluateExp0014({
  browser: browser.value,
  checkpoint: checkpoint.value,
  config: config.value,
  dataset: dataset.value,
  fingerprints: {
    campaign: campaignFingerprint,
    runtime: runtimeFingerprint
  },
  health,
  offline: offline.value
});
report.provenance = {
  browser: {
    path: browser.path,
    sha256: browser.sha256,
    runNonce: browser.value.runNonce
  },
  checkpoint: {
    path: checkpoint.path,
    sha256: checkpoint.sha256
  },
  config: { path: config.path, sha256: config.sha256 },
  dataset: { path: dataset.path, sha256: dataset.sha256 },
  offline: { path: offline.path, sha256: offline.sha256 }
};
const output = resolve(PROJECT_ROOT, options.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `EXP-0014: ${report.pass ? "PROMOTE" : "HOLD"} · ` +
    `${report.metrics.datasetExamples} exemplos · ` +
    `${report.metrics.onlineDecisions} decisões Chrome · ` +
    `p95 ${report.metrics.onlineInferenceP95Ms} ms`
);
console.log(`Evidência canônica: ${options.out}`);
if (!report.pass) {
  process.exitCode = 1;
}
