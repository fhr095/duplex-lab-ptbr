import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  createExp0025RFloorPack,
  validateExp0025RFloorPack
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson } from
  "../src/eval/factory/canonical-hash.mjs";
import { EXP0025_R_DEVELOPMENT_PACK_PATH } from
  "./build-exp-0025-r-development-pack.mjs";
import {
  EXP0025_R_LOCAL_FREEZE_PATH,
  validateExp0025RLocalFreeze
} from "./freeze-exp-0025-r-local-candidate.mjs";

export const EXP0025_R_HOLDOUT_PACK_PATH =
  "eval/datasets/exp-0025-r-holdout-v0.1.json";
export const EXP0025_R_HOLDOUT_PLAN_PATH =
  "eval/generated/exp-0025-r/holdout-plan-v0.1.json";

const CREATED_AT = "2026-08-03T15:30:00.000Z";
const CRITICAL_BOUNDARY_AT_MS = 2_400;
const PAUSE_SET_MS = Object.freeze([480, 560, 600, 720, 900, 1_140]);

const DEFINITIONS = Object.freeze([
  {
    family: "hesitation-filler",
    prefix: "Eu preciso conferir o número, hum",
    suffix: "antes de confirmar o cadastro.",
    pauseMs: 560
  },
  {
    family: "hesitation-filler",
    prefix: "Sobre a entrega de amanhã, assim",
    suffix: "talvez seja melhor mudar o período.",
    pauseMs: 900
  },
  {
    family: "hesitation-filler",
    prefix: "Eu estava revendo os detalhes, bom",
    suffix: "ainda falta validar uma informação.",
    pauseMs: 480
  },
  {
    family: "hesitation-filler",
    prefix: "Quanto ao orçamento deste mês, ahn",
    suffix: "preciso comparar com a última versão.",
    pauseMs: 1_140
  },
  {
    family: "hesitation-filler",
    prefix: "Antes de enviar o formulário, tipo",
    suffix: "quero reler os campos obrigatórios.",
    pauseMs: 720
  },
  {
    family: "hesitation-filler",
    prefix: "Para escolher a melhor rota, é",
    suffix: "vou verificar o trânsito primeiro.",
    pauseMs: 600
  },
  {
    family: "syntactic-continuation",
    prefix: "Não consigo aprovar esta etapa porque",
    suffix: "o anexo ainda não chegou.",
    pauseMs: 720
  },
  {
    family: "syntactic-continuation",
    prefix: "Separe uma cópia do contrato para",
    suffix: "o setor jurídico revisar hoje.",
    pauseMs: 480
  },
  {
    family: "syntactic-continuation",
    prefix: "O principal ponto que precisamos confirmar é que",
    suffix: "o prazo inclui os feriados locais.",
    pauseMs: 1_140
  },
  {
    family: "syntactic-continuation",
    prefix: "Podemos antecipar a visita se",
    suffix: "o responsável estiver disponível.",
    pauseMs: 600
  },
  {
    family: "syntactic-continuation",
    prefix: "Vou conferir a planilha e",
    suffix: "depois retorno com o total correto.",
    pauseMs: 560
  },
  {
    family: "syntactic-continuation",
    prefix: "A primeira opção parece simples, mas",
    suffix: "ela depende da autorização do cliente.",
    pauseMs: 900
  },
  {
    family: "correction-restart",
    prefix: "A reunião será na quinta, não",
    suffix: "na sexta depois do almoço.",
    pauseMs: 900
  },
  {
    family: "correction-restart",
    prefix: "O total é duzentos e dez, quer dizer",
    suffix: "duzentos e doze reais.",
    pauseMs: 600
  },
  {
    family: "correction-restart",
    prefix: "Vamos usar o arquivo antigo, na verdade",
    suffix: "abra a versão revisada de ontem.",
    pauseMs: 560
  },
  {
    family: "correction-restart",
    prefix: "Reserve a sala maior, melhor",
    suffix: "fique com a sala ao lado do elevador.",
    pauseMs: 480
  },
  {
    family: "correction-restart",
    prefix: "Envie para o contato anterior, desculpa",
    suffix: "use o endereço novo da equipe.",
    pauseMs: 1_140
  },
  {
    family: "correction-restart",
    prefix: "A passagem deve sair no domingo",
    suffix: "não, coloque a partida no sábado.",
    pauseMs: 720
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "O relatório está pronto para envio",
    suffix: "depois que a diretoria assinar a capa.",
    pauseMs: 480
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "A reserva ficou registrada no sistema",
    suffix: "mas ainda sem o comprovante de pagamento.",
    pauseMs: 1_140
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "Esse horário atende a nossa equipe",
    suffix: "desde que a conversa termine antes das cinco.",
    pauseMs: 720
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "O pacote inclui suporte por telefone",
    suffix: "durante os primeiros trinta dias.",
    pauseMs: 560
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "Já podemos apresentar esta versão",
    suffix: "como uma prévia ainda sujeita a ajustes.",
    pauseMs: 900
  },
  {
    family: "lexically-ambiguous-close",
    prefix: "A documentação parece completa agora",
    suffix: "exceto pelas assinaturas das testemunhas.",
    pauseMs: 600
  }
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

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
    status: "NOT_MATERIALIZED_BEFORE_HOLDOUT_SEAL",
    role: "PROVENANCE_ONLY_NOT_POLICY_INPUT",
    pairId,
    outcome,
    wavPath: null,
    wavSha256: null,
    wordAlignment: null
  };
}

function utterance(definition, pairIndex, outcome) {
  const pairId = `exp0025r-hold-p${String(pairIndex).padStart(2, "0")}`;
  const continues = outcome === "CONTINUES";
  return {
    id: `${pairId}-${outcome.toLowerCase()}`,
    pairId,
    sessionId:
      `exp0025r-hold-s${String(Math.ceil(pairIndex / 3)).padStart(2, "0")}`,
    split: "holdout",
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

export async function assertExp0025RHoldoutBoundary(pack) {
  const [developmentBytes, freezeBytes] = await Promise.all([
    readFile(resolve(EXP0025_R_DEVELOPMENT_PACK_PATH)),
    readFile(resolve(EXP0025_R_LOCAL_FREEZE_PATH))
  ]);
  const development = JSON.parse(developmentBytes.toString("utf8"));
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const validation = validateExp0025RFloorPack(pack);
  if (!validation.valid || pack.split !== "holdout") {
    throw new Error(`holdout inválido: ${validation.errors.join("; ")}`);
  }
  if (!validateExp0025RLocalFreeze(freeze) ||
    freeze.holdout.status !== "NOT_GENERATED_NOT_OPENED") {
    throw new Error("L não foi congelado antes da geração de H");
  }
  const developmentSurfaces = new Set(development.utterances.flatMap(
    (item) => [item.prefix, item.suffix].filter(Boolean)
  ));
  const holdoutSurfaces = pack.utterances.flatMap(
    (item) => [item.prefix, item.suffix].filter(Boolean)
  );
  if (holdoutSurfaces.some((surface) => developmentSurfaces.has(surface))) {
    throw new Error("H repetiu superfície de D");
  }
  const pairCountsBySession = Map.groupBy(
    [...new Map(pack.utterances.map((item) => [item.pairId, item])).values()],
    (item) => item.sessionId
  );
  if ([...pairCountsBySession.values()].some((items) => items.length !== 3)) {
    throw new Error("H não possui três pares por sessão");
  }
  for (const family of Object.keys(pack.families)) {
    const pauses = [...new Map(pack.utterances.filter((item) =>
      item.family === family).map((item) => [item.pairId, item.pauseMs]))
      .values()].toSorted((left, right) => left - right);
    if (!isDeepStrictEqual(pauses, PAUSE_SET_MS)) {
      throw new Error(`família ${family} perdeu distribuição de pausas`);
    }
  }
  return {
    developmentPackSha256: development.packSha256,
    developmentFileSha256: `sha256:${sha256(developmentBytes)}`,
    localFreezeSha256: freeze.freezeSha256,
    disjointSurfaces: true,
    pairsPerSession: 3,
    pauseSetMs: [...PAUSE_SET_MS]
  };
}

export function buildExp0025RHoldoutPack() {
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
    split: "holdout",
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

export async function materializeExp0025RHoldoutPlan(options = {}) {
  const path = resolve(options.path ?? EXP0025_R_HOLDOUT_PLAN_PATH);
  const expected = buildExp0025RHoldoutPack();
  await assertExp0025RHoldoutBoundary(expected);
  if (options.check === true) {
    const observed = JSON.parse(await readFile(path, "utf8"));
    if (!isDeepStrictEqual(observed, expected)) {
      throw new Error("plano H divergiu do builder congelado");
    }
    return observed;
  }
  await writeAtomic(path, `${canonicalJson(expected)}\n`);
  return expected;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--check")) {
    throw new Error(
      "uso: node scripts/build-exp-0025-r-holdout-pack.mjs [--check]"
    );
  }
  const pack = await materializeExp0025RHoldoutPlan({
    check: args.has("--check")
  });
  process.stdout.write(
    `EXP-0025-R H ${args.has("--check") ? "verificado" : "planejado"}: ` +
      `${pack.pairs} pares, ${pack.utterances.length} falas; nenhuma inferência\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
