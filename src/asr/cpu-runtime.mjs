import { PersistentIncrementalAsr } from "./incremental-session.mjs";
import { PersistentAsrWorker } from "./worker-client.mjs";

export function resolveAsrWarmupDurations(options = {}) {
  return {
    partial:
      options.partialWarmupMs ?? options.warmupMs,
    final:
      options.finalWarmupMs ?? options.warmupMs
  };
}

export function createCpuStreamingAsr(options = {}) {
  const warmup = resolveAsrWarmupDurations(options);
  const partialWorker = new PersistentAsrWorker({
    cacheDir: options.cacheDir,
    computeType: options.computeType ?? "int8",
    engine: options.partialEngine ?? "whisper",
    model: options.partialModel ?? options.model ?? "tiny",
    requestTimeoutMs: options.requestTimeoutMs,
    startTimeoutMs: options.startTimeoutMs,
    threads: options.partialThreads ?? 1,
    workers: 1,
    warmupMs: warmup.partial
  });
  const finalWorker = new PersistentAsrWorker({
    cacheDir: options.cacheDir,
    computeType: options.computeType ?? "int8",
    engine: options.finalEngine ?? "whisper",
    model: options.finalModel ?? options.model ?? "base",
    requestTimeoutMs: options.requestTimeoutMs,
    startTimeoutMs: options.startTimeoutMs,
    threads: options.finalThreads ?? 3,
    workers: 1,
    warmupMs: warmup.final
  });

  return new PersistentIncrementalAsr({
    partialWorker,
    finalWorker,
    sessionDefaults: {
      initialAudioMs: 320,
      stepAudioMs: 320,
      maxTurnMs: 30_000,
      ...options.sessionDefaults
    }
  });
}
