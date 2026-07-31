import { performance } from "node:perf_hooks";

import { WindowsSystemSpeechSynthesizer } from "../src/tts/windows-system-tts.mjs";

const text =
  process.argv.slice(2).join(" ").trim() ||
  "Entendi. Vou verificar isso para você.";
const coldRuns = 5;
const warmRuns = 10;

function round(value) {
  return Math.round(value * 100) / 100;
}

function percentile(samples, probability) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil(probability * sorted.length) - 1
  );
  return sorted[index];
}

function summarize(samples) {
  return {
    count: samples.length,
    minMs: round(Math.min(...samples)),
    p50Ms: round(percentile(samples, 0.5)),
    p95Ms: round(percentile(samples, 0.95)),
    maxMs: round(Math.max(...samples)),
    samplesMs: samples.map(round)
  };
}

async function measureCold() {
  const samples = [];
  for (let index = 0; index < coldRuns; index += 1) {
    const synthesizer = new WindowsSystemSpeechSynthesizer({
      idleTimeoutMs: 0
    });
    try {
      const startedAt = performance.now();
      await synthesizer.synthesize(text);
      samples.push(performance.now() - startedAt);
    } finally {
      await synthesizer.close({ drain: false });
    }
  }
  return samples;
}

async function measureWarm() {
  const synthesizer = new WindowsSystemSpeechSynthesizer({
    idleTimeoutMs: 0
  });
  try {
    const prewarmStartedAt = performance.now();
    const status = await synthesizer.prewarm();
    const prewarmMs = performance.now() - prewarmStartedAt;
    const samples = [];
    for (let index = 0; index < warmRuns; index += 1) {
      const startedAt = performance.now();
      await synthesizer.synthesize(text);
      samples.push(performance.now() - startedAt);
    }
    return {
      samples,
      prewarmMs,
      worker: status.worker,
      processStarts: synthesizer.status.stats.processStarts
    };
  } finally {
    await synthesizer.close();
  }
}

try {
  const cold = summarize(await measureCold());
  const warmMeasurement = await measureWarm();
  const warm = summarize(warmMeasurement.samples);
  const medianReduction =
    ((cold.p50Ms - warm.p50Ms) / cold.p50Ms) * 100;

  console.log(
    JSON.stringify(
      {
        metric: "request_to_wav_ready_ms",
        note:
          "Mede a contribuição do sintetizador para TTFA; não inclui rede, decode nem início do player.",
        text,
        cold: {
          mode: "novo powershell.exe e nova voz por fala",
          ...cold
        },
        warm: {
          mode: "um worker System.Speech persistente",
          prewarmMs: round(warmMeasurement.prewarmMs),
          worker: warmMeasurement.worker,
          processStarts: warmMeasurement.processStarts,
          ...warm
        },
        p50ReductionPercent: round(medianReduction)
      },
      null,
      2
    )
  );
} catch (error) {
  if (error.code === "ENOENT") {
    console.error("powershell.exe não está disponível neste ambiente");
    process.exitCode = 2;
  } else {
    throw error;
  }
}
