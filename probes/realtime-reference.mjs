// B2 v2 — Realtime sob o protocolo PT-BR (contrato confirmatório).
//
// Correções sobre o screening v1: (1) todo chunk de áudio é vinculado ao
// response_id ativo; (2) responded = response.done DO MESMO id; (3) matriz
// de detecção de turno (semantic auto | semantic high | server_vad);
// (4) repetições; (5) barge-in/backchannel enviados DURANTE a geração
// (delta fresco <300ms), medindo cancelamento de geração via eventos.
// Estímulos versionados em probes/data/stimuli.
//
// Uso: node probes/realtime-reference.mjs <modelo> <vad>
//   vad ∈ semantic | semantic-high | server

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

import { loadEnvFile } from "../src/config/load-env.mjs";
import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";

await loadEnvFile();
const MODEL = process.argv[2] ?? "gpt-realtime-2.1-mini";
const VAD = process.argv[3] ?? "semantic";
const STIM = resolve(import.meta.dirname, "data/stimuli");
const OUT = resolve(
  import.meta.dirname,
  `../notes/evidencia/realtime-v2/${MODEL}-${VAD}`
);
await mkdir(OUT, { recursive: true });

const RATE = 24_000;
const RMS_FLOOR = 0.012;
const PRICE = MODEL.includes("mini")
  ? { in: 10, out: 20 }
  : { in: 32, out: 64 };
let spentUsd = 0;
const USD_CEILING = 2.0;

const TURN_DETECTION = {
  semantic: { type: "semantic_vad" },
  "semantic-high": { type: "semantic_vad", eagerness: "high" },
  server: { type: "server_vad", silence_duration_ms: 500 }
}[VAD];

function resample24k(pcm, from) {
  if (from === RATE) {
    return pcm;
  }
  const n = pcm.length / 2;
  const out = Math.floor((n * RATE) / from);
  const buffer = Buffer.alloc(out * 2);
  for (let i = 0; i < out; i += 1) {
    const s = (i * from) / RATE;
    const lo = Math.floor(s);
    const hi = Math.min(n - 1, lo + 1);
    const f = s - lo;
    buffer.writeInt16LE(Math.round(
      pcm.readInt16LE(lo * 2) * (1 - f) + pcm.readInt16LE(hi * 2) * f
    ), i * 2);
  }
  return buffer;
}

async function stimulus(name) {
  const decoded = decodeWaveToPcm16(await readFile(`${STIM}/${name}`));
  return resample24k(decoded.pcm, decoded.sampleRate);
}

function rmsOf(buffer) {
  let sum = 0;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    const value = buffer.readInt16LE(offset) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / (buffer.length / 2));
}

class Session {
  events = [];
  chunks = [];
  currentResponseId = null;
  #socket;

  constructor() {
    this.#socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${MODEL}`,
      { headers: { authorization:
          `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    this.ready = new Promise((resolvePromise, rejectPromise) => {
      this.#socket.once("open", resolvePromise);
      this.#socket.once("error", rejectPromise);
    });
    this.#socket.on("message", (data) => {
      let event;
      try {
        event = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }
      event.atMs = performance.now();
      if (event.type === "response.created") {
        this.currentResponseId = event.response?.id ?? null;
      }
      if (event.type?.endsWith("audio.delta") && event.delta) {
        const pcm = Buffer.from(event.delta, "base64");
        this.chunks.push({
          atMs: event.atMs,
          pcm,
          rms: rmsOf(pcm),
          responseId: event.response_id ?? this.currentResponseId
        });
        event.delta = `<áudio ${pcm.length}B>`;
      }
      if (event.type === "response.done") {
        const usage = event.response?.usage;
        spentUsd += ((usage?.input_token_details?.audio_tokens ?? 0) *
          PRICE.in + (usage?.output_token_details?.audio_tokens ?? 0) *
          PRICE.out) / 1_000_000;
      }
      this.events.push(event);
    });
  }

  send(object) {
    this.#socket.send(JSON.stringify(object));
  }

  async open() {
    await this.ready;
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: "Você é um assistente de voz em português " +
          "brasileiro. Responda sempre em pt-BR, com uma ou duas " +
          "frases curtas.",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: RATE },
            turn_detection: TURN_DETECTION
          },
          output: { format: { type: "audio/pcm", rate: RATE } }
        }
      }
    });
    await delay(500);
  }

  async stream(pcm) {
    const bytesPerChunk = (RATE * 40 * 2) / 1000;
    const startedAt = performance.now();
    for (let offset = 0; offset < pcm.length; offset += bytesPerChunk) {
      await delay(Math.max(
        0, startedAt + (offset / 2 / RATE) * 1000 - performance.now()
      ));
      this.send({
        type: "input_audio_buffer.append",
        audio: pcm.subarray(
          offset, Math.min(pcm.length, offset + bytesPerChunk)
        ).toString("base64")
      });
    }
    return performance.now();
  }

  // Cursor persistente: cada waitFor consome a partir do último evento já
  // examinado — um response.done antigo nunca satisfaz um probe posterior.
  cursor = 0;

  async waitFor(predicate, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      while (this.cursor < this.events.length) {
        const event = this.events[this.cursor++];
        if (predicate(event)) {
          return event;
        }
      }
      await delay(20);
    }
    return null;
  }

  async close(name) {
    await writeFile(
      resolve(OUT, `${name}.events.jsonl`),
      this.events.map((event) => JSON.stringify(event)).join("\n")
    );
    const pcm = Buffer.concat(this.chunks.map((chunk) => chunk.pcm));
    if (pcm.length) {
      const header = Buffer.alloc(44);
      header.write("RIFF", 0);
      header.writeUInt32LE(36 + pcm.length, 4);
      header.write("WAVEfmt ", 8);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(RATE, 24);
      header.writeUInt32LE(RATE * 2, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write("data", 36);
      header.writeUInt32LE(pcm.length, 40);
      await writeFile(
        resolve(OUT, `${name}.wav`), Buffer.concat([header, pcm])
      );
    }
    this.#socket.close();
    await delay(150);
  }
}

function guardBudget() {
  if (spentUsd >= USD_CEILING) {
    throw new Error(`teto: US$ ${spentUsd.toFixed(3)}`);
  }
}

const silence = (ms) => Buffer.alloc(((RATE * ms * 2) / 1000) & ~1);
const report = { model: MODEL, vad: VAD, latency: [], dynamics: {} };

// ---- Latência: sessão NOVA por turno; IDs únicos e latência não nula
// exigidos para validade ----
const seenResponseIds = new Set();
for (let rep = 0; rep < 2; rep += 1) {
  for (const [name, file] of [
    ["saudacao", "fala-saudacao.wav"],
    ["pergunta", "fala-pergunta.wav"],
    ["correcao", "fala-correcao.wav"],
    ["continuidade", "fala-continuidade.wav"]
  ]) {
    guardBudget();
    const session = new Session();
    await session.open();
    const end = await session.stream(await stimulus(file));
    await session.stream(silence(2_600));
    const done = await session.waitFor(
      (event) => event.type === "response.done" && event.response?.id,
      20_000
    );
    const responseId = done?.response?.id ?? null;
    const first = responseId === null
      ? null
      : session.chunks.find(
          (chunk) => chunk.responseId === responseId &&
            chunk.atMs >= end && chunk.rms > RMS_FLOOR
        );
    const latencyMs = first ? Math.round(first.atMs - end) : null;
    const unique = responseId !== null &&
      !seenResponseIds.has(responseId);
    if (responseId) {
      seenResponseIds.add(responseId);
    }
    report.latency.push({
      rep,
      turn: name,
      responseId,
      responded: Boolean(done),
      endToNonSilentMs: latencyMs,
      valid: Boolean(done) && unique && latencyMs !== null
    });
    await session.close(`latencia-rep${rep}-${name}`);
  }
}

// ---- Dinâmica: sessão NOVA por probe; só vale com geração ativa ----
{
  guardBudget();
  const probeDynamics = async (label, interruptFile) => {
    const session = new Session();
    await session.open();
    const before = session.currentResponseId;
    await session.stream(await stimulus("fala-explica.wav"));
    await session.stream(silence(2_600));
    const firstDelta = await session.waitFor(
      (event) => event.type?.endsWith("audio.delta") &&
        (event.response_id ?? session.currentResponseId) !== before,
      20_000
    );
    if (!firstDelta) {
      await session.close(`dinamica-${label}`);
      return { error: "resposta não iniciou", valid: false };
    }
    const targetId = firstDelta.response_id ?? session.currentResponseId;
    // envia o interrupt imediatamente (geração em andamento)
    const lastDeltaAge = () => {
      const last = session.chunks.findLast(
        (chunk) => chunk.responseId === targetId
      );
      return last ? performance.now() - last.atMs : Infinity;
    };
    const activeAtSend = lastDeltaAge() < 300;
    const sentAt = performance.now();
    await session.stream(await stimulus(interruptFile));
    await session.stream(silence(1_500));
    await delay(1_000);
    const cancelled = session.events.find(
      (event) => ["response.cancelled", "response.done"].includes(
        event.type
      ) && event.response?.id === targetId &&
        event.atMs >= sentAt &&
        ["cancelled", "incomplete"].includes(event.response?.status)
    );
    const lastTargetChunk = session.chunks.findLast(
      (chunk) => chunk.responseId === targetId
    );
    await session.close(`dinamica-${label}`);
    return {
      activeAtSend,
      valid: activeAtSend,
      generationCancelled: Boolean(cancelled),
      lastDeltaAfterSendMs: lastTargetChunk
        ? Math.round(lastTargetChunk.atMs - sentAt)
        : null
    };
  };
  report.dynamics.bargeIn = await probeDynamics(
    "barge-in", "fala-interrompe.wav"
  );
  await delay(600);
  report.dynamics.backchannel = await probeDynamics(
    "backchannel", "fala-aham.wav"
  );
}

// ---- Hesitação ----
{
  guardBudget();
  const session = new Session();
  await session.open();
  const endA = await session.stream(await stimulus("fala-hesita-a.wav"));
  await session.stream(silence(900));
  const premature = session.chunks.find(
    (chunk) => chunk.atMs >= endA && chunk.rms > RMS_FLOOR &&
      chunk.atMs <= endA + 1_100
  );
  const endB = await session.stream(await stimulus("fala-hesita-b.wav"));
  await session.stream(silence(2_600));
  await session.waitFor(
    (event) => event.type === "response.done", 20_000
  );
  const first = session.chunks.find(
    (chunk) => chunk.atMs >= endB && chunk.rms > RMS_FLOOR
  );
  report.dynamics.hesitacao = {
    tomadaPrematura: Boolean(premature),
    respostaAposFimMs: first ? Math.round(first.atMs - endB) : null
  };
  await session.close("hesitacao");
}

report.spentUsd = Number(spentUsd.toFixed(4));
await writeFile(
  resolve(OUT, "report.json"), `${JSON.stringify(report, null, 1)}\n`
);
console.log(JSON.stringify(report));
