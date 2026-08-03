import { isDeepStrictEqual } from "node:util";

import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_INSTRUMENTATION_FREEZE_PATH
} from "./exp-0019-boundary.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0019_CANONICAL_REPORT_SCHEMA =
  "exp-0019-causal-audio-canonical-report-v1";
export const EXP0019_CANONICAL_REPORT_PATH =
  "eval/reports/exp-0019-causal-audio-v0.1.json";

export const EXP0019_DECISIONS = Object.freeze({
  pass: "PASS_CAUSAL_AUDIO_BRIDGE_SHADOW",
  cut: "CUT_CAUSAL_AUDIO_BRIDGE",
  invalidate: "INVALIDATE_CAUSAL_AUDIO_INSTRUMENT"
});

const PAYLOAD_KEYS = Object.freeze([
  "assistantAudiblePrefixAtDecision",
  "assistantAudiblePrefixAvailableAtSample",
  "assistantSpeaking",
  "currentSample",
  "recentInbound",
  "recentInboundAvailableAtSample",
  "targetAvailableAtSample",
  "targetText"
].toSorted());
const REPORT_KEYS = Object.freeze([
  "authorityEligible",
  "decision",
  "evidence",
  "experimentId",
  "gates",
  "instrumentValid",
  "limitations",
  "metrics",
  "nextExperiment",
  "notPromoted",
  "paidApiCalls",
  "pass",
  "promoted",
  "reportSha256",
  "schemaVersion",
  "status",
  "validation"
]);
const EXPECTED_SIGNATURE = Object.freeze({
  B0: { correct: 4, observations: 8 },
  B1: {
    correct: 7,
    observations: 8,
    directedCorrect: 4,
    directedObservations: 4,
    backgroundCorrect: 3,
    backgroundObservations: 4
  },
  paired: { pairs: 4, wins: 3, losses: 0, ties: 1 },
  knownMiss: {
    pairRootId:
      "development-correction-version-label-target-development-green-label",
    targetSurfaceId: "target-development-green-label",
    contextSurfaceId: "context-development-version-over-label",
    expected: "BACKGROUND_OR_NOT_DIRECTED",
    predicted: "DIRECTED_TO_ASSISTANT"
  }
});
const REQUIRED_VALIDATIONS = Object.freeze([
  "audioAttemptValid",
  "audioManifestValid",
  "browserCheckpointValid",
  "browserReportValid",
  "evidenceChainBound",
  "instrumentationFreezeValid",
  "nodeReplayValid",
  "planValid",
  "sourceCheckpointValid"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function exactKeys(value, expected) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function withoutHash(report) {
  const core = structuredClone(report ?? {});
  delete core.reportSha256;
  return core;
}

function nearestRankP95(values) {
  if (!Array.isArray(values) || values.length === 0 ||
      values.some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function canonicalRecord(record, canonicalSha256Value = null) {
  const output = {
    path: record?.path ?? null,
    fileSha256: record?.fileSha256 ?? null
  };
  if (canonicalSha256Value !== null) {
    output.canonicalSha256 = canonicalSha256Value;
  }
  return output;
}

function allPayloads(replay) {
  return (replay?.scenes ?? []).flatMap((scene) => [
    ...(scene.probes ?? []).map((probe) => probe.payload),
    scene.ready?.payload
  ]).filter(Boolean);
}

function payloadIsCausal(payload) {
  if (!isDeepStrictEqual(Object.keys(payload ?? {}).sort(), PAYLOAD_KEYS) ||
      payload.assistantSpeaking !== true) {
    return false;
  }
  const inboundPresent = Array.isArray(payload.recentInbound) &&
    payload.recentInbound.length === 1;
  const prefixPresent =
    typeof payload.assistantAudiblePrefixAtDecision === "string";
  const targetPresent = typeof payload.targetText === "string";
  return inboundPresent === (
    payload.currentSample >= payload.recentInboundAvailableAtSample
  ) && prefixPresent === (
    payload.currentSample >=
      payload.assistantAudiblePrefixAvailableAtSample
  ) && targetPresent === (
    payload.currentSample >= payload.targetAvailableAtSample
  );
}

function schedulesRemainPaired(replay) {
  const pairs = new Map((replay?.pairs ?? []).map((pair) => [
    pair.pairRootId,
    pair
  ]));
  return pairs.size === 4 && (replay?.scenes ?? []).every((scene) => {
    const pair = pairs.get(scene.pairRootId);
    return pair && isDeepStrictEqual(scene.schedule, pair.schedule) &&
      scene.scheduleSha256 === pair.scheduleSha256;
  });
}

function exploratoryTiming(replay) {
  const streams = new Map((replay?.audio?.streams ?? []).map((stream) => [
    stream.streamId,
    stream
  ]));
  const onsetToProposalMs = [];
  const backgroundCounterfactualHoldMs = [];
  for (const scene of replay?.scenes ?? []) {
    const target = streams.get(scene.streamBindings?.target);
    const schedule = scene.schedule;
    if (target && schedule) {
      onsetToProposalMs.push(
        (schedule.target.endSample - schedule.target.startSample -
          target.onsetSample) / 16
      );
    }
    if (scene.scorer?.label === "BACKGROUND_OR_NOT_DIRECTED" && schedule) {
      backgroundCounterfactualHoldMs.push(
        (schedule.assistant.endSample - schedule.target.endSample) / 16
      );
    }
  }
  return {
    onsetToProposalMs,
    onsetToProposalP95Ms: nearestRankP95(onsetToProposalMs),
    backgroundCounterfactualHoldMs,
    backgroundCounterfactualHoldP95Ms:
      nearestRankP95(backgroundCounterfactualHoldMs)
  };
}

export function exp0019EvidenceChainBound(records) {
  try {
    const {
      preregistration,
      plan,
      instrumentationFreeze: freeze,
      audioAttempt: attempt,
      audioManifest: manifest,
      nodeReplay: replay,
      browserReport: browser,
      sourceCheckpoint,
      browserCheckpoint
    } = records;
    return plan.value.bindings.preregistration.path === preregistration.path &&
      plan.value.bindings.preregistration.fileSha256 ===
        preregistration.fileSha256 &&
      freeze.value.artifacts.plan.path === plan.path &&
      freeze.value.artifacts.plan.fileSha256 === plan.fileSha256 &&
      freeze.value.artifacts.plan.canonicalSha256 ===
        plan.value.planSha256 &&
      freeze.value.artifacts.preregistration.path ===
        preregistration.path &&
      freeze.value.artifacts.preregistration.fileSha256 ===
        preregistration.fileSha256 &&
      freeze.value.artifacts.sourceCheckpoint.path ===
        sourceCheckpoint.path &&
      freeze.value.artifacts.sourceCheckpoint.fileSha256 ===
        sourceCheckpoint.fileSha256 &&
      freeze.value.artifacts.sourceCheckpoint.canonicalSha256 ===
        sourceCheckpoint.value.checkpointSha256 &&
      freeze.value.artifacts.browserCheckpoint.path ===
        browserCheckpoint.path &&
      freeze.value.artifacts.browserCheckpoint.fileSha256 ===
        browserCheckpoint.fileSha256 &&
      freeze.value.artifacts.browserCheckpoint.canonicalSha256 ===
        browserCheckpoint.value.browserCheckpointSha256 &&
      attempt.path === EXP0019_AUDIO_ATTEMPT_PATH &&
      attempt.value.instrumentationFreeze.path === freeze.path &&
      attempt.value.instrumentationFreeze.fileSha256 === freeze.fileSha256 &&
      attempt.value.plan.path === plan.path &&
      attempt.value.plan.fileSha256 === plan.fileSha256 &&
      manifest.value.audioAttempt.path === attempt.path &&
      manifest.value.audioAttempt.fileSha256 === attempt.fileSha256 &&
      manifest.value.instrumentationFreeze.path === freeze.path &&
      manifest.value.instrumentationFreeze.fileSha256 === freeze.fileSha256 &&
      manifest.value.plan.path === plan.path &&
      manifest.value.plan.fileSha256 === plan.fileSha256 &&
      replay.value.bindings.audioAttempt.path === attempt.path &&
      replay.value.bindings.audioAttempt.fileSha256 === attempt.fileSha256 &&
      replay.value.bindings.manifest.path === manifest.path &&
      replay.value.bindings.manifest.fileSha256 === manifest.fileSha256 &&
      replay.value.bindings.instrumentationFreeze.path === freeze.path &&
      replay.value.bindings.instrumentationFreeze.fileSha256 ===
        freeze.fileSha256 &&
      browser.value.source.nodeReplay.path === replay.path &&
      browser.value.source.nodeReplay.fileSha256 === replay.fileSha256 &&
      browser.value.source.instrumentationFreeze.path === freeze.path &&
      browser.value.source.instrumentationFreeze.fileSha256 ===
        freeze.fileSha256 &&
      browser.value.source.checkpoint.path === browserCheckpoint.path &&
      browser.value.source.checkpoint.fileSha256 ===
        browserCheckpoint.fileSha256;
  } catch {
    return false;
  }
}

function deriveGates(input) {
  const { plan, freeze, manifest, replay, browser, sourceCheckpoint } = input;
  const payloads = allPayloads(replay);
  const allProbes = (replay?.scenes ?? []).flatMap(
    (scene) => scene.probes ?? []
  );
  const allProbeArms = allProbes.flatMap((probe) =>
    Object.values(probe.arms ?? {})
  );
  const allReadyArms = (replay?.scenes ?? []).flatMap((scene) =>
    Object.values(scene.ready?.arms ?? {})
  );
  return {
    completeCausalBundle:
      plan?.summary?.scenes === 8 && plan.summary.pairRoots === 4 &&
      plan.summary.streams === 12 && manifest?.files?.length === 12 &&
      replay?.scenes?.length === 8 && replay?.pairs?.length === 4 &&
      replay?.audio?.streams?.length === 12 &&
      browser?.metrics?.scenesPerRepetition === 8 &&
      browser?.metrics?.readyEvaluations === 16,
    zeroFutureEvidence:
      plan?.runtime?.futureTextAllowed === false &&
      plan?.runtime?.futurePcmAllowed === false && payloads.length === 32 &&
      payloads.every(payloadIsCausal) && allProbes.length === 24 &&
      allProbeArms.length === 48 && allProbeArms.every((arm) =>
        arm.status === "DEFER_CAUSAL_EVIDENCE" &&
        arm.classifierExecuted === false && arm.inferenceCountDelta === 0
      ) && replay?.summary?.preBoundaryInferences === 0 &&
      browser?.gates?.causalProbes === true,
    pairIsolationAndPayload:
      replay?.audio?.targetPairEqualityExact === true &&
      schedulesRemainPaired(replay) && payloads.every((payload) =>
        isDeepStrictEqual(Object.keys(payload).sort(), PAYLOAD_KEYS)
      ) && manifest?.targetReuse?.synthesesPerTarget === 1 &&
      manifest?.targetReuse?.byteIdenticalReuseRequiredWithinPair === true,
    frozenSignature:
      isDeepStrictEqual(plan?.summary?.frozenSignature, EXPECTED_SIGNATURE) &&
      replay?.summary?.frozenTraceParity === "16/16" &&
      allReadyArms.length === 16 &&
      allReadyArms.every((arm) => arm.frozenTraceExact === true) &&
      browser?.gates?.frozenSignature === true,
    nodeChromeParity:
      browser?.gates?.nodeBrowserParity === true &&
      browser?.metrics?.maximumFeatureRelativeError <= 1e-12 &&
      browser?.metrics?.maximumProbabilityRelativeError <= 1e-12,
    cardinalityAndDeterminism:
      replay?.summary?.proposals === 16 &&
      browser?.gates?.oneProposalPerArmPerScene === true &&
      browser?.gates?.exactlyTwoRepetitions === true &&
      browser?.gates?.deterministicNormalizedTrace === true &&
      browser?.repetitions?.length === 2,
    latencyWithinBudget:
      replay?.summary?.nodeComputeWithinBudget === true &&
      replay?.summary?.nodeComputeP95Ms <= 50 &&
      browser?.gates?.proposalP95WithinBudget === true &&
      browser?.gates?.calculationP95WithinBudget === true &&
      browser?.metrics?.proposalLatencyP95Ms <= 300 &&
      browser?.metrics?.calculationP95Ms <= 50,
    lifecycleAndPhysicalStopIsolated:
      browser?.gates?.lifecycleUnchanged === true &&
      browser?.gates?.lifecycleShadowOnOffEquivalent === true &&
      browser?.gates?.rendererStopP95WithinBudget === true &&
      browser?.gates?.physicalStopContextIsolation === true &&
      browser?.gates?.zeroEffects === true &&
      browser?.metrics?.rendererStopP95Ms <= 250 &&
      browser?.metrics?.effectsDispatched === 0,
    frozenCheckpointZeroAuthorityAndCost:
      freeze?.boundary?.audioMaterializationsBeforeFreeze === 0 &&
      freeze?.boundary?.nodeReplaysBeforeFreeze === 0 &&
      freeze?.boundary?.browserCampaignsBeforeFreeze === 0 &&
      freeze?.boundary?.paidApiCalls === 0 &&
      freeze?.authority?.canProduceEffects === false &&
      manifest?.provenance?.testHarnessUsed === false &&
      manifest?.provenance?.networkAllowed === false &&
      manifest?.provenance?.paidApiCalls === 0 &&
      manifest?.provenance?.gpuRuns === 0 &&
      replay?.bindings?.checkpoint?.canonicalSha256 ===
        sourceCheckpoint?.checkpointSha256 &&
      replay?.authority?.canProduceEffects === false &&
      replay?.authority?.effectsDispatched === 0 &&
      browser?.gates?.zeroAuthority === true &&
      browser?.metrics?.paidApiCalls === 0 &&
      browser?.metrics?.gpuRuns === 0
  };
}

export function buildExp0019CanonicalReport(input = {}) {
  const records = input.records ?? {};
  const validation = Object.fromEntries(REQUIRED_VALIDATIONS.map((name) => [
    name,
    input.validations?.[name] === true
  ]));
  const instrumentValid = Object.values(validation).every(Boolean);
  const plan = records.plan?.value;
  const freeze = records.instrumentationFreeze?.value;
  const manifest = records.audioManifest?.value;
  const replay = records.nodeReplay?.value;
  const browser = records.browserReport?.value;
  const sourceCheckpoint = records.sourceCheckpoint?.value;
  const gates = deriveGates({
    plan,
    freeze,
    manifest,
    replay,
    browser,
    sourceCheckpoint
  });
  const allGatesPass = Object.values(gates).every(Boolean);
  const decision = !instrumentValid
    ? EXP0019_DECISIONS.invalidate
    : allGatesPass
      ? EXP0019_DECISIONS.pass
      : EXP0019_DECISIONS.cut;
  const exploratory = exploratoryTiming(replay);
  const core = {
    schemaVersion: EXP0019_CANONICAL_REPORT_SCHEMA,
    experimentId: "EXP-0019",
    status: "complete",
    decision,
    pass: decision === EXP0019_DECISIONS.pass,
    instrumentValid,
    authorityEligible: false,
    validation,
    gates,
    metrics: {
      scenes: replay?.scenes?.length ?? 0,
      pairs: replay?.pairs?.length ?? 0,
      streams: replay?.audio?.streams?.length ?? 0,
      nodeProposals: replay?.summary?.proposals ?? null,
      browserRepetitions: browser?.repetitions?.length ?? 0,
      browserReadyEvaluations: browser?.metrics?.readyEvaluations ?? null,
      causalProbeArmEvaluations:
        replay?.summary?.preBoundaryArmProbes ?? null,
      frozenSignature: structuredClone(
        plan?.summary?.frozenSignature ?? null
      ),
      nodeComputeP95Ms: replay?.summary?.nodeComputeP95Ms ?? null,
      browserProposalLatencyP95Ms:
        browser?.metrics?.proposalLatencyP95Ms ?? null,
      browserCalculationP95Ms:
        browser?.metrics?.calculationP95Ms ?? null,
      rendererStopP95Ms: browser?.metrics?.rendererStopP95Ms ?? null,
      maximumFeatureRelativeError:
        browser?.metrics?.maximumFeatureRelativeError ?? null,
      maximumProbabilityRelativeError:
        browser?.metrics?.maximumProbabilityRelativeError ?? null,
      exploratory,
      effectsDispatched: browser?.metrics?.effectsDispatched ?? null,
      paidApiCalls: 0,
      gpuRuns: 0
    },
    evidence: {
      preregistration: canonicalRecord(records.preregistration),
      plan: canonicalRecord(records.plan, plan?.planSha256 ?? null),
      instrumentationFreeze: canonicalRecord(
        records.instrumentationFreeze,
        freeze?.instrumentationFreezeSha256 ?? null
      ),
      audioAttempt: canonicalRecord(
        records.audioAttempt,
        records.audioAttempt?.value?.attemptSha256 ?? null
      ),
      audioManifest: canonicalRecord(
        records.audioManifest,
        manifest?.manifestSha256 ?? null
      ),
      nodeReplay: canonicalRecord(
        records.nodeReplay,
        replay?.replaySha256 ?? null
      ),
      browserReport: canonicalRecord(
        records.browserReport,
        browser?.browserReportSha256 ?? null
      ),
      sourceCheckpoint: canonicalRecord(
        records.sourceCheckpoint,
        sourceCheckpoint?.checkpointSha256 ?? null
      ),
      browserCheckpoint: canonicalRecord(
        records.browserCheckpoint,
        records.browserCheckpoint?.value?.browserCheckpointSha256 ?? null
      )
    },
    promoted: decision === EXP0019_DECISIONS.pass
      ? "prova de disponibilidade do bridge causal em áudio somente em shadow"
      : "nenhuma capacidade",
    notPromoted: [
      "ASR incremental ou diarização",
      "autoridade sobre STOP, lifecycle, renderer ou efeitos",
      "qualidade perceptiva, naturalidade ou generalização de produto",
      "qualquer modelo externo como dependência arquitetural"
    ],
    nextExperiment: decision === EXP0019_DECISIONS.pass
      ? "Pré-registrar o menor comparativo de ASR incremental local contra " +
        "este teto-oráculo, preservando o mesmo pack e zero autoridade."
      : decision === EXP0019_DECISIONS.cut
        ? "Localizar o primeiro gate causal/runtime falho antes de adicionar ASR."
        : "Corrigir e recongelar a instrumentação; não interpretar qualidade.",
    limitations: [
      "oito cenas sintéticas selecionadas de development, não amostra representativa",
      "texto-oráculo só é liberado no fim de cada clip; reconhecimento de fala não foi testado",
      "Supertonic fornece estímulo reproduzível, não evidência de naturalidade percebida",
      "duas execuções Chrome medem determinismo de integração, não robustez estatística",
      "nenhuma decisão deste experimento pode produzir efeitos"
    ],
    paidApiCalls: 0
  };
  return deepFreeze({
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  });
}

export function validateExp0019CanonicalReport(report, input = null) {
  const errors = [];
  try {
    if (
      !exactKeys(report, REPORT_KEYS) ||
      report?.schemaVersion !== EXP0019_CANONICAL_REPORT_SCHEMA ||
      report?.experimentId !== "EXP-0019" ||
      report?.status !== "complete" ||
      report?.authorityEligible !== false ||
      report?.paidApiCalls !== 0 ||
      report?.reportSha256 !==
        `sha256:${canonicalSha256(withoutHash(report))}`
    ) {
      errors.push("identidade, autoridade ou reportSha256 incompatível");
    }
    if (!exactKeys(report?.validation, REQUIRED_VALIDATIONS)) {
      errors.push("shape das validações incompatível");
    }
    const expectedInstrumentValid = Object.values(
      report?.validation ?? {}
    ).every((value) => value === true);
    const expectedGatesPass = Object.values(report?.gates ?? {})
      .every((value) => value === true);
    const expectedDecision = !expectedInstrumentValid
      ? EXP0019_DECISIONS.invalidate
      : expectedGatesPass
        ? EXP0019_DECISIONS.pass
        : EXP0019_DECISIONS.cut;
    if (
      report?.instrumentValid !== expectedInstrumentValid ||
      report?.decision !== expectedDecision ||
      report?.pass !== (expectedDecision === EXP0019_DECISIONS.pass)
    ) {
      errors.push("decisão não corresponde às validações e gates");
    }
    if (input !== null) {
      const rebuilt = buildExp0019CanonicalReport(input);
      if (!isDeepStrictEqual(report, rebuilt)) {
        errors.push("relatório diverge da evidência recalculada");
      }
    }
  } catch (error) {
    errors.push(`relatório malformado: ${error.message}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}
