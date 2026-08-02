import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";
import {
  EXP0017_SUPERTONIC_SOURCE_SCHEMA,
  finalizeExp0017SupertonicSourceManifest,
  validateExp0017SupertonicPlan,
  validateExp0017SupertonicSourceManifest
} from "../src/eval/exp-0017-supertonic.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const MATERIALIZER = resolve(
  PROJECT_ROOT,
  "scripts/lib/materialize-supertonic-scenes.py"
);
const DEFAULTS = Object.freeze({
  plan: "eval/experiments/exp-0017-supertonic-scenes.pt-BR.json",
  manifest: "eval/sources/exp-0017-supertonic-v0.1.json",
  outputRoot: "eval/generated/exp-0017/sources/supertonic",
  modelDir: process.env.SUPERTONIC_MODEL_DIR ??
    join(homedir(), ".cache", "supertonic3")
});
const MODEL_FILES = Object.freeze([
  "LICENSE",
  "config.json",
  "onnx/duration_predictor.onnx",
  "onnx/text_encoder.onnx",
  "onnx/tts.json",
  "onnx/unicode_indexer.json",
  "onnx/vector_estimator.onnx",
  "onnx/vocoder.onnx",
  ...["F1", "F2", "F3", "F4", "M1", "M2", "M3", "M4"].map(
    (voice) => `voice_styles/${voice}.json`
  )
]);

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (![
      "--plan",
      "--manifest",
      "--output-root",
      "--model-dir"
    ].includes(argument)) {
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

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function modelArtifactBinding(modelDir) {
  const files = {};
  for (const path of MODEL_FILES) {
    const absolute = resolve(modelDir, path);
    if (!await stat(absolute).catch(() => null)) {
      throw new Error(`artefato Supertonic ausente: ${absolute}`);
    }
    files[path] = `sha256:${await sha256File(absolute)}`;
  }
  return Object.freeze({
    files: Object.freeze(files),
    canonicalSha256: `sha256:${canonicalSha256(files)}`
  });
}

async function verifyLocalManifest(path) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const validation = validateExp0017SupertonicSourceManifest(manifest);
  const errors = [...validation.errors];
  for (const file of manifest.files ?? []) {
    const wave = await readFile(resolve(PROJECT_ROOT, file.relativePath))
      .catch(() => null);
    if (wave === null || `sha256:${sha256(wave)}` !== file.waveSha256) {
      errors.push(`${file.sceneId}: WAV ausente ou divergente`);
      continue;
    }
    const decoded = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 });
    if (
      `sha256:${sha256(decoded.pcm)}` !== file.pcmSha256 ||
      decoded.pcm.length / 2 !== file.sampleCount
    ) {
      errors.push(`${file.sceneId}: PCM divergente`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `fonte Supertonic EXP-0017 inválida: ${errors.join("; ")}`
    );
  }
  return manifest;
}

export async function materializeExp0017SupertonicSources(options = {}) {
  const planPath = resolve(PROJECT_ROOT, options.plan ?? DEFAULTS.plan);
  const planBytes = await readFile(planPath);
  const plan = JSON.parse(planBytes.toString("utf8"));
  const planValidation = validateExp0017SupertonicPlan(plan);
  if (!planValidation.valid) {
    throw new Error(
      `plano Supertonic inválido: ${planValidation.errors.join("; ")}`
    );
  }
  const outputRoot = resolve(
    PROJECT_ROOT,
    options.outputRoot ?? DEFAULTS.outputRoot
  );
  const modelDir = resolve(options.modelDir ?? DEFAULTS.modelDir);
  const binding = await modelArtifactBinding(modelDir);
  if (
    binding.files.LICENSE !== plan.generator.license.modelLicenseSha256
  ) {
    throw new Error("licença do modelo Supertonic diverge do plano");
  }
  await mkdir(outputRoot, { recursive: true });
  await execFile("uvx", [
    "--from",
    "supertonic==1.3.1",
    "python",
    MATERIALIZER,
    "--plan",
    planPath,
    "--output-root",
    outputRoot,
    "--model-dir",
    modelDir
  ], {
    timeout: 20 * 60_000,
    maxBuffer: 8 * 1024 * 1024
  });
  const files = [];
  for (const partition of ["train", "development"]) {
    for (const scene of plan.scenes[partition]) {
      const wavePath = resolve(outputRoot, partition, `${scene.id}.wav`);
      const wave = await readFile(wavePath);
      const decoded = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 });
      files.push({
        partition,
        sceneId: scene.id,
        textSha256: `sha256:${sha256(Buffer.from(scene.text, "utf8"))}`,
        label: scene.label,
        conversationFamily: scene.conversationFamily,
        intendedContext: scene.intendedContext,
        templateGroupId: scene.templateGroupId,
        semanticGroupId: scene.semanticGroupId,
        voiceStyle: scene.voiceStyle,
        speakerGroupId: `supertonic3:${scene.voiceStyle}`,
        voiceProfileId: `supertonic3:${scene.voiceStyle}`,
        sourceArtifactId: `supertonic3:${scene.id}`,
        lineageRootId: `supertonic3:${scene.id}`,
        relativePath: relative(PROJECT_ROOT, wavePath),
        waveSha256: `sha256:${sha256(wave)}`,
        pcmSha256: `sha256:${sha256(decoded.pcm)}`,
        sourceSampleRate: decoded.source.sampleRate,
        sampleRate: decoded.sampleRate,
        sampleCount: decoded.pcm.length / 2
      });
    }
  }
  const core = {
    schemaVersion: EXP0017_SUPERTONIC_SOURCE_SCHEMA,
    sourceId: "supertonic3-pt-local-exp0017-v0.1",
    experimentId: "exp-0017-safe-veto-core-v0.1",
    locale: "pt-BR",
    role: "train-development-synthetic-procedural-source",
    plan: {
      path: options.plan ?? DEFAULTS.plan,
      fileSha256: `sha256:${sha256(planBytes)}`,
      canonicalSha256: `sha256:${canonicalSha256(plan)}`
    },
    source: {
      kind: "synthetic-ai",
      model: plan.generator.model,
      revision: plan.generator.revision,
      languageCode: plan.generator.languageCode,
      license: plan.generator.license.model,
      sdkLicense: plan.generator.license.sdk,
      sdkVersion: plan.generator.license.sdkVersion,
      execution: "local-offline",
      paidApiCalls: 0,
      modelArtifactBinding: binding,
      syntheticDisclosure: plan.generator.syntheticDisclosure
    },
    synthesis: {
      totalSteps: 8,
      speed: 1.05,
      language: "pt",
      outputSampleRate: plan.generator.sampleRate
    },
    selection: {
      selected: files.length,
      splits: Object.fromEntries(["train", "development"].map(
        (partition) => [
          partition,
          {
            sources: files.filter(
              (file) => file.partition === partition
            ).length,
            labels: Object.fromEntries(LABELS_FROM_FILES(files).map(
              (label) => [
                label,
                files.filter((file) =>
                  file.partition === partition && file.label === label
                ).length
              ]
            )),
            voiceProfiles: [...new Set(files.filter(
              (file) => file.partition === partition
            ).map((file) => file.voiceProfileId))].sort()
          }
        ]
      ))
    },
    retention: {
      rawAudioInGit: false,
      sourceManifestInGit: true,
      modelWeightsInGit: false
    },
    limitations: [
      "voz sintética não sustenta alegação de naturalidade humana",
      "português genérico do modelo não sustenta alegação de sotaque PT-BR",
      "fonte sintética é proibida no holdout-core"
    ],
    files
  };
  const manifest = finalizeExp0017SupertonicSourceManifest(core);
  const validation = validateExp0017SupertonicSourceManifest(manifest);
  if (!validation.valid) {
    throw new Error(
      `manifest Supertonic inválido: ${validation.errors.join("; ")}`
    );
  }
  const manifestPath = resolve(
    PROJECT_ROOT,
    options.manifest ?? DEFAULTS.manifest
  );
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function LABELS_FROM_FILES(files) {
  return [...new Set(files.map((file) => file.label))].sort();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(PROJECT_ROOT, options.manifest);
  const manifest = options.check
    ? await verifyLocalManifest(manifestPath)
    : await materializeExp0017SupertonicSources(options);
  console.log(
    `EXP-0017 Supertonic ${options.check ? "CHECK" : "BUILD"}: ` +
      `${manifest.files.length} fontes sintéticas locais, ` +
      `${manifest.selection.splits.train.voiceProfiles.length}+` +
      `${manifest.selection.splits.development.voiceProfiles.length} ` +
      `perfis disjuntos, ${manifest.manifestSha256}`
  );
  console.log(
    "OpenRAIL-M/SDK MIT; zero nuvem/API paga; proibido no holdout-core."
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
