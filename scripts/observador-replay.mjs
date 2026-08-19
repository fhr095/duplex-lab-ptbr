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
//     [--fundo <arquivo .raw|.wav>] [--snr <dB>] [--fundo-offset <s>]
//
// --desde/--ate recortam a janela no EIXO DO WAV (relógio de amostras do
// pacote, o mesmo dos leitos e do escutar); os frames preservam o
// sampleStart ABSOLUTO do pacote original, então o trace do replay
// continua comparável posição a posição. A cena anexada aos finais é
// repassada ao /api/turn — o replay exercita a política de confirmação
// exatamente como o cliente real.
//
// --fundo mistura um SOM DE FUNDO CONTÍNUO (PCM16 mono 16 kHz; .raw
// headerless ou .wav; loop se mais curto) sobre a voz gravada, no nível
// dado por --snr (dB entre o RMS da FALA ATIVA da janela e o RMS do
// fundo; padrão 5). Fundos: scripts/gerar-fundos-cena.mjs + a música
// real de fora-do-corpus. Limite honesto do sintético: soma digital não
// simula AGC/AEC do navegador, reverberação da sala, ducking da caixa
// nem o efeito Lombard (você falaria mais alto) — vale como bancada de
// estresse da cadeia de escuta e p/ calibrar cena, não como experiência
// completa.
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
const FUNDO_ARQUIVO = arg("--fundo", null);
const FUNDO_SNR_DB = Number(arg("--snr", "5"));
const FUNDO_OFFSET_S = Number(arg("--fundo-offset", "0"));
// --reproducao-simulada: para cada resposta da engine, sintetiza o TTS
// de verdade (sidecar precisa estar no ar) e emite os beacons de
// reprodução avançando um relógio SIMULADO com a duração real do WAV —
// o pacote ganha canal-assistente FÍSICO posicionado, e o loop
// fonte→engine→fonte fica mensurável (bancada de recuperação de âncora,
// notes/percepcao/012 §3). LIMITE DECLARADO: simulação TEMPORAL, não
// acústica — prova contingência e recuperação; NÃO alega AEC,
// reverberação nem comportamento físico da sala (o áudio simulado não
// entra no microfone).
const REPRODUCAO_SIMULADA = args.includes("--reproducao-simulada");

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

// ---- fundo contínuo opcional (--fundo): carrega, mede e calcula ganho
function pcmDeWav(buffer) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const tamanho = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      return buffer.subarray(offset + 8, offset + 8 + tamanho);
    }
    offset += 8 + tamanho + (tamanho % 2);
  }
  throw new Error("WAV de fundo sem chunk data");
}
function rmsDe(pcm, iniAmostra, quantas, passo = 1) {
  let soma = 0;
  let n = 0;
  for (let i = 0; i < quantas; i += passo) {
    const v = pcm.readInt16LE((iniAmostra + i) * 2) / 32_768;
    soma += v * v;
    n += 1;
  }
  return n === 0 ? 0 : Math.sqrt(soma / n);
}
let fundoPcm = null;
let fundoGanho = 0;
let fundoOffsetAmostras = 0;
if (FUNDO_ARQUIVO) {
  const bruto = await readFile(resolve(FUNDO_ARQUIVO));
  fundoPcm = bruto.subarray(0, 4).toString("ascii") === "RIFF"
    ? pcmDeWav(bruto)
    : bruto;
  fundoOffsetAmostras = Math.floor(FUNDO_OFFSET_S * SR);
  // RMS da FALA ATIVA da janela: mediana dos frames de 20 ms acima de
  // -45 dBFS (evita calibrar o SNR contra silêncio).
  const framesAtivos = [];
  for (let b = iniByte; b + bytesPorFrame <= fimByte; b += bytesPorFrame) {
    const rms = rmsDe(pcmCompleto, b / 2, bytesPorFrame / 2);
    if (rms > 10 ** (-45 / 20)) {
      framesAtivos.push(rms);
    }
  }
  framesAtivos.sort((a, b) => a - b);
  const vozRms = framesAtivos.length > 0
    ? framesAtivos[Math.floor(framesAtivos.length / 2)]
    : 10 ** (-30 / 20);
  const fundoRms = rmsDe(
    fundoPcm,
    0,
    Math.min(fundoPcm.length / 2, 60 * SR),
    4
  );
  fundoGanho = fundoRms > 0
    ? vozRms / (fundoRms * 10 ** (FUNDO_SNR_DB / 20))
    : 0;
  console.log(
    `fundo: ${FUNDO_ARQUIVO} (${(fundoPcm.length / 2 / SR).toFixed(0)}s, ` +
      `loop) · SNR alvo ${FUNDO_SNR_DB} dB · voz ativa ` +
      `${(20 * Math.log10(vozRms)).toFixed(1)} dBFS · fundo ` +
      `${(20 * Math.log10(fundoRms)).toFixed(1)} dBFS · ganho ` +
      `${fundoGanho.toFixed(3)}`
  );
}
function misturarFrame(fatia, posicaoAmostra) {
  if (!fundoPcm) {
    return fatia;
  }
  const totalFundo = fundoPcm.length / 2;
  const saida = Buffer.alloc(fatia.length);
  for (let i = 0; i < fatia.length / 2; i += 1) {
    const indiceFundo =
      (fundoOffsetAmostras + posicaoAmostra + i) % totalFundo;
    const misto =
      fatia.readInt16LE(i * 2) +
      Math.round(fundoPcm.readInt16LE(indiceFundo * 2) * fundoGanho);
    saida.writeInt16LE(Math.max(-32_768, Math.min(32_767, misto)), i * 2);
  }
  return saida;
}

const sessionId = `replay-${Date.now().toString(36)}`;
let turnos = 0;
const finais = [];

// ---- reprodução simulada: beacons reais + relógio de playback serial
async function enviarBeacon(entrada) {
  await fetch(`${HTTP}/api/observador/beacon`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      clientEpochMs: Date.now(),
      perfNow: performance.now(),
      entries: [
        { p: performance.now(), tc: Date.now(), c: "reproducao", ...entrada }
      ]
    })
  }).catch(() => {});
}
let filaReproducao = Promise.resolve();
let reproducoesSimuladas = 0;
function simularReproducao(texto) {
  filaReproducao = filaReproducao.then(async () => {
    const uid = `sim-${Date.now().toString(36)}-${++reproducoesSimuladas}`;
    const resposta = await fetch(
      `${HTTP}/api/tts?text=${encodeURIComponent(texto.slice(0, 680))}` +
        `&uid=${uid}`,
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!resposta.ok) {
      console.log(`  (tts indisponível p/ simulação: HTTP ${resposta.status})`);
      return;
    }
    const wav = Buffer.from(await resposta.arrayBuffer());
    const sr = wav.readUInt32LE(24) || 44_100;
    const bits = wav.readUInt16LE(34) || 16;
    const duracaoS = Math.max(
      0.2,
      (wav.length - 44) / (sr * (bits / 8))
    );
    await enviarBeacon({
      evento: "inicio",
      uid,
      kind: "resposta",
      texto: texto.slice(0, 120),
      posicaoS: 0,
      duracaoS
    });
    console.log(
      `  ▶ reprodução simulada ${duracaoS.toFixed(1)}s («${texto.slice(0, 50)}…»)`
    );
    await delay(duracaoS * 1_000);
    await enviarBeacon({
      evento: "fim",
      uid,
      kind: "resposta",
      motivo: "finalizado",
      tocou: true,
      posicaoS: duracaoS,
      duracaoS
    });
  }).catch(() => {});
  return filaReproducao;
}
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
  if (REPRODUCAO_SIMULADA && registro.resposta?.trim()) {
    void simularReproducao(registro.resposta.trim());
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
        pcm16: misturarFrame(fatia, (offset - iniByte) / 2)
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
