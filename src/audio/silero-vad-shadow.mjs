import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import {
  numberDistribution,
  RollingSamples
} from "./rolling-samples.mjs";

export const SILERO_VAD_MODEL_SHA256 =
  "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";
export const SILERO_VAD_MODEL_URL =
  "https://github.com/snakers4/silero-vad/raw/v6.2/" +
  "src/silero_vad/data/silero_vad.onnx";

const SAMPLE_RATE = 16_000;
const WINDOW_SAMPLES = 512;
const CONTEXT_SAMPLES = 64;

function round(value, places = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function pcm16ToFloat32(buffer) {
  const samples = new Float32Array(buffer.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2) / 32_768;
  }
  return samples;
}

function normalizeVadResult(result) {
  const probability = Number(result?.probability);
  const context = Float32Array.from(result?.context ?? []);
  const state = Float32Array.from(result?.state ?? []);
  if (
    !Number.isFinite(probability) ||
    context.length !== CONTEXT_SAMPLES ||
    state.length !== 2 * 1 * 128 ||
    !context.every(Number.isFinite) ||
    !state.every(Number.isFinite)
  ) {
    const error = new Error("Silero VAD retornou saída inválida");
    error.code = "silero_vad_invalid_output";
    throw error;
  }
  return { probability, context, state };
}

export class SileroVadShadowStream {
  #buffer = new Float32Array(1_024);
  #bufferedSamples = 0;
  #bufferSampleStart = null;
  #closed = false;
  #context = new Float32Array(CONTEXT_SAMPLES);
  #drainPromise = null;
  #epoch = 0;
  #expectedSampleStart = null;
  #inferenceSamples = new RollingSamples();
  #lastProcessedSampleEnd = null;
  #maximumQueueDepth = 0;
  #negativeStreak = 0;
  #onEvent;
  #onsetSampleStart = null;
  #positiveStreak = 0;
  #processedWindows = 0;
  #queue = [];
  #resetCount = 0;
  #runWindow;
  #speaking = false;
  #state = new Float32Array(2 * 1 * 128);
  #staleResultCount = 0;
  #threshold;
  #offThreshold;
  #onsetWindows;
  #offsetWindows;
  #overflowCount = 0;
  #maxQueueWindows;

  constructor(options) {
    if (typeof options?.runWindow !== "function") {
      throw new TypeError("runWindow é obrigatório");
    }
    this.#runWindow = options.runWindow;
    this.#onEvent = options.onEvent ?? (() => {});
    this.#threshold = options.threshold ?? 0.5;
    this.#offThreshold = options.offThreshold ?? 0.35;
    this.#onsetWindows = options.onsetWindows ?? 2;
    this.#offsetWindows = options.offsetWindows ?? 7;
    this.#maxQueueWindows = options.maxQueueWindows ?? 8;
  }

  get snapshot() {
    return Object.freeze({
      state: this.#speaking ? "speaking" : "idle",
      processedWindows: this.#processedWindows,
      bufferedSamples: this.#bufferedSamples,
      queueDepth: this.#queue.length,
      maximumQueueDepth: this.#maximumQueueDepth,
      overflowCount: this.#overflowCount,
      resetCount: this.#resetCount,
      staleResultCount: this.#staleResultCount,
      lastProcessedSampleEnd: this.#lastProcessedSampleEnd,
      inferenceMs: numberDistribution(
        this.#inferenceSamples.values()
      )
    });
  }

  #emit(type, detail = {}) {
    this.#onEvent({
      type,
      atMs: round(performance.now(), 2),
      ...detail
    });
  }

  #resetState(reason, detail = {}) {
    this.#epoch += 1;
    this.#state = new Float32Array(2 * 1 * 128);
    this.#context = new Float32Array(CONTEXT_SAMPLES);
    this.#positiveStreak = 0;
    this.#negativeStreak = 0;
    this.#onsetSampleStart = null;
    this.#speaking = false;
    this.#resetCount += 1;
    this.#emit("vad.shadow.reset", { reason, ...detail });
  }

  #ensureCapacity(required) {
    if (required <= this.#buffer.length) {
      return;
    }
    let capacity = this.#buffer.length;
    while (capacity < required) {
      capacity *= 2;
    }
    const expanded = new Float32Array(capacity);
    expanded.set(this.#buffer.subarray(0, this.#bufferedSamples));
    this.#buffer = expanded;
  }

  pushFrame(frame) {
    if (this.#closed) {
      return false;
    }
    if (
      !Buffer.isBuffer(frame?.pcm) ||
      !Number.isSafeInteger(frame.sampleStart) ||
      !Number.isSafeInteger(frame.sequence)
    ) {
      throw new TypeError(
        "frame shadow exige pcm, sampleStart e sequence"
      );
    }
    const samples = pcm16ToFloat32(frame.pcm);
    if (
      this.#expectedSampleStart !== null &&
      frame.sampleStart !== this.#expectedSampleStart
    ) {
      const expectedSampleStart = this.#expectedSampleStart;
      this.#bufferedSamples = 0;
      this.#bufferSampleStart = frame.sampleStart;
      this.#queue = [];
      this.#resetState("sample-gap", {
        expectedSampleStart,
        receivedSampleStart: frame.sampleStart,
        sequence: frame.sequence
      });
    }
    this.#expectedSampleStart = frame.sampleStart + samples.length;
    this.#bufferSampleStart ??= frame.sampleStart;
    this.#ensureCapacity(this.#bufferedSamples + samples.length);
    this.#buffer.set(samples, this.#bufferedSamples);
    this.#bufferedSamples += samples.length;

    while (this.#bufferedSamples >= WINDOW_SAMPLES) {
      const window = this.#buffer.slice(0, WINDOW_SAMPLES);
      const sampleStart = this.#bufferSampleStart;
      this.#buffer.copyWithin(
        0,
        WINDOW_SAMPLES,
        this.#bufferedSamples
      );
      this.#bufferedSamples -= WINDOW_SAMPLES;
      this.#bufferSampleStart += WINDOW_SAMPLES;
      this.#enqueue({
        queuedAtMs: performance.now(),
        sampleStart,
        sequence: frame.sequence,
        samples: window
      });
    }
    return true;
  }

  #enqueue(window) {
    if (this.#queue.length >= this.#maxQueueWindows) {
      this.#overflowCount += 1;
      this.#queue = [];
      this.#resetState("queue-overflow", {
        droppedAtSampleStart: window.sampleStart
      });
    }
    this.#queue.push(window);
    this.#maximumQueueDepth = Math.max(
      this.#maximumQueueDepth,
      this.#queue.length
    );
    if (!this.#drainPromise) {
      this.#drainPromise = this.#drain().finally(() => {
        this.#drainPromise = null;
        if (!this.#closed && this.#queue.length > 0) {
          this.#enqueueDrain();
        }
      });
    }
  }

  #enqueueDrain() {
    if (this.#drainPromise || this.#queue.length === 0) {
      return;
    }
    this.#drainPromise = this.#drain().finally(() => {
      this.#drainPromise = null;
      this.#enqueueDrain();
    });
  }

  async #drain() {
    while (!this.#closed && this.#queue.length > 0) {
      const window = this.#queue.shift();
      const epoch = this.#epoch;
      const startedAtMs = performance.now();
      try {
        const rawResult = await this.#runWindow({
          context: this.#context,
          samples: window.samples,
          state: this.#state
        });
        if (this.#closed) {
          return;
        }
        if (epoch !== this.#epoch) {
          this.#staleResultCount += 1;
          this.#emit("vad.shadow.window.discarded", {
            reason: "stream-reset-during-inference",
            sampleStart: window.sampleStart,
            sequence: window.sequence
          });
          continue;
        }
        const result = normalizeVadResult(rawResult);
        const emittedAtMs = performance.now();
        const probability = result.probability;
        this.#context = result.context;
        this.#state = result.state;
        const inferenceMs = emittedAtMs - startedAtMs;
        this.#inferenceSamples.push(inferenceMs);
        this.#processedWindows += 1;
        this.#lastProcessedSampleEnd =
          window.sampleStart + WINDOW_SAMPLES;

        if (!this.#speaking) {
          if (probability >= this.#threshold) {
            this.#onsetSampleStart ??= window.sampleStart;
            this.#positiveStreak += 1;
            if (this.#positiveStreak >= this.#onsetWindows) {
              this.#speaking = true;
              this.#negativeStreak = 0;
              this.#emit("vad.shadow.speech.started", {
                onsetSampleStart: this.#onsetSampleStart,
                triggerSampleStart: window.sampleStart,
                emittedAtMs: round(emittedAtMs, 2),
                probability: round(probability, 6)
              });
            }
          } else {
            this.#positiveStreak = 0;
            this.#onsetSampleStart = null;
          }
        } else if (probability <= this.#offThreshold) {
          this.#negativeStreak += 1;
          if (this.#negativeStreak >= this.#offsetWindows) {
            this.#speaking = false;
            this.#positiveStreak = 0;
            this.#negativeStreak = 0;
            this.#onsetSampleStart = null;
            this.#emit("vad.shadow.speech.ended", {
              triggerSampleStart: window.sampleStart,
              emittedAtMs: round(emittedAtMs, 2),
              probability: round(probability, 6)
            });
          }
        } else {
          this.#negativeStreak = 0;
        }

        this.#emit("vad.shadow.window", {
          sampleStart: window.sampleStart,
          sampleEnd: window.sampleStart + WINDOW_SAMPLES,
          sequence: window.sequence,
          probability: round(probability, 6),
          queueDelayMs: round(startedAtMs - window.queuedAtMs),
          inferenceMs: round(inferenceMs),
          queueDepth: this.#queue.length,
          state: this.#speaking ? "speaking" : "idle",
          positiveStreak: this.#positiveStreak
        });
      } catch (error) {
        if (epoch !== this.#epoch) {
          this.#staleResultCount += 1;
          this.#emit("vad.shadow.window.discarded", {
            reason: "stream-reset-during-inference",
            sampleStart: window.sampleStart,
            sequence: window.sequence
          });
          continue;
        }
        this.#resetState("inference-error", {
          code: error.code ?? "vad_shadow_inference_error",
          message: error.message,
          sampleStart: window.sampleStart
        });
      }
    }
  }

  async flush() {
    while (this.#drainPromise || this.#queue.length > 0) {
      await this.#drainPromise;
    }
    return this.snapshot;
  }

  close(reason = "stream-closed") {
    if (this.#closed) {
      return;
    }
    this.#emit("vad.shadow.session", {
      reason,
      snapshot: this.snapshot
    });
    this.#closed = true;
    this.#queue = [];
  }
}

export class SileroVadController {
  #buffer = new Float32Array(1_024);
  #bufferedSamples = 0;
  #bufferSampleStart = null;
  #clockOriginMs = null;
  #context = new Float32Array(CONTEXT_SAMPLES);
  #expectedSampleStart = null;
  #gapResetCount = 0;
  #inferenceErrorCount = 0;
  #inferenceSamples = new RollingSamples();
  #lastProcessedSampleEnd = null;
  #negativeStreak = 0;
  #offThreshold;
  #offsetWindows;
  #onsetSampleStart = null;
  #onsetSequence = null;
  #onsetWindows;
  #positiveStreak = 0;
  #processedWindows = 0;
  #runWindow;
  #state = new Float32Array(2 * 1 * 128);
  #threshold;
  #vadState = "idle";

  constructor(options) {
    if (typeof options?.runWindow !== "function") {
      throw new TypeError("runWindow é obrigatório");
    }
    this.#runWindow = options.runWindow;
    this.#threshold = options.threshold ?? 0.5;
    this.#offThreshold = options.offThreshold ?? 0.35;
    this.#onsetWindows = options.onsetWindows ?? 2;
    this.#offsetWindows = options.offsetWindows ?? 7;
    this.lastProbability = 0;
    this.noiseFloor = 0;
  }

  get state() {
    return this.#vadState;
  }

  get snapshot() {
    return Object.freeze({
      state: this.#vadState,
      processedWindows: this.#processedWindows,
      bufferedSamples: this.#bufferedSamples,
      gapResetCount: this.#gapResetCount,
      inferenceErrorCount: this.#inferenceErrorCount,
      lastProcessedSampleEnd: this.#lastProcessedSampleEnd,
      lastProbability: round(this.lastProbability, 6),
      inferenceMs: numberDistribution(
        this.#inferenceSamples.values(),
        { includeMax: false }
      )
    });
  }

  thresholds() {
    return {
      domain: "speech-probability",
      on: this.#threshold,
      off: this.#offThreshold
    };
  }

  reset(options = { preserveStream: true }) {
    const preserveStream = options.preserveStream !== false;
    if (!preserveStream) {
      this.#state = new Float32Array(2 * 1 * 128);
      this.#context = new Float32Array(CONTEXT_SAMPLES);
    }
    this.#positiveStreak = 0;
    this.#negativeStreak = 0;
    this.#onsetSampleStart = null;
    this.#onsetSequence = null;
    this.#vadState = "idle";
    this.lastProbability = 0;
    if (!preserveStream) {
      this.#bufferedSamples = 0;
      this.#bufferSampleStart = null;
      this.#expectedSampleStart = null;
      this.#clockOriginMs = null;
    }
  }

  #ensureCapacity(required) {
    if (required <= this.#buffer.length) {
      return;
    }
    let capacity = this.#buffer.length;
    while (capacity < required) {
      capacity *= 2;
    }
    const expanded = new Float32Array(capacity);
    expanded.set(this.#buffer.subarray(0, this.#bufferedSamples));
    this.#buffer = expanded;
  }

  #atMs(sampleStart) {
    return this.#clockOriginMs +
      sampleStart / SAMPLE_RATE * 1_000;
  }

  async push(frame) {
    if (
      !Buffer.isBuffer(frame?.pcm) ||
      !Number.isSafeInteger(frame.sampleStart) ||
      !Number.isSafeInteger(frame.sequence) ||
      !Number.isFinite(frame.atMs)
    ) {
      throw new TypeError(
        "frame de controle Silero exige PCM, relógio e sequência"
      );
    }
    const samples = pcm16ToFloat32(frame.pcm);
    this.#clockOriginMs ??=
      frame.atMs - frame.sampleStart / SAMPLE_RATE * 1_000;
    if (
      this.#expectedSampleStart !== null &&
      frame.sampleStart !== this.#expectedSampleStart
    ) {
      this.#gapResetCount += 1;
      this.reset({ preserveStream: false });
      this.#clockOriginMs =
        frame.atMs - frame.sampleStart / SAMPLE_RATE * 1_000;
    }
    this.#expectedSampleStart = frame.sampleStart + samples.length;
    this.#bufferSampleStart ??= frame.sampleStart;
    this.#ensureCapacity(this.#bufferedSamples + samples.length);
    this.#buffer.set(samples, this.#bufferedSamples);
    this.#bufferedSamples += samples.length;

    const events = [];
    while (this.#bufferedSamples >= WINDOW_SAMPLES) {
      const window = this.#buffer.slice(0, WINDOW_SAMPLES);
      const sampleStart = this.#bufferSampleStart;
      this.#buffer.copyWithin(
        0,
        WINDOW_SAMPLES,
        this.#bufferedSamples
      );
      this.#bufferedSamples -= WINDOW_SAMPLES;
      this.#bufferSampleStart += WINDOW_SAMPLES;

      const startedAtMs = performance.now();
      let result;
      try {
        result = normalizeVadResult(await this.#runWindow({
          context: this.#context,
          samples: window,
          state: this.#state
        }));
      } catch (error) {
        this.#inferenceErrorCount += 1;
        this.reset({ preserveStream: false });
        error.code ??= "silero_vad_inference_error";
        throw error;
      }
      const inferenceMs = performance.now() - startedAtMs;
      const probability = result.probability;
      this.#context = result.context;
      this.#state = result.state;
      this.#inferenceSamples.push(inferenceMs);
      this.#processedWindows += 1;
      this.#lastProcessedSampleEnd =
        sampleStart + WINDOW_SAMPLES;
      this.lastProbability = probability;

      if (this.#vadState !== "speaking") {
        if (probability >= this.#threshold) {
          this.#onsetSampleStart ??= sampleStart;
          this.#onsetSequence ??= frame.sequence;
          this.#positiveStreak += 1;
          if (this.#positiveStreak >= this.#onsetWindows) {
            const resumed = this.#vadState === "paused";
            this.#vadState = "speaking";
            this.#negativeStreak = 0;
            events.push({
              type: resumed
                ? "user.speech.resumed"
                : "user.speech.started",
              atMs: this.#atMs(this.#onsetSampleStart),
              payload: {
                detector: "silero-vad-v6.2",
                probability,
                threshold: this.#threshold,
                onsetSequence: this.#onsetSequence,
                onsetSampleStart: this.#onsetSampleStart,
                triggerSequence: frame.sequence,
                triggerSampleStart: sampleStart
              }
            });
            this.#positiveStreak = 0;
            this.#onsetSampleStart = null;
            this.#onsetSequence = null;
          }
        } else {
          this.#positiveStreak = 0;
          this.#onsetSampleStart = null;
          this.#onsetSequence = null;
        }
        continue;
      }

      if (probability <= this.#offThreshold) {
        this.#onsetSampleStart ??= sampleStart;
        this.#negativeStreak += 1;
        if (this.#negativeStreak >= this.#offsetWindows) {
          const pauseSampleStart = this.#onsetSampleStart;
          this.#vadState = "paused";
          this.#negativeStreak = 0;
          this.#positiveStreak = 0;
          this.#onsetSampleStart = null;
          events.push({
            type: "user.speech.paused",
            atMs: this.#atMs(pauseSampleStart),
            payload: {
              detector: "silero-vad-v6.2",
              probability,
              threshold: this.#offThreshold,
              silenceMs:
                this.#offsetWindows *
                WINDOW_SAMPLES / SAMPLE_RATE * 1_000,
              triggerSequence: frame.sequence,
              triggerSampleStart: sampleStart
            }
          });
        }
      } else {
        this.#negativeStreak = 0;
        this.#onsetSampleStart = null;
      }
    }
    return events;
  }
}

export async function createSileroVadShadowRuntime(options = {}) {
  const modelPath = resolve(
    options.modelPath ??
      "eval/generated/vad/models/silero_vad_v6.2.onnx"
  );
  const actualSha256 = await fileSha256(modelPath);
  if (actualSha256 !== SILERO_VAD_MODEL_SHA256) {
    throw new Error(
      `hash inválido do Silero VAD: ${actualSha256}`
    );
  }
  const ort = await import("onnxruntime-node");
  const createdAt = performance.now();
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    executionMode: "sequential",
    interOpNumThreads: 1,
    intraOpNumThreads: 1
  });
  const sessionInitMs = performance.now() - createdAt;
  const sampleRateTensor = new ort.Tensor(
    "int64",
    new BigInt64Array([BigInt(SAMPLE_RATE)]),
    []
  );

  const runWindow = async ({ context, samples, state }) => {
    const input = new Float32Array(
      CONTEXT_SAMPLES + WINDOW_SAMPLES
    );
    input.set(context);
    input.set(samples, CONTEXT_SAMPLES);
    const result = await session.run({
      input: new ort.Tensor("float32", input, [1, input.length]),
      state: new ort.Tensor("float32", state, [2, 1, 128]),
      sr: sampleRateTensor
    });
    return {
      probability: result.output.data[0],
      state: result.stateN.data,
      context: input.subarray(input.length - CONTEXT_SAMPLES)
    };
  };

  const warmInferenceMs = [];
  let warmState = new Float32Array(2 * 1 * 128);
  let warmContext = new Float32Array(CONTEXT_SAMPLES);
  for (let index = 0; index < 5; index += 1) {
    const startedAt = performance.now();
    const result = await runWindow({
      context: warmContext,
      samples: new Float32Array(WINDOW_SAMPLES),
      state: warmState
    });
    warmInferenceMs.push(performance.now() - startedAt);
    warmState = Float32Array.from(result.state);
    warmContext = Float32Array.from(result.context);
  }
  const warmInferenceDistribution =
    numberDistribution(warmInferenceMs);

  return Object.freeze({
    health: Object.freeze({
      state: "ready",
      engine: "silero-vad",
      version: "6.2",
      mode: options.mode ?? "shadow",
      controlPathChanged:
        options.controlPathChanged === true,
      modelPath,
      sha256: actualSha256,
      threshold: options.threshold ?? 0.5,
      onsetWindows: options.onsetWindows ?? 2,
      offThreshold: options.offThreshold ?? 0.35,
      offsetWindows: options.offsetWindows ?? 7,
      sessionInitMs: round(sessionInitMs),
      warmInferenceMs: {
        p50: warmInferenceDistribution.p50,
        max: warmInferenceDistribution.max
      }
    }),
    createStream(streamOptions = {}) {
      return new SileroVadShadowStream({
        ...options,
        ...streamOptions,
        runWindow
      });
    },
    createController(controllerOptions = {}) {
      return new SileroVadController({
        ...options,
        ...controllerOptions,
        runWindow
      });
    },
    async close() {
      await session.release();
    }
  });
}
