import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  EXP0021_BOUNDARY_PATHS,
  EXP0021_EXP0020_EVIDENCE_COMMIT,
  EXP0021_INSTRUMENTATION_SOURCE_PATHS,
  EXP0021_PRODUCTION_SOURCE_PATHS,
  EXP0021_RUNTIME_FINGERPRINT_ROOTS,
  createExp0021InstrumentationFreeze
} from "../src/eval/exp-0021-boundary.mjs";
import { createSourceFingerprint } from
  "../src/eval/source-fingerprint.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0021 freeze: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function gitBytes(...args) {
  const result = await execFile("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "buffer",
    maxBuffer: 30 * 1024 * 1024
  });
  return result.stdout;
}

async function gitText(...args) {
  return (await gitBytes(...args)).toString("utf8").trim();
}

async function assertAbsent(path, label) {
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

export async function freezeExp0021Instrumentation() {
  invariant(
    await gitText("status", "--porcelain=v1", "--untracked-files=all") === "",
    "worktree precisa estar limpo e commitado"
  );
  await Promise.all([
    assertAbsent(EXP0021_BOUNDARY_PATHS.freeze, "freeze"),
    assertAbsent(EXP0021_BOUNDARY_PATHS.attempt, "tentativa"),
    assertAbsent(EXP0021_BOUNDARY_PATHS.receipt, "recibo"),
    assertAbsent(EXP0021_BOUNDARY_PATHS.report, "relatório")
  ]);

  const runnerSourceCommit = await gitText("rev-parse", "HEAD");
  const [preregistration, exp0020Report, exp0020Closeout] =
    await Promise.all([
      trackedHeadBytes(EXP0021_BOUNDARY_PATHS.preregistration),
      trackedHeadBytes(EXP0021_BOUNDARY_PATHS.exp0020Report),
      trackedHeadBytes(EXP0021_BOUNDARY_PATHS.exp0020Closeout)
    ]);

  const productionSources = [];
  for (const path of EXP0021_PRODUCTION_SOURCE_PATHS) {
    const [current, baseline] = await Promise.all([
      trackedHeadBytes(path),
      gitBytes("show", `${EXP0021_EXP0020_EVIDENCE_COMMIT}:${path}`)
    ]);
    invariant(
      current.equals(baseline),
      `${path} mudou desde a evidência canônica do EXP-0020`
    );
    productionSources.push({
      path,
      fileSha256: sha256(current),
      exp0020FileSha256: sha256(baseline)
    });
  }

  const instrumentationSources = [];
  for (const path of EXP0021_INSTRUMENTATION_SOURCE_PATHS) {
    const bytes = await trackedHeadBytes(path);
    instrumentationSources.push({ path, fileSha256: sha256(bytes) });
  }

  const runtimeBinding = await createSourceFingerprint(PROJECT_ROOT, {
    roots: EXP0021_RUNTIME_FINGERPRINT_ROOTS
  });

  const freeze = createExp0021InstrumentationFreeze({
    runnerSourceCommit,
    nodeVersion: process.version,
    artifacts: {
      preregistration: {
        path: EXP0021_BOUNDARY_PATHS.preregistration,
        fileSha256: sha256(preregistration)
      },
      exp0020Report: {
        path: EXP0021_BOUNDARY_PATHS.exp0020Report,
        fileSha256: sha256(exp0020Report)
      },
      exp0020Closeout: {
        path: EXP0021_BOUNDARY_PATHS.exp0020Closeout,
        fileSha256: sha256(exp0020Closeout)
      }
    },
    runtimeBinding,
    productionSources,
    instrumentationSources
  });
  await writeFile(
    resolve(PROJECT_ROOT, EXP0021_BOUNDARY_PATHS.freeze),
    `${JSON.stringify(freeze, null, 2)}\n`,
    { flag: "wx" }
  );
  return freeze;
}

async function main() {
  const freeze = await freezeExp0021Instrumentation();
  console.log(
    `EXP-0021 instrumentação congelada: ` +
      freeze.instrumentationFreezeSha256
  );
  console.log("Zero Chrome, rede, TTS, API paga, GPU ou nova autoridade.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
