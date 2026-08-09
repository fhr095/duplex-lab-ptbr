// Cobertura do fast-path v0 (controle determinístico) sobre textos PT-BR do
// próprio lab: quantos turnos são elegíveis a LOCAL_FINAL e com que classe.
// Base de comparação para medir o que um modelo pequeno ADICIONA.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { classifyFastPath } from "../src/interaction/fast-path.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

async function collectTexts() {
  const texts = new Set();

  // Cenários e packs do laboratório (frases de usuário).
  const roots = ["eval/scenarios", "eval/experiments"];
  for (const root of roots) {
    let files = [];
    try {
      files = await readdir(resolve(PROJECT_ROOT, root));
    } catch {
      continue;
    }
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      try {
        const parsed = JSON.parse(
          await readFile(resolve(PROJECT_ROOT, root, file), "utf8")
        );
        for (const value of extractStrings(parsed)) {
          texts.add(value);
        }
      } catch {
        // pack não-JSON ou ilegível: ignora
      }
    }
  }

  // Transcrições reais (CORAA).
  try {
    const manifest = JSON.parse(await readFile(
      resolve(PROJECT_ROOT, "eval/generated/coraa/manifest.json"),
      "utf8"
    ));
    for (const item of manifest.cases ?? []) {
      if (item.expected) {
        texts.add(item.expected);
      }
    }
  } catch {
    // manifest ausente nesta máquina
  }

  // Turnos fáticos típicos que o lab ainda não cobre em pack.
  for (const text of [
    "Oi, tudo bem?", "Bom dia!", "Obrigado, viu", "Valeu!",
    "Tchau, até mais", "Que horas são?", "Que dia é hoje?",
    "Que dia da semana é hoje?", "Me explica o que é CDI",
    "Qual a capital da França?", "Transfere trezentos reais",
    "Espera", "Não, deixa pra lá", "Aham", "Entendi",
    "Pode marcar a reunião pra sexta?"
  ]) {
    texts.add(text);
  }
  return [...texts];
}

function* extractStrings(value, key = null) {
  if (typeof value === "string") {
    if (
      ["text", "utterance", "userText", "expected", "transcript"]
        .includes(key) && value.length >= 2 && value.length <= 200
    ) {
      yield value;
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* extractStrings(item, key);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      yield* extractStrings(child, childKey);
    }
  }
}

const texts = await collectTexts();
const byClass = new Map();
const localFinals = [];
for (const text of texts) {
  const decision = classifyFastPath(text);
  if (decision.action === "LOCAL_FINAL") {
    localFinals.push({ text, class: decision.class });
    byClass.set(decision.class, (byClass.get(decision.class) ?? 0) + 1);
  }
}

console.log(`corpus: ${texts.length} textos únicos`);
console.log(
  `LOCAL_FINAL: ${localFinals.length} ` +
  `(${(localFinals.length / texts.length * 100).toFixed(1)}%) · ` +
  `PASS: ${texts.length - localFinals.length}`
);
console.log("por classe:", Object.fromEntries(byClass));
console.log("\nexemplos aceitos:");
for (const item of localFinals.slice(0, 12)) {
  console.log(`  [${item.class}] «${item.text}»`);
}
