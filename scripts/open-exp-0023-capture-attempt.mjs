import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  EXP0023_BOUNDARY_PATHS,
  createExp0023CaptureAttempt,
  validateExp0023InstrumentationFreeze
} from "../src/eval/exp-0023-boundary.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0023 opening: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function git(args, encoding = "utf8") {
  return new Promise((resolveGit, rejectGit) => {
    const child = spawn("git", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectGit);
    child.once("close", (code) => {
      if (code !== 0) {
        rejectGit(new Error(Buffer.concat(stderr).toString("utf8").trim()));
        return;
      }
      const bytes = Buffer.concat(stdout);
      resolveGit(encoding === "buffer" ? bytes : bytes.toString("utf8"));
    });
  });
}

async function gitText(...args) {
  return (await git(args)).trim();
}

async function main() {
  invariant(process.argv.length === 2, "não aceita argumentos livres");
  invariant(
    (await gitText("status", "--porcelain")) === "",
    "worktree precisa estar limpa"
  );
  const freezePath = resolve(PROJECT_ROOT, EXP0023_BOUNDARY_PATHS.freeze);
  const freezeBytes = await readFile(freezePath);
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const validation = validateExp0023InstrumentationFreeze(freeze);
  invariant(validation.valid, validation.errors.join("; "));
  const head = await gitText("rev-parse", "HEAD");
  const parent = await gitText("rev-parse", "HEAD^");
  invariant(
    parent === freeze.runnerSourceCommit,
    "freeze commit precisa ser filho direto do C0"
  );
  const changed = (await gitText(
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    head
  )).split(/\r?\n/u).filter(Boolean).toSorted();
  invariant(
    changed.length === 1 && changed[0] === EXP0023_BOUNDARY_PATHS.freeze,
    "freeze commit precisa conter somente o freeze"
  );
  const committedFreeze = await git(
    ["show", `HEAD:${EXP0023_BOUNDARY_PATHS.freeze}`],
    "buffer"
  );
  invariant(
    Buffer.from(committedFreeze).equals(freezeBytes),
    "freeze do worktree divergiu do commit"
  );
  for (const path of [
    EXP0023_BOUNDARY_PATHS.attempt,
    EXP0023_BOUNDARY_PATHS.receipt,
    EXP0023_BOUNDARY_PATHS.report
  ]) invariant(!await exists(resolve(PROJECT_ROOT, path)), `${path} já existe`);

  const attempt = createExp0023CaptureAttempt({
    openingSourceCommit: head,
    openedAt: new Date().toISOString(),
    freeze: {
      path: EXP0023_BOUNDARY_PATHS.freeze,
      fileSha256: sha256(freezeBytes),
      instrumentationFreezeSha256:
        freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    }
  });
  await writeFile(
    resolve(PROJECT_ROOT, EXP0023_BOUNDARY_PATHS.attempt),
    `${JSON.stringify(attempt, null, 2)}\n`,
    { flag: "wx" }
  );
  console.log(`EXP-0023 tentativa aberta: ${attempt.captureAttemptSha256}`);
  console.log("Commite somente a tentativa antes de executar o supervisor.");
}

await main();
