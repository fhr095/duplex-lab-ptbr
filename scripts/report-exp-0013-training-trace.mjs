import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  auditTrainingTraceContract,
  evaluateExp0013
} from "./lib/exp-0013-analysis.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_ROOTS = [
  "src",
  "web",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
];
const DEFAULTS = Object.freeze({
  candidate: "eval/reports/exp-0013-browser-current.json",
  out: "eval/reports/exp-0013-training-trace-interruption-v1.json",
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

const options = parseArgs(process.argv.slice(2));
const [candidate, healthResponse, campaignFingerprint, runtimeFingerprint] =
  await Promise.all([
    readReport(options.candidate),
    fetch(options.healthUrl, { signal: AbortSignal.timeout(5_000) }),
    createSourceFingerprint(PROJECT_ROOT),
    createSourceFingerprint(PROJECT_ROOT, { roots: RUNTIME_ROOTS })
  ]);
if (!healthResponse.ok) {
  throw new Error(`health retornou HTTP ${healthResponse.status}`);
}
const health = await healthResponse.json();
const contractAudit = auditTrainingTraceContract();
const report = evaluateExp0013({
  candidate: candidate.value,
  health,
  fingerprints: {
    campaign: campaignFingerprint,
    runtime: runtimeFingerprint
  },
  contractAudit
});
report.provenance = {
  candidateInput: {
    path: candidate.path,
    sha256: candidate.sha256,
    runNonce: candidate.value.runNonce
  },
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
  `EXP-0013: ${report.decision.toUpperCase()} · ` +
    `${report.metrics.selectedCases} casos · ` +
    `${report.metrics.replayedDecisions} decisões · ` +
    `${report.metrics.observedEffects} efeitos`
);
console.log(`Evidência canônica: ${options.out}`);
if (!report.pass) {
  process.exitCode = 1;
}
