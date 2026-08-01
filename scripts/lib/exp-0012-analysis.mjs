import {
  OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
  OutputInterruptionLifecycle
} from "../../web/output-interruption-lifecycle.mjs";

const EXPECTED_REPLAY_LABELS = Object.freeze([
  "pending-audio",
  "deterministic-backchannel",
  "reopened-backchannel",
  "pcm-backchannel",
  "pcm-barge-in",
  "long-correction"
]);

const REQUIRED_PHASES = Object.freeze([
  "idle",
  "held",
  "resuming",
  "confirmed"
]);

const REQUIRED_INTENTS = Object.freeze([
  "PAUSE_OUTPUT",
  "HOLD_OUTPUT",
  "KEEP_OUTPUT_HELD",
  "RESUME_OUTPUT",
  "SETTLE_WITHOUT_RESUME",
  "SETTLE_RESUMED",
  "CONFIRM_INTERRUPTION",
  "SETTLE_CLEARED"
]);

const REQUIRED_BROWSER_GATES = Object.freeze([
  "automationAvailable",
  "outputInterruptionLifecycleAdvertised",
  "outputInterruptionLifecycleReplay",
  "outputInterruptionLifecycleCoverage",
  "outputInterruptionLifecycleNoInvariantError",
  "audioTransportRecovery",
  "requestedVadControlSelected",
  "audioDrainedThroughWatermark",
  "serverAudioPipelineIntegrity",
  "deterministicPotentialBargeInRecovery",
  "localAudioReflexAdvertised",
  "marginalSpikeHandledByReflex",
  "earlyBackchannelPartialCanReopen",
  "pendingAudioHeldDuringPotentialBargeIn",
  "realPcmBackchannelRecovered",
  "localAudioVertical",
  "responseStarted",
  "statefulCriticalConfirmation",
  "stoppedOnBargeIn",
  "localAudioReflexPreservesBargeIn",
  "closedLoopPcmBargeIn",
  "browserRenderPathStoppedOnBargeIn",
  "longCorrectionNeverResumedMidSpeech",
  "delegatedTaskCancelled",
  "delegatedTaskSurvivesConversation",
  "noAudioPipelineErrors",
  "noBrowserErrors"
]);

const PHYSICAL_BOUNDARY_GATES = Object.freeze([
  "physicalMicrophoneCapture",
  "sileroControlIntegrity",
  "noSelfInterruptionUnderDeviceAec",
  "longSessionNoFalseActivation",
  "sileroShadowIntegrity",
  "sileroShadowAssistantOnlySpecificity",
  "potentialBargeInRecovery"
]);

function pause(overrides = {}) {
  return {
    type: "PAUSE_REQUESTED",
    turnId: "audit-turn-1",
    outputEpoch: 7,
    hasAudibleOutput: true,
    hasAcousticOutput: true,
    hasActiveResponse: true,
    ...overrides
  };
}

function intentType(transition) {
  return transition.intents[0]?.type ?? null;
}

export function auditOutputInterruptionContract() {
  const repause = new OutputInterruptionLifecycle();
  repause.dispatch(pause());
  repause.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 7,
    hasResumableAudio: true
  });
  const cancelledResume = repause.dispatch(
    pause({ turnId: "audit-turn-2" })
  );
  const staleWhileHeld = repause.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: 1
  });
  const currentResume = repause.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 7,
    hasResumableAudio: true
  });
  const olderWhileNewerResumes = repause.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: 1
  });
  const newerResumeSucceeded = repause.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: currentResume.state.resumeAttempt
  });

  const confirmed = new OutputInterruptionLifecycle();
  confirmed.dispatch(pause());
  confirmed.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 7,
    hasResumableAudio: true
  });
  const confirmedDuringResume = confirmed.dispatch({
    type: "CONFIRM_REQUESTED",
    reason: "audit-useful-speech"
  });
  const staleAfterConfirmation = confirmed.dispatch({
    type: "RESUME_SUCCEEDED",
    resumeAttempt: 1
  });

  const obsolete = new OutputInterruptionLifecycle();
  obsolete.dispatch(pause());
  const obsoleteEpoch = obsolete.dispatch({
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 8,
    hasResumableAudio: true
  });

  const noOutput = new OutputInterruptionLifecycle().dispatch(
    pause({
      hasAudibleOutput: false,
      hasAcousticOutput: false,
      hasActiveResponse: false
    })
  );

  const checks = {
    speechDuringResumeCancelsPlay:
      cancelledResume.state.phase === "held" &&
      intentType(cancelledResume) === "CANCEL_RESUME_AND_PAUSE",
    stalePlayCannotEscapeHold:
      staleWhileHeld.state.phase === "held" &&
      intentType(staleWhileHeld) === "PAUSE_STALE_RESUME",
    oldResultCannotSabotageNewResume:
      olderWhileNewerResumes.state.phase === "resuming" &&
      intentType(olderWhileNewerResumes) === "IGNORE_STALE_RESUME" &&
      newerResumeSucceeded.state.phase === "idle" &&
      intentType(newerResumeSucceeded) === "SETTLE_RESUMED",
    confirmationInvalidatesPendingPlay:
      confirmedDuringResume.state.phase === "confirmed" &&
      intentType(confirmedDuringResume) === "CONFIRM_INTERRUPTION" &&
      intentType(staleAfterConfirmation) === "PAUSE_STALE_RESUME",
    obsoleteEpochNeverResumes:
      obsoleteEpoch.state.phase === "idle" &&
      intentType(obsoleteEpoch) === "SETTLE_WITHOUT_RESUME",
    noOutputCreatesNoHold:
      noOutput.state.phase === "idle" &&
      noOutput.intents.length === 0
  };
  return {
    version: OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
    pass: Object.values(checks).every(Boolean),
    checks
  };
}

function assessReplay(candidate) {
  const lifecycle = candidate.outputInterruptionLifecycle ?? {};
  const replays = Array.isArray(lifecycle.replays)
    ? lifecycle.replays
    : [];
  const labels = replays.map((replay) => replay.label);
  const allSteps = replays.flatMap((replay) =>
    Array.isArray(replay.steps) ? replay.steps : []
  );
  return {
    version: lifecycle.version ?? null,
    expectedLabelsPresent:
      EXPECTED_REPLAY_LABELS.every((label) => labels.includes(label)) &&
      new Set(labels).size === replays.length,
    exact:
      replays.length === EXPECTED_REPLAY_LABELS.length &&
      replays.every(
        (replay) =>
          replay.ok === true &&
          replay.terminalPhase === "idle" &&
          Array.isArray(replay.errors) &&
          replay.errors.length === 0 &&
          Array.isArray(replay.steps) &&
          replay.steps.length > 0 &&
          replay.steps.every((step) => step.equivalent === true)
      ),
    noRedundantDecisions:
      allSteps.length > 0 &&
      allSteps.every(
        (step) =>
          Array.isArray(step.intents) && step.intents.length > 0
      ),
    phasesCovered: REQUIRED_PHASES.every((phase) =>
      lifecycle.coverage?.phases?.includes(phase)
    ),
    intentsCovered: REQUIRED_INTENTS.every((intent) =>
      lifecycle.coverage?.intents?.includes(intent)
    ),
    replays,
    coverage: lifecycle.coverage ?? null
  };
}

function assessPhysicalBoundary(candidate) {
  const gates = candidate.gates ?? {};
  const failedGates = Object.entries(gates)
    .filter(([, value]) => value !== true)
    .map(([name]) => name);
  const physicalPassed = PHYSICAL_BOUNDARY_GATES.every(
    (name) => gates[name] === true
  );
  const preflight =
    candidate.microphoneCapture?.falseActivationProbe?.preflight ?? null;
  const unresolvedStatuses = new Set([
    "unresolved",
    "probe-start-unresolved"
  ]);
  const onlyPhysicalUnresolved =
    failedGates.length > 0 &&
    failedGates.every((name) => PHYSICAL_BOUNDARY_GATES.includes(name)) &&
    unresolvedStatuses.has(preflight?.status);
  return {
    classification: physicalPassed
      ? "resolved-pass"
      : onlyPhysicalUnresolved
        ? "unresolved-causal-probe"
        : "unexpected-regression",
    boundaryHonest: physicalPassed || onlyPhysicalUnresolved,
    physicalPassed,
    failedGates,
    preflight
  };
}

export function evaluateExp0012(input) {
  const candidate = input.candidate ?? {};
  const replay = assessReplay(candidate);
  const physical = assessPhysicalBoundary(candidate);
  const contractAudit = input.contractAudit ?? {};
  const sourceComparable =
    typeof candidate.sourceFingerprint?.sha256 === "string" &&
    candidate.sourceFingerprint.sha256 ===
      input.fingerprints?.campaign?.sha256;
  const gates = {
    lifecycleVersionAdvertised:
      candidate.page?.outputInterruptionLifecycle?.lifecycleVersion ===
        OUTPUT_INTERRUPTION_LIFECYCLE_VERSION &&
      replay.version === OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
    exactBrowserReplay:
      replay.expectedLabelsPresent && replay.exact,
    lifecycleCoverage:
      replay.phasesCovered && replay.intentsCovered,
    noRedundantLifecycleDecisions: replay.noRedundantDecisions,
    asyncRaceContract:
      contractAudit.version === OUTPUT_INTERRUPTION_LIFECYCLE_VERSION &&
      contractAudit.pass === true &&
      Object.values(contractAudit.checks ?? {}).every(Boolean),
    browserInteractionRegression:
      REQUIRED_BROWSER_GATES.every(
        (name) => candidate.gates?.[name] === true
      ),
    physicalBoundaryHonest: physical.boundaryHonest,
    sourceAndRuntimeComparable:
      sourceComparable &&
      input.health?.process?.runtimeFingerprint?.sha256 ===
        input.fingerprints?.runtime?.sha256,
    localZeroPaidExecution:
      input.health?.status === "ok" &&
      input.health?.brain === "local" &&
      input.health?.usage?.requests === 0
  };
  const pass = Object.values(gates).every(Boolean);
  return {
    schemaVersion: 1,
    experimentId: "EXP-0012",
    evidenceLevel: "causal-browser-render-plus-exact-lifecycle-replay",
    generatedAt: new Date().toISOString(),
    decision: pass
      ? "promote-output-interruption-lifecycle-slice"
      : "hold",
    pass,
    scope: "local-output-interruption-lifecycle",
    globalRuntimeStatus: physical.physicalPassed
      ? "pass-current-physical-probe"
      : "hold-labelled-physical-specificity",
    gates,
    contextGates: {
      fullSmokePass: candidate.ok === true,
      physicalSpecificityConclusive: physical.physicalPassed
    },
    metrics: {
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
      replay,
      contractAudit,
      physical
    },
    interpretation: {
      promoted:
        "Uma única máquina de estados local governa hold, retomada e " +
        "confirmação; os traces do Chrome reproduzem exatamente seus " +
        "efeitos e corridas assíncronas falham fechadas.",
      notPromoted:
        "M2.5 completo, especificidade acústica física global, loopback " +
        "causal, política treinada ou generalização humana.",
      physicalFinding:
        physical.physicalPassed
          ? "O probe físico corrente também passou."
          : "O probe causal físico não iniciou de forma válida; seus gates " +
            "continuam em hold sem bloquear a promoção estreita do lifecycle."
    }
  };
}

export {
  EXPECTED_REPLAY_LABELS,
  PHYSICAL_BOUNDARY_GATES,
  REQUIRED_BROWSER_GATES,
  REQUIRED_INTENTS,
  REQUIRED_PHASES
};
