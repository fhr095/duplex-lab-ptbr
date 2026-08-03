import { isDeepStrictEqual } from "node:util";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import { EXP0022_CONFIG } from
  "./exp-0022-bootstrap-audit-health-binding.mjs";

export const EXP0022_FREEZE_SCHEMA =
  "exp-0022-instrumentation-freeze-v1";
export const EXP0022_ATTEMPT_SCHEMA =
  "exp-0022-capture-attempt-v1";
export const EXP0022_ATTEMPT_NONCE = "exp-0022-official-v0.1";
export const EXP0022_OFFICIAL_COMMAND =
  "node scripts/run-exp-0022-supervisor.mjs";
export const EXP0022_EXP0021_SOURCE_COMMIT =
  "2fbe5af88931d49c236cc27f241f2a74c545f1d2";
export const EXP0022_IMPLEMENTATION_BASE_COMMIT =
  "dbd4204c3961c2950d0c72885253339095f96fcb";
export const EXP0022_RUNTIME_FINGERPRINT_ROOTS = Object.freeze([
  "src",
  "web",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
]);
export const EXP0022_RUNTIME_FINGERPRINT_ALGORITHM =
  "sha256-source-tree-v1";

export const EXP0022_PREREGISTRATION_PATH =
  "docs/experiments/EXP-0022-bootstrap-audit-health-binding.md";
export const EXP0022_EXP0021_REPORT_PATH =
  "eval/reports/exp-0021-cdp-capture-qualification-v0.1.json";
export const EXP0022_EXP0021_CLOSEOUT_PATH =
  "docs/experiments/EXP-0021-closeout.md";
export const EXP0022_FREEZE_PATH =
  "eval/commitments/exp-0022-instrumentation-freeze-v0.1.json";
export const EXP0022_ATTEMPT_PATH =
  "eval/commitments/exp-0022-capture-attempt-v0.1.json";
export const EXP0022_RECEIPT_PATH =
  "eval/generated/exp-0022/capture-attempt-consumed-v0.1.json";
export const EXP0022_REPORT_PATH =
  "eval/reports/exp-0022-bootstrap-audit-health-binding-v0.1.json";

export const EXP0022_C0_CHANGED_PATHS = Object.freeze([
  ".gitignore",
  "docs/AUTONOMOUS_LOOP.md",
  "docs/PROJECT_REFERENCE.md",
  "docs/ROADMAP.md",
  "docs/experiments/EXP-0022-bootstrap-audit-health-binding.md",
  "eval/EXPERIMENT_INDEX.json",
  "package.json",
  "scripts/freeze-exp-0022-instrumentation.mjs",
  "scripts/open-exp-0022-capture-attempt.mjs",
  "scripts/run-exp-0022-supervisor.mjs",
  "scripts/run-exp-0022-worker.mjs",
  "src/eval/exp-0022-bootstrap-audit-health-binding.mjs",
  "src/eval/exp-0022-boundary.mjs",
  "tests/exp-0022-analysis.test.mjs",
  "tests/exp-0022-boundary.test.mjs",
  "tests/exp-0022-supervisor.test.mjs",
  "tests/exp-0022-worker.test.mjs",
  "tests/experiment-index.test.mjs"
].toSorted());

export const EXP0022_RUNTIME_ALLOWED_DRIFT_PATHS = Object.freeze([
  "package.json",
  "src/eval/exp-0022-bootstrap-audit-health-binding.mjs",
  "src/eval/exp-0022-boundary.mjs",
  "src/eval/experiment-index.mjs"
].toSorted());

export const EXP0022_PRODUCTION_SOURCE_PATHS = Object.freeze([
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

export const EXP0022_INSTRUMENTATION_SOURCE_PATHS = Object.freeze([
  ".gitignore",
  "package.json",
  "scripts/freeze-exp-0022-instrumentation.mjs",
  "scripts/lib/exp-0021-cdp-capture.mjs",
  "scripts/open-exp-0022-capture-attempt.mjs",
  "scripts/run-exp-0022-supervisor.mjs",
  "scripts/run-exp-0022-worker.mjs",
  "src/eval/factory/canonical-hash.mjs",
  "src/eval/exp-0022-boundary.mjs",
  "src/eval/exp-0022-bootstrap-audit-health-binding.mjs",
  "src/eval/runtime-provenance.mjs",
  "src/eval/source-fingerprint.mjs",
  "tests/exp-0022-analysis.test.mjs",
  "tests/exp-0022-boundary.test.mjs",
  "tests/exp-0021-cdp-capture.test.mjs",
  "tests/exp-0022-supervisor.test.mjs",
  "tests/exp-0022-worker.test.mjs"
].toSorted());

export const EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS = Object.freeze([
  "scripts/lib/exp-0021-cdp-capture.mjs",
  "src/eval/factory/canonical-hash.mjs",
  "src/eval/runtime-provenance.mjs",
  "src/eval/source-fingerprint.mjs",
  "tests/exp-0021-cdp-capture.test.mjs"
].toSorted());

export const EXP0022_TRIAL_ORDER = deepFreeze([
  { navigation: 1, position: 1, trialId: "A1", payloadId: "A" },
  { navigation: 1, position: 2, trialId: "B1", payloadId: "B" },
  { navigation: 2, position: 1, trialId: "B2", payloadId: "B" },
  { navigation: 2, position: 2, trialId: "A2", payloadId: "A" }
]);

export const EXP0022_GIT_TOPOLOGY = deepFreeze({
  order: ["C0_INSTRUMENT", "FREEZE", "OPENING", "EVIDENCE"],
  freezeDirectParent: "C0_INSTRUMENT",
  openingDirectParent: "FREEZE",
  evidenceDirectParent: "OPENING",
  evidenceAllowedPaths: [EXP0022_RECEIPT_PATH, EXP0022_REPORT_PATH]
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

export function validateExp0022C0Boundary(input = {}) {
  return commit(input.runnerSourceCommit) &&
    input.parentCommit === EXP0022_IMPLEMENTATION_BASE_COMMIT &&
    isDeepStrictEqual(
      input.changedPaths,
      EXP0022_C0_CHANGED_PATHS
    ) && isDeepStrictEqual(
      input.runtimeChangedPaths,
      EXP0022_RUNTIME_ALLOWED_DRIFT_PATHS
    );
}

function artifactValid(record, path) {
  return exactKeys(record, ["fileSha256", "path"]) &&
    record.path === path && hash(record.fileSha256);
}

function sourceListValid(records, paths, production = false) {
  return Array.isArray(records) &&
    isDeepStrictEqual(records.map((record) => record?.path), paths) &&
    records.every((record) => {
      const keys = production
        ? ["exp0021FileSha256", "fileSha256", "path"]
        : ["fileSha256", "path"];
      return exactKeys(record, keys) && hash(record.fileSha256) &&
        (!production ||
          hash(record.exp0021FileSha256) &&
          record.fileSha256 === record.exp0021FileSha256);
    });
}

function instrumentationSourceListValid(records) {
  const inherited = new Set(
    EXP0022_INHERITED_INSTRUMENTATION_SOURCE_PATHS
  );
  return Array.isArray(records) &&
    isDeepStrictEqual(
      records.map((record) => record?.path),
      EXP0022_INSTRUMENTATION_SOURCE_PATHS
    ) && records.every((record) => {
      const inheritedSource = inherited.has(record?.path);
      const keys = inheritedSource
        ? ["exp0021FileSha256", "fileSha256", "path"]
        : ["fileSha256", "path"];
      return exactKeys(record, keys) && hash(record.fileSha256) &&
        (!inheritedSource ||
          hash(record.exp0021FileSha256) &&
          record.fileSha256 === record.exp0021FileSha256);
    });
}

function freezeCore(input) {
  return {
    schemaVersion: EXP0022_FREEZE_SCHEMA,
    experimentId: "EXP-0022",
    status: "frozen-before-capture-opening",
    runnerSourceCommit: input.runnerSourceCommit,
    nodeVersion: input.nodeVersion,
    sourceBaseline: {
      experimentId: "EXP-0021",
      evidenceCommit: EXP0022_EXP0021_SOURCE_COMMIT
    },
    implementationBoundary: {
      baseCommit: EXP0022_IMPLEMENTATION_BASE_COMMIT,
      c0ChangedPaths: structuredClone(EXP0022_C0_CHANGED_PATHS),
      runtimeBaselineCommit: EXP0022_EXP0021_SOURCE_COMMIT,
      runtimeChangedPaths: structuredClone(
        EXP0022_RUNTIME_ALLOWED_DRIFT_PATHS
      )
    },
    runtimeBinding: structuredClone(input.runtimeBinding),
    artifacts: structuredClone(input.artifacts),
    config: structuredClone(EXP0022_CONFIG),
    configCanonicalSha256: `sha256:${canonicalSha256(EXP0022_CONFIG)}`,
    productionSources: structuredClone(input.productionSources),
    instrumentationSources: structuredClone(input.instrumentationSources),
    gitTopology: structuredClone(EXP0022_GIT_TOPOLOGY),
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

export function createExp0022InstrumentationFreeze(input = {}) {
  const core = freezeCore(input);
  const freeze = deepFreeze({
    ...core,
    instrumentationFreezeSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0022InstrumentationFreeze(freeze);
  if (!validation.valid) {
    throw new TypeError(
      `freeze EXP-0022 inválido: ${validation.errors.join("; ")}`
    );
  }
  return freeze;
}

export function validateExp0022InstrumentationFreeze(freeze) {
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
    ]) ||
      freeze?.schemaVersion !== EXP0022_FREEZE_SCHEMA ||
      freeze?.experimentId !== "EXP-0022" ||
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
      !isDeepStrictEqual(freeze?.config, EXP0022_CONFIG) ||
      freeze?.configCanonicalSha256 !==
        `sha256:${canonicalSha256(EXP0022_CONFIG)}`
    ) errors.push("configuração congelada divergiu");

    if (
      !exactKeys(freeze?.sourceBaseline, ["evidenceCommit", "experimentId"]) ||
      freeze?.sourceBaseline?.experimentId !== "EXP-0021" ||
      freeze?.sourceBaseline?.evidenceCommit !==
        EXP0022_EXP0021_SOURCE_COMMIT
    ) errors.push("baseline de fontes EXP-0021 divergiu");

    if (!exactKeys(freeze?.implementationBoundary, [
      "baseCommit",
      "c0ChangedPaths",
      "runtimeBaselineCommit",
      "runtimeChangedPaths"
    ]) || freeze?.implementationBoundary?.baseCommit !==
        EXP0022_IMPLEMENTATION_BASE_COMMIT ||
      !isDeepStrictEqual(
        freeze?.implementationBoundary?.c0ChangedPaths,
        EXP0022_C0_CHANGED_PATHS
      ) || freeze?.implementationBoundary?.runtimeBaselineCommit !==
        EXP0022_EXP0021_SOURCE_COMMIT ||
      !isDeepStrictEqual(
        freeze?.implementationBoundary?.runtimeChangedPaths,
        EXP0022_RUNTIME_ALLOWED_DRIFT_PATHS
      )
    ) errors.push("fronteira exata do C0 divergiu");

    if (!exactKeys(freeze?.runtimeBinding, [
      "algorithm",
      "fileCount",
      "roots",
      "sha256"
    ]) ||
      freeze?.runtimeBinding?.algorithm !==
        EXP0022_RUNTIME_FINGERPRINT_ALGORITHM ||
      !Number.isSafeInteger(freeze?.runtimeBinding?.fileCount) ||
      freeze.runtimeBinding.fileCount <= 0 ||
      !/^[a-f0-9]{64}$/u.test(freeze?.runtimeBinding?.sha256 ?? "") ||
      !isDeepStrictEqual(
        freeze?.runtimeBinding?.roots,
        EXP0022_RUNTIME_FINGERPRINT_ROOTS
      )
    ) errors.push("fingerprint esperado do runtime C0 divergiu");

    if (!exactKeys(freeze?.artifacts, [
      "exp0021Closeout",
      "exp0021Report",
      "preregistration"
    ]) ||
      !artifactValid(
        freeze?.artifacts?.preregistration,
        EXP0022_PREREGISTRATION_PATH
      ) ||
      !artifactValid(
        freeze?.artifacts?.exp0021Report,
        EXP0022_EXP0021_REPORT_PATH
      ) ||
      !artifactValid(
        freeze?.artifacts?.exp0021Closeout,
        EXP0022_EXP0021_CLOSEOUT_PATH
      )
    ) errors.push("artefatos congelados incompatíveis");

    if (!sourceListValid(
      freeze?.productionSources,
      EXP0022_PRODUCTION_SOURCE_PATHS,
      true
    )) errors.push("fontes de produção divergiram do evidence commit EXP-0021");
    if (!instrumentationSourceListValid(freeze?.instrumentationSources)) {
      errors.push("fontes de instrumentação não correspondem ao allowlist");
    }

    if (!isDeepStrictEqual(freeze?.gitTopology, EXP0022_GIT_TOPOLOGY)) {
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
    nonce: EXP0022_ATTEMPT_NONCE,
    command: EXP0022_OFFICIAL_COMMAND,
    configCanonicalSha256: `sha256:${canonicalSha256(EXP0022_CONFIG)}`,
    targetUrl: TARGET_URL,
    navigations: 2,
    requestsPerNavigation: 2,
    totalRequests: 4,
    trialOrder: structuredClone(EXP0022_TRIAL_ORDER),
    reportPath: EXP0022_REPORT_PATH,
    receiptPath: EXP0022_RECEIPT_PATH
  };
}

function attemptCore(input) {
  return {
    schemaVersion: EXP0022_ATTEMPT_SCHEMA,
    experimentId: "EXP-0022",
    status: "opened-single-capture-attempt",
    openingSourceCommit: input.openingSourceCommit,
    openedAt: input.openedAt,
    freeze: {
      ...structuredClone(input.freeze),
      freezeCommit: input.openingSourceCommit
    },
    campaign: attemptCampaign(),
    gitTopology: structuredClone(EXP0022_GIT_TOPOLOGY),
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

export function createExp0022CaptureAttempt(input = {}) {
  const core = attemptCore(input);
  const attempt = deepFreeze({
    ...core,
    captureAttemptSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0022CaptureAttempt(attempt);
  if (!validation.valid) {
    throw new TypeError(
      `tentativa EXP-0022 inválida: ${validation.errors.join("; ")}`
    );
  }
  return attempt;
}

export function validateExp0022CaptureAttempt(attempt) {
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
    ]) ||
      attempt?.schemaVersion !== EXP0022_ATTEMPT_SCHEMA ||
      attempt?.experimentId !== "EXP-0022" ||
      attempt?.status !== "opened-single-capture-attempt" ||
      !commit(attempt?.openingSourceCommit) ||
      !Number.isFinite(Date.parse(attempt?.openedAt ?? ""))
    ) errors.push("identidade, estado, data ou commit da tentativa inválido");

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
    ]) ||
      attempt?.freeze?.path !== EXP0022_FREEZE_PATH ||
      !hash(attempt?.freeze?.fileSha256) ||
      !hash(attempt?.freeze?.instrumentationFreezeSha256) ||
      !commit(attempt?.freeze?.runnerSourceCommit) ||
      !commit(attempt?.freeze?.freezeCommit) ||
      attempt?.freeze?.freezeCommit !== attempt?.openingSourceCommit ||
      attempt?.freeze?.runnerSourceCommit === attempt?.openingSourceCommit
    ) errors.push("binding C0/freeze da tentativa inválido");

    if (!isDeepStrictEqual(attempt?.campaign, attemptCampaign())) {
      errors.push("campanha aberta divergiu do contrato 2x2 A1/B1/B2/A2");
    }

    if (!isDeepStrictEqual(attempt?.gitTopology, EXP0022_GIT_TOPOLOGY)) {
      errors.push("topologia Git da tentativa divergiu");
    }

    if (!isDeepStrictEqual(attempt?.boundary, {
      captureCampaignsBeforeOpening: 0,
      reportAbsent: true,
      receiptAbsent: true,
      rerunAllowed: false
    }) || !isDeepStrictEqual(attempt?.authority, {
      mode: "measurement-only",
      canProduceNewEffects: false
    })) errors.push("fronteira ou autoridade da tentativa incompatível");
  } catch (error) {
    errors.push(`tentativa malformada: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export const EXP0022_BOUNDARY_PATHS = deepFreeze({
  preregistration: EXP0022_PREREGISTRATION_PATH,
  exp0021Report: EXP0022_EXP0021_REPORT_PATH,
  exp0021Closeout: EXP0022_EXP0021_CLOSEOUT_PATH,
  freeze: EXP0022_FREEZE_PATH,
  attempt: EXP0022_ATTEMPT_PATH,
  receipt: EXP0022_RECEIPT_PATH,
  report: EXP0022_REPORT_PATH
});
