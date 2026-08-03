import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { encodePcm16Wave } from "../src/audio/wav.mjs";
import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import {
  EXP0017_R_ALIGNMENT_INPUT_POLICY,
  EXP0017_R_DECISION_SAMPLES,
  EXP0017_R_ELIGIBLE_THROUGH_SAMPLE,
  EXP0017_R_MODEL_SNAPSHOT_FILES,
  EXP0017_R_ORACLE_PREFIX_MAP_SCHEMA,
  EXP0017_R_WHISPER_SMALL_REVISION,
  createExp0017ROracleAlignmentRequest,
  deriveExp0017ROraclePrefixEntry,
  exp0017ROraclePrefixEntrySha256,
  finalizeExp0017ROraclePrefixEntry,
  finalizeExp0017ROraclePrefixMap,
  validateExp0017ROraclePrefixMap,
  validateExp0017RRawAlignment
} from "../src/eval/exp-0017-r-oracle.mjs";
import { createExp0017RCausalTruncatedInput } from
  "../scripts/build-exp-0017-r-oracle-prefixes.mjs";

const PLAN_URL = new URL(
  "../eval/experiments/exp-0017-supertonic-scenes.pt-BR.json",
  import.meta.url
);
const SOURCE_URL = new URL(
  "../eval/sources/exp-0017-supertonic-v0.1.json",
  import.meta.url
);
const HASH = `sha256:${"a".repeat(64)}`;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function snapshotFiles() {
  return structuredClone(EXP0017_R_MODEL_SNAPSHOT_FILES);
}

async function fixtures() {
  return {
    plan: JSON.parse(await readFile(PLAN_URL, "utf8")),
    sourceManifest: JSON.parse(await readFile(SOURCE_URL, "utf8"))
  };
}

function word(text, startSeconds, endSeconds) {
  return {
    startSeconds,
    endSeconds,
    text,
    probability: 0.9
  };
}

function rawSource(words = [], overrides = {}) {
  const sourceOnsetSample = overrides.sourceOnsetSample ?? 3_200;
  return {
    sceneId: "train-causal-test",
    partition: "train",
    truncatedRelativePath:
      "eval/generated/exp-0017/r/truncated/train-causal-test.wav",
    sourceWaveSha256: HASH,
    sourcePcmSha256: HASH,
    truncatedWaveSha256: HASH,
    truncatedPcmSha256: HASH,
    sourceOnsetSample,
    acceptedThroughSample:
      sourceOnsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE,
    inputStartSample: 0,
    inputEndSampleExclusive:
      sourceOnsetSample + EXP0017_R_DECISION_SAMPLES,
    futureSamplesUsed: 0,
    decodedText: words.map((item) => item.text).join(" "),
    language: "pt",
    languageProbability: 1,
    durationSeconds: 2,
    segments: [],
    words,
    ...overrides
  };
}

function truncatedSources(sourceManifest) {
  return sourceManifest.files.map((source, index) => ({
    sceneId: source.sceneId,
    partition: source.partition,
    truncatedRelativePath:
      `eval/generated/exp-0017/r/truncated/${source.sceneId}.wav`,
    sourceWaveSha256: source.waveSha256,
    sourcePcmSha256: source.pcmSha256,
    truncatedWaveSha256: HASH,
    truncatedPcmSha256: HASH,
    sourceOnsetSample: 1_000 + index,
    acceptedThroughSample:
      1_000 + index + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE,
    inputStartSample: 0,
    inputEndSampleExclusive:
      1_000 + index + EXP0017_R_DECISION_SAMPLES,
    futureSamplesUsed: 0
  }));
}

function mapCore(sourceManifest) {
  return {
    schemaVersion: EXP0017_R_ORACLE_PREFIX_MAP_SCHEMA,
    experimentId: "exp-0017-r-oracle-v0.1",
    locale: "pt-BR",
    role: "causal-oracle-prefix-development-screen-only",
    boundary: {
      allowedSplits: ["train", "development"],
      holdoutRead: false
    },
    inputs: {
      planFileSha256: HASH,
      sourceManifestFileSha256: HASH,
      alignmentRequestFileSha256: HASH,
      rawAlignmentFileSha256: HASH
    },
    alignment: {
      engine: "faster-whisper",
      model: "small",
      modelRevision: EXP0017_R_WHISPER_SMALL_REVISION,
      fasterWhisperVersion: "1.2.1",
      snapshotFiles: snapshotFiles(),
      cpuThreads: 4,
      numWorkers: 1,
      wordTimestamps: true,
      inputPolicy: EXP0017_R_ALIGNMENT_INPUT_POLICY,
      sampleRate: 16_000,
      decisionSamples: 8_960,
      marginSamples: 1_280,
      eligibleThroughSample: 7_680,
      futureSamplesUsed: 0
    },
    sources: sourceManifest.files.map((source) =>
      finalizeExp0017ROraclePrefixEntry({
      sceneId: source.sceneId,
      partition: source.partition,
      waveSha256: source.waveSha256,
      pcmSha256: source.pcmSha256,
      truncatedWaveSha256: HASH,
      truncatedPcmSha256: HASH,
      referenceTextSha256: source.textSha256,
      sourceOnsetSample: 0,
      acceptedThroughSample: 7_680,
      inputStartSample: 0,
      inputEndSampleExclusive: 8_960,
      sampleRate: 16_000,
      decisionSample: 8_960,
      marginSamples: 1_280,
      eligibleThroughSample: 7_680,
      text: null,
      audioEndSample: null,
      status: "deferred",
      reason: "alignment-empty",
      futureSamplesUsed: 0
      })
    )
  };
}

test("request contém somente as 60 identidades train/development", async () => {
  const { plan, sourceManifest } = await fixtures();
  const request = createExp0017ROracleAlignmentRequest({
    plan,
    sourceManifest,
    truncatedSources: truncatedSources(sourceManifest)
  });

  assert.equal(request.sources.length, 60);
  assert.equal(
    request.sources.filter((source) => source.partition === "train").length,
    30
  );
  assert.equal(
    request.sources.filter(
      (source) => source.partition === "development"
    ).length,
    30
  );
  const serialized = JSON.stringify(request);
  assert.doesNotMatch(
    serialized,
    /label|checkpoint|reference|metrics|intendedContext/iu
  );
  assert.equal(request.inputPolicy, EXP0017_R_ALIGNMENT_INPUT_POLICY);
  assert.equal(request.futureSamplesUsed, 0);
  assert.ok(request.sources.every((source) =>
    source.acceptedThroughSample ===
      source.sourceOnsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE &&
    source.inputEndSampleExclusive ===
      source.sourceOnsetSample + EXP0017_R_DECISION_SAMPLES &&
    source.futureSamplesUsed === 0
  ));
});

test("materializador entrega ao ASR somente WAV fisicamente truncado", () => {
  const pcm = Buffer.alloc(24_000 * 2);
  for (let sample = 3_200; sample < 20_000; sample += 1) {
    pcm.writeInt16LE(sample % 2 === 0 ? 12_000 : -12_000, sample * 2);
  }
  const waveBytes = encodePcm16Wave(pcm, { sampleRate: 16_000 });
  const truncated = createExp0017RCausalTruncatedInput({
    source: {
      sceneId: "train-physical-cut",
      partition: "train",
      waveSha256: sha256(waveBytes),
      pcmSha256: sha256(pcm)
    },
    wave: waveBytes,
    truncatedRelativePath:
      "eval/generated/exp-0017/r/truncated/train-physical-cut.wav"
  });
  const decoded = decodeWaveToPcm16(truncated.wave, {
    targetSampleRate: 16_000
  });

  assert.equal(truncated.descriptor.inputStartSample, 0);
  assert.equal(
    truncated.descriptor.inputEndSampleExclusive,
    truncated.descriptor.sourceOnsetSample +
      EXP0017_R_DECISION_SAMPLES
  );
  assert.equal(
    decoded.pcm.length / 2,
    truncated.descriptor.inputEndSampleExclusive
  );
  assert.equal(
    truncated.descriptor.truncatedWaveSha256,
    sha256(truncated.wave)
  );
  assert.equal(
    truncated.descriptor.truncatedPcmSha256,
    sha256(decoded.pcm)
  );
  assert.equal(truncated.descriptor.futureSamplesUsed, 0);
});

test("prefixo aceita somente tokens coincidentes antes da margem causal", () => {
  const onsetSample = 3_200;
  const entry = deriveExp0017ROraclePrefixEntry({
    rawSource: rawSource([
      word(" Não,", 0.22, 0.6),
      // O segundo token está no lookahead de 80 ms e não é elegível.
      word(" errado", 0.61, 0.72)
    ]),
    referenceText: "Não, futuro correto."
  });

  assert.equal(entry.status, "accepted");
  assert.equal(entry.text, "nao");
  assert.equal(entry.audioEndSample, 6_400);
  assert.equal(entry.eligibleThroughSample, 7_680);
  assert.equal(entry.futureSamplesUsed, 0);
  assert.equal(
    entry.entrySha256,
    exp0017ROraclePrefixEntrySha256(entry)
  );
});

test("ceil aceita a borda, usa lookahead e rejeita além da decisão", () => {
  const onsetSample = 3_200;
  const boundarySeconds = (
    onsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE
  ) / 16_000;
  const accepted = deriveExp0017ROraclePrefixEntry({
    rawSource: rawSource([word(" Pode", 0.2, boundarySeconds)]),
    referenceText: "Pode continuar"
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.audioEndSample, 7_680);

  const lookahead = deriveExp0017ROraclePrefixEntry({
    rawSource: rawSource([word(
      " Pode",
      0.2,
      (onsetSample + EXP0017_R_ELIGIBLE_THROUGH_SAMPLE + 1) / 16_000
    )]),
    referenceText: "Pode continuar"
  });
  assert.equal(lookahead.status, "deferred");
  assert.equal(lookahead.reason, "no-complete-token-before-margin");

  assert.throws(() => deriveExp0017ROraclePrefixEntry({
    rawSource: rawSource([word(
      " Pode",
      0.2,
      (onsetSample + EXP0017_R_DECISION_SAMPLES + 1) / 16_000
    )]),
    referenceText: "Pode continuar"
  }), /inválida/iu);
});

test("discordância lexical falha fechado como texto nulo", () => {
  const entry = deriveExp0017ROraclePrefixEntry({
    rawSource: rawSource(
      [word(" talvez", 0.1, 0.3)],
      {
        sourceOnsetSample: 0,
        acceptedThroughSample: 7_680,
        inputEndSampleExclusive: 8_960
      }
    ),
    referenceText: "Não, espere"
  });

  assert.equal(entry.status, "deferred");
  assert.equal(entry.reason, "aligned-prefix-disagrees");
  assert.equal(entry.text, null);
  assert.equal(entry.audioEndSample, null);
});

test("alinhamento bruto fica ligado ao request e rejeita tampering", async () => {
  const { plan, sourceManifest } = await fixtures();
  const request = createExp0017ROracleAlignmentRequest({
    plan,
    sourceManifest,
    truncatedSources: truncatedSources(sourceManifest)
  });
  const raw = {
    schemaVersion: "exp-0017-r-oracle-raw-alignment-v2",
    requestSha256: HASH,
    sampleRate: 16_000,
    inputPolicy: EXP0017_R_ALIGNMENT_INPUT_POLICY,
    futureSamplesUsed: 0,
    model: {
      engine: "faster-whisper",
      name: "small",
      revision: EXP0017_R_WHISPER_SMALL_REVISION,
      device: "cpu",
      computeType: "int8",
      cpuThreads: 4,
      numWorkers: 1,
      fasterWhisperVersion: "1.2.1",
      snapshotFiles: snapshotFiles(),
      wordTimestamps: true,
      localFilesOnly: true,
      inputPolicy: EXP0017_R_ALIGNMENT_INPUT_POLICY,
      futureSamplesUsed: 0
    },
    decoding: {
      language: "pt",
      beamSize: 1,
      bestOf: 1,
      temperature: 0,
      conditionOnPreviousText: false,
      vadFilter: false
    },
    sources: request.sources.map((source) => ({
      ...source,
      decodedText: "",
      language: "pt",
      languageProbability: 1,
      durationSeconds: source.inputEndSampleExclusive / 16_000,
      segments: [],
      words: []
    }))
  };
  let validation = validateExp0017RRawAlignment(raw, {
    request,
    requestSha256: HASH
  });
  assert.equal(validation.valid, true, validation.errors.join("; "));

  raw.sources[0].truncatedWaveSha256 = `sha256:${"b".repeat(64)}`;
  validation = validateExp0017RRawAlignment(raw, {
    request,
    requestSha256: HASH
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /request/iu);

  raw.sources[0].truncatedWaveSha256 =
    request.sources[0].truncatedWaveSha256;
  raw.decoding.beamSize = 2;
  validation = validateExp0017RRawAlignment(raw, {
    request,
    requestSha256: HASH
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /contrato principal/iu);

  raw.decoding.beamSize = 1;
  raw.model.cpuThreads = 2;
  validation = validateExp0017RRawAlignment(raw, {
    request,
    requestSha256: HASH
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /contrato principal/iu);
});

test("raw rejeita qualquer palavra além do WAV truncado", async () => {
  const { plan, sourceManifest } = await fixtures();
  const request = createExp0017ROracleAlignmentRequest({
    plan,
    sourceManifest,
    truncatedSources: truncatedSources(sourceManifest)
  });
  const source = request.sources[0];
  const beyond = (source.inputEndSampleExclusive + 1) / 16_000;
  const raw = {
    schemaVersion: "exp-0017-r-oracle-raw-alignment-v2",
    requestSha256: HASH,
    sampleRate: 16_000,
    inputPolicy: EXP0017_R_ALIGNMENT_INPUT_POLICY,
    futureSamplesUsed: 0,
    model: {
      engine: "faster-whisper",
      name: "small",
      revision: EXP0017_R_WHISPER_SMALL_REVISION,
      device: "cpu",
      computeType: "int8",
      cpuThreads: 4,
      numWorkers: 1,
      fasterWhisperVersion: "1.2.1",
      snapshotFiles: snapshotFiles(),
      wordTimestamps: true,
      localFilesOnly: true,
      inputPolicy: EXP0017_R_ALIGNMENT_INPUT_POLICY,
      futureSamplesUsed: 0
    },
    decoding: {
      language: "pt",
      beamSize: 1,
      bestOf: 1,
      temperature: 0,
      conditionOnPreviousText: false,
      vadFilter: false
    },
    sources: request.sources.map((item, index) => ({
      ...item,
      decodedText: index === 0 ? " futuro" : "",
      language: "pt",
      languageProbability: 1,
      durationSeconds: item.inputEndSampleExclusive / 16_000,
      segments: [],
      words: index === 0 ? [word(" futuro", 0, beyond)] : []
    }))
  };
  const validation = validateExp0017RRawAlignment(raw, {
    request,
    requestSha256: HASH
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /ultrapassa WAV truncado/iu);
});

test("mapa canônico rejeita hash, futuro e campos de métricas adulterados", async () => {
  const { sourceManifest } = await fixtures();
  const canonical = finalizeExp0017ROraclePrefixMap(mapCore(sourceManifest));
  let validation = validateExp0017ROraclePrefixMap(canonical, {
    sourceManifest
  });
  assert.equal(validation.valid, true, validation.errors.join("; "));

  const future = structuredClone(canonical);
  future.sources[0].status = "accepted";
  future.sources[0].reason = "aligned-prefix-match";
  future.sources[0].text = "nao";
  future.sources[0].audioEndSample = 7_681;
  validation = validateExp0017ROraclePrefixMap(future, { sourceManifest });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /divergente|futuro/iu);

  const injected = structuredClone(mapCore(sourceManifest));
  injected.metrics = { accuracy: 1 };
  const rehashed = finalizeExp0017ROraclePrefixMap(injected);
  validation = validateExp0017ROraclePrefixMap(rehashed, {
    sourceManifest
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /contrato principal/iu);
});
