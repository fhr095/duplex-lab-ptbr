import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { EXP0025_R_LOCAL_CANDIDATE_ID } from
  "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson, canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  EXP0025_R_HOLDOUT_OPENING_PATH,
  EXP0025_R_HOLDOUT_RECEIPT_PATH,
  EXP0025_R_HOLDOUT_REPORT_PATH,
  EXP0025_R_HOLDOUT_SEAL_PATH,
  validateExp0025RHoldoutSeal,
  verifyExp0025RHoldoutSeal
} from "./seal-exp-0025-r-holdout.mjs";

export const EXP0025_R_HOLDOUT_OPENING_SCHEMA =
  "exp-0025-r-holdout-opening-v1";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OPENED_AT = "2026-08-03T15:40:00.000Z";

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0025-R opening H: ${message}`);
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

export function validateExp0025RHoldoutOpening(opening) {
  try {
    const core = structuredClone(opening);
    delete core.openingSha256;
    return opening?.schemaVersion === EXP0025_R_HOLDOUT_OPENING_SCHEMA &&
      opening?.experimentId === "EXP-0025-R" &&
      opening?.stage === "HOLDOUT_OPENED_FOR_ONE_LOCAL_INFERENCE" &&
      opening?.authorizedCandidateId === EXP0025_R_LOCAL_CANDIDATE_ID &&
      opening?.maximumLocalInferencePasses === 1 &&
      opening?.receiptRequiredBeforeInference === true &&
      opening?.outputsAbsentAtOpening === true &&
      opening?.externalExecutionAuthorized === false &&
      opening?.authorityEligible === false &&
      opening.openingSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

export async function openExp0025RHoldout() {
  invariant(
    await gitText("status", "--porcelain=v1", "--untracked-files=all") === "",
    "worktree precisa estar limpa"
  );
  for (const path of [
    EXP0025_R_HOLDOUT_OPENING_PATH,
    EXP0025_R_HOLDOUT_RECEIPT_PATH,
    EXP0025_R_HOLDOUT_REPORT_PATH
  ]) invariant(!await exists(path), `${path} já existe`);

  const [sealBytes, head] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_SEAL_PATH)),
    gitText("rev-parse", "HEAD")
  ]);
  const seal = JSON.parse(sealBytes.toString("utf8"));
  invariant(validateExp0025RHoldoutSeal(seal), "seal H inválido");
  await verifyExp0025RHoldoutSeal(seal);

  const core = {
    schemaVersion: EXP0025_R_HOLDOUT_OPENING_SCHEMA,
    experimentId: "EXP-0025-R",
    stage: "HOLDOUT_OPENED_FOR_ONE_LOCAL_INFERENCE",
    openedAt: OPENED_AT,
    openingSourceCommit: head,
    seal: {
      path: EXP0025_R_HOLDOUT_SEAL_PATH,
      fileSha256: sha256(sealBytes),
      sealSha256: seal.sealSha256,
      sealSourceCommit: seal.sealSourceCommit
    },
    holdout: {
      path: seal.holdout.path,
      packSha256: seal.holdout.packSha256,
      fileSha256: seal.holdout.fileSha256,
      pairs: seal.holdout.pairs,
      utterances: seal.holdout.utterances
    },
    localFreeze: {
      path: seal.localCandidate.freezePath,
      freezeSha256: seal.localCandidate.freezeSha256,
      runnerSourceCommit: seal.localCandidate.runnerSourceCommit
    },
    authorizedCandidateId: EXP0025_R_LOCAL_CANDIDATE_ID,
    maximumLocalInferencePasses: 1,
    receiptRequiredBeforeInference: true,
    crashAfterReceiptAllowsRerun: false,
    outputsAbsentAtOpening: true,
    externalExecutionAuthorized: false,
    authorityEligible: false
  };
  const opening = Object.freeze({
    ...core,
    openingSha256: `sha256:${canonicalSha256(core)}`
  });
  await writeFile(
    resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_OPENING_PATH),
    `${canonicalJson(opening)}\n`,
    { flag: "wx" }
  );
  return opening;
}

async function main() {
  invariant(process.argv.length === 2, "não aceita argumentos livres");
  const opening = await openExp0025RHoldout();
  process.stdout.write(
    `EXP-0025-R H aberto para uma inferência local: ` +
      `${opening.openingSha256}; E autorizado=${opening.externalExecutionAuthorized}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
