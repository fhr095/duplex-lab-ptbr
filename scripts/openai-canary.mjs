import { performance } from "node:perf_hooks";

import { createOpenAIBrain } from "../src/brain/openai-brain.mjs";
import { isPremiumOpenAIModel } from "../src/brain/provider.mjs";
import { loadEnvFile } from "../src/config/load-env.mjs";

await loadEnvFile();

if (process.env.ALLOW_PAID_PROBE !== "1") {
  console.error(
    "Canário pago bloqueado. Rode com ALLOW_PAID_PROBE=1 para autorizar uma chamada."
  );
  process.exit(2);
}

const model = process.env.PAID_PROBE_MODEL ?? "gpt-5.6-luna";
if (
  isPremiumOpenAIModel(model) &&
  process.env.ALLOW_PREMIUM_PROBE !== "1"
) {
  console.error(
    `${model} é premium. Adicione ALLOW_PREMIUM_PROBE=1 para autorizar o canário.`
  );
  process.exit(2);
}

const brain = createOpenAIBrain({
  interactionModel: model,
  taskModel: model,
  maxOutputTokens: 16,
  maxRequests: 1
});
const startedAt = performance.now();
let firstDeltaMs = null;
let returnedModel = null;
let text = "";

for await (const event of brain.streamTurn({
  text: "Responda somente com a palavra: ok"
})) {
  if (event.type === "delta") {
    firstDeltaMs ??= Math.round(performance.now() - startedAt);
    text += event.delta;
  }
  returnedModel = event.model ?? returnedModel;
}

console.log(
  JSON.stringify({
    ok: text.trim().toLowerCase() === "ok",
    requestedModel: model,
    returnedModel,
    firstDeltaMs,
    elapsedMs: Math.round(performance.now() - startedAt),
    usage: brain.getUsage()
  })
);
