import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  evaluateExp0011
} from "./lib/exp-0011-analysis.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_ROOTS = [
  "src",
  "web",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
];
const DEFAULTS = Object.freeze({
  control: "eval/reports/exp-0011-control-current.json",
  candidate: "eval/reports/exp-0011-candidate-current.json",
  supplemental: [
    "eval/reports/exp-0011-control-1b.json",
    "eval/reports/exp-0011-candidate-1.json",
    "eval/reports/exp-0011-candidate-2.json",
    "eval/reports/exp-0011-candidate-3b.json"
  ].join(","),
  out: "eval/reports/exp-0011-local-audio-reflex-v1.json",
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
const supplementalPaths = options.supplemental
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .filter(
    (value) => value !== options.control && value !== options.candidate
  );
const [
  control,
  candidate,
  healthResponse,
  campaignFingerprint,
  runtimeFingerprint,
  supplementalInputs
] = await Promise.all([
  readReport(options.control),
  readReport(options.candidate),
  fetch(options.healthUrl, { signal: AbortSignal.timeout(5_000) }),
  createSourceFingerprint(PROJECT_ROOT),
  createSourceFingerprint(PROJECT_ROOT, { roots: RUNTIME_ROOTS }),
  Promise.all(supplementalPaths.map(readOptionalReport))
]);
if (!healthResponse.ok) {
  throw new Error(`health retornou HTTP ${healthResponse.status}`);
}
const realizedSupplemental = supplementalInputs.filter(Boolean);
const health = await healthResponse.json();
const report = evaluateExp0011({
  control: control.value,
  candidate: candidate.value,
  health,
  fingerprints: {
    campaign: campaignFingerprint,
    runtime: runtimeFingerprint
  },
  supplemental: realizedSupplemental.map((item) => item.value)
});
report.provenance = {
  controlInput: {
    path: control.path,
    sha256: control.sha256,
    runNonce: control.value.runNonce
  },
  candidateInput: {
    path: candidate.path,
    sha256: candidate.sha256,
    runNonce: candidate.value.runNonce
  },
  supplementalInputs: realizedSupplemental.map((item) => ({
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
  `EXP-0011: ${report.decision.toUpperCase()} · ` +
    `pico marginal ${report.metrics.candidateMarginalOutputPreserved
      ? "preservado"
      : "falhou"} · ` +
    `barge-in ${report.metrics.closedLoopBargeInMs ?? "—"} ms · ` +
    `físico ${report.metrics.physical.classification}`
);
console.log(`Evidência canônica: ${options.out}`);
if (!report.pass) {
  process.exitCode = 1;
}
