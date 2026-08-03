import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { encodePcm16Wave, inspectWave } from "../src/audio/wav.mjs";
import {
  createExp0025RFloorPack,
  validateExp0025RMaterializedPack
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson } from "../src/eval/factory/canonical-hash.mjs";
import {
  closeWindowsSpeechSynthesizer,
  prewarmWindowsSpeech,
  synthesizeWindowsSpeech
} from "../src/tts/windows-system-tts.mjs";
import {
  EXP0025_R_DEVELOPMENT_PACK_PATH,
  buildExp0025RDevelopmentPack
} from "./build-exp-0025-r-development-pack.mjs";

export const EXP0025_R_AUDIO_ROOT =
  "eval/generated/exp-0025-r/development-audio-v0.1";

const SAMPLE_RATE = 16_000;
const CRITICAL_BOUNDARY_MS = 2_400;
const FINAL_OBSERVATION_MS = 1_200;
const TTS_RATE = 1;
const ACTIVE_THRESHOLD = 256;
const TRAILING_MARGIN_MS = 100;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function samplesIn(pcm) {
  return pcm.byteLength / 2;
}

function silence(durationMs) {
  return Buffer.alloc(Math.round(SAMPLE_RATE * durationMs / 1_000) * 2);
}

function trimAfterLastActive(pcm) {
  let lastActive = -1;
  for (let index = 0; index < samplesIn(pcm); index += 1) {
    if (Math.abs(pcm.readInt16LE(index * 2)) >= ACTIVE_THRESHOLD) {
      lastActive = index;
    }
  }
  if (lastActive < 0) throw new Error("TTS retornou PCM sem fala ativa");
  const marginSamples = Math.round(SAMPLE_RATE * TRAILING_MARGIN_MS / 1_000);
  const end = Math.min(samplesIn(pcm), lastActive + 1 + marginSamples);
  return Buffer.from(pcm.subarray(0, end * 2));
}

function resamplePcm16(pcm, targetSamples) {
  const sourceSamples = samplesIn(pcm);
  if (sourceSamples === targetSamples) return Buffer.from(pcm);
  const output = Buffer.alloc(targetSamples * 2);
  for (let index = 0; index < targetSamples; index += 1) {
    const sourcePosition = targetSamples === 1
      ? 0
      : index * (sourceSamples - 1) / (targetSamples - 1);
    const left = Math.floor(sourcePosition);
    const right = Math.min(sourceSamples - 1, left + 1);
    const ratio = sourcePosition - left;
    const value = Math.round(
      pcm.readInt16LE(left * 2) * (1 - ratio) +
      pcm.readInt16LE(right * 2) * ratio
    );
    output.writeInt16LE(Math.max(-32_768, Math.min(32_767, value)), index * 2);
  }
  return output;
}

function fitPrefixToBoundary(pcm) {
  const trimmed = trimAfterLastActive(pcm);
  const targetSamples = Math.round(
    SAMPLE_RATE * CRITICAL_BOUNDARY_MS / 1_000
  );
  if (samplesIn(trimmed) > targetSamples) {
    return resamplePcm16(trimmed, targetSamples);
  }
  return Buffer.concat([
    trimmed,
    Buffer.alloc((targetSamples - samplesIn(trimmed)) * 2)
  ]);
}

function words(text) {
  return text.trim().split(/\s+/u);
}

function scheduledWords(text, startMs, endMs, segment) {
  const tokens = words(text);
  return tokens.map((word, index) => ({
    word,
    segment,
    startMs: Math.round(
      (startMs + (endMs - startMs) * index / tokens.length) * 100
    ) / 100,
    endMs: Math.round(
      (startMs + (endMs - startMs) * (index + 1) / tokens.length) * 100
    ) / 100
  }));
}

export function composeExp0025RPairAudio(input) {
  const prefixDecoded = decodeWaveToPcm16(input.prefixWave, {
    targetSampleRate: SAMPLE_RATE
  });
  const suffixDecoded = decodeWaveToPcm16(input.suffixWave, {
    targetSampleRate: SAMPLE_RATE
  });
  const prefixPcm = fitPrefixToBoundary(prefixDecoded.pcm);
  const suffixPcm = trimAfterLastActive(suffixDecoded.pcm);
  const pausePcm = silence(input.pauseMs);
  const continuesPcm = Buffer.concat([prefixPcm, pausePcm, suffixPcm]);
  const endsPcm = Buffer.concat([
    prefixPcm,
    silence(FINAL_OBSERVATION_MS)
  ]);
  return Object.freeze({
    continuesWave: encodePcm16Wave(continuesPcm, {
      sampleRate: SAMPLE_RATE,
      channels: 1
    }),
    endsWave: encodePcm16Wave(endsPcm, {
      sampleRate: SAMPLE_RATE,
      channels: 1
    }),
    prefixPcmSha256: sha256(prefixPcm),
    suffixDurationMs: samplesIn(suffixPcm) / SAMPLE_RATE * 1_000
  });
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}

async function synthesizeCached(text, options) {
  const key = sha256(Buffer.from(JSON.stringify({
    engine: options.engine,
    text,
    rate: TTS_RATE
  })));
  const path = resolve(EXP0025_R_AUDIO_ROOT, "tts-cache", `${key}.wav`);
  const cached = await readFile(path).catch(() => null);
  if (cached) return cached;
  const wave = await options.synthesize(text, { rate: TTS_RATE });
  await writeAtomic(path, wave);
  return wave;
}

function alignmentFor(utterance, suffixDurationMs) {
  const entries = scheduledWords(
    utterance.prefix,
    0,
    utterance.criticalBoundaryAtMs,
    "prefix"
  );
  if (utterance.outcome === "CONTINUES") {
    entries.push(...scheduledWords(
      utterance.suffix,
      utterance.resumeAtMs,
      utterance.resumeAtMs + suffixDurationMs,
      "suffix"
    ));
  }
  return {
    method: "ORACLE_SEGMENT_SCHEDULE_NOT_ACOUSTIC_FORCED_ALIGNMENT",
    entries
  };
}

function withProvenance(plan, records) {
  const core = structuredClone(plan);
  delete core.packSha256;
  core.utterances = core.utterances.map((utterance) => {
    const record = records.get(utterance.id);
    if (!record) throw new Error(`WAV ausente para ${utterance.id}`);
    return {
      ...utterance,
      audioProvenance: record
    };
  });
  return createExp0025RFloorPack(core);
}

export async function materializeExp0025RAudio(options = {}) {
  const plan = buildExp0025RDevelopmentPack();
  const status = options.engine
    ? null
    : await prewarmWindowsSpeech();
  const engine = options.engine ?? {
    id: "windows-system-speech",
    voice: status.worker?.voice ?? "unknown",
    culture: status.worker?.culture ?? "unknown",
    rate: TTS_RATE
  };
  const synthesize = options.synthesize ?? synthesizeWindowsSpeech;
  if (engine.id !== "windows-system-speech" || engine.culture !== "pt-BR") {
    throw new Error("EXP-0025-R exige Windows TTS pt-BR para proveniência");
  }

  try {
    const firstPrefix = plan.utterances[0].prefix;
    const control = await synthesize(firstPrefix, { rate: TTS_RATE });
    const repeated = await synthesize(firstPrefix, { rate: TTS_RATE });
    if (sha256(control) !== sha256(repeated)) {
      throw new Error("Windows TTS não foi determinístico no controle");
    }

    const records = new Map();
    const pairs = Map.groupBy(plan.utterances, (item) => item.pairId);
    for (const pair of pairs.values()) {
      const continues = pair.find((item) => item.outcome === "CONTINUES");
      const ends = pair.find((item) => item.outcome === "ENDS");
      const prefixWave = continues.prefix === firstPrefix
        ? control
        : await synthesizeCached(continues.prefix, { engine, synthesize });
      const suffixWave = await synthesizeCached(continues.suffix, {
        engine,
        synthesize
      });
      const composed = composeExp0025RPairAudio({
        prefixWave,
        suffixWave,
        pauseMs: continues.pauseMs
      });
      for (const [utterance, wave] of [
        [continues, composed.continuesWave],
        [ends, composed.endsWave]
      ]) {
        const relativePath =
          `${EXP0025_R_AUDIO_ROOT}/${utterance.id}.wav`;
        await writeAtomic(resolve(relativePath), wave);
        records.set(utterance.id, {
          status: "MATERIALIZED",
          role: "PROVENANCE_ONLY_NOT_POLICY_INPUT",
          pairId: utterance.pairId,
          outcome: utterance.outcome,
          wavPath: relativePath,
          wavSha256: `sha256:${sha256(wave)}`,
          byteLength: wave.byteLength,
          durationMs: inspectWave(wave).durationMs,
          criticalBoundaryAtMs: utterance.criticalBoundaryAtMs,
          prefixPcmSha256: `sha256:${composed.prefixPcmSha256}`,
          engine,
          wordAlignment: alignmentFor(
            utterance,
            composed.suffixDurationMs
          )
        });
      }
    }
    const pack = withProvenance(plan, records);
    const validation = validateExp0025RMaterializedPack(pack);
    if (!validation.valid) {
      throw new Error(`pack materializado inválido: ${validation.errors.join("; ")}`);
    }
    await writeAtomic(
      resolve(options.path ?? EXP0025_R_DEVELOPMENT_PACK_PATH),
      `${canonicalJson(pack)}\n`
    );
    return pack;
  } finally {
    if (!options.engine) {
      await closeWindowsSpeechSynthesizer({ drain: true });
    }
  }
}

export async function checkExp0025RAudio(options = {}) {
  const path = resolve(options.path ?? EXP0025_R_DEVELOPMENT_PACK_PATH);
  const pack = JSON.parse(await readFile(path, "utf8"));
  const validation = validateExp0025RMaterializedPack(pack);
  if (!validation.valid) {
    throw new Error(`pack materializado inválido: ${validation.errors.join("; ")}`);
  }
  for (const utterance of pack.utterances) {
    const bytes = await readFile(resolve(utterance.audioProvenance.wavPath));
    if (`sha256:${sha256(bytes)}` !== utterance.audioProvenance.wavSha256 ||
      bytes.byteLength !== utterance.audioProvenance.byteLength) {
      throw new Error(`WAV divergiu para ${utterance.id}`);
    }
  }
  return pack;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--check")) {
    throw new Error("uso: node scripts/materialize-exp-0025-r-audio.mjs [--check]");
  }
  const pack = args.has("--check")
    ? await checkExp0025RAudio()
    : await materializeExp0025RAudio();
  process.stdout.write(
    `EXP-0025-R áudio ${args.has("--check") ? "verificado" : "materializado"}: ` +
      `${pack.utterances.length} WAVs, ${pack.packSha256}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
