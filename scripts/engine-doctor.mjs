// Engine RC v0.1 — doctor: um comando que prova a instalação inteira.
//
//   node scripts/engine-doctor.mjs [--turns N] [--url ws://…/api/audio]
//
// Verifica: (1) health do servidor (ASR/VAD/TTS prontos de verdade);
// (2) UM turno de áudio ponta a ponta — fixture PT-BR pelo WebSocket →
// transcript.final → /api/turn → primeiro áudio NÃO-SILENCIOSO do TTS;
// (3) conversa prolongada — N repetições do ciclo, com falha se qualquer
// turno não fechar. Sai 0 somente com tudo verde.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { encodePcmFrame } from "../web/pcm-wire.mjs";
import { readNdjson } from "../web/stream-utils.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const TURNS = Number.parseInt(arg("--turns", "6"), 10);
const WS_URL = arg("--url", "ws://127.0.0.1:4173/api/audio");
const HTTP = WS_URL.replace(/^ws/u, "http").replace(/\/api\/audio$/u, "");
const STIM = resolve(import.meta.dirname, "../tests/fixtures/engine");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok " : "FALHA"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures += 1;
  }
};

// (1) health real
const health = await fetch(`${HTTP}/api/health`, {
  signal: AbortSignal.timeout(5_000)
}).then((response) => response.json()).catch(() => null);
check(Boolean(health), "servidor responde /api/health");
if (!health) {
  process.exit(1);
}
check(health.asr?.state === "ready", "ASR pronto", health.asr?.model);
check(health.vadControl?.state === "ready", "VAD pronto",
  health.vadControl?.engine);
check(health.tts?.state === "ready", "TTS pronto",
  `${health.tts?.engine}/${health.tts?.voice}`);
check(Boolean(health.interaction?.kernelVersion), "kernel ativo",
  health.interaction?.kernelVersion);

// (2)+(3) turnos de áudio ponta a ponta
const wave = await readFile(resolve(STIM, "fala-saudacao.wav"));
const decoded = decodeWaveToPcm16(wave);
const bytesPerFrame = ((decoded.sampleRate * 20) / 1000) * 2;
const silence = Buffer.alloc(decoded.sampleRate * 2 * 2);
const stream = Buffer.concat([decoded.pcm, silence]);

const socket = new WebSocket(WS_URL, {
  perMessageDeflate: false,
  maxPayload: 64 * 1024
});
const finals = [];
await new Promise((resolvePromise, rejectPromise) => {
  const timeout = setTimeout(
    () => rejectPromise(new Error("timeout de conexão de áudio")), 10_000
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
      finals.push({ text: String(event.text ?? "").trim(),
        atMs: performance.now() });
    }
  });
});

let sequence = 0;
let sampleStart = 0;
const latencies = [];
for (let turn = 0; turn < TURNS; turn += 1) {
  const finalsBefore = finals.length;
  const startedAt = performance.now();
  for (let offset = 0; offset < stream.length; offset += bytesPerFrame) {
    const pcm = stream.subarray(
      offset, Math.min(stream.length, offset + bytesPerFrame)
    );
    if (pcm.length % 2 !== 0 || pcm.length === 0) {
      break;
    }
    await delay(Math.max(
      0, startedAt + (offset / 2 / decoded.sampleRate) * 1000 -
        performance.now()
    ));
    socket.send(Buffer.from(encodePcmFrame({
      sequence, sampleStart, pcm16: pcm
    })), { binary: true });
    sequence += 1;
    sampleStart += pcm.length / 2;
  }
  const deadline = performance.now() + 15_000;
  while (finals.length === finalsBefore &&
         performance.now() < deadline) {
    await delay(25);
  }
  const final = finals.at(-1);
  const gotFinal = finals.length > finalsBefore && final.text.length > 0;
  check(gotFinal, `turno ${turn + 1}: transcript.final`,
    final?.text ?? "ausente");
  if (!gotFinal) {
    continue;
  }

  let responseText = "";
  let fastPath = null;
  const turnResponse = await fetch(`${HTTP}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: final.text,
      history: [],
      sessionId: `doctor-${process.pid}-${Math.trunc(
        performance.timeOrigin)}`,
      turnId: `doctor-${turn}`
    })
  });
  for await (const event of readNdjson(turnResponse)) {
    if (event.type === "route") {
      fastPath = event.fastPath?.action ?? null;
    }
    if (event.type === "delta") {
      responseText += event.delta;
    }
    if (event.type === "error") {
      responseText = "";
      break;
    }
  }
  check(responseText.trim().length > 0,
    `turno ${turn + 1}: resposta (${fastPath ?? "sem fast-path"})`,
    responseText.trim().slice(0, 40));

  // TTS não-silencioso da primeira frase
  const isSidecar = String(health.tts?.engine ?? "")
    .endsWith("-sidecar");
  const ttsStart = performance.now();
  let nonSilentMs = null;
  if (isSidecar) {
    const ttsResponse = await fetch(
      `${HTTP}/api/tts?stream=1&text=${
        encodeURIComponent(responseText.trim().slice(0, 120))}`
    );
    let buffered = Buffer.alloc(0);
    const windowBytes = (16_000 * 20 * 2) / 1_000;
    outer:
    for await (const chunk of ttsResponse.body) {
      buffered = Buffer.concat([buffered, chunk]);
      for (let offset = 44; offset + windowBytes <= buffered.length;
           offset += windowBytes) {
        let sum = 0;
        for (let i = offset; i < offset + windowBytes; i += 2) {
          const value = buffered.readInt16LE(i) / 32768;
          sum += value * value;
        }
        if (Math.sqrt(sum / (windowBytes / 2)) > 0.012) {
          nonSilentMs = performance.now() - ttsStart;
          break outer;
        }
      }
    }
  } else {
    const ttsResponse = await fetch(`${HTTP}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: responseText.trim().slice(0, 120) })
    });
    const audio = Buffer.from(await ttsResponse.arrayBuffer());
    nonSilentMs = audio.length > 4_000
      ? performance.now() - ttsStart
      : null;
  }
  check(nonSilentMs !== null,
    `turno ${turn + 1}: TTS áudio não-silencioso`,
    nonSilentMs === null ? "" : `${Math.round(nonSilentMs)}ms`);
  if (nonSilentMs !== null) {
    latencies.push(Math.round(nonSilentMs));
  }
  await delay(300);
}
socket.close();

console.log(`\nresumo: ${TURNS} turnos · TTS 1º áudio ` +
  `${latencies.join("/")}ms · falhas: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
