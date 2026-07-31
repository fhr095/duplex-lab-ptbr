import { performance } from "node:perf_hooks";

import {
  numberDistribution,
  RollingSamples
} from "./rolling-samples.mjs";

function round(value, places = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export class FramePipelineTelemetry {
  #acceptedFrames = 0;
  #maxDepth;
  #maximumPendingFrames = 0;
  #overflowCount = 0;
  #pending = new Set();
  #processedFrames = 0;
  #processingErrorCount = 0;
  #queueDelayMs = new RollingSamples();
  #receivedFrames = 0;
  #lastProcessedSampleEnd = null;
  #lastProcessedSequence = null;

  constructor(options = {}) {
    this.#maxDepth = options.maxDepth ?? 16;
    if (!Number.isSafeInteger(this.#maxDepth) || this.#maxDepth < 1) {
      throw new RangeError("maxDepth do pipeline precisa ser positivo");
    }
  }

  enqueue(frame, atMs = performance.now()) {
    this.#receivedFrames += 1;
    if (this.#pending.size >= this.#maxDepth) {
      this.#overflowCount += 1;
      const error = new Error(
        `backlog de áudio excedeu ${this.#maxDepth} frames`
      );
      error.code = "audio_pipeline_overflow";
      throw error;
    }
    const token = {
      atMs,
      completed: false,
      sampleEnd: frame.sampleEnd,
      sequence: frame.sequence,
      started: false
    };
    this.#acceptedFrames += 1;
    this.#pending.add(token);
    this.#maximumPendingFrames = Math.max(
      this.#maximumPendingFrames,
      this.#pending.size
    );
    return token;
  }

  start(token, atMs = performance.now()) {
    if (!this.#pending.has(token) || token.started) {
      throw new Error("token inválido ao iniciar pipeline de áudio");
    }
    token.started = true;
    this.#queueDelayMs.push(Math.max(0, atMs - token.atMs));
  }

  complete(token, options = {}) {
    if (!this.#pending.has(token) || token.completed) {
      return false;
    }
    token.completed = true;
    this.#pending.delete(token);
    if (options.success === false) {
      this.#processingErrorCount += 1;
      return true;
    }
    this.#processedFrames += 1;
    this.#lastProcessedSequence = token.sequence;
    this.#lastProcessedSampleEnd = token.sampleEnd;
    return true;
  }

  snapshot(atMs = performance.now()) {
    const queueDelay = this.#queueDelayMs.values();
    const oldestPendingAtMs = this.#pending.size === 0
      ? null
      : Math.min(...[...this.#pending].map((token) => token.atMs));
    return Object.freeze({
      receivedFrames: this.#receivedFrames,
      acceptedFrames: this.#acceptedFrames,
      processedFrames: this.#processedFrames,
      processingErrorCount: this.#processingErrorCount,
      pendingFrames: this.#pending.size,
      maximumPendingFrames: this.#maximumPendingFrames,
      maxDepth: this.#maxDepth,
      overflowCount: this.#overflowCount,
      lastProcessedSequence: this.#lastProcessedSequence,
      lastProcessedSampleEnd: this.#lastProcessedSampleEnd,
      oldestPendingAgeMs:
        oldestPendingAtMs === null
          ? 0
          : round(Math.max(0, atMs - oldestPendingAtMs)),
      queueDelayMs: numberDistribution(queueDelay)
    });
  }
}
