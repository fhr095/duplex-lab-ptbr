import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import {
  EXP0022_BOUNDARY_PATHS,
  EXP0022_INSTRUMENTATION_SOURCE_PATHS,
  EXP0022_PRODUCTION_SOURCE_PATHS,
  createExp0022CaptureAttempt,
  validateExp0022InstrumentationFreeze
} from "../src/eval/exp-0022-boundary.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0022 opening: ${message}`);
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

async function changedPaths(commit) {
  return (await gitText(
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    commit
  )).split(/\r?\n/u).filter(Boolean).toSorted();
}

export async function openExp0022CaptureAttempt() {
  invariant(
    await gitText("status", "--porcelain=v1", "--untracked-files=all") === "",
    "worktree precisa estar limpo e commitado"
  );
  await Promise.all([
    assertAbsent(EXP0022_BOUNDARY_PATHS.attempt, "tentativa"),
    assertAbsent(EXP0022_BOUNDARY_PATHS.receipt, "recibo"),
    assertAbsent(EXP0022_BOUNDARY_PATHS.report, "relatório")
  ]);

  const freezeCommit = await gitText("rev-parse", "HEAD");
  const freezeBytes = await readFile(
    resolve(PROJECT_ROOT, EXP0022_BOUNDARY_PATHS.freeze)
  );
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const validation = validateExp0022InstrumentationFreeze(freeze);
  invariant(validation.valid, validation.errors.join("; "));
  invariant(
    (await gitBytes(
      "show",
      `HEAD:${EXP0022_BOUNDARY_PATHS.freeze}`
    )).equals(freezeBytes),
    "freeze precisa estar commitado byte a byte em HEAD"
  );
  invariant(
    await gitText("rev-parse", "HEAD^") === freeze.runnerSourceCommit,
    "commit do freeze precisa ser filho direto de C0"
  );
  invariant(
    isDeepStrictEqual(
      await changedPaths(freezeCommit),
      [EXP0022_BOUNDARY_PATHS.freeze]
    ),
    "commit do freeze pode alterar somente o commitment"
  );

  for (const record of [
    ...freeze.productionSources,
    ...freeze.instrumentationSources
  ]) {
    const [source, current] = await Promise.all([
      gitBytes("show", `${freeze.runnerSourceCommit}:${record.path}`),
      readFile(resolve(PROJECT_ROOT, record.path))
    ]);
    invariant(
      sha256(source) === record.fileSha256 &&
        sha256(current) === record.fileSha256,
      `${record.path} divergiu depois do freeze`
    );
  }
  invariant(
    freeze.productionSources.length === EXP0022_PRODUCTION_SOURCE_PATHS.length &&
      freeze.instrumentationSources.length ===
        EXP0022_INSTRUMENTATION_SOURCE_PATHS.length,
    "allowlist do freeze ficou incompleto"
  );

  const attempt = createExp0022CaptureAttempt({
    openingSourceCommit: freezeCommit,
    openedAt: new Date().toISOString(),
    freeze: {
      path: EXP0022_BOUNDARY_PATHS.freeze,
      fileSha256: sha256(freezeBytes),
      instrumentationFreezeSha256:
        freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    }
  });
  await writeFile(
    resolve(PROJECT_ROOT, EXP0022_BOUNDARY_PATHS.attempt),
    `${JSON.stringify(attempt, null, 2)}\n`,
    { flag: "wx" }
  );
  return attempt;
}

async function main() {
  const attempt = await openExp0022CaptureAttempt();
  console.log(`EXP-0022 tentativa aberta: ${attempt.captureAttemptSha256}`);
  console.log("Commite somente a tentativa antes de executar o supervisor.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
