#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  EXP0025_R_D_ONLY_JOURNAL_PATH,
  EXP0025_R_D_ONLY_RAW_PATH,
  EXP0025_R_D_ONLY_REPORT_PATH,
  validateExp0025RDOnlyAuthorization
} from "./check-exp-0025-r-external-d-only-authorization.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

export const EXP0025_R_D_ONLY_RETRY_AUTHORIZATION_PATH =
  "eval/commitments/exp-0025-r-external-d-only-retry-authorization-v0.1.json";
export const EXP0025_R_D_ONLY_RETRY_LOG_PATH =
  "eval/evidence/exp-0025-r-external-development-d-only-runpod-v0.2.log";
export const EXP0025_R_D_ONLY_RETRY_RECEIPT_PATH =
  "eval/evidence/exp-0025-r-external-runpod-allocation-v0.5.json";

const ORIGINAL_AUTHORIZATION_PATH =
  "eval/commitments/exp-0025-r-external-d-only-authorization-v0.1.json";
const ORIGINAL_AUTHORIZATION_SHA256 =
  "a4a81c30f56ac45571927cc2002712afe8c565cc9641ecc0731bd50fdaa9c1d2";
const ATTEMPT4_RECEIPT_PATH =
  "eval/evidence/exp-0025-r-external-runpod-allocation-v0.4.json";
const ATTEMPT4_RECEIPT_SHA256 =
  "0cd74ba2ef97d8a452bab4e504d1b91940ed8ca42f7a3dd239d5ead6ccef0442";
const ATTEMPT4_LOG_PATH =
  "eval/evidence/exp-0025-r-external-development-d-only-runpod-v0.1.log";
const ATTEMPT4_LOG_SHA256 =
  "0d8eee965826457f5eefdfe9bda6bb4e2c8c9acef2fda1e40205e6d850da88f2";

const execFileAsync = promisify(execFile);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path) {
  const bytes = await readFile(resolve(path));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

async function absent(path) {
  try {
    await access(resolve(path));
    return false;
  } catch {
    return true;
  }
}

function exactNumber(value, expected) {
  return typeof value === "number" && Number.isFinite(value) &&
    value === expected;
}

export async function validateExp0025RDOnlyRetryAuthorization(options = {}) {
  const errors = [];
  try {
    const original = await validateExp0025RDOnlyAuthorization({
      preflight: false
    });
    if (!original.valid) {
      errors.push(`autorização científica anterior divergiu: ${
        original.errors.join("; ")}`);
    }

    const authorizationFile = await readJson(
      options.path ?? EXP0025_R_D_ONLY_RETRY_AUTHORIZATION_PATH
    );
    const authorization = authorizationFile.value;
    const core = structuredClone(authorization);
    delete core.authorizationSha256;
    if (authorization.schemaVersion !==
        "exp-0025-r-external-d-only-retry-authorization-v1" ||
      authorization.experimentId !== "EXP-0025-R" ||
      authorization.stage !==
        "FIFTH_ALLOCATION_PATH_ONLY_RETRY_AUTHORIZED" ||
      authorization.authorizationSha256 !==
        `sha256:${canonicalSha256(core)}`) {
      errors.push("identidade ou hash da autorização de retry divergiu");
    }
    if (authorization.authorizationBasis?.userStatement !==
        "Tranquilo. ta autorizado" ||
      authorization.authorizationBasis?.constrainedInterpretation !==
        "ONE_FIFTH_AND_FINAL_PATH_ONLY_D_RETRY" ||
      authorization.authorizationBasis?.scientificProtocolChanged !== false) {
      errors.push("base ou interpretação da autorização divergiu");
    }
    if (authorization.candidate?.id !==
        "E-official-duplexcascade-v0.1" ||
      authorization.candidate?.scientificAuthorizationPath !==
        ORIGINAL_AUTHORIZATION_PATH ||
      authorization.candidate?.scientificAuthorizationFileSha256 !==
        ORIGINAL_AUTHORIZATION_SHA256 ||
      JSON.stringify(authorization.authorizedStages) !== JSON.stringify([
        "DEVELOPMENT_D_SINGLE_PASS_COMPLETION_AFTER_PATH_FIX"
      ])) {
      errors.push("candidato ou estágio científico foi ampliado");
    }
    const scope = authorization.scope;
    if (scope?.sentinelRerunAuthorized !== false ||
      scope?.developmentPassOrdinal !== 1 ||
      scope?.fifthAllocationAuthorized !== true ||
      scope?.sixthAllocationAuthorized !== false ||
      scope?.automaticRetryAuthorized !== false ||
      scope?.checkpointSwapAuthorized !== false ||
      scope?.mappingSweepAuthorized !== false ||
      scope?.localReproductionAuthorized !== false ||
      scope?.holdoutAuthorized !== false ||
      authorization.authorityEligible !== false) {
      errors.push("retry, holdout ou autoridade foi ampliado");
    }
    const provider = authorization.providerExecution;
    if (provider?.provider !== "runpod" ||
      provider?.infrastructureAttempt !== 5 ||
      provider?.finalAdditionalAllocation !== true ||
      provider?.automaticRetryAllowed !== false ||
      provider?.cloudType !== "SECURE" ||
      provider?.gpuTypeId !== "NVIDIA H100 PCIe" ||
      provider?.gpuCount !== 1 ||
      provider?.gpuFallbackAllowed !== false ||
      provider?.maximumAcceptedHourlyUsd !== 6 ||
      provider?.terminationRequiredInFinally !== true ||
      provider?.pathOnlyEntrypoint !==
        "scripts/run_exp_0025_r_external_d_only_v2.py" ||
      provider?.frozenScientificAdapter !==
        "scripts/run_exp_0025_r_external_d_only.py" ||
      provider?.dataBoundary?.holdoutTransferred !== false ||
      provider?.dataBoundary?.environmentFileTransferred !== false ||
      provider?.dataBoundary?.accountApiKeyTransferred !== false ||
      provider?.dataBoundary?.openAiApiKeyTransferred !== false) {
      errors.push("ambiente, correção de caminho ou fronteira de dados divergiu");
    }
    const budget = authorization.cumulativeBudget;
    if (!exactNumber(
      budget?.priorCumulativeGpuSeconds, 1287.297000169754) ||
      !exactNumber(
        budget?.priorCumulativeEstimatedCostUsd, 1.0334134251362748) ||
      !exactNumber(
        budget?.priorCumulativeTransferBytesUpperBound, 37_706_974_907) ||
      !exactNumber(
        budget?.rehydrationTransferBytesUpperBound, 32_666_833_251) ||
      !exactNumber(
        budget?.projectedCumulativeTransferBytes, 70_373_808_158) ||
      budget?.maximumDownloadGiB !== 70 ||
      budget?.maximumGpuHours !== 2 ||
      budget?.maximumExternalCostUsd !== 12 ||
      budget?.gpuOrCostIncreaseAuthorized !== false ||
      budget?.firstLimitReachedStopsExecution !== true) {
      errors.push("budget cumulativo da quinta alocação divergiu");
    }

    const originalBytes = await readFile(resolve(ORIGINAL_AUTHORIZATION_PATH));
    if (sha256(originalBytes) !== ORIGINAL_AUTHORIZATION_SHA256) {
      errors.push("autorização científica anterior mudou");
    }
    const attempt4 = await readJson(ATTEMPT4_RECEIPT_PATH);
    if (sha256(attempt4.bytes) !== ATTEMPT4_RECEIPT_SHA256 ||
      attempt4.value.status !== "FAILED" ||
      attempt4.value.infrastructureAttempt !== 4 ||
      attempt4.value.termination?.confirmed !== true ||
      attempt4.value.runtime?.retrieved?.[
        "eval/evidence/exp-0025-r-external-development-d-only-raw-v0.1.json"
      ] !== false) {
      errors.push("recibo causal da quarta alocação divergiu");
    }
    const attempt4Log = await readFile(resolve(ATTEMPT4_LOG_PATH));
    if (sha256(attempt4Log) !== ATTEMPT4_LOG_SHA256 ||
      !attempt4Log.toString("utf8").includes(
        "ModuleNotFoundError: No module named 'scripts'")) {
      errors.push("diagnóstico de caminho da quarta alocação divergiu");
    }
    for (const binding of authorization.sourceBindings ?? []) {
      const bytes = await readFile(resolve(binding.path));
      if (bytes.length !== binding.byteLength ||
        sha256(bytes) !== binding.sha256) {
        errors.push(`source binding divergiu: ${binding.path}`);
      }
    }
    for (const binding of Object.values(authorization.inputBindings ?? {})) {
      const bytes = await readFile(resolve(binding.path));
      if (sha256(bytes) !== binding.fileSha256) {
        errors.push(`input binding divergiu: ${binding.path}`);
      }
    }
    const ancestor = await execFileAsync("git", [
      "merge-base", "--is-ancestor", authorization.authorizationSourceCommit,
      "HEAD"
    ], { cwd: resolve(".") }).then(() => true, () => false);
    if (!ancestor) errors.push("commit-fonte da nova autorização não é ancestral");

    if (options.preflight === true) {
      for (const path of [
        EXP0025_R_D_ONLY_RAW_PATH,
        EXP0025_R_D_ONLY_JOURNAL_PATH,
        EXP0025_R_D_ONLY_RETRY_LOG_PATH,
        EXP0025_R_D_ONLY_RETRY_RECEIPT_PATH,
        EXP0025_R_D_ONLY_REPORT_PATH
      ]) {
        if (!await absent(path)) errors.push(`output já existe: ${path}`);
      }
    }
    return Object.freeze({
      valid: errors.length === 0,
      errors,
      authorization
    });
  } catch (error) {
    return Object.freeze({
      valid: false,
      errors: [`autorização de retry malformada: ${error.message}`],
      authorization: null
    });
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((argument) => argument !== "--preflight")) {
    throw new Error(
      "uso: node scripts/check-exp-0025-r-external-d-only-retry-authorization.mjs [--preflight]"
    );
  }
  const result = await validateExp0025RDOnlyRetryAuthorization({
    preflight: args.has("--preflight")
  });
  if (!result.valid) {
    throw new Error(`autorização de retry inválida: ${result.errors.join("; ")}`);
  }
  process.stdout.write(
    `EXP-0025-R retry D-only válido; preflight=${args.has("--preflight")}; ` +
      `H autorizado=false; sexto Pod=false\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
