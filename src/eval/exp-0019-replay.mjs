import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { decodeWaveToPcm16 } from "../asr/pcm.mjs";
import { inspectWave } from "../audio/wav.mjs";
import {
  EXP0018_BACKGROUND,
  EXP0018_DIRECTED,
  validateExp0018Checkpoint
} from "./exp-0018-training.mjs";
import {
  extractExp0018ContextFeatures,
  projectExp0018ModelInput
} from "./exp-0018-context.mjs";
import {
  EXP0019_DEFER_CAUSAL_EVIDENCE,
  EXP0019_FIXED_GAP_SAMPLES,
  EXP0019_PROPOSAL_BUDGET_SAMPLES,
  EXP0019_SAMPLE_RATE,
  EXP0019_TARGET_OFFSET_SAMPLES,
  createExp0019CausalPayload,
  createExp0019CausalSchedule,
  runExp0019CausalAdapter,
  validateExp0019CausalAudioPlan
} from "./exp-0019-causal-audio-bridge.mjs";
import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_AUDIO_ATTEMPT_SCHEMA,
  EXP0019_INSTRUMENTATION_FREEZE_PATH,
  EXP0019_TTS_CONFIG,
  validateExp0019InstrumentationFreeze
} from "./exp-0019-boundary.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import { predictSoftmaxClassifier } from
  "../learning/softmax-classifier.mjs";

export const EXP0019_NODE_REPLAY_SCHEMA = "exp-0019-node-replay-v1";
export const EXP0019_RUNTIME_FINGERPRINT_SCHEMA =
  "exp-0019-runtime-fingerprint-v1";
export const EXP0019_AUDIO_MANIFEST_SCHEMA =
  "exp-0019-causal-audio-manifest-v1";
export const EXP0019_ONSET_CONFIG = deepFreeze({
  algorithm: "fixed-rms-consecutive-frames-v1",
  sampleRate: EXP0019_SAMPLE_RATE,
  frameMs: 20,
  frameSamples: 320,
  thresholdDb: -45,
  consecutiveFrames: 2
});

const ARM_NAMES = Object.freeze(["B0", "B1"]);
const REPLAY_CRITICAL_SOURCES = Object.freeze([
  "scripts/run-exp-0019-node-replay.mjs",
  "src/eval/exp-0019-replay.mjs"
]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MANIFEST_FILE_KEYS = Object.freeze([
  "bitsPerSample",
  "channels",
  "id",
  "pcmSha256",
  "prefixEndSample",
  "relativePath",
  "role",
  "sampleCount",
  "sampleRate",
  "segments",
  "tailTextSha256",
  "textSha256",
  "voiceStyle",
  "waveSha256"
]);
const MANIFEST_ROOT_KEYS = Object.freeze([
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
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`replay Node EXP-0019: ${message}`);
  }
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function textSha256(text) {
  return sha256(Buffer.from(text, "utf8"));
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function validText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validHash(value) {
  return HASH_PATTERN.test(value ?? "");
}

function validNonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function withoutHash(value, key) {
  const core = structuredClone(value ?? {});
  delete core[key];
  return core;
}

function parseJsonRecord(record, label) {
  assert(validText(record?.path), `${label}.path precisa ser texto não vazio`);
  assert(Buffer.isBuffer(record?.bytes), `${label}.bytes precisa ser Buffer`);
  let parsed;
  try {
    parsed = JSON.parse(record.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`replay Node EXP-0019: ${label} não é JSON válido`, {
      cause: error
    });
  }
  if (record.value !== undefined) {
    assert(isDeepStrictEqual(record.value, parsed),
      `${label}.value diverge dos bytes`);
  }
  return Object.freeze({
    path: record.path,
    bytes: record.bytes,
    fileSha256: sha256(record.bytes),
    value: parsed
  });
}

function parseBytesRecord(record, label) {
  assert(validText(record?.path), `${label}.path precisa ser texto não vazio`);
  assert(Buffer.isBuffer(record?.bytes), `${label}.bytes precisa ser Buffer`);
  return Object.freeze({
    path: record.path,
    bytes: record.bytes,
    fileSha256: sha256(record.bytes)
  });
}

function manifestRole(kind) {
  return kind === "assistant" ? "assistant-output" : kind;
}

function pcmFrameRmsDb(pcm, startSample, endSample) {
  let sum = 0;
  for (let sample = startSample; sample < endSample; sample += 1) {
    const normalized = pcm.readInt16LE(sample * 2) / 32_768;
    sum += normalized * normalized;
  }
  if (endSample === startSample || sum === 0) {
    return -Infinity;
  }
  return 20 * Math.log10(Math.sqrt(sum / (endSample - startSample)));
}

export function inspectExp0019PcmActivity(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new TypeError("PCM EXP-0019 precisa ser Buffer PCM16 não vazio");
  }
  const sampleCount = pcm.length / 2;
  const frameSamples = EXP0019_ONSET_CONFIG.frameSamples;
  let consecutive = 0;
  let runStartSample = null;
  let onsetSample = null;
  let activeEndSampleExclusive = null;
  for (let start = 0; start < sampleCount; start += frameSamples) {
    const end = Math.min(sampleCount, start + frameSamples);
    const active = pcmFrameRmsDb(pcm, start, end) >=
      EXP0019_ONSET_CONFIG.thresholdDb;
    if (!active) {
      consecutive = 0;
      runStartSample = null;
      continue;
    }
    runStartSample ??= start;
    consecutive += 1;
    if (consecutive >= EXP0019_ONSET_CONFIG.consecutiveFrames) {
      onsetSample ??= runStartSample;
      activeEndSampleExclusive = end;
    }
  }
  return deepFreeze({
    ...EXP0019_ONSET_CONFIG,
    sampleCount,
    onsetSample,
    activeEndSampleExclusive
  });
}

export function detectExp0019PcmOnset(pcm) {
  return inspectExp0019PcmActivity(pcm).onsetSample;
}

function assertManifestEnvelope(manifest, planRecord) {
  assert(
    exactKeys(manifest, MANIFEST_ROOT_KEYS) &&
    manifest?.schemaVersion === EXP0019_AUDIO_MANIFEST_SCHEMA &&
      manifest?.experimentId === "EXP-0019" &&
      manifest?.status === "materialized-local-offline",
    "identidade do manifest de áudio é incompatível"
  );
  assert(
    manifest.manifestSha256 ===
      `sha256:${canonicalSha256(withoutHash(
        manifest,
        "manifestSha256"
      ))}`,
    "manifestSha256 divergente"
  );
  assert(
    manifest?.plan?.path === planRecord.path &&
      manifest.plan.fileSha256 === planRecord.fileSha256 &&
      manifest.plan.canonicalSha256 === planRecord.value.planSha256,
    "binding do plano no manifest divergiu"
  );
  assert(
    manifest?.provenance?.execution === "local-offline" &&
      /^[a-f0-9]{40}$/u.test(
        manifest.provenance.executionHeadCommit ?? ""
      ) &&
      manifest.provenance.testHarnessUsed === false &&
      manifest.provenance.networkAllowed === false &&
      manifest.provenance.paidApiCalls === 0 &&
      manifest.provenance.gpuRuns === 0 &&
      manifest?.audio?.sampleRate === EXP0019_SAMPLE_RATE &&
      manifest.audio.channels === 1 &&
      manifest.audio.bitsPerSample === 16 &&
      manifest?.selection?.total === 12 &&
      isDeepStrictEqual(manifest.selection.roles, {
        target: 4,
        inbound: 4,
        "assistant-output": 4
      }) &&
      manifest?.targetReuse?.synthesesPerTarget === 1 &&
      manifest.targetReuse.byteIdenticalReuseRequiredWithinPair === true &&
      manifest?.retention?.rawAudioInGit === false &&
      manifest.retention.manifestInGit === true &&
      manifest?.materializationReceipt?.networkAllowed === false &&
      manifest.materializationReceipt.autoDownload === false,
    "contrato offline, formato ou seleção do manifest divergiu"
  );
}

function assertAudioAttemptChain(input) {
  const {
    attemptRecord,
    freezeRecord,
    freeze,
    manifestRecord,
    manifest,
    planRecord
  } = input;
  const attempt = attemptRecord.value;
  const attemptCore = withoutHash(attempt, "attemptSha256");
  assert(
    attemptRecord.path === EXP0019_AUDIO_ATTEMPT_PATH &&
      exactKeys(attempt, [
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
      attempt.attemptSha256 ===
        `sha256:${canonicalSha256(attemptCore)}` &&
      /^[a-f0-9]{40}$/u.test(attempt.executionHeadCommit ?? ""),
    "tentativa exclusiva de áudio é inválida"
  );
  assert(
    exactKeys(manifest?.audioAttempt, [
      "canonicalSha256",
      "executionHeadCommit",
      "fileSha256",
      "path"
    ]) &&
      manifest.audioAttempt.path === attemptRecord.path &&
      manifest.audioAttempt.fileSha256 === attemptRecord.fileSha256 &&
      manifest.audioAttempt.canonicalSha256 === attempt.attemptSha256 &&
      manifest.audioAttempt.executionHeadCommit ===
        attempt.executionHeadCommit,
    "manifest não vincula os bytes da tentativa exclusiva"
  );
  assert(
    exactKeys(manifest?.instrumentationFreeze, [
      "canonicalSha256",
      "fileSha256",
      "path",
      "runnerSourceCommit"
    ]) &&
      manifest.instrumentationFreeze.path === freezeRecord.path &&
      manifest.instrumentationFreeze.fileSha256 === freezeRecord.fileSha256 &&
      manifest.instrumentationFreeze.canonicalSha256 ===
        freeze.instrumentationFreezeSha256 &&
      manifest.instrumentationFreeze.runnerSourceCommit ===
        freeze.runnerSourceCommit &&
      attempt.instrumentationFreeze.path === freezeRecord.path &&
      attempt.instrumentationFreeze.fileSha256 === freezeRecord.fileSha256 &&
      attempt.instrumentationFreeze.canonicalSha256 ===
        freeze.instrumentationFreezeSha256 &&
      attempt.instrumentationFreeze.runnerSourceCommit ===
        freeze.runnerSourceCommit,
    "manifest/tentativa divergem do instrumentation freeze"
  );
  assert(
    attempt.plan.path === planRecord.path &&
      attempt.plan.fileSha256 === planRecord.fileSha256 &&
      attempt.plan.canonicalSha256 === planRecord.value.planSha256 &&
      attempt.modelArtifactBindingSha256 ===
        freeze.tts.modelArtifactBinding.canonicalSha256 &&
      attempt.outputs.manifest === manifestRecord.path &&
      attempt.outputs.rawAudioRoot ===
        manifest.retention.rawAudioIgnoredUnder &&
      attempt.allowedSyntheses?.streams === 12 &&
      attempt.allowedSyntheses?.targets === 4 &&
      attempt.allowedSyntheses?.inbounds === 4 &&
      attempt.allowedSyntheses?.assistantPrefixes === 4 &&
      attempt.allowedSyntheses?.assistantTails === 4 &&
      attempt.allowedSyntheses?.rerunAllowed === false &&
      attempt.authority?.mode === "offline-shadow-only" &&
      attempt.authority?.canProduceEffects === false &&
      manifest.materializationReceipt.attemptFileSha256 ===
        attemptRecord.fileSha256 &&
      manifest.materializationReceipt.instrumentationFreezeFileSha256 ===
        freezeRecord.fileSha256,
    "tentativa não vincula plano, modelo, outputs ou recibo"
  );
}

function assertFreezeChain(input) {
  const { freezeRecord, freeze, planRecord, checkpointRecord, manifest } =
    input;
  const validation = validateExp0019InstrumentationFreeze(freeze);
  assert(validation.valid,
    `instrumentation freeze inválido: ${validation.errors.join("; ")}`);
  assert(freezeRecord.path === EXP0019_INSTRUMENTATION_FREEZE_PATH,
    "path do instrumentation freeze divergiu");
  assert(
    freeze.artifacts.plan.path === planRecord.path &&
      freeze.artifacts.plan.fileSha256 === planRecord.fileSha256 &&
      freeze.artifacts.plan.canonicalSha256 ===
        planRecord.value.planSha256,
    "plano diverge do instrumentation freeze"
  );
  assert(
    freeze.artifacts.sourceCheckpoint.path === checkpointRecord.path &&
      freeze.artifacts.sourceCheckpoint.fileSha256 ===
        checkpointRecord.fileSha256 &&
      freeze.artifacts.sourceCheckpoint.canonicalSha256 ===
        checkpointRecord.value.checkpointSha256,
    "checkpoint diverge do instrumentation freeze"
  );
  const frozenSources = new Map(freeze.criticalSources.map((source) => [
    source.path,
    source.fileSha256
  ]));
  const records = input.criticalSourceRecords ?? [];
  assert(Array.isArray(records) && records.length ===
    REPLAY_CRITICAL_SOURCES.length,
  "hashes atuais do replay e CLI são obrigatórios");
  const observed = new Map();
  for (const [index, raw] of records.entries()) {
    const record = parseBytesRecord(raw, `criticalSourceRecords[${index}]`);
    assert(REPLAY_CRITICAL_SOURCES.includes(record.path),
      `fonte crítica inesperada: ${record.path}`);
    assert(!observed.has(record.path),
      `fonte crítica duplicada: ${record.path}`);
    assert(record.fileSha256 === frozenSources.get(record.path),
      `fonte crítica divergiu do freeze: ${record.path}`);
    observed.set(record.path, record.fileSha256);
  }
  assert(REPLAY_CRITICAL_SOURCES.every((path) => observed.has(path)),
    "replay e CLI não foram ambos conferidos contra o freeze");
  const materializerSources = manifest?.provenance?.sourceFiles;
  for (const [record, expectedPath] of [
    [materializerSources?.wrapper, "scripts/materialize-exp-0019-audio.mjs"],
    [materializerSources?.pythonMaterializer,
      "scripts/lib/materialize-exp-0019-supertonic.py"]
  ]) {
    assert(
      record?.path === expectedPath &&
        record.fileSha256 === frozenSources.get(expectedPath),
      `manifest diverge da fonte congelada: ${expectedPath}`
    );
  }
  assert(
    isDeepStrictEqual(
      manifest?.provenance?.modelArtifactBinding,
      freeze.tts.modelArtifactBinding
    ) &&
      isDeepStrictEqual(
        manifest?.provenance?.toolchainBinding,
        freeze.tts.toolchainBinding
      ) &&
      manifest?.provenance?.engine === EXP0019_TTS_CONFIG.engine &&
      manifest?.provenance?.model === EXP0019_TTS_CONFIG.model &&
      manifest?.provenance?.sdkVersion === EXP0019_TTS_CONFIG.sdkVersion &&
      manifest?.synthesis?.language === EXP0019_TTS_CONFIG.language &&
      manifest?.synthesis?.totalSteps === EXP0019_TTS_CONFIG.totalSteps &&
      manifest?.synthesis?.speed === EXP0019_TTS_CONFIG.speed &&
      manifest?.synthesis?.randomSeedBase ===
        EXP0019_TTS_CONFIG.randomness.baseSeed &&
      manifest?.synthesis?.randomSeedStrategy ===
        EXP0019_TTS_CONFIG.randomness.strategy &&
      manifest?.synthesis?.assistantSegmentsSynthesizedSeparately ===
        EXP0019_TTS_CONFIG.assistantSegmentsSynthesizedSeparately,
    "manifest diverge da configuração/pesos TTS congelados"
  );
}

function expectedStreamTexts(stream) {
  return stream.kind === "assistant" ? [
    stream.segments[0].text,
    stream.segments[1].text
  ] : [stream.text];
}

async function auditManifestAudio(plan, manifest, readWave) {
  assert(typeof readWave === "function", "readWave precisa ser função");
  const streams = plan.audio.streams;
  assert(Array.isArray(manifest.files) && manifest.files.length === 12,
    "manifest precisa conter exatamente 12 arquivos");
  assert(isDeepStrictEqual(
    manifest.files.map((file) => file.id),
    streams.map((stream) => stream.streamId)
  ), "manifest precisa preservar ids e ordem dos streams do plano");
  const audits = [];
  for (const [index, stream] of streams.entries()) {
    const file = manifest.files[index];
    assert(exactKeys(file, MANIFEST_FILE_KEYS),
      `${stream.streamId}: descriptor do manifest tem shape divergente`);
    const assistant = stream.kind === "assistant";
    const texts = expectedStreamTexts(stream);
    const expectedKinds = assistant
      ? ["audible-prefix", "neutral-tail"]
      : ["utterance"];
    const expectedVoice = assistant
      ? plan.audio.synthesis.voiceStyles.assistant
      : plan.audio.synthesis.voiceStyles.nonAssistant;
    assert(
      file.id === stream.streamId &&
        file.role === manifestRole(stream.kind) &&
        file.voiceStyle === expectedVoice &&
        file.relativePath === stream.relativePath &&
        file.sampleRate === EXP0019_SAMPLE_RATE &&
        file.channels === 1 &&
        file.bitsPerSample === 16 &&
        file.textSha256 === textSha256(texts[0]) &&
        file.tailTextSha256 ===
          (assistant ? textSha256(texts[1]) : null) &&
        validHash(file.waveSha256) && validHash(file.pcmSha256) &&
        Number.isSafeInteger(file.sampleCount) && file.sampleCount > 0 &&
        Array.isArray(file.segments) &&
        file.segments.length === expectedKinds.length,
      `${stream.streamId}: plano e descriptor de áudio divergiram`
    );
    let wave;
    try {
      wave = await readWave(stream.relativePath);
    } catch (error) {
      throw new Error(
        `replay Node EXP-0019: WAV ausente: ${stream.relativePath}`,
        { cause: error }
      );
    }
    assert(Buffer.isBuffer(wave), `${stream.streamId}: WAV precisa ser Buffer`);
    assert(sha256(wave) === file.waveSha256,
      `${stream.streamId}: waveSha256 divergente`);
    const inspected = inspectWave(wave);
    assert(
      inspected.audioFormat === 1 && inspected.channels === 1 &&
        inspected.sampleRate === EXP0019_SAMPLE_RATE &&
        inspected.bitsPerSample === 16 && inspected.blockAlign === 2 &&
        inspected.samplesPerChannel === file.sampleCount &&
        inspected.dataBytes === file.sampleCount * 2,
      `${stream.streamId}: formato ou duração WAV divergente`
    );
    const decoded = decodeWaveToPcm16(wave, {
      targetSampleRate: EXP0019_SAMPLE_RATE
    });
    assert(decoded.pcm.length / 2 === file.sampleCount,
      `${stream.streamId}: sampleCount divergente`);
    assert(sha256(decoded.pcm) === file.pcmSha256,
      `${stream.streamId}: pcmSha256 divergente`);
    const activity = inspectExp0019PcmActivity(decoded.pcm);
    assert(activity.onsetSample !== null,
      `${stream.streamId}: onset determinístico não encontrado`);
    const segments = [];
    let offsetSamples = 0;
    for (const [segmentIndex, descriptor] of file.segments.entries()) {
      const kind = expectedKinds[segmentIndex];
      const text = texts[segmentIndex];
      assert(
        exactKeys(descriptor, [
          "kind", "pcmSha256", "sampleCount", "textSha256"
        ]) && descriptor.kind === kind &&
          descriptor.textSha256 === textSha256(text) &&
          Number.isSafeInteger(descriptor.sampleCount) &&
          descriptor.sampleCount > 0 && validHash(descriptor.pcmSha256),
        `${stream.streamId}/${kind}: descriptor de segmento divergente`
      );
      const pcm = decoded.pcm.subarray(
        offsetSamples * 2,
        (offsetSamples + descriptor.sampleCount) * 2
      );
      assert(pcm.length === descriptor.sampleCount * 2,
        `${stream.streamId}/${kind}: duração excede o WAV`);
      assert(sha256(pcm) === descriptor.pcmSha256,
        `${stream.streamId}/${kind}: pcmSha256 divergente`);
      const segmentActivity = inspectExp0019PcmActivity(pcm);
      assert(segmentActivity.onsetSample !== null,
        `${stream.streamId}/${kind}: segmento sem fala sustentada`);
      segments.push({
        kind,
        sampleCount: descriptor.sampleCount,
        pcmSha256: descriptor.pcmSha256,
        onsetSample: segmentActivity.onsetSample,
        activeEndSampleExclusive: segmentActivity.activeEndSampleExclusive
      });
      offsetSamples += descriptor.sampleCount;
    }
    assert(offsetSamples === file.sampleCount,
      `${stream.streamId}: soma de segmentos diverge da duração`);
    assert(
      assistant
        ? file.prefixEndSample === file.segments[0].sampleCount &&
          file.prefixEndSample < file.sampleCount
        : file.prefixEndSample === null,
      `${stream.streamId}: fronteira prefixo/cauda divergente`
    );
    audits.push(deepFreeze({
      streamId: stream.streamId,
      kind: stream.kind,
      relativePath: stream.relativePath,
      waveSha256: file.waveSha256,
      pcmSha256: file.pcmSha256,
      sampleCount: file.sampleCount,
      onsetSample: activity.onsetSample,
      activeEndSampleExclusive: activity.activeEndSampleExclusive,
      prefixEndSample: file.prefixEndSample,
      segments
    }));
  }
  return deepFreeze(audits);
}

function buildPairSchedules(plan, streamAudits) {
  const auditById = new Map(streamAudits.map((stream) => [
    stream.streamId,
    stream
  ]));
  const grouped = Map.groupBy(plan.scenes, (scene) => scene.scorer.pairRootId);
  const pairs = [];
  const scheduleByPair = new Map();
  for (const [pairRootId, scenes] of [...grouped.entries()].toSorted(
    ([left], [right]) => left.localeCompare(right)
  )) {
    assert(scenes.length === 2, `${pairRootId}: par precisa ter duas cenas`);
    const targetIds = new Set(scenes.map(
      (scene) => scene.streamBindings.target
    ));
    assert(targetIds.size === 1,
      `${pairRootId}: target binding não é idêntico`);
    const target = auditById.get([...targetIds][0]);
    assert(target?.kind === "target", `${pairRootId}: target ausente`);
    const inbounds = scenes.map((scene) =>
      auditById.get(scene.streamBindings.inbound)
    );
    const assistants = scenes.map((scene) =>
      auditById.get(scene.streamBindings.assistant)
    );
    assert(inbounds.every((stream) => stream?.kind === "inbound") &&
      assistants.every((stream) => stream?.kind === "assistant"),
    `${pairRootId}: streams contextuais ausentes`);
    const inboundSlotSamples = Math.max(...inbounds.map(
      (stream) => stream.sampleCount
    ));
    const assistantPrefixSlotSamples = Math.max(...assistants.map(
      (stream) => stream.prefixEndSample
    ));
    const assistantTailPlaybackSamples =
      EXP0019_TARGET_OFFSET_SAMPLES + target.sampleCount +
      EXP0019_PROPOSAL_BUDGET_SAMPLES;
    for (const assistant of assistants) {
      const tail = assistant.segments[1];
      assert(tail.sampleCount >= assistantTailPlaybackSamples,
        `${assistant.streamId}: cauda termina antes do orçamento causal`);
      assert(
        tail.activeEndSampleExclusive !== null &&
          tail.activeEndSampleExclusive >= assistantTailPlaybackSamples,
        `${assistant.streamId}: cauda não permanece audível até o orçamento`
      );
    }
    const schedule = createExp0019CausalSchedule({
      inboundSlotSamples,
      assistantPrefixSlotSamples,
      assistantTotalSlotSamples:
        assistantPrefixSlotSamples + assistantTailPlaybackSamples,
      targetSampleCount: target.sampleCount,
      targetOnsetSample: target.onsetSample
    });
    assert(
      schedule.assistant.endSample ===
        schedule.target.endSample + EXP0019_PROPOSAL_BUDGET_SAMPLES,
      `${pairRootId}: horizonte audível normalizado divergiu`
    );
    const scheduleSha256 = `sha256:${canonicalSha256(schedule)}`;
    scheduleByPair.set(pairRootId, { schedule, scheduleSha256 });
    pairs.push({
      pairRootId,
      scheduleBindingKey: scenes[0].scheduleBindingKey,
      sceneIds: scenes.map((scene) => scene.sceneId).toSorted(),
      normalizedSlots: {
        inboundSlotSamples,
        assistantPrefixSlotSamples,
        assistantTailPlaybackSamples,
        targetSampleCount: target.sampleCount,
        targetOnsetSample: target.onsetSample
      },
      target: {
        streamId: target.streamId,
        relativePath: target.relativePath,
        waveSha256: target.waveSha256,
        pcmSha256: target.pcmSha256,
        sampleCount: target.sampleCount,
        onsetSample: target.onsetSample
      },
      schedule,
      scheduleSha256
    });
  }
  return { pairs: deepFreeze(pairs), scheduleByPair, auditById };
}

function predictionTrace(checkpoint, scene, armName, observedModelInput) {
  const fullModelInput = {
    assistantAudiblePrefixAtDecision:
      scene.oracleText.assistantAudiblePrefixAtDecision,
    assistantSpeaking: true,
    recentInbound: [...scene.oracleText.recentInbound],
    targetText: scene.oracleText.targetText
  };
  const contextEnabled = armName === "B1";
  const expectedModelInput = projectExp0018ModelInput(fullModelInput, {
    contextEnabled
  });
  assert(isDeepStrictEqual(observedModelInput, expectedModelInput),
    `${scene.sceneId}/${armName}: projeção do adapter divergiu`);
  const features = extractExp0018ContextFeatures(observedModelInput, {
    contextEnabled
  });
  const arm = checkpoint.arms[armName];
  const raw = predictSoftmaxClassifier(arm.model, features.values);
  const backgroundProbability =
    raw.probabilities[EXP0018_BACKGROUND];
  const predicted = backgroundProbability >= arm.threshold
    ? EXP0018_BACKGROUND : EXP0018_DIRECTED;
  const trace = {
    contextEnabled: arm.contextEnabled,
    modelSha256: arm.modelSha256,
    threshold: arm.threshold,
    featureValues: [...features.values],
    probabilities: structuredClone(raw.probabilities),
    backgroundProbability,
    rawPredicted: raw.label,
    predicted
  };
  const parityProjection = structuredClone(trace);
  delete parityProjection.probabilities;
  assert(isDeepStrictEqual(parityProjection, scene.frozenTrace[armName]),
    `${scene.sceneId}/${armName}: trace diverge do frozenTrace`);
  return deepFreeze(trace);
}

function compactAdapterResult(result) {
  return {
    status: result.status,
    classifierExecuted: result.classifierExecuted,
    inferenceCountDelta: result.inferenceCountDelta,
    canProduceEffects: result.canProduceEffects,
    missingEvidence: [...(result.missingEvidence ?? [])]
  };
}

function runPreBoundaryProbes(scene, schedule) {
  const definitions = [
    ["before-inbound-end", schedule.inbound.endSample - 1],
    ["before-assistant-prefix-end", schedule.assistant.prefixEndSample - 1],
    ["before-target-end", schedule.target.endSample - 1]
  ];
  return definitions.map(([boundary, currentSample]) => {
    assert(currentSample >= 0, `${scene.sceneId}/${boundary}: sample inválida`);
    const payload = createExp0019CausalPayload(
      scene.oracleText,
      schedule,
      currentSample
    );
    const arms = {};
    for (const armName of ARM_NAMES) {
      let classifierCalls = 0;
      const result = runExp0019CausalAdapter(payload, {
        armName,
        expectedAvailability: schedule.availability,
        classify() {
          classifierCalls += 1;
          return null;
        }
      });
      assert(
        result.status === EXP0019_DEFER_CAUSAL_EVIDENCE &&
          result.classifierExecuted === false &&
          result.inferenceCountDelta === 0 && classifierCalls === 0,
        `${scene.sceneId}/${boundary}/${armName}: probe executou inferência`
      );
      arms[armName] = compactAdapterResult(result);
    }
    return {
      boundary,
      currentSample,
      payload,
      payloadSha256: `sha256:${canonicalSha256(payload)}`,
      arms
    };
  });
}

function runReadyProposals(scene, schedule, checkpoint, now) {
  const currentSample = schedule.target.endSample;
  const payload = createExp0019CausalPayload(
    scene.oracleText,
    schedule,
    currentSample
  );
  const arms = {};
  for (const armName of ARM_NAMES) {
    let classifierCalls = 0;
    const start = now();
    const result = runExp0019CausalAdapter(payload, {
      armName,
      expectedAvailability: schedule.availability,
      classify(modelInput) {
        classifierCalls += 1;
        return predictionTrace(checkpoint, scene, armName, modelInput);
      }
    });
    const computeMs = now() - start;
    assert(validNonNegativeNumber(computeMs),
      `${scene.sceneId}/${armName}: relógio inválido`);
    assert(
      result.status === "SHADOW_PROPOSAL" &&
        result.classifierExecuted === true &&
        result.inferenceCountDelta === 1 &&
        result.canProduceEffects === false && classifierCalls === 1,
      `${scene.sceneId}/${armName}: proposta shadow inválida`
    );
    arms[armName] = {
      status: result.status,
      classifierExecuted: result.classifierExecuted,
      inferenceCountDelta: result.inferenceCountDelta,
      canProduceEffects: result.canProduceEffects,
      modelInput: result.modelInput,
      trace: result.proposal,
      computeMs,
      frozenTraceExact: true
    };
  }
  return {
    currentSample,
    payload,
    payloadSha256: `sha256:${canonicalSha256(payload)}`,
    arms
  };
}

function nearestRankP95(values) {
  assert(Array.isArray(values) && values.length > 0 &&
    values.every(validNonNegativeNumber), "latências inválidas");
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function runtimeFingerprintCore(bindings, configuration) {
  return {
    schemaVersion: EXP0019_RUNTIME_FINGERPRINT_SCHEMA,
    instrumentationFreezeSha256:
      bindings.instrumentationFreeze.canonicalSha256,
    audioAttemptSha256: bindings.audioAttempt.canonicalSha256,
    planSha256: bindings.plan.canonicalSha256,
    manifestSha256: bindings.manifest.canonicalSha256,
    checkpointSha256: bindings.checkpoint.canonicalSha256,
    sampleRate: configuration.sampleRate,
    onset: configuration.onset,
    fixedGapSamples: configuration.fixedGapSamples,
    targetAfterPrefixSamples: configuration.targetAfterPrefixSamples,
    assistantTailAfterTargetSamplesAtLeast:
      configuration.assistantTailAfterTargetSamplesAtLeast
  };
}

function artifactWithoutHash(artifact) {
  return withoutHash(artifact, "replaySha256");
}

export function validateExp0019NodeReplayArtifact(artifact, options = {}) {
  const errors = [];
  const push = (condition, message) => {
    if (!condition) errors.push(message);
  };
  try {
    push(
      artifact?.schemaVersion === EXP0019_NODE_REPLAY_SCHEMA &&
        artifact?.experimentId === "EXP-0019" &&
        artifact?.status === "NODE_REPLAY_COMPLETE",
      "identidade do replay incompatível"
    );
    push(
      artifact?.replaySha256 ===
        `sha256:${canonicalSha256(artifactWithoutHash(artifact))}`,
      "replaySha256 divergente"
    );
    push(
      artifact?.bindings?.instrumentationFreeze?.path ===
        EXP0019_INSTRUMENTATION_FREEZE_PATH &&
        validHash(artifact.bindings.instrumentationFreeze.fileSha256) &&
        validHash(artifact.bindings.instrumentationFreeze.canonicalSha256) &&
        /^[a-f0-9]{40}$/u.test(
          artifact.bindings.instrumentationFreeze.runnerSourceCommit ?? ""
        ),
      "binding do instrumentation freeze divergente"
    );
    push(
      artifact?.bindings?.audioAttempt?.path ===
        EXP0019_AUDIO_ATTEMPT_PATH &&
        validHash(artifact.bindings.audioAttempt.fileSha256) &&
        validHash(artifact.bindings.audioAttempt.canonicalSha256) &&
        /^[a-f0-9]{40}$/u.test(
          artifact.bindings.audioAttempt.executionHeadCommit ?? ""
        ),
      "binding da tentativa de áudio divergente"
    );
    const fingerprintCore = runtimeFingerprintCore(
      artifact.bindings,
      artifact.configuration
    );
    push(
      artifact?.bindings?.runtimeFingerprint?.schemaVersion ===
        EXP0019_RUNTIME_FINGERPRINT_SCHEMA &&
        artifact.bindings.runtimeFingerprint.sha256 ===
          `sha256:${canonicalSha256(fingerprintCore)}`,
      "runtime fingerprint divergente"
    );
    push(
      artifact?.configuration?.sampleRate === EXP0019_SAMPLE_RATE &&
        isDeepStrictEqual(artifact.configuration.onset, EXP0019_ONSET_CONFIG) &&
        artifact.configuration.fixedGapSamples ===
          EXP0019_FIXED_GAP_SAMPLES &&
        artifact.configuration.targetAfterPrefixSamples ===
          EXP0019_TARGET_OFFSET_SAMPLES &&
        artifact.configuration.assistantTailAfterTargetSamplesAtLeast ===
          EXP0019_PROPOSAL_BUDGET_SAMPLES,
      "configuração causal divergente"
    );
    push(Array.isArray(artifact?.audio?.streams) &&
      artifact.audio.streams.length === 12,
    "auditoria precisa conter 12 streams");
    push(Array.isArray(artifact?.pairs) && artifact.pairs.length === 4,
      "replay precisa conter quatro pares");
    push(Array.isArray(artifact?.scenes) && artifact.scenes.length === 8,
      "replay precisa conter oito cenas");
    const pairById = new Map((artifact.pairs ?? []).map((pair) => [
      pair.pairRootId,
      pair
    ]));
    push(pairById.size === 4, "pairRootId duplicado");
    let proposalCount = 0;
    let preBoundaryArmProbes = 0;
    const computeMs = [];
    for (const scene of artifact.scenes ?? []) {
      const pair = pairById.get(scene.pairRootId);
      push(Boolean(pair), `${scene.sceneId}: par ausente`);
      push(
        pair && isDeepStrictEqual(scene.schedule, pair.schedule) &&
          scene.scheduleSha256 === pair.scheduleSha256 &&
          scene.scheduleSha256 ===
            `sha256:${canonicalSha256(scene.schedule)}`,
        `${scene.sceneId}: schedule pareado divergiu`
      );
      push(
        scene.schedule?.assistant?.endSample >=
          scene.schedule?.target?.endSample +
            EXP0019_PROPOSAL_BUDGET_SAMPLES,
        `${scene.sceneId}: cauda causal insuficiente`
      );
      push(Array.isArray(scene.probes) && scene.probes.length === 3,
        `${scene.sceneId}: probes pré-fronteira divergiram`);
      push(isDeepStrictEqual(
        (scene.probes ?? []).map((probe) => probe.boundary),
        [
          "before-inbound-end",
          "before-assistant-prefix-end",
          "before-target-end"
        ]
      ), `${scene.sceneId}: ordem dos probes divergiu`);
      for (const probe of scene.probes ?? []) {
        push(isDeepStrictEqual(Object.keys(probe?.arms ?? {}).sort(),
          [...ARM_NAMES]),
        `${scene.sceneId}/${probe?.boundary}: braços dos probes divergiram`);
        for (const armName of ARM_NAMES) {
          const arm = probe?.arms?.[armName];
          preBoundaryArmProbes += 1;
          push(
            arm?.status === EXP0019_DEFER_CAUSAL_EVIDENCE &&
              arm.classifierExecuted === false &&
              arm.inferenceCountDelta === 0 &&
              arm.canProduceEffects === false,
            `${scene.sceneId}/${probe?.boundary}/${armName}: probe inválido`
          );
        }
      }
      push(scene.ready?.currentSample === scene.schedule?.target?.endSample,
        `${scene.sceneId}: proposta fora da fronteira targetEnd`);
      push(isDeepStrictEqual(Object.keys(scene.ready?.arms ?? {}).sort(),
        [...ARM_NAMES]),
      `${scene.sceneId}: propostas precisam conter somente B0/B1`);
      for (const armName of ARM_NAMES) {
        const arm = scene.ready?.arms?.[armName];
        proposalCount += 1;
        if (validNonNegativeNumber(arm?.computeMs)) {
          computeMs.push(arm.computeMs);
        }
        push(
          arm?.status === "SHADOW_PROPOSAL" &&
            arm.classifierExecuted === true &&
            arm.inferenceCountDelta === 1 &&
            arm.canProduceEffects === false &&
            arm.frozenTraceExact === true &&
            exactKeys(arm.trace?.probabilities, [
              EXP0018_BACKGROUND,
              EXP0018_DIRECTED
            ]) &&
            Object.values(arm.trace.probabilities).every(
              (value) => Number.isFinite(value) && value >= 0 && value <= 1
            ) &&
            Math.abs(Object.values(arm.trace.probabilities).reduce(
              (sum, value) => sum + value,
              0
            ) - 1) <= Number.EPSILON * 4 &&
            arm.trace.backgroundProbability ===
              arm.trace.probabilities[EXP0018_BACKGROUND],
          `${scene.sceneId}/${armName}: proposta ou trace inválido`
        );
      }
    }
    push(
      artifact?.summary?.scenes === 8 &&
        artifact.summary.pairs === 4 &&
        artifact.summary.proposals === proposalCount &&
        proposalCount === 16 &&
        artifact.summary.preBoundaryArmProbes === preBoundaryArmProbes &&
        preBoundaryArmProbes === 48 &&
        artifact.summary.preBoundaryInferences === 0 &&
        artifact.summary.frozenTraceParity === "16/16" &&
        computeMs.length === 16 &&
        artifact.summary.nodeComputeP95Ms === nearestRankP95(computeMs),
      "sumário do replay divergiu"
    );
    push(
      artifact?.authority?.mode === "offline-shadow-only" &&
        artifact.authority.canProduceEffects === false &&
        artifact.authority.effectsDispatched === 0,
      "autoridade do replay divergiu"
    );
    if (options.plan) {
      const planScenes = new Map(options.plan.scenes.map((scene) => [
        scene.sceneId,
        scene
      ]));
      push(
        artifact.bindings.plan.canonicalSha256 === options.plan.planSha256,
        "binding canônico do plano divergiu"
      );
      for (const scene of artifact.scenes ?? []) {
        const frozen = planScenes.get(scene.sceneId);
        push(Boolean(frozen), `${scene.sceneId}: cena não existe no plano`);
        for (const armName of ARM_NAMES) {
          const trace = structuredClone(scene.ready?.arms?.[armName]?.trace);
          delete trace?.probabilities;
          push(
            frozen && isDeepStrictEqual(trace, frozen.frozenTrace[armName]),
            `${scene.sceneId}/${armName}: frozenTrace divergiu`
          );
        }
      }
    }
    if (options.instrumentationFreeze) {
      push(
        artifact.bindings.instrumentationFreeze.canonicalSha256 ===
          options.instrumentationFreeze.instrumentationFreezeSha256 &&
          artifact.bindings.instrumentationFreeze.runnerSourceCommit ===
            options.instrumentationFreeze.runnerSourceCommit &&
          artifact.runtime.nodeVersion === options.instrumentationFreeze.nodeVersion,
        "artefato diverge do instrumentation freeze fornecido"
      );
    }
  } catch (error) {
    errors.push(error.message);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export async function buildExp0019NodeReplay(input = {}) {
  const planRecord = parseJsonRecord(input.planRecord, "planRecord");
  const freezeRecord = parseJsonRecord(
    input.instrumentationFreezeRecord,
    "instrumentationFreezeRecord"
  );
  const manifestRecord = parseJsonRecord(
    input.manifestRecord,
    "manifestRecord"
  );
  const attemptRecord = parseJsonRecord(
    input.audioAttemptRecord,
    "audioAttemptRecord"
  );
  const checkpointRecord = parseJsonRecord(
    input.checkpointRecord,
    "checkpointRecord"
  );
  const plan = planRecord.value;
  const freeze = freezeRecord.value;
  const manifest = manifestRecord.value;
  const checkpoint = checkpointRecord.value;
  const planValidation = validateExp0019CausalAudioPlan(plan);
  assert(planValidation.valid,
    `plano inválido: ${planValidation.errors.join("; ")}`);
  assertManifestEnvelope(manifest, planRecord);
  const checkpointValidation = validateExp0018Checkpoint(checkpoint);
  assert(checkpointValidation.valid,
    `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`);
  assert(
    checkpointRecord.path === plan.bindings.checkpoint.path &&
      checkpointRecord.fileSha256 === plan.bindings.checkpoint.fileSha256 &&
      checkpoint.checkpointSha256 ===
        plan.bindings.checkpoint.canonicalSha256,
    "checkpoint diverge do binding congelado no plano"
  );
  const nodeVersion = input.nodeVersion ?? process.version;
  assert(nodeVersion === freeze.nodeVersion,
    "versão Node diverge do instrumentation freeze");
  assertFreezeChain({
    freezeRecord,
    freeze,
    planRecord,
    checkpointRecord,
    manifest,
    criticalSourceRecords: input.criticalSourceRecords
  });
  assertAudioAttemptChain({
    attemptRecord,
    freezeRecord,
    freeze,
    manifestRecord,
    manifest,
    planRecord
  });
  const streamAudits = await auditManifestAudio(
    plan,
    manifest,
    input.readWave
  );
  const { pairs, scheduleByPair, auditById } = buildPairSchedules(
    plan,
    streamAudits
  );
  const now = input.now ?? (() => performance.now());
  assert(typeof now === "function", "now precisa ser função");
  const scenes = [];
  for (const scene of plan.scenes) {
    const pair = scheduleByPair.get(scene.scorer.pairRootId);
    assert(pair, `${scene.sceneId}: schedule do par ausente`);
    const inbound = auditById.get(scene.streamBindings.inbound);
    const assistant = auditById.get(scene.streamBindings.assistant);
    const target = auditById.get(scene.streamBindings.target);
    const normalizedPair = pairs.find((item) =>
      item.pairRootId === scene.scorer.pairRootId
    );
    const normalization = {
      inboundLeadingSilenceSamples:
        normalizedPair.normalizedSlots.inboundSlotSamples -
          inbound.sampleCount,
      assistantLeadingSilenceSamples:
        normalizedPair.normalizedSlots.assistantPrefixSlotSamples -
          assistant.prefixEndSample,
      assistantTailPlaybackSamples:
        normalizedPair.normalizedSlots.assistantTailPlaybackSamples,
      assistantTailAvailableSamples: assistant.segments[1].sampleCount,
      assistantTailActiveEndSampleExclusive:
        assistant.segments[1].activeEndSampleExclusive,
      targetWaveSha256: target.waveSha256,
      targetPcmSha256: target.pcmSha256
    };
    assert(
      normalization.inboundLeadingSilenceSamples >= 0 &&
        normalization.assistantLeadingSilenceSamples >= 0 &&
        normalization.assistantTailActiveEndSampleExclusive >=
          normalization.assistantTailPlaybackSamples,
      `${scene.sceneId}: normalização exigiria áudio futuro ou silêncio na cauda`
    );
    const probes = runPreBoundaryProbes(scene, pair.schedule);
    const ready = runReadyProposals(scene, pair.schedule, checkpoint, now);
    scenes.push({
      sceneId: scene.sceneId,
      pairRootId: scene.scorer.pairRootId,
      scorer: structuredClone(scene.scorer),
      streamBindings: structuredClone(scene.streamBindings),
      scheduleBindingKey: scene.scheduleBindingKey,
      normalization,
      schedule: pair.schedule,
      scheduleSha256: pair.scheduleSha256,
      probes,
      ready
    });
  }
  const configuration = {
    sampleRate: EXP0019_SAMPLE_RATE,
    onset: structuredClone(EXP0019_ONSET_CONFIG),
    fixedGapSamples: EXP0019_FIXED_GAP_SAMPLES,
    targetAfterPrefixSamples: EXP0019_TARGET_OFFSET_SAMPLES,
    assistantTailAfterTargetSamplesAtLeast:
      EXP0019_PROPOSAL_BUDGET_SAMPLES,
    pairNormalization:
      "leading-silence-aligns-observed-ends;spoken-tail-truncated-to-common-horizon"
  };
  const bindings = {
    instrumentationFreeze: {
      path: freezeRecord.path,
      fileSha256: freezeRecord.fileSha256,
      canonicalSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    },
    audioAttempt: {
      path: attemptRecord.path,
      fileSha256: attemptRecord.fileSha256,
      canonicalSha256: attemptRecord.value.attemptSha256,
      executionHeadCommit: attemptRecord.value.executionHeadCommit
    },
    plan: {
      path: planRecord.path,
      fileSha256: planRecord.fileSha256,
      canonicalSha256: plan.planSha256
    },
    manifest: {
      path: manifestRecord.path,
      fileSha256: manifestRecord.fileSha256,
      canonicalSha256: manifest.manifestSha256
    },
    checkpoint: {
      path: checkpointRecord.path,
      fileSha256: checkpointRecord.fileSha256,
      canonicalSha256: checkpoint.checkpointSha256
    }
  };
  const fingerprintCore = runtimeFingerprintCore(bindings, configuration);
  bindings.runtimeFingerprint = {
    schemaVersion: EXP0019_RUNTIME_FINGERPRINT_SCHEMA,
    sha256: `sha256:${canonicalSha256(fingerprintCore)}`
  };
  const computeMs = scenes.flatMap((scene) => ARM_NAMES.map(
    (armName) => scene.ready.arms[armName].computeMs
  ));
  const core = {
    schemaVersion: EXP0019_NODE_REPLAY_SCHEMA,
    experimentId: "EXP-0019",
    status: "NODE_REPLAY_COMPLETE",
    bindings,
    configuration,
    runtime: {
      engine: "node",
      nodeVersion
    },
    audio: {
      streams: streamAudits,
      targetPairEqualityExact: true,
      assistantTailAudibleThroughBudget: true
    },
    pairs,
    scenes,
    summary: {
      scenes: scenes.length,
      pairs: pairs.length,
      proposals: scenes.length * ARM_NAMES.length,
      preBoundaryArmProbes: scenes.length * 3 * ARM_NAMES.length,
      preBoundaryInferences: 0,
      frozenTraceParity: "16/16",
      nodeComputeP95Ms: nearestRankP95(computeMs),
      nodeComputeBudgetMs: 50,
      nodeComputeWithinBudget: nearestRankP95(computeMs) <= 50
    },
    authority: {
      mode: "offline-shadow-only",
      canProduceEffects: false,
      effectsDispatched: 0
    }
  };
  const replay = deepFreeze({
    ...core,
    replaySha256: `sha256:${canonicalSha256(core)}`
  });
  const replayValidation = validateExp0019NodeReplayArtifact(replay, {
    plan,
    instrumentationFreeze: freeze
  });
  assert(replayValidation.valid,
    `artefato derivado inválido: ${replayValidation.errors.join("; ")}`);
  return replay;
}
