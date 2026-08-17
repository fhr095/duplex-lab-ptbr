// Gera FUNDOS CONTÍNUOS para a bancada de cena adversa (replay com
// --fundo): trilhas de ruído de fundo em PCM16LE mono 16 kHz headerless
// (.raw), determinísticas, gravadas em var/ (nunca versionadas — este
// gerador é o que se versiona).
//
//   node scripts/gerar-fundos-cena.mjs [--duracao-s 200]
//
// Fundos gerados:
//   burburinho-coraa.raw — "praça de alimentação": 3 camadas defasadas
//     de vozes PT-BR REAIS e independentes (clipes CORAA de avaliação —
//     CC BY-NC-ND: uso SÓ em avaliação local, jamais em produto/
//     distribuição, mesma regra do juiz de ASR).
//   ruido-rosa.raw — ruído rosa (ar-condicionado/ventilação genérica).
//   radio-falado.raw — UMA voz clara contínua (locutor Supertonic M2):
//     o eixo rádio/TV/vendedor — inteligível, confundível com turno.
//   anuncios-loja.raw — rajadas de anúncio (F2) a cada ~15 s sobre
//     silêncio: o alto-falante do mercado.
//   (os dois últimos exigem o sidecar Supertonic no ar — 8341; sem ele,
//   o gerador avisa e pula, mantendo os demais.)
//
// Música real NÃO é gerada aqui: usar diretamente a captura ambiente
// var/fora-do-corpus/2026-08-16-e2c0-mic3/mic-3.raw (16 min reais).

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const CORAA = resolve(RAIZ, "eval/generated/coraa/audio");
const DESTINO = resolve(RAIZ, "var/observador/testes/cena/fundos");
const SR = 16_000;

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const DURACAO_S = Number(arg("--duracao-s", "200"));
const TOTAL = Math.floor(DURACAO_S * SR);

// WAV mono 16 kHz (PCM16 ou float32) → Float32Array [-1,1]
function lerWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("não é WAV");
  }
  let offset = 12;
  let formato = 1;
  let bits = 16;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const tamanho = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      formato = buffer.readUInt16LE(offset + 8);
      if (buffer.readUInt16LE(offset + 10) !== 1) {
        throw new Error("WAV precisa ser mono");
      }
      if (buffer.readUInt32LE(offset + 12) !== SR) {
        throw new Error("WAV precisa ser 16 kHz");
      }
      bits = buffer.readUInt16LE(offset + 22);
    } else if (id === "data") {
      const dados = buffer.subarray(offset + 8, offset + 8 + tamanho);
      if (formato === 3 && bits === 32) {
        // cópia alinhada: o chunk data raramente cai em múltiplo de 4
        const alinhado = new ArrayBuffer(
          Math.floor(dados.byteLength / 4) * 4
        );
        new Uint8Array(alinhado).set(
          dados.subarray(0, alinhado.byteLength)
        );
        return new Float32Array(alinhado);
      }
      if (formato === 1 && bits === 16) {
        const saida = new Float32Array(Math.floor(dados.byteLength / 2));
        for (let i = 0; i < saida.length; i += 1) {
          saida[i] = dados.readInt16LE(i * 2) / 32_768;
        }
        return saida;
      }
      throw new Error(`formato WAV não suportado: fmt=${formato} bits=${bits}`);
    }
    offset += 8 + tamanho + (tamanho % 2);
  }
  throw new Error("WAV sem chunk data");
}

function paraPcm16(amostras) {
  const saida = Buffer.alloc(amostras.length * 2);
  for (let i = 0; i < amostras.length; i += 1) {
    const v = Math.max(-1, Math.min(1, amostras[i]));
    saida.writeInt16LE(Math.round(v * 32_767), i * 2);
  }
  return saida;
}

function rmsDbfs(amostras) {
  let soma = 0;
  for (const v of amostras) {
    soma += v * v;
  }
  const rms = Math.sqrt(soma / amostras.length);
  return rms <= 0 ? -120 : 20 * Math.log10(rms);
}

// Embaralhamento determinístico (LCG) — reprodutível sem Math.random.
function embaralhar(lista, semente) {
  const saida = [...lista];
  let estado = semente >>> 0;
  for (let i = saida.length - 1; i > 0; i -= 1) {
    estado = (estado * 1_664_525 + 1_013_904_223) >>> 0;
    const j = estado % (i + 1);
    [saida[i], saida[j]] = [saida[j], saida[i]];
  }
  return saida;
}

async function gerarBurburinho() {
  const arquivos = (await readdir(CORAA))
    .filter((nome) => nome.endsWith(".wav"))
    .sort();
  if (arquivos.length === 0) {
    throw new Error(`sem clipes CORAA em ${CORAA}`);
  }
  const clipes = [];
  for (const nome of arquivos) {
    clipes.push(lerWav(await readFile(resolve(CORAA, nome))));
  }
  // 3 camadas defasadas, cada uma com ordem própria dos clipes e ganho
  // decrescente — a soma soa como várias conversas simultâneas.
  const camadas = [
    { semente: 11, ganho: 0.5, offsetS: 0 },
    { semente: 23, ganho: 0.42, offsetS: 7 },
    { semente: 47, ganho: 0.35, offsetS: 13 }
  ];
  const mistura = new Float32Array(TOTAL);
  for (const camada of camadas) {
    const ordem = embaralhar(clipes, camada.semente);
    let posicao = Math.floor(camada.offsetS * SR);
    let indice = 0;
    while (posicao < TOTAL) {
      const clipe = ordem[indice % ordem.length];
      for (
        let i = 0;
        i < clipe.length && posicao + i < TOTAL;
        i += 1
      ) {
        mistura[posicao + i] += clipe[i] * camada.ganho;
      }
      posicao += clipe.length;
      indice += 1;
    }
  }
  return mistura;
}

function gerarRuidoRosa() {
  // Voss-McCartney com LCG determinístico; ~-26 dBFS RMS.
  const LINHAS = 8;
  const linhas = new Float32Array(LINHAS);
  let estado = 20_260_817 >>> 0;
  const aleatorio = () => {
    estado = (estado * 1_664_525 + 1_013_904_223) >>> 0;
    return estado / 4_294_967_296 - 0.5;
  };
  const saida = new Float32Array(TOTAL);
  for (let i = 0; i < TOTAL; i += 1) {
    for (let linha = 0; linha < LINHAS; linha += 1) {
      if (i % (1 << linha) === 0) {
        linhas[linha] = aleatorio();
      }
    }
    let soma = aleatorio();
    for (const v of linhas) {
      soma += v;
    }
    saida[i] = soma / (LINHAS + 1) * 0.35;
  }
  return saida;
}

// ---- fundos de voz clara via sidecar Supertonic (44,1 kHz → 16 kHz)

const SIDECAR = process.env.TTS_SIDECAR_URL?.trim() ||
  "http://127.0.0.1:8341";

function reamostrarPara16k(amostras, srOrigem) {
  if (srOrigem === SR) {
    return amostras;
  }
  const fator = srOrigem / SR;
  const saida = new Float32Array(Math.floor(amostras.length / fator));
  for (let i = 0; i < saida.length; i += 1) {
    const posicao = i * fator;
    const base = Math.floor(posicao);
    const fracao = posicao - base;
    const proximo = Math.min(base + 1, amostras.length - 1);
    saida[i] = amostras[base] * (1 - fracao) + amostras[proximo] * fracao;
  }
  return saida;
}

async function sintetizar(texto, voz) {
  const resposta = await fetch(`${SIDECAR}?voz=${voz}`, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: texto,
    signal: AbortSignal.timeout(60_000)
  });
  if (!resposta.ok) {
    throw new Error(`sidecar HTTP ${resposta.status}`);
  }
  const wav = Buffer.from(await resposta.arrayBuffer());
  const srOrigem = wav.readUInt32LE(24);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const tamanho = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      const dados = wav.subarray(offset + 8, offset + 8 + tamanho);
      const amostras = new Float32Array(Math.floor(dados.byteLength / 2));
      for (let i = 0; i < amostras.length; i += 1) {
        amostras[i] = dados.readInt16LE(i * 2) / 32_768;
      }
      return reamostrarPara16k(amostras, srOrigem);
    }
    offset += 8 + tamanho + (tamanho % 2);
  }
  throw new Error("WAV do sidecar sem chunk data");
}

const FRASES_LOCUTOR = [
  "E agora a previsão do tempo para a nossa região: a tarde segue com sol entre nuvens e temperatura na casa dos vinte e oito graus.",
  "No trânsito, as principais avenidas apresentam fluxo intenso no sentido centro, com lentidão perto do viaduto.",
  "Você está ouvindo a programação da tarde, e daqui a pouco a gente volta com mais música e as notícias do dia.",
  "O mercado abriu em alta nesta manhã, com destaque para o setor de tecnologia e para as exportações agrícolas.",
  "E não esqueça: neste fim de semana tem festival gastronômico na praça central, com entrada gratuita para toda a família.",
  "A pesquisa aponta que a maioria dos entrevistados prefere fazer compras no período da manhã, evitando as filas.",
  "Agora uma pausa rápida, e já voltamos com o quadro de esportes e os resultados da rodada de ontem à noite.",
  "As inscrições para os cursos gratuitos da prefeitura terminam na sexta-feira e podem ser feitas pela internet."
];
const FRASES_ANUNCIO = [
  "Atenção clientes: ofertas especiais no setor de eletrodomésticos, aproveitem, é só até o fim do dia!",
  "Promoção relâmpago no corredor cinco: leve três e pague dois em toda a linha de limpeza!",
  "Senhores clientes, o setor de hortifruti acaba de receber frutas fresquinhas com preços imperdíveis!",
  "Última chamada: a liquidação de inverno termina hoje, peças com até setenta por cento de desconto!",
  "Cliente Amanda, favor comparecer ao balcão de informações. Cliente Amanda, balcão de informações.",
  "Experimente hoje o combo da lanchonete: sanduíche, batata e refresco por um preço especial!"
];

async function gerarRadioFalado() {
  const partes = [];
  for (const frase of FRASES_LOCUTOR) {
    partes.push(await sintetizar(frase, "M2"));
  }
  const pausa = Math.floor(0.4 * SR);
  const saida = new Float32Array(TOTAL);
  let posicao = 0;
  let indice = 0;
  while (posicao < TOTAL) {
    const parte = partes[indice % partes.length];
    for (let i = 0; i < parte.length && posicao + i < TOTAL; i += 1) {
      saida[posicao + i] = parte[i] * 0.8;
    }
    posicao += parte.length + pausa;
    indice += 1;
  }
  return saida;
}

async function gerarAnuncios() {
  const partes = [];
  for (const frase of FRASES_ANUNCIO) {
    partes.push(await sintetizar(frase, "F2"));
  }
  const intervalo = Math.floor(15 * SR);
  const saida = new Float32Array(TOTAL);
  let posicao = Math.floor(3 * SR);
  let indice = 0;
  while (posicao < TOTAL) {
    const parte = partes[indice % partes.length];
    for (let i = 0; i < parte.length && posicao + i < TOTAL; i += 1) {
      saida[posicao + i] = parte[i];
    }
    posicao += intervalo;
    indice += 1;
  }
  return saida;
}

await mkdir(DESTINO, { recursive: true });
const burburinho = await gerarBurburinho();
await writeFile(
  resolve(DESTINO, "burburinho-coraa.raw"),
  paraPcm16(burburinho)
);
console.log(
  `burburinho-coraa.raw: ${DURACAO_S}s, RMS ${rmsDbfs(burburinho).toFixed(1)} dBFS`
);
const rosa = gerarRuidoRosa();
await writeFile(resolve(DESTINO, "ruido-rosa.raw"), paraPcm16(rosa));
console.log(
  `ruido-rosa.raw: ${DURACAO_S}s, RMS ${rmsDbfs(rosa).toFixed(1)} dBFS`
);
if (args.includes("--sem-tts")) {
  console.log("(--sem-tts: pulando radio-falado/anuncios-loja)");
} else {
  try {
    const radio = await gerarRadioFalado();
    await writeFile(resolve(DESTINO, "radio-falado.raw"), paraPcm16(radio));
    console.log(
      `radio-falado.raw: ${DURACAO_S}s, RMS ${rmsDbfs(radio).toFixed(1)} dBFS`
    );
    const anuncios = await gerarAnuncios();
    await writeFile(
      resolve(DESTINO, "anuncios-loja.raw"),
      paraPcm16(anuncios)
    );
    console.log(
      `anuncios-loja.raw: ${DURACAO_S}s, RMS ` +
        `${rmsDbfs(anuncios).toFixed(1)} dBFS`
    );
  } catch (erro) {
    console.log(
      `AVISO: sidecar Supertonic indisponível (${erro.message}) — ` +
        "radio-falado/anuncios-loja pulados (suba a engine ou o sidecar)"
    );
  }
}
console.log(`fundos em ${DESTINO} (música real: fora-do-corpus/mic-3.raw)`);
