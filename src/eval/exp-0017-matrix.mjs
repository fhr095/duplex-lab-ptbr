import {
  EXP0017_CLASSES,
  validateExp0017Manifest
} from "./exp-0017-contract.mjs";

export const EXP0017_MATRIX_LIMITS = Object.freeze({
  maximumExamples: 720,
  minimumEvaluationExamples: 120,
  minimumExamplesPerClass: 60,
  minimumConversationFamilies: 6,
  minimumLineages: 8,
  minimumVoiceProfiles: 4,
  minimumAcousticConditions: 4,
  maximumLineageShare: 0.25,
  minimumHardDirectedExamples: 10,
  decisionSamples: 8_960,
  sampleRate: 16_000
});

export const EXP0017_HARD_DIRECTED_STRATA = Object.freeze([
  "low-distant",
  "short",
  "partially-overlapped",
  "correction"
]);

const EVALUATION_SPLITS = Object.freeze(["development"]);
const SOURCE_KINDS = new Set(["human", "synthetic-ai"]);

function present(value) {
  return typeof value === "string" && value.length > 0;
}

function countBy(items, field) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item[field], (counts.get(item[field]) ?? 0) + 1);
  }
  return counts;
}

function splitSummary(items) {
  const labels = Object.fromEntries(EXP0017_CLASSES.map((label) => [
    label,
    items.filter((item) => item.label === label).length
  ]));
  const lineages = countBy(items, "lineageRootId");
  const maximumLineageExamples = lineages.size === 0
    ? 0
    : Math.max(...lineages.values());
  return Object.freeze({
    examples: items.length,
    labels: Object.freeze(labels),
    conversationFamilies: new Set(
      items.map((item) => item.conversationFamilyId)
    ).size,
    lineages: lineages.size,
    voiceProfiles: new Set(items.map((item) => item.voiceProfileId)).size,
    acousticConditions: new Set(
      items.map((item) => item.acousticConditionId)
    ).size,
    maximumLineageExamples,
    maximumLineageShare: items.length === 0
      ? null
      : maximumLineageExamples / items.length,
    hardDirected: Object.freeze(Object.fromEntries(
      EXP0017_HARD_DIRECTED_STRATA.map((stratum) => [
        stratum,
        items.filter((item) =>
          item.label === "DIRECTED_TO_ASSISTANT" &&
          item.hardDirectedStrata.includes(stratum)
        ).length
      ])
    ))
  });
}

function validateItem(item, sourceById, errors) {
  const source = sourceById.get(item?.sourceId);
  if (
    !SOURCE_KINDS.has(item?.sourceKind) ||
    item?.sourceKind !== source?.kind ||
    !present(item?.conversationFamilyId) ||
    !present(item?.voiceProfileId) ||
    !present(item?.acousticConditionId) ||
    item?.decisionSamples !== EXP0017_MATRIX_LIMITS.decisionSamples ||
    item?.sampleRate !== EXP0017_MATRIX_LIMITS.sampleRate ||
    item?.futureSamplesUsed !== 0 ||
    !Array.isArray(item?.hardDirectedStrata) ||
    item.hardDirectedStrata.some(
      (stratum) => !EXP0017_HARD_DIRECTED_STRATA.includes(stratum)
    ) ||
    new Set(item.hardDirectedStrata).size !==
      item.hardDirectedStrata.length
  ) {
    errors.push(`${item?.artifactId ?? "item"}: metadata da matriz inválida`);
  }
  if (
    item?.label !== "DIRECTED_TO_ASSISTANT" &&
    item?.hardDirectedStrata?.length > 0
  ) {
    errors.push(
      `${item.artifactId}: hardDirectedStrata em classe não dirigida`
    );
  }
}

function validateEvaluationSplit(split, items, limits, errors) {
  const summary = splitSummary(items);
  if (summary.examples < limits.minimumEvaluationExamples) {
    errors.push(`${split}: denominador menor que o pré-registrado`);
  }
  for (const label of EXP0017_CLASSES) {
    if (summary.labels[label] < limits.minimumExamplesPerClass) {
      errors.push(`${split}: ${label} abaixo do mínimo`);
    }
  }
  for (const [field, observed, minimum] of [
    ["famílias conversacionais", summary.conversationFamilies,
      limits.minimumConversationFamilies],
    ["linhagens", summary.lineages, limits.minimumLineages],
    ["perfis de voz", summary.voiceProfiles, limits.minimumVoiceProfiles],
    ["condições acústicas", summary.acousticConditions,
      limits.minimumAcousticConditions]
  ]) {
    if (observed < minimum) {
      errors.push(`${split}: ${field} abaixo do mínimo`);
    }
  }
  if (
    summary.maximumLineageShare === null ||
    summary.maximumLineageShare > limits.maximumLineageShare
  ) {
    errors.push(`${split}: uma linhagem excede o teto de participação`);
  }
  for (const stratum of EXP0017_HARD_DIRECTED_STRATA) {
    if (summary.hardDirected[stratum] < limits.minimumHardDirectedExamples) {
      errors.push(`${split}: estrato dirigido ${stratum} abaixo do mínimo`);
    }
  }

  const conditions = new Set(items.map((item) => item.acousticConditionId));
  for (const condition of conditions) {
    const labels = new Set(items.filter(
      (item) => item.acousticConditionId === condition
    ).map((item) => item.label));
    if (labels.size !== EXP0017_CLASSES.length) {
      errors.push(
        `${split}: condição acústica correlacionada à classe: ${condition}`
      );
    }
  }
  return summary;
}

export function validateExp0017Matrix(manifest, options = {}) {
  const limits = Object.freeze({
    ...EXP0017_MATRIX_LIMITS,
    ...(options.limits ?? {})
  });
  const errors = [];
  const manifestValidation = validateExp0017Manifest(manifest);
  if (!manifestValidation.valid) {
    errors.push(...manifestValidation.errors.map(
      (error) => `manifest: ${error}`
    ));
  }
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  const sourceById = new Map(sources.map((source) => [
    source.sourceId,
    source
  ]));
  for (const source of sources) {
    if (!SOURCE_KINDS.has(source?.kind)) {
      errors.push(`${source?.sourceId ?? "fonte"}: source kind inválido`);
    }
  }
  for (const item of items) {
    validateItem(item, sourceById, errors);
  }
  if (items.length > limits.maximumExamples) {
    errors.push("matriz excede o orçamento máximo de exemplos");
  }
  const summaries = {};
  for (const split of ["train", ...EVALUATION_SPLITS]) {
    const selected = items.filter((item) => item.partition === split);
    summaries[split] = EVALUATION_SPLITS.includes(split)
      ? validateEvaluationSplit(split, selected, limits, errors)
      : splitSummary(selected);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    limits,
    summaries: Object.freeze(summaries),
    manifestValidation
  });
}
