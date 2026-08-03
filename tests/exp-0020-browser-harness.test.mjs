import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0020_FIXED_PHRASE,
  EXP0020_NAVIGATION_COUNT,
  EXP0020_POST_MARKER_HORIZON_MS,
  EXP0020_TARGET_URL,
  EXP0020_TOTAL_TRIALS,
  EXP0020_TRIALS_PER_NAVIGATION,
  EXP0020_TRIGGER_DELAY_MS,
  assertExp0020TargetUrl,
  connectExp0020Chrome,
  createExp0020TestOnlyCardinality,
  decodeExp0020CdpBody,
  exp0020TrialExpression,
  isExp0020AllowedNetworkUrl,
  isExp0020TtsUrl,
  parseExp0020TtsRequestPostData,
  resolveExp0020Cardinality,
  runExp0020BrowserCampaign,
  validateExp0020OfficialCardinality,
  validateExp0020TrialCollection
} from "../scripts/lib/exp-0020-browser-harness.mjs";

const WAV_BYTES = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from("WAVE"),
  Buffer.from([0, 1, 2, 3, 4, 5])
]);

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
    state: {
      assistantSpeaking: false,
      potentialBargeIn: "pending"
    },
    audio: {
      lastRenderStop: structuredClone(lastRenderStop),
      renderProbe: { pendingMeasurements: 0 },
      outputInterruptionLifecycle: {
        phase: "held",
        pauseKind: "audible"
      }
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
    markerEvents: {
      paused: [pause],
      renderStopped: [render]
    },
    latestMarkerAtPerformanceMs: latest,
    latestStopMarkerTraceIndex: 2,
    markerSnapshotObservedAtMs: latest,
    renderStopAtMarkers: structuredClone(lastRenderStop),
    finalSnapshotAtPerformanceMs: finalSnapshot.observedAtMs,
    postLatestMarkerHorizonMs:
      finalSnapshot.observedAtMs - latest,
    newRenderActiveMarkers: [],
    renderStopUnchanged: true,
    finalSnapshot
  };
}

function ttsRecord(sequence) {
  return {
    sequence,
    requestId: `tts-${sequence}`,
    url: "http://localhost:4173/api/tts",
    method: "POST",
    requestBody: { text: EXP0020_FIXED_PHRASE, rate: 1 },
    rate: 1,
    status: 200,
    mimeType: "audio/wav",
    bodyBase64: WAV_BYTES.toString("base64"),
    bytes: Buffer.from(WAV_BYTES),
    byteLength: WAV_BYTES.byteLength,
    sha256: "sha256:46f9a253b2117ecb75738f95e558f3178df600c30861e58b7cde7b0d67e6f86f"
  };
}

function createFakeChrome() {
  const commands = [];
  const expressions = [];
  const bodies = [];
  const networkRequests = [];
  let navigation = 0;
  let trial = 0;
  let closed = false;
  const diagnostics = {
    consoleErrors: [],
    runtimeErrors: [],
    httpErrors: [],
    networkViolations: [],
    ttsCaptureErrors: []
  };
  return {
    commands,
    expressions,
    diagnostics,
    get closed() {
      return closed;
    },
    async send(method, params = {}) {
      commands.push({ method, params });
      if (method === "Page.navigate") {
        navigation += 1;
        trial = 0;
        networkRequests.push({
          requestId: `page-${navigation}`,
          url: params.url,
          method: "GET",
          type: "Document",
          timestamp: navigation
        });
      }
      return method === "Browser.getVersion"
        ? { product: "Chrome/fixture", revision: "fixture" }
        : {};
    },
    async evaluate(expression) {
      expressions.push(expression);
      if (expression.includes("EXP0020_WAIT_READY")) return true;
      assert.match(expression, /EXP0020_RUN_STOP_TRIAL/u);
      trial += 1;
      networkRequests.push({
        requestId: `tts-${navigation}-${trial}`,
        url: "http://localhost:4173/api/tts",
        method: "POST",
        type: "Fetch",
        timestamp: navigation * 100 + trial
      });
      bodies.push(ttsRecord(bodies.length + 1));
      return stopEvidence(navigation, trial);
    },
    async waitFor(probe) {
      const value = await probe();
      assert.ok(value);
      return value;
    },
    async waitForTtsBodies(expected) {
      assert.equal(bodies.length, expected);
      return bodies.map((body) => ({
        ...body,
        bytes: Buffer.from(body.bytes)
      }));
    },
    getTtsBodies() {
      return bodies.map((body) => ({
        ...body,
        bytes: Buffer.from(body.bytes)
      }));
    },
    getNetworkRequests() {
      return structuredClone(networkRequests);
    },
    getDiagnostics() {
      return structuredClone(diagnostics);
    },
    clearDiagnostics() {},
    assertLocalNetworkOnly() {
      assert.deepEqual(diagnostics.networkViolations, []);
    },
    close() {
      closed = true;
    }
  };
}

test("URL e cardinalidade oficiais são hard locks", () => {
  assert.equal(assertExp0020TargetUrl(), EXP0020_TARGET_URL);
  assert.deepEqual(resolveExp0020Cardinality(), {
    navigations: EXP0020_NAVIGATION_COUNT,
    trialsPerNavigation: EXP0020_TRIALS_PER_NAVIGATION,
    totalTrials: EXP0020_TOTAL_TRIALS
  });
  assert.equal(validateExp0020OfficialCardinality({
    navigations: 2,
    trialsPerNavigation: 6,
    totalTrials: 12
  }), true);
  assert.throws(
    () => assertExp0020TargetUrl(
      "http://127.0.0.1:4173/?automation=1&experiment=0020"
    ),
    /URL precisa ser exatamente/iu
  );
  assert.throws(
    () => assertExp0020TargetUrl(
      "http://localhost:4173/?automation=1&experiment=0020&extra=1"
    ),
    /URL precisa ser exatamente/iu
  );
  assert.throws(
    () => resolveExp0020Cardinality({ trialsPerNavigation: 5 }),
    /não pode parametrizar/iu
  );
  assert.throws(
    () => resolveExp0020Cardinality({
      cardinality: {
        navigations: 2,
        trialsPerNavigation: 5,
        totalTrials: 10
      }
    }),
    /2 navegações × 6/iu
  );
  assert.throws(
    () => resolveExp0020Cardinality({
      testOnlyCardinality: {
        navigations: 1,
        trialsPerNavigation: 1,
        totalTrials: 1
      }
    }),
    /factory explicitamente test-only/iu
  );
});

test("política de rede aceita somente a origem local congelada", () => {
  assert.equal(isExp0020AllowedNetworkUrl(
    "http://localhost:4173/api/health"
  ), true);
  assert.equal(isExp0020AllowedNetworkUrl(
    "ws://localhost:4173/audio"
  ), true);
  assert.equal(isExp0020TtsUrl(
    "http://localhost:4173/api/tts"
  ), true);
  assert.equal(isExp0020AllowedNetworkUrl(
    "http://localhost:4174/api/tts"
  ), false);
  assert.equal(isExp0020AllowedNetworkUrl(
    "https://api.openai.com/v1/responses"
  ), false);
  assert.equal(isExp0020TtsUrl(
    "http://localhost:4173/api/health"
  ), false);
});

test("expressão ancora trigger e horizonte no performance.now browser", () => {
  const expression = exp0020TrialExpression({
    navigationIndex: 2,
    trialIndex: 6
  });
  assert.match(expression, /EXP0020_RUN_STOP_TRIAL/u);
  assert.match(expression, /performance\.now\(\)/u);
  assert.match(expression, /plannedTriggerAtPerformanceMs/u);
  assert.match(expression, /\+ 320/u);
  assert.match(expression, /\+\s+250 \+ 1/u);
  assert.match(expression, new RegExp(EXP0020_FIXED_PHRASE, "u"));
  assert.match(expression, /exp0020-nav-2-trial-6/u);
  assert.match(expression, /newRenderActiveMarkers/u);
  assert.doesNotThrow(() => new Function(`return ${expression};`));
});

test("promessa browser executa trigger e snapshot no horizonte causal", async () => {
  let clock = 0;
  let activeAt = null;
  let triggerAt = null;
  let phrase = null;
  let lastRenderStop = null;
  let assistantSpeaking = false;
  const trace = [];
  const pushScheduledEvents = () => {
    if (activeAt !== null && clock >= activeAt &&
      !trace.some((event) => event.type === "assistant.render.active")) {
      trace.push({
        atMs: activeAt,
        type: "assistant.render.active",
        detail: "fake browser"
      });
      assistantSpeaking = true;
    }
    if (triggerAt !== null && clock >= triggerAt + 5 &&
      !trace.some((event) => event.type === "assistant.speech.paused")) {
      trace.push({
        atMs: triggerAt + 5,
        type: "assistant.speech.paused",
        detail: "fake browser"
      });
      assistantSpeaking = false;
    }
    if (triggerAt !== null && clock >= triggerAt + 7 &&
      !trace.some((event) => event.type === "assistant.render.stopped")) {
      trace.push({
        atMs: triggerAt + 7,
        type: "assistant.render.stopped",
        detail: "fake browser"
      });
      lastRenderStop = {
        kind: "browser-render-stop",
        latencyMs: 7,
        renderedThroughTrigger: true
      };
    }
  };
  const snapshot = () => {
    pushScheduledEvents();
    return {
      observedAtMs: clock,
      state: {
        assistantSpeaking,
        potentialBargeIn: triggerAt === null ? null : "pending"
      },
      audio: {
        lastRenderStop: structuredClone(lastRenderStop),
        renderProbe: { pendingMeasurements: 0 },
        outputInterruptionLifecycle: {
          phase: triggerAt === null ? "idle" : "held",
          pauseKind: triggerAt === null ? null : "audible"
        }
      },
      trace: structuredClone(trace)
    };
  };
  const lab = {
    reset() {
      trace.length = 0;
      activeAt = null;
      triggerAt = null;
      lastRenderStop = null;
      assistantSpeaking = false;
      return snapshot();
    },
    speakLoop(value) {
      phrase = value;
      activeAt = clock + 10;
    },
    simulateAudioEvent(event) {
      assert.equal(event.type, "user.speech.started");
      assert.equal(event.turnId, "exp0020-nav-1-trial-1");
      triggerAt = clock;
      return snapshot();
    },
    snapshot
  };
  const fakeSetTimeout = (callback, delayMs) => {
    clock += Math.max(0, Number(delayMs));
    pushScheduledEvents();
    queueMicrotask(callback);
    return 1;
  };
  const expression = exp0020TrialExpression({
    navigationIndex: 1,
    trialIndex: 1
  });
  const execute = new Function(
    "window",
    "performance",
    "setTimeout",
    `return ${expression};`
  );
  const collected = await execute(
    { __duplexLab: lab },
    { now: () => clock },
    fakeSetTimeout
  );

  assert.equal(phrase, EXP0020_FIXED_PHRASE);
  assert.equal(collected.triggerAtPerformanceMs, 330);
  assert.equal(collected.timerErrorMs, 0);
  assert.equal(collected.postLatestMarkerHorizonMs, 251);
  assert.equal(collected.startSnapshot.state.assistantSpeaking, true);
  assert.equal(collected.newRenderActiveMarkers.length, 0);
  assert.deepEqual(validateExp0020TrialCollection(collected), {
    valid: true,
    errors: []
  });
});

test("validador recusa timer, horizonte e reativação adulterados", () => {
  const valid = stopEvidence(1, 1);
  assert.deepEqual(validateExp0020TrialCollection(valid), {
    valid: true,
    errors: []
  });

  const early = structuredClone(valid);
  early.postLatestMarkerHorizonMs = 249;
  early.finalSnapshotAtPerformanceMs =
    early.latestMarkerAtPerformanceMs + 249;
  early.finalSnapshot.observedAtMs = early.finalSnapshotAtPerformanceMs;
  assert.equal(validateExp0020TrialCollection(early).valid, false);

  const lateTimer = structuredClone(valid);
  lateTimer.triggerAtPerformanceMs =
    lateTimer.plannedTriggerAtPerformanceMs + 11;
  lateTimer.timerErrorMs = 11;
  assert.equal(validateExp0020TrialCollection(lateTimer).valid, false);

  const reactivated = structuredClone(valid);
  const extra = {
    atMs: reactivated.latestMarkerAtPerformanceMs + 100,
    type: "assistant.render.active",
    detail: "reativou"
  };
  reactivated.finalSnapshot.trace.push(extra);
  reactivated.newRenderActiveMarkers.push(extra);
  assert.equal(validateExp0020TrialCollection(reactivated).valid, false);

  const preStopActive = structuredClone(valid);
  preStopActive.finalSnapshot.trace.splice(1, 0, {
    atMs: preStopActive.triggerAtPerformanceMs + 1,
    type: "assistant.render.active",
    detail: "atividade natural anterior ao STOP"
  });
  preStopActive.latestStopMarkerTraceIndex = 3;
  assert.deepEqual(validateExp0020TrialCollection(preStopActive), {
    valid: true,
    errors: []
  });

  const afterRenderBeforePause = stopEvidence(1, 2);
  const betweenMarkers = {
    atMs: afterRenderBeforePause.triggerAtPerformanceMs + 6,
    type: "assistant.render.active",
    detail: "reativou depois do renderer"
  };
  afterRenderBeforePause.finalSnapshot.trace.splice(2, 0, betweenMarkers);
  afterRenderBeforePause.latestStopMarkerTraceIndex = 3;
  assert.deepEqual(
    validateExp0020TrialCollection(afterRenderBeforePause),
    { valid: true, errors: [] }
  );
});

test("campanha fake oficial faz somente 2 navegações × 6 trials", async () => {
  const chrome = createFakeChrome();
  const campaign = await runExp0020BrowserCampaign({
    cdpUrl: "http://fake-cdp:9223",
    connectChrome: async () => chrome
  });
  assert.equal(campaign.navigations.length, 2);
  assert.equal(campaign.ttsResponses.length, 12);
  assert.equal(
    chrome.commands.filter((command) =>
      command.method === "Page.navigate"
    ).length,
    2
  );
  assert.deepEqual(
    campaign.navigations.map((navigation) => navigation.trials.length),
    [6, 6]
  );
  const trials = campaign.navigations.flatMap(
    (navigation) => navigation.trials
  );
  assert.equal(new Set(trials.map((trial) => trial.turnId)).size, 12);
  assert.equal(trials.every((trial) =>
    trial.tts.wavSha256 === trial.tts.sha256 &&
    trial.tts.rate === 1 &&
    trial.timing.renderActiveAtMs === trial.activeMarker.atMs &&
    trial.timing.plannedTriggerAtMs ===
      trial.plannedTriggerAtPerformanceMs &&
    trial.timing.actualTriggerAtMs === trial.triggerAtPerformanceMs &&
    trial.timing.postStopObservedAtMs ===
      trial.finalSnapshot.observedAtMs &&
    trial.startSnapshot !== null), true);
  assert.equal(trials.every((trial) =>
    trial.collectionValidation.valid), true);
  assert.equal(new Set(campaign.ttsResponses.map(
    (response) => response.sha256
  )).size, 1);
  assert.equal(chrome.closed, true);
  assert.equal(campaign.browser.product, "Chrome/fixture");
  assert.equal(campaign.networkRequests.length, 14);
  assert.equal(campaign.navigations.every((navigation) =>
    navigation.browserProduct === "Chrome/fixture" &&
    navigation.networkUrls.length === 2 &&
    navigation.networkUrls.includes(EXP0020_TARGET_URL) &&
    navigation.networkUrls.includes(
      "http://localhost:4173/api/tts"
    )), true);
});

test("cardinalidade reduzida exige capability test-only", async () => {
  const chrome = createFakeChrome();
  const testOnlyCardinality = createExp0020TestOnlyCardinality({
    navigations: 1,
    trialsPerNavigation: 2
  });
  const campaign = await runExp0020BrowserCampaign({
    cdpUrl: "http://fake-cdp:9223",
    connectChrome: async () => chrome,
    testOnlyCardinality
  });
  assert.equal(campaign.navigations.length, 1);
  assert.equal(campaign.navigations[0].trials.length, 2);
  assert.equal(campaign.ttsResponses.length, 2);
});

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.bodyByRequestId = new Map();
    this.postDataByRequestId = new Map();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  message(value) {
    this.emit("message", { data: JSON.stringify(value) });
  }

  send(serialized) {
    const command = JSON.parse(serialized);
    const result = command.method === "Network.getResponseBody"
      ? this.bodyByRequestId.get(command.params.requestId)
      : command.method === "Network.getRequestPostData"
        ? {
            postData: this.postDataByRequestId.get(
              command.params.requestId
            )
          }
        : {};
    queueMicrotask(() => this.message({ id: command.id, result }));
  }

  close() {
    this.emit("close", {});
  }
}

test("CDP captura bytes exatos do TTS e torna rede externa observável", async () => {
  FakeWebSocket.instances.length = 0;
  const chrome = await connectExp0020Chrome({
    cdpUrl: "http://fake-cdp:9223",
    targetUrl: EXP0020_TARGET_URL,
    WebSocketImpl: FakeWebSocket,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return [{
          type: "page",
          url: EXP0020_TARGET_URL,
          webSocketDebuggerUrl: "ws://fake/page"
        }];
      }
    })
  });
  const socket = FakeWebSocket.instances[0];
  socket.bodyByRequestId.set("tts-1", {
    body: WAV_BYTES.toString("base64"),
    base64Encoded: true
  });
  socket.message({
    method: "Network.requestWillBeSent",
    params: {
      requestId: "tts-1",
      request: {
        url: "http://localhost:4173/api/tts",
        method: "POST",
        postData: JSON.stringify({ text: EXP0020_FIXED_PHRASE })
      }
    }
  });
  socket.message({
    method: "Network.responseReceived",
    params: {
      requestId: "tts-1",
      response: {
        url: "http://localhost:4173/api/tts",
        status: 200,
        mimeType: "audio/wav"
      }
    }
  });
  socket.message({
    method: "Network.loadingFinished",
    params: { requestId: "tts-1" }
  });
  const [captured] = await chrome.waitForTtsBodies(1, 1_000);
  assert.deepEqual(captured.bytes, WAV_BYTES);
  assert.equal(captured.bodyBase64, WAV_BYTES.toString("base64"));
  assert.equal(captured.byteLength, WAV_BYTES.byteLength);

  socket.bodyByRequestId.set("tts-2", {
    body: WAV_BYTES.toString("base64"),
    base64Encoded: true
  });
  socket.postDataByRequestId.set(
    "tts-2",
    JSON.stringify({ text: EXP0020_FIXED_PHRASE })
  );
  socket.message({
    method: "Network.requestWillBeSent",
    params: {
      requestId: "tts-2",
      request: {
        url: "http://localhost:4173/api/tts",
        method: "POST"
      }
    }
  });
  socket.message({
    method: "Network.responseReceived",
    params: {
      requestId: "tts-2",
      response: {
        url: "http://localhost:4173/api/tts",
        status: 200,
        mimeType: "audio/wav"
      }
    }
  });
  socket.message({
    method: "Network.loadingFinished",
    params: { requestId: "tts-2" }
  });
  const captures = await chrome.waitForTtsBodies(2, 1_000);
  assert.equal(captures[1].rate, 1);
  assert.equal(captures[1].requestBody.text, EXP0020_FIXED_PHRASE);

  socket.message({
    method: "Network.webSocketCreated",
    params: {
      requestId: "ws-local",
      url: "ws://localhost:4173/audio",
      timestamp: 10
    }
  });
  assert.equal(chrome.getDiagnostics().networkViolations.length, 0);
  assert.equal(chrome.getNetworkRequests().at(-1).type, "WebSocket");

  socket.message({
    method: "Network.requestWillBeSent",
    params: {
      requestId: "tts-extra",
      request: {
        url: "http://localhost:4173/api/tts",
        method: "POST",
        postData: JSON.stringify({ text: EXP0020_FIXED_PHRASE })
      }
    }
  });
  await assert.rejects(
    chrome.waitForTtsBodies(2, 100),
    /cardinalidade \/api\/tts excedeu 2/iu
  );

  socket.message({
    method: "Network.requestWillBeSent",
    params: {
      requestId: "external-1",
      request: {
        url: "https://api.openai.com/v1/responses",
        method: "POST"
      }
    }
  });
  assert.equal(chrome.getDiagnostics().networkViolations.length, 1);
  assert.throws(
    () => chrome.assertLocalNetworkOnly(),
    /rede não local.*api\.openai\.com/iu
  );
  chrome.close();
});

test("decoder CDP recusa corpo não base64 e corpo vazio", () => {
  const decoded = decodeExp0020CdpBody({
    body: WAV_BYTES.toString("base64"),
    base64Encoded: true
  });
  assert.deepEqual(decoded.bytes, WAV_BYTES);
  assert.throws(
    () => decodeExp0020CdpBody({
      body: WAV_BYTES.toString("latin1"),
      base64Encoded: false
    }),
    /base64/iu
  );
  assert.throws(
    () => decodeExp0020CdpBody({ body: "", base64Encoded: true }),
    /corpo vazio/iu
  );
  assert.throws(
    () => decodeExp0020CdpBody({
      body: "@@@@",
      base64Encoded: true
    }),
    /base64 inválido/iu
  );
});

test("request do TTS prova frase fixa e rate default", () => {
  assert.deepEqual(
    parseExp0020TtsRequestPostData(JSON.stringify({
      text: EXP0020_FIXED_PHRASE
    })),
    { text: EXP0020_FIXED_PHRASE, rate: 1 }
  );
  assert.throws(
    () => parseExp0020TtsRequestPostData(JSON.stringify({
      text: "outra frase"
    })),
    /frase congelada/iu
  );
  assert.throws(
    () => parseExp0020TtsRequestPostData(JSON.stringify({
      text: EXP0020_FIXED_PHRASE,
      rate: 1.1
    })),
    /somente a frase/iu
  );
});
