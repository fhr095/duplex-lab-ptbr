import { isDeepStrictEqual } from "node:util";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0024_FREEZE_SCHEMA =
  "exp-0024-instrumentation-freeze-v1";
export const EXP0024_OPENING_SCHEMA =
  "exp-0024-physical-stop-attempt-v1";
export const EXP0024_ATTEMPT_NONCE = "exp-0024-official-v0.1";

export const EXP0024_IMPLEMENTATION_BASE_COMMIT =
  "e08e4c4d18af88c519abe47ef6a1ecbba67fd5d9";
export const EXP0024_EXP0019_EVIDENCE_COMMIT =
  "0127322ad18a5b1d98de53d9e45898249e05888d";
export const EXP0024_EXP0023_EVIDENCE_COMMIT =
  "ee0d5864aac4a984b33c9bdb86273ca9e7283b38";

export const EXP0024_REQUIRED_NODE_VERSION = "v22.22.2";
export const EXP0024_REQUIRED_CHROME = Object.freeze({
  product: "Chrome/150.0.7871.187",
  protocolVersion: "1.3"
});
export const EXP0024_RUNTIME_FINGERPRINT_ROOTS = Object.freeze([
  "src",
  "web",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
]);
export const EXP0024_RUNTIME_FINGERPRINT_ALGORITHM =
  "sha256-source-tree-v1";

export const EXP0024_PREREGISTRATION_PATH =
  "docs/experiments/EXP-0024-physical-stop-after-capture-qualification.md";
export const EXP0024_EXP0019_REPORT_PATH =
  "eval/reports/exp-0019-causal-audio-v0.1.json";
export const EXP0024_EXP0019_CLOSEOUT_PATH =
  "docs/experiments/EXP-0019-closeout.md";
export const EXP0024_EXP0023_REPORT_PATH =
  "eval/reports/exp-0023-cdp-ordinal-timestamp-semantics-v0.1.json";
export const EXP0024_EXP0023_CLOSEOUT_PATH =
  "docs/experiments/EXP-0023-closeout.md";
export const EXP0024_FREEZE_PATH =
  "eval/commitments/exp-0024-instrumentation-freeze-v0.1.json";
export const EXP0024_OPENING_PATH =
  "eval/commitments/exp-0024-physical-stop-attempt-v0.1.json";
export const EXP0024_RECEIPT_PATH =
  "eval/generated/exp-0024/physical-stop-attempt-consumed-v0.1.json";
export const EXP0024_JOURNAL_PATH =
  "eval/generated/exp-0024/physical-stop-journal-v0.1.ndjson";
export const EXP0024_REPORT_PATH =
  "eval/reports/exp-0024-physical-stop-after-capture-qualification-v0.1.json";
export const EXP0024_LOCK_PATH =
  "eval/generated/exp-0024-physical-stop-attempt-v0.1.lock";
export const EXP0024_OFFICIAL_COMMAND =
  `flock --exclusive --nonblock ${EXP0024_LOCK_PATH} ` +
  "node scripts/run-exp-0024-supervisor.mjs";

export const EXP0024_PRODUCTION_SOURCE_PATHS = Object.freeze([
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

export const EXP0024_INSTRUMENTATION_SOURCE_PATHS = Object.freeze([
  ".gitignore",
  "package.json",
  "scripts/freeze-exp-0024-instrumentation.mjs",
  "scripts/lib/exp-0024-browser-harness.mjs",
  "scripts/open-exp-0024-physical-stop-attempt.mjs",
  "scripts/run-exp-0024-supervisor.mjs",
  "scripts/run-exp-0024-worker.mjs",
  "src/eval/exp-0024-boundary.mjs",
  "src/eval/exp-0024-journal.mjs",
  "src/eval/exp-0024-stop-order.mjs",
  "tests/exp-0024-boundary.test.mjs",
  "tests/exp-0024-browser-harness.test.mjs",
  "tests/exp-0024-journal.test.mjs",
  "tests/exp-0024-stop-order.test.mjs",
  "tests/exp-0024-supervisor.test.mjs",
  "tests/exp-0024-worker.test.mjs"
].toSorted());

export const EXP0024_C0_CHANGED_PATHS = Object.freeze([
  ...EXP0024_INSTRUMENTATION_SOURCE_PATHS
]);

export const EXP0024_RUNTIME_ALLOWED_DRIFT_PATHS = Object.freeze([
  "package.json",
  "src/eval/exp-0024-boundary.mjs",
  "src/eval/exp-0024-journal.mjs",
  "src/eval/exp-0024-stop-order.mjs"
].toSorted());

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const EXP0024_GIT_TOPOLOGY = deepFreeze({
  order: ["C0_INSTRUMENT", "FREEZE", "OPENING", "EVIDENCE"],
  freezeDirectParent: "C0_INSTRUMENT",
  freezeAllowedPaths: [EXP0024_FREEZE_PATH],
  openingDirectParent: "FREEZE",
  openingAllowedPaths: [EXP0024_OPENING_PATH],
  evidenceDirectParent: "OPENING",
  normalEvidenceAllowedPaths: [
    EXP0024_JOURNAL_PATH,
    EXP0024_RECEIPT_PATH,
    EXP0024_REPORT_PATH
  ].toSorted(),
  recoveryBeforeJournalAllowedPaths: [
    EXP0024_RECEIPT_PATH,
    EXP0024_REPORT_PATH
  ].toSorted()
});

export const EXP0024_CONFIG = deepFreeze({
  targetUrl: "http://localhost:4173/?automation=1&experiment=0024",
  navigations: 2,
  stopsPerNavigation: 6,
  totalStops: 12,
  phrase:
    "Esta fala contínua mede uma única parada física do assistente.",
  ttsRate: 1,
  expectedWavSha256:
    "sha256:ca2f579e7942db94c2f50029525b2057d94964e91cfe79244bd706eb6f50cd4b",
  expectedWavByteLength: 237_232,
  triggerAfterRenderActiveMs: 320,
  triggerTimerErrorMaxMs: 10,
  postStopObservationMs: 250,
  renderStopLimitMs: 250,
  classMinimumCount: 2,
  classLatencyEquivalenceMarginMs: 16.7,
  responseBodyRetryDelaysMs: [0, 8, 24, 64],
  networkEnable: {
    maxTotalBufferSize: 16 * 1024 * 1024,
    maxResourceBufferSize: 2 * 1024 * 1024,
    maxPostDataSize: 64 * 1024,
    enableDurableMessages: false
  },
  browserCdpByteIdentity: "NOT_EVALUATED",
  nodeVersion: EXP0024_REQUIRED_NODE_VERSION,
  chrome: EXP0024_REQUIRED_CHROME,
  provider: "local",
  asrState: "disabled",
  vadControlEngine: "adaptive-energy-vad",
  vadShadowState: "disabled",
  ttsEngine: "windows-system-speech",
  attemptDeadlineMs: 600_000,
  paidApiCalls: 0,
  gpuRuns: 0,
  canProduceNewEffects: false,
  sameExperimentRerunAllowed: false
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HEX_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function hash(value) {
  return HASH_PATTERN.test(value ?? "");
}

function hexHash(value) {
  return HEX_HASH_PATTERN.test(value ?? "");
}

function commit(value) {
  return COMMIT_PATTERN.test(value ?? "");
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function artifactValid(record, path) {
  return exactKeys(record, ["fileSha256", "path"]) &&
    record.path === path && hash(record.fileSha256);
}

export function validateExp0024C0Boundary(input = {}) {
  return exactKeys(input, [
    "changedPaths",
    "parentCommit",
    "runnerSourceCommit",
    "runtimeChangedPaths"
  ]) && commit(input.runnerSourceCommit) &&
    input.parentCommit === EXP0024_IMPLEMENTATION_BASE_COMMIT &&
    isDeepStrictEqual(input.changedPaths, EXP0024_C0_CHANGED_PATHS) &&
    isDeepStrictEqual(
      input.runtimeChangedPaths,
      EXP0024_RUNTIME_ALLOWED_DRIFT_PATHS
    );
}

export function validateExp0024FreezeCommitBoundary(input = {}) {
  return exactKeys(input, [
    "c0Commit", "changedPaths", "freezeCommit", "parentCommit"
  ]) && commit(input.c0Commit) && commit(input.freezeCommit) &&
    input.parentCommit === input.c0Commit &&
    isDeepStrictEqual(input.changedPaths, [EXP0024_FREEZE_PATH]);
}

export function validateExp0024OpeningCommitBoundary(input = {}) {
  return exactKeys(input, [
    "changedPaths", "freezeCommit", "openingCommit", "parentCommit"
  ]) && commit(input.freezeCommit) && commit(input.openingCommit) &&
    input.parentCommit === input.freezeCommit &&
    isDeepStrictEqual(input.changedPaths, [EXP0024_OPENING_PATH]);
}

export function validateExp0024EvidenceCommitBoundary(input = {}) {
  if (!exactKeys(input, [
    "changedPaths",
    "evidenceCommit",
    "openingCommit",
    "parentCommit",
    "recoveryBeforeJournal"
  ]) || !commit(input.evidenceCommit) || !commit(input.openingCommit) ||
    input.parentCommit !== input.openingCommit ||
    typeof input.recoveryBeforeJournal !== "boolean") return false;
  const allowed = input.recoveryBeforeJournal
    ? EXP0024_GIT_TOPOLOGY.recoveryBeforeJournalAllowedPaths
    : EXP0024_GIT_TOPOLOGY.normalEvidenceAllowedPaths;
  return isDeepStrictEqual(input.changedPaths, allowed);
}

function productionSourceListValid(records) {
  return Array.isArray(records) && isDeepStrictEqual(
    records.map((record) => record?.path),
    EXP0024_PRODUCTION_SOURCE_PATHS
  ) && records.every((record) =>
    exactKeys(record, ["exp0019FileSha256", "fileSha256", "path"]) &&
    hash(record.fileSha256) && hash(record.exp0019FileSha256) &&
    record.fileSha256 === record.exp0019FileSha256);
}

function instrumentationSourceListValid(records) {
  return Array.isArray(records) && isDeepStrictEqual(
    records.map((record) => record?.path),
    EXP0024_INSTRUMENTATION_SOURCE_PATHS
  ) && records.every((record) =>
    exactKeys(record, ["fileSha256", "path"]) &&
    hash(record.fileSha256));
}

function sourceBaseline() {
  return {
    physicalRuntime: {
      experimentId: "EXP-0019",
      evidenceCommit: EXP0024_EXP0019_EVIDENCE_COMMIT
    },
    captureQualification: {
      experimentId: "EXP-0023",
      evidenceCommit: EXP0024_EXP0023_EVIDENCE_COMMIT
    }
  };
}

function implementationBoundary() {
  return {
    baseCommit: EXP0024_IMPLEMENTATION_BASE_COMMIT,
    c0ChangedPaths: structuredClone(EXP0024_C0_CHANGED_PATHS),
    runtimeBaselineCommit: EXP0024_IMPLEMENTATION_BASE_COMMIT,
    runtimeChangedPaths: structuredClone(
      EXP0024_RUNTIME_ALLOWED_DRIFT_PATHS
    )
  };
}

function freezeBoundary() {
  return {
    physicalStopCampaignsBeforeFreeze: 0,
    freezeAbsentBeforeWrite: true,
    openingAbsent: true,
    receiptAbsent: true,
    journalAbsent: true,
    reportAbsent: true,
    lockAbsent: true,
    paidApiCalls: 0,
    gpuRuns: 0,
    canProduceNewEffects: false
  };
}

function freezeCore(input) {
  return {
    schemaVersion: EXP0024_FREEZE_SCHEMA,
    experimentId: "EXP-0024",
    status: "frozen-before-physical-stop-opening",
    runnerSourceCommit: input.runnerSourceCommit,
    nodeVersion: input.nodeVersion,
    sourceBaseline: sourceBaseline(),
    implementationBoundary: implementationBoundary(),
    runtimeBinding: structuredClone(input.runtimeBinding),
    artifacts: structuredClone(input.artifacts),
    config: structuredClone(EXP0024_CONFIG),
    configCanonicalSha256: `sha256:${canonicalSha256(EXP0024_CONFIG)}`,
    productionSources: structuredClone(input.productionSources),
    instrumentationSources: structuredClone(input.instrumentationSources),
    gitTopology: structuredClone(EXP0024_GIT_TOPOLOGY),
    boundary: freezeBoundary(),
    authority: {
      mode: "measurement-only",
      canProduceNewEffects: false
    }
  };
}

export function createExp0024InstrumentationFreeze(input = {}) {
  const core = freezeCore(input);
  const freeze = deepFreeze({
    ...core,
    instrumentationFreezeSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0024InstrumentationFreeze(freeze);
  if (!validation.valid) {
    throw new TypeError(
      `freeze EXP-0024 inválido: ${validation.errors.join("; ")}`
    );
  }
  return freeze;
}

export function validateExp0024InstrumentationFreeze(freeze) {
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
    ]) || freeze?.schemaVersion !== EXP0024_FREEZE_SCHEMA ||
      freeze?.experimentId !== "EXP-0024" ||
      freeze?.status !== "frozen-before-physical-stop-opening" ||
      !commit(freeze?.runnerSourceCommit) ||
      freeze?.nodeVersion !== EXP0024_REQUIRED_NODE_VERSION
    ) errors.push("identidade, estado, C0 ou Node do freeze incompatível");

    const core = structuredClone(freeze ?? {});
    delete core.instrumentationFreezeSha256;
    if (freeze?.instrumentationFreezeSha256 !==
      `sha256:${canonicalSha256(core)}`
    ) errors.push("instrumentationFreezeSha256 divergente");
    if (!isDeepStrictEqual(freeze?.config, EXP0024_CONFIG) ||
      freeze?.configCanonicalSha256 !==
        `sha256:${canonicalSha256(EXP0024_CONFIG)}`
    ) errors.push("configuração congelada divergiu");
    if (!isDeepStrictEqual(freeze?.sourceBaseline, sourceBaseline())) {
      errors.push("baselines EXP-0019/EXP-0023 divergiram");
    }
    if (!isDeepStrictEqual(
      freeze?.implementationBoundary,
      implementationBoundary()
    )) errors.push("fronteira exata do C0 divergiu");
    if (!exactKeys(freeze?.runtimeBinding, [
      "algorithm", "fileCount", "roots", "sha256"
    ]) || freeze?.runtimeBinding?.algorithm !==
        EXP0024_RUNTIME_FINGERPRINT_ALGORITHM ||
      !Number.isSafeInteger(freeze?.runtimeBinding?.fileCount) ||
      freeze.runtimeBinding.fileCount <= 0 ||
      !hexHash(freeze?.runtimeBinding?.sha256) ||
      !isDeepStrictEqual(
        freeze?.runtimeBinding?.roots,
        EXP0024_RUNTIME_FINGERPRINT_ROOTS
      )
    ) errors.push("fingerprint esperado do runtime C0 divergiu");
    if (!exactKeys(freeze?.artifacts, [
      "exp0019Closeout",
      "exp0019Report",
      "exp0023Closeout",
      "exp0023Report",
      "preregistration"
    ]) || !artifactValid(
      freeze?.artifacts?.preregistration,
      EXP0024_PREREGISTRATION_PATH
    ) || !artifactValid(
      freeze?.artifacts?.exp0019Report,
      EXP0024_EXP0019_REPORT_PATH
    ) || !artifactValid(
      freeze?.artifacts?.exp0019Closeout,
      EXP0024_EXP0019_CLOSEOUT_PATH
    ) || !artifactValid(
      freeze?.artifacts?.exp0023Report,
      EXP0024_EXP0023_REPORT_PATH
    ) || !artifactValid(
      freeze?.artifacts?.exp0023Closeout,
      EXP0024_EXP0023_CLOSEOUT_PATH
    )) errors.push("artefatos congelados incompatíveis");
    if (!productionSourceListValid(freeze?.productionSources)) {
      errors.push("fontes produtivas divergiram do evidence commit EXP-0019");
    }
    if (!instrumentationSourceListValid(freeze?.instrumentationSources)) {
      errors.push("fontes de instrumentação não correspondem ao allowlist");
    }
    if (!isDeepStrictEqual(freeze?.gitTopology, EXP0024_GIT_TOPOLOGY)) {
      errors.push("topologia Git congelada divergiu");
    }
    if (!isDeepStrictEqual(freeze?.boundary, freezeBoundary()) ||
      !isDeepStrictEqual(freeze?.authority, {
        mode: "measurement-only",
        canProduceNewEffects: false
      })
    ) errors.push("fronteira ou autoridade do freeze incompatível");
  } catch (error) {
    errors.push(`freeze malformado: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

function openingPreflight(input) {
  return {
    completedAt: input?.completedAt,
    nodeVersion: input?.nodeVersion,
    chrome: structuredClone(input?.chrome),
    runtimeFingerprintSha256: input?.runtimeFingerprintSha256,
    provider: input?.provider,
    targetAutomationNavigations: input?.targetAutomationNavigations,
    physicalStops: input?.physicalStops,
    paidApiCalls: input?.paidApiCalls,
    gpuRuns: input?.gpuRuns
  };
}

function preflightValid(preflight, expectedRuntimeFingerprintSha256) {
  return exactKeys(preflight, [
    "chrome",
    "completedAt",
    "gpuRuns",
    "nodeVersion",
    "paidApiCalls",
    "physicalStops",
    "provider",
    "runtimeFingerprintSha256",
    "targetAutomationNavigations"
  ]) && validDate(preflight.completedAt) &&
    preflight.nodeVersion === EXP0024_REQUIRED_NODE_VERSION &&
    isDeepStrictEqual(preflight.chrome, EXP0024_REQUIRED_CHROME) &&
    preflight.runtimeFingerprintSha256 === expectedRuntimeFingerprintSha256 &&
    hexHash(preflight.runtimeFingerprintSha256) &&
    preflight.provider === "local" &&
    preflight.targetAutomationNavigations === 0 &&
    preflight.physicalStops === 0 &&
    preflight.paidApiCalls === 0 && preflight.gpuRuns === 0;
}

function attemptCampaign() {
  return {
    nonce: EXP0024_ATTEMPT_NONCE,
    command: EXP0024_OFFICIAL_COMMAND,
    targetUrl: EXP0024_CONFIG.targetUrl,
    navigations: EXP0024_CONFIG.navigations,
    stopsPerNavigation: EXP0024_CONFIG.stopsPerNavigation,
    totalStops: EXP0024_CONFIG.totalStops,
    provider: EXP0024_CONFIG.provider,
    attemptDeadlineMs: EXP0024_CONFIG.attemptDeadlineMs,
    configCanonicalSha256: `sha256:${canonicalSha256(EXP0024_CONFIG)}`,
    openingPath: EXP0024_OPENING_PATH,
    receiptPath: EXP0024_RECEIPT_PATH,
    journalPath: EXP0024_JOURNAL_PATH,
    reportPath: EXP0024_REPORT_PATH,
    lockPath: EXP0024_LOCK_PATH,
    rerunAllowed: false
  };
}

function openingBoundary() {
  return {
    physicalStopCampaignsBeforeOpening: 0,
    openingAbsentBeforeWrite: true,
    receiptAbsent: true,
    journalAbsent: true,
    reportAbsent: true,
    lockAbsent: true,
    rerunAllowed: false
  };
}

function attemptCore(input) {
  return {
    schemaVersion: EXP0024_OPENING_SCHEMA,
    experimentId: "EXP-0024",
    status: "opened-single-physical-stop-attempt",
    openingParentCommit: input.freezeCommit,
    openedAt: input.openedAt,
    freeze: structuredClone(input.freeze),
    preflight: openingPreflight(input.preflight),
    campaign: attemptCampaign(),
    gitTopology: structuredClone(EXP0024_GIT_TOPOLOGY),
    boundary: openingBoundary(),
    authority: {
      mode: "measurement-only",
      canProduceNewEffects: false
    }
  };
}

export function createExp0024PhysicalStopAttempt(input = {}) {
  const core = attemptCore(input);
  const attempt = deepFreeze({
    ...core,
    physicalStopAttemptSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0024PhysicalStopAttempt(attempt);
  if (!validation.valid) {
    throw new TypeError(
      `tentativa EXP-0024 inválida: ${validation.errors.join("; ")}`
    );
  }
  return attempt;
}

export function validateExp0024PhysicalStopAttempt(attempt) {
  const errors = [];
  try {
    if (!exactKeys(attempt, [
      "authority",
      "boundary",
      "campaign",
      "experimentId",
      "freeze",
      "gitTopology",
      "openedAt",
      "openingParentCommit",
      "physicalStopAttemptSha256",
      "preflight",
      "schemaVersion",
      "status"
    ]) || attempt?.schemaVersion !== EXP0024_OPENING_SCHEMA ||
      attempt?.experimentId !== "EXP-0024" ||
      attempt?.status !== "opened-single-physical-stop-attempt" ||
      !commit(attempt?.openingParentCommit) || !validDate(attempt?.openedAt)
    ) errors.push("identidade, estado, parent ou data da abertura divergiram");

    const core = structuredClone(attempt ?? {});
    delete core.physicalStopAttemptSha256;
    if (attempt?.physicalStopAttemptSha256 !==
      `sha256:${canonicalSha256(core)}`
    ) errors.push("physicalStopAttemptSha256 divergente");
    if (!exactKeys(attempt?.freeze, [
      "expectedRuntimeFingerprintSha256",
      "fileSha256",
      "freezeCommit",
      "instrumentationFreezeSha256",
      "nodeVersion",
      "path",
      "runnerSourceCommit"
    ]) || attempt?.freeze?.path !== EXP0024_FREEZE_PATH ||
      !hash(attempt?.freeze?.fileSha256) ||
      !hash(attempt?.freeze?.instrumentationFreezeSha256) ||
      !commit(attempt?.freeze?.freezeCommit) ||
      !commit(attempt?.freeze?.runnerSourceCommit) ||
      !hexHash(attempt?.freeze?.expectedRuntimeFingerprintSha256) ||
      attempt?.freeze?.nodeVersion !== EXP0024_REQUIRED_NODE_VERSION ||
      attempt?.freeze?.freezeCommit !== attempt?.openingParentCommit
    ) errors.push("binding do freeze na abertura divergiu");
    if (!preflightValid(
      attempt?.preflight,
      attempt?.freeze?.expectedRuntimeFingerprintSha256
    )) errors.push("preflight Node/Chrome/runtime/provider divergiu");
    if (!isDeepStrictEqual(attempt?.campaign, attemptCampaign())) {
      errors.push("campanha oficial da abertura divergiu");
    }
    if (!isDeepStrictEqual(attempt?.gitTopology, EXP0024_GIT_TOPOLOGY)) {
      errors.push("topologia da abertura divergiu");
    }
    if (!isDeepStrictEqual(attempt?.boundary, openingBoundary()) ||
      !isDeepStrictEqual(attempt?.authority, {
        mode: "measurement-only",
        canProduceNewEffects: false
      })
    ) errors.push("fronteira ou autoridade da abertura divergiu");
  } catch (error) {
    errors.push(`abertura malformada: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export const EXP0024_BOUNDARY_PATHS = deepFreeze({
  preregistration: EXP0024_PREREGISTRATION_PATH,
  exp0019Report: EXP0024_EXP0019_REPORT_PATH,
  exp0019Closeout: EXP0024_EXP0019_CLOSEOUT_PATH,
  exp0023Report: EXP0024_EXP0023_REPORT_PATH,
  exp0023Closeout: EXP0024_EXP0023_CLOSEOUT_PATH,
  freeze: EXP0024_FREEZE_PATH,
  opening: EXP0024_OPENING_PATH,
  receipt: EXP0024_RECEIPT_PATH,
  journal: EXP0024_JOURNAL_PATH,
  report: EXP0024_REPORT_PATH,
  lock: EXP0024_LOCK_PATH
});
