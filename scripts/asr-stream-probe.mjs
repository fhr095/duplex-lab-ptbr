import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import {
  createCpuStreamingAsr,
  decodeWaveToPcm16,
  summarizeStreamingTrace
} from "../src/asr/index.mjs";
import { scoreTranscript } from "../src/eval/transcript-metrics.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_CASES = [
  {
    id: "synthetic-interruption",
    path: "eval/generated/asr/audio/interrupcao--rate-1.wav",
    expected: "Espera, eu quis dizer outra coisa."
  },
  {
    id: "human-noise",
    path: "eval/generated/coraa/audio/test--sp--48796_sp_.wav",
    expected: "me vê dois pastel e um chopes"
  }
];

function parseArgs(args) {
  const options = {
    chunkMs: 160,
    initialMs: 320,
    file: null,
    expected: null,
    finalEngine: process.env.ASR_FINAL_ENGINE ?? "whisper",
    finalModel: process.env.ASR_FINAL_MODEL ?? "base",
    finalThreads: Number.parseInt(
      process.env.ASR_FINAL_THREADS ?? "3",
      10
    ),
    partialModel: process.env.ASR_PARTIAL_MODEL ?? "tiny",
    partialThreads: Number.parseInt(
      process.env.ASR_PARTIAL_THREADS ?? "1",
      10
    )
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      ["--chunk-ms", "--initial-ms", "--file", "--expected",
        "--partial-model",
        "--final-engine", "--final-model", "--partial-threads",
        "--final-threads"].includes(argument)
    ) {
      const value = args[++index];
      const field = argument.slice(2).replace(
        /-([a-z])/gu,
        (_, letter) => letter.toUpperCase()
      );
      options[field] = [
        "chunkMs",
        "initialMs",
        "partialThreads",
        "finalThreads"
      ].includes(field)
        ? Number.parseInt(value, 10)
        : value;
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

async function runCase(runtime, item, chunkMs, initialMs) {
  const audio = await readFile(resolve(PROJECT_ROOT, item.path));
  const decoded = decodeWaveToPcm16(audio);
  const bytesPerChunk = Math.round(16_000 * chunkMs / 1_000) * 2;
  const events = [];
  const startedAt = performance.now();
  const session = runtime.createSession({
    id: item.id,
    initialAudioMs: initialMs,
    stepAudioMs: 320,
    onEvent: (event) => events.push(event)
  });

  for (
    let offset = 0, chunk = 1;
    offset < decoded.pcm.length;
    offset += bytesPerChunk, chunk += 1
  ) {
    const end = Math.min(decoded.pcm.length, offset + bytesPerChunk);
    const targetAt =
      startedAt + Math.min(end / 2 / 16_000 * 1_000, chunk * chunkMs);
    await delay(Math.max(0, targetAt - performance.now()));
    session.pushPcm(decoded.pcm.subarray(offset, end), {
      capturedAtMs: startedAt
    });
  }

  const endpointAtMs = performance.now();
  const final = await session.finish();
  return {
    id: item.id,
    audioMs: Math.round(decoded.pcm.length / 2 / 16_000 * 1_000),
    expected: item.expected,
    actual: final.text,
    transcript: scoreTranscript(item.expected, final.text),
    perceived: summarizeStreamingTrace(events, { endpointAtMs }),
    partials: events
      .filter((event) => event.type === "partial")
      .map((event) => ({
        atMs: Math.round(event.elapsedMs),
        committed: event.committedText,
        provisional: event.unstableText
      }))
  };
}

const options = parseArgs(process.argv.slice(2));
const cases = options.file
  ? [{
      id: "custom",
      path: options.file,
      expected: options.expected ?? ""
    }]
  : DEFAULT_CASES;
const runtime = createCpuStreamingAsr({
  finalEngine: options.finalEngine,
  finalModel: options.finalModel,
  finalThreads: options.finalThreads,
  partialModel: options.partialModel,
  partialThreads: options.partialThreads,
  sessionDefaults: {
    initialAudioMs: options.initialMs,
    stepAudioMs: 320
  }
});

const runtimeStarted = performance.now();
const ready = await runtime.start();
const readyAfterMs = Math.round(performance.now() - runtimeStarted);
const results = [];
try {
  for (const item of cases) {
    results.push(
      await runCase(runtime, item, options.chunkMs, options.initialMs)
    );
  }
} finally {
  await runtime.close();
}

console.log(JSON.stringify({
  schemaVersion: 1,
  candidate:
    `${options.partialModel}-partial+${options.finalEngine}-` +
    `${options.finalModel}-final-cpu-int8`,
  configuration: {
    chunkMs: options.chunkMs,
    initialMs: options.initialMs,
    finalEngine: options.finalEngine,
    partialModel: options.partialModel,
    partialThreads: options.partialThreads,
    finalModel: options.finalModel,
    finalThreads: options.finalThreads,
    totalInferenceThreads:
      options.partialThreads + options.finalThreads
  },
  warmup: {
    readyAfterMs,
    partial: ready.partial,
    final: ready.final
  },
  cases: results
}, null, 2));
