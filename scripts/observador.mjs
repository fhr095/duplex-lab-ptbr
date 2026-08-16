#!/usr/bin/env node
// Harness do observador de experiência — transforma uma sessão gravada
// (OBSERVER=1) num pacote analisável e conduz a análise em DUAS passagens
// com ordem estrutural garantida:
//   1. `escutar`  — escuta perceptiva CEGA por modelo áudio-nativo (só o
//      áudio + identificação de falantes + objetivo; nada de logs) e
//      persistência do relato ANTES de qualquer diagnóstico;
//   2. `correlacionar` — só roda se a escuta cega já estiver persistida
//      (hash conferido) e junta cada momento percebido aos sinais técnicos.
//
// Comandos:
//   listar
//   empacotar     --sessao <nome|caminho>
//   retranscrever --sessao ... [--modelo-asr auto|medium|large-v3]
//   escutar       --sessao ... --autorizo-envio [--modelo gpt-audio]
//   correlacionar --sessao ...
//   excluir       --sessao ... --confirmo
//
// Privacidade: tudo local por padrão; `escutar` envia SOMENTE o áudio da
// mistura à API da OpenAI e exige autorização explícita via flag/env.

import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encodePcm16Wave, inspectWave } from "../src/audio/wav.mjs";
import { loadEnvFile } from "../src/config/load-env.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 16_000;

// ---------------------------------------------------------------- util --

function argumentos() {
  const [comando, ...resto] = process.argv.slice(2);
  const opcoes = {};
  for (let i = 0; i < resto.length; i += 1) {
    if (resto[i].startsWith("--")) {
      const chave = resto[i].slice(2);
      const proximo = resto[i + 1];
      if (proximo !== undefined && !proximo.startsWith("--")) {
        opcoes[chave] = proximo;
        i += 1;
      } else {
        opcoes[chave] = true;
      }
    }
  }
  return { comando, opcoes };
}

async function existe(caminho) {
  return stat(caminho).then(() => true, () => false);
}

async function lerJsonl(caminho) {
  if (!(await existe(caminho))) {
    return [];
  }
  const linhas = (await readFile(caminho, "utf8")).split("\n");
  const saida = [];
  for (const linha of linhas) {
    if (!linha.trim()) {
      continue;
    }
    try {
      saida.push(JSON.parse(linha));
    } catch {
      // linha corrompida (ex.: queda no meio da escrita) — ignora
    }
  }
  return saida;
}

function mmss(segundos) {
  const s = Math.max(0, Math.round(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:` +
    `${String(s % 60).padStart(2, "0")}`;
}

function decodificarWavMono(buffer) {
  const info = inspectWave(buffer);
  if (info.audioFormat !== 1 || info.bitsPerSample !== 16) {
    throw new TypeError("esperado WAV PCM16");
  }
  // localizar o chunk data de novo (inspectWave não expõe o offset)
  let offset = 12;
  let dataOffset = null;
  let dataSize = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const tamanho = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      dataOffset = offset + 8;
      dataSize = Math.min(tamanho, buffer.length - dataOffset);
      break;
    }
    offset += 8 + tamanho + (tamanho % 2);
  }
  const total = Math.floor(dataSize / 2 / info.channels);
  const mono = new Int16Array(total);
  for (let i = 0; i < total; i += 1) {
    let soma = 0;
    for (let c = 0; c < info.channels; c += 1) {
      soma += buffer.readInt16LE(
        dataOffset + (i * info.channels + c) * 2
      );
    }
    mono[i] = Math.round(soma / info.channels);
  }
  return { sampleRate: info.sampleRate, pcm: mono };
}

function reamostrar(pcm, deSr, paraSr) {
  if (deSr === paraSr) {
    return pcm;
  }
  const total = Math.floor((pcm.length * paraSr) / deSr);
  const saida = new Int16Array(total);
  for (let i = 0; i < total; i += 1) {
    const posicao = (i * deSr) / paraSr;
    const base = Math.floor(posicao);
    const fracao = posicao - base;
    const a = pcm[base] ?? 0;
    const b = pcm[base + 1] ?? a;
    saida[i] = Math.round(a + (b - a) * fracao);
  }
  return saida;
}

function int16ParaBuffer(pcm) {
  const buffer = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i += 1) {
    buffer.writeInt16LE(pcm[i], i * 2);
  }
  return buffer;
}

function saturar(valor) {
  return Math.max(-32_768, Math.min(32_767, valor));
}

async function resolverPacote(opcoes) {
  const alvo = opcoes.sessao;
  if (!alvo || alvo === true) {
    throw new Error("--sessao <nome|caminho> é obrigatório");
  }
  const candidatos = [
    isAbsolute(alvo) ? alvo : null,
    resolve(process.cwd(), alvo),
    resolve(RAIZ, "var/observador", alvo)
  ].filter(Boolean);
  for (const caminho of candidatos) {
    if (await existe(join(caminho, "manifesto.json"))) {
      return caminho;
    }
  }
  throw new Error(
    `pacote não encontrado (procurei manifesto.json em: ` +
      `${candidatos.join(", ")})`
  );
}

// ------------------------------------------------------------ empacotar --

async function empacotar(pacote) {
  const manifesto = JSON.parse(
    await readFile(join(pacote, "manifesto.json"), "utf8")
  );
  const eventos = await lerJsonl(join(pacote, "eventos.jsonl"));
  const reproducao = await lerJsonl(join(pacote, "reproducao.jsonl"));
  const pagina = await lerJsonl(join(pacote, "pagina.jsonl"));
  const marcas = await lerJsonl(join(pacote, "marcas.jsonl"));
  const sinteses = await lerJsonl(join(pacote, "assistente.jsonl"));
  const avisos = [];

  // 1. conexões de microfone: âncoras amostra↔relógio do servidor
  const conexoes = [];
  for (const nome of (await readdir(pacote)).sort()) {
    const casamento = /^mic-(\d+)\.raw$/u.exec(nome);
    if (!casamento) {
      continue;
    }
    const indice = await lerJsonl(
      join(pacote, `mic-${casamento[1]}.indice.jsonl`)
    );
    const ancoras = indice.filter((e) => e.tipo === "ancora");
    if (ancoras.length === 0) {
      avisos.push(`${nome}: sem âncoras — conexão ignorada`);
      continue;
    }
    const bruto = await readFile(join(pacote, nome));
    const pcm = new Int16Array(
      bruto.buffer,
      bruto.byteOffset,
      Math.floor(bruto.length / 2)
    );
    const a0 = ancoras[0];
    const tDaAmostra = (amostra) =>
      a0.t + ((amostra - a0.amostraInicio) * 1_000) / SR;
    const ultima = ancoras.at(-1);
    const desvio =
      ultima === a0
        ? 0
        : ultima.t - tDaAmostra(ultima.amostraInicio);
    if (Math.abs(desvio) > 250) {
      avisos.push(
        `${nome}: desvio de relógio de captura ${Math.round(desvio)}ms ` +
          `entre primeira e última âncora`
      );
    }
    const primeiraAmostra = a0.amostraInicio;
    conexoes.push({
      nome,
      pcm,
      tInicio: tDaAmostra(primeiraAmostra),
      tFim: tDaAmostra(primeiraAmostra + pcm.length)
    });
  }
  if (conexoes.length === 0) {
    throw new Error("nenhuma conexão de microfone gravada no pacote");
  }

  // 2. linha do tempo global
  // O fim do ÁUDIO é definido por mic + reproduções (+2 s de cauda);
  // eventos de processo/shutdown não devem esticar a mistura.
  const t0 = Math.min(...conexoes.map((c) => c.tInicio));
  const fins = [
    ...conexoes.map((c) => c.tFim),
    ...reproducao.map((r) => (r.t ?? 0) + 2_000)
  ];
  const tFim = Math.max(...fins);
  const totalAmostras = Math.ceil(((tFim - t0) / 1_000) * SR) + SR;

  // 3. canal do usuário (mic como a engine ouviu)
  const usuario = new Int16Array(totalAmostras);
  for (const conexao of conexoes) {
    const inicio = Math.round(((conexao.tInicio - t0) / 1_000) * SR);
    for (let i = 0; i < conexao.pcm.length; i += 1) {
      const destino = inicio + i;
      if (destino >= 0 && destino < totalAmostras) {
        usuario[destino] = conexao.pcm[i];
      }
    }
  }

  // 4. canal do assistente (sínteses arquivadas posicionadas pelos beacons
  //    de reprodução; cortes truncam na posição relatada)
  const assistente = new Int16Array(totalAmostras);
  const porUid = new Map();
  for (const entrada of reproducao) {
    const uid = entrada.uid ?? "";
    if (!porUid.has(uid)) {
      porUid.set(uid, {});
    }
    const grupo = porUid.get(uid);
    if (entrada.evento === "inicio" && !grupo.inicio) {
      grupo.inicio = entrada;
    }
    if (entrada.evento === "fim" && !grupo.fim) {
      grupo.fim = entrada;
    }
  }
  let reproduzidos = 0;
  for (const [uid, grupo] of porUid) {
    if (!grupo.inicio || !uid) {
      continue;
    }
    const arquivo = join(pacote, "assistente", `${uid}.wav`);
    if (!(await existe(arquivo))) {
      avisos.push(`reprodução sem WAV arquivado: uid ${uid}`);
      continue;
    }
    let decodificado;
    try {
      decodificado = decodificarWavMono(await readFile(arquivo));
    } catch (erro) {
      avisos.push(`WAV inválido (${uid}): ${erro.message}`);
      continue;
    }
    let pcm = reamostrar(
      decodificado.pcm,
      decodificado.sampleRate,
      SR
    );
    const fim = grupo.fim;
    if (
      fim &&
      fim.motivo !== "terminou" &&
      Number.isFinite(fim.posicaoS) &&
      fim.posicaoS > 0
    ) {
      pcm = pcm.subarray(0, Math.round(fim.posicaoS * SR));
    }
    const inicioAmostra = Math.round(
      ((grupo.inicio.t - t0) / 1_000) * SR
    );
    for (let i = 0; i < pcm.length; i += 1) {
      const destino = inicioAmostra + i;
      if (destino >= 0 && destino < totalAmostras) {
        assistente[destino] = saturar(assistente[destino] + pcm[i]);
      }
    }
    reproduzidos += 1;
  }

  // 5. misturas
  const misturaMono = new Int16Array(totalAmostras);
  const estereo = new Int16Array(totalAmostras * 2);
  for (let i = 0; i < totalAmostras; i += 1) {
    misturaMono[i] = saturar(usuario[i] + assistente[i]);
    estereo[i * 2] = usuario[i];
    estereo[i * 2 + 1] = assistente[i];
  }
  await writeFile(
    join(pacote, "canal-usuario.wav"),
    encodePcm16Wave(int16ParaBuffer(usuario), { sampleRate: SR })
  );
  await writeFile(
    join(pacote, "canal-assistente.wav"),
    encodePcm16Wave(int16ParaBuffer(assistente), { sampleRate: SR })
  );
  await writeFile(
    join(pacote, "mistura.wav"),
    encodePcm16Wave(int16ParaBuffer(misturaMono), { sampleRate: SR })
  );
  await writeFile(
    join(pacote, "mistura-estereo.wav"),
    encodePcm16Wave(int16ParaBuffer(estereo), {
      sampleRate: SR,
      channels: 2
    })
  );

  // 6. linha do tempo unificada (relógio do servidor, trel em segundos)
  const linhaDoTempo = [];
  for (const evento of eventos) {
    linhaDoTempo.push(evento);
  }
  for (const entrada of reproducao) {
    linhaDoTempo.push({ canal: "reproducao", ...entrada });
  }
  for (const entrada of pagina) {
    linhaDoTempo.push({ canal: "pagina", ...entrada });
  }
  for (const entrada of marcas) {
    linhaDoTempo.push({ canal: "marca", ...entrada });
  }
  for (const sintese of sinteses) {
    linhaDoTempo.push({
      canal: "tts.sintese",
      t: sintese.tInicio,
      ...sintese
    });
  }
  linhaDoTempo.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const linhas = linhaDoTempo
    .map((e) =>
      JSON.stringify({
        trel:
          Math.round((((e.t ?? t0) - t0) / 1_000) * 1_000) / 1_000,
        ...e
      })
    )
    .join("\n");
  await writeFile(join(pacote, "linha-do-tempo.jsonl"), `${linhas}\n`);

  const turnos = new Set(
    eventos
      .filter(
        (e) =>
          e.canal === "turno" &&
          e.type === "requisicao" &&
          e.stage === "full"
      )
      .map((e) => e.turnId)
  );
  const resumo = {
    t0,
    duracaoS: Math.round(((tFim - t0) / 1_000) * 10) / 10,
    conexoesMic: conexoes.length,
    turnosFull: turnos.size,
    sinteses: sinteses.length,
    reproducoesPosicionadas: reproduzidos,
    marcasHumanas: marcas.length,
    eventosPagina: pagina.length,
    avisos
  };
  await writeFile(
    join(pacote, "resumo.json"),
    `${JSON.stringify(resumo, null, 2)}\n`
  );
  console.log(JSON.stringify(resumo, null, 2));
  console.log(`pacote pronto: ${pacote}`);
  return resumo;
}

// -------------------------------------------------------- retranscrever --

async function retranscrever(pacote, opcoes) {
  for (const canal of ["usuario", "assistente"]) {
    if (!(await existe(join(pacote, `canal-${canal}.wav`)))) {
      throw new Error(
        `canal-${canal}.wav ausente — rode 'empacotar' primeiro`
      );
    }
  }
  const python = join(RAIZ, ".venv-obs/bin/python");
  if (!(await existe(python))) {
    throw new Error(
      ".venv-obs ausente — rode scripts/setup-observador.sh primeiro"
    );
  }
  const saida = join(pacote, "retranscricao.jsonl");
  await rm(saida, { force: true });
  for (const canal of ["usuario", "assistente"]) {
    console.log(`retranscrevendo canal ${canal}…`);
    await new Promise((resolvePromise, reject) => {
      const processo = spawn(
        python,
        [
          join(RAIZ, "scripts/observador_retranscrever.py"),
          "--entrada",
          join(pacote, `canal-${canal}.wav`),
          "--canal",
          canal,
          "--saida",
          saida,
          "--modelo",
          opcoes["modelo-asr"] ?? "auto"
        ],
        { stdio: ["ignore", "inherit", "inherit"] }
      );
      processo.once("error", reject);
      processo.once("exit", (codigo) =>
        codigo === 0
          ? resolvePromise()
          : reject(new Error(`retranscrição saiu com código ${codigo}`))
      );
    });
  }
  console.log(`retranscrição pronta: ${saida}`);
}

// ------------------------------------------------------------- escutar --

const ESCUTA_SYSTEM =
  "Você é um ouvinte humano atento avaliando a EXPERIÊNCIA de uma " +
  "conversa por voz em português brasileiro entre uma pessoa (o usuário) " +
  "e um assistente de voz por computador. O assistente fala com voz " +
  "sintética masculina; o usuário é a outra voz. Você recebe apenas o " +
  "áudio e não conhece nada da implementação — avalie somente o que um " +
  "ouvinte perceberia: naturalidade, fluidez, esperas, atropelos, " +
  "repetições, confusões, quebras de continuidade, qualidade e adequação " +
  "das respostas e da voz, e qualquer coisa notável (positiva ou " +
  "negativa), mesmo que não caiba em categorias comuns. Sempre localize " +
  "os momentos com timestamps mm:ss contados do INÍCIO DA CONVERSA e " +
  "cite trechos curtos de fala quando ajudar a localizar.";

function promptHolistico(objetivo, duracaoS) {
  return (
    `Objetivo geral da interação: ${objetivo}\n` +
    `Duração total: ${mmss(duracaoS)}.\n\n` +
    "Ouça a conversa inteira e responda em texto corrido, sempre com " +
    "timestamps mm:ss:\n" +
    "1. Impressão geral da experiência e nota de 0 a 10 (o que pesou).\n" +
    "2. Em quais momentos a conversa pareceu natural e convincente?\n" +
    "3. Onde deixou de parecer uma interação fluida (esperas, atropelos, " +
    "repetições, confusão, quebras de continuidade)?\n" +
    "4. Onde o assistente pareceu não acompanhar a pessoa?\n" +
    "5. Os 3 momentos que MAIS afetaram a experiência positivamente e os " +
    "3 que mais afetaram negativamente.\n" +
    "6. Algo notável que não caiba nas categorias acima?\n" +
    "7. Como um usuário comum provavelmente interpretaria o " +
    "comportamento do assistente nesta conversa?"
  );
}

function promptTrecho(objetivo, inicioS, fimS, duracaoS) {
  return (
    `Objetivo geral da interação: ${objetivo}\n` +
    `Este áudio é o TRECHO de ${mmss(inicioS)} a ${mmss(fimS)} de uma ` +
    `conversa com duração total ${mmss(duracaoS)}. Os timestamps da sua ` +
    `resposta devem ser ABSOLUTOS (some ${mmss(inicioS)} à posição ` +
    "dentro do trecho).\n\n" +
    "Liste os MOMENTOS notáveis deste trecho para a experiência do " +
    "usuário (bons e ruins). Responda SOMENTE com um array JSON, sem " +
    "texto fora dele, no formato:\n" +
    '[{"inicio":"mm:ss","fim":"mm:ss","categoria":"livre, nas suas ' +
    'palavras","descricao":"o que um ouvinte percebeu","citacao":"trecho ' +
    'curto de fala, se ajudar","impacto":-2 a 2,"confianca":0 a 1}]\n' +
    "Inclua também momentos positivos (impacto > 0). Se nada for " +
    "notável, responda []."
  );
}

function extrairJson(texto) {
  const inicio = texto.search(/[[{]/u);
  if (inicio === -1) {
    return null;
  }
  for (let fim = texto.length; fim > inicio; fim -= 1) {
    const candidato = texto.slice(inicio, fim);
    try {
      const valor = JSON.parse(candidato);
      if (Array.isArray(valor)) {
        return valor;
      }
      // leniência: {"momentos": [...]} ou objeto com algum array dentro
      if (valor && typeof valor === "object") {
        const lista = Object.values(valor).find(Array.isArray);
        return lista ?? [valor];
      }
      return valor;
    } catch {
      // tenta encurtar
    }
  }
  return null;
}

function mmssParaSegundos(valor) {
  const casamento = /^(\d{1,3}):(\d{2})$/u.exec(String(valor).trim());
  if (!casamento) {
    return null;
  }
  return Number(casamento[1]) * 60 + Number(casamento[2]);
}

async function chamarModeloAudio({ chave, modelo, pcm, prompt }) {
  const wav = encodePcm16Wave(int16ParaBuffer(pcm), { sampleRate: SR });
  const resposta = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${chave}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: modelo,
        modalities: ["text"],
        max_completion_tokens: 3_000,
        messages: [
          { role: "system", content: ESCUTA_SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "input_audio",
                input_audio: {
                  data: wav.toString("base64"),
                  format: "wav"
                }
              }
            ]
          }
        ]
      })
    }
  );
  const corpo = await resposta.json();
  if (!resposta.ok) {
    throw new Error(
      `modelo de áudio retornou HTTP ${resposta.status}: ` +
        `${corpo?.error?.message ?? "sem detalhe"}`
    );
  }
  return {
    texto: corpo.choices?.[0]?.message?.content ?? "",
    usage: corpo.usage ?? null
  };
}

async function escolherModeloAudio(chave, preferido) {
  if (preferido) {
    return preferido;
  }
  const resposta = await fetch("https://api.openai.com/v1/models", {
    headers: { authorization: `Bearer ${chave}` }
  });
  const corpo = await resposta.json();
  const ids = new Set(
    (corpo.data ?? []).map((m) => m.id).filter(Boolean)
  );
  for (const candidato of [
    "gpt-audio-1.5",
    "gpt-audio",
    "gpt-audio-mini",
    "gpt-4o-audio-preview"
  ]) {
    if (ids.has(candidato)) {
      return candidato;
    }
  }
  const generico = [...ids].find(
    (id) =>
      id.includes("audio") &&
      !id.includes("realtime") &&
      !id.includes("transcribe") &&
      !id.includes("tts")
  );
  if (!generico) {
    throw new Error("nenhum modelo áudio-nativo disponível na conta");
  }
  return generico;
}

function estimarCustoUsd(usos) {
  // Estimativa local (referência gpt-4o-audio: US$40/M tokens de áudio de
  // entrada, US$2.5/M texto de entrada, US$10/M texto de saída). Conferir
  // na fatura — modelos gpt-audio podem ter preço diferente.
  let total = 0;
  for (const uso of usos) {
    if (!uso) {
      continue;
    }
    const audioIn = uso.prompt_tokens_details?.audio_tokens ?? 0;
    const textoIn = (uso.prompt_tokens ?? 0) - audioIn;
    const saida = uso.completion_tokens ?? 0;
    total +=
      (audioIn * 40 + textoIn * 2.5 + saida * 10) / 1_000_000;
  }
  return Math.round(total * 100) / 100;
}

async function escutar(pacote, opcoes) {
  // Trava de privacidade: enviar áudio para fora exige autorização
  // explícita de quem conduz a análise. --simulado NUNCA envia nada:
  // gera uma escuta fictícia rotulada, só para validar o encanamento.
  const simulado = opcoes.simulado === true;
  if (
    !simulado &&
    opcoes["autorizo-envio"] !== true &&
    process.env.OBSERVADOR_AUTORIZA_ENVIO !== "1"
  ) {
    throw new Error(
      "escutar envia o áudio da sessão à API da OpenAI; rode com " +
        "--autorizo-envio (ou OBSERVADOR_AUTORIZA_ENVIO=1) após decidir " +
        "que este áudio pode sair da máquina"
    );
  }
  const caminhoEscuta = join(pacote, "escuta");
  const arquivoEscuta = join(caminhoEscuta, "escuta-cega.json");
  if ((await existe(arquivoEscuta)) && opcoes.refazer !== true) {
    throw new Error(
      "escuta-cega.json já existe — use --refazer para uma nova passada"
    );
  }
  if (!(await existe(join(pacote, "mistura.wav")))) {
    throw new Error("mistura.wav ausente — rode 'empacotar' primeiro");
  }
  // Passagem CEGA por construção: este comando só abre mistura.wav e o
  // objetivo do manifesto — nunca logs, transcrições ou métricas.
  const manifesto = JSON.parse(
    await readFile(join(pacote, "manifesto.json"), "utf8")
  );
  const objetivo = manifesto.objetivo ?? "conversa com assistente de voz";
  const { pcm: pcmCompleto } = decodificarWavMono(
    await readFile(join(pacote, "mistura.wav"))
  );
  const duracaoTotalS = pcmCompleto.length / SR;
  // Janela de escuta (--desde/--ate, "mm:ss" ou segundos): pacotes de
  // processo longo são quase todo silêncio entre sessões — sem janela, a
  // mistura de horas estoura o modelo de áudio (HTTP 500 real no pacote
  // a6c1, 197 min). O recorte é só do ÁUDIO OUVIDO; todos os tempos
  // persistidos permanecem ABSOLUTOS do pacote (correlação intacta).
  const paraSegundos = (valor) => {
    if (valor === undefined || valor === true) return null;
    const texto = String(valor);
    if (/^\d+:\d{2}(?::\d{2})?$/u.test(texto)) {
      const partes = texto.split(":").map(Number);
      return partes.length === 3
        ? partes[0] * 3600 + partes[1] * 60 + partes[2]
        : partes[0] * 60 + partes[1];
    }
    const n = Number(texto);
    return Number.isFinite(n) ? n : null;
  };
  const desdeS = Math.max(0, paraSegundos(opcoes.desde) ?? 0);
  const ateS = Math.min(
    duracaoTotalS,
    paraSegundos(opcoes.ate) ?? duracaoTotalS
  );
  if (ateS - desdeS < 3) {
    throw new Error("janela --desde/--ate menor que 3 s");
  }
  const pcm = pcmCompleto.subarray(
    Math.round(desdeS * SR),
    Math.round(ateS * SR)
  );
  const duracaoS = pcm.length / SR;
  if (duracaoS < 3) {
    throw new Error("mistura.wav tem menos de 3 s — nada para escutar");
  }

  await loadEnvFile();
  const chave = process.env.OPENAI_API_KEY;
  if (!simulado && !chave) {
    throw new Error("OPENAI_API_KEY ausente no ambiente/.env");
  }
  const modelo = simulado
    ? "SIMULADO/ensaio (nenhum áudio saiu da máquina)"
    : await escolherModeloAudio(
        chave,
        typeof opcoes.modelo === "string" ? opcoes.modelo : null
      );
  console.log(
    `escuta cega com ${modelo} · ${mmss(duracaoS)} de áudio`
  );

  const passadas = [];
  const usos = [];
  const ouvir = simulado
    ? async ({ prompt }) => ({
        texto: prompt.includes("array JSON")
          ? JSON.stringify([
              {
                inicio: mmss(Math.min(6, duracaoS / 2)),
                fim: mmss(Math.min(9, duracaoS)),
                categoria: "simulado",
                descricao:
                  "momento fictício gerado pelo modo --simulado para " +
                  "validar o encanamento; NÃO é uma percepção real",
                citacao: "",
                impacto: -1,
                confianca: 0.1
              }
            ])
          : "ESCUTA SIMULADA (--simulado): nenhum modelo ouviu este " +
            "áudio; relato fictício apenas para validar o fluxo.",
        usage: null
      })
    : chamarModeloAudio;

  // Passada A — holística (arquivo inteiro; cap de 9,5 min por request)
  const capA = Math.min(pcm.length, Math.round(570 * SR));
  const holistica = await ouvir({
    chave,
    modelo,
    pcm: pcm.subarray(0, capA),
    prompt: promptHolistico(objetivo, duracaoS)
  });
  usos.push(holistica.usage);
  passadas.push({
    tipo: "holistica",
    audioDe: desdeS,
    audioAte: desdeS + capA / SR,
    truncada: capA < pcm.length,
    prompt: promptHolistico(objetivo, duracaoS),
    resposta: holistica.texto,
    usage: holistica.usage
  });
  console.log("passada holística concluída");

  // Passada B — momentos por trecho (75 s, passo 70 s)
  const momentos = [];
  const janela = 75 * SR;
  const passo = 70 * SR;
  for (let inicio = 0; inicio < pcm.length; inicio += passo) {
    let fim = Math.min(inicio + janela, pcm.length);
    if (pcm.length - fim < 20 * SR) {
      fim = pcm.length;
    }
    const prompt = promptTrecho(
      objetivo,
      desdeS + inicio / SR,
      desdeS + fim / SR,
      desdeS + duracaoS
    );
    const trecho = await ouvir({
      chave,
      modelo,
      pcm: pcm.subarray(inicio, fim),
      prompt
    });
    usos.push(trecho.usage);
    const itens = extrairJson(trecho.texto);
    passadas.push({
      tipo: "trecho",
      audioDe: desdeS + inicio / SR,
      audioAte: desdeS + fim / SR,
      prompt,
      resposta: trecho.texto,
      usage: trecho.usage,
      momentosExtraidos: Array.isArray(itens) ? itens.length : null
    });
    if (Array.isArray(itens)) {
      for (const item of itens) {
        momentos.push({
          ...item,
          inicioS: mmssParaSegundos(item.inicio),
          fimS: mmssParaSegundos(item.fim) ?? mmssParaSegundos(item.inicio),
          trecho: [desdeS + inicio / SR, desdeS + fim / SR]
        });
      }
    }
    console.log(
      `trecho ${mmss(desdeS + inicio / SR)}–${mmss(desdeS + fim / SR)}: ` +
        `${Array.isArray(itens) ? itens.length : "?"} momento(s)`
    );
    if (fim === pcm.length) {
      break;
    }
  }

  const custo = estimarCustoUsd(usos);
  const escuta = {
    versao: "escuta-cega-v0.1",
    modelo,
    executadoEm: new Date().toISOString(),
    autorizadoPor: simulado
      ? "MODO SIMULADO — nenhum envio externo ocorreu"
      : opcoes["autorizo-envio"] === true
        ? "flag --autorizo-envio"
        : "env OBSERVADOR_AUTORIZA_ENVIO=1",
    objetivo,
    duracaoS,
    janelaOuvida: { desdeS, ateS, duracaoTotalS },
    cega:
      "esta passada usou SOMENTE mistura.wav + objetivo do manifesto; " +
      "nenhum log, transcrição ou métrica foi lida antes dela",
    custoEstimadoUsd: custo,
    passadas,
    momentos
  };
  await mkdir(caminhoEscuta, { recursive: true });
  const destino = opcoes.refazer === true && (await existe(arquivoEscuta))
    ? join(caminhoEscuta, `escuta-cega-r${Date.now()}.json`)
    : arquivoEscuta;
  const serializado = `${JSON.stringify(escuta, null, 2)}\n`;
  await writeFile(destino, serializado);
  await writeFile(
    `${destino.replace(/\.json$/u, "")}.sha256`,
    `${createHash("sha256").update(serializado).digest("hex")}\n`
  );

  const md = [
    `# Escuta cega — ${manifesto.sessao ?? basename(pacote)}`,
    "",
    `Modelo: ${modelo} · ${mmss(duracaoS)} · custo estimado ` +
      `US$${custo} (conferir fatura)`,
    "",
    "## Passada holística",
    "",
    holistica.texto,
    "",
    "## Momentos por trecho",
    "",
    ...momentos.map(
      (m) =>
        `- **${m.inicio ?? "?"}${m.fim && m.fim !== m.inicio ? `–${m.fim}` : ""}** ` +
        `(impacto ${m.impacto ?? "?"}, confiança ${m.confianca ?? "?"}) ` +
        `${m.categoria ?? ""}: ${m.descricao ?? ""}` +
        (m.citacao ? ` — «${m.citacao}»` : "")
    ),
    ""
  ].join("\n");
  await writeFile(
    join(caminhoEscuta, "escuta-cega.md"),
    md
  );
  console.log(
    `escuta cega persistida (${momentos.length} momentos, ` +
      `US$${custo} estimado): ${destino}`
  );
}

// ------------------------------------------------------- correlacionar --

async function correlacionar(pacote) {
  const arquivoEscuta = join(pacote, "escuta/escuta-cega.json");
  if (!(await existe(arquivoEscuta))) {
    throw new Error(
      "ordem obrigatória violada: a escuta perceptiva cega ainda não " +
        "foi persistida (escuta/escuta-cega.json) — rode 'escutar' antes " +
        "de qualquer diagnóstico técnico"
    );
  }
  const serializado = await readFile(arquivoEscuta, "utf8");
  const hashAtual = createHash("sha256")
    .update(serializado)
    .digest("hex");
  const hashGravado = (
    await readFile(
      join(pacote, "escuta/escuta-cega.sha256"),
      "utf8"
    ).catch(() => "")
  ).trim();
  if (hashGravado && hashGravado !== hashAtual) {
    throw new Error(
      "escuta-cega.json foi alterada após a persistência (hash difere) — " +
        "refaça a escuta ou restaure o arquivo original"
    );
  }
  const escuta = JSON.parse(serializado);
  const linhaDoTempo = await lerJsonl(
    join(pacote, "linha-do-tempo.jsonl")
  );
  const retranscricao = await lerJsonl(
    join(pacote, "retranscricao.jsonl")
  );
  const resumo = JSON.parse(
    await readFile(join(pacote, "resumo.json"), "utf8")
  );

  const naJanela = (lista, de, ate, campoInicio, campoFim) =>
    lista.filter((item) => {
      const inicio = item[campoInicio];
      const fim = item[campoFim] ?? inicio;
      return Number.isFinite(inicio) && fim >= de && inicio <= ate;
    });

  // Dossiê técnico por momento percebido
  const dossies = [];
  for (const momento of escuta.momentos ?? []) {
    if (!Number.isFinite(momento.inicioS)) {
      dossies.push({ momento, erro: "timestamp ilegível" });
      continue;
    }
    const de = momento.inicioS - 4;
    const ate = (momento.fimS ?? momento.inicioS) + 4;
    const eventos = naJanela(linhaDoTempo, de, ate, "trel", "trel");
    const relevantes = eventos.filter((e) =>
      [
        "turno",
        "reproducao",
        "marca",
        "tts.sintese"
      ].includes(e.canal) ||
      (e.canal === "ws" &&
        /transcript|endpoint|speech|error|prefinal/u.test(
          e.type ?? ""
        ))
    );
    dossies.push({
      momento,
      janela: [Math.max(0, de), ate],
      falaUsuario: naJanela(
        retranscricao.filter((r) => r.canal === "usuario"),
        de,
        ate,
        "inicio",
        "fim"
      ).map((r) => ({ inicio: r.inicio, fim: r.fim, texto: r.texto })),
      falaAssistente: naJanela(
        retranscricao.filter((r) => r.canal === "assistente"),
        de,
        ate,
        "inicio",
        "fim"
      ).map((r) => ({ inicio: r.inicio, fim: r.fim, texto: r.texto })),
      marcasHumanas: relevantes.filter((e) => e.canal === "marca"),
      eventos: relevantes.map((e) => ({
        trel: e.trel,
        canal: e.canal,
        tipo: e.type ?? e.tipo ?? e.evento ?? null,
        resumo:
          e.canal === "turno"
            ? e.type === "delta"
              ? `delta ${String(e.delta ?? "").slice(0, 60)}`
              : `${e.type} ${e.mode ?? ""} ` +
                `${e.fastPath ? JSON.stringify(e.fastPath) : ""} ` +
                `${e.model ?? ""}`.trim()
            : e.canal === "reproducao"
              ? `${e.evento} ${e.kind ?? ""} ${e.motivo ?? ""} ` +
                `${String(e.texto ?? "").slice(0, 50)}`.trim()
              : e.canal === "tts.sintese"
                ? `síntese ${String(e.texto ?? "").slice(0, 50)}`
                : e.canal === "marca"
                  ? `${e.tipo ?? ""}${e.nota ? ` (${e.nota})` : ""}`
                  : `${e.type ?? ""} ${String(
                      e.text ?? e.detail ?? ""
                    ).slice(0, 60)}`.trim()
      }))
    });
  }
  await mkdir(join(pacote, "correlacao"), { recursive: true });
  await writeFile(
    join(pacote, "correlacao/dossies.jsonl"),
    `${dossies.map((d) => JSON.stringify(d)).join("\n")}\n`
  );

  // Latência por turno full: fim do endpoint → primeiro áudio semântico
  const turnos = new Map();
  for (const evento of linhaDoTempo) {
    if (evento.canal === "turno" && evento.turnId) {
      if (!turnos.has(evento.turnId)) {
        turnos.set(evento.turnId, {});
      }
      const turno = turnos.get(evento.turnId);
      if (evento.type === "requisicao" && evento.stage === "full") {
        turno.requisicao = evento.trel;
        turno.texto = evento.texto;
      }
      if (evento.type === "route" && !turno.rota) {
        turno.rota = evento.mode;
        turno.fastPath = evento.fastPath ?? null;
      }
      if (evento.type === "delta" && turno.primeiroDelta === undefined) {
        turno.primeiroDelta = evento.trel;
      }
    }
  }
  const reproducoesSemanticas = linhaDoTempo.filter(
    (e) =>
      e.canal === "reproducao" &&
      e.evento === "inicio" &&
      !["fast-ack", "backchannel"].includes(e.kind)
  );
  const tabelaTurnos = [...turnos.entries()]
    .filter(([, turno]) => Number.isFinite(turno.requisicao))
    .map(([turnId, turno]) => {
      const audio = reproducoesSemanticas.find(
        (r) => r.trel >= turno.requisicao
      );
      return {
        turnId,
        trel: turno.requisicao,
        texto: String(turno.texto ?? "").slice(0, 60),
        rota: turno.rota ?? null,
        fastPath: turno.fastPath ?? null,
        requisicaoParaPrimeiroDeltaS: Number.isFinite(turno.primeiroDelta)
          ? Math.round((turno.primeiroDelta - turno.requisicao) * 100) /
            100
          : null,
        requisicaoParaAudioS: audio
          ? Math.round((audio.trel - turno.requisicao) * 100) / 100
          : null
      };
    })
    .sort((a, b) => a.trel - b.trel);

  // Anomalias técnicas fora dos momentos percebidos
  const percebidos = (escuta.momentos ?? [])
    .filter((m) => Number.isFinite(m.inicioS))
    .map((m) => [m.inicioS - 4, (m.fimS ?? m.inicioS) + 4]);
  const foraDaPercepcao = (trel) =>
    !percebidos.some(([de, ate]) => trel >= de && trel <= ate);
  const anomalias = linhaDoTempo.filter(
    (e) =>
      (e.canal === "ws" && /error|lacuna/u.test(e.type ?? "")) ||
      (e.canal === "sys" &&
        ((e.atrasoMs ?? 0) > 250 || (e.livreMb ?? 9_999) < 300)) ||
      (e.canal === "tts.sintese" && (e.erro || e.interrompido)) ||
      (e.canal === "turno" && e.type === "error")
  );

  // Relatório-base: fatos mecânicos organizados; a análise causal e as
  // inferências ficam para o relatório final (autoria do agente).
  const md = [
    `# Relatório-base — ${basename(pacote)}`,
    "",
    `Duração ${mmss(resumo.duracaoS)} · ${resumo.turnosFull} turnos · ` +
      `${resumo.marcasHumanas} marcações humanas · escuta cega: ` +
      `${escuta.modelo} (${(escuta.momentos ?? []).length} momentos)`,
    "",
    "Camadas separadas: (1) FATOS = linha-do-tempo/latências; (2) " +
    "ESCUTA = o que o ouvido cego relatou; (3) HUMANO = marcações da " +
    "pessoa; (4) INFERÊNCIAS = só no relatório final, com confiança.",
    "",
    "## Latência por turno (fatos)",
    "",
    "| trel | rota | fastPath | req→1º delta | req→áudio | texto |",
    "|---|---|---|---|---|---|",
    ...tabelaTurnos.map(
      (t) =>
        `| ${mmss(t.trel)} | ${t.rota ?? "?"} | ` +
        `${t.fastPath ? t.fastPath.action : "—"} | ` +
        `${t.requisicaoParaPrimeiroDeltaS ?? "—"}s | ` +
        `${t.requisicaoParaAudioS ?? "—"}s | ${t.texto} |`
    ),
    "",
    "## Momentos percebidos × sinais técnicos",
    "",
    ...dossies.flatMap((d) => {
      if (d.erro) {
        return [
          `### (timestamp ilegível) ${d.momento.descricao ?? ""}`,
          ""
        ];
      }
      return [
        `### ${mmss(d.momento.inicioS)} · impacto ` +
          `${d.momento.impacto ?? "?"} · ${d.momento.categoria ?? ""}`,
        "",
        `Escuta: ${d.momento.descricao ?? ""}` +
          (d.momento.citacao ? ` — «${d.momento.citacao}»` : ""),
        "",
        d.falaUsuario.length
          ? `Usuário (retranscrição): ${d.falaUsuario
              .map((f) => `[${mmss(f.inicio)}] ${f.texto}`)
              .join(" · ")}`
          : "Usuário (retranscrição): —",
        d.falaAssistente.length
          ? `Assistente (retranscrição): ${d.falaAssistente
              .map((f) => `[${mmss(f.inicio)}] ${f.texto}`)
              .join(" · ")}`
          : "Assistente (retranscrição): —",
        d.marcasHumanas.length
          ? `Marcações humanas na janela: ${d.marcasHumanas
              .map((m) => `${m.tipo}${m.nota ? ` (${m.nota})` : ""}`)
              .join(", ")}`
          : "",
        "",
        "Eventos na janela:",
        ...d.eventos
          .slice(0, 40)
          .map((e) => `- ${mmss(e.trel)} ${e.canal} ${e.resumo}`),
        ""
      ].filter((linha) => linha !== "");
    }),
    "## Anomalias técnicas (com e sem percepção associada)",
    "",
    ...(anomalias.length
      ? anomalias.map(
          (a) =>
            `- ${mmss(a.trel)} [${a.canal}] ` +
            `${a.type ?? a.tipo ?? ""} ` +
            `${a.erro ?? a.message ?? ""} ` +
            `${a.atrasoMs ? `atraso ${a.atrasoMs}ms` : ""} ` +
            `${a.livreMb ? `livre ${a.livreMb}MB` : ""}`.trim() +
            `${foraDaPercepcao(a.trel) ? " · (fora dos momentos percebidos)" : ""}`
        )
      : ["- nenhuma anomalia registrada"]),
    ""
  ].join("\n");
  await writeFile(join(pacote, "correlacao/relatorio-base.md"), md);
  console.log(
    `correlação pronta: ${dossies.length} dossiês, ` +
      `${tabelaTurnos.length} turnos, ${anomalias.length} anomalias → ` +
      `${join(pacote, "correlacao/relatorio-base.md")}`
  );
}

// -------------------------------------------------------------- outros --

async function listar() {
  const raiz = join(RAIZ, "var/observador");
  if (!(await existe(raiz))) {
    console.log("nenhum pacote (var/observador vazio)");
    return;
  }
  for (const nome of (await readdir(raiz)).sort()) {
    const pacote = join(raiz, nome);
    if (!(await existe(join(pacote, "manifesto.json")))) {
      continue;
    }
    const resumo = await readFile(join(pacote, "resumo.json"), "utf8")
      .then((texto) => JSON.parse(texto))
      .catch(() => null);
    const escutado = await existe(
      join(pacote, "escuta/escuta-cega.json")
    );
    console.log(
      `${nome} · ${resumo ? `${mmss(resumo.duracaoS)}, ` +
        `${resumo.turnosFull} turnos` : "não empacotado"}` +
        `${escutado ? " · escuta ok" : ""}`
    );
  }
}

async function excluir(pacote, opcoes) {
  if (opcoes.confirmo !== true) {
    throw new Error(
      `exclusão de ${pacote} requer --confirmo (irreversível)`
    );
  }
  await rm(pacote, { recursive: true, force: true });
  console.log(`excluído: ${pacote}`);
}

// ---------------------------------------------------------------- main --

const { comando, opcoes } = argumentos();
try {
  if (comando === "listar" || comando === undefined) {
    await listar();
  } else if (comando === "empacotar") {
    await empacotar(await resolverPacote(opcoes));
  } else if (comando === "retranscrever") {
    await retranscrever(await resolverPacote(opcoes), opcoes);
  } else if (comando === "escutar") {
    await escutar(await resolverPacote(opcoes), opcoes);
  } else if (comando === "correlacionar") {
    await correlacionar(await resolverPacote(opcoes));
  } else if (comando === "excluir") {
    await excluir(await resolverPacote(opcoes), opcoes);
  } else {
    throw new Error(
      `comando desconhecido: ${comando} (use listar, empacotar, ` +
        `retranscrever, escutar, correlacionar, excluir)`
    );
  }
} catch (erro) {
  console.error(`erro: ${erro.message}`);
  process.exit(1);
}
