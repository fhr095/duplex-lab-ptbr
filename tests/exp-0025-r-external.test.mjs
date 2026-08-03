import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import developmentPack from
  "../eval/datasets/exp-0025-r-development-v0.1.json" with { type: "json" };
import {
  EXP0025_R_EXTERNAL_CANDIDATE_ID,
  EXP0025_R_EXTERNAL_RAW_SCHEMA,
  analyzeExp0025RExternalDevelopment,
  validateExp0025RExternalRawEvidence
} from "../src/eval/exp-0025-r-external.mjs";
import {
  EXP0025_R_TOKENS,
  replayAdaptiveEndpoint
} from "../src/eval/exp-0025-r-floor-control.mjs";
import { validateExp0025RExternalAuthorization } from
  "../scripts/check-exp-0025-r-external-authorization.mjs";

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

test("autorização prospectiva vincula D e torna H-L inelegível para E", async () => {
  const validation = await validateExp0025RExternalAuthorization({
    preflight: true
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
});
