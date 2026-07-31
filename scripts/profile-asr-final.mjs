import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { PersistentAsrWorker } from "../src/asr/worker-client.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function parseArgs(args) {
  const options = {
    file: "eval/generated/asr/audio/correcao--rate-1.wav",
    finalModel: "base",
    partialModel: "tiny",
    finalThreads: [3, 4],
    partialThreads: 1,
    runs: 3,
    speculativeLeadMs: 300
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[++index];
    if (argument === "--file") {
      options.file = value;
    } else if (argument === "--final-model") {
      options.finalModel = value;
    } else if (argument === "--partial-model") {
      options.partialModel = value;
    } else if (argument === "--final-threads") {
      options.finalThreads = value
        .split(",")
        .map((item) => Number.parseInt(item, 10));
    } else if (argument === "--partial-threads") {
      options.partialThreads = Number.parseInt(value, 10);
    } else if (argument === "--runs") {
      options.runs = Number.parseInt(value, 10);
    } else if (argument === "--speculative-lead-ms") {
      options.speculativeLeadMs = Number.parseInt(value, 10);
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  const integers = [
    ...options.finalThreads,
    options.partialThreads,
    options.runs
  ];
  if (integers.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new RangeError("threads e runs precisam ser inteiros positivos");
  }
  if (
    !Number.isInteger(options.speculativeLeadMs) ||
    options.speculativeLeadMs < 0
  ) {
    throw new RangeError("speculative-lead-ms precisa ser não negativo");
  }
  return options;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function summarize(samples) {
  const roundTrips = samples.map((item) => item.roundTripMs);
  const inferences = samples.map((item) => item.inferenceMs);
  const overhead = samples.map(
    (item) => item.roundTripMs - item.inferenceMs
  );
  return {
    count: samples.length,
    roundTripMs: {
      p50: round(percentile(roundTrips, 0.5)),
      p95: round(percentile(roundTrips, 0.95)),
      samples: roundTrips.map(round)
    },
    inferenceMs: {
      p50: round(percentile(inferences, 0.5)),
      p95: round(percentile(inferences, 0.95)),
      samples: inferences.map(round)
    },
    nonInferenceMs: {
      p50: round(percentile(overhead, 0.5)),
      p95: round(percentile(overhead, 0.95)),
      samples: overhead.map(round)
    },
    distinctTexts: [...new Set(samples.map((item) => item.text))]
  };
}

async function transcribe(worker, pcm, mode, id) {
  const result = await worker.transcribe({
    sessionId: id,
    generation: 1,
    mode,
    sampleRate: 16_000,
    language: "pt",
    pcm
  });
  return {
    inferenceMs: result.elapsedMs,
    roundTripMs: result.roundTripMs,
    text: result.text
  };
}

async function profileCandidate(options, pcm, finalThreads) {
  const partial = new PersistentAsrWorker({
    model: options.partialModel,
    threads: options.partialThreads,
    warmupMs: 500
  });
  const final = new PersistentAsrWorker({
    model: options.finalModel,
    threads: finalThreads,
    warmupMs: 500
  });
  const ready = await Promise.all([partial.start(), final.start()]);
  const isolated = [];
  const speculative = [];
  const concurrent = [];

  try {
    for (let run = 0; run < options.runs; run += 1) {
      isolated.push(
        await transcribe(final, pcm, "final", `isolated-${run}`)
      );
    }
    for (let run = 0; run < options.runs; run += 1) {
      const task = transcribe(
        final,
        pcm,
        "final",
        `speculative-${run}`
      );
      await delay(options.speculativeLeadMs);
      const endpointAt = performance.now();
      const result = await task;
      speculative.push({
        ...result,
        finalAfterEndpointMs: performance.now() - endpointAt
      });
    }
    for (let run = 0; run < options.runs; run += 1) {
      const [partialResult, finalResult] = await Promise.all([
        transcribe(partial, pcm, "partial", `partial-${run}`),
        transcribe(final, pcm, "final", `concurrent-${run}`)
      ]);
      concurrent.push({
        ...finalResult,
        concurrentPartialRoundTripMs: partialResult.roundTripMs
      });
    }
  } finally {
    await Promise.all([partial.close(), final.close()]);
  }

  const isolatedSummary = summarize(isolated);
  const speculativeSummary = summarize(speculative);
  const concurrentSummary = summarize(concurrent);
  const speculativeFinalization = speculative.map(
    (item) => item.finalAfterEndpointMs
  );
  return {
    finalThreads,
    totalInferenceThreads:
      finalThreads + options.partialThreads,
    ready: {
      partial: ready[0],
      final: ready[1]
    },
    isolated: isolatedSummary,
    latePrefinal: {
      ...speculativeSummary,
      speculativeLeadMs: options.speculativeLeadMs,
      finalAfterEndpointMs: {
        p50: round(percentile(speculativeFinalization, 0.5)),
        p95: round(percentile(speculativeFinalization, 0.95)),
        samples: speculativeFinalization.map(round)
      }
    },
    concurrentWithPartial: {
      ...concurrentSummary,
      partialRoundTripMs: summarize(
        concurrent.map((item) => ({
          inferenceMs: item.concurrentPartialRoundTripMs,
          roundTripMs: item.concurrentPartialRoundTripMs,
          text: ""
        }))
      ).roundTripMs
    },
    criticalPathAb: {
      speculativeLeadMs: options.speculativeLeadMs,
      independentlyMeasuredBaselineP50Ms:
        isolatedSummary.roundTripMs.p50,
      counterfactualEndpointStartP50Ms:
        speculativeSummary.roundTripMs.p50,
      latePrefinalP50Ms: round(
        percentile(speculativeFinalization, 0.5)
      ),
      reductionMs: round(
        speculativeSummary.roundTripMs.p50 -
          percentile(speculativeFinalization, 0.5)
      )
    }
  };
}

const options = parseArgs(process.argv.slice(2));
const wave = await readFile(resolve(PROJECT_ROOT, options.file));
const decoded = decodeWaveToPcm16(wave);
const candidates = [];
for (const finalThreads of options.finalThreads) {
  candidates.push(
    await profileCandidate(options, decoded.pcm, finalThreads)
  );
}
const allTexts = candidates.flatMap(
  (candidate) => [
    ...candidate.isolated.distinctTexts,
    ...candidate.latePrefinal.distinctTexts,
    ...candidate.concurrentWithPartial.distinctTexts
  ]
);

console.log(JSON.stringify({
  schemaVersion: 1,
  metric:
    "worker_round_trip_ms = queue + PCM/base64 + CTranslate2 + protocolo",
  environment: {
    logicalCpuCount: cpus().length,
    computeType: "int8",
    device: "cpu"
  },
  input: {
    file: options.file,
    durationMs: round(decoded.pcm.length / 2 / 16_000 * 1_000)
  },
  configuration: options,
  semanticInvariant: {
    pass: new Set(allTexts).size === 1,
    distinctTexts: [...new Set(allTexts)]
  },
  candidates
}, null, 2));
