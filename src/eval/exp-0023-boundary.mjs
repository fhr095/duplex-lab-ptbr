import { isDeepStrictEqual } from "node:util";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import { EXP0023_CONFIG } from
  "./exp-0023-cdp-ordinal-timestamp-semantics.mjs";

export const EXP0023_FREEZE_SCHEMA =
  "exp-0023-instrumentation-freeze-v1";
export const EXP0023_ATTEMPT_SCHEMA =
  "exp-0023-capture-attempt-v1";
export const EXP0023_ATTEMPT_NONCE = "exp-0023-official-v0.1";
export const EXP0023_OFFICIAL_COMMAND =
  "node scripts/run-exp-0023-supervisor.mjs";
export const EXP0023_INHERITED_WORKER_COMMAND =
  "node scripts/run-exp-0022-worker.mjs";
export const EXP0023_EXP0022_SOURCE_COMMIT =
  "29b589a956e4aab487e71673d4c92b141d3c0511";
export const EXP0023_EXP0022_EVIDENCE_COMMIT =
  "b8aba7c49715e846a57bafbcbb1eeb4dee2f8a56";
export const EXP0023_IMPLEMENTATION_BASE_COMMIT =
  "daad5f7c03d43e2454c34a27b02a34af8641bd87";
export const EXP0023_RUNTIME_FINGERPRINT_ROOTS = Object.freeze([
  "src",
  "web",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
]);
export const EXP0023_RUNTIME_FINGERPRINT_ALGORITHM =
  "sha256-source-tree-v1";

export const EXP0023_PREREGISTRATION_PATH =
  "docs/experiments/EXP-0023-cdp-ordinal-timestamp-semantics.md";
export const EXP0023_EXP0022_REPORT_PATH =
  "eval/reports/exp-0022-bootstrap-audit-health-binding-v0.1.json";
export const EXP0023_EXP0022_CLOSEOUT_PATH =
  "docs/experiments/EXP-0022-closeout.md";
export const EXP0023_FREEZE_PATH =
  "eval/commitments/exp-0023-instrumentation-freeze-v0.1.json";
export const EXP0023_ATTEMPT_PATH =
  "eval/commitments/exp-0023-capture-attempt-v0.1.json";
export const EXP0023_RECEIPT_PATH =
  "eval/generated/exp-0023/capture-attempt-consumed-v0.1.json";
export const EXP0023_REPORT_PATH =
  "eval/reports/exp-0023-cdp-ordinal-timestamp-semantics-v0.1.json";

export const EXP0023_C0_CHANGED_PATHS = Object.freeze([
  ".gitignore",
  "docs/AUTONOMOUS_LOOP.md",
  "docs/PROJECT_REFERENCE.md",
  "docs/ROADMAP.md",
  "docs/experiments/EXP-0023-cdp-ordinal-timestamp-semantics.md",
  "package.json",
  "scripts/freeze-exp-0023-instrumentation.mjs",
  "scripts/open-exp-0023-capture-attempt.mjs",
  "scripts/run-exp-0023-supervisor.mjs",
  "src/eval/exp-0023-boundary.mjs",
  "src/eval/exp-0023-cdp-ordinal-timestamp-semantics.mjs",
  "tests/exp-0023-analysis.test.mjs",
  "tests/exp-0023-boundary.test.mjs",
  "tests/exp-0023-supervisor.test.mjs"
].toSorted());

export const EXP0023_RUNTIME_ALLOWED_DRIFT_PATHS = Object.freeze([
  "package.json",
  "src/eval/exp-0023-boundary.mjs",
  "src/eval/exp-0023-cdp-ordinal-timestamp-semantics.mjs",
  "src/eval/experiment-index.mjs"
].toSorted());

export const EXP0023_PRODUCTION_SOURCE_PATHS = Object.freeze([
  "src/brain/provider.mjs",
  "src/cli/serve.mjs",
  "src/tts/windows-system-tts.mjs",
  "web/app.mjs",
  "web/index.html",
  "web/local-audio-reflex.mjs",
  "web/output-interruption-lifecycle.mjs",
  "web/pcm-capture.mjs",
  "web/training-trace-recorder.mjs",
  "web/turn-taking.mjs"
].toSorted());

export const EXP0023_INSTRUMENTATION_SOURCE_PATHS = Object.freeze([
  ".gitignore",
  "package.json",
  "scripts/freeze-exp-0023-instrumentation.mjs",
  "scripts/lib/exp-0021-cdp-capture.mjs",
  "scripts/open-exp-0023-capture-attempt.mjs",
  "scripts/run-exp-0022-worker.mjs",
  "scripts/run-exp-0023-supervisor.mjs",
  "src/eval/exp-0022-bootstrap-audit-health-binding.mjs",
  "src/eval/exp-0023-boundary.mjs",
  "src/eval/exp-0023-cdp-ordinal-timestamp-semantics.mjs",
  "src/eval/factory/canonical-hash.mjs",
  "src/eval/runtime-provenance.mjs",
  "src/eval/source-fingerprint.mjs",
  "tests/exp-0021-cdp-capture.test.mjs",
  "tests/exp-0022-analysis.test.mjs",
  "tests/exp-0022-worker.test.mjs",
  "tests/exp-0023-analysis.test.mjs",
  "tests/exp-0023-boundary.test.mjs",
  "tests/exp-0023-supervisor.test.mjs"
].toSorted());

export const EXP0023_INHERITED_INSTRUMENTATION_SOURCE_PATHS = Object.freeze([
  "scripts/lib/exp-0021-cdp-capture.mjs",
  "scripts/run-exp-0022-worker.mjs",
  "src/eval/exp-0022-bootstrap-audit-health-binding.mjs",
  "src/eval/factory/canonical-hash.mjs",
  "src/eval/runtime-provenance.mjs",
  "src/eval/source-fingerprint.mjs",
  "tests/exp-0021-cdp-capture.test.mjs",
  "tests/exp-0022-analysis.test.mjs",
  "tests/exp-0022-worker.test.mjs"
].toSorted());

export const EXP0023_TRIAL_ORDER = deepFreeze([
  { navigation: 1, position: 1, trialId: "A1", payloadId: "A" },
  { navigation: 1, position: 2, trialId: "B1", payloadId: "B" },
  { navigation: 2, position: 1, trialId: "B2", payloadId: "B" },
  { navigation: 2, position: 2, trialId: "A2", payloadId: "A" }
]);

export const EXP0023_GIT_TOPOLOGY = deepFreeze({
  order: ["C0_INSTRUMENT", "FREEZE", "OPENING", "EVIDENCE"],
  freezeDirectParent: "C0_INSTRUMENT",
  openingDirectParent: "FREEZE",
  evidenceDirectParent: "OPENING",
  evidenceAllowedPaths: [EXP0023_RECEIPT_PATH, EXP0023_REPORT_PATH]
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const TARGET_URL =
  "http://localhost:4173/?automation=1&experiment=0022";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function hash(value) {
  return HASH_PATTERN.test(value ?? "");
}

function commit(value) {
  return COMMIT_PATTERN.test(value ?? "");
}

export function validateExp0023C0Boundary(input = {}) {
  return commit(input.runnerSourceCommit) &&
    input.parentCommit === EXP0023_IMPLEMENTATION_BASE_COMMIT &&
    isDeepStrictEqual(input.changedPaths, EXP0023_C0_CHANGED_PATHS) &&
    isDeepStrictEqual(
      input.runtimeChangedPaths,
      EXP0023_RUNTIME_ALLOWED_DRIFT_PATHS
    );
}

function artifactValid(record, path) {
  return exactKeys(record, ["fileSha256", "path"]) &&
    record.path === path && hash(record.fileSha256);
}

function productionSourceListValid(records) {
  return Array.isArray(records) &&
    isDeepStrictEqual(
      records.map((record) => record?.path),
      EXP0023_PRODUCTION_SOURCE_PATHS
    ) && records.every((record) =>
      exactKeys(record, ["exp0022FileSha256", "fileSha256", "path"]) &&
      hash(record.fileSha256) && hash(record.exp0022FileSha256) &&
      record.fileSha256 === record.exp0022FileSha256);
}

function instrumentationSourceListValid(records) {
  const inherited = new Set(EXP0023_INHERITED_INSTRUMENTATION_SOURCE_PATHS);
  return Array.isArray(records) &&
    isDeepStrictEqual(
      records.map((record) => record?.path),
      EXP0023_INSTRUMENTATION_SOURCE_PATHS
    ) && records.every((record) => {
      const inheritedSource = inherited.has(record?.path);
      const keys = inheritedSource
        ? ["exp0022FileSha256", "fileSha256", "path"]
        : ["fileSha256", "path"];
      return exactKeys(record, keys) && hash(record.fileSha256) &&
        (!inheritedSource ||
          (hash(record.exp0022FileSha256) &&
            record.fileSha256 === record.exp0022FileSha256));
    });
}

function freezeCore(input) {
  return {
    schemaVersion: EXP0023_FREEZE_SCHEMA,
    experimentId: "EXP-0023",
    status: "frozen-before-capture-opening",
    runnerSourceCommit: input.runnerSourceCommit,
    nodeVersion: input.nodeVersion,
    sourceBaseline: {
      experimentId: "EXP-0022",
      sourceCommit: EXP0023_EXP0022_SOURCE_COMMIT,
      evidenceCommit: EXP0023_EXP0022_EVIDENCE_COMMIT
    },
    implementationBoundary: {
      baseCommit: EXP0023_IMPLEMENTATION_BASE_COMMIT,
      c0ChangedPaths: structuredClone(EXP0023_C0_CHANGED_PATHS),
      runtimeBaselineCommit: EXP0023_EXP0022_SOURCE_COMMIT,
      runtimeChangedPaths: structuredClone(
        EXP0023_RUNTIME_ALLOWED_DRIFT_PATHS
      )
    },
    runtimeBinding: structuredClone(input.runtimeBinding),
    artifacts: structuredClone(input.artifacts),
    config: structuredClone(EXP0023_CONFIG),
    configCanonicalSha256: `sha256:${canonicalSha256(EXP0023_CONFIG)}`,
    productionSources: structuredClone(input.productionSources),
    instrumentationSources: structuredClone(input.instrumentationSources),
    gitTopology: structuredClone(EXP0023_GIT_TOPOLOGY),
    boundary: {
      browserAttemptsBeforeFreeze: 0,
      captureCampaignsBeforeFreeze: 0,
      reportAbsent: true,
      receiptAbsent: true,
      paidApiCalls: 0,
      gpuRuns: 0,
      canProduceNewEffects: false
    },
    authority: {
      mode: "measurement-only",
      canProduceNewEffects: false
    }
  };
}

export function createExp0023InstrumentationFreeze(input = {}) {
  const core = freezeCore(input);
  const freeze = deepFreeze({
    ...core,
    instrumentationFreezeSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0023InstrumentationFreeze(freeze);
  if (!validation.valid) {
    throw new TypeError(
      `freeze EXP-0023 inválido: ${validation.errors.join("; ")}`
    );
  }
  return freeze;
}

export function validateExp0023InstrumentationFreeze(freeze) {
  const errors = [];
  try {
    if (!exactKeys(freeze, [
      "artifacts",
      "authority",
      "boundary",
      "config",
      "configCanonicalSha256",
      "experimentId",
      "gitTopology",
      "implementationBoundary",
      "instrumentationFreezeSha256",
      "instrumentationSources",
      "nodeVersion",
      "productionSources",
      "runnerSourceCommit",
      "runtimeBinding",
      "schemaVersion",
      "sourceBaseline",
      "status"
    ]) || freeze?.schemaVersion !== EXP0023_FREEZE_SCHEMA ||
      freeze?.experimentId !== "EXP-0023" ||
      freeze?.status !== "frozen-before-capture-opening" ||
      !commit(freeze?.runnerSourceCommit) ||
      typeof freeze?.nodeVersion !== "string" ||
      freeze.nodeVersion.length === 0
    ) errors.push("identidade, estado ou C0 do freeze incompatível");

    const core = structuredClone(freeze ?? {});
    delete core.instrumentationFreezeSha256;
    if (
      freeze?.instrumentationFreezeSha256 !==
        `sha256:${canonicalSha256(core)}`
    ) errors.push("instrumentationFreezeSha256 divergente");
    if (
      !isDeepStrictEqual(freeze?.config, EXP0023_CONFIG) ||
      freeze?.configCanonicalSha256 !==
        `sha256:${canonicalSha256(EXP0023_CONFIG)}`
    ) errors.push("configuração congelada divergiu");
    if (!isDeepStrictEqual(freeze?.sourceBaseline, {
      experimentId: "EXP-0022",
      sourceCommit: EXP0023_EXP0022_SOURCE_COMMIT,
      evidenceCommit: EXP0023_EXP0022_EVIDENCE_COMMIT
    })) errors.push("baseline de fontes/evidência EXP-0022 divergiu");
    if (!isDeepStrictEqual(freeze?.implementationBoundary, {
      baseCommit: EXP0023_IMPLEMENTATION_BASE_COMMIT,
      c0ChangedPaths: EXP0023_C0_CHANGED_PATHS,
      runtimeBaselineCommit: EXP0023_EXP0022_SOURCE_COMMIT,
      runtimeChangedPaths: EXP0023_RUNTIME_ALLOWED_DRIFT_PATHS
    })) errors.push("fronteira exata do C0 divergiu");
    if (!exactKeys(freeze?.runtimeBinding, [
      "algorithm", "fileCount", "roots", "sha256"
    ]) || freeze?.runtimeBinding?.algorithm !==
        EXP0023_RUNTIME_FINGERPRINT_ALGORITHM ||
      !Number.isSafeInteger(freeze?.runtimeBinding?.fileCount) ||
      freeze.runtimeBinding.fileCount <= 0 ||
      !/^[a-f0-9]{64}$/u.test(freeze?.runtimeBinding?.sha256 ?? "") ||
      !isDeepStrictEqual(
        freeze?.runtimeBinding?.roots,
        EXP0023_RUNTIME_FINGERPRINT_ROOTS
      )
    ) errors.push("fingerprint esperado do runtime C0 divergiu");
    if (!exactKeys(freeze?.artifacts, [
      "exp0022Closeout", "exp0022Report", "preregistration"
    ]) || !artifactValid(
      freeze?.artifacts?.preregistration,
      EXP0023_PREREGISTRATION_PATH
    ) || !artifactValid(
      freeze?.artifacts?.exp0022Report,
      EXP0023_EXP0022_REPORT_PATH
    ) || !artifactValid(
      freeze?.artifacts?.exp0022Closeout,
      EXP0023_EXP0022_CLOSEOUT_PATH
    )) errors.push("artefatos congelados incompatíveis");
    if (!productionSourceListValid(freeze?.productionSources)) {
      errors.push("fontes produtivas divergiram do source commit EXP-0022");
    }
    if (!instrumentationSourceListValid(freeze?.instrumentationSources)) {
      errors.push("fontes de instrumentação não correspondem ao allowlist");
    }
    if (!isDeepStrictEqual(freeze?.gitTopology, EXP0023_GIT_TOPOLOGY)) {
      errors.push("topologia Git congelada divergiu");
    }
    if (!isDeepStrictEqual(freeze?.boundary, {
      browserAttemptsBeforeFreeze: 0,
      captureCampaignsBeforeFreeze: 0,
      reportAbsent: true,
      receiptAbsent: true,
      paidApiCalls: 0,
      gpuRuns: 0,
      canProduceNewEffects: false
    }) || !isDeepStrictEqual(freeze?.authority, {
      mode: "measurement-only",
      canProduceNewEffects: false
    })) errors.push("fronteira ou autoridade do freeze incompatível");
  } catch (error) {
    errors.push(`freeze malformado: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

function attemptCampaign() {
  return {
    nonce: EXP0023_ATTEMPT_NONCE,
    command: EXP0023_OFFICIAL_COMMAND,
    inheritedWorkerCommand: EXP0023_INHERITED_WORKER_COMMAND,
    configCanonicalSha256: `sha256:${canonicalSha256(EXP0023_CONFIG)}`,
    orderingAuthority: EXP0023_CONFIG.orderingAuthority,
    targetUrl: TARGET_URL,
    navigations: 2,
    requestsPerNavigation: 2,
    totalRequests: 4,
    trialOrder: structuredClone(EXP0023_TRIAL_ORDER),
    reportPath: EXP0023_REPORT_PATH,
    receiptPath: EXP0023_RECEIPT_PATH
  };
}

function attemptCore(input) {
  return {
    schemaVersion: EXP0023_ATTEMPT_SCHEMA,
    experimentId: "EXP-0023",
    status: "opened-single-capture-attempt",
    openingSourceCommit: input.openingSourceCommit,
    openedAt: input.openedAt,
    freeze: {
      ...structuredClone(input.freeze),
      freezeCommit: input.openingSourceCommit
    },
    campaign: attemptCampaign(),
    gitTopology: structuredClone(EXP0023_GIT_TOPOLOGY),
    boundary: {
      captureCampaignsBeforeOpening: 0,
      reportAbsent: true,
      receiptAbsent: true,
      rerunAllowed: false
    },
    authority: {
      mode: "measurement-only",
      canProduceNewEffects: false
    }
  };
}

export function createExp0023CaptureAttempt(input = {}) {
  const core = attemptCore(input);
  const attempt = deepFreeze({
    ...core,
    captureAttemptSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0023CaptureAttempt(attempt);
  if (!validation.valid) {
    throw new TypeError(
      `tentativa EXP-0023 inválida: ${validation.errors.join("; ")}`
    );
  }
  return attempt;
}

export function validateExp0023CaptureAttempt(attempt) {
  const errors = [];
  try {
    if (!exactKeys(attempt, [
      "authority",
      "boundary",
      "campaign",
      "captureAttemptSha256",
      "experimentId",
      "freeze",
      "gitTopology",
      "openedAt",
      "openingSourceCommit",
      "schemaVersion",
      "status"
    ]) || attempt?.schemaVersion !== EXP0023_ATTEMPT_SCHEMA ||
      attempt?.experimentId !== "EXP-0023" ||
      attempt?.status !== "opened-single-capture-attempt" ||
      !commit(attempt?.openingSourceCommit) ||
      !validDate(attempt?.openedAt)
    ) errors.push("identidade, estado, commit ou data da tentativa divergiram");
    const core = structuredClone(attempt ?? {});
    delete core.captureAttemptSha256;
    if (
      attempt?.captureAttemptSha256 !== `sha256:${canonicalSha256(core)}`
    ) errors.push("captureAttemptSha256 divergente");
    if (!exactKeys(attempt?.freeze, [
      "fileSha256",
      "freezeCommit",
      "instrumentationFreezeSha256",
      "path",
      "runnerSourceCommit"
    ]) || attempt?.freeze?.path !== EXP0023_FREEZE_PATH ||
      !hash(attempt?.freeze?.fileSha256) ||
      !hash(attempt?.freeze?.instrumentationFreezeSha256) ||
      !commit(attempt?.freeze?.runnerSourceCommit) ||
      attempt?.freeze?.freezeCommit !== attempt?.openingSourceCommit
    ) errors.push("binding do freeze na tentativa divergiu");
    if (!isDeepStrictEqual(attempt?.campaign, attemptCampaign())) {
      errors.push("campanha oficial da tentativa divergiu");
    }
    if (!isDeepStrictEqual(attempt?.gitTopology, EXP0023_GIT_TOPOLOGY)) {
      errors.push("topologia da tentativa divergiu");
    }
    if (!isDeepStrictEqual(attempt?.boundary, {
      captureCampaignsBeforeOpening: 0,
      reportAbsent: true,
      receiptAbsent: true,
      rerunAllowed: false
    }) || !isDeepStrictEqual(attempt?.authority, {
      mode: "measurement-only",
      canProduceNewEffects: false
    })) errors.push("fronteira ou autoridade da tentativa divergiu");
  } catch (error) {
    errors.push(`tentativa malformada: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export const EXP0023_BOUNDARY_PATHS = deepFreeze({
  freeze: EXP0023_FREEZE_PATH,
  attempt: EXP0023_ATTEMPT_PATH,
  receipt: EXP0023_RECEIPT_PATH,
  report: EXP0023_REPORT_PATH,
  preregistration: EXP0023_PREREGISTRATION_PATH,
  exp0022Report: EXP0023_EXP0022_REPORT_PATH,
  exp0022Closeout: EXP0023_EXP0022_CLOSEOUT_PATH
});
