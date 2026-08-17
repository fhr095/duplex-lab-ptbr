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
//     [--desde <segundos|mm:ss>] [--ate <segundos|mm:ss>]
//
// --desde/--ate recortam a janela no EIXO DO WAV (relógio de amostras do
// pacote, o mesmo dos leitos e do escutar); os frames preservam o
// sampleStart ABSOLUTO do pacote original, então o trace do replay
// continua comparável posição a posição. A cena anexada aos finais é
// repassada ao /api/turn — o replay exercita a política de confirmação
// exatamente como o cliente real.
//
// Pré-requisito: engine com OBSERVER=1 na porta alvo (cérebro local
// basta — as respostas não são o objeto do replay). SEMPRE em engine
// descartável (convenção: porta 4321), nunca na engine viva.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

function parseTempo(valor, nome) {
  if (valor === null) {
    return null;
  }
  const mmss = /^(\d+):([0-5]\d)$/u.exec(valor);
  const segundos = mmss
    ? Number(mmss[1]) * 60 + Number(mmss[2])
    : Number(valor);
  if (!Number.isFinite(segundos) || segundos < 0) {
    console.error(`${nome} inválido: ${valor} (use segundos ou mm:ss)`);
    process.exit(1);
  }
  return segundos;
}
const DESDE_S = parseTempo(arg("--desde", null), "--desde") ?? 0;
const ATE_S = parseTempo(arg("--ate", null), "--ate");

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
    `${health.asr.computeType} · cena ${health.cena?.state ?? "?"} · ` +
    `pacote ${health.observador.pasta}`
);

const wav = await readFile(resolve(ORIGEM, "canal-usuario.wav"));
const pcmCompleto = wav.subarray(44);
const bytesPorFrame = ((SR * 20) / 1_000) * 2;
const alinhar = (bytes) => bytes - (bytes % bytesPorFrame);
const iniByte = alinhar(Math.floor(DESDE_S * SR) * 2);
const fimByte = ATE_S === null
  ? pcmCompleto.length
  : Math.min(pcmCompleto.length, alinhar(Math.floor(ATE_S * SR) * 2));
if (iniByte >= fimByte) {
  console.error("janela vazia: --desde precisa vir antes de --ate/fim");
  process.exit(1);
}
console.log(
  `áudio do usuário: ${(pcmCompleto.length / 2 / SR).toFixed(1)}s · ` +
    `janela ${(iniByte / 2 / SR).toFixed(1)}s → ` +
    `${(fimByte / 2 / SR).toFixed(1)}s ` +
    `(${((fimByte - iniByte) / 2 / SR).toFixed(1)}s)`
);

const sessionId = `replay-${Date.now().toString(36)}`;
let turnos = 0;
const finais = [];
async function conduzirTurno(texto, cena) {
  const turnId = `replay-turno-${++turnos}`;
  const registro = finais.at(-1);
  const resposta = await fetch(`${HTTP}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: texto,
      history: [],
      sessionId,
      turnId,
      cena: cena ?? undefined
    })
  });
  for await (const event of readNdjson(resposta)) {
    if (event.type === "cena.confirmacao") {
      registro.confirmacao = event.acao;
      console.log(
        `  ⚠ cena.confirmacao (${event.acao}) para «${texto}»`
      );
    } else if (event.type === "route" && event.cena?.resultado) {
      registro.confirmacao = event.cena.resultado;
      console.log(`  ✓ pendência de cena ${event.cena.resultado}`);
    } else if (event.type === "delta") {
      registro.resposta = `${registro.resposta ?? ""}${event.delta}`;
    } else if (event.type === "done" || event.type === "error") {
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
    } else if (event.type === "cena.avaliada") {
      console.log(
        `  cena.avaliada ${event.turnId}: ${event.veredicto}` +
          (event.music !== null && event.music !== undefined
            ? ` (music ${event.music}, ${event.fatias} fatia(s))`
            : ` (${event.fonte ?? "sem fonte"})`)
      );
    } else if (event.type === "transcript.final") {
      const texto = String(event.text ?? "").trim();
      const registro = {
        atMs: performance.now() - inicioEm,
        texto: texto || "(vazio)",
        cena: event.cena?.veredicto ?? null,
        resposta: null,
        confirmacao: null
      };
      finais.push(registro);
      if (texto) {
        void conduzirTurno(texto, event.cena ?? null);
      }
    }
  });
});

const inicioEm = performance.now();
for (let offset = iniByte; offset < fimByte; offset += bytesPorFrame) {
  const fatia = pcmCompleto.subarray(
    offset,
    Math.min(fimByte, offset + bytesPorFrame)
  );
  if (fatia.length % 2 !== 0 || fatia.length === 0) {
    break;
  }
  await delay(
    Math.max(
      0,
      inicioEm + ((offset - iniByte) / 2 / SR) * 1_000 - performance.now()
    )
  );
  socket.send(
    Buffer.from(
      encodePcmFrame({
        // sampleStart ABSOLUTO do pacote original: o trace do replay
        // fica no mesmo relógio de amostras da sessão de origem.
        sequence: (offset - iniByte) / bytesPorFrame,
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
  const posicao = DESDE_S + final.atMs / 1_000;
  console.log(
    `  ${posicao.toFixed(1)}s [${final.cena ?? "sem cena"}]` +
      ` «${final.texto}»` +
      (final.confirmacao ? ` · cena→${final.confirmacao}` : "") +
      (final.resposta
        ? `\n      resposta: «${final.resposta.slice(0, 160)}»`
        : "")
  );
}
console.log(`pacote do replay: ${health.observador.pasta}`);
