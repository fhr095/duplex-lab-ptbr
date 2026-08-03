import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { createExp0025RFloorPack } from
  "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson } from
  "../src/eval/factory/canonical-hash.mjs";

export const EXP0025_R_DEVELOPMENT_PACK_PATH =
  "eval/datasets/exp-0025-r-development-v0.1.json";
export const EXP0025_R_DEVELOPMENT_PLAN_PATH =
  "eval/generated/exp-0025-r/development-plan-v0.1.json";

const CREATED_AT = "2026-08-03T15:00:00.000Z";
const CRITICAL_BOUNDARY_AT_MS = 2_400;

const DEFINITIONS = Object.freeze([
  {
    family: "hesitation-filler",
    prefix: "Eu queria confirmar isso, assim",
    suffix: "antes de concluir o pedido.",
    pauseMs: 800
  },
  {
    family: "hesitation-filler",
    prefix: "Sobre a mudança de horário, bom",
    suffix: "acho melhor deixar para depois.",
    pauseMs: 1_200
  },
  {
    family: "hesitation-filler",
    prefix: "Eu estava pensando em outra possibilidade",
    suffix: "que talvez seja mais simples.",
    pauseMs: 700
  },
  {
    family: "hesitation-filler",
    prefix: "Deixa eu ver a agenda aqui",
    suffix: "quarta-feira pela manhã funciona.",
    pauseMs: 480
  },
  {
    family: "syntactic-continuation",
    prefix: "Eu prefiro não confirmar agora porque",
    suffix: "ainda preciso falar com a equipe.",
    pauseMs: 900
  },
  {
    family: "syntactic-continuation",
    prefix: "Eu aviso quando eu chegar",
    suffix: "e tiver conferido o endereço.",
    pauseMs: 840
  },
  {
    family: "syntactic-continuation",
    prefix: "Pode separar os documentos para",
    suffix: "eu revisar tudo amanhã cedo.",
    pauseMs: 1_200
  },
  {
    family: "syntactic-continuation",
    prefix: "O que eu realmente preciso é",
    suffix: "uma confirmação por escrito.",
    pauseMs: 650
  },
  {
    family: "correction-restart",
    prefix: "Pode marcar para sexta, na verdade",
    suffix: "melhor deixar para segunda-feira.",
    pauseMs: 1_200
  },
  {
    family: "correction-restart",
    prefix: "O valor correto é cento e cinquenta reais",
    suffix: "não cento e quinze como eu disse.",
    pauseMs: 700
  },
  {
    family: "correction-restart",
    prefix: "Quero receber pela manhã, quer dizer",
    suffix: "pode ser no começo da tarde.",
    pauseMs: 800
  },
  {
    family: "correction-restart",
    prefix: "Terça-feira funciona para mim",
    suffix: "desde que seja depois das três.",
    pauseMs: 480
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "Esse é o endereço que eu tenho",
    suffix: "mas ainda vou confirmar o número.",
    pauseMs: 600
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "A proposta parece adequada",
    suffix: "considerando apenas essa primeira etapa.",
    pauseMs: 480
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "Então podemos encerrar por aqui",
    suffix: "depois que você me enviar o protocolo.",
    pauseMs: 900
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "Está tudo certo com a reserva",
    suffix: "exceto pelo nome do segundo hóspede.",
    pauseMs: 520
  }
]);

function microturns(prefix) {
  const words = prefix.split(/\s+/u);
  const chunks = [];
  let offset = 0;
  for (let index = 0; index < 4; index += 1) {
    const remainingWords = words.length - offset;
    const remainingChunks = 4 - index;
    const take = Math.ceil(remainingWords / remainingChunks);
    chunks.push({
      atMs: (index + 1) * 600,
      deltaText: words.slice(offset, offset + take).join(" "),
      assistantSpeaking: false,
      voiceActive: true
    });
    offset += take;
  }
  return chunks;
}

function audioProvenance(pairId, outcome) {
  return {
    status: "NOT_MATERIALIZED_BEFORE_HEADROOM_GATE",
    role: "PROVENANCE_ONLY_NOT_POLICY_INPUT",
    pairId,
    outcome,
    wavPath: null,
    wavSha256: null,
    wordAlignment: null
  };
}

function utterance(definition, pairIndex, outcome) {
  const pairId = `exp0025r-dev-p${String(pairIndex).padStart(2, "0")}`;
  const continues = outcome === "CONTINUES";
  return {
    id: `${pairId}-${outcome.toLowerCase()}`,
    pairId,
    sessionId:
      `exp0025r-dev-s${String(Math.ceil(pairIndex / 2)).padStart(2, "0")}`,
    split: "development",
    family: definition.family,
    outcome,
    assistantSpeaking: false,
    prefix: definition.prefix,
    suffix: continues ? definition.suffix : null,
    speechMs: CRITICAL_BOUNDARY_AT_MS,
    criticalBoundaryAtMs: CRITICAL_BOUNDARY_AT_MS,
    pauseMs: definition.pauseMs,
    resumeAtMs: continues
      ? CRITICAL_BOUNDARY_AT_MS + definition.pauseMs
      : null,
    trueFinalAtMs: continues ? null : CRITICAL_BOUNDARY_AT_MS,
    microturns: microturns(definition.prefix),
    audioProvenance: audioProvenance(pairId, outcome)
  };
}

export function buildExp0025RDevelopmentPack() {
  const utterances = DEFINITIONS.flatMap((definition, offset) => [
    utterance(definition, offset + 1, "CONTINUES"),
    utterance(definition, offset + 1, "ENDS")
  ]);
  const families = Object.fromEntries([...new Set(DEFINITIONS.map(
    (definition) => definition.family
  ))].map((family) => [
    family,
    DEFINITIONS.filter((definition) => definition.family === family).length
  ]));
  return createExp0025RFloorPack({
    createdAt: CREATED_AT,
    split: "development",
    pairs: DEFINITIONS.length,
    sessions: 8,
    families,
    utterances
  });
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}

export async function materializeExp0025RDevelopmentPack(options = {}) {
  const path = resolve(options.path ?? EXP0025_R_DEVELOPMENT_PLAN_PATH);
  const expected = buildExp0025RDevelopmentPack();
  if (options.check === true) {
    const observed = JSON.parse(await readFile(path, "utf8"));
    if (!isDeepStrictEqual(observed, expected)) {
      throw new Error("pack development EXP-0025-R divergiu do builder");
    }
    return expected;
  }
  await writeAtomic(path, `${canonicalJson(expected)}\n`);
  return expected;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--check")) {
    throw new Error("uso: node scripts/build-exp-0025-r-development-pack.mjs [--check]");
  }
  const pack = await materializeExp0025RDevelopmentPack({
    check: args.has("--check")
  });
  process.stdout.write(
    `EXP-0025-R development pack ${args.has("--check") ? "verificado" : "criado"}: ` +
      `${pack.pairs} pares, ${pack.utterances.length} falas, ${pack.packSha256}\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
