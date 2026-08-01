import { isDeepStrictEqual } from "node:util";

import {
  REQUIRED_BROWSER_GATES
} from "./exp-0012-analysis.mjs";
import { validateEvent } from "../../src/contracts/events.mjs";
import {
  reduceOutputInterruption
} from "../../web/output-interruption-lifecycle.mjs";
import {
  INTERRUPTION_TRACE_SLICE_VERSION,
  TRAINING_TRACE_VERSION,
  TrainingTraceRecorder,
  projectTrainingTraceToEvaluationTrace,
  validateTrainingTraceBundle
} from "../../web/training-trace-recorder.mjs";

export const TRAINING_TRACE_CASES = Object.freeze([
  Object.freeze({
    label: "pending-audio",
    path: Object.freeze(["preparingBargeIn", "released"])
  }),
  Object.freeze({
    label: "deterministic-backchannel",
    path: Object.freeze(["potentialBargeInRecovery"])
  }),
  Object.freeze({
    label: "reopened-backchannel",
    path: Object.freeze(["reopenedBackchannel"])
  }),
  Object.freeze({
    label: "pcm-backchannel",
    path: Object.freeze(["realBackchannel"])
  }),
  Object.freeze({
    label: "pcm-barge-in",
    path: Object.freeze(["bargeIn"])
  }),
  Object.freeze({
    label: "long-correction",
    path: Object.freeze(["longCorrection", "completed"])
  })
]);

export const REQUIRED_TRAINING_EFFECTS = Object.freeze([
  "PAUSE_OUTPUT",
  "HOLD_OUTPUT",
  "KEEP_OUTPUT_HELD",
  "RESUME_OUTPUT",
  "SETTLE_WITHOUT_RESUME",
  "SETTLE_RESUMED",
  "CONFIRM_INTERRUPTION",
  "SETTLE_CLEARED"
]);

export const REQUIRED_TRAINING_STAGES = Object.freeze([
  "accepted",
  "dispatched",
  "player-received",
  "audible",
  "renderer-silent",
  "cancelled",
  "completed"
]);

const PHYSICAL_BOUNDARY_GATES = Object.freeze([
  "physicalMicrophoneCapture",
  "sileroControlIntegrity",
  "noSelfInterruptionUnderDeviceAec",
  "longSessionNoFalseActivation",
  "sileroShadowIntegrity",
  "sileroShadowAssistantOnlySpecificity",
  "sileroShadowFixtureSensitivity"
]);
const TERMINAL_EFFECT_STAGES = new Set([
  "rejected",
  "cancelled",
  "completed"
]);

function atPath(value, path) {
  return path.reduce((current, field) => current?.[field], value);
}

function normalizedIntent(intent) {
  const payload = { ...intent };
  delete payload.type;
  delete payload.origin;
  return {
    intent: intent.type,
    origin: intent.origin,
    payload
  };
}

export function replayTrainingTrace(bundle) {
  const steps = [];
  const errors = [];
  for (const decision of bundle?.decisions ?? []) {
    const context = bundle.contexts.find(
      (candidate) => candidate.contextId === decision.decisionContextRef
    );
    const event = bundle.events.find(
      (candidate) => candidate.eventId === decision.triggeredBy?.[0]
    );
    const lifecycleEvent = event?.payload?.lifecycleEvent;
    let observed = null;
    const stepErrors = [];
    try {
      observed = reduceOutputInterruption(
        context?.state?.lifecycle,
        lifecycleEvent
      );
    } catch (error) {
      stepErrors.push(error.message);
    }
    if (observed) {
      const expectedTransition = {
        previousStateVersion: observed.previousStateVersion,
        stateVersion: observed.state.version,
        previousPhase: context.state.lifecycle.phase,
        phase: observed.state.phase,
        reason: observed.reason
      };
      const expectedOutputs = observed.intents.map(normalizedIntent);
      const expectedAuthority = observed.intents.length > 0
        ? "ACCEPT"
        : "REJECT";
      if (!isDeepStrictEqual(decision.transition, expectedTransition)) {
        stepErrors.push("transição gravada diverge do reducer");
      }
      if (!isDeepStrictEqual(decision.outputs, expectedOutputs)) {
        stepErrors.push("intenções gravadas divergem do reducer");
      }
      if (decision.proposal !== (observed.intents[0]?.type ?? null)) {
        stepErrors.push("proposta gravada diverge do reducer");
      }
      if (decision.authorityDecision !== expectedAuthority) {
        stepErrors.push("autoridade gravada diverge do reducer");
      }
      if (
        event.atMs !== context.availableAt.atMs ||
        context.availableAt.atMs !== decision.atMs
      ) {
        stepErrors.push("snapshot causal não coincide com a decisão");
      }
    }
    const step = {
      decisionId: decision.decisionId,
      eventId: event?.eventId ?? null,
      eventType: lifecycleEvent?.type ?? null,
      exact: stepErrors.length === 0,
      errors: stepErrors
    };
    steps.push(step);
    errors.push(...stepErrors.map((message) =>
      `${decision.decisionId}: ${message}`
    ));
  }
  return {
    exact: steps.length > 0 && errors.length === 0,
    steps,
    errors
  };
}

function assessEffect(effect) {
  const stages = effect.stages?.map((stage) => stage.stage) ?? [];
  const terminal = stages.at(-1);
  const errors = [];
  if (!TERMINAL_EFFECT_STAGES.has(terminal)) {
    errors.push("efeito não terminou");
  }
  if (terminal === "completed" && !stages.includes("dispatched")) {
    errors.push("efeito concluído sem despacho");
  }
  if (
    effect.effectType === "PAUSE_OUTPUT" &&
    terminal === "completed" &&
    (
      !stages.includes("player-received") ||
      !stages.includes("renderer-silent")
    )
  ) {
    errors.push("PAUSE_OUTPUT concluído sem silêncio do renderer");
  }
  if (
    effect.effectType === "RESUME_OUTPUT" &&
    terminal === "completed" &&
    (
      !stages.includes("player-received") ||
      !stages.includes("audible")
    )
  ) {
    errors.push("RESUME_OUTPUT concluído sem retomada audível");
  }
  if (
    effect.effectType === "CONFIRM_INTERRUPTION" &&
    terminal === "completed" &&
    !stages.includes("player-received")
  ) {
    errors.push("confirmação concluída sem player contido");
  }
  if (
    terminal === "cancelled" &&
    effect.reconciledByDecisionId === null
  ) {
    errors.push("cancelamento sem decisão reconciliadora");
  }
  return { effectId: effect.effectId, stages, terminal, errors };
}

function collectTrainingTraceErrors(value, path = "candidate", output = []) {
  if (!value || typeof value !== "object") {
    return output;
  }
  if (Array.isArray(value.trace)) {
    for (const event of value.trace) {
      if (
        event?.type?.startsWith("training-trace.") &&
        event.type.endsWith(".error")
      ) {
        output.push({ path, event });
      }
    }
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectTrainingTraceErrors(item, `${path}[${index}]`, output)
    );
  } else {
    for (const [field, nested] of Object.entries(value)) {
      if (field !== "trace") {
        collectTrainingTraceErrors(nested, `${path}.${field}`, output);
      }
    }
  }
  return output;
}

function assessSelectedCases(candidate, expectedConfigHash) {
  const cases = [];
  const effectTypes = new Set();
  const effectStages = new Set();
  const sessionIds = new Set();
  for (const definition of TRAINING_TRACE_CASES) {
    const snapshot = atPath(candidate, definition.path);
    const bundle = snapshot?.trainingTrace;
    const validation = validateTrainingTraceBundle(bundle);
    const replay = validation.valid
      ? replayTrainingTrace(bundle)
      : { exact: false, steps: [], errors: validation.errors };
    const effects = validation.valid
      ? bundle.effects.map(assessEffect)
      : [];
    for (const effect of bundle?.effects ?? []) {
      effectTypes.add(effect.effectType);
      for (const stage of effect.stages ?? []) {
        effectStages.add(stage.stage);
      }
    }
    const projection = validation.valid
      ? projectTrainingTraceToEvaluationTrace(bundle)
      : null;
    const projectionMonotonic = projection !== null &&
      projection.events.every(
        (event, index, events) =>
          index === 0 || event.atMs >= events[index - 1].atMs
      );
    let projectionContractValid = projection !== null;
    try {
      projection?.events.forEach((event, index) =>
        validateEvent(event, `projection.events[${index}]`)
      );
    } catch {
      projectionContractValid = false;
    }
    const traceErrors = (snapshot?.trace ?? []).filter((event) =>
      event.type.startsWith("training-trace.") &&
      event.type.endsWith(".error")
    );
    const sessionBound =
      bundle?.session?.sessionId === snapshot?.semantic?.sessionId &&
      bundle?.session?.configHash === expectedConfigHash;
    if (bundle?.session?.sessionId) {
      sessionIds.add(bundle.session.sessionId);
    }
    cases.push({
      label: definition.label,
      path: definition.path.join("."),
      present: snapshot !== undefined,
      validation,
      replay,
      effects,
      projection,
      projectionMonotonic,
      projectionContractValid,
      sessionBound,
      traceErrors,
      trainingTrace: bundle
    });
  }
  const byLabel = Object.fromEntries(
    cases.map((entry) => [entry.label, entry])
  );
  const pcmBackchannelEvents =
    byLabel["pcm-backchannel"]?.projection?.events
      ?.map((event) => event.type) ?? [];
  const pcmBargeInEvents =
    byLabel["pcm-barge-in"]?.projection?.events
      ?.map((event) => event.type) ?? [];
  return {
    cases,
    validationPass:
      cases.every((entry) => entry.present && entry.validation.valid),
    replayPass: cases.every((entry) => entry.replay.exact),
    effectsPass: cases.every((entry) =>
      entry.effects.every((effect) => effect.errors.length === 0)
    ),
    projectionPass:
      cases.every(
        (entry) =>
          entry.projectionMonotonic && entry.projectionContractValid
      ) &&
      pcmBackchannelEvents.includes("assistant.speech.stopped") &&
      pcmBackchannelEvents.includes("assistant.speech.started") &&
      pcmBargeInEvents.includes("assistant.speech.stopped"),
    bindingPass:
      sessionIds.size === cases.length &&
      cases.every((entry) => entry.sessionBound),
    noInstrumentationErrors:
      collectTrainingTraceErrors(candidate).length === 0,
    scopeBoundaryExplicit: cases.every((entry) =>
      entry.validation.valid &&
      entry.projection !== null &&
      entry.projection.schemaVersion === "trace-v0-projection-v1" &&
      entry.validation.counts.events > 0 &&
      entry.validation.counts.decisions > 0 &&
      entry.projection.events.every((event) =>
        [
          "assistant.speech.started",
          "assistant.speech.stopped"
        ].includes(event.type)
      ) &&
      atPath(candidate, entry.path.split("."))
        ?.trainingTrace?.streams?.length === 0 &&
      atPath(candidate, entry.path.split("."))
        ?.trainingTrace?.limitations?.some((limitation) =>
          /sem áudio persistido/iu.test(limitation)
        )
    ),
    coverage: {
      effectTypes: [...effectTypes].sort(),
      effectStages: [...effectStages].sort(),
      requiredEffectsCovered: REQUIRED_TRAINING_EFFECTS.every((effect) =>
        effectTypes.has(effect)
      ),
      requiredStagesCovered: REQUIRED_TRAINING_STAGES.every((stage) =>
        effectStages.has(stage)
      )
    }
  };
}

export function auditTrainingTraceContract() {
  const configHash = `sha256:${"a".repeat(64)}`;
  const recorder = new TrainingTraceRecorder({
    sessionId: "audit-training-trace",
    startedAtEpochMs: 1,
    locale: "pt-BR",
    candidate: "audit-candidate",
    configHash
  });
  const shadowInput = {
    atMs: 1,
    turnId: "turn-shadow",
    epoch: 0,
    event: {
      type: "output-interruption.pause_requested",
      source: "audit-shadow",
      payload: {}
    },
    context: { state: {} },
    policy: {
      id: "audit-shadow",
      version: "checkpoint:audit",
      mode: "shadow"
    },
    transition: { proposal: "PAUSE_OUTPUT" },
    intents: [{ type: "PAUSE_OUTPUT", origin: "audit-shadow" }]
  };
  recorder.recordDecision(shadowInput);
  let shadowAuthorityRejected = false;
  try {
    recorder.recordDecision({
      ...shadowInput,
      atMs: 2,
      authorityDecision: "ACCEPT"
    });
  } catch {
    shadowAuthorityRejected = true;
  }
  const snapshot = recorder.snapshot;
  const corrupted = structuredClone(snapshot);
  corrupted.decisions[0].authorityDecision = "ACCEPT";
  const checks = {
    shadowCreatesNoEffect:
      snapshot.decisions[0].authorityDecision === "OBSERVE_ONLY" &&
      snapshot.effects.length === 0,
    shadowAuthorityRejected,
    schemaAcceptsValidShadow:
      validateTrainingTraceBundle(snapshot).valid === true,
    schemaRejectsCorruptAuthority:
      validateTrainingTraceBundle(corrupted).valid === false
  };
  return {
    schemaVersion: TRAINING_TRACE_VERSION,
    sliceVersion: INTERRUPTION_TRACE_SLICE_VERSION,
    pass: Object.values(checks).every(Boolean),
    checks
  };
}

function assessPhysicalBoundary(candidate) {
  const failedGates = Object.entries(candidate.gates ?? {})
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  const unexpected = failedGates.filter(
    (name) => !PHYSICAL_BOUNDARY_GATES.includes(name)
  );
  const limitationsExplicit = (candidate.limitations ?? []).some(
    (limitation) => /físic|microfone|ambiente/iu.test(limitation)
  );
  return {
    classification: failedGates.length === 0
      ? "resolved-pass"
      : unexpected.length === 0 && limitationsExplicit
        ? "hold-labelled-physical-specificity"
        : "unexpected-regression",
    honest:
      failedGates.length === 0 ||
      (unexpected.length === 0 && limitationsExplicit),
    failedGates,
    unexpected
  };
}

export function evaluateExp0013(input) {
  const candidate = input.candidate ?? {};
  const runtimeHash = input.fingerprints?.runtime?.sha256;
  const expectedConfigHash = `sha256:${runtimeHash ?? ""}`;
  const traces = assessSelectedCases(candidate, expectedConfigHash);
  const physical = assessPhysicalBoundary(candidate);
  const contractAudit = input.contractAudit ?? {};
  const gates = {
    schemaAndReferencesValid: traces.validationPass,
    exactDecisionReplay: traces.replayPass,
    effectLedgerClosed:
      traces.effectsPass && traces.noInstrumentationErrors,
    userPerceivedProjection: traces.projectionPass,
    sessionAndRuntimeBound: traces.bindingPass,
    promotedPathCoverage:
      traces.coverage.requiredEffectsCovered &&
      traces.coverage.requiredStagesCovered,
    shadowHasNoAuthority:
      contractAudit.schemaVersion === TRAINING_TRACE_VERSION &&
      contractAudit.sliceVersion === INTERRUPTION_TRACE_SLICE_VERSION &&
      contractAudit.pass === true,
    partialScopeExplicit: traces.scopeBoundaryExplicit,
    browserInteractionRegression:
      REQUIRED_BROWSER_GATES.every(
        (name) => candidate.gates?.[name] === true
      ),
    physicalBoundaryHonest: physical.honest,
    sourceAndRuntimeComparable:
      candidate.sourceFingerprint?.sha256 ===
        input.fingerprints?.campaign?.sha256 &&
      input.health?.process?.runtimeFingerprint?.sha256 === runtimeHash,
    localZeroPaidExecution:
      input.health?.status === "ok" &&
      input.health?.brain === "local" &&
      input.health?.usage?.requests === 0
  };
  const pass = Object.values(gates).every(Boolean);
  const effectCount = traces.cases.reduce(
    (sum, entry) => sum + (entry.validation.counts?.effects ?? 0),
    0
  );
  const decisionCount = traces.cases.reduce(
    (sum, entry) => sum + (entry.validation.counts?.decisions ?? 0),
    0
  );
  return {
    schemaVersion: 1,
    experimentId: "EXP-0013",
    evidenceLevel:
      "causal-browser-effects-plus-replay-and-v0-projection",
    generatedAt: new Date().toISOString(),
    decision: pass
      ? "promote-training-trace-interruption-slice"
      : "hold",
    pass,
    scope: "training-trace-v1-output-interruption-slice",
    globalRuntimeStatus: physical.classification,
    gates,
    contextGates: {
      fullTrainingTraceV1Materialized: false,
      audioStreamsPersistedAndHashed: false,
      crossProcessClockMappingMaterialized: false,
      m4aGeneralizationClaimed: false,
      fullSmokePass: candidate.ok === true
    },
    metrics: {
      selectedCases: traces.cases.length,
      replayedDecisions: decisionCount,
      observedEffects: effectCount,
      responseStartMs:
        candidate.directTurn?.metrics?.responseStartMs ?? null,
      stopCommandMs: candidate.bargeIn?.metrics?.stopCommandMs ?? null,
      browserRenderStopMs:
        candidate.bargeIn?.metrics?.stopRenderedMs ?? null,
      pcmOnsetToBrowserRenderStopMs:
        candidate.bargeIn?.closedLoop?.speechOnsetToLastRenderMs ?? null,
      realBackchannelSpeechEndToResumeMs:
        candidate.realBackchannel?.recovery?.speechEndToResumeMs ?? null
    },
    observations: {
      traces,
      contractAudit,
      physical
    },
    interpretation: {
      promoted:
        "A fatia de interrupção produz no Chrome um bundle causal com IDs, " +
        "contexto, decisão, rótulo e ledger de efeitos; o reducer reproduz " +
        "cada decisão e a projeção v0 usa apenas STOP renderizado e retomada " +
        "audível.",
      notPromoted:
        "O contrato training-trace-v1 completo, streams acústicos hasheados, " +
        "clocks entre processos, M4a, política treinada, generalização e " +
        "especificidade física ampla.",
      next:
        "Persistir áudio e posições de amostra apenas no recorte necessário " +
        "ao primeiro candidato M4a em shadow, mantendo efeitos críticos sob " +
        "autoridade determinística."
    }
  };
}
