import assert from "node:assert/strict";
import test from "node:test";

import {
  SileroVadController,
  SileroVadShadowStream
} from "../src/audio/silero-vad-shadow.mjs";

function pcm(samples, value = 0.1) {
  const buffer = Buffer.alloc(samples * 2);
  const integer = Math.round(value * 32_767);
  for (let offset = 0; offset < buffer.length; offset += 2) {
    buffer.writeInt16LE(integer, offset);
  }
  return buffer;
}

test("shadow preserva janelas contínuas e nunca emite evento de controle", async () => {
  const probabilities = [0.6, 0.7];
  const events = [];
  const stream = new SileroVadShadowStream({
    onEvent: (event) => events.push(event),
    async runWindow({ samples, state }) {
      return {
        probability: probabilities.shift(),
        state,
        context: samples.subarray(samples.length - 64)
      };
    }
  });

  for (let sequence = 0; sequence < 4; sequence += 1) {
    stream.pushFrame({
      sequence,
      sampleStart: sequence * 320,
      pcm: pcm(320)
    });
  }
  const snapshot = await stream.flush();

  assert.equal(snapshot.processedWindows, 2);
  assert.equal(snapshot.bufferedSamples, 256);
  assert.deepEqual(
    events
      .filter((event) => event.type === "vad.shadow.window")
      .map((event) => event.sampleStart),
    [0, 512]
  );
  assert.equal(
    events.filter(
      (event) => event.type === "vad.shadow.speech.started"
    ).length,
    1
  );
  assert.equal(
    events.some((event) => event.type === "user.speech.started"),
    false
  );
});

test("gap de amostras reinicia estado recorrente e fica observável", async () => {
  const events = [];
  const stream = new SileroVadShadowStream({
    onEvent: (event) => events.push(event),
    async runWindow({ samples, state }) {
      return {
        probability: 0,
        state,
        context: samples.subarray(samples.length - 64)
      };
    }
  });

  stream.pushFrame({
    sequence: 0,
    sampleStart: 0,
    pcm: pcm(320)
  });
  stream.pushFrame({
    sequence: 2,
    sampleStart: 960,
    pcm: pcm(320)
  });
  await stream.flush();

  const reset = events.find(
    (event) => event.type === "vad.shadow.reset"
  );
  assert.equal(reset.reason, "sample-gap");
  assert.equal(reset.expectedSampleStart, 320);
  assert.equal(reset.receivedSampleStart, 960);
  assert.equal(stream.snapshot.resetCount, 1);
});

test("shadow descarta inferência anterior a um gap assíncrono", async () => {
  let releaseFirst;
  let calls = 0;
  const events = [];
  const stream = new SileroVadShadowStream({
    onEvent: (event) => events.push(event),
    async runWindow({ samples, state }) {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return {
        probability: 0.99,
        state,
        context: samples.subarray(samples.length - 64)
      };
    }
  });

  stream.pushFrame({
    sequence: 0,
    sampleStart: 0,
    pcm: pcm(512)
  });
  await new Promise((resolve) => setImmediate(resolve));
  stream.pushFrame({
    sequence: 2,
    sampleStart: 960,
    pcm: pcm(1_024)
  });
  releaseFirst();
  await stream.flush();

  assert.equal(
    events.some(
      (event) =>
        event.type === "vad.shadow.window" &&
        event.sampleStart === 0
    ),
    false
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "vad.shadow.window.discarded" &&
        event.sampleStart === 0
    ),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "vad.shadow.speech.started" &&
        event.onsetSampleStart === 0
    ),
    false
  );
  assert.equal(stream.snapshot.staleResultCount, 1);
  assert.equal(stream.snapshot.resetCount, 1);
});

test("controle Silero produz início, pausa e retomada sem evento shadow", async () => {
  const probabilities = [
    0.9,
    0.9,
    ...Array.from({ length: 7 }, () => 0.1),
    0.9,
    0.9
  ];
  const controller = new SileroVadController({
    runWindow: async ({ context, state }) => ({
      probability: probabilities.shift() ?? 0.1,
      context,
      state
    })
  });
  const events = [];
  let sequence = 0;
  while (
    probabilities.length > 0 ||
    controller.snapshot.bufferedSamples >= 512
  ) {
    const frame = {
      sequence,
      sampleStart: sequence * 320,
      atMs: sequence * 20,
      pcm: Buffer.alloc(640)
    };
    events.push(...await controller.push(frame));
    sequence += 1;
    if (sequence > 40) {
      break;
    }
  }

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "user.speech.started",
      "user.speech.paused",
      "user.speech.resumed"
    ]
  );
  assert.ok(
    events.every(
      (event) => event.payload.detector === "silero-vad-v6.2"
    )
  );
  assert.equal(controller.state, "speaking");
});

test("controle preserva estado recorrente entre endpoints e o limpa em gap", async () => {
  const received = [];
  const controller = new SileroVadController({
    runWindow: async ({ context, state }) => {
      received.push({
        context: Array.from(context),
        state: Array.from(state)
      });
      return {
        probability: 0,
        context: Float32Array.from(
          { length: context.length },
          () => received.length * 3
        ),
        state: Float32Array.from(
          { length: state.length },
          () => received.length * 7
        )
      };
    }
  });

  await controller.push({
    sequence: 0,
    sampleStart: 0,
    atMs: 0,
    pcm: pcm(512)
  });
  controller.reset();
  await controller.push({
    sequence: 1,
    sampleStart: 512,
    atMs: 32,
    pcm: pcm(512)
  });
  await controller.push({
    sequence: 3,
    sampleStart: 1_536,
    atMs: 96,
    pcm: pcm(512)
  });

  assert.equal(received[1].context.every((value) => value === 3), true);
  assert.equal(received[1].state.every((value) => value === 7), true);
  assert.equal(received[2].context.every((value) => value === 0), true);
  assert.equal(received[2].state.every((value) => value === 0), true);
  assert.equal(controller.snapshot.gapResetCount, 1);
});

test("erro de inferência do controle é explícito e limpa o stream", async () => {
  let shouldFail = true;
  const controller = new SileroVadController({
    runWindow: async ({ context, state }) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("falha ORT simulada");
      }
      return {
        probability: 0,
        context,
        state
      };
    }
  });

  await assert.rejects(
    controller.push({
      sequence: 0,
      sampleStart: 0,
      atMs: 0,
      pcm: pcm(640)
    }),
    (error) =>
      error.code === "silero_vad_inference_error" &&
      /ORT/u.test(error.message)
  );
  assert.equal(controller.snapshot.inferenceErrorCount, 1);
  assert.equal(controller.snapshot.bufferedSamples, 0);
  assert.equal(controller.snapshot.processedWindows, 0);

  await controller.push({
    sequence: 1,
    sampleStart: 640,
    atMs: 40,
    pcm: pcm(512)
  });
  assert.equal(controller.snapshot.processedWindows, 1);
  assert.equal(controller.snapshot.inferenceErrorCount, 1);
});

test("saída não finita nunca avança controller ou shadow", async () => {
  const invalid = async ({ context, state }) => ({
    probability: Number.NaN,
    context,
    state
  });
  const controller = new SileroVadController({ runWindow: invalid });
  await assert.rejects(
    controller.push({
      sequence: 0,
      sampleStart: 0,
      atMs: 0,
      pcm: pcm(512)
    }),
    (error) => error.code === "silero_vad_invalid_output"
  );
  assert.equal(controller.snapshot.processedWindows, 0);
  assert.equal(controller.snapshot.lastProcessedSampleEnd, null);
  assert.equal(controller.snapshot.inferenceErrorCount, 1);

  const events = [];
  const shadow = new SileroVadShadowStream({
    runWindow: invalid,
    onEvent: (event) => events.push(event)
  });
  shadow.pushFrame({
    sequence: 0,
    sampleStart: 0,
    pcm: pcm(512)
  });
  await shadow.flush();
  assert.equal(shadow.snapshot.processedWindows, 0);
  assert.equal(shadow.snapshot.lastProcessedSampleEnd, null);
  assert.equal(shadow.snapshot.resetCount, 1);
  assert.equal(
    events.some(
      (event) =>
        event.type === "vad.shadow.reset" &&
        event.code === "silero_vad_invalid_output"
    ),
    true
  );
});
