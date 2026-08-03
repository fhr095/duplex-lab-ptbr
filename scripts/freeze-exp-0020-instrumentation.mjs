import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  EXP0020_BOUNDARY_PATHS,
  EXP0020_EXP0019_EVIDENCE_COMMIT,
  EXP0020_INSTRUMENTATION_SOURCE_PATHS,
  EXP0020_PRODUCTION_SOURCE_PATHS,
  createExp0020InstrumentationFreeze
} from "../src/eval/exp-0020-boundary.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0020 freeze: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function gitBytes(...args) {
  const result = await execFile("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024
  });
  return result.stdout;
}

async function gitText(...args) {
  return (await gitBytes(...args)).toString("utf8").trim();
}

async function absent(path, label) {
  const exists = await access(resolve(PROJECT_ROOT, path)).then(
    () => true,
    () => false
  );
  invariant(!exists, `${label} já existe: ${path}`);
}

async function trackedHeadBytes(path) {
  await gitBytes("ls-files", "--error-unmatch", path);
  const [disk, head] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, path)),
    gitBytes("show", `HEAD:${path}`)
  ]);
  invariant(disk.equals(head), `${path} diverge dos bytes commitados`);
  return disk;
}

async function main() {
  invariant(
    await gitText("status", "--porcelain=v1", "--untracked-files=all") === "",
    "worktree precisa estar limpo e commitado"
  );
  await Promise.all([
    absent(EXP0020_BOUNDARY_PATHS.freeze, "freeze"),
    absent(EXP0020_BOUNDARY_PATHS.attempt, "tentativa"),
    absent(EXP0020_BOUNDARY_PATHS.receipt, "recibo de consumo"),
    absent(EXP0020_BOUNDARY_PATHS.report, "relatório")
  ]);

  const runnerSourceCommit = await gitText("rev-parse", "HEAD");
  const [preregistration, exp0019Report] = await Promise.all([
    trackedHeadBytes(EXP0020_BOUNDARY_PATHS.preregistration),
    trackedHeadBytes(EXP0020_BOUNDARY_PATHS.exp0019Report)
  ]);
  const productionSources = [];
  for (const path of EXP0020_PRODUCTION_SOURCE_PATHS) {
    const current = await trackedHeadBytes(path);
    const baseline = await gitBytes(
      "show",
      `${EXP0020_EXP0019_EVIDENCE_COMMIT}:${path}`
    );
    invariant(
      current.equals(baseline),
      `${path} mudou desde a evidência do EXP-0019`
    );
    productionSources.push({
      path,
      fileSha256: sha256(current),
      exp0019FileSha256: sha256(baseline)
    });
  }
  const instrumentationSources = [];
  for (const path of EXP0020_INSTRUMENTATION_SOURCE_PATHS) {
    const bytes = await trackedHeadBytes(path);
    instrumentationSources.push({ path, fileSha256: sha256(bytes) });
  }

  const freeze = createExp0020InstrumentationFreeze({
    runnerSourceCommit,
    nodeVersion: process.version,
    artifacts: {
      preregistration: {
        path: EXP0020_BOUNDARY_PATHS.preregistration,
        fileSha256: sha256(preregistration)
      },
      exp0019Report: {
        path: EXP0020_BOUNDARY_PATHS.exp0019Report,
        fileSha256: sha256(exp0019Report)
      }
    },
    productionSources,
    instrumentationSources
  });
  await writeFile(
    resolve(PROJECT_ROOT, EXP0020_BOUNDARY_PATHS.freeze),
    `${JSON.stringify(freeze, null, 2)}\n`,
    { flag: "wx" }
  );
  console.log(
    `EXP-0020 instrumentação congelada: ` +
      freeze.instrumentationFreezeSha256
  );
  console.log("Zero abertura, Chrome, API paga, GPU ou nova autoridade.");
}

await main();
