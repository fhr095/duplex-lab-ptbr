// Replay do observador — reinjeta a VOZ REAL capturada de uma sessão
// antiga (canal-usuario.wav) na engine atual, pelo caminho de produção
// (WS → VAD → ASR → endpoint → /api/turn), em tempo real. Fecha o PDCA
// sem regravar: a pseudo-referência da sessão original vale para o mesmo
// áudio, então dá para comparar final a final entre versões da engine.
// Limite honesto: a voz gravada não REAGE às respostas novas — replay
// valida a cadeia de escuta; a experiência completa segue exigindo
// sessão viva.
//
//   node scripts/observador-replay.mjs --origem var/observador/<pacote>
//     [--url ws://127.0.0.1:4321/api/audio]
//
// Pré-requisito: engine com OBSERVER=1 na porta alvo (cérebro local
// basta — as respostas não são o objeto do replay).

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

import { encodePcmFrame } from "../web/pcm-wire.mjs";
import { readNdjson } from "../web/stream-utils.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const ORIGEM = arg("--origem", null);
if (!ORIGEM) {
  console.error("--origem <pacote> é obrigatório");
  process.exit(1);
}
const WS_URL = arg("--url", "ws://127.0.0.1:4321/api/audio");
const HTTP = WS_URL.replace(/^ws/u, "http").replace(/\/api\/audio$/u, "");
const SR = 16_000;

const health = await fetch(`${HTTP}/api/health`).then(
  (resposta) => resposta.json(),
  () => null
);
if (!health || health.observador?.ativo !== true) {
  console.error("engine sem OBSERVER=1 na porta alvo");
  process.exit(1);
}
console.log(
  `replay de ${ORIGEM} → engine ${health.asr.finalModel}/` +
    `${health.asr.computeType} · pacote ${health.observador.pasta}`
);

const wav = await readFile(resolve(ORIGEM, "canal-usuario.wav"));
const pcm = wav.subarray(44);
console.log(`áudio do usuário: ${(pcm.length / 2 / SR).toFixed(1)}s`);

const sessionId = `replay-${Date.now().toString(36)}`;
let turnos = 0;
const finais = [];
async function conduzirTurno(texto) {
  const turnId = `replay-turno-${++turnos}`;
  const resposta = await fetch(`${HTTP}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: texto, history: [], sessionId, turnId })
  });
  for await (const event of readNdjson(resposta)) {
    if (event.type === "done" || event.type === "error") {
      break;
    }
  }
}

const socket = new WebSocket(WS_URL, {
  perMessageDeflate: false,
  maxPayload: 64 * 1024
});
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
        finais.push({
          trel: null,
          atMs: performance.now() - inicioEm,
          texto
        });
        void conduzirTurno(texto);
      }
    }
  });
});

const bytesPorFrame = ((SR * 20) / 1_000) * 2;
const inicioEm = performance.now();
for (let offset = 0; offset < pcm.length; offset += bytesPorFrame) {
  const fatia = pcm.subarray(
    offset,
    Math.min(pcm.length, offset + bytesPorFrame)
  );
  if (fatia.length % 2 !== 0 || fatia.length === 0) {
    break;
  }
  await delay(
    Math.max(
      0,
      inicioEm + (offset / 2 / SR) * 1_000 - performance.now()
    )
  );
  socket.send(
    Buffer.from(
      encodePcmFrame({
        sequence: offset / bytesPorFrame,
        sampleStart: offset / 2,
        pcm16: fatia
      })
    ),
    { binary: true }
  );
}
await delay(2_500);
socket.send(JSON.stringify({ type: "audio.stop" }));
await delay(400);
socket.close();

console.log(`\nfinais do replay (${finais.length}):`);
for (const final of finais) {
  console.log(
    `  ${(final.atMs / 1_000).toFixed(1)}s «${final.texto}»`
  );
}
console.log(`pacote do replay: ${health.observador.pasta}`);
