import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateExp0018Checkpoint } from
  "../src/eval/exp-0018-training.mjs";
import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_INSTRUMENTATION_FREEZE_PATH,
  validateExp0019InstrumentationFreeze
} from "../src/eval/exp-0019-boundary.mjs";
import {
  validateExp0019CausalAudioPlan
} from "../src/eval/exp-0019-causal-audio-bridge.mjs";
import {
  EXP0019_CANONICAL_REPORT_PATH,
  buildExp0019CanonicalReport,
  exp0019EvidenceChainBound,
  validateExp0019CanonicalReport
} from "../src/eval/exp-0019-analysis.mjs";
import { validateExp0019NodeReplayArtifact } from
  "../src/eval/exp-0019-replay.mjs";
import {
  validateExp0019AudioAttempt,
  verifyExp0019AudioManifest
} from "./materialize-exp-0019-audio.mjs";
import { validateExp0019BrowserReport } from
  "./smoke-exp-0019-browser.mjs";
import { validateContextRelevanceCheckpoint } from
  "../web/context-relevance-shadow.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  preregistration:
    "docs/experiments/EXP-0019-causal-audio-context-bridge.md",
  plan: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
  instrumentationFreeze: EXP0019_INSTRUMENTATION_FREEZE_PATH,
  audioAttempt: EXP0019_AUDIO_ATTEMPT_PATH,
  audioManifest: "eval/sources/exp-0019-causal-audio-v0.1.json",
  nodeReplay: "eval/reports/exp-0019-node-replay-v0.1.json",
  browserReport: "eval/reports/exp-0019-browser-v0.1.json",
  sourceCheckpoint: "eval/checkpoints/exp-0018-context-v0.1.json",
  browserCheckpoint: "web/context-relevance-checkpoint.json",
  out: EXP0019_CANONICAL_REPORT_PATH,
  modelDir: resolve(
    process.env.SUPERTONIC_MODEL_DIR ?? resolve(
      process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache"),
      "supertonic3"
    )
  )
});

function invariant(condition, message) {
  if (!condition) throw new Error(`relatório EXP-0019: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readRecord(path, parseJson = true) {
  const bytes = await readFile(resolve(PROJECT_ROOT, path));
  return Object.freeze({
    path,
    bytes,
    fileSha256: sha256(bytes),
    value: parseJson ? JSON.parse(bytes.toString("utf8")) : null
  });
}

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  const fields = Object.fromEntries(Object.keys(DEFAULTS).map((name) => [
    `--${name.replace(/[A-Z]/gu, (letter) =>
      `-${letter.toLowerCase()}`)}`,
    name
  ]));
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--check") {
      options.check = true;
      continue;
    }
    const field = fields[args[index]];
    invariant(field && index + 1 < args.length,
      `argumento desconhecido ou sem valor: ${args[index]}`);
    options[field] = args[++index];
  }
  invariant(
    options.out === EXP0019_CANONICAL_REPORT_PATH,
    "output canônico não pode ser redirecionado"
  );
  return options;
}

export async function reportExp0019(options = {}) {
  const paths = { ...DEFAULTS, ...options };
  const records = Object.fromEntries(await Promise.all([
    ["preregistration", paths.preregistration, false],
    ["plan", paths.plan, true],
    ["instrumentationFreeze", paths.instrumentationFreeze, true],
    ["audioAttempt", paths.audioAttempt, true],
    ["audioManifest", paths.audioManifest, true],
    ["nodeReplay", paths.nodeReplay, true],
    ["browserReport", paths.browserReport, true],
    ["sourceCheckpoint", paths.sourceCheckpoint, true],
    ["browserCheckpoint", paths.browserCheckpoint, true]
  ].map(async ([name, path, parseJson]) => [
    name,
    await readRecord(path, parseJson)
  ])));

  const planValidation = validateExp0019CausalAudioPlan(records.plan.value);
  const freezeValidation = validateExp0019InstrumentationFreeze(
    records.instrumentationFreeze.value
  );
  const attemptValid = validateExp0019AudioAttempt(
    records.audioAttempt.value
  );
  const audioManifestValidation = await verifyExp0019AudioManifest(
    records.audioManifest.value,
    {
      projectRoot: PROJECT_ROOT,
      modelDir: resolve(paths.modelDir),
      requireEvidenceCommitted: true
    }
  );
  const sourceCheckpointValidation = validateExp0018Checkpoint(
    records.sourceCheckpoint.value
  );
  const browserCheckpointValidation = validateContextRelevanceCheckpoint(
    records.browserCheckpoint.value
  );
  const nodeReplayValidation = validateExp0019NodeReplayArtifact(
    records.nodeReplay.value,
    {
      plan: records.plan.value,
      instrumentationFreeze: records.instrumentationFreeze.value
    }
  );
  const browserReportValidation = validateExp0019BrowserReport(
    records.browserReport.value,
    {
      replay: records.nodeReplay.value,
      checkpoint: records.browserCheckpoint.value,
      instrumentationFreeze: records.instrumentationFreeze.value
    }
  );
  const validations = {
    planValid: planValidation.valid,
    instrumentationFreezeValid: freezeValidation.valid,
    audioAttemptValid: attemptValid,
    audioManifestValid: audioManifestValidation.valid,
    nodeReplayValid: nodeReplayValidation.valid,
    browserReportValid: browserReportValidation.valid,
    sourceCheckpointValid: sourceCheckpointValidation.valid,
    browserCheckpointValid: browserCheckpointValidation.valid,
    evidenceChainBound: exp0019EvidenceChainBound(records)
  };
  const input = { records, validations };
  const report = buildExp0019CanonicalReport(input);
  const validation = validateExp0019CanonicalReport(report, input);
  invariant(validation.valid, validation.errors.join("; "));
  return report;
}

async function writeOrCheck(report, options) {
  const path = resolve(PROJECT_ROOT, options.out);
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (options.check) {
    const current = await readFile(path, "utf8").catch(() => null);
    invariant(current === content, "relatório canônico ausente ou divergente");
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { flag: "wx" });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await reportExp0019(options);
  await writeOrCheck(report, options);
  console.log(
    `EXP-0019 ${options.check ? "CHECK" : "REPORT"}: ${report.decision}; ` +
      `gates=${Object.values(report.gates).filter(Boolean).length}/` +
      `${Object.keys(report.gates).length}; autoridade=false; API=0; GPU=0`
  );
  if (!report.pass) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
