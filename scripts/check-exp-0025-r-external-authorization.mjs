import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

export const EXP0025_R_EXTERNAL_AUTHORIZATION_PATH =
  "eval/commitments/exp-0025-r-external-development-authorization-v0.1.json";
export const EXP0025_R_EXTERNAL_EVIDENCE_PATH =
  "eval/evidence/exp-0025-r-external-development-raw-v0.1.json";
export const EXP0025_R_EXTERNAL_JOURNAL_PATH =
  "eval/evidence/exp-0025-r-external-development-raw-v0.1.journal.ndjson";
export const EXP0025_R_EXTERNAL_REPORT_PATH =
  "eval/reports/exp-0025-r-external-development-v0.1.json";

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

export async function validateExp0025RExternalAuthorization(options = {}) {
  const errors = [];
  try {
    const authorizationFile = await readJson(
      options.path ?? EXP0025_R_EXTERNAL_AUTHORIZATION_PATH
    );
    const authorization = authorizationFile.value;
    const core = structuredClone(authorization);
    delete core.authorizationSha256;
    if (authorization.schemaVersion !==
        "exp-0025-r-external-development-authorization-v1" ||
      authorization.experimentId !== "EXP-0025-R" ||
      authorization.stage !==
        "EXTERNAL_SENTINELS_AND_DEVELOPMENT_AUTHORIZED_BEFORE_INFERENCE" ||
      authorization.candidate?.id !== "E-official-duplexcascade-v0.1" ||
      authorization.authorizationSha256 !==
        `sha256:${canonicalSha256(core)}`) {
      errors.push("identidade ou hash da autorização divergiu");
    }
    if (authorization.oldHoldout?.statusForExternalCandidate !==
        "INELIGIBLE_FOR_CONFIRMATION" ||
      authorization.oldHoldout?.executionAuthorizedThisRound !== false ||
      authorization.freshExternalHoldout?.exists !== false ||
      authorization.freshExternalHoldout?.creationAuthorized !== false ||
      authorization.freshExternalHoldout?.openingAuthorized !== false ||
      authorization.automaticFollowups?.secondLocalReproduction !== false ||
      authorization.authorityEligible !== false) {
      errors.push("fronteira de H, reprodução ou autoridade foi ampliada");
    }
    if (authorization.artifactBudget?.maximumDownloadGiB !== 40 ||
      authorization.artifactBudget?.maximumGpuHours !== 2 ||
      authorization.artifactBudget?.maximumExternalCostUsd !== 12 ||
      authorization.candidate?.configuration?.overlapWindowSeconds !== 0.6 ||
      authorization.candidate?.configuration?.maxNewTokens !== 64 ||
      authorization.candidate?.configuration?.doSample !== false) {
      errors.push("budget ou configuração externa divergiu");
    }
    const provider = authorization.providerExecution;
    if (provider?.provider !== "runpod" ||
      provider?.cloudType !== "SECURE" ||
      provider?.gpuTypeId !== "NVIDIA H100 PCIe" ||
      provider?.gpuCount !== 1 ||
      provider?.gpuFallbackAllowed !== false ||
      provider?.imageName !==
        "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04" ||
      provider?.maximumAcceptedHourlyUsd !== 6 ||
      provider?.remoteRunTimeoutSeconds !== 6_000 ||
      provider?.terminationRequiredInFinally !== true ||
      provider?.dataBoundary?.holdoutTransferred !== false ||
      provider?.dataBoundary?.environmentFileTransferred !== false ||
      provider?.dataBoundary?.accountApiKeyTransferred !== false ||
      provider?.dataBoundary?.openAiApiKeyTransferred !== false ||
      provider?.infrastructureRetry?.attempt1?.status !==
        "FAILED_BEFORE_MODEL_INFERENCE" ||
      provider?.infrastructureRetry?.attempt1
        ?.sentinelOrDevelopmentGenerationCount !== 0 ||
      provider?.infrastructureRetry?.attempt1?.terminationConfirmed !== true ||
      provider?.infrastructureRetry?.attempt2?.authorized !== true ||
      provider?.infrastructureRetry?.attempt2?.modelInferenceAttemptOrdinal !== 1 ||
      provider?.infrastructureRetry?.attempt2?.status !==
        "FAILED_BEFORE_MODEL_INFERENCE" ||
      provider?.infrastructureRetry?.attempt2
        ?.sentinelOrDevelopmentGenerationCount !== 0 ||
      provider?.infrastructureRetry?.attempt2
        ?.automaticFurtherInfrastructureRetry !== false ||
      provider?.infrastructureRetry?.attempt3?.authorized !== true ||
      provider?.infrastructureRetry?.attempt3?.terminalInfrastructureAttempt !==
        true ||
      provider?.infrastructureRetry?.attempt3?.modelInferenceAttemptOrdinal !== 1 ||
      provider?.infrastructureRetry?.attempt3
        ?.projectedCumulativeTransferBytes > 40 * 1024 ** 3 ||
      provider?.infrastructureRetry?.attempt3
        ?.automaticFurtherInfrastructureRetry !== false) {
      errors.push("ambiente RunPod ou fronteira de dados divergiu");
    }

    for (const binding of authorization.sourceBindings ?? []) {
      const bytes = await readFile(resolve(binding.path));
      if (bytes.length !== binding.byteLength || sha256(bytes) !== binding.sha256) {
        errors.push(`source binding divergiu: ${binding.path}`);
      }
    }
    for (const key of ["development", "sentinels", "baselineHeadroom"]) {
      const binding = authorization.inputBindings?.[key];
      const bytes = await readFile(resolve(binding.path));
      if (sha256(bytes) !== binding.fileSha256) {
        errors.push(`input binding divergiu: ${binding.path}`);
      }
    }
    const oldOpening = await readJson(authorization.oldHoldout.openingPath);
    if (sha256(oldOpening.bytes) !==
        authorization.oldHoldout.openingFileSha256 ||
      oldOpening.value.openingSha256 !==
        authorization.oldHoldout.openingSha256 ||
      oldOpening.value.authorizedCandidateId !==
        authorization.oldHoldout.authorizedCandidateId ||
      oldOpening.value.externalExecutionAuthorized !== false) {
      errors.push("abertura histórica H-L divergiu");
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
        EXP0025_R_EXTERNAL_EVIDENCE_PATH,
        EXP0025_R_EXTERNAL_JOURNAL_PATH,
        EXP0025_R_EXTERNAL_REPORT_PATH
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
      errors: [`autorização malformada: ${error.message}`],
      authorization: null
    });
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--preflight")) {
    throw new Error(
      "uso: node scripts/check-exp-0025-r-external-authorization.mjs [--preflight]"
    );
  }
  const result = await validateExp0025RExternalAuthorization({
    preflight: args.has("--preflight")
  });
  if (!result.valid) {
    throw new Error(`autorização E inválida: ${result.errors.join("; ")}`);
  }
  process.stdout.write(
    `EXP-0025-R E autorização válida; preflight=${args.has("--preflight")}; ` +
      `H autorizado=${result.authorization.oldHoldout.executionAuthorizedThisRound}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
