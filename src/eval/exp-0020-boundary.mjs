import { isDeepStrictEqual } from "node:util";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import {
  EXP0020_ATTEMPT_PATH,
  EXP0020_CONFIG,
  EXP0020_EXP0019_EVIDENCE_COMMIT,
  EXP0020_FREEZE_PATH,
  EXP0020_PREREGISTRATION_PATH,
  EXP0020_RECEIPT_PATH,
  EXP0020_REPORT_PATH
} from "./exp-0020-stop-order.mjs";

export const EXP0020_FREEZE_SCHEMA =
  "exp-0020-instrumentation-freeze-v1";
export const EXP0020_ATTEMPT_SCHEMA =
  "exp-0020-browser-attempt-v1";
export const EXP0020_ATTEMPT_NONCE = "exp-0020-official-v0.1";
export const EXP0020_BROWSER_COMMAND =
  "node scripts/smoke-exp-0020-browser.mjs";
export const EXP0020_EXP0019_REPORT_PATH =
  "eval/reports/exp-0019-causal-audio-v0.1.json";

export const EXP0020_PRODUCTION_SOURCE_PATHS = Object.freeze([
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

export const EXP0020_INSTRUMENTATION_SOURCE_PATHS = Object.freeze([
  ".gitignore",
  "package.json",
  "scripts/freeze-exp-0020-instrumentation.mjs",
  "scripts/lib/exp-0020-browser-harness.mjs",
  "scripts/open-exp-0020-browser-attempt.mjs",
  "scripts/smoke-exp-0020-browser.mjs",
  "src/eval/exp-0020-boundary.mjs",
  "src/eval/exp-0020-stop-order.mjs",
  "tests/exp-0020-analysis.test.mjs",
  "tests/exp-0020-boundary.test.mjs",
  "tests/exp-0020-browser-harness.test.mjs",
  "tests/exp-0020-browser-runner.test.mjs"
].toSorted());

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

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

function sourceListValid(records, paths, production = false) {
  return Array.isArray(records) &&
    isDeepStrictEqual(records.map((record) => record?.path), paths) &&
    records.every((record) => {
      const keys = production
        ? ["exp0019FileSha256", "fileSha256", "path"]
        : ["fileSha256", "path"];
      return exactKeys(record, keys) && hash(record.fileSha256) &&
        (!production ||
          hash(record.exp0019FileSha256) &&
          record.fileSha256 === record.exp0019FileSha256);
    });
}

function freezeCore(input) {
  return {
    schemaVersion: EXP0020_FREEZE_SCHEMA,
    experimentId: "EXP-0020",
    status: "frozen-before-browser-opening",
    runnerSourceCommit: input.runnerSourceCommit,
    nodeVersion: input.nodeVersion,
    sourceBaseline: {
      experimentId: "EXP-0019",
      evidenceCommit: EXP0020_EXP0019_EVIDENCE_COMMIT
    },
    artifacts: structuredClone(input.artifacts),
    config: structuredClone(EXP0020_CONFIG),
    configCanonicalSha256: `sha256:${canonicalSha256(EXP0020_CONFIG)}`,
    productionSources: structuredClone(input.productionSources),
    instrumentationSources: structuredClone(input.instrumentationSources),
    boundary: {
      browserAttemptsBeforeFreeze: 0,
      browserCampaignsBeforeFreeze: 0,
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

export function createExp0020InstrumentationFreeze(input) {
  const core = freezeCore(input);
  const freeze = deepFreeze({
    ...core,
    instrumentationFreezeSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0020InstrumentationFreeze(freeze);
  if (!validation.valid) {
    throw new TypeError(
      `freeze EXP-0020 inválido: ${validation.errors.join("; ")}`
    );
  }
  return freeze;
}

export function validateExp0020InstrumentationFreeze(freeze) {
  const errors = [];
  try {
    if (!exactKeys(freeze, [
      "artifacts",
      "authority",
      "boundary",
      "config",
      "configCanonicalSha256",
      "experimentId",
      "instrumentationFreezeSha256",
      "instrumentationSources",
      "nodeVersion",
      "productionSources",
      "runnerSourceCommit",
      "schemaVersion",
      "sourceBaseline",
      "status"
    ]) ||
      freeze?.schemaVersion !== EXP0020_FREEZE_SCHEMA ||
      freeze?.experimentId !== "EXP-0020" ||
      freeze?.status !== "frozen-before-browser-opening" ||
      !COMMIT_PATTERN.test(freeze?.runnerSourceCommit ?? "") ||
      typeof freeze?.nodeVersion !== "string" ||
      freeze.nodeVersion.length === 0
    ) errors.push("identidade, estado ou commit do freeze incompatível");

    const core = structuredClone(freeze ?? {});
    delete core.instrumentationFreezeSha256;
    if (
      freeze?.instrumentationFreezeSha256 !==
        `sha256:${canonicalSha256(core)}`
    ) errors.push("instrumentationFreezeSha256 divergente");

    if (
      !isDeepStrictEqual(freeze?.config, EXP0020_CONFIG) ||
      freeze?.configCanonicalSha256 !==
        `sha256:${canonicalSha256(EXP0020_CONFIG)}`
    ) errors.push("configuração congelada divergiu");

    if (
      !exactKeys(freeze?.sourceBaseline, ["evidenceCommit", "experimentId"]) ||
      freeze?.sourceBaseline?.experimentId !== "EXP-0019" ||
      freeze?.sourceBaseline?.evidenceCommit !==
        EXP0020_EXP0019_EVIDENCE_COMMIT
    ) errors.push("baseline de fontes EXP-0019 divergiu");

    if (!exactKeys(freeze?.artifacts, ["exp0019Report", "preregistration"]) ||
      !exactKeys(freeze?.artifacts?.preregistration, ["fileSha256", "path"]) ||
      freeze?.artifacts?.preregistration?.path !==
        EXP0020_PREREGISTRATION_PATH ||
      !hash(freeze?.artifacts?.preregistration?.fileSha256) ||
      !exactKeys(freeze?.artifacts?.exp0019Report, ["fileSha256", "path"]) ||
      freeze?.artifacts?.exp0019Report?.path !==
        EXP0020_EXP0019_REPORT_PATH ||
      !hash(freeze?.artifacts?.exp0019Report?.fileSha256)
    ) errors.push("artefatos congelados incompatíveis");

    if (!sourceListValid(
      freeze?.productionSources,
      EXP0020_PRODUCTION_SOURCE_PATHS,
      true
    )) errors.push("fontes de produção divergiram do EXP-0019");
    if (!sourceListValid(
      freeze?.instrumentationSources,
      EXP0020_INSTRUMENTATION_SOURCE_PATHS,
      false
    )) errors.push("fontes de instrumentação não correspondem ao allowlist");

    if (!isDeepStrictEqual(freeze?.boundary, {
      browserAttemptsBeforeFreeze: 0,
      browserCampaignsBeforeFreeze: 0,
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

function attemptCore(input) {
  return {
    schemaVersion: EXP0020_ATTEMPT_SCHEMA,
    experimentId: "EXP-0020",
    status: "opened-single-browser-attempt",
    openingSourceCommit: input.openingSourceCommit,
    openedAt: input.openedAt,
    freeze: structuredClone(input.freeze),
    campaign: {
      nonce: EXP0020_ATTEMPT_NONCE,
      command: EXP0020_BROWSER_COMMAND,
      targetUrl: EXP0020_CONFIG.targetUrl,
      navigations: EXP0020_CONFIG.navigations,
      stopsPerNavigation: EXP0020_CONFIG.stopsPerNavigation,
      totalStops: EXP0020_CONFIG.totalStops,
      reportPath: EXP0020_REPORT_PATH,
      receiptPath: EXP0020_RECEIPT_PATH
    },
    boundary: {
      browserCampaignsBeforeOpening: 0,
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

export function createExp0020BrowserAttempt(input) {
  const core = attemptCore(input);
  const attempt = deepFreeze({
    ...core,
    browserAttemptSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0020BrowserAttempt(attempt);
  if (!validation.valid) {
    throw new TypeError(
      `tentativa EXP-0020 inválida: ${validation.errors.join("; ")}`
    );
  }
  return attempt;
}

export function validateExp0020BrowserAttempt(attempt) {
  const errors = [];
  try {
    if (!exactKeys(attempt, [
      "authority",
      "boundary",
      "browserAttemptSha256",
      "campaign",
      "experimentId",
      "freeze",
      "openedAt",
      "openingSourceCommit",
      "schemaVersion",
      "status"
    ]) ||
      attempt?.schemaVersion !== EXP0020_ATTEMPT_SCHEMA ||
      attempt?.experimentId !== "EXP-0020" ||
      attempt?.status !== "opened-single-browser-attempt" ||
      !COMMIT_PATTERN.test(attempt?.openingSourceCommit ?? "") ||
      !Number.isFinite(Date.parse(attempt?.openedAt ?? ""))
    ) errors.push("identidade, estado, data ou commit da tentativa inválido");

    const core = structuredClone(attempt ?? {});
    delete core.browserAttemptSha256;
    if (
      attempt?.browserAttemptSha256 !==
        `sha256:${canonicalSha256(core)}`
    ) errors.push("browserAttemptSha256 divergente");

    if (!exactKeys(attempt?.freeze, [
      "fileSha256",
      "instrumentationFreezeSha256",
      "path",
      "runnerSourceCommit"
    ]) ||
      attempt?.freeze?.path !== EXP0020_FREEZE_PATH ||
      !hash(attempt?.freeze?.fileSha256) ||
      !hash(attempt?.freeze?.instrumentationFreezeSha256) ||
      !COMMIT_PATTERN.test(attempt?.freeze?.runnerSourceCommit ?? "")
    ) errors.push("binding do freeze na tentativa inválido");

    if (!isDeepStrictEqual(attempt?.campaign, {
      nonce: EXP0020_ATTEMPT_NONCE,
      command: EXP0020_BROWSER_COMMAND,
      targetUrl: EXP0020_CONFIG.targetUrl,
      navigations: EXP0020_CONFIG.navigations,
      stopsPerNavigation: EXP0020_CONFIG.stopsPerNavigation,
      totalStops: EXP0020_CONFIG.totalStops,
      reportPath: EXP0020_REPORT_PATH,
      receiptPath: EXP0020_RECEIPT_PATH
    })) errors.push("campanha aberta divergiu do contrato");

    if (!isDeepStrictEqual(attempt?.boundary, {
      browserCampaignsBeforeOpening: 0,
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

export const EXP0020_BOUNDARY_PATHS = deepFreeze({
  preregistration: EXP0020_PREREGISTRATION_PATH,
  exp0019Report: EXP0020_EXP0019_REPORT_PATH,
  freeze: EXP0020_FREEZE_PATH,
  attempt: EXP0020_ATTEMPT_PATH,
  receipt: EXP0020_RECEIPT_PATH,
  report: EXP0020_REPORT_PATH
});
