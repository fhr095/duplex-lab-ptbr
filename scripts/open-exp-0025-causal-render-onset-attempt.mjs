import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0025_BOUNDARY_PATHS,
  EXP0025_CONFIG,
  EXP0025_REQUIRED_CHROME,
  createExp0025PhysicalStopAttempt,
  validateExp0025FreezeCommitBoundary,
  validateExp0025InstrumentationFreeze
} from "../src/eval/exp-0025-boundary.mjs";
import { fetchExp0025Health } from "./lib/exp-0025-browser-harness.mjs";
import { discoverExp0022CdpUrl } from "./run-exp-0022-worker.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0025 opening: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function git(args, encoding = "buffer", projectRoot = PROJECT_ROOT) {
  return new Promise((resolveGit, rejectGit) => {
    const child = spawn("git", args, {
      cwd: projectRoot,
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

async function gitText(projectRoot, ...args) {
  return (await git(args, "utf8", projectRoot)).trim();
}

async function gitBytes(projectRoot, ...args) {
  return git(args, "buffer", projectRoot);
}

async function changedPaths(projectRoot, commit) {
  return (await gitText(
    projectRoot,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    commit
  )).split(/\r?\n/u).filter(Boolean).toSorted();
}

function normalizeChromeVersion(value) {
  return {
    product: value?.Browser ?? value?.product ?? null,
    protocolVersion: value?.["Protocol-Version"] ??
      value?.protocolVersion ?? null
  };
}

export function validateExp0025PreflightHealth(health, expectedFingerprint) {
  const zeroUsage = [
    "requests", "inputTokens", "outputTokens", "totalTokens"
  ].every((field) => health?.usage?.[field] === 0);
  return health?.process?.runtimeFingerprint?.sha256 === expectedFingerprint &&
    health?.brain === EXP0025_CONFIG.provider && zeroUsage &&
    health?.asr?.state === EXP0025_CONFIG.asrState &&
    health?.vadControl?.engine === EXP0025_CONFIG.vadControlEngine &&
    health?.vadShadow?.state === EXP0025_CONFIG.vadShadowState &&
    health?.tts?.state === "ready" &&
    health?.tts?.engine === EXP0025_CONFIG.ttsEngine &&
    typeof health?.tts?.voice === "string" &&
    health.tts.voice.trim().length > 0 && health?.tts?.culture === "pt-BR";
}

export async function runExp0025Preflight(options = {}) {
  const freeze = options.freeze;
  invariant(freeze !== null && typeof freeze === "object", "freeze ausente");
  invariant(process.version === freeze.nodeVersion,
    "Node divergiu do freeze");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  invariant(typeof fetchImpl === "function", "fetch indisponível");
  const health = await (options.fetchHealth ?? fetchExp0025Health)(
    EXP0025_CONFIG.targetUrl,
    fetchImpl
  );
  invariant(validateExp0025PreflightHealth(
    health,
    freeze.runtimeBinding.sha256
  ), "health local divergiu do runtime/ambiente congelado");

  const cdpUrl = options.cdpUrl ??
    (options.discoverCdpUrl ?? discoverExp0022CdpUrl)();
  const versionResponse = await fetchImpl(new URL("/json/version", cdpUrl), {
    redirect: "error",
    signal: AbortSignal.timeout(10_000)
  });
  invariant(versionResponse.ok,
    `CDP /json/version retornou HTTP ${versionResponse.status}`);
  const chrome = normalizeChromeVersion(await versionResponse.json());
  invariant(isDeepStrictEqual(chrome, EXP0025_REQUIRED_CHROME),
    "Chrome/CDP divergiu da versão congelada");
  return Object.freeze({
    completedAt: options.completedAt ?? new Date().toISOString(),
    nodeVersion: process.version,
    chrome,
    runtimeFingerprintSha256: freeze.runtimeBinding.sha256,
    provider: health.brain,
    targetAutomationNavigations: 0,
    physicalStops: 0,
    paidApiCalls: 0,
    gpuRuns: 0
  });
}

export async function verifyExp0025FreezeForOpening(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  invariant(
    (await gitText(
      projectRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    )) === "",
    "worktree precisa estar limpa"
  );
  const freezePath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.freeze);
  const freezeBytes = await readFile(freezePath);
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const validation = validateExp0025InstrumentationFreeze(freeze);
  invariant(validation.valid, validation.errors.join("; "));
  const head = await gitText(projectRoot, "rev-parse", "HEAD");
  const parent = await gitText(projectRoot, "rev-parse", "HEAD^");
  invariant(validateExp0025FreezeCommitBoundary({
    c0Commit: freeze.runnerSourceCommit,
    freezeCommit: head,
    parentCommit: parent,
    changedPaths: await changedPaths(projectRoot, head)
  }), "freeze commit não é filho isolado do C0");
  invariant(
    (await gitBytes(
      projectRoot,
      "show",
      `${head}:${EXP0025_BOUNDARY_PATHS.freeze}`
    )).equals(freezeBytes),
    "freeze do worktree divergiu do commit"
  );
  return Object.freeze({ projectRoot, freeze, freezeBytes, freezeCommit: head });
}

export async function openExp0025PhysicalStopAttempt(options = {}) {
  const boundary = await (options.verifyFreeze ??
    verifyExp0025FreezeForOpening)(options);
  const projectRoot = boundary.projectRoot ??
    resolve(options.projectRoot ?? PROJECT_ROOT);
  for (const path of [
    EXP0025_BOUNDARY_PATHS.opening,
    EXP0025_BOUNDARY_PATHS.receipt,
    EXP0025_BOUNDARY_PATHS.journal,
    EXP0025_BOUNDARY_PATHS.report,
    EXP0025_BOUNDARY_PATHS.lock
  ]) invariant(!await exists(resolve(projectRoot, path)), `${path} já existe`);

  const preflight = await (options.preflight ?? runExp0025Preflight)({
    freeze: boundary.freeze,
    ...(options.preflightOptions ?? {})
  });
  const opening = createExp0025PhysicalStopAttempt({
    freezeCommit: boundary.freezeCommit,
    openedAt: options.openedAt ?? new Date().toISOString(),
    freeze: {
      path: EXP0025_BOUNDARY_PATHS.freeze,
      fileSha256: sha256(boundary.freezeBytes),
      instrumentationFreezeSha256:
        boundary.freeze.instrumentationFreezeSha256,
      runnerSourceCommit: boundary.freeze.runnerSourceCommit,
      freezeCommit: boundary.freezeCommit,
      nodeVersion: boundary.freeze.nodeVersion,
      expectedRuntimeFingerprintSha256: boundary.freeze.runtimeBinding.sha256
    },
    preflight
  });
  const outputPath = resolve(projectRoot, EXP0025_BOUNDARY_PATHS.opening);
  await writeFile(outputPath, `${JSON.stringify(opening, null, 2)}\n`, {
    flag: "wx"
  });
  await mkdir(
    dirname(resolve(projectRoot, EXP0025_BOUNDARY_PATHS.lock)),
    { recursive: true }
  );
  return opening;
}

async function main() {
  invariant(process.argv.length === 2, "não aceita argumentos livres");
  const opening = await openExp0025PhysicalStopAttempt();
  console.log(
    `EXP-0025 tentativa aberta: ${opening.physicalStopAttemptSha256}`
  );
  console.log(
    "Commite somente a abertura; depois não execute outro preflight."
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) await main();
