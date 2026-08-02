import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0017_SUPERTONIC_PLAN_SCHEMA =
  "exp-0017-supertonic-scenes-v1";
export const EXP0017_SUPERTONIC_SOURCE_SCHEMA =
  "exp-0017-supertonic-source-manifest-v1";

const SPLITS = Object.freeze(["train", "development"]);
const LABELS = Object.freeze([
  "BACKGROUND_OR_NOT_DIRECTED",
  "DIRECTED_TO_ASSISTANT"
]);
const EXPECTED_FAMILIES = Object.freeze({
  correction: 4,
  short: 4,
  "direct-generic": 7,
  "third-party-backchannel": 4,
  "lateral-conversation": 4,
  "background-broadcast": 4,
  "assistant-leakage-or-nondirected": 3
});
const EXPECTED_VOICES = Object.freeze({
  train: Object.freeze(["F1", "F2", "M1", "M2"]),
  development: Object.freeze(["F3", "F4", "M3", "M4"])
});
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function present(value) {
  return typeof value === "string" && value.length > 0;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function counts(values) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [
    value,
    values.filter((candidate) => candidate === value).length
  ]));
}

function sameCounts(observed, expected) {
  const keys = [...new Set([
    ...Object.keys(observed),
    ...Object.keys(expected)
  ])].sort();
  return keys.every((key) => observed[key] === expected[key]);
}

function withoutHash(value) {
  const core = structuredClone(value ?? {});
  delete core.manifestSha256;
  return core;
}

export function validateExp0017SupertonicPlan(plan) {
  const errors = [];
  if (
    plan?.schemaVersion !== EXP0017_SUPERTONIC_PLAN_SCHEMA ||
    plan?.locale !== "pt-BR" ||
    plan?.status !== "pre-fit-plan-no-audio-materialized" ||
    plan?.scope?.holdoutObserved !== false ||
    plan?.scope?.audioMaterialized !== false ||
    plan?.scope?.paidApiCalls !== 0 ||
    !same(plan?.scope?.allowedSplits, SPLITS) ||
    plan?.generator?.model !== "Supertone/supertonic-3" ||
    plan?.generator?.execution !== "local-offline" ||
    plan?.generator?.license?.model !== "OpenRAIL-M" ||
    plan?.generator?.license?.sdk !== "MIT" ||
    plan?.generator?.license?.sdkVersion !== "1.3.1" ||
    !HASH_PATTERN.test(plan?.generator?.license?.modelLicenseSha256 ?? "")
  ) {
    errors.push("contrato principal do plano Supertonic inválido");
  }
  const allScenes = [];
  for (const split of SPLITS) {
    const scenes = plan?.scenes?.[split];
    if (!Array.isArray(scenes) || scenes.length !== 30) {
      errors.push(`${split}: precisa conter 30 cenas`);
      continue;
    }
    allScenes.push(...scenes.map((scene) => ({ ...scene, split })));
    for (const label of LABELS) {
      if (scenes.filter((scene) => scene.label === label).length !== 15) {
        errors.push(`${split}/${label}: precisa conter 15 cenas`);
      }
    }
    if (!sameCounts(counts(scenes.map(
      (scene) => scene.conversationFamily
    )), EXPECTED_FAMILIES)) {
      errors.push(`${split}: famílias divergem do plano congelado`);
    }
    const allowedVoices = EXPECTED_VOICES[split];
    const voiceCounts = counts(scenes.map((scene) => scene.voiceStyle));
    if (
      !same(Object.keys(voiceCounts).sort(), [...allowedVoices].sort()) ||
      !same(Object.values(voiceCounts).sort(), [7, 7, 8, 8])
    ) {
      errors.push(`${split}: vozes não estão balanceadas/congeladas`);
    }
    for (const label of LABELS) {
      const classVoiceCounts = counts(scenes.filter(
        (scene) => scene.label === label
      ).map((scene) => scene.voiceStyle));
      if (
        Object.keys(classVoiceCounts).length !== 4 ||
        !Object.values(classVoiceCounts).every(
          (count) => count === 3 || count === 4
        )
      ) {
        errors.push(`${split}/${label}: voz correlacionada à classe`);
      }
    }
  }
  for (const scene of allScenes) {
    if (
      !present(scene?.id) ||
      !/^[a-z0-9-]+$/u.test(scene.id) ||
      !present(scene?.text) ||
      !LABELS.includes(scene?.label) ||
      !present(scene?.conversationFamily) ||
      !present(scene?.templateGroupId) ||
      !present(scene?.semanticGroupId) ||
      !EXPECTED_VOICES[scene.split].includes(scene?.voiceStyle) ||
      !present(scene?.intendedContext) ||
      scene?.provenance?.synthetic !== true ||
      scene?.provenance?.audioStatus !== "not-materialized"
    ) {
      errors.push(`${scene?.id ?? "cena"}: cena Supertonic inválida`);
    }
  }
  for (const field of ["id", "templateGroupId", "semanticGroupId"]) {
    if (new Set(allScenes.map((scene) => scene[field])).size !== 60) {
      errors.push(`${field}: precisa ser globalmente disjunto`);
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

export function finalizeExp0017SupertonicSourceManifest(core) {
  const without = withoutHash(core);
  return Object.freeze({
    ...without,
    manifestSha256: `sha256:${canonicalSha256(without)}`
  });
}

export function validateExp0017SupertonicSourceManifest(manifest) {
  const errors = [];
  const observedHash = `sha256:${canonicalSha256(withoutHash(manifest))}`;
  if (manifest?.manifestSha256 !== observedHash) {
    errors.push("manifestSha256 divergente");
  }
  if (
    manifest?.schemaVersion !== EXP0017_SUPERTONIC_SOURCE_SCHEMA ||
    manifest?.locale !== "pt-BR" ||
    manifest?.source?.kind !== "synthetic-ai" ||
    manifest?.source?.model !== "Supertone/supertonic-3" ||
    manifest?.source?.license !== "OpenRAIL-M" ||
    manifest?.source?.sdkLicense !== "MIT" ||
    manifest?.source?.paidApiCalls !== 0 ||
    manifest?.retention?.rawAudioInGit !== false
  ) {
    errors.push("contrato principal do manifest Supertonic inválido");
  }
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (
    files.length !== 60 ||
    files.length !== manifest?.selection?.selected ||
    new Set(files.map((file) => file.sceneId)).size !== files.length ||
    new Set(files.map((file) => file.relativePath)).size !== files.length ||
    new Set(files.map((file) => file.waveSha256)).size !== files.length ||
    new Set(files.map((file) => file.pcmSha256)).size !== files.length
  ) {
    errors.push("seleção Supertonic precisa de 60 artefatos únicos");
  }
  for (const file of files) {
    if (
      !SPLITS.includes(file?.partition) ||
      !present(file?.sceneId) ||
      !present(file?.textSha256) ||
      !LABELS.includes(file?.label) ||
      !present(file?.conversationFamily) ||
      !present(file?.templateGroupId) ||
      !present(file?.semanticGroupId) ||
      !EXPECTED_VOICES[file.partition].includes(file?.voiceStyle) ||
      !present(file?.speakerGroupId) ||
      !present(file?.lineageRootId) ||
      !present(file?.relativePath) ||
      !HASH_PATTERN.test(file?.waveSha256 ?? "") ||
      !HASH_PATTERN.test(file?.pcmSha256 ?? "") ||
      file?.sampleRate !== 16_000 ||
      !Number.isSafeInteger(file?.sampleCount) ||
      file.sampleCount < 1
    ) {
      errors.push(`${file?.sceneId ?? "arquivo"}: artefato inválido`);
    }
  }
  for (const split of SPLITS) {
    const selected = files.filter((file) => file.partition === split);
    if (selected.length !== 30) {
      errors.push(`${split}: manifest precisa conter 30 fontes`);
    }
    for (const label of LABELS) {
      if (selected.filter((file) => file.label === label).length !== 15) {
        errors.push(`${split}/${label}: manifest desbalanceado`);
      }
    }
  }
  const speakerOwners = new Map();
  for (const file of files) {
    const prior = speakerOwners.get(file.speakerGroupId);
    if (prior !== undefined && prior !== file.partition) {
      errors.push(`${file.speakerGroupId}: voz atravessa splits`);
    }
    speakerOwners.set(file.speakerGroupId, file.partition);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    observedHash
  });
}
