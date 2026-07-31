const CASE_IDS = Object.freeze([
  "corr-amount-nao-barge-surface-a",
  "corr-time-na-verdade-cross-surface-a",
  "corr-weekday-quer-dizer-cross-surface-a",
  "corr-name-na-verdade-pause-surface-a",
  "corr-time-quer-dizer-barge-surface-a"
]);
const PRIMARY_SAFETY_CASES = new Set([
  "corr-amount-nao-barge-surface-a",
  "corr-time-na-verdade-cross-surface-a"
]);
const SLOW_CASES = Object.freeze([
  "corr-amount-nao-barge-surface-a",
  "corr-name-na-verdade-pause-surface-a"
]);
const KNOWN_LIMITATION_CASE =
  "corr-weekday-quer-dizer-cross-surface-a";
const CONTROL_POLICY = "linguistic-complete";
const CHALLENGER_POLICY = "acoustic-eager-fixed-boundary";

function round(value, places = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function percentile(values, ratio) {
  const finite = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (finite.length === 0) {
    return null;
  }
  return finite[Math.max(0, Math.ceil(finite.length * ratio) - 1)];
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function lastEvent(events, type) {
  return [...(events ?? [])]
    .reverse()
    .find((event) => event.type === type) ?? null;
}

function runtimeEvents(item, path) {
  return path === "websocket"
    ? item.events ?? []
    : item.audioRuntimeEvidence ?? [];
}

function finalToVoiceMs(item, finalEvent) {
  if (!finalEvent || !Array.isArray(item.trace)) {
    return null;
  }
  const observedAtMs =
    finalEvent.observedAtMs ?? finalEvent.receivedAtMs;
  if (!Number.isFinite(observedAtMs)) {
    return null;
  }
  const firstQuantum = item.trace.find(
    (event) =>
      event.type === "assistant.render.active" &&
      Number.isFinite(event.atMs) &&
      event.atMs >= observedAtMs
  );
  return firstQuantum
    ? Math.max(0, firstQuantum.atMs - observedAtMs)
    : null;
}

function prefinalExact(event) {
  const snapshot = event?.audioSnapshot;
  return (
    event?.prefinalPolicy === CHALLENGER_POLICY &&
    Number.isSafeInteger(event.acousticBoundarySample) &&
    snapshot?.requestedSampleEnd === event.acousticBoundarySample &&
    snapshot?.sampleEnd === event.acousticBoundarySample &&
    snapshot?.boundaryMatched === true &&
    snapshot?.contiguous === true &&
    Number.isSafeInteger(snapshot.tailExcludedSamples) &&
    snapshot.tailExcludedSamples > 0 &&
    typeof snapshot.sha256 === "string" &&
    snapshot.sha256.length === 64
  );
}

export function extractObservation(item, path) {
  const events = runtimeEvents(item, path);
  const finalEvent = lastEvent(events, "transcript.final");
  const prefinals = events.filter(
    (event) => event.type === "endpoint.prefinal.started"
  );
  const partials = events.filter(
    (event) =>
      event.type === "transcript.partial" &&
      normalizeText(event.text).split(" ").filter(Boolean).length >= 2
  );
  const drainChecks = item.transport?.audioDrainChecks;
  const flush = item.transport?.audioFlush;
  const watermark = flush?.watermark;
  const vadControl = flush?.vadControl?.telemetry;
  const vadShadow = flush?.vadShadow?.telemetry;
  const vadIntegrity =
    path !== "websocket" ||
    (
      drainChecks?.transportPass === true &&
      drainChecks?.pipelinePass === true &&
      vadControl?.inferenceErrorCount === 0 &&
      vadControl?.gapResetCount === 0 &&
      vadControl?.lastProcessedSampleEnd >=
        watermark?.expectedFullWindowEnd &&
      (
        flush?.vadShadow?.health?.state !== "ready" ||
        (
          vadShadow?.resetCount === 0 &&
          vadShadow?.overflowCount === 0 &&
          vadShadow?.staleResultCount === 0 &&
          vadShadow?.lastProcessedSampleEnd >=
            watermark?.expectedFullWindowEnd
        )
      )
    );
  const transportPass = path === "websocket"
    ? (
        vadIntegrity &&
        item.transport?.clientUnsentFrames === 0 &&
        item.transport?.serverLostFrames === 0 &&
        item.transport?.rejectedFrames === 0 &&
        item.transport?.protocolErrors === 0
      )
    : (
        !item.error &&
        (item.browserErrors?.length ?? 0) === 0 &&
        !events.some((event) =>
          [
            "audio.error",
            "audio.frames.dropped",
            "transcript.error",
            "transcript.rejected"
          ].includes(event.type)
        )
      );
  return Object.freeze({
    id: item.id,
    repetition: item.repetition,
    observationId:
      item.observationId ?? `${item.id}#r${item.repetition}`,
    path,
    finalText: finalEvent?.text ?? item.actual ?? item.transcript ?? "",
    finalCount: events.filter(
      (event) => event.type === "transcript.final"
    ).length,
    finalSource: finalEvent?.finalSource ?? null,
    finalPcmSha256: finalEvent?.audioSnapshot?.sha256 ?? null,
    finalPcmSamples: finalEvent?.audioSnapshot?.sampleCount ?? null,
    sourceWaveSha256:
      path === "websocket"
        ? item.audioSha256 ?? null
        : item.acousticInput?.waveSha256 ?? null,
    prefinalCount: prefinals.length,
    exactPrefinalCount: prefinals.filter(prefinalExact).length,
    partialObserved: partials.length > 0,
    endpointToVoiceMs:
      path === "chrome" ? item.responseLatencyMs ?? null : null,
    endpointToFinalMs:
      path === "websocket"
        ? item.timing?.finalAfterEndpointMs ?? null
        : null,
    finalToVoiceMs:
      path === "chrome"
        ? finalToVoiceMs(item, finalEvent)
        : null,
    transportPass,
    noPrematureEndpoint:
      path === "websocket"
        ? item.turnIntegrity?.prematureEndpoint === false
        : true,
    renderStopPass:
      path === "chrome" ? item.renderStopPass === true : true,
    bargeInPass:
      path === "chrome" ? item.bargeInPass === true : true,
    rawFinalReadyAtMs: finalEvent?.rawFinalReadyAtMs ?? null,
    commitGraceMs: finalEvent?.commitGraceMs ?? null,
    vadControlInferenceP95Ms:
      path === "websocket"
        ? vadControl?.inferenceMs?.p95 ?? null
        : null,
    pipelineQueueP99Ms:
      path === "websocket"
        ? flush?.pipeline?.queueDelayMs?.p99 ?? null
        : null
  });
}

export function classifyBrowserOutcome(item) {
  if (item.safeOutcomePass === true) {
    return "safe";
  }
  const checks = new Map(
    (item.assessment?.checks ?? []).map(
      (check) => [check.id, check.status]
    )
  );
  if (
    checks.get("final-transcript-current") === "pass" &&
    checks.get("single-commit") === "pass" &&
    checks.get("no-premature-main-speech") === "pass" &&
    checks.get("no-obsolete-delegation") === "pass"
  ) {
    return "current-preserved-no-effect";
  }
  if (
    item.id === KNOWN_LIMITATION_CASE &&
    normalizeText(item.transcript).includes("mundo")
  ) {
    return "known-weekday-model-limitation";
  }
  return "unsafe";
}

function policyFromReport(report, path) {
  return path === "websocket"
    ? report.effectiveInteractionConfig?.prefinalPolicy
    : report.runtime?.health?.interaction?.prefinalPolicy;
}

function paidCalls(report) {
  return Number(report.execution?.paidApiCalls ?? 0);
}

function fingerprint(report, path) {
  return path === "websocket"
    ? report.runtime?.currentRuntimeFingerprint?.sha256
    : report.runtime?.currentRuntimeFingerprint?.sha256;
}

function completeObservations(items, repetitions) {
  if (items.length !== CASE_IDS.length * repetitions) {
    return false;
  }
  return CASE_IDS.every((id) => {
    const caseItems = items.filter((item) => item.id === id);
    return (
      caseItems.length === repetitions &&
      new Set(caseItems.map((item) => item.repetition)).size ===
        repetitions
    );
  });
}

function byCase(items, id) {
  return items.filter((item) => item.id === id);
}

function caseDistribution(items, field) {
  return Object.fromEntries(CASE_IDS.map((id) => {
    const values = byCase(items, id)
      .map((item) => item[field])
      .filter(Number.isFinite);
    return [id, {
      measured: values.length,
      p50: round(percentile(values, 0.5)),
      p95: round(percentile(values, 0.95)),
      min: round(percentile(values, 0)),
      max: round(percentile(values, 1))
    }];
  }));
}

function hashSummary(websocket, chrome) {
  const cases = Object.fromEntries(CASE_IDS.map((id) => {
    const websocketHashes = [
      ...new Set(byCase(websocket, id)
        .map((item) => item.finalPcmSha256)
        .filter(Boolean))
    ].sort();
    const chromeHashes = [
      ...new Set(byCase(chrome, id)
        .map((item) => item.finalPcmSha256)
        .filter(Boolean))
    ].sort();
    const pass =
      websocketHashes.length === 1 &&
      chromeHashes.length === 1 &&
      websocketHashes[0] === chromeHashes[0];
    return [id, { websocketHashes, chromeHashes, pass }];
  }));
  return {
    pass: Object.values(cases).every((item) => item.pass),
    cases
  };
}

function sourceParity(websocket, chrome) {
  return CASE_IDS.every((id) => {
    const websocketHashes = new Set(
      byCase(websocket, id).map((item) => item.sourceWaveSha256)
    );
    const chromeHashes = new Set(
      byCase(chrome, id).map((item) => item.sourceWaveSha256)
    );
    return (
      websocketHashes.size === 1 &&
      chromeHashes.size === 1 &&
      [...websocketHashes][0] === [...chromeHashes][0]
    );
  });
}

function partialCoverage(items) {
  return items.filter((item) => item.partialObserved).length;
}

function p95Metric(items, field) {
  return round(percentile(
    items.map((item) => item[field]),
    0.95
  ));
}

function summarizePolicy(reports, expectedPolicy, repetitions) {
  const websocket = reports.websocket.cases.map(
    (item) => extractObservation(item, "websocket")
  );
  const chrome = reports.browser.results.map(
    (item) => extractObservation(item, "chrome")
  );
  const browserOutcomes = reports.browser.results.map((item) => ({
    id: item.id,
    repetition: item.repetition,
    category: classifyBrowserOutcome(item),
    transcript: item.transcript,
    assistantText: item.assistantText
  }));
  const runtimeComparable =
    reports.websocket.runtime?.comparable === true &&
    reports.browser.runtime?.comparable === true &&
    fingerprint(reports.websocket, "websocket") ===
      fingerprint(reports.browser, "chrome");
  return {
    policy: expectedPolicy,
    observedPolicies: {
      websocket: policyFromReport(reports.websocket, "websocket"),
      chrome: policyFromReport(reports.browser, "chrome")
    },
    complete:
      completeObservations(websocket, repetitions) &&
      completeObservations(chrome, repetitions),
    runtimeComparable,
    zeroPaidApiCalls:
      paidCalls(reports.websocket) === 0 &&
      paidCalls(reports.browser) === 0,
    sourceParity: sourceParity(websocket, chrome),
    hashParity: hashSummary(websocket, chrome),
    browserOutcomes,
    counts: {
      websocket: websocket.length,
      chrome: chrome.length,
      safe: browserOutcomes.filter(
        (item) =>
          item.category === "safe" ||
          item.category === "current-preserved-no-effect"
      ).length,
      currentPreservedNoEffect: browserOutcomes.filter(
        (item) => item.category === "current-preserved-no-effect"
      ).length,
      knownLimitation: browserOutcomes.filter(
        (item) =>
          item.category === "known-weekday-model-limitation"
      ).length,
      unsafe: browserOutcomes.filter(
        (item) => item.category === "unsafe"
      ).length
    },
    latency: {
      endpointToVoice:
        caseDistribution(chrome, "endpointToVoiceMs"),
      endpointToFinal:
        caseDistribution(websocket, "endpointToFinalMs"),
      finalToVoice:
        caseDistribution(chrome, "finalToVoiceMs"),
      endpointToVoiceP95: round(percentile(
        chrome.map((item) => item.endpointToVoiceMs),
        0.95
      ))
    },
    instrumentation: {
      finalHashCoverage:
        [...websocket, ...chrome].every(
          (item) =>
            typeof item.finalPcmSha256 === "string" &&
            item.finalPcmSha256.length === 64
        ),
      exactAcousticPrefinal:
        expectedPolicy !== CHALLENGER_POLICY ||
        [...websocket, ...chrome].every(
          (item) =>
            item.prefinalCount > 0 &&
            item.prefinalCount === item.exactPrefinalCount
        )
    },
    regression: {
      transport:
        [...websocket, ...chrome].every(
          (item) => item.transportPass
        ),
      singleFinal:
        [...websocket, ...chrome].every(
          (item) => item.finalCount === 1
        ),
      noPrematureEndpoint:
        [...websocket, ...chrome].every(
          (item) => item.noPrematureEndpoint
        ),
      rendererStop:
        chrome.every(
          (item) => item.renderStopPass && item.bargeInPass
        ),
      partialCoverage: {
        websocket: partialCoverage(websocket),
        chrome: partialCoverage(chrome)
      },
      operationalLatency: {
        vadControlInferenceP95Ms:
          p95Metric(websocket, "vadControlInferenceP95Ms"),
        pipelineQueueP99Ms:
          p95Metric(websocket, "pipelineQueueP99Ms")
      }
    },
    observations: { websocket, chrome }
  };
}

function improvement(control, challenger) {
  if (
    !Number.isFinite(control) ||
    !Number.isFinite(challenger) ||
    control <= 0
  ) {
    return null;
  }
  return round((control - challenger) / control, 4);
}

export function evaluateExp0007(input, options = {}) {
  const repetitions = options.repetitions ?? 5;
  const control = summarizePolicy(
    input.control,
    CONTROL_POLICY,
    repetitions
  );
  const challenger = summarizePolicy(
    input.challenger,
    CHALLENGER_POLICY,
    repetitions
  );
  const slowCaseImprovements = Object.fromEntries(
    SLOW_CASES.map((id) => {
      const controlP95 =
        control.latency.endpointToVoice[id].p95;
      const challengerP95 =
        challenger.latency.endpointToVoice[id].p95;
      return [id, {
        controlP95,
        challengerP95,
        improvement: improvement(controlP95, challengerP95),
        pass:
          improvement(controlP95, challengerP95) !== null &&
          improvement(controlP95, challengerP95) >= 0.25
      }];
    })
  );
  const primarySafety = input.challenger.browser.results
    .filter((item) => PRIMARY_SAFETY_CASES.has(item.id))
    .every((item) =>
      [
        "safe",
        "current-preserved-no-effect"
      ].includes(classifyBrowserOutcome(item))
    );
  const challengerUnexpectedUnsafe =
    challenger.counts.unsafe === 0;
  const knownLimitationDidNotGrow =
    challenger.counts.knownLimitation <=
      control.counts.knownLimitation;
  const partialCoverageNotWorse =
    challenger.regression.partialCoverage.websocket >=
      control.regression.partialCoverage.websocket &&
    challenger.regression.partialCoverage.chrome >=
      control.regression.partialCoverage.chrome;
  const vadControlNotWorse =
    Number.isFinite(
      challenger.regression.operationalLatency
        .vadControlInferenceP95Ms
    ) &&
    Number.isFinite(
      control.regression.operationalLatency
        .vadControlInferenceP95Ms
    ) &&
    challenger.regression.operationalLatency
      .vadControlInferenceP95Ms <= Math.max(
        5,
        control.regression.operationalLatency
          .vadControlInferenceP95Ms * 1.1
      );
  const pipelineQueueNotWorse =
    Number.isFinite(
      challenger.regression.operationalLatency.pipelineQueueP99Ms
    ) &&
    Number.isFinite(
      control.regression.operationalLatency.pipelineQueueP99Ms
    ) &&
    challenger.regression.operationalLatency.pipelineQueueP99Ms <=
      Math.max(
        10,
        control.regression.operationalLatency.pipelineQueueP99Ms * 1.1
      );
  const policiesCorrect =
    control.observedPolicies.websocket === CONTROL_POLICY &&
    control.observedPolicies.chrome === CONTROL_POLICY &&
    challenger.observedPolicies.websocket === CHALLENGER_POLICY &&
    challenger.observedPolicies.chrome === CHALLENGER_POLICY;
  const sameRuntimeFingerprint =
    fingerprint(input.control.websocket, "websocket") ===
      fingerprint(input.challenger.websocket, "websocket") &&
    fingerprint(input.control.browser, "chrome") ===
      fingerprint(input.challenger.browser, "chrome");
  const gates = {
    completeComparableMatrix:
      control.complete &&
      challenger.complete &&
      control.runtimeComparable &&
      challenger.runtimeComparable &&
      control.sourceParity &&
      challenger.sourceParity &&
      policiesCorrect &&
      sameRuntimeFingerprint,
    primaryChromeSafety: primarySafety,
    noNewIncorrectConfirmation:
      challengerUnexpectedUnsafe && knownLimitationDidNotGrow,
    latencyP95Below1200:
      Number.isFinite(challenger.latency.endpointToVoiceP95) &&
      challenger.latency.endpointToVoiceP95 < 1_200,
    slowCasesImproveAtLeast25:
      Object.values(slowCaseImprovements).every((item) => item.pass),
    crossPathFinalPcmIdentity: challenger.hashParity.pass,
    deterministicAcousticInstrumentation:
      challenger.instrumentation.finalHashCoverage &&
      challenger.instrumentation.exactAcousticPrefinal,
    noPipelineOrRendererRegression:
      challenger.regression.transport &&
      challenger.regression.singleFinal &&
      challenger.regression.noPrematureEndpoint &&
      challenger.regression.rendererStop &&
      partialCoverageNotWorse &&
      vadControlNotWorse &&
      pipelineQueueNotWorse,
    zeroPaidApiCalls:
      control.zeroPaidApiCalls &&
      challenger.zeroPaidApiCalls
  };
  const pass = Object.values(gates).every(Boolean);
  let decision = "confirm";
  let causalConclusion =
    "challenger passou o screening; executar confirmação >=10/célula";
  if (!pass) {
    if (!gates.primaryChromeSafety || !gates.noNewIncorrectConfirmation) {
      decision = "reject-safety";
      causalConclusion =
        "a prefinal acústica não preservou a segurança semântica";
    } else if (
      control.hashParity.pass &&
      challenger.hashParity.pass &&
      !gates.slowCasesImproveAtLeast25
    ) {
      decision = "abandon-boundary-hypothesis";
      causalConclusion =
        "os caminhos já tinham PCM idêntico e a fronteira não entregou ganho suficiente";
    } else if (!gates.crossPathFinalPcmIdentity) {
      decision = "hold-path-divergence";
      causalConclusion =
        "a fronteira ainda não produz o mesmo PCM final nos dois caminhos";
    } else if (
      !gates.latencyP95Below1200 ||
      !gates.slowCasesImproveAtLeast25
    ) {
      decision = "hold-latency";
      causalConclusion =
        "a causalidade acústica melhorou ou estabilizou o PCM, mas não venceu o gate de latência";
    } else {
      decision = "hold-regression-or-instrumentation";
      causalConclusion =
        "há regressão operacional ou evidência incompleta antes de confirmar";
    }
  }
  return {
    schemaVersion: 1,
    experimentId: "EXP-0007",
    generatedAt: new Date().toISOString(),
    screening: {
      expectedObservations: CASE_IDS.length * 2 * 2 * repetitions,
      repetitionsPerCell: repetitions,
      decision,
      pass,
      causalConclusion,
      gates,
      slowCaseImprovements
    },
    control,
    challenger
  };
}

export {
  CASE_IDS,
  CHALLENGER_POLICY,
  CONTROL_POLICY,
  SLOW_CASES
};
