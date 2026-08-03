import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0020_FIXED_PHRASE,
  EXP0020_POST_MARKER_HORIZON_MS,
  EXP0020_TRIGGER_DELAY_MS
} from "../scripts/lib/exp-0020-browser-harness.mjs";
import {
  EXP0024_EXPECTED_WAV_BYTES,
  EXP0024_EXPECTED_WAV_SHA256,
  EXP0024_TARGET_URL,
  runExp0024BrowserCampaign,
  validateExp0024WorkerEnvelopeShape
} from "../scripts/lib/exp-0024-browser-harness.mjs";
import { createExp0024JournalFrame } from
  "../src/eval/exp-0024-journal.mjs";

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
    navigationIndex,
    trialIndex,
    turnId: `exp0020-nav-${navigationIndex}-trial-${trialIndex}`,
    resetAtPerformanceMs: activeAt - 50,
    resetSnapshot: { trace: [] },
    activeSnapshot: { observedAtMs: activeAt, trace: [active] },
    startSnapshot: { observedAtMs: activeAt, trace: [active] },
    activeMarker: active,
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
    byteLength: EXP0024_EXPECTED_WAV_BYTES,
    sha256: EXP0024_EXPECTED_WAV_SHA256,
    bytes: Buffer.alloc(EXP0024_EXPECTED_WAV_BYTES)
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
          ? EXP0024_EXPECTED_WAV_BYTES
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
      if (expression.includes("EXP0020_RUN_STOP_TRIAL")) {
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
      if (expression.includes("EXP0024_READ_NAVIGATION_EVIDENCE")) {
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

test("campanha 2x6 persiste cada STOP antes de juntar a captura", async () => {
  const records = [];
  let releaseFirstCapture = null;
  let captureCount = 0;
  const envelope = await runExp0024BrowserCampaign({
    chrome: createFakeChrome(),
    fetchHealth: async () => health(),
    capture: async ({ requestId }) => {
      captureCount += 1;
      if (captureCount !== 1) return captured(requestId);
      return new Promise((resolveCapture) => {
        releaseFirstCapture = () => resolveCapture(captured(requestId));
      });
    },
    emitRecord: async (type, payload) => {
      createExp0024JournalFrame({ ordinal: 1, type, payload });
      records.push({ type, payload: structuredClone(payload) });
      if (type === "PHYSICAL_TRIAL_COMPLETED" && releaseFirstCapture) {
        const release = releaseFirstCapture;
        releaseFirstCapture = null;
        release();
      }
    }
  });

  assert.equal(validateExp0024WorkerEnvelopeShape(envelope).valid, true);
  assert.equal(captureCount, 12);
  const physical = records.filter((record) =>
    record.type === "PHYSICAL_TRIAL_COMPLETED");
  const captures = records.filter((record) =>
    record.type === "CAPTURE_COMPLETED");
  assert.equal(physical.length, 12);
  assert.equal(captures.length, 12);
  for (const trial of physical) {
    const physicalIndex = records.indexOf(trial);
    const captureIndex = records.findIndex((record) =>
      record.type === "CAPTURE_COMPLETED" &&
        record.payload.requestId === trial.payload.requestId);
    assert.ok(physicalIndex < captureIndex);
    assert.equal(trial.payload.trialId, trial.payload.turnId);
  }
  assert.ok(captures.every((record) =>
    record.payload.status === "qualified" &&
      record.payload.sha256 === EXP0024_EXPECTED_WAV_SHA256 &&
      record.payload.byteLength === EXP0024_EXPECTED_WAV_BYTES));
  assert.equal(records.filter((record) =>
    record.type === "NETWORK_REQUEST" &&
      record.payload.url === TTS_URL).length, 12);
  assert.doesNotMatch(JSON.stringify(records), /bodyBase64|"bytes"/u);
});
