import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  EXP0023_BOUNDARY_PATHS,
  EXP0023_C0_CHANGED_PATHS,
  EXP0023_EXP0022_SOURCE_COMMIT,
  EXP0023_INHERITED_INSTRUMENTATION_SOURCE_PATHS,
  EXP0023_INSTRUMENTATION_SOURCE_PATHS,
  EXP0023_PRODUCTION_SOURCE_PATHS,
  EXP0023_RUNTIME_ALLOWED_DRIFT_PATHS,
  EXP0023_RUNTIME_FINGERPRINT_ALGORITHM,
  EXP0023_RUNTIME_FINGERPRINT_ROOTS,
  createExp0023InstrumentationFreeze,
  validateExp0023C0Boundary
} from "../src/eval/exp-0023-boundary.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0023 freeze: ${message}`);
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
    child.once("close", (code) => {
      if (code !== 0) {
        rejectGit(new Error(Buffer.concat(stderr).toString("utf8").trim()));
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

function fingerprint(files) {
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
    algorithm: EXP0023_RUNTIME_FINGERPRINT_ALGORITHM,
    sha256: digest.digest("hex"),
    fileCount: ordered.length,
    roots: [...EXP0023_RUNTIME_FINGERPRINT_ROOTS]
  };
}

async function runtimeFingerprintAtCommit(commit) {
  const listing = await gitBytes(
    "ls-tree",
    "-rz",
    "--name-only",
    commit,
    "--",
    ...EXP0023_RUNTIME_FINGERPRINT_ROOTS
  );
  const paths = listing.toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const path of paths) {
    files.push({ path, bytes: await gitBytes("show", `${commit}:${path}`) });
  }
  return fingerprint(files);
}

async function artifact(path) {
  const bytes = await readFile(resolve(PROJECT_ROOT, path));
  return { path, fileSha256: sha256(bytes) };
}

async function productionSource(path, head) {
  const [bytes, baselineBytes] = await Promise.all([
    gitBytes("show", `${head}:${path}`),
    gitBytes("show", `${EXP0023_EXP0022_SOURCE_COMMIT}:${path}`)
  ]);
  return {
    path,
    fileSha256: sha256(bytes),
    exp0022FileSha256: sha256(baselineBytes)
  };
}

async function instrumentationSource(path, head) {
  const bytes = await gitBytes("show", `${head}:${path}`);
  const record = { path, fileSha256: sha256(bytes) };
  if (EXP0023_INHERITED_INSTRUMENTATION_SOURCE_PATHS.includes(path)) {
    record.exp0022FileSha256 = sha256(
      await gitBytes("show", `${EXP0023_EXP0022_SOURCE_COMMIT}:${path}`)
    );
  }
  return record;
}

async function main() {
  invariant(process.argv.length === 2, "não aceita argumentos livres");
  invariant(
    (await gitText("status", "--porcelain")) === "",
    "worktree precisa estar limpa"
  );
  const head = await gitText("rev-parse", "HEAD");
  const parent = await gitText("rev-parse", "HEAD^");
  const runtimeChangedPaths = (await gitText(
    "diff",
    "--name-only",
    EXP0023_EXP0022_SOURCE_COMMIT,
    head,
    "--",
    ...EXP0023_RUNTIME_FINGERPRINT_ROOTS
  )).split(/\r?\n/u).filter(Boolean).toSorted();
  invariant(validateExp0023C0Boundary({
    runnerSourceCommit: head,
    parentCommit: parent,
    changedPaths: await changedPaths(head),
    runtimeChangedPaths
  }),
  `C0 precisa ser filho direto da base e conter exatamente ` +
    `${EXP0023_C0_CHANGED_PATHS.length} paths; runtime esperado: ` +
    EXP0023_RUNTIME_ALLOWED_DRIFT_PATHS.join(", "));
  for (const path of [
    EXP0023_BOUNDARY_PATHS.freeze,
    EXP0023_BOUNDARY_PATHS.attempt,
    EXP0023_BOUNDARY_PATHS.receipt,
    EXP0023_BOUNDARY_PATHS.report
  ]) {
    invariant(!await exists(resolve(PROJECT_ROOT, path)),
      `${path} já existe`);
  }
  const [artifacts, productionSources, instrumentationSources, runtimeBinding] =
    await Promise.all([
      Promise.all([
        artifact(EXP0023_BOUNDARY_PATHS.preregistration),
        artifact(EXP0023_BOUNDARY_PATHS.exp0022Report),
        artifact(EXP0023_BOUNDARY_PATHS.exp0022Closeout)
      ]),
      Promise.all(EXP0023_PRODUCTION_SOURCE_PATHS.map((path) =>
        productionSource(path, head))),
      Promise.all(EXP0023_INSTRUMENTATION_SOURCE_PATHS.map((path) =>
        instrumentationSource(path, head))),
      runtimeFingerprintAtCommit(head)
    ]);
  const freeze = createExp0023InstrumentationFreeze({
    runnerSourceCommit: head,
    nodeVersion: process.version,
    runtimeBinding,
    artifacts: {
      preregistration: artifacts[0],
      exp0022Report: artifacts[1],
      exp0022Closeout: artifacts[2]
    },
    productionSources,
    instrumentationSources
  });
  const outputPath = resolve(PROJECT_ROOT, EXP0023_BOUNDARY_PATHS.freeze);
  await writeFile(outputPath, `${JSON.stringify(freeze, null, 2)}\n`, {
    flag: "wx"
  });
  console.log(
    `EXP-0023 instrumentação congelada: ` +
    freeze.instrumentationFreezeSha256
  );
  console.log("Commite somente o freeze antes de abrir a tentativa.");
}

await main();
