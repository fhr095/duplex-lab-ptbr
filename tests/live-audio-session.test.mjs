import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as waitImmediate } from "node:timers/promises";
import { setTimeout as wait } from "node:timers/promises";

import {
  LiveAudioSession,
  pcmRms
} from "../src/audio/live-audio-session.mjs";

function pcm(rms, durationMs = 20) {
  const value = Math.round(rms * 32_767);
  const buffer = Buffer.alloc(16_000 * durationMs / 1_000 * 2);
  for (let offset = 0; offset < buffer.length; offset += 2) {
    buffer.writeInt16LE(value, offset);
  }
  return buffer;
}

async function waitUntil(predicate, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await waitImmediate();
  }
  throw new Error("condição de teste não foi atingida");
}

class FakeAsrRuntime {
  constructor(partialText = "pode continuar") {
    this.partialText = partialText;
  }

  sessions = [];

  createSession(options) {
    const partialText = this.partialText;
    const state = {
      buffers: [],
      cancelled: null,
      finishCount: 0,
      options
    };
    const session = {
      pushPcm(value) {
        state.buffers.push(value);
        if (state.buffers.length === 24) {
          options.onEvent({
            type: "partial",
            text: partialText,
            committedText: "pode",
            unstableText: "continuar",
            inferenceMs: 15,
            audioEndMs: 480
          });
        }
      },
      async finish() {
        state.finishCount += 1;
        return {
          text: "pode continuar",
          inferenceMs: 20,
          finalizationMs: 20,
          languageProbability: 1
        };
      },
      cancel(reason) {
        state.cancelled = reason;
      }
    };
    state.session = session;
    this.sessions.push(state);
    return session;
  }
}

class ControlledPrefinalRuntime {
  sessions = [];

  createSession(options) {
    const state = {
      activePreparations: 0,
      invalidations: 0,
      maximumActivePreparations: 0,
      options,
      preparations: 0,
      partialResumes: 0,
      partialSuspensions: 0
    };
    const session = {
      pushPcm() {},
      emitPartial(text, atMs = performance.now()) {
        options.onEvent({
          type: "partial",
          atMs,
          text,
          committedText: text,
          unstableText: "",
          inferenceMs: 700,
          audioEndMs: 800
        });
      },
      prepareFinal() {
        state.preparations += 1;
        state.activePreparations += 1;
        state.maximumActivePreparations = Math.max(
          state.maximumActivePreparations,
          state.activePreparations
        );
        return new Promise(() => {});
      },
      suspendPartials() {
        state.partialSuspensions += 1;
        return true;
      },
      resumePartials() {
        state.partialResumes += 1;
        return true;
      },
      invalidatePreparedFinal() {
        if (state.activePreparations === 0) {
          return false;
        }
        state.activePreparations -= 1;
        state.invalidations += 1;
        return true;
      },
      async finish() {
        return {
          text: "fala completa",
          inferenceMs: 1_100,
          finalizationMs: 1_100,
          languageProbability: 1
        };
      },
      cancel() {
        state.activePreparations = 0;
      }
    };
    state.session = session;
    this.sessions.push(state);
    return session;
  }
}

function pushSeries(live, values, startingSequence = 0) {
  let sampleStart = startingSequence * 320;
  values.forEach((rms, index) => {
    live.pushFrame({
      sequence: startingSequence + index,
      sampleStart,
      pcm: pcm(rms)
    });
    sampleStart += 320;
  });
}

test("RMS PCM16 reflete energia acústica", () => {
  assert.ok(Math.abs(pcmRms(pcm(0.25)) - 0.25) < 0.001);
});

test("sessão aguarda VAD assíncrono sem perder o frame de onset", async () => {
  const runtime = new FakeAsrRuntime();
  const events = [];
  const vad = {
    lastProbability: 0.99,
    noiseFloor: 0,
    state: "idle",
    thresholds() {
      return {
        domain: "speech-probability",
        on: 0.5,
        off: 0.35
      };
    },
    async push(frame) {
      this.state = "speaking";
      return [{
        type: "user.speech.started",
        atMs: frame.atMs,
        payload: {
          detector: "silero-vad-v6.2",
          probability: 0.99,
          threshold: 0.5
        }
      }];
    },
    reset() {
      this.state = "idle";
    }
  };
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    vad,
    onEvent: (event) => events.push(event)
  });

  await live.pushFrame({
    sequence: 0,
    sampleStart: 0,
    pcm: pcm(0.001)
  });

  assert.equal(runtime.sessions.length, 1);
  assert.equal(runtime.sessions[0].buffers.length, 1);
  assert.equal(
    events.find(
      (event) => event.type === "user.speech.started"
    ).detector,
    "silero-vad-v6.2"
  );
});

test("fechamento durante VAD assíncrono não ressuscita turno ou ASR", async () => {
  let resolveVad;
  const runtime = new FakeAsrRuntime();
  const events = [];
  const vad = {
    lastProbability: 0,
    noiseFloor: 0,
    state: "idle",
    thresholds() {
      return { domain: "speech-probability", on: 0.5, off: 0.35 };
    },
    push(frame) {
      return new Promise((resolve) => {
        resolveVad = () => resolve([{
          type: "user.speech.started",
          atMs: frame.atMs,
          payload: {
            detector: "silero-vad-v6.2",
            probability: 0.99,
            threshold: 0.5
          }
        }]);
      });
    },
    reset() {}
  };
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    vad,
    onEvent: (event) => events.push(event)
  });

  const pending = live.pushFrame({
    sequence: 0,
    sampleStart: 0,
    pcm: pcm(0.001)
  });
  live.close("test-close");
  resolveVad();
  await pending;

  assert.equal(live.closed, true);
  assert.equal(live.activeTurnId, null);
  assert.equal(runtime.sessions.length, 0);
  assert.equal(events.length, 0);
});

test("vertical detecta fala, preserva pre-roll e finaliza após silêncio", async () => {
  const runtime = new FakeAsrRuntime();
  const events = [];
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    endpointConfig: {
      completeSilenceMs: 280,
      noTranscriptSilenceMs: 280,
      shortSpeechSilenceMs: 280,
      minimumSilenceMs: 280
    },
    onEvent: (event) => events.push(event)
  });

  pushSeries(live, [
    ...Array(5).fill(0.002),
    ...Array(20).fill(0.04),
    ...Array(24).fill(0.002)
  ]);
  await waitImmediate();

  assert.equal(runtime.sessions.length, 1);
  assert.ok(runtime.sessions[0].buffers.length > 20);
  assert.equal(runtime.sessions[0].finishCount, 1);
  assert.deepEqual(
    events.filter((event) => [
      "user.speech.started",
      "user.speech.paused",
      "endpoint.committed",
      "transcript.final"
    ].includes(event.type)).map((event) => event.type),
    [
      "user.speech.started",
      "user.speech.paused",
      "endpoint.committed",
      "transcript.final"
    ]
  );
});

test("nova fala suprime final antigo e o preserva para possível continuação", async () => {
  let resolveFinal;
  const runtime = new FakeAsrRuntime();
  const originalCreate = runtime.createSession.bind(runtime);
  runtime.createSession = (options) => {
    const session = originalCreate(options);
    session.finish = () => new Promise((resolve) => {
      resolveFinal = resolve;
    });
    return session;
  };
  const events = [];
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    endpointConfig: {
      completeSilenceMs: 280,
      noTranscriptSilenceMs: 280,
      shortSpeechSilenceMs: 280,
      minimumSilenceMs: 280
    },
    onEvent: (event) => events.push(event)
  });

  pushSeries(live, [
    ...Array(4).fill(0.04),
    ...Array(24).fill(0.002),
    ...Array(4).fill(0.04)
  ]);
  resolveFinal?.({
    text: "obsoleto",
    inferenceMs: 1,
    finalizationMs: 1,
    languageProbability: 1
  });
  await waitImmediate();

  assert.equal(runtime.sessions[0].cancelled, null);
  assert.equal(
    events.some((event) => event.type === "transcript.merging"),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "transcript.final" && event.text === "obsoleto"
    ),
    false
  );
});

test("recompõe correção que atravessa um falso endpoint", async () => {
  class MergeRuntime extends FakeAsrRuntime {
    createSession(options) {
      const index = this.sessions.length;
      const session = super.createSession(options);
      session.finish = async () => ({
        text: index === 0
          ? "Marque para sexta."
          : "Não, na verdade, para domingo.",
        inferenceMs: 20,
        finalizationMs: 20,
        languageProbability: 1
      });
      return session;
    }
  }

  const runtime = new MergeRuntime();
  const events = [];
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    endpointConfig: {
      completeSilenceMs: 280,
      noTranscriptSilenceMs: 280,
      shortSpeechSilenceMs: 280,
      minimumSilenceMs: 280
    },
    onEvent: (event) => events.push(event)
  });

  pushSeries(live, [
    ...Array(50).fill(0.04),
    ...Array(24).fill(0.002),
    ...Array(50).fill(0.04),
    ...Array(24).fill(0.002)
  ]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await waitImmediate();
  }

  const finals = events.filter(
    (event) => event.type === "transcript.final"
  );
  assert.equal(
    finals.length,
    1,
    JSON.stringify(events.map((event) => ({
      type: event.type,
      turnId: event.turnId,
      text: event.text,
      reasons: event.plausibility?.reasons
    })))
  );
  assert.equal(
    finals[0].text,
    "Marque para sexta. Não, na verdade, para domingo."
  );
  assert.deepEqual(finals[0].mergedTurnIds, ["turn-1", "turn-2"]);
});

test("graça de commit absorve continuação antes de ela virar resposta", async () => {
  class FastRuntime extends FakeAsrRuntime {
    createSession(options) {
      const index = this.sessions.length;
      const session = super.createSession(options);
      session.finish = async () => ({
        text: index === 0 ? "primeira parte" : "segunda parte",
        engine: "parakeet",
        inferenceMs: 5,
        finalizationMs: 5,
        languageProbability: null
      });
      return session;
    }
  }

  const runtime = new FastRuntime();
  const events = [];
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    endpointConfig: {
      completeSilenceMs: 280,
      noTranscriptSilenceMs: 280,
      shortSpeechSilenceMs: 280,
      minimumSilenceMs: 280
    },
    finalCommitGraceMs: 40,
    onEvent: (event) => events.push(event)
  });

  const first = [
    ...Array(30).fill(0.04),
    ...Array(24).fill(0.002)
  ];
  pushSeries(live, first);
  await waitImmediate();
  assert.equal(
    events.filter((event) => event.type === "transcript.final").length,
    0
  );

  const second = [
    ...Array(30).fill(0.04),
    ...Array(24).fill(0.002)
  ];
  pushSeries(live, second, first.length);
  await wait(70);

  const finals = events.filter(
    (event) => event.type === "transcript.final"
  );
  assert.equal(finals.length, 1);
  assert.equal(finals[0].text, "primeira parte segunda parte");
  assert.deepEqual(finals[0].mergedTurnIds, ["turn-1", "turn-2"]);
});

test("graça de ação começa depois que o ASR final fica disponível", async () => {
  class SlowEffectfulRuntime extends FakeAsrRuntime {
    createSession(options) {
      const session = super.createSession(options);
      session.finish = async () => {
        await wait(60);
        return {
          text: "Marque para sexta.",
          engine: "parakeet",
          inferenceMs: 60,
          finalizationMs: 60,
          languageProbability: null
        };
      };
      return session;
    }
  }

  const events = [];
  const live = new LiveAudioSession({
    asrRuntime: new SlowEffectfulRuntime("Marque para sexta."),
    effectfulFinalCommitGraceMs: 50,
    endpointConfig: {
      completeSilenceMs: 280,
      minimumSilenceMs: 280
    },
    finalCommitGraceMs: 0,
    onEvent: (event) => events.push(event)
  });

  pushSeries(live, [
    ...Array(30).fill(0.04),
    ...Array(24).fill(0.002)
  ]);
  await wait(75);
  assert.equal(
    events.filter((event) => event.type === "transcript.final").length,
    0
  );
  await wait(50);
  assert.equal(
    events.filter((event) => event.type === "transcript.final").length,
    1
  );
});

test("sugere um único backchannel só em pausa de fala incompleta", () => {
  const runtime = new FakeAsrRuntime("eu queria mas");
  const events = [];
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    backchannelSilenceMs: 380,
    minimumBackchannelSpeechMs: 300,
    onEvent: (event) => events.push(event)
  });

  pushSeries(live, [
    ...Array(30).fill(0.04),
    ...Array(40).fill(0.002),
    ...Array(2).fill(0.04),
    ...Array(60).fill(0.002)
  ]);

  const backchannels = events.filter(
    (event) => event.type === "assistant.backchannel.suggested"
  );
  assert.equal(backchannels.length, 1);
  assert.equal(backchannels[0].text, "Aham.");
  assert.equal(
    events.some((event) => event.type === "endpoint.committed"),
    true
  );
});

test("parcial completa tardia usa a janela de pausa para antecipar a final", () => {
  const runtime = new ControlledPrefinalRuntime();
  const events = [];
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    onEvent: (event) => events.push(event)
  });

  pushSeries(live, [
    ...Array(30).fill(0.04),
    ...Array(10).fill(0.002)
  ]);
  const state = runtime.sessions[0];
  assert.equal(state.preparations, 0);

  state.session.emitPartial("agora a frase está completa");
  state.session.emitPartial("agora a frase está completa mesmo");

  assert.equal(state.preparations, 1);
  assert.equal(state.partialSuspensions, 1);
  const partialIndex = events.findIndex(
    (event) => event.type === "transcript.partial"
  );
  const prefinalIndex = events.findIndex(
    (event) => event.type === "endpoint.prefinal.started"
  );
  assert.ok(partialIndex >= 0);
  assert.ok(prefinalIndex > partialIndex);
  assert.equal(
    events[prefinalIndex].trigger,
    "partial-after-pause"
  );
  live.close();
});

test("retomada invalida prefinal tardia sem acumular backlog", () => {
  const runtime = new ControlledPrefinalRuntime();
  const events = [];
  const live = new LiveAudioSession({
    asrRuntime: runtime,
    onEvent: (event) => events.push(event)
  });

  pushSeries(live, [
    ...Array(30).fill(0.04),
    ...Array(10).fill(0.002)
  ]);
  const state = runtime.sessions[0];
  state.session.emitPartial("primeira versão completa");
  assert.equal(state.activePreparations, 1);

  pushSeries(live, Array(2).fill(0.04), 40);
  assert.equal(state.invalidations, 1);
  assert.equal(state.activePreparations, 0);
  assert.equal(state.partialResumes, 1);

  pushSeries(live, Array(10).fill(0.002), 42);
  state.session.emitPartial("segunda versão completa");

  assert.equal(state.preparations, 2);
  assert.equal(state.maximumActivePreparations, 1);
  assert.equal(
    events.filter(
      (event) => event.type === "endpoint.prefinal.cancelled"
    ).length,
    1
  );
  assert.equal(
    events.filter(
      (event) => event.type === "endpoint.prefinal.started"
    ).length,
    2
  );
  live.close();
});
