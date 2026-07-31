const KERNEL_VERSION = "interaction-kernel-v0.1";
const AUTHORITY = "backend-interaction-runtime";
const POLICY = "repeat-critical-value-before-commit";
const EXPECTED_VALUE = "BRL 1150";
const LATENCY_LIMIT_MS = 1_200;

const NON_ACOUSTIC_GLOBAL_GATES = Object.freeze([
  "automationAvailable",
  "requestedVadControlSelected",
  "sileroControlIntegrity",
  "serverAudioPipelineIntegrity",
  "sileroShadowIntegrity",
  "sileroShadowFixtureSensitivity",
  "deterministicPotentialBargeInRecovery",
  "earlyBackchannelPartialCanReopen",
  "pendingAudioHeldDuringPotentialBargeIn",
  "realPcmBackchannelRecovered",
  "localAudioVertical",
  "responseStarted",
  "stoppedOnBargeIn",
  "closedLoopPcmBargeIn",
  "browserRenderPathStoppedOnBargeIn",
  "longCorrectionNeverResumedMidSpeech",
  "delegatedTaskCancelled",
  "delegatedTaskSurvivesConversation",
  "noAudioPipelineErrors",
  "noBrowserErrors"
]);

function percentile(values, ratio) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) {
    return null;
  }
  return finite[Math.max(0, Math.ceil(finite.length * ratio) - 1)];
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function traceOf(snapshot) {
  return Array.isArray(snapshot?.trace) ? snapshot.trace : [];
}

function events(snapshot, type) {
  return traceOf(snapshot).filter((event) => event.type === type);
}

function responseLatency(snapshot, commitIndex) {
  const trace = traceOf(snapshot);
  const commits = trace.filter((event) => event.type === "turn.committed");
  const commit = commits[commitIndex];
  if (!commit) {
    return null;
  }
  const start = trace.find(
    (event) =>
      event.type === "assistant.speech.started" &&
      event.detail === "direct" &&
      event.atMs >= commit.atMs
  );
  return start ? Math.round((start.atMs - commit.atMs) * 100) / 100 : null;
}

function transitionTrace(snapshot) {
  return events(snapshot, "interaction.transition")
    .map((event) => parseObject(event.detail))
    .filter(Boolean);
}

function assessRun(run) {
  const pending = run?.pending;
  const accepted = run?.accepted;
  const pendingSemantic = pending?.semantic;
  const acceptedSemantic = accepted?.semantic;
  const pendingTransitions = transitionTrace(pending);
  const acceptedTransitions = transitionTrace(accepted);
  const rollbackEvents = events(accepted, "state.rollback");
  const rollback = parseObject(rollbackEvents.at(-1)?.detail);
  const pendingId = pendingSemantic?.pendingConfirmation?.id;
  const revision = acceptedSemantic?.revisions?.[0];
  const singleAuthority =
    pendingSemantic?.authority === AUTHORITY &&
    acceptedSemantic?.authority === AUTHORITY &&
    typeof pendingSemantic?.sessionId === "string" &&
    pendingSemantic.sessionId === acceptedSemantic?.sessionId &&
    pendingTransitions.length === 1 &&
    acceptedTransitions.length === 2 &&
    acceptedTransitions.every(
      (transition) =>
        transition.authority === AUTHORITY &&
        transition.kernelVersion === KERNEL_VERSION
    );
  const orderedVersions =
    pendingSemantic?.kernelStateVersion === 1 &&
    acceptedSemantic?.kernelStateVersion === 2 &&
    acceptedTransitions[0]?.previousStateVersion === 0 &&
    acceptedTransitions[0]?.stateVersion === 1 &&
    acceptedTransitions[1]?.previousStateVersion === 1 &&
    acceptedTransitions[1]?.stateVersion === 2;
  const noPrematureSemanticCommit =
    pendingSemantic?.state === null &&
    pendingSemantic?.revisions?.length === 0 &&
    pendingSemantic?.pendingConfirmation?.policy === POLICY &&
    events(pending, "state.rollback").length === 0 &&
    events(pending, "task.delegated").length === 0;
  const singlePostConfirmationCommit =
    acceptedSemantic?.pendingConfirmation === null &&
    acceptedSemantic?.state?.slot === "amount" &&
    acceptedSemantic?.state?.value === EXPECTED_VALUE &&
    acceptedSemantic?.revisions?.length === 1 &&
    revision?.current === EXPECTED_VALUE &&
    revision?.confirmationId === pendingId &&
    rollbackEvents.length === 1 &&
    rollback?.current === EXPECTED_VALUE &&
    rollback?.revisionId === acceptedSemantic?.state?.revisionId &&
    rollback?.confirmationId === pendingId &&
    events(accepted, "assistant.safety-confirmed").length === 1 &&
    events(accepted, "task.delegated").length === 0;
  const neutralPrompt =
    typeof pending?.text?.assistant === "string" &&
    !/\d/u.test(pending.text.assistant);
  const acceptedResponse =
    typeof accepted?.text?.assistant === "string" &&
    /1150/u.test(accepted.text.assistant);
  const noRuntimeErrors = [pending, accepted].every(
    (snapshot) =>
      !traceOf(snapshot).some((event) => event.type.endsWith(".error"))
  );
  const pendingResponseMs = responseLatency(pending, 0);
  const acceptedResponseMs = responseLatency(accepted, 1);
  return {
    repetition: run?.repetition ?? null,
    sessionId: pendingSemantic?.sessionId ?? null,
    pass:
      singleAuthority &&
      orderedVersions &&
      noPrematureSemanticCommit &&
      singlePostConfirmationCommit &&
      neutralPrompt &&
      acceptedResponse &&
      noRuntimeErrors &&
      Number.isFinite(pendingResponseMs) &&
      Number.isFinite(acceptedResponseMs),
    checks: {
      singleAuthority,
      orderedVersions,
      noPrematureSemanticCommit,
      singlePostConfirmationCommit,
      neutralPrompt,
      acceptedResponse,
      noRuntimeErrors
    },
    pendingResponseMs,
    acceptedResponseMs,
    finalValue: acceptedSemantic?.state?.value ?? null,
    pendingRollbackCount: events(pending, "state.rollback").length,
    acceptedRollbackCount: rollbackEvents.length
  };
}

function historySummary(history) {
  const reports = Array.isArray(history) ? history : [];
  return {
    fullSmokeRuns: reports.length,
    fullSmokePasses: reports.filter((item) => item?.ok === true).length,
    statefulGatePasses: reports.filter(
      (item) => item?.gates?.statefulCriticalConfirmation === true
    ).length,
    acousticLongSessionPasses: reports.filter(
      (item) =>
        item?.gates?.noSelfInterruptionUnderDeviceAec === true &&
        item?.gates?.longSessionNoFalseActivation === true &&
        item?.gates?.sileroShadowAssistantOnlySpecificity === true
    ).length
  };
}

export function evaluateExp0010(input, options = {}) {
  const expectedRepetitions = options.repetitions ?? 5;
  const browser = input.browser ?? {};
  const runs = browser.criticalConfirmation?.runs ?? [];
  const observations = runs.map(assessRun);
  const repetitions = observations.map((item) => item.repetition);
  const sessions = observations.map((item) => item.sessionId);
  const complete =
    observations.length === expectedRepetitions &&
    new Set(repetitions).size === expectedRepetitions &&
    repetitions.every(Number.isSafeInteger);
  const allObserved = complete && observations.every((item) => item.pass);
  const gates = {
    complete,
    deterministicReplayContract:
      allObserved && observations.every((item) => item.checks.orderedVersions),
    singleAuthority:
      allObserved &&
      observations.every((item) => item.checks.singleAuthority) &&
      sessions.every((sessionId) => typeof sessionId === "string") &&
      new Set(sessions).size === expectedRepetitions,
    noPrematureSemanticCommit:
      allObserved &&
      observations.every(
        (item) => item.checks.noPrematureSemanticCommit
      ),
    singlePostConfirmationCommit:
      allObserved &&
      observations.every(
        (item) => item.checks.singlePostConfirmationCommit
      ),
    neutralPromptWithoutRecognizedValue:
      allObserved && observations.every((item) => item.checks.neutralPrompt),
    responseP95Below1200:
      percentile(
        observations.map((item) => item.pendingResponseMs),
        0.95
      ) < LATENCY_LIMIT_MS &&
      percentile(
        observations.map((item) => item.acceptedResponseMs),
        0.95
      ) < LATENCY_LIMIT_MS,
    sourceAndRuntimeComparable:
      browser.sourceFingerprint?.sha256 ===
        input.fingerprints?.campaign?.sha256 &&
      input.health?.process?.runtimeFingerprint?.sha256 ===
        input.fingerprints?.runtime?.sha256,
    localZeroPaidExecution:
      input.health?.status === "ok" &&
      input.health?.brain === "local" &&
      input.health?.usage?.requests === 0,
    authorityAdvertisedByRuntime:
      input.health?.interaction?.authority === AUTHORITY &&
      input.health?.interaction?.kernelVersion === KERNEL_VERSION,
    nonAcousticBrowserRegression:
      NON_ACOUSTIC_GLOBAL_GATES.every(
        (name) => browser.gates?.[name] === true
      )
  };
  const contextGates = {
    acousticLongSessionStable:
      browser.gates?.noSelfInterruptionUnderDeviceAec === true &&
      browser.gates?.longSessionNoFalseActivation === true &&
      browser.gates?.sileroShadowAssistantOnlySpecificity === true &&
      browser.gates?.potentialBargeInRecovery === true,
    fullSmokePass: browser.ok === true
  };
  const pass = Object.values(gates).every(Boolean);
  const history = historySummary(input.history);
  return {
    schemaVersion: 1,
    experimentId: "EXP-0010",
    evidenceLevel: "stateful-browser-causal-slice",
    generatedAt: new Date().toISOString(),
    decision: pass ? "promote-stateful-kernel-slice" : "hold",
    pass,
    scope: "critical-amount-confirmation-state-machine",
    globalRuntimeStatus:
      contextGates.fullSmokePass && contextGates.acousticLongSessionStable
        ? "pass-current-smoke"
        : "hold-acoustic-stability",
    gates,
    contextGates,
    metrics: {
      observations: observations.length,
      passingObservations: observations.filter((item) => item.pass).length,
      pendingResponseP95Ms: percentile(
        observations.map((item) => item.pendingResponseMs),
        0.95
      ),
      acceptedResponseP95Ms: percentile(
        observations.map((item) => item.acceptedResponseMs),
        0.95
      ),
      browserHistory: history
    },
    observations,
    interpretation: {
      promoted:
        "Kernel stateful v0.1, autoridade única por sessão e projeção browser de intenções para o fluxo monetário crítico.",
      notPromoted:
        "M2.5 completo, efeitos externos reais, generalização semântica ou estabilidade acústica física de longo prazo.",
      acousticFinding:
        history.fullSmokeRuns === 0
          ? "Sem histórico suplementar."
          : `${history.acousticLongSessionPasses}/${history.fullSmokeRuns} smokes suplementares passaram o eixo acústico longo; o resultado não altera o gate causal do kernel.`
    },
    limitations: [
      "A campanha usa texto injetado para isolar a máquina de estados; ASR acústico continua coberto separadamente.",
      "O valor repetido é uma única realização conhecida e ainda não autoriza efeito financeiro externo.",
      "A política abstém em negação, dúvida, alternativa ou ausência de um único valor, mas a cobertura linguística ainda é estreita.",
      "Flutuações físicas de AEC/VAD permanecem um eixo independente e explicitamente reportado."
    ]
  };
}
