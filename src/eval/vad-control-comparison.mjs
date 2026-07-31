function check(id, pass, detail) {
  return { id, pass: Boolean(pass), detail };
}

function probe(report) {
  return report?.microphoneCapture?.falseActivationProbe ?? {};
}

export function compareVadControlCandidate(input) {
  const {
    baseline,
    browserCampaign = null,
    candidate,
    liveCampaign = null,
    offline,
    onsetWindows = 1,
    threshold = 0.85
  } = input;
  if (!Number.isFinite(threshold)) {
    throw new TypeError("threshold do candidato precisa ser numérico");
  }
  if (!Number.isSafeInteger(onsetWindows) || onsetWindows < 1) {
    throw new TypeError("onsetWindows do candidato precisa ser positivo");
  }
  const policyId = `silero-${threshold}-${onsetWindows}`;
  const policy = offline?.aggregate?.policies?.find(
    (item) => item.policy === policyId
  );
  const lowGain = policy?.speechByGain?.["0.125"];
  const baselineProbe = probe(baseline);
  const candidateProbe = probe(candidate);
  const candidateGates = Object.values(candidate?.gates ?? {});
  const requiredCandidateGates = [
    "sileroControlIntegrity",
    "audioDrainedThroughWatermark",
    "sileroShadowIntegrity",
    "longSessionNoFalseActivation",
    "delegatedTaskCancelled",
    "delegatedTaskSurvivesConversation",
    "noAudioPipelineErrors"
  ];
  const candidateControl = candidateProbe.vadControl;
  const drainedControl = candidateProbe.drain?.server?.vadControl;
  const drainedWatermark = candidateProbe.drain?.server?.watermark;
  const expectedSource = candidate?.sourceFingerprint?.sha256;
  const liveShortCases = new Map(
    (liveCampaign?.cases ?? [])
      .filter((item) => item.category?.startsWith("short-soft"))
      .map((item) => [item.id, item])
  );
  const checks = [
    check(
      "offline-low-gain-recall",
      lowGain?.observations >= 12 && lowGain?.recall === 1,
      `${lowGain?.detected ?? 0}/${lowGain?.observations ?? 0}`
    ),
    check(
      "offline-control-specificity",
      policy?.controlObservations >= 4 &&
        policy?.falsePositives === 0 &&
        policy?.controlSpecificity === 1,
      `${policy?.falsePositives ?? "?"} falsos em ` +
        `${policy?.controlObservations ?? 0} controles`
    ),
    check(
      "offline-source-fingerprint",
      Boolean(expectedSource) &&
        offline?.sourceFingerprint?.sha256 === expectedSource,
      `offline=${offline?.sourceFingerprint?.sha256 ?? "?"}; ` +
        `candidato=${expectedSource ?? "?"}`
    ),
    check(
      "matched-duration-long-session",
      baselineProbe.observedDurationMs >= 599_750 &&
        candidateProbe.observedDurationMs >= 599_750,
      `baseline=${baselineProbe.observedDurationMs ?? 0} ms; ` +
        `candidato=${candidateProbe.observedDurationMs ?? 0} ms`
    ),
    check(
      "fewer-false-activations",
      Number.isFinite(baselineProbe.unexpectedUserSpeechEvents) &&
        baselineProbe.unexpectedUserSpeechEvents > 0 &&
        candidateProbe.unexpectedUserSpeechEvents === 0,
      `baseline=${baselineProbe.unexpectedUserSpeechEvents ?? "?"}; ` +
        `candidato=${candidateProbe.unexpectedUserSpeechEvents ?? "?"}`
    ),
    check(
      "candidate-browser-gates",
      candidate?.schemaVersion >= 2 &&
      candidate?.ok === true &&
        candidateGates.length > 0 &&
        candidateGates.every(Boolean) &&
        requiredCandidateGates.every(
          (name) => candidate?.gates?.[name] === true
        ),
      `schema=${candidate?.schemaVersion ?? "?"}; ` +
        `${candidateGates.filter(Boolean).length}/` +
        `${candidateGates.length}; obrigatórios=` +
        `${requiredCandidateGates.filter(
          (name) => candidate?.gates?.[name] === true
        ).length}/${requiredCandidateGates.length}`
    ),
    check(
      "candidate-control-provenance-and-drain",
      candidateControl?.health?.engine === "silero-vad" &&
        candidateControl.health.threshold === threshold &&
        candidateControl.health.onsetWindows === onsetWindows &&
        candidateControl.telemetry?.inferenceErrorCount === 0 &&
        drainedControl?.health?.engine === "silero-vad" &&
        drainedControl.health.threshold === threshold &&
        drainedControl.health.onsetWindows === onsetWindows &&
        drainedControl.telemetry?.inferenceErrorCount === 0 &&
        drainedControl.telemetry?.lastProcessedSampleEnd >=
          drainedWatermark?.expectedFullWindowEnd,
      `engine=${candidateControl?.health?.engine ?? "?"}; ` +
        `threshold=${candidateControl?.health?.threshold ?? "?"}; ` +
        `onsetWindows=${candidateControl?.health?.onsetWindows ?? "?"}; ` +
        `drenado=${drainedControl?.telemetry
          ?.lastProcessedSampleEnd ?? "?"}/` +
        `${drainedWatermark?.expectedFullWindowEnd ?? "?"}`
    ),
    check(
      "barge-in-render-budget",
      candidate?.bargeIn?.closedLoop
        ?.speechOnsetToLastRenderMs <= 250,
      `${candidate?.bargeIn?.closedLoop
        ?.speechOnsetToLastRenderMs ?? "?"} ms`
    ),
    check(
      "backchannel-recovery-budget",
      candidate?.realBackchannel?.recovery
        ?.speechEndToResumeMs <= 500,
      `${candidate?.realBackchannel?.recovery
        ?.speechEndToResumeMs ?? "?"} ms`
    ),
    check(
      "statistical-browser-campaign",
      browserCampaign?.pass === true &&
        browserCampaign?.summary?.validRuns >= 10 &&
        candidate?.sourceFingerprint?.sha256 &&
        candidate.sourceFingerprint.sha256 ===
          browserCampaign?.sourceFingerprint?.sha256,
      browserCampaign
        ? `${browserCampaign.summary?.validRuns ?? 0} execuções; ` +
          `pass=${browserCampaign.pass}; source=` +
          `${browserCampaign.sourceFingerprint?.sha256 ?? "?"}`
        : "campanha ainda não fornecida"
    ),
    check(
      "live-audio-operability-and-soft-speech",
      liveCampaign?.schemaVersion >= 2 &&
        liveCampaign?.sourceFingerprint?.sha256 === expectedSource &&
        liveCampaign?.gate?.operability?.pass === true &&
        liveCampaign?.candidate?.vad?.threshold === threshold &&
        liveCampaign?.candidate?.vad?.onsetWindows === onsetWindows &&
        liveCampaign?.gate?.summaries?.control?.detectedCases === 0 &&
        [
          "nao-curto-baixo",
          "espera-curto-baixo",
          "muda-terca-baixo"
        ].every((id) => {
          const item = liveShortCases.get(id);
          return (
            item?.eventCounts?.speechStarts === 1 &&
            item?.eventCounts?.finals === 1 &&
            item?.timing?.onsetDetectionMs <= 180 &&
            item?.transport?.audioDrainVerified === true
          );
        }),
      liveCampaign
        ? `operabilidade=${liveCampaign.gate?.operability?.pass}; ` +
          `source=${liveCampaign.sourceFingerprint?.sha256 ?? "?"}; ` +
          `curtas=${liveShortCases.size}/3`
        : "campanha live ainda não fornecida"
    )
  ];
  const pass = checks.every((item) => item.pass);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    experiment:
      `energy-vs-silero-${threshold}x${onsetWindows}-control`,
    decision: pass ? "engineering-promote" : "hold",
    pass,
    checks,
    measurements: {
      falseActivations: {
        baseline: baselineProbe.unexpectedUserSpeechEvents ?? null,
        candidate: candidateProbe.unexpectedUserSpeechEvents ?? null
      },
      candidate: {
        bargeInPcmOnsetToLastRenderMs:
          candidate?.bargeIn?.closedLoop
            ?.speechOnsetToLastRenderMs ?? null,
        backchannelSpeechEndToResumeMs:
          candidate?.realBackchannel?.recovery
            ?.speechEndToResumeMs ?? null,
        correctionWer:
          candidate?.longCorrection?.transcript?.wer ?? null
      },
      offline: {
        lowGainRecall: lowGain?.recall ?? null,
        controlSpecificity: policy?.controlSpecificity ?? null
      }
    },
    userFacingReadiness: {
      decision: "hold",
      blockers: [
        "sessão física não garante que o alto-falante estava audível",
        "cauda do alto-falante e da sala ainda não foi medida",
        "preferência e conforto ainda não passaram por A/B humano"
      ]
    }
  };
}
