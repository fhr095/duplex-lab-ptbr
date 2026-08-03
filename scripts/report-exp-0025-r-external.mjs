#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

import {
  analyzeExp0025RExternalDevelopment,
  validateExp0025RExternalRawEvidence
} from "../src/eval/exp-0025-r-external.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { evaluateDuplexCascadeOfficialRuntimeSentinels } from
  "../src/eval/exp-0025-r-official-runtime-semantics.mjs";

const PATHS = Object.freeze({
  authorization:
    "eval/commitments/exp-0025-r-external-development-authorization-v0.1.json",
  pack: "eval/datasets/exp-0025-r-development-v0.1.json",
  raw: "eval/evidence/exp-0025-r-external-development-raw-v0.1.json",
  journal:
    "eval/evidence/exp-0025-r-external-development-raw-v0.1.journal.ndjson",
  log: "eval/evidence/exp-0025-r-external-development-runpod-v0.1.log",
  peftDiagnostic:
    "eval/evidence/exp-0025-r-external-peft-base-equivalence-v0.1.json",
  receipt1:
    "eval/evidence/exp-0025-r-external-runpod-allocation-v0.1.json",
  receipt2:
    "eval/evidence/exp-0025-r-external-runpod-allocation-v0.2.json",
  receipt3:
    "eval/evidence/exp-0025-r-external-runpod-allocation-v0.3.json",
  report: "eval/reports/exp-0025-r-external-development-v0.1.json"
});
const execFileAsync = promisify(execFile);
const checkMode = process.argv.includes("--check");
const unknownArguments = process.argv.slice(2).filter((argument) =>
  argument !== "--check");
if (unknownArguments.length > 0) {
  throw new Error(`argumentos desconhecidos: ${unknownArguments.join(", ")}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path) {
  const bytes = await readFile(resolve(path));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

async function pythonCanonicalRawSha256(path) {
  const source = [
    "import hashlib,json,sys",
    "with open(sys.argv[1],encoding='utf-8') as f: value=json.load(f)",
    "value.pop('evidenceSha256',None)",
    "encoded=json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()",
    "print(hashlib.sha256(encoded).hexdigest())"
  ].join("\n");
  const candidates = [
    process.env.PYTHON,
    resolve(".venv/bin/python"),
    "python3",
    "python"
  ].filter(Boolean);
  let lastError = null;
  for (const executable of candidates) {
    try {
      const result = await execFileAsync(
        executable,
        ["-c", source, resolve(path)],
        { maxBuffer: 1024 * 1024 }
      );
      return result.stdout.trim();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Python indisponível para hash bruto: ${lastError?.message}`);
}

const [authorization, pack, rawFile, journalBytes, logBytes, diagnostic,
  receipt1, receipt2, receipt3] = await Promise.all([
  readJson(PATHS.authorization),
  readJson(PATHS.pack),
  readJson(PATHS.raw),
  readFile(resolve(PATHS.journal)),
  readFile(resolve(PATHS.log)),
  readJson(PATHS.peftDiagnostic),
  readJson(PATHS.receipt1),
  readJson(PATHS.receipt2),
  readJson(PATHS.receipt3)
]);
const raw = rawFile.value;
if (!validateExp0025RExternalRawEvidence(raw)) {
  throw new Error("evidência bruta E não fecha o schema congelado");
}
const recomputedRawEvidenceSha256 = await pythonCanonicalRawSha256(PATHS.raw);
if (raw.evidenceSha256 !== recomputedRawEvidenceSha256) {
  throw new Error("evidenceSha256 bruto divergiu");
}
const journalLines = journalBytes.toString("utf8").trim().split(/\r?\n/u)
  .filter(Boolean).map((line) => JSON.parse(line));
const journalFinal = journalLines.at(-1);
if (journalFinal?.stage !== "FINAL" ||
  journalFinal?.evidenceSha256 !== raw.evidenceSha256) {
  throw new Error("journal não fecha a evidência bruta");
}
if (diagnostic.value.comparison?.allEqual !== true ||
  diagnostic.value.comparison?.tensorCount !== 112 ||
  diagnostic.value.budget?.withinLimit !== true) {
  throw new Error("validade do carregamento PEFT não foi demonstrada");
}
if (receipt3.value.status !== "COMPLETED" ||
  receipt3.value.termination?.confirmed !== true ||
  receipt3.value.budget?.withinFrozenLimits !== true) {
  throw new Error("alocação terminal não fechou com segurança");
}

const frozenAnalysis = analyzeExp0025RExternalDevelopment({
  pack: pack.value,
  sentinelObservations: raw.sentinels,
  developmentObservations: raw.development
});
const officialSentinels = evaluateDuplexCascadeOfficialRuntimeSentinels(
  raw.sentinels
);
if (officialSentinels.status !== "PASS" || officialSentinels.passed !== 4) {
  throw new Error("sentinelas não passam sob a semântica do servidor oficial");
}
if (raw.development.length !== 0) {
  throw new Error("D inesperadamente contém inferências");
}

const cumulativeDownloadBytesUpperBound =
  diagnostic.value.budget.projectedCumulativeTransferBytes;
const maximumDownloadBytes = diagnostic.value.budget.maximumDownloadBytes;
const terminalSnapshotBytes = raw.budget.snapshotArtifactBytes;
const minimumCapForRehydratedD =
  cumulativeDownloadBytesUpperBound + terminalSnapshotBytes;
const cumulativeGpuSeconds = receipt3.value.budget.cumulativeAllocationSeconds;
const cumulativeCostUsd =
  receipt3.value.budget.cumulativeEstimatedGpuCostUsd;
const existingReport = checkMode
  ? JSON.parse(await readFile(resolve(PATHS.report), "utf8"))
  : null;

const report = {
  schemaVersion: "exp-0025-r-external-development-report-v1",
  experimentId: "EXP-0025-R",
  candidateId: "E-official-duplexcascade-v0.1",
  createdAt: existingReport?.createdAt ?? new Date().toISOString(),
  stage: "EXTERNAL_SENTINELS_COMPLETE_DEVELOPMENT_NOT_EVALUATED",
  evidence: {
    authorization: {
      path: PATHS.authorization,
      fileSha256: sha256(authorization.bytes),
      authorizationSha256: authorization.value.authorizationSha256
    },
    raw: {
      path: PATHS.raw,
      fileSha256: sha256(rawFile.bytes),
      evidenceSha256: raw.evidenceSha256,
      pythonCanonicalSha256Verified: true
    },
    journal: {
      path: PATHS.journal,
      fileSha256: sha256(journalBytes),
      entries: journalLines.length
    },
    providerLog: {
      path: PATHS.log,
      fileSha256: sha256(logBytes),
      byteLength: logBytes.length
    },
    providerReceipts: [receipt1, receipt2, receipt3].map((item, index) => ({
      path: PATHS[`receipt${index + 1}`],
      fileSha256: sha256(item.bytes),
      status: item.value.status,
      terminationConfirmed: item.value.termination?.confirmed === true
    })),
    peftBaseEquivalence: {
      path: PATHS.peftDiagnostic,
      fileSha256: sha256(diagnostic.bytes),
      tensorCount: diagnostic.value.comparison.tensorCount,
      allEqual: diagnostic.value.comparison.allEqual
    }
  },
  validity: {
    checkpointHashesVerified: true,
    exactOfficialCodeCommitVerified: true,
    modelLoadEquivalent: true,
    modelLoadExplanation:
      "112 ignored plain q/v base keys equal byte-for-byte to the pinned base-layer initialization; LoRA keys loaded",
    holdoutRead: false,
    oldHoldoutConfirmatoryEligible: false,
    rawTokensAndTrajectoriesPreserved: true,
    podTerminationConfirmed: true
  },
  sentinels: {
    generationCount: raw.sentinels.length,
    frozenAdapterClassification: frozenAnalysis.sentinels,
    officialRuntimeClassification: officialSentinels,
    correction: {
      type: "POST_RUN_CONSTRUCT_INTERPRETATION_CORRECTION",
      modelOutputChanged: false,
      rerunUsed: false,
      affectedSentinelId: "english-user-interruption",
      rawOutput: raw.sentinels.find((item) =>
        item.id === "english-user-interruption")?.output ?? null,
      rationale:
        "Pinned server.py resets TTS for both user interruption and user talking while assistant is speaking"
    }
  },
  development: {
    evaluated: false,
    utteranceCount: 0,
    reason:
      "Frozen adapter mislabeled a valid official-runtime sentinel and therefore correctly fail-closed before D",
    comparisonsAvailable: {
      againstA0Native: false,
      againstA0At600: false,
      postFinalDelay: false,
      gainsAndLosses: false
    }
  },
  budget: {
    cumulativeGpuSeconds,
    maximumGpuSeconds: 7_200,
    remainingGpuSeconds: 7_200 - cumulativeGpuSeconds,
    cumulativeEstimatedCostUsd: cumulativeCostUsd,
    maximumExternalCostUsd: 12,
    remainingExternalCostUsd: 12 - cumulativeCostUsd,
    cumulativeDownloadBytesUpperBound,
    maximumDownloadBytes,
    remainingDownloadBytes:
      maximumDownloadBytes - cumulativeDownloadBytesUpperBound,
    terminalSnapshotBytes,
    minimumCapForRehydratedD,
    minimumCapForRehydratedDGiB: minimumCapForRehydratedD / 1024 ** 3
  },
  decision: {
    id: "DO_NOT_CUT_E_DO_NOT_CLAIM_D_GAIN",
    externalMicroturnFrontCut: false,
    freshHoldoutJustified: false,
    freshHoldoutAuthorized: false,
    localReproductionAuthorized: false,
    oldHoldoutUse: "NOT_EXECUTED",
    interpretation:
      "E passed the official runtime protocol gate, but D has no observations",
    nextAction:
      "REQUEST_EXPLICIT_DOWNLOAD_CAP_EXTENSION_THEN_RUN_ONE_D_ONLY_PASS",
    requiredNewAuthority: {
      reason:
        "Checkpoint volume was intentionally deleted and rehydration would exceed the frozen cumulative 40 GiB cap",
      recommendedMaximumCumulativeDownloadGiB: 70,
      additionalModelOrCheckpoint: false,
      sentinelRerun: false,
      developmentOnly: true,
      holdoutInference: false,
      mappingSweepOrSeedChange: false,
      gpuHourOrCostIncreaseRequired: false
    }
  }
};
const core = structuredClone(report);
report.reportSha256 = `sha256:${canonicalSha256(core)}`;
const destination = resolve(PATHS.report);
if (checkMode) {
  if (!isDeepStrictEqual(existingReport, report)) {
    throw new Error("relatório externo versionado divergiu da recomputação");
  }
} else {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx"
  });
}
process.stdout.write(JSON.stringify({
  mode: checkMode ? "check" : "write",
  decision: report.decision.id,
  officialSentinelsPassed: officialSentinels.passed,
  developmentEvaluated: report.development.evaluated,
  cumulativeEstimatedCostUsd: cumulativeCostUsd,
  minimumCapForRehydratedDGiB: report.budget.minimumCapForRehydratedDGiB,
  output: PATHS.report
}) + "\n");
