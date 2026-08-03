import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  EXP0022_BOUNDARY_PATHS,
  EXP0022_C0_CHANGED_PATHS,
  EXP0022_EXP0021_SOURCE_COMMIT,
  EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS,
  EXP0022_INSTRUMENTATION_SOURCE_PATHS,
  EXP0022_PRODUCTION_SOURCE_PATHS,
  EXP0022_RUNTIME_ALLOWED_DRIFT_PATHS,
  EXP0022_RUNTIME_FINGERPRINT_ROOTS,
  createExp0022InstrumentationFreeze,
  validateExp0022C0Boundary
} from "../src/eval/exp-0022-boundary.mjs";
import { createSourceFingerprint } from
  "../src/eval/source-fingerprint.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0022 freeze: ${message}`);
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

export async function freezeExp0022Instrumentation() {
  invariant(
    await gitText("status", "--porcelain=v1", "--untracked-files=all") === "",
    "worktree precisa estar limpo e commitado"
  );
  await Promise.all([
    assertAbsent(EXP0022_BOUNDARY_PATHS.freeze, "freeze"),
    assertAbsent(EXP0022_BOUNDARY_PATHS.attempt, "tentativa"),
    assertAbsent(EXP0022_BOUNDARY_PATHS.receipt, "recibo"),
    assertAbsent(EXP0022_BOUNDARY_PATHS.report, "relatório")
  ]);

  const runnerSourceCommit = await gitText("rev-parse", "HEAD");
  const parentCommit = await gitText("rev-parse", "HEAD^");
  const c0ChangedPaths = (await gitText(
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    runnerSourceCommit
  )).split(/\r?\n/u).filter(Boolean).toSorted();
  const runtimeChangedPaths = (await gitText(
    "diff",
    "--name-only",
    EXP0022_EXP0021_SOURCE_COMMIT,
    runnerSourceCommit,
    "--",
    ...EXP0022_RUNTIME_FINGERPRINT_ROOTS
  )).split(/\r?\n/u).filter(Boolean).toSorted();
  invariant(
    validateExp0022C0Boundary({
      runnerSourceCommit,
      parentCommit,
      changedPaths: c0ChangedPaths,
      runtimeChangedPaths
    }),
    `C0 precisa ser filho direto da base e alterar exatamente os paths ` +
      `autorizados (${EXP0022_C0_CHANGED_PATHS.length} C0; ` +
      `${EXP0022_RUNTIME_ALLOWED_DRIFT_PATHS.length} runtime)`
  );
  const [preregistration, exp0021Report, exp0021Closeout] =
    await Promise.all([
      trackedHeadBytes(EXP0022_BOUNDARY_PATHS.preregistration),
      trackedHeadBytes(EXP0022_BOUNDARY_PATHS.exp0021Report),
      trackedHeadBytes(EXP0022_BOUNDARY_PATHS.exp0021Closeout)
    ]);

  const productionSources = [];
  for (const path of EXP0022_PRODUCTION_SOURCE_PATHS) {
    const [current, baseline] = await Promise.all([
      trackedHeadBytes(path),
      gitBytes("show", `${EXP0022_EXP0021_SOURCE_COMMIT}:${path}`)
    ]);
    invariant(
      current.equals(baseline),
      `${path} mudou desde a evidência canônica do EXP-0021`
    );
    productionSources.push({
      path,
      fileSha256: sha256(current),
      exp0021FileSha256: sha256(baseline)
    });
  }

  const instrumentationSources = [];
  const inheritedCaptureSources = new Set(
    EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS
  );
  for (const path of EXP0022_INSTRUMENTATION_SOURCE_PATHS) {
    const bytes = await trackedHeadBytes(path);
    if (inheritedCaptureSources.has(path)) {
      const baseline = await gitBytes(
        "show",
        `${EXP0022_EXP0021_SOURCE_COMMIT}:${path}`
      );
      invariant(
        bytes.equals(baseline),
        `${path} mudou desde o C0 do EXP-0021`
      );
      instrumentationSources.push({
        path,
        fileSha256: sha256(bytes),
        exp0021FileSha256: sha256(baseline)
      });
    } else {
      instrumentationSources.push({ path, fileSha256: sha256(bytes) });
    }
  }

  const runtimeBinding = await createSourceFingerprint(PROJECT_ROOT, {
    roots: EXP0022_RUNTIME_FINGERPRINT_ROOTS
  });

  const freeze = createExp0022InstrumentationFreeze({
    runnerSourceCommit,
    nodeVersion: process.version,
    artifacts: {
      preregistration: {
        path: EXP0022_BOUNDARY_PATHS.preregistration,
        fileSha256: sha256(preregistration)
      },
      exp0021Report: {
        path: EXP0022_BOUNDARY_PATHS.exp0021Report,
        fileSha256: sha256(exp0021Report)
      },
      exp0021Closeout: {
        path: EXP0022_BOUNDARY_PATHS.exp0021Closeout,
        fileSha256: sha256(exp0021Closeout)
      }
    },
    runtimeBinding,
    productionSources,
    instrumentationSources
  });
  await writeFile(
    resolve(PROJECT_ROOT, EXP0022_BOUNDARY_PATHS.freeze),
    `${JSON.stringify(freeze, null, 2)}\n`,
    { flag: "wx" }
  );
  return freeze;
}

async function main() {
  const freeze = await freezeExp0022Instrumentation();
  console.log(
    `EXP-0022 instrumentação congelada: ` +
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
