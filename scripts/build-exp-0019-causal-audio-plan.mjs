import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildExp0019CausalAudioPlan,
  validateExp0019CausalAudioPlan
} from "../src/eval/exp-0019-causal-audio-bridge.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

export const EXP0019_PLAN_PATHS = Object.freeze({
  preregistration:
    "docs/experiments/EXP-0019-causal-audio-context-bridge.md",
  developmentDataset:
    "eval/datasets/exp-0018-context-development-v0.1.json",
  developmentReport:
    "eval/reports/exp-0018-context-development-v0.1.json",
  checkpoint: "eval/checkpoints/exp-0018-context-v0.1.json",
  output: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json"
});

function parseArgs(args) {
  const options = { ...EXP0019_PLAN_PATHS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const key = argument.startsWith("--") ? argument.slice(2) : null;
    if (!key || !(key in EXP0019_PLAN_PATHS)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const value = args[index + 1];
    if (!value) {
      throw new TypeError(`${argument} exige caminho`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function fileSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

export async function buildExp0019CausalAudioPlanArtifact(options = {}) {
  const paths = { ...EXP0019_PLAN_PATHS, ...options };
  const [preregistrationBytes, datasetBytes, reportBytes, checkpointBytes] =
    await Promise.all([
      readFile(resolve(PROJECT_ROOT, paths.preregistration)),
      readFile(resolve(PROJECT_ROOT, paths.developmentDataset)),
      readFile(resolve(PROJECT_ROOT, paths.developmentReport)),
      readFile(resolve(PROJECT_ROOT, paths.checkpoint))
    ]);
  const developmentDataset = JSON.parse(datasetBytes.toString("utf8"));
  const developmentReport = JSON.parse(reportBytes.toString("utf8"));
  const checkpoint = JSON.parse(checkpointBytes.toString("utf8"));
  const sources = {
    preregistrationText: preregistrationBytes.toString("utf8"),
    developmentDataset,
    developmentReport,
    checkpoint,
    bindings: {
      preregistration: {
        path: paths.preregistration,
        fileSha256: fileSha256(preregistrationBytes)
      },
      developmentDataset: {
        path: paths.developmentDataset,
        fileSha256: fileSha256(datasetBytes),
        canonicalSha256: developmentDataset.datasetSha256
      },
      developmentReport: {
        path: paths.developmentReport,
        fileSha256: fileSha256(reportBytes),
        canonicalSha256: developmentReport.developmentReportSha256
      },
      checkpoint: {
        path: paths.checkpoint,
        fileSha256: fileSha256(checkpointBytes),
        canonicalSha256: checkpoint.checkpointSha256
      }
    }
  };
  const plan = buildExp0019CausalAudioPlan(sources);
  const validation = validateExp0019CausalAudioPlan(plan, sources);
  if (!validation.valid) {
    throw new Error(`plano EXP-0019 inválido: ${validation.errors.join("; ")}`);
  }
  return { plan, bytes: jsonBytes(plan), sources };
}

async function writeOrCheck(path, bytes, check) {
  if (check) {
    const existing = await readFile(path).catch(() => null);
    if (!existing || !existing.equals(bytes)) {
      throw new Error(`artefato ausente ou divergente: ${path}`);
    }
    return;
  }
  await writeFile(path, bytes);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildExp0019CausalAudioPlanArtifact(options);
  await writeOrCheck(
    resolve(PROJECT_ROOT, options.output),
    result.bytes,
    options.check
  );
  console.log(
    `EXP-0019 plano ${options.check ? "CHECK" : "BUILD"} PASS: ` +
      "2 blocos, 4 pares, 8 cenas, 12 streams, zero áudio"
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
