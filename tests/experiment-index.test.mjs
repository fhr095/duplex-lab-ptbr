import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXP0018_CANONICAL_OUTCOMES,
  readExperimentIndex,
  validateExp0018HistoricalOutcome,
  validateExperimentIndex
} from "../src/eval/experiment-index.mjs";

test("contrato EXP-0018 fixa outcomes qualitativos e invalidação técnica", () => {
  assert.deepEqual(EXP0018_CANONICAL_OUTCOMES, {
    PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN: {
      status: "completed",
      authority: "none",
      reportStatus: "passed-textual-mechanism-screen",
      allGatesPassed: true,
      claimRequired: true,
      nextDecision:
        "Pré-registrar uma emenda e executar o menor screen causal em áudio do mesmo checkpoint; ASR continua fora até provar disponibilidade.",
      parallelProbeStatus: "planned",
      parallelProbeDecision:
        "Pré-registrar separadamente o menor bridge causal em áudio do checkpoint aprovado; ASR permanece fora até evidência de disponibilidade."
    },
    CUT_CONTEXT_MATCHER_IN_THIS_DESIGN: {
      status: "cut",
      authority: "none",
      reportStatus: "cut-textual-mechanism-screen",
      allGatesPassed: false,
      claimRequired: false,
      nextDecision:
        "Não levar este matcher a áudio; selecionar o próximo maior gargalo percebido sob novo pré-registro.",
      parallelProbeStatus: "cut",
      parallelProbeDecision:
        "Bridge causal em áudio cancelado porque o matcher textual não venceu seus gates; selecionar outro mecanismo."
    },
    INVALIDATED_SINGLE_DEVELOPMENT_ATTEMPT: {
      status: "invalidated",
      authority: "none",
      reportStatus: "invalidated-development-attempt",
      allGatesPassed: null,
      claimRequired: false,
      nextDecision:
        "Registrar um novo experimento antes de qualquer nova abertura; esta tentativa não produz conclusão de qualidade.",
      parallelProbeStatus: "planned",
      parallelProbeDecision:
        "Nenhum bridge em áudio foi autorizado; repetir a hipótese somente sob novo experimento e nova abertura."
    }
  });
});

test("outcome histórico EXP-0018 sobrevive ao próximo caminho crítico", () => {
  const outcome = EXP0018_CANONICAL_OUTCOMES
    .PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN;
  const entry = {
    nextDecision: outcome.nextDecision,
    parallelProbeOutcome: {
      status: outcome.parallelProbeStatus,
      decision: outcome.parallelProbeDecision
    }
  };
  assert.doesNotThrow(() => validateExp0018HistoricalOutcome(entry, {
    currentCriticalPath: "EXP-0019",
    currentParallelProbe: {
      status: "planned",
      decision: "probe novo e independente"
    }
  }, "PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN"));
  assert.throws(() => validateExp0018HistoricalOutcome({
    ...entry,
    parallelProbeOutcome: { ...entry.parallelProbeOutcome, status: "cut" }
  }, {
    currentCriticalPath: "EXP-0019",
    currentParallelProbe: { status: "planned", decision: "novo" }
  }, "PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN"), /histórico contradiz/u);
});

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(projectRoot, "eval/EXPERIMENT_INDEX.json");

async function fixture() {
  return JSON.parse(await readFile(indexPath, "utf8"));
}

test("índice canônico real referencia evidências existentes", async () => {
  const index = await readExperimentIndex(indexPath);
  assert.equal(index.currentCriticalPath, "EXP-0019");
  assert.equal(index.transitionState, "active");
  assert.equal(index.currentParallelProbe.id, "EXP-0019-R");
  assert.equal(index.currentParallelProbe.blocking, false);
  assert.equal(index.entries.at(-1).canonicalReport, null);
  assert.equal(index.entries.at(-1).authority, "none");
  assert.equal(
    index.entries.at(-1).decision,
    "materialize-minimal-causal-audio-context-bridge"
  );
  assert.deepEqual(index.entries.at(-1).cleanCloneChecks, []);
  const exp0018 = index.entries.find(({ id }) => id === "EXP-0018");
  assert.equal(
    exp0018.canonicalReport,
    "eval/reports/exp-0018-context-development-v0.1.json"
  );
  assert.equal(
    exp0018.evidenceCommit,
    "7d03ad715894eb80202d7978fe613f88fc54aacb"
  );
  assert.deepEqual(exp0018.parallelProbeOutcome, {
    status: "planned",
    decision:
      "Pré-registrar separadamente o menor bridge causal em áudio do checkpoint aprovado; ASR permanece fora até evidência de disponibilidade."
  });
  assert.equal(
    exp0018.decision,
    "PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN"
  );
  assert.deepEqual(exp0018.cleanCloneChecks, [
    "node --test tests/exp-0018-context-factory.test.mjs",
    "node --test tests/exp-0018-boundary.test.mjs",
    "node --test tests/exp-0018-training.test.mjs",
    "node --test tests/experiment-index.test.mjs"
  ]);
  assert.equal(
    index.entries.find(({ id }) => id === "EXP-0017").canonicalReport,
    "eval/reports/exp-0017-summary-v0.1.json"
  );
});

test("rejeita IDs duplicados", async () => {
  const index = await fixture();
  index.entries[1].id = index.entries[0].id;
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /experiment IDs must be unique/u
  );
});

test("rejeita arquivo canônico ausente", async () => {
  const index = await fixture();
  index.entries[0].canonicalReport = "eval/reports/does-not-exist.json";
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /canonicalReport does not exist/u
  );
});

test("rejeita status e autoridade fora do contrato", async () => {
  const invalidStatus = await fixture();
  invalidStatus.entries[0].status = "maybe";
  await assert.rejects(
    validateExperimentIndex(invalidStatus, { projectRoot }),
    /status is invalid/u
  );

  const invalidAuthority = await fixture();
  invalidAuthority.entries[0].authority = "full-control";
  await assert.rejects(
    validateExperimentIndex(invalidAuthority, { projectRoot }),
    /authority is invalid/u
  );
});

test("rejeita mais de um caminho crítico", async () => {
  const index = await fixture();
  index.entries[0].criticalPath = true;
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /exactly one critical path is required; found 2/u
  );
});

test("não permite abandonar experimento anterior ainda aberto", async () => {
  const index = await fixture();
  const previous = index.entries.at(-2);
  previous.status = "active";
  previous.canonicalReport = null;
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /não pode permanecer aberto fora do caminho crítico/u
  );
});

test("rejeita lacuna na sequência canônica e cobertura legada parcial", async () => {
  const missingEntry = await fixture();
  missingEntry.entries.splice(3, 1);
  await assert.rejects(
    validateExperimentIndex(missingEntry, { projectRoot }),
    /entries must cover the canonical decision range exactly/u
  );

  const partialLegacy = await fixture();
  partialLegacy.coverage.legacyRange = "anything";
  partialLegacy.coverage.legacyExperimentDocs =
    partialLegacy.coverage.legacyExperimentDocs.slice(0, 1);
  await assert.rejects(
    validateExperimentIndex(partialLegacy, { projectRoot }),
    /legacyRange must be an inclusive experiment range/u
  );
});

test("rejeita probe paralelo que bloqueie ou receba autoridade", async () => {
  const blocking = await fixture();
  blocking.currentParallelProbe.blocking = true;
  await assert.rejects(
    validateExperimentIndex(blocking, { projectRoot }),
    /currentParallelProbe must be non-blocking/u
  );

  const authoritative = await fixture();
  authoritative.currentParallelProbe.authority = "shadow-only";
  await assert.rejects(
    validateExperimentIndex(authoritative, { projectRoot }),
    /currentParallelProbe must have zero authority/u
  );

  const unrelated = await fixture();
  unrelated.currentParallelProbe.id = "EXP-9999-R";
  await assert.rejects(
    validateExperimentIndex(unrelated, { projectRoot }),
    /must be the R track of currentCriticalPath/u
  );
});

test("rejeita autoridade sem relatório e drift contra decisão canônica", async () => {
  const activeAuthority = await fixture();
  activeAuthority.entries.at(-1).authority = "runtime-control";
  await assert.rejects(
    validateExperimentIndex(activeAuthority, { projectRoot }),
    /cannot have authority before a canonical report/u
  );

  const cutAuthority = await fixture();
  cutAuthority.entries.find(({ id }) => id === "EXP-0017").authority =
    "runtime-control";
  await assert.rejects(
    validateExperimentIndex(cutAuthority, { projectRoot }),
    /authority contradicts its canonical report contract/u
  );

  const promotedAuthority = await fixture();
  promotedAuthority.entries.find(({ id }) => id === "EXP-0016").authority =
    "runtime-control";
  await assert.rejects(
    validateExperimentIndex(promotedAuthority, { projectRoot }),
    /authority contradicts its canonical report contract/u
  );

  const inventedDecision = await fixture();
  inventedDecision.entries.find(({ id }) => id === "EXP-0016").decision =
    "promote-to-production";
  await assert.rejects(
    validateExperimentIndex(inventedDecision, { projectRoot }),
    /decision contradicts its canonical report/u
  );
});
