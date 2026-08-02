import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { measurePcm16 } from "../src/audio/acoustic-renderer.mjs";
import { encodePcm16Wave } from "../src/audio/wav.mjs";
import {
  EXP0017_CLASSES,
  EXP0017_DEVELOPMENT_DATASET_SCHEMA,
  EXP0017_MANIFEST_SCHEMA,
  finalizeExp0017DevelopmentDataset,
  finalizeExp0017Manifest,
  validateExp0017DevelopmentDataset,
  validateExp0017Manifest
} from "../src/eval/exp-0017-contract.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";
import { validateExp0017Matrix } from "../src/eval/exp-0017-matrix.mjs";
import {
  SPEAKER_RELEVANCE_FEATURES,
  SPEAKER_RELEVANCE_FEATURE_VERSION,
  extractSpeakerRelevanceFeatures,
  renderSpeakerRelevanceRecipe
} from "../src/eval/speaker-relevance-features.mjs";
import {
  validateExp0017SupertonicSourceManifest
} from "../src/eval/exp-0017-supertonic.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  config: "eval/experiments/exp-0017-safe-veto-core-v0.1.json"
});
const DIRECTED = "DIRECTED_TO_ASSISTANT";

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument !== "--config") {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    options.config = args[++index];
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function seedFor(...parts) {
  return Number.parseInt(
    sha256(Buffer.from(parts.join("/"), "utf8")).slice(0, 8),
    16
  );
}

function validateConfig(config) {
  const errors = [];
  if (
    config?.schemaVersion !== 1 ||
    config?.status !== "frozen-before-fit" ||
    config?.locale !== "pt-BR" ||
    config?.budget?.plannedExamples !== 240 ||
    config?.budget?.maximumExamples !== 720 ||
    config?.budget?.modelFamilies !== 1 ||
    config?.budget?.calibrationRules !== 1 ||
    config?.budget?.holdoutOpenings !== 0 ||
    config?.budget?.paidApiCalls !== 0 ||
    config?.budget?.paidGpuRuns !== 0 ||
    JSON.stringify(config?.task?.classes) !== JSON.stringify(EXP0017_CLASSES)
  ) {
    errors.push("contrato principal da configuração é inválido");
  }
  if (
    config?.audio?.sampleRate !== 16_000 ||
    config?.audio?.durationMs !== 1_000 ||
    config?.audio?.decisionMs !== 560 ||
    config?.audio?.decisionSamples !== 8_960 ||
    config?.audio?.futureSamplesAllowed !== 0 ||
    config?.audio?.conditionsCrossedAcrossLabels !== true
  ) {
    errors.push("contrato causal de áudio é inválido");
  }
  const conditions = config?.acousticConditions;
  if (
    !Array.isArray(conditions) ||
    conditions.length !== 4 ||
    new Set(conditions.map((condition) => condition.id)).size !== 4 ||
    conditions.filter((condition) => condition.secondary === true).length !== 1
  ) {
    errors.push("quatro condições acústicas cruzadas são obrigatórias");
  }
  if (
    config?.matrix?.sourceScenesPerSplit !== 30 ||
    config?.matrix?.descendantsPerSource !== 4 ||
    config?.matrix?.examplesPerSplit !== 120 ||
    config?.matrix?.examplesPerClassPerSplit !== 60 ||
    config?.trainer?.algorithm !==
      "full-batch-multinomial-logistic-regression-v1" ||
    config?.trainer?.epochs !== 2_400 ||
    config?.trainer?.learningRate !== 0.3 ||
    config?.trainer?.l2 !== 0.001 ||
    config?.trainer?.initialization !== "all-zero" ||
    config?.trainer?.ordering !== "input-order/full-batch" ||
    config?.trainer?.repetitions !== 2 ||
    config?.calibration?.selectedSplit !== "development" ||
    config?.calibration?.minimumThreshold !== 0.5 ||
    config?.calibration?.objective !==
      "maximize-background-coverage-subject-to-perfect-directed-recall" ||
    JSON.stringify(config?.calibration?.tieBreak) !== JSON.stringify([
      "maximum-background-coverage",
      "maximum-accuracy",
      "highest-threshold"
    ]) ||
    config?.calibration?.holdoutMaySelectThreshold !== false
  ) {
    errors.push("matriz, treino ou calibração diverge do pré-registro");
  }
  if (
    config?.gates?.pairedDecisionUnit !==
      "lineage-root-all-descendants-correct" ||
    config?.gates?.minimumDirectedRecall !== 1 ||
    config?.gates?.minimumAccuracy !== 0.75 ||
    config?.gates?.minimumClassRecall !== 0.75 ||
    config?.gates?.minimumGainOverAllDirected !== 0.2 ||
    config?.gates?.minimumPairedNetGainAgainstA0 !== 1 ||
    config?.gates?.futureSamplesUsed !== 0 ||
    config?.gates?.canProduceEffects !== false
  ) {
    errors.push("gates divergem do pré-registro");
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

async function writeOrCheck(path, bytes, check) {
  if (check) {
    const existing = await readFile(path).catch(() => null);
    if (existing === null || !existing.equals(bytes)) {
      throw new Error(`artefato ausente ou divergente: ${path}`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function sourceScenes(sourceManifest) {
  return sourceManifest.files.map((file) => ({
    ...file,
    sourceId: sourceManifest.sourceId,
    sourceKind: sourceManifest.source.kind,
    sourceLicense: sourceManifest.source.license
  }));
}

async function loadSources(config) {
  const descriptors = [config.sources.trainDevelopment];
  const loaded = [];
  for (const descriptor of descriptors) {
    const path = resolve(PROJECT_ROOT, descriptor.manifest);
    const bytes = await readFile(path);
    if (`sha256:${sha256(bytes)}` !== descriptor.fileSha256) {
      throw new Error(`${descriptor.manifest}: fileSha256 divergente`);
    }
    const manifest = JSON.parse(bytes.toString("utf8"));
    if (manifest.manifestSha256 !== descriptor.manifestSha256) {
      throw new Error(`${descriptor.manifest}: manifestSha256 divergente`);
    }
    const validation = validateExp0017SupertonicSourceManifest(manifest);
    if (!validation.valid) {
      throw new Error(
        `${descriptor.manifest}: ${validation.errors.join("; ")}`
      );
    }
    loaded.push({ descriptor, manifest, bytes });
  }
  return loaded;
}

async function decodeSourceScenes(scenes) {
  const decoded = [];
  for (const scene of scenes) {
    const wave = await readFile(resolve(PROJECT_ROOT, scene.relativePath));
    if (`sha256:${sha256(wave)}` !== scene.waveSha256) {
      throw new Error(`${scene.sceneId}: WAV fonte divergente`);
    }
    const audio = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 });
    if (`sha256:${sha256(audio.pcm)}` !== scene.pcmSha256) {
      throw new Error(`${scene.sceneId}: PCM fonte divergente`);
    }
    decoded.push({ ...scene, pcm: audio.pcm });
  }
  return decoded;
}

function secondaryFor(scene, selected) {
  const opposite = selected.filter((candidate) =>
    candidate.label !== scene.label
  );
  const peers = selected.filter((candidate) =>
    candidate.label === scene.label
  );
  const index = peers.findIndex((candidate) =>
    candidate.sceneId === scene.sceneId
  );
  if (index < 0 || opposite.length !== peers.length) {
    throw new Error(`pareamento secundário inválido: ${scene.sceneId}`);
  }
  return opposite[index];
}

function hardDirectedStrata(scene, condition) {
  if (scene.label !== DIRECTED) {
    return [];
  }
  return [
    ...(condition.id === "low-distant-proxy" ? ["low-distant"] : []),
    ...(condition.id === "competing-speech-proxy"
      ? ["partially-overlapped"]
      : []),
    ...(scene.conversationFamily.includes("short") ? ["short"] : []),
    ...(scene.conversationFamily.includes("correction")
      ? ["correction"]
      : [])
  ];
}

function splitSummary(examples) {
  return {
    examples: examples.length,
    labels: Object.fromEntries(EXP0017_CLASSES.map((label) => [
      label,
      examples.filter((example) => example.label === label).length
    ]))
  };
}

function featureExample(item, features) {
  return {
    exampleId: `example:${item.artifactId}`,
    artifactId: item.artifactId,
    split: item.partition,
    lineageRootId: item.lineageRootId,
    speakerGroupId: item.speakerGroupId,
    semanticGroupId: item.semanticGroupId,
    templateGroupId: item.templateGroupId,
    recipeFamilyId: item.recipeFamilyId,
    secondaryLineageRootIds: [...item.secondaryLineageRootIds],
    label: item.label,
    labelSource: {
      kind: item.sourceKind === "human"
        ? "human-word-controlled-context-proxy"
        : "synthetic-controlled-context-proxy",
      ref: item.sourceId,
      humanDirectIntentLabel: false
    },
    fitEligibility: item.fitEligibility,
    features: [...features.values],
    causalWindow: { ...features.window },
    strata: {
      conversationFamilyId: item.conversationFamilyId,
      voiceProfileId: item.voiceProfileId,
      acousticConditionId: item.acousticConditionId,
      hardDirected: [...item.hardDirectedStrata]
    }
  };
}

export async function buildExp0017CoreDataset(options = {}) {
  const configPath = resolve(PROJECT_ROOT, options.config ?? DEFAULTS.config);
  const configBytes = await readFile(configPath);
  const config = JSON.parse(configBytes.toString("utf8"));
  const configValidation = validateConfig(config);
  if (!configValidation.valid) {
    throw new Error(
      `configuração inválida: ${configValidation.errors.join("; ")}`
    );
  }
  const sourceBundles = await loadSources(config);
  const [supertonic] = sourceBundles;
  const splitSources = {
    train: sourceScenes(supertonic.manifest).filter(
      (scene) => scene.partition === "train"
    ),
    development: sourceScenes(supertonic.manifest).filter(
      (scene) => scene.partition === "development"
    )
  };
  for (const split of Object.keys(splitSources)) {
    if (splitSources[split].length !== 30) {
      throw new Error(`${split}: precisa conter 30 fontes`);
    }
    splitSources[split] = await decodeSourceScenes(splitSources[split]);
  }

  const manifestItems = [];
  const examples = [];
  const audioRoot = config.outputs.transformedAudioRoot;
  for (const split of ["train", "development"]) {
    const selected = splitSources[split];
    for (const scene of selected) {
      const secondary = secondaryFor(scene, selected);
      for (const condition of config.acousticConditions) {
        const rendered = renderSpeakerRelevanceRecipe({
          ...condition,
          sourcePcm: scene.pcm,
          secondaryPcm: condition.secondary ? secondary.pcm : null,
          sampleRate: config.audio.sampleRate,
          durationMs: config.audio.durationMs,
          decisionMs: config.audio.decisionMs,
          seed: seedFor(config.id, split, scene.sceneId, condition.id)
        });
        const featureSet = extractSpeakerRelevanceFeatures(rendered);
        const wave = encodePcm16Wave(rendered.pcm, {
          sampleRate: rendered.sampleRate,
          channels: 1
        });
        const relativePath =
          `${audioRoot}/${split}/${scene.sceneId}--${condition.id}.wav`;
        await writeOrCheck(
          resolve(PROJECT_ROOT, relativePath),
          wave,
          options.check ?? false
        );
        const measurement = measurePcm16(rendered.pcm, {
          sampleRate: rendered.sampleRate
        });
        if (measurement.clippedSamples > 0) {
          throw new Error(`${relativePath}: clipping detectado`);
        }
        const artifactId =
          `exp0017:${split}:${scene.sceneId}:${condition.id}`;
        const item = {
          artifactId,
          sourceId: scene.sourceId,
          sourceArtifactId:
            `${scene.sourceArtifactId}:condition:${condition.id}`,
          partition: split,
          lineageRootId: scene.lineageRootId,
          speakerGroupId: scene.speakerGroupId,
          semanticGroupId: scene.semanticGroupId,
          templateGroupId: scene.templateGroupId,
          recipeFamilyId: `exp0017:${split}:${condition.id}`,
          waveSha256: `sha256:${sha256(wave)}`,
          pcmSha256: `sha256:${sha256(rendered.pcm)}`,
          secondaryLineageRootIds: condition.secondary
            ? [secondary.lineageRootId]
            : [],
          label: scene.label,
          fitEligibility: "fit-eligible",
          sourceKind: scene.sourceKind,
          sourceLicense: scene.sourceLicense,
          conversationFamilyId:
            `exp0017:${split}:${scene.conversationFamily}`,
          voiceProfileId: scene.voiceProfileId,
          acousticConditionId: condition.id,
          hardDirectedStrata: hardDirectedStrata(scene, condition),
          decisionSamples: config.audio.decisionSamples,
          sampleRate: config.audio.sampleRate,
          futureSamplesUsed: 0,
          artifact: {
            path: relativePath,
            sampleCount: rendered.pcm.length / 2,
            clippedSamples: measurement.clippedSamples
          },
          provenance: {
            sourceSceneId: scene.sceneId,
            sourceManifestSha256: supertonic.manifest.manifestSha256,
            transformation: condition,
            synthetic: scene.sourceKind === "synthetic-ai"
          }
        };
        manifestItems.push(item);
        examples.push(featureExample(item, featureSet));
      }
    }
  }

  const manifest = finalizeExp0017Manifest({
    schemaVersion: EXP0017_MANIFEST_SCHEMA,
    experimentId: config.id,
    locale: config.locale,
    experimentConfig: {
      path: options.config ?? DEFAULTS.config,
      fileSha256: `sha256:${sha256(configBytes)}`,
      canonicalSha256: `sha256:${canonicalSha256(config)}`
    },
    sources: sourceBundles.map(({ descriptor, manifest: source }) => ({
      sourceId: source.sourceId,
      revision: source.manifestSha256,
      license: descriptor.license,
      kind: descriptor.kind,
      manifestPath: descriptor.manifest,
      manifestFileSha256: descriptor.fileSha256
    })),
    retention: {
      rawAudioInGit: false,
      transformedAudioInGit: false,
      committedFeaturesReproduceCheckpoint: true,
      holdoutConstructedInThisExecution: false
    },
    sealing: {
      frozenBeforeFit: true,
      evidenceLevel: "development-screen",
      holdoutConstructed: false,
      holdoutMetricsComputed: false
    },
    items: manifestItems
  });
  const manifestValidation = validateExp0017Manifest(manifest);
  const matrixValidation = validateExp0017Matrix(manifest);
  if (!manifestValidation.valid || !matrixValidation.valid) {
    throw new Error([
      ...manifestValidation.errors,
      ...matrixValidation.errors
    ].join("; "));
  }

  const developmentExamples = examples;
  const developmentDataset = finalizeExp0017DevelopmentDataset({
    schemaVersion: EXP0017_DEVELOPMENT_DATASET_SCHEMA,
    experimentId: config.id,
    locale: config.locale,
    manifestSha256: manifest.manifestSha256,
    featureVersion: SPEAKER_RELEVANCE_FEATURE_VERSION,
    featureNames: [...SPEAKER_RELEVANCE_FEATURES],
    classes: [...EXP0017_CLASSES],
    decisionSamples: config.audio.decisionSamples,
    fitBoundary: {
      selectedSplit: "train",
      calibrationSplit: "development",
      excluded: [],
      holdoutRead: false
    },
    splits: Object.fromEntries(["train", "development"].map((split) => [
      split,
      splitSummary(developmentExamples.filter(
        (example) => example.split === split
      ))
    ])),
    examples: developmentExamples
  });
  const developmentValidation = validateExp0017DevelopmentDataset(
    developmentDataset,
    { manifest }
  );
  if (!developmentValidation.valid) {
    throw new Error(developmentValidation.errors.join("; "));
  }
  return {
    config,
    manifest,
    manifestValidation,
    matrixValidation,
    developmentDataset,
    developmentValidation
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildExp0017CoreDataset(options);
  const artifacts = [
    [result.config.outputs.manifest, result.manifest],
    [result.config.outputs.developmentDataset, result.developmentDataset]
  ];
  for (const [path, value] of artifacts) {
    await writeOrCheck(
      resolve(PROJECT_ROOT, path),
      Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
      options.check
    );
  }
  console.log(
    `EXP-0017 Core data ${options.check ? "CHECK" : "BUILD"}: ` +
      `${result.manifest.items.length} exemplos; ` +
      `dev=${result.developmentDataset.examples.length}; ` +
      "holdout=adiado até challenger qualificar; " +
      result.manifest.manifestSha256
  );
  console.log(
    "evidence=development-screen; zero métricas/artefatos de holdout."
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
