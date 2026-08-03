import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0019_INSTRUMENTATION_FREEZE_SCHEMA =
  "exp-0019-instrumentation-freeze-v1";

export const EXP0019_INSTRUMENTATION_FREEZE_PATH =
  "eval/commitments/exp-0019-instrumentation-freeze-v0.1.json";

export const EXP0019_AUDIO_ATTEMPT_SCHEMA =
  "exp-0019-audio-materialization-attempt-v1";

export const EXP0019_AUDIO_ATTEMPT_PATH =
  "eval/commitments/exp-0019-audio-attempt-v0.1.json";

export const EXP0019_TTS_RANDOM_SEED = 190019;
export const EXP0019_TTS_RANDOM_SEED_STRATEGY =
  "sha256-stream-segment-numpy-v1";
export const EXP0019_TTS_PYTHON_PACKAGES = deepFreeze({
  PyYAML: "6.0.3",
  anyio: "4.14.2",
  certifi: "2026.7.22",
  cffi: "2.1.0",
  click: "8.4.2",
  filelock: "3.32.2",
  flatbuffers: "25.12.19",
  fsspec: "2026.7.0",
  h11: "0.16.0",
  "hf-xet": "1.5.2",
  httpcore: "1.0.9",
  httpx: "0.28.1",
  huggingface_hub: "1.26.0",
  idna: "3.18",
  numpy: "2.5.1",
  onnxruntime: "1.28.0",
  packaging: "26.2",
  protobuf: "7.35.1",
  pycparser: "3.0",
  soundfile: "0.14.0",
  supertonic: "1.3.1",
  tqdm: "4.70.0",
  typing_extensions: "4.16.0"
});

export const EXP0019_FROZEN_ARTIFACT_PATHS = Object.freeze({
  preregistration:
    "docs/experiments/EXP-0019-causal-audio-context-bridge.md",
  plan: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
  browserCheckpoint: "web/context-relevance-checkpoint.json",
  sourceCheckpoint: "eval/checkpoints/exp-0018-context-v0.1.json"
});

export const EXP0019_CRITICAL_SOURCE_PATHS = Object.freeze([
  ".gitignore",
  "package.json",
  "scripts/build-exp-0019-causal-audio-plan.mjs",
  "scripts/build-exp-0019-web-checkpoint.mjs",
  "scripts/freeze-exp-0019-instrumentation.mjs",
  "scripts/lib/materialize-exp-0019-supertonic.py",
  "scripts/materialize-exp-0019-audio.mjs",
  "scripts/report-exp-0019-causal-audio.mjs",
  "scripts/run-exp-0019-node-replay.mjs",
  "scripts/smoke-exp-0019-browser.mjs",
  "src/asr/pcm.mjs",
  "src/audio/wav.mjs",
  "src/cli/serve.mjs",
  "src/eval/exp-0018-context.mjs",
  "src/eval/exp-0018-training.mjs",
  "src/eval/exp-0019-analysis.mjs",
  "src/eval/exp-0019-boundary.mjs",
  "src/eval/exp-0019-causal-audio-bridge.mjs",
  "src/eval/exp-0019-replay.mjs",
  "src/eval/factory/canonical-hash.mjs",
  "src/learning/softmax-classifier.mjs",
  "tests/exp-0019-analysis.test.mjs",
  "tests/exp-0019-audio-materializer.test.mjs",
  "tests/exp-0019-boundary.test.mjs",
  "tests/exp-0019-browser-integration.test.mjs",
  "tests/exp-0019-browser-runner.test.mjs",
  "tests/exp-0019-browser-shadow.test.mjs",
  "tests/exp-0019-contract.test.mjs",
  "tests/exp-0019-replay.test.mjs",
  "web/app.mjs",
  "web/context-relevance-shadow.mjs",
  "web/output-interruption-lifecycle.mjs"
].toSorted());

export const EXP0019_TTS_CONFIG = deepFreeze({
  engine: "supertonic",
  model: "supertonic-3",
  sdkVersion: "1.3.1",
  language: "pt",
  totalSteps: 8,
  speed: 1.05,
  outputSampleRate: 16_000,
  assistantSegmentsSynthesizedSeparately: true,
  randomness: {
    baseSeed: EXP0019_TTS_RANDOM_SEED,
    strategy: EXP0019_TTS_RANDOM_SEED_STRATEGY,
    numpySeededBeforeEachSynthesis: true
  },
  pythonPackages: EXP0019_TTS_PYTHON_PACKAGES,
  voiceStyles: {
    assistant: "F4",
    nonAssistant: "M4"
  },
  execution: {
    networkAllowed: false,
    autoDownload: false,
    paidApiCalls: 0,
    gpuRuns: 0
  }
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const EXPECTED_MODEL_FILES = Object.freeze([
  "LICENSE",
  "config.json",
  "onnx/duration_predictor.onnx",
  "onnx/text_encoder.onnx",
  "onnx/tts.json",
  "onnx/unicode_indexer.json",
  "onnx/vector_estimator.onnx",
  "onnx/vocoder.onnx",
  "voice_styles/F4.json",
  "voice_styles/M4.json"
].toSorted());

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, expected) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...expected].sort());
}

function withoutHash(value) {
  const core = structuredClone(value ?? {});
  delete core.instrumentationFreezeSha256;
  return core;
}

function validArtifact(record, canonicalRequired) {
  return exactKeys(
    record,
    canonicalRequired
      ? ["path", "fileSha256", "canonicalSha256"]
      : ["path", "fileSha256"]
  ) &&
    typeof record.path === "string" && record.path.length > 0 &&
    HASH_PATTERN.test(record.fileSha256 ?? "") &&
    (!canonicalRequired || HASH_PATTERN.test(record.canonicalSha256 ?? ""));
}

function structureErrors(freeze) {
  const errors = [];
  if (
    !exactKeys(freeze, [
      "artifacts",
      "authority",
      "boundary",
      "criticalSources",
      "experimentId",
      "instrumentationFreezeSha256",
      "nodeVersion",
      "runnerSourceCommit",
      "schemaVersion",
      "status",
      "tts"
    ]) ||
    freeze?.schemaVersion !== EXP0019_INSTRUMENTATION_FREEZE_SCHEMA ||
    freeze?.experimentId !== "EXP-0019" ||
    freeze?.status !== "frozen-before-audio-materialization" ||
    !COMMIT_PATTERN.test(freeze?.runnerSourceCommit ?? "") ||
    typeof freeze?.nodeVersion !== "string" ||
    freeze.nodeVersion.length === 0
  ) {
    errors.push("identidade, estado ou commit do freeze incompatível");
  }
  if (
    freeze?.instrumentationFreezeSha256 !==
      `sha256:${canonicalSha256(withoutHash(freeze))}`
  ) {
    errors.push("instrumentationFreezeSha256 divergente");
  }
  if (
    !exactKeys(freeze?.artifacts, [
      "browserCheckpoint",
      "plan",
      "preregistration",
      "sourceCheckpoint"
    ]) ||
    !validArtifact(freeze?.artifacts?.preregistration, false) ||
    !validArtifact(freeze?.artifacts?.plan, true) ||
    !validArtifact(freeze?.artifacts?.browserCheckpoint, true) ||
    !validArtifact(freeze?.artifacts?.sourceCheckpoint, true) ||
    Object.entries(EXP0019_FROZEN_ARTIFACT_PATHS).some(
      ([name, path]) => freeze?.artifacts?.[name]?.path !== path
    )
  ) {
    errors.push("artefatos congelados são incompatíveis");
  }
  if (
    !exactKeys(freeze?.tts, [
      "config",
      "configCanonicalSha256",
      "modelArtifactBinding",
      "toolchainBinding"
    ]) ||
    !same(freeze?.tts?.config, EXP0019_TTS_CONFIG) ||
    freeze?.tts?.configCanonicalSha256 !==
      `sha256:${canonicalSha256(EXP0019_TTS_CONFIG)}`
  ) {
    errors.push("configuração TTS divergiu");
  }
  if (
    !exactKeys(freeze?.tts?.toolchainBinding, [
      "command",
      "executableSha256",
      "version"
    ]) ||
    freeze?.tts?.toolchainBinding?.command !== "uvx" ||
    !HASH_PATTERN.test(
      freeze?.tts?.toolchainBinding?.executableSha256 ?? ""
    ) ||
    typeof freeze?.tts?.toolchainBinding?.version !== "string" ||
    !freeze.tts.toolchainBinding.version.startsWith("uvx ")
  ) {
    errors.push("binding do executável uvx é incompatível");
  }
  const modelFiles = freeze?.tts?.modelArtifactBinding?.files;
  if (
    !exactKeys(freeze?.tts?.modelArtifactBinding, [
      "canonicalSha256",
      "files"
    ]) ||
    !same(Object.keys(modelFiles ?? {}).sort(), EXPECTED_MODEL_FILES) ||
    Object.values(modelFiles ?? {}).some(
      (value) => !HASH_PATTERN.test(value ?? "")
    ) ||
    freeze?.tts?.modelArtifactBinding?.canonicalSha256 !==
      `sha256:${canonicalSha256(modelFiles ?? {})}`
  ) {
    errors.push("binding dos pesos TTS é incompatível");
  }
  const sources = freeze?.criticalSources;
  if (
    !Array.isArray(sources) ||
    sources.length !== EXP0019_CRITICAL_SOURCE_PATHS.length ||
    !same(sources.map((record) => record?.path),
      EXP0019_CRITICAL_SOURCE_PATHS) ||
    sources.some((record) =>
      !exactKeys(record, ["fileSha256", "path"]) ||
      !HASH_PATTERN.test(record.fileSha256 ?? "")
    )
  ) {
    errors.push("fontes críticas não correspondem ao allowlist congelado");
  }
  if (
    !exactKeys(freeze?.boundary, [
      "audioMaterializationsBeforeFreeze",
      "browserCampaignsBeforeFreeze",
      "canProduceEffects",
      "nodeReplaysBeforeFreeze",
      "paidApiCalls",
      "rawAudioCommitted"
    ]) ||
    freeze?.boundary?.audioMaterializationsBeforeFreeze !== 0 ||
    freeze?.boundary?.nodeReplaysBeforeFreeze !== 0 ||
    freeze?.boundary?.browserCampaignsBeforeFreeze !== 0 ||
    freeze?.boundary?.paidApiCalls !== 0 ||
    freeze?.boundary?.rawAudioCommitted !== false ||
    freeze?.boundary?.canProduceEffects !== false ||
    !exactKeys(freeze?.authority, ["canProduceEffects", "mode"]) ||
    freeze?.authority?.mode !== "offline-shadow-only" ||
    freeze?.authority?.canProduceEffects !== false
  ) {
    errors.push("fronteira de execução ou autoridade incompatível");
  }
  return errors;
}

export function createExp0019InstrumentationFreeze(input = {}) {
  const core = {
    schemaVersion: EXP0019_INSTRUMENTATION_FREEZE_SCHEMA,
    experimentId: "EXP-0019",
    status: "frozen-before-audio-materialization",
    runnerSourceCommit: input.runnerSourceCommit,
    nodeVersion: input.nodeVersion,
    artifacts: structuredClone(input.artifacts),
    tts: {
      config: structuredClone(EXP0019_TTS_CONFIG),
      configCanonicalSha256:
        `sha256:${canonicalSha256(EXP0019_TTS_CONFIG)}`,
      modelArtifactBinding: structuredClone(input.modelArtifactBinding),
      toolchainBinding: structuredClone(input.toolchainBinding)
    },
    criticalSources: structuredClone(input.criticalSources),
    boundary: {
      audioMaterializationsBeforeFreeze: 0,
      nodeReplaysBeforeFreeze: 0,
      browserCampaignsBeforeFreeze: 0,
      paidApiCalls: 0,
      rawAudioCommitted: false,
      canProduceEffects: false
    },
    authority: {
      mode: "offline-shadow-only",
      canProduceEffects: false
    }
  };
  const freeze = deepFreeze({
    ...core,
    instrumentationFreezeSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = validateExp0019InstrumentationFreeze(freeze);
  if (!validation.valid) {
    throw new TypeError(
      `freeze EXP-0019 inválido: ${validation.errors.join("; ")}`
    );
  }
  return freeze;
}

export function validateExp0019InstrumentationFreeze(freeze) {
  let errors;
  try {
    errors = structureErrors(freeze);
  } catch (error) {
    errors = [`freeze malformado: ${error.message}`];
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}
