const REFLEX_VERSION = "local-audio-reflex-v0.1";
const CANDIDATE_MODE = "evidence-gated";
const CONTROL_MODE = "immediate";
const CLOSED_LOOP_LIMIT_MS = 350;

const NON_ACOUSTIC_REGRESSION_GATES = Object.freeze([
  "automationAvailable",
  "physicalMicrophoneCapture",
  "audioTransportRecovery",
  "requestedVadControlSelected",
  "sileroControlIntegrity",
  "audioDrainedThroughWatermark",
  "serverAudioPipelineIntegrity",
  "sileroShadowIntegrity",
  "sileroShadowFixtureSensitivity",
  "deterministicPotentialBargeInRecovery",
  "localAudioReflexAdvertised",
  "marginalSpikeControlObserved",
  "earlyBackchannelPartialCanReopen",
  "pendingAudioHeldDuringPotentialBargeIn",
  "realPcmBackchannelRecovered",
  "localAudioVertical",
  "responseStarted",
  "statefulCriticalConfirmation",
  "stoppedOnBargeIn",
  "browserRenderPathStoppedOnBargeIn",
  "longCorrectionNeverResumedMidSpeech",
  "delegatedTaskCancelled",
  "delegatedTaskSurvivesConversation",
  "noAudioPipelineErrors",
  "noBrowserErrors"
]);

function traceOf(snapshot) {
  return Array.isArray(snapshot?.trace) ? snapshot.trace : [];
}

function eventTypes(snapshot) {
  return traceOf(snapshot).map((event) => event.type);
}

function hasType(snapshot, type) {
  return eventTypes(snapshot).includes(type);
}

function reflexMode(report) {
  return report?.page?.localAudioReflex?.config?.mode ?? null;
}

function assessMarginal(report) {
  const started = report?.marginalReflex?.started;
  const settled = report?.marginalReflex?.settled;
  const startedTypes = eventTypes(started);
  const settledTypes = eventTypes(settled);
  const mode = settled?.audio?.localAudioReflex?.config?.mode ??
    reflexMode(report);
  const armedWithoutPause =
    startedTypes.includes("local-audio-reflex.armed") &&
    !startedTypes.includes("assistant.speech.paused");
  const outputPreserved =
    settledTypes.includes("local-audio-reflex.suppressed") &&
    settledTypes.includes("local-audio-reflex.transcript-suppressed") &&
    !settledTypes.includes("assistant.speech.paused") &&
    !settledTypes.includes("assistant.speech.stopped") &&
    !settledTypes.includes("barge-in.confirmed") &&
    !settledTypes.includes("turn.committed") &&
    settled?.state?.assistantSpeaking === true;
  const immediateAdverseOutcome =
    startedTypes.includes("local-audio-reflex.pause") &&
    startedTypes.includes("assistant.speech.paused") &&
    settledTypes.includes("barge-in.confirmed") &&
    settledTypes.includes("turn.committed");
  return {
    mode,
    passCandidate:
      mode === CANDIDATE_MODE && armedWithoutPause && outputPreserved,
    passControl:
      mode === CONTROL_MODE && immediateAdverseOutcome,
    armedWithoutPause,
    outputPreserved,
    lateTranscriptSuppressed: settledTypes.includes(
      "local-audio-reflex.transcript-suppressed"
    ),
    turnCommitted: settledTypes.includes("turn.committed"),
    immediateAdverseOutcome
  };
}

function assessBargeIn(report) {
  const snapshot = report?.bargeIn;
  const trace = traceOf(snapshot);
  const armedAt = trace.findIndex(
    (event) => event.type === "local-audio-reflex.armed"
  );
  const pauseAt = trace.findIndex(
    (event) => event.type === "local-audio-reflex.pause"
  );
  const pauseEvent = trace[pauseAt];
  const latencyMs = snapshot?.closedLoop?.speechOnsetToLastRenderMs;
  const sustainedEvidence =
    armedAt >= 0 &&
    pauseAt > armedAt &&
    /sustained-acoustic-evidence|transcript-evidence/u.test(
      String(pauseEvent?.detail ?? "")
    );
  return {
    pass:
      sustainedEvidence &&
      hasType(snapshot, "assistant.speech.paused") &&
      hasType(snapshot, "barge-in.confirmed") &&
      report?.gates?.stoppedOnBargeIn === true &&
      report?.gates?.browserRenderPathStoppedOnBargeIn === true &&
      report?.gates?.closedLoopPcmBargeIn === true &&
      Number.isFinite(latencyMs) &&
      latencyMs >= 0 &&
      latencyMs <= CLOSED_LOOP_LIMIT_MS,
    sustainedEvidence,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    limitMs: CLOSED_LOOP_LIMIT_MS
  };
}

function pauseResolutions(trace) {
  const pauses = trace
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === "assistant.speech.paused");
  return pauses.map(({ event, index }, pauseIndex) => {
    const nextPauseIndex = pauses[pauseIndex + 1]?.index ?? trace.length;
    const resolution = trace.slice(index + 1, nextPauseIndex).find(
      (candidate) =>
        candidate.type === "barge-in.dismissed" ||
        candidate.type === "barge-in.confirmed"
    );
    return {
      pausedAtMs: event.atMs,
      resolution: resolution?.type ?? null,
      resolvedAtMs: resolution?.atMs ?? null,
      latencyMs: resolution
        ? Math.round((resolution.atMs - event.atMs) * 100) / 100
        : null
    };
  });
}

function assessPhysicalProbe(report) {
  const probe = report?.microphoneCapture?.falseActivationProbe ?? {};
  const trace = traceOf(report?.microphoneCapture);
  const probeStart = trace.findIndex(
    (event) =>
      event.type === "assistant.speech.started" &&
      event.detail === "automation-probe"
  );
  const tail = probeStart >= 0 ? trace.slice(probeStart + 1) : [];
  const resolutions = pauseResolutions(tail);
  const rawStarts = Number(probe.unexpectedUserSpeechEvents) || 0;
  const pauses = Number(probe.unexpectedAssistantPauseEvents) || 0;
  const confirmed = Number(probe.confirmedPotentialBargeIns) || 0;
  const suppressed = tail.filter(
    (event) => event.type === "local-audio-reflex.suppressed"
  ).length;
  const orphanedPauses = resolutions.filter(
    (item) => item.resolution === null
  ).length;
  let classification = "unresolved";
  if (probeStart >= 0 && orphanedPauses === 0) {
    if (confirmed > 0) {
      classification = "unlabelled-concurrent-speech";
    } else if (rawStarts === 0) {
      classification = "quiet-no-activation";
    } else if (pauses === 0 && suppressed > 0) {
      classification = "unlabelled-activation-suppressed";
    } else {
      classification = "unlabelled-activation-resolved";
    }
  }
  return {
    pass:
      probeStart >= 0 &&
      orphanedPauses === 0 &&
      report?.gates?.noAudioPipelineErrors === true &&
      report?.gates?.noBrowserErrors === true,
    classification,
    specificityConclusive: classification === "quiet-no-activation",
    rawStarts,
    pauses,
    confirmed,
    suppressed,
    orphanedPauses,
    resolutions,
    preflight: probe.preflight ?? null
  };
}

function supplementalSummary(reports) {
  return (Array.isArray(reports) ? reports : []).map((report) => ({
    runNonce: report?.runNonce ?? null,
    mode: reflexMode(report),
    ok: report?.ok === true,
    physical: assessPhysicalProbe(report),
    marginal: assessMarginal(report),
    bargeIn: assessBargeIn(report)
  }));
}

export function evaluateExp0011(input) {
  const control = input.control ?? {};
  const candidate = input.candidate ?? {};
  const marginalControl = assessMarginal(control);
  const marginalCandidate = assessMarginal(candidate);
  const bargeIn = assessBargeIn(candidate);
  const physical = assessPhysicalProbe(candidate);
  const sourceComparable =
    typeof candidate.sourceFingerprint?.sha256 === "string" &&
    candidate.sourceFingerprint.sha256 ===
      control.sourceFingerprint?.sha256 &&
    candidate.sourceFingerprint.sha256 ===
      input.fingerprints?.campaign?.sha256;
  const gates = {
    candidateConfigured:
      reflexMode(candidate) === CANDIDATE_MODE &&
      candidate.page?.localAudioReflex?.reflexVersion === REFLEX_VERSION &&
      candidate.page.localAudioReflex.config?.supportProbability === 0.75 &&
      candidate.page.localAudioReflex.config?.supportWindows === 2,
    sourceIdenticalAb: sourceComparable,
    controlExposesMarginalFailure: marginalControl.passControl,
    marginalSpikePreservesOutput: marginalCandidate.passCandidate,
    lateTranscriptCannotLeak: marginalCandidate.lateTranscriptSuppressed,
    realBargeInPreserved: bargeIn.pass,
    physicalInteractionResolved: physical.pass,
    nonAcousticBrowserRegression: NON_ACOUSTIC_REGRESSION_GATES.every(
      (name) => candidate.gates?.[name] === true
    ),
    sourceAndRuntimeComparable:
      candidate.sourceFingerprint?.sha256 ===
        input.fingerprints?.campaign?.sha256 &&
      input.health?.process?.runtimeFingerprint?.sha256 ===
        input.fingerprints?.runtime?.sha256,
    localZeroPaidExecution:
      input.health?.status === "ok" &&
      input.health?.brain === "local" &&
      input.health?.usage?.requests === 0
  };
  const pass = Object.values(gates).every(Boolean);
  const supplemental = supplementalSummary(input.supplemental);
  return {
    schemaVersion: 1,
    experimentId: "EXP-0011",
    evidenceLevel: "causal-browser-reflex-plus-unlabelled-physical",
    generatedAt: new Date().toISOString(),
    decision: pass ? "promote-local-audio-reflex-slice" : "hold",
    pass,
    scope: "assistant-output-barge-in-reflex",
    globalRuntimeStatus: physical.specificityConclusive
      ? "pass-current-physical-probe"
      : "hold-labelled-physical-specificity",
    gates,
    contextGates: {
      fullSmokePass: candidate.ok === true,
      rawPhysicalSpecificity:
        candidate.gates?.longSessionNoFalseActivation === true &&
        candidate.gates?.sileroShadowAssistantOnlySpecificity === true,
      physicalSpecificityConclusive: physical.specificityConclusive
    },
    metrics: {
      controlMarginalPaused: marginalControl.immediateAdverseOutcome,
      candidateMarginalOutputPreserved: marginalCandidate.outputPreserved,
      candidateLateTranscriptSuppressed:
        marginalCandidate.lateTranscriptSuppressed,
      closedLoopBargeInMs: bargeIn.latencyMs,
      closedLoopLimitMs: bargeIn.limitMs,
      physical
    },
    observations: {
      control: marginalControl,
      candidate: marginalCandidate,
      bargeIn,
      supplemental
    },
    interpretation: {
      promoted:
        "Reflexo local evidence-gated durante saída audível: aguarda duas janelas de suporte, preserva a voz em pico isolado e impede que um final tardio não confirmado crie turno.",
      notPromoted:
        "Especificidade acústica física global, causalidade de eco, calibração por dispositivo, generalização humana ou M2.5 completo.",
      physicalFinding:
        physical.specificityConclusive
          ? "A janela física corrente permaneceu sem ativação bruta."
          : `A janela física é ${physical.classification}; sem rótulo humano ou loopback ela não prova nem refuta autoeco.`
    },
    limitations: [
      "O A/B causal usa eventos Silero determinísticos no navegador; a sessão física complementar não possui rótulo de quem falou.",
      "Duas janelas adicionais acrescentam cerca de 64 ms e foram verificadas em uma fixture principal de barge-in, não em população humana.",
      "O STOP medido termina no último quantum não silencioso do Chrome e não inclui a cauda do alto-falante ou da sala.",
      "A promoção é somente da fatia de reflexo; especificidade física rotulada e testes humanos continuam pendentes."
    ]
  };
}

export {
  assessBargeIn,
  assessMarginal,
  assessPhysicalProbe
};
