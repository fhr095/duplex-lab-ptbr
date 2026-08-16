// Ensaio do observador — cliente sintético que valida o ENCANAMENTO do
// pacote de sessão ponta a ponta (mic contínuo → turnos → TTS com uid →
// beacons de reprodução/página/marcações), sem navegador. NÃO substitui a
// sessão real: o áudio é 100% sintético e serve só para provar que o
// pacote fecha e o harness analisa.
//
//   node scripts/observador-ensaio.mjs [--url ws://127.0.0.1:4321/api/audio]
//
// Pré-requisito: engine rodando com OBSERVER=1 nessa porta.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { encodePcmFrame } from "../web/pcm-wire.mjs";
import { readNdjson } from "../web/stream-utils.mjs";
import { inspectWave } from "../src/audio/wav.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const WS_URL = arg("--url", "ws://127.0.0.1:4321/api/audio");
const HTTP = WS_URL.replace(/^ws/u, "http").replace(/\/api\/audio$/u, "");
const FIXTURES = resolve(import.meta.dirname, "../tests/fixtures/engine");
const SR = 16_000;

function reamostrar16k(pcm, deSr) {
  if (deSr === SR) {
    return pcm;
  }
  const total = Math.floor((pcm.length / 2) * (SR / deSr));
  const saida = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i += 1) {
    const posicao = (i * deSr) / SR;
    const base = Math.floor(posicao);
    const fracao = posicao - base;
    const a = base * 2 + 1 < pcm.length ? pcm.readInt16LE(base * 2) : 0;
    const b = (base + 1) * 2 + 1 < pcm.length
      ? pcm.readInt16LE((base + 1) * 2)
      : a;
    saida.writeInt16LE(Math.round(a + (b - a) * fracao), i * 2);
  }
  return saida;
}

const health = await fetch(`${HTTP}/api/health`).then(
  (resposta) => resposta.json(),
  () => null
);
if (!health || health.observador?.ativo !== true) {
  console.error(
    "engine sem observador ativo nessa porta — rode com OBSERVER=1"
  );
  process.exit(1);
}
console.log(`observador ativo: ${health.observador.pasta}`);

// fala 2 sintetizada pela própria engine (POST bufferizado, RIFF corrigido)
const perguntaWav = Buffer.from(
  await (
    await fetch(`${HTTP}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Que horas são agora?" })
    })
  ).arrayBuffer()
);
const pergunta = decodeWaveToPcm16(perguntaWav);
const perguntaPcm = reamostrar16k(pergunta.pcm, pergunta.sampleRate);
const saudacao = decodeWaveToPcm16(
  await readFile(resolve(FIXTURES, "fala-saudacao.wav"))
);
const saudacaoPcm = reamostrar16k(saudacao.pcm, saudacao.sampleRate);

// linha do tempo do "microfone": silêncio + fala1 + silêncio + fala2 + cauda
const silencio = (segundos) => Buffer.alloc(Math.round(segundos * SR) * 2);
const micTimeline = Buffer.concat([
  silencio(1.2),
  saudacaoPcm,
  silencio(2.8),
  perguntaPcm,
  silencio(4.0)
]);
console.log(
  `mic sintético: ${(micTimeline.length / 2 / SR).toFixed(1)}s ` +
    `(fala1 ${(saudacaoPcm.length / 2 / SR).toFixed(1)}s, ` +
    `fala2 ${(perguntaPcm.length / 2 / SR).toFixed(1)}s)`
);

// beacons como a página enviaria
const sessionId = `ensaio-${randomUUID()}`;
const filaBeacons = [];
function beacon(entrada) {
  filaBeacons.push({
    p: performance.now(),
    tc: Date.now(),
    ...entrada
  });
}
async function enviarBeacons() {
  if (filaBeacons.length === 0) {
    return;
  }
  const entries = filaBeacons.splice(0, filaBeacons.length);
  await fetch(`${HTTP}/api/observador/beacon`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      clientEpochMs: Date.now(),
      perfNow: performance.now(),
      entries
    })
  }).catch(() => {});
}
const beaconTimer = setInterval(() => void enviarBeacons(), 1_000);
beacon({ c: "pagina", type: "session.started", detail: "ensaio sintético" });

// turno: final do ASR → /api/turn → TTS via GET stream com uid → beacons
let turnos = 0;
const respostas = [];
async function conduzirTurno(textoFinal) {
  turnos += 1;
  const turnId = `ensaio-turno-${turnos}`;
  let resposta = "";
  let rota = null;
  const requisicao = await fetch(`${HTTP}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: textoFinal,
      history: [],
      sessionId,
      turnId
    })
  });
  for await (const event of readNdjson(requisicao)) {
    if (event.type === "route") {
      rota = event.fastPath?.action ?? event.mode;
    }
    if (event.type === "delta") {
      resposta += event.delta;
    }
  }
  resposta = resposta.trim();
  if (!resposta) {
    console.error(`turno ${turnos}: resposta vazia`);
    return;
  }
  const uid = randomUUID();
  const audio = Buffer.from(
    await (
      await fetch(
        `${HTTP}/api/tts?stream=1&text=${encodeURIComponent(
          resposta.slice(0, 300)
        )}&uid=${uid}`
      )
    ).arrayBuffer()
  );
  // o GET stream chega com tamanhos RIFF abertos — inspectWave pode
  // recusar; extrai o sampleRate direto do fmt padrão como fallback
  let duracaoS = 1;
  try {
    duracaoS = inspectWave(audio).durationMs / 1_000;
  } catch {
    const sr = audio.length > 28 ? audio.readUInt32LE(24) : 24_000;
    duracaoS = (audio.length - 44) / 2 / (sr || 24_000);
  }
  beacon({
    c: "pagina",
    type: "assistant.utterance.started",
    detail: JSON.stringify({ kind: "direct", text: resposta.slice(0, 80) })
  });
  beacon({
    c: "reproducao",
    evento: "inicio",
    uid,
    kind: "direct",
    texto: resposta.slice(0, 120),
    posicaoS: 0,
    duracaoS
  });
  // reprodução simulada em tempo real (o mic continua fluindo em paralelo)
  await delay(Math.min(duracaoS, 6) * 1_000);
  beacon({
    c: "reproducao",
    evento: "fim",
    uid,
    kind: "direct",
    motivo: "terminou",
    tocou: true,
    posicaoS: duracaoS,
    duracaoS
  });
  beacon({
    c: "pagina",
    type: "assistant.speech.finished",
    detail: "direct"
  });
  respostas.push({ turnId, rota, resposta: resposta.slice(0, 60) });
  console.log(`turno ${turnos} (${rota}): ${resposta.slice(0, 60)}`);
}

// conexão de áudio
const socket = new WebSocket(WS_URL, {
  perMessageDeflate: false,
  maxPayload: 64 * 1024
});
const finais = [];
await new Promise((resolvePromise, rejectPromise) => {
  const timeout = setTimeout(
    () => rejectPromise(new Error("timeout de conexão")),
    10_000
  );
  socket.once("error", rejectPromise);
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      return;
    }
    const event = JSON.parse(data.toString("utf8"));
    if (event.type === "audio.ready") {
      socket.send(JSON.stringify({ type: "audio.start" }));
    } else if (event.type === "audio.started") {
      clearTimeout(timeout);
      resolvePromise();
    } else if (event.type === "transcript.final") {
      const texto = String(event.text ?? "").trim();
      if (texto) {
        finais.push(texto);
        void conduzirTurno(texto);
      }
    }
  });
});

// streaming do mic em tempo real (frames de 20 ms)
const bytesPorFrame = ((SR * 20) / 1_000) * 2;
const inicioEm = performance.now();
let sequence = 0;
let sampleStart = 0;
for (
  let offset = 0;
  offset < micTimeline.length;
  offset += bytesPorFrame
) {
  const pcm = micTimeline.subarray(
    offset,
    Math.min(micTimeline.length, offset + bytesPorFrame)
  );
  if (pcm.length % 2 !== 0 || pcm.length === 0) {
    break;
  }
  await delay(
    Math.max(
      0,
      inicioEm + (offset / 2 / SR) * 1_000 - performance.now()
    )
  );
  socket.send(
    Buffer.from(encodePcmFrame({ sequence, sampleStart, pcm16: pcm })),
    { binary: true }
  );
  sequence += 1;
  sampleStart += pcm.length / 2;
}

// marcação humana simulada + espera dos turnos pendentes
beacon({ c: "marca", tipo: "otimo", nota: "ensaio sintético" });
const prazo = performance.now() + 25_000;
while (respostas.length < finais.length && performance.now() < prazo) {
  await delay(100);
}
await delay(1_000);
socket.send(JSON.stringify({ type: "audio.stop" }));
await delay(300);
socket.close();
clearInterval(beaconTimer);
await enviarBeacons();

console.log(
  `ensaio concluído: ${finais.length} finais, ${respostas.length} ` +
    `respostas · pacote ${health.observador.pasta}`
);
process.exit(finais.length >= 1 && respostas.length >= 1 ? 0 : 1);
