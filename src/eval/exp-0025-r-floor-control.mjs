import { isDeepStrictEqual } from "node:util";

import { decideEndpoint } from "../interaction/adaptive-endpoint.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0025_R_PACK_SCHEMA = "exp-0025-r-floor-pack-v1";
export const EXP0025_R_BASELINE_REPORT_SCHEMA =
  "exp-0025-r-baseline-headroom-report-v1";

export const EXP0025_R_ACTIONS = Object.freeze({
  continueListening: "CONTINUE_LISTENING",
  takeFloor: "TAKE_FLOOR",
  keepAssistantFloor: "KEEP_ASSISTANT_FLOOR",
  yieldFloor: "YIELD_FLOOR",
  protocolFailure: "PROTOCOL_FAILURE"
});

export const EXP0025_R_TOKENS = Object.freeze({
  noVoice: "<|no voice|>",
  userTalking: "<|user is talking|>",
  userFinish: "<|user finish talking|>",
  userThinking: "<|user is thinking|>",
  userInterruption: "<|user interruption|>",
  userBackchannel: "<|user backchannel|>"
});

export const EXP0025_R_CADENCES = Object.freeze({
  nativeMs: 20,
  externalMs: 600,
  finalObservationMs: 1_200
});

export const EXP0025_R_BASELINE_BINDING = Object.freeze({
  manifestPath: "eval/baselines/runtime-baseline-v0.3.json",
  manifestSha256:
    "3ae781436ab7ea68ae3e87d307dc4afd85feebb79ffd19620986efe5f828146f",
  endpointPath: "src/interaction/adaptive-endpoint.mjs",
  endpointSha256:
    "e6df7e152c9ef3e621050b2825d64f5ba44221dddff4cd03d9c1c60208bbc2a3"
});

export const EXP0025_R_SENTINELS = Object.freeze([
  Object.freeze({
    id: "english-user-talking",
    assistantSpeaking: false,
    expectedAction: EXP0025_R_ACTIONS.continueListening
  }),
  Object.freeze({
    id: "english-user-finished",
    assistantSpeaking: false,
    expectedAction: EXP0025_R_ACTIONS.takeFloor
  }),
  Object.freeze({
    id: "english-user-backchannel",
    assistantSpeaking: true,
    expectedAction: EXP0025_R_ACTIONS.keepAssistantFloor
  }),
  Object.freeze({
    id: "english-user-interruption",
    assistantSpeaking: true,
    expectedAction: EXP0025_R_ACTIONS.yieldFloor
  })
]);

const SPECIAL_TOKEN_PATTERN = /^<\|[^|]+\|>/u;
const SPLITS = new Set(["development", "holdout"]);
const OUTCOMES = new Set(["CONTINUES", "ENDS"]);
const FAMILIES = new Set([
  "hesitation-filler",
  "syntactic-continuation",
  "correction-restart",
  "lexically-ambiguous-close"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function plainObject(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  return plainObject(value) && isDeepStrictEqual(
    Object.keys(value).toSorted(),
    [...expected].toSorted()
  );
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function firstActionable(rawOutput) {
  const output = String(rawOutput ?? "").trim();
  if (!output) return { token: null, text: null };
  const special = SPECIAL_TOKEN_PATTERN.exec(output)?.[0] ?? null;
  if (special !== null) return { token: special, text: null };
  return { token: null, text: output };
}

export function interpretDuplexCascadeOutput(input = {}) {
  const assistantSpeaking = input.assistantSpeaking === true;
  const { token, text } = firstActionable(input.output);
  let action = EXP0025_R_ACTIONS.protocolFailure;
  let reason = "NO_ACTIONABLE_OUTPUT";

  if (token === EXP0025_R_TOKENS.userTalking ||
    token === EXP0025_R_TOKENS.userThinking) {
    action = EXP0025_R_ACTIONS.continueListening;
    reason = token === EXP0025_R_TOKENS.userTalking
      ? "USER_STILL_TALKING"
      : "USER_THINKING";
  } else if (token === EXP0025_R_TOKENS.userFinish) {
    action = EXP0025_R_ACTIONS.takeFloor;
    reason = "USER_FINISHED";
  } else if (token === EXP0025_R_TOKENS.userBackchannel) {
    if (assistantSpeaking) {
      action = EXP0025_R_ACTIONS.keepAssistantFloor;
      reason = "IGNORE_USER_BACKCHANNEL_AND_CONTINUE";
    } else {
      reason = "USER_BACKCHANNEL_OUTSIDE_ASSISTANT_SPEECH";
    }
  } else if (token === EXP0025_R_TOKENS.userInterruption) {
    if (assistantSpeaking) {
      action = EXP0025_R_ACTIONS.yieldFloor;
      reason = "USER_INTERRUPTED_ASSISTANT";
    } else {
      reason = "USER_INTERRUPTION_OUTSIDE_ASSISTANT_SPEECH";
    }
  } else if (token !== null) {
    reason = token === EXP0025_R_TOKENS.noVoice
      ? "USER_INPUT_TOKEN_EMITTED_BY_ASSISTANT"
      : "UNKNOWN_SPECIAL_TOKEN";
  } else if (nonEmptyText(text)) {
    action = assistantSpeaking
      ? EXP0025_R_ACTIONS.keepAssistantFloor
      : EXP0025_R_ACTIONS.takeFloor;
    reason = assistantSpeaking
      ? "ASSISTANT_TEXT_CONTINUES_CURRENT_UTTERANCE"
      : "ASSISTANT_TEXT_STARTS_RESPONSE";
  }

  return deepFreeze({
    status: action === EXP0025_R_ACTIONS.protocolFailure
      ? "PROTOCOL_FAILURE"
      : "ACTION",
    action,
    reason,
    token,
    text
  });
}

export function evaluateDuplexCascadeSentinels(observations) {
  const byId = new Map((observations ?? []).map((item) => [item?.id, item]));
  const results = EXP0025_R_SENTINELS.map((sentinel) => {
    const observation = byId.get(sentinel.id);
    const interpreted = interpretDuplexCascadeOutput({
      assistantSpeaking: sentinel.assistantSpeaking,
      output: observation?.output
    });
    return {
      ...sentinel,
      output: observation?.output ?? null,
      observedAction: interpreted.action,
      reason: interpreted.reason,
      pass: interpreted.action === sentinel.expectedAction
    };
  });
  const complete = byId.size === EXP0025_R_SENTINELS.length &&
    EXP0025_R_SENTINELS.every((sentinel) => byId.has(sentinel.id));
  const pass = complete && results.every((result) => result.pass);
  return deepFreeze({
    status: pass ? "PASS" : "E_PROTOCOL_FAILURE",
    complete,
    passed: results.filter((result) => result.pass).length,
    expected: EXP0025_R_SENTINELS.length,
    results
  });
}

function validateUtterance(utterance, split) {
  if (!exactKeys(utterance, [
    "assistantSpeaking",
    "audioProvenance",
    "criticalBoundaryAtMs",
    "family",
    "id",
    "microturns",
    "outcome",
    "pairId",
    "pauseMs",
    "prefix",
    "resumeAtMs",
    "sessionId",
    "speechMs",
    "split",
    "suffix",
    "trueFinalAtMs"
  ])) return false;
  if (!nonEmptyText(utterance.id) || !nonEmptyText(utterance.pairId) ||
    !nonEmptyText(utterance.sessionId) || utterance.split !== split ||
    !SPLITS.has(utterance.split) || !OUTCOMES.has(utterance.outcome) ||
    !FAMILIES.has(utterance.family) || !nonEmptyText(utterance.prefix) ||
    utterance.assistantSpeaking !== false ||
    !positiveInteger(utterance.criticalBoundaryAtMs) ||
    !positiveInteger(utterance.speechMs) ||
    !positiveInteger(utterance.pauseMs) ||
    !Array.isArray(utterance.microturns) || utterance.microturns.length !== 4 ||
    !plainObject(utterance.audioProvenance)) return false;
  if (utterance.outcome === "CONTINUES") {
    return nonEmptyText(utterance.suffix) &&
      utterance.resumeAtMs === utterance.criticalBoundaryAtMs +
        utterance.pauseMs && utterance.trueFinalAtMs === null;
  }
  return utterance.suffix === null && utterance.resumeAtMs === null &&
    utterance.trueFinalAtMs === utterance.criticalBoundaryAtMs;
}

export function validateExp0025RFloorPack(pack) {
  const errors = [];
  try {
    if (!exactKeys(pack, [
      "createdAt",
      "experimentId",
      "families",
      "gridMs",
      "locale",
      "packSha256",
      "pairs",
      "schemaVersion",
      "sessions",
      "split",
      "utterances"
    ])) errors.push("pack possui chaves divergentes");
    if (pack?.schemaVersion !== EXP0025_R_PACK_SCHEMA ||
      pack?.experimentId !== "EXP-0025-R" || pack?.locale !== "pt-BR" ||
      !SPLITS.has(pack?.split) || pack?.gridMs !== 600 ||
      !nonEmptyText(pack?.createdAt)) errors.push("identidade do pack inválida");
    const expectedPairs = pack?.split === "development" ? 16 : 24;
    const expectedUtterances = expectedPairs * 2;
    if (!Array.isArray(pack?.utterances) ||
      pack.utterances.length !== expectedUtterances ||
      !pack.utterances.every((item) => validateUtterance(item, pack.split))) {
      errors.push("falas do pack inválidas");
    }
    const pairIds = new Set(pack?.utterances?.map((item) => item.pairId));
    const sessionIds = new Set(pack?.utterances?.map((item) => item.sessionId));
    if (pairIds.size !== expectedPairs || sessionIds.size !== 8 ||
      pack?.pairs !== expectedPairs || pack?.sessions !== 8) {
      errors.push("cardinalidade de pares/sessões inválida");
    }
    for (const pairId of pairIds) {
      const pair = pack.utterances.filter((item) => item.pairId === pairId);
      const [left, right] = pair;
      if (pair.length !== 2 ||
        new Set(pair.map((item) => item.outcome)).size !== 2 ||
        left.prefix !== right.prefix || left.pauseMs !== right.pauseMs ||
        left.criticalBoundaryAtMs !== right.criticalBoundaryAtMs ||
        !isDeepStrictEqual(left.microturns, right.microturns)) {
        errors.push(`par ${pairId} perdeu o prefixo pareado`);
      }
    }
    const familyCounts = Object.fromEntries([...FAMILIES].map((family) => [
      family,
      new Set(pack?.utterances?.filter((item) => item.family === family)
        .map((item) => item.pairId)).size
    ]));
    const expectedPerFamily = expectedPairs / FAMILIES.size;
    if (!isDeepStrictEqual(pack?.families, familyCounts) ||
      Object.values(familyCounts).some((count) => count !== expectedPerFamily)) {
      errors.push("famílias não estão balanceadas");
    }
    const core = structuredClone(pack ?? {});
    delete core.packSha256;
    if (pack?.packSha256 !== `sha256:${canonicalSha256(core)}`) {
      errors.push("packSha256 divergente");
    }
  } catch (error) {
    errors.push(`pack malformado: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function validateExp0025RMaterializedPack(pack) {
  const errors = [...validateExp0025RFloorPack(pack).errors];
  const materialized = pack?.utterances?.every((utterance) => {
    const provenance = utterance.audioProvenance;
    return plainObject(provenance) &&
      provenance.status === "MATERIALIZED" &&
      provenance.role === "PROVENANCE_ONLY_NOT_POLICY_INPUT" &&
      provenance.pairId === utterance.pairId &&
      provenance.outcome === utterance.outcome &&
      nonEmptyText(provenance.wavPath) &&
      /^sha256:[a-f0-9]{64}$/u.test(provenance.wavSha256 ?? "") &&
      /^sha256:[a-f0-9]{64}$/u.test(provenance.prefixPcmSha256 ?? "") &&
      positiveInteger(provenance.byteLength) &&
      finite(provenance.durationMs) && provenance.durationMs > 0 &&
      provenance.criticalBoundaryAtMs === utterance.criticalBoundaryAtMs &&
      plainObject(provenance.engine) &&
      provenance.engine.id === "windows-system-speech" &&
      nonEmptyText(provenance.engine.voice) &&
      provenance.engine.culture === "pt-BR" &&
      provenance.engine.rate === 1 &&
      plainObject(provenance.wordAlignment) &&
      provenance.wordAlignment.method ===
        "ORACLE_SEGMENT_SCHEDULE_NOT_ACOUSTIC_FORCED_ALIGNMENT" &&
      Array.isArray(provenance.wordAlignment.entries) &&
      provenance.wordAlignment.entries.length > 0;
  }) === true;
  if (!materialized) errors.push("proveniência WAV não foi materializada");

  for (const pairId of new Set(pack?.utterances?.map((item) => item.pairId))) {
    const pair = pack.utterances.filter((item) => item.pairId === pairId);
    if (pair.length === 2 &&
      pair[0].audioProvenance?.prefixPcmSha256 !==
        pair[1].audioProvenance?.prefixPcmSha256) {
      errors.push(`par ${pairId} não compartilha PCM de prefixo idêntico`);
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

function nextGridAtOrAfter(atMs, gridMs) {
  return Math.ceil(atMs / gridMs) * gridMs;
}

export function replayAdaptiveEndpoint(utterance, options = {}) {
  const gridMs = options.gridMs ?? EXP0025_R_CADENCES.nativeMs;
  if (!positiveInteger(gridMs) || !validateUtterance(
    utterance,
    utterance?.split
  )) throw new TypeError("fala ou grid inválido para replay A0");
  const boundaryAtMs = utterance.criticalBoundaryAtMs;
  const lastObservedAtMs = utterance.outcome === "CONTINUES"
    ? utterance.resumeAtMs
    : boundaryAtMs + EXP0025_R_CADENCES.finalObservationMs;
  const trajectory = [];
  let firstTakeFloorAtMs = null;

  for (let atMs = nextGridAtOrAfter(boundaryAtMs, gridMs);
    atMs <= lastObservedAtMs;
    atMs += gridMs) {
    if (utterance.outcome === "CONTINUES" && atMs >= utterance.resumeAtMs) {
      break;
    }
    const decision = decideEndpoint({
      silenceMs: atMs - boundaryAtMs,
      speechMs: utterance.speechMs,
      transcript: utterance.prefix
    });
    const action = decision.action === "commit"
      ? EXP0025_R_ACTIONS.takeFloor
      : EXP0025_R_ACTIONS.continueListening;
    trajectory.push({
      atMs,
      action,
      reason: decision.reason,
      requiredSilenceMs: decision.requiredSilenceMs,
      observedSilenceMs: decision.observedSilenceMs
    });
    if (action === EXP0025_R_ACTIONS.takeFloor) {
      firstTakeFloorAtMs = atMs;
      break;
    }
  }

  const prematureTakeover = utterance.outcome === "CONTINUES" &&
    firstTakeFloorAtMs !== null && firstTakeFloorAtMs < utterance.resumeAtMs;
  const postFinalDecisionDelayMs = utterance.outcome === "ENDS" &&
    firstTakeFloorAtMs !== null
    ? firstTakeFloorAtMs - utterance.trueFinalAtMs
    : null;
  const missedTakeover = utterance.outcome === "ENDS" &&
    (postFinalDecisionDelayMs === null ||
      postFinalDecisionDelayMs > EXP0025_R_CADENCES.finalObservationMs);

  return deepFreeze({
    id: utterance.id,
    pairId: utterance.pairId,
    sessionId: utterance.sessionId,
    outcome: utterance.outcome,
    gridMs,
    firstTakeFloorAtMs,
    prematureTakeover,
    postFinalDecisionDelayMs,
    missedTakeover,
    protocolFailure: false,
    trajectory
  });
}

function nearestRankP95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
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
    missedTakeoverCount: ends.filter((item) => item.missedTakeover).length,
    protocolFailureCount: results.filter((item) =>
      item.protocolFailure).length,
    postFinalDecisionDelayMs: {
      count: delays.length,
      minimum: delays.length > 0 ? Math.min(...delays) : null,
      median: delays.length > 0
        ? [...delays].sort((a, b) => a - b)[Math.floor(delays.length / 2)]
        : null,
      p95: nearestRankP95(delays),
      maximum: delays.length > 0 ? Math.max(...delays) : null
    },
    sessionsWithPrematureTakeover: [...sessionIds].filter((sessionId) =>
      continues.some((item) =>
        item.sessionId === sessionId && item.prematureTakeover)).length
  };
}

export function analyzeExp0025RBaselineHeadroom(pack) {
  const validation = validateExp0025RFloorPack(pack);
  if (!validation.valid || pack.split !== "development") {
    throw new TypeError(
      `pack development inválido: ${validation.errors.join("; ")}`
    );
  }
  const native = pack.utterances.map((utterance) =>
    replayAdaptiveEndpoint(utterance, {
      gridMs: EXP0025_R_CADENCES.nativeMs
    }));
  const grid600 = pack.utterances.map((utterance) =>
    replayAdaptiveEndpoint(utterance, {
      gridMs: EXP0025_R_CADENCES.externalMs
    }));
  const nativeSummary = summarize(native);
  const gridSummary = summarize(grid600);
  const gatePass = nativeSummary.prematureTakeoverCount >= 4 &&
    nativeSummary.protocolFailureCount === 0;
  return deepFreeze({
    schemaVersion: EXP0025_R_BASELINE_REPORT_SCHEMA,
    experimentId: "EXP-0025-R",
    stage: "BASELINE_HEADROOM_DEVELOPMENT",
    pack: {
      path: null,
      sha256: pack.packSha256,
      pairs: pack.pairs,
      utterances: pack.utterances.length,
      sessions: pack.sessions
    },
    baseline: structuredClone(EXP0025_R_BASELINE_BINDING),
    native: { gridMs: EXP0025_R_CADENCES.nativeMs, summary: nativeSummary },
    a0At600: {
      role: "CADENCE_DIAGNOSTIC_NOT_CHALLENGER",
      gridMs: EXP0025_R_CADENCES.externalMs,
      summary: gridSummary
    },
    cadencePenalty: {
      prematureTakeoverCount:
        gridSummary.prematureTakeoverCount -
          nativeSummary.prematureTakeoverCount,
      missedTakeoverCount:
        gridSummary.missedTakeoverCount - nativeSummary.missedTakeoverCount,
      postFinalP95Ms:
        gridSummary.postFinalDecisionDelayMs.p95 -
          nativeSummary.postFinalDecisionDelayMs.p95
    },
    gate: {
      requiredPrematureTakeovers: 4,
      observedPrematureTakeovers: nativeSummary.prematureTakeoverCount,
      protocolFailureCount: nativeSummary.protocolFailureCount,
      pass: gatePass,
      decision: gatePass
        ? "BASELINE_HEADROOM_CONFIRMED"
        : "CUT_NO_BASELINE_HEADROOM"
    },
    externalExecutionAuthorized: false,
    holdoutOpened: false,
    authorityEligible: false
  });
}

export function createExp0025RFloorPack(core) {
  const withoutHash = {
    ...structuredClone(core),
    schemaVersion: EXP0025_R_PACK_SCHEMA,
    experimentId: "EXP-0025-R",
    locale: "pt-BR",
    gridMs: EXP0025_R_CADENCES.externalMs
  };
  const pack = deepFreeze({
    ...withoutHash,
    packSha256: `sha256:${canonicalSha256(withoutHash)}`
  });
  const validation = validateExp0025RFloorPack(pack);
  if (!validation.valid) {
    throw new TypeError(`pack EXP-0025-R inválido: ${validation.errors.join("; ")}`);
  }
  return pack;
}
