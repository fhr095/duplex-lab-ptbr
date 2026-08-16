// Leito de SOBREPOSIÇÃO v2 — dois canais NO MESMO EIXO por construção.
//
// v1 tinha bug de eixo (achado do harness MaAI): reproduções
// posicionadas por relógio de parede (Date.parse(iniciadoEm)) contra um
// wav cujo zero é a 1ª âncora de mic, com deriva de relógio de captura
// (+1,9s a +17s) — 52/59 pareamentos inválidos.
//
// v2: usa canal-usuario.wav E canal-assistente.wav — AMBOS gerados pelo
// empacotador com o mesmo t0 (min das conexões) e mapeamento por âncoras
// (tDaAmostra). Atividade por energia nos DOIS; sobreposição exige
// energia real dos dois lados (o "gate de cena" vira inerente).
// reproducao.jsonl entra só como METADADO (kind/motivo/posição), casado
// por proximidade temporal com tolerância — nunca como geometria.
//
// Células: segurou-contra-piso · assistente-entrou-sobre-usuario ·
// backchannel-atravessado · cedeu-a-burst-curto · interrupcao-atendida
// · ack-substituido-por-conteudo.
//
// Uso: node leito-sobreposicao.mjs <dirGravacoes> <saida.jsonl>

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [, , RAIZ, SAIDA] = process.argv;
const SR = 16_000;

function decodificarWav(buffer) {
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

// Segmentos ativos por energia; limiar adaptativo relativo ao piso.
function segmentosAtivos(pcm, { fatorLimiar = 4, minimoAbs = 0.006 } = {}) {
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
  const limiar = Math.max(piso * fatorLimiar, minimoAbs);
  const brutos = [];
  let inicio = null;
  for (let i = 0; i < n; i += 1) {
    if (rms[i] > limiar) {
      inicio ??= i;
    } else if (inicio !== null) {
      brutos.push([inicio * 0.03, i * 0.03]);
      inicio = null;
    }
  }
  if (inicio !== null) brutos.push([inicio * 0.03, n * 0.03]);
  const unidos = [];
  for (const [a, b] of brutos) {
    const anterior = unidos.at(-1);
    if (anterior && a - anterior[1] < 0.15) {
      anterior[1] = b;
    } else {
      unidos.push([a, b]);
    }
  }
  return unidos.filter(([a, b]) => b - a >= 0.15);
}

async function lerJsonl(caminho) {
  try {
    const texto = await readFile(caminho, "utf8");
    return texto.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return null;
  }
}

// t0 do EMPACOTADOR = min(tInicio das conexões) ≈ min da 1ª âncora de
// cada mic (só p/ casar METADADO de reprodução, com tolerância).
async function t0DoPacote(base) {
  let minimo = Infinity;
  for (let n = 1; n <= 12; n += 1) {
    const indice = await lerJsonl(join(base, `mic-${n}.indice.jsonl`));
    if (!indice || indice.length === 0) continue;
    const primeira = indice.find((l) => l.tipo === "ancora") ?? indice[0];
    if (Number.isFinite(primeira.t)) minimo = Math.min(minimo, primeira.t);
  }
  return Number.isFinite(minimo) ? minimo : null;
}

const momentos = [];
let pacotesVivos = 0;
const pacotes = (await readdir(RAIZ)).filter((n) => /^\d{4}-/.test(n));

for (const pacote of pacotes) {
  const base = join(RAIZ, pacote);
  const reproducoes = await lerJsonl(join(base, "reproducao.jsonl"));
  if (!reproducoes || reproducoes.length === 0) continue;
  let pcmUsuario;
  let pcmAssistente;
  try {
    pcmUsuario = decodificarWav(await readFile(join(base, "canal-usuario.wav")));
    pcmAssistente = decodificarWav(
      await readFile(join(base, "canal-assistente.wav"))
    );
  } catch {
    continue;
  }
  pacotesVivos += 1;
  const t0 = await t0DoPacote(base);

  const exclusoes = JSON.parse(
    await readFile(join(base, "corpus-excluir.json"), "utf8").catch(
      () => "[]"
    )
  );
  const excluido = (t) =>
    exclusoes.some((e) => t >= e.deS && t <= e.ateS);

  const bursts = segmentosAtivos(pcmUsuario);
  // Canal do assistente é sintético sobre silêncio digital: limiar
  // absoluto baixo basta e o piso é ~0.
  const falasAssistente = segmentosAtivos(pcmAssistente, {
    fatorLimiar: 3,
    minimoAbs: 0.004
  });

  // Metadados de reprodução no eixo aproximado do wav (só p/ rotular
  // kind/motivo do segmento mais próximo; tolerância 2,5s).
  const metadados = [];
  if (t0 !== null) {
    const porUid = new Map();
    for (const r of reproducoes) {
      if (r.evento === "inicio") {
        porUid.set(r.uid, {
          deAprox: (r.t - t0) / 1000,
          kind: r.kind ?? null,
          texto: r.texto ?? null,
          duracaoTotalS: r.duracaoS ?? null,
          motivo: null,
          posicaoS: null
        });
      } else if (r.evento === "fim" && porUid.has(r.uid)) {
        const m = porUid.get(r.uid);
        if (m.motivo === null) {
          m.motivo = r.motivo ?? "completou";
          m.posicaoS = r.posicaoS ?? null;
        }
      }
    }
    metadados.push(...porUid.values());
  }
  const metadadoDe = (segDe) => {
    let melhor = null;
    for (const m of metadados) {
      const d = Math.abs(m.deAprox - segDe);
      if (d <= 2.5 && (melhor === null || d < melhor.d)) {
        melhor = { ...m, d };
      }
    }
    return melhor;
  };

  for (const [fa, fb] of falasAssistente) {
    if (excluido(fa)) continue;
    const meta = metadadoDe(fa);
    const cortou = meta?.motivo === "cortado";
    for (const [ba, bb] of bursts) {
      const inicioSobre = Math.max(ba, fa);
      const fimSobre = Math.min(bb, fb);
      if (fimSobre - inicioSobre < 0.18) continue;
      if (excluido(inicioSobre)) continue;
      const burstDur = bb - ba;
      const usuarioLongo = burstDur >= 1.2;
      const usuarioJaFalava = ba < fa - 0.05 && bb > fa + 0.15;
      // Corte causal: o fim físico do segmento do assistente cai perto
      // do burst (durante, ou ≤1s depois do início do burst).
      const ehCausal =
        cortou && ba <= fb && fb - ba >= -0.1 && fb - ba <= 3 && bb >= fb - 0.3;
      let celula;
      if (usuarioJaFalava) {
        celula = "assistente-entrou-sobre-usuario";
      } else if (cortou && ehCausal) {
        celula = usuarioLongo ? "interrupcao-atendida" : "cedeu-a-burst-curto";
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
          Number((Math.min(ba, fa) - 2).toFixed(2)),
          Number((Math.max(bb, fb) + 1).toFixed(2))
        ],
        celula,
        burst: [Number(ba.toFixed(2)), Number(bb.toFixed(2))],
        burstDurS: Number(burstDur.toFixed(2)),
        sobreposicaoS: Number((fimSobre - inicioSobre).toFixed(2)),
        assistente: {
          seg: [Number(fa.toFixed(2)), Number(fb.toFixed(2))],
          kind: meta?.kind ?? null,
          texto: meta?.texto ? meta.texto.slice(0, 60) : null,
          cortou,
          reacaoMs: ehCausal ? Math.round((fb - ba) * 1000) : null,
          metaDeltaS: meta ? Number(meta.d.toFixed(2)) : null
        },
        confiancaRotulo:
          celula === "sobreposicao-nao-causal" ? 0.5 : meta ? 0.9 : 0.7,
        fonteRotulo: "energia-2-canais+metadado-reproducao"
      });
    }
  }
}

const porCelula = {};
const reacoes = [];
for (const m of momentos) {
  porCelula[m.celula] = (porCelula[m.celula] ?? 0) + 1;
  if (m.assistente.reacaoMs !== null) reacoes.push(m.assistente.reacaoMs);
}
reacoes.sort((a, b) => a - b);
const q = (p) =>
  reacoes[Math.min(reacoes.length - 1, Math.floor(reacoes.length * p))];

await writeFile(SAIDA, momentos.map((m) => JSON.stringify(m)).join("\n") + "\n");
console.log(
  `sobreposições v2: ${momentos.length} em ${pacotesVivos} pacotes vivos → ${SAIDA}`
);
console.log("células:", JSON.stringify(porCelula, null, 1));
if (reacoes.length) {
  console.log(
    `reação ao ceder (causal): p50=${q(0.5)}ms p90=${q(0.9)}ms (n=${reacoes.length})`
  );
}
