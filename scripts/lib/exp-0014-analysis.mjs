import { isDeepStrictEqual } from "node:util";

import {
  ACOUSTIC_REFLEX_CLASSES,
  acousticReflexTeacherLabel,
  predictAcousticReflex
} from "../../web/acoustic-reflex-shadow.mjs";
import {
  reduceLocalAudioReflex
} from "../../web/local-audio-reflex.mjs";
import {
  ACOUSTIC_REFLEX_TRACE_SLICE_VERSION,
  validateTrainingTraceBundle
} from "../../web/training-trace-recorder.mjs";

const REQUIRED_BROWSER_GATES = Object.freeze([
  "automationAvailable",
  "requestedVadControlSelected",
  "sileroControlIntegrity",
  "localAudioReflexAdvertised",
  "marginalSpikeHandledByReflex",
  "acousticReflexShadowPcm",
  "stoppedOnBargeIn",
  "localAudioReflexPreservesBargeIn",
  "closedLoopPcmBargeIn",
  "browserRenderPathStoppedOnBargeIn",
  "noAudioPipelineErrors",
  "noBrowserErrors"
]);

function approximate(left, right, epsilon = 1e-12) {
  return Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= epsilon;
}

function outputProbabilities(decision) {
  return Object.fromEntries(
    (decision.outputs ?? []).map((output) => [
      output.intent,
      output.payload?.probability
    ])
  );
}

export function replayAcousticReflexShadowTrace(bundle, checkpoint) {
  const validation = validateTrainingTraceBundle(bundle);
  const steps = [];
  const errors = [...validation.errors];
  if (!validation.valid) {
    return { exact: false, validation, steps, errors };
  }
  for (const decision of bundle.decisions) {
    const event = bundle.events.find(
      (candidate) => candidate.eventId === decision.triggeredBy?.[0]
    );
    const context = bundle.contexts.find(
      (candidate) => candidate.contextId === decision.decisionContextRef
    );
    const label = bundle.labels.find(
      (candidate) => candidate.targetId === decision.decisionId
    );
    const stepErrors = [];
    let prediction = null;
    let teacher = null;
    let transition = null;
    try {
      const previous = context?.state?.localAudioReflex;
      const reflexEvent = event?.payload?.reflexEvent;
      transition = reduceLocalAudioReflex(previous, reflexEvent);
      teacher = acousticReflexTeacherLabel(
        previous,
        reflexEvent,
        transition
      );
      prediction = predictAcousticReflex(
        checkpoint,
        previous,
        reflexEvent
      );
      if (teacher === null) {
        stepErrors.push("evento gravado não produz rótulo causal");
      }
      if (decision.proposal !== prediction.proposal) {
        stepErrors.push("proposta diverge do checkpoint");
      }
      const observedProbabilities = outputProbabilities(decision);
      for (const intent of ACOUSTIC_REFLEX_CLASSES) {
        if (!approximate(
          observedProbabilities[intent],
          prediction.probabilities[intent]
        )) {
          stepErrors.push(`probabilidade de ${intent} diverge`);
        }
      }
      if (!isDeepStrictEqual(
        context?.state?.features?.values,
        [...prediction.features.values]
      )) {
        stepErrors.push("features gravadas divergem do extrator");
      }
      if (label?.value !== teacher) {
        stepErrors.push("rótulo gravado diverge do reducer");
      }
      if (
        decision.transition?.teacherReason !== transition.reason ||
        decision.transition?.teacherPreviousStateVersion !==
          transition.previousStateVersion ||
        decision.transition?.teacherStateVersion !== transition.state.version
      ) {
        stepErrors.push("transição teacher diverge do reducer");
      }
      if (
        decision.policy?.mode !== "shadow" ||
        decision.authorityDecision !== "OBSERVE_ONLY"
      ) {
        stepErrors.push("candidato recebeu autoridade");
      }
      if (
        event.atMs !== context.availableAt.atMs ||
        context.availableAt.atMs !== decision.atMs
      ) {
        stepErrors.push("snapshot causal não coincide com a decisão");
      }
    } catch (error) {
      stepErrors.push(error.message);
    }
    const step = {
      decisionId: decision.decisionId,
      eventId: event?.eventId ?? null,
      proposal: prediction?.proposal ?? null,
      teacher,
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
    validation,
    steps,
    errors
  };
}

function assessOnlineCase(label, snapshot, checkpoint) {
  const bundle = snapshot?.reflexTrainingTrace;
  const replay = replayAcousticReflexShadowTrace(bundle, checkpoint);
  const decisions = bundle?.decisions ?? [];
  const labels = bundle?.labels ?? [];
  const events = bundle?.events ?? [];
  const streams = bundle?.streams ?? [];
  const positionsBound =
    events.length > 0 &&
    events.every((event) => {
      const stream = streams.find(
        (candidate) =>
          candidate.streamId === event.audioPosition?.streamId
      );
      return stream &&
        event.audioPosition.sampleStart >= 0 &&
        event.audioPosition.sampleEnd > event.audioPosition.sampleStart &&
        event.audioPosition.sampleEnd <= stream.sampleCount;
    });
  return {
    label,
    present: snapshot !== null && snapshot !== undefined,
    validation: replay.validation,
    replay,
    positionsBound,
    decisions: decisions.length,
    proposals: [...new Set(decisions.map((decision) => decision.proposal))],
    labels: [...new Set(labels.map((entry) => entry.value))],
    shadowOnly: decisions.length > 0 && decisions.every(
      (decision) =>
        decision.policy?.mode === "shadow" &&
        decision.authorityDecision === "OBSERVE_ONLY"
    ),
    effects: bundle?.effects?.length ?? null,
    modelBound:
      snapshot?.audio?.acousticReflexShadow?.modelSha256 ===
        checkpoint.modelSha256 &&
      decisions.every(
        (decision) =>
          decision.policy?.version ===
          `checkpoint-${checkpoint.modelSha256}`
      ),
    inferenceP95Ms:
      snapshot?.audio?.acousticReflexShadow?.inferenceMs?.p95 ?? null,
    agreementRate:
      snapshot?.audio?.acousticReflexShadow?.agreementRate ?? null,
    trainingTrace: bundle
  };
}

export function evaluateExp0014(input) {
  const {
    browser,
    checkpoint,
    dataset,
    fingerprints,
    health,
    offline
  } = input;
  const onlineCases = [
    assessOnlineCase(
      "marginal-continue",
      browser?.acousticReflexShadowPcm,
      checkpoint
    ),
    assessOnlineCase("sustained-pause", browser?.bargeIn, checkpoint)
  ];
  const onlineLabels = new Set(
    onlineCases.flatMap((entry) => entry.labels)
  );
  const marginalDatasetStream = dataset.streams.find(
    (stream) =>
      stream.family === "interrupcao" &&
      stream.rate === 1 &&
      stream.variant === "marginal"
  );
  const marginalOnlineStream = onlineCases[0]
    .trainingTrace?.streams?.find(
      (stream) => stream.role === "user-input-fixture"
    );
  const runtimeHash = health?.process?.runtimeFingerprint?.sha256 ?? null;
  const configHash = runtimeHash === null ? null : `sha256:${runtimeHash}`;
  const gates = {
    offlinePipeline:
      offline?.pass === true &&
      Object.values(offline.gates ?? {}).every(Boolean),
    datasetCheckpointBound:
      dataset.datasetSha256 === checkpoint.training?.datasetSha256 &&
      dataset.datasetSha256 === offline?.dataset?.sha256,
    familySplitDisjoint: offline?.gates?.familySplitDisjoint === true,
    holdoutExcludedFromFit: offline?.gates?.holdoutExcludedFromFit === true,
    checkpointReproducible:
      offline?.reproducibility?.repeatedTrainingEqual === true,
    offlineAllClasses:
      offline?.gates?.allClassesInEverySplit === true &&
      offline?.gates?.splitMetricsPass === true,
    browserRegression:
      REQUIRED_BROWSER_GATES.every((gate) => browser?.gates?.[gate] === true),
    onlineTraceValid:
      onlineCases.every((entry) => entry.validation.valid),
    onlineReplayExact: onlineCases.every((entry) => entry.replay.exact),
    onlineClassesCovered: ACOUSTIC_REFLEX_CLASSES.every(
      (label) => onlineLabels.has(label)
    ),
    audioPositionsBound:
      onlineCases.every((entry) => entry.positionsBound),
    exactMarginalMediaBound:
      marginalDatasetStream !== undefined &&
      marginalOnlineStream?.sha256 ===
        `sha256:${marginalDatasetStream.sha256}` &&
      marginalOnlineStream?.sampleCount ===
        marginalDatasetStream.sampleCount,
    shadowCannotAct:
      onlineCases.every(
        (entry) => entry.shadowOnly && entry.effects === 0
      ),
    checkpointOnlineBound:
      onlineCases.every((entry) => entry.modelBound),
    onlineAgreement:
      onlineCases.every((entry) => entry.agreementRate === 1),
    inferenceBudget:
      onlineCases.every(
        (entry) =>
          Number.isFinite(entry.inferenceP95Ms) &&
          entry.inferenceP95Ms <=
            input.config.gates.maximumBrowserInferenceP95Ms
      ),
    sourceFingerprintBound:
      browser?.sourceFingerprint?.sha256 === fingerprints.campaign.sha256 &&
      runtimeHash === fingerprints.runtime.sha256 &&
      onlineCases.every(
        (entry) => entry.trainingTrace?.session?.configHash === configHash
      ),
    noPaidApi:
      health?.brain === "local" && health?.usage?.requests === 0
  };
  const pass = Object.values(gates).every(Boolean);
  const physicalGateNames = [
    "physicalMicrophoneCapture",
    "noSelfInterruptionUnderDeviceAec",
    "longSessionNoFalseActivation",
    "sileroShadowAssistantOnlySpecificity",
    "potentialBargeInRecovery"
  ];
  const failedPhysicalGates = physicalGateNames.filter(
    (gate) => browser?.gates?.[gate] !== true
  );
  return {
    schemaVersion: "exp-0014-acoustic-reflex-m4a-report-v1",
    experimentId: input.config.id,
    pass,
    decision: pass
      ? "promote-m4a-acoustic-shadow-infrastructure"
      : "hold-m4a-acoustic-shadow-infrastructure",
    gates,
    metrics: {
      datasetExamples: dataset.examples.length,
      datasetStreams: dataset.streams.length,
      trainAccuracy: offline.metrics.train.accuracy,
      developmentAccuracy: offline.metrics.development.accuracy,
      holdoutAccuracy: offline.metrics.holdout.accuracy,
      onlineDecisions: onlineCases.reduce(
        (sum, entry) => sum + entry.decisions,
        0
      ),
      onlineLabels: [...onlineLabels].sort(),
      onlineInferenceP95Ms: Math.max(
        ...onlineCases.map((entry) => entry.inferenceP95Ms)
      ),
      browserRenderStopMs: browser?.bargeIn?.metrics?.stopRenderedMs ?? null,
      pcmOnsetToBrowserRenderStopMs:
        browser?.bargeIn?.closedLoop?.speechOnsetToLastRenderMs ?? null
    },
    evidence: {
      dataset: {
        id: dataset.datasetId,
        sha256: dataset.datasetSha256,
        splits: dataset.splits,
        retention: dataset.retention
      },
      checkpoint: {
        id: checkpoint.checkpointId,
        modelSha256: checkpoint.modelSha256,
        training: checkpoint.training,
        authority: checkpoint.authority
      },
      offline,
      onlineCases,
      browser: {
        runNonce: browser.runNonce,
        globalOk: browser.ok,
        sourceFingerprint: browser.sourceFingerprint,
        gates: browser.gates,
        thresholds: browser.thresholds,
        physicalBoundary: {
          classification: failedPhysicalGates.length === 0
            ? "current-device-window-green"
            : "hold-unlabelled-activity",
          pass: failedPhysicalGates.length === 0,
          failedGates: failedPhysicalGates,
          unexpectedUserSpeechEvents:
            browser?.microphoneCapture?.falseActivationProbe
              ?.unexpectedUserSpeechEvents ?? null,
          confirmedPotentialBargeIns:
            browser?.microphoneCapture?.falseActivationProbe
              ?.confirmedPotentialBargeIns ?? null,
          affectsM4aDecision: false,
          reason:
            "eventos do microfone chegam ao VAD antes da inferência shadow; sem rótulo/loopback não atribuem causalidade ao checkpoint"
        }
      },
      health: {
        runId: health.process?.runId ?? null,
        runtimeFingerprint: health.process?.runtimeFingerprint ?? null,
        brain: health.brain,
        usage: health.usage
      },
      fingerprints
    },
    interpretation: {
      promoted:
        "pipeline dados→treino→checkpoint→inferência online→trace→replay para WAIT/PAUSE/CONTINUE, em shadow e sem efeitos",
      notPromoted:
        "ganho sobre a regra, preferência humana, generalização acústica, autoridade do checkpoint, especificidade física ou prontidão de produto",
      holdoutMeaning:
        "famílias não usadas no ajuste testam vazamento estrutural; os rótulos ainda imitam a mesma regra determinística"
    },
    limitations: [
      "O modelo aprende rótulos da política atual; 100% no holdout não significa qualidade humana.",
      "Os WAV/PCM pesados continuam fora do Git; features, receitas e hashes versionados reproduzem o checkpoint.",
      "A prova online atravessa PCM, transporte, Silero e Chrome, mas não microfone humano ou sala.",
      "Atividade física não rotulada permanece visível como hold separado e não é atribuída ao shadow.",
      "M4a não autoriza o candidato a pausar ou retomar áudio."
    ],
    paidApiCalls: health?.usage?.requests ?? null
  };
}

export { REQUIRED_BROWSER_GATES };
