import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson, canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  EXP0025_R_HOLDOUT_PACK_PATH,
  assertExp0025RHoldoutBoundary
} from "./build-exp-0025-r-holdout-pack.mjs";
import {
  EXP0025_R_LOCAL_FREEZE_PATH,
  validateExp0025RLocalFreeze
} from "./freeze-exp-0025-r-local-candidate.mjs";
import { checkExp0025RHoldoutAudio } from
  "./materialize-exp-0025-r-holdout-audio.mjs";

export const EXP0025_R_HOLDOUT_SEAL_PATH =
  "eval/commitments/exp-0025-r-holdout-seal-v0.1.json";
export const EXP0025_R_HOLDOUT_SEAL_SCHEMA =
  "exp-0025-r-holdout-seal-v1";
export const EXP0025_R_HOLDOUT_OPENING_PATH =
  "eval/commitments/exp-0025-r-holdout-opening-v0.1.json";
export const EXP0025_R_HOLDOUT_RECEIPT_PATH =
  "eval/generated/exp-0025-r/holdout-attempt-consumed-v0.1.json";
export const EXP0025_R_HOLDOUT_REPORT_PATH =
  "eval/reports/exp-0025-r-local-holdout-v0.1.json";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const SEALED_AT = "2026-08-03T15:35:00.000Z";
const INSTRUMENT_PATHS = Object.freeze([
  "scripts/build-exp-0025-r-holdout-pack.mjs",
  "scripts/materialize-exp-0025-r-holdout-audio.mjs",
  "scripts/open-exp-0025-r-holdout.mjs",
  "scripts/run-exp-0025-r-local-holdout.mjs"
]);

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0025-R seal H: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  return access(resolve(PROJECT_ROOT, path)).then(() => true, () => false);
}

async function gitText(...args) {
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
      resolveGit(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}

async function committedBytes(commit, path) {
  return new Promise((resolveGit, rejectGit) => {
    const child = spawn("git", ["show", `${commit}:${path}`], {
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
      resolveGit(Buffer.concat(stdout));
    });
  });
}

export function validateExp0025RHoldoutSeal(seal) {
  try {
    const core = structuredClone(seal);
    delete core.sealSha256;
    return seal?.schemaVersion === EXP0025_R_HOLDOUT_SEAL_SCHEMA &&
      seal?.experimentId === "EXP-0025-R" &&
      seal?.stage === "HOLDOUT_SEALED_BEFORE_INFERENCE" &&
      seal?.holdout?.pairs === 24 && seal?.holdout?.utterances === 48 &&
      seal?.holdout?.sessions === 8 &&
      seal?.holdout?.inferenceCountAtSeal === 0 &&
      seal?.holdout?.openedAtSeal === false &&
      seal?.boundary?.disjointSurfaces === true &&
      seal?.localCandidate?.singleCandidate === true &&
      seal?.externalReference?.executionAuthorized === false &&
      seal?.authorityEligible === false &&
      seal.sealSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

export async function verifyExp0025RHoldoutSeal(seal) {
  invariant(validateExp0025RHoldoutSeal(seal), "commitmento malformado");
  const [packBytes, freezeBytes] = await Promise.all([
    committedBytes(seal.sealSourceCommit, seal.holdout.path),
    committedBytes(seal.sealSourceCommit, seal.localCandidate.freezePath)
  ]);
  invariant(sha256(packBytes) === seal.holdout.fileSha256, "pack H divergiu");
  invariant(
    sha256(freezeBytes) === seal.localCandidate.freezeFileSha256,
    "freeze L divergiu"
  );
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  invariant(validateExp0025RLocalFreeze(freeze), "freeze L inválido");
  invariant(
    freeze.freezeSha256 === seal.localCandidate.freezeSha256,
    "hash lógico do freeze L divergiu"
  );
  for (const binding of seal.instrumentBindings) {
    const bytes = await committedBytes(seal.sealSourceCommit, binding.path);
    invariant(sha256(bytes) === binding.sha256, `${binding.path} divergiu`);
  }
  return seal;
}

export async function sealExp0025RHoldout() {
  invariant(
    await gitText("status", "--porcelain=v1", "--untracked-files=all") === "",
    "worktree precisa estar limpa"
  );
  for (const path of [
    EXP0025_R_HOLDOUT_SEAL_PATH,
    EXP0025_R_HOLDOUT_OPENING_PATH,
    EXP0025_R_HOLDOUT_RECEIPT_PATH,
    EXP0025_R_HOLDOUT_REPORT_PATH
  ]) invariant(!await exists(path), `${path} já existe`);

  const head = await gitText("rev-parse", "HEAD");
  const pack = await checkExp0025RHoldoutAudio();
  const boundary = await assertExp0025RHoldoutBoundary(pack);
  const [packBytes, freezeBytes, instrumentBindings] = await Promise.all([
    committedBytes(head, EXP0025_R_HOLDOUT_PACK_PATH),
    committedBytes(head, EXP0025_R_LOCAL_FREEZE_PATH),
    Promise.all(INSTRUMENT_PATHS.map(async (path) => ({
      path,
      sha256: sha256(await committedBytes(head, path))
    })))
  ]);
  const worktreePackBytes = await readFile(resolve(EXP0025_R_HOLDOUT_PACK_PATH));
  invariant(packBytes.equals(worktreePackBytes), "pack H não está commitado");
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  invariant(validateExp0025RLocalFreeze(freeze), "freeze L inválido");

  const core = {
    schemaVersion: EXP0025_R_HOLDOUT_SEAL_SCHEMA,
    experimentId: "EXP-0025-R",
    stage: "HOLDOUT_SEALED_BEFORE_INFERENCE",
    sealedAt: SEALED_AT,
    sealSourceCommit: head,
    holdout: {
      path: EXP0025_R_HOLDOUT_PACK_PATH,
      packSha256: pack.packSha256,
      fileSha256: sha256(packBytes),
      pairs: pack.pairs,
      utterances: pack.utterances.length,
      sessions: pack.sessions,
      inferenceCountAtSeal: 0,
      openedAtSeal: false,
      generatedAfterLocalFreeze: true
    },
    boundary,
    localCandidate: {
      id: freeze.candidate.id,
      role: freeze.candidate.role,
      singleCandidate: true,
      runnerSourceCommit: freeze.runnerSourceCommit,
      freezePath: EXP0025_R_LOCAL_FREEZE_PATH,
      freezeSha256: freeze.freezeSha256,
      freezeFileSha256: sha256(freezeBytes)
    },
    instrumentBindings,
    openingPolicy: {
      maximumLocalInferencePasses: 1,
      receiptWrittenBeforeInference: true,
      crashAfterReceiptAllowsRerun: false,
      secondCandidateAllowed: false
    },
    externalReference: {
      status: "NOT_EVALUATED_NO_AUTHORIZATION",
      executionAuthorized: false,
      includedInOpening: false
    },
    authorityEligible: false
  };
  const seal = Object.freeze({
    ...core,
    sealSha256: `sha256:${canonicalSha256(core)}`
  });
  await writeFile(
    resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_SEAL_PATH),
    `${canonicalJson(seal)}\n`,
    { flag: "wx" }
  );
  return seal;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  invariant(
    [...args].every((arg) => arg === "--check") && args.size <= 1,
    "uso: node scripts/seal-exp-0025-r-holdout.mjs [--check]"
  );
  const seal = args.has("--check")
    ? await verifyExp0025RHoldoutSeal(JSON.parse(await readFile(
      resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_SEAL_PATH),
      "utf8"
    )))
    : await sealExp0025RHoldout();
  process.stdout.write(
    `EXP-0025-R H ${args.has("--check") ? "verificado" : "selado"}: ` +
      `${seal.sealSha256}; inferências no seal=${seal.holdout.inferenceCountAtSeal}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
