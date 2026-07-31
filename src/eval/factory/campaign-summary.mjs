function gate(status, detail = {}) {
  return {
    status,
    decision: status === "pass" ? "promote" : "hold",
    pass: status === "pass",
    ...detail
  };
}

function assertSame(actual, expected, label) {
  if (!actual || actual !== expected) {
    throw new TypeError(`${label} diverge do pack/build agregado`);
  }
}

function diagnosticsAreClean(report) {
  return [
    report?.diagnostics?.consoleErrors,
    report?.diagnostics?.runtimeErrors,
    report?.diagnostics?.httpErrors
  ].every((items) => Array.isArray(items) && items.length === 0);
}

const CURRENT_VALUE_CHECKS = new Set([
  "final-transcript-current",
  "final-semantic-state",
  "single-commit",
  "single-semantic-revision",
  "no-premature-main-speech",
  "causal-event-order",
  "assistant-confirms-current",
  "audible-confirms-current",
  "no-obsolete-delegation"
]);

const SEMANTIC_CHECKS = new Set([
  ...CURRENT_VALUE_CHECKS,
  "causal-rollback"
]);

function exactRequiredChecksPass(checks, required) {
  if (!Array.isArray(checks)) {
    return false;
  }
  const relevant = checks.filter((check) => required.has(check.id));
  return relevant.length === required.size &&
    new Set(relevant.map((check) => check.id)).size === required.size &&
    relevant.every((check) => check.status === "pass");
}

function rawSemanticPass(item) {
  const checks = item?.assessment?.checks;
  return item?.semanticPass === true &&
    exactRequiredChecksPass(checks, SEMANTIC_CHECKS) &&
    checks.find((check) => check.id === "no-obsolete-effect")?.status !==
      "fail" &&
    Array.isArray(item.browserErrors) && item.browserErrors.length === 0;
}

function rawCurrentValuePass(item) {
  return item?.currentValueSafetyPass === true &&
    exactRequiredChecksPass(
      item?.assessment?.checks,
      CURRENT_VALUE_CHECKS
    ) &&
    Array.isArray(item.browserErrors) && item.browserErrors.length === 0;
}

function rawRepairPass(item) {
  return item?.safeRepairPass === true &&
    item?.criticalConflict?.policy === "clarify-before-commit" &&
    Array.isArray(item.criticalConflict.alternatives) &&
    item.criticalConflict.alternatives.length === 2 &&
    item.criticalConflict.alternatives.every(Number.isFinite) &&
    item?.observation?.commitCount === 0 &&
    Array.isArray(item.trace) &&
    item.trace.some((event) => event.type === "assistant.clarification") &&
    item.trace.some((event) => {
      if (event.type !== "assistant.utterance.started") {
        return false;
      }
      try {
        return JSON.parse(event.detail)?.kind === "repair";
      } catch {
        return false;
      }
    });
}

function deriveBrowserEvidence(report, expectedCaseIds) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const expectedIds = Array.isArray(expectedCaseIds)
    ? [...expectedCaseIds].sort()
    : [];
  const actualIds = results.map((item) => item.id).sort();
  const complete =
    expectedIds.length > 0 &&
    expectedIds.length === actualIds.length &&
    new Set(actualIds).size === actualIds.length &&
    expectedIds.every((id, index) => id === actualIds[index]);
  const diagnosticsPass = diagnosticsAreClean(report);
  const semantic = results.map(rawSemanticPass);
  const safe = results.map(
    (item, index) =>
      item?.safeOutcomePass === true &&
      (semantic[index] || rawCurrentValuePass(item) || rawRepairPass(item))
  );
  const interruption = results.filter((item) =>
    ["barge-in", "cross-turn"].includes(item.timingPattern)
  );
  return {
    complete,
    diagnosticsPass,
    semanticPass:
      complete && diagnosticsPass && semantic.every(Boolean),
    criticalSafetyPass:
      complete && diagnosticsPass && safe.every(Boolean),
    renderStopPass:
      complete &&
      diagnosticsPass &&
      interruption.length > 0 &&
      interruption.every(
        (item) =>
          item.renderStopPass === true &&
          Number.isFinite(item.metrics?.stopRenderedMs) &&
          item.metrics.stopRenderedMs >= 0 &&
          item.metrics.stopRenderedMs <= 250
      ),
    semanticCases: semantic.filter(Boolean).length,
    safeCases: safe.filter(Boolean).length,
    interruptionCases: interruption.length
  };
}

function transportPass(transport) {
  return transport?.clientUnsentFrames === 0 &&
    transport?.serverLostFrames === 0 &&
    transport?.rejectedFrames === 0 &&
    transport?.protocolErrors === 0 &&
    transport?.audioDrainVerified === true;
}

function deriveLiveEvidence(
  report,
  expectedCaseIds,
  expectedSpeechCaseCount
) {
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  const expectedIds = Array.isArray(expectedCaseIds)
    ? [...expectedCaseIds].sort()
    : [];
  const actualIds = cases.map((item) => item.id).sort();
  const speech = cases.filter(
    (item) => item.expectSpeech !== false && item.cohort === "synthetic"
  );
  const controls = cases.filter((item) => item.expectSpeech === false);
  const complete =
    expectedIds.length > 0 &&
    expectedIds.length === actualIds.length &&
    new Set(actualIds).size === actualIds.length &&
    expectedIds.every((id, index) => id === actualIds[index]) &&
    speech.length === expectedSpeechCaseCount &&
    controls.length > 0;
  const speechOperable = speech.every(
    (item) =>
      item.eventCounts?.speechStarts >= 1 &&
      item.eventCounts?.endpoints >= 1 &&
      item.eventCounts?.finals >= 1 &&
      item.turnIntegrity?.coherentSingleTurn === true &&
      item.turnIntegrity?.prematureEndpoint !== true &&
      item.timing?.realtimeEvidence === true &&
      transportPass(item.transport)
  );
  const controlsSafe = controls.every(
    (item) =>
      item.eventCounts?.speechStarts === 0 &&
      item.eventCounts?.finals === 0 &&
      transportPass(item.transport)
  );
  const errors = speech.reduce(
    (sum, item) => sum + (item.transcript?.errors ?? Infinity),
    0
  );
  const expectedWords = speech.reduce(
    (sum, item) => sum + (item.transcript?.expectedWords ?? 0),
    0
  );
  const corpusWer = expectedWords > 0 ? errors / expectedWords : Infinity;
  const criticalRequired = speech.reduce(
    (sum, item) => sum + (item.criticalPhrases?.required?.length ?? 0),
    0
  );
  const criticalMatched = speech.reduce(
    (sum, item) => sum + (item.criticalPhrases?.matched?.length ?? 0),
    0
  );
  const criticalRecall = criticalRequired > 0
    ? criticalMatched / criticalRequired
    : 0;
  const fidelityPass =
    complete &&
    speech.every(
      (item) =>
        Number.isFinite(item.transcript?.wer) &&
        item.transcript.wer <= 0.5 &&
        item.criticalPhrases?.recall === 1
    ) &&
    corpusWer <= 0.25 &&
    criticalRecall === 1;
  return {
    complete,
    operabilityPass: complete && speechOperable && controlsSafe,
    fidelityPass,
    corpusWer,
    criticalRecall,
    speechCaseCount: speech.length
  };
}

function observedTranscriptFailures(report, source) {
  return (report?.cases ?? [])
    .filter(
      (item) =>
        item.expectSpeech !== false &&
        (
          item.criticalPhrases?.recall < 1 ||
          item.transcript?.wer > 0.5
        )
    )
    .map((item) => ({
      source,
      caseId: item.id,
      kind: "transcript-fidelity",
      finalTranscript: item.actual ?? null,
      criticalPhraseRecall: item.criticalPhrases?.recall ?? null,
      wer: item.transcript?.wer ?? null
    }));
}

function observedBrowserSafetyFailures(report, source) {
  return (report?.results ?? [])
    .filter(
      (item) =>
        item.safeOutcomePass !== true ||
        !(
          rawSemanticPass(item) ||
          rawCurrentValuePass(item) ||
          rawRepairPass(item)
        )
    )
    .map((item) => ({
      source,
      caseId: item.id,
      kind: "unsafe-current-value",
      finalTranscript: item.observation?.finalTranscript ?? null,
      semanticState: item.observation?.semanticState ?? null,
      commitCount: item.observation?.commitCount ?? null,
      failedChecks: (item.assessment?.checks ?? [])
        .filter((check) => check.status === "fail")
        .map((check) => check.id)
    }));
}

export function aggregateFactoryCampaign(input) {
  const {
    build,
    audio,
    acousticBuild,
    live,
    acousticLive,
    browserText,
    browserPcm,
    browserPcmNoise,
    expectedBrowserCaseIds,
    expectedLiveCaseIds,
    expectedAcousticCaseIds,
    integrity,
    inputArtifacts
  } = input;
  const packSha256 = build?.build?.packSha256;
  const buildSha256 = build?.build?.buildSha256;
  if (
    !Array.isArray(expectedBrowserCaseIds) ||
    expectedBrowserCaseIds.length !== build?.build?.browserCaseCount ||
    new Set(expectedBrowserCaseIds).size !== expectedBrowserCaseIds.length
  ) {
    throw new TypeError("IDs esperados do browser estão incompletos ou duplicados");
  }
  assertSame(audio?.sourcePack?.sha256, packSha256, "audio.sourcePack");
  assertSame(
    acousticBuild?.source?.packSha256,
    packSha256,
    "acousticBuild.source"
  );
  assertSame(
    browserText?.provenance?.sourcePackSha256,
    packSha256,
    "browserText.provenance"
  );
  assertSame(
    browserPcm?.provenance?.sourcePackSha256,
    packSha256,
    "browserPcm.provenance"
  );
  if (browserPcmNoise) {
    assertSame(
      browserPcmNoise.provenance?.sourcePackSha256,
      packSha256,
      "browserPcmNoise.provenance"
    );
  }
  if (
    !integrity ||
    Object.values(integrity).some((value) => value !== true)
  ) {
    throw new TypeError("integridade de um ou mais artefatos não foi provada");
  }

  const liveRaw = deriveLiveEvidence(
    live,
    expectedLiveCaseIds,
    build.build.liveAudioCaseCount
  );
  const acousticRaw = deriveLiveEvidence(
    acousticLive,
    expectedAcousticCaseIds,
    build.build.liveAudioCaseCount
  );
  const browserTextRaw = deriveBrowserEvidence(
    browserText,
    expectedBrowserCaseIds
  );
  const browserPcmRaw = deriveBrowserEvidence(
    browserPcm,
    expectedBrowserCaseIds
  );
  const browserNoiseRaw = browserPcmNoise
    ? deriveBrowserEvidence(browserPcmNoise, expectedBrowserCaseIds)
    : null;
  const liveTranscriptStatus =
    liveRaw.fidelityPass && acousticRaw.fidelityPass
      ? "pass"
      : "fail";
  const browserPcmResults = browserPcm?.results ?? [];
  const responseLatencies = browserPcmResults
    .map((item) => item.responseLatencyMs)
    .filter(Number.isFinite);
  const latencyViolations = responseLatencies.filter((value) => value > 1_200);
  const safeRepairs = browserPcmResults.filter(
    (item) => item.safeRepairPass === true
  );
  const browserNoiseResults = browserPcmNoise?.results ?? [];
  const allSafeRepairs = [
    ...safeRepairs,
    ...browserNoiseResults.filter((item) => item.safeRepairPass === true)
  ];
  const observedTranscriptFailureItems = [
    ...observedTranscriptFailures(live, "websocket-clean"),
    ...observedTranscriptFailures(acousticLive, "websocket-acoustic")
  ];
  const observedFailures = [
    ...observedTranscriptFailureItems,
    ...observedBrowserSafetyFailures(browserText, "browser-text"),
    ...observedBrowserSafetyFailures(browserPcm, "browser-pcm-clean"),
    ...observedBrowserSafetyFailures(browserPcmNoise, "browser-pcm-noise")
  ];
  const measuredExecutions = [
    live,
    acousticLive,
    browserText,
    browserPcm,
    ...(browserPcmNoise ? [browserPcmNoise] : [])
  ].map((report) => report.execution);
  if (
    measuredExecutions.some(
      (execution) =>
        !Number.isFinite(execution?.paidApiCalls) ||
        !Number.isFinite(execution?.requests) ||
        !Number.isFinite(execution?.totalTokens)
    )
  ) {
    throw new TypeError("telemetria de custo ausente em uma campanha");
  }
  const gates = {
    factoryToolchain: gate(
      build.gates.factoryIntegrity.pass &&
        build.coverage.pass &&
        build.oracleMutationAudit?.total > 0 &&
        build.oracleMutationAudit.killed === build.oracleMutationAudit.total
        ? "pass"
        : "fail",
      {
        cases: build.build.caseCount,
        mutationAudit: build.oracleMutationAudit
          ? {
              killed: build.oracleMutationAudit.killed,
              total: build.oracleMutationAudit.total
            }
          : null,
        pairwiseCoverage: build.coverage.pairwise.ratio
      }
    ),
    ttsFixtureIntegrity: gate(
      audio.gate.pass &&
        audio.entries?.length === build.build.liveAudioCaseCount &&
        new Set(audio.entries.map((item) => item.waveSha256)).size ===
          audio.entries.length
        ? "pass"
        : "fail",
      {
      cases: audio.summary.caseCount,
      uniqueWaves: audio.summary.uniqueWaveCount
      }
    ),
    acousticFixtureIntegrity: gate(
      acousticBuild.gate.pass &&
        acousticBuild.entries?.length > 0 &&
        acousticBuild.entries.every(
          (item) =>
            item.deterministic === true &&
            Object.values(item.checks ?? {}).every((value) => value === true)
        )
        ? "pass"
        : "fail",
      { scenes: acousticBuild.entries.length }
    ),
    pcmPipelineOperability: gate(
      liveRaw.operabilityPass && acousticRaw.operabilityPass
        ? "pass"
        : "fail",
      {
        clean: liveRaw.operabilityPass ? "promote" : "hold",
        acoustic: acousticRaw.operabilityPass ? "promote" : "hold"
      }
    ),
    websocketTranscriptFidelity: gate(liveTranscriptStatus, {
      observedFailureCount: observedTranscriptFailureItems.length,
      cleanCriticalRecall:
        liveRaw.criticalRecall,
      acousticCriticalRecall:
        acousticRaw.criticalRecall
    }),
    browserTextSemanticCorrection: gate(
      browserTextRaw.semanticPass ? "pass" : "fail",
      { cases: browserText.results.length }
    ),
    browserPcmSemanticCompletion: gate(
      browserPcmRaw.semanticPass ? "pass" : "hold",
      {
        completedCases: browserPcmRaw.semanticCases,
        requiredCases: browserPcmResults.length,
        safeRepairs: safeRepairs.length
      }
    ),
    criticalSlotSafety: gate(
      browserPcmRaw.criticalSafetyPass ? "pass" : "fail",
      { safeRepairCaseIds: safeRepairs.map((item) => item.id) }
    ),
    browserNoiseCurrentValueSafety: gate(
      browserPcmNoise
        ? browserNoiseRaw.criticalSafetyPass
          ? "pass"
          : "fail"
        : "not_run",
      {
        cases: browserNoiseResults.length,
        strictSemanticCases: browserNoiseRaw?.semanticCases ?? 0,
        currentValueSafeCases: browserNoiseRaw?.safeCases ?? 0
      }
    ),
    browserRenderStop: gate(
      browserPcmRaw.renderStopPass ? "pass" : "fail",
      {
        measuredCases: browserPcmRaw.interruptionCases,
        maximumMs: Math.max(
          ...browserPcmResults
            .map((item) => item.metrics?.stopRenderedMs)
            .filter(Number.isFinite),
          0
        )
      }
    ),
    responsiveness: gate("hold", {
      reason: "amostra menor que 20; p95 promocional não é publicado",
      measuredCases: responseLatencies.length,
      budgetMs: 1_200,
      observedBudgetViolations: latencyViolations
    }),
    temporalPatternFidelity: gate("hold", {
      reason:
        "pausas físicas e cross-turn dependente de memória ainda não correspondem a todos os rótulos"
    }),
    downstreamEffectFidelity: gate("hold", {
      reason: "nenhum ledger/adaptador de efeito externo foi instrumentado"
    }),
    holdoutIndependence: gate("hold", {
      reason: "holdout v0.2 foi exposto durante o PDCA e não é evidência independente"
    }),
    acousticDiversity: gate("hold", {
      reason: "ganho e ruído foram cobertos, mas a voz sintética ainda é apenas Maria"
    }),
    humanValidity: gate("hold", {
      reason: "julgamento humano fica para depois da vertical funcional"
    })
  };
  return {
    schemaVersion: 1,
    id: "eval-factory-campaign-v0.2",
    generatedAt: new Date().toISOString(),
    subject: {
      packId: build.build.packId,
      packSha256,
      buildSha256
    },
    inputs: inputArtifacts,
    integrity,
    derivedEvidence: {
      live: liveRaw,
      acousticLive: acousticRaw,
      browserText: browserTextRaw,
      browserPcm: browserPcmRaw,
      browserPcmNoise: browserNoiseRaw
    },
    gates,
    decisions: {
      factoryToolchain: gates.factoryToolchain.pass ? "promote" : "hold",
      runtimeEngineering: "hold",
      userFacingReadiness: "hold"
    },
    observedFailures,
    observedSafeRepairs: allSafeRepairs.map((item) => ({
      caseId: item.id,
      conflict: item.criticalConflict,
      expectedAlternativeObserved:
        item.repairExpectedAlternativePass === true,
      assistantText: item.assistantText,
      committed: false
    })),
    honestHolds: Object.entries(gates)
      .filter(([, value]) => value.decision === "hold")
      .map(([id, value]) => ({
        id,
        status: value.status,
        reason: value.reason ?? null
      })),
    cost: {
      paidApiCalls: measuredExecutions.reduce(
        (sum, execution) => sum + execution.paidApiCalls,
        0
      ),
      externalLlmCallsDuringRegression: measuredExecutions.reduce(
        (sum, execution) => sum + execution.requests,
        0
      ),
      totalTokens: measuredExecutions.reduce(
        (sum, execution) => sum + execution.totalTokens,
        0
      )
    }
  };
}
