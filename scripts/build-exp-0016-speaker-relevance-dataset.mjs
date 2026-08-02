import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { measurePcm16 } from "../src/audio/acoustic-renderer.mjs";
import { encodePcm16Wave } from "../src/audio/wav.mjs";
import {
  finalizeSpeakerRelevanceDataset,
  validateSpeakerRelevanceDataset
} from "../src/eval/speaker-relevance-dataset.mjs";
import {
  SPEAKER_RELEVANCE_CLASSES,
  SPEAKER_RELEVANCE_FEATURES,
  SPEAKER_RELEVANCE_FEATURE_VERSION,
  extractSpeakerRelevanceFeatures,
  renderSpeakerRelevanceRecipe
} from "../src/eval/speaker-relevance-features.mjs";
import {
  canonicalSha256
} from "../src/eval/factory/canonical-hash.mjs";
import {
  validateExp0016SourceManifest
} from "./fetch-exp-0016-fleurs-source.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  audioRoot: "eval/generated/exp-0016/dataset-audio",
  config: "eval/experiments/exp-0016-speaker-relevance-m4b.pt-BR.json",
  out: "eval/datasets/exp-0016-speaker-relevance-v0.1.json"
});

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (!["--audio-root", "--config", "--out"].includes(argument)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const field = argument.slice(2).replace(
      /-([a-z])/gu,
      (_, letter) => letter.toUpperCase()
    );
    options[field] = args[++index];
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateConfig(config) {
  const errors = [];
  if (
    config?.schemaVersion !== 1 ||
    config?.source?.license !== "CC-BY-4.0" ||
    config?.source?.fitEligibility !== "fit-eligible" ||
    config?.source?.rawAudioInGit !== false ||
    JSON.stringify(config?.task?.classes) !==
      JSON.stringify(SPEAKER_RELEVANCE_CLASSES)
  ) {
    errors.push("contrato principal da configuração é inválido");
  }
  const families = [];
  for (const split of ["train", "development", "holdout"]) {
    const recipes = config?.splits?.[split];
    if (!Array.isArray(recipes) || recipes.length < 2) {
      errors.push(`${split} precisa conter receitas`);
      continue;
    }
    const labels = new Set(recipes.map((recipe) => recipe.label));
    if (!SPEAKER_RELEVANCE_CLASSES.every((label) => labels.has(label))) {
      errors.push(`${split} não cobre todas as classes`);
    }
    for (const recipe of recipes) {
      families.push(recipe.id);
      if (
        typeof recipe.id !== "string" ||
        !/^[a-z0-9-]+$/u.test(recipe.id) ||
        !SPEAKER_RELEVANCE_CLASSES.includes(recipe.label) ||
        !Number.isSafeInteger(recipe.decisionMs) ||
        recipe.decisionMs <= 0 ||
        recipe.decisionMs > config.audio.maximumDecisionMs
      ) {
        errors.push(`${split}/${recipe.id ?? "receita"} é inválida`);
      }
    }
  }
  if (new Set(families).size !== families.length) {
    errors.push("famílias de receita precisam ser disjuntas");
  }
  if (
    config?.audio?.sampleRate !== 16_000 ||
    config?.audio?.futureSamplesAllowed !== 0 ||
    !Number.isSafeInteger(config?.task?.shadowDecisionMs) ||
    config.task.shadowDecisionMs < 1 ||
    config.task.shadowDecisionMs > config.audio.maximumDecisionMs
  ) {
    errors.push("contrato causal de áudio é inválido");
  }
  return { valid: errors.length === 0, errors };
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

function seedFor(...parts) {
  return Number.parseInt(
    sha256(Buffer.from(parts.join("/"), "utf8")).slice(0, 8),
    16
  );
}

export async function buildExp0016SpeakerRelevanceDataset(options = {}) {
  const configPath = resolve(
    PROJECT_ROOT,
    options.config ?? DEFAULTS.config
  );
  const configBytes = await readFile(configPath);
  const config = JSON.parse(configBytes.toString("utf8"));
  const configValidation = validateConfig(config);
  if (!configValidation.valid) {
    throw new Error(
      `configuração inválida: ${configValidation.errors.join("; ")}`
    );
  }
  const [sourceBytes, calibrationBytes] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, config.source.manifest)),
    readFile(resolve(PROJECT_ROOT, config.calibration.report))
  ]);
  const source = JSON.parse(sourceBytes.toString("utf8"));
  const calibration = JSON.parse(calibrationBytes.toString("utf8"));
  const sourceValidation = validateExp0016SourceManifest(source);
  if (!sourceValidation.valid) {
    throw new Error(
      `fonte inválida: ${sourceValidation.errors.join("; ")}`
    );
  }
  if (
    calibration?.campaignComplete !== true ||
    calibration?.experimentId !== config.calibration.packId ||
    calibration?.aggregate?.packSha256 !== config.calibration.packSha256 ||
    calibration?.aggregate?.scoring?.preferenceResolution?.rubricId !==
      config.calibration.resolutionRubricId ||
    calibration?.aggregate?.readyForDirectModelFit !== false
  ) {
    throw new Error("calibração EXP-0015 incompatível");
  }
  const sourceFiles = new Map();
  for (const file of source.files) {
    const wave = await readFile(resolve(PROJECT_ROOT, file.relativePath));
    if (`sha256:${sha256(wave)}` !== file.waveSha256) {
      throw new Error(`${file.fileName}: WAV fonte divergente`);
    }
    const decoded = decodeWaveToPcm16(wave, {
      targetSampleRate: config.audio.sampleRate
    });
    if (`sha256:${sha256(decoded.pcm)}` !== file.decodedPcmSha256) {
      throw new Error(`${file.fileName}: PCM fonte divergente`);
    }
    sourceFiles.set(file.fileName, { file, pcm: decoded.pcm });
  }

  const examples = [];
  for (const split of ["train", "development", "holdout"]) {
    const selected = source.files.filter((file) => file.partition === split);
    for (const [sourceIndex, file] of selected.entries()) {
      const sourceEntry = sourceFiles.get(file.fileName);
      const secondaryFile = selected[(sourceIndex + 1) % selected.length];
      const secondaryEntry = sourceFiles.get(secondaryFile.fileName);
      for (const recipe of config.splits[split]) {
        const rendered = renderSpeakerRelevanceRecipe({
          ...recipe,
          sourcePcm: sourceEntry.pcm,
          secondaryPcm: recipe.secondary
            ? secondaryEntry.pcm
            : null,
          sampleRate: config.audio.sampleRate,
          durationMs: config.audio.durationMs,
          seed: seedFor(config.id, split, recipe.id, file.fileName)
        });
        const featureSet = extractSpeakerRelevanceFeatures(rendered);
        const wave = encodePcm16Wave(rendered.pcm, {
          sampleRate: rendered.sampleRate,
          channels: 1
        });
        const artifactPath =
          `${options.audioRoot ?? DEFAULTS.audioRoot}/` +
          `${split}--${recipe.id}--${file.fileName}`;
        await writeOrCheck(
          resolve(PROJECT_ROOT, artifactPath),
          wave,
          options.check ?? false
        );
        const measurement = measurePcm16(rendered.pcm, {
          sampleRate: rendered.sampleRate
        });
        if (measurement.clippedSamples > 0) {
          throw new Error(`${artifactPath}: clipping detectado`);
        }
        examples.push({
          exampleId:
            `${split}/${recipe.id}/${file.fileName.replace(/\.wav$/u, "")}`,
          split,
          recipeFamily: recipe.id,
          recipeSha256: `sha256:${canonicalSha256(recipe)}`,
          sourceFileName: file.fileName,
          sourcePartition: file.partition,
          upstreamSplit: file.upstreamSplit,
          sourceWaveSha256: file.waveSha256,
          sourceGender: file.gender,
          secondarySourceFileName: recipe.secondary
            ? secondaryFile.fileName
            : null,
          fitEligibility: "fit-eligible",
          features: [...featureSet.values],
          label: recipe.label,
          labelSource: {
            kind: "calibration-derived-procedural-label",
            ref: config.calibration.packId,
            version: config.calibration.resolutionRubricId,
            humanDirectLabel: false
          },
          causalWindow: { ...featureSet.window },
          diagnostics: { ...featureSet.diagnostics },
          artifact: {
            path: artifactPath,
            waveSha256: `sha256:${sha256(wave)}`,
            pcmSha256: `sha256:${sha256(rendered.pcm)}`,
            sampleRate: rendered.sampleRate,
            sampleCount: rendered.pcm.length / 2,
            clippedSamples: measurement.clippedSamples
          }
        });
      }
    }
  }

  const splits = Object.fromEntries(
    ["train", "development", "holdout"].map((split) => {
      const selected = examples.filter((example) => example.split === split);
      return [split, {
        sourceClips: new Set(
          selected.map((example) => example.sourceFileName)
        ).size,
        recipeFamilies: config.splits[split].map((recipe) => recipe.id),
        examples: selected.length,
        labels: Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map((label) => [
          label,
          selected.filter((example) => example.label === label).length
        ]))
      }];
    })
  );
  const dataset = finalizeSpeakerRelevanceDataset({
    schemaVersion: "speaker-relevance-dataset-v1",
    datasetId: config.id,
    locale: config.locale,
    experimentConfig: {
      path: options.config ?? DEFAULTS.config,
      sha256: `sha256:${sha256(configBytes)}`
    },
    source: {
      manifestPath: config.source.manifest,
      manifestSha256: source.manifestSha256,
      fileSha256: `sha256:${sha256(sourceBytes)}`,
      dataset: source.upstream.dataset,
      license: source.upstream.license,
      attribution: source.upstream.attribution,
      fitEligibility: "fit-eligible",
      selectedClips: source.files.length
    },
    calibration: {
      reportPath: config.calibration.report,
      reportSha256: `sha256:${sha256(calibrationBytes)}`,
      packId: config.calibration.packId,
      packSha256: config.calibration.packSha256,
      resolutionRubricId: config.calibration.resolutionRubricId,
      usedForFit: false,
      fitExamples: 0,
      role: "policy-direction-and-human-evaluation-anchor-only"
    },
    retention: {
      rawAudioInGit: false,
      transformedAudioInGit: false,
      transcriptsInGit: false,
      committedFeaturesReproduceCheckpoint: true
    },
    featureVersion: SPEAKER_RELEVANCE_FEATURE_VERSION,
    featureNames: [...SPEAKER_RELEVANCE_FEATURES],
    classes: [...SPEAKER_RELEVANCE_CLASSES],
    labelPolicy: {
      kind: "calibration-derived-procedural-proxy",
      background: "CONTINUE_OUTPUT candidate",
      directed: "DEFER_TO_DETERMINISTIC",
      ambiguous: "excluded-from-singular-fit"
    },
    splits,
    examples
  });
  const validation = validateSpeakerRelevanceDataset(dataset);
  if (!validation.valid) {
    throw new Error(`dataset inválido: ${validation.errors.join("; ")}`);
  }
  return { config, dataset, validation };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildExp0016SpeakerRelevanceDataset(options);
  const bytes = Buffer.from(`${JSON.stringify(result.dataset, null, 2)}\n`);
  await writeOrCheck(
    resolve(PROJECT_ROOT, options.out),
    bytes,
    options.check
  );
  console.log(
    `EXP-0016 dataset ${options.check ? "CHECK" : "BUILD"}: ` +
      `${result.dataset.examples.length} exemplos, ` +
      `${result.dataset.source.selectedClips} fontes, ` +
      result.dataset.datasetSha256
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
