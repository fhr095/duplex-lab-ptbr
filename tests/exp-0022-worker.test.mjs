import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EXP0021_NETWORK_ENABLE_OPTIONS as EXP0022_NETWORK_ENABLE_OPTIONS
} from "../scripts/lib/exp-0021-cdp-capture.mjs";
import {
  EXP0022_BOUNDARY_PATHS,
  EXP0022_TRIAL_ORDER
} from "../src/eval/exp-0022-boundary.mjs";
import {
  EXP0022_CONFIG,
  EXP0022_PATHS
} from "../src/eval/exp-0022-bootstrap-audit-health-binding.mjs";
import {
  EXP0022_TARGET_URL,
  EXP0022_TTS_URL,
  EXP0022_WORKER_ENVELOPE_SCHEMA,
  EXP0022_WORKER_ORDER,
  EXP0022_WORKER_PAYLOADS,
  createExp0022HealthBinding,
  createExp0022NetworkTracker,
  exp0022BrowserAuditSource,
  exp0022BrowserFetchExpression,
  exp0022BrowserHealthExpression,
  exp0022BoundWebSocketUrl,
  exp0022CdpUrlFromRoute,
  isExp0022AllowedNetworkUrl,
  parseExp0022TtsPostData,
  runExp0022WorkerCampaign
} from "../scripts/run-exp-0022-worker.mjs";
import { validateExp0022WorkerEnvelopeShape } from
  "../scripts/run-exp-0022-supervisor.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function captured(requestId, sha256 = HASH_A) {
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
    byteLength: 64,
    sha256,
    bytes: Buffer.alloc(64)
  };
}

function captureFailure(requestId) {
  return {
    status: "capture-failure",
    code: "CDP_RESPONSE_BODY_EMPTY_EXHAUSTED",
    requestId,
    readCount: 4,
    emptyResponsesBeforeFailure: 4,
    attempts: [0, 8, 24, 64].map((delayBeforeReadMs, index) => ({
      index: index + 1,
      delayBeforeReadMs,
      requestedAtMs: 10 + index,
      completedAtMs: 11 + index,
      outcome: "empty"
    }))
  };
}

function emitUnit(tracker, input = {}) {
  const requestId = input.requestId ?? "req-a1";
  const text = input.text ?? EXP0022_WORKER_PAYLOADS.A.text;
  tracker.handleEvent({
    method: "Network.requestWillBeSent",
    params: {
      requestId,
      timestamp: 1,
      type: "Fetch",
      request: {
        url: EXP0022_TTS_URL,
        method: "POST",
        postData: JSON.stringify({ text })
      }
    }
  });
  tracker.handleEvent({
    method: "Network.responseReceived",
    params: {
      requestId,
      response: {
        url: EXP0022_TTS_URL,
        status: input.status ?? 200,
        mimeType: input.mimeType ?? "audio/wav"
      }
    }
  });
  tracker.handleEvent({
    method: "Network.loadingFinished",
    params: {
      requestId,
      encodedDataLength: input.encodedDataLength ?? 64
    }
  });
}

test("worker congela dois payloads distinguíveis e ordem A1/B1/B2/A2", () => {
  assert.deepEqual(EXP0022_WORKER_ORDER.map((unit) => unit.trialId), [
    "A1", "B1", "B2", "A2"
  ]);
  assert.deepEqual(EXP0022_WORKER_ORDER.map((unit) => unit.sequence), [
    1, 2, 3, 4
  ]);
  assert.notEqual(
    EXP0022_WORKER_PAYLOADS.A.text,
    EXP0022_WORKER_PAYLOADS.B.text
  );
  assert.equal(EXP0022_WORKER_PAYLOADS.A.rate, 1);
  assert.equal(EXP0022_WORKER_PAYLOADS.B.rate, 1);
  assert.deepEqual(EXP0022_CONFIG.networkEnable,
    EXP0022_NETWORK_ENABLE_OPTIONS);
  assert.deepEqual(EXP0022_PATHS, {
    report: EXP0022_BOUNDARY_PATHS.report,
    freeze: EXP0022_BOUNDARY_PATHS.freeze,
    attempt: EXP0022_BOUNDARY_PATHS.attempt,
    receipt: EXP0022_BOUNDARY_PATHS.receipt,
    preregistration: EXP0022_BOUNDARY_PATHS.preregistration
  });
  assert.deepEqual(
    EXP0022_TRIAL_ORDER.map(({ navigation, position, ...identity }, index) => ({
      navigationIndex: navigation,
      unitIndex: position,
      sequence: index + 1,
      ...identity
    })),
    EXP0022_WORKER_ORDER
  );
});

test("browser faz fetch e digest sem chamar fala ou playback", () => {
  const expression = exp0022BrowserFetchExpression(
    EXP0022_WORKER_PAYLOADS.A.text
  );
  assert.match(expression, /fetch\("\/api\/tts"/u);
  assert.match(expression, /crypto\.subtle\.digest/u);
  assert.doesNotMatch(expression, /\.speak(?:Loop)?\s*\(/u);
  assert.doesNotMatch(expression, /\.play\s*\(/u);

  const audit = exp0022BrowserAuditSource();
  for (const token of [
    "AudioContext",
    "webkitAudioContext",
    "HTMLMediaElement",
    "speechSynthesisSpeak"
  ]) assert.match(audit, new RegExp(token, "u"));

  const healthBinding = exp0022BrowserHealthExpression(1);
  assert.match(healthBinding, /exp0022_probe/u);
  assert.match(healthBinding, /x-duplex-exp-0022-audit/u);
  assert.match(healthBinding, /nav-1/u);
  assert.match(healthBinding, /response\.json\(\)/u);
  assert.throws(() => exp0022BrowserHealthExpression(0));
});

test("autoridade CDP fica no gateway WSL e WebSocket no target criado", () => {
  const route = "default via 172.20.32.1 dev eth0 proto kernel\n";
  assert.equal(
    exp0022CdpUrlFromRoute(route),
    "http://172.20.32.1:9223/"
  );
  assert.equal(
    exp0022CdpUrlFromRoute(route, {
      CDP_URL: "http://172.20.32.1:9223/"
    }),
    "http://172.20.32.1:9223/"
  );
  assert.throws(
    () => exp0022CdpUrlFromRoute(route, {
      CDP_URL: "http://192.0.2.8:9223/"
    }),
    /gateway WSL/iu
  );
  const bound = exp0022BoundWebSocketUrl(
    "http://172.20.32.1:9223/",
    {
      id: "target-1",
      webSocketDebuggerUrl: "ws://localhost:9223/devtools/page/target-1"
    }
  );
  assert.equal(
    bound.socketUrl,
    "ws://172.20.32.1:9223/devtools/page/target-1"
  );
  assert.deepEqual(bound.binding, {
    endpoint: "http://172.20.32.1:9223/",
    hostPolicy: "wsl-default-gateway",
    initialTarget: "about:blank",
    targetId: "target-1",
    webSocketPath: "/devtools/page/target-1"
  });
  assert.throws(
    () => exp0022BoundWebSocketUrl(
      "http://172.20.32.1:9223/",
      {
        id: "target-1",
        webSocketDebuggerUrl: "ws://localhost:9223/devtools/page/other"
      }
    ),
    /target criado/iu
  );
});

test("tracker liga um único requestId e remove bytes/base64 do envelope", async () => {
  const calls = [];
  const tracker = createExp0022NetworkTracker({
    send: async (method, params) => calls.push({ method, params }),
    capture: async ({ requestId }) => captured(requestId)
  });
  tracker.beginUnit({
    navigationIndex: 1,
    unitIndex: 1,
    trialId: "A1",
    payloadId: "A",
    sequence: 1,
    text: EXP0022_WORKER_PAYLOADS.A.text
  });
  emitUnit(tracker);
  const unit = await tracker.finishUnit({
    url: EXP0022_TTS_URL,
    status: 200,
    mimeType: "audio/wav",
    byteLength: 64,
    sha256: HASH_A
  });
  assert.deepEqual(unit.cdp.observedRequestIds, ["req-a1"]);
  assert.equal(unit.cdp.requestWillBeSentCount, 1);
  assert.equal(unit.cdp.responseReceivedCount, 1);
  assert.equal(unit.cdp.loadingFinishedCount, 1);
  assert.deepEqual(unit.cdp.postData, {
    text: EXP0022_WORKER_PAYLOADS.A.text
  });
  assert.equal(unit.cdp.capture.status, "success");
  assert.equal(unit.cdp.capture.attempts[0].requestId, "req-a1");
  assert.equal(Object.hasOwn(unit.cdp.capture, "bytes"), false);
  assert.equal(Object.hasOwn(unit.cdp.capture, "bodyBase64"), false);
  assert.deepEqual(calls, []);
});

test("tracker sinaliza requestId stale/cross-trial em vez de aceitá-lo", async () => {
  const tracker = createExp0022NetworkTracker({
    send: async () => ({}),
    capture: async ({ requestId }) => captured(requestId)
  });
  tracker.beginUnit({
    navigationIndex: 1,
    unitIndex: 1,
    trialId: "A1",
    payloadId: "A",
    sequence: 1,
    text: EXP0022_WORKER_PAYLOADS.A.text
  });
  emitUnit(tracker, { requestId: "reused" });
  await tracker.finishUnit({ sha256: HASH_A });

  tracker.beginUnit({
    navigationIndex: 1,
    unitIndex: 2,
    trialId: "B1",
    payloadId: "B",
    sequence: 2,
    text: EXP0022_WORKER_PAYLOADS.B.text
  });
  emitUnit(tracker, {
    requestId: "reused",
    text: EXP0022_WORKER_PAYLOADS.B.text
  });
  await tracker.finishUnit({ sha256: HASH_B });
  assert.ok(tracker.getDiagnostics().structuralErrors.some(
    (entry) => entry.code === "REQUEST_ID_REUSED_CROSS_TRIAL"
  ));
});

test("status/MIME/overflow falham tipados antes de ler o body", async () => {
  for (const [overrides, expectedCode] of [
    [{ status: 503 }, "TTS_HTTP_STATUS_INVALID"],
    [{ mimeType: "application/json" }, "TTS_MIME_TYPE_INVALID"],
    [{ encodedDataLength: 0 }, "CDP_ENCODED_LENGTH_INVALID"],
    [{
      encodedDataLength: EXP0022_NETWORK_ENABLE_OPTIONS.maxResourceBufferSize
    }, "CDP_RESOURCE_BUFFER_EXCEEDED"]
  ]) {
    let captureCalls = 0;
    const tracker = createExp0022NetworkTracker({
      send: async () => ({}),
      capture: async ({ requestId }) => {
        captureCalls += 1;
        return captured(requestId);
      }
    });
    tracker.beginUnit({
      navigationIndex: 1,
      unitIndex: 1,
      trialId: "A1",
      payloadId: "A",
      sequence: 1,
      text: EXP0022_WORKER_PAYLOADS.A.text
    });
    emitUnit(tracker, overrides);
    const unit = await tracker.finishUnit({ sha256: HASH_A });
    assert.equal(unit.cdp.capture.status, "failure");
    assert.equal(unit.cdp.capture.code, expectedCode);
    assert.equal(unit.cdp.capture.readCount, 0);
    assert.equal(captureCalls, 0);
  }
});

test("URL e postData falham fechados fora da origem/payload exatos", () => {
  assert.equal(isExp0022AllowedNetworkUrl(EXP0022_TARGET_URL), true);
  assert.equal(isExp0022AllowedNetworkUrl(EXP0022_TTS_URL), true);
  assert.equal(isExp0022AllowedNetworkUrl("https://example.com/a.js"), false);
  assert.deepEqual(parseExp0022TtsPostData(JSON.stringify({ text: "A" })), {
    valid: true,
    text: "A"
  });
  assert.equal(parseExp0022TtsPostData("{}").valid, false);
  assert.equal(parseExp0022TtsPostData("not-json").valid, false);
});

test("binding deriva bootstrap e audit apenas do delta observado", () => {
  const records = new Map([
    ["bootstrap-1", {
      requestId: "bootstrap-1",
      loadingFinishedCount: 1,
      finishedTimestamp: 3
    }],
    ["audit-1", { requestId: "audit-1" }]
  ]);
  const binding = createExp0022HealthBinding({
    before: {
      boundaryOrdinal: 3,
      networkRequestIds: ["document-1", "bootstrap-1"],
      healthRequestIds: ["bootstrap-1"],
      pendingRequestIds: []
    },
    after: {
      boundaryOrdinal: 6,
      networkRequestIds: ["document-1", "bootstrap-1", "audit-1"],
      healthRequestIds: ["bootstrap-1", "audit-1"],
      pendingRequestIds: []
    },
    getHealthRecord: (requestId) => records.get(requestId)
  });
  assert.equal(binding.bootstrapHealthRequestId, "bootstrap-1");
  assert.equal(binding.auditHealthRequestId, "audit-1");
  assert.deepEqual(binding.newNetworkRequestIds, ["audit-1"]);
  assert.deepEqual(binding.newHealthRequestIds, ["audit-1"]);
  assert.equal(binding.bootstrapFinishedBeforeAudit, true);
});

function health() {
  return {
    process: {
      runId: "runtime-1",
      runtimeFingerprint: { sha256: HASH_A }
    },
    brain: "local",
    usage: {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    },
    asr: { state: "disabled" },
    vadControl: { engine: "adaptive-energy-vad" },
    vadShadow: { state: "disabled" },
    tts: {
      state: "ready",
      engine: "windows-system-speech",
      voice: "Microsoft Maria Desktop",
      culture: "pt-BR"
    }
  };
}

function fakeChrome(captureMode = "success") {
  let listener = null;
  let requestSequence = 0;
  let navigationSequence = 0;
  let networkTimestamp = 0;
  let closed = false;
  const commands = [];
  const digests = {
    A: `sha256:${createHash("sha256").update("payload-a").digest("hex")}`,
    B: `sha256:${createHash("sha256").update("payload-b").digest("hex")}`
  };
  const emitHealth = ({ audit = false } = {}) => {
    const probeId = `nav-${navigationSequence}`;
    const url = new URL("/api/health", EXP0022_TARGET_URL);
    if (audit) {
      url.searchParams.set(
        EXP0022_CONFIG.healthBinding.auditQueryName,
        probeId
      );
    }
    const requestId = `${audit ? "audit" : "bootstrap"}-${probeId}`;
    const loaderId = `loader-${navigationSequence}`;
    const frameId = `frame-${navigationSequence}`;
    listener({
      method: "Network.requestWillBeSent",
      params: {
        requestId,
        timestamp: ++networkTimestamp,
        type: "Fetch",
        loaderId,
        frameId,
        request: {
          url: url.href,
          method: "GET",
          headers: audit ? {
            [EXP0022_CONFIG.healthBinding.auditHeaderName]:
              EXP0022_CONFIG.healthBinding.auditHeaderValue
          } : {}
        }
      }
    });
    listener({
      method: "Network.responseReceived",
      params: {
        requestId,
        timestamp: ++networkTimestamp,
        type: "Fetch",
        loaderId,
        response: {
          url: url.href,
          status: 200,
          mimeType: "application/json"
        }
      }
    });
    listener({
      method: "Network.loadingFinished",
      params: {
        requestId,
        timestamp: ++networkTimestamp,
        encodedDataLength: 100
      }
    });
    return { probeId, url: url.href };
  };
  const chrome = {
    commands,
    get closed() { return closed; },
    binding: {
      endpoint: "http://172.20.32.1:9223/",
      hostPolicy: "wsl-default-gateway",
      initialTarget: "about:blank",
      targetId: "target-fake",
      webSocketPath: "/devtools/page/target-fake"
    },
    onEvent(next) {
      listener = next;
      return () => { listener = null; };
    },
    send: async (method, params = {}) => {
      commands.push({ method, params });
      if (method === "Browser.getVersion") {
        return {
          product: "Chrome/150.0.0.0",
          protocolVersion: "1.3",
          userAgent: "fake"
        };
      }
      if (method === "Page.navigate") {
        navigationSequence += 1;
        emitHealth();
      }
      return {};
    },
    waitFor: async (probe) => {
      assert.equal(await probe(), true);
      return true;
    },
    evaluate: async (expression) => {
      if (expression.includes("EXP0022_WAIT_READY")) return true;
      if (expression.includes("EXP0022_BROWSER_HEALTH_BINDING")) {
        const audit = emitHealth({ audit: true });
        return {
          probeId: audit.probeId,
          url: audit.url,
          status: 200,
          mimeType: "application/json",
          health: health()
        };
      }
      if (expression.includes("EXP0022_READ_NEGATIVE_BUDGET")) {
        return {
          audit: {
            schemaVersion: "exp-0022-browser-negative-budget-v1",
            audioConstructors: {
              Audio: 0,
              AudioContext: 0,
              webkitAudioContext: 0
            },
            calls: {
              htmlMediaElementPlay: 0,
              speechSynthesisSpeak: 0
            },
            installedAtMs: 1
          },
          snapshot: {
            state: {
              active: false,
              inputMode: null,
              assistantSpeaking: false
            },
            trace: [{ type: "automation.ready" }],
            trainingTrace: { decisions: [], effects: [] },
            reflexTrainingTrace: { decisions: [], effects: [] },
            audio: {
              capture: null,
              transport: { socketReadyState: null },
              vadControl: { state: "unknown" },
              vadShadow: { health: { state: "unknown" } },
              outputInterruptionLifecycle: { phase: "idle" }
            }
          }
        };
      }
      if (expression.includes("EXP0022_BROWSER_TTS_FETCH")) {
        requestSequence += 1;
        const payloadId = ["A", "B", "B", "A"][requestSequence - 1];
        const requestId = `req-${requestSequence}`;
        emitUnit({ handleEvent: listener }, {
          requestId,
          text: EXP0022_WORKER_PAYLOADS[payloadId].text
        });
        return {
          url: EXP0022_TTS_URL,
          status: 200,
          mimeType: "audio/wav",
          byteLength: 64,
          sha256: digests[payloadId]
        };
      }
      throw new Error(`expressão fake desconhecida: ${expression.slice(0, 80)}`);
    },
    close() { closed = true; }
  };
  const capture = async ({ requestId }) => {
    const index = Number.parseInt(requestId.split("-")[1], 10);
    if (captureMode === "first-fails" && index === 1) {
      return captureFailure(requestId);
    }
    const payloadId = ["A", "B", "B", "A"][index - 1];
    return captured(requestId, digests[payloadId]);
  };
  return { chrome, capture };
}

test("campanha fake executa 2x2, buffers exatos e budget negativo", async () => {
  const fixture = fakeChrome();
  const envelope = await runExp0022WorkerCampaign({
    chrome: fixture.chrome,
    capture: fixture.capture,
    fetchHealth: async () => health(),
    startedAt: "2026-08-03T00:00:00.000Z",
    completedAt: "2026-08-03T00:01:00.000Z"
  });
  assert.equal(envelope.schemaVersion, EXP0022_WORKER_ENVELOPE_SCHEMA);
  assert.equal(envelope.status, "completed");
  assert.equal(validateExp0022WorkerEnvelopeShape(envelope), true);
  assert.deepEqual(
    envelope.campaign.navigations.flatMap((navigation) =>
      navigation.units.map((unit) => unit.trialId)),
    ["A1", "B1", "B2", "A2"]
  );
  assert.equal(envelope.campaign.budget.ttsRequests, 4);
  assert.deepEqual(envelope.campaign.budget, EXP0022_CONFIG.negativeBudget);
  assert.deepEqual(envelope.campaign.budget.audioConstructors, {
    Audio: 0,
    AudioContext: 0,
    webkitAudioContext: 0
  });
  assert.equal(envelope.campaign.budget.externalRequests, 0);
  assert.equal(envelope.campaign.navigations.length, 2);
  assert.ok(envelope.campaign.navigations.every((navigation) =>
    navigation.browserHealth.health.process.runId === "runtime-1"));
  assert.deepEqual(envelope.campaign.budget.usageDelta, {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  });
  assert.ok(fixture.chrome.commands.some(({ method, params }) =>
    method === "Network.enable" &&
      assert.deepEqual(params, EXP0022_NETWORK_ENABLE_OPTIONS) === undefined
  ));
  assert.equal(fixture.chrome.closed, true);
});

test("falha CDP esperada preserva envelope e pede FIX ao analisador", async () => {
  const fixture = fakeChrome("first-fails");
  const envelope = await runExp0022WorkerCampaign({
    chrome: fixture.chrome,
    capture: fixture.capture,
    fetchHealth: async () => health()
  });
  assert.equal(envelope.status, "capture-failure");
  assert.equal(
    envelope.failure.code,
    "CDP_RESPONSE_BODY_EMPTY_EXHAUSTED"
  );
  const first = envelope.campaign.navigations[0].units[0];
  assert.equal(first.cdp.capture.status, "failure");
  assert.equal(first.cdp.capture.readCount, 4);
  assert.deepEqual(
    first.cdp.capture.attempts.map((attempt) => attempt.requestId),
    ["req-1", "req-1", "req-1", "req-1"]
  );
});
