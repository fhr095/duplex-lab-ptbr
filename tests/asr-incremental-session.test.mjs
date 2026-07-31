import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setImmediate as waitImmediate } from "node:timers/promises";
import test from "node:test";

import {
  IncrementalAsrSession,
  PersistentIncrementalAsr
} from "../src/asr/incremental-session.mjs";

function pcmFor(ms, sampleRate = 16_000) {
  return Buffer.alloc(Math.round(sampleRate * (ms / 1_000)) * 2);
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

class FakeWorker {
  constructor(responder) {
    this.calls = [];
    this.closed = 0;
    this.responder = responder;
    this.started = 0;
  }

  async start() {
    this.started += 1;
    return { type: "ready", model: "fake" };
  }

  transcribe(request, options) {
    this.calls.push({ request, signal: options.signal });
    return this.responder(request, options, this.calls.length - 1);
  }

  async close() {
    this.closed += 1;
  }
}

test("coalesce áudio acumulado enquanto uma parcial está em voo", async () => {
  let releaseFirst;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const worker = new FakeWorker(async (request, _options, index) => {
    if (index === 0) {
      return first;
    }
    return {
      text: "fala parcial atualizada",
      elapsedMs: 20,
      language: "pt"
    };
  });
  const session = new IncrementalAsrSession({
    id: "coalesce",
    worker
  });

  session.pushPcm(pcmFor(480));
  session.pushPcm(pcmFor(160));
  session.pushPcm(pcmFor(160));
  session.pushPcm(pcmFor(160));
  assert.equal(worker.calls.length, 1);

  releaseFirst({
    text: "fala parcial",
    elapsedMs: 20,
    language: "pt"
  });
  await waitUntil(() => worker.calls.length === 2);

  assert.equal(worker.calls[1].request.mode, "partial");
  assert.equal(worker.calls[1].request.pcm.length, pcmFor(960).length);
});

test("pausa suspende parciais redundantes e retomada coalesce o áudio", async () => {
  let releaseFirst;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const worker = new FakeWorker(async (_request, _options, index) => {
    if (index === 0) {
      return first;
    }
    return {
      text: "fala retomada",
      elapsedMs: 20,
      language: "pt"
    };
  });
  const session = new IncrementalAsrSession({
    id: "pause-coalescing",
    worker
  });

  session.pushPcm(pcmFor(480));
  assert.equal(session.suspendPartials(), true);
  session.pushPcm(pcmFor(320));
  releaseFirst({
    text: "fala antes da pausa",
    elapsedMs: 20,
    language: "pt"
  });
  await waitImmediate();
  assert.equal(worker.calls.length, 1);

  assert.equal(session.resumePartials(), true);
  await waitUntil(() => worker.calls.length === 2);
  assert.equal(worker.calls[1].request.pcm.length, pcmFor(800).length);
  assert.equal(session.resumePartials(), false);
});

test("final prioritária não espera uma parcial nativa obsoleta", async () => {
  let releaseStale;
  const stale = new Promise((resolve) => {
    releaseStale = resolve;
  });
  const worker = new FakeWorker(async (request) => {
    if (request.mode === "partial") {
      return stale;
    }
    return {
      text: "texto final correto",
      elapsedMs: 40,
      language: "pt",
      languageProbability: 1,
      segments: []
    };
  });
  const events = [];
  const session = new IncrementalAsrSession({
    id: "priority",
    worker,
    onEvent: (event) => events.push(event)
  });

  session.pushPcm(pcmFor(480));
  const final = await session.finish();

  assert.deepEqual(
    worker.calls.map((call) => call.request.mode),
    ["partial", "final"]
  );
  assert.equal(worker.calls[0].signal.aborted, true);
  assert.equal(final.text, "texto final correto");

  releaseStale({
    text: "resultado velho",
    elapsedMs: 400,
    language: "pt"
  });
  await waitImmediate();
  assert.equal(
    events.some((event) => event.text === "resultado velho"),
    false
  );
});

test("final especulativa pronta reduz espera sem publicar antes do endpoint", async () => {
  const partialWorker = new FakeWorker(async () => ({
    text: "pode seguir",
    elapsedMs: 10,
    language: "pt"
  }));
  const finalWorker = new FakeWorker(async () => ({
    text: "pode seguir",
    elapsedMs: 30,
    language: "pt"
  }));
  const events = [];
  const session = new IncrementalAsrSession({
    id: "prepared",
    partialWorker,
    finalWorker,
    onEvent: (event) => events.push(event)
  });

  session.pushPcm(pcmFor(480));
  await session.prepareFinal();
  assert.equal(events.some((event) => event.type === "final"), false);

  const final = await session.finish();
  assert.equal(final.text, "pode seguir");
  assert.equal(finalWorker.calls.length, 1);
  assert.equal(finalWorker.calls[0].request.sessionId, "prepared:prepared-final");
  assert.equal(final.finalSource, "prepared");
  assert.equal(final.preparedReadyBeforeFinish, true);
});

test("prefinal acústica recorta PCM no limite exato e registra sua identidade", async () => {
  const finalWorker = new FakeWorker(async () => ({
    text: "limite acústico",
    elapsedMs: 30,
    language: "pt"
  }));
  const partialWorker = new FakeWorker(async () => ({
    text: "parcial",
    elapsedMs: 10,
    language: "pt"
  }));
  let now = 100;
  const session = new IncrementalAsrSession({
    id: "fixed-boundary",
    partialWorker,
    finalWorker,
    initialAudioMs: 10_000,
    now: () => now++
  });
  const first = Buffer.alloc(640, 0x11);
  const second = Buffer.alloc(640, 0x22);
  const third = Buffer.alloc(640, 0x33);
  session.pushPcm(first, { sampleStart: 1_000 });
  session.pushPcm(second, { sampleStart: 1_320 });
  session.pushPcm(third, { sampleStart: 1_640 });

  await session.prepareFinal({
    sampleEnd: 1_480,
    trigger: "speech-paused"
  });
  const expectedPcm = Buffer.concat([
    first,
    second.subarray(0, 320)
  ]);
  assert.deepEqual(finalWorker.calls[0].request.pcm, expectedPcm);
  assert.deepEqual(session.preparedFinalSnapshot, {
    sha256: createHash("sha256").update(expectedPcm).digest("hex"),
    sampleStart: 1_000,
    sampleEnd: 1_480,
    sampleCount: 480,
    requestedSampleEnd: 1_480,
    availableSampleStart: 1_000,
    availableSampleEnd: 1_960,
    availableSampleCount: 960,
    tailExcludedSamples: 480,
    gapSamples: 0,
    contiguous: true,
    boundaryMatched: true,
    trigger: "speech-paused"
  });

  const final = await session.finish();
  assert.equal(final.finalSource, "prepared");
  assert.deepEqual(final.audioSnapshot, {
    sha256: createHash("sha256").update(expectedPcm).digest("hex"),
    sampleStart: 1_000,
    sampleEnd: 1_480,
    sampleCount: 480,
    requestedSampleEnd: 1_480,
    availableSampleStart: 1_000,
    availableSampleEnd: 1_960,
    availableSampleCount: 960,
    tailExcludedSamples: 480,
    gapSamples: 0,
    contiguous: true,
    boundaryMatched: true,
    trigger: "speech-paused"
  });
  assert.deepEqual(session.finalPcmSnapshot, expectedPcm);
});

test("retomada invalida final especulativa e confirma o áudio completo", async () => {
  const partialWorker = new FakeWorker(async () => ({
    text: "primeira parte",
    elapsedMs: 10,
    language: "pt"
  }));
  const finalWorker = new FakeWorker(async (request) => ({
    text: request.sessionId.endsWith(":prepared-final")
      ? "primeira parte"
      : "primeira parte e continuação",
    elapsedMs: 30,
    language: "pt"
  }));
  const session = new IncrementalAsrSession({
    id: "resumed",
    partialWorker,
    finalWorker
  });

  session.pushPcm(pcmFor(480));
  await session.prepareFinal();
  assert.equal(session.invalidatePreparedFinal(), true);
  session.pushPcm(pcmFor(320));
  const final = await session.finish();

  assert.equal(final.text, "primeira parte e continuação");
  assert.equal(finalWorker.calls.length, 2);
  assert.equal(final.finalSource, "fresh");
  assert.equal(final.audioSnapshot.sampleCount, pcmFor(800).length / 2);
});

test("cancelamento invalida saída atrasada sem encerrar o worker", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const worker = new FakeWorker(() => pending);
  const events = [];
  const session = new IncrementalAsrSession({
    id: "cancel",
    worker,
    onEvent: (event) => events.push(event)
  });

  session.pushPcm(pcmFor(480));
  session.cancel("barge-in");
  release({
    text: "não pode aparecer",
    elapsedMs: 50,
    language: "pt"
  });
  await waitImmediate();

  assert.equal(session.state, "cancelled");
  assert.equal(worker.calls[0].signal.aborted, true);
  assert.deepEqual(events.map((event) => event.type), ["cancelled"]);
});

test("runtime aquece uma vez e cancela sessões ao fechar", async () => {
  const worker = new FakeWorker(async () => ({
    text: "",
    elapsedMs: 0,
    language: "pt"
  }));
  const runtime = new PersistentIncrementalAsr({ worker });
  await runtime.start();
  const session = runtime.createSession({ id: "active" });

  await runtime.close();

  assert.equal(worker.started, 1);
  assert.equal(worker.closed, 1);
  assert.equal(session.state, "cancelled");
});

test("runtime pode separar pistas quente parcial e final", async () => {
  const partialWorker = new FakeWorker(async () => ({
    text: "parcial",
    elapsedMs: 10,
    language: "pt"
  }));
  const finalWorker = new FakeWorker(async () => ({
    text: "final",
    elapsedMs: 20,
    language: "pt"
  }));
  const runtime = new PersistentIncrementalAsr({
    partialWorker,
    finalWorker
  });
  await runtime.start();
  const session = runtime.createSession({ id: "dual-lane" });
  session.pushPcm(pcmFor(480));
  await waitUntil(() => partialWorker.calls.length === 1);
  await session.finish();
  await runtime.close();

  assert.equal(partialWorker.started, 1);
  assert.equal(finalWorker.started, 1);
  assert.equal(partialWorker.calls[0].request.mode, "partial");
  assert.equal(finalWorker.calls[0].request.mode, "final");
  assert.equal(partialWorker.closed, 1);
  assert.equal(finalWorker.closed, 1);
});

test("recusa formatos que quebrariam o contrato PCM16 de 16 kHz", () => {
  const worker = new FakeWorker(async () => ({}));
  const session = new IncrementalAsrSession({ worker });

  assert.throws(() => session.pushPcm(new Uint8Array(2)), /Buffer/u);
  assert.throws(() => session.pushPcm(Buffer.alloc(3)), /alinhado/u);
});
