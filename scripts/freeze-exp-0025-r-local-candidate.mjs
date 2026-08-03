import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0025_R_LOCAL_CANDIDATE_ID,
  replayArticleInspiredMicroturn,
  validateExp0025RMaterializedPack
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson, canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { EXP0025_R_DEVELOPMENT_PACK_PATH } from
  "./build-exp-0025-r-development-pack.mjs";
import {
  EXP0025_R_LOCAL_DEVELOPMENT_REPORT_PATH,
  EXP0025_R_LOCAL_SOURCE_PATH,
  validateExp0025RLocalDevelopmentReport
} from "./run-exp-0025-r-local-development.mjs";

export const EXP0025_R_LOCAL_FREEZE_PATH =
  "eval/commitments/exp-0025-r-local-candidate-freeze-v0.1.json";
export const EXP0025_R_LOCAL_FREEZE_SCHEMA =
  "exp-0025-r-local-candidate-freeze-v1";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const FROZEN_AT = "2026-08-03T15:25:00.000Z";
const CPU_P95_LIMIT_MS = 20;
const ARTIFACT_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;
const RUNTIME_SOURCE_PATHS = Object.freeze([
  EXP0025_R_LOCAL_SOURCE_PATH,
  "src/interaction/adaptive-endpoint.mjs",
  "src/eval/factory/canonical-hash.mjs"
]);

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0025-R freeze L: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nearestRankP95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
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

function benchmarkCandidate(pack, iterations = 100) {
  const utterances = pack.utterances;
  for (let index = 0; index < 100; index += 1) {
    replayArticleInspiredMicroturn(utterances[index % utterances.length]);
  }
  const durationsMs = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const utterance of utterances) {
      const startedAt = performance.now();
      replayArticleInspiredMicroturn(utterance);
      durationsMs.push(performance.now() - startedAt);
    }
  }
  return {
    samples: durationsMs.length,
    p95Ms: Math.round(nearestRankP95(durationsMs) * 1_000_000) / 1_000_000,
    maximumMs:
      Math.round(Math.max(...durationsMs) * 1_000_000) / 1_000_000
  };
}

export function validateExp0025RLocalFreeze(freeze) {
  try {
    const core = structuredClone(freeze);
    delete core.freezeSha256;
    return freeze?.schemaVersion === EXP0025_R_LOCAL_FREEZE_SCHEMA &&
      freeze?.experimentId === "EXP-0025-R" &&
      freeze?.stage === "LOCAL_CANDIDATE_FROZEN_BEFORE_HOLDOUT" &&
      freeze?.candidate?.id === EXP0025_R_LOCAL_CANDIDATE_ID &&
      freeze?.candidate?.role === "ARTICLE_INSPIRED_MECHANISM_PROBE" &&
      freeze?.candidate?.singleCandidate === true &&
      freeze?.viability?.cpuP95?.pass === true &&
      freeze?.viability?.artifactSize?.pass === true &&
      freeze?.viability?.network?.observedCalls === 0 &&
      freeze?.holdout?.status === "NOT_GENERATED_NOT_OPENED" &&
      freeze?.externalReference?.executionAuthorized === false &&
      freeze?.authorityEligible === false &&
      freeze.freezeSha256 === `sha256:${canonicalSha256(core)}`;
  } catch {
    return false;
  }
}

async function bindingsAt(commit) {
  const entries = [];
  let artifactBytes = 0;
  for (const path of RUNTIME_SOURCE_PATHS) {
    const bytes = await committedBytes(commit, path);
    artifactBytes += bytes.byteLength;
    entries.push({ path, sha256: sha256(bytes), byteLength: bytes.byteLength });
  }
  return { entries, artifactBytes };
}

async function verifyFreezeBindings(freeze) {
  invariant(validateExp0025RLocalFreeze(freeze), "commitmento malformado");
  const sourceBindings = await bindingsAt(freeze.runnerSourceCommit);
  invariant(
    isDeepStrictEqual(sourceBindings.entries, freeze.sourceBindings),
    "fontes congeladas divergiram"
  );
  const [packBytes, reportBytes] = await Promise.all([
    committedBytes(
      freeze.runnerSourceCommit,
      freeze.developmentBinding.pack.path
    ),
    committedBytes(
      freeze.runnerSourceCommit,
      freeze.developmentBinding.report.path
    )
  ]);
  invariant(
    sha256(packBytes) === freeze.developmentBinding.pack.fileSha256,
    "pack D divergiu"
  );
  invariant(
    sha256(reportBytes) === freeze.developmentBinding.report.fileSha256,
    "relatório D divergiu"
  );
  const pack = JSON.parse(packBytes.toString("utf8"));
  const timing = benchmarkCandidate(pack, 10);
  invariant(timing.p95Ms <= CPU_P95_LIMIT_MS, "L excedeu budget CPU no check");
  return { freeze, timing };
}

export async function freezeExp0025RLocalCandidate() {
  invariant(
    await gitText("status", "--porcelain=v1", "--untracked-files=all") === "",
    "worktree precisa estar limpa"
  );
  const head = await gitText("rev-parse", "HEAD");
  const [packBytes, reportBytes, sourceBinding] = await Promise.all([
    committedBytes(head, EXP0025_R_DEVELOPMENT_PACK_PATH),
    committedBytes(head, EXP0025_R_LOCAL_DEVELOPMENT_REPORT_PATH),
    bindingsAt(head)
  ]);
  const pack = JSON.parse(packBytes.toString("utf8"));
  const report = JSON.parse(reportBytes.toString("utf8"));
  invariant(validateExp0025RMaterializedPack(pack).valid, "pack D inválido");
  invariant(
    validateExp0025RLocalDevelopmentReport(report),
    "relatório D inválido"
  );
  invariant(
    report.analysis.cadenceAttribution ===
      "CANDIDATE_EQUIVALENT_TO_A0_AT_600",
    "atribuição de desenvolvimento mudou antes do freeze"
  );
  const sourceText = (await committedBytes(
    head,
    EXP0025_R_LOCAL_SOURCE_PATH
  )).toString("utf8");
  invariant(
    !/(?:https?:\/\/|\bfetch\s*\(|node:(?:http|https|net)|from\s+["'](?:http|https|net)["'])/u
      .test(sourceText),
    "fonte candidata contém dependência de rede"
  );
  const timing = benchmarkCandidate(pack);
  invariant(timing.p95Ms <= CPU_P95_LIMIT_MS, "L excedeu budget CPU");
  invariant(
    sourceBinding.artifactBytes <= ARTIFACT_SIZE_LIMIT_BYTES,
    "L excedeu budget de artefato"
  );

  const core = {
    schemaVersion: EXP0025_R_LOCAL_FREEZE_SCHEMA,
    experimentId: "EXP-0025-R",
    stage: "LOCAL_CANDIDATE_FROZEN_BEFORE_HOLDOUT",
    frozenAt: FROZEN_AT,
    runnerSourceCommit: head,
    candidate: {
      id: EXP0025_R_LOCAL_CANDIDATE_ID,
      role: "ARTICLE_INSPIRED_MECHANISM_PROBE",
      singleCandidate: true,
      secondThresholdOrCandidateAllowedAfterHoldout: false,
      gridMs: 600,
      maximumSilentMicroturns: 2,
      firstTickOpenPrefixAction: "CONTINUE_LISTENING",
      firstTickClosedPrefixAction: "TAKE_FLOOR",
      secondSilentTickAction: "TAKE_FLOOR",
      tieRule: "VOICE_RESUMPTION_AT_TICK_PRECEDES_POLICY_ACTION",
      states: ["USER_TALKING", "USER_THINKING", "USER_FINISHED"],
      actions: ["CONTINUE_LISTENING", "TAKE_FLOOR"],
      futureInputAllowed: false
    },
    developmentBinding: {
      pack: {
        path: EXP0025_R_DEVELOPMENT_PACK_PATH,
        packSha256: pack.packSha256,
        fileSha256: sha256(packBytes)
      },
      report: {
        path: EXP0025_R_LOCAL_DEVELOPMENT_REPORT_PATH,
        reportSha256: report.reportSha256,
        fileSha256: sha256(reportBytes)
      }
    },
    sourceBindings: sourceBinding.entries,
    viability: {
      cpuP95: {
        thresholdMs: CPU_P95_LIMIT_MS,
        observedMs: timing.p95Ms,
        maximumObservedMs: timing.maximumMs,
        samples: timing.samples,
        hardware: {
          platform: process.platform,
          architecture: process.arch,
          nodeVersion: process.version,
          cpuModel: cpus()[0]?.model ?? "unknown"
        },
        pass: true
      },
      artifactSize: {
        thresholdBytes: ARTIFACT_SIZE_LIMIT_BYTES,
        observedBytes: sourceBinding.artifactBytes,
        pass: true
      },
      network: {
        allowed: false,
        observedCalls: 0,
        staticSourceCheck: "PASS"
      }
    },
    developmentInterpretation: {
      correctedPrematureTakeovers:
        report.analysis.againstNative.correctedPrematureTakeovers,
      introducedPrematureTakeovers:
        report.analysis.againstNative.introducedPrematureTakeovers,
      sessionsImproved: report.analysis.againstNative.sessionsImproved,
      candidatePostFinalP95Ms:
        report.analysis.candidate.postFinalDecisionDelayMs.p95,
      cadenceAttribution: report.analysis.cadenceAttribution,
      confirmatoryClaim: false
    },
    holdout: {
      status: "NOT_GENERATED_NOT_OPENED",
      packSha256: null,
      inferenceCount: 0
    },
    externalReference: {
      status: "NOT_EVALUATED_NO_AUTHORIZATION",
      executionAuthorized: false,
      weightsDownloaded: false,
      gpuUsed: false,
      apiUsed: false
    },
    authorityEligible: false
  };
  const freeze = Object.freeze({
    ...core,
    freezeSha256: `sha256:${canonicalSha256(core)}`
  });
  await writeFile(
    resolve(PROJECT_ROOT, EXP0025_R_LOCAL_FREEZE_PATH),
    `${canonicalJson(freeze)}\n`,
    { flag: "wx" }
  );
  return freeze;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  invariant(
    [...args].every((arg) => arg === "--check") && args.size <= 1,
    "uso: node scripts/freeze-exp-0025-r-local-candidate.mjs [--check]"
  );
  if (args.has("--check")) {
    const freeze = JSON.parse(await readFile(
      resolve(PROJECT_ROOT, EXP0025_R_LOCAL_FREEZE_PATH),
      "utf8"
    ));
    const checked = await verifyFreezeBindings(freeze);
    process.stdout.write(
      `EXP-0025-R L freeze verificado: ${freeze.freezeSha256}; ` +
        `CPU p95 check=${checked.timing.p95Ms} ms\n`
    );
    return;
  }
  const freeze = await freezeExp0025RLocalCandidate();
  process.stdout.write(
    `EXP-0025-R L congelado antes de H: ${freeze.freezeSha256}; ` +
      `E autorizado=${freeze.externalReference.executionAuthorized}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
