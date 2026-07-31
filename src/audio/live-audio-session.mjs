import { AdaptiveEnergyVad } from "./adaptive-energy-vad.mjs";
import {
  assessTranscriptPlausibility
} from "../asr/transcript-plausibility.mjs";
import {
  reconcileFinalTranscript
} from "../asr/final-reconciliation.mjs";
import {
  decideEndpoint,
  looksIncompletePtBr
} from "../interaction/adaptive-endpoint.mjs";
import {
  selectFinalCommitGraceMs
} from "../interaction/commit-grace.mjs";

function pcmRms(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new TypeError("frame precisa conter Buffer PCM16LE alinhado");
  }
  let sumSquares = 0;
  const samples = pcm.length / 2;
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const normalized = pcm.readInt16LE(offset) / 32_768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / samples);
}

function requiredInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} precisa ser inteiro não negativo`);
  }
}

export class LiveAudioSession {
  #asrRuntime;
  #clockOriginMs = null;
  #closed = false;
  #emitCallback;
  #endpointConfig;
  #effectfulFinalCommitGraceMs;
  #criticalFinalCommitGraceMs;
  #backchannelSilenceMs;
  #minimumBackchannelSpeechMs;
  #frameDurationMs;
  #frameCount = 0;
  #finalCommitGraceMs;
  #lastSampleEnd = null;
  #lastSequence = null;
  #mergeWindowMs;
  #nextTurnId = 0;
  #pendingFinals = new Set();
  #preRoll = [];
  #preRollFrames;
  #recentFinal = null;
  #sampleRate;
  #turn = null;
  #vad;

  constructor(options = {}) {
    if (!options.asrRuntime?.createSession) {
      throw new TypeError("asrRuntime com createSession é obrigatório");
    }
    this.#asrRuntime = options.asrRuntime;
    this.#emitCallback = options.onEvent ?? (() => {});
    this.#sampleRate = options.sampleRate ?? 16_000;
    this.#frameDurationMs = options.frameDurationMs ?? 20;
    this.#preRollFrames = Math.ceil(
      (options.preRollMs ?? 240) / this.#frameDurationMs
    );
    this.#endpointConfig = options.endpointConfig ?? {};
    this.#backchannelSilenceMs =
      options.backchannelSilenceMs ?? 380;
    this.#minimumBackchannelSpeechMs =
      options.minimumBackchannelSpeechMs ?? 900;
    this.#mergeWindowMs = options.mergeWindowMs ?? 1_400;
    this.#finalCommitGraceMs = options.finalCommitGraceMs ?? 0;
    this.#effectfulFinalCommitGraceMs =
      options.effectfulFinalCommitGraceMs ??
      this.#finalCommitGraceMs;
    this.#criticalFinalCommitGraceMs =
      options.criticalFinalCommitGraceMs ?? 1_100;
    this.#vad = options.vad ?? new AdaptiveEnergyVad({
      minimumOnThreshold: 0.025,
      minimumOffThreshold: 0.012,
      onMultiplier: 4,
      onsetFrames: 4,
      ...options.vadConfig
    });
  }

  get activeTurnId() {
    return this.#turn?.id ?? null;
  }

  get closed() {
    return this.#closed;
  }

  pushFrame(frame) {
    if (this.#closed) {
      throw new Error("sessão de áudio encerrada");
    }
    requiredInteger(frame.sequence, "sequence");
    requiredInteger(frame.sampleStart, "sampleStart");
    if (!Buffer.isBuffer(frame.pcm)) {
      throw new TypeError("frame.pcm precisa ser Buffer");
    }
    const sampleCount = frame.pcm.length / 2;
    if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
      throw new TypeError("frame PCM16 inválido");
    }

    if (this.#lastSequence !== null) {
      if (frame.sequence <= this.#lastSequence) {
        this.#emit("audio.frame.rejected", this.#atMs(frame.sampleStart), {
          reason: "non-monotonic-sequence",
          sequence: frame.sequence
        });
        return;
      }
      const lostFrames = frame.sequence - this.#lastSequence - 1;
      const lostSamples = Math.max(
        0,
        frame.sampleStart - this.#lastSampleEnd
      );
      if (lostFrames > 0 || lostSamples > 0) {
        this.#emit("audio.frames.dropped", this.#atMs(frame.sampleStart), {
          lostFrames,
          lostSamples
        });
      }
    }
    this.#lastSequence = frame.sequence;
    this.#lastSampleEnd = frame.sampleStart + sampleCount;

    const atMs = this.#atMs(frame.sampleStart);
    const durationMs = (sampleCount / this.#sampleRate) * 1_000;
    const enriched = {
      ...frame,
      atMs,
      durationMs,
      rms: pcmRms(frame.pcm)
    };
    this.#frameCount += 1;
    if (this.#frameCount % 25 === 0) {
      const thresholds = this.#vad.thresholds();
      this.#emit("audio.level", atMs, {
        detector:
          thresholds.domain === "speech-probability"
            ? "silero-vad-v6.2"
            : "adaptive-energy-vad",
        rms: Math.round(enriched.rms * 100_000) / 100_000,
        noiseFloor:
          Math.round(this.#vad.noiseFloor * 100_000) / 100_000,
        onThreshold: Math.round(thresholds.on * 100_000) / 100_000,
        offThreshold: Math.round(thresholds.off * 100_000) / 100_000,
        speechProbability:
          Number.isFinite(this.#vad.lastProbability)
            ? Math.round(this.#vad.lastProbability * 1_000_000) /
              1_000_000
            : null,
        vadState: this.#vad.state
      });
    }

    if (!this.#turn) {
      this.#preRoll.push(enriched);
      this.#preRoll = this.#preRoll.slice(-this.#preRollFrames);
    }

    const vadEvents = this.#vad.push(enriched);
    if (typeof vadEvents?.then === "function") {
      return vadEvents.then((resolvedEvents) =>
        this.#consumeVadEvents(
          enriched,
          frame,
          atMs,
          durationMs,
          resolvedEvents
        )
      );
    }
    return this.#consumeVadEvents(
      enriched,
      frame,
      atMs,
      durationMs,
      vadEvents
    );
  }

  #consumeVadEvents(
    enriched,
    frame,
    atMs,
    durationMs,
    vadEvents
  ) {
    if (this.#closed) {
      return;
    }
    if (!Array.isArray(vadEvents)) {
      throw new TypeError("VAD precisa retornar uma lista de eventos");
    }
    const started = vadEvents.find(
      (event) => event.type === "user.speech.started"
    );
    if (started) {
      this.#startTurn(started);
    } else if (this.#turn) {
      this.#turn.asr.pushPcm(frame.pcm, { capturedAtMs: atMs });
    }

    for (const event of vadEvents) {
      if (event.type === "user.speech.paused" && this.#turn) {
        this.#turn.pauseAtMs = event.atMs;
        this.#turn.asr.suspendPartials?.();
        this.#tryPrepareFinal(
          this.#turn,
          event.atMs,
          "speech-paused"
        );
      } else if (event.type === "user.speech.resumed" && this.#turn) {
        this.#turn.pauseAtMs = null;
        if (this.#turn.asr.invalidatePreparedFinal?.()) {
          this.#turn.prefinalStarted = false;
          this.#emit("endpoint.prefinal.cancelled", event.atMs, {
            turnId: this.#turn.id,
            reason: "speech-resumed"
          });
        }
        this.#turn.asr.resumePartials?.();
      }
      this.#emit(event.type, event.atMs, {
        ...event.payload,
        turnId: this.#turn?.id ?? null
      });
    }

    if (this.#turn?.pauseAtMs !== null) {
      this.#considerEndpoint(atMs + durationMs);
    }
  }

  close(reason = "connection-closed") {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#turn) {
      this.#turn.cancelled = true;
      this.#turn.asr.cancel(reason);
    }
    this.#turn = null;
    for (const pending of this.#pendingFinals) {
      pending.cancelled = true;
      pending.asr.cancel(reason);
    }
    this.#pendingFinals.clear();
    this.#preRoll = [];
  }

  #atMs(sampleStart) {
    this.#clockOriginMs ??= performance.now() -
      (sampleStart / this.#sampleRate) * 1_000;
    return this.#clockOriginMs +
      (sampleStart / this.#sampleRate) * 1_000;
  }

  #startTurn(vadEvent) {
    const mergeablePending = [...this.#pendingFinals]
      .filter(
        (pending) =>
          vadEvent.atMs - pending.endpointAtMs <= this.#mergeWindowMs
      )
      .at(-1) ?? null;
    for (const pending of [...this.#pendingFinals]) {
      if (pending === mergeablePending) {
        pending.superseded = true;
        this.#emit("transcript.merging", vadEvent.atMs, {
          reason: "speech-resumed-after-endpoint",
          turnId: pending.id
        });
        continue;
      }
      pending.cancelled = true;
      pending.asr.cancel("superseded-by-new-speech");
      this.#pendingFinals.delete(pending);
      this.#emit("transcript.cancelled", vadEvent.atMs, {
        reason: "superseded-by-new-speech",
        turnId: pending.id
      });
    }
    const recentGapMs = this.#recentFinal
      ? vadEvent.atMs - this.#recentFinal.endpointAtMs
      : Number.POSITIVE_INFINITY;
    const previousTurn =
      mergeablePending ??
      (recentGapMs <= this.#mergeWindowMs ? this.#recentFinal : null);

    const id = `turn-${++this.#nextTurnId}`;
    const turn = {
      id,
      asr: null,
      backchannelSent: false,
      cancelled: false,
      latestTranscript: "",
      pauseAtMs: null,
      prefinalStarted: false,
      previousTurn,
      startedAtMs: vadEvent.atMs
    };
    turn.asr = this.#asrRuntime.createSession({
      id,
      onEvent: (event) => {
        if (this.#closed || turn.cancelled) {
          return;
        }
        if (event.type === "partial") {
          turn.latestTranscript = event.text;
          this.#emit("transcript.partial", performance.now(), {
            turnId: id,
            text: event.text,
            committedText: event.committedText,
            unstableText: event.unstableText,
            inferenceMs: event.inferenceMs,
            audioEndMs: event.audioEndMs
          });
          this.#tryPrepareFinal(
            turn,
            event.atMs ?? performance.now(),
            "partial-after-pause"
          );
        } else if (event.type === "error") {
          this.#emit("transcript.error", performance.now(), {
            turnId: id,
            code: event.code,
            message: event.message
          });
        }
      }
    });
    this.#turn = turn;
    for (const buffered of this.#preRoll) {
      turn.asr.pushPcm(buffered.pcm, { capturedAtMs: buffered.atMs });
    }
    this.#preRoll = [];
  }

  #tryPrepareFinal(turn, atMs, trigger) {
    if (
      this.#turn !== turn ||
      turn.pauseAtMs === null ||
      turn.prefinalStarted ||
      turn.pauseAtMs - turn.startedAtMs < 420 ||
      !turn.latestTranscript ||
      looksIncompletePtBr(turn.latestTranscript)
    ) {
      return false;
    }

    const preparation = turn.asr.prepareFinal?.();
    if (!preparation) {
      return false;
    }
    turn.prefinalStarted = true;
    this.#emit("endpoint.prefinal.started", atMs, {
      turnId: turn.id,
      provisionalText: turn.latestTranscript,
      trigger
    });
    return true;
  }

  #considerEndpoint(atMs) {
    const turn = this.#turn;
    if (!turn || turn.pauseAtMs === null) {
      return;
    }
    const decision = decideEndpoint({
      silenceMs: atMs - turn.pauseAtMs,
      speechMs: turn.pauseAtMs - turn.startedAtMs,
      transcript: turn.latestTranscript
    }, this.#endpointConfig);
    const speechMs = turn.pauseAtMs - turn.startedAtMs;
    if (
      !turn.backchannelSent &&
      decision.action === "wait" &&
      decision.incomplete &&
      turn.latestTranscript &&
      speechMs >= this.#minimumBackchannelSpeechMs &&
      decision.observedSilenceMs >= this.#backchannelSilenceMs
    ) {
      turn.backchannelSent = true;
      this.#emit("assistant.backchannel.suggested", atMs, {
        turnId: turn.id,
        text: "Aham.",
        silenceMs: decision.observedSilenceMs,
        reason: "incomplete-utterance"
      });
    }
    if (decision.action !== "commit") {
      return;
    }

    this.#turn = null;
    this.#vad.reset();
    this.#preRoll = [];
    this.#pendingFinals.add(turn);
    turn.speechMs = turn.pauseAtMs - turn.startedAtMs;
    turn.totalSpeechMs = turn.speechMs;
    turn.endpointAtMs = atMs;
    turn.endpointCommittedAtWallMs = performance.now();
    turn.emitted = false;
    turn.superseded = false;
    this.#emit("endpoint.committed", atMs, {
      turnId: turn.id,
      reason: decision.reason,
      silenceMs: decision.observedSilenceMs,
      requiredSilenceMs: decision.requiredSilenceMs,
      provisionalText: turn.latestTranscript
    });

    const rawFinal = turn.asr.finish();
    turn.finalPromise = (async () => {
      const raw = await rawFinal;
      const reconciliation = reconcileFinalTranscript({
        engine: raw.engine,
        finalText: raw.text,
        provisionalText: turn.latestTranscript
      });
      const final = {
        ...raw,
        text: reconciliation.text,
        transcriptSource: reconciliation.source,
        reconciliationReason: reconciliation.reason,
        criticalConflict: reconciliation.criticalConflict ?? null,
        criticalInstability: reconciliation.criticalInstability ?? null
      };
      const previous = turn.previousTurn;
      if (!previous?.finalPromise) {
        turn.resolvedFinal = final;
        return final;
      }

      let previousFinal;
      try {
        previousFinal = await previous.finalPromise;
      } catch {
        turn.resolvedFinal = final;
        return final;
      }
      const previousPlausibility = assessTranscriptPlausibility({
        text: previousFinal.text,
        audioMs: previous.totalSpeechMs ?? previous.speechMs
      });
      const correctionOrContinuation =
        /^(?:aliás|e\b|mas\b|melhor|na verdade|não\b|quer dizer)/iu.test(
          String(final.text ?? "").trim()
        );
      const merge =
        previousPlausibility.pass &&
        (!previous.emitted || correctionOrContinuation);
      if (!merge) {
        turn.resolvedFinal = final;
        return final;
      }

      turn.totalSpeechMs +=
        previous.totalSpeechMs ?? previous.speechMs ?? 0;
      const merged = {
        ...final,
        text: [previousFinal.text, final.text]
          .map((text) => String(text ?? "").trim())
          .filter(Boolean)
          .join(" "),
        mergedTurnIds: [
          ...(previousFinal.mergedTurnIds ?? [previous.id]),
          turn.id
        ]
      };
      turn.resolvedFinal = merged;
      return merged;
    })();

    void turn.finalPromise.then(
      async (final) => {
        const semanticCommitGraceMs = selectFinalCommitGraceMs({
          baseMs: this.#finalCommitGraceMs,
          effectfulMs: this.#effectfulFinalCommitGraceMs,
          transcript: final.text
        });
        const commitGraceMs = final.criticalInstability
          ? Math.max(
              semanticCommitGraceMs,
              this.#criticalFinalCommitGraceMs
            )
          : semanticCommitGraceMs;
        const effectfulGrace =
          commitGraceMs > this.#finalCommitGraceMs;
        const waitAfterFinalMs = effectfulGrace
          ? commitGraceMs
          : Math.max(
              0,
              turn.endpointCommittedAtWallMs +
                commitGraceMs -
                performance.now()
            );
        if (waitAfterFinalMs > 0) {
          await new Promise((resolvePromise) => {
            setTimeout(resolvePromise, waitAfterFinalMs);
          });
        }
        this.#pendingFinals.delete(turn);
        if (this.#closed || turn.cancelled || turn.superseded) {
          return;
        }
        const plausibility = assessTranscriptPlausibility({
          text: final.text,
          audioMs: turn.totalSpeechMs
        });
        if (!plausibility.pass) {
          this.#emit("transcript.rejected", performance.now(), {
            turnId: turn.id,
            text: final.text,
            plausibility
          });
          return;
        }
        this.#emit("transcript.final", performance.now(), {
          turnId: turn.id,
          text: final.text,
          inferenceMs: final.inferenceMs,
          finalizationMs: final.finalizationMs,
          engine: final.engine ?? null,
          languageProbability: final.languageProbability,
          transcriptSource: final.transcriptSource ?? "final",
          reconciliationReason: final.reconciliationReason ?? null,
          criticalConflict: final.criticalConflict ?? null,
          criticalInstability: final.criticalInstability ?? null,
          mergedTurnIds: final.mergedTurnIds ?? null,
          endpointAtMs: atMs
        });
        turn.emitted = true;
        this.#recentFinal = turn;
      },
      (error) => {
        this.#pendingFinals.delete(turn);
        if (error.name !== "AbortError" && !this.#closed) {
          this.#emit("transcript.error", performance.now(), {
            turnId: turn.id,
            code: error.code ?? "asr_final_error",
            message: error.message
          });
        }
      }
    );
  }

  #emit(type, atMs, detail = {}) {
    if (this.#closed) {
      return;
    }
    this.#emitCallback({
      type,
      atMs: Math.round(atMs * 100) / 100,
      ...detail
    });
  }
}

export { pcmRms };
