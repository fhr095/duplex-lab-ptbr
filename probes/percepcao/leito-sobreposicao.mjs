// Leito de SOBREPOSIÇÃO por SINAL dos dois canais (frente percepção).
//
// Substitui o leito fraco por eventos (confiança 0,6): aqui o lado do
// assistente vem do REGISTRO FÍSICO de reprodução (inicio/fim por uid,
// com motivo="cortado" e posição onde parou — cedeu×completou é fato,
// não inferência) e o lado do usuário vem da ENERGIA do canal-usuario
// (limiar adaptativo sobre o piso de ruído da própria sessão).
//
// Células de confusão (revisão do Felipe):
//   cedeu-a-burst-curto      possível corte indevido por backchannel
//   interrupcao-atendida     cedeu a burst longo (+tempo de reação)
//   backchannel-atravessado  completou sob burst curto (desejado)
//   segurou-contra-piso      completou com usuário insistindo (ruim)
//
// Só pacotes VIVOS (replays não têm reprodução — regra da linhagem).
// Uso: node leito-sobreposicao.mjs <dirGravacoes> <saida.jsonl>

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [, , RAIZ, SAIDA] = process.argv;
const SR = 16_000;

function decodificarWav(buffer) {
  // RIFF mínimo PCM16/float32 mono (canal-usuario é PCM16 16k).
  let pos = 12;
  let fmt = null;
  let bits = null;
  let canais = 1;
  let corpo = null;
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString("ascii", pos, pos + 4);
    const tam = buffer.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      fmt = buffer.readUInt16LE(pos + 8);
      canais = buffer.readUInt16LE(pos + 10);
      bits = buffer.readUInt16LE(pos + 22);
    } else if (id === "data") {
      corpo = buffer.subarray(pos + 8, pos + 8 + tam);
    }
    pos += 8 + tam + (tam % 2);
  }
  if (!corpo || fmt !== 1 || bits !== 16 || canais !== 1) {
    throw new Error(`wav não suportado fmt=${fmt} bits=${bits} ch=${canais}`);
  }
  return corpo;
}

// Atividade de fala por energia com limiar adaptativo: piso = p20 dos
// quadros de 30 ms; ativo quando RMS > max(piso*4, 0.006); junta
// lacunas <150 ms; descarta bursts <150 ms.
function atividadeDeFala(pcm) {
  const quadro = Math.round(0.03 * SR);
  const n = Math.floor(pcm.length / 2 / quadro);
  const rms = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let soma = 0;
    for (let j = 0; j < quadro; j += 1) {
      const s = pcm.readInt16LE((i * quadro + j) * 2) / 32768;
      soma += s * s;
    }
    rms[i] = Math.sqrt(soma / quadro);
  }
  const ordenado = [...rms].sort((a, b) => a - b);
  const piso = ordenado[Math.floor(n * 0.2)] ?? 0;
  const limiar = Math.max(piso * 4, 0.006);
  const ativos = [];
  let inicio = null;
  for (let i = 0; i < n; i += 1) {
    if (rms[i] > limiar) {
      inicio ??= i;
    } else if (inicio !== null) {
      ativos.push([inicio * 0.03, i * 0.03]);
      inicio = null;
    }
  }
  if (inicio !== null) ativos.push([inicio * 0.03, n * 0.03]);
  const unidos = [];
  for (const [a, b] of ativos) {
    const anterior = unidos.at(-1);
    if (anterior && a - anterior[1] < 0.15) {
      anterior[1] = b;
    } else {
      unidos.push([a, b]);
    }
  }
  return { bursts: unidos.filter(([a, b]) => b - a >= 0.15), limiar, piso };
}

async function lerJsonl(caminho) {
  try {
    const texto = await readFile(caminho, "utf8");
    return texto.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return null;
  }
}

const momentos = [];
const resumoPacotes = [];
const pacotes = (await readdir(RAIZ)).filter((n) => /^\d{4}-/.test(n));

for (const pacote of pacotes) {
  const base = join(RAIZ, pacote);
  const reproducoes = await lerJsonl(join(base, "reproducao.jsonl"));
  if (!reproducoes || reproducoes.length === 0) continue; // só vivos
  let manifesto;
  try {
    manifesto = JSON.parse(await readFile(join(base, "manifesto.json"), "utf8"));
  } catch {
    continue;
  }
  const t0 = Date.parse(manifesto.iniciadoEm);
  let pcm;
  try {
    pcm = decodificarWav(await readFile(join(base, "canal-usuario.wav")));
  } catch {
    continue;
  }
  const { bursts } = atividadeDeFala(pcm);

  // Janelas excluídas do corpus (ex.: captura de música ambiente que não
  // é teste) — corpus-excluir.json no pacote, com [{deS, ateS, motivo}].
  const exclusoes = JSON.parse(
    await readFile(join(base, "corpus-excluir.json"), "utf8").catch(
      () => "[]"
    )
  );
  const excluido = (t) =>
    exclusoes.some((e) => t >= e.deS && t <= e.ateS);

  // Pares inicio/fim por uid → janelas físicas de reprodução.
  const janelas = new Map();
  for (const r of reproducoes) {
    if (r.evento === "inicio") {
      janelas.set(r.uid, {
        uid: r.uid,
        kind: r.kind ?? null,
        texto: r.texto ?? null,
        de: (r.t - t0) / 1000,
        duracaoTotalS: r.duracaoS ?? null,
        ate: null,
        motivo: null,
        posicaoS: null
      });
    } else if (r.evento === "fim" && janelas.has(r.uid)) {
      const j = janelas.get(r.uid);
      if (j.ate === null) {
        j.ate = (r.t - t0) / 1000;
        j.motivo = r.motivo ?? null;
        j.posicaoS = r.posicaoS ?? null;
      }
    }
  }

  // Ordena janelas para detectar "ack substituído por conteúdo": corte
  // seguido de outra reprodução em <600ms SEM burst causal = o conteúdo
  // ficou pronto e cortou o ack (fast-ack.cut) — não é interrupção.
  const ordenadas = [...janelas.values()]
    .filter((j) => j.ate !== null && j.ate > j.de)
    .sort((a, b) => a.de - b.de);

  let doPacote = 0;
  for (let idx = 0; idx < ordenadas.length; idx += 1) {
    const j = ordenadas[idx];
    const proxima = ordenadas[idx + 1] ?? null;
    const cortou = j.motivo === "cortado";
    // Burst CAUSAL do corte: o último que começa DENTRO da reprodução e
    // no máximo 3s antes do fim dela.
    const causal = cortou
      ? bursts.findLast(
          ([ba]) => ba >= j.de - 0.1 && ba <= j.ate && j.ate - ba <= 3
        ) ?? null
      : null;
    const substituidoPorConteudo =
      cortou && !causal && proxima !== null && proxima.de - j.ate < 0.6;

    for (const [ba, bb] of bursts) {
      const inicioSobre = Math.max(ba, j.de);
      const fimSobre = Math.min(bb, j.ate + 0.2);
      if (fimSobre - inicioSobre < 0.18) continue;
      if (excluido(inicioSobre)) continue;
      const burstDur = bb - ba;
      const usuarioLongo = burstDur >= 1.2;
      const ehCausal = causal !== null && ba === causal[0];
      let celula;
      if (ba < j.de - 0.05 && bb > j.de + 0.15) {
        // Usuário JÁ falava quando a reprodução começou.
        celula = "assistente-entrou-sobre-usuario";
      } else if (cortou && ehCausal) {
        celula = usuarioLongo ? "interrupcao-atendida" : "cedeu-a-burst-curto";
      } else if (cortou && substituidoPorConteudo) {
        celula = "ack-substituido-por-conteudo";
      } else if (!cortou) {
        celula = usuarioLongo
          ? "segurou-contra-piso"
          : "backchannel-atravessado";
      } else {
        celula = "sobreposicao-nao-causal";
      }
      momentos.push({
        pacote,
        t: Number(inicioSobre.toFixed(2)),
        janela: [
          Number((Math.min(ba, j.de) - 1).toFixed(2)),
          Number((Math.max(bb, j.ate) + 1).toFixed(2))
        ],
        celula,
        burst: [Number(ba.toFixed(2)), Number(bb.toFixed(2))],
        burstDurS: Number(burstDur.toFixed(2)),
        sobreposicaoS: Number((fimSobre - inicioSobre).toFixed(2)),
        assistente: {
          kind: j.kind,
          texto: j.texto ? j.texto.slice(0, 60) : null,
          cortou,
          reacaoMs: ehCausal ? Math.round((j.ate - ba) * 1000) : null,
          tocouS: j.posicaoS,
          totalS: j.duracaoTotalS
        },
        confiancaRotulo: celula === "sobreposicao-nao-causal" ? 0.5 : 0.85,
        fonteRotulo: "sinal+reproducao-fisica"
      });
      doPacote += 1;
    }
  }
  resumoPacotes.push({ pacote, sobreposicoes: doPacote });
}

const porCelula = {};
const reacoes = [];
for (const m of momentos) {
  porCelula[m.celula] = (porCelula[m.celula] ?? 0) + 1;
  if (m.assistente.reacaoMs !== null) reacoes.push(m.assistente.reacaoMs);
}
reacoes.sort((a, b) => a - b);
const q = (p) => reacoes[Math.min(reacoes.length - 1, Math.floor(reacoes.length * p))];

await writeFile(SAIDA, momentos.map((m) => JSON.stringify(m)).join("\n") + "\n");
console.log(`sobreposições: ${momentos.length} em ${resumoPacotes.length} pacotes vivos → ${SAIDA}`);
console.log("células:", JSON.stringify(porCelula, null, 1));
if (reacoes.length) {
  console.log(`tempo de reação ao ceder: p50=${q(0.5)}ms p90=${q(0.9)}ms (n=${reacoes.length})`);
}
