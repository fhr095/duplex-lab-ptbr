import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0025_R_BASELINE_BINDING,
  EXP0025_R_LOCAL_CANDIDATE_ID,
  evaluateExp0025RLocalCandidate,
  validateExp0025RMaterializedPack
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson, canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { EXP0025_R_DEVELOPMENT_PACK_PATH } from
  "./build-exp-0025-r-development-pack.mjs";
import {
  EXP0025_R_BASELINE_REPORT_PATH,
  validateExp0025RBaselineReport
} from "./run-exp-0025-r-baseline.mjs";

export const EXP0025_R_LOCAL_DEVELOPMENT_REPORT_PATH =
  "eval/reports/exp-0025-r-local-development-v0.1.json";
export const EXP0025_R_LOCAL_DEVELOPMENT_REPORT_SCHEMA =
  "exp-0025-r-local-development-report-v1";
export const EXP0025_R_LOCAL_SOURCE_PATH =
  "src/eval/exp-0025-r-floor-control.mjs";

const COMPLETED_AT = "2026-08-03T15:20:00.000Z";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path) {
  const bytes = await readFile(resolve(path));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

export async function buildExp0025RLocalDevelopmentReport(options = {}) {
  const packPath = options.packPath ?? EXP0025_R_DEVELOPMENT_PACK_PATH;
  const baselineReportPath = options.baselineReportPath ??
    EXP0025_R_BASELINE_REPORT_PATH;
  const [packFile, baselineFile, candidateSource] = await Promise.all([
    readJson(packPath),
    readJson(baselineReportPath),
    readFile(resolve(EXP0025_R_LOCAL_SOURCE_PATH))
  ]);
  const validation = validateExp0025RMaterializedPack(packFile.value);
  if (!validation.valid || packFile.value.split !== "development") {
    throw new Error(`pack D inválido: ${validation.errors.join("; ")}`);
  }
  if (!validateExp0025RBaselineReport(baselineFile.value) ||
    baselineFile.value.gate.decision !== "BASELINE_HEADROOM_CONFIRMED") {
    throw new Error("headroom A0 não está confirmado por relatório válido");
  }

  const analysis = evaluateExp0025RLocalCandidate(packFile.value);
  const core = {
    schemaVersion: EXP0025_R_LOCAL_DEVELOPMENT_REPORT_SCHEMA,
    experimentId: "EXP-0025-R",
    stage: "LOCAL_CANDIDATE_DEVELOPMENT",
    completedAt: COMPLETED_AT,
    candidate: {
      id: EXP0025_R_LOCAL_CANDIDATE_ID,
      role: "ARTICLE_INSPIRED_MECHANISM_PROBE",
      algorithm:
        "CAUSAL_TWO_STATE_PT_BR_MICROTURN_MACHINE",
      decisionCadenceMs: 600,
      maximumSilentMicroturns: 2,
      states: ["USER_TALKING", "USER_THINKING", "USER_FINISHED"],
      actions: ["CONTINUE_LISTENING", "TAKE_FLOOR"],
      features: [
        "accumulatedTranscript",
        "voiceResumptionAtOrBeforeTick",
        "silentMicroturnIndex"
      ],
      ptBrOpenPrefixClassifier: "looksIncompletePtBr-v0.1-shared-local-rule",
      futureAudioOrOutcomeFeature: false,
      externalModelOutputAtInference: false,
      runtimeNetwork: false
    },
    developmentPack: {
      path: packPath,
      packSha256: packFile.value.packSha256,
      fileSha256: `sha256:${sha256(packFile.bytes)}`,
      pairs: packFile.value.pairs,
      utterances: packFile.value.utterances.length,
      sessions: packFile.value.sessions
    },
    baselineHeadroom: {
      path: baselineReportPath,
      fileSha256: `sha256:${sha256(baselineFile.bytes)}`,
      reportSha256: baselineFile.value.reportSha256,
      decision: baselineFile.value.gate.decision
    },
    sourceBindings: {
      candidate: {
        path: EXP0025_R_LOCAL_SOURCE_PATH,
        sha256: sha256(candidateSource)
      },
      endpoint: {
        path: EXP0025_R_BASELINE_BINDING.endpointPath,
        sha256: EXP0025_R_BASELINE_BINDING.endpointSha256
      },
      baselineManifest: {
        path: EXP0025_R_BASELINE_BINDING.manifestPath,
        sha256: EXP0025_R_BASELINE_BINDING.manifestSha256
      }
    },
    analysis,
    interpretation: {
      developmentOnly: true,
      result:
        "FOUR_PREMATURE_TAKEOVERS_CORRECTED_WITH_ZERO_INTRODUCED_ON_D",
      cadenceAttribution: analysis.cadenceAttribution,
      limitation:
        "NO_RESIDUAL_GAIN_OVER_A0_AT_600_ON_DEVELOPMENT_AND_P95_IS_1200_MS",
      decision: "FREEZE_SINGLE_L_THEN_SEAL_H_BEFORE_ONE_INFERENCE"
    },
    externalReference: {
      status: "NOT_EVALUATED_NO_AUTHORIZATION",
      executionAuthorized: false,
      weightsDownloaded: false,
      gpuUsed: false,
      apiUsed: false
    },
    holdoutOpened: false,
    authorityEligible: false
  };
  return Object.freeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0025RLocalDevelopmentReport(report) {
  try {
    if (report?.schemaVersion !==
        EXP0025_R_LOCAL_DEVELOPMENT_REPORT_SCHEMA ||
      report?.experimentId !== "EXP-0025-R" ||
      report?.stage !== "LOCAL_CANDIDATE_DEVELOPMENT" ||
      report?.candidate?.id !== EXP0025_R_LOCAL_CANDIDATE_ID ||
      report?.candidate?.role !== "ARTICLE_INSPIRED_MECHANISM_PROBE" ||
      report?.analysis?.split !== "development" ||
      report?.analysis?.holdoutGate !== null ||
      report?.analysis?.holdoutWin !== null ||
      report?.externalReference?.executionAuthorized !== false ||
      report?.holdoutOpened !== false || report?.authorityEligible !== false) {
      return false;
    }
    const core = structuredClone(report);
    delete core.reportSha256;
    return report.reportSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}

export async function materializeExp0025RLocalDevelopmentReport(options = {}) {
  const path = resolve(options.path ??
    EXP0025_R_LOCAL_DEVELOPMENT_REPORT_PATH);
  const expected = await buildExp0025RLocalDevelopmentReport(options);
  if (options.check === true) {
    const observed = JSON.parse(await readFile(path, "utf8"));
    if (!isDeepStrictEqual(observed, expected) ||
      !validateExp0025RLocalDevelopmentReport(observed)) {
      throw new Error("relatório development de L divergiu");
    }
    return observed;
  }
  await writeAtomic(path, `${canonicalJson(expected)}\n`);
  return expected;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--check")) {
    throw new Error(
      "uso: node scripts/run-exp-0025-r-local-development.mjs [--check]"
    );
  }
  const report = await materializeExp0025RLocalDevelopmentReport({
    check: args.has("--check")
  });
  process.stdout.write(
    `EXP-0025-R L development ${args.has("--check") ? "verificado" : "criado"}: ` +
      `${report.analysis.againstNative.correctedPrematureTakeovers} correções, ` +
      `${report.analysis.againstNative.introducedPrematureTakeovers} introduções, ` +
      `${report.analysis.cadenceAttribution}; H aberto=${report.holdoutOpened}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
