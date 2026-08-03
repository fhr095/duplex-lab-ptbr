import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0020_FIXED_PHRASE,
  EXP0020_POST_MARKER_HORIZON_MS,
  EXP0020_TRIGGER_DELAY_MS
} from "../scripts/lib/exp-0020-browser-harness.mjs";
import {
  EXP0025_EXPECTED_WAV_BYTES,
  EXP0025_EXPECTED_WAV_SHA256,
  EXP0025_TARGET_URL,
  runExp0025BrowserCampaign,
  validateExp0025WorkerEnvelopeShape
} from "../scripts/lib/exp-0025-browser-harness.mjs";
import {
  EXP0025_BROWSER_TRIAL_RESULT_SCHEMA,
  EXP0025_BROWSER_TRIAL_STATUSES
} from "../scripts/lib/exp-0025-browser-trial.mjs";
import { createExp0025JournalFrame } from
  "../src/eval/exp-0025-journal.mjs";

const HEALTH_URL = "http://localhost:4173/api/health";
const TTS_URL = "http://localhost:4173/api/tts";

function health() {
  return {
    process: {
      runId: "runtime-1",
      runtimeFingerprint: {
        sha256: "a".repeat(64),
        fileCount: 321
      }
    },
    brain: "local",
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    asr: { state: "disabled" },
    vadControl: { engine: "adaptive-energy-vad", state: "ready" },
    vadShadow: { state: "disabled" },
    tts: {
      state: "ready",
      engine: "windows-system-speech",
      voice: "Microsoft Maria Desktop",
      culture: "pt-BR"
    }
  };
}

function stopEvidence(navigationIndex, trialIndex) {
  const activeAt = 1_000 + navigationIndex * 1_000 + trialIndex * 50;
  const active = {
    atMs: activeAt,
    type: "assistant.render.active",
    detail: "fixture"
  };
  const planned = activeAt + EXP0020_TRIGGER_DELAY_MS;
  const trigger = planned + 4;
  const pause = {
    atMs: trigger + (trialIndex % 2 === 0 ? 8 : 4),
    type: "assistant.speech.paused",
    detail: "fixture"
  };
  const render = {
    atMs: trigger + (trialIndex % 2 === 0 ? 4 : 8),
    type: "assistant.render.stopped",
    detail: "fixture"
  };
  const latest = Math.max(pause.atMs, render.atMs);
  const lastRenderStop = {
    kind: "browser-render-stop",
    latencyMs: 40,
    renderedThroughTrigger: true
  };
  const finalSnapshot = {
    observedAtMs: latest + EXP0020_POST_MARKER_HORIZON_MS + 1,
    state: { assistantSpeaking: false, potentialBargeIn: "pending" },
    audio: {
      lastRenderStop: structuredClone(lastRenderStop),
      renderProbe: { pendingMeasurements: 0 },
      outputInterruptionLifecycle: { phase: "held", pauseKind: "audible" }
    },
    trace: [active, ...[pause, render].toSorted(
      (left, right) => left.atMs - right.atMs
    )]
  };
  return {
    schemaVersion: EXP0025_BROWSER_TRIAL_RESULT_SCHEMA,
    status: EXP0025_BROWSER_TRIAL_STATUSES.collected,
    phase: "complete",
    code: null,
    message: null,
    navigationIndex,
    trialIndex,
    turnId: `exp0020-nav-${navigationIndex}-trial-${trialIndex}`,
    resetAtPerformanceMs: activeAt - 50,
    resetSnapshot: { trace: [] },
    activeSnapshot: { observedAtMs: activeAt, trace: [active] },
    startSnapshot: { observedAtMs: activeAt, trace: [active] },
    anchorTraceIndex: 0,
    activeMarker: active,
    preTriggerSnapshot: { observedAtMs: trigger, trace: [active] },
    preTriggerActiveMarkers: [active],
    plannedTriggerAtPerformanceMs: planned,
    triggerAtPerformanceMs: trigger,
    timerErrorMs: 4,
    markerEvents: { paused: [pause], renderStopped: [render] },
    latestMarkerAtPerformanceMs: latest,
    latestStopMarkerTraceIndex: 2,
    markerSnapshotObservedAtMs: latest,
    renderStopAtMarkers: structuredClone(lastRenderStop),
    finalSnapshotAtPerformanceMs: finalSnapshot.observedAtMs,
    postLatestMarkerHorizonMs: finalSnapshot.observedAtMs - latest,
    newRenderActiveMarkers: [],
    renderStopUnchanged: true,
    finalSnapshot
  };
}

function captured(requestId) {
  return {
    status: "captured",
    code: null,
    requestId,
    readCount: 1,
    emptyResponsesBeforeSuccess: 0,
    attempts: [{
      index: 1,
      delayBeforeReadMs: 0,
      requestedAtMs: 10,
      completedAtMs: 11,
      outcome: "captured"
    }],
    base64Encoded: true,
    byteLength: EXP0025_EXPECTED_WAV_BYTES,
    sha256: EXP0025_EXPECTED_WAV_SHA256,
    bytes: Buffer.alloc(EXP0025_EXPECTED_WAV_BYTES)
  };
}

function createFakeChrome() {
  let listener = () => {};
  let navigationIndex = 0;
  let requestSequence = 0;
  let timestamp = 1;
  let latestTrial = null;

  function emitLifecycle({
    id,
    url,
    method = "GET",
    type = "Fetch",
    postData,
    headers = {},
    mimeType = "application/json"
  }) {
    const frameId = `frame-${navigationIndex}`;
    const loaderId = `loader-${navigationIndex}`;
    listener({
      method: "Network.requestWillBeSent",
      params: {
        requestId: id,
        timestamp: timestamp++,
        type,
        frameId,
        loaderId,
        request: { url, method, headers, ...(postData ? { postData } : {}) }
      }
    });
    listener({
      method: "Network.responseReceived",
      params: {
        requestId: id,
        timestamp: timestamp++,
        type,
        frameId,
        loaderId,
        response: {
          url,
          status: 200,
          mimeType,
          fromDiskCache: false,
          fromServiceWorker: false
        }
      }
    });
    listener({
      method: "Network.loadingFinished",
      params: {
        requestId: id,
        timestamp: timestamp++,
        encodedDataLength: url === TTS_URL
          ? EXP0025_EXPECTED_WAV_BYTES
          : 256
      }
    });
  }

  return {
    binding: {
      endpoint: "http://172.20.32.1:9223/",
      hostPolicy: "wsl-default-gateway",
      initialTarget: "about:blank",
      targetId: "target-fixture",
      webSocketPath: "/devtools/page/target-fixture"
    },
    async send(method, params = {}) {
      if (method === "Browser.getVersion") {
        return {
          protocolVersion: "1.3",
          product: "Chrome/150.0.7871.187",
          revision: "fixture",
          userAgent: "Chrome fixture",
          jsVersion: "15"
        };
      }
      if (method === "Page.navigate") {
        navigationIndex += 1;
        emitLifecycle({
          id: `document-${navigationIndex}`,
          url: params.url,
          type: "Document",
          mimeType: "text/html"
        });
        emitLifecycle({
          id: `bootstrap-${navigationIndex}`,
          url: HEALTH_URL
        });
      }
      return {};
    },
    async evaluate(expression) {
      if (expression.includes("EXP0022_WAIT_READY")) return true;
      if (expression.includes("EXP0022_BROWSER_HEALTH_BINDING")) {
        const probeId = `nav-${navigationIndex}`;
        const url = `${HEALTH_URL}?exp0022_probe=${probeId}`;
        emitLifecycle({
          id: `audit-${navigationIndex}`,
          url,
          headers: { "x-duplex-exp-0022-audit": "audit-health-v0.1" }
        });
        return {
          probeId,
          url,
          status: 200,
          mimeType: "application/json",
          health: health()
        };
      }
      if (expression.includes("EXP0025_RUN_STOP_TRIAL")) {
        const match = /exp0020-nav-(\d+)-trial-(\d+)/u.exec(expression);
        assert.ok(match);
        const trialIndex = Number(match[2]);
        latestTrial = stopEvidence(navigationIndex, trialIndex);
        requestSequence += 1;
        emitLifecycle({
          id: `tts-${requestSequence}`,
          url: TTS_URL,
          method: "POST",
          postData: JSON.stringify({ text: EXP0020_FIXED_PHRASE }),
          mimeType: "audio/wav"
        });
        return latestTrial;
      }
      if (expression.includes("EXP0025_READ_NAVIGATION_EVIDENCE")) {
        return {
          audit: {
            installedAtMs: 1,
            audioConstructors: {
              Audio: 6,
              AudioContext: 0,
              webkitAudioContext: 0
            },
            calls: { htmlMediaElementPlay: 6, speechSynthesisSpeak: 0 }
          },
          snapshot: latestTrial.finalSnapshot
        };
      }
      throw new Error(`expressão fake desconhecida: ${expression.slice(0, 80)}`);
    },
    async waitFor(probe) { return probe(); },
    onEvent(next) {
      listener = next;
      return () => { listener = () => {}; };
    },
    async closeTarget() {},
    close() {}
  };
}

test("campanha 2x6 persiste somente o núcleo causal de STOP-R", async () => {
  const records = [];
  const envelope = await runExp0025BrowserCampaign({
    chrome: createFakeChrome(),
    emitRecord: async (type, payload) => {
      createExp0025JournalFrame({ ordinal: 1, type, payload });
      records.push({ type, payload: structuredClone(payload) });
    }
  });

  assert.equal(validateExp0025WorkerEnvelopeShape(envelope).valid, true);
  const physical = records.filter((record) =>
    record.type === "PHYSICAL_TRIAL_RESULT");
  assert.equal(physical.length, 12);
  for (const trial of physical) {
    assert.equal(trial.payload.requestId, null);
    assert.equal(trial.payload.trialId, trial.payload.turnId);
  }
  assert.equal(records.filter((record) =>
    record.type === "BROWSER_BOUND").length, 1);
  assert.equal(records.filter((record) =>
    record.type === "NAVIGATION_STARTED").length, 2);
  assert.equal(records.filter((record) =>
    record.type === "NAVIGATION_COMPLETED").length, 2);
  assert.equal(records.length, 17);
  assert.deepEqual(envelope.campaign.provenanceDiagnostics, {
    health: "NOT_COLLECTED",
    networkLedger: "NOT_COLLECTED",
    wavCapture: "NOT_COLLECTED"
  });
  assert.equal(records.some((record) => [
    "HEALTH_BEFORE",
    "HEALTH_AFTER",
    "NAVIGATION_AUDITED",
    "NETWORK_REQUEST",
    "CAPTURE_COMPLETED",
    "BUDGET_INPUTS"
  ].includes(record.type)), false);
  assert.doesNotMatch(JSON.stringify(records), /bodyBase64|"bytes"/u);
});
