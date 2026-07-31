function round(value, places = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function finite(values) {
  return values.filter(Number.isFinite);
}

export function percentile(values, ratio) {
  const ordered = finite(values).sort((left, right) => left - right);
  if (ordered.length === 0) {
    return null;
  }
  return ordered[
    Math.max(0, Math.ceil(ordered.length * ratio) - 1)
  ];
}

function distribution(values) {
  const samples = finite(values);
  return {
    n: samples.length,
    p50: round(percentile(samples, 0.5)),
    p95: round(percentile(samples, 0.95)),
    p99: round(percentile(samples, 0.99)),
    max: samples.length === 0
      ? null
      : round(Math.max(...samples))
  };
}

function passRate(values) {
  if (values.length === 0) {
    return 0;
  }
  return round(
    values.filter(Boolean).length / values.length,
    4
  );
}

function captureCoverage(report) {
  const probe = report.microphoneCapture?.falseActivationProbe;
  if (
    !Number.isFinite(probe?.captureFramesDuringProbe) ||
    !Number.isFinite(
      probe?.requestedDurationMs ?? probe?.observedDurationMs
    ) ||
    (probe.requestedDurationMs ?? probe.observedDurationMs) <= 0
  ) {
    return null;
  }
  return probe.captureFramesDuringProbe /
    ((probe.requestedDurationMs ?? probe.observedDurationMs) / 20);
}

export function extractBrowserPerceptionRun(report, index = 0) {
  const probe = report.microphoneCapture?.falseActivationProbe ?? {};
  const shadow = probe.vadShadow ?? {};
  const serverPipeline = probe.drain?.server?.pipeline ?? {};
  const fixtureFingerprint = Object.values(report.fixtures ?? {})
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort()
    .join(":");
  return {
    index,
    generatedAt: report.generatedAt ?? null,
    sourceFingerprint:
      report.sourceFingerprint?.sha256 ?? null,
    fixtureFingerprint: fixtureFingerprint || null,
    ok: report.ok === true,
    gateCount: Object.keys(report.gates ?? {}).length,
    passedGates: Object.values(report.gates ?? {})
      .filter(Boolean).length,
    failedGates: Object.entries(report.gates ?? {})
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    response: {
      simpleFirstAudioMs:
        report.directTurn?.metrics?.responseStartMs ?? null,
      localPcmEndToVoiceMs:
        report.localAudio?.metrics?.responseStartMs ?? null,
      localPcmAfterEndpointMs:
        report.localAudio?.metrics?.responseAfterEndpointMs ?? null
    },
    bargeIn: {
      pcmOnsetToLastRenderMs:
        report.bargeIn?.closedLoop?.speechOnsetToLastRenderMs ??
        null,
      stopCommandMs:
        report.bargeIn?.metrics?.stopCommandMs ?? null,
      stopRenderedMs:
        report.bargeIn?.metrics?.stopRenderedMs ?? null,
      responseAfterEndpointMs:
        report.bargeIn?.metrics?.responseAfterEndpointMs ?? null
    },
    backchannel: {
      pauseToResumeMs:
        report.realBackchannel?.recovery?.pauseToResumeMs ?? null,
      speechEndToResumeMs:
        report.realBackchannel?.recovery
          ?.speechEndToResumeMs ?? null
    },
    correction: {
      endToVoiceMs:
        report.longCorrection?.completed?.metrics
          ?.responseStartMs ?? null,
      responseAfterEndpointMs:
        report.longCorrection?.completed?.metrics
          ?.responseAfterEndpointMs ?? null,
      wer: report.longCorrection?.transcript?.wer ?? null,
      committedTurns:
        report.longCorrection?.completed?.trace?.filter(
          (event) => event.type === "turn.committed"
        ).length ?? null
    },
    capture: {
      durationMs: probe.observedDurationMs ?? null,
      coverage: round(captureCoverage(report), 6),
      clockRealtimeRatio:
        report.microphoneCapture?.audio?.capture?.clock
          ?.realtimeRatio ?? null,
      maxFrameArrivalGapMs:
        probe.captureContinuity?.maxFrameArrivalGapMs ?? null,
      unexpectedUserSpeechEvents:
        probe.unexpectedUserSpeechEvents ?? null,
      integrityErrors: Object.values(
        probe.captureIntegrity ?? {}
      ).reduce(
        (sum, value) =>
          sum + (Number.isFinite(value) ? value : 0),
        0
      )
    },
    shadow: {
      windows: shadow.windowsDuringProbe ?? null,
      falseStarts: shadow.startsDuringProbe ?? null,
      resets: shadow.resetsDuringProbe ?? null,
      errors: shadow.errorsDuringProbe ?? null,
      inferenceP95Ms:
        shadow.telemetry?.inferenceMs?.p95 ?? null,
      inferenceP99Ms:
        shadow.telemetry?.inferenceMs?.p99 ?? null,
      queueDelayP99Ms:
        shadow.telemetry?.queueDelayMs?.p99 ?? null
    },
    vadControl: {
      engine: probe.vadControl?.health?.engine ??
        report.microphoneCapture?.audio?.vadControl?.engine ??
        "adaptive-energy-vad",
      windows: probe.vadControl?.windowsDuringProbe ?? null,
      gapResetCount:
        probe.vadControl?.telemetry?.gapResetCount ?? null,
      inferenceErrorCount:
        probe.vadControl?.telemetry?.inferenceErrorCount ?? null,
      inferenceP95Ms:
        probe.vadControl?.telemetry?.inferenceMs?.p95 ?? null,
      inferenceP99Ms:
        probe.vadControl?.telemetry?.inferenceMs?.p99 ?? null,
      threshold: probe.vadControl?.health?.threshold ?? null,
      onsetWindows: probe.vadControl?.health?.onsetWindows ?? null,
      modelSha256: probe.vadControl?.health?.sha256 ?? null
    },
    serverPipeline: {
      maximumPendingFrames:
        serverPipeline.maximumPendingFrames ?? null,
      overflowCount: serverPipeline.overflowCount ?? null,
      processingErrorCount:
        serverPipeline.processingErrorCount ?? null,
      queueDelayP99Ms:
        serverPipeline.queueDelayMs?.p99 ?? null
    }
  };
}

function allFiniteBelow(values, limit) {
  return values.length > 0 &&
    values.every(
      (value) => Number.isFinite(value) && value <= limit
    );
}

export function aggregateBrowserPerceptionReports(
  reports,
  options = {}
) {
  const minimumRuns = options.minimumRuns ?? 10;
  const requestedRuns = options.requestedRuns ?? reports.length;
  const runnerFailures = options.runnerFailures ?? [];
  const runs = reports.map(extractBrowserPerceptionRun);
  const metric = (read) => distribution(runs.map(read));
  const everyRun = (predicate) =>
    runs.length > 0 && runs.every(predicate);

  const metrics = {
    simpleFirstAudioMs: metric(
      (run) => run.response.simpleFirstAudioMs
    ),
    localPcmEndToVoiceMs: metric(
      (run) => run.response.localPcmEndToVoiceMs
    ),
    localPcmAfterEndpointMs: metric(
      (run) => run.response.localPcmAfterEndpointMs
    ),
    pcmOnsetToLastRenderMs: metric(
      (run) => run.bargeIn.pcmOnsetToLastRenderMs
    ),
    stopCommandMs: metric(
      (run) => run.bargeIn.stopCommandMs
    ),
    backchannelSpeechEndToResumeMs: metric(
      (run) => run.backchannel.speechEndToResumeMs
    ),
    correctionEndToVoiceMs: metric(
      (run) => run.correction.endToVoiceMs
    ),
    correctionAfterEndpointMs: metric(
      (run) => run.correction.responseAfterEndpointMs
    ),
    correctionWer: metric((run) => run.correction.wer),
    captureCoverage: metric((run) => run.capture.coverage),
    captureClockRealtimeRatio: metric(
      (run) => run.capture.clockRealtimeRatio
    ),
    shadowInferenceP99Ms: metric(
      (run) => run.shadow.inferenceP99Ms
    ),
    shadowInferenceP95Ms: metric(
      (run) => run.shadow.inferenceP95Ms
    ),
    shadowQueueDelayP99Ms: metric(
      (run) => run.shadow.queueDelayP99Ms
    ),
    vadControlInferenceP99Ms: metric(
      (run) => run.vadControl.inferenceP99Ms
    ),
    vadControlInferenceP95Ms: metric(
      (run) => run.vadControl.inferenceP95Ms
    ),
    serverPipelineQueueDelayP99Ms: metric(
      (run) => run.serverPipeline.queueDelayP99Ms
    )
  };
  const usesSileroControl = runs.some(
    (run) => run.vadControl.engine === "silero-vad"
  );
  const sourceFingerprints = new Set(
    runs.map((run) => run.sourceFingerprint).filter(Boolean)
  );
  const fixtureFingerprints = new Set(
    runs.map((run) => run.fixtureFingerprint).filter(Boolean)
  );
  const controlPolicies = new Set(
    runs
      .filter((run) => run.vadControl.engine === "silero-vad")
      .map(
        (run) =>
          `${run.vadControl.modelSha256}:` +
          `${run.vadControl.threshold}:` +
          `${run.vadControl.onsetWindows}`
      )
  );

  const checks = [
    {
      id: "sample-size",
      pass:
        runs.length >= minimumRuns &&
        runs.length === requestedRuns &&
        runnerFailures.length === 0,
      detail:
        `${runs.length}/${requestedRuns} execuções válidas; ` +
        `mínimo ${minimumRuns}`
    },
    {
      id: "same-source-fingerprint",
      pass:
        runs.length > 0 &&
        runs.every((run) => Boolean(run.sourceFingerprint)) &&
        sourceFingerprints.size === 1,
      detail:
        `${sourceFingerprints.size} fingerprint(s) em ` +
        `${runs.length} execuções`
    },
    {
      id: "same-evidence-fixtures",
      pass:
        runs.length > 0 &&
        runs.every((run) => Boolean(run.fixtureFingerprint)) &&
        fixtureFingerprints.size === 1,
      detail:
        `${fixtureFingerprints.size} conjunto(s) em ` +
        `${runs.length} execuções`
    },
    {
      id: "all-browser-gates",
      pass: everyRun((run) => run.ok),
      detail: `${runs.filter((run) => run.ok).length}/${runs.length}`
    },
    {
      id: "simple-first-audio-p95",
      pass:
        metrics.simpleFirstAudioMs.p95 !== null &&
        metrics.simpleFirstAudioMs.p95 <= 1_200,
      detail: `${metrics.simpleFirstAudioMs.p95} ms ≤ 1200 ms`
    },
    {
      id: "barge-in-render-p95",
      pass:
        metrics.pcmOnsetToLastRenderMs.p95 !== null &&
        metrics.pcmOnsetToLastRenderMs.p95 <= 250,
      detail:
        `${metrics.pcmOnsetToLastRenderMs.p95} ms ≤ 250 ms`
    },
    {
      id: "backchannel-recovery-p95",
      pass:
        metrics.backchannelSpeechEndToResumeMs.p95 !== null &&
        metrics.backchannelSpeechEndToResumeMs.p95 <= 500,
      detail:
        `${metrics.backchannelSpeechEndToResumeMs.p95} ms ≤ 500 ms`
    },
    {
      id: "correction-coherence",
      pass:
        everyRun((run) => run.correction.committedTurns === 1) &&
        allFiniteBelow(
          runs.map((run) => run.correction.wer),
          0.5
        ),
      detail:
        `WER máx ${metrics.correctionWer.max}; ` +
        "um commit por execução"
    },
    {
      id: "capture-integrity",
      pass: everyRun(
        (run) =>
          run.capture.integrityErrors === 0 &&
          run.capture.unexpectedUserSpeechEvents === 0 &&
          run.capture.coverage >= 0.995 &&
          run.capture.coverage <= 1.02
      ),
      detail:
        `cobertura p50 ${metrics.captureCoverage.p50}; ` +
        "zero perda e falso corte"
    },
    {
      id: "silero-shadow-safety",
      pass: everyRun(
        (run) =>
          run.shadow.falseStarts === 0 &&
          run.shadow.resets === 0 &&
          run.shadow.errors === 0 &&
          run.shadow.inferenceP95Ms < 5 &&
          run.shadow.inferenceP99Ms < 20 &&
          run.shadow.queueDelayP99Ms < 10
      ),
      detail:
        `inferência p99 entre execuções ` +
        `${metrics.shadowInferenceP99Ms.max} ms`
    },
    {
      id: "silero-control-runtime",
      pass:
        !usesSileroControl ||
        everyRun(
          (run) =>
            run.vadControl.engine === "silero-vad" &&
            Number.isFinite(run.vadControl.threshold) &&
            Number.isSafeInteger(run.vadControl.onsetWindows) &&
            run.vadControl.onsetWindows >= 1 &&
            Boolean(run.vadControl.modelSha256) &&
            run.vadControl.gapResetCount === 0 &&
            run.vadControl.inferenceErrorCount === 0 &&
            run.vadControl.inferenceP95Ms < 5 &&
            run.vadControl.inferenceP99Ms < 20
        ) &&
        controlPolicies.size === 1,
      detail: usesSileroControl
        ? `inferência p99 máxima ` +
          `${metrics.vadControlInferenceP99Ms.max} ms; ` +
          `${controlPolicies.size} política(s)`
        : "controle permaneceu na baseline de energia"
    },
    {
      id: "server-audio-pipeline",
      pass: everyRun(
        (run) =>
          run.serverPipeline.overflowCount === 0 &&
          run.serverPipeline.processingErrorCount === 0 &&
          run.serverPipeline.maximumPendingFrames <= 8 &&
          run.serverPipeline.queueDelayP99Ms < 10
      ),
      detail:
        `fila p99 máxima ` +
        `${metrics.serverPipelineQueueDelayP99Ms.max} ms`
    }
  ];
  const pass = checks.every((check) => check.pass);

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: sourceFingerprints.size === 1
      ? { sha256: [...sourceFingerprints][0] }
      : null,
    fixtureFingerprint: fixtureFingerprints.size === 1
      ? { sha256Set: [...fixtureFingerprints][0] }
      : null,
    candidate: "browser-windows-chrome-local-silero-shadow",
    scope:
      "repetição estatística no renderer e transporte reais; " +
      "fala de teste PCM e sem cauda física do alto-falante/sala",
    pass,
    decision: pass ? "engineering-promote" : "hold",
    summary: {
      requestedRuns,
      validRuns: runs.length,
      minimumRuns,
      runPassRate: passRate(runs.map((run) => run.ok)),
      runnerFailures
    },
    thresholds: {
      simpleFirstAudioP95Ms: 1_200,
      pcmOnsetToLastRenderP95Ms: 250,
      backchannelSpeechEndToResumeP95Ms: 500,
      correctionMaximumWer: 0.5,
      vadInferenceP95PerRunMs: 5,
      vadInferenceP99PerRunMs: 20,
      shadowQueueDelayP99PerRunMs: 10
    },
    checks,
    metrics,
    failedGateFrequency: Object.fromEntries(
      [...new Set(runs.flatMap((run) => run.failedGates))]
        .sort()
        .map((name) => [
          name,
          runs.filter((run) =>
            run.failedGates.includes(name)
          ).length
        ])
    ),
    userFacingReadiness: {
      decision: "hold",
      blockers: [
        "parada acústica depois do alto-falante e da sala não medida",
        "naturalidade e conforto ainda sem A/B humano cego",
        "fixtures PCM não representam vários falantes e ambientes"
      ]
    },
    runs
  };
}
