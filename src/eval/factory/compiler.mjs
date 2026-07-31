import { canonicalSha256 } from "./canonical-hash.mjs";
import { validateFactoryPack } from "./schema.mjs";

const TIMINGS = Object.freeze({
  "same-turn-continuous": {
    speechStart: 0,
    transcript: 650,
    correction: 700,
    speechEnd: 1_000
  },
  "same-turn-after-pause": {
    speechStart: 0,
    pause: 700,
    resume: 950,
    transcript: 1_200,
    correction: 1_230,
    speechEnd: 1_500
  },
  "barge-in": {
    assistantSeed: 0,
    speechStart: 900,
    transcript: 1_400,
    correction: 1_430,
    speechEnd: 1_700
  },
  "cross-turn": {
    firstSpeechStart: 0,
    firstTranscript: 300,
    firstSpeechEnd: 550,
    speechStart: 950,
    transcript: 1_250,
    correction: 1_280,
    speechEnd: 1_550
  }
});

function timelineFor(item) {
  const timing = TIMINGS[item.stimulus.timingPattern];
  if (!timing) {
    throw new TypeError(
      `timingPattern sem compilador: ${item.stimulus.timingPattern}`
    );
  }
  const events = [];
  if (timing.assistantSeed !== undefined) {
    events.push({
      atMs: timing.assistantSeed,
      type: "assistant.speech.started",
      payload: { durationMs: 5_000, kind: "seed", text: "Resposta em andamento." }
    });
  }
  if (timing.firstSpeechStart !== undefined) {
    events.push({ atMs: timing.firstSpeechStart, type: "user.speech.started" });
    events.push({
      atMs: timing.firstTranscript,
      type: "user.transcript.final",
      payload: { text: `Considere ${item.stimulus.slots.obsolete}.` }
    });
    events.push({ atMs: timing.firstSpeechEnd, type: "user.speech.ended" });
  }
  events.push({ atMs: timing.speechStart, type: "user.speech.started" });
  if (timing.pause !== undefined) {
    events.push({ atMs: timing.pause, type: "user.speech.paused" });
    events.push({ atMs: timing.resume, type: "user.speech.resumed" });
  }
  events.push({
    atMs: timing.transcript,
    type: "user.transcript.final",
    payload: { text: item.stimulus.text }
  });
  events.push({
    atMs: timing.correction,
    type: "user.correction",
    payload: {
      previous: item.oracle.args.obsolete,
      current: item.oracle.args.current,
      slot: item.stimulus.slotType,
      revisionId: `${item.id}-revision-1`
    }
  });
  events.push({ atMs: timing.speechEnd, type: "user.speech.ended" });
  return events.sort((left, right) => left.atMs - right.atMs);
}

function expectationsFor(item) {
  const expectations = [
    {
      id: `${item.id}-rollback-current`,
      kind: "payload",
      event: "state.rollback",
      path: "current",
      equals: item.oracle.args.current
    },
    {
      id: `${item.id}-no-main-speech-before-end`,
      kind: "forbidden",
      event: "assistant.speech.started",
      after: "user.speech.started",
      afterOccurrence:
        item.stimulus.timingPattern === "cross-turn" ? 2 : 1,
      until: "user.speech.ended",
      untilOccurrence: 1
    },
    {
      id: `${item.id}-response-after-real-end`,
      kind: "required",
      event: "assistant.speech.started",
      after: "user.speech.ended",
      afterOccurrence:
        item.stimulus.timingPattern === "cross-turn" ? 2 : 1,
      withinMs: 500
    }
  ];
  if (item.stimulus.timingPattern === "barge-in") {
    expectations.push({
      id: `${item.id}-stop-on-barge-in`,
      kind: "latency",
      from: "user.speech.started",
      to: "assistant.speech.stopped",
      maxMs: 200,
      metric: "stop_decision_latency_ms"
    });
  }
  return expectations;
}

function compileTracePack(pack) {
  return {
    schemaVersion: 1,
    id: `${pack.id}-trace-v1`,
    locale: pack.locale,
    frozen: true,
    scenarios: pack.cases.map((item) => ({
      id: item.id,
      category: "correction",
      description:
        `Última revisão vence em ${item.stimulus.slotType}; ` +
        `${item.stimulus.timingPattern}.`,
      metadata: {
        factoryPackId: pack.id,
        factoryCaseId: item.id,
        familyRootId: item.familyRootId,
        split: item.split,
        evidenceLevel: "semantic-event-compiled",
        limitation:
          "user.correction é derivado do blueprint; o replay Chrome usa texto/PCM bruto"
      },
      timeline: timelineFor(item),
      expectations: expectationsFor(item)
    }))
  };
}

function compilePerceptionPack(pack, tracePack) {
  return {
    schemaVersion: 1,
    id: `${pack.id}-perception-v1`,
    tracePackId: tracePack.id,
    locale: pack.locale,
    scenarios: pack.cases.map((item) => ({
      id: `${item.id}-perception`,
      sourceScenarioId: item.id,
      category: "correction",
      userPerception:
        `A pessoa percebe que ${item.stimulus.slots.current} substitui ` +
        `${item.stimulus.slots.obsolete} sem disparo provisório.`,
      checks: [
        {
          id: `${item.id}-last-value-wins`,
          kind: "correction_preserved",
          severity: "critical",
          proxyFor: "última revisão preservada no estado instrumentado",
          correction: { type: "user.correction" },
          expectedCurrent: item.oracle.args.current,
          maxRollbackMs: 50,
          forbidDelegationBeforeEnd: true
        }
      ]
    })),
    deferredMeasurements: [
      {
        id: "factory-downstream-effect-fidelity",
        metric: "downstream_correction_fidelity",
        requires: "human_judgment",
        whyProxyIsInsufficient:
          "O relógio virtual recebe a correção derivada; somente runtime instrumentado prova o efeito final.",
        blocksUserFacingRelease: true,
        target: "zero efeito com slot obsoleto"
      },
      {
        id: "factory-physical-correction-timing",
        metric: "physical_correction_end_to_voice_ms",
        requires: "physical_audio",
        whyProxyIsInsufficient:
          "Eventos virtuais não medem endpoint, ASR, TTS e renderer no mesmo caminho.",
        blocksUserFacingRelease: true,
        target: "p95 <= 1200 ms"
      }
    ]
  };
}

function compileLiveAudioPack(pack) {
  return {
    schemaVersion: 1,
    id: `${pack.id}-live-audio-v1`,
    locale: pack.locale,
    description: "Casos de correção compilados pela fábrica v0.2.",
    sources: {
      synthetic: "TTS local content-addressed; voz explícita no caso"
    },
    gate: {
      id: `${pack.id}-audio-gate`,
      maxOnsetP95Ms: 180,
      maxFirstUsefulPartialP95Ms: 2_500,
      maxEndpointP95Ms: 1_300,
      maxFinalAfterEndpointP95Ms: 2_000,
      maxSyntheticCorpusWer: 0.25,
      maxHumanCorpusWer: 0.25,
      maxPerCaseWer: 0.5,
      minCriticalPhraseRecall: 1,
      maxLostFrames: 0,
      maxBufferedAmountBytes: 16_384,
      maxRejectedFrames: 0,
      maxProtocolErrors: 0,
      requireSilenceControl: true
    },
    cases: [
      {
        id: "silencio-controle",
        cohort: "control",
        evidence: "synthetic-silence",
        category: "false-activation",
        generatedSilenceMs: 2_200,
        expectSpeech: false
      },
      ...pack.cases
        .filter((item) => item.lineage.relation === "root")
        .map((item) => ({
        id: item.id,
        cohort: "synthetic",
        evidence: item.audioPlan.ttsRef,
        category: "correction",
        audio: `eval/generated/factory/audio/${item.id}.wav`,
        gain: item.audioPlan.gain,
        expected: item.stimulus.text,
        requiredPhrases: [
          item.stimulus.slots.obsolete,
          item.stimulus.marker,
          item.stimulus.slots.current
        ],
        metadata: {
          familyRootId: item.familyRootId,
          split: item.split,
          rate: item.audioPlan.rate,
          timingPattern: item.stimulus.timingPattern
        }
        }))
    ]
  };
}

export function compileFactoryPack(input) {
  const pack = validateFactoryPack(input);
  const tracePack = compileTracePack(pack);
  const perceptionPack = compilePerceptionPack(pack, tracePack);
  const liveAudioPack = compileLiveAudioPack(pack);
  const browserCases = {
    schemaVersion: 1,
    id: `${pack.id}-browser-v1`,
    sourcePackId: pack.id,
    cases: pack.cases
      .filter(
        (item) => item.critical && item.lineage.relation === "root"
      )
      .map((item) => ({
        id: item.id,
        text: item.stimulus.text,
        audio: `eval/generated/factory/audio/${item.id}.wav`,
        timingPattern: item.stimulus.timingPattern,
        effectRisk: item.stimulus.effectRisk,
        slots: item.stimulus.slots,
        oracle: item.oracle,
        expectedSemanticState: {
          slot: item.oracle.args.slot,
          value: item.oracle.args.current
        }
      }))
  };
  const packSha256 = canonicalSha256(pack);
  const artifactHashes = {
    tracePack: canonicalSha256(tracePack),
    perceptionPack: canonicalSha256(perceptionPack),
    liveAudioPack: canonicalSha256(liveAudioPack),
    browserCases: canonicalSha256(browserCases)
  };
  return {
    tracePack,
    perceptionPack,
    liveAudioPack,
    browserCases,
    manifest: {
      schemaVersion: 1,
      sourcePackId: pack.id,
      packSha256,
      artifactHashes
    }
  };
}
