import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0025_BROWSER_TRIAL_RESULT_SCHEMA,
  EXP0025_BROWSER_TRIAL_STATUSES,
  exp0025TrialExpression,
  normalizeExp0025BrowserTrialResult,
  validateExp0025BrowserTrialResult,
  validateExp0025CausalRenderOnset
} from "../scripts/lib/exp-0025-browser-trial.mjs";

function browserFixture(options = {}) {
  let clock = 100;
  let trace = [];
  let assistantSpeaking = false;
  let lastRenderStop = null;
  let stopCalls = 0;

  const snapshot = () => ({
    observedAtMs: clock,
    state: { assistantSpeaking, potentialBargeIn: "pending" },
    audio: {
      lastRenderStop: structuredClone(lastRenderStop),
      renderProbe: { pendingMeasurements: 0 },
      outputInterruptionLifecycle: {
        phase: assistantSpeaking ? "speaking" : "held",
        pauseKind: assistantSpeaking ? null : "audible"
      }
    },
    trace: structuredClone(trace),
    trainingTrace: { events: [], contexts: [], decisions: [], effects: [] },
    reflexTrainingTrace: null
  });
  const lab = {
    reset() {
      trace = [];
      assistantSpeaking = false;
      lastRenderStop = null;
      return snapshot();
    },
    snapshot,
    speakLoop() {
      trace.push({
        atMs: 101,
        type: "assistant.render.active",
        detail: "first"
      });
      if (options.multiple !== false) {
        trace.push({
          atMs: 105,
          type: "assistant.render.active",
          detail: "second"
        });
      }
      assistantSpeaking = true;
      clock = options.lateAnchor === true ? 450 : 105;
    },
    simulateAudioEvent() {
      stopCalls += 1;
      trace.push({
        atMs: clock + 4,
        type: "assistant.speech.paused",
        detail: "fixture"
      });
      trace.push({
        atMs: clock + 8,
        type: "assistant.render.stopped",
        detail: "fixture"
      });
      clock += 8;
      assistantSpeaking = false;
      lastRenderStop = {
        kind: "browser-render-stop",
        latencyMs: 8,
        renderedThroughTrigger: true
      };
    }
  };
  const performance = { now: () => clock };
  const setTimeout = (callback, delayMs) => {
    clock += Math.max(0, delayMs);
    callback();
    return 1;
  };
  return {
    execute(expression) {
      return Function(
        "window",
        "performance",
        "setTimeout",
        `return ${expression}`
      )({ __duplexLab: lab }, performance, setTimeout);
    },
    get stopCalls() { return stopCalls; }
  };
}

test("primeiro render.active ancora o STOP e multiplicidade permanece bruta", async () => {
  const browser = browserFixture();
  const result = await browser.execute(exp0025TrialExpression({
    navigationIndex: 1,
    trialIndex: 1
  }));

  assert.equal(result.schemaVersion, EXP0025_BROWSER_TRIAL_RESULT_SCHEMA);
  assert.equal(result.status, EXP0025_BROWSER_TRIAL_STATUSES.collected);
  assert.equal(result.phase, "complete");
  assert.equal(result.anchorTraceIndex, 0);
  assert.equal(result.activeMarker.detail, "first");
  assert.deepEqual(
    result.preTriggerActiveMarkers.map(({ detail }) => detail),
    ["first", "second"]
  );
  assert.equal(browser.stopCalls, 1);
  assert.equal(validateExp0025BrowserTrialResult(result).valid, true);
  assert.equal(validateExp0025CausalRenderOnset(result).valid, true);
});

test("âncora observada tarde retorna falha tipada antes de emitir STOP", async () => {
  const browser = browserFixture({ lateAnchor: true });
  const result = await browser.execute(exp0025TrialExpression({
    navigationIndex: 2,
    trialIndex: 3
  }));

  assert.equal(result.status, EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure);
  assert.equal(result.phase, "trigger-scheduling");
  assert.equal(result.code, "CAUSAL_ANCHOR_OBSERVED_TOO_LATE");
  assert.equal(result.anchorTraceIndex, 0);
  assert.equal(result.startSnapshot.trace.length, 2);
  assert.equal(result.preTriggerActiveMarkers.length, 2);
  assert.equal(browser.stopCalls, 0);
  assert.equal(validateExp0025BrowserTrialResult(result).valid, true);
  assert.equal(validateExp0025CausalRenderOnset(result).valid, false);
});

test("validador causal rejeita reescrever a âncora para evento posterior", async () => {
  const browser = browserFixture();
  const result = await browser.execute(exp0025TrialExpression({
    navigationIndex: 1,
    trialIndex: 2
  }));
  const rewritten = structuredClone(result);
  rewritten.anchorTraceIndex = 1;
  rewritten.activeMarker = structuredClone(rewritten.preTriggerActiveMarkers[1]);
  rewritten.plannedTriggerAtPerformanceMs = rewritten.activeMarker.atMs + 320;
  rewritten.timerErrorMs = rewritten.triggerAtPerformanceMs -
    rewritten.plannedTriggerAtPerformanceMs;

  assert.equal(validateExp0025BrowserTrialResult(rewritten).valid, true);
  assert.equal(validateExp0025CausalRenderOnset(rewritten).valid, false);
  assert.match(
    validateExp0025CausalRenderOnset(rewritten).errors.join("; "),
    /primeiro render\.active/u
  );
});

test("resultado possui schema fechado e mensagem de falha limitada", async () => {
  const browser = browserFixture({ lateAnchor: true });
  const result = await browser.execute(exp0025TrialExpression({
    navigationIndex: 1,
    trialIndex: 1
  }));
  const extra = { ...result, invented: true };
  const missingSnapshot = structuredClone(result);
  missingSnapshot.startSnapshot = null;

  assert.equal(validateExp0025BrowserTrialResult(extra).valid, false);
  assert.equal(validateExp0025BrowserTrialResult(missingSnapshot).valid, false);
  assert.ok(result.message.length > 0 && result.message.length <= 500);
});

test("retorno malformado é convertido em falha tipada persistível", () => {
  const normalized = normalizeExp0025BrowserTrialResult(
    { phase: "render-onset", invented: true },
    { navigationIndex: 1, trialIndex: 4 }
  );

  assert.equal(normalized.status,
    EXP0025_BROWSER_TRIAL_STATUSES.instrumentFailure);
  assert.equal(normalized.code, "MALFORMED_BROWSER_TRIAL_RESULT");
  assert.equal(normalized.navigationIndex, 1);
  assert.equal(normalized.trialIndex, 4);
  assert.equal(validateExp0025BrowserTrialResult(normalized).valid, true);
});
