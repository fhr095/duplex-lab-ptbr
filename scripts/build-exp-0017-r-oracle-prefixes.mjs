import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { encodePcm16Wave } from "../src/audio/wav.mjs";
import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import {
  EXP0017_R_ALIGNMENT_INPUT_POLICY,
  EXP0017_R_DECISION_SAMPLES,
  EXP0017_R_ELIGIBLE_THROUGH_SAMPLE,
  EXP0017_R_MARGIN_SAMPLES,
  EXP0017_R_ORACLE_PREFIX_MAP_SCHEMA,
  createExp0017ROracleAlignmentRequest,
  deriveExp0017ROraclePrefixEntry,
  finalizeExp0017ROraclePrefixMap,
  validateExp0017ROracleAlignmentRequest,
  validateExp0017ROraclePrefixMap,
  validateExp0017RRawAlignment
} from "../src/eval/exp-0017-r-oracle.mjs";
import { findPcm16SpeechOnset } from
  "../src/eval/speaker-relevance-features.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const ALIGNER = resolve(
  PROJECT_ROOT,
  "scripts/lib/align-exp-0017-r-oracle.py"
);
const DEFAULTS = Object.freeze({
  plan: "eval/experiments/exp-0017-supertonic-scenes.pt-BR.json",
  sourceManifest: "eval/sources/exp-0017-supertonic-v0.1.json",
  request:
    "eval/generated/exp-0017/r/oracle-alignment-request-v0.1.json",
  raw:
    "eval/generated/exp-0017/r/oracle-alignment-whisper-small-v0.1.json",
  output: "eval/datasets/exp-0017-r-oracle-prefixes-v0.1.json",
  python: ".venv/bin/python",
  modelDir: "eval/generated/asr/models",
  threads: 4
});

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false, reuseRaw: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--reuse-raw") {
      options.reuseRaw = true;
      continue;
    }
    if (![
      "--plan",
      "--source-manifest",
      "--request",
      "--raw",
      "--output",
      "--python",
      "--model-dir",
      "--threads"
    ].includes(argument)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const rawValue = args[++index];
    if (rawValue === undefined) {
      throw new TypeError(`${argument} precisa de valor`);
    }
    const field = argument.slice(2).replace(
      /-([a-z])/gu,
      (_, letter) => letter.toUpperCase()
    );
    options[field] = field === "threads"
      ? Number.parseInt(rawValue, 10)
      : rawValue;
  }
  if (!Number.isSafeInteger(options.threads) || options.threads < 1) {
    throw new TypeError("threads precisa ser inteiro positivo");
  }
  return options;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function repositoryPath(path, label) {
  const target = resolve(PROJECT_ROOT, path);
  const fromRoot = relative(PROJECT_ROOT, target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    fromRoot.length === 0
  ) {
    throw new TypeError(`${label} precisa ficar dentro do repositório`);
  }
  return target;
}

function assertGeneratedPath(path, label) {
  const absolute = repositoryPath(path, label);
  const generated = resolve(PROJECT_ROOT, "eval/generated");
  const fromGenerated = relative(generated, absolute);
  if (
    fromGenerated === ".." ||
    fromGenerated.startsWith(`..${sep}`) ||
    fromGenerated.length === 0
  ) {
    throw new TypeError(`${label} precisa ficar em eval/generated`);
  }
  return absolute;
}

async function readJson(relativePath, label) {
  const path = repositoryPath(relativePath, label);
  const bytes = await readFile(path);
  return { path, bytes, value: JSON.parse(bytes.toString("utf8")) };
}

async function writeOrCheck(path, value, check) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    const observed = await readFile(path, "utf8").catch(() => null);
    if (observed !== content) {
      throw new Error(`artefato ausente ou divergente: ${path}`);
    }
    return Buffer.from(content);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return Buffer.from(content);
}

async function writeBytesOrCheck(path, bytes, check) {
  if (check) {
    const observed = await readFile(path).catch(() => null);
    if (!observed || !observed.equals(bytes)) {
      throw new Error(`artefato causal ausente ou divergente: ${path}`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function sceneReferences(plan) {
  return new Map(["train", "development"].flatMap((partition) =>
    plan.scenes[partition].map((scene) => [scene.id, {
      partition,
      text: scene.text
    }])
  ));
}

export function createExp0017RCausalTruncatedInput(input = {}) {
  const source = input.source;
  const wave = input.wave;
  const truncatedRelativePath = input.truncatedRelativePath;
  if (
    !source ||
    typeof source.sceneId !== "string" ||
    !["train", "development"].includes(source.partition) ||
    !Buffer.isBuffer(wave) ||
    typeof truncatedRelativePath !== "string" ||
    !truncatedRelativePath.startsWith(
      "eval/generated/exp-0017/r/truncated/"
    )
  ) {
    throw new TypeError("fonte para truncagem causal inválida");
  }
  if (sha256(wave) !== source.waveSha256) {
    throw new Error(`${source.sceneId}: waveSha256 divergente`);
  }
  const decoded = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 });
  if (sha256(decoded.pcm) !== source.pcmSha256) {
    throw new Error(`${source.sceneId}: pcmSha256 divergente`);
  }
  const sourceOnsetSample = findPcm16SpeechOnset(decoded.pcm, {
    sampleRate: 16_000
  });
  if (sourceOnsetSample === null) {
    throw new Error(`${source.sceneId}: onset não encontrado`);
  }
  const inputStartSample = 0;
  const acceptedThroughSample =
    sourceOnsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE;
  const inputEndSampleExclusive =
    sourceOnsetSample + EXP0017_R_DECISION_SAMPLES;
  if (decoded.pcm.length / 2 < inputEndSampleExclusive) {
    throw new Error(`${source.sceneId}: fonte termina antes da fronteira causal`);
  }
  const truncatedPcm = Buffer.from(decoded.pcm.subarray(
    inputStartSample * 2,
    inputEndSampleExclusive * 2
  ));
  const truncatedWave = encodePcm16Wave(truncatedPcm, {
    sampleRate: 16_000,
    channels: 1
  });
  return Object.freeze({
    descriptor: Object.freeze({
      sceneId: source.sceneId,
      partition: source.partition,
      truncatedRelativePath,
      sourceWaveSha256: source.waveSha256,
      sourcePcmSha256: source.pcmSha256,
      truncatedWaveSha256: sha256(truncatedWave),
      truncatedPcmSha256: sha256(truncatedPcm),
      sourceOnsetSample,
      acceptedThroughSample,
      inputStartSample,
      inputEndSampleExclusive,
      futureSamplesUsed: 0
    }),
    wave: truncatedWave,
    pcm: truncatedPcm
  });
}

async function materializeCausalInputs(sourceManifest, check) {
  const descriptors = [];
  for (const source of sourceManifest.files) {
    const wavePath = repositoryPath(
      source.relativePath,
      `${source.sceneId}.relativePath`
    );
    const wave = await readFile(wavePath);
    const truncatedRelativePath =
      `eval/generated/exp-0017/r/truncated/${source.sceneId}.wav`;
    const truncated = createExp0017RCausalTruncatedInput({
      source,
      wave,
      truncatedRelativePath
    });
    await writeBytesOrCheck(
      repositoryPath(truncatedRelativePath, `${source.sceneId}.truncated`),
      truncated.wave,
      check
    );
    descriptors.push(truncated.descriptor);
  }
  return descriptors;
}

export async function buildExp0017ROraclePrefixMap(options = {}) {
  const paths = {
    plan: options.plan ?? DEFAULTS.plan,
    sourceManifest: options.sourceManifest ?? DEFAULTS.sourceManifest,
    request: options.request ?? DEFAULTS.request,
    raw: options.raw ?? DEFAULTS.raw,
    output: options.output ?? DEFAULTS.output
  };
  const requestPath = assertGeneratedPath(paths.request, "request");
  const rawPath = assertGeneratedPath(paths.raw, "raw alignment");
  const outputPath = repositoryPath(paths.output, "mapa canônico");
  const [planBundle, sourceBundle] = await Promise.all([
    readJson(paths.plan, "plano Supertonic"),
    readJson(paths.sourceManifest, "manifest Supertonic")
  ]);
  const truncatedSources = await materializeCausalInputs(
    sourceBundle.value,
    options.check ?? false
  );
  const request = createExp0017ROracleAlignmentRequest({
    plan: planBundle.value,
    sourceManifest: sourceBundle.value,
    truncatedSources
  });
  const requestValidation = validateExp0017ROracleAlignmentRequest(request);
  if (!requestValidation.valid) {
    throw new Error(requestValidation.errors.join("; "));
  }
  const requestBytes = await writeOrCheck(
    requestPath,
    request,
    options.check ?? false
  );
  const requestFileSha256 = sha256(requestBytes);

  if (!(options.check ?? false) && !(options.reuseRaw ?? false)) {
    const pythonPath = repositoryPath(
      options.python ?? DEFAULTS.python,
      "python local"
    );
    const modelDir = repositoryPath(
      options.modelDir ?? DEFAULTS.modelDir,
      "cache do modelo"
    );
    await execFile(pythonPath, [
      ALIGNER,
      "--request",
      requestPath,
      "--output",
      rawPath,
      "--model-dir",
      modelDir,
      "--threads",
      String(options.threads ?? DEFAULTS.threads)
    ], {
      cwd: PROJECT_ROOT,
      timeout: 20 * 60_000,
      maxBuffer: 8 * 1024 * 1024
    });
  }

  const rawBytes = await readFile(rawPath);
  const raw = JSON.parse(rawBytes.toString("utf8"));
  const rawValidation = validateExp0017RRawAlignment(raw, {
    request,
    requestSha256: requestFileSha256
  });
  if (!rawValidation.valid) {
    throw new Error(
      `alinhamento bruto inválido: ${rawValidation.errors.join("; ")}`
    );
  }
  const references = sceneReferences(planBundle.value);
  const sourceFiles = new Map(sourceBundle.value.files.map((source) => [
    source.sceneId,
    source
  ]));
  const entries = raw.sources.map((rawSource) => {
    const reference = references.get(rawSource.sceneId);
    const source = sourceFiles.get(rawSource.sceneId);
    if (
      reference === undefined ||
      source === undefined ||
      reference.partition !== rawSource.partition
    ) {
      throw new Error(`${rawSource.sceneId}: universo Supertonic divergente`);
    }
    return deriveExp0017ROraclePrefixEntry({
      rawSource,
      referenceText: reference.text
    });
  }).sort((left, right) =>
    ["train", "development"].indexOf(left.partition) -
      ["train", "development"].indexOf(right.partition) ||
    left.sceneId.localeCompare(right.sceneId)
  );

  const map = finalizeExp0017ROraclePrefixMap({
    schemaVersion: EXP0017_R_ORACLE_PREFIX_MAP_SCHEMA,
    experimentId: "exp-0017-r-oracle-v0.1",
    locale: "pt-BR",
    role: "causal-oracle-prefix-development-screen-only",
    boundary: {
      allowedSplits: ["train", "development"],
      holdoutRead: false
    },
    inputs: {
      planFileSha256: sha256(planBundle.bytes),
      sourceManifestFileSha256: sha256(sourceBundle.bytes),
      alignmentRequestFileSha256: requestFileSha256,
      rawAlignmentFileSha256: sha256(rawBytes)
    },
    alignment: {
      engine: "faster-whisper",
      model: "small",
      modelRevision: raw.model.revision,
      fasterWhisperVersion: raw.model.fasterWhisperVersion,
      snapshotFiles: raw.model.snapshotFiles,
      cpuThreads: raw.model.cpuThreads,
      numWorkers: raw.model.numWorkers,
      wordTimestamps: true,
      inputPolicy: EXP0017_R_ALIGNMENT_INPUT_POLICY,
      sampleRate: 16_000,
      decisionSamples: EXP0017_R_DECISION_SAMPLES,
      marginSamples: EXP0017_R_MARGIN_SAMPLES,
      eligibleThroughSample: EXP0017_R_ELIGIBLE_THROUGH_SAMPLE,
      futureSamplesUsed: 0
    },
    sources: entries
  });
  const validation = validateExp0017ROraclePrefixMap(map, {
    planFileSha256: sha256(planBundle.bytes),
    sourceManifestFileSha256: sha256(sourceBundle.bytes),
    alignmentRequestFileSha256: requestFileSha256,
    rawAlignmentFileSha256: sha256(rawBytes),
    sourceManifest: sourceBundle.value
  });
  if (!validation.valid) {
    throw new Error(`mapa-oráculo inválido: ${validation.errors.join("; ")}`);
  }
  await writeOrCheck(outputPath, map, options.check ?? false);
  return { map, rawValidation, validation };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildExp0017ROraclePrefixMap(options);
  console.log(
    `EXP-0017-R oracle ${options.check ? "CHECK" : "BUILD"}: ` +
      `${result.map.sources.length} fontes train/development; ` +
      `${result.map.mapSha256}; zero treino/avaliação.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
