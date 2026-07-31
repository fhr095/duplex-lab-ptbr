import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { runCampaign } from "./live-audio-campaign.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_EXPERIMENT =
  "eval/scenarios/live-audio-ab-endpoint.pt-BR.json";
const DEFAULT_REPORT =
  "eval/reports/live-audio-ab-endpoint-latest.json";

function round(value, places = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function nearestRank(values, ratio) {
  const finite = values.filter(Number.isFinite).sort((left, right) =>
    left - right
  );
  if (finite.length === 0) {
    return null;
  }
  return finite[Math.max(0, Math.ceil(finite.length * ratio) - 1)];
}

export function distribution(values, options = {}) {
  const finite = values.filter(Number.isFinite);
  const minimumP95Samples = options.minimumP95Samples ?? 20;
  const p95Eligible = finite.length >= minimumP95Samples;
  return {
    n: finite.length,
    min: round(nearestRank(finite, 0)),
    p25: round(nearestRank(finite, 0.25)),
    p50: round(nearestRank(finite, 0.5)),
    p75: round(nearestRank(finite, 0.75)),
    p90: round(nearestRank(finite, 0.9)),
    p95: p95Eligible
      ? round(nearestRank(finite, 0.95))
      : null,
    max: round(nearestRank(finite, 1)),
    mean:
      finite.length === 0
        ? null
        : round(
            finite.reduce((sum, value) => sum + value, 0) /
              finite.length,
            1
          ),
    p95Eligible,
    minimumP95Samples,
    p95TailObservations: p95Eligible
      ? finite.length - Math.ceil(finite.length * 0.95) + 1
      : 0
  };
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : round(numerator / denominator, 4);
}

function finalizedExactlyOnce(item) {
  return item.eventCounts?.finals === 1;
}

function coherent(item) {
  return finalizedExactlyOnce(item) &&
    item.turnIntegrity?.coherentSingleTurn === true;
}

function correctionSuccess(item) {
  return (
    item.category === "correction" &&
    coherent(item) &&
    item.criticalPhrases?.recall === 1
  );
}

function endOfSpeechToFinal(item) {
  const endpoint = item.timing?.endpointAfterLastActiveMs;
  const finalization = item.timing?.finalAfterEndpointMs;
  return Number.isFinite(endpoint) && Number.isFinite(finalization)
    ? endpoint + finalization
    : null;
}

function scenarioSummary(items, experiment) {
  const speech = items.filter((item) => item.expectSpeech);
  const controls = items.filter((item) => !item.expectSpeech);
  const minimumP95Samples = experiment.minAggregateSamplesForP95;
  const finalized = speech.filter(finalizedExactlyOnce);
  const corrections = speech.filter(
    (item) => item.category === "correction"
  );
  let errors = 0;
  let expectedWords = 0;
  for (const item of speech) {
    errors += item.transcript?.errors ?? 0;
    expectedWords += item.transcript?.expectedWords ?? 0;
  }

  return {
    observations: items.length,
    speechObservations: speech.length,
    controlObservations: controls.length,
    falseActivations: controls.reduce(
      (sum, item) => sum + (item.eventCounts?.speechStarts ?? 0),
      0
    ),
    finalized: finalized.length,
    finalizationRate: rate(finalized.length, speech.length),
    coherent: speech.filter(coherent).length,
    coherenceRate: rate(speech.filter(coherent).length, speech.length),
    rawPrematureEndpoints: speech.filter(
      (item) => item.turnIntegrity?.rawPrematureEndpoint
    ).length,
    rawPrematureEndpointRate: rate(
      speech.filter(
        (item) => item.turnIntegrity?.rawPrematureEndpoint
      ).length,
      speech.length
    ),
    unrecoveredPrematureEndpoints: speech.filter(
      (item) => item.turnIntegrity?.prematureEndpoint
    ).length,
    correctionObservations: corrections.length,
    correctionSuccesses: corrections.filter(correctionSuccess).length,
    correctionSuccessRate: rate(
      corrections.filter(correctionSuccess).length,
      corrections.length
    ),
    transcript: {
      errors,
      expectedWords,
      corpusWer:
        expectedWords === 0 ? null : round(errors / expectedWords, 4)
    },
    timing: {
      endpointAfterSpeechEndMs: distribution(
        speech.map(
          (item) => item.timing?.endpointAfterLastActiveMs
        ),
        { minimumP95Samples }
      ),
      finalAfterEndpointMs: distribution(
        speech.map((item) => item.timing?.finalAfterEndpointMs),
        { minimumP95Samples }
      ),
      speechEndToFinalMs: distribution(
        speech.map(endOfSpeechToFinal),
        { minimumP95Samples }
      )
    },
    transport: {
      clientUnsentFrames: items.reduce(
        (sum, item) => sum + (item.transport?.clientUnsentFrames ?? 0),
        0
      ),
      serverLostFrames: items.reduce(
        (sum, item) => sum + (item.transport?.serverLostFrames ?? 0),
        0
      ),
      rejectedFrames: items.reduce(
        (sum, item) => sum + (item.transport?.rejectedFrames ?? 0),
        0
      ),
      protocolErrors: items.reduce(
        (sum, item) => sum + (item.transport?.protocolErrors ?? 0),
        0
      ),
      maxBufferedAmountBytes: round(nearestRank(
        items
          .map((item) => item.transport?.maxBufferedAmountBytes)
          .filter(Number.isFinite),
        1
      )),
      backlogDistributionBytes: distribution(
        items.map(
          (item) => item.transport?.maxBufferedAmountBytes
        ),
        { minimumP95Samples }
      )
    }
  };
}

export function summarizeCandidate(
  candidateId,
  observations,
  experiment
) {
  const selected = observations.filter(
    (item) => item.candidateId === candidateId
  );
  const expectedCaseIds = experiment.caseIds;
  const perScenario = {};
  for (const caseId of expectedCaseIds) {
    const items = selected
      .filter((item) => item.case.id === caseId)
      .map((item) => item.case);
    perScenario[caseId] = {
      repetitionsObserved: items.length,
      repeatCoverage:
        items.length >= experiment.minRepetitionsPerScenario,
      ...scenarioSummary(items, experiment)
    };
  }
  const allCases = selected.map((item) => item.case);
  const aggregate = scenarioSummary(allCases, experiment);
  const completeCoverage = expectedCaseIds.every(
    (caseId) => perScenario[caseId].repeatCoverage
  );
  return {
    candidateId,
    completeCoverage,
    expectedObservations:
      expectedCaseIds.length * experiment.repetitions,
    observedObservations: selected.length,
    ...aggregate,
    perScenario
  };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function bootstrapMedianInterval(
  values,
  options = {}
) {
  const finite = values.filter(Number.isFinite);
  const iterations = options.iterations ?? 2_000;
  if (finite.length < 2 || iterations < 100) {
    return {
      eligible: false,
      n: finite.length,
      iterations,
      low: null,
      high: null
    };
  }
  const random = randomGenerator(options.seed ?? 1);
  const medians = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    for (let index = 0; index < finite.length; index += 1) {
      sample.push(finite[Math.floor(random() * finite.length)]);
    }
    medians.push(nearestRank(sample, 0.5));
  }
  return {
    eligible: true,
    n: finite.length,
    iterations,
    low: round(nearestRank(medians, 0.025)),
    high: round(nearestRank(medians, 0.975)),
    method:
      "paired nonparametric bootstrap of median, deterministic seed"
  };
}

function pairedMetric(pairs, selector, experiment, metricName) {
  const observations = [];
  for (const pair of pairs) {
    const baseline = selector(pair.baseline);
    const challenger = selector(pair.challenger);
    if (Number.isFinite(baseline) && Number.isFinite(challenger)) {
      observations.push({
        repetition: pair.repetition,
        caseId: pair.caseId,
        baselineOrderIndex: pair.baselineOrderIndex,
        challengerOrderIndex: pair.challengerOrderIndex,
        baseline: round(baseline),
        challenger: round(challenger),
        delta: round(challenger - baseline)
      });
    }
  }
  const deltas = observations.map((item) => item.delta);
  const practicalTieMs = 10;
  const orderStrata = Object.fromEntries(
    [0, 1].map((orderIndex) => {
      const values = observations
        .filter(
          (item) => item.challengerOrderIndex === orderIndex
        )
        .map((item) => item.delta);
      return [
        orderIndex === 0 ? "challenger-first" : "challenger-second",
        distribution(values, {
          minimumP95Samples: experiment.minAggregateSamplesForP95
        })
      ];
    })
  );
  return {
    metric: metricName,
    pairedSamples: observations.length,
    deltaConvention: "challenger-minus-baseline; negative is faster",
    deltaMs: distribution(deltas, {
      minimumP95Samples: experiment.minAggregateSamplesForP95
    }),
    bootstrapMedian95CiMs: bootstrapMedianInterval(deltas, {
      iterations: experiment.bootstrapIterations,
      seed: hashSeed(`${experiment.id}:${metricName}`)
    }),
    wins: deltas.filter((value) => value < -practicalTieMs).length,
    practicalTies: deltas.filter(
      (value) => Math.abs(value) <= practicalTieMs
    ).length,
    losses: deltas.filter((value) => value > practicalTieMs).length,
    practicalTieMs,
    orderStrata,
    observations
  };
}

function binaryDiscordance(pairs, selector) {
  let bothPass = 0;
  let bothFail = 0;
  let challengerGains = 0;
  let challengerRegressions = 0;
  for (const pair of pairs) {
    const baseline = Boolean(selector(pair.baseline));
    const challenger = Boolean(selector(pair.challenger));
    if (baseline && challenger) {
      bothPass += 1;
    } else if (!baseline && !challenger) {
      bothFail += 1;
    } else if (challenger) {
      challengerGains += 1;
    } else {
      challengerRegressions += 1;
    }
  }
  return {
    pairedSamples: pairs.length,
    bothPass,
    bothFail,
    challengerGains,
    challengerRegressions
  };
}

function makePairs(experiment, observations) {
  const byKey = new Map();
  for (const observation of observations) {
    const key = `${observation.repetition}:${observation.case.id}`;
    const entry = byKey.get(key) ?? {
      repetition: observation.repetition,
      caseId: observation.case.id
    };
    entry[observation.candidateId === experiment.baselineId
      ? "baseline"
      : "challenger"] = observation.case;
    entry[observation.candidateId === experiment.baselineId
      ? "baselineOrderIndex"
      : "challengerOrderIndex"] = observation.orderIndex;
    byKey.set(key, entry);
  }
  return [...byKey.values()].filter(
    (item) => item.baseline && item.challenger
  );
}

function compareRates(challenger, baseline) {
  if (!Number.isFinite(challenger) || !Number.isFinite(baseline)) {
    return null;
  }
  return round(challenger - baseline, 4);
}

export function compareCandidates(
  experiment,
  observations,
  runMetadata = []
) {
  const summaries = {
    [experiment.baselineId]: summarizeCandidate(
      experiment.baselineId,
      observations,
      experiment
    ),
    [experiment.challengerId]: summarizeCandidate(
      experiment.challengerId,
      observations,
      experiment
    )
  };
  const baseline = summaries[experiment.baselineId];
  const challenger = summaries[experiment.challengerId];
  const pairs = makePairs(experiment, observations);
  const speechPairs = pairs.filter(
    (pair) => pair.baseline.expectSpeech
  );
  const correctionPairs = speechPairs.filter(
    (pair) => pair.baseline.category === "correction"
  );
  const controlPairs = pairs.filter(
    (pair) => !pair.baseline.expectSpeech
  );
  const pairedByScenario = Object.fromEntries(
    experiment.caseIds.map((caseId) => {
      const scenarioPairs = speechPairs.filter(
        (pair) => pair.caseId === caseId
      );
      return [
        caseId,
        {
          pairedSamples: scenarioPairs.length,
          endpoint: pairedMetric(
            scenarioPairs,
            (item) => item.timing?.endpointAfterLastActiveMs,
            experiment,
            `${caseId}:endpoint-after-speech-end`
          ),
          speechEndToFinal: pairedMetric(
            scenarioPairs,
            endOfSpeechToFinal,
            experiment,
            `${caseId}:speech-end-to-final`
          ),
          finalization: binaryDiscordance(
            scenarioPairs,
            finalizedExactlyOnce
          ),
          coherence: binaryDiscordance(scenarioPairs, coherent)
        }
      ];
    })
  );
  const endpoint = pairedMetric(
    speechPairs,
    (item) => item.timing?.endpointAfterLastActiveMs,
    experiment,
    "endpoint-after-speech-end"
  );
  const speechEndToFinal = pairedMetric(
    speechPairs,
    endOfSpeechToFinal,
    experiment,
    "speech-end-to-final"
  );
  const gate = experiment.decisionGate;
  const successfulRuns = runMetadata.filter(
    (item) => item.status === "completed"
  );
  const expectedRuns =
    experiment.repetitions * experiment.candidates.length;
  const configurationVerified =
    runMetadata.length === 0 ||
    (
      successfulRuns.length === expectedRuns &&
      successfulRuns.every((item) => item.configurationVerified)
    );
  const evidenceChecks = {
    baselineCoverage: baseline.completeCoverage,
    challengerCoverage: challenger.completeCoverage,
    expectedRunCount:
      runMetadata.length === 0 ||
      successfulRuns.length === expectedRuns,
    configurationVerified,
    endpointPairs:
      endpoint.pairedSamples >= gate.minPairedEndpointSamples,
    speechEndToFinalPairs:
      speechEndToFinal.pairedSamples >=
        gate.minPairedSpeechEndToFinalSamples,
    endpointP95NotSingleObservation:
      baseline.timing.endpointAfterSpeechEndMs.p95Eligible &&
      challenger.timing.endpointAfterSpeechEndMs.p95Eligible &&
      baseline.timing.endpointAfterSpeechEndMs.p95TailObservations >=
        experiment.minP95TailObservations &&
      challenger.timing.endpointAfterSpeechEndMs.p95TailObservations >=
        experiment.minP95TailObservations,
    finalP95NotSingleObservation:
      baseline.timing.speechEndToFinalMs.p95Eligible &&
      challenger.timing.speechEndToFinalMs.p95Eligible &&
      baseline.timing.speechEndToFinalMs.p95TailObservations >=
        experiment.minP95TailObservations &&
      challenger.timing.speechEndToFinalMs.p95TailObservations >=
        experiment.minP95TailObservations
  };
  const binary = {
    finalization: binaryDiscordance(
      speechPairs,
      finalizedExactlyOnce
    ),
    coherence: binaryDiscordance(speechPairs, coherent),
    rawPrematureEndpoint: binaryDiscordance(
      speechPairs,
      (item) => !item.turnIntegrity?.rawPrematureEndpoint
    ),
    correctionSuccess: binaryDiscordance(
      correctionPairs,
      correctionSuccess
    ),
    falseActivationControl: binaryDiscordance(
      controlPairs,
      (item) => (item.eventCounts?.speechStarts ?? 0) === 0
    )
  };
  const rateDeltas = {
    finalization: compareRates(
      challenger.finalizationRate,
      baseline.finalizationRate
    ),
    coherence: compareRates(
      challenger.coherenceRate,
      baseline.coherenceRate
    ),
    rawPrematureEndpoint: compareRates(
      challenger.rawPrematureEndpointRate,
      baseline.rawPrematureEndpointRate
    ),
    correctionSuccess: compareRates(
      challenger.correctionSuccessRate,
      baseline.correctionSuccessRate
    ),
    corpusWer: compareRates(
      challenger.transcript.corpusWer,
      baseline.transcript.corpusWer
    )
  };
  const safetyChecks = {
    allChallengerFinalized:
      !gate.requireAllChallengerFinals ||
      challenger.finalizationRate === 1,
    finalizationNonInferior:
      rateDeltas.finalization !== null &&
      rateDeltas.finalization >= -gate.maxFinalizationRateDrop,
    coherenceNonInferior:
      rateDeltas.coherence !== null &&
      rateDeltas.coherence >= -gate.maxCoherenceRateDrop,
    correctionCoherent:
      !gate.requireAllChallengerCorrectionsCoherent ||
      challenger.correctionSuccessRate === 1,
    correctionNonInferior:
      rateDeltas.correctionSuccess !== null &&
      rateDeltas.correctionSuccess >=
        -gate.maxCorrectionSuccessRateDrop,
    noChallengerFalseActivations:
      challenger.falseActivations === 0,
    falseActivationNonInferior:
      binary.falseActivationControl.challengerRegressions === 0,
    noNewRawPrematureEndpoints:
      rateDeltas.rawPrematureEndpoint !== null &&
      rateDeltas.rawPrematureEndpoint <=
        gate.maxRawPrematureRateIncrease,
    transcriptNonInferior:
      rateDeltas.corpusWer !== null &&
      rateDeltas.corpusWer <= gate.maxCorpusWerIncrease,
    noChallengerLoss:
      challenger.transport.clientUnsentFrames <= gate.maxLostFrames &&
      challenger.transport.serverLostFrames <= gate.maxLostFrames,
    noChallengerRejectedFrames:
      challenger.transport.rejectedFrames <= gate.maxRejectedFrames,
    noChallengerProtocolErrors:
      challenger.transport.protocolErrors <= gate.maxProtocolErrors,
    boundedChallengerBacklog:
      Number.isFinite(challenger.transport.maxBufferedAmountBytes) &&
      challenger.transport.maxBufferedAmountBytes <=
        gate.maxBufferedAmountBytes,
    speechEndToFinalNonInferior:
      Number.isFinite(speechEndToFinal.deltaMs.p50) &&
      speechEndToFinal.deltaMs.p50 <=
        gate.maxMedianSpeechEndToFinalRegressionMs &&
      speechEndToFinal.bootstrapMedian95CiMs.eligible &&
      speechEndToFinal.bootstrapMedian95CiMs.high <=
        gate.maxMedianSpeechEndToFinalRegressionMs
  };
  const benefitChecks = {
    materialEndpointMedianGain:
      Number.isFinite(endpoint.deltaMs.p50) &&
      endpoint.deltaMs.p50 <= -gate.minMedianEndpointGainMs,
    endpointBootstrapBelowZero:
      endpoint.bootstrapMedian95CiMs.eligible &&
      endpoint.bootstrapMedian95CiMs.high < 0
  };
  const evidenceAdequate =
    Object.values(evidenceChecks).every(Boolean);
  const hardSafetyChecks = Object.fromEntries(
    Object.entries(safetyChecks).filter(
      ([check]) => check !== "speechEndToFinalNonInferior"
    )
  );
  const hardSafe = Object.values(hardSafetyChecks).every(Boolean);
  const nonInferiorityEstablished =
    safetyChecks.speechEndToFinalNonInferior;
  const safe = hardSafe && nonInferiorityEstablished;
  const beneficial = Object.values(benefitChecks).every(Boolean);
  const decision = evidenceAdequate && safe && beneficial
    ? "promote-challenger"
    : evidenceAdequate && !hardSafe
      ? "reject-challenger"
      : "inconclusive";

  return {
    baselineId: experiment.baselineId,
    challengerId: experiment.challengerId,
    summaries,
    paired: {
      totalPairs: pairs.length,
      speechPairs: speechPairs.length,
      correctionPairs: correctionPairs.length,
      endpoint,
      speechEndToFinal,
      binary,
      byScenario: pairedByScenario,
      absoluteDistributionDeltas: {
        convention: "challenger-minus-baseline",
        endpointP95Ms:
          Number.isFinite(
            challenger.timing.endpointAfterSpeechEndMs.p95
          ) &&
          Number.isFinite(
            baseline.timing.endpointAfterSpeechEndMs.p95
          )
            ? challenger.timing.endpointAfterSpeechEndMs.p95 -
              baseline.timing.endpointAfterSpeechEndMs.p95
            : null,
        speechEndToFinalP95Ms:
          Number.isFinite(challenger.timing.speechEndToFinalMs.p95) &&
          Number.isFinite(baseline.timing.speechEndToFinalMs.p95)
            ? challenger.timing.speechEndToFinalMs.p95 -
              baseline.timing.speechEndToFinalMs.p95
            : null
      }
    },
    rateDeltas: {
      convention:
        "challenger-minus-baseline; negative latency/WER is better",
      ...rateDeltas
    },
    recommendation: {
      decision,
      recommendedConfiguration:
        decision === "promote-challenger"
          ? experiment.challengerId
          : decision === "reject-challenger"
            ? experiment.baselineId
            : null,
      evidenceAdequate,
      hardSafe,
      nonInferiorityEstablished,
      safe,
      beneficial,
      evidenceChecks,
      safetyChecks,
      benefitChecks,
      failedEvidenceChecks: Object.entries(evidenceChecks)
        .filter(([, pass]) => !pass)
        .map(([check]) => check),
      failedSafetyChecks: Object.entries(safetyChecks)
        .filter(([, pass]) => !pass)
        .map(([check]) => check),
      failedBenefitChecks: Object.entries(benefitChecks)
        .filter(([, pass]) => !pass)
        .map(([check]) => check),
      operationalAction:
        decision === "promote-challenger"
          ? "adotar challenger neste escopo"
          : "manter baseline operacional até nova evidência",
      note:
        "Falha em provar não inferioridade produz inconclusivo; reject exige regressão dura. p95 só é publicado com amostra agregada suficiente e ao menos duas observações na cauda."
    }
  };
}

function parseArgs(args) {
  const options = {
    analyzeReport: null,
    experiment: DEFAULT_EXPERIMENT,
    out: DEFAULT_REPORT,
    repetitions: null,
    resumeReport: null
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      ["--analyze-report", "--experiment", "--out",
        "--repetitions", "--resume-report"].includes(argument)
    ) {
      const field = argument.slice(2).replace(
        /-([a-z])/gu,
        (_, letter) => letter.toUpperCase()
      );
      const value = args[++index];
      options[field] = field === "repetitions"
        ? Number.parseInt(value, 10)
        : value;
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  if (
    options.repetitions !== null &&
    (!Number.isInteger(options.repetitions) || options.repetitions < 1)
  ) {
    throw new RangeError("repetitions precisa ser inteiro positivo");
  }
  return options;
}

function expectedHealth(candidate) {
  return {
    completeSilenceMs: candidate.endpointCompleteMs,
    incompleteSilenceMs: candidate.endpointIncompleteMs,
    noTranscriptSilenceMs: candidate.endpointNoTranscriptMs,
    pauseFrames: candidate.vadPauseFrames,
    mergeWindowMs: candidate.mergeWindowMs
  };
}

function verifyHealth(candidate, health) {
  const expected = expectedHealth(candidate);
  const actual = {
    completeSilenceMs:
      health?.interaction?.endpoint?.completeSilenceMs,
    incompleteSilenceMs:
      health?.interaction?.endpoint?.incompleteSilenceMs,
    noTranscriptSilenceMs:
      health?.interaction?.endpoint?.noTranscriptSilenceMs,
    pauseFrames: health?.interaction?.vad?.pauseFrames,
    mergeWindowMs: health?.interaction?.mergeWindowMs
  };
  return {
    pass: Object.entries(expected).every(
      ([field, value]) => actual[field] === value
    ),
    expected,
    actual
  };
}

async function waitForServer(url, child, timeoutMs, logs) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `servidor encerrou antes de ficar pronto: ${logs.join("\n")}`
      );
    }
    try {
      const response = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(1_000)
      });
      if (response.ok) {
        const health = await response.json();
        if (
          health.asr?.state === "ready" &&
          health.tts?.state === "ready"
        ) {
          return {
            health,
            readyAfterMs: round(performance.now() - startedAt)
          };
        }
      }
    } catch {
      // Processo ainda aquecendo.
    }
    await delay(200);
  }
  throw new Error(`servidor não ficou pronto em ${timeoutMs} ms`);
}

async function assertPortFree(url) {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(500)
    });
    if (response.ok) {
      throw new Error(`porta de experimento já ocupada: ${url}`);
    }
  } catch (error) {
    if (error.message.startsWith("porta de experimento")) {
      throw error;
    }
  }
}

async function startCandidate(candidate, experiment) {
  const port = experiment.server.port;
  const httpUrl = `http://127.0.0.1:${port}`;
  await assertPortFree(httpUrl);
  const logs = [];
  const child = spawn(
    process.execPath,
    ["src/cli/serve.mjs"],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        BRAIN_PROVIDER: "local",
        HOST: "127.0.0.1",
        PORT: String(port),
        ENDPOINT_COMPLETE_MS:
          String(candidate.endpointCompleteMs),
        ENDPOINT_INCOMPLETE_MS:
          String(candidate.endpointIncompleteMs),
        ENDPOINT_NO_TRANSCRIPT_MS:
          String(candidate.endpointNoTranscriptMs),
        ENDPOINT_MERGE_WINDOW_MS:
          String(candidate.mergeWindowMs),
        VAD_PAUSE_FRAMES: String(candidate.vadPauseFrames)
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const consume = (prefix) => (chunk) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/u)) {
      if (line) {
        logs.push(`${prefix}${line}`);
      }
    }
    logs.splice(0, Math.max(0, logs.length - 80));
  };
  child.stdout.on("data", consume(""));
  child.stderr.on("data", consume("stderr: "));
  try {
    const ready = await waitForServer(
      httpUrl,
      child,
      experiment.server.readyTimeoutMs,
      logs
    );
    const verification = verifyHealth(candidate, ready.health);
    if (!verification.pass) {
      throw new Error(
        `configuração efetiva divergiu: ${JSON.stringify(verification)}`
      );
    }
    return {
      child,
      health: ready.health,
      logs,
      readyAfterMs: ready.readyAfterMs,
      verification,
      wsUrl: `ws://127.0.0.1:${port}/api/audio`
    };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

async function stopCandidate(instance) {
  const child = instance?.child;
  if (!child || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolvePromise) => {
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal, forced: false });
    });
  });
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited,
    delay(5_000).then(() => null)
  ]);
  if (graceful) {
    return graceful;
  }
  child.kill("SIGKILL");
  return new Promise((resolvePromise) => {
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal, forced: true });
    });
  });
}

function candidateOrder(experiment, repetition) {
  return repetition % 2 === 1
    ? [...experiment.candidates]
    : [...experiment.candidates].reverse();
}

function compactCase(item) {
  return {
    ...item,
    events: item.events.filter((event) => [
      "audio.frames.dropped",
      "audio.frame.rejected",
      "audio.error",
      "client.observation.timeout",
      "endpoint.committed",
      "transcript.cancelled",
      "transcript.final",
      "transcript.merged",
      "transcript.merging",
      "transcript.rejected",
      "user.speech.started"
    ].includes(event.type))
  };
}

async function runExperiment(experiment, initial = {}) {
  const observations = structuredClone(initial.observations ?? []);
  const runs = structuredClone(initial.runs ?? []);
  const startedAt = performance.now();
  for (
    let repetition = 1;
    repetition <= experiment.repetitions;
    repetition += 1
  ) {
    const order = candidateOrder(experiment, repetition);
    for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
      const candidate = order[orderIndex];
      if (
        runs.some(
          (item) =>
            item.repetition === repetition &&
            item.candidateId === candidate.id &&
            item.status === "completed"
        )
      ) {
        continue;
      }
      process.stdout.write(
        `Rodada ${repetition}/${experiment.repetitions}, ` +
        `${candidate.id}... `
      );
      let instance = null;
      const runStartedAt = performance.now();
      const metadata = {
        repetition,
        orderIndex,
        candidateId: candidate.id,
        status: "error",
        configurationVerified: false
      };
      try {
        instance = await startCandidate(candidate, experiment);
        metadata.configurationVerified = instance.verification.pass;
        metadata.configuration = instance.verification.actual;
        metadata.serverReadyMs = instance.readyAfterMs;
        const campaign = await runCampaign({
          caseIds: experiment.caseIds,
          cohort: "all",
          failOnHold: false,
          finalTimeoutMs: experiment.server.finalTimeoutMs,
          frameMs: 20,
          json: true,
          out: null,
          pack: experiment.pack,
          realtime: true,
          tailSilenceMs: experiment.server.tailSilenceMs,
          url: instance.wsUrl
        });
        for (const item of campaign.cases) {
          const compact = compactCase(item);
          observations.push({
            repetition,
            orderIndex,
            candidateId: candidate.id,
            case: compact
          });
        }
        metadata.status = "completed";
        metadata.caseCount = campaign.cases.length;
        metadata.asr = campaign.candidate;
        console.log(`ok (${campaign.cases.length} casos)`);
      } catch (error) {
        metadata.error = {
          name: error.name,
          code: error.code ?? null,
          message: error.message
        };
        console.log(`erro: ${error.message}`);
      } finally {
        metadata.elapsedMs = round(performance.now() - runStartedAt);
        metadata.shutdown = await stopCandidate(instance);
        runs.push(metadata);
        await delay(300);
      }
    }
  }
  const comparison = compareCandidates(experiment, observations, runs);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    experiment: {
      id: experiment.id,
      plannedRepetitions:
        experiment.plannedRepetitions ?? experiment.repetitions,
      repetitions: experiment.repetitions,
      adaptiveExtensionReason:
        experiment.adaptiveExtensionReason ?? null,
      counterbalancedOrder:
        "rodadas ímpares baseline→challenger; pares challenger→baseline",
      minAggregateSamplesForP95:
        experiment.minAggregateSamplesForP95,
      caseIds: experiment.caseIds,
      candidates: experiment.candidates,
      decisionGate: experiment.decisionGate
    },
    execution: {
      elapsedMs: round(
        (initial.elapsedMs ?? 0) + performance.now() - startedAt
      ),
      paidApiCalls: 0,
      externalLlmUsed: false,
      isolatedServerPerCandidatePerRound: true,
      resumedFrom: initial.resumedFrom ?? null
    },
    comparison,
    runs,
    observations,
    limitations: [
      "Áudio sintético reproduzível não representa microfone, sala ou eco.",
      `Bootstrap pareado é descritivo; ${experiment.repetitions} repetições por cenário ainda não substituem validação humana.`,
      "Latência sem transcript.final é tratada como falha de cobertura, nunca como observação rápida.",
      "A promoção vale apenas para a configuração endpoint/VAD medida."
    ]
  };
}

function printSummary(report, output) {
  const comparison = report.comparison;
  const baseline = comparison.summaries[comparison.baselineId];
  const challenger = comparison.summaries[comparison.challengerId];
  const endpoint = comparison.paired.endpoint;
  const final = comparison.paired.speechEndToFinal;
  console.log("\nA/B endpoint full-duplex PT-BR");
  console.log(
    `Decisão: ${comparison.recommendation.decision.toUpperCase()}`
  );
  console.log(
    `Endpoint mediano: ${baseline.timing.endpointAfterSpeechEndMs.p50} → ` +
    `${challenger.timing.endpointAfterSpeechEndMs.p50} ms; ` +
    `delta pareado ${endpoint.deltaMs.p50} ms, IC bootstrap ` +
    `[${endpoint.bootstrapMedian95CiMs.low}, ` +
    `${endpoint.bootstrapMedian95CiMs.high}]`
  );
  console.log(
    `Fim de fala→final mediano: ` +
    `${baseline.timing.speechEndToFinalMs.p50} → ` +
    `${challenger.timing.speechEndToFinalMs.p50} ms; ` +
    `delta pareado ${final.deltaMs.p50} ms`
  );
  console.log(
    `Correções coerentes: ${baseline.correctionSuccesses}/` +
    `${baseline.correctionObservations} → ` +
    `${challenger.correctionSuccesses}/` +
    `${challenger.correctionObservations}`
  );
  console.log(
    `Finais: ${baseline.finalized}/${baseline.speechObservations} → ` +
    `${challenger.finalized}/${challenger.speechObservations}; ` +
    `backlog máx. ${baseline.transport.maxBufferedAmountBytes} → ` +
    `${challenger.transport.maxBufferedAmountBytes} bytes`
  );
  console.log(`Relatório: ${output}\n`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const experiment = JSON.parse(await readFile(
    resolve(PROJECT_ROOT, options.experiment),
    "utf8"
  ));
  if (options.analyzeReport && options.resumeReport) {
    throw new TypeError(
      "--analyze-report e --resume-report são mutuamente exclusivos"
    );
  }
  const previousPath = options.analyzeReport ?? options.resumeReport;
  const previous = previousPath
    ? JSON.parse(await readFile(
        resolve(PROJECT_ROOT, previousPath),
        "utf8"
      ))
    : null;
  const configuredRepetitions = experiment.repetitions;
  if (
    options.repetitions === null &&
    Number.isInteger(previous?.experiment?.repetitions)
  ) {
    experiment.repetitions = previous.experiment.repetitions;
    experiment.minRepetitionsPerScenario = experiment.repetitions;
    const speechCases = experiment.caseIds.length - 1;
    experiment.decisionGate.minPairedEndpointSamples =
      experiment.repetitions * speechCases;
    experiment.decisionGate.minPairedSpeechEndToFinalSamples =
      experiment.repetitions * speechCases;
  }
  if (options.repetitions !== null) {
    experiment.repetitions = options.repetitions;
    experiment.minRepetitionsPerScenario = options.repetitions;
    const speechCases = experiment.caseIds.length - 1;
    experiment.decisionGate.minPairedEndpointSamples =
      options.repetitions * speechCases;
    experiment.decisionGate.minPairedSpeechEndToFinalSamples =
      options.repetitions * speechCases;
  }
  experiment.plannedRepetitions =
    previous?.experiment?.plannedRepetitions ??
    previous?.experiment?.repetitions ??
    configuredRepetitions;
  if (experiment.repetitions > experiment.plannedRepetitions) {
    experiment.adaptiveExtensionReason =
      "Uma rodada adicional equilibra challenger-first/challenger-second; limiares não foram alterados.";
  }
  let report;
  if (options.analyzeReport) {
    report = {
      ...previous,
      generatedAt: new Date().toISOString(),
      execution: {
        ...previous.execution,
        reanalyzedFrom: options.analyzeReport
      },
      comparison: compareCandidates(
        experiment,
        previous.observations,
        previous.runs
      )
    };
  } else if (options.resumeReport) {
    if (previous.experiment?.id !== experiment.id) {
      throw new Error("relatório anterior pertence a outro experimento");
    }
    report = await runExperiment(experiment, {
      elapsedMs: previous.execution?.elapsedMs ?? 0,
      observations: previous.observations,
      resumedFrom: options.resumeReport,
      runs: previous.runs
    });
  } else {
    report = await runExperiment(experiment);
  }
  const outputPath = resolve(PROJECT_ROOT, options.out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report, options.out);
  if (
    report.comparison.recommendation.decision !==
    "promote-challenger"
  ) {
    process.exitCode = 1;
  }
  return report;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  await main();
}
