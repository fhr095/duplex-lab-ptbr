import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateExp0011
} from "../scripts/lib/exp-0011-analysis.mjs";

function reflex(mode) {
  return {
    schemaVersion: 1,
    reflexVersion: "local-audio-reflex-v0.1",
    config: {
      mode,
      supportProbability: 0.75,
      supportWindows: 2
    }
  };
}

function snapshot(trace, mode, state = {}) {
  return {
    state: { assistantSpeaking: true, ...state },
    audio: { localAudioReflex: reflex(mode) },
    trace
  };
}

function event(atMs, type, detail = "") {
  return { atMs, type, detail };
}

function allRegressionGates() {
  return Object.fromEntries([
    "automationAvailable",
    "physicalMicrophoneCapture",
    "audioTransportRecovery",
    "requestedVadControlSelected",
    "sileroControlIntegrity",
    "audioDrainedThroughWatermark",
    "serverAudioPipelineIntegrity",
    "sileroShadowIntegrity",
    "sileroShadowFixtureSensitivity",
    "deterministicPotentialBargeInRecovery",
    "localAudioReflexAdvertised",
    "marginalSpikeControlObserved",
    "earlyBackchannelPartialCanReopen",
    "pendingAudioHeldDuringPotentialBargeIn",
    "realPcmBackchannelRecovered",
    "localAudioVertical",
    "responseStarted",
    "statefulCriticalConfirmation",
    "stoppedOnBargeIn",
    "browserRenderPathStoppedOnBargeIn",
    "longCorrectionNeverResumedMidSpeech",
    "delegatedTaskCancelled",
    "delegatedTaskSurvivesConversation",
    "noAudioPipelineErrors",
    "noBrowserErrors",
    "closedLoopPcmBargeIn"
  ].map((name) => [name, true]));
}

function input() {
  const sourceFingerprint = { sha256: "same-source" };
  const control = {
    sourceFingerprint,
    page: { localAudioReflex: reflex("immediate") },
    marginalReflex: {
      started: snapshot([
        event(1, "local-audio-reflex.pause"),
        event(2, "assistant.speech.paused")
      ], "immediate", { assistantSpeaking: false }),
      settled: snapshot([
        event(1, "local-audio-reflex.pause"),
        event(2, "assistant.speech.paused"),
        event(3, "barge-in.confirmed"),
        event(4, "turn.committed")
      ], "immediate")
    }
  };
  const candidate = {
    ok: false,
    sourceFingerprint,
    page: { localAudioReflex: reflex("evidence-gated") },
    gates: {
      ...allRegressionGates(),
      longSessionNoFalseActivation: false,
      sileroShadowAssistantOnlySpecificity: false
    },
    marginalReflex: {
      started: snapshot([
        event(1, "local-audio-reflex.armed")
      ], "evidence-gated"),
      settled: snapshot([
        event(1, "local-audio-reflex.armed"),
        event(2, "local-audio-reflex.suppressed"),
        event(3, "local-audio-reflex.transcript-suppressed")
      ], "evidence-gated")
    },
    bargeIn: {
      closedLoop: { speechOnsetToLastRenderMs: 181.12 },
      trace: [
        event(1, "local-audio-reflex.armed"),
        event(
          2,
          "local-audio-reflex.pause",
          "sustained-acoustic-evidence"
        ),
        event(3, "assistant.speech.paused"),
        event(4, "barge-in.confirmed")
      ]
    },
    microphoneCapture: {
      trace: [
        event(1, "assistant.speech.started", "automation-probe"),
        event(2, "assistant.speech.paused"),
        event(3, "barge-in.confirmed")
      ],
      falseActivationProbe: {
        unexpectedUserSpeechEvents: 1,
        unexpectedAssistantPauseEvents: 1,
        confirmedPotentialBargeIns: 1,
        preflight: { observedUserSpeechEvents: 2 }
      }
    }
  };
  return {
    control,
    candidate,
    health: {
      status: "ok",
      brain: "local",
      usage: { requests: 0 },
      process: { runtimeFingerprint: { sha256: "runtime" } }
    },
    fingerprints: {
      campaign: sourceFingerprint,
      runtime: { sha256: "runtime" }
    },
    supplemental: []
  };
}

test("promove a fatia causal sem chamar fala física não rotulada de eco", () => {
  const result = evaluateExp0011(input());

  assert.equal(result.pass, true);
  assert.equal(result.decision, "promote-local-audio-reflex-slice");
  assert.equal(result.metrics.closedLoopBargeInMs, 181.12);
  assert.equal(
    result.metrics.physical.classification,
    "unlabelled-concurrent-speech"
  );
  assert.equal(result.contextGates.fullSmokePass, false);
  assert.equal(result.contextGates.physicalSpecificityConclusive, false);
  assert.equal(result.globalRuntimeStatus, "hold-labelled-physical-specificity");
  assert.equal(Object.values(result.gates).every(Boolean), true);
});

test("final tardio que cria turno bloqueia promoção", () => {
  const value = input();
  value.candidate.marginalReflex.settled.trace.push(
    event(4, "turn.committed")
  );

  const result = evaluateExp0011(value);
  assert.equal(result.pass, false);
  assert.equal(result.gates.marginalSpikePreservesOutput, false);
});

test("latência acima do teto e pausa física órfã permanecem visíveis", () => {
  const value = input();
  value.candidate.bargeIn.closedLoop.speechOnsetToLastRenderMs = 351;
  value.candidate.microphoneCapture.trace.pop();

  const result = evaluateExp0011(value);
  assert.equal(result.pass, false);
  assert.equal(result.gates.realBargeInPreserved, false);
  assert.equal(result.gates.physicalInteractionResolved, false);
  assert.equal(result.metrics.physical.orphanedPauses, 1);
});

test("A/B com fontes diferentes não produz decisão causal", () => {
  const value = input();
  value.control.sourceFingerprint = { sha256: "stale-control" };

  const result = evaluateExp0011(value);
  assert.equal(result.pass, false);
  assert.equal(result.gates.sourceIdenticalAb, false);
});
