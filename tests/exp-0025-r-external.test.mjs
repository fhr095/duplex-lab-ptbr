import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import developmentPack from
  "../eval/datasets/exp-0025-r-development-v0.1.json" with { type: "json" };
import priorExternalRaw from
  "../eval/evidence/exp-0025-r-external-development-raw-v0.1.json" with {
    type: "json"
  };
import {
  analyzeExp0025RExternalDOnlyDevelopment,
  joinExp0025RExternalEvidence,
  validateExp0025RDOnlyRawEvidence
} from "../src/eval/exp-0025-r-external-d-only.mjs";
import {
  EXP0025_R_EXTERNAL_CANDIDATE_ID,
  EXP0025_R_EXTERNAL_RAW_SCHEMA,
  analyzeExp0025RExternalDevelopment,
  validateExp0025RExternalRawEvidence
} from "../src/eval/exp-0025-r-external.mjs";
import {
  evaluateDuplexCascadeOfficialRuntimeSentinels,
  interpretDuplexCascadeOfficialRuntime
} from "../src/eval/exp-0025-r-official-runtime-semantics.mjs";
import {
  EXP0025_R_TOKENS,
  replayAdaptiveEndpoint
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { validateExp0025RExternalAuthorization } from
  "../scripts/check-exp-0025-r-external-authorization.mjs";
import { validateExp0025RDOnlyAuthorization } from
  "../scripts/check-exp-0025-r-external-d-only-authorization.mjs";

const validSentinels = [
  { id: "english-user-talking", output: EXP0025_R_TOKENS.userTalking },
  { id: "english-user-finished", output: EXP0025_R_TOKENS.userFinish },
  { id: "english-user-backchannel", output: EXP0025_R_TOKENS.userBackchannel },
  { id: "english-user-interruption", output: EXP0025_R_TOKENS.userInterruption }
];

function observation(utterance, firstTakeFloorAtMs) {
  return {
    id: utterance.id,
    generations: firstTakeFloorAtMs === null
      ? [{
          atMs: utterance.criticalBoundaryAtMs,
          assistantSpeaking: false,
          deltaText: utterance.microturns.at(-1).deltaText,
          decodedRaw: EXP0025_R_TOKENS.userTalking,
          generationLatencyMs: 10
        }]
      : [{
          atMs: firstTakeFloorAtMs,
          assistantSpeaking: false,
          deltaText: null,
          decodedRaw: EXP0025_R_TOKENS.userFinish,
          generationLatencyMs: 10
        }]
  };
}

function a0At600Observations() {
  return developmentPack.utterances.map((utterance) => {
    const replay = replayAdaptiveEndpoint(utterance, { gridMs: 600 });
    return observation(utterance, replay.firstTakeFloorAtMs);
  });
}

function validDOnlyRaw() {
  return {
    schemaVersion: "exp-0025-r-external-d-only-raw-evidence-v1",
    experimentId: "EXP-0025-R",
    candidateId: EXP0025_R_EXTERNAL_CANDIDATE_ID,
    stage: "DEVELOPMENT_D_ONLY_AFTER_OFFICIAL_SENTINELS",
    status: "COMPLETED",
    authorization: {
      sentinelRerunAuthorized: false,
      developmentAuthorized: true,
      holdoutInferenceAuthorized: false,
      localReproductionAuthorized: false,
      automaticRetryAuthorized: false
    },
    priorSentinelEvidence: {
      officialSentinelsPassed: 4,
      sentinelGenerationsThisRun: 0
    },
    configuration: {
      overlapWindowSeconds: 0.6,
      maxNewTokens: 64,
      doSample: false,
      infraSeed: 25025,
      freePromptAdded: false,
      quantized: false,
      officialRuntimeContextMapping: true
    },
    checkpoint: {
      officialCodeCommit: "42893024ca90c8de8ac3ed624467ebc123512ff8",
      externalSnapshotCommit: "dca21cb1309bb533d80f5aa5600c7b0cc2c470e3",
      baseSnapshotCommit: "f2826a00ceef68f0f2b946d945ecc0477ce4450c"
    },
    inputs: { holdoutTransferred: false },
    modelLoad: {
      missingKeys: Array.from({ length: 112 }, (_, index) =>
        `model.layers.${index}.q_proj.base_layer.weight`),
      unexpectedKeys: Array.from({ length: 112 }, (_, index) =>
        `model.layers.${index}.q_proj.weight`)
    },
    budget: {
      projectedCumulativeTransferBytes: 70_373_808_158,
      cumulativeGpuSeconds: 1_500,
      cumulativeEstimatedCostUsd: 2
    },
    development: a0At600Observations(),
    evidenceSha256: "0".repeat(64)
  };
}

test("E só justifica H fresco com ganho residual seguro sobre A0@600", () => {
  const observations = a0At600Observations();
  const gridPremature = developmentPack.utterances.filter((utterance) => {
    const replay = replayAdaptiveEndpoint(utterance, { gridMs: 600 });
    return utterance.outcome === "CONTINUES" && replay.prematureTakeover;
  });
  const failuresBySession = new Map(gridPremature.map((utterance) => [
    utterance.sessionId,
    gridPremature.filter((item) => item.sessionId === utterance.sessionId).length
  ]));
  const corrected = gridPremature.find((utterance) =>
    failuresBySession.get(utterance.sessionId) === 1);
  observations.splice(
    observations.findIndex((item) => item.id === corrected.id),
    1,
    observation(corrected, null)
  );

  const analysis = analyzeExp0025RExternalDevelopment({
    pack: developmentPack,
    sentinelObservations: validSentinels,
    developmentObservations: observations
  });
  assert.equal(analysis.sentinels.status, "PASS");
  assert.equal(analysis.againstA0At600.correctedPrematureTakeovers, 1);
  assert.equal(analysis.againstA0At600.introducedPrematureTakeovers, 0);
  assert.equal(analysis.freshHoldoutJustified, true);
  assert.equal(
    analysis.decision,
    "JUSTIFY_FRESH_EXTERNAL_HOLDOUT_PREREGISTRATION"
  );
  assert.equal(analysis.freshHoldoutAuthorized, false);
  assert.equal(analysis.localReproductionAuthorized, false);
  assert.equal(analysis.oldHoldoutConfirmatoryEligible, false);
});

test("uma regressão contra A0@600 corta E mesmo que outra fala melhore", () => {
  const observations = a0At600Observations();
  const continuing = developmentPack.utterances.filter((utterance) =>
    utterance.outcome === "CONTINUES");
  const corrected = continuing.find((utterance) =>
    replayAdaptiveEndpoint(utterance, { gridMs: 600 }).prematureTakeover);
  const introduced = continuing.find((utterance) =>
    !replayAdaptiveEndpoint(utterance, { gridMs: 600 }).prematureTakeover);
  observations.splice(
    observations.findIndex((item) => item.id === corrected.id),
    1,
    observation(corrected, null)
  );
  observations.splice(
    observations.findIndex((item) => item.id === introduced.id),
    1,
    observation(introduced, introduced.criticalBoundaryAtMs)
  );
  const analysis = analyzeExp0025RExternalDevelopment({
    pack: developmentPack,
    sentinelObservations: validSentinels,
    developmentObservations: observations
  });
  assert.equal(analysis.againstA0At600.introducedPrematureTakeovers, 1);
  assert.equal(analysis.freshHoldoutJustified, false);
  assert.equal(analysis.decision, "CUT_EXTERNAL_MICROTURN_FRONT");
});

test("falha de sentinela impede qualquer leitura de D", () => {
  const invalid = structuredClone(validSentinels);
  invalid[2].output = EXP0025_R_TOKENS.userFinish;
  const analysis = analyzeExp0025RExternalDevelopment({
    pack: developmentPack,
    sentinelObservations: invalid,
    developmentObservations: []
  });
  assert.equal(analysis.sentinels.status, "E_PROTOCOL_FAILURE");
  assert.equal(analysis.developmentEvaluated, false);
  assert.equal(analysis.decision, "CUT_E_PROTOCOL_FAILURE");
});

test("evidência bruta fecha checkpoint, configuração e ausência de H", () => {
  const raw = {
    schemaVersion: EXP0025_R_EXTERNAL_RAW_SCHEMA,
    experimentId: "EXP-0025-R",
    candidateId: EXP0025_R_EXTERNAL_CANDIDATE_ID,
    status: "COMPLETED",
    authorization: {
      holdoutInferenceAuthorized: false,
      localReproductionAuthorized: false
    },
    configuration: {
      overlapWindowSeconds: 0.6,
      maxNewTokens: 64,
      doSample: false
    },
    checkpoint: {
      officialCodeCommit: "42893024ca90c8de8ac3ed624467ebc123512ff8",
      externalSnapshotCommit: "dca21cb1309bb533d80f5aa5600c7b0cc2c470e3",
      baseSnapshotCommit: "f2826a00ceef68f0f2b946d945ecc0477ce4450c"
    },
    sentinels: Array.from({ length: 4 }, () => ({})),
    development: Array.from({ length: 32 }, () => ({}))
  };
  assert.equal(validateExp0025RExternalRawEvidence(raw), true);
  raw.authorization.holdoutInferenceAuthorized = true;
  assert.equal(validateExp0025RExternalRawEvidence(raw), false);
});

test("adaptador externo não possui rota de holdout, sweep ou quantização", async () => {
  const source = await readFile("scripts/run_exp_0025_r_external.py", "utf8");
  assert.doesNotMatch(source, /exp-0025-r-holdout|--holdout|--checkpoint/iu);
  assert.doesNotMatch(source, /quantization_config|load_in_4bit|load_in_8bit/iu);
  assert.match(source, /do_sample=False/u);
  assert.match(source, /MAX_NEW_TOKENS = 64/u);
  assert.match(source, /OVERLAP_WINDOW_SECONDS = 0\.6/u);
});

test("adaptador acrescenta cada delta textual uma única vez por microturno", async () => {
  const source = await readFile("scripts/run_exp_0025_r_external.py", "utf8");
  const encodeDeltaCalls = source.match(
    /self\.tokenizer\.encode\(delta_text, add_special_tokens=False\)/gu
  ) ?? [];
  assert.equal(encodeDeltaCalls.length, 1);
});

test("semântica oficial faz user talking ceder piso durante fala assistente", () => {
  assert.equal(interpretDuplexCascadeOfficialRuntime({
    assistantSpeaking: true,
    output: EXP0025_R_TOKENS.userTalking
  }).action, "YIELD_FLOOR");
  assert.equal(interpretDuplexCascadeOfficialRuntime({
    assistantSpeaking: false,
    output: EXP0025_R_TOKENS.userTalking
  }).action, "CONTINUE_LISTENING");
  const observations = structuredClone(validSentinels);
  observations.find((item) => item.id === "english-user-interruption").output =
    EXP0025_R_TOKENS.userTalking;
  assert.equal(
    evaluateDuplexCascadeOfficialRuntimeSentinels(observations).status,
    "PASS"
  );
});

test("D aceita a leitura oficial auditada sem reescrever saídas brutas", () => {
  const observations = structuredClone(validSentinels);
  observations.find((item) => item.id === "english-user-interruption").output =
    EXP0025_R_TOKENS.userTalking;
  const official = evaluateDuplexCascadeOfficialRuntimeSentinels(observations);
  const analysis = analyzeExp0025RExternalDOnlyDevelopment({
    pack: developmentPack,
    sentinelObservations: observations,
    developmentObservations: a0At600Observations(),
    officialRuntimeSentinelAnalysis: official
  });
  assert.equal(analysis.sentinels.status, "PASS");
  assert.equal(analysis.sentinels.results.at(-1).output,
    EXP0025_R_TOKENS.userTalking);
  assert.equal(analysis.developmentEvaluated, true);

  const invalid = structuredClone(official);
  invalid.officialRuntimeBinding.sha256 = "0".repeat(64);
  assert.throws(() => analyzeExp0025RExternalDOnlyDevelopment({
    pack: developmentPack,
    sentinelObservations: observations,
    developmentObservations: a0At600Observations(),
    officialRuntimeSentinelAnalysis: invalid
  }), /não fecha o binding/u);
});

test("evidência D-only exige mesmo candidato, zero H e 32 trajetórias", () => {
  const dOnly = validDOnlyRaw();
  assert.equal(validateExp0025RDOnlyRawEvidence(dOnly), true);
  const joined = joinExp0025RExternalEvidence(priorExternalRaw, dOnly);
  assert.equal(joined.sentinelObservations.length, 4);
  assert.equal(joined.developmentObservations.length, 32);
  assert.equal(joined.holdoutRead, false);
  dOnly.inputs.holdoutTransferred = true;
  assert.equal(validateExp0025RDOnlyRawEvidence(dOnly), false);
});

test("quarta alocação é D-only, final e não transfere H ou sentinelas", async () => {
  const validation = await validateExp0025RDOnlyAuthorization({
    preflight: false
  });
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
  assert.equal(validation.authorization.providerExecution.infrastructureAttempt,
    4);
  assert.equal(validation.authorization.providerExecution.finalAdditionalAllocation,
    true);
  assert.equal(validation.authorization.providerExecution.automaticRetryAllowed,
    false);
  assert.equal(validation.authorization.cumulativeBudget.maximumDownloadGiB,
    70);
  assert.equal(validation.authorization.oldHoldout.executionAuthorized, false);

  const [pythonSource, providerSource] = await Promise.all([
    readFile("scripts/run_exp_0025_r_external_d_only.py", "utf8"),
    readFile("scripts/run-exp-0025-r-runpod-d-only.mjs", "utf8")
  ]);
  assert.doesNotMatch(pythonSource, /run_sentinels\(/u);
  assert.match(pythonSource, /shared\.run_development\(/u);
  assert.doesNotMatch(providerSource, /exp-0025-r-holdout/iu);
  assert.doesNotMatch(providerSource, /external-sentinels-v0\.1/iu);
  assert.match(providerSource, /INFRASTRUCTURE_ATTEMPT = 4/u);
  assert.match(providerSource, /MAX_DOWNLOAD_BYTES = 70 \* 1024 \*\* 3/u);
});

test("entrypoint corretivo altera somente a resolução do import remoto", async () => {
  const wrapperSource = await readFile(
    "scripts/run_exp_0025_r_external_d_only_v2.py",
    "utf8"
  );
  assert.match(
    wrapperSource,
    /PROJECT_ROOT = Path\(__file__\)\.resolve\(\)\.parents\[1\]/u
  );
  assert.match(wrapperSource, /sys\.path\.insert\(0, str\(PROJECT_ROOT\)\)/u);
  assert.match(
    wrapperSource,
    /from scripts\.run_exp_0025_r_external_d_only import main/u
  );
  assert.doesNotMatch(wrapperSource, /from_pretrained|run_development|run_sentinels/u);
});

test("autorização prospectiva vincula D e torna H-L inelegível para E", async () => {
  const validation = await validateExp0025RExternalAuthorization({
    preflight: false
  });
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
  assert.equal(
    validation.authorization.oldHoldout.statusForExternalCandidate,
    "INELIGIBLE_FOR_CONFIRMATION"
  );
  assert.equal(
    validation.authorization.freshExternalHoldout.creationAuthorized,
    false
  );
  assert.equal(
    validation.authorization.providerExecution.gpuTypeId,
    "NVIDIA H100 PCIe"
  );
  assert.equal(
    validation.authorization.providerExecution.dataBoundary.holdoutTransferred,
    false
  );
  assert.equal(
    validation.authorization.providerExecution.terminationRequiredInFinally,
    true
  );
  assert.equal(
    validation.authorization.providerExecution.infrastructureRetry.attempt1
      .sentinelOrDevelopmentGenerationCount,
    0
  );
  assert.equal(
    validation.authorization.providerExecution.infrastructureRetry.attempt2
      .modelInferenceAttemptOrdinal,
    1
  );
  assert.equal(
    validation.authorization.providerExecution.infrastructureRetry.attempt3
      .terminalInfrastructureAttempt,
    true
  );
  assert.equal(
    validation.authorization.providerExecution.infrastructureRetry.attempt3
      .modelInferenceAttemptOrdinal,
    1
  );
});
