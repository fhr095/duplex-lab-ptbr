import {
  SPEAKER_RELEVANCE_CLASSES,
  SPEAKER_RELEVANCE_FEATURES,
  SPEAKER_RELEVANCE_FEATURE_VERSION
} from "./speaker-relevance-features.mjs";
import {
  canonicalSha256
} from "./factory/canonical-hash.mjs";

function core(dataset) {
  const value = structuredClone(dataset ?? {});
  delete value.datasetSha256;
  return value;
}

export function finalizeSpeakerRelevanceDataset(datasetCore) {
  const value = core(datasetCore);
  return Object.freeze({
    ...value,
    datasetSha256: `sha256:${canonicalSha256(value)}`
  });
}

export function validateSpeakerRelevanceDataset(dataset) {
  const errors = [];
  if (dataset?.schemaVersion !== "speaker-relevance-dataset-v1") {
    errors.push("schemaVersion incompatível");
  }
  const observedHash = `sha256:${canonicalSha256(core(dataset))}`;
  if (dataset?.datasetSha256 !== observedHash) {
    errors.push("datasetSha256 divergente");
  }
  if (
    dataset?.featureVersion !== SPEAKER_RELEVANCE_FEATURE_VERSION ||
    JSON.stringify(dataset?.featureNames) !==
      JSON.stringify(SPEAKER_RELEVANCE_FEATURES) ||
    JSON.stringify(dataset?.classes) !==
      JSON.stringify(SPEAKER_RELEVANCE_CLASSES)
  ) {
    errors.push("features ou classes incompatíveis");
  }
  if (
    dataset?.source?.license !== "CC-BY-4.0" ||
    dataset?.source?.fitEligibility !== "fit-eligible" ||
    dataset?.retention?.rawAudioInGit !== false ||
    dataset?.calibration?.usedForFit !== false ||
    dataset?.calibration?.fitExamples !== 0
  ) {
    errors.push("fronteira de fonte, retenção ou calibração inválida");
  }
  const examples = Array.isArray(dataset?.examples) ? dataset.examples : [];
  const splitNames = ["train", "development", "holdout"];
  const familyOwners = new Map();
  const clipOwners = new Map();
  for (const split of splitNames) {
    const summary = dataset?.splits?.[split];
    if (!summary || summary.examples < 1 || summary.sourceClips < 1) {
      errors.push(`split ausente ou vazio: ${split}`);
      continue;
    }
    for (const family of summary.recipeFamilies ?? []) {
      if (familyOwners.has(family)) {
        errors.push(`família em múltiplos splits: ${family}`);
      }
      familyOwners.set(family, split);
    }
    for (const label of SPEAKER_RELEVANCE_CLASSES) {
      if (!(summary.labels?.[label] > 0)) {
        errors.push(`${split} não contém ${label}`);
      }
    }
  }
  for (const example of examples) {
    if (
      !SPEAKER_RELEVANCE_CLASSES.includes(example?.label) ||
      !Array.isArray(example?.features) ||
      example.features.length !== SPEAKER_RELEVANCE_FEATURES.length ||
      example.features.some((value) => !Number.isFinite(value)) ||
      example.fitEligibility !== "fit-eligible" ||
      example.labelSource?.kind !==
        "calibration-derived-procedural-label" ||
      example.causalWindow?.futureSamplesUsed !== 0 ||
      example.causalWindow?.decisionSample <=
        example.causalWindow?.onsetSample ||
      !/^sha256:[a-f0-9]{64}$/u.test(
        example?.artifact?.waveSha256 ?? ""
      )
    ) {
      errors.push(`${example?.exampleId ?? "exemplo"} é incompatível`);
    }
    if (familyOwners.get(example.recipeFamily) !== example.split) {
      errors.push(`${example.exampleId} rompe split por família`);
    }
    const owner = clipOwners.get(example.sourceFileName);
    if (owner !== undefined && owner !== example.split) {
      errors.push(`${example.sourceFileName} aparece em múltiplos splits`);
    }
    clipOwners.set(example.sourceFileName, example.split);
  }
  if (new Set(examples.map((example) => example.exampleId)).size !==
    examples.length) {
    errors.push("exampleId duplicado");
  }
  if (
    examples.length !== Object.values(dataset?.splits ?? {}).reduce(
      (sum, summary) => sum + (summary.examples ?? 0),
      0
    )
  ) {
    errors.push("sumário de exemplos divergente");
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors,
    observedHash,
    familyOwners: Object.fromEntries(familyOwners),
    clipOwners: Object.fromEntries(clipOwners)
  });
}
