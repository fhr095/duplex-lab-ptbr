import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  EXP0025_BOUNDARY_PATHS,
  EXP0025_C0_CHANGED_PATHS,
  EXP0025_EXP0019_EVIDENCE_COMMIT,
  EXP0025_INSTRUMENTATION_SOURCE_PATHS,
  EXP0025_PRODUCTION_SOURCE_PATHS,
  EXP0025_RUNTIME_ALLOWED_DRIFT_PATHS,
  EXP0025_RUNTIME_FINGERPRINT_ALGORITHM,
  EXP0025_RUNTIME_FINGERPRINT_ROOTS,
  createExp0025InstrumentationFreeze,
  validateExp0025C0Boundary
} from "../src/eval/exp-0025-boundary.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0025 freeze: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function git(args, encoding = "buffer") {
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
    child.once("close", (code, signal) => {
      if (code !== 0) {
        rejectGit(new Error(
          `git ${args[0]} falhou (${code ?? signal}): ` +
            Buffer.concat(stderr).toString("utf8").trim()
        ));
        return;
      }
      const bytes = Buffer.concat(stdout);
      resolveGit(encoding === "buffer" ? bytes : bytes.toString(encoding));
    });
  });
}

async function gitText(...args) {
  return (await git(args, "utf8")).trim();
}

async function gitBytes(...args) {
  return git(args, "buffer");
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

function runtimeFingerprint(files) {
  const ordered = files.toSorted((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const digest = createHash("sha256");
  for (const file of ordered) {
    digest.update(
      `${file.path.length}:${file.path}:${file.bytes.length}:`,
      "utf8"
    );
    digest.update(file.bytes);
  }
  return {
    algorithm: EXP0025_RUNTIME_FINGERPRINT_ALGORITHM,
    sha256: digest.digest("hex"),
    fileCount: ordered.length,
    roots: [...EXP0025_RUNTIME_FINGERPRINT_ROOTS]
  };
}

async function runtimeFingerprintAtCommit(commit) {
  const listing = await gitBytes(
    "ls-tree",
    "-rz",
    "--name-only",
    commit,
    "--",
    ...EXP0025_RUNTIME_FINGERPRINT_ROOTS
  );
  const paths = listing.toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const path of paths) {
    files.push({ path, bytes: await gitBytes("show", `${commit}:${path}`) });
  }
  return runtimeFingerprint(files);
}

async function artifact(path, head) {
  const [worktreeBytes, committedBytes] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, path)),
    gitBytes("show", `${head}:${path}`)
  ]);
  invariant(
    worktreeBytes.equals(committedBytes),
    `artefato divergiu do C0: ${path}`
  );
  return { path, fileSha256: sha256(committedBytes) };
}

async function productionSource(path, head) {
  const [bytes, exp0019Bytes] = await Promise.all([
    gitBytes("show", `${head}:${path}`),
    gitBytes("show", `${EXP0025_EXP0019_EVIDENCE_COMMIT}:${path}`)
  ]);
  return {
    path,
    fileSha256: sha256(bytes),
    exp0019FileSha256: sha256(exp0019Bytes)
  };
}

async function instrumentationSource(path, head) {
  return {
    path,
    fileSha256: sha256(await gitBytes("show", `${head}:${path}`))
  };
}

export async function freezeExp0025Instrumentation() {
  invariant(
    (await gitText("status", "--porcelain=v1", "--untracked-files=all")) ===
      "",
    "worktree precisa estar limpa"
  );
  const head = await gitText("rev-parse", "HEAD");
  const parent = await gitText("rev-parse", "HEAD^");
  const runtimeChangedPaths = (await gitText(
    "diff",
    "--name-only",
    parent,
    head,
    "--",
    ...EXP0025_RUNTIME_FINGERPRINT_ROOTS
  )).split(/\r?\n/u).filter(Boolean).toSorted();
  invariant(validateExp0025C0Boundary({
    runnerSourceCommit: head,
    parentCommit: parent,
    changedPaths: await changedPaths(head),
    runtimeChangedPaths
  }),
  `C0 precisa ser filho direto da base e conter exatamente ` +
    `${EXP0025_C0_CHANGED_PATHS.length} paths; runtime esperado: ` +
    EXP0025_RUNTIME_ALLOWED_DRIFT_PATHS.join(", "));

  for (const path of [
    EXP0025_BOUNDARY_PATHS.freeze,
    EXP0025_BOUNDARY_PATHS.opening,
    EXP0025_BOUNDARY_PATHS.receipt,
    EXP0025_BOUNDARY_PATHS.journal,
    EXP0025_BOUNDARY_PATHS.report,
    EXP0025_BOUNDARY_PATHS.lock
  ]) {
    invariant(!await exists(resolve(PROJECT_ROOT, path)), `${path} já existe`);
  }

  const [artifacts, productionSources, instrumentationSources, runtimeBinding] =
    await Promise.all([
      Promise.all([
        artifact(EXP0025_BOUNDARY_PATHS.preregistration, head),
        artifact(EXP0025_BOUNDARY_PATHS.exp0019Report, head),
        artifact(EXP0025_BOUNDARY_PATHS.exp0019Closeout, head),
        artifact(EXP0025_BOUNDARY_PATHS.exp0023Report, head),
        artifact(EXP0025_BOUNDARY_PATHS.exp0023Closeout, head),
        artifact(EXP0025_BOUNDARY_PATHS.exp0024Report, head),
        artifact(EXP0025_BOUNDARY_PATHS.exp0024Closeout, head)
      ]),
      Promise.all(EXP0025_PRODUCTION_SOURCE_PATHS.map((path) =>
        productionSource(path, head))),
      Promise.all(EXP0025_INSTRUMENTATION_SOURCE_PATHS.map((path) =>
        instrumentationSource(path, head))),
      runtimeFingerprintAtCommit(head)
    ]);
  const freeze = createExp0025InstrumentationFreeze({
    runnerSourceCommit: head,
    nodeVersion: process.version,
    runtimeBinding,
    artifacts: {
      preregistration: artifacts[0],
      exp0019Report: artifacts[1],
      exp0019Closeout: artifacts[2],
      exp0023Report: artifacts[3],
      exp0023Closeout: artifacts[4],
      exp0024Report: artifacts[5],
      exp0024Closeout: artifacts[6]
    },
    productionSources,
    instrumentationSources
  });
  const outputPath = resolve(PROJECT_ROOT, EXP0025_BOUNDARY_PATHS.freeze);
  await writeFile(outputPath, `${JSON.stringify(freeze, null, 2)}\n`, {
    flag: "wx"
  });
  return freeze;
}

async function main() {
  invariant(process.argv.length === 2, "não aceita argumentos livres");
  const freeze = await freezeExp0025Instrumentation();
  console.log(
    `EXP-0025 instrumentação congelada: ` +
      freeze.instrumentationFreezeSha256
  );
  console.log("Commite somente o freeze antes do preflight e da abertura.");
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
