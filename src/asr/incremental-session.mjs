import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { TranscriptStabilizer } from "./text-stability.mjs";

function abortError(message = "sessão ASR cancelada") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function validateConfig(config) {
  for (const field of [
    "sampleRate",
    "initialAudioMs",
    "stepAudioMs",
    "maxTurnMs"
  ]) {
    if (!Number.isFinite(config[field]) || config[field] <= 0) {
      throw new RangeError(`${field} precisa ser positivo`);
    }
  }
}

export class IncrementalAsrSession extends EventEmitter {
  #buffers = [];
  #bufferRanges = [];
  #config;
  #controller = null;
  #dirty = false;
  #eventCallback;
  #finalDeferred = null;
  #finalPcm = null;
  #finishRequestedAt = null;
  #firstAudioAt = null;
  #generation = 0;
  #inflight = null;
  #lastSubmittedSamples = 0;
  #lastSampleEnd = null;
  #now;
  #partialWorker;
  #partialsSuspended = false;
  #finalWorker;
  #preparedFinal = null;
  #preparedFinalSequence = 0;
  #stabilizer;
  #state = "open";
  #totalBytes = 0;

  constructor(options) {
    super();
    if (!options?.worker && (!options?.partialWorker || !options?.finalWorker)) {
      throw new TypeError(
        "worker ou partialWorker + finalWorker são obrigatórios"
      );
    }
    this.id = options.id ??
      `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.language = options.language ?? "pt";
    this.#partialWorker = options.partialWorker ?? options.worker;
    this.#finalWorker = options.finalWorker ?? options.worker;
    this.#now = options.now ?? (() => performance.now());
    this.#eventCallback = options.onEvent ?? null;
    this.#config = {
      sampleRate: options.sampleRate ?? 16_000,
      initialAudioMs: options.initialAudioMs ?? 480,
      stepAudioMs: options.stepAudioMs ?? 320,
      maxTurnMs: options.maxTurnMs ?? 30_000,
      holdbackWords: options.holdbackWords ?? 1
    };
    validateConfig(this.#config);
    this.#stabilizer = new TranscriptStabilizer({
      holdbackWords: this.#config.holdbackWords
    });
  }

  get state() {
    return this.#state;
  }

  get audioMs() {
    return (
      (this.#totalBytes / 2 / this.#config.sampleRate) *
      1_000
    );
  }

  get preparedFinalSnapshot() {
    return this.#preparedFinal?.valid
      ? Object.freeze({ ...this.#preparedFinal.audioSnapshot })
      : null;
  }

  get finalPcmSnapshot() {
    return this.#finalPcm === null
      ? null
      : Buffer.from(this.#finalPcm);
  }

  pushPcm(pcm, options = {}) {
    if (this.#state !== "open") {
      throw new Error(`sessão ASR não aceita áudio em estado ${this.#state}`);
    }
    if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0) {
      throw new TypeError("áudio precisa ser Buffer PCM16LE alinhado");
    }
    if (pcm.length === 0) {
      return;
    }

    const sampleCount = pcm.length / 2;
    const sampleStart = options.sampleStart ??
      this.#lastSampleEnd ??
      0;
    if (!Number.isSafeInteger(sampleStart) || sampleStart < 0) {
      throw new TypeError("sampleStart precisa ser inteiro não negativo");
    }
    if (
      this.#lastSampleEnd !== null &&
      sampleStart < this.#lastSampleEnd
    ) {
      throw new RangeError(
        "sampleStart não pode sobrepor áudio já acumulado"
      );
    }
    const sampleEnd = sampleStart + sampleCount;

    this.#firstAudioAt ??= options.capturedAtMs ?? this.#now();
    this.#buffers.push(pcm);
    this.#bufferRanges.push({ sampleStart, sampleEnd });
    this.#lastSampleEnd = sampleEnd;
    this.#totalBytes += pcm.length;
    if (this.audioMs > this.#config.maxTurnMs) {
      this.cancel("turno excedeu duração máxima");
      throw new RangeError(
        `turno ASR excedeu ${this.#config.maxTurnMs} ms`
      );
    }

    if (!this.#partialsSuspended && this.#shouldRequestPartial()) {
      if (this.#inflight) {
        this.#dirty = true;
      } else {
        this.#launch("partial");
      }
    }
  }

  suspendPartials() {
    if (this.#state !== "open") {
      return false;
    }
    this.#partialsSuspended = true;
    return true;
  }

  resumePartials() {
    if (this.#state !== "open" || !this.#partialsSuspended) {
      return false;
    }
    this.#partialsSuspended = false;
    if (!this.#inflight && this.#shouldRequestPartial()) {
      this.#launch("partial");
    }
    return true;
  }

  finish() {
    if (this.#state === "cancelled") {
      return Promise.reject(abortError());
    }
    if (this.#state === "closed") {
      return this.#finalDeferred?.promise ??
        Promise.reject(new Error("sessão ASR já encerrada"));
    }
    if (this.#finalDeferred) {
      return this.#finalDeferred.promise;
    }

    this.#state = "finishing";
    this.#finishRequestedAt = this.#now();
    this.#finalDeferred = deferred();
    if (this.#totalBytes === 0) {
      const snapshot = this.#createAudioSnapshot();
      this.#emitFinal({
        text: "",
        elapsedMs: 0,
        language: this.language,
        languageProbability: null,
        segments: []
      }, this.#generation, {
        audioSnapshot: snapshot.metadata,
        audioPcm: snapshot.pcm,
        finalSource: "fresh",
        rawFinalReadyAtMs: this.#now()
      });
    } else if (this.#preparedFinal?.valid) {
      const prepared = this.#preparedFinal;
      this.#preparedFinal = null;
      this.#generation += 1;
      const generation = this.#generation;
      this.#controller?.abort();
      this.#inflight = null;
      this.#controller = null;
      void prepared.promise.then((outcome) => {
        if (this.#state === "cancelled") {
          return;
        }
        if (outcome.ok) {
          this.#emitFinal(outcome.result, generation, {
            audioSnapshot: prepared.audioSnapshot,
            audioPcm: prepared.pcm,
            finalSource: "prepared",
            preparedStartedAtMs: prepared.startedAtMs,
            rawFinalReadyAtMs: outcome.rawFinalReadyAtMs
          });
        } else {
          this.#launch("final");
        }
      });
    } else if (this.#inflight) {
      this.#controller?.abort();
      this.#inflight = null;
      this.#controller = null;
      this.#launch("final");
    } else {
      this.#launch("final");
    }
    return this.#finalDeferred.promise;
  }

  prepareFinal(options = {}) {
    if (
      this.#state !== "open" ||
      this.#totalBytes === 0 ||
      this.#preparedFinal?.valid
    ) {
      return this.#preparedFinal?.promise ?? null;
    }

    const snapshot = this.#createAudioSnapshot({
      sampleEnd: options.sampleEnd,
      trigger: options.trigger
    });
    if (snapshot.pcm.length === 0) {
      return null;
    }
    const controller = new AbortController();
    const generation = ++this.#preparedFinalSequence;
    const startedAtMs = this.#now();
    const prepared = {
      audioSnapshot: snapshot.metadata,
      controller,
      generation,
      pcm: snapshot.pcm,
      samples: snapshot.metadata.sampleCount,
      startedAtMs,
      valid: true,
      promise: null
    };
    const task = this.#finalWorker.transcribe(
      {
        generation,
        language: this.language,
        mode: "final",
        pcm: snapshot.pcm,
        sampleRate: this.#config.sampleRate,
        sessionId: `${this.id}:prepared-final`
      },
      { signal: controller.signal }
    );
    prepared.promise = task.then(
      (result) => ({
        ok: true,
        rawFinalReadyAtMs: this.#now(),
        result
      }),
      (error) => ({
        ok: false,
        rawFinalReadyAtMs: this.#now(),
        error
      })
    );
    this.#preparedFinal = prepared;
    return prepared.promise;
  }

  invalidatePreparedFinal(reason = "speech-resumed") {
    const prepared = this.#preparedFinal;
    if (!prepared) {
      return false;
    }
    prepared.valid = false;
    prepared.controller.abort(reason);
    this.#preparedFinal = null;
    return true;
  }

  cancel(reason = "cancelada") {
    if (this.#state === "cancelled" || this.#state === "closed") {
      return;
    }
    this.#state = "cancelled";
    this.#dirty = false;
    this.#controller?.abort();
    this.invalidatePreparedFinal(reason);
    const event = this.#event("cancelled", {
      reason,
      cancelLatencyMs: 0
    });
    this.#publish(event);
    this.#finalDeferred?.reject(abortError(reason));
  }

  #shouldRequestPartial() {
    const totalSamples = this.#totalBytes / 2;
    const initialSamples =
      (this.#config.initialAudioMs / 1_000) * this.#config.sampleRate;
    const stepSamples =
      (this.#config.stepAudioMs / 1_000) * this.#config.sampleRate;
    if (this.#lastSubmittedSamples === 0) {
      return totalSamples >= initialSamples;
    }
    return totalSamples - this.#lastSubmittedSamples >= stepSamples;
  }

  #createAudioSnapshot(options = {}) {
    const requestedSampleEnd = options.sampleEnd ?? null;
    if (
      requestedSampleEnd !== null &&
      (
        !Number.isSafeInteger(requestedSampleEnd) ||
        requestedSampleEnd < 0
      )
    ) {
      throw new TypeError(
        "sampleEnd da prefinal precisa ser inteiro não negativo"
      );
    }

    const selected = [];
    let byteLength = 0;
    let gapSamples = 0;
    let previousSampleEnd = null;
    let sampleStart = null;
    let sampleEnd = null;
    for (let index = 0; index < this.#buffers.length; index += 1) {
      const buffer = this.#buffers[index];
      const range = this.#bufferRanges[index];
      if (
        requestedSampleEnd !== null &&
        range.sampleStart >= requestedSampleEnd
      ) {
        break;
      }
      const selectedSampleEnd = requestedSampleEnd === null
        ? range.sampleEnd
        : Math.min(range.sampleEnd, requestedSampleEnd);
      const selectedSamples = selectedSampleEnd - range.sampleStart;
      if (selectedSamples <= 0) {
        continue;
      }
      if (
        previousSampleEnd !== null &&
        range.sampleStart > previousSampleEnd
      ) {
        gapSamples += range.sampleStart - previousSampleEnd;
      }
      const selectedBuffer =
        selectedSamples === range.sampleEnd - range.sampleStart
          ? buffer
          : buffer.subarray(0, selectedSamples * 2);
      selected.push(selectedBuffer);
      byteLength += selectedBuffer.length;
      sampleStart ??= range.sampleStart;
      sampleEnd = selectedSampleEnd;
      previousSampleEnd = selectedSampleEnd;
    }
    const pcm = Buffer.concat(selected, byteLength);
    const sampleCount = byteLength / 2;
    const availableSampleStart =
      this.#bufferRanges[0]?.sampleStart ?? null;
    const availableSampleEnd =
      this.#bufferRanges.at(-1)?.sampleEnd ?? null;
    const metadata = Object.freeze({
      sha256: createHash("sha256").update(pcm).digest("hex"),
      sampleStart,
      sampleEnd,
      sampleCount,
      requestedSampleEnd,
      availableSampleStart,
      availableSampleEnd,
      availableSampleCount: this.#totalBytes / 2,
      tailExcludedSamples: this.#totalBytes / 2 - sampleCount,
      gapSamples,
      contiguous: gapSamples === 0,
      boundaryMatched:
        requestedSampleEnd === null ||
        sampleEnd === requestedSampleEnd,
      trigger: options.trigger ?? null
    });
    return { metadata, pcm };
  }

  #launch(mode) {
    if (this.#state === "cancelled" || this.#inflight) {
      return;
    }
    const snapshot = this.#createAudioSnapshot();
    const pcm = snapshot.pcm;
    const submittedSamples = snapshot.metadata.sampleCount;
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#controller = controller;
    this.#lastSubmittedSamples = submittedSamples;
    this.#dirty = false;

    const worker = mode === "final"
      ? this.#finalWorker
      : this.#partialWorker;
    const task = worker.transcribe(
      {
        generation,
        language: this.language,
        mode,
        pcm,
        sampleRate: this.#config.sampleRate,
        sessionId: this.id
      },
      { signal: controller.signal }
    );
    this.#inflight = task;

    void task.then(
      (result) => {
        if (
          this.#state === "cancelled" ||
          generation !== this.#generation
        ) {
          return;
        }
        if (mode === "final") {
          this.#emitFinal(result, generation, {
            audioSnapshot: snapshot.metadata,
            audioPcm: snapshot.pcm,
            finalSource: "fresh",
            rawFinalReadyAtMs: this.#now()
          });
        } else {
          this.#emitPartial(result, generation);
        }
      },
      (error) => {
        if (
          error.name !== "AbortError" &&
          this.#state !== "cancelled" &&
          generation === this.#generation
        ) {
          this.#state = "closed";
          const event = this.#event("error", {
            code: error.code ?? "asr_error",
            message: error.message
          });
          this.#publish(event);
          this.#finalDeferred?.reject(error);
        }
      }
    ).finally(() => {
      if (this.#inflight !== task) {
        return;
      }
      this.#inflight = null;
      this.#controller = null;
      if (this.#state === "finishing") {
        this.#launch("final");
      } else if (
        this.#state === "open" &&
        !this.#partialsSuspended &&
        (this.#dirty || this.#shouldRequestPartial())
      ) {
        this.#launch("partial");
      }
    });
  }

  #emitPartial(result, generation) {
    const stabilized = this.#stabilizer.update(result.text);
    const event = this.#event("partial", {
      ...stabilized,
      generation,
      audioEndMs: this.#samplesToMs(this.#lastSubmittedSamples),
      inferenceMs: result.elapsedMs ?? null,
      roundTripMs: result.roundTripMs ?? null,
      language: result.language ?? this.language,
      languageProbability: result.languageProbability ?? null
    });
    this.#publish(event);
  }

  #emitFinal(
    result,
    generation = this.#generation,
    context = {}
  ) {
    if (this.#state === "closed") {
      return;
    }
    const stabilized = this.#stabilizer.finalize(result.text);
    this.#finalPcm = Buffer.from(context.audioPcm ?? Buffer.alloc(0));
    const event = this.#event("final", {
      ...stabilized,
      generation,
      audioEndMs: this.#samplesToMs(
        context.audioSnapshot?.sampleCount ??
          this.#totalBytes / 2
      ),
      inferenceMs: result.elapsedMs ?? null,
      roundTripMs: result.roundTripMs ?? null,
      finalizationMs:
        this.#finishRequestedAt === null
          ? null
          : this.#now() - this.#finishRequestedAt,
      language: result.language ?? this.language,
      languageProbability: result.languageProbability ?? null,
      engine: result.engine ?? null,
      segments: result.segments ?? [],
      audioSnapshot: context.audioSnapshot ?? null,
      finalSource: context.finalSource ?? "fresh",
      preparedStartedAtMs: context.preparedStartedAtMs ?? null,
      rawFinalReadyAtMs: context.rawFinalReadyAtMs ?? this.#now(),
      finishRequestedAtMs: this.#finishRequestedAt,
      preparedReadyBeforeFinish:
        context.finalSource === "prepared" &&
        Number.isFinite(context.rawFinalReadyAtMs) &&
        Number.isFinite(this.#finishRequestedAt)
          ? context.rawFinalReadyAtMs <= this.#finishRequestedAt
          : false
    });
    this.#state = "closed";
    this.#publish(event);
    this.#finalDeferred?.resolve(event);
  }

  #samplesToMs(samples) {
    return (samples / this.#config.sampleRate) * 1_000;
  }

  #event(type, detail) {
    const atMs = this.#now();
    return {
      type,
      sessionId: this.id,
      atMs,
      elapsedMs:
        this.#firstAudioAt === null ? 0 : atMs - this.#firstAudioAt,
      ...detail
    };
  }

  #publish(event) {
    this.emit(event.type, event);
    this.emit("event", event);
    this.#eventCallback?.(event);
  }
}

export class PersistentIncrementalAsr {
  #sessions = new Set();
  #workers;

  constructor(options) {
    if (!options?.worker && (!options?.partialWorker || !options?.finalWorker)) {
      throw new TypeError(
        "worker ou partialWorker + finalWorker são obrigatórios"
      );
    }
    this.partialWorker = options.partialWorker ?? options.worker;
    this.finalWorker = options.finalWorker ?? options.worker;
    this.#workers = new Set([this.partialWorker, this.finalWorker]);
    this.sessionDefaults = options.sessionDefaults ?? {};
  }

  async start() {
    const ready = await Promise.all(
      [...this.#workers].map((worker) => worker.start())
    );
    return {
      partial: ready[0],
      final: ready.at(-1)
    };
  }

  createSession(options = {}) {
    const session = new IncrementalAsrSession({
      ...this.sessionDefaults,
      ...options,
      partialWorker: this.partialWorker,
      finalWorker: this.finalWorker
    });
    this.#sessions.add(session);
    const release = () => this.#sessions.delete(session);
    session.once("final", release);
    session.once("cancelled", release);
    session.once("error", release);
    return session;
  }

  async close() {
    for (const session of this.#sessions) {
      session.cancel("runtime encerrado");
    }
    this.#sessions.clear();
    await Promise.all(
      [...this.#workers].map((worker) => worker.close())
    );
  }
}
