#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

export const EXP0025_R_D_ONLY_AUTHORIZATION_PATH =
  "eval/commitments/exp-0025-r-external-d-only-authorization-v0.1.json";
export const EXP0025_R_D_ONLY_RAW_PATH =
  "eval/evidence/exp-0025-r-external-development-d-only-raw-v0.1.json";
export const EXP0025_R_D_ONLY_JOURNAL_PATH =
  "eval/evidence/exp-0025-r-external-development-d-only-raw-v0.1.journal.ndjson";
export const EXP0025_R_D_ONLY_LOG_PATH =
  "eval/evidence/exp-0025-r-external-development-d-only-runpod-v0.1.log";
export const EXP0025_R_D_ONLY_RECEIPT_PATH =
  "eval/evidence/exp-0025-r-external-runpod-allocation-v0.4.json";
export const EXP0025_R_D_ONLY_REPORT_PATH =
  "eval/reports/exp-0025-r-external-development-complete-v0.1.json";

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

function equalNumbers(left, right) {
  return typeof left === "number" && Number.isFinite(left) && left === right;
}

export async function validateExp0025RDOnlyAuthorization(options = {}) {
  const errors = [];
  try {
    const authorizationFile = await readJson(
      options.path ?? EXP0025_R_D_ONLY_AUTHORIZATION_PATH
    );
    const authorization = authorizationFile.value;
    const core = structuredClone(authorization);
    delete core.authorizationSha256;
    if (authorization.schemaVersion !==
        "exp-0025-r-external-d-only-authorization-v1" ||
      authorization.experimentId !== "EXP-0025-R" ||
      authorization.stage !==
        "FOURTH_ALLOCATION_DEVELOPMENT_D_ONLY_AUTHORIZED" ||
      authorization.candidate?.id !== "E-official-duplexcascade-v0.1" ||
      authorization.authorizationSha256 !==
        `sha256:${canonicalSha256(core)}`) {
      errors.push("identidade ou hash da autorização D-only divergiu");
    }
    if (JSON.stringify(authorization.authorizedStages) !==
        JSON.stringify(["DEVELOPMENT_D_SINGLE_PASS_COMPLETION"]) ||
      authorization.scope?.sentinelRerunAuthorized !== false ||
      authorization.scope?.developmentPassOrdinal !== 1 ||
      authorization.scope?.fifthAllocationAuthorized !== false ||
      authorization.scope?.automaticRetryAuthorized !== false ||
      authorization.scope?.checkpointSwapAuthorized !== false ||
      authorization.scope?.mappingSweepAuthorized !== false ||
      authorization.scope?.localReproductionAuthorized !== false ||
      authorization.oldHoldout?.executionAuthorized !== false ||
      authorization.freshExternalHoldout?.executionAuthorized !== false ||
      authorization.authorityEligible !== false) {
      errors.push("escopo D-only, H, retry ou autoridade foi ampliado");
    }
    const configuration = authorization.candidate?.configuration;
    if (configuration?.overlapWindowSeconds !== 0.6 ||
      configuration?.maxNewTokens !== 64 ||
      configuration?.doSample !== false ||
      configuration?.infraSeed !== 25025 ||
      configuration?.freePromptAdded !== false ||
      configuration?.quantizationAllowed !== false ||
      configuration?.checkpointSwapAllowed !== false) {
      errors.push("configuração do candidato divergiu");
    }
    const budget = authorization.cumulativeBudget;
    if (budget?.maximumDownloadGiB !== 70 ||
      budget?.maximumGpuHours !== 2 ||
      budget?.maximumExternalCostUsd !== 12 ||
      !equalNumbers(
        budget?.priorCumulativeTransferBytesUpperBound, 37_706_974_907) ||
      !equalNumbers(
        budget?.rehydrationTransferBytesUpperBound, 32_666_833_251) ||
      !equalNumbers(
        budget?.projectedCumulativeTransferBytes, 70_373_808_158) ||
      budget?.projectedCumulativeTransferBytes > 70 * 1024 ** 3 ||
      !equalNumbers(
        budget?.priorCumulativeGpuSeconds, 1193.4900000095367) ||
      !equalNumbers(
        budget?.priorCumulativeEstimatedCostUsd, 0.958107250007656) ||
      budget?.firstLimitReachedStopsExecution !== true) {
      errors.push("budget cumulativo D-only divergiu");
    }
    const provider = authorization.providerExecution;
    if (provider?.provider !== "runpod" ||
      provider?.infrastructureAttempt !== 4 ||
      provider?.finalAdditionalAllocation !== true ||
      provider?.supersedesAttempt3TerminalFlagOnly !== true ||
      provider?.automaticRetryAllowed !== false ||
      provider?.cloudType !== "SECURE" ||
      provider?.gpuTypeId !== "NVIDIA H100 PCIe" ||
      provider?.gpuCount !== 1 ||
      provider?.gpuFallbackAllowed !== false ||
      provider?.imageName !==
        "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04" ||
      provider?.maximumAcceptedHourlyUsd !== 6 ||
      provider?.remoteRunTimeoutSeconds !== 5_700 ||
      provider?.terminationRequiredInFinally !== true ||
      provider?.dataBoundary?.holdoutTransferred !== false ||
      provider?.dataBoundary?.environmentFileTransferred !== false ||
      provider?.dataBoundary?.accountApiKeyTransferred !== false ||
      provider?.dataBoundary?.openAiApiKeyTransferred !== false) {
      errors.push("ambiente RunPod D-only ou fronteira de dados divergiu");
    }

    for (const binding of authorization.sourceBindings ?? []) {
      const bytes = await readFile(resolve(binding.path));
      if (bytes.length !== binding.byteLength || sha256(bytes) !== binding.sha256) {
        errors.push(`source binding divergiu: ${binding.path}`);
      }
    }
    for (const binding of Object.values(authorization.inputBindings ?? {})) {
      const bytes = await readFile(resolve(binding.path));
      if (sha256(bytes) !== binding.fileSha256) {
        errors.push(`input binding divergiu: ${binding.path}`);
      }
    }
    const sentinelReport = await readJson(
      authorization.priorSentinelEvidence.path
    );
    if (sha256(sentinelReport.bytes) !==
        authorization.priorSentinelEvidence.fileSha256 ||
      sentinelReport.value.reportSha256 !==
        authorization.priorSentinelEvidence.reportSha256 ||
      sentinelReport.value.sentinels?.officialRuntimeClassification?.status !==
        "PASS" ||
      sentinelReport.value.sentinels?.officialRuntimeClassification?.passed !==
        4 ||
      sentinelReport.value.development?.evaluated !== false ||
      sentinelReport.value.validity?.holdoutRead !== false) {
      errors.push("evidência anterior das sentinelas divergiu");
    }
    const diagnostic = await readJson(
      authorization.priorLoadValidity.path
    );
    if (sha256(diagnostic.bytes) !==
        authorization.priorLoadValidity.fileSha256 ||
      diagnostic.value.comparison?.allEqual !== true ||
      diagnostic.value.comparison?.tensorCount !== 112) {
      errors.push("validade anterior do carregamento divergiu");
    }
    for (const prior of authorization.priorProviderReceipts ?? []) {
      const receipt = await readJson(prior.path);
      if (sha256(receipt.bytes) !== prior.fileSha256 ||
        receipt.value.status !== prior.status ||
        receipt.value.termination?.confirmed !== true) {
        errors.push(`recibo anterior divergiu: ${prior.path}`);
      }
    }
    const ancestor = await execFileAsync("git", [
      "merge-base",
      "--is-ancestor",
      authorization.authorizationSourceCommit,
      "HEAD"
    ], { cwd: resolve(".") }).then(() => true, () => false);
    if (!ancestor) errors.push("commit-fonte da autorização não é ancestral");

    if (options.preflight === true) {
      for (const path of [
        EXP0025_R_D_ONLY_RAW_PATH,
        EXP0025_R_D_ONLY_JOURNAL_PATH,
        EXP0025_R_D_ONLY_LOG_PATH,
        EXP0025_R_D_ONLY_RECEIPT_PATH,
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
      errors: [`autorização D-only malformada: ${error.message}`],
      authorization: null
    });
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((argument) => argument !== "--preflight")) {
    throw new Error(
      "uso: node scripts/check-exp-0025-r-external-d-only-authorization.mjs [--preflight]"
    );
  }
  const result = await validateExp0025RDOnlyAuthorization({
    preflight: args.has("--preflight")
  });
  if (!result.valid) {
    throw new Error(`autorização D-only inválida: ${result.errors.join("; ")}`);
  }
  process.stdout.write(
    `EXP-0025-R D-only autorização válida; ` +
      `preflight=${args.has("--preflight")}; H autorizado=false\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
