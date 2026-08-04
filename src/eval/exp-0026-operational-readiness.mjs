import { canonicalSha256 } from "./factory/canonical-hash.mjs";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function evaluateExp0026AcousticQualification(observation) {
  invariant(
    observation?.schemaVersion === "exp-0026-acoustic-observation-v1",
    "observação acústica EXP-0026 inválida"
  );
  const capture = observation.capture ?? {};
  const gates = {
    isolatedWindowsChromeAndLiveMicrophone:
      observation.browser?.isolatedContext === true &&
      observation.browser?.secureOrigin === true &&
      observation.microphone?.permission === "granted" &&
      observation.microphone?.trackReadyState === "live" &&
      /^sha256:[a-f0-9]{64}$/u.test(
        observation.microphone?.deviceIdSha256 ?? ""
      ) &&
      Number.isFinite(observation.microphone?.sampleRate) &&
      observation.microphone.sampleRate > 0 &&
      Number.isSafeInteger(observation.microphone?.channelCount) &&
      observation.microphone.channelCount > 0,
    pcmContinuousAndObservable:
      Number.isSafeInteger(capture.receivedFrames) &&
      capture.receivedFrames > 0 &&
      capture.deliveredFrames > 0 &&
      capture.observedSequenceGaps === 0 &&
      capture.observedSampleGaps === 0 &&
      capture.protocolErrors === 0,
    fixedSpeechReachedAsr:
      observation.fixedSpeech?.speechStartObserved === true &&
      observation.fixedSpeech?.nonemptyFinalObserved === true,
    frozenTtsRendererAndPhysicalAudibility:
      observation.tts?.rendererStarted === true &&
      observation.tts?.rendererFinished === true &&
      observation.tts?.operatorAudibleAck === true &&
      observation.tts?.microphoneCaptureNonSilent === true,
    overlapRemainedObservable:
      observation.overlap?.captureAdvanced === true &&
      observation.overlap?.turnDecisionObserved === true,
    transientRecorderIntegrity:
      observation.recorder?.decodable === true &&
      observation.recorder?.rawDeleted === true &&
      Number.isFinite(observation.recorder?.durationMs) &&
      observation.recorder.durationMs > 0 &&
      Number.isFinite(observation.recorder?.rms) &&
      observation.recorder.rms > 0 &&
      Number.isSafeInteger(observation.recorder?.bytes) &&
      observation.recorder.bytes > 0 &&
      /^sha256:[a-f0-9]{64}$/u.test(observation.recorder?.sha256 ?? ""),
    frozenNoiseReachedPhysicalCapture:
      observation.noise?.artifactHashMatched === true &&
      observation.noise?.playedThroughPhysicalOutput === true &&
      Number.isFinite(observation.noise?.silenceRms) &&
      Number.isFinite(observation.noise?.noiseRms) &&
      observation.noise.noiseRms > observation.noise.silenceRms
  };
  const core = {
    schemaVersion: "exp-0026-acoustic-qualification-v1",
    experimentId: "EXP-0026",
    construct: "physical-chain-exists-and-is-observable",
    attemptId: observation.attemptId,
    observedAt: observation.observedAt,
    gates,
    scopeProtections: {
      asrContentOrCerGate: false,
      interruptionQualityGate: false,
      volumePreferenceGate: false,
      perceptualProductQualityGate: false,
      rawAudioPersisted: false,
      transcriptPersisted: false
    },
    limitations: [
      "uma estação e uma execução; não estima confiabilidade populacional",
      "audibilidade é confirmação binária do operador, não teste de naturalidade ou volume",
      "overlap prova observabilidade da cadeia, não acerto da política de interrupção"
    ],
    stationEvidence: {
      browserProduct: observation.browser?.product ?? null,
      microphone: {
        deviceIdSha256: observation.microphone?.deviceIdSha256 ?? null,
        sampleRate: observation.microphone?.sampleRate ?? null,
        channelCount: observation.microphone?.channelCount ?? null,
        echoCancellation: observation.microphone?.echoCancellation ?? null,
        noiseSuppression: observation.microphone?.noiseSuppression ?? null,
        autoGainControl: observation.microphone?.autoGainControl ?? null
      }
    }
  };
  const pass = Object.values(gates).every(Boolean);
  return {
    ...core,
    pass,
    decision: pass
      ? "PHYSICAL_CHAIN_QUALIFIED"
      : "PHYSICAL_CHAIN_NOT_QUALIFIED_TERMINAL",
    qualificationSha256: `sha256:${canonicalSha256({ ...core, pass })}`
  };
}

export function createExp0026OperationalReadinessReport(input) {
  invariant(input?.acoustic?.schemaVersion === "exp-0026-acoustic-qualification-v1", "qualificação acústica ausente");
  const automated = input.automated ?? {};
  const gates = {
    OQ_A_PHYSICAL_CHAIN:
      input.acoustic.pass === true &&
      automated.withinTerminalBudget === true,
    OQ_B_FROZEN_ANALYSIS:
      automated.frozenSignatureVocabulary === true &&
      automated.deterministicRanking === true &&
      automated.unknownRemainsUnattributed === true,
    OQ_C_WITHDRAWAL_AND_RETENTION:
      automated.postCompleteWithdrawal === true &&
      automated.postOpenReanalysis === true &&
      automated.postCloseoutArtifactInvalidation === true &&
      automated.retentionPurge === true,
    OQ_D_RESERVES:
      automated.exhaustiveDiversityValidation === true &&
      automated.administrativeOnlyReplacement === true &&
      automated.startedSessionRequiresWithdrawal === true &&
      automated.maximumTwoActivations === true
  };
  const pass = Object.values(gates).every(Boolean);
  const core = {
    schemaVersion: "exp-0026-operational-readiness-v1",
    experimentId: "EXP-0026",
    amendment: input.amendment,
    sourceCommit: input.sourceCommit,
    openingCommitment: input.openingCommitment,
    completedAt: input.completedAt,
    executionDisposition: input.executionDisposition ?? "COMPLETED",
    timebox: input.timebox,
    gates,
    acousticQualificationSha256: input.acoustic.qualificationSha256,
    automatedEvidence: input.automatedEvidence,
    pass,
    decision: pass
      ? "READY_TO_FREEZE_EXP_0026"
      : "NOT_READY_FOR_FREEZE_TERMINAL",
    limitations: input.acoustic.limitations,
    prohibitedScopeRemainedClosed: input.prohibitedScopeRemainedClosed === true
  };
  invariant(core.prohibitedScopeRemainedClosed, "frentes proibidas foram reabertas");
  return {
    ...core,
    reportSha256: `sha256:${canonicalSha256(core)}`
  };
}
