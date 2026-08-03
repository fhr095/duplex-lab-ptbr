import { createHash } from "node:crypto";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import {
  validateExp0017SupertonicPlan,
  validateExp0017SupertonicSourceManifest
} from "./exp-0017-supertonic.mjs";

export const EXP0017_R_ALIGNMENT_REQUEST_SCHEMA =
  "exp-0017-r-oracle-alignment-request-v2";
export const EXP0017_R_RAW_ALIGNMENT_SCHEMA =
  "exp-0017-r-oracle-raw-alignment-v2";
export const EXP0017_R_ORACLE_PREFIX_MAP_SCHEMA =
  "exp-0017-r-oracle-prefix-map-v2";
export const EXP0017_R_WHISPER_SMALL_REVISION =
  "536b0662742c02347bc0e980a01041f333bce120";
export const EXP0017_R_DECISION_SAMPLES = 8_960;
export const EXP0017_R_MARGIN_SAMPLES = 1_280;
export const EXP0017_R_ELIGIBLE_THROUGH_SAMPLE =
  EXP0017_R_DECISION_SAMPLES - EXP0017_R_MARGIN_SAMPLES;
export const EXP0017_R_ALIGNMENT_INPUT_POLICY =
  "physically-truncated-wav-only";
export const EXP0017_R_MODEL_SNAPSHOT_FILES = Object.freeze([
  Object.freeze({
    name: "config.json",
    sha256:
      "sha256:b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828",
    sizeBytes: 2_370
  }),
  Object.freeze({
    name: "model.bin",
    sha256:
      "sha256:3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
    sizeBytes: 483_546_902
  }),
  Object.freeze({
    name: "tokenizer.json",
    sha256:
      "sha256:fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
    sizeBytes: 2_203_239
  }),
  Object.freeze({
    name: "vocabulary.txt",
    sha256:
      "sha256:34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
    sizeBytes: 459_861
  })
]);

const SAMPLE_RATE = 16_000;
const SPLITS = Object.freeze(["train", "development"]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DEFER_REASONS = new Set([
  "alignment-empty",
  "no-complete-token-before-margin",
  "aligned-prefix-disagrees"
]);
const ALIGNMENT_SOURCE_FIELDS = Object.freeze([
  "sceneId",
  "partition",
  "truncatedRelativePath",
  "sourceWaveSha256",
  "sourcePcmSha256",
  "truncatedWaveSha256",
  "truncatedPcmSha256",
  "sourceOnsetSample",
  "acceptedThroughSample",
  "inputStartSample",
  "inputEndSampleExclusive",
  "futureSamplesUsed"
]);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function withoutMapHash(value) {
  const core = structuredClone(value ?? {});
  delete core.mapSha256;
  return core;
}

function withoutEntryHash(value) {
  const core = structuredClone(value ?? {});
  delete core.entrySha256;
  return core;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort());
}

function validHash(value) {
  return HASH_PATTERN.test(value ?? "");
}

function validSnapshotFiles(files) {
  return Array.isArray(files) &&
    files.length === EXP0017_R_MODEL_SNAPSHOT_FILES.length &&
    files.every((file, index) =>
      exactKeys(file, ["name", "sha256", "sizeBytes"]) &&
      same(file, EXP0017_R_MODEL_SNAPSHOT_FILES[index]) &&
      validHash(file.sha256) &&
      Number.isSafeInteger(file.sizeBytes) &&
      file.sizeBytes > 0
    );
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    freeze(nested);
  }
  return Object.freeze(value);
}

export function normalizeExp0017ROracleText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokens(value) {
  const normalized = normalizeExp0017ROracleText(value);
  return normalized ? normalized.split(" ") : [];
}

export function createExp0017ROracleAlignmentRequest(input = {}) {
  const planValidation = validateExp0017SupertonicPlan(input.plan);
  const sourceValidation = validateExp0017SupertonicSourceManifest(
    input.sourceManifest
  );
  if (!planValidation.valid || !sourceValidation.valid) {
    throw new TypeError([
      ...planValidation.errors,
      ...sourceValidation.errors
    ].join("; "));
  }
  const scenes = new Map(SPLITS.flatMap((partition) =>
    input.plan.scenes[partition].map((scene) => [scene.id, {
      ...scene,
      partition
    }])
  ));
  const truncatedSources = new Map(
    (input.truncatedSources ?? []).map((source) => [source.sceneId, source])
  );
  if (
    truncatedSources.size !== 60 ||
    truncatedSources.size !== (input.truncatedSources ?? []).length
  ) {
    throw new TypeError("insumos truncados precisam conter 60 fontes únicas");
  }
  const sources = input.sourceManifest.files.map((file) => {
    const scene = scenes.get(file.sceneId);
    const truncated = truncatedSources.get(file.sceneId);
    if (
      !scene ||
      scene.partition !== file.partition ||
      file.textSha256 !== sha256(Buffer.from(scene.text, "utf8")) ||
      !truncated ||
      truncated.partition !== file.partition ||
      truncated.sourceWaveSha256 !== file.waveSha256 ||
      truncated.sourcePcmSha256 !== file.pcmSha256
    ) {
      throw new TypeError(`${file.sceneId}: plano e fonte divergem`);
    }
    return {
      sceneId: file.sceneId,
      partition: file.partition,
      truncatedRelativePath: truncated.truncatedRelativePath,
      sourceWaveSha256: truncated.sourceWaveSha256,
      sourcePcmSha256: truncated.sourcePcmSha256,
      truncatedWaveSha256: truncated.truncatedWaveSha256,
      truncatedPcmSha256: truncated.truncatedPcmSha256,
      sourceOnsetSample: truncated.sourceOnsetSample,
      acceptedThroughSample: truncated.acceptedThroughSample,
      inputStartSample: truncated.inputStartSample,
      inputEndSampleExclusive: truncated.inputEndSampleExclusive,
      futureSamplesUsed: truncated.futureSamplesUsed
    };
  }).sort((left, right) =>
    SPLITS.indexOf(left.partition) - SPLITS.indexOf(right.partition) ||
    left.sceneId.localeCompare(right.sceneId)
  );
  return freeze({
    schemaVersion: EXP0017_R_ALIGNMENT_REQUEST_SCHEMA,
    sampleRate: SAMPLE_RATE,
    inputPolicy: EXP0017_R_ALIGNMENT_INPUT_POLICY,
    futureSamplesUsed: 0,
    sources
  });
}

export function validateExp0017ROracleAlignmentRequest(request) {
  const errors = [];
  if (
    !exactKeys(request, [
      "schemaVersion",
      "sampleRate",
      "inputPolicy",
      "futureSamplesUsed",
      "sources"
    ]) ||
    request?.schemaVersion !== EXP0017_R_ALIGNMENT_REQUEST_SCHEMA ||
    request?.sampleRate !== SAMPLE_RATE ||
    request?.inputPolicy !== EXP0017_R_ALIGNMENT_INPUT_POLICY ||
    request?.futureSamplesUsed !== 0
  ) {
    errors.push("contrato principal do request inválido");
  }
  const sources = Array.isArray(request?.sources) ? request.sources : [];
  if (
    sources.length !== 60 ||
    new Set(sources.map((source) => source?.sceneId)).size !== 60 ||
    new Set(sources.map(
      (source) => source?.truncatedRelativePath
    )).size !== 60
  ) {
    errors.push("request precisa conter 60 fontes únicas");
  }
  for (const source of sources) {
    if (
      !exactKeys(source, ALIGNMENT_SOURCE_FIELDS) ||
      typeof source.sceneId !== "string" ||
      source.sceneId.length === 0 ||
      !SPLITS.includes(source.partition) ||
      typeof source.truncatedRelativePath !== "string" ||
      !source.truncatedRelativePath.startsWith(
        "eval/generated/exp-0017/r/truncated/"
      ) ||
      !validHash(source.sourceWaveSha256) ||
      !validHash(source.sourcePcmSha256) ||
      !validHash(source.truncatedWaveSha256) ||
      !validHash(source.truncatedPcmSha256) ||
      !Number.isSafeInteger(source.sourceOnsetSample) ||
      source.sourceOnsetSample < 0 ||
      source.acceptedThroughSample !==
        source.sourceOnsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE ||
      source.inputStartSample !== 0 ||
      source.inputEndSampleExclusive !==
        source.sourceOnsetSample + EXP0017_R_DECISION_SAMPLES ||
      source.futureSamplesUsed !== 0
    ) {
      errors.push(`${source?.sceneId ?? "fonte"}: request inválido`);
    }
  }
  for (const split of SPLITS) {
    if (sources.filter((source) => source.partition === split).length !== 30) {
      errors.push(`${split}: request precisa conter 30 fontes`);
    }
  }
  return freeze({ valid: errors.length === 0, errors });
}

function validWord(word) {
  return exactKeys(word, [
    "startSeconds",
    "endSeconds",
    "text",
    "probability"
  ]) &&
    Number.isFinite(word.startSeconds) &&
    word.startSeconds >= 0 &&
    Number.isFinite(word.endSeconds) &&
    word.endSeconds >= word.startSeconds &&
    typeof word.text === "string" &&
    word.text.length > 0 &&
    (word.probability === null || (
      Number.isFinite(word.probability) &&
      word.probability >= 0 &&
      word.probability <= 1
    ));
}

function validSegment(segment) {
  return exactKeys(segment, [
    "startSeconds",
    "endSeconds",
    "text",
    "words"
  ]) &&
    Number.isFinite(segment.startSeconds) &&
    segment.startSeconds >= 0 &&
    Number.isFinite(segment.endSeconds) &&
    segment.endSeconds >= segment.startSeconds &&
    typeof segment.text === "string" &&
    Array.isArray(segment.words) &&
    segment.words.every(validWord);
}

function timestampStartSample(seconds) {
  return Math.floor(seconds * SAMPLE_RATE);
}

function timestampEndSample(seconds) {
  return Math.ceil(seconds * SAMPLE_RATE);
}

function withinPhysicalInput(item, source) {
  return timestampStartSample(item.startSeconds) >= source.inputStartSample &&
    timestampEndSample(item.endSeconds) <= source.inputEndSampleExclusive;
}

export function validateExp0017RRawAlignment(raw, expected = {}) {
  const errors = [];
  if (
    !exactKeys(raw, [
      "schemaVersion",
      "requestSha256",
      "sampleRate",
      "inputPolicy",
      "futureSamplesUsed",
      "model",
      "decoding",
      "sources"
    ]) ||
    raw?.schemaVersion !== EXP0017_R_RAW_ALIGNMENT_SCHEMA ||
    raw?.sampleRate !== SAMPLE_RATE ||
    raw?.inputPolicy !== EXP0017_R_ALIGNMENT_INPUT_POLICY ||
    raw?.futureSamplesUsed !== 0 ||
    !validHash(raw?.requestSha256) ||
    !exactKeys(raw?.model, [
      "engine",
      "name",
      "revision",
      "device",
      "computeType",
      "cpuThreads",
      "numWorkers",
      "wordTimestamps",
      "localFilesOnly",
      "fasterWhisperVersion",
      "snapshotFiles",
      "inputPolicy",
      "futureSamplesUsed"
    ]) ||
    raw?.model?.engine !== "faster-whisper" ||
    raw?.model?.name !== "small" ||
    raw?.model?.revision !== EXP0017_R_WHISPER_SMALL_REVISION ||
    raw?.model?.device !== "cpu" ||
    raw?.model?.computeType !== "int8" ||
    typeof raw?.model?.fasterWhisperVersion !== "string" ||
    raw.model.fasterWhisperVersion.length === 0 ||
    raw?.model?.wordTimestamps !== true ||
    raw?.model?.localFilesOnly !== true ||
    raw?.model?.inputPolicy !== EXP0017_R_ALIGNMENT_INPUT_POLICY ||
    raw?.model?.futureSamplesUsed !== 0 ||
    raw?.model?.cpuThreads !== 4 ||
    raw?.model?.numWorkers !== 1 ||
    !validSnapshotFiles(raw?.model?.snapshotFiles) ||
    !exactKeys(raw?.decoding, [
      "language",
      "beamSize",
      "bestOf",
      "temperature",
      "conditionOnPreviousText",
      "vadFilter"
    ]) ||
    raw?.decoding?.language !== "pt" ||
    raw?.decoding?.beamSize !== 1 ||
    raw?.decoding?.bestOf !== 1 ||
    raw?.decoding?.temperature !== 0 ||
    raw?.decoding?.conditionOnPreviousText !== false ||
    raw?.decoding?.vadFilter !== false
  ) {
    errors.push("contrato principal do alinhamento bruto inválido");
  }
  if (
    expected.requestSha256 !== undefined &&
    raw?.requestSha256 !== expected.requestSha256
  ) {
    errors.push("requestSha256 do alinhamento bruto divergente");
  }
  const requestSources = new Map(
    (expected.request?.sources ?? []).map((source) => [source.sceneId, source])
  );
  const sources = Array.isArray(raw?.sources) ? raw.sources : [];
  if (
    sources.length !== 60 ||
    new Set(sources.map((source) => source?.sceneId)).size !== 60
  ) {
    errors.push("alinhamento bruto precisa conter 60 fontes únicas");
  }
  for (const source of sources) {
    const requestSource = requestSources.get(source?.sceneId);
    if (
      !exactKeys(source, [
        ...ALIGNMENT_SOURCE_FIELDS,
        "decodedText",
        "language",
        "languageProbability",
        "durationSeconds",
        "segments",
        "words"
      ]) ||
      typeof source?.sceneId !== "string" ||
      !SPLITS.includes(source?.partition) ||
      typeof source?.truncatedRelativePath !== "string" ||
      !validHash(source?.sourceWaveSha256) ||
      !validHash(source?.sourcePcmSha256) ||
      !validHash(source?.truncatedWaveSha256) ||
      !validHash(source?.truncatedPcmSha256) ||
      !Number.isSafeInteger(source?.sourceOnsetSample) ||
      source.sourceOnsetSample < 0 ||
      source?.acceptedThroughSample !==
        source.sourceOnsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE ||
      source?.inputStartSample !== 0 ||
      source?.inputEndSampleExclusive !==
        source.sourceOnsetSample + EXP0017_R_DECISION_SAMPLES ||
      source?.futureSamplesUsed !== 0 ||
      typeof source?.decodedText !== "string" ||
      typeof source?.language !== "string" ||
      source.language.length === 0 ||
      (source?.languageProbability !== null &&
        !Number.isFinite(source?.languageProbability)) ||
      !Number.isFinite(source?.durationSeconds) ||
      source.durationSeconds < 0 ||
      timestampEndSample(source.durationSeconds) >
        source.inputEndSampleExclusive ||
      !Array.isArray(source?.segments) ||
      source.segments.some((segment) => !validSegment(segment)) ||
      !Array.isArray(source?.words) ||
      source.words.some((word) => !validWord(word))
    ) {
      errors.push(`${source?.sceneId ?? "fonte"}: alinhamento bruto inválido`);
      continue;
    }
    let previousStart = -1;
    for (const word of source.words) {
      const startSample = timestampStartSample(word.startSeconds);
      if (startSample < previousStart) {
        errors.push(`${source.sceneId}: timestamps fora de ordem`);
        break;
      }
      if (!withinPhysicalInput(word, source)) {
        errors.push(`${source.sceneId}: palavra ultrapassa WAV truncado`);
        break;
      }
      previousStart = startSample;
    }
    for (const segment of source.segments) {
      if (
        !withinPhysicalInput(segment, source) ||
        segment.words.some((word) => !withinPhysicalInput(word, source))
      ) {
        errors.push(`${source.sceneId}: segmento ultrapassa WAV truncado`);
        break;
      }
    }
    if (requestSources.size > 0 && (
      requestSource === undefined ||
      ALIGNMENT_SOURCE_FIELDS.some(
        (field) => requestSource[field] !== source[field]
      )
    )) {
      errors.push(`${source.sceneId}: alinhamento diverge do request`);
    }
  }
  if (
    requestSources.size > 0 &&
    requestSources.size !== sources.length
  ) {
    errors.push("universo do alinhamento diverge do request");
  }
  return freeze({ valid: errors.length === 0, errors });
}

export function deriveExp0017ROraclePrefixEntry(input = {}) {
  const raw = input.rawSource;
  const onsetSample = raw?.sourceOnsetSample;
  if (
    !Number.isSafeInteger(onsetSample) ||
    onsetSample < 0 ||
    !raw ||
    typeof raw.sceneId !== "string" ||
    !SPLITS.includes(raw.partition) ||
    !Array.isArray(raw.words) ||
    raw.words.some((word) => !validWord(word)) ||
    raw.words.some((word) => !withinPhysicalInput(word, raw)) ||
    !validHash(raw.sourceWaveSha256) ||
    !validHash(raw.sourcePcmSha256) ||
    !validHash(raw.truncatedWaveSha256) ||
    !validHash(raw.truncatedPcmSha256) ||
    raw.inputStartSample !== 0 ||
    raw.acceptedThroughSample !==
      onsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE ||
    raw.inputEndSampleExclusive !==
      onsetSample + EXP0017_R_DECISION_SAMPLES ||
    raw.futureSamplesUsed !== 0 ||
    typeof input.referenceText !== "string" ||
    input.referenceText.length === 0
  ) {
    throw new TypeError("entrada do prefixo-oráculo inválida");
  }
  const referenceTokens = tokens(input.referenceText);
  const eligible = [];
  for (const word of raw.words) {
    const endSourceSample = timestampEndSample(word.endSeconds);
    const endSample = endSourceSample - onsetSample;
    const normalizedTokens = tokens(word.text);
    if (
      endSample <= 0 ||
      endSample > EXP0017_R_ELIGIBLE_THROUGH_SAMPLE
    ) {
      continue;
    }
    for (const token of normalizedTokens) {
      eligible.push({ token, endSample });
    }
  }

  let text = null;
  let audioEndSample = null;
  let status = "deferred";
  let reason = "alignment-empty";
  if (raw.words.length > 0 && eligible.length === 0) {
    reason = "no-complete-token-before-margin";
  } else if (eligible.length > 0) {
    const alignedTokens = eligible.map((item) => item.token);
    const matches = alignedTokens.length <= referenceTokens.length &&
      alignedTokens.every((token, index) => token === referenceTokens[index]);
    if (matches) {
      text = alignedTokens.join(" ");
      audioEndSample = Math.max(...eligible.map((item) => item.endSample));
      status = "accepted";
      reason = "aligned-prefix-match";
    } else {
      reason = "aligned-prefix-disagrees";
    }
  }

  return finalizeExp0017ROraclePrefixEntry({
    sceneId: raw.sceneId,
    partition: raw.partition,
    waveSha256: raw.sourceWaveSha256,
    pcmSha256: raw.sourcePcmSha256,
    truncatedWaveSha256: raw.truncatedWaveSha256,
    truncatedPcmSha256: raw.truncatedPcmSha256,
    referenceTextSha256: sha256(Buffer.from(input.referenceText, "utf8")),
    sourceOnsetSample: onsetSample,
    acceptedThroughSample: raw.acceptedThroughSample,
    inputStartSample: raw.inputStartSample,
    inputEndSampleExclusive: raw.inputEndSampleExclusive,
    sampleRate: SAMPLE_RATE,
    decisionSample: EXP0017_R_DECISION_SAMPLES,
    marginSamples: EXP0017_R_MARGIN_SAMPLES,
    eligibleThroughSample: EXP0017_R_ELIGIBLE_THROUGH_SAMPLE,
    text,
    audioEndSample,
    status,
    reason,
    futureSamplesUsed: 0
  });
}

export function exp0017ROraclePrefixEntrySha256(entry) {
  return `sha256:${canonicalSha256(withoutEntryHash(entry))}`;
}

export function finalizeExp0017ROraclePrefixEntry(core) {
  const without = withoutEntryHash(core);
  return freeze({
    ...without,
    entrySha256: exp0017ROraclePrefixEntrySha256(without)
  });
}

export function finalizeExp0017ROraclePrefixMap(core) {
  const without = withoutMapHash(core);
  return freeze({
    ...without,
    mapSha256: `sha256:${canonicalSha256(without)}`
  });
}

export function validateExp0017ROraclePrefixMap(map, expected = {}) {
  const errors = [];
  const observedHash = `sha256:${canonicalSha256(withoutMapHash(map))}`;
  if (map?.mapSha256 !== observedHash) {
    errors.push("mapSha256 divergente");
  }
  if (
    !exactKeys(map, [
      "schemaVersion",
      "experimentId",
      "locale",
      "role",
      "boundary",
      "inputs",
      "alignment",
      "sources",
      "mapSha256"
    ]) ||
    map?.schemaVersion !== EXP0017_R_ORACLE_PREFIX_MAP_SCHEMA ||
    map?.experimentId !== "exp-0017-r-oracle-v0.1" ||
    map?.locale !== "pt-BR" ||
    map?.role !== "causal-oracle-prefix-development-screen-only" ||
    !exactKeys(map?.boundary, ["allowedSplits", "holdoutRead"]) ||
    !exactKeys(map?.inputs, [
      "planFileSha256",
      "sourceManifestFileSha256",
      "alignmentRequestFileSha256",
      "rawAlignmentFileSha256"
    ]) ||
    !exactKeys(map?.alignment, [
      "engine",
      "model",
      "modelRevision",
      "fasterWhisperVersion",
      "snapshotFiles",
      "cpuThreads",
      "numWorkers",
      "wordTimestamps",
      "inputPolicy",
      "sampleRate",
      "decisionSamples",
      "marginSamples",
      "eligibleThroughSample",
      "futureSamplesUsed"
    ]) ||
    !same(map?.boundary?.allowedSplits, SPLITS) ||
    map?.boundary?.holdoutRead !== false ||
    map?.alignment?.engine !== "faster-whisper" ||
    map?.alignment?.model !== "small" ||
    map?.alignment?.modelRevision !== EXP0017_R_WHISPER_SMALL_REVISION ||
    typeof map?.alignment?.fasterWhisperVersion !== "string" ||
    map.alignment.fasterWhisperVersion.length === 0 ||
    !validSnapshotFiles(map?.alignment?.snapshotFiles) ||
    map?.alignment?.cpuThreads !== 4 ||
    map?.alignment?.numWorkers !== 1 ||
    map?.alignment?.wordTimestamps !== true ||
    map?.alignment?.inputPolicy !== EXP0017_R_ALIGNMENT_INPUT_POLICY ||
    map?.alignment?.sampleRate !== SAMPLE_RATE ||
    map?.alignment?.decisionSamples !== EXP0017_R_DECISION_SAMPLES ||
    map?.alignment?.marginSamples !== EXP0017_R_MARGIN_SAMPLES ||
    map?.alignment?.eligibleThroughSample !==
      EXP0017_R_ELIGIBLE_THROUGH_SAMPLE ||
    map?.alignment?.futureSamplesUsed !== 0
  ) {
    errors.push("contrato principal do mapa-oráculo inválido");
  }
  for (const field of [
    "planFileSha256",
    "sourceManifestFileSha256",
    "alignmentRequestFileSha256",
    "rawAlignmentFileSha256"
  ]) {
    if (!validHash(map?.inputs?.[field])) {
      errors.push(`${field} inválido`);
    } else if (
      expected[field] !== undefined &&
      map.inputs[field] !== expected[field]
    ) {
      errors.push(`${field} divergente`);
    }
  }
  const sources = Array.isArray(map?.sources) ? map.sources : [];
  if (
    sources.length !== 60 ||
    new Set(sources.map((source) => source?.sceneId)).size !== 60
  ) {
    errors.push("mapa-oráculo precisa conter 60 fontes únicas");
  }
  for (const source of sources) {
    if (
      !exactKeys(source, [
        "sceneId",
        "partition",
        "waveSha256",
        "pcmSha256",
        "truncatedWaveSha256",
        "truncatedPcmSha256",
        "referenceTextSha256",
        "sourceOnsetSample",
        "acceptedThroughSample",
        "inputStartSample",
        "inputEndSampleExclusive",
        "sampleRate",
        "decisionSample",
        "marginSamples",
        "eligibleThroughSample",
        "text",
        "audioEndSample",
        "status",
        "reason",
        "futureSamplesUsed",
        "entrySha256"
      ]) ||
      typeof source.sceneId !== "string" ||
      !SPLITS.includes(source.partition) ||
      !validHash(source.waveSha256) ||
      !validHash(source.pcmSha256) ||
      !validHash(source.truncatedWaveSha256) ||
      !validHash(source.truncatedPcmSha256) ||
      !validHash(source.referenceTextSha256) ||
      source.entrySha256 !== exp0017ROraclePrefixEntrySha256(source) ||
      !Number.isSafeInteger(source.sourceOnsetSample) ||
      source.sourceOnsetSample < 0 ||
      source.acceptedThroughSample !==
        source.sourceOnsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE ||
      source.inputStartSample !== 0 ||
      source.inputEndSampleExclusive !==
        source.sourceOnsetSample + EXP0017_R_DECISION_SAMPLES ||
      source.sampleRate !== SAMPLE_RATE ||
      source.decisionSample !== EXP0017_R_DECISION_SAMPLES ||
      source.marginSamples !== EXP0017_R_MARGIN_SAMPLES ||
      source.eligibleThroughSample !== EXP0017_R_ELIGIBLE_THROUGH_SAMPLE ||
      source.futureSamplesUsed !== 0
    ) {
      errors.push(`${source?.sceneId ?? "fonte"}: contrato causal inválido`);
      continue;
    }
    if (source.status === "accepted") {
      if (
        typeof source.text !== "string" ||
        source.text.length === 0 ||
        source.text !== normalizeExp0017ROracleText(source.text) ||
        !Number.isSafeInteger(source.audioEndSample) ||
        source.audioEndSample < 1 ||
        source.audioEndSample > EXP0017_R_ELIGIBLE_THROUGH_SAMPLE ||
        source.reason !== "aligned-prefix-match"
      ) {
        errors.push(`${source.sceneId}: prefixo aceito inválido ou futuro`);
      }
    } else if (
      source.status !== "deferred" ||
      source.text !== null ||
      source.audioEndSample !== null ||
      !DEFER_REASONS.has(source.reason)
    ) {
      errors.push(`${source.sceneId}: deferência inválida`);
    }
  }
  for (const split of SPLITS) {
    if (sources.filter((source) => source.partition === split).length !== 30) {
      errors.push(`${split}: mapa-oráculo precisa conter 30 fontes`);
    }
  }
  const expectedSources = new Map(
    (expected.sourceManifest?.files ?? []).map((source) => [
      source.sceneId,
      source
    ])
  );
  if (expectedSources.size > 0) {
    for (const source of sources) {
      const expectedSource = expectedSources.get(source.sceneId);
      if (
        expectedSource === undefined ||
        expectedSource.partition !== source.partition ||
        expectedSource.waveSha256 !== source.waveSha256 ||
        expectedSource.pcmSha256 !== source.pcmSha256 ||
        expectedSource.textSha256 !== source.referenceTextSha256
      ) {
        errors.push(`${source.sceneId}: fonte canônica divergente`);
      }
    }
  }
  return freeze({
    valid: errors.length === 0,
    errors,
    observedHash
  });
}
