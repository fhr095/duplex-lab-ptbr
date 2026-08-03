import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { inspectWave } from "../src/audio/wav.mjs";
import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_AUDIO_ATTEMPT_SCHEMA,
  EXP0019_CRITICAL_SOURCE_PATHS,
  EXP0019_INSTRUMENTATION_FREEZE_PATH,
  EXP0019_TTS_CONFIG,
  EXP0019_TTS_PYTHON_PACKAGES,
  EXP0019_TTS_RANDOM_SEED,
  EXP0019_TTS_RANDOM_SEED_STRATEGY,
  validateExp0019InstrumentationFreeze
} from
  "../src/eval/exp-0019-boundary.mjs";
import { validateExp0019CausalAudioPlan } from
  "../src/eval/exp-0019-causal-audio-bridge.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";

const execFile = promisify(execFileCallback);
const MODULE_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PYTHON_MATERIALIZER = resolve(
  PROJECT_ROOT,
  "scripts/lib/materialize-exp-0019-supertonic.py"
);
const LOCAL_CACHE_ROOT = resolve(
  process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache")
);

export const EXP0019_AUDIO_MANIFEST_SCHEMA =
  "exp-0019-causal-audio-manifest-v1";
export { EXP0019_AUDIO_ATTEMPT_PATH, EXP0019_AUDIO_ATTEMPT_SCHEMA };
export const EXP0019_SUPERTONIC_REQUIRED_MODEL_FILES = Object.freeze([
  "LICENSE",
  "config.json",
  "onnx/duration_predictor.onnx",
  "onnx/text_encoder.onnx",
  "onnx/tts.json",
  "onnx/unicode_indexer.json",
  "onnx/vector_estimator.onnx",
  "onnx/vocoder.onnx"
]);

const DEFAULTS = Object.freeze({
  plan: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
  freeze: EXP0019_INSTRUMENTATION_FREEZE_PATH,
  attempt: EXP0019_AUDIO_ATTEMPT_PATH,
  manifest: "eval/sources/exp-0019-causal-audio-v0.1.json",
  outputRoot: "eval/generated/exp-0019/audio",
  modelDir: resolve(
    process.env.SUPERTONIC_MODEL_DIR ??
      resolve(LOCAL_CACHE_ROOT, "supertonic3")
  )
});
const VALID_ROLES = new Set(["target", "inbound", "assistant-output"]);
const VALID_STREAM_KINDS = new Set(["target", "inbound", "assistant"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`EXP-0019 audio materializer: ${message}`);
  }
}

function exactKeys(value, expected) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function exp0019SegmentSeed(streamId, segmentKind) {
  invariant(
    typeof streamId === "string" && streamId.length > 0 &&
      typeof segmentKind === "string" && segmentKind.length > 0,
    "seed exige streamId e segmentKind"
  );
  const digest = createHash("sha256").update(
    `EXP-0019|${EXP0019_TTS_RANDOM_SEED}|${streamId}|${segmentKind}`,
    "utf8"
  ).digest();
  return digest.readUInt32BE(0);
}

async function gitBytes(projectRoot, args) {
  const result = await execFile("git", args, {
    cwd: projectRoot,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  });
  return result.stdout;
}

async function gitCommitChangedPaths(projectRoot, commit) {
  const bytes = await gitBytes(projectRoot, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    commit
  ]);
  return bytes.toString("utf8").split(/\r?\n/u).filter(Boolean).toSorted();
}

async function verifyCanonicalGitFreeze(
  projectRoot,
  freeze,
  freezeBytes,
  executionHeadCommit = null
) {
  const headCommit = (await gitBytes(projectRoot, ["rev-parse", "HEAD"]))
    .toString("utf8").trim();
  const executionCommit = executionHeadCommit ?? headCommit;
  const committedFreeze = await gitBytes(projectRoot, [
    "show",
    `HEAD:${EXP0019_INSTRUMENTATION_FREEZE_PATH}`
  ]).catch(() => null);
  invariant(
    Buffer.isBuffer(committedFreeze) && committedFreeze.equals(freezeBytes),
    "freeze canônico precisa estar commitado byte a byte em HEAD"
  );
  await gitBytes(projectRoot, [
    "merge-base",
    "--is-ancestor",
    freeze.runnerSourceCommit,
    "HEAD"
  ]).catch((error) => {
    throw new Error(
      "runnerSourceCommit do freeze não é ancestral de HEAD",
      { cause: error }
    );
  });
  if (executionHeadCommit !== null) {
    invariant(
      /^[a-f0-9]{40}$/u.test(executionHeadCommit),
      "executionHeadCommit precisa ser commit Git completo"
    );
    await gitBytes(projectRoot, [
      "merge-base",
      "--is-ancestor",
      executionHeadCommit,
      "HEAD"
    ]).catch((error) => {
      throw new Error(
        "executionHeadCommit da tentativa não é ancestral de HEAD",
        { cause: error }
      );
    });
    const executionFreeze = await gitBytes(projectRoot, [
      "show",
      `${executionHeadCommit}:${EXP0019_INSTRUMENTATION_FREEZE_PATH}`
    ]).catch(() => null);
    invariant(
      Buffer.isBuffer(executionFreeze) && executionFreeze.equals(freezeBytes),
      "executionHeadCommit não contém o freeze canônico"
    );
  }
  const executionParent = (await gitBytes(projectRoot, [
    "rev-parse",
    `${executionCommit}^`
  ])).toString("utf8").trim();
  invariant(
    executionParent === freeze.runnerSourceCommit,
    "commit do freeze precisa ser filho direto de runnerSourceCommit"
  );
  invariant(
    isDeepStrictEqual(
      await gitCommitChangedPaths(projectRoot, executionCommit),
      [EXP0019_INSTRUMENTATION_FREEZE_PATH]
    ),
    "commit do freeze pode alterar somente o commitment canônico"
  );
  const protectedPaths = [
    EXP0019_INSTRUMENTATION_FREEZE_PATH,
    ...Object.values(freeze.artifacts).map((artifact) => artifact.path),
    ...freeze.criticalSources.map((source) => source.path)
  ];
  const status = await gitBytes(projectRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...new Set(protectedPaths)
  ]);
  invariant(status.length === 0,
    "freeze, artefatos e fontes críticas precisam estar limpos em HEAD");
  const frozenByPath = new Map(freeze.criticalSources.map((source) => [
    source.path,
    source.fileSha256
  ]));
  for (const path of [
    ...EXP0019_CRITICAL_SOURCE_PATHS,
    ...Object.values(freeze.artifacts).map((artifact) => artifact.path)
  ]) {
    const bytes = await gitBytes(projectRoot, [
      "show",
      `${freeze.runnerSourceCommit}:${path}`
    ]).catch(() => null);
    const expected = frozenByPath.get(path) ??
      Object.values(freeze.artifacts).find(
        (artifact) => artifact.path === path
      )?.fileSha256;
    invariant(
      Buffer.isBuffer(bytes) && sha256(bytes) === expected,
      `${path}: runnerSourceCommit não contém os bytes congelados`
    );
    const executionBytes = await gitBytes(projectRoot, [
      "show",
      `${executionCommit}:${path}`
    ]).catch(() => null);
    invariant(
      Buffer.isBuffer(executionBytes) && sha256(executionBytes) === expected,
      `${path}: commit de execução não contém os bytes congelados`
    );
  }
  for (const artifact of Object.values(freeze.artifacts)) {
    const absolutePath = resolve(projectRoot, artifact.path);
    await assertNoSymlinkEscape(
      projectRoot,
      absolutePath,
      `artefato congelado ${artifact.path}`
    );
    const currentBytes = await readFile(absolutePath).catch(() => null);
    invariant(
      Buffer.isBuffer(currentBytes) &&
        sha256(currentBytes) === artifact.fileSha256,
      `${artifact.path}: bytes atuais divergem do freeze`
    );
  }
  return headCommit;
}

async function verifyCommittedAudioAttempt(
  projectRoot,
  attempt,
  attemptBytes,
  materializationCommit = null
) {
  invariant(
    validateExp0019AudioAttempt(attempt),
    "tentativa de áudio commitada é inválida"
  );
  const commit = materializationCommit ??
    (await gitBytes(projectRoot, ["rev-parse", "HEAD"]))
      .toString("utf8").trim();
  invariant(
    /^[a-f0-9]{40}$/u.test(commit),
    "commit da materialização precisa ser SHA Git completo"
  );
  await gitBytes(projectRoot, [
    "merge-base",
    "--is-ancestor",
    commit,
    "HEAD"
  ]).catch((error) => {
    throw new Error(
      "commit da materialização não é ancestral de HEAD",
      { cause: error }
    );
  });
  const parent = (await gitBytes(projectRoot, [
    "rev-parse",
    `${commit}^`
  ])).toString("utf8").trim();
  invariant(
    parent === attempt.executionHeadCommit,
    "commit da tentativa precisa ser filho direto do commit do freeze"
  );
  invariant(
    isDeepStrictEqual(
      await gitCommitChangedPaths(projectRoot, commit),
      [EXP0019_AUDIO_ATTEMPT_PATH]
    ),
    "commit da tentativa pode alterar somente a tentativa canônica"
  );
  const committedBytes = await gitBytes(projectRoot, [
    "show",
    `${commit}:${EXP0019_AUDIO_ATTEMPT_PATH}`
  ]).catch(() => null);
  invariant(
    Buffer.isBuffer(committedBytes) && committedBytes.equals(attemptBytes),
    "commit da materialização não contém a tentativa canônica"
  );
  const status = await gitBytes(projectRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    EXP0019_AUDIO_ATTEMPT_PATH
  ]);
  invariant(status.length === 0, "tentativa precisa estar commitada e limpa");
  return commit;
}

async function criticalSourceSnapshot(
  projectRoot,
  freeze,
  readCriticalSource
) {
  invariant(process.version === freeze.nodeVersion,
    "versão Node diverge do freeze");
  invariant(
    JSON.stringify(freeze.criticalSources.map((source) => source.path)) ===
      JSON.stringify(EXP0019_CRITICAL_SOURCE_PATHS),
    "criticalSources diverge do allowlist canônico"
  );
  const hashes = {};
  for (const source of freeze.criticalSources) {
    const bytes = await readCriticalSource(
      resolve(projectRoot, source.path),
      source.path
    );
    invariant(Buffer.isBuffer(bytes),
      `${source.path}: leitor crítico precisa devolver Buffer`);
    hashes[source.path] = sha256(bytes);
    invariant(hashes[source.path] === source.fileSha256,
      `${source.path}: fonte crítica divergiu do freeze`);
  }
  return Object.freeze(hashes);
}

async function assertNoSymlinkEscape(projectRoot, absolutePath, label) {
  const canonicalRoot = await realpath(projectRoot);
  const relativePath = repositoryPath(projectRoot, absolutePath, label);
  let current = canonicalRoot;
  for (const part of relativePath.split("/").filter(Boolean)) {
    current = resolve(current, part);
    const info = await lstat(current).catch(() => null);
    if (info === null) break;
    invariant(!info.isSymbolicLink(), `${label} não pode atravessar symlink`);
  }
}

export async function assertExp0019ModelCacheOutsideRepository(
  projectRoot,
  modelDir
) {
  const [canonicalRoot, canonicalModelDir] = await Promise.all([
    realpath(projectRoot),
    realpath(modelDir)
  ]);
  const fromRoot = relative(canonicalRoot, canonicalModelDir);
  invariant(
    fromRoot === ".." || fromRoot.startsWith(`..${sep}`),
    "cache Supertonic precisa ficar fora do repositório"
  );
}

async function verifyRawAudioGitBoundary(projectRoot, files) {
  const paths = files.map((file) => file.relativePath);
  invariant(paths.length === 12, "fronteira Git exige exatamente 12 WAVs");
  const tracked = await gitBytes(projectRoot, [
    "ls-files",
    "--",
    ...paths
  ]);
  invariant(
    tracked.length === 0,
    "WAV bruto do EXP-0019 não pode estar rastreado pelo Git"
  );
  for (const path of paths) {
    await gitBytes(projectRoot, [
      "check-ignore",
      "--quiet",
      "--",
      path
    ]).catch((error) => {
      throw new Error(
        `${path}: WAV bruto precisa estar coberto pelo .gitignore`,
        { cause: error }
      );
    });
  }
}

function createAudioAttempt(input) {
  const core = {
    schemaVersion: EXP0019_AUDIO_ATTEMPT_SCHEMA,
    experimentId: "EXP-0019",
    status: "OPENED_FOR_SINGLE_MATERIALIZATION",
    openedAt: input.openedAt,
    executionHeadCommit: input.executionHeadCommit,
    instrumentationFreeze: {
      path: EXP0019_INSTRUMENTATION_FREEZE_PATH,
      fileSha256: input.freezeFileSha256,
      canonicalSha256: input.freeze.instrumentationFreezeSha256,
      runnerSourceCommit: input.freeze.runnerSourceCommit
    },
    plan: {
      path: input.planPath,
      fileSha256: input.planFileSha256,
      canonicalSha256: input.plan.planSha256
    },
    modelArtifactBindingSha256:
      input.modelArtifactBinding.canonicalSha256,
    outputs: {
      rawAudioRoot: input.outputRoot,
      manifest: input.manifestPath
    },
    allowedSyntheses: {
      streams: 12,
      targets: 4,
      inbounds: 4,
      assistantPrefixes: 4,
      assistantTails: 4,
      rerunAllowed: false
    },
    authority: {
      mode: "offline-shadow-only",
      canProduceEffects: false
    }
  };
  return Object.freeze({
    ...core,
    attemptSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0019AudioAttempt(attempt) {
  const core = structuredClone(attempt ?? {});
  delete core.attemptSha256;
  return exactKeys(attempt, [
    "allowedSyntheses",
    "attemptSha256",
    "authority",
    "executionHeadCommit",
    "experimentId",
    "instrumentationFreeze",
    "modelArtifactBindingSha256",
    "openedAt",
    "outputs",
    "plan",
    "schemaVersion",
    "status"
  ]) &&
    attempt.schemaVersion === EXP0019_AUDIO_ATTEMPT_SCHEMA &&
    attempt.experimentId === "EXP-0019" &&
    attempt.status === "OPENED_FOR_SINGLE_MATERIALIZATION" &&
    typeof attempt.openedAt === "string" &&
    Number.isFinite(Date.parse(attempt.openedAt)) &&
    /^[a-f0-9]{40}$/u.test(attempt.executionHeadCommit ?? "") &&
    exactKeys(attempt.instrumentationFreeze, [
      "canonicalSha256",
      "fileSha256",
      "path",
      "runnerSourceCommit"
    ]) &&
    attempt.instrumentationFreeze.path ===
      EXP0019_INSTRUMENTATION_FREEZE_PATH &&
    SHA256_PATTERN.test(
      attempt.instrumentationFreeze.fileSha256 ?? ""
    ) &&
    SHA256_PATTERN.test(
      attempt.instrumentationFreeze.canonicalSha256 ?? ""
    ) &&
    /^[a-f0-9]{40}$/u.test(
      attempt.instrumentationFreeze.runnerSourceCommit ?? ""
    ) &&
    exactKeys(attempt.plan, [
      "canonicalSha256",
      "fileSha256",
      "path"
    ]) &&
    attempt.plan.path === DEFAULTS.plan &&
    SHA256_PATTERN.test(attempt.plan.fileSha256 ?? "") &&
    SHA256_PATTERN.test(attempt.plan.canonicalSha256 ?? "") &&
    SHA256_PATTERN.test(attempt.modelArtifactBindingSha256 ?? "") &&
    exactKeys(attempt.outputs, ["manifest", "rawAudioRoot"]) &&
    attempt.outputs.rawAudioRoot === DEFAULTS.outputRoot &&
    attempt.outputs.manifest === DEFAULTS.manifest &&
    exactKeys(attempt.allowedSyntheses, [
      "assistantPrefixes",
      "assistantTails",
      "inbounds",
      "rerunAllowed",
      "streams",
      "targets"
    ]) &&
    attempt.allowedSyntheses?.streams === 12 &&
    attempt.allowedSyntheses?.targets === 4 &&
    attempt.allowedSyntheses?.inbounds === 4 &&
    attempt.allowedSyntheses?.assistantPrefixes === 4 &&
    attempt.allowedSyntheses?.assistantTails === 4 &&
    attempt.allowedSyntheses?.rerunAllowed === false &&
    exactKeys(attempt.authority, ["canProduceEffects", "mode"]) &&
    attempt.authority?.mode === "offline-shadow-only" &&
    attempt.authority?.canProduceEffects === false &&
    attempt.attemptSha256 === `sha256:${canonicalSha256(core)}`;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return `sha256:${hash.digest("hex")}`;
}

function repositoryPath(projectRoot, absolutePath, label) {
  const value = relative(resolve(projectRoot), resolve(absolutePath));
  invariant(
    value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value),
    `${label} precisa permanecer dentro do projeto`
  );
  return value.split(sep).join("/");
}

function resolveRepositoryPath(projectRoot, path, label) {
  invariant(
    typeof path === "string" && path.length > 0 && !isAbsolute(path),
    `${label} precisa ser path relativo não vazio`
  );
  invariant(!path.includes("\\"), `${label} precisa usar separador POSIX`);
  const absolute = resolve(projectRoot, path);
  repositoryPath(projectRoot, absolute, label);
  return absolute;
}

function assertOutputPath(projectRoot, outputRoot, source) {
  const absolute = resolveRepositoryPath(
    projectRoot,
    source.relativePath,
    `${source.id}.relativePath`
  );
  const fromOutput = relative(outputRoot, absolute);
  invariant(
    fromOutput !== ".." &&
      !fromOutput.startsWith(`..${sep}`) &&
      !isAbsolute(fromOutput),
    `${source.id}.relativePath precisa ficar no output root ignorado`
  );
  invariant(
    source.relativePath.toLowerCase().endsWith(".wav"),
    `${source.id}.relativePath precisa terminar em .wav`
  );
  return absolute;
}

function manifestRoleForStreamKind(kind) {
  return kind === "assistant" ? "assistant-output" : kind;
}

function audioSourcesFromPlan(plan) {
  const voiceStyles = plan.audio.synthesis.voiceStyles;
  return plan.audio.streams.map((stream) => {
    const assistant = stream.kind === "assistant";
    const prefix = assistant ? stream.segments[0] : null;
    const tail = assistant ? stream.segments[1] : null;
    return Object.freeze({
      id: stream.streamId,
      role: manifestRoleForStreamKind(stream.kind),
      speakerSlot: stream.speakerSlot,
      voiceStyle: assistant ? voiceStyles.assistant : voiceStyles.nonAssistant,
      text: assistant ? prefix.text : stream.text,
      tailText: assistant ? tail.text : undefined,
      relativePath: stream.relativePath
    });
  });
}

export function validateExp0019AudioPlan(plan, options = {}) {
  const errors = [];
  const push = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const streams = plan?.audio?.streams;
  const voiceStyles = plan?.audio?.synthesis?.voiceStyles;
  push(
    plan !== null && typeof plan === "object" && !Array.isArray(plan),
    "raiz precisa ser objeto JSON"
  );
  push(
    Array.isArray(streams) && streams.length === 12,
    "audio.streams precisa conter exatamente 12 itens"
  );
  push(
    voiceStyles !== null && typeof voiceStyles === "object" &&
      !Array.isArray(voiceStyles),
    "audio.synthesis.voiceStyles precisa ser objeto"
  );
  push(
    typeof voiceStyles?.assistant === "string" &&
      voiceStyles.assistant.trim().length > 0,
    "audio.synthesis.voiceStyles.assistant precisa ser texto não vazio"
  );
  push(
    typeof voiceStyles?.nonAssistant === "string" &&
      voiceStyles.nonAssistant.trim().length > 0,
    "audio.synthesis.voiceStyles.nonAssistant precisa ser texto não vazio"
  );
  push(
    voiceStyles?.assistant !== voiceStyles?.nonAssistant,
    "vozes assistant e nonAssistant precisam ser distintas"
  );
  push(
    plan?.audio?.synthesis?.randomSeedBase ===
      EXP0019_TTS_RANDOM_SEED &&
      plan?.audio?.synthesis?.randomSeedStrategy ===
        EXP0019_TTS_RANDOM_SEED_STRATEGY,
    "audio.synthesis precisa fixar a estratégia de seed do Supertonic"
  );
  if (!Array.isArray(streams)) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  const ids = new Set();
  const paths = new Set();
  const counts = Object.fromEntries([...VALID_ROLES].map((role) => [role, 0]));
  for (const [index, stream] of streams.entries()) {
    const label = `audio.streams[${index}]`;
    if (!stream || typeof stream !== "object" || Array.isArray(stream)) {
      errors.push(`${label} precisa ser objeto`);
      continue;
    }
    for (const key of ["streamId", "kind", "speakerSlot", "relativePath"]) {
      push(
        typeof stream[key] === "string" && stream[key].trim().length > 0,
        `${label}.${key} precisa ser texto não vazio`
      );
    }
    if (!VALID_STREAM_KINDS.has(stream.kind)) {
      errors.push(`${label}.kind precisa ser target, inbound ou assistant`);
      continue;
    }
    const role = manifestRoleForStreamKind(stream.kind);
    counts[role] += 1;
    const assistant = stream.kind === "assistant";
    push(
      stream.speakerSlot === (assistant ? "assistant" : "non-assistant"),
      `${label}.speakerSlot não corresponde a kind=${stream.kind}`
    );
    if (assistant) {
      push(
        stream.text === null || stream.text === undefined,
        `${label}.text precisa ser null/ausente no assistant`
      );
      push(
        Array.isArray(stream.segments) && stream.segments.length === 2,
        `${label}.segments precisa ter audible-prefix e neutral-tail`
      );
      const expectedKinds = ["audible-prefix", "neutral-tail"];
      if (Array.isArray(stream.segments)) {
        for (const [segmentIndex, segment] of stream.segments.entries()) {
          push(
            segment !== null && typeof segment === "object" &&
              !Array.isArray(segment),
            `${label}.segments[${segmentIndex}] precisa ser objeto`
          );
          push(
            segment?.kind === expectedKinds[segmentIndex],
            `${label}.segments[${segmentIndex}].kind precisa ser ${
              expectedKinds[segmentIndex] ?? "inexistente"
            }`
          );
          push(
            typeof segment?.text === "string" && segment.text.trim().length > 0,
            `${label}.segments[${segmentIndex}].text precisa ser texto não vazio`
          );
        }
      }
    } else {
      push(
        typeof stream.text === "string" && stream.text.trim().length > 0,
        `${label}.text precisa ser texto não vazio`
      );
      push(
        stream.segments === null || stream.segments === undefined,
        `${label}.segments só é permitido no assistant`
      );
    }
    push(!ids.has(stream.streamId), `${label}.streamId precisa ser único`);
    push(!paths.has(stream.relativePath), `${label}.relativePath precisa ser único`);
    ids.add(stream.streamId);
    paths.add(stream.relativePath);
    if (options.projectRoot && options.outputRoot &&
        typeof stream.relativePath === "string") {
      try {
        assertOutputPath(options.projectRoot, options.outputRoot, {
          id: stream.streamId,
          relativePath: stream.relativePath
        });
      } catch (error) {
        errors.push(error.message.replace("EXP-0019 audio materializer: ", ""));
      }
    }
  }
  for (const role of VALID_ROLES) {
    push(counts[role] === 4, `audio.streams precisa ter 4 itens role=${role}`);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

export async function describeExp0019SupertonicModel(
  modelDir,
  voiceStyles
) {
  const rootInfo = await lstat(modelDir).catch(() => null);
  invariant(
    rootInfo?.isDirectory() && !rootInfo.isSymbolicLink(),
    `cache Supertonic precisa ser diretório real: ${modelDir}`
  );
  const required = [
    ...EXP0019_SUPERTONIC_REQUIRED_MODEL_FILES,
    ...voiceStyles.map((voice) => `voice_styles/${voice}.json`)
  ];
  const files = {};
  for (const repositoryPath of [...new Set(required)].sort()) {
    const path = resolve(modelDir, repositoryPath);
    const info = await lstat(path).catch(() => null);
    invariant(
      info?.isFile() && !info.isSymbolicLink(),
      `artefato Supertonic local ausente ou symlink: ${path}`
    );
    files[repositoryPath] = await sha256File(path);
  }
  return Object.freeze({
    files: Object.freeze(files),
    canonicalSha256: `sha256:${canonicalSha256(files)}`
  });
}

async function resolvePathExecutable(command) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = resolve(directory, command);
    const info = await lstat(candidate).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) continue;
    const executable = await access(candidate, fsConstants.X_OK)
      .then(() => true, () => false);
    if (executable) return candidate;
  }
  throw new Error(
    `EXP-0019 audio materializer: executável ${command} não encontrado`
  );
}

export async function describeExp0019UvxToolchain(options = {}) {
  const executablePath = options.executablePath ??
    await resolvePathExecutable("uvx");
  invariant(isAbsolute(executablePath), "uvx precisa usar path absoluto");
  const info = await lstat(executablePath).catch(() => null);
  invariant(
    info?.isFile() && !info.isSymbolicLink(),
    "uvx precisa ser arquivo regular, não symlink"
  );
  const executableSha256 = await sha256File(executablePath);
  const result = await (options.execFileImpl ?? execFile)(
    executablePath,
    ["--version"],
    { timeout: 10_000, maxBuffer: 1024 * 1024 }
  );
  const version = String(result.stdout ?? "").trim();
  invariant(version.startsWith("uvx "), "versão uvx é incompatível");
  return Object.freeze({
    executablePath,
    binding: Object.freeze({
      command: "uvx",
      executableSha256,
      version
    })
  });
}

export function createExp0019PythonInvocation(options = {}) {
  const args = [
    PYTHON_MATERIALIZER,
    "--plan", options.planPath,
    "--freeze", options.freezePath,
    "--freeze-file-sha256", options.freezeFileSha256,
    "--attempt", options.attemptPath,
    "--project-root", options.projectRoot,
    "--output-root", options.outputRoot,
    "--model-dir", options.modelDir,
    "--receipt", options.receiptPath
  ];
  return Object.freeze({
    command: options.uvxExecutablePath,
    args: Object.freeze([
      "--offline",
      "--from", "supertonic==1.3.1",
      ...Object.entries(EXP0019_TTS_PYTHON_PACKAGES)
        .filter(([name]) => name !== "supertonic")
        .flatMap(([name, version]) => ["--with", `${name}==${version}`]),
      "python",
      ...args
    ]),
    environmentMode: "uvx-offline-existing-cache"
  });
}

function offlineEnvironment() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
    TZ: "America/Sao_Paulo",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    UV_OFFLINE: "1",
    UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? resolve(LOCAL_CACHE_ROOT, "uv")
  };
}

async function runPythonMaterializer(input) {
  const receiptPath = resolve(input.outputRoot, ".materialization-receipt.json");
  const invocation = createExp0019PythonInvocation({
    ...input,
    receiptPath
  });
  try {
    await input.execFileImpl(invocation.command, invocation.args, {
      cwd: input.projectRoot,
      env: offlineEnvironment(),
      timeout: 20 * 60_000,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch (error) {
    throw new Error(
      "materialização Supertonic offline falhou; confirme o cache local, " +
      "o ambiente Python já cacheado e SUPERTONIC_PYTHON, sem habilitar rede",
      { cause: error }
    );
  }
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  return receipt;
}

function validateReceipt(receipt, plan, expected = {}) {
  invariant(
    exactKeys(receipt, [
      "assistantSegmentsSynthesizedSeparately",
      "attemptFileSha256",
      "autoDownload",
      "engine",
      "environmentMode",
      "files",
      "instrumentationFreezeFileSha256",
      "language",
      "model",
      "modelSampleRate",
      "networkAllowed",
      "outputSampleRate",
      "packageVersions",
      "pythonExecutableSha256",
      "pythonVersion",
      "randomSeedBase",
      "randomSeedStrategy",
      "schemaVersion",
      "sdkVersion",
      "speed",
      "supertonicPackageSha256",
      "totalSteps"
    ]) &&
      receipt?.schemaVersion ===
      "exp-0019-supertonic-materialization-receipt-v1" &&
      receipt.engine === "supertonic" &&
      receipt.model === "supertonic-3" &&
      receipt.sdkVersion === "1.3.1" &&
      receipt.environmentMode === "uvx-offline-existing-cache" &&
      receipt.language === EXP0019_TTS_CONFIG.language &&
      receipt.totalSteps === EXP0019_TTS_CONFIG.totalSteps &&
      receipt.speed === EXP0019_TTS_CONFIG.speed &&
      receipt.randomSeedBase === EXP0019_TTS_RANDOM_SEED &&
      receipt.randomSeedStrategy === EXP0019_TTS_RANDOM_SEED_STRATEGY &&
      receipt.assistantSegmentsSynthesizedSeparately ===
        EXP0019_TTS_CONFIG.assistantSegmentsSynthesizedSeparately &&
      typeof receipt.pythonVersion === "string" &&
      receipt.pythonVersion.length > 0 &&
      Number.isSafeInteger(receipt.modelSampleRate) &&
      receipt.modelSampleRate > 0 &&
      receipt.outputSampleRate === EXP0019_TTS_CONFIG.outputSampleRate &&
      receipt.networkAllowed === false &&
      receipt.autoDownload === false,
    "receipt do runner Supertonic é incompatível"
  );
  invariant(
    SHA256_PATTERN.test(receipt.pythonExecutableSha256 ?? "") &&
      SHA256_PATTERN.test(receipt.supertonicPackageSha256 ?? "") &&
      isDeepStrictEqual(
        receipt.packageVersions,
        EXP0019_TTS_PYTHON_PACKAGES
      ) &&
      receipt.instrumentationFreezeFileSha256 ===
        expected.freezeFileSha256 &&
      receipt.attemptFileSha256 === expected.attemptFileSha256,
    "receipt não vincula ambiente, freeze ou tentativa"
  );
  invariant(
    Array.isArray(receipt.files) && receipt.files.length === 12,
    "receipt precisa descrever exatamente 12 WAVs"
  );
  const byId = new Map(receipt.files.map((file) => [file.id, file]));
  invariant(byId.size === 12, "receipt contém ids duplicados");
  for (const source of audioSourcesFromPlan(plan)) {
    const file = byId.get(source.id);
    invariant(exactKeys(file, [
      "id",
      "prefixEndSample",
      "relativePath",
      "sampleCount",
      "segmentSampleCounts",
      "segmentSeeds"
    ]), `receipt tem shape inválido para ${source.id}`);
    invariant(file?.relativePath === source.relativePath,
      `receipt diverge do plano para ${source.id}`);
    invariant(
      Number.isSafeInteger(file.sampleCount) && file.sampleCount > 0 &&
      Array.isArray(file.segmentSampleCounts) &&
      file.segmentSampleCounts.every(
        (count) => Number.isSafeInteger(count) && count > 0
      ) &&
      file.segmentSampleCounts.reduce((sum, count) => sum + count, 0) ===
        file.sampleCount,
      `sample counts inválidos para ${source.id}`
    );
    const expectedKinds = source.role === "assistant-output"
      ? ["audible-prefix", "neutral-tail"]
      : ["utterance"];
    invariant(
      Array.isArray(file.segmentSeeds) &&
        isDeepStrictEqual(
          file.segmentSeeds,
          expectedKinds.map((kind) => exp0019SegmentSeed(source.id, kind))
        ),
      `seeds de síntese inválidos para ${source.id}`
    );
    if (source.role === "assistant-output") {
      invariant(
        file.segmentSampleCounts.length === 2 &&
        file.prefixEndSample === file.segmentSampleCounts[0] &&
        file.prefixEndSample < file.sampleCount,
        `fronteira prefix/tail inválida para ${source.id}`
      );
    } else {
      invariant(
        file.segmentSampleCounts.length === 1 &&
        file.prefixEndSample === null,
        `fonte não-assistente segmentada indevidamente: ${source.id}`
      );
    }
  }
  return byId;
}

function textSha256(text) {
  return sha256(Buffer.from(text, "utf8"));
}

async function describeWave(projectRoot, source, receiptFile) {
  const path = resolveRepositoryPath(projectRoot, source.relativePath,
    `${source.id}.relativePath`);
  const wave = await readFile(path);
  const inspected = inspectWave(wave);
  invariant(
    inspected.audioFormat === 1 &&
      inspected.channels === 1 &&
      inspected.sampleRate === 16_000 &&
      inspected.bitsPerSample === 16 &&
      inspected.blockAlign === 2,
    `${source.id} precisa ser WAV PCM16 mono 16 kHz`
  );
  const decoded = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 });
  const sampleCount = decoded.pcm.length / 2;
  invariant(sampleCount === receiptFile.sampleCount,
    `${source.id} diverge do sampleCount do runner`);
  const segmentCounts = receiptFile.segmentSampleCounts;
  let byteOffset = 0;
  const kinds = source.role === "assistant-output"
    ? ["audible-prefix", "neutral-tail"]
    : ["utterance"];
  const texts = source.role === "assistant-output"
    ? [source.text, source.tailText]
    : [source.text];
  const segments = segmentCounts.map((count, index) => {
    const pcm = decoded.pcm.subarray(byteOffset, byteOffset + count * 2);
    byteOffset += count * 2;
    return {
      kind: kinds[index],
      textSha256: textSha256(texts[index]),
      sampleCount: count,
      pcmSha256: sha256(pcm)
    };
  });
  return {
    id: source.id,
    role: source.role,
    voiceStyle: source.voiceStyle,
    textSha256: textSha256(source.text),
    tailTextSha256: source.role === "assistant-output"
      ? textSha256(source.tailText)
      : null,
    relativePath: source.relativePath,
    waveSha256: sha256(wave),
    pcmSha256: sha256(decoded.pcm),
    sampleRate: 16_000,
    channels: 1,
    bitsPerSample: 16,
    sampleCount,
    prefixEndSample: receiptFile.prefixEndSample,
    segments
  };
}

function withoutManifestHash(manifest) {
  const core = structuredClone(manifest);
  delete core.manifestSha256;
  return core;
}

export async function verifyExp0019AudioManifest(manifest, options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const errors = [];
  if (
    !exactKeys(manifest, [
      "audio",
      "audioAttempt",
      "experimentId",
      "files",
      "instrumentationFreeze",
      "manifestSha256",
      "materializationReceipt",
      "plan",
      "provenance",
      "retention",
      "schemaVersion",
      "selection",
      "status",
      "synthesis",
      "targetReuse"
    ]) ||
    manifest?.schemaVersion !== EXP0019_AUDIO_MANIFEST_SCHEMA ||
    manifest?.experimentId !== "EXP-0019" ||
    manifest?.status !== "materialized-local-offline" ||
    manifest?.manifestSha256 !==
      `sha256:${canonicalSha256(withoutManifestHash(manifest))}`
  ) {
    errors.push("identidade ou manifestSha256 incompatível");
  }
  if (
    !exactKeys(manifest?.provenance, [
      "engine",
      "environmentMode",
      "execution",
      "executionHeadCommit",
      "gpuRuns",
      "model",
      "modelArtifactBinding",
      "modelCacheLocation",
      "networkAllowed",
      "paidApiCalls",
      "pythonVersion",
      "receiptCanonicalSha256",
      "sdkVersion",
      "sourceFiles",
      "testHarnessUsed",
      "toolchainBinding"
    ]) ||
    manifest?.provenance?.execution !== "local-offline" ||
    !/^[a-f0-9]{40}$/u.test(
      manifest?.provenance?.executionHeadCommit ?? ""
    ) ||
    !(
      manifest?.provenance?.testHarnessUsed === false ||
      (options.allowTestHarness === true &&
        manifest?.provenance?.testHarnessUsed === true)
    ) ||
    manifest?.provenance?.networkAllowed !== false ||
    manifest?.provenance?.paidApiCalls !== 0 ||
    manifest?.provenance?.gpuRuns !== 0 ||
    manifest?.provenance?.engine !== EXP0019_TTS_CONFIG.engine ||
    manifest?.provenance?.model !== EXP0019_TTS_CONFIG.model ||
    manifest?.provenance?.sdkVersion !== EXP0019_TTS_CONFIG.sdkVersion ||
    manifest?.provenance?.environmentMode !==
      "uvx-offline-existing-cache" ||
    manifest?.provenance?.modelCacheLocation !==
      "local-cache-outside-repository" ||
    typeof manifest?.provenance?.pythonVersion !== "string" ||
    manifest.provenance.pythonVersion.length === 0 ||
    !exactKeys(manifest?.provenance?.sourceFiles, [
      "pythonMaterializer", "wrapper"
    ]) ||
    !exactKeys(manifest?.provenance?.sourceFiles?.wrapper, [
      "fileSha256", "path"
    ]) ||
    !exactKeys(manifest?.provenance?.sourceFiles?.pythonMaterializer, [
      "fileSha256", "path"
    ]) ||
    !SHA256_PATTERN.test(
      manifest?.provenance?.receiptCanonicalSha256 ?? ""
    ) ||
    !exactKeys(manifest?.synthesis, [
      "assistantSegmentsSynthesizedSeparately",
      "language",
      "modelSampleRate",
      "randomSeedBase",
      "randomSeedStrategy",
      "speed",
      "totalSteps"
    ]) ||
    manifest?.synthesis?.language !== EXP0019_TTS_CONFIG.language ||
    manifest?.synthesis?.totalSteps !== EXP0019_TTS_CONFIG.totalSteps ||
    manifest?.synthesis?.speed !== EXP0019_TTS_CONFIG.speed ||
    manifest?.synthesis?.randomSeedBase !== EXP0019_TTS_RANDOM_SEED ||
    manifest?.synthesis?.randomSeedStrategy !==
      EXP0019_TTS_RANDOM_SEED_STRATEGY ||
    manifest?.synthesis?.assistantSegmentsSynthesizedSeparately !==
      EXP0019_TTS_CONFIG.assistantSegmentsSynthesizedSeparately ||
    !Number.isSafeInteger(manifest?.synthesis?.modelSampleRate) ||
    manifest.synthesis.modelSampleRate <= 0 ||
    !exactKeys(manifest?.audio, [
      "bitsPerSample", "channels", "encoding", "sampleRate"
    ]) ||
    manifest?.audio?.encoding !== "PCM_S16LE_WAVE" ||
    manifest?.audio?.sampleRate !== 16_000 ||
    manifest?.audio?.channels !== 1 ||
    manifest?.audio?.bitsPerSample !== 16 ||
    manifest?.selection?.total !== 12 ||
    manifest?.selection?.roles?.target !== 4 ||
    manifest?.selection?.roles?.inbound !== 4 ||
    manifest?.selection?.roles?.["assistant-output"] !== 4 ||
    manifest?.targetReuse?.synthesesPerTarget !== 1 ||
    manifest?.targetReuse?.targetSources !== 4 ||
    manifest?.targetReuse?.strategy !==
      "one-canonical-wave-per-target-source" ||
    manifest?.targetReuse?.byteIdenticalReuseRequiredWithinPair !== true ||
    !exactKeys(manifest?.retention, [
      "manifestInGit",
      "modelWeightsInGit",
      "rawAudioIgnoredUnder",
      "rawAudioInGit"
    ]) ||
    manifest?.retention?.rawAudioInGit !== false ||
    manifest?.retention?.manifestInGit !== true ||
    manifest?.retention?.modelWeightsInGit !== false ||
    manifest?.retention?.rawAudioIgnoredUnder !== DEFAULTS.outputRoot ||
    !Array.isArray(manifest?.files) || manifest.files.length !== 12
  ) {
    errors.push("contrato offline, seleção ou formato incompatível");
  }
  const planPath = manifest?.plan?.path;
  try {
    if (
      !exactKeys(manifest?.instrumentationFreeze, [
        "canonicalSha256",
        "fileSha256",
        "path",
        "runnerSourceCommit"
      ]) ||
      !exactKeys(manifest?.audioAttempt, [
        "canonicalSha256",
        "executionHeadCommit",
        "fileSha256",
        "path"
      ]) ||
      !exactKeys(manifest?.plan, [
        "canonicalSha256", "fileSha256", "path"
      ]) ||
      !exactKeys(manifest?.selection, ["roles", "total"]) ||
      !exactKeys(manifest?.selection?.roles, [
        "assistant-output", "inbound", "target"
      ]) ||
      !exactKeys(manifest?.targetReuse, [
        "byteIdenticalReuseRequiredWithinPair",
        "strategy",
        "synthesesPerTarget",
        "targetSources"
      ])
    ) {
      errors.push("shape de bindings, seleção ou reuse incompatível");
    }
    const freezePath = resolveRepositoryPath(
      projectRoot,
      manifest?.instrumentationFreeze?.path,
      "instrumentationFreeze.path"
    );
    const freezeBytes = await readFile(freezePath);
    const freeze = JSON.parse(freezeBytes.toString("utf8"));
    const freezeValidation = validateExp0019InstrumentationFreeze(freeze);
    if (
      !freezeValidation.valid ||
      manifest.instrumentationFreeze.path !==
        EXP0019_INSTRUMENTATION_FREEZE_PATH ||
      manifest.instrumentationFreeze.fileSha256 !== sha256(freezeBytes) ||
      manifest.instrumentationFreeze.canonicalSha256 !==
        freeze.instrumentationFreezeSha256 ||
      manifest.instrumentationFreeze.runnerSourceCommit !==
        freeze.runnerSourceCommit
    ) {
      errors.push("freeze de instrumentação ausente ou divergente");
    }
    const attemptPath = resolveRepositoryPath(
      projectRoot,
      manifest?.audioAttempt?.path,
      "audioAttempt.path"
    );
    const attemptBytes = await readFile(attemptPath);
    const attempt = JSON.parse(attemptBytes.toString("utf8"));
    const attemptChecks = [
      [manifest.audioAttempt.path === EXP0019_AUDIO_ATTEMPT_PATH, "path"],
      [manifest.audioAttempt.fileSha256 === sha256(attemptBytes), "file hash"],
      [manifest.audioAttempt.canonicalSha256 === attempt.attemptSha256,
        "canonical hash"],
      [manifest.audioAttempt.executionHeadCommit ===
        attempt.executionHeadCommit, "commit no manifest"],
      [validateExp0019AudioAttempt(attempt), "contrato"],
      [attempt.instrumentationFreeze.path ===
        manifest.instrumentationFreeze.path, "freeze path"],
      [attempt.instrumentationFreeze.fileSha256 ===
        manifest.instrumentationFreeze.fileSha256, "freeze file hash"],
      [attempt.instrumentationFreeze.canonicalSha256 ===
        manifest.instrumentationFreeze.canonicalSha256,
      "freeze canonical hash"],
      [attempt.instrumentationFreeze.runnerSourceCommit ===
        manifest.instrumentationFreeze.runnerSourceCommit,
      "freeze runner commit"],
      [attempt.plan.path === manifest.plan.path, "plan path"],
      [attempt.plan.fileSha256 === manifest.plan.fileSha256, "plan file hash"],
      [attempt.plan.canonicalSha256 === manifest.plan.canonicalSha256,
        "plan canonical hash"],
      [attempt.modelArtifactBindingSha256 ===
        manifest.provenance.modelArtifactBinding?.canonicalSha256,
      "model binding"],
      [attempt.outputs.rawAudioRoot ===
        manifest.retention.rawAudioIgnoredUnder, "output root"],
      [attempt.outputs.manifest === DEFAULTS.manifest, "manifest output"]
    ];
    const failedAttemptChecks = attemptChecks
      .filter(([valid]) => !valid)
      .map(([, label]) => label);
    if (failedAttemptChecks.length > 0) {
      errors.push(
        `tentativa única ausente, adulterada ou divergente: ${
          failedAttemptChecks.join(", ")
        }`
      );
    }
    const absolutePlan = resolveRepositoryPath(projectRoot, planPath, "plan.path");
    const planBytes = await readFile(absolutePlan);
    const plan = JSON.parse(planBytes.toString("utf8"));
    if (
      planPath !== DEFAULTS.plan ||
      manifest.plan.fileSha256 !== sha256(planBytes) ||
      manifest.plan.canonicalSha256 !== plan.planSha256
    ) {
      errors.push("plano atual diverge do manifest");
    }
    const outputRoot = resolveRepositoryPath(
      projectRoot,
      manifest.retention.rawAudioIgnoredUnder,
      "retention.rawAudioIgnoredUnder"
    );
    const planValidation = validateExp0019AudioPlan(plan, {
      projectRoot,
      outputRoot
    });
    const causalPlanValidation = validateExp0019CausalAudioPlan(plan);
    if (!planValidation.valid) {
      errors.push(`plano inválido: ${planValidation.errors.join("; ")}`);
    }
    if (!causalPlanValidation.valid) {
      errors.push(
        `plano causal completo inválido: ${
          causalPlanValidation.errors.join("; ")
        }`
      );
    }
    const sources = audioSourcesFromPlan(plan);
    try {
      validateReceipt(manifest.materializationReceipt, plan, {
        freezeFileSha256: manifest.instrumentationFreeze.fileSha256,
        attemptFileSha256: manifest.audioAttempt.fileSha256
      });
    } catch (error) {
      errors.push(error.message);
    }
    if (
      manifest.provenance.receiptCanonicalSha256 !==
        `sha256:${canonicalSha256(manifest.materializationReceipt)}` ||
      manifest.materializationReceipt.engine !==
        manifest.provenance.engine ||
      manifest.materializationReceipt.model !==
        manifest.provenance.model ||
      manifest.materializationReceipt.sdkVersion !==
        manifest.provenance.sdkVersion ||
      manifest.materializationReceipt.pythonVersion !==
        manifest.provenance.pythonVersion ||
      manifest.materializationReceipt.modelSampleRate !==
        manifest.synthesis.modelSampleRate ||
      manifest.materializationReceipt.randomSeedBase !==
        manifest.synthesis.randomSeedBase ||
      manifest.materializationReceipt.randomSeedStrategy !==
        manifest.synthesis.randomSeedStrategy
    ) {
      errors.push("receipt persistido diverge da proveniência/síntese");
    }
    const expectedIds = sources.map((source) => source.id);
    const observedIds = (manifest.files ?? []).map((file) => file.id);
    if (!isDeepStrictEqual(observedIds, expectedIds)) {
      errors.push("files precisa preservar exatamente os 12 ids/ordem do plano");
    }
    const observedRoles = Object.fromEntries([...VALID_ROLES].map((role) => [
      role,
      (manifest.files ?? []).filter((file) => file.role === role).length
    ]));
    if (!isDeepStrictEqual(manifest?.selection?.roles, observedRoles)) {
      errors.push("selection.roles diverge dos arquivos materializados");
    }
    const sourceById = new Map(sources.map((item) => [item.id, item]));
    for (const file of manifest.files ?? []) {
      const source = sourceById.get(file.id);
      if (!source || source.relativePath !== file.relativePath) {
        errors.push(`${file.id}: arquivo não corresponde ao plano`);
        continue;
      }
      const wave = await readFile(resolveRepositoryPath(
        projectRoot,
        file.relativePath,
        `${file.id}.relativePath`
      )).catch(() => null);
      if (wave === null || sha256(wave) !== file.waveSha256) {
        errors.push(`${file.id}: WAV ausente ou divergente`);
        continue;
      }
      const inspected = inspectWave(wave);
      const decoded = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 });
      if (
        inspected.audioFormat !== 1 || inspected.channels !== 1 ||
        inspected.sampleRate !== 16_000 || inspected.bitsPerSample !== 16 ||
        decoded.pcm.length / 2 !== file.sampleCount ||
        sha256(decoded.pcm) !== file.pcmSha256 ||
        (file.role === "assistant-output" &&
          (!Number.isSafeInteger(file.prefixEndSample) ||
            file.prefixEndSample <= 0 ||
            file.prefixEndSample >= file.sampleCount ||
            !Array.isArray(file.segments) || file.segments.length !== 2 ||
            file.prefixEndSample !== file.segments[0]?.sampleCount ||
            file.segments.reduce(
              (sum, segment) => sum + segment.sampleCount,
              0
            ) !== file.sampleCount)) ||
        (file.role !== "assistant-output" && file.prefixEndSample !== null)
      ) {
        errors.push(`${file.id}: PCM, sample count ou fronteira divergente`);
        continue;
      }
      const expected = await describeWave(projectRoot, source, {
        sampleCount: file.sampleCount,
        prefixEndSample: file.prefixEndSample,
        segmentSampleCounts: file.segments?.map(
          (segment) => segment.sampleCount
        )
      });
      if (!isDeepStrictEqual(file, expected)) {
        errors.push(`${file.id}: descriptor ou segmentos divergem do WAV/plano`);
      }
    }
    const criticalReader = options.readCriticalSource ??
      ((absolutePath) => readFile(absolutePath));
    const currentCriticalHashes = await criticalSourceSnapshot(
      projectRoot,
      freeze,
      criticalReader
    );
    if (manifest.provenance.testHarnessUsed === false) {
      await verifyRawAudioGitBoundary(projectRoot, manifest.files);
      await verifyCanonicalGitFreeze(
        projectRoot,
        freeze,
        freezeBytes,
        attempt.executionHeadCommit
      );
      await verifyCommittedAudioAttempt(
        projectRoot,
        attempt,
        attemptBytes,
        manifest.provenance.executionHeadCommit
      );
      if (options.requireEvidenceCommitted === true) {
        const evidencePaths = [
          EXP0019_AUDIO_ATTEMPT_PATH,
          options.manifestPath ?? DEFAULTS.manifest
        ];
        const evidenceStatus = await gitBytes(projectRoot, [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "--",
          ...evidencePaths
        ]);
        invariant(
          evidenceStatus.length === 0,
          "tentativa e manifest precisam estar commitados e limpos"
        );
        for (const evidencePath of evidencePaths) {
          await gitBytes(projectRoot, [
            "ls-files",
            "--error-unmatch",
            evidencePath
          ]).catch((error) => {
            throw new Error(
              `${evidencePath}: evidência não está rastreada pelo Git`,
              { cause: error }
            );
          });
        }
      }
    }
    const frozenSources = new Map(
      (freeze.criticalSources ?? []).map((record) => [record.path, record])
    );
    if (
      manifest?.provenance?.sourceFiles?.wrapper?.path !==
        "scripts/materialize-exp-0019-audio.mjs" ||
      manifest.provenance.sourceFiles.wrapper.fileSha256 !==
        currentCriticalHashes["scripts/materialize-exp-0019-audio.mjs"] ||
      manifest?.provenance?.sourceFiles?.pythonMaterializer?.path !==
        "scripts/lib/materialize-exp-0019-supertonic.py" ||
      manifest.provenance.sourceFiles.pythonMaterializer.fileSha256 !==
        currentCriticalHashes[
          "scripts/lib/materialize-exp-0019-supertonic.py"
        ] ||
      frozenSources.get("scripts/materialize-exp-0019-audio.mjs")
        ?.fileSha256 !== currentCriticalHashes[
          "scripts/materialize-exp-0019-audio.mjs"
        ] ||
      frozenSources.get("scripts/lib/materialize-exp-0019-supertonic.py")
        ?.fileSha256 !== currentCriticalHashes[
          "scripts/lib/materialize-exp-0019-supertonic.py"
        ] ||
      freeze?.artifacts?.plan?.path !== manifest.plan.path ||
      freeze.artifacts.plan.fileSha256 !== manifest.plan.fileSha256 ||
      freeze.artifacts.plan.canonicalSha256 !== plan.planSha256 ||
      !isDeepStrictEqual(
        freeze?.tts?.modelArtifactBinding,
        manifest?.provenance?.modelArtifactBinding
      ) ||
      !isDeepStrictEqual(
        freeze?.tts?.toolchainBinding,
        manifest?.provenance?.toolchainBinding
      ) ||
      manifest?.provenance?.modelArtifactBinding?.canonicalSha256 !==
        `sha256:${canonicalSha256(
          manifest?.provenance?.modelArtifactBinding?.files ?? {}
        )}` ||
      Object.values(
        manifest?.provenance?.modelArtifactBinding?.files ?? {}
      ).some((value) => !SHA256_PATTERN.test(value))
    ) {
      errors.push("proveniência de código ou modelo é incompatível");
    }
    if (options.modelDir) {
      await assertExp0019ModelCacheOutsideRepository(
        projectRoot,
        resolve(options.modelDir)
      );
      const expectedModelBinding = await describeExp0019SupertonicModel(
        resolve(options.modelDir),
        sources.map((source) => source.voiceStyle)
      );
      if (!isDeepStrictEqual(
        manifest.provenance.modelArtifactBinding,
        expectedModelBinding
      )) {
        errors.push("artefatos locais do modelo divergem do manifest");
      }
    }
  } catch (error) {
    errors.push(error.message);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export async function materializeExp0019Audio(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  invariant(
    options.freeze === undefined ||
      options.freeze === EXP0019_INSTRUMENTATION_FREEZE_PATH,
    "freeze precisa usar o path canônico do EXP-0019"
  );
  invariant(
    options.attempt === undefined ||
      options.attempt === EXP0019_AUDIO_ATTEMPT_PATH,
    "tentativa precisa usar o path canônico do EXP-0019"
  );
  for (const [value, expected, label] of [
    [options.plan, DEFAULTS.plan, "plan"],
    [options.manifest, DEFAULTS.manifest, "manifest"],
    [options.outputRoot, DEFAULTS.outputRoot, "output root"]
  ]) {
    invariant(value === undefined || value === expected,
      `${label} precisa usar o path canônico do EXP-0019`);
  }
  const testOnly = options.testOnly === true;
  invariant(
    options.openAttemptOnly !== true || !testOnly,
    "abertura de tentativa é um estágio canônico, não um harness"
  );
  invariant(
    options.runner === undefined || testOnly,
    "runner injetado é permitido somente no harness explícito de testes"
  );
  invariant(
    options.readCriticalSource === undefined || testOnly,
    "leitor crítico injetado é permitido somente em testes"
  );
  invariant(
    options.execFileImpl === undefined || testOnly,
    "execFile injetado é permitido somente no harness explícito de testes"
  );
  invariant(
    options.nowIso === undefined || testOnly,
    "relógio injetado é permitido somente no harness explícito de testes"
  );
  invariant(
    options.pythonExecutable === undefined,
    "executável Python arbitrário é proibido no materializador canônico"
  );
  const planPath = resolveRepositoryPath(
    projectRoot,
    options.plan ?? DEFAULTS.plan,
    "--plan"
  );
  const freezePath = resolveRepositoryPath(
    projectRoot,
    options.freeze ?? DEFAULTS.freeze,
    "--freeze"
  );
  const attemptPath = resolveRepositoryPath(
    projectRoot,
    options.attempt ?? DEFAULTS.attempt,
    "--attempt"
  );
  const manifestPath = resolveRepositoryPath(
    projectRoot,
    options.manifest ?? DEFAULTS.manifest,
    "--manifest"
  );
  const outputRoot = resolveRepositoryPath(
    projectRoot,
    options.outputRoot ?? DEFAULTS.outputRoot,
    "--output-root"
  );
  const outputRepositoryPath = repositoryPath(
    projectRoot,
    outputRoot,
    "--output-root"
  );
  invariant(
    outputRepositoryPath === "eval/generated" ||
      outputRepositoryPath.startsWith("eval/generated/"),
    "--output-root precisa ficar sob eval/generated, que é ignorado pelo Git"
  );
  const manifestFromOutput = relative(outputRoot, manifestPath);
  invariant(
    manifestFromOutput === ".." ||
      manifestFromOutput.startsWith(`..${sep}`) ||
      isAbsolute(manifestFromOutput),
    "--manifest precisa ficar fora do output root ignorado"
  );
  const modelDir = resolve(options.modelDir ?? DEFAULTS.modelDir);
  await assertExp0019ModelCacheOutsideRepository(projectRoot, modelDir);
  await Promise.all([
    assertNoSymlinkEscape(projectRoot, planPath, "--plan"),
    assertNoSymlinkEscape(projectRoot, freezePath, "--freeze"),
    assertNoSymlinkEscape(projectRoot, attemptPath, "--attempt"),
    assertNoSymlinkEscape(projectRoot, manifestPath, "--manifest"),
    assertNoSymlinkEscape(projectRoot, outputRoot, "--output-root")
  ]);
  const planBytes = await readFile(planPath).catch((error) => {
    throw new Error(
      `EXP-0019 audio materializer: plano ausente ou ilegível em ${planPath}`,
      { cause: error }
    );
  });
  const plan = JSON.parse(planBytes.toString("utf8"));
  const freezeBytes = await readFile(freezePath).catch((error) => {
    throw new Error(
      `EXP-0019 audio materializer: freeze ausente ou ilegível em ${freezePath}`,
      { cause: error }
    );
  });
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const freezeValidation = validateExp0019InstrumentationFreeze(freeze);
  invariant(freezeValidation.valid,
    `freeze incompatível: ${freezeValidation.errors.join("; ")}`);
  const planValidation = validateExp0019AudioPlan(plan, {
    projectRoot,
    outputRoot
  });
  const causalPlanValidation = validateExp0019CausalAudioPlan(plan);
  invariant(
    planValidation.valid,
    `plano incompatível: ${planValidation.errors.join("; ")}`
  );
  invariant(
    causalPlanValidation.valid,
    `plano causal completo incompatível: ${
      causalPlanValidation.errors.join("; ")
    }`
  );
  invariant(
    repositoryPath(projectRoot, freezePath, "freeze") ===
      EXP0019_INSTRUMENTATION_FREEZE_PATH,
    "freeze precisa permanecer no path canônico"
  );
  const sources = audioSourcesFromPlan(plan);
  const voiceStyles = [...new Set(
    sources.map((source) => source.voiceStyle)
  )].sort();
  const modelBinding = await describeExp0019SupertonicModel(
    modelDir,
    voiceStyles
  );
  const toolchain = testOnly && options.runner !== undefined
    ? Object.freeze({
        executablePath: null,
        binding: freeze.tts.toolchainBinding
      })
    : await describeExp0019UvxToolchain();
  const wrapperBytes = await readFile(MODULE_PATH);
  const materializerBytes = await readFile(PYTHON_MATERIALIZER);
  invariant(
    freeze.artifacts.plan.path === repositoryPath(
      projectRoot,
      planPath,
      "plan"
    ) &&
      freeze.artifacts.plan.fileSha256 === sha256(planBytes) &&
      freeze.artifacts.plan.canonicalSha256 === plan.planSha256 &&
      isDeepStrictEqual(freeze.tts.modelArtifactBinding, modelBinding) &&
      isDeepStrictEqual(freeze.tts.toolchainBinding, toolchain.binding),
    "plano, modelo ou código materializador divergiu do freeze"
  );
  const criticalReader = options.readCriticalSource ??
    ((absolutePath) => readFile(absolutePath));
  const criticalBefore = await criticalSourceSnapshot(
    projectRoot,
    freeze,
    criticalReader
  );
  invariant(
    criticalBefore["scripts/materialize-exp-0019-audio.mjs"] ===
      sha256(wrapperBytes) &&
    criticalBefore["scripts/lib/materialize-exp-0019-supertonic.py"] ===
      sha256(materializerBytes),
    "wrapper ou Python não correspondem ao snapshot crítico"
  );
  const absent = async (path, label) => invariant(
    !(await access(path).then(() => true, () => false)),
    `${label} já existe; reexecução silenciosa é proibida`
  );
  await Promise.all([
    absent(manifestPath, "manifest"),
    absent(outputRoot, "output root")
  ]);
  let attempt;
  let attemptBytes;
  let executionHeadCommit;
  if (testOnly || options.openAttemptOnly === true) {
    await absent(attemptPath, "tentativa");
    const freezeCommit = testOnly
      ? freeze.runnerSourceCommit
      : await verifyCanonicalGitFreeze(projectRoot, freeze, freezeBytes);
    attempt = createAudioAttempt({
      openedAt: (options.nowIso ?? (() => new Date().toISOString()))(),
      executionHeadCommit: freezeCommit,
      freeze,
      freezeFileSha256: sha256(freezeBytes),
      plan,
      planFileSha256: sha256(planBytes),
      planPath: repositoryPath(projectRoot, planPath, "plan"),
      modelArtifactBinding: modelBinding,
      outputRoot: outputRepositoryPath,
      manifestPath: repositoryPath(projectRoot, manifestPath, "manifest")
    });
    attemptBytes = Buffer.from(
      `${JSON.stringify(attempt, null, 2)}\n`,
      "utf8"
    );
    await mkdir(dirname(attemptPath), { recursive: true });
    await writeFile(attemptPath, attemptBytes, { flag: "wx" });
    if (options.openAttemptOnly === true) {
      return Object.freeze({
        status: "ATTEMPT_OPENED_REQUIRES_COMMIT",
        attempt
      });
    }
    executionHeadCommit = freezeCommit;
  } else {
    attemptBytes = await readFile(attemptPath).catch((error) => {
      throw new Error(
        "EXP-0019 audio materializer: tentativa canônica ausente; " +
        "execute --open-attempt, commite-a e só então materialize",
        { cause: error }
      );
    });
    attempt = JSON.parse(attemptBytes.toString("utf8"));
    invariant(
      validateExp0019AudioAttempt(attempt) &&
        attempt.instrumentationFreeze.fileSha256 === sha256(freezeBytes) &&
        attempt.instrumentationFreeze.canonicalSha256 ===
          freeze.instrumentationFreezeSha256 &&
        attempt.plan.fileSha256 === sha256(planBytes) &&
        attempt.plan.canonicalSha256 === plan.planSha256 &&
        attempt.modelArtifactBindingSha256 === modelBinding.canonicalSha256,
      "tentativa commitada diverge de freeze, plano ou modelo"
    );
    await verifyCanonicalGitFreeze(
      projectRoot,
      freeze,
      freezeBytes,
      attempt.executionHeadCommit
    );
    executionHeadCommit = await verifyCommittedAudioAttempt(
      projectRoot,
      attempt,
      attemptBytes
    );
  }
  await mkdir(outputRoot, { recursive: true });
  const runner = options.runner ?? (input => runPythonMaterializer({
    ...input,
    execFileImpl: options.execFileImpl ?? execFile
  }));
  const receipt = await runner({
    plan,
    planPath,
    freezePath,
    freezeFileSha256: sha256(freezeBytes),
    attemptPath,
    attemptBytes,
    projectRoot,
    outputRoot,
    modelDir,
    uvxExecutablePath: toolchain.executablePath
  });
  const receiptById = validateReceipt(receipt, plan, {
    freezeFileSha256: sha256(freezeBytes),
    attemptFileSha256: sha256(attemptBytes)
  });
  const [
    planAfter,
    freezeAfter,
    attemptAfter,
    modelBindingAfter,
    toolchainAfter,
    criticalAfter
  ] =
    await Promise.all([
      readFile(planPath),
      readFile(freezePath),
      readFile(attemptPath),
      describeExp0019SupertonicModel(modelDir, voiceStyles),
      testOnly && options.runner !== undefined
        ? Promise.resolve(toolchain)
        : describeExp0019UvxToolchain(),
      criticalSourceSnapshot(projectRoot, freeze, criticalReader)
    ]);
  invariant(
    planAfter.equals(planBytes) &&
      freezeAfter.equals(freezeBytes) &&
      attemptAfter.equals(attemptBytes) &&
      isDeepStrictEqual(modelBindingAfter, modelBinding) &&
      isDeepStrictEqual(toolchainAfter.binding, toolchain.binding) &&
      isDeepStrictEqual(criticalAfter, criticalBefore),
    "entrada, modelo ou fonte crítica mudou durante a síntese"
  );
  const files = [];
  for (const source of sources) {
    files.push(await describeWave(projectRoot, source, receiptById.get(source.id)));
  }
  const roles = Object.fromEntries([...VALID_ROLES].map((role) => [
    role,
    files.filter((file) => file.role === role).length
  ]));
  const core = {
    schemaVersion: EXP0019_AUDIO_MANIFEST_SCHEMA,
    experimentId: "EXP-0019",
    status: "materialized-local-offline",
    instrumentationFreeze: {
      path: repositoryPath(projectRoot, freezePath, "freeze"),
      fileSha256: sha256(freezeBytes),
      canonicalSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    },
    audioAttempt: {
      path: repositoryPath(projectRoot, attemptPath, "attempt"),
      fileSha256: sha256(attemptBytes),
      canonicalSha256: attempt.attemptSha256,
      executionHeadCommit: attempt.executionHeadCommit
    },
    plan: {
      path: repositoryPath(projectRoot, planPath, "plan"),
      fileSha256: sha256(planBytes),
      canonicalSha256: plan.planSha256
    },
    provenance: {
      execution: "local-offline",
      executionHeadCommit,
      testHarnessUsed: testOnly,
      networkAllowed: false,
      paidApiCalls: 0,
      gpuRuns: 0,
      engine: "supertonic",
      model: "supertonic-3",
      sdkVersion: receipt.sdkVersion,
      pythonVersion: receipt.pythonVersion,
      environmentMode: receipt.environmentMode,
      modelCacheLocation: "local-cache-outside-repository",
      modelArtifactBinding: modelBinding,
      toolchainBinding: structuredClone(toolchain.binding),
      sourceFiles: {
        wrapper: {
          path: "scripts/materialize-exp-0019-audio.mjs",
          fileSha256: sha256(wrapperBytes)
        },
        pythonMaterializer: {
          path: "scripts/lib/materialize-exp-0019-supertonic.py",
          fileSha256: sha256(materializerBytes)
        }
      },
      receiptCanonicalSha256: `sha256:${canonicalSha256(receipt)}`
    },
    materializationReceipt: structuredClone(receipt),
    synthesis: {
      language: receipt.language,
      totalSteps: receipt.totalSteps,
      speed: receipt.speed,
      modelSampleRate: receipt.modelSampleRate,
      randomSeedBase: receipt.randomSeedBase,
      randomSeedStrategy: receipt.randomSeedStrategy,
      assistantSegmentsSynthesizedSeparately:
        receipt.assistantSegmentsSynthesizedSeparately
    },
    audio: {
      encoding: "PCM_S16LE_WAVE",
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16
    },
    selection: { total: files.length, roles },
    targetReuse: {
      strategy: "one-canonical-wave-per-target-source",
      targetSources: roles.target,
      synthesesPerTarget: 1,
      byteIdenticalReuseRequiredWithinPair: true
    },
    retention: {
      rawAudioInGit: false,
      rawAudioIgnoredUnder: outputRepositoryPath,
      manifestInGit: true,
      modelWeightsInGit: false
    },
    files
  };
  const manifest = Object.freeze({
    ...core,
    manifestSha256: `sha256:${canonicalSha256(core)}`
  });
  const validation = await verifyExp0019AudioManifest(manifest, {
    projectRoot,
    modelDir,
    allowTestHarness: testOnly,
    readCriticalSource: criticalReader
  });
  invariant(validation.valid,
    `manifest gerado é inválido: ${validation.errors.join("; ")}`);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" }
  );
  return manifest;
}

function parseArgs(args) {
  const options = { check: false, openAttemptOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--open-attempt") {
      options.openAttemptOnly = true;
      continue;
    }
    const fields = {
      "--plan": "plan",
      "--freeze": "freeze",
      "--manifest": "manifest",
      "--output-root": "outputRoot",
      "--model-dir": "modelDir"
    };
    const field = fields[argument];
    if (!field || index + 1 >= args.length) {
      throw new TypeError(`argumento desconhecido ou sem valor: ${argument}`);
    }
    options[field] = args[++index];
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  invariant(
    !(options.check && options.openAttemptOnly),
    "--check e --open-attempt são mutuamente exclusivos"
  );
  if (options.check) {
    const manifestPath = resolve(
      PROJECT_ROOT,
      options.manifest ?? DEFAULTS.manifest
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const validation = await verifyExp0019AudioManifest(manifest, {
      modelDir: resolve(options.modelDir ?? DEFAULTS.modelDir),
      requireEvidenceCommitted: true
    });
    invariant(validation.valid, validation.errors.join("; "));
    console.log(`EXP-0019 audio CHECK: 12 WAVs, ${manifest.manifestSha256}`);
    return;
  }
  const result = await materializeExp0019Audio(options);
  if (options.openAttemptOnly) {
    console.log(
      `EXP-0019 ATTEMPT OPEN: ${result.attempt.attemptSha256}; ` +
      "commite a tentativa antes de executar a síntese"
    );
    return;
  }
  const manifest = result;
  console.log(`EXP-0019 audio BUILD: 12 WAVs, ${manifest.manifestSha256}`);
  console.log("Supertonic local/offline; zero API, rede, GPU ou autoridade.");
}

if (process.argv[1] === MODULE_PATH) {
  await main();
}
