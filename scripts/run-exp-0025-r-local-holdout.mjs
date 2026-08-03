import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  EXP0025_R_LOCAL_CANDIDATE_ID,
  evaluateExp0025RLocalCandidate,
  validateExp0025RMaterializedPack
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson, canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  EXP0025_R_HOLDOUT_OPENING_SCHEMA,
  validateExp0025RHoldoutOpening
} from "./open-exp-0025-r-holdout.mjs";
import {
  EXP0025_R_HOLDOUT_OPENING_PATH,
  EXP0025_R_HOLDOUT_RECEIPT_PATH,
  EXP0025_R_HOLDOUT_REPORT_PATH,
  EXP0025_R_HOLDOUT_SEAL_PATH,
  validateExp0025RHoldoutSeal
} from "./seal-exp-0025-r-holdout.mjs";
import { validateExp0025RLocalFreeze } from
  "./freeze-exp-0025-r-local-candidate.mjs";

export const EXP0025_R_LOCAL_HOLDOUT_REPORT_SCHEMA =
  "exp-0025-r-local-holdout-report-v1";
export const EXP0025_R_HOLDOUT_RECEIPT_SCHEMA =
  "exp-0025-r-holdout-attempt-receipt-v1";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const CONSUMED_AT = "2026-08-03T15:45:00.000Z";
const COMPLETED_AT = "2026-08-03T15:46:00.000Z";

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0025-R run H: ${message}`);
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

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}

export function validateExp0025RLocalHoldoutReport(report) {
  try {
    const core = structuredClone(report);
    delete core.reportSha256;
    const gateValues = Object.values(report?.analysis?.holdoutGate ?? {});
    return report?.schemaVersion === EXP0025_R_LOCAL_HOLDOUT_REPORT_SCHEMA &&
      report?.experimentId === "EXP-0025-R" &&
      report?.stage === "LOCAL_HOLDOUT_CONFIRMATORY" &&
      report?.candidate?.id === EXP0025_R_LOCAL_CANDIDATE_ID &&
      report?.candidate?.role === "ARTICLE_INSPIRED_MECHANISM_PROBE" &&
      report?.analysis?.split === "holdout" &&
      report?.analysis?.candidate?.utteranceCount === 48 &&
      gateValues.length === 10 && gateValues.every((item) =>
        typeof item === "boolean") &&
      report?.externalReference?.executionAuthorized === false &&
      report?.externalReference?.status ===
        "NOT_EVALUATED_NO_AUTHORIZATION" &&
      report?.runtimeChanged === false && report?.authorityEligible === false &&
      report.reportSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

function createReceipt(input) {
  const core = {
    schemaVersion: EXP0025_R_HOLDOUT_RECEIPT_SCHEMA,
    experimentId: "EXP-0025-R",
    stage: "HOLDOUT_ATTEMPT_CONSUMED_BEFORE_INFERENCE",
    consumedAt: CONSUMED_AT,
    executionCommit: input.executionCommit,
    openingSha256: input.opening.openingSha256,
    sealSha256: input.seal.sealSha256,
    packSha256: input.opening.holdout.packSha256,
    candidateId: EXP0025_R_LOCAL_CANDIDATE_ID,
    maximumInferencePasses: 1,
    inferencePassOrdinal: 1,
    rerunAllowedAfterThisWrite: false,
    externalExecutionAuthorized: false
  };
  return Object.freeze({
    ...core,
    receiptSha256: `sha256:${canonicalSha256(core)}`
  });
}

function createReport(input) {
  const decision = input.analysis.holdoutWin
    ? "PROMOTE_LOCAL_FLOOR_CONTROL_TO_SHADOW_WITHOUT_EXTERNAL_CLAIM"
    : "KEEP_BASELINE_AND_CUT_MICROTURN_CHALLENGER";
  const core = {
    schemaVersion: EXP0025_R_LOCAL_HOLDOUT_REPORT_SCHEMA,
    experimentId: "EXP-0025-R",
    stage: "LOCAL_HOLDOUT_CONFIRMATORY",
    completedAt: COMPLETED_AT,
    executionCommit: input.executionCommit,
    opening: {
      path: EXP0025_R_HOLDOUT_OPENING_PATH,
      openingSha256: input.opening.openingSha256,
      schemaVersion: EXP0025_R_HOLDOUT_OPENING_SCHEMA,
      fileSha256: sha256(input.openingBytes)
    },
    seal: {
      path: EXP0025_R_HOLDOUT_SEAL_PATH,
      sealSha256: input.seal.sealSha256,
      fileSha256: sha256(input.sealBytes)
    },
    receipt: {
      path: EXP0025_R_HOLDOUT_RECEIPT_PATH,
      receiptSha256: input.receipt.receiptSha256,
      writtenBeforeInference: true,
      inferencePassOrdinal: 1
    },
    holdout: {
      path: input.opening.holdout.path,
      packSha256: input.pack.packSha256,
      fileSha256: sha256(input.packBytes),
      pairs: input.pack.pairs,
      utterances: input.pack.utterances.length,
      sessions: input.pack.sessions
    },
    candidate: {
      id: EXP0025_R_LOCAL_CANDIDATE_ID,
      role: "ARTICLE_INSPIRED_MECHANISM_PROBE",
      freezeSha256: input.opening.localFreeze.freezeSha256,
      singleCandidate: true,
      viabilityGatePassedBeforeHoldout: true
    },
    analysis: input.analysis,
    decision: {
      code: decision,
      localCandidateWon: input.analysis.holdoutWin,
      cadenceAttribution: input.analysis.cadenceAttribution,
      externalReferenceEvaluated: false,
      secondLocalCandidateAllowed: false,
      runtimePromotionAuthorized: false
    },
    maximumClaim: input.analysis.holdoutWin
      ? "COMPACT_LOCAL_CONTROLLER_BEAT_A0_ON_THIS_FROZEN_ORACLE_TRACE_HOLDOUT"
      : "LOCAL_600_MS_MECHANISM_DID_NOT_BEAT_A0_UNDER_ALL_FROZEN_USER_PERCEPTION_GATES",
    externalReference: {
      status: "NOT_EVALUATED_NO_AUTHORIZATION",
      executionAuthorized: false,
      weightsDownloaded: false,
      gpuUsed: false,
      apiUsed: false
    },
    runtimeChanged: false,
    authorityEligible: false
  };
  return Object.freeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
}

async function readOfficialBindings() {
  const [openingBytes, sealBytes] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_OPENING_PATH)),
    readFile(resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_SEAL_PATH))
  ]);
  const opening = JSON.parse(openingBytes.toString("utf8"));
  const seal = JSON.parse(sealBytes.toString("utf8"));
  invariant(validateExp0025RHoldoutOpening(opening), "opening inválido");
  invariant(validateExp0025RHoldoutSeal(seal), "seal inválido");
  invariant(opening.seal.sealSha256 === seal.sealSha256, "opening/ seal divergiram");
  const packBytes = await readFile(resolve(PROJECT_ROOT, opening.holdout.path));
  const pack = JSON.parse(packBytes.toString("utf8"));
  invariant(validateExp0025RMaterializedPack(pack).valid, "pack H inválido");
  invariant(pack.packSha256 === opening.holdout.packSha256, "pack H trocado");
  invariant(sha256(packBytes) === opening.holdout.fileSha256, "bytes H trocados");
  const freezeBytes = await readFile(resolve(
    PROJECT_ROOT,
    opening.localFreeze.path
  ));
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  invariant(validateExp0025RLocalFreeze(freeze), "freeze L inválido");
  invariant(freeze.freezeSha256 === opening.localFreeze.freezeSha256,
    "opening não liga freeze L");
  for (const binding of freeze.sourceBindings) {
    const currentBytes = await readFile(resolve(PROJECT_ROOT, binding.path));
    invariant(sha256(currentBytes) === binding.sha256,
      `fonte L divergiu depois do freeze: ${binding.path}`);
  }
  return {
    opening,
    openingBytes,
    seal,
    sealBytes,
    freeze,
    freezeBytes,
    pack,
    packBytes
  };
}

export async function runExp0025RLocalHoldout() {
  invariant(
    await gitText("status", "--porcelain=v1", "--untracked-files=all") === "",
    "worktree precisa estar limpa"
  );
  invariant(!await exists(EXP0025_R_HOLDOUT_RECEIPT_PATH),
    "tentativa H já foi consumida");
  invariant(!await exists(EXP0025_R_HOLDOUT_REPORT_PATH),
    "relatório H já existe");
  const executionCommit = await gitText("rev-parse", "HEAD");
  const bindings = await readOfficialBindings();
  const receipt = createReceipt({ ...bindings, executionCommit });
  await writeAtomic(
    resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_RECEIPT_PATH),
    `${canonicalJson(receipt)}\n`
  );

  const analysis = evaluateExp0025RLocalCandidate(bindings.pack);
  const report = createReport({
    ...bindings,
    receipt,
    analysis,
    executionCommit
  });
  invariant(validateExp0025RLocalHoldoutReport(report),
    "relatório produzido falhou no schema");
  await writeAtomic(
    resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_REPORT_PATH),
    `${canonicalJson(report)}\n`
  );
  return report;
}

export async function checkExp0025RLocalHoldout() {
  const bindings = await readOfficialBindings();
  const [receiptBytes, reportBytes] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_RECEIPT_PATH)),
    readFile(resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_REPORT_PATH))
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const report = JSON.parse(reportBytes.toString("utf8"));
  invariant(receipt.schemaVersion === EXP0025_R_HOLDOUT_RECEIPT_SCHEMA,
    "receipt inválido");
  const receiptCore = structuredClone(receipt);
  delete receiptCore.receiptSha256;
  invariant(receipt.receiptSha256 === `sha256:${canonicalSha256(receiptCore)}`,
    "hash do receipt divergiu");
  invariant(validateExp0025RLocalHoldoutReport(report), "relatório inválido");
  invariant(report.receipt.receiptSha256 === receipt.receiptSha256,
    "relatório não liga o receipt");
  invariant(report.opening.openingSha256 === bindings.opening.openingSha256,
    "relatório não liga opening");
  invariant(report.holdout.packSha256 === bindings.pack.packSha256,
    "relatório não liga pack H");
  return report;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  invariant(
    [...args].every((arg) => arg === "--check") && args.size <= 1,
    "uso: node scripts/run-exp-0025-r-local-holdout.mjs [--check]"
  );
  const report = args.has("--check")
    ? await checkExp0025RLocalHoldout()
    : await runExp0025RLocalHoldout();
  process.stdout.write(
    `EXP-0025-R L H ${args.has("--check") ? "verificado" : "executado uma vez"}: ` +
      `${report.decision.code}; venceu=${report.decision.localCandidateWon}; ` +
      `E=${report.externalReference.status}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
