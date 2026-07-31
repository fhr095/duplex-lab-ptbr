import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import WebSocket from "ws";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import {
  normalizeTranscript,
  scoreTranscript
} from "../src/eval/transcript-metrics.mjs";
import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  measureUsageDelta,
  RUNTIME_FINGERPRINT_ROOTS
} from "../src/eval/runtime-provenance.mjs";
import { encodePcmFrame } from "../web/pcm-wire.mjs";
import {
  extractPtBrCurrencyAmounts
} from "../src/interaction/ptbr-number.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_PACK =
  "eval/scenarios/live-audio-campaign.pt-BR.json";
const DEFAULT_REPORT =
  "eval/reports/live-audio-campaign-latest.json";
const VAD_INFERENCE_P95_LIMIT_MS = 5;
const VAD_INFERENCE_P99_LIMIT_MS = 20;
const NON_USEFUL_PARTIAL_WORDS = new Set([
  "a",
  "ahn",
  "ahm",
  "assim",
  "de",
  "do",
  "e",
  "eh",
  "em",
  "é",
  "hm",
  "hum",
  "o",
  "que",
  "tipo"
]);

function round(value, places = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function percentile(values, ratio) {
  const finite = values.filter(Number.isFinite).sort((left, right) =>
    left - right
  );
  if (finite.length === 0) {
    return null;
  }
  return finite[Math.max(0, Math.ceil(finite.length * ratio) - 1)];
}

export function isUsefulPartial(text) {
  return normalizeTranscript(text)
    .split(" ")
    .filter(Boolean)
    .some((word) => !NON_USEFUL_PARTIAL_WORDS.has(word));
}

export function applyPcmGain(pcm, gain = 1) {
  if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0) {
    throw new TypeError("PCM16 precisa ser um Buffer alinhado");
  }
  if (!Number.isFinite(gain) || gain <= 0 || gain > 4) {
    throw new RangeError("gain precisa estar em (0, 4]");
  }
  if (gain === 1) {
    return Buffer.from(pcm);
  }
  const scaled = Buffer.allocUnsafe(pcm.length);
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const sample = Math.round(pcm.readInt16LE(offset) * gain);
    scaled.writeInt16LE(
      Math.max(-32_768, Math.min(32_767, sample)),
      offset
    );
  }
  return scaled;
}

export function phraseIncluded(text, phrase) {
  const expectedAmounts = extractPtBrCurrencyAmounts(phrase);
  if (expectedAmounts.length === 1) {
    const actualValues = new Set(
      extractPtBrCurrencyAmounts(text).map((item) => item.value)
    );
    return actualValues.has(expectedAmounts[0].value);
  }
  const normalizedText = ` ${normalizeTranscript(text)} `;
  const normalizedPhrase = normalizeTranscript(phrase);
  return normalizedPhrase.length > 0 &&
    normalizedText.includes(` ${normalizedPhrase} `);
}

function countLostFrames(events) {
  return events
    .filter((event) => event.type === "audio.frames.dropped")
    .reduce((sum, event) => sum + (Number(event.lostFrames) || 0), 0);
}

function countLostSamples(events) {
  return events
    .filter((event) => event.type === "audio.frames.dropped")
    .reduce((sum, event) => sum + (Number(event.lostSamples) || 0), 0);
}

function firstEvent(events, predicate) {
  return events.find(predicate) ?? null;
}

function verifyAudioFlush(flush, sentFrames) {
  const watermark = flush?.watermark;
  const control = flush?.vadControl;
  const shadow = flush?.vadShadow;
  const pipeline = flush?.pipeline;
  const transportPass =
    Number.isSafeInteger(watermark?.expectedSequence) &&
    watermark.expectedSequence === sentFrames - 1 &&
    Number.isSafeInteger(watermark?.expectedSampleEnd) &&
    watermark.expectedSampleEnd > 0 &&
    watermark.receivedSequence >= watermark.expectedSequence &&
    watermark.receivedSampleEnd >= watermark.expectedSampleEnd;
  const controlPass =
    control?.health?.engine !== "silero-vad" ||
    (
      control.telemetry?.inferenceErrorCount === 0 &&
      control.telemetry?.gapResetCount === 0 &&
      control.telemetry?.inferenceMs?.p95 !== null &&
      control.telemetry?.inferenceMs?.p95 <
        VAD_INFERENCE_P95_LIMIT_MS &&
      control.telemetry?.inferenceMs?.p99 !== null &&
      control.telemetry?.inferenceMs?.p99 <
        VAD_INFERENCE_P99_LIMIT_MS &&
      control.telemetry?.lastProcessedSampleEnd >=
        watermark?.expectedFullWindowEnd
    );
  const shadowPass =
    shadow?.health?.state !== "ready" ||
    (
      shadow.telemetry?.resetCount === 0 &&
      shadow.telemetry?.overflowCount === 0 &&
      shadow.telemetry?.staleResultCount === 0 &&
      shadow.telemetry?.inferenceMs?.p95 !== null &&
      shadow.telemetry?.inferenceMs?.p95 <
        VAD_INFERENCE_P95_LIMIT_MS &&
      shadow.telemetry?.inferenceMs?.p99 !== null &&
      shadow.telemetry?.inferenceMs?.p99 <
        VAD_INFERENCE_P99_LIMIT_MS &&
      shadow.telemetry?.lastProcessedSampleEnd >=
        watermark?.expectedFullWindowEnd
    );
  const pipelinePass =
    pipeline?.overflowCount === 0 &&
    pipeline?.processingErrorCount === 0 &&
    pipeline?.lastProcessedSequence >=
      watermark?.expectedSequence &&
    pipeline?.lastProcessedSampleEnd >=
      watermark?.expectedSampleEnd &&
    pipeline?.queueDelayMs?.p99 !== null &&
    pipeline?.queueDelayMs?.p99 < 10;
  return {
    pass:
      transportPass &&
      controlPass &&
      shadowPass &&
      pipelinePass,
    transportPass,
    controlPass,
    shadowPass,
    pipelinePass
  };
}

export function analyzeObservedCase(definition, observation) {
  const events = observation.events ?? [];
  const speechStarts = events.filter(
    (event) => event.type === "user.speech.started"
  );
  const endpoints = events.filter(
    (event) => event.type === "endpoint.committed"
  );
  const finals = events.filter(
    (event) => event.type === "transcript.final"
  );
  const firstPartial = firstEvent(
    events,
    (event) => event.type === "transcript.partial" && event.text
  );
  const firstUsefulPartial = firstEvent(
    events,
    (event) =>
      event.type === "transcript.partial" &&
      isUsefulPartial(event.text)
  );
  const firstSpeech = speechStarts[0] ?? null;
  const final = finals.at(-1) ?? null;
  const finalEndpoint =
    (
      final
        ? endpoints.findLast(
            (event) => event.turnId === final.turnId
          )
        : null
    ) ??
    endpoints.at(-1) ??
    null;
  const expectedSpeech = definition.expectSpeech !== false;
  const activeStartAtMs =
    observation.activeStartOffsetMs === null ||
    observation.activeStartOffsetMs === undefined
      ? null
      : observation.streamStartedAtMs + observation.activeStartOffsetMs;
  const activeEndAtMs =
    observation.activeEndOffsetMs === null ||
    observation.activeEndOffsetMs === undefined
      ? null
      : observation.streamStartedAtMs + observation.activeEndOffsetMs;
  const activeSpeechDurationMs =
    observation.activeStartOffsetMs === null ||
    observation.activeStartOffsetMs === undefined ||
    observation.activeEndOffsetMs === null ||
    observation.activeEndOffsetMs === undefined
      ? null
      : Math.max(
          0,
          observation.activeEndOffsetMs -
            observation.activeStartOffsetMs
        );
  const expectedWordCount = normalizeTranscript(
    definition.expected ?? ""
  ).split(" ").filter(Boolean).length;
  const usefulPartialRequired =
    definition.requireUsefulPartial ??
    (
      expectedSpeech &&
      expectedWordCount >= 2 &&
      activeSpeechDurationMs >= 1_000
    );
  const actual = final?.text ?? "";
  const transcript = expectedSpeech
    ? scoreTranscript(definition.expected ?? "", actual)
    : null;
  const requiredPhrases = definition.requiredPhrases ?? [];
  const matchedPhrases = requiredPhrases.filter((phrase) =>
    phraseIncluded(actual, phrase)
  );
  const firstTurnId = firstSpeech?.turnId ?? null;
  const mergedTurnIds = Array.isArray(final?.mergedTurnIds)
    ? final.mergedTurnIds
    : [];
  const coherentPhysicalTurn =
    expectedSpeech &&
    speechStarts.length === 1 &&
    endpoints.length === 1 &&
    finals.length === 1 &&
    firstTurnId !== null &&
    endpoints[0].turnId === firstTurnId &&
    finals[0].turnId === firstTurnId;
  const recoveredMergedTurn =
    expectedSpeech &&
    finals.length === 1 &&
    speechStarts.length > 1 &&
    endpoints.length === speechStarts.length &&
    mergedTurnIds.length === speechStarts.length &&
    speechStarts.every((event) => mergedTurnIds.includes(event.turnId)) &&
    endpoints.every((event) => mergedTurnIds.includes(event.turnId));
  const coherentTurn = coherentPhysicalTurn || recoveredMergedTurn;
  const endpointAfterLastActiveMs =
    finalEndpoint && activeEndAtMs !== null
      ? finalEndpoint.receivedAtMs - activeEndAtMs
      : null;
  const rawPrematureEndpoint = endpoints.some(
    (event) =>
      activeEndAtMs !== null &&
      event.receivedAtMs - activeEndAtMs <
        -(observation.frameMs ?? 20)
  );
  const prematureEndpoint =
    rawPrematureEndpoint && !recoveredMergedTurn;
  const audioDrain = verifyAudioFlush(
    observation.audioFlush,
    observation.sentFrames ?? 0
  );

  return {
    id: definition.id,
    cohort: definition.cohort,
    evidence: definition.evidence,
    category: definition.category,
    metadata: definition.metadata ?? null,
    audio: definition.audio ?? null,
    audioSha256: observation.audioSha256 ?? null,
    gain: definition.gain ?? 1,
    expectSpeech: expectedSpeech,
    expected: expectedSpeech ? definition.expected : null,
    actual: expectedSpeech ? actual : null,
    transcript,
    criticalPhrases: {
      required: requiredPhrases,
      matched: matchedPhrases,
      recall:
        requiredPhrases.length === 0
          ? null
          : round(matchedPhrases.length / requiredPhrases.length, 4)
    },
    activity: {
      durationMs: round(observation.audioDurationMs),
      activeStartOffsetMs: round(observation.activeStartOffsetMs),
      activeEndOffsetMs: round(observation.activeEndOffsetMs),
      activeSpeechDurationMs: round(activeSpeechDurationMs)
    },
    partialExpectation: {
      required: usefulPartialRequired,
      rationale: usefulPartialRequired
        ? "fala com ao menos duas palavras e 1 s de atividade"
        : "fala curta demais para uma parcial útil antes da final"
    },
    eventCounts: {
      speechStarts: speechStarts.length,
      speechPauses: events.filter(
        (event) => event.type === "user.speech.paused"
      ).length,
      speechResumes: events.filter(
        (event) => event.type === "user.speech.resumed"
      ).length,
      partials: events.filter(
        (event) => event.type === "transcript.partial"
      ).length,
      endpoints: endpoints.length,
      finals: finals.length,
      cancelledTranscripts: events.filter(
        (event) => event.type === "transcript.cancelled"
      ).length,
      observationTimeouts: events.filter(
        (event) => event.type === "client.observation.timeout"
      ).length
    },
    turnIntegrity: {
      coherentSingleTurn: coherentTurn,
      prematureEndpoint,
      rawPrematureEndpoint,
      recoveredByMerge: recoveredMergedTurn,
      mergedTurnIds
    },
    timing: {
      realtimeEvidence: observation.realtime === true,
      onsetDetectionMs:
        firstSpeech && activeStartAtMs !== null
          ? round(firstSpeech.receivedAtMs - activeStartAtMs)
          : null,
      firstPartialAfterSpeechStartMs:
        firstPartial && firstSpeech
          ? round(firstPartial.receivedAtMs - firstSpeech.receivedAtMs)
          : null,
      firstUsefulPartialAfterSpeechStartMs:
        firstUsefulPartial && firstSpeech
          ? round(
              firstUsefulPartial.receivedAtMs -
              firstSpeech.receivedAtMs
            )
          : null,
      endpointAfterLastActiveMs: round(endpointAfterLastActiveMs),
      finalAfterEndpointMs:
        final && finalEndpoint
          ? round(final.receivedAtMs - finalEndpoint.receivedAtMs)
          : null,
      totalUntilFinalMs:
        final
          ? round(final.receivedAtMs - observation.streamStartedAtMs)
          : null
    },
    transport: {
      intendedFrames: observation.intendedFrames ?? 0,
      sentFrames: observation.sentFrames ?? 0,
      clientUnsentFrames: Math.max(
        0,
        (observation.intendedFrames ?? 0) -
        (observation.sentFrames ?? 0)
      ),
      maxBufferedAmountBytes:
        observation.maxBufferedAmountBytes ?? null,
      serverDroppedFrameEvents: events.filter(
        (event) => event.type === "audio.frames.dropped"
      ).length,
      serverLostFrames: countLostFrames(events),
      serverLostSamples: countLostSamples(events),
      rejectedFrames: events.filter(
        (event) => event.type === "audio.frame.rejected"
      ).length,
      protocolErrors: events.filter(
        (event) =>
          event.type === "audio.error" ||
          event.type === "client.protocol.error"
      ).length,
      audioDrainVerified: audioDrain.pass,
      audioDrainChecks: audioDrain,
      audioFlush: observation.audioFlush ?? null
    },
    events
  };
}

function cohortSummary(cases) {
  const speechCases = cases.filter((item) => item.expectSpeech);
  const realtimeCases = speechCases.filter(
    (item) => item.timing.realtimeEvidence
  );
  const usefulPartialCases = realtimeCases.filter(
    (item) => item.partialExpectation.required
  );
  const latency = (field) =>
    (
      field === "firstUsefulPartialAfterSpeechStartMs"
        ? usefulPartialCases
        : realtimeCases
    )
      .map((item) => item.timing[field])
      .filter(Number.isFinite);
  let totalErrors = 0;
  let totalExpectedWords = 0;
  let requiredPhrases = 0;
  let matchedPhrases = 0;

  for (const item of speechCases) {
    totalErrors += item.transcript?.errors ?? 0;
    totalExpectedWords += item.transcript?.expectedWords ?? 0;
    requiredPhrases += item.criticalPhrases.required.length;
    matchedPhrases += item.criticalPhrases.matched.length;
  }

  const timing = {};
  for (const field of [
    "onsetDetectionMs",
    "firstPartialAfterSpeechStartMs",
    "firstUsefulPartialAfterSpeechStartMs",
    "endpointAfterLastActiveMs",
    "finalAfterEndpointMs",
    "totalUntilFinalMs"
  ]) {
    const values = latency(field);
    timing[field] = {
      measuredCases: values.length,
      p50: round(percentile(values, 0.5)),
      p95: round(percentile(values, 0.95)),
      max: round(percentile(values, 1))
    };
  }

  return {
    caseCount: cases.length,
    speechCaseCount: speechCases.length,
    detectedCases: speechCases.filter(
      (item) => item.eventCounts.speechStarts > 0
    ).length,
    finalizedCases: speechCases.filter(
      (item) => item.eventCounts.finals > 0
    ).length,
    coherentSingleTurnCases: speechCases.filter(
      (item) => item.turnIntegrity.coherentSingleTurn
    ).length,
    prematureEndpointCases: speechCases.filter(
      (item) => item.turnIntegrity.prematureEndpoint
    ).length,
    realtimeEvidenceCases: realtimeCases.length,
    usefulPartialExpectedCases: usefulPartialCases.length,
    transcript: {
      errors: totalErrors,
      expectedWords: totalExpectedWords,
      corpusWer:
        totalExpectedWords === 0
          ? null
          : round(totalErrors / totalExpectedWords, 4),
      maxCaseWer: round(percentile(
        speechCases
          .map((item) => item.transcript?.wer)
          .filter(Number.isFinite),
        1
      ), 4)
    },
    criticalPhrases: {
      required: requiredPhrases,
      matched: matchedPhrases,
      recall:
        requiredPhrases === 0
          ? null
          : round(matchedPhrases / requiredPhrases, 4)
    },
    timing,
    transport: {
      clientUnsentFrames: cases.reduce(
        (sum, item) => sum + item.transport.clientUnsentFrames,
        0
      ),
      serverLostFrames: cases.reduce(
        (sum, item) => sum + item.transport.serverLostFrames,
        0
      ),
      serverLostSamples: cases.reduce(
        (sum, item) => sum + item.transport.serverLostSamples,
        0
      ),
      rejectedFrames: cases.reduce(
        (sum, item) => sum + item.transport.rejectedFrames,
        0
      ),
      protocolErrors: cases.reduce(
        (sum, item) => sum + item.transport.protocolErrors,
        0
      ),
      failedAudioDrains: cases.filter(
        (item) => !item.transport.audioDrainVerified
      ).length,
      maxBufferedAmountBytes: round(percentile(
        cases
          .map((item) => item.transport.maxBufferedAmountBytes)
          .filter(Number.isFinite),
        1
      ))
    }
  };
}

function latencyCheck(
  summary,
  metric,
  threshold,
  expectedCases = summary.speechCaseCount
) {
  return summary.realtimeEvidenceCases === summary.speechCaseCount &&
    expectedCases > 0 &&
    summary.timing[metric].measuredCases === expectedCases &&
    Number.isFinite(summary.timing[metric].p95) &&
    summary.timing[metric].p95 <= threshold;
}

function evaluateSpeechCohort(name, summary, gate) {
  if (!summary || summary.speechCaseCount === 0) {
    return {
      status: "not-run",
      pass: false,
      checks: {},
      failures: ["cohort-not-run"]
    };
  }
  const maxCorpusWer = name === "human"
    ? gate.maxHumanCorpusWer
    : gate.maxSyntheticCorpusWer;
  const checks = {
    detectedEveryCase:
      summary.detectedCases === summary.speechCaseCount,
    finalizedEveryCase:
      summary.finalizedCases === summary.speechCaseCount,
    coherentSingleTurn:
      summary.coherentSingleTurnCases === summary.speechCaseCount,
    noPrematureEndpoint: summary.prematureEndpointCases === 0,
    realtimeLatencyEvidence:
      summary.realtimeEvidenceCases === summary.speechCaseCount,
    onsetP95:
      latencyCheck(
        summary,
        "onsetDetectionMs",
        gate.maxOnsetP95Ms
      ),
    usefulPartialP95:
      summary.usefulPartialExpectedCases === 0 ||
      latencyCheck(
        summary,
        "firstUsefulPartialAfterSpeechStartMs",
        gate.maxFirstUsefulPartialP95Ms,
        summary.usefulPartialExpectedCases
      ),
    endpointP95:
      latencyCheck(
        summary,
        "endpointAfterLastActiveMs",
        gate.maxEndpointP95Ms
      ),
    finalAfterEndpointP95:
      latencyCheck(
        summary,
        "finalAfterEndpointMs",
        gate.maxFinalAfterEndpointP95Ms
      ),
    corpusWer:
      Number.isFinite(summary.transcript.corpusWer) &&
      summary.transcript.corpusWer <= maxCorpusWer,
    perCaseWer:
      Number.isFinite(summary.transcript.maxCaseWer) &&
      summary.transcript.maxCaseWer <= gate.maxPerCaseWer,
    criticalPhraseRecall:
      summary.criticalPhrases.required === 0 ||
      summary.criticalPhrases.recall >= gate.minCriticalPhraseRecall,
    zeroClientLoss:
      summary.transport.clientUnsentFrames <= gate.maxLostFrames,
    zeroServerLoss:
      summary.transport.serverLostFrames <= gate.maxLostFrames,
    boundedClientBacklog:
      Number.isFinite(summary.transport.maxBufferedAmountBytes) &&
      summary.transport.maxBufferedAmountBytes <=
        gate.maxBufferedAmountBytes,
    zeroRejectedFrames:
      summary.transport.rejectedFrames <= gate.maxRejectedFrames,
    zeroProtocolErrors:
      summary.transport.protocolErrors <= gate.maxProtocolErrors,
    drainedServerPipeline:
      summary.transport.failedAudioDrains === 0
  };
  const failures = Object.entries(checks)
    .filter(([, pass]) => !pass)
    .map(([check]) => check);
  return {
    status: failures.length === 0 ? "promote" : "hold",
    pass: failures.length === 0,
    checks,
    failures,
    thresholds: {
      maxCorpusWer,
      maxPerCaseWer: gate.maxPerCaseWer,
      minCriticalPhraseRecall: gate.minCriticalPhraseRecall,
      maxOnsetP95Ms: gate.maxOnsetP95Ms,
      maxFirstUsefulPartialP95Ms:
        gate.maxFirstUsefulPartialP95Ms,
      maxEndpointP95Ms: gate.maxEndpointP95Ms,
      maxFinalAfterEndpointP95Ms:
        gate.maxFinalAfterEndpointP95Ms,
      maxBufferedAmountBytes: gate.maxBufferedAmountBytes
    }
  };
}

function evaluateControl(cases, gate) {
  if (cases.length === 0) {
    return {
      status: gate.requireSilenceControl ? "not-run" : "not-required",
      pass: !gate.requireSilenceControl,
      checks: {
        present: !gate.requireSilenceControl
      },
      failures: gate.requireSilenceControl
        ? ["silence-control-not-run"]
        : []
    };
  }
  const falseActivations = cases.reduce(
    (sum, item) => sum + item.eventCounts.speechStarts,
    0
  );
  const falseFinals = cases.reduce(
    (sum, item) => sum + item.eventCounts.finals,
    0
  );
  const transportErrors = cases.reduce(
    (sum, item) =>
      sum +
      item.transport.clientUnsentFrames +
      item.transport.serverLostFrames +
      item.transport.rejectedFrames +
      item.transport.protocolErrors +
      (item.transport.audioDrainVerified ? 0 : 1),
    0
  );
  const checks = {
    present: true,
    noFalseActivation: falseActivations === 0,
    noFalseFinal: falseFinals === 0,
    transportIntegrity: transportErrors === 0
  };
  const failures = Object.entries(checks)
    .filter(([, pass]) => !pass)
    .map(([check]) => check);
  return {
    status: failures.length === 0 ? "promote" : "hold",
    pass: failures.length === 0,
    checks,
    failures,
    observations: {
      caseCount: cases.length,
      falseActivations,
      falseFinals
    }
  };
}

export function evaluateCampaign(pack, cases) {
  const gateConfig = pack.gate;
  if (!gateConfig) {
    throw new TypeError("pack precisa declarar gate");
  }
  const byCohort = Object.fromEntries(
    ["synthetic", "human", "control"].map((cohort) => [
      cohort,
      cases.filter((item) => item.cohort === cohort)
    ])
  );
  const summaries = {
    synthetic: cohortSummary(byCohort.synthetic),
    human: cohortSummary(byCohort.human),
    control: cohortSummary(byCohort.control)
  };
  const synthetic = evaluateSpeechCohort(
    "synthetic",
    summaries.synthetic,
    gateConfig
  );
  const human = evaluateSpeechCohort(
    "human",
    summaries.human,
    gateConfig
  );
  const control = evaluateControl(byCohort.control, gateConfig);
  const structuralChecks = [
    control.pass,
    ...[synthetic, human]
      .filter((gate) => gate.status !== "not-run")
      .flatMap((gate) => [
        gate.checks.detectedEveryCase,
        gate.checks.finalizedEveryCase,
        gate.checks.coherentSingleTurn,
        gate.checks.noPrematureEndpoint,
        gate.checks.realtimeLatencyEvidence,
        gate.checks.onsetP95,
        gate.checks.usefulPartialP95,
        gate.checks.endpointP95,
        gate.checks.finalAfterEndpointP95,
        gate.checks.zeroClientLoss,
        gate.checks.zeroServerLoss,
        gate.checks.boundedClientBacklog,
        gate.checks.zeroRejectedFrames,
        gate.checks.zeroProtocolErrors,
        gate.checks.drainedServerPipeline
      ])
  ];
  const operabilityPass =
    structuralChecks.length > 1 && structuralChecks.every(Boolean);
  const qualityPass =
    synthetic.pass && human.pass && control.pass;

  return {
    id: gateConfig.id,
    decision: qualityPass ? "promote" : "hold",
    automatedPass: qualityPass,
    operability: {
      decision: operabilityPass ? "promote" : "hold",
      pass: operabilityPass,
      scope:
        "PCM injetado no WebSocket local: VAD, endpoint, ASR e transporte"
    },
    cohorts: {
      synthetic,
      human,
      control
    },
    summaries,
    userFacingReadiness: {
      decision: "hold",
      pass: false,
      blockers: [
        "microphone-and-browser-capture-not-measured",
        "echo-cancellation-and-self-trigger-not-measured",
        "audible-barge-in-stop-not-measured",
        "human-naturalness-judgment-not-measured"
      ],
      note:
        "Este gate promove regressões do pipeline injetado, não a experiência acústica completa."
    }
  };
}

function parseArgs(args) {
  const options = {
    caseIds: [],
    cohort: "all",
    failOnHold: true,
    frameMs: 20,
    json: false,
    out: DEFAULT_REPORT,
    pack: DEFAULT_PACK,
    realtime: true,
    tailSilenceMs: 1_800,
    url:
      process.env.DUPLEX_AUDIO_URL ??
      "ws://127.0.0.1:4173/api/audio"
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--no-realtime") {
      options.realtime = false;
    } else if (argument === "--no-fail") {
      options.failOnHold = false;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--case") {
      options.caseIds.push(args[++index]);
    } else if (
      ["--cohort", "--frame-ms", "--out", "--pack",
        "--tail-silence-ms", "--url"].includes(argument)
    ) {
      const field = argument.slice(2).replace(
        /-([a-z])/gu,
        (_, letter) => letter.toUpperCase()
      );
      const value = args[++index];
      options[field] = ["frameMs", "tailSilenceMs"].includes(field)
        ? Number.parseInt(value, 10)
        : value;
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }

  if (!["all", "synthetic", "human", "control"].includes(options.cohort)) {
    throw new TypeError(`cohort inválido: ${options.cohort}`);
  }
  if (
    !Number.isInteger(options.frameMs) ||
    options.frameMs <= 0 ||
    !Number.isInteger(options.tailSilenceMs) ||
    options.tailSilenceMs < 0
  ) {
    throw new RangeError("frame-ms e tail-silence-ms inválidos");
  }
  return options;
}

function frameRms(buffer) {
  if (buffer.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    const value = buffer.readInt16LE(offset) / 32_768;
    sum += value * value;
  }
  return Math.sqrt(sum / (buffer.length / 2));
}

function inspectPcmActivity(pcm, sampleRate, frameMs) {
  const samplesPerFrame = sampleRate * frameMs / 1_000;
  if (!Number.isInteger(samplesPerFrame)) {
    throw new RangeError(
      "frame-ms não produz quantidade inteira de amostras"
    );
  }
  const bytesPerFrame = samplesPerFrame * 2;
  let firstActiveOffsetMs = null;
  let lastActiveOffsetMs = null;
  for (let offset = 0; offset < pcm.length; offset += bytesPerFrame) {
    const frame = pcm.subarray(
      offset,
      Math.min(pcm.length, offset + bytesPerFrame)
    );
    if (frame.length > 0 && frameRms(frame) >= 0.014) {
      firstActiveOffsetMs ??=
        offset / 2 / sampleRate * 1_000;
      lastActiveOffsetMs =
        (offset + frame.length) / 2 / sampleRate * 1_000;
    }
  }
  return {
    bytesPerFrame,
    firstActiveOffsetMs,
    lastActiveOffsetMs
  };
}

async function loadCaseAudio(definition, frameMs, tailSilenceMs) {
  const sampleRate = 16_000;
  let pcm;
  let audioSha256;
  if (definition.generatedSilenceMs !== undefined) {
    pcm = Buffer.alloc(
      Math.round(
        sampleRate * definition.generatedSilenceMs / 1_000
      ) * 2
    );
    audioSha256 = sha256Buffer(pcm);
  } else {
    const wave = await readFile(
      resolve(PROJECT_ROOT, definition.audio)
    );
    audioSha256 = sha256Buffer(wave);
    pcm = decodeWaveToPcm16(wave, {
      targetSampleRate: sampleRate
    }).pcm;
  }
  const activity = inspectPcmActivity(pcm, sampleRate, frameMs);
  const sourcePcm = applyPcmGain(pcm, definition.gain ?? 1);
  const tail = definition.expectSpeech === false
    ? Buffer.alloc(0)
    : Buffer.alloc(
        Math.round(sampleRate * tailSilenceMs / 1_000) * 2
      );
  return {
    sampleRate,
    audioSha256,
    sourcePcm,
    streamPcm: Buffer.concat([sourcePcm, tail]),
    ...activity
  };
}

function waitForEvent(events, type, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const deadline = performance.now() + timeoutMs;
    const poll = () => {
      const event = events.find((item) => item.type === type);
      if (event) {
        resolvePromise(event);
      } else if (performance.now() >= deadline) {
        rejectPromise(new Error(`evento ausente: ${type}`));
      } else {
        setTimeout(poll, 20);
      }
    };
    poll();
  });
}

async function flushAudio(
  socket,
  events,
  expectedSequence,
  expectedSampleEnd
) {
  const requestId = [
    "campaign",
    process.pid,
    Date.now(),
    Math.random().toString(16).slice(2)
  ].join("-");
  socket.send(JSON.stringify({
    type: "audio.flush",
    requestId,
    expectedSequence,
    expectedSampleEnd
  }));
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const error = events.find(
      (event) =>
        event.type === "audio.error" &&
        event.requestId === requestId
    );
    if (error) {
      throw new Error(error.message ?? "audio.flush falhou");
    }
    const flushed = events.find(
      (event) =>
        event.type === "audio.flushed" &&
        event.requestId === requestId
    );
    if (flushed) {
      return flushed;
    }
    await delay(10);
  }
  throw new Error(`audio.flush expirou: ${requestId}`);
}

async function connect(url, events) {
  const socket = new WebSocket(url, {
    perMessageDeflate: false,
    maxPayload: 64 * 1024
  });
  await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      rejectPromise(new Error("timeout conectando ao áudio"));
    }, 10_000);
    const fail = (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    };
    socket.once("error", fail);
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        return;
      }
      try {
        const event = JSON.parse(data.toString("utf8"));
        events.push({ ...event, receivedAtMs: performance.now() });
        if (event.type === "audio.ready") {
          socket.send(JSON.stringify({ type: "audio.start" }));
        } else if (event.type === "audio.started") {
          clearTimeout(timeout);
          socket.off("error", fail);
          resolvePromise();
        }
      } catch (error) {
        events.push({
          type: "client.protocol.error",
          message: error.message,
          receivedAtMs: performance.now()
        });
      }
    });
  });
  return socket;
}

async function stopAndClose(socket, events) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({ type: "audio.stop" }));
  await Promise.race([
    waitForEvent(events, "audio.stopped", 750).catch(() => null),
    delay(750)
  ]);
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      resolvePromise();
    }, 750);
    socket.once("close", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    socket.close();
  });
}

async function runLiveCase(definition, options) {
  const audio = await loadCaseAudio(
    definition,
    options.frameMs,
    options.tailSilenceMs
  );
  const events = [];
  const socket = await connect(options.url, events);
  const intendedFrames = Math.ceil(
    audio.streamPcm.length / audio.bytesPerFrame
  );
  let sentFrames = 0;
  let sequence = 0;
  let sampleStart = 0;
  let maxBufferedAmountBytes = 0;
  let audioFlush = null;
  const streamStartedAtMs = performance.now();

  try {
    for (
      let offset = 0;
      offset < audio.streamPcm.length;
      offset += audio.bytesPerFrame
    ) {
      const pcm = audio.streamPcm.subarray(
        offset,
        Math.min(
          audio.streamPcm.length,
          offset + audio.bytesPerFrame
        )
      );
      const offsetMs = offset / 2 / audio.sampleRate * 1_000;
      if (options.realtime) {
        await delay(Math.max(
          0,
          streamStartedAtMs + offsetMs - performance.now()
        ));
      }
      socket.send(Buffer.from(encodePcmFrame({
        sequence,
        sampleStart,
        pcm16: pcm
      })));
      sentFrames += 1;
      maxBufferedAmountBytes = Math.max(
        maxBufferedAmountBytes,
        socket.bufferedAmount
      );
      sequence += 1;
      sampleStart += pcm.length / 2;
    }

    audioFlush = await flushAudio(
      socket,
      events,
      sequence - 1,
      sampleStart
    );
    if (definition.expectSpeech === false) {
      await delay(50);
    } else {
      await waitForEvent(
        events,
        "transcript.final",
        options.finalTimeoutMs ?? 15_000
      ).catch((error) => {
        events.push({
          type: "client.observation.timeout",
          awaitedEvent: "transcript.final",
          message: error.message,
          receivedAtMs: performance.now()
        });
      });
    }
  } finally {
    await stopAndClose(socket, events);
  }

  return analyzeObservedCase(definition, {
    events,
    realtime: options.realtime,
    frameMs: options.frameMs,
    streamStartedAtMs,
    audioDurationMs:
      audio.sourcePcm.length / 2 / audio.sampleRate * 1_000,
    activeStartOffsetMs: audio.firstActiveOffsetMs,
    activeEndOffsetMs: audio.lastActiveOffsetMs,
    intendedFrames,
    sentFrames,
    maxBufferedAmountBytes,
    audioFlush,
    audioSha256: audio.audioSha256
  });
}

async function readHealth(audioUrl) {
  try {
    const url = new URL(audioUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/api/health";
    url.search = "";
    url.hash = "";
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000)
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function filterDefinitions(pack, options) {
  const selected = pack.cases.filter((item) =>
    (options.cohort === "all" || item.cohort === options.cohort) &&
    (
      options.caseIds.length === 0 ||
      options.caseIds.includes(item.id)
    )
  );
  if (selected.length === 0) {
    throw new Error("nenhum caso selecionado");
  }
  const unknown = options.caseIds.filter(
    (id) => !pack.cases.some((item) => item.id === id)
  );
  if (unknown.length > 0) {
    throw new Error(`casos desconhecidos: ${unknown.join(", ")}`);
  }
  return selected;
}

function printSummary(report) {
  const synthetic = report.gate.summaries.synthetic;
  const human = report.gate.summaries.human;
  console.log("\nCampanha de áudio WebSocket PT-BR");
  console.log(`Gate automatizado: ${report.gate.decision.toUpperCase()}`);
  console.log(
    `Operabilidade PCM→VAD→endpoint→ASR: ` +
      report.gate.operability.decision.toUpperCase()
  );
  if (synthetic.speechCaseCount > 0) {
    console.log(
      `Sintético: WER=${synthetic.transcript.corpusWer}, ` +
      `endpoint p95=${synthetic.timing.endpointAfterLastActiveMs.p95}ms, ` +
      `final p95=${synthetic.timing.finalAfterEndpointMs.p95}ms ` +
      `(${synthetic.timing.finalAfterEndpointMs.measuredCases}/` +
      `${synthetic.speechCaseCount} finais medidos)`
    );
  }
  if (human.speechCaseCount > 0) {
    console.log(
      `Humano/CORAA: WER=${human.transcript.corpusWer}, ` +
      `endpoint p95=${human.timing.endpointAfterLastActiveMs.p95}ms, ` +
      `final p95=${human.timing.finalAfterEndpointMs.p95}ms ` +
      `(${human.timing.finalAfterEndpointMs.measuredCases}/` +
      `${human.speechCaseCount} finais medidos)`
    );
  }
  for (const [cohort, result] of Object.entries(
    report.gate.cohorts
  )) {
    if (result.status === "hold") {
      console.log(
        `- ${cohort}: HOLD (${result.failures.join(", ")})`
      );
    }
  }
  console.log(
    `Prontidão acústica ao usuário: HOLD ` +
      `(fora do escopo deste probe injetado)`
  );
  console.log(`Relatório: ${report.output}\n`);
}

export async function runCampaign(options) {
  const packPath = resolve(PROJECT_ROOT, options.pack);
  const packBytes = await readFile(packPath);
  const pack = JSON.parse(packBytes.toString("utf8"));
  const definitions = filterDefinitions(pack, options);
  const health = await readHealth(options.url);
  const sourceFingerprint = await createSourceFingerprint(
    PROJECT_ROOT
  );
  const currentRuntimeFingerprint = await createSourceFingerprint(
    PROJECT_ROOT,
    { roots: RUNTIME_FINGERPRINT_ROOTS }
  );
  const runtimeComparable =
    health?.process?.runtimeFingerprint?.sha256 ===
      currentRuntimeFingerprint.sha256;
  const cases = [];
  const startedAt = performance.now();
  for (const definition of definitions) {
    if (!options.json) {
      process.stdout.write(
        `Executando ${definition.id} (${definition.evidence})... `
      );
    }
    const result = await runLiveCase(definition, options);
    cases.push(result);
    if (!options.json) {
      const outcome = result.expectSpeech
        ? (
            result.eventCounts.finals === 0
              ? `sem final (WER conservador=${result.transcript.wer})`
              : `WER=${result.transcript.wer}`
          )
        : `ativações=${result.eventCounts.speechStarts}`;
      console.log(outcome);
    }
  }
  const gate = evaluateCampaign(pack, cases);
  const healthAfter = await readHealth(options.url);
  const usageDelta = measureUsageDelta(health, healthAfter);
  const sameProcess =
    health?.process?.runId === healthAfter?.process?.runId;
  const comparable = runtimeComparable && sameProcess;
  if (!comparable) {
    gate.operability = {
      ...gate.operability,
      candidatePass: gate.operability.pass,
      decision: "hold",
      pass: false,
      reason: "fingerprint do processo difere do runtime no disco"
    };
  }
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceFingerprint,
    pack: {
      id: pack.id,
      locale: pack.locale,
      path: options.pack,
      fileSha256: sha256Buffer(packBytes),
      sources: pack.sources ?? null
    },
    candidate: {
      transport: "websocket-pcm-v1",
      vad: health?.vadControl ?? { state: "unknown" },
      vadShadow: health?.vadShadow ?? { state: "unknown" },
      endpoint: "adaptive-ptbr",
      partialAsr: health?.asr?.partialModel ?? "unknown",
      finalAsrEngine: health?.asr?.engine ?? "unknown",
      finalAsr: health?.asr?.finalModel ?? "unknown",
      device: health?.asr?.device ?? "unknown",
      computeType: health?.asr?.computeType ?? "unknown"
    },
    runtime: {
      process: health?.process ?? null,
      processAfter: healthAfter?.process ?? null,
      currentRuntimeFingerprint,
      comparable
    },
    effectiveInteractionConfig: health?.interaction ?? null,
    execution: {
      realtime: options.realtime,
      frameMs: options.frameMs,
      tailSilenceMs: options.tailSilenceMs,
      elapsedMs: round(performance.now() - startedAt),
      url: options.url,
      selectedCohort: options.cohort,
      selectedCaseIds: definitions.map((item) => item.id),
      ...usageDelta
    },
    evidence: {
      synthetic:
        "Windows TTS reproduzível: bom para regressão, não representa fala humana.",
      human:
        "Trechos locais CORAA: fala gravada real, amostra pequena e não conversação full-duplex.",
      control:
        "Silêncio digital: detecta regressão grosseira, não substitui ruído de microfone.",
      excluded:
        "Microfone/Chrome, sala, eco do alto-falante, julgamento humano e interrupção audível."
    },
    gate,
    cases
  };
  return report;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const report = await runCampaign(options);
  const outputPath = resolve(PROJECT_ROOT, options.out);
  report.output = options.out;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
  }
  if (options.failOnHold && !report.gate.automatedPass) {
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
