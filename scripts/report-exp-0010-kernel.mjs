import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  evaluateExp0010
} from "./lib/exp-0010-analysis.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_ROOTS = [
  "src",
  "web",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
];
const DEFAULTS = Object.freeze({
  input: "eval/reports/exp-0010-browser-smoke-current.json",
  out: "eval/reports/exp-0010-stateful-kernel-v1.json",
  healthUrl: "http://127.0.0.1:4173/api/health",
  history: [
    "eval/reports/exp-0010-browser-smoke.json",
    "eval/reports/exp-0010-browser-smoke-repeat-2.json",
    "eval/reports/exp-0010-browser-smoke-five.json"
  ].join(",")
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
    const value = args[++index];
    if (value === undefined) {
      throw new TypeError(`${argument} exige um valor`);
    }
    options[field] = value;
  }
  return options;
}

async function readReport(path) {
  const bytes = await readFile(resolve(PROJECT_ROOT, path));
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

async function readOptionalReport(path) {
  try {
    return await readReport(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

const options = parseArgs(process.argv.slice(2));
const historyPaths = options.history
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .filter((value) => value !== options.input);
const [primary, healthResponse, campaignFingerprint, runtimeFingerprint] =
  await Promise.all([
    readReport(options.input),
    fetch(options.healthUrl, { signal: AbortSignal.timeout(5_000) }),
    createSourceFingerprint(PROJECT_ROOT),
    createSourceFingerprint(PROJECT_ROOT, { roots: RUNTIME_ROOTS })
  ]);
if (!healthResponse.ok) {
  throw new Error(`health retornou HTTP ${healthResponse.status}`);
}
const historyInputs = (
  await Promise.all(historyPaths.map(readOptionalReport))
).filter(Boolean);
const health = await healthResponse.json();
const report = evaluateExp0010({
  browser: primary.value,
  health,
  fingerprints: {
    campaign: campaignFingerprint,
    runtime: runtimeFingerprint
  },
  history: [...historyInputs.map((item) => item.value), primary.value]
});
report.provenance = {
  primaryInput: {
    path: primary.path,
    sha256: primary.sha256,
    runNonce: primary.value.runNonce
  },
  supplementalInputs: historyInputs.map((item) => ({
    path: item.path,
    sha256: item.sha256,
    runNonce: item.value.runNonce,
    sourceFingerprint: item.value.sourceFingerprint?.sha256 ?? null
  })),
  campaignFingerprint,
  runtimeFingerprint,
  runtimeRunId: health.process?.runId ?? null,
  runtimeProvider: health.brain,
  paidApiRequests: health.usage?.requests ?? null
};
const output = resolve(PROJECT_ROOT, options.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `EXP-0010: ${report.decision.toUpperCase()} · ` +
    `${report.metrics.passingObservations}/${report.metrics.observations} ` +
    `ciclos · runtime global ${report.globalRuntimeStatus}`
);
console.log(`Evidência canônica: ${options.out}`);
