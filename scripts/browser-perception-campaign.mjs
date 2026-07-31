import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  aggregateBrowserPerceptionReports
} from "../src/eval/browser-perception-campaign.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(name, fallback) {
  const parsed = Number.parseInt(option(name, String(fallback)), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} exige inteiro positivo`);
  }
  return parsed;
}

const requestedRuns = positiveInteger("--runs", 10);
const probeMs = Math.max(
  5_000,
  positiveInteger("--probe-ms", 5_000)
);
const reportPath = resolve(
  PROJECT_ROOT,
  option(
    "--out",
    "eval/reports/browser-perception-campaign-latest.json"
  )
);
const runDirectory = resolve(
  PROJECT_ROOT,
  option(
    "--run-dir",
    "eval/reports/browser-perception-campaign"
  )
);
const noFail = process.argv.includes("--no-fail");
const reports = [];
const runnerFailures = [];
const startedAtMs = performance.now();

async function runSmoke(index, path, runNonce) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      ["scripts/windows-chrome-smoke.mjs"],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          BROWSER_REPORT: path,
          FALSE_ACTIVATION_PROBE_MS: String(probeMs),
          REQUIRE_VAD_SHADOW: "1",
          BROWSER_RUN_NONCE: runNonce
        },
        stdio: ["ignore", "inherit", "inherit"]
      }
    );
    child.once("error", (error) => {
      resolvePromise({
        code: null,
        error: error.message,
        index
      });
    });
    child.once("close", (code, signal) => {
      resolvePromise({
        code,
        signal: signal ?? null,
        index
      });
    });
  });
}

await mkdir(runDirectory, { recursive: true });
for (let index = 1; index <= requestedRuns; index += 1) {
  const path = resolve(
    runDirectory,
    `run-${String(index).padStart(2, "0")}.json`
  );
  console.log(
    `[browser-campaign] execução ${index}/${requestedRuns}`
  );
  await rm(path, { force: true });
  const runNonce = [
    process.pid,
    Date.now(),
    index,
    Math.random().toString(16).slice(2)
  ].join("-");
  const result = await runSmoke(index, path, runNonce);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (
      parsed.runNonce !== runNonce ||
      parsed.schemaVersion < 2
    ) {
      throw new Error(
        "relatório não pertence à execução atual ou usa schema antigo"
      );
    }
    reports.push(parsed);
  } catch (error) {
    runnerFailures.push({
      ...result,
      path,
      error: result.error ?? error.message
    });
  }
}

const report = aggregateBrowserPerceptionReports(reports, {
  minimumRuns: 10,
  requestedRuns,
  runnerFailures
});
report.durationMs = Math.round(performance.now() - startedAtMs);
report.runDirectory = runDirectory;
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  pass: report.pass,
  decision: report.decision,
  validRuns: report.summary.validRuns,
  requestedRuns,
  metrics: report.metrics,
  report: reportPath
}));

if (!report.pass && !noFail) {
  process.exitCode = 1;
}
