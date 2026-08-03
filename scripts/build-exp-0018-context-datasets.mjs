import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXP0018_FEATURE_NAMES,
  EXP0018_FEATURE_VERSION,
  EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
  EXP0018_ROLE_CONTRACT,
  buildExp0018Datasets,
  validateExp0018Dataset
} from "../src/eval/exp-0018-context.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  config: "eval/experiments/exp-0018-context-observability-v0.1.json",
  catalog: "eval/experiments/exp-0018-context-pairs.pt-BR.v0.1.json",
  fit: "eval/datasets/exp-0018-context-fit-v0.1.json",
  calibration: "eval/datasets/exp-0018-context-calibration-v0.1.json",
  development: "eval/datasets/exp-0018-context-development-v0.1.json",
  audit: "eval/commitments/exp-0018-instrumentation-audit-v0.1.json"
});

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (![
      "--config", "--catalog", "--fit", "--calibration",
      "--development", "--audit"
    ].includes(argument)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const value = args[index + 1];
    if (!value) {
      throw new TypeError(`${argument} exige caminho`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeOrCheck(path, bytes, check) {
  if (check) {
    const existing = await readFile(path).catch(() => null);
    if (!existing || !existing.equals(bytes)) {
      throw new Error(`artefato ausente ou divergente: ${path}`);
    }
    return;
  }
  await writeFile(path, bytes);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateExp0018InstrumentationConfig(
  config,
  options = DEFAULTS
) {
  const errors = [];
  if (
    `sha256:${canonicalSha256(config)}` !==
      EXP0018_PREFIT_CONFIG_CANONICAL_SHA256
  ) {
    errors.push("configuração inteira diverge do compromisso prefit no código");
  }
  if (
    config?.schemaVersion !==
      "exp-0018-context-observability-config-v1" ||
    config?.experimentId !== "EXP-0018" ||
    config?.status !== "instrumentation-only-prefit-audit-required" ||
    config?.executionAllowed !== false
  ) {
    errors.push("identidade ou fronteira prefit da configuração inválida");
  }
  if (
    config?.features?.version !== EXP0018_FEATURE_VERSION ||
    !same(config?.features?.names, EXP0018_FEATURE_NAMES)
  ) {
    errors.push("configuração diverge do contrato de features");
  }
  for (const [role, expected] of Object.entries(EXP0018_ROLE_CONTRACT)) {
    if (!same(config?.matrix?.[role], expected)) {
      errors.push(`matriz ${role} diverge do contrato congelado`);
    }
  }
  const expectedPaths = {
    catalog: options.catalog,
    fitDataset: options.fit,
    calibrationDataset: options.calibration,
    developmentDataset: options.development,
    instrumentationAudit: options.audit
  };
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (config?.paths?.[key] !== expected) {
      errors.push(`path ${key} diverge da configuração`);
    }
  }
  if (
    config?.budget?.experimentRuntimeExternalModelCalls !== 0 ||
    config?.budget?.experimentRuntimePaidApiCalls !== 0 ||
    config?.budget?.paidGpuRuns !== 0 ||
    config?.budget?.developmentStructuralAuditRuns !== 1 ||
    config?.budget?.developmentCandidateMetricRuns !== 0 ||
    config?.authority?.canProduceEffects !== false
  ) {
    errors.push("orçamento ou autoridade prefit inválidos");
  }
  if (errors.length > 0) {
    throw new TypeError(`configuração EXP-0018 inválida: ${errors.join("; ")}`);
  }
}

function empiricalCeiling(examples, projection) {
  const groups = Map.groupBy(examples, projection);
  let bestCorrect = 0;
  for (const descendants of groups.values()) {
    const counts = Object.fromEntries([
      "BACKGROUND_OR_NOT_DIRECTED",
      "DIRECTED_TO_ASSISTANT"
    ].map((label) => [
      label,
      descendants.filter((item) => item.label === label).length
    ]));
    bestCorrect += Math.max(...Object.values(counts));
  }
  return {
    groups: groups.size,
    examples: examples.length,
    bestCorrect,
    ceiling: examples.length === 0 ? null : bestCorrect / examples.length,
    everyGroupContainsOppositeLabels: [...groups.values()].every(
      (items) => new Set(items.map((item) => item.label)).size === 2
    )
  };
}

function controlsFor(dataset) {
  return {
    targetOnly: empiricalCeiling(
      dataset.examples,
      (item) => item.targetSurfaceId
    ),
    contextOnly: empiricalCeiling(
      dataset.examples,
      (item) => item.contextSurfaceId
    ),
    pairRootMetadataOnly: empiricalCeiling(
      dataset.examples,
      (item) => item.pairRootId
    ),
    crossBlockMetadataOnly: empiricalCeiling(
      dataset.examples,
      (item) => item.crossBlockRootId
    ),
    familyMetadataOnly: empiricalCeiling(
      dataset.examples,
      (item) => item.family
    )
  };
}

export async function buildExp0018ContextDatasets(options = {}) {
  const paths = Object.fromEntries(Object.entries({ ...DEFAULTS, ...options })
    .filter(([key]) => key !== "check")
    .map(([key, value]) => [key, resolve(PROJECT_ROOT, value)]));
  const [configBytes, catalogBytes] = await Promise.all([
    readFile(paths.config),
    readFile(paths.catalog)
  ]);
  const config = JSON.parse(configBytes.toString("utf8"));
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  validateExp0018InstrumentationConfig(
    config,
    { ...DEFAULTS, ...options }
  );
  const built = buildExp0018Datasets(catalog, {
    experimentConfigFileSha256: sha256(configBytes)
  });
  const datasetPaths = {
    fit: paths.fit,
    calibration: paths.calibration,
    development: paths.development
  };
  const datasetBytes = {};
  const datasetRecords = {};
  for (const [role, dataset] of Object.entries(built.datasets)) {
    const validation = validateExp0018Dataset(dataset, {
      catalog,
      experimentConfigFileSha256: sha256(configBytes)
    });
    if (!validation.valid) {
      throw new Error(
        `${role} inválido: ${validation.errors.join("; ")}`
      );
    }
    datasetBytes[role] = jsonBytes(dataset);
    datasetRecords[role] = {
      path: { fit: DEFAULTS.fit, calibration: DEFAULTS.calibration,
        development: DEFAULTS.development }[role],
      fileSha256: sha256(datasetBytes[role]),
      canonicalSha256: dataset.datasetSha256,
      crossBlocks: dataset.summary.crossBlocks,
      pairRoots: dataset.summary.pairRoots,
      examples: dataset.summary.examples,
      labels: dataset.summary.labels,
      controls: controlsFor(dataset)
    };
  }
  const auditCore = {
    schemaVersion: "exp-0018-instrumentation-audit-v1",
    experimentId: "EXP-0018",
    status: "prefit-instrumentation-only",
    inputs: {
      config: {
        path: DEFAULTS.config,
        fileSha256: sha256(configBytes)
      },
      catalog: {
        path: DEFAULTS.catalog,
        fileSha256: sha256(catalogBytes),
        canonicalSha256: built.catalogSha256
      }
    },
    catalogAudit: built.audit,
    datasets: datasetRecords,
    gates: {
      catalogValid: built.audit.valid,
      exactRoleFloors: Object.entries(datasetRecords).every(
        ([role, record]) => same(
          {
            crossBlocks: record.crossBlocks,
            pairRoots: record.pairRoots,
            examples: record.examples
          },
          EXP0018_ROLE_CONTRACT[role]
        )
      ),
      targetOnlyCeilingExactlyHalf: Object.values(datasetRecords).every(
        (record) => record.controls.targetOnly.ceiling === 0.5 &&
          record.controls.targetOnly.everyGroupContainsOppositeLabels
      ),
      contextOnlyCeilingExactlyHalf: Object.values(datasetRecords).every(
        (record) => record.controls.contextOnly.ceiling === 0.5 &&
          record.controls.contextOnly.everyGroupContainsOppositeLabels
      ),
      metadataMarginalsExactlyHalf: Object.values(datasetRecords).every(
        (record) => [
          record.controls.pairRootMetadataOnly,
          record.controls.crossBlockMetadataOnly,
          record.controls.familyMetadataOnly
        ].every((control) => control.ceiling === 0.5 &&
          control.everyGroupContainsOppositeLabels)
      ),
      nearDuplicatesWithinOrAcrossRolesZero:
        built.audit.nearDuplicates.length === 0,
      exactModelInputAllowlist:
        built.audit.leakageChecks.modelInputAllowlistExact,
      authorityIsZero: config.authority.canProduceEffects === false
    },
    boundary: {
      modelFitPerformed: false,
      thresholdSelected: false,
      developmentStructuralAuditPerformed: true,
      developmentCandidatePredictionsRead: false,
      developmentCandidateMetricsRead: false,
      fitAuthorized: false,
      canProduceEffects: false
    },
    budget: {
      experimentRuntimeExternalModelCalls: 0,
      experimentRuntimePaidApiCalls: 0,
      paidGpuRuns: 0,
      asrRuns: 0,
      audioMaterializations: 0,
      developmentStructuralAuditRuns: 1,
      developmentCandidateMetricRuns: 0
    }
  };
  const audit = {
    ...auditCore,
    instrumentationAuditSha256:
      `sha256:${canonicalSha256(auditCore)}`
  };
  if (!Object.values(audit.gates).every(Boolean)) {
    throw new Error("auditoria prefit EXP-0018 não passou todos os gates");
  }
  return {
    datasets: built.datasets,
    audit,
    bytes: {
      ...datasetBytes,
      audit: jsonBytes(audit)
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildExp0018ContextDatasets(options);
  await Promise.all([
    writeOrCheck(resolve(PROJECT_ROOT, options.fit), result.bytes.fit,
      options.check),
    writeOrCheck(resolve(PROJECT_ROOT, options.calibration),
      result.bytes.calibration, options.check),
    writeOrCheck(resolve(PROJECT_ROOT, options.development),
      result.bytes.development, options.check),
    writeOrCheck(resolve(PROJECT_ROOT, options.audit), result.bytes.audit,
      options.check)
  ]);
  console.log(
    `EXP-0018 instrumentação ${options.check ? "CHECK" : "BUILD"} PASS: ` +
      `${result.audit.catalogAudit.counts.crossBlocks} blocos, ` +
      `${result.audit.catalogAudit.counts.pairRoots} pares, ` +
      `${result.audit.catalogAudit.counts.examples} casos, ` +
      `zero fit/avaliação de candidato em development`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
