import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXP0018_CANONICAL_OUTCOMES,
  EXP0020_CANONICAL_REPORT_PATH,
  EXP0021_CANONICAL_REPORT_PATH,
  EXP0022_CANONICAL_REPORT_PATH,
  EXP0023_CANONICAL_REPORT_PATH,
  EXP0023_EVIDENCE_COMMIT,
  EXP0024_CANONICAL_REPORT_PATH,
  EXP0024_EVIDENCE_COMMIT,
  EXP0025_R_EXTERNAL_CANONICAL_REPORT_PATH,
  EXP0025_R_EXTERNAL_EVIDENCE_COMMIT,
  EXP0025_R_EXTERNAL_TERMINAL_CLOSEOUT_PATH,
  EXP0025_R_EXTERNAL_TERMINAL_EVIDENCE_COMMIT,
  EXP0025_R_LOCAL_CANONICAL_REPORT_PATH,
  EXP0025_R_LOCAL_EVIDENCE_COMMIT,
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
    currentCriticalPath: "EXP-0026",
    currentParallelProbe: {
      status: "planned",
      decision: "probe novo e independente"
    }
  }, "PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN"));
  assert.throws(() => validateExp0018HistoricalOutcome({
    ...entry,
    parallelProbeOutcome: { ...entry.parallelProbeOutcome, status: "cut" }
  }, {
    currentCriticalPath: "EXP-0023",
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
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.currentCriticalPath, "EXP-0026");
  assert.equal(index.transitionState, "active");
  assert.equal(index.currentParallelProbe, null);
  const exp0025R = index.parallelProbeHistory.find(
    ({ id }) => id === "EXP-0025-R"
  );
  assert.ok(exp0025R);
  assert.equal(exp0025R.status, "cut");
  assert.equal(exp0025R.blocking, false);
  assert.equal(
    exp0025R.preRegistration,
    "docs/experiments/EXP-0025-R-duplexcascade-floor-control.md"
  );
  assert.equal(
    exp0025R.canonicalReport,
    EXP0025_R_LOCAL_CANONICAL_REPORT_PATH
  );
  assert.equal(
    exp0025R.evidenceCommit,
    EXP0025_R_LOCAL_EVIDENCE_COMMIT
  );
  assert.equal(
    exp0025R.externalSentinelResult.canonicalReport,
    EXP0025_R_EXTERNAL_CANONICAL_REPORT_PATH
  );
  assert.equal(
    exp0025R.externalSentinelResult.evidenceCommit,
    EXP0025_R_EXTERNAL_EVIDENCE_COMMIT
  );
  assert.equal(
    exp0025R.externalSentinelResult.officialSentinelsPassed,
    4
  );
  assert.equal(
    exp0025R.externalSentinelResult.developmentEvaluated,
    false
  );
  assert.equal(exp0025R.externalSentinelResult.holdoutRead,
    false);
  assert.equal(
    exp0025R.externalTerminalResult.status,
    "not-evaluated-environment-blocked-terminal"
  );
  assert.equal(
    exp0025R.externalTerminalResult.decision,
    "CUT_EXTERNAL_MICROTURN_FRONT_ENVIRONMENT_BLOCKED"
  );
  assert.equal(
    exp0025R.externalTerminalResult.evidenceCommit,
    EXP0025_R_EXTERNAL_TERMINAL_EVIDENCE_COMMIT
  );
  assert.equal(
    exp0025R.externalTerminalResult.closeout,
    EXP0025_R_EXTERNAL_TERMINAL_CLOSEOUT_PATH
  );
  assert.equal(
    exp0025R.externalTerminalResult.developmentEvaluated,
    false
  );
  assert.equal(
    exp0025R.externalTerminalResult.activePodsAfterRecovery,
    0
  );
  assert.equal(exp0025R.technicalQuestion.status, "UNRESOLVED");
  assert.equal(
    exp0025R.technicalQuestion.priorityDisposition,
    "DEFERRED_BY_PRODUCT_PRIORITY"
  );
  assert.equal(exp0025R.technicalQuestion.hypothesisRefuted, false);
  assert.match(exp0025R.decision, /1\.200 ms > 800 ms/u);
  assert.match(exp0025R.nextDecision, /Não repetir/u);

  const exp0025 = index.entries.find(({ id }) => id === "EXP-0025");
  assert.equal(exp0025.status, "cut");
  assert.equal(
    exp0025.preRegistration,
    "docs/experiments/EXP-0025-causal-render-onset-physical-stop.md"
  );
  assert.equal(
    exp0025.canonicalReport,
    "eval/reports/exp-0025-causal-render-onset-physical-stop-v0.1.json"
  );
  assert.equal(
    exp0025.evidenceCommit,
    "65a7b6019ab4b7231d0c79b0bff724373bdf6aea"
  );
  assert.equal(exp0025.authority, "none");
  assert.equal(exp0025.criticalPath, false);
  assert.deepEqual(exp0025.cleanCloneChecks, [
    "node --test tests/experiment-index.test.mjs",
    "node --test tests/exp-0025-preregistration.test.mjs",
    "node --test tests/exp-0025-boundary.test.mjs",
    "node --test tests/exp-0025-browser-harness.test.mjs",
    "node --test tests/exp-0025-browser-trial.test.mjs",
    "node --test tests/exp-0025-journal.test.mjs",
    "node --test tests/exp-0025-stop-order.test.mjs",
    "node --test tests/exp-0025-supervisor.test.mjs",
    "node --test tests/exp-0025-worker.test.mjs"
  ]);

  const exp0026 = index.entries.at(-1);
  assert.equal(exp0026.id, "EXP-0026");
  assert.equal(exp0026.status, "active");
  assert.equal(exp0026.canonicalReport, null);
  assert.equal(exp0026.evidenceCommit, null);
  assert.equal(exp0026.authority, "none");
  assert.equal(exp0026.criticalPath, true);
  assert.equal(
    exp0026.preRegistration,
    "docs/experiments/EXP-0026-end-to-end-experience-bottleneck-diagnostic.md"
  );
  assert.deepEqual(exp0026.cleanCloneChecks, [
    "node --test tests/exp-0026-preregistration.test.mjs",
    "node --test tests/exp-0026-instrument.test.mjs",
    "node --test tests/exp-0026-session-store.test.mjs",
    "node --test tests/exp-0026-blind-analysis.test.mjs",
    "node --test tests/exp-0026-freeze.test.mjs",
    "node --test tests/exp-0026-qualification-reports.test.mjs",
    "node --test tests/experiment-index.test.mjs",
    "node --test tests/documentation-consistency.test.mjs"
  ]);
  assert.equal(
    index.entries.some(({ id }) => id === "EXP-0026-R"),
    false
  );
  const exp0024 = index.entries.find(({ id }) => id === "EXP-0024");
  assert.equal(exp0024.status, "invalidated");
  assert.equal(
    exp0024.decision,
    "INVALIDATE_PHYSICAL_STOP_AFTER_CAPTURE_QUALIFICATION"
  );
  assert.equal(exp0024.canonicalReport, EXP0024_CANONICAL_REPORT_PATH);
  assert.equal(exp0024.evidenceCommit, EXP0024_EVIDENCE_COMMIT);
  assert.equal(exp0024.authority, "none");
  assert.equal(exp0024.criticalPath, false);
  assert.deepEqual(exp0024.cleanCloneChecks, [
    "node --test tests/exp-0024-boundary.test.mjs",
    "node --test tests/exp-0024-browser-harness.test.mjs",
    "node --test tests/exp-0024-journal.test.mjs",
    "node --test tests/exp-0024-stop-order.test.mjs",
    "node --test tests/exp-0024-supervisor.test.mjs",
    "node --test tests/exp-0024-worker.test.mjs"
  ]);
  const exp0023 = index.entries.find(({ id }) => id === "EXP-0023");
  assert.equal(exp0023.status, "completed");
  assert.equal(
    exp0023.decision,
    "PASS_CDP_TTS_CAPTURE_AFTER_ORDINAL_BINDING"
  );
  assert.equal(exp0023.canonicalReport, EXP0023_CANONICAL_REPORT_PATH);
  assert.equal(
    exp0023.evidenceCommit,
    EXP0023_EVIDENCE_COMMIT
  );
  assert.equal(exp0023.authority, "none");
  assert.equal(exp0023.criticalPath, false);
  assert.deepEqual(exp0023.cleanCloneChecks, [
    "node --test tests/exp-0021-cdp-capture.test.mjs",
    "node --test tests/exp-0022-worker.test.mjs",
    "node --test tests/exp-0023-boundary.test.mjs",
    "node --test tests/exp-0023-supervisor.test.mjs",
    "node --test tests/exp-0023-analysis.test.mjs"
  ]);
  const exp0022 = index.entries.find(({ id }) => id === "EXP-0022");
  assert.equal(exp0022.status, "invalidated");
  assert.equal(
    exp0022.decision,
    "INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING"
  );
  assert.equal(exp0022.canonicalReport, EXP0022_CANONICAL_REPORT_PATH);
  assert.equal(
    exp0022.evidenceCommit,
    "b8aba7c49715e846a57bafbcbb1eeb4dee2f8a56"
  );
  assert.equal(exp0022.authority, "none");
  assert.equal(exp0022.criticalPath, false);
  assert.deepEqual(exp0022.cleanCloneChecks, [
    "node --test tests/exp-0021-cdp-capture.test.mjs",
    "node --test tests/exp-0022-boundary.test.mjs",
    "node --test tests/exp-0022-supervisor.test.mjs",
    "node --test tests/exp-0022-worker.test.mjs",
    "node --test tests/exp-0022-analysis.test.mjs"
  ]);
  const exp0021 = index.entries.find(({ id }) => id === "EXP-0021");
  assert.equal(exp0021.status, "invalidated");
  assert.equal(
    exp0021.decision,
    "INVALIDATE_CDP_TTS_CAPTURE_QUALIFICATION"
  );
  assert.equal(exp0021.canonicalReport, EXP0021_CANONICAL_REPORT_PATH);
  assert.equal(
    exp0021.evidenceCommit,
    "5c3d810c065d28b2d8c5f56f5ade4e9e284cc84f"
  );
  assert.equal(exp0021.authority, "none");
  assert.equal(exp0021.criticalPath, false);
  assert.deepEqual(exp0021.cleanCloneChecks, [
    "node --test tests/exp-0021-boundary.test.mjs",
    "node --test tests/exp-0021-worker.test.mjs",
    "node --test tests/exp-0021-cdp-capture.test.mjs",
    "node --test tests/exp-0021-supervisor.test.mjs",
    "node --test tests/exp-0021-analysis.test.mjs",
    "node --test tests/experiment-index.test.mjs"
  ]);
  const exp0020 = index.entries.find(({ id }) => id === "EXP-0020");
  assert.equal(exp0020.status, "invalidated");
  assert.equal(exp0020.decision, "INVALIDATE_STOP_ORDER_INSTRUMENT");
  assert.equal(
    exp0020.canonicalReport,
    EXP0020_CANONICAL_REPORT_PATH
  );
  assert.equal(
    exp0020.evidenceCommit,
    "404a06d5a7eba90ae72690e8870966770b97902a"
  );
  assert.equal(exp0020.authority, "none");
  assert.equal(exp0020.criticalPath, false);
  assert.deepEqual(exp0020.cleanCloneChecks, [
    "node --test tests/exp-0020-boundary.test.mjs",
    "node --test tests/exp-0020-browser-harness.test.mjs",
    "node --test tests/exp-0020-browser-runner.test.mjs",
    "node --test tests/exp-0020-analysis.test.mjs",
    "node --test tests/experiment-index.test.mjs"
  ]);
  const exp0019 = index.entries.find(({ id }) => id === "EXP-0019");
  assert.equal(
    exp0019.canonicalReport,
    "eval/reports/exp-0019-causal-audio-v0.1.json"
  );
  assert.equal(
    exp0019.evidenceCommit,
    "0127322ad18a5b1d98de53d9e45898249e05888d"
  );
  assert.equal(exp0019.authority, "none");
  assert.equal(
    exp0019.decision,
    "CUT_CAUSAL_AUDIO_BRIDGE"
  );
  assert.equal(exp0019.criticalPath, false);
  assert.ok(exp0019.cleanCloneChecks.length >= 5);
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

test("EXP-0019 terminal não pode apagar o corte físico do relatório", async () => {
  const index = await fixture();
  const entry = index.entries.find(({ id }) => id === "EXP-0019");
  entry.status = "completed";
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /EXP-0019.status contradicts its canonical report contract/u
  );
});

test("EXP-0020 preserva invalidação sem inventar avaliação física", async () => {
  const changedStatus = await fixture();
  changedStatus.entries.find(({ id }) => id === "EXP-0020").status =
    "completed";
  await assert.rejects(
    validateExperimentIndex(changedStatus, { projectRoot }),
    /EXP-0020.status contradicts its canonical report contract/u
  );

  const inventedDecision = await fixture();
  inventedDecision.entries.find(({ id }) => id === "EXP-0020").decision =
    "PASS_TELEMETRY_ORDER_EQUIVALENT";
  await assert.rejects(
    validateExperimentIndex(inventedDecision, { projectRoot }),
    /EXP-0020.decision contradicts its canonical report/u
  );

  const preEvidenceCommit = await fixture();
  preEvidenceCommit.entries.find(({ id }) => id === "EXP-0020")
    .evidenceCommit = "0d060b02fa0d73ae980966c43e54a4381094f042";
  await assert.rejects(
    validateExperimentIndex(preEvidenceCommit, { projectRoot }),
    /EXP-0020 canonical report não existia no commit declarado/u
  );
});

test("EXP-0021 preserva captura avaliada sem apagar invalidação", async () => {
  const changedStatus = await fixture();
  changedStatus.entries.find(({ id }) => id === "EXP-0021").status =
    "completed";
  await assert.rejects(
    validateExperimentIndex(changedStatus, { projectRoot }),
    /EXP-0021.status contradicts its canonical report contract/u
  );

  const inventedDecision = await fixture();
  inventedDecision.entries.find(({ id }) => id === "EXP-0021").decision =
    "PASS_CDP_TTS_CAPTURE_QUALIFICATION";
  await assert.rejects(
    validateExperimentIndex(inventedDecision, { projectRoot }),
    /EXP-0021.decision contradicts its canonical report/u
  );

  const inventedAuthority = await fixture();
  inventedAuthority.entries.find(({ id }) => id === "EXP-0021").authority =
    "shadow-only";
  await assert.rejects(
    validateExperimentIndex(inventedAuthority, { projectRoot }),
    /EXP-0021.authority contradicts its canonical report contract/u
  );

  const preEvidenceCommit = await fixture();
  preEvidenceCommit.entries.find(({ id }) => id === "EXP-0021")
    .evidenceCommit = "b334f4d1de3b2b0092b567d69ff5abdc15fa7215";
  await assert.rejects(
    validateExperimentIndex(preEvidenceCommit, { projectRoot }),
    /EXP-0021 canonical report não existia no commit declarado/u
  );
});

test("EXP-0022 preserva inversão temporal sem inventar passe", async () => {
  const changedStatus = await fixture();
  changedStatus.entries.find(({ id }) => id === "EXP-0022").status =
    "completed";
  await assert.rejects(
    validateExperimentIndex(changedStatus, { projectRoot }),
    /EXP-0022.status contradicts its canonical report contract/u
  );

  const inventedDecision = await fixture();
  inventedDecision.entries.find(({ id }) => id === "EXP-0022").decision =
    "PASS_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING";
  await assert.rejects(
    validateExperimentIndex(inventedDecision, { projectRoot }),
    /EXP-0022.decision contradicts its canonical report/u
  );

  const inventedAuthority = await fixture();
  inventedAuthority.entries.find(({ id }) => id === "EXP-0022").authority =
    "shadow-only";
  await assert.rejects(
    validateExperimentIndex(inventedAuthority, { projectRoot }),
    /EXP-0022.authority contradicts its canonical report contract/u
  );

  const preEvidenceCommit = await fixture();
  preEvidenceCommit.entries.find(({ id }) => id === "EXP-0022")
    .evidenceCommit = "8d52894a0ba27a758a3a8c87e41ac8f2bdf99a9e";
  await assert.rejects(
    validateExperimentIndex(preEvidenceCommit, { projectRoot }),
    /EXP-0022 canonical report não existia no commit declarado/u
  );
});

test("EXP-0023 preserva passe instrumental sem conceder autoridade", async () => {
  const changedStatus = await fixture();
  changedStatus.entries.find(({ id }) => id === "EXP-0023").status =
    "promoted";
  await assert.rejects(
    validateExperimentIndex(changedStatus, { projectRoot }),
    /EXP-0023.status contradicts its canonical report contract/u
  );

  const inventedDecision = await fixture();
  inventedDecision.entries.find(({ id }) => id === "EXP-0023").decision =
    "promote-runtime";
  await assert.rejects(
    validateExperimentIndex(inventedDecision, { projectRoot }),
    /EXP-0023.decision contradicts its canonical report/u
  );

  const inventedAuthority = await fixture();
  inventedAuthority.entries.find(({ id }) => id === "EXP-0023").authority =
    "runtime-control";
  await assert.rejects(
    validateExperimentIndex(inventedAuthority, { projectRoot }),
    /EXP-0023.authority contradicts its canonical report contract/u
  );

  const preEvidenceCommit = await fixture();
  preEvidenceCommit.entries.find(({ id }) => id === "EXP-0023")
    .evidenceCommit = "30813869f3a2bdbf0c69ca3bf72073b68d54c361";
  await assert.rejects(
    validateExperimentIndex(preEvidenceCommit, { projectRoot }),
    /EXP-0023 evidenceCommit precisa ser o fechamento oficial imutável/u
  );
});

test("EXP-0024 preserva falha instrumental sem inventar resultado físico", async () => {
  const changedStatus = await fixture();
  changedStatus.entries.find(({ id }) => id === "EXP-0024").status =
    "completed";
  await assert.rejects(
    validateExperimentIndex(changedStatus, { projectRoot }),
    /EXP-0024.status contradicts its canonical report contract/u
  );

  const inventedDecision = await fixture();
  inventedDecision.entries.find(({ id }) => id === "EXP-0024").decision =
    "PASS_PHYSICAL_STOP_AFTER_CAPTURE_QUALIFICATION";
  await assert.rejects(
    validateExperimentIndex(inventedDecision, { projectRoot }),
    /EXP-0024.decision contradicts its canonical report/u
  );

  const inventedAuthority = await fixture();
  inventedAuthority.entries.find(({ id }) => id === "EXP-0024").authority =
    "runtime-control";
  await assert.rejects(
    validateExperimentIndex(inventedAuthority, { projectRoot }),
    /EXP-0024.authority contradicts its canonical report contract/u
  );

  const preEvidenceCommit = await fixture();
  preEvidenceCommit.entries.find(({ id }) => id === "EXP-0024")
    .evidenceCommit = "a860e7806193286d79bda5a1cfc373ff8d03710d";
  await assert.rejects(
    validateExperimentIndex(preEvidenceCommit, { projectRoot }),
    /EXP-0024 evidenceCommit precisa ser o fechamento oficial imutável/u
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

test("rejeita histórico paralelo bloqueante, autoritativo ou refutado", async () => {
  const blocking = await fixture();
  blocking.parallelProbeHistory[0].blocking = true;
  await assert.rejects(
    validateExperimentIndex(blocking, { projectRoot }),
    /parallelProbeHistory entries must be non-blocking/u
  );

  const authoritative = await fixture();
  authoritative.parallelProbeHistory[0].authority = "shadow-only";
  await assert.rejects(
    validateExperimentIndex(authoritative, { projectRoot }),
    /parallelProbeHistory entries must be non-blocking/u
  );

  const refuted = await fixture();
  refuted.parallelProbeHistory[0].technicalQuestion.hypothesisRefuted = true;
  await assert.rejects(
    validateExperimentIndex(refuted, { projectRoot }),
    /technical question must remain unresolved and deferred/u
  );
});

test("rejeita probe corrente alheio ou sem pré-registro canônico", async () => {
  const unrelated = await fixture();
  unrelated.currentParallelProbe = {
    ...structuredClone(unrelated.parallelProbeHistory[0]),
    id: "EXP-9999-R",
    parent: "EXP-0026",
    status: "planned"
  };
  await assert.rejects(
    validateExperimentIndex(unrelated, { projectRoot }),
    /must be the R track of currentCriticalPath/u
  );

  const wrongPreRegistration = await fixture();
  wrongPreRegistration.currentParallelProbe = {
    ...structuredClone(wrongPreRegistration.parallelProbeHistory[0]),
    id: "EXP-0026-R",
    parent: "EXP-0026",
    status: "planned",
    preRegistration: "README.md"
  };
  await assert.rejects(
    validateExperimentIndex(wrongPreRegistration, { projectRoot }),
    /must match the canonical parallel probe preregistration/u
  );
});

test("rejeita troca unilateral do pré-registro crítico", async () => {
  const wrongCriticalPreRegistration = await fixture();
  wrongCriticalPreRegistration.entries.at(-1).preRegistration =
    "docs/experiments/EXP-0025-R-duplexcascade-floor-control.md";
  await assert.rejects(
    validateExperimentIndex(wrongCriticalPreRegistration, { projectRoot }),
    /must match the canonical critical preregistration/u
  );
});

test("rejeita clean-clone check inválido no experimento ativo", async () => {
  const index = await fixture();
  index.entries.at(-1).cleanCloneChecks = ["not-a-command"];
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /cleanCloneChecks must be direct Node test commands/u
  );
});

test("rejeita autoridade sem relatório e drift contra decisão canônica", async () => {
  const activeAuthority = await fixture();
  Object.assign(activeAuthority.entries.at(-1), {
    status: "active",
    canonicalReport: null,
    evidenceCommit: null,
    authority: "runtime-control"
  });
  activeAuthority.transitionState = "active";
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
