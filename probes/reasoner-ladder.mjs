// Escada de reasoners na mesma chave: TTFT + qualidade PT-BR de amostra.
// Pergunta: existe modelo com TTFT substancialmente < luna (~960ms) que
// mantenha respostas PT-BR curtas aceitáveis para o caminho de interação?

import { loadEnvFile } from "../src/config/load-env.mjs";
import { createOpenAIBrain } from "../src/brain/openai-brain.mjs";

await loadEnvFile();

const MODELS = [
  "gpt-5.6-luna",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5-nano",
  "gpt-4.1-nano"
];
const QUESTIONS = [
  "Qual é a capital da Austrália?",
  "Me diz um sinônimo de rápido.",
  "Quantos meses têm 31 dias?"
];

for (const model of MODELS) {
  const brain = createOpenAIBrain({
    interactionModel: model,
    taskModel: model,
    maxRequests: 10
  });
  const ttfts = [];
  let sample = "";
  let failure = null;
  for (const question of QUESTIONS) {
    const start = performance.now();
    let firstDelta = null;
    try {
      for await (const event of brain.streamTurn({
        text: question,
        history: [],
        mode: "direct"
      })) {
        if (event.type === "delta" && firstDelta === null) {
          firstDelta = performance.now() - start;
        }
        if (event.type === "delta" && question === QUESTIONS[0]) {
          sample += event.delta;
        }
      }
      ttfts.push(Math.round(firstDelta ?? -1));
    } catch (error) {
      failure = error.message.slice(0, 80);
      break;
    }
  }
  ttfts.sort((a, b) => a - b);
  console.log(
    model.padEnd(14),
    failure
      ? `ERRO: ${failure}`
      : `TTFT ${ttfts.join("/")}ms · mediana ${
          ttfts[Math.floor(ttfts.length / 2)]
        }ms · «${sample.trim().slice(0, 60)}»`
  );
}
