// TTFT do reasoner (luna) em função do tamanho do histórico enviado.
// Se o histórico inflar o TTFT, cortar contexto do caminho de interação é
// ganho direto de experiência (o conteúdo profundo fica com o task model).

import { readNdjson } from "../web/stream-utils.mjs";

const HTTP = "http://127.0.0.1:4173";
const QUESTIONS = [
  "Qual é a capital da Austrália?",
  "Quantos minutos tem um dia inteiro?",
  "Me diz um sinônimo de rápido.",
  "Qual é o plural de cidadão?"
];

const FILLER_TURN = [
  { role: "user", content: "Me conta um pouco sobre como funciona a poupança no Brasil e por que o rendimento dela mudou nos últimos anos." },
  { role: "assistant", content: "A poupança rende 70% da Selic mais TR quando a Selic está até 8,5% ao ano; acima disso o rendimento fixa em 0,5% ao mês mais TR. Nos últimos anos a alternância da Selic mudou bastante o retorno real, principalmente descontada a inflação." }
];

function historyOf(pairs) {
  return Array.from({ length: pairs }, () => FILLER_TURN).flat();
}

async function measure(text, history) {
  const start = performance.now();
  let firstDelta = null;
  const response = await fetch(`${HTTP}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      history,
      sessionId: `ttft-ctx-${Math.random().toString(36).slice(2)}`,
      turnId: "t1"
    })
  });
  for await (const event of readNdjson(response)) {
    if (event.type === "delta" && firstDelta === null) {
      firstDelta = performance.now() - start;
    }
    if (event.type === "error") {
      throw new Error(event.message);
    }
  }
  return firstDelta;
}

for (const pairs of [0, 3, 6]) {
  const history = historyOf(pairs);
  const chars = JSON.stringify(history).length;
  const samples = [];
  for (const question of QUESTIONS) {
    const ttft = await measure(question, history);
    samples.push(Math.round(ttft));
  }
  samples.sort((a, b) => a - b);
  console.log(
    `histórico=${pairs} pares (~${Math.round(chars / 1000)}KB): ` +
    `TTFT ${samples.join("/")}ms · mediana ${
      samples[Math.floor(samples.length / 2)]
    }ms`
  );
}
