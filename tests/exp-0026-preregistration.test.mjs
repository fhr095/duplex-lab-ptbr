import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const preregistrationPath = new URL(
  "../docs/experiments/EXP-0026-end-to-end-experience-bottleneck-diagnostic.md",
  import.meta.url
);
const runnerDesignPath = new URL(
  "../docs/research/EXTERNAL_CHALLENGER_RUNNER_DESIGN.md",
  import.meta.url
);

function requiresAll(document, fragments) {
  for (const fragment of fragments) {
    assert.ok(
      document.includes(fragment),
      `contrato EXP-0026 perdeu fragmento obrigatório: ${fragment}`
    );
  }
}

test("EXP-0026 congela um screen formativo por participante", async () => {
  const document = await readFile(preregistrationPath, "utf8");
  assert.match(document, /^# EXP-0026 —/u);
  requiresAll(document, [
    "diagnóstico formativo de produto",
    "participante/sessão (`n=6`)",
    "exatamente 6 participantes externos únicos",
    "um dry-run interno adicional, explicitamente excluído",
    "uma única estação física e os mesmos dispositivos nas seis sessões",
    "máxima de sete dias corridos",
    "PENDING_END_TO_END_BOTTLENECK_DIAGNOSIS"
  ]);
  assert.doesNotMatch(document, /prontidão humana ampla.*confirmada/iu);
});

test("EXP-0026 congela cérebro, prompt, parâmetros, TTS, dispositivo e ruído", async () => {
  const document = await readFile(preregistrationPath, "utf8");
  requiresAll(document, [
    "exp-0026-session-freeze-v0.1.json",
    "modelos de interação e tarefa `gpt-5.6-luna`",
    "SHA-256 das instruções direta e delegada",
    "`reasoning.effort=none`",
    "temperatura e teto de 25 requisições",
    "Modelo premium é proibido",
    "voz `Microsoft Maria Desktop`",
    "versão do servidor, microfone,",
    "saída, dispositivo de ruído,",
    "WAV de ruído branco seeded",
    "volume ou posição não podem ser reajustados"
  ]);
});

test("EXP-0026 separa consentimento, avaliação e treino", async () => {
  const document = await readFile(preregistrationPath, "utf8");
  requiresAll(document, [
    "Há consentimentos separados e revogáveis",
    "processamento transitório da",
    "Áudio e traces só são gravados",
    "fitEligibility=evaluation-only",
    "nunca entram em treino",
    "ficam fora do Git",
    "apagados até 30 dias após o closeout",
    "persistência incremental ou snapshot fechado por cena"
  ]);
});

test("EXP-0026 coleta cena a cena e sela o top-2 uma vez", async () => {
  const document = await readFile(preregistrationPath, "utf8");
  requiresAll(document, [
    "Depois de cada cena o participante registra exatamente",
    "uma categoria principal",
    "severidade",
    "comentário opcional",
    "uma única vez por participante",
    "formulário não força dois",
    "`NENHUM_PROBLEMA_MATERIAL`",
    "é exclusivo e não pode coexistir",
    "Esse top-2 é selado antes",
    "de abrir o módulo comercial e não pode ser refeito"
  ]);
});

test("EXP-0026 exige prevalência, severidade e reprodução sem forçar consenso", async () => {
  const document = await readFile(preregistrationPath, "utf8");
  requiresAll(document, [
    "`P_f`: número de participantes",
    "`Q_f`:",
    "`S_f`: mediana",
    "`R_f`: falha técnica reproduzível",
    "`P_f >= 4`, `S_f >= 2` e",
    "NO_DOMINANT_BOTTLENECK",
    "participantes ao denominador.",
    "no máximo um",
    "próximo experimento**"
  ]);
});

test("EXP-0026 atribui cada problema pela cadeia local", async () => {
  const document = await readFile(preregistrationPath, "utf8");
  requiresAll(document, [
    "`AUDIO`",
    "`ASR_PARTIAL`",
    "`ASR_FINAL`",
    "`ENDPOINT`",
    "`BRAIN`",
    "`TTS`",
    "`INTERRUPTION`",
    "`TASK`",
    "`MULTI_STAGE`",
    "`UNATTRIBUTED`"
  ]);
});

test("referência Live é calibração isolada e não fonte de treino ou ranking", async () => {
  const document = await readFile(preregistrationPath, "utf8");
  requiresAll(document, [
    "Calibração opcional com referência Live comercial",
    "selados severidades e top-2 locais",
    "Não se gravam áudio, tela, transcrição nem output do produto comercial",
    "não muda o",
    "ranking e não escolhe o próximo experimento",
    "NOT_EVALUATED_REFERENCE_INCOMPLETE"
  ]);
});

test("DuplexCascade só volta sob novo ID se gestão de piso dominar", async () => {
  const document = await readFile(preregistrationPath, "utf8");
  const runner = await readFile(runnerDesignPath, "utf8");
  requiresAll(document, [
    "Gestão de piso dominante",
    "novo experimento e novo ID",
    "O EXP-0025-R não reabre",
    "UNRESOLVED — DEFERRED BY PRODUCT",
    "External Challenger Runner precisa ser qualificado",
    "GPU: `0`; External Challenger Runner: `0`; DuplexCascade: `0`"
  ]);
  requiresAll(runner, [
    "desenho preservado, não implementado",
    "Retry de infraestrutura versus tentativa científica",
    "nenhum input científico foi aberto",
    "primeiro token",
    "no máximo dois retries automáticos",
    "UNIMPLEMENTED — DEFERRED BY PRODUCT PRIORITY"
  ]);
});
