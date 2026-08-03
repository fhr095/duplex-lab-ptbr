import { isDeepStrictEqual } from "node:util";

import {
  EXP0025_R_EXTERNAL_CANDIDATE_ID,
  externalObservationToResult,
  validateExp0025RExternalRawEvidence
} from "./exp-0025-r-external.mjs";
import {
  replayAdaptiveEndpoint,
  validateExp0025RMaterializedPack
} from "./exp-0025-r-floor-control.mjs";
import { EXP0025_R_OFFICIAL_RUNTIME_BINDING } from
  "./exp-0025-r-official-runtime-semantics.mjs";

export const EXP0025_R_D_ONLY_RAW_SCHEMA =
  "exp-0025-r-external-d-only-raw-evidence-v1";

const CHECKPOINT = Object.freeze({
  officialCodeCommit: "42893024ca90c8de8ac3ed624467ebc123512ff8",
  externalSnapshotCommit: "dca21cb1309bb533d80f5aa5600c7b0cc2c470e3",
  baseSnapshotCommit: "f2826a00ceef68f0f2b946d945ecc0477ce4450c"
});

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nearestRankP95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function summarize(results) {
  const continues = results.filter((item) => item.outcome === "CONTINUES");
  const ends = results.filter((item) => item.outcome === "ENDS");
  const delays = ends.map((item) => item.postFinalDecisionDelayMs)
    .filter(finite);
  const sessionIds = new Set(results.map((item) => item.sessionId));
  return Object.freeze({
    utteranceCount: results.length,
    prematureTakeoverCount: continues.filter((item) =>
      item.prematureTakeover).length,
    preFinalTakeoverCount: ends.filter((item) =>
      item.preFinalTakeover).length,
    missedTakeoverCount: ends.filter((item) => item.missedTakeover).length,
    protocolFailureCount: results.filter((item) =>
      item.protocolFailure).length,
    postFinalDecisionDelayMs: Object.freeze({
      count: delays.length,
      minimum: delays.length > 0 ? Math.min(...delays) : null,
      median: median(delays),
      p95: nearestRankP95(delays),
      maximum: delays.length > 0 ? Math.max(...delays) : null
    }),
    sessionsWithPrematureTakeover: [...sessionIds].filter((sessionId) =>
      continues.some((item) => item.sessionId === sessionId &&
        item.prematureTakeover)).length
  });
}

function compare(a0Results, candidateResults) {
  const candidateById = new Map(candidateResults.map((item) => [item.id, item]));
  const paired = a0Results.map((a0) => ({
    a0,
    candidate: candidateById.get(a0.id)
  }));
  const continues = paired.filter(({ a0 }) => a0.outcome === "CONTINUES");
  const ends = paired.filter(({ a0 }) => a0.outcome === "ENDS");
  const sessionIds = new Set(a0Results.map((item) => item.sessionId));
  const failed = (side, sessionId) => continues.some((item) =>
    item[side]?.sessionId === sessionId && item[side].prematureTakeover);
  const corrected = continues.filter(({ a0, candidate }) =>
    a0.prematureTakeover && !candidate?.prematureTakeover);
  const introduced = continues.filter(({ a0, candidate }) =>
    !a0.prematureTakeover && candidate?.prematureTakeover);
  const improvedSessions = [...sessionIds].filter((sessionId) =>
    failed("a0", sessionId) && !failed("candidate", sessionId));
  const regressedSessions = [...sessionIds].filter((sessionId) =>
    !failed("a0", sessionId) && failed("candidate", sessionId));
  return Object.freeze({
    correctedPrematureTakeovers: corrected.length,
    correctedUtteranceIds: Object.freeze(corrected.map(({ a0 }) => a0.id)),
    introducedPrematureTakeovers: introduced.length,
    introducedUtteranceIds: Object.freeze(introduced.map(({ a0 }) => a0.id)),
    netPrematureTakeoverImprovement: corrected.length - introduced.length,
    sessionsImproved: improvedSessions.length,
    improvedSessionIds: Object.freeze(improvedSessions),
    safeSessionsRegressed: regressedSessions.length,
    regressedSessionIds: Object.freeze(regressedSessions),
    missedTakeoverDelta: ends.filter(({ candidate }) =>
      candidate?.missedTakeover).length - ends.filter(({ a0 }) =>
      a0.missedTakeover).length
  });
}

function addExternalDiagnostics(result) {
  return Object.freeze({
    ...result,
    family: null,
    preFinalTakeover: false
  });
}

function observationOutput(observation) {
  if (typeof observation?.output === "string") return observation.output;
  return Array.isArray(observation?.generations) &&
    observation.generations.length > 0
    ? observation.generations.at(-1)?.decodedRaw ?? null
    : null;
}

function validateOfficialSentinelGate(analysis, observations) {
  const byId = new Map((observations ?? []).map((item) =>
    [item?.id, observationOutput(item)]));
  return analysis?.status === "PASS" && analysis?.complete === true &&
    analysis?.passed === 4 && analysis?.expected === 4 &&
    isDeepStrictEqual(
      analysis?.officialRuntimeBinding,
      EXP0025_R_OFFICIAL_RUNTIME_BINDING
    ) && Array.isArray(analysis?.results) && analysis.results.length === 4 &&
    analysis.results.every((item) =>
      item?.pass === true && byId.get(item?.id) === item?.output);
}

function validModelLoad(modelLoad) {
  return Array.isArray(modelLoad?.missingKeys) &&
    modelLoad.missingKeys.length === 112 &&
    modelLoad.missingKeys.every((key) =>
      /\.(q_proj|v_proj)\.base_layer\.(weight|bias)$/u.test(key)) &&
    Array.isArray(modelLoad?.unexpectedKeys) &&
    modelLoad.unexpectedKeys.length === 112 &&
    modelLoad.unexpectedKeys.every((key) =>
      /\.(q_proj|v_proj)\.(weight|bias)$/u.test(key));
}

export function validateExp0025RDOnlyRawEvidence(raw) {
  try {
    const ids = raw.development.map((item) => item?.id);
    return raw?.schemaVersion === EXP0025_R_D_ONLY_RAW_SCHEMA &&
      raw?.experimentId === "EXP-0025-R" &&
      raw?.candidateId === EXP0025_R_EXTERNAL_CANDIDATE_ID &&
      raw?.stage === "DEVELOPMENT_D_ONLY_AFTER_OFFICIAL_SENTINELS" &&
      raw?.status === "COMPLETED" &&
      raw?.authorization?.sentinelRerunAuthorized === false &&
      raw?.authorization?.developmentAuthorized === true &&
      raw?.authorization?.holdoutInferenceAuthorized === false &&
      raw?.authorization?.localReproductionAuthorized === false &&
      raw?.authorization?.automaticRetryAuthorized === false &&
      raw?.priorSentinelEvidence?.officialSentinelsPassed === 4 &&
      raw?.priorSentinelEvidence?.sentinelGenerationsThisRun === 0 &&
      raw?.configuration?.overlapWindowSeconds === 0.6 &&
      raw?.configuration?.maxNewTokens === 64 &&
      raw?.configuration?.doSample === false &&
      raw?.configuration?.infraSeed === 25025 &&
      raw?.configuration?.freePromptAdded === false &&
      raw?.configuration?.quantized === false &&
      raw?.configuration?.officialRuntimeContextMapping === true &&
      raw?.checkpoint?.officialCodeCommit === CHECKPOINT.officialCodeCommit &&
      raw?.checkpoint?.externalSnapshotCommit ===
        CHECKPOINT.externalSnapshotCommit &&
      raw?.checkpoint?.baseSnapshotCommit === CHECKPOINT.baseSnapshotCommit &&
      raw?.inputs?.holdoutTransferred === false &&
      Array.isArray(raw?.development) && raw.development.length === 32 &&
      new Set(ids).size === 32 && ids.every((id) =>
        typeof id === "string" && id.length > 0) &&
      raw.development.every((item) =>
        Array.isArray(item?.generations) && item.generations.length > 0) &&
      validModelLoad(raw?.modelLoad) &&
      finite(raw?.budget?.projectedCumulativeTransferBytes) &&
      raw.budget.projectedCumulativeTransferBytes <= 70 * 1024 ** 3 &&
      finite(raw?.budget?.cumulativeGpuSeconds) &&
      raw.budget.cumulativeGpuSeconds <= 7_200 &&
      finite(raw?.budget?.cumulativeEstimatedCostUsd) &&
      raw.budget.cumulativeEstimatedCostUsd <= 12 &&
      typeof raw?.evidenceSha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(raw.evidenceSha256);
  } catch {
    return false;
  }
}

export function analyzeExp0025RExternalDOnlyDevelopment({
  pack,
  sentinelObservations,
  officialRuntimeSentinelAnalysis,
  developmentObservations
}) {
  const packValidation = validateExp0025RMaterializedPack(pack);
  if (!packValidation.valid || pack.split !== "development") {
    throw new TypeError(`pack D inválido: ${packValidation.errors.join("; ")}`);
  }
  if (!validateOfficialSentinelGate(
    officialRuntimeSentinelAnalysis,
    sentinelObservations
  )) {
    throw new TypeError("leitura oficial das sentinelas não fecha o binding");
  }
  const byId = new Map((developmentObservations ?? []).map((item) =>
    [item?.id, item]));
  if (byId.size !== pack.utterances.length) {
    throw new TypeError("E não contém exatamente 32 observações de D");
  }
  const nativeResults = pack.utterances.map((utterance) =>
    addExternalDiagnostics(replayAdaptiveEndpoint(utterance, { gridMs: 20 })));
  const gridResults = pack.utterances.map((utterance) =>
    addExternalDiagnostics(replayAdaptiveEndpoint(utterance, { gridMs: 600 })));
  const externalResults = pack.utterances.map((utterance) =>
    externalObservationToResult(utterance, byId.get(utterance.id)));
  const native = summarize(nativeResults);
  const a0At600 = summarize(gridResults);
  const external = summarize(externalResults);
  const againstNative = compare(nativeResults, externalResults);
  const againstA0At600 = compare(gridResults, externalResults);
  const residualGate = Object.freeze({
    completeDevelopment: external.utteranceCount === 32 && pack.pairs === 16,
    correctedAtLeastOneVsA0At600:
      againstA0At600.correctedPrematureTakeovers >= 1,
    positiveNetVsA0At600:
      againstA0At600.netPrematureTakeoverImprovement > 0,
    zeroIntroducedVsA0At600:
      againstA0At600.introducedPrematureTakeovers === 0,
    sessionsImprovedAtLeastOneVsA0At600:
      againstA0At600.sessionsImproved >= 1,
    zeroSafeSessionRegressionVsA0At600:
      againstA0At600.safeSessionsRegressed === 0,
    noMissRegressionVsA0At600:
      againstA0At600.missedTakeoverDelta <= 0,
    zeroPreFinalTakeover: external.preFinalTakeoverCount === 0,
    p95NotWorseThanA0At600:
      finite(external.postFinalDecisionDelayMs.p95) &&
      external.postFinalDecisionDelayMs.p95 <=
        a0At600.postFinalDecisionDelayMs.p95,
    maximumAtMost1200:
      finite(external.postFinalDecisionDelayMs.maximum) &&
      external.postFinalDecisionDelayMs.maximum <= 1_200,
    zeroProtocolFailure: external.protocolFailureCount === 0
  });
  const freshHoldoutJustified = Object.values(residualGate).every(Boolean);
  const gridById = new Map(gridResults.map((item) => [item.id, item]));
  const gains = externalResults.filter((candidate) =>
    gridById.get(candidate.id)?.prematureTakeover &&
      !candidate.prematureTakeover).map((item) => item.id);
  const losses = externalResults.filter((candidate) => {
    const baseline = gridById.get(candidate.id);
    return (!baseline?.prematureTakeover && candidate.prematureTakeover) ||
      candidate.missedTakeover || candidate.preFinalTakeover ||
      candidate.protocolFailure;
  }).map((item) => item.id);
  return Object.freeze({
    sentinels: officialRuntimeSentinelAnalysis,
    sentinelGateSource: "PINNED_OFFICIAL_RUNTIME_POST_RUN_INTERPRETATION",
    developmentEvaluated: true,
    candidateId: EXP0025_R_EXTERNAL_CANDIDATE_ID,
    native,
    a0At600,
    external,
    againstNative,
    againstA0At600,
    residualGate,
    residualGainObserved:
      againstA0At600.netPrematureTakeoverImprovement > 0,
    gains: Object.freeze(gains),
    losses: Object.freeze(losses),
    utteranceResults: Object.freeze({
      native: Object.freeze(nativeResults),
      a0At600: Object.freeze(gridResults),
      external: Object.freeze(externalResults)
    }),
    decision: freshHoldoutJustified
      ? "JUSTIFY_FRESH_EXTERNAL_HOLDOUT_PREREGISTRATION"
      : "CUT_EXTERNAL_MICROTURN_FRONT",
    freshHoldoutJustified,
    freshHoldoutAuthorized: false,
    oldHoldoutConfirmatoryEligible: false,
    oldHoldoutPermittedUse: "EXPLORATORY_ONLY_NOT_EXECUTED_THIS_ROUND",
    localReproductionAuthorized: false
  });
}

export function joinExp0025RExternalEvidence(priorRaw, dOnlyRaw) {
  if (!validateExp0025RExternalRawEvidence(priorRaw)) {
    throw new TypeError("evidência anterior das sentinelas é inválida");
  }
  if (!validateExp0025RDOnlyRawEvidence(dOnlyRaw)) {
    throw new TypeError("evidência D-only é inválida");
  }
  if (priorRaw.candidateId !== dOnlyRaw.candidateId ||
    priorRaw.checkpoint.officialCodeCommit !==
      dOnlyRaw.checkpoint.officialCodeCommit ||
    priorRaw.checkpoint.externalSnapshotCommit !==
      dOnlyRaw.checkpoint.externalSnapshotCommit ||
    priorRaw.checkpoint.baseSnapshotCommit !==
      dOnlyRaw.checkpoint.baseSnapshotCommit ||
    priorRaw.configuration.overlapWindowSeconds !==
      dOnlyRaw.configuration.overlapWindowSeconds ||
    priorRaw.configuration.maxNewTokens !==
      dOnlyRaw.configuration.maxNewTokens ||
    priorRaw.configuration.doSample !== dOnlyRaw.configuration.doSample) {
    throw new TypeError("D-only não é o mesmo candidato/configuração");
  }
  return Object.freeze({
    candidateId: priorRaw.candidateId,
    sentinelObservations: priorRaw.sentinels,
    developmentObservations: dOnlyRaw.development,
    sameCandidateAndConfiguration: true,
    holdoutRead: false,
    sourceEvidenceSha256: Object.freeze({
      sentinels: priorRaw.evidenceSha256,
      development: dOnlyRaw.evidenceSha256
    })
  });
}

export function dOnlyEvidenceEqual(left, right) {
  return isDeepStrictEqual(left, right);
}
