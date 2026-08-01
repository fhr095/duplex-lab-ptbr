import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_TRAINING_EFFECTS,
  REQUIRED_TRAINING_STAGES,
  auditTrainingTraceContract,
  evaluateExp0013,
  replayTrainingTrace
} from "../scripts/lib/exp-0013-analysis.mjs";
import {
  REQUIRED_BROWSER_GATES
} from "../scripts/lib/exp-0012-analysis.mjs";
import {
  OutputInterruptionLifecycle
} from "../web/output-interruption-lifecycle.mjs";
import {
  TrainingTraceRecorder
} from "../web/training-trace-recorder.mjs";

const RUNTIME_SHA = "b".repeat(64);
const CONFIG_HASH = `sha256:${RUNTIME_SHA}`;

function createHarness(sessionId) {
  return {
    lifecycle: new OutputInterruptionLifecycle(),
    recorder: new TrainingTraceRecorder({
      sessionId,
      startedAtEpochMs: 1,
      locale: "pt-BR",
      candidate: "test-output-interruption-v0.1",
      configHash: CONFIG_HASH
    })
  };
}

function record(harness, event, atMs) {
  const previous = harness.lifecycle.snapshot;
  const transition = harness.lifecycle.dispatch(event);
  const recorded = harness.recorder.recordDecision({
    atMs,
    turnId: event.turnId ?? transition.state.turnId ?? null,
    epoch:
      event.outputEpoch ??
      event.currentOutputEpoch ??
      previous.outputEpoch ??
      0,
    event: {
      type: `output-interruption.${event.type.toLowerCase()}`,
      source: "test-browser",
      payload: { lifecycleEvent: event }
    },
    context: { state: { lifecycle: previous } },
    policy: {
      id: "output-interruption-lifecycle",
      version: transition.lifecycleVersion,
      mode: "authority"
    },
    transition: {
      previousStateVersion: transition.previousStateVersion,
      stateVersion: transition.state.version,
      previousPhase: previous.phase,
      phase: transition.state.phase,
      reason: transition.reason
    },
    intents: transition.intents
  });
  return { recorded, transition };
}

function effectId(result, type) {
  return result.recorded.effects.find(
    (effect) => effect.effectType === type
  )?.effectId;
}

function stages(harness, id, names, startAtMs, options = {}) {
  names.forEach((stage, index) => {
    harness.recorder.recordEffectStage(id, {
      stage,
      atMs: startAtMs + index,
      reconciledByDecisionId:
        stage === "cancelled"
          ? options.reconciledByDecisionId
          : null,
      evidence: stage === "cancelled"
        ? { reason: "superseded-by-test-decision" }
        : {}
    });
  });
}

function snapshot(harness) {
  return {
    semantic: { sessionId: harness.recorder.sessionId },
    trainingTrace: harness.recorder.snapshot,
    trace: [],
    metrics: {}
  };
}

function pendingAudioCase(sessionId) {
  const harness = createHarness(sessionId);
  const hold = record(harness, {
    type: "PAUSE_REQUESTED",
    turnId: "turn-hold",
    outputEpoch: 1,
    hasAudibleOutput: false,
    hasAcousticOutput: true,
    hasActiveResponse: true
  }, 10);
  stages(harness, effectId(hold, "HOLD_OUTPUT"), [
    "dispatched",
    "completed"
  ], 11);
  const settle = record(harness, {
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 2,
    hasResumableAudio: false
  }, 20);
  stages(harness, effectId(settle, "SETTLE_WITHOUT_RESUME"), [
    "dispatched",
    "completed"
  ], 21);
  return snapshot(harness);
}

function resumedCase(sessionId, options = {}) {
  const harness = createHarness(sessionId);
  const pause = record(harness, {
    type: "PAUSE_REQUESTED",
    turnId: "turn-resume",
    outputEpoch: 3,
    hasAudibleOutput: true,
    hasAcousticOutput: true,
    hasActiveResponse: false
  }, 10);
  const pauseId = effectId(pause, "PAUSE_OUTPUT");
  stages(harness, pauseId, ["dispatched", "player-received"], 11);
  if (options.cancelPause !== true) {
    stages(harness, pauseId, ["renderer-silent", "completed"], 13);
  }
  const resume = record(harness, {
    type: "DISMISS_REQUESTED",
    currentOutputEpoch: 3,
    hasResumableAudio: true
  }, 30);
  if (options.cancelPause === true) {
    stages(harness, pauseId, ["cancelled"], 30, {
      reconciledByDecisionId: resume.recorded.decisionId
    });
  }
  const resumeId = effectId(resume, "RESUME_OUTPUT");
  stages(harness, resumeId, [
    "dispatched",
    "player-received",
    "audible",
    "completed"
  ], 31);
  const settled = record(harness, {
    type: "RESUME_SUCCEEDED",
    resumeAttempt: resume.transition.state.resumeAttempt
  }, 40);
  stages(harness, effectId(settled, "SETTLE_RESUMED"), [
    "dispatched",
    "completed"
  ], 41);
  return snapshot(harness);
}

function confirmedCase(sessionId, options = {}) {
  const harness = createHarness(sessionId);
  const pause = record(harness, {
    type: "PAUSE_REQUESTED",
    turnId: "turn-confirm",
    outputEpoch: 4,
    hasAudibleOutput: true,
    hasAcousticOutput: true,
    hasActiveResponse: false
  }, 10);
  stages(harness, effectId(pause, "PAUSE_OUTPUT"), [
    "dispatched",
    "player-received",
    "renderer-silent",
    "completed"
  ], 11);
  if (options.keepHeld === true) {
    const kept = record(harness, {
      type: "PAUSE_REQUESTED",
      turnId: "turn-confirm",
      outputEpoch: 4,
      hasAudibleOutput: false,
      hasAcousticOutput: true,
      hasActiveResponse: false
    }, 20);
    stages(harness, effectId(kept, "KEEP_OUTPUT_HELD"), [
      "dispatched",
      "completed"
    ], 21);
  }
  const confirm = record(harness, {
    type: "CONFIRM_REQUESTED",
    reason: "fala útil"
  }, 30);
  stages(harness, effectId(confirm, "CONFIRM_INTERRUPTION"), [
    "dispatched",
    "player-received",
    "completed"
  ], 31);
  const clear = record(harness, {
    type: "CLEAR",
    reason: "turn-committed"
  }, 40);
  stages(harness, effectId(clear, "SETTLE_CLEARED"), [
    "dispatched",
    "completed"
  ], 41);
  return snapshot(harness);
}

function candidateFixture() {
  const gates = Object.fromEntries(
    REQUIRED_BROWSER_GATES.map((name) => [name, true])
  );
  Object.assign(gates, {
    physicalMicrophoneCapture: true,
    sileroControlIntegrity: false,
    noSelfInterruptionUnderDeviceAec: false,
    longSessionNoFalseActivation: false,
    sileroShadowIntegrity: false,
    sileroShadowAssistantOnlySpecificity: true,
    sileroShadowFixtureSensitivity: true
  });
  const realBackchannel = resumedCase("session-real-backchannel");
  realBackchannel.recovery = { speechEndToResumeMs: 280 };
  const bargeIn = confirmedCase("session-barge-in");
  bargeIn.metrics = { stopCommandMs: 1, stopRenderedMs: 42 };
  bargeIn.closedLoop = { speechOnsetToLastRenderMs: 170 };
  return {
    ok: false,
    sourceFingerprint: { sha256: "same-source" },
    gates,
    limitations: [
      "O STOP físico exige microfone ou loopback calibrado."
    ],
    directTurn: { metrics: { responseStartMs: 165 } },
    preparingBargeIn: {
      released: pendingAudioCase("session-pending-audio")
    },
    potentialBargeInRecovery: resumedCase(
      "session-deterministic-backchannel",
      { cancelPause: true }
    ),
    reopenedBackchannel: resumedCase("session-reopened"),
    realBackchannel,
    bargeIn,
    longCorrection: {
      completed: confirmedCase("session-long-correction", {
        keepHeld: true
      })
    }
  };
}

function inputFixture(candidate = candidateFixture()) {
  return {
    candidate,
    contractAudit: auditTrainingTraceContract(),
    fingerprints: {
      campaign: { sha256: "same-source" },
      runtime: { sha256: RUNTIME_SHA }
    },
    health: {
      status: "ok",
      brain: "local",
      usage: { requests: 0 },
      process: { runtimeFingerprint: { sha256: RUNTIME_SHA } }
    }
  };
}

test("promove somente a fatia causal de interrupção", () => {
  const report = evaluateExp0013(inputFixture());

  assert.equal(report.pass, true);
  assert.equal(
    report.decision,
    "promote-training-trace-interruption-slice"
  );
  assert.equal(Object.values(report.gates).every(Boolean), true);
  assert.equal(
    report.contextGates.fullTrainingTraceV1Materialized,
    false
  );
  assert.equal(report.contextGates.m4aGeneralizationClaimed, false);
  assert.equal(
    report.globalRuntimeStatus,
    "hold-labelled-physical-specificity"
  );
  assert.equal(
    REQUIRED_TRAINING_EFFECTS.every((effect) =>
      report.observations.traces.coverage.effectTypes.includes(effect)
    ),
    true
  );
  assert.equal(
    REQUIRED_TRAINING_STAGES.every((stage) =>
      report.observations.traces.coverage.effectStages.includes(stage)
    ),
    true
  );
});

test("replay usa o contexto causal gravado e detecta divergência", () => {
  const bundle = candidateFixture().bargeIn.trainingTrace;
  assert.equal(replayTrainingTrace(bundle).exact, true);

  const corrupted = structuredClone(bundle);
  corrupted.decisions[0].transition.phase = "idle";
  const replay = replayTrainingTrace(corrupted);
  assert.equal(replay.exact, false);
  assert.match(replay.errors.join(" | "), /diverge/iu);
});

test("efeito aberto ou contexto futuro bloqueiam promoção", () => {
  const candidate = structuredClone(candidateFixture());
  const effect =
    candidate.realBackchannel.trainingTrace.effects.find(
      (entry) => entry.effectType === "RESUME_OUTPUT"
    );
  effect.stages.pop();
  effect.status = effect.stages.at(-1).stage;
  const context = candidate.bargeIn.trainingTrace.contexts[0];
  context.availableAt.atMs += 1;

  const report = evaluateExp0013(inputFixture(candidate));
  assert.equal(report.pass, false);
  assert.equal(report.gates.schemaAndReferencesValid, false);
  assert.equal(report.gates.effectLedgerClosed, false);
});

test("sessão, runtime e execução local são gates", () => {
  const unbound = structuredClone(candidateFixture());
  unbound.bargeIn.trainingTrace.session.configHash =
    `sha256:${"c".repeat(64)}`;
  assert.equal(
    evaluateExp0013(inputFixture(unbound)).gates.sessionAndRuntimeBound,
    false
  );

  const paid = inputFixture();
  paid.health.usage.requests = 1;
  assert.equal(
    evaluateExp0013(paid).gates.localZeroPaidExecution,
    false
  );
});

test("shadow é auditado sem autoridade nem efeito", () => {
  const audit = auditTrainingTraceContract();
  assert.equal(audit.pass, true);
  assert.equal(Object.values(audit.checks).every(Boolean), true);
  assert.equal(audit.checks.shadowCreatesNoEffect, true);
  assert.equal(audit.checks.shadowAuthorityRejected, true);
});

test("regressão funcional não pode ser reclassificada como limite físico", () => {
  const candidate = candidateFixture();
  candidate.gates.stoppedOnBargeIn = false;
  const report = evaluateExp0013(inputFixture(candidate));

  assert.equal(report.pass, false);
  assert.equal(report.gates.browserInteractionRegression, false);
  assert.equal(report.gates.physicalBoundaryHonest, false);
  assert.equal(
    report.globalRuntimeStatus,
    "unexpected-regression"
  );
});
