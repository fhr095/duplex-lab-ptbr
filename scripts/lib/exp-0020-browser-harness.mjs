import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const EXP0020_TARGET_URL =
  "http://localhost:4173/?automation=1&experiment=0020";
export const EXP0020_NAVIGATION_COUNT = 2;
export const EXP0020_TRIALS_PER_NAVIGATION = 6;
export const EXP0020_TOTAL_TRIALS = 12;
export const EXP0020_TRIGGER_DELAY_MS = 320;
export const EXP0020_TRIGGER_ERROR_MAX_MS = 10;
export const EXP0020_POST_MARKER_HORIZON_MS = 250;
export const EXP0020_TTS_PATH = "/api/tts";
export const EXP0020_FIXED_PHRASE =
  "Esta fala contínua mede uma única parada física do assistente.";

const COMMAND_TIMEOUT_MS = 10_000;
const PAGE_READY_TIMEOUT_MS = 60_000;
const TRIAL_TIMEOUT_MS = 90_000;
const TEST_CARDINALITY_BRAND = Symbol("EXP0020_TEST_CARDINALITY");
const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`EXP-0020 browser harness: ${message}`);
  }
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneDiagnostics(value) {
  return {
    consoleErrors: [...(value?.consoleErrors ?? [])],
    runtimeErrors: [...(value?.runtimeErrors ?? [])],
    httpErrors: structuredClone(value?.httpErrors ?? []),
    networkViolations: structuredClone(value?.networkViolations ?? []),
    ttsCaptureErrors: [...(value?.ttsCaptureErrors ?? [])]
  };
}

function clearDiagnostics(value) {
  value.consoleErrors.length = 0;
  value.runtimeErrors.length = 0;
  value.httpErrors.length = 0;
  value.networkViolations.length = 0;
  value.ttsCaptureErrors.length = 0;
}

export function validateExp0020OfficialCardinality(value) {
  return value?.navigations === EXP0020_NAVIGATION_COUNT &&
    value?.trialsPerNavigation === EXP0020_TRIALS_PER_NAVIGATION &&
    value?.totalTrials === EXP0020_TOTAL_TRIALS;
}

export function createExp0020TestOnlyCardinality(input = {}) {
  const navigations = input.navigations;
  const trialsPerNavigation = input.trialsPerNavigation;
  invariant(
    Number.isInteger(navigations) && navigations > 0 &&
      Number.isInteger(trialsPerNavigation) && trialsPerNavigation > 0,
    "cardinalidade fake precisa conter inteiros positivos"
  );
  return Object.freeze({
    [TEST_CARDINALITY_BRAND]: true,
    navigations,
    trialsPerNavigation,
    totalTrials: navigations * trialsPerNavigation
  });
}

export function resolveExp0020Cardinality(options = {}) {
  for (const forbidden of [
    "navigations",
    "navigationCount",
    "trials",
    "trialsPerNavigation",
    "totalTrials"
  ]) {
    invariant(
      !Object.hasOwn(options, forbidden),
      `${forbidden} não pode parametrizar a campanha oficial`
    );
  }
  if (options.testOnlyCardinality !== undefined) {
    invariant(
      options.testOnlyCardinality?.[TEST_CARDINALITY_BRAND] === true,
      "override de cardinalidade exige factory explicitamente test-only"
    );
    return options.testOnlyCardinality;
  }
  const cardinality = options.cardinality ?? {
    navigations: EXP0020_NAVIGATION_COUNT,
    trialsPerNavigation: EXP0020_TRIALS_PER_NAVIGATION,
    totalTrials: EXP0020_TOTAL_TRIALS
  };
  invariant(
    validateExp0020OfficialCardinality(cardinality),
    "campanha oficial exige exatamente 2 navegações × 6 STOPs"
  );
  return Object.freeze({ ...cardinality });
}

export function assertExp0020TargetUrl(value = EXP0020_TARGET_URL) {
  let normalized = null;
  try {
    normalized = new URL(value).href;
  } catch {
    // Falha fechada abaixo.
  }
  invariant(
    normalized === EXP0020_TARGET_URL,
    `URL precisa ser exatamente ${EXP0020_TARGET_URL}`
  );
  return normalized;
}

export function isExp0020AllowedNetworkUrl(
  value,
  targetUrl = EXP0020_TARGET_URL
) {
  let url;
  let target;
  try {
    url = new URL(value);
    target = new URL(assertExp0020TargetUrl(targetUrl));
  } catch {
    return false;
  }
  if (!NETWORK_PROTOCOLS.has(url.protocol)) {
    return ["about:", "blob:", "data:"].includes(url.protocol) &&
      (url.protocol !== "blob:" || url.origin === target.origin);
  }
  const targetPort = target.port || (target.protocol === "https:" ? "443" : "80");
  const candidatePort = url.port ||
    (["https:", "wss:"].includes(url.protocol) ? "443" : "80");
  return url.hostname === "localhost" && candidatePort === targetPort &&
    ["http:", "ws:"].includes(url.protocol);
}

export function isExp0020TtsUrl(value, targetUrl = EXP0020_TARGET_URL) {
  if (!isExp0020AllowedNetworkUrl(value, targetUrl)) return false;
  try {
    const url = new URL(value);
    const target = new URL(targetUrl);
    return url.protocol === target.protocol && url.origin === target.origin &&
      url.pathname === EXP0020_TTS_PATH && url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

export function decodeExp0020CdpBody(payload) {
  invariant(
    payload !== null && typeof payload === "object" &&
      nonEmptyText(payload.body),
    "Network.getResponseBody retornou corpo vazio"
  );
  invariant(
    payload.base64Encoded === true,
    "WAV do TTS precisa chegar em base64 para preservar bytes"
  );
  invariant(
    payload.body.length % 4 === 0 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
        .test(payload.body),
    "corpo WAV contém base64 inválido"
  );
  const bytes = Buffer.from(payload.body, "base64");
  invariant(
    bytes.toString("base64") === payload.body,
    "round-trip base64 do WAV divergiu"
  );
  invariant(bytes.byteLength > 0, "WAV do TTS decodificou vazio");
  invariant(
    bytes.byteLength >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WAVE",
    "resposta /api/tts não contém envelope WAV RIFF/WAVE"
  );
  return Object.freeze({
    bodyBase64: bytes.toString("base64"),
    bytes,
    byteLength: bytes.byteLength,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  });
}

export function parseExp0020TtsRequestPostData(value) {
  let parsed = null;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Falha fechada abaixo.
  }
  invariant(
    parsed !== null && typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      isDeepStrictEqual(Object.keys(parsed).sort(), ["text"]) &&
      parsed.text === EXP0020_FIXED_PHRASE,
    "request /api/tts não contém somente a frase congelada"
  );
  return Object.freeze({ text: parsed.text, rate: 1 });
}

export function discoverExp0020CdpUrl(environment = process.env) {
  if (nonEmptyText(environment.CDP_URL)) return environment.CDP_URL;
  const route = execFileSync("ip", ["route", "show", "default"], {
    encoding: "utf8"
  });
  const gateway = /\bvia\s+([0-9.]+)/u.exec(route)?.[1];
  invariant(gateway, "gateway do Chrome do Windows não encontrado");
  return `http://${gateway}:9223`;
}

function consoleDiagnostic(argumentsList) {
  return argumentsList.map(
    (argument) => argument.value ?? argument.description ?? ""
  ).join(" ").slice(0, 500);
}

export async function connectExp0020Chrome(options = {}) {
  const targetUrl = assertExp0020TargetUrl(options.targetUrl);
  const cdpUrl = options.cdpUrl;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  invariant(nonEmptyText(cdpUrl), "URL CDP ausente");
  invariant(typeof fetchImpl === "function", "fetch CDP indisponível");
  invariant(typeof WebSocketImpl === "function", "WebSocket CDP indisponível");

  const listResponse = await fetchImpl(`${cdpUrl}/json/list`, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  invariant(listResponse.ok, `CDP retornou HTTP ${listResponse.status}`);
  const pages = await listResponse.json();
  const targetOrigin = new URL(targetUrl).origin;
  let page = pages.find((candidate) => {
    if (candidate.type !== "page") return false;
    try {
      return new URL(candidate.url).origin === targetOrigin;
    } catch {
      return false;
    }
  });
  if (!page) {
    const createResponse = await fetchImpl(
      `${cdpUrl}/json/new?${encodeURIComponent(targetUrl)}`,
      { method: "PUT", signal: AbortSignal.timeout(timeoutMs) }
    );
    invariant(createResponse.ok,
      `CDP não criou aba: HTTP ${createResponse.status}`);
    page = await createResponse.json();
  }
  invariant(nonEmptyText(page?.webSocketDebuggerUrl),
    "aba CDP não publicou WebSocket");

  const socket = new WebSocketImpl(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(
      () => rejectOpen(new Error("timeout conectando ao CDP")),
      timeoutMs
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolveOpen();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      rejectOpen(new Error("falha conectando ao CDP"));
    }, { once: true });
  });

  const diagnostics = {
    consoleErrors: [],
    runtimeErrors: [],
    httpErrors: [],
    networkViolations: [],
    ttsCaptureErrors: []
  };
  const pendingCommands = new Map();
  const ttsRequests = new Map();
  const ttsResponses = new Map();
  const pendingTtsCaptures = new Set();
  const ttsBodies = [];
  const networkRequests = [];
  let commandSequence = 0;
  let requestSequence = 0;

  function recordNetwork(url, method, source) {
    if (!isExp0020AllowedNetworkUrl(url, targetUrl)) {
      diagnostics.networkViolations.push({ url, method, source });
    }
  }

  function send(method, params = {}, commandTimeoutMs = timeoutMs) {
    return new Promise((resolveCommand, rejectCommand) => {
      commandSequence += 1;
      const id = commandSequence;
      const timer = setTimeout(() => {
        pendingCommands.delete(id);
        rejectCommand(new Error(`timeout CDP: ${method}`));
      }, commandTimeoutMs);
      pendingCommands.set(id, { resolveCommand, rejectCommand, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  function captureTtsBody(requestId) {
    if (!ttsResponses.has(requestId)) return;
    const response = ttsResponses.get(requestId);
    const operation = Promise.all([
      send("Network.getResponseBody", { requestId }),
      nonEmptyText(response.postData)
        ? Promise.resolve({ postData: response.postData })
        : send("Network.getRequestPostData", { requestId })
    ])
      .then(([body, requestPostData]) => {
        const decoded = decodeExp0020CdpBody(body);
        const requestBody = parseExp0020TtsRequestPostData(
          requestPostData.postData
        );
        invariant(response.status === 200,
          `/api/tts retornou HTTP ${response.status}`);
        invariant(response.method === "POST",
          "/api/tts precisa ser requisitado por POST");
        invariant(response.mimeType === "audio/wav",
          `/api/tts retornou MIME ${response.mimeType ?? "ausente"}`);
        ttsBodies.push(Object.freeze({
          sequence: response.sequence,
          requestId,
          url: response.url,
          method: response.method,
          requestBody,
          rate: requestBody.rate,
          status: response.status,
          mimeType: response.mimeType,
          ...decoded
        }));
      })
      .catch((error) => {
        diagnostics.ttsCaptureErrors.push(
          `${requestId}: ${error.message}`
        );
      })
      .finally(() => pendingTtsCaptures.delete(operation));
    pendingTtsCaptures.add(operation);
  }

  socket.addEventListener("message", ({ data }) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      diagnostics.runtimeErrors.push(`CDP JSON inválido: ${error.message}`);
      return;
    }
    if (message.id && pendingCommands.has(message.id)) {
      const pending = pendingCommands.get(message.id);
      pendingCommands.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.rejectCommand(new Error(message.error.message));
      } else {
        pending.resolveCommand(message.result);
      }
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error") {
      diagnostics.consoleErrors.push(
        consoleDiagnostic(message.params.args)
      );
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      diagnostics.runtimeErrors.push(
        (message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text).slice(0, 500)
      );
      return;
    }
    if (
      message.method === "Network.webSocketCreated" ||
      message.method === "Network.webTransportCreated"
    ) {
      const requestId = message.params.requestId ??
        message.params.transportId ?? null;
      const type = message.method === "Network.webSocketCreated"
        ? "WebSocket"
        : "WebTransport";
      networkRequests.push({
        requestId,
        url: message.params.url,
        method: "CONNECT",
        type,
        timestamp: message.params.timestamp ?? null
      });
      recordNetwork(message.params.url, "CONNECT", type);
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params.request;
      networkRequests.push({
        requestId: message.params.requestId,
        url: request.url,
        method: request.method,
        type: message.params.type ?? null,
        timestamp: message.params.timestamp ?? null
      });
      recordNetwork(request.url, request.method, "request");
      if (isExp0020TtsUrl(request.url, targetUrl)) {
        requestSequence += 1;
        ttsRequests.set(message.params.requestId, {
          sequence: requestSequence,
          url: request.url,
          method: request.method,
          postData: request.postData ?? null
        });
      }
      return;
    }
    if (message.method === "Network.responseReceived") {
      const response = message.params.response;
      recordNetwork(response.url, null, "response");
      if (response.status >= 400) {
        diagnostics.httpErrors.push({
          status: response.status,
          url: response.url
        });
      }
      if (isExp0020TtsUrl(response.url, targetUrl)) {
        const request = ttsRequests.get(message.params.requestId) ?? {
          sequence: ++requestSequence,
          url: response.url,
          method: null,
          postData: null
        };
        ttsResponses.set(message.params.requestId, {
          ...request,
          status: response.status,
          mimeType: response.mimeType ?? null
        });
      }
      return;
    }
    if (message.method === "Network.loadingFinished") {
      captureTtsBody(message.params.requestId);
    }
  });
  socket.addEventListener("close", () => {
    for (const pending of pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.rejectCommand(new Error("CDP desconectado"));
    }
    pendingCommands.clear();
  });

  async function evaluate(expression, commandTimeoutMs = timeoutMs) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, commandTimeoutMs);
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
      );
    }
    return result.result?.value;
  }

  async function waitFor(probe, waitTimeoutMs = PAGE_READY_TIMEOUT_MS) {
    const deadline = Date.now() + waitTimeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await probe();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    throw new Error(
      "condição CDP não satisfeita" +
        (lastError ? `: ${lastError.message}` : "")
    );
  }

  async function waitForTtsBodies(expected, waitTimeoutMs = TRIAL_TIMEOUT_MS) {
    invariant(Number.isInteger(expected) && expected >= 0,
      "contagem esperada de TTS inválida");
    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      if (diagnostics.ttsCaptureErrors.length > 0) {
        throw new Error(diagnostics.ttsCaptureErrors.join("; "));
      }
      if (
        ttsRequests.size > expected ||
        ttsResponses.size > expected ||
        ttsBodies.length > expected
      ) {
        throw new Error(
          `cardinalidade /api/tts excedeu ${expected}: ` +
            `${ttsRequests.size} requests, ${ttsResponses.size} responses, ` +
            `${ttsBodies.length} bodies`
        );
      }
      if (
        ttsRequests.size === expected &&
        ttsResponses.size === expected &&
        ttsBodies.length === expected &&
        pendingTtsCaptures.size === 0
      ) {
        return ttsBodies.map((record) => ({
          ...record,
          bytes: Buffer.from(record.bytes)
        }));
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
    throw new Error(
      `timeout capturando /api/tts: ${ttsBodies.length}/${expected}`
    );
  }

  return Object.freeze({
    page,
    socket,
    diagnostics,
    send,
    evaluate,
    waitFor,
    waitForTtsBodies,
    getTtsBodies() {
      return ttsBodies.map((record) => ({
        ...record,
        bytes: Buffer.from(record.bytes)
      }));
    },
    getNetworkRequests() {
      return structuredClone(networkRequests);
    },
    getDiagnostics() {
      return cloneDiagnostics(diagnostics);
    },
    clearDiagnostics() {
      clearDiagnostics(diagnostics);
    },
    assertLocalNetworkOnly() {
      invariant(
        diagnostics.networkViolations.length === 0,
        `rede não local observada: ${diagnostics.networkViolations
          .map((item) => item.url).join(", ")}`
      );
    },
    close() {
      socket.close();
    }
  });
}

function readyExpression() {
  return `/*EXP0020_WAIT_READY*/ (() => {
    const lab = window.__duplexLab;
    return Boolean(
      lab && typeof lab.reset === "function" &&
      typeof lab.snapshot === "function" &&
      typeof lab.speakLoop === "function" &&
      typeof lab.simulateAudioEvent === "function"
    );
  })()`;
}

export function exp0020TrialExpression(input) {
  const navigationIndex = input.navigationIndex;
  const trialIndex = input.trialIndex;
  invariant(Number.isInteger(navigationIndex) && navigationIndex > 0,
    "navigationIndex inválido");
  invariant(Number.isInteger(trialIndex) && trialIndex > 0,
    "trialIndex inválido");
  const turnId = `exp0020-nav-${navigationIndex}-trial-${trialIndex}`;
  return `/*EXP0020_RUN_STOP_TRIAL*/ (async () => {
    const lab = window.__duplexLab;
    if (!lab) throw new Error("automação indisponível");
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForSnapshot = async (predicate, timeoutMs, label) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() <= deadline) {
        const snapshot = lab.snapshot();
        if (predicate(snapshot)) return snapshot;
        await delay(4);
      }
      throw new Error("timeout aguardando " + label);
    };
    const waitUntil = async (targetAtMs) => {
      while (performance.now() < targetAtMs) {
        await delay(Math.max(0, targetAtMs - performance.now()));
      }
    };
    const resetAtPerformanceMs = performance.now();
    const resetSnapshot = lab.reset();
    lab.speakLoop(${JSON.stringify(EXP0020_FIXED_PHRASE)});
    const activeSnapshot = await waitForSnapshot(
      (snapshot) => snapshot.trace.some(
        (event) => event.type === "assistant.render.active"
      ),
      ${PAGE_READY_TIMEOUT_MS},
      "primeiro assistant.render.active"
    );
    const activeMarkers = activeSnapshot.trace.filter(
      (event) => event.type === "assistant.render.active"
    );
    if (activeMarkers.length !== 1) {
      throw new Error("trial precisa de um único render.active inicial");
    }
    const activeMarker = activeMarkers[0];
    const plannedTriggerAtPerformanceMs =
      activeMarker.atMs + ${EXP0020_TRIGGER_DELAY_MS};
    await waitUntil(plannedTriggerAtPerformanceMs);
    const triggerAtPerformanceMs = performance.now();
    lab.simulateAudioEvent({
      type: "user.speech.started",
      turnId: ${JSON.stringify(turnId)},
      rms: 0.06,
      threshold: 0.025
    });
    const markerSnapshot = await waitForSnapshot(
      (snapshot) => {
        const paused = snapshot.trace.filter(
          (event) => event.type === "assistant.speech.paused"
        );
        const stopped = snapshot.trace.filter(
          (event) => event.type === "assistant.render.stopped"
        );
        return paused.length >= 1 && stopped.length >= 1;
      },
      ${COMMAND_TIMEOUT_MS},
      "marcadores concorrentes de STOP"
    );
    const pausedAtMarkers = markerSnapshot.trace.filter(
      (event) => event.type === "assistant.speech.paused"
    );
    const stoppedAtMarkers = markerSnapshot.trace.filter(
      (event) => event.type === "assistant.render.stopped"
    );
    let latestMarkerAtPerformanceMs = Math.max(
      ...pausedAtMarkers.map((event) => event.atMs),
      ...stoppedAtMarkers.map((event) => event.atMs)
    );
    let latestMarkerSnapshot = markerSnapshot;
    let finalSnapshot = null;
    while (finalSnapshot === null) {
      await waitUntil(
        latestMarkerAtPerformanceMs +
          ${EXP0020_POST_MARKER_HORIZON_MS} + 1
      );
      const candidate = lab.snapshot();
      const candidateMarkers = candidate.trace.filter(
        (event) => event.type === "assistant.speech.paused" ||
          event.type === "assistant.render.stopped"
      );
      const candidateLatest = Math.max(
        ...candidateMarkers.map((event) => event.atMs)
      );
      if (candidateLatest > latestMarkerAtPerformanceMs) {
        latestMarkerAtPerformanceMs = candidateLatest;
        latestMarkerSnapshot = candidate;
      } else {
        finalSnapshot = candidate;
      }
    }
    const finalSnapshotAtPerformanceMs = finalSnapshot.observedAtMs;
    const finalPausedMarkers = finalSnapshot.trace.filter(
      (event) => event.type === "assistant.speech.paused"
    );
    const finalStoppedMarkers = finalSnapshot.trace.filter(
      (event) => event.type === "assistant.render.stopped"
    );
    const latestStopMarkerTraceIndex = Math.max(
      ...finalSnapshot.trace.flatMap((event, index) =>
        event.type === "assistant.speech.paused" ||
          event.type === "assistant.render.stopped"
          ? [index]
          : []
      )
    );
    const newRenderActiveMarkers = finalSnapshot.trace
      .slice(latestStopMarkerTraceIndex + 1)
      .filter(
        (event) => event.type === "assistant.render.active"
      );
    return {
      navigationIndex: ${navigationIndex},
      trialIndex: ${trialIndex},
      turnId: ${JSON.stringify(turnId)},
      resetAtPerformanceMs,
      resetSnapshot,
      activeSnapshot,
      startSnapshot: activeSnapshot,
      activeMarker,
      plannedTriggerAtPerformanceMs,
      triggerAtPerformanceMs,
      timerErrorMs:
        triggerAtPerformanceMs - plannedTriggerAtPerformanceMs,
      markerEvents: {
        paused: finalPausedMarkers,
        renderStopped: finalStoppedMarkers
      },
      latestMarkerAtPerformanceMs,
      latestStopMarkerTraceIndex,
      markerSnapshotObservedAtMs: latestMarkerSnapshot.observedAtMs,
      renderStopAtMarkers: latestMarkerSnapshot.audio.lastRenderStop,
      finalSnapshotAtPerformanceMs,
      postLatestMarkerHorizonMs:
        finalSnapshotAtPerformanceMs - latestMarkerAtPerformanceMs,
      newRenderActiveMarkers,
      renderStopUnchanged: JSON.stringify(
        latestMarkerSnapshot.audio.lastRenderStop
      ) === JSON.stringify(finalSnapshot.audio.lastRenderStop),
      finalSnapshot
    };
  })()`;
}

export function validateExp0020TrialCollection(trial) {
  const errors = [];
  const paused = trial?.markerEvents?.paused;
  const stopped = trial?.markerEvents?.renderStopped;
  const finalTrace = trial?.finalSnapshot?.trace;
  const expectedTurnId = Number.isInteger(trial?.navigationIndex) &&
    Number.isInteger(trial?.trialIndex)
    ? `exp0020-nav-${trial.navigationIndex}-trial-${trial.trialIndex}`
    : null;
  if (
    expectedTurnId === null || trial.turnId !== expectedTurnId ||
    trial?.activeMarker?.type !== "assistant.render.active"
  ) {
    errors.push("identidade do trial ou render.active inicial divergiu");
  }
  if (
    !Number.isFinite(trial?.plannedTriggerAtPerformanceMs) ||
    trial.plannedTriggerAtPerformanceMs - trial.activeMarker?.atMs !==
      EXP0020_TRIGGER_DELAY_MS ||
    !Number.isFinite(trial?.triggerAtPerformanceMs) ||
    trial.timerErrorMs !== trial.triggerAtPerformanceMs -
      trial.plannedTriggerAtPerformanceMs ||
    trial.timerErrorMs < 0 ||
    trial.timerErrorMs > EXP0020_TRIGGER_ERROR_MAX_MS
  ) {
    errors.push("trigger não respeitou 320 ms com erro de 0–10 ms");
  }
  if (
    !Array.isArray(paused) || paused.length !== 1 ||
    paused[0]?.type !== "assistant.speech.paused" ||
    !Array.isArray(stopped) || stopped.length !== 1 ||
    stopped[0]?.type !== "assistant.render.stopped"
  ) {
    errors.push("marcadores concorrentes ausentes ou duplicados");
  }
  const expectedLatest = Array.isArray(paused) && Array.isArray(stopped) &&
    paused.length > 0 && stopped.length > 0
    ? Math.max(paused[0].atMs, stopped[0].atMs)
    : null;
  if (
    expectedLatest === null ||
    trial.latestMarkerAtPerformanceMs !== expectedLatest ||
    !Number.isFinite(trial?.finalSnapshotAtPerformanceMs) ||
    trial.finalSnapshotAtPerformanceMs !== trial.finalSnapshot?.observedAtMs ||
    trial.postLatestMarkerHorizonMs !==
      trial.finalSnapshotAtPerformanceMs - expectedLatest ||
    trial.postLatestMarkerHorizonMs < EXP0020_POST_MARKER_HORIZON_MS
  ) {
    errors.push("snapshot terminal antecedeu o horizonte pós-STOP");
  }
  const latestStopMarkerTraceIndex = Array.isArray(finalTrace)
    ? Math.max(...finalTrace.flatMap((event, index) =>
        event.type === "assistant.speech.paused" ||
          event.type === "assistant.render.stopped"
          ? [index]
          : []
      ))
    : null;
  const observedNewActive = Number.isSafeInteger(latestStopMarkerTraceIndex)
    ? finalTrace.slice(latestStopMarkerTraceIndex + 1).filter(
        (event) => event.type === "assistant.render.active"
      )
    : null;
  if (
    trial?.latestStopMarkerTraceIndex !== latestStopMarkerTraceIndex ||
    !Array.isArray(trial?.newRenderActiveMarkers) ||
    !isDeepStrictEqual(trial.newRenderActiveMarkers, observedNewActive) ||
    trial.newRenderActiveMarkers.length !== 0 ||
    trial.renderStopUnchanged !== isDeepStrictEqual(
      trial.renderStopAtMarkers,
      trial.finalSnapshot?.audio?.lastRenderStop
    ) ||
    trial.renderStopUnchanged !== true
  ) {
    errors.push("houve reativação ou mudança do render stop no horizonte");
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

async function prepareNavigation(chrome, targetUrl) {
  chrome.clearDiagnostics?.();
  await Promise.all([
    chrome.send("Runtime.enable"),
    chrome.send("Page.enable"),
    chrome.send("Network.enable")
  ]);
  await chrome.send("Page.bringToFront");
  await chrome.send("Page.navigate", { url: targetUrl });
  await chrome.waitFor(
    () => chrome.evaluate(readyExpression()),
    PAGE_READY_TIMEOUT_MS
  );
  chrome.assertLocalNetworkOnly?.();
}

function ttsEvidence(record) {
  return {
    sequence: record.sequence,
    requestId: record.requestId,
    url: record.url,
    method: record.method,
    requestBody: structuredClone(record.requestBody),
    status: record.status,
    mimeType: record.mimeType,
    bodyBase64: record.bodyBase64,
    byteLength: record.byteLength,
    sha256: record.sha256,
    wavSha256: record.sha256,
    rate: record.rate,
    bytes: Buffer.from(record.bytes)
  };
}

export async function runExp0020BrowserNavigation(options = {}) {
  const cardinality = resolveExp0020Cardinality(options);
  const targetUrl = assertExp0020TargetUrl(options.targetUrl);
  const navigationIndex = options.navigationIndex;
  const chrome = options.chrome;
  invariant(chrome && typeof chrome.send === "function" &&
    typeof chrome.evaluate === "function" &&
    typeof chrome.waitFor === "function" &&
    typeof chrome.waitForTtsBodies === "function" &&
    typeof chrome.getTtsBodies === "function",
  "cliente CDP incompatível");
  invariant(
    Number.isInteger(navigationIndex) && navigationIndex >= 1 &&
      navigationIndex <= cardinality.navigations,
    "navigationIndex fora da cardinalidade congelada"
  );
  const networkRequestStart = chrome.getNetworkRequests?.().length ?? 0;
  const browser = options.browser ?? await chrome.send("Browser.getVersion");
  await prepareNavigation(chrome, targetUrl);
  const trials = [];
  for (let trialIndex = 1;
    trialIndex <= cardinality.trialsPerNavigation;
    trialIndex += 1) {
    const beforeTts = chrome.getTtsBodies().length;
    const collected = await chrome.evaluate(
      exp0020TrialExpression({ navigationIndex, trialIndex }),
      TRIAL_TIMEOUT_MS
    );
    const bodies = await chrome.waitForTtsBodies(beforeTts + 1);
    invariant(
      bodies.length === beforeTts + 1,
      `trial ${navigationIndex}.${trialIndex} precisa de um único /api/tts`
    );
    chrome.assertLocalNetworkOnly?.();
    const collectionValidation = validateExp0020TrialCollection(collected);
    trials.push({
      ...collected,
      timing: {
        renderActiveAtMs: collected.activeMarker?.atMs ?? null,
        plannedTriggerAtMs:
          collected.plannedTriggerAtPerformanceMs ?? null,
        actualTriggerAtMs: collected.triggerAtPerformanceMs ?? null,
        timerErrorMs: collected.timerErrorMs ?? null,
        latestStopMarkerAtMs:
          collected.latestMarkerAtPerformanceMs ?? null,
        postStopObservedAtMs:
          collected.finalSnapshotAtPerformanceMs ?? null,
        postLatestMarkerHorizonMs:
          collected.postLatestMarkerHorizonMs ?? null
      },
      collectionValidation,
      tts: ttsEvidence(bodies[beforeTts])
    });
  }
  const expectedTts = navigationIndex * cardinality.trialsPerNavigation;
  invariant(
    chrome.getTtsBodies().length === expectedTts,
    `navegação ${navigationIndex} terminou com cardinalidade TTS divergente`
  );
  const networkRequests = (chrome.getNetworkRequests?.() ?? [])
    .slice(networkRequestStart);
  return Object.freeze({
    navigationIndex,
    targetUrl,
    browser,
    browserProduct: browser?.product ?? null,
    networkRequests: Object.freeze(networkRequests),
    networkUrls: Object.freeze([
      ...new Set(networkRequests.map((request) => request.url))
    ]),
    trials: Object.freeze(trials),
    diagnostics: Object.freeze(
      chrome.getDiagnostics?.() ?? cloneDiagnostics(chrome.diagnostics)
    )
  });
}

export async function runExp0020BrowserCampaign(options = {}) {
  const cardinality = resolveExp0020Cardinality(options);
  const targetUrl = assertExp0020TargetUrl(options.targetUrl);
  const connectChrome = options.connectChrome ?? connectExp0020Chrome;
  const chrome = options.chrome ?? await connectChrome({
    cdpUrl: options.cdpUrl ?? discoverExp0020CdpUrl(),
    targetUrl,
    fetchImpl: options.fetchImpl,
    WebSocketImpl: options.WebSocketImpl,
    timeoutMs: options.commandTimeoutMs
  });
  const navigations = [];
  try {
    const browser = options.browser ?? await chrome.send("Browser.getVersion");
    for (let navigationIndex = 1;
      navigationIndex <= cardinality.navigations;
      navigationIndex += 1) {
      navigations.push(await runExp0020BrowserNavigation({
        chrome,
        navigationIndex,
        targetUrl,
        browser,
        cardinality,
        testOnlyCardinality: options.testOnlyCardinality
      }));
    }
    const totalTrials = navigations.reduce(
      (sum, navigation) => sum + navigation.trials.length,
      0
    );
    invariant(totalTrials === cardinality.totalTrials,
      "cardinalidade final de trials divergiu");
    invariant(chrome.getTtsBodies().length === cardinality.totalTrials,
      "cardinalidade final de WAVs divergiu");
    chrome.assertLocalNetworkOnly?.();
    return Object.freeze({
      targetUrl,
      runtimeFingerprintSha256:
        options.runtimeFingerprintSha256 ?? null,
      browser,
      networkRequests: Object.freeze(
        chrome.getNetworkRequests?.() ?? []
      ),
      cardinality,
      navigations: Object.freeze(navigations),
      ttsResponses: Object.freeze(
        chrome.getTtsBodies().map(ttsEvidence)
      )
    });
  } finally {
    chrome.close?.();
  }
}
