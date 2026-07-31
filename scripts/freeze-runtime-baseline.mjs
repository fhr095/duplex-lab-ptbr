import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  buildRuntimeBaseline
} from "./lib/runtime-baseline.mjs";
import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  RUNTIME_FINGERPRINT_ROOTS
} from "../src/eval/runtime-provenance.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const HEALTH_URL =
  process.env.DUPLEX_HEALTH_URL ?? "http://127.0.0.1:4173/api/health";
const OUTPUT = "eval/baselines/runtime-baseline-v0.3.json";
const INPUTS = Object.freeze({
  factory: "eval/reports/eval-factory-campaign-v0.2.json",
  exp0007: "eval/reports/exp-0007-screening-v1.json",
  exp0008: "eval/reports/exp-0008-shadow-v1.json",
  exp0009: "eval/reports/exp-0009-critical-amount-guard-v1.json"
});

async function readEvidence(path) {
  const bytes = await readFile(resolve(PROJECT_ROOT, path));
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

const [health, currentFingerprint, entries] = await Promise.all([
  fetch(HEALTH_URL).then(async (response) => {
    if (!response.ok) {
      throw new Error(`health retornou HTTP ${response.status}`);
    }
    return response.json();
  }),
  createSourceFingerprint(PROJECT_ROOT, {
    roots: RUNTIME_FINGERPRINT_ROOTS
  }),
  Promise.all(
    Object.entries(INPUTS).map(async ([name, path]) => [
      name,
      await readEvidence(path)
    ])
  )
]);
const baseline = buildRuntimeBaseline({
  health,
  currentFingerprint,
  evidence: Object.fromEntries(entries)
});
const output = resolve(PROJECT_ROOT, OUTPUT);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Baseline congelada: ${baseline.id}`);
console.log(`Fingerprint: ${baseline.runtimeFingerprint.sha256}`);
console.log(`Artefato: ${OUTPUT}`);
