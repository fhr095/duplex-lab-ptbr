// B2 — Referência comercial nativa (OpenAI Realtime) sob o protocolo PT-BR.
//
// Mede, por cenário: fim-da-fala→primeiro áudio NÃO-SILENCIOSO da resposta,
// tomada prematura em hesitação, parada sob barge-in, reação a backchannel,
// incorporação de correção e continuidade. Salva TODO o áudio de saída e o
// log bruto de eventos (evidência versionável). Medidor de custo com corte.
//
// Uso: node probes/realtime-reference.mjs [modelo] [--out dir]
//   modelo default: gpt-realtime-2.1-mini

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

import { loadEnvFile } from "../src/config/load-env.mjs";
import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";

await loadEnvFile();

const MODEL = process.argv[2] ?? "gpt-realtime-2.1-mini";
const OUT_DIR = resolve(
  import.meta.dirname,
  `../notes/evidencia/realtime/${MODEL}`
);
await mkdir(OUT_DIR, { recursive: true });
const MODELS = "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/" +
  "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models";

const RATE = 24_000;
const RMS_FLOOR = 0.012;
// Corte duro de orçamento por processo (aproximação conservadora por
// tokens de áudio reportados em response.done; preços ver dashboard).
const USD_CEILING = Number.parseFloat(
  process.env.REALTIME_USD_CEILING ?? "2.5"
);
// preços por 1M tokens (entrada áudio / saída áudio) — conservadores
const PRICE = MODEL.includes("mini")
  ? { in: 10, out: 20 }
  : { in: 32, out: 64 };
let spentUsd = 0;

function linearResampleTo24k(pcm16, fromRate) {
  if (fromRate === RATE) {
    return pcm16;
  }
  const samples = pcm16.length / 2;
  const outSamples = Math.floor((samples * RATE) / fromRate);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i += 1) {
    const src = (i * fromRate) / RATE;
    const lo = Math.floor(src);
    const hi = Math.min(samples - 1, lo + 1);
    const frac = src - lo;
    const value = pcm16.readInt16LE(lo * 2) * (1 - frac) +
      pcm16.readInt16LE(hi * 2) * frac;
    out.writeInt16LE(Math.round(value), i * 2);
  }
  return out;
}

async function loadStimulus(name) {
  const wave = await readFile(`${MODELS}/${name}`);
  const decoded = decodeWaveToPcm16(wave);
  return linearResampleTo24k(decoded.pcm, decoded.sampleRate);
}

function rms(buffer) {
  let sum = 0;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    const value = buffer.readInt16LE(offset) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / (buffer.length / 2));
}

function wavFromPcm(pcm) {
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
  return Buffer.concat([header, pcm]);
}

class RealtimeSession {
  events = [];
  outputChunks = [];
  #socket;
  #openPromise;

  constructor(label) {
    this.label = label;
    this.#socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${MODEL}`,
      {
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );
    this.#openPromise = new Promise((resolvePromise, rejectPromise) => {
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
      const audioB64 = event.type?.endsWith("audio.delta")
        ? event.delta
        : null;
      if (audioB64) {
        const pcm = Buffer.from(audioB64, "base64");
        event.delta = `<áudio ${pcm.length}B>`;
        this.outputChunks.push({
          atMs: event.atMs,
          pcm,
          rms: rms(pcm),
          responseId: event.response_id ?? null
        });
      }
      this.events.push(event);
      if (event.type === "response.done") {
        const usage = event.response?.usage;
        const inputAudio =
          usage?.input_token_details?.audio_tokens ?? 0;
        const outputAudio =
          usage?.output_token_details?.audio_tokens ?? 0;
        spentUsd += (inputAudio * PRICE.in +
          outputAudio * PRICE.out) / 1_000_000;
      }
      if (event.type === "error") {
        console.error("API error:", JSON.stringify(event).slice(0, 300));
      }
    });
  }

  async open(instructions) {
    await this.#openPromise;
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: RATE },
            turn_detection: { type: "semantic_vad" }
          },
          output: { format: { type: "audio/pcm", rate: RATE } }
        }
      }
    });
    await delay(600);
  }

  send(object) {
    this.#socket.send(JSON.stringify(object));
  }

  // envia PCM em ritmo de tempo real; retorna o instante do fim da fala
  async streamAudio(pcm) {
    const chunkMs = 40;
    const bytesPerChunk = (RATE * chunkMs * 2) / 1000;
    const startedAt = performance.now();
    for (let offset = 0; offset < pcm.length; offset += bytesPerChunk) {
      const chunk = pcm.subarray(
        offset, Math.min(pcm.length, offset + bytesPerChunk)
      );
      await delay(Math.max(
        0,
        startedAt + (offset / 2 / RATE) * 1000 - performance.now()
      ));
      this.send({
        type: "input_audio_buffer.append",
        audio: chunk.toString("base64")
      });
    }
    return performance.now();
  }

  async waitFor(predicate, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    let index = 0;
    while (performance.now() < deadline) {
      while (index < this.events.length) {
        const event = this.events[index++];
        if (predicate(event)) {
          return event;
        }
      }
      await delay(25);
    }
    return null;
  }

  firstNonSilentAfter(sinceMs) {
    return this.outputChunks.find(
      (chunk) => chunk.atMs >= sinceMs && chunk.rms > RMS_FLOOR
    ) ?? null;
  }

  lastAudioAt() {
    return this.outputChunks.at(-1)?.atMs ?? null;
  }

  async close() {
    this.#socket.close();
    await delay(200);
  }

  async saveAudio(name) {
    const pcm = Buffer.concat(
      this.outputChunks.map((chunk) => chunk.pcm)
    );
    if (pcm.length > 0) {
      await writeFile(
        resolve(OUT_DIR, `${name}.wav`), wavFromPcm(pcm)
      );
    }
  }

  async saveEvents(name) {
    await writeFile(
      resolve(OUT_DIR, `${name}.events.jsonl`),
      this.events.map((event) => JSON.stringify(event)).join("\n")
    );
  }
}

const INSTRUCTIONS =
  "Você é um assistente de voz em português brasileiro. Responda sempre " +
  "em pt-BR, com uma ou duas frases curtas e naturais.";

function checkBudget() {
  if (spentUsd >= USD_CEILING) {
    throw new Error(
      `teto de orçamento atingido: US$ ${spentUsd.toFixed(3)}`
    );
  }
}

const report = { model: MODEL, scenarios: {}, spentUsd: null };

// Fala um turno como um microfone real: enunciado + silêncio contínuo até
// o VAD fechar e a resposta concluir. Retorna o instante do fim da fala.
async function speakTurn(session, pcm, options = {}) {
  const endOfSpeechAt = await session.streamAudio(pcm);
  const silence = Buffer.alloc((RATE * 2 * 2_600) / 1_000 & ~1);
  await session.streamAudio(silence);
  if (options.waitDone !== false) {
    await session.waitFor(
      (event) => event.type === "response.done",
      options.timeoutMs ?? 20_000
    );
  }
  return endOfSpeechAt;
}

// ---------- Cenário 1: latência + correção + continuidade ----------
{
  checkBudget();
  const session = new RealtimeSession("latencia");
  await session.open(INSTRUCTIONS);
  const scenario = [];
  for (const [name, file] of [
    ["saudacao", "fala-saudacao.wav"],
    ["pergunta", "fala-pergunta.wav"],
    ["correcao", "fala-correcao.wav"],
    ["continuidade", "fala-continuidade.wav"]
  ]) {
    checkBudget();
    const pcm = await loadStimulus(file);
    const doneBefore = session.events.filter(
      (event) => event.type === "response.done"
    ).length;
    const endOfSpeechAt = await speakTurn(session, pcm);
    const responded = session.events.filter(
      (event) => event.type === "response.done"
    ).length > doneBefore;
    const first = session.firstNonSilentAfter(endOfSpeechAt);
    scenario.push({
      turn: name,
      endToNonSilentMs: first
        ? Math.round(first.atMs - endOfSpeechAt)
        : null,
      responded
    });
    await delay(500);
  }
  report.scenarios.latencia = scenario;
  await session.saveAudio("s1-conversa");
  await session.saveEvents("s1-conversa");
  await session.close();
}

// ---------- Cenário 2: hesitação (tomada prematura?) ----------
{
  checkBudget();
  const session = new RealtimeSession("hesitacao");
  await session.open(INSTRUCTIONS);
  const partA = await loadStimulus("fala-hesita-a.wav");
  const partB = await loadStimulus("fala-hesita-b.wav");
  const pauseMs = 900;
  const endA = await session.streamAudio(partA);
  // silêncio da pausa em tempo real
  const silence = Buffer.alloc((RATE * pauseMs * 2) / 1000);
  await session.streamAudio(silence);
  const prematureAudio = session.firstNonSilentAfter(endA);
  const prematureBefore = prematureAudio &&
    prematureAudio.atMs < endA + pauseMs + 200;
  const endB = await speakTurn(session, partB);
  const first = session.firstNonSilentAfter(endB);
  report.scenarios.hesitacao = {
    tomadaPrematura: Boolean(prematureBefore),
    prematuraAposMs: prematureAudio
      ? Math.round(prematureAudio.atMs - endA)
      : null,
    respostaFinalMs: first ? Math.round(first.atMs - endB) : null
  };
  await session.saveAudio("s2-hesitacao");
  await session.saveEvents("s2-hesitacao");
  await session.close();
}

// ---------- Cenário 3: barge-in e backchannel ----------
{
  checkBudget();
  const session = new RealtimeSession("interrupcao");
  await session.open(INSTRUCTIONS +
    " Quando pedirem uma explicação, responda MUITO longamente, com pelo " +
    "menos vinte segundos de fala contínua, sem parar.");
  const askPcm = await loadStimulus("fala-explica.wav");
  await session.streamAudio(askPcm);
  const silencePad = Buffer.alloc((RATE * 2 * 2_600) / 1_000 & ~1);
  await session.streamAudio(silencePad);
  await session.waitFor(
    (event) => event.type?.endsWith("audio.delta"), 15_000
  );
  // garante fala ativa: >=2,5s de áudio e chunk fresco (<400ms)
  const activeAudio = async () => {
    for (let i = 0; i < 40; i += 1) {
      const last = session.outputChunks.at(-1);
      if (session.outputChunks.length > 60 && last &&
          performance.now() - last.atMs < 400) {
        return true;
      }
      await delay(200);
    }
    return false;
  };
  const activeAtAham = await activeAudio();
  // backchannel curto: deve CONTINUAR falando
  const aham = await loadStimulus("fala-aham.wav");
  const endAham = await session.streamAudio(aham);
  await delay(1_600);
  const audioAfterAham = session.outputChunks.some(
    (chunk) => chunk.atMs > endAham + 400 && chunk.rms > RMS_FLOOR
  );
  // barge-in real: deve PARAR rápido
  const activeAtInterrupt = session.outputChunks.at(-1) &&
    performance.now() - session.outputChunks.at(-1).atMs < 600;
  const interrupt = await loadStimulus("fala-interrompe.wav");
  const interruptStartAt = performance.now();
  await session.streamAudio(interrupt);
  await session.streamAudio(
    Buffer.alloc((RATE * 2 * 1_800) / 1_000 & ~1)
  );
  await delay(800);
  const lastBeforeNewResponse = session.outputChunks.filter(
    (chunk) => chunk.rms > RMS_FLOOR &&
      chunk.atMs >= interruptStartAt &&
      chunk.responseId === session.outputChunks.findLast(
        (c) => c.atMs < interruptStartAt
      )?.responseId
  ).at(-1);
  report.scenarios.interrupcao = {
    falaAtivaNoBackchannel: activeAtAham,
    continuouAposBackchannel: audioAfterAham,
    falaAtivaNoBargeIn: Boolean(activeAtInterrupt),
    bargeInStopMs: lastBeforeNewResponse
      ? Math.round(lastBeforeNewResponse.atMs - interruptStartAt)
      : 0
  };
  await session.saveAudio("s3-interrupcao");
  await session.saveEvents("s3-interrupcao");
  await session.close();
}

report.spentUsd = Number(spentUsd.toFixed(4));
await writeFile(
  resolve(OUT_DIR, "report.json"),
  `${JSON.stringify(report, null, 1)}\n`
);
console.log(JSON.stringify(report, null, 1));
