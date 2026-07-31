import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateExp0010
} from "../scripts/lib/exp-0010-analysis.mjs";

const FIRST_TEXT = "Transfere 1500 reais, não, 150 reais.";
const SECOND_TEXT = "O valor final é 1150 reais.";

function transition(eventId, previousStateVersion, stateVersion) {
  return {
    atMs: stateVersion * 10,
    type: "interaction.transition",
    detail: JSON.stringify({
      authority: "backend-interaction-runtime",
      eventId,
      kernelVersion: "interaction-kernel-v0.1",
      previousStateVersion,
      stateVersion
    })
  };
}

function run(repetition = 1) {
  const pendingId = "confirmation:turn-1";
  const pendingTrace = [
    { atMs: 0, type: "turn.committed", detail: FIRST_TEXT },
    transition("turn-1", 0, 1),
    { atMs: 20, type: "state.pending-confirmation", detail: "{}" },
    { atMs: 21, type: "assistant.safety-confirmation", detail: "repeat-critical-value-before-commit" },
    { atMs: 100, type: "assistant.speech.started", detail: "direct" },
    { atMs: 500, type: "assistant.speech.finished", detail: "direct" }
  ];
  const pending = {
    semantic: {
      authority: "backend-interaction-runtime",
      sessionId: `session-${repetition}`,
      kernelStateVersion: 1,
      pendingConfirmation: {
        id: pendingId,
        policy: "repeat-critical-value-before-commit"
      },
      revisions: [],
      state: null
    },
    text: {
      assistant: "Qual é o valor final da transferência?",
      user: FIRST_TEXT
    },
    trace: pendingTrace
  };
  const accepted = {
    semantic: {
      authority: "backend-interaction-runtime",
      sessionId: `session-${repetition}`,
      kernelStateVersion: 2,
      pendingConfirmation: null,
      revisions: [{
        id: "revision-1",
        slot: "amount",
        obsolete: "BRL 1500",
        current: "BRL 1150",
        confirmationId: pendingId
      }],
      state: {
        slot: "amount",
        value: "BRL 1150",
        revisionId: "revision-1"
      }
    },
    text: {
      assistant: "Entendido. Valor final confirmado: R$ 1150.",
      user: SECOND_TEXT
    },
    trace: [
      ...pendingTrace,
      { atMs: 1_000, type: "turn.committed", detail: SECOND_TEXT },
      transition("turn-2", 1, 2),
      {
        atMs: 1_020,
        type: "state.rollback",
        detail: JSON.stringify({
          previous: "BRL 1500",
          current: "BRL 1150",
          revisionId: "revision-1",
          slot: "amount",
          confirmationId: pendingId
        })
      },
      { atMs: 1_021, type: "assistant.safety-confirmed", detail: "{}" },
      { atMs: 1_100, type: "assistant.speech.started", detail: "direct" },
      { atMs: 1_500, type: "assistant.speech.finished", detail: "direct" }
    ]
  };
  return { repetition, pending, accepted };
}

function input(overrides = {}) {
  const allGreen = {
    automationAvailable: true,
    requestedVadControlSelected: true,
    sileroControlIntegrity: true,
    serverAudioPipelineIntegrity: true,
    sileroShadowIntegrity: true,
    sileroShadowFixtureSensitivity: true,
    deterministicPotentialBargeInRecovery: true,
    earlyBackchannelPartialCanReopen: true,
    pendingAudioHeldDuringPotentialBargeIn: true,
    realPcmBackchannelRecovered: true,
    localAudioVertical: true,
    responseStarted: true,
    statefulCriticalConfirmation: true,
    stoppedOnBargeIn: true,
    closedLoopPcmBargeIn: true,
    browserRenderPathStoppedOnBargeIn: true,
    longCorrectionNeverResumedMidSpeech: true,
    delegatedTaskCancelled: true,
    delegatedTaskSurvivesConversation: true,
    noAudioPipelineErrors: true,
    noBrowserErrors: true,
    noSelfInterruptionUnderDeviceAec: true,
    longSessionNoFalseActivation: true,
    sileroShadowAssistantOnlySpecificity: true,
    potentialBargeInRecovery: true
  };
  return {
    browser: {
      ok: true,
      sourceFingerprint: { sha256: "campaign-sha" },
      gates: allGreen,
      criticalConfirmation: {
        repetitions: 5,
        runs: [1, 2, 3, 4, 5].map(run)
      }
    },
    health: {
      status: "ok",
      brain: "local",
      usage: { requests: 0 },
      process: { runtimeFingerprint: { sha256: "runtime-sha" } },
      interaction: {
        authority: "backend-interaction-runtime",
        kernelVersion: "interaction-kernel-v0.1"
      }
    },
    fingerprints: {
      campaign: { sha256: "campaign-sha" },
      runtime: { sha256: "runtime-sha" }
    },
    history: [],
    ...overrides
  };
}

test("promove a fatia stateful sem confundir com prontidão total do runtime", () => {
  const result = evaluateExp0010(input());
  assert.equal(result.decision, "promote-stateful-kernel-slice");
  assert.equal(result.pass, true);
  assert.equal(result.metrics.observations, 5);
  assert.equal(result.metrics.pendingResponseP95Ms, 100);
  assert.equal(result.metrics.acceptedResponseP95Ms, 100);
  assert.equal(result.globalRuntimeStatus, "pass-current-smoke");
  assert.equal(Object.values(result.gates).every(Boolean), true);
});

test("um rollback precoce ou autoridade duplicada bloqueia promoção", () => {
  const broken = input();
  broken.browser.criticalConfirmation.runs[2].pending.trace.push({
    atMs: 30,
    type: "state.rollback",
    detail: "{}"
  });
  broken.browser.criticalConfirmation.runs[3].accepted.semantic.authority =
    "browser-policy";

  const result = evaluateExp0010(broken);
  assert.equal(result.pass, false);
  assert.equal(result.decision, "hold");
  assert.equal(result.gates.noPrematureSemanticCommit, false);
  assert.equal(result.gates.singleAuthority, false);
});

test("flutuação acústica fica visível sem apagar evidência causal do kernel", () => {
  const value = input();
  value.browser.ok = false;
  value.browser.gates.noSelfInterruptionUnderDeviceAec = false;
  value.browser.gates.longSessionNoFalseActivation = false;
  value.browser.gates.sileroShadowAssistantOnlySpecificity = false;

  const result = evaluateExp0010(value);
  assert.equal(result.pass, true);
  assert.equal(result.decision, "promote-stateful-kernel-slice");
  assert.equal(result.globalRuntimeStatus, "hold-acoustic-stability");
  assert.equal(result.contextGates.acousticLongSessionStable, false);
});
