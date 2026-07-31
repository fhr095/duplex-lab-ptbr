import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { WebSocket } from "ws";

import {
  attachAudioWebSocket
} from "../src/audio/audio-websocket.mjs";
import { encodePcmFrame } from "../web/pcm-wire.mjs";

function messageCollector(socket) {
  const messages = [];
  const waiters = new Set();
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString("utf8"));
    messages.push(message);
    for (const waiter of waiters) {
      if (waiter.predicate(message)) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(message);
      }
    }
  });
  return {
    messages,
    waitFor(predicate, timeoutMs = 2_000) {
      const existing = messages.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error("mensagem WebSocket não chegou"));
          }, timeoutMs)
        };
        waiters.add(waiter);
      });
    }
  };
}

test("transporte aceita retomada e limita telemetria pesada", async (t) => {
  const server = createServer();
  const audio = attachAudioWebSocket({
    server,
    asrRuntime: {
      createSession() {
        throw new Error("silêncio não deveria iniciar ASR");
      }
    },
    telemetryIntervalFrames: 5
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/api/audio`
  );
  const collector = messageCollector(socket);

  t.after(async () => {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
      await new Promise((resolve) => socket.once("close", resolve));
    }
    await audio.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const ready = await collector.waitFor(
    (message) => message.type === "audio.ready"
  );
  assert.equal(ready.telemetryIntervalFrames, 5);
  socket.send(JSON.stringify({
    type: "audio.start",
    sampleRate: 16_000,
    encoding: "pcm_s16le"
  }));
  await collector.waitFor(
    (message) => message.type === "audio.started"
  );

  const initialSequence = 100;
  const initialSampleStart = 32_000;
  const samplesPerFrame = 320;
  for (let offset = 0; offset < 12; offset += 1) {
    socket.send(encodePcmFrame({
      sequence: initialSequence + offset,
      sampleStart: initialSampleStart + offset * samplesPerFrame,
      pcm16: new Int16Array(samplesPerFrame)
    }));
  }
  const lastSequence = initialSequence + 11;
  const lastSampleEnd = initialSampleStart + 12 * samplesPerFrame;
  socket.send(JSON.stringify({
    type: "audio.flush",
    requestId: "resume-watermark",
    expectedSequence: lastSequence,
    expectedSampleEnd: lastSampleEnd
  }));

  const flushed = await collector.waitFor(
    (message) =>
      message.type === "audio.flushed" &&
      message.requestId === "resume-watermark"
  );
  assert.equal(flushed.pipeline.processedFrames, 12);
  assert.equal(flushed.pipeline.overflowCount, 0);
  assert.equal(
    flushed.watermark.firstReceivedSampleStart,
    initialSampleStart
  );
  assert.equal(flushed.watermark.receivedSequence, lastSequence);
  assert.equal(flushed.watermark.receivedSampleEnd, lastSampleEnd);

  const periodic = collector.messages.filter(
    (message) => message.type === "audio.pipeline.telemetry"
  );
  assert.deepEqual(
    periodic.map((message) => message.snapshot.processedFrames),
    [5, 10]
  );
});
