// Bakeoff de ocupantes do slot rápido no hardware-alvo (8GB, CPU).
//
// Para cada modelo GGUF: sobe llama-server, roda o conjunto rotulado como
// CLASSIFICADOR (JSON schema restrito) e como GERADOR DE PONTE, medindo
// TTFT/total por chamada. A régua de viabilidade é a janela especulativa
// (~300–700ms). O controle determinístico já tem placar próprio
// (fast-path-score); aqui medimos o que o modelo ADICIONA e quanto custa.
//
// Uso: node probes/occupant-bakeoff.mjs <modelo.gguf> [porta]

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const MODELS = "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/" +
  "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models";
const LLAMA_SERVER = `${MODELS}/llama-b10333/llama-server`;
const modelPath = process.argv[2] ?? `${MODELS}/qwen3-1.7b-q4.gguf`;
const port = Number.parseInt(process.argv[3] ?? "8400", 10);
const BASE = `http://127.0.0.1:${port}`;

const dataPath = resolve(
  import.meta.dirname, "data/fastpath-turns.pt-BR.json"
);
const { turns } = JSON.parse(await readFile(dataPath, "utf8"));

const SYSTEM_CLASSIFY = `Você é o decisor da camada rápida de um assistente de voz em português brasileiro. Decida como tratar o turno do usuário:
- LOCAL_FINAL: só para saudação, agradecimento ou despedida PUROS, sem nenhum pedido junto.
- BRIDGE: o usuário corrigiu um valor/dado que ele mesmo disse antes, ou pediu uma pesquisa/tarefa demorada.
- CLARIFY: valor crítico ambíguo ou instável que precisa de confirmação.
- PASS: qualquer outra coisa (perguntas, pedidos, conteúdo). Na dúvida, PASS.
Responda apenas o JSON. /no_think`;

const SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["LOCAL_FINAL", "BRIDGE", "CLARIFY", "PASS"]
    }
  },
  required: ["action"],
  additionalProperties: false
};

async function chat(messages, options = {}) {
  const start = performance.now();
  let firstTokenMs = null;
  let text = "";
  const response = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages,
      stream: true,
      temperature: 0,
      max_tokens: options.maxTokens ?? 24,
      ...(options.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "decisao", schema: options.schema }
            }
          }
        : {})
    })
  });
  if (!response.ok) {
    throw new Error(`llama-server HTTP ${response.status}`);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.startsWith("data:") && !line.includes("[DONE]")) {
        const payload = JSON.parse(line.slice(5));
        const delta = payload.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          firstTokenMs ??= performance.now() - start;
          text += delta;
        }
      }
      index = buffer.indexOf("\n");
    }
  }
  return {
    text: text.trim(),
    firstTokenMs,
    totalMs: performance.now() - start
  };
}

console.error(`modelo: ${modelPath.split("/").at(-1)}`);
const server = spawn(LLAMA_SERVER, [
  "-m", modelPath,
  "--port", String(port),
  "-c", "1024",
  "-t", "4",
  "--no-webui"
], { stdio: "ignore" });

try {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const health = await fetch(`${BASE}/health`, {
        signal: AbortSignal.timeout(1_500)
      });
      if (health.ok) {
        break;
      }
    } catch { /* subindo */ }
    await delay(2_000);
  }

  // aquecimento
  await chat([
    { role: "system", content: SYSTEM_CLASSIFY },
    { role: "user", content: "Oi." }
  ], { schema: SCHEMA });

  // 1) Classificação no conjunto rotulado
  let correct = 0;
  const times = [];
  const errors = [];
  for (const item of turns) {
    const user = item.context
      ? `Turno anterior do usuário: «${item.context}»\nTurno atual: «${item.text}»`
      : `Turno atual: «${item.text}»`;
    try {
      const result = await chat([
        { role: "system", content: SYSTEM_CLASSIFY },
        { role: "user", content: user }
      ], { schema: SCHEMA });
      times.push(result.totalMs);
      const action = JSON.parse(result.text).action;
      if (action === item.label) {
        correct += 1;
      } else {
        errors.push(`«${item.text}» ${item.label}→${action}`);
      }
    } catch (error) {
      errors.push(`«${item.text}» ERRO ${error.message}`);
    }
  }
  times.sort((a, b) => a - b);
  const percentile = (fraction) =>
    Math.round(times[Math.floor(times.length * fraction)] ?? -1);
  console.error(
    `classificação: ${correct}/${turns.length} ` +
    `(${(correct / turns.length * 100).toFixed(1)}%) · ` +
    `latência p50 ${percentile(0.5)}ms p90 ${percentile(0.9)}ms`
  );
  for (const error of errors.slice(0, 12)) {
    console.error(`  ERR ${error}`);
  }

  // 2) Geração de ponte para os casos BRIDGE
  console.error("\npontes geradas:");
  for (const item of turns.filter((turn) => turn.label === "BRIDGE")) {
    const user = item.context
      ? `Contexto: o usuário disse «${item.context}» e agora disse «${item.text}».`
      : `O usuário disse «${item.text}».`;
    const result = await chat([
      {
        role: "system",
        content: "Você é a voz imediata de um assistente PT-BR. Gere UMA " +
          "frase curtíssima (máx. 6 palavras) confirmando o que o usuário " +
          "corrigiu ou pediu, sem responder o conteúdo. /no_think"
      },
      { role: "user", content: user }
    ], { maxTokens: 20 });
    console.error(
      `  [${Math.round(result.firstTokenMs)}ms/${
        Math.round(result.totalMs)}ms] «${item.text}» → ` +
      `«${result.text.replaceAll("\n", " ").slice(0, 60)}»`
    );
  }
} finally {
  server.kill("SIGTERM");
}
