// Leito do detector "AMBIENTE DE VOZES" — features GRÁTIS computáveis
// ao vivo, extraídas dos eventos de pacotes de replay (rótulo perfeito:
// sabemos qual fundo tocava em cada conexão).
//
//   node var/observador/testes/cena/fundos/leito-ambiente-vozes.mjs \
//     <pacote>:<conexao>:<rotulo> [...mais triplas]
//   (1 linha por tripla)
//
// Features por conexão (janela = duração toda da conexão):
//   dutyVad    — fração do tempo com VAD em fala (máquina de estados
//                sobre user.speech.started/paused/resumed + fim)
//   fracShadow — fração das janelas do silero shadow com prob > 0,5
//                (contínuo, existe nos replays; ao vivo exigiria
//                VAD_SHADOW=silero — custo já medido)
//   maiorFalaS — maior trecho contínuo em fala (s)

import { readFileSync } from "node:fs";

function medir(pacote, conexaoAlvo, rotulo) {
  const linhas = readFileSync(`${pacote}/eventos.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((linha) => {
      try {
        return JSON.parse(linha);
      } catch {
        return {};
      }
    })
    .filter((evento) => evento.conexao === Number(conexaoAlvo));

  if (linhas.length === 0) {
    console.log(`${rotulo}: conexão ${conexaoAlvo} vazia em ${pacote}`);
    return;
  }

  const t0 = linhas[0].t;
  const tFim = linhas.at(-1).t;
  let falando = false;
  let desdeT = t0;
  let tempoFala = 0;
  let maiorFala = 0;
  for (const evento of linhas) {
    const tipo = evento.type ?? "";
    if (
      tipo === "user.speech.started" ||
      tipo === "user.speech.resumed"
    ) {
      if (!falando) {
        falando = true;
        desdeT = evento.t;
      }
    } else if (
      tipo === "user.speech.paused" ||
      tipo === "transcript.final" ||
      tipo === "transcript.cancelled"
    ) {
      if (falando) {
        falando = false;
        const trecho = evento.t - desdeT;
        tempoFala += trecho;
        maiorFala = Math.max(maiorFala, trecho);
      }
    }
  }
  if (falando) {
    const trecho = tFim - desdeT;
    tempoFala += trecho;
    maiorFala = Math.max(maiorFala, trecho);
  }

  const shadow = linhas.filter((e) => e.type === "vad.shadow.window");
  const shadowAltas = shadow.filter((e) => e.probability > 0.5).length;

  // Duty ROLANTE de 60 s (passo 10 s): o formato do gatilho ao vivo —
  // reconstruído dos intervalos de fala.
  const intervalos = [];
  falando = false;
  for (const evento of linhas) {
    const tipo = evento.type ?? "";
    if (
      (tipo === "user.speech.started" ||
        tipo === "user.speech.resumed") &&
      !falando
    ) {
      falando = true;
      desdeT = evento.t;
    } else if (
      (tipo === "user.speech.paused" ||
        tipo === "transcript.final" ||
        tipo === "transcript.cancelled") &&
      falando
    ) {
      falando = false;
      intervalos.push([desdeT, evento.t]);
    }
  }
  if (falando) {
    intervalos.push([desdeT, tFim]);
  }
  let maxDuty60 = 0;
  for (let inicio = t0; inicio + 60_000 <= tFim; inicio += 10_000) {
    const fim = inicio + 60_000;
    let fala = 0;
    for (const [a, b] of intervalos) {
      fala += Math.max(0, Math.min(b, fim) - Math.max(a, inicio));
    }
    maxDuty60 = Math.max(maxDuty60, fala / 60_000);
  }

  const duracaoS = (tFim - t0) / 1_000;
  console.log(
    [
      rotulo ?? "?",
      `${pacote.split("/").at(-1)}#${conexaoAlvo}`,
      `dur ${duracaoS.toFixed(0)}s`,
      `dutyVad ${(tempoFala / (tFim - t0)).toFixed(3)}`,
      `maxDuty60 ${duracaoS >= 60 ? maxDuty60.toFixed(3) : "curto"}`,
      `fracShadow>0.5 ${
        shadow.length > 0
          ? (shadowAltas / shadow.length).toFixed(3)
          : "s/shadow"
      }`,
      `maiorFala ${(maiorFala / 1_000).toFixed(1)}s`
    ].join(" · ")
  );
}

for (const tripla of process.argv.slice(2)) {
  const [pacote, conexao, rotulo] = tripla.split(":");
  medir(pacote, conexao, rotulo);
}
