// Decomposição da perna PASS: para luna vs 5.4-mini, mede N vezes
// final→primeiro-delta (TTFT), delta→primeira-frase-completa, e
// frase→primeiro-byte-TTS. Responde se o reasoner rápido aparece no E2E e
// onde o tempo realmente está.

import { loadEnvFile } from "../src/config/load-env.mjs";
import { createOpenAIBrain } from "../src/brain/openai-brain.mjs";
import { extractSpeechChunks } from "../web/stream-utils.mjs";

await loadEnvFile();

const POCKET = "http://127.0.0.1:8321/tts";
const QUESTIONS = [
  "Qual é a capital da França?",
  "Me explica em uma frase o que é CDI.",
  "Quantos dias tem fevereiro em ano bissexto?",
  "Me diz um sinônimo de bonito.",
  "Qual é o maior estado do Brasil?"
];

async function ttsFirstByteMs(text) {
  const start = performance.now();
  const form = new FormData();
  form.set("text", text);
  const response = await fetch(POCKET, { method: "POST", body: form });
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > 44) {
      const at = performance.now() - start;
      void (async () => {
        try {
          for await (const rest of response.body) {
            void rest;
          }
        } catch { /* ok */ }
      })();
      return at;
    }
  }
  return performance.now() - start;
}

for (const model of ["gpt-5.6-luna", "gpt-5.4-mini"]) {
  const brain = createOpenAIBrain({
    interactionModel: model,
    taskModel: model,
    maxRequests: 12
  });
  const rows = [];
  for (const question of QUESTIONS) {
    const start = performance.now();
    let ttft = null;
    let sentenceAt = null;
    let firstChunk = null;
    let buffered = "";
    for await (const event of brain.streamTurn({
      text: question,
      history: [],
      mode: "direct"
    })) {
      if (event.type === "delta") {
        ttft ??= performance.now() - start;
        buffered += event.delta;
        if (sentenceAt === null) {
          const split = extractSpeechChunks(buffered);
          if (split.chunks.length > 0) {
            sentenceAt = performance.now() - start;
            firstChunk = split.chunks[0];
          }
        }
      }
    }
    if (sentenceAt === null) {
      sentenceAt = performance.now() - start;
      firstChunk = buffered.trim();
    }
    const tts = await ttsFirstByteMs(firstChunk);
    rows.push({
      ttft: Math.round(ttft),
      sentence: Math.round(sentenceAt - ttft),
      tts: Math.round(tts),
      total: Math.round(sentenceAt + tts)
    });
  }
  const median = (key) => {
    const values = rows.map((row) => row[key]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  console.log(
    `${model.padEnd(14)} TTFT p50 ${median("ttft")}ms · ` +
    `+frase ${median("sentence")}ms · +TTS ${median("tts")}ms · ` +
    `total(final→áudio) p50 ${median("total")}ms · ` +
    `amostras ${rows.map((row) => row.total).join("/")}`
  );
}
