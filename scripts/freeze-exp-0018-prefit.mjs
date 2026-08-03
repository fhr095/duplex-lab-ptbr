import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
  auditExp0018Catalog,
  blindExp0018CatalogProjection,
  validateExp0018Dataset
} from "../src/eval/exp-0018-context.mjs";
import {
  EXP0018_CRITICAL_SOURCE_PATHS,
  EXP0018_PATHS,
  createExp0018PrefitFreeze,
  validateExp0018PrefitFreeze
} from "../src/eval/exp-0018-boundary.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  PROJECT_ROOT,
  assertCondition,
  hashProjectFile,
  readJsonRecord,
  writeJsonExclusive
} from "./lib/exp-0018-io.mjs";

const execFileAsync = promisify(execFile);

async function git(...args) {
  const result = await execFileAsync("git", args, { cwd: PROJECT_ROOT });
  return result.stdout.trim();
}

const status = await git("status", "--porcelain=v1", "--untracked-files=all");
assertCondition(status === "",
  "freeze exige worktree limpo e todo código já commitado");
const runnerSourceCommit = await git("rev-parse", "HEAD");

for (const path of EXP0018_CRITICAL_SOURCE_PATHS) {
  await git("ls-files", "--error-unmatch", path);
}

const records = Object.fromEntries(await Promise.all([
  ["config", EXP0018_PATHS.config],
  ["catalog", EXP0018_PATHS.catalog],
  ["fitDataset", EXP0018_PATHS.fitDataset],
  ["calibrationDataset", EXP0018_PATHS.calibrationDataset],
  ["developmentDataset", EXP0018_PATHS.developmentDataset],
  ["instrumentationAudit", EXP0018_PATHS.instrumentationAudit],
  ["blindSemanticReview", EXP0018_PATHS.blindSemanticReview]
].map(async ([name, path]) => [name, await readJsonRecord(path)])));

assertCondition(
  `sha256:${canonicalSha256(records.config.value)}` ===
    EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
  "config diverge do compromisso canônico prefit"
);
const catalogAudit = auditExp0018Catalog(records.catalog.value);
assertCondition(catalogAudit.valid,
  `catálogo inválido: ${catalogAudit.errors.join("; ")}`);
for (const role of ["fitDataset", "calibrationDataset", "developmentDataset"]) {
  const validation = validateExp0018Dataset(records[role].value, {
    experimentConfigFileSha256: records.config.fileSha256,
    catalog: records.catalog.value
  });
  assertCondition(validation.valid,
    `${role} inválido: ${validation.errors.join("; ")}`);
}

const audit = records.instrumentationAudit.value;
const expectedAuditGateKeys = [
  "authorityIsZero",
  "catalogValid",
  "contextOnlyCeilingExactlyHalf",
  "exactModelInputAllowlist",
  "exactRoleFloors",
  "metadataMarginalsExactlyHalf",
  "nearDuplicatesWithinOrAcrossRolesZero",
  "targetOnlyCeilingExactlyHalf"
];
assertCondition(
  audit?.schemaVersion === "exp-0018-instrumentation-audit-v1" &&
  audit?.experimentId === "EXP-0018" &&
  audit?.status === "prefit-instrumentation-only" &&
  audit?.instrumentationAuditSha256 === `sha256:${canonicalSha256((() => {
    const core = structuredClone(audit);
    delete core.instrumentationAuditSha256;
    return core;
  })())}` &&
  JSON.stringify(Object.keys(audit?.gates ?? {}).sort()) ===
    JSON.stringify(expectedAuditGateKeys) &&
  Object.values(audit.gates).every((value) => value === true) &&
  audit?.inputs?.config?.path === records.config.path &&
  audit?.inputs?.config?.fileSha256 === records.config.fileSha256 &&
  audit?.inputs?.catalog?.path === records.catalog.path &&
  audit?.inputs?.catalog?.fileSha256 === records.catalog.fileSha256 &&
  audit?.inputs?.catalog?.canonicalSha256 ===
    `sha256:${canonicalSha256(records.catalog.value)}` &&
  ["fit", "calibration", "development"].every((role) => {
    const recordName = `${role}Dataset`;
    return audit?.datasets?.[role]?.path === records[recordName].path &&
      audit.datasets[role].fileSha256 === records[recordName].fileSha256 &&
      audit.datasets[role].canonicalSha256 ===
        records[recordName].value.datasetSha256;
  }) &&
  audit?.boundary?.modelFitPerformed === false &&
  audit?.boundary?.developmentCandidateMetricsRead === false &&
  audit?.boundary?.fitAuthorized === false,
  "auditoria de instrumentação não autoriza freeze"
);
const review = records.blindSemanticReview.value;
assertCondition(
  review?.schemaVersion === "exp-0018-blind-semantic-review-v1" &&
  review?.experimentId === "EXP-0018" &&
  review?.reviewSha256 === `sha256:${canonicalSha256((() => {
    const core = structuredClone(review);
    delete core.reviewSha256;
    return core;
  })())}` &&
  review?.status === "passed-for-prefit-freeze" &&
  review?.catalog?.path === records.catalog.path &&
  review?.catalog?.fileSha256 === records.catalog.fileSha256 &&
  review?.catalog?.canonicalSha256 ===
    `sha256:${canonicalSha256(records.catalog.value)}` &&
  review?.blindProjection?.canonicalSha256 ===
    `sha256:${canonicalSha256(
      blindExp0018CatalogProjection(records.catalog.value)
    )}` &&
  review?.blindProjection?.schemaVersion ===
    "exp-0018-blind-semantic-projection-v1" &&
  JSON.stringify(review?.blindProjection?.includedFields) === JSON.stringify([
    "crossBlockRootId", "role", "family", "targets", "contexts"
  ]) &&
  JSON.stringify(review?.blindProjection?.excludedFields) === JSON.stringify([
    "oracle", "labels", "model predictions", "candidate metrics"
  ]) &&
  review?.blindProjection?.persisted === false &&
  review?.chronology?.finalCatalog?.criticB?.blocksReviewed === 24 &&
  review?.chronology?.finalCatalog?.criticB?.passed === 24 &&
  review?.chronology?.finalCatalog?.criticB?.blockers === 0 &&
  review?.chronology?.finalCatalog?.criticA?.relevantBlocksReviewed === 13 &&
  review?.chronology?.finalCatalog?.criticA?.passed === 13 &&
  review?.chronology?.finalCatalog?.criticA?.bothAntecedentsPlausible === 0 &&
  review?.chronology?.finalCatalog?.criticA?.neitherAntecedentPlausible === 0 &&
  review?.chronology?.finalCatalog?.criticA?.blockers === 0 &&
  review?.chronology?.finalCatalog?.decision ===
    "semantic-construct-sufficient-for-prefit-freeze" &&
  review?.reviewers?.count === 2 &&
  review?.reviewers?.humanReviewers === 0 &&
  review?.boundary?.modelFitPerformed === false &&
  review?.boundary?.developmentCandidateMetricsRead === false &&
  review?.boundary?.fitAuthorized === false,
  "revisão semântica cega não autoriza freeze"
);

const artifacts = {
  config: {
    path: records.config.path,
    fileSha256: records.config.fileSha256,
    canonicalSha256: `sha256:${canonicalSha256(records.config.value)}`
  },
  catalog: {
    path: records.catalog.path,
    fileSha256: records.catalog.fileSha256,
    canonicalSha256: `sha256:${canonicalSha256(records.catalog.value)}`
  },
  fitDataset: {
    path: records.fitDataset.path,
    fileSha256: records.fitDataset.fileSha256,
    canonicalSha256: records.fitDataset.value.datasetSha256,
    readSetSha256: `sha256:${canonicalSha256({
      orderedExampleIds: records.fitDataset.value.examples.map(
        (item) => item.exampleId
      ),
      orderedExampleCanonicalSha256:
        records.fitDataset.value.examples.map(
          (item) => `sha256:${canonicalSha256(item)}`
        )
    })}`
  },
  calibrationDataset: {
    path: records.calibrationDataset.path,
    fileSha256: records.calibrationDataset.fileSha256,
    canonicalSha256: records.calibrationDataset.value.datasetSha256
  },
  developmentDataset: {
    path: records.developmentDataset.path,
    fileSha256: records.developmentDataset.fileSha256,
    canonicalSha256: records.developmentDataset.value.datasetSha256
  },
  instrumentationAudit: {
    path: records.instrumentationAudit.path,
    fileSha256: records.instrumentationAudit.fileSha256,
    canonicalSha256: audit.instrumentationAuditSha256
  },
  blindSemanticReview: {
    path: records.blindSemanticReview.path,
    fileSha256: records.blindSemanticReview.fileSha256,
    canonicalSha256: review.reviewSha256
  }
};
const criticalSources = await Promise.all(
  EXP0018_CRITICAL_SOURCE_PATHS.map(async (path) => ({
    path,
    fileSha256: await hashProjectFile(path)
  }))
);
const freeze = createExp0018PrefitFreeze({
  runnerSourceCommit,
  nodeVersion: process.version,
  artifacts,
  criticalSources
});
const validation = validateExp0018PrefitFreeze(freeze);
assertCondition(validation.valid,
  `freeze inválido: ${validation.errors.join("; ")}`);
await writeJsonExclusive(EXP0018_PATHS.prefitFreeze, freeze);
console.log(`EXP-0018 prefit congelado: ${freeze.prefitFreezeSha256}`);
console.log("Fit autorizado; development continua fisicamente selado.");
