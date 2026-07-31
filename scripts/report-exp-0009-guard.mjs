import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  evaluateExp0009
} from "./lib/exp-0009-analysis.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const paths = {
  browser: "eval/reports/exp-0008-guard-wrong-value-browser.json",
  acoustic: "eval/reports/exp-0009-guard-baseline-pcm-browser.json",
  out: "eval/reports/exp-0009-critical-amount-guard-v1.json"
};

async function readReport(path) {
  const bytes = await readFile(resolve(PROJECT_ROOT, path));
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

const [browser, acoustic] = await Promise.all([
  readReport(paths.browser),
  readReport(paths.acoustic)
]);
const report = evaluateExp0009({
  browser: browser.value,
  acoustic: acoustic.value
});
report.provenance = {
  runtimeFingerprint:
    browser.value.runtime?.currentRuntimeFingerprint ?? null,
  inputs: [browser, acoustic].map(({ path, sha256 }) => ({
    path,
    sha256
  })),
  textOverride:
    browser.value.provenance?.textOverridesFileSha256 ?? null
};
const output = resolve(PROJECT_ROOT, paths.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `EXP-0009: ${report.decision.toUpperCase()} · ` +
    `${report.metrics.guardedObservations}/${report.metrics.observations} protegidas`
);
console.log(`Evidência canônica: ${paths.out}`);
