import { isDeepStrictEqual } from "node:util";

import {
  EXP0025_R_ACTIONS,
  EXP0025_R_CADENCES,
  evaluateDuplexCascadeSentinels,
  interpretDuplexCascadeOutput,
  replayAdaptiveEndpoint,
  validateExp0025RMaterializedPack
} from "./exp-0025-r-floor-control.mjs";

export const EXP0025_R_EXTERNAL_CANDIDATE_ID =
  "E-official-duplexcascade-v0.1";
export const EXP0025_R_EXTERNAL_RAW_SCHEMA =
  "exp-0025-r-external-raw-evidence-v1";
export const EXP0025_R_EXTERNAL_REPORT_SCHEMA =
  "exp-0025-r-external-development-report-v1";

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
  return {
    utteranceCount: results.length,
    prematureTakeoverCount: continues.filter((item) =>
      item.prematureTakeover).length,
    preFinalTakeoverCount: ends.filter((item) =>
      item.preFinalTakeover).length,
    missedTakeoverCount: ends.filter((item) => item.missedTakeover).length,
    protocolFailureCount: results.filter((item) =>
      item.protocolFailure).length,
    postFinalDecisionDelayMs: {
      count: delays.length,
      minimum: delays.length > 0 ? Math.min(...delays) : null,
      median: median(delays),
      p95: nearestRankP95(delays),
      maximum: delays.length > 0 ? Math.max(...delays) : null
    },
    sessionsWithPrematureTakeover: [...sessionIds].filter((sessionId) =>
      continues.some((item) => item.sessionId === sessionId &&
        item.prematureTakeover)).length
  };
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
  return {
    correctedPrematureTakeovers: corrected.length,
    correctedUtteranceIds: corrected.map(({ a0 }) => a0.id),
    introducedPrematureTakeovers: introduced.length,
    introducedUtteranceIds: introduced.map(({ a0 }) => a0.id),
    netPrematureTakeoverImprovement: corrected.length - introduced.length,
    sessionsImproved: improvedSessions.length,
    improvedSessionIds: improvedSessions,
    safeSessionsRegressed: regressedSessions.length,
    regressedSessionIds: regressedSessions,
    missedTakeoverDelta: ends.filter(({ candidate }) =>
      candidate?.missedTakeover).length - ends.filter(({ a0 }) =>
      a0.missedTakeover).length
  };
}

function observationOutput(observation) {
  if (typeof observation?.output === "string") return observation.output;
  const generations = observation?.generations;
  return Array.isArray(generations) && generations.length > 0
    ? generations.at(-1)?.decodedRaw ?? null
    : null;
}

export function evaluateExp0025RExternalSentinels(observations) {
  return evaluateDuplexCascadeSentinels((observations ?? []).map((item) => ({
    id: item?.id,
    output: observationOutput(item)
  })));
}

export function externalObservationToResult(utterance, observation) {
  if (observation?.id !== utterance.id ||
    !Array.isArray(observation?.generations)) {
    throw new TypeError(`observação E ausente ou inválida para ${utterance.id}`);
  }
  const trajectory = [];
  let firstTakeFloorAtMs = null;
  let protocolFailure = false;
  let previousAtMs = -Infinity;

  for (const generation of observation.generations) {
    if (!finite(generation?.atMs) || generation.atMs <= previousAtMs ||
      typeof generation?.decodedRaw !== "string") {
      throw new TypeError(`trajetória E inválida para ${utterance.id}`);
    }
    previousAtMs = generation.atMs;
    const interpreted = interpretDuplexCascadeOutput({
      assistantSpeaking: generation.assistantSpeaking === true,
      output: generation.decodedRaw
    });
    trajectory.push({
      atMs: generation.atMs,
      deltaText: generation.deltaText ?? null,
      assistantSpeaking: generation.assistantSpeaking === true,
      output: generation.decodedRaw,
      action: interpreted.action,
      reason: interpreted.reason,
      generationLatencyMs: finite(generation.generationLatencyMs)
        ? generation.generationLatencyMs
        : null
    });
    if (interpreted.action === EXP0025_R_ACTIONS.protocolFailure) {
      protocolFailure = true;
      break;
    }
    if (interpreted.action === EXP0025_R_ACTIONS.takeFloor) {
      firstTakeFloorAtMs = generation.atMs;
      break;
    }
  }

  const prematureTakeover = utterance.outcome === "CONTINUES" &&
    firstTakeFloorAtMs !== null && firstTakeFloorAtMs < utterance.resumeAtMs;
  const preFinalTakeover = utterance.outcome === "ENDS" &&
    firstTakeFloorAtMs !== null && firstTakeFloorAtMs < utterance.trueFinalAtMs;
  const postFinalDecisionDelayMs = utterance.outcome === "ENDS" &&
    firstTakeFloorAtMs !== null && !preFinalTakeover
    ? firstTakeFloorAtMs - utterance.trueFinalAtMs
    : null;
  const missedTakeover = utterance.outcome === "ENDS" &&
    (postFinalDecisionDelayMs === null ||
      postFinalDecisionDelayMs > EXP0025_R_CADENCES.finalObservationMs);

  return Object.freeze({
    id: utterance.id,
    pairId: utterance.pairId,
    sessionId: utterance.sessionId,
    family: utterance.family,
    outcome: utterance.outcome,
    gridMs: EXP0025_R_CADENCES.externalMs,
    firstTakeFloorAtMs,
    prematureTakeover,
    preFinalTakeover,
    postFinalDecisionDelayMs,
    missedTakeover,
    protocolFailure,
    trajectory
  });
}

function addExternalDiagnostics(baselineResult) {
  return {
    ...baselineResult,
    family: null,
    preFinalTakeover: false
  };
}

export function analyzeExp0025RExternalDevelopment({
  pack,
  sentinelObservations,
  developmentObservations
}) {
  const validation = validateExp0025RMaterializedPack(pack);
  if (!validation.valid || pack.split !== "development") {
    throw new TypeError(`pack D inválido: ${validation.errors.join("; ")}`);
  }
  const sentinels = evaluateExp0025RExternalSentinels(sentinelObservations);
  if (sentinels.status !== "PASS") {
    return Object.freeze({
      sentinels,
      developmentEvaluated: false,
      decision: "CUT_E_PROTOCOL_FAILURE",
      freshHoldoutAuthorized: false,
      localReproductionAuthorized: false
    });
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
  const latencyNotWorseThanA0At600 = finite(
    external.postFinalDecisionDelayMs.p95
  ) && external.postFinalDecisionDelayMs.p95 <=
    a0At600.postFinalDecisionDelayMs.p95;
  const residualGate = {
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
    p95NotWorseThanA0At600: latencyNotWorseThanA0At600,
    maximumAtMost1200:
      finite(external.postFinalDecisionDelayMs.maximum) &&
      external.postFinalDecisionDelayMs.maximum <= 1_200,
    zeroProtocolFailure: external.protocolFailureCount === 0
  };
  const freshHoldoutJustified = Object.values(residualGate).every(Boolean);
  const gains = externalResults.filter((candidate) => {
    const a0 = gridResults.find((item) => item.id === candidate.id);
    return a0?.prematureTakeover && !candidate.prematureTakeover;
  }).map((item) => item.id);
  const losses = externalResults.filter((candidate) => {
    const a0 = gridResults.find((item) => item.id === candidate.id);
    return (!a0?.prematureTakeover && candidate.prematureTakeover) ||
      candidate.missedTakeover || candidate.preFinalTakeover ||
      candidate.protocolFailure;
  }).map((item) => item.id);

  return Object.freeze({
    sentinels,
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
    gains,
    losses,
    utteranceResults: {
      native: nativeResults,
      a0At600: gridResults,
      external: externalResults
    },
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

export function validateExp0025RExternalRawEvidence(raw) {
  try {
    return raw?.schemaVersion === EXP0025_R_EXTERNAL_RAW_SCHEMA &&
      raw?.experimentId === "EXP-0025-R" &&
      raw?.candidateId === EXP0025_R_EXTERNAL_CANDIDATE_ID &&
      ["COMPLETED", "SENTINEL_FAILED"].includes(raw?.status) &&
      Array.isArray(raw?.sentinels) && raw.sentinels.length === 4 &&
      Array.isArray(raw?.development) &&
      (raw.status === "SENTINEL_FAILED" || raw.development.length === 32) &&
      raw?.authorization?.holdoutInferenceAuthorized === false &&
      raw?.authorization?.localReproductionAuthorized === false &&
      raw?.configuration?.overlapWindowSeconds === 0.6 &&
      raw?.configuration?.maxNewTokens === 64 &&
      raw?.configuration?.doSample === false &&
      raw?.checkpoint?.officialCodeCommit ===
        "42893024ca90c8de8ac3ed624467ebc123512ff8" &&
      raw?.checkpoint?.externalSnapshotCommit ===
        "dca21cb1309bb533d80f5aa5600c7b0cc2c470e3" &&
      raw?.checkpoint?.baseSnapshotCommit ===
        "f2826a00ceef68f0f2b946d945ecc0477ce4450c";
  } catch {
    return false;
  }
}

export function externalAnalysesEqual(left, right) {
  return isDeepStrictEqual(left, right);
}
