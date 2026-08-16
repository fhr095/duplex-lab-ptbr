// Leito de avaliação da frente percepção: extrai MOMENTOS INTERACIONAIS
// rotuláveis das gravações reais (eventos do observador), SEM dar
// autoridade à decisão da engine — ela entra como hipótese; o DESFECHO
// observável é o rótulo forte.
//
// Classes v0:
//   fim-real            pausa → commit → resposta, sem retomada em 3 s
//   hesitacao           pausa → usuário retoma em <2,5 s (não era fim)
//   fim-falso-commit    commit disparou mas usuário retomou <1,5 s depois
//   sobreposicao        fala do usuário ENQUANTO áudio do assistente toca
//                       (desfecho separa backchannel×interrupção)
//   correcao-textual    final começando com marcador de correção
//
// Saída: momentos.jsonl {pacote, classe, t, janela:[a,b], decisaoEngine,
// desfecho, confiancaRotulo, fonteRotulo} — janelas em segundos do
// pacote; áudio fatiado sob demanda pelos challengers.
//
// Uso: node extrair-momentos.mjs <dirGravacoes> <saida.jsonl>

import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const [, , RAIZ, SAIDA] = process.argv;
if (!RAIZ || !SAIDA) {
  console.error("uso: node extrair-momentos.mjs <dirGravacoes> <saida>");
  process.exit(1);
}

const MARCA_CORRECAO =
  /^(n[aã]o[,.]?\s|na verdade|n[aã]o é isso|errado|corrig|quis dizer|pera|calma)/iu;

async function lerJsonl(caminho) {
  try {
    const texto = await readFile(caminho, "utf8");
    return texto.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return null;
  }
}

const momentos = [];
const pacotes = (await readdir(RAIZ)).filter((n) => /^\d{4}-/.test(n));

for (const pacote of pacotes) {
  const base = join(RAIZ, pacote);
  const eventos = await lerJsonl(join(base, "eventos.jsonl"));
  if (!eventos) continue;
  const manifesto = JSON.parse(
    await readFile(join(base, "manifesto.json"), "utf8").catch(() => "{}")
  );
  const t0 = manifesto.t0 ?? eventos[0]?.t ?? 0;
  const rel = (e) => ((e.t ?? 0) - t0) / 1000;

  // Reproduções do assistente = janelas em que ELE estava falando.
  const reproducoes = (await lerJsonl(join(base, "reproducao.jsonl"))) ?? [];
  const janelasAssistente = [];
  for (const r of reproducoes) {
    const a = ((r.tInicio ?? r.t ?? 0) - t0) / 1000;
    const b = r.tFim ? (r.tFim - t0) / 1000 : a + (r.duracaoS ?? 3);
    if (b > a) janelasAssistente.push([a, b]);
  }
  const assistenteFalando = (t) =>
    janelasAssistente.some(([a, b]) => t >= a - 0.15 && t <= b + 0.15);

  // Linha do tempo de fala do usuário + commits + finais + turnos.
  const fatos = eventos
    .map((e) => ({ e, t: rel(e), tipo: e.type ?? e.tipo ?? "" }))
    .filter(({ tipo }) =>
      /^(user\.speech\.(started|paused|resumed)|endpoint\.committed|transcript\.final|requisicao|reproducao)/.test(
        tipo
      ) || tipo === "route"
    );

  for (let i = 0; i < fatos.length; i += 1) {
    const { e, t, tipo } = fatos[i];

    if (tipo === "user.speech.paused") {
      // Procura o que acontece depois da pausa.
      let retomadaEm = null;
      let commitEm = null;
      for (let j = i + 1; j < fatos.length; j += 1) {
        const proximo = fatos[j];
        if (proximo.t - t > 6) break;
        if (
          proximo.tipo === "user.speech.resumed" ||
          proximo.tipo === "user.speech.started"
        ) {
          retomadaEm = proximo.t;
          break;
        }
        if (proximo.tipo === "endpoint.committed" && commitEm === null) {
          commitEm = proximo.t;
        }
      }
      if (retomadaEm !== null && retomadaEm - t < 2.5) {
        const classe =
          commitEm !== null && commitEm < retomadaEm
            ? "fim-falso-commit"
            : "hesitacao";
        // Refino do rótulo: se a RESPOSTA já tocava quando o usuário
        // retomou, a retomada pode ser reação legítima (pergunta→
        // resposta→continua), não corte prematuro — subclasse separada
        // com confiança menor. Corte-seco (sem resposta no ar) é o
        // rótulo forte.
        const respostaTocava =
          classe === "fim-falso-commit" &&
          janelasAssistente.some(
            ([a, b]) => a <= retomadaEm && retomadaEm <= b + 0.3
          );
        momentos.push({
          pacote,
          classe,
          subclasse:
            classe === "fim-falso-commit"
              ? respostaTocava
                ? "retomada-pos-resposta"
                : "corte-seco"
              : null,
          t: Number(t.toFixed(2)),
          janela: [Number((t - 4).toFixed(2)), Number((retomadaEm + 1).toFixed(2))],
          decisaoEngine: commitEm !== null ? "commit" : "esperou",
          desfecho: `usuario retomou em ${(retomadaEm - t).toFixed(2)}s`,
          // Campos da curva de baseline: quanto silêncio a engine
          // esperou até o commit e quanto durou até a retomada real.
          silencioAteCommitMs:
            commitEm !== null ? Math.round((commitEm - t) * 1000) : null,
          deltaRetomadaMs: Math.round((retomadaEm - t) * 1000),
          confiancaRotulo:
            classe === "fim-falso-commit"
              ? respostaTocava
                ? 0.5
                : 0.95
              : 0.7,
          fonteRotulo: "desfecho-eventos"
        });
      } else if (commitEm !== null && retomadaEm === null) {
        momentos.push({
          pacote,
          classe: "fim-real",
          t: Number(t.toFixed(2)),
          janela: [Number((t - 4).toFixed(2)), Number((t + 1.5).toFixed(2))],
          decisaoEngine: "commit",
          desfecho: "sem retomada em 6s",
          silencioAteCommitMs: Math.round((commitEm - t) * 1000),
          deltaRetomadaMs: null,
          confiancaRotulo: 0.8,
          fonteRotulo: "desfecho-eventos"
        });
      }
    }

    if (tipo === "user.speech.started" && assistenteFalando(t)) {
      // Sobreposição: desfecho = assistente parou (interrupção efetivada)
      // ou seguiu (backchannel/atravessou).
      const fimJanela = janelasAssistente.find(
        ([a, b]) => t >= a - 0.15 && t <= b + 0.15
      )?.[1];
      const assistenteParou = fimJanela !== undefined && fimJanela - t < 2.0;
      momentos.push({
        pacote,
        classe: "sobreposicao",
        t: Number(t.toFixed(2)),
        janela: [Number((t - 2).toFixed(2)), Number((t + 3).toFixed(2))],
        decisaoEngine: null,
        desfecho: assistenteParou
          ? "assistente-cedeu"
          : "assistente-continuou",
        confiancaRotulo: 0.6,
        fonteRotulo: "desfecho-reproducao"
      });
    }

    if (tipo === "transcript.final") {
      const texto = String(e.text ?? "").trim();
      if (texto && MARCA_CORRECAO.test(texto)) {
        momentos.push({
          pacote,
          classe: "correcao-textual",
          t: Number(t.toFixed(2)),
          janela: [Number((t - 5).toFixed(2)), Number((t + 0.5).toFixed(2))],
          decisaoEngine: null,
          desfecho: `final: ${texto.slice(0, 60)}`,
          confiancaRotulo: 0.5,
          fonteRotulo: "marcador-textual"
        });
      }
    }
  }
}

const porClasse = {};
for (const m of momentos) {
  porClasse[m.classe] = (porClasse[m.classe] ?? 0) + 1;
}
await writeFile(
  SAIDA,
  momentos.map((m) => JSON.stringify(m)).join("\n") + "\n"
);
console.log(
  `momentos: ${momentos.length} em ${pacotes.length} pacotes → ${SAIDA}`
);
console.log(JSON.stringify(porClasse, null, 1));
