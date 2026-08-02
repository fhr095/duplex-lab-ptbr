import {
  SPEAKER_RELEVANCE_CLASSES,
  SPEAKER_RELEVANCE_FEATURES,
  SPEAKER_RELEVANCE_FEATURE_VERSION
} from "./speaker-relevance-features.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0017_MANIFEST_SCHEMA =
  "exp-0017-development-manifest-v1";
export const EXP0017_DEVELOPMENT_DATASET_SCHEMA =
  "exp-0017-development-dataset-v1";
export const EXP0017_DEVELOPMENT_REPORT_SCHEMA =
  "exp-0017-development-report-v1";
export const EXP0017_CLASSES = SPEAKER_RELEVANCE_CLASSES;

const SPLITS = Object.freeze(["train", "development"]);
const DEVELOPMENT_SPLITS = Object.freeze(["train", "development"]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function withoutField(value, field) {
  const core = structuredClone(value ?? {});
  delete core[field];
  return core;
}

function finalize(value, field) {
  const core = withoutField(value, field);
  return Object.freeze({
    ...core,
    [field]: `sha256:${canonicalSha256(core)}`
  });
}

function validateCanonicalHash(value, field, errors) {
  const observed = `sha256:${canonicalSha256(withoutField(value, field))}`;
  if (value?.[field] !== observed) {
    errors.push(`${field} divergente`);
  }
  return observed;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validHash(value) {
  return HASH_PATTERN.test(value ?? "");
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueOwner(items, field, errors) {
  const owners = new Map();
  for (const item of items) {
    const value = item?.[field];
    if (!nonEmptyString(value)) {
      errors.push(`${item?.artifactId ?? "item"}: ${field} inválido`);
      continue;
    }
    const owner = owners.get(value);
    if (owner !== undefined && owner !== item.partition) {
      errors.push(`${field} aparece em múltiplos splits: ${value}`);
    }
    owners.set(value, item.partition);
  }
  return owners;
}

function duplicateValues(items, field, errors) {
  const observed = new Set();
  for (const item of items) {
    const value = item?.[field];
    if (!nonEmptyString(value)) {
      errors.push(`${item?.artifactId ?? "item"}: ${field} inválido`);
    } else if (observed.has(value)) {
      errors.push(`${field} duplicado: ${value}`);
    }
    observed.add(value);
  }
}

export function finalizeExp0017Manifest(manifestCore) {
  return finalize(manifestCore, "manifestSha256");
}

export function validateExp0017Manifest(manifest) {
  const errors = [];
  const observedHash = validateCanonicalHash(
    manifest,
    "manifestSha256",
    errors
  );
  if (manifest?.schemaVersion !== EXP0017_MANIFEST_SCHEMA) {
    errors.push("schemaVersion de manifest incompatível");
  }
  if (
    !nonEmptyString(manifest?.experimentId) ||
    manifest?.locale !== "pt-BR" ||
    manifest?.retention?.rawAudioInGit !== false
  ) {
    errors.push("identidade, locale ou retenção do manifest inválida");
  }
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  const sourceIds = new Set();
  for (const source of sources) {
    if (
      !nonEmptyString(source?.sourceId) ||
      !nonEmptyString(source?.revision) ||
      !nonEmptyString(source?.license) ||
      sourceIds.has(source?.sourceId)
    ) {
      errors.push("fonte ausente, duplicada ou sem revisão/licença");
    }
    sourceIds.add(source?.sourceId);
  }
  if (sources.length === 0) {
    errors.push("manifest precisa declarar fontes");
  }
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  if (items.length === 0) {
    errors.push("manifest precisa conter items");
  }
  duplicateValues(items, "artifactId", errors);
  duplicateValues(items, "sourceArtifactId", errors);
  duplicateValues(items, "waveSha256", errors);
  duplicateValues(items, "pcmSha256", errors);
  const ownerFields = [
    "lineageRootId",
    "speakerGroupId",
    "semanticGroupId",
    "templateGroupId",
    "recipeFamilyId"
  ];
  const ownerMaps = Object.fromEntries(ownerFields.map((field) => [
    field,
    uniqueOwner(items, field, errors)
  ]));
  const primaryLineages = new Map(items.map((item) => [
    item.lineageRootId,
    item.partition
  ]));
  for (const item of items) {
    if (
      !SPLITS.includes(item?.partition) ||
      !sourceIds.has(item?.sourceId) ||
      !SPEAKER_RELEVANCE_CLASSES.includes(item?.label) ||
      !validHash(item?.waveSha256) ||
      !validHash(item?.pcmSha256)
    ) {
      errors.push(`${item?.artifactId ?? "item"}: contrato principal inválido`);
    }
    if (item?.fitEligibility !== "fit-eligible") {
      errors.push(`${item?.artifactId ?? "item"}: fitEligibility inválido`);
    }
    const secondary = item?.secondaryLineageRootIds;
    if (
      !Array.isArray(secondary) ||
      secondary.some((lineage) => !nonEmptyString(lineage)) ||
      new Set(secondary).size !== secondary.length
    ) {
      errors.push(
        `${item?.artifactId ?? "item"}: secondaryLineageRootIds inválido`
      );
      continue;
    }
    for (const lineage of secondary) {
      const primaryOwner = primaryLineages.get(lineage);
      if (primaryOwner === undefined) {
        errors.push(`secondaryLineageRootIds sem ancestral: ${lineage}`);
      } else if (primaryOwner !== item.partition) {
        errors.push(
          `linhagem secundária aparece em múltiplos splits: ${lineage}`
        );
      }
    }
  }
  for (const split of SPLITS) {
    const splitItems = items.filter((item) => item.partition === split);
    if (splitItems.length === 0) {
      errors.push(`split ausente: ${split}`);
      continue;
    }
    for (const label of SPEAKER_RELEVANCE_CLASSES) {
      if (!splitItems.some((item) => item.label === label)) {
        errors.push(`${split} não contém ${label}`);
      }
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    observedHash,
    owners: Object.freeze(Object.fromEntries(
      Object.entries(ownerMaps).map(([field, owners]) => [
        field,
        Object.freeze(Object.fromEntries(owners))
      ])
    ))
  });
}

function validateFeatureHeader(value, errors) {
  if (
    value?.featureVersion !== SPEAKER_RELEVANCE_FEATURE_VERSION ||
    !sameArray(value?.featureNames, SPEAKER_RELEVANCE_FEATURES) ||
    !sameArray(value?.classes, SPEAKER_RELEVANCE_CLASSES) ||
    !Number.isSafeInteger(value?.decisionSamples) ||
    value.decisionSamples < 1
  ) {
    errors.push("contrato de features/classes/janela incompatível");
  }
}

function validateFeatureExample(example, input, errors) {
  const { allowedSplits, expectedEligibility, manifestItems } = input;
  if (!allowedSplits.includes(example?.split)) {
    errors.push(
      `${example?.exampleId ?? "exemplo"}: split ${example?.split ?? "ausente"} ` +
      `viola fronteira ${allowedSplits.join("/")}`
    );
  }
  if (
    !nonEmptyString(example?.exampleId) ||
    !nonEmptyString(example?.artifactId) ||
    !allowedSplits.includes(example?.split) ||
    !SPEAKER_RELEVANCE_CLASSES.includes(example?.label) ||
    !Array.isArray(example?.features) ||
    example.features.length !== SPEAKER_RELEVANCE_FEATURES.length ||
    example.features.some((value) => !Number.isFinite(value)) ||
    !nonEmptyString(example?.labelSource?.kind) ||
    !nonEmptyString(example?.labelSource?.ref) ||
    example?.fitEligibility !== expectedEligibility(example?.split)
  ) {
    errors.push(`${example?.exampleId ?? "exemplo"}: contrato inválido`);
  }
  const window = example?.causalWindow;
  if (
    !Number.isSafeInteger(window?.onsetSample) ||
    window.onsetSample < 0 ||
    !Number.isSafeInteger(window?.decisionSample) ||
    window.decisionSample - window.onsetSample !== input.decisionSamples ||
    window?.sampleRate !== 16_000 ||
    window?.futureSamplesUsed !== 0
  ) {
    errors.push(`${example?.exampleId ?? "exemplo"}: janela causal inválida`);
  }
  const groupFields = [
    "lineageRootId",
    "speakerGroupId",
    "semanticGroupId",
    "templateGroupId",
    "recipeFamilyId"
  ];
  for (const field of groupFields) {
    if (!nonEmptyString(example?.[field])) {
      errors.push(`${example?.exampleId ?? "exemplo"}: ${field} inválido`);
    }
  }
  if (!Array.isArray(example?.secondaryLineageRootIds)) {
    errors.push(
      `${example?.exampleId ?? "exemplo"}: secondaryLineageRootIds inválido`
    );
  }
  if (manifestItems) {
    const manifestItem = manifestItems.get(example?.artifactId);
    if (!manifestItem) {
      errors.push(`${example?.exampleId ?? "exemplo"}: ausente no manifest`);
    } else {
      const fields = [
        "partition",
        "lineageRootId",
        "speakerGroupId",
        "semanticGroupId",
        "templateGroupId",
        "recipeFamilyId",
        "label"
      ];
      const exampleValues = {
        ...example,
        partition: example.split
      };
      if (
        fields.some((field) =>
          manifestItem[field] !== exampleValues[field]
        ) ||
        !sameArray(
          manifestItem.secondaryLineageRootIds,
          example.secondaryLineageRootIds
        )
      ) {
        errors.push(
          `${example.exampleId}: metadata/lineageRootId diverge do manifest`
        );
      }
    }
  }
}

function expectedSplitSummary(examples) {
  return {
    examples: examples.length,
    labels: Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map((label) => [
      label,
      examples.filter((example) => example.label === label).length
    ]))
  };
}

export function finalizeExp0017DevelopmentDataset(datasetCore) {
  return finalize(datasetCore, "datasetSha256");
}

export function validateExp0017DevelopmentDataset(dataset, expected = {}) {
  const errors = [];
  const observedHash = validateCanonicalHash(
    dataset,
    "datasetSha256",
    errors
  );
  if (dataset?.schemaVersion !== EXP0017_DEVELOPMENT_DATASET_SCHEMA) {
    errors.push("schemaVersion de development dataset incompatível");
  }
  if (
    !nonEmptyString(dataset?.experimentId) ||
    dataset?.locale !== "pt-BR" ||
    !validHash(dataset?.manifestSha256)
  ) {
    errors.push("binding principal do development dataset inválido");
  }
  validateFeatureHeader(dataset, errors);
  const manifest = expected.manifest;
  const manifestValidation = manifest
    ? validateExp0017Manifest(manifest)
    : null;
  if (manifestValidation && !manifestValidation.valid) {
    errors.push("manifest esperado é inválido");
  }
  if (
    manifest && (
      dataset?.manifestSha256 !== manifest.manifestSha256 ||
      dataset?.experimentId !== manifest.experimentId
    )
  ) {
    errors.push("dataset diverge do manifest esperado");
  }
  const splitKeys = Object.keys(dataset?.splits ?? {}).sort();
  if (!sameArray(splitKeys, [...DEVELOPMENT_SPLITS].sort())) {
    errors.push("dataset development-only contém split inválido/holdout-core");
  }
  const examples = Array.isArray(dataset?.examples) ? dataset.examples : [];
  const manifestItems = manifest
    ? new Map(manifest.items.map((item) => [item.artifactId, item]))
    : null;
  for (const example of examples) {
    validateFeatureExample(example, {
      allowedSplits: DEVELOPMENT_SPLITS,
      decisionSamples: dataset?.decisionSamples,
      expectedEligibility: () => "fit-eligible",
      manifestItems
    }, errors);
  }
  duplicateValues(examples, "exampleId", errors);
  duplicateValues(examples, "artifactId", errors);
  for (const split of DEVELOPMENT_SPLITS) {
    const selected = examples.filter((example) => example.split === split);
    const observed = expectedSplitSummary(selected);
    if (!sameArray(dataset?.splits?.[split], observed)) {
      errors.push(`sumário divergente: ${split}`);
    }
    for (const label of SPEAKER_RELEVANCE_CLASSES) {
      if (!(observed.labels[label] > 0)) {
        errors.push(`${split} não contém ${label}`);
      }
    }
  }
  for (const field of [
    "lineageRootId",
    "speakerGroupId",
    "semanticGroupId",
    "templateGroupId",
    "recipeFamilyId"
  ]) {
    uniqueOwner(examples.map((example) => ({
      ...example,
      partition: example.split
    })), field, errors);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    observedHash
  });
}

function validateAuthorityBoundary(report, errors) {
  if (
    report?.authorityEligible !== false ||
    report?.authority?.mode !== "shadow" ||
    report?.authority?.canProduceEffects !== false ||
    report?.claims?.authorityGranted !== false
  ) {
    errors.push("fronteira de autoridade inválida");
  }
}

function validateEvidenceBindings(evidence, expected, fields, errors) {
  for (const field of fields) {
    if (!validHash(evidence?.[field])) {
      errors.push(`evidence.${field} inválido`);
    }
    if (expected[field] && evidence?.[field] !== expected[field]) {
      errors.push(`evidence.${field} divergente`);
    }
  }
}

function validateDevelopmentDecision(report, errors) {
  const criteria = report?.gateCriteria;
  const metrics = report?.metrics?.development;
  const candidate = metrics?.A;
  const paired = metrics?.pairedAAgainstA0ByLineage;
  const gates = report?.gates;
  if (
    criteria?.pairedDecisionUnit !==
      "lineage-root-all-descendants-correct" ||
    !Number.isFinite(criteria?.minimumDirectedRecall) ||
    !Number.isFinite(criteria?.minimumAccuracy) ||
    !Number.isFinite(criteria?.minimumClassRecall) ||
    !Number.isFinite(criteria?.minimumGainOverAllDirected) ||
    !Number.isFinite(criteria?.minimumPairedNetGainAgainstA0) ||
    paired?.unit !== criteria?.pairedDecisionUnit ||
    !Number.isFinite(paired?.netGain) ||
    !Number.isFinite(candidate?.accuracy) ||
    !Number.isFinite(
      candidate?.classRecall?.DIRECTED_TO_ASSISTANT
    ) ||
    !Number.isFinite(
      candidate?.classRecall?.BACKGROUND_OR_NOT_DIRECTED
    ) ||
    !Number.isFinite(metrics?.gainOverAllDirected) ||
    !gates || typeof gates !== "object"
  ) {
    errors.push("métricas ou critérios decisórios ausentes/inválidos");
    return;
  }
  const derived = {
    noHoldoutConstructedOrRead:
      report.holdoutRead === false &&
      report?.fitBoundary?.holdoutConstructed === false &&
      report?.fitBoundary?.holdoutPayloadPathRead === false &&
      Array.isArray(report?.fitBoundary?.inputReadAllowlist) &&
      report.fitBoundary.inputReadAllowlist.length === 4 &&
      report.fitBoundary.inputReadAllowlist.every(
        (path) => typeof path === "string" &&
          !/holdout|commitment|mswc/iu.test(path)
      ),
    fitAndCalibrationSplitsFrozen:
      report?.fitBoundary?.selectedSplit === "train" &&
      report?.fitBoundary?.calibrationSplit === "development",
    thresholdSelectedOnDevelopment:
      report?.core?.calibrationSafeSolution === true &&
      report?.calibration?.split === "development" &&
      report?.calibration?.selected !== null,
    directedRecallIsPerfect:
      candidate.classRecall.DIRECTED_TO_ASSISTANT >=
        criteria.minimumDirectedRecall,
    minimumAccuracy:
      candidate.accuracy >= criteria.minimumAccuracy,
    minimumClassRecall: Object.values(candidate.classRecall).every(
      (recall) => Number.isFinite(recall) &&
        recall >= criteria.minimumClassRecall
    ),
    minimumGainOverAllDirected:
      metrics.gainOverAllDirected >= criteria.minimumGainOverAllDirected,
    minimumPairedNetGainAgainstA0:
      paired.netGain >= criteria.minimumPairedNetGainAgainstA0,
    causalWindow:
      report?.fitBoundary?.futureSamplesUsed === criteria.futureSamplesUsed,
    shadowOnly:
      report?.authority?.canProduceEffects === criteria.canProduceEffects
  };
  for (const [name, expected] of Object.entries(derived)) {
    if (gates[name] !== expected) {
      errors.push(`gate ${name} diverge das métricas`);
    }
  }
  const gateEntries = Object.entries(gates).filter(
    ([name]) => name !== "allPassed"
  );
  if (
    gateEntries.length === 0 ||
    gateEntries.some(([, value]) => typeof value !== "boolean")
  ) {
    errors.push("gates precisam ser booleanos e não vazios");
    return;
  }
  const allPassed = gateEntries.every(([, value]) => value);
  if (
    gates.allPassed !== allPassed ||
    report?.core?.aQualified !== allPassed ||
    report?.core?.aRef !== (allPassed ? "A" : "A0") ||
    report?.core?.decision !== (allPassed
      ? "qualify-a-for-new-opaque-holdout-preregistration"
      : "retain-a0-and-cut-acoustic-core")
  ) {
    errors.push("decisão de A/A0 diverge dos gates derivados");
  }
}

export function finalizeExp0017DevelopmentReport(reportCore) {
  return finalize(reportCore, "reportSha256");
}

export function validateExp0017DevelopmentReport(report, expected = {}) {
  const errors = [];
  const observedHash = validateCanonicalHash(
    report,
    "reportSha256",
    errors
  );
  if (
    report?.schemaVersion !== EXP0017_DEVELOPMENT_REPORT_SCHEMA ||
    !nonEmptyString(report?.experimentId) ||
    report?.evidenceLevel !== "development-screen" ||
    report?.confirmatory !== false ||
    report?.holdoutRead !== false
  ) {
    errors.push("relatório dev tenta ultrapassar evidência de screen");
  }
  validateAuthorityBoundary(report, errors);
  validateEvidenceBindings(report?.evidence, expected, [
    "manifestSha256",
    "developmentDatasetSha256",
    "a0ModelSha256",
    "aModelSha256"
  ], errors);
  if (
    report?.evidence?.holdoutPayloadSha256 !== undefined ||
    report?.holdoutMetrics !== undefined ||
    report?.core?.stage !== "development" ||
    !["A", "A0"].includes(report?.core?.aRef)
  ) {
    errors.push("relatório dev consumiu ou alegou holdout");
  }
  if (
    report?.r?.evaluationRole !== "development-screen-only" ||
    report?.r?.confirmatory !== false ||
    report?.r?.holdoutCoreConsumed !== false ||
    report?.r?.promoted !== false ||
    report?.claims?.coreConfirmatoryEvidence !== false ||
    report?.claims?.rConfirmatoryEvidence !== false ||
    report?.claims?.rPromoted !== false
  ) {
    errors.push("fronteira exploratória de R/dev inválida");
  }
  validateDevelopmentDecision(report, errors);
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    observedHash
  });
}
