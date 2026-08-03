import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  EXP0021_CONFIG,
  EXP0021_ORDER,
  EXP0021_PAYLOADS,
  EXP0021_WORKER_ENVELOPE_SCHEMA as ANALYSIS_WORKER_ENVELOPE_SCHEMA
} from "../src/eval/exp-0021-capture-qualification.mjs";
import {
  EXP0021_NETWORK_ENABLE_OPTIONS,
  captureExp0021ResponseBody
} from "./lib/exp-0021-cdp-capture.mjs";

export const EXP0021_WORKER_ENVELOPE_SCHEMA =
  ANALYSIS_WORKER_ENVELOPE_SCHEMA;
export const EXP0021_TARGET_URL = EXP0021_CONFIG.targetUrl;
export const EXP0021_TTS_URL = EXP0021_CONFIG.ttsUrl;
export const EXP0021_WORKER_PAYLOADS = EXP0021_PAYLOADS;
export const EXP0021_WORKER_ORDER = EXP0021_ORDER;

const COMMAND_TIMEOUT_MS = 10_000;
const PAGE_READY_TIMEOUT_MS = 60_000;
const UNIT_CAPTURE_TIMEOUT_MS = 10_000;
const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function invariant(condition, message) {
  if (!condition) throw new Error(`EXP-0021 worker: ${message}`);
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizeMimeType(value) {
  return typeof value === "string"
    ? value.split(";", 1)[0].trim().toLowerCase()
    : null;
}

export function isExp0021AllowedNetworkUrl(
  value,
  targetUrl = EXP0021_TARGET_URL
) {
  let candidate;
  let target;
  try {
    candidate = new URL(value);
    target = new URL(targetUrl);
  } catch {
    return false;
  }
  if (!NETWORK_PROTOCOLS.has(candidate.protocol)) {
    return ["about:", "blob:", "data:"].includes(candidate.protocol) &&
      (candidate.protocol !== "blob:" || candidate.origin === target.origin);
  }
  const targetPort = target.port || "80";
  const candidatePort = candidate.port ||
    (["https:", "wss:"].includes(candidate.protocol) ? "443" : "80");
  return candidate.hostname === "localhost" &&
    candidatePort === targetPort &&
    ["http:", "ws:"].includes(candidate.protocol);
}

export function isExp0021TtsUrl(
  value,
  targetUrl = EXP0021_TARGET_URL
) {
  try {
    const candidate = new URL(value);
    const expected = new URL("/api/tts", targetUrl);
    return candidate.href === expected.href;
  } catch {
    return false;
  }
}

export function parseExp0021TtsPostData(value) {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed !== null && typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      nonEmptyText(parsed.text)
    ) {
      return Object.freeze({ valid: true, text: parsed.text });
    }
  } catch {
    // Falha fechada abaixo.
  }
  return Object.freeze({ valid: false, text: null });
}

export function exp0021BrowserAuditSource() {
  return `/*EXP0021_INSTALL_NEGATIVE_BUDGET_AUDIT*/ (() => {
    const audit = {
      schemaVersion: "exp-0021-browser-negative-budget-v1",
      audioConstructors: { Audio: 0, AudioContext: 0, webkitAudioContext: 0 },
      calls: { htmlMediaElementPlay: 0, speechSynthesisSpeak: 0 },
      installedAtMs: performance.now()
    };
    const wrapConstructor = (name) => {
      const Original = globalThis[name];
      if (typeof Original !== "function") return;
      const Wrapped = function (...args) {
        audit.audioConstructors[name] += 1;
        return Reflect.construct(Original, args, new.target || Original);
      };
      Object.setPrototypeOf(Wrapped, Original);
      Wrapped.prototype = Original.prototype;
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: Wrapped
      });
    };
    for (const name of ["Audio", "AudioContext", "webkitAudioContext"]) {
      wrapConstructor(name);
    }
    const mediaPrototype = globalThis.HTMLMediaElement?.prototype;
    const originalPlay = mediaPrototype?.play;
    if (typeof originalPlay === "function") {
      Object.defineProperty(mediaPrototype, "play", {
        configurable: true,
        writable: true,
        value: function (...args) {
          audit.calls.htmlMediaElementPlay += 1;
          return Reflect.apply(originalPlay, this, args);
        }
      });
    }
    const synthesis = globalThis.speechSynthesis;
    const originalSpeak = synthesis?.speak;
    if (typeof originalSpeak === "function") {
      synthesis.speak = function (...args) {
        audit.calls.speechSynthesisSpeak += 1;
        return Reflect.apply(originalSpeak, this, args);
      };
    }
    Object.defineProperty(globalThis, "__exp0021Audit", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: audit
    });
  })();`;
}

export function exp0021ReadyExpression() {
  return `/*EXP0021_WAIT_READY*/ (() => Boolean(
    globalThis.__exp0021Audit &&
    globalThis.crypto?.subtle &&
    globalThis.__duplexLab &&
    typeof globalThis.__duplexLab.snapshot === "function"
  ))()`;
}

export function exp0021BrowserHealthExpression() {
  return `/*EXP0021_BROWSER_HEALTH_BINDING*/ (async () => {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("EXP0021 browser health HTTP " + response.status);
    }
    return {
      url: response.url,
      status: response.status,
      mimeType: (response.headers.get("content-type") || "")
        .split(";", 1)[0].trim().toLowerCase() || null,
      health: await response.json()
    };
  })()`;
}

export function exp0021BrowserFetchExpression(text) {
  invariant(nonEmptyText(text), "texto TTS do browser ausente");
  return `/*EXP0021_BROWSER_TTS_FETCH*/ (async () => {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: ${JSON.stringify(text)} })
    });
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return {
      url: response.url,
      status: response.status,
      mimeType: (response.headers.get("content-type") || "")
        .split(";", 1)[0].trim().toLowerCase() || null,
      byteLength: bytes.byteLength,
      sha256: "sha256:" + sha256
    };
  })()`;
}

function safeCaptureResult(result) {
  if (result?.status === "captured") {
    return {
      status: "success",
      code: null,
      readCount: result.readCount,
      emptyReadsBeforeSuccess: result.emptyResponsesBeforeSuccess,
      attempts: result.attempts.map((attempt) => ({
        index: attempt.index,
        delayBeforeMs: attempt.delayBeforeReadMs,
        requestId: result.requestId,
        startedAtMs: attempt.requestedAtMs,
        completedAtMs: attempt.completedAtMs,
        outcome: attempt.outcome === "captured" ? "success" : attempt.outcome
      })),
      base64Encoded: result.base64Encoded,
      byteLength: result.byteLength,
      sha256: result.sha256,
      wavValid: true
    };
  }
  return {
    status: "failure",
    code: result?.code ?? "CDP_CAPTURE_RESULT_MISSING",
    readCount: result?.readCount ?? 0,
    emptyReadsBeforeSuccess: null,
    attempts: (result?.attempts ?? []).map((attempt) => ({
      index: attempt.index,
      delayBeforeMs: attempt.delayBeforeReadMs,
      requestId: result?.requestId ?? null,
      startedAtMs: attempt.requestedAtMs,
      completedAtMs: attempt.completedAtMs,
      outcome: ["command-error", "invalid"].includes(attempt.outcome)
        ? "error"
        : attempt.outcome
    })),
    base64Encoded: null,
    byteLength: null,
    sha256: null,
    wavValid: false
  };
}

function newTtsRecord(requestId) {
  return {
    requestId,
    assignedTrialId: null,
    requestWillBeSentCount: 0,
    responseReceivedCount: 0,
    loadingFinishedCount: 0,
    url: null,
    method: null,
    postData: null,
    status: null,
    mimeType: null,
    encodedDataLength: null,
    capture: null,
    capturePromise: null
  };
}

function preReadCaptureFailure(code) {
  return {
    status: "failure",
    code,
    readCount: 0,
    emptyReadsBeforeSuccess: null,
    attempts: [],
    base64Encoded: null,
    byteLength: null,
    sha256: null,
    wavValid: false
  };
}

export function createExp0021NetworkTracker(options = {}) {
  const send = options.send;
  const targetUrl = options.targetUrl ?? EXP0021_TARGET_URL;
  const capture = options.capture ?? captureExp0021ResponseBody;
  const wait = options.wait;
  const now = options.now;
  invariant(typeof send === "function", "tracker exige send CDP");

  const records = new Map();
  const pendingNetworkRequestIds = new Set();
  const networkRequests = [];
  const diagnostics = {
    structuralErrors: [],
    networkViolations: [],
    httpErrors: [],
    consoleErrors: [],
    runtimeErrors: []
  };
  let activeUnit = null;

  function recordStructural(code, details = {}) {
    diagnostics.structuralErrors.push({ code, ...clone(details) });
  }

  function recordNetwork(requestId, url, method, type, timestamp) {
    networkRequests.push({ requestId, url, method, type, timestamp });
    if (!isExp0021AllowedNetworkUrl(url, targetUrl)) {
      diagnostics.networkViolations.push({ requestId, url, method, type });
    }
  }

  function ttsRecord(requestId) {
    if (!records.has(requestId)) records.set(requestId, newTtsRecord(requestId));
    return records.get(requestId);
  }

  function beginUnit(identity) {
    invariant(activeUnit === null, "somente uma unidade pode ficar em voo");
    invariant(
      identity && Number.isInteger(identity.sequence) &&
        nonEmptyText(identity.trialId) && nonEmptyText(identity.text),
      "identidade da unidade inválida"
    );
    activeUnit = {
      identity: clone(identity),
      observedRequestIds: []
    };
  }

  function handleEvent(message) {
    const params = message?.params ?? {};
    if (message?.method === "Runtime.consoleAPICalled" &&
      params.type === "error") {
      diagnostics.consoleErrors.push(
        (params.args ?? []).map((entry) =>
          entry.value ?? entry.description ?? "").join(" ").slice(0, 500)
      );
      return;
    }
    if (message?.method === "Runtime.exceptionThrown") {
      diagnostics.runtimeErrors.push(
        (params.exceptionDetails?.exception?.description ??
          params.exceptionDetails?.text ?? "runtime exception").slice(0, 500)
      );
      return;
    }
    if (message?.method === "Network.webSocketCreated" ||
      message?.method === "Network.webTransportCreated") {
      recordNetwork(
        params.requestId ?? params.transportId ?? null,
        params.url,
        "CONNECT",
        message.method,
        params.timestamp ?? null
      );
      return;
    }
    if (message?.method === "Network.requestWillBeSent") {
      const request = params.request ?? {};
      pendingNetworkRequestIds.add(params.requestId);
      recordNetwork(
        params.requestId,
        request.url,
        request.method,
        params.type ?? null,
        params.timestamp ?? null
      );
      if (!isExp0021TtsUrl(request.url, targetUrl)) return;
      const record = ttsRecord(params.requestId);
      record.requestWillBeSentCount += 1;
      record.url = request.url ?? null;
      record.method = request.method ?? null;
      record.postData = request.postData ?? null;
      if (activeUnit === null) {
        recordStructural("TTS_WITHOUT_ACTIVE_UNIT", {
          requestId: params.requestId
        });
      } else {
        if (!activeUnit.observedRequestIds.includes(params.requestId)) {
          activeUnit.observedRequestIds.push(params.requestId);
        }
        if (record.assignedTrialId === null) {
          record.assignedTrialId = activeUnit.identity.trialId;
        } else if (record.assignedTrialId !== activeUnit.identity.trialId) {
          recordStructural("REQUEST_ID_REUSED_CROSS_TRIAL", {
            requestId: params.requestId,
            previousTrialId: record.assignedTrialId,
            currentTrialId: activeUnit.identity.trialId
          });
        }
      }
      return;
    }
    if (message?.method === "Network.responseReceived") {
      const response = params.response ?? {};
      if (response.status >= 400) {
        diagnostics.httpErrors.push({
          requestId: params.requestId,
          url: response.url,
          status: response.status
        });
      }
      if (!isExp0021TtsUrl(response.url, targetUrl)) return;
      const record = ttsRecord(params.requestId);
      record.responseReceivedCount += 1;
      record.url ??= response.url ?? null;
      record.status = response.status ?? null;
      record.mimeType = normalizeMimeType(response.mimeType);
      if (record.requestWillBeSentCount === 0) {
        recordStructural("TTS_RESPONSE_WITHOUT_REQUEST", {
          requestId: params.requestId
        });
      }
      return;
    }
    if (message?.method === "Network.loadingFinished") {
      pendingNetworkRequestIds.delete(params.requestId);
      if (!records.has(params.requestId)) return;
      const record = records.get(params.requestId);
      record.loadingFinishedCount += 1;
      record.encodedDataLength = params.encodedDataLength ?? null;
      if (record.responseReceivedCount === 0) {
        recordStructural("TTS_FINISH_WITHOUT_RESPONSE", {
          requestId: params.requestId
        });
      }
      if (record.capturePromise !== null) {
        recordStructural("DUPLICATE_TTS_CAPTURE", {
          requestId: params.requestId
        });
        return;
      }
      const preReadFailureCode = record.status !== 200
        ? "TTS_HTTP_STATUS_INVALID"
        : record.mimeType !== "audio/wav"
          ? "TTS_MIME_TYPE_INVALID"
          : !Number.isFinite(record.encodedDataLength) ||
              record.encodedDataLength <= 0
            ? "CDP_ENCODED_LENGTH_INVALID"
            : record.encodedDataLength >=
                EXP0021_NETWORK_ENABLE_OPTIONS.maxResourceBufferSize
              ? "CDP_RESOURCE_BUFFER_EXCEEDED"
              : null;
      if (preReadFailureCode !== null) {
        record.capture = preReadCaptureFailure(preReadFailureCode);
        record.capturePromise = Promise.resolve(record.capture);
        return;
      }
      record.capturePromise = capture({
        requestId: params.requestId,
        send,
        ...(wait ? { wait } : {}),
        ...(now ? { now } : {})
      }).then((result) => {
        record.capture = safeCaptureResult(result);
        return record.capture;
      });
      return;
    }
    if (message?.method === "Network.loadingFailed") {
      pendingNetworkRequestIds.delete(params.requestId);
      if (records.has(params.requestId)) {
        recordStructural("TTS_LOADING_FAILED", {
          requestId: params.requestId,
          errorText: params.errorText ?? null
        });
      }
    }
  }

  async function waitForNetworkIdle(options = {}) {
    const quietMs = options.quietMs ?? 25;
    const timeoutMs = options.timeoutMs ?? UNIT_CAPTURE_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let idleSince = pendingNetworkRequestIds.size === 0 ? Date.now() : null;
    while (Date.now() < deadline) {
      if (pendingNetworkRequestIds.size === 0) {
        idleSince ??= Date.now();
        if (Date.now() - idleSince >= quietMs) return;
      } else {
        idleSince = null;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 2));
    }
    throw new Error(
      `rede do browser não ficou ociosa: ` +
        `${pendingNetworkRequestIds.size} request(s) pendente(s)`
    );
  }

  async function finishUnit(browser, timeoutMs = UNIT_CAPTURE_TIMEOUT_MS) {
    invariant(activeUnit !== null, "nenhuma unidade ativa para finalizar");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ids = activeUnit.observedRequestIds;
      if (
        ids.length !== 0 &&
        ids.every((requestId) =>
          records.get(requestId)?.capturePromise !== null)
      ) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 2));
    }
    const unitState = activeUnit;
    activeUnit = null;
    if (unitState.observedRequestIds.length !== 1) {
      recordStructural("UNIT_TTS_REQUEST_CARDINALITY", {
        trialId: unitState.identity.trialId,
        observedRequestIds: unitState.observedRequestIds
      });
    }
    const requestId = unitState.observedRequestIds[0] ?? null;
    const record = requestId === null ? newTtsRecord(null) :
      records.get(requestId) ?? newTtsRecord(requestId);
    if (record.capturePromise !== null) {
      await record.capturePromise;
    } else {
      recordStructural("UNIT_CAPTURE_NOT_STARTED", {
        trialId: unitState.identity.trialId,
        requestId
      });
    }
    const parsedPostData = parseExp0021TtsPostData(record.postData);
    return Object.freeze({
      ...clone(unitState.identity),
      browser: clone(browser),
      cdp: {
        observedRequestIds: [...unitState.observedRequestIds],
        requestId,
        requestWillBeSentCount: record.requestWillBeSentCount,
        responseReceivedCount: record.responseReceivedCount,
        loadingFinishedCount: record.loadingFinishedCount,
        url: record.url,
        method: record.method,
        postData: parsedPostData.valid ? { text: parsedPostData.text } : null,
        status: record.status,
        mimeType: record.mimeType,
        encodedDataLength: record.encodedDataLength,
        capture: clone(record.capture) ?? safeCaptureResult(null)
      }
    });
  }

  return Object.freeze({
    beginUnit,
    finishUnit,
    handleEvent,
    waitForNetworkIdle,
    getDiagnostics: () => clone(diagnostics),
    getNetworkRequests: () => clone(networkRequests),
    getTtsRecords: () => [...records.values()].map((record) => {
      const projected = clone(record);
      delete projected.capturePromise;
      return projected;
    })
  });
}

function validIpv4(value) {
  const parts = typeof value === "string" ? value.split(".") : [];
  return parts.length === 4 && parts.every((part) =>
    /^\d{1,3}$/u.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function canonicalCdpEndpoint(value, expectedGateway = null) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    invariant(false, "endpoint CDP inválido");
  }
  invariant(
    endpoint.protocol === EXP0021_CONFIG.cdp.protocol &&
      endpoint.port === EXP0021_CONFIG.cdp.port &&
      validIpv4(endpoint.hostname) &&
      (expectedGateway === null || endpoint.hostname === expectedGateway) &&
      endpoint.pathname === "/" && endpoint.search === "" &&
      endpoint.hash === "" && endpoint.username === "" &&
      endpoint.password === "",
    "endpoint CDP precisa ser o gateway WSL exato na porta congelada"
  );
  return endpoint.href;
}

export function exp0021CdpUrlFromRoute(route, environment = {}) {
  const gateway = /(?:^|\n)default\s+via\s+([0-9.]+)(?:\s|$)/u
    .exec(route)?.[1];
  invariant(
    validIpv4(gateway),
    "gateway do Chrome do Windows não encontrado"
  );
  const expected = canonicalCdpEndpoint(
    `${EXP0021_CONFIG.cdp.protocol}//${gateway}:${EXP0021_CONFIG.cdp.port}/`,
    gateway
  );
  if (nonEmptyText(environment.CDP_URL)) {
    invariant(
      canonicalCdpEndpoint(environment.CDP_URL, gateway) === expected,
      "CDP_URL diverge do gateway WSL congelado"
    );
  }
  return expected;
}

export function discoverExp0021CdpUrl(environment = process.env) {
  const route = execFileSync("ip", ["route", "show", "default"], {
    encoding: "utf8"
  });
  return exp0021CdpUrlFromRoute(route, environment);
}

export function exp0021BoundWebSocketUrl(cdpUrl, page) {
  const endpoint = canonicalCdpEndpoint(cdpUrl);
  invariant(
    nonEmptyText(page?.id) && nonEmptyText(page?.webSocketDebuggerUrl),
    "aba CDP não publicou targetId/WebSocket"
  );
  let declaredSocketUrl;
  try {
    declaredSocketUrl = new URL(page.webSocketDebuggerUrl);
  } catch {
    invariant(false, "WebSocket CDP malformado");
  }
  const expectedWebSocketPath =
    `${EXP0021_CONFIG.cdp.webSocketPathPrefix}${page.id}`;
  invariant(
    declaredSocketUrl.protocol === "ws:" &&
      declaredSocketUrl.pathname === expectedWebSocketPath &&
      declaredSocketUrl.search === "" && declaredSocketUrl.hash === "" &&
      declaredSocketUrl.username === "" &&
      declaredSocketUrl.password === "",
    "WebSocket CDP não pertence ao target criado"
  );
  const socketUrl = new URL(endpoint);
  socketUrl.protocol = "ws:";
  socketUrl.pathname = expectedWebSocketPath;
  return Object.freeze({
    socketUrl: socketUrl.href,
    binding: Object.freeze({
      endpoint,
      hostPolicy: EXP0021_CONFIG.cdp.hostPolicy,
      initialTarget: EXP0021_CONFIG.cdp.initialTarget,
      targetId: page.id,
      webSocketPath: expectedWebSocketPath
    })
  });
}

export async function connectExp0021Chrome(options = {}) {
  const cdpUrl = options.cdpUrl;
  const targetUrl = options.targetUrl ?? EXP0021_TARGET_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  invariant(nonEmptyText(cdpUrl), "URL CDP ausente");
  invariant(typeof fetchImpl === "function", "fetch CDP indisponível");
  invariant(typeof WebSocketImpl === "function", "WebSocket CDP indisponível");
  const endpoint = canonicalCdpEndpoint(cdpUrl);
  const createUrl = new URL(
    `/json/new?${encodeURIComponent(EXP0021_CONFIG.cdp.initialTarget)}`,
    endpoint
  );

  const createResponse = await fetchImpl(
    createUrl,
    {
      method: "PUT",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    }
  );
  invariant(
    createResponse.ok,
    `CDP não criou aba neutra isolada: HTTP ${createResponse.status}`
  );
  const page = await createResponse.json();
  const socketBinding = exp0021BoundWebSocketUrl(endpoint, page);

  const socket = new WebSocketImpl(socketBinding.socketUrl);
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

  const pendingCommands = new Map();
  const eventListeners = new Set();
  let commandSequence = 0;

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

  socket.addEventListener("message", ({ data }) => {
    let message;
    try {
      message = JSON.parse(typeof data === "string" ? data : String(data));
    } catch (error) {
      for (const listener of eventListeners) {
        listener({
          method: "EXP0021.protocolError",
          params: { message: `CDP JSON inválido: ${error.message}` }
        });
      }
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
    for (const listener of eventListeners) listener(message);
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
      userGesture: false
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
        const result = await probe();
        if (result) return result;
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

  return Object.freeze({
    page,
    binding: socketBinding.binding,
    send,
    evaluate,
    waitFor,
    onEvent(listener) {
      invariant(typeof listener === "function", "listener CDP inválido");
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    close() {
      socket.close();
    },
    async closeTarget() {
      if (nonEmptyText(page?.id)) {
        await send("Target.closeTarget", { targetId: page.id });
      }
    }
  });
}

async function fetchHealth(targetUrl, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(new URL("/api/health", targetUrl), {
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS)
  });
  invariant(response.ok, `/api/health retornou HTTP ${response.status}`);
  return response.json();
}

function normalizeBrowserObservation(value) {
  invariant(value !== null && typeof value === "object", "fetch sem resultado");
  return {
    url: value.url ?? null,
    status: value.status ?? null,
    mimeType: normalizeMimeType(value.mimeType),
    byteLength: value.byteLength ?? null,
    sha256: HASH_PATTERN.test(value.sha256 ?? "") ? value.sha256 : null
  };
}

function normalizeBrowserHealth(value) {
  invariant(
    value !== null && typeof value === "object" &&
      value.health !== null && typeof value.health === "object",
    "health do browser sem resultado"
  );
  return {
    url: value.url ?? null,
    status: value.status ?? null,
    mimeType: normalizeMimeType(value.mimeType),
    health: clone(value.health)
  };
}

function snapshotSummary(snapshot) {
  const trace = Array.isArray(snapshot?.trace) ? snapshot.trace : [];
  const trainingTrace = snapshot?.trainingTrace ?? {};
  const reflexTrainingTrace = snapshot?.reflexTrainingTrace ?? {};
  return {
    state: clone(snapshot?.state ?? null),
    traceEventTypes: trace.map((event) => event?.type ?? null),
    trainingTrace: {
      decisions: Array.isArray(trainingTrace.decisions)
        ? trainingTrace.decisions.length
        : null,
      effects: Array.isArray(trainingTrace.effects)
        ? trainingTrace.effects.length
        : null
    },
    reflexTrainingTrace: {
      decisions: Array.isArray(reflexTrainingTrace.decisions)
        ? reflexTrainingTrace.decisions.length
        : null,
      effects: Array.isArray(reflexTrainingTrace.effects)
        ? reflexTrainingTrace.effects.length
        : null
    },
    audio: {
      capture: clone(snapshot?.audio?.capture ?? null),
      transport: clone(snapshot?.audio?.transport ?? null),
      vadControl: clone(snapshot?.audio?.vadControl ?? null),
      vadShadow: clone(snapshot?.audio?.vadShadow ?? null),
      outputInterruptionLifecycle: clone(
        snapshot?.audio?.outputInterruptionLifecycle ?? null
      )
    }
  };
}

function diagnosticSlice(diagnostics, offsets) {
  const output = {};
  for (const [key, values] of Object.entries(diagnostics)) {
    output[key] = Array.isArray(values)
      ? values.slice(offsets[key] ?? 0)
      : clone(values);
  }
  return output;
}

function diagnosticOffsets(diagnostics) {
  return Object.fromEntries(Object.entries(diagnostics).map(
    ([key, values]) => [key, Array.isArray(values) ? values.length : 0]
  ));
}

function usageDelta(before, after) {
  const fields = ["requests", "inputTokens", "outputTokens", "totalTokens"];
  return Object.fromEntries(fields.map((field) => [
    field,
    Number.isFinite(before?.usage?.[field]) &&
      Number.isFinite(after?.usage?.[field])
      ? after.usage[field] - before.usage[field]
      : null
  ]));
}

function buildBudget(navigations, healthBefore, healthAfter) {
  const audits = navigations.map((navigation) => navigation.audit);
  const snapshots = navigations.map((navigation) => navigation.snapshot);
  const allTraceTypes = snapshots.flatMap(
    (snapshot) => snapshot?.traceEventTypes ?? []
  );
  const allRequests = navigations.flatMap(
    (navigation) => navigation.networkRequests ?? []
  );
  const ttsRequests = allRequests.filter((request) =>
    isExp0021TtsUrl(request.url)).length;
  const audioConstructor = (name) => audits.reduce(
    (sum, audit) => sum + (audit?.audioConstructors?.[name] ?? 0),
    0
  );
  const auditCall = (name) => audits.reduce(
    (sum, audit) => sum + (audit?.calls?.[name] ?? 0),
    0
  );
  const sumSnapshot = (path) => snapshots.reduce((sum, snapshot) => {
    let value = snapshot;
    for (const key of path) value = value?.[key];
    return sum + (Number.isInteger(value) ? value : 0);
  }, 0);
  const externalRequests = allRequests.filter((request) =>
    !isExp0021AllowedNetworkUrl(request.url)).length;
  return {
    ttsRequests,
    localTtsSyntheses: ttsRequests,
    audioConstructors: {
      Audio: audioConstructor("Audio"),
      AudioContext: audioConstructor("AudioContext"),
      webkitAudioContext: audioConstructor("webkitAudioContext")
    },
    calls: {
      htmlMediaElementPlay: auditCall("htmlMediaElementPlay"),
      speechSynthesisSpeak: auditCall("speechSynthesisSpeak")
    },
    lifecycle: {
      bargeIn: allTraceTypes.filter((type) =>
        typeof type === "string" && type.includes("barge")).length,
      stop: allTraceTypes.filter((type) =>
        typeof type === "string" &&
          (type.includes("render.stopped") || type.includes("speech.paused"))
      ).length,
      transitions: allTraceTypes.filter((type) =>
        type === "output-interruption.transition").length
    },
    trainingTrace: {
      decisions: sumSnapshot(["trainingTrace", "decisions"]) +
        sumSnapshot(["reflexTrainingTrace", "decisions"]),
      effects: sumSnapshot(["trainingTrace", "effects"]) +
        sumSnapshot(["reflexTrainingTrace", "effects"])
    },
    inputActivations: snapshots.filter((snapshot) =>
      snapshot?.state?.active === true ||
      snapshot?.state?.inputMode !== null ||
      snapshot?.audio?.capture !== null
    ).length,
    externalRequests,
    usageDelta: usageDelta(healthBefore, healthAfter),
    gpuRuns: 0,
    challengerRuns: 0,
    backboneRuns: 0,
    canProduceNewEffects: false
  };
}

export async function runExp0021WorkerCampaign(options = {}) {
  const targetUrl = options.targetUrl ?? EXP0021_TARGET_URL;
  invariant(targetUrl === EXP0021_TARGET_URL, "target URL não pode variar");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const connectChrome = options.connectChrome ?? connectExp0021Chrome;
  const startedAt = options.startedAt ??
    process.env.EXP0021_ATTEMPT_STARTED_AT ??
    new Date().toISOString();
  const healthBefore = await (options.fetchHealth ?? fetchHealth)(
    targetUrl,
    fetchImpl
  );
  const chrome = options.chrome ?? await connectChrome({
    cdpUrl: options.cdpUrl ?? discoverExp0021CdpUrl(),
    targetUrl,
    fetchImpl,
    WebSocketImpl: options.WebSocketImpl,
    timeoutMs: options.commandTimeoutMs
  });
  const tracker = createExp0021NetworkTracker({
    send: chrome.send,
    targetUrl,
    capture: options.capture,
    wait: options.captureWait,
    now: options.captureNow
  });
  const removeListener = chrome.onEvent(tracker.handleEvent);
  const navigations = [];
  let browser = null;
  try {
    await Promise.all([
      chrome.send("Runtime.enable"),
      chrome.send("Page.enable"),
      chrome.send("Network.enable", EXP0021_NETWORK_ENABLE_OPTIONS)
    ]);
    await chrome.send("Page.addScriptToEvaluateOnNewDocument", {
      source: exp0021BrowserAuditSource()
    });
    browser = {
      ...await chrome.send("Browser.getVersion"),
      cdpBinding: clone(chrome.binding ?? null)
    };
    await chrome.send("Page.bringToFront");

    for (let navigationIndex = 1; navigationIndex <= 2; navigationIndex += 1) {
      const requestsBefore = tracker.getNetworkRequests().length;
      const diagnosticsBefore = diagnosticOffsets(tracker.getDiagnostics());
      await chrome.send("Page.navigate", { url: targetUrl });
      await chrome.waitFor(
        () => chrome.evaluate(exp0021ReadyExpression()),
        PAGE_READY_TIMEOUT_MS
      );
      await tracker.waitForNetworkIdle();
      const browserHealth = normalizeBrowserHealth(
        await chrome.evaluate(
          exp0021BrowserHealthExpression(),
          PAGE_READY_TIMEOUT_MS
        )
      );
      await tracker.waitForNetworkIdle();
      const units = [];
      const plannedUnits = EXP0021_WORKER_ORDER.filter(
        (unit) => unit.navigationIndex === navigationIndex
      );
      for (const planned of plannedUnits) {
        const payload = EXP0021_WORKER_PAYLOADS[planned.payloadId];
        const identity = { ...planned, text: payload.text };
        tracker.beginUnit(identity);
        const browserObservation = normalizeBrowserObservation(
          await chrome.evaluate(
            exp0021BrowserFetchExpression(payload.text),
            PAGE_READY_TIMEOUT_MS
          )
        );
        units.push(await tracker.finishUnit(browserObservation));
      }
      await tracker.waitForNetworkIdle();
      const pageEvidence = await chrome.evaluate(
        `/*EXP0021_READ_NEGATIVE_BUDGET*/ (() => ({
          audit: structuredClone(globalThis.__exp0021Audit),
          snapshot: globalThis.__duplexLab.snapshot()
        }))()`
      );
      const allRequests = tracker.getNetworkRequests();
      const allDiagnostics = tracker.getDiagnostics();
      navigations.push({
        index: navigationIndex,
        targetUrl,
        browserHealth,
        units,
        audit: {
          ...clone(pageEvidence?.audit ?? {}),
          singleTtsInFlight: units.every(
            (unit) => unit.cdp.observedRequestIds.length === 1
          ),
          retryIssuedRequest:
            allRequests.slice(requestsBefore).filter((request) =>
              isExp0021TtsUrl(request.url)).length !== units.length,
          firstUnitTrialId: units[0]?.trialId ?? null,
          instrumentationInstalled:
            Number.isFinite(pageEvidence?.audit?.installedAtMs)
        },
        snapshot: snapshotSummary(pageEvidence?.snapshot),
        networkRequests: allRequests.slice(requestsBefore),
        diagnostics: diagnosticSlice(allDiagnostics, diagnosticsBefore)
      });
    }
  } finally {
    removeListener();
    await chrome.closeTarget?.().catch(() => {});
    chrome.close?.();
  }
  const healthAfter = await (options.fetchHealth ?? fetchHealth)(
    targetUrl,
    fetchImpl
  );
  const diagnostics = tracker.getDiagnostics();
  const budget = buildBudget(navigations, healthBefore, healthAfter);
  const units = navigations.flatMap((navigation) => navigation.units);
  const captureFailed = units.some(
    (unit) => unit?.cdp?.capture?.status !== "success"
  );
  const firstCaptureFailure = units.find(
    (unit) => unit?.cdp?.capture?.status === "failure"
  )?.cdp?.capture ?? null;
  return Object.freeze({
    schemaVersion: EXP0021_WORKER_ENVELOPE_SCHEMA,
    status: captureFailed ? "capture-failure" : "completed",
    startedAt,
    completedAt: options.completedAt ?? new Date().toISOString(),
    campaign: {
      health: { before: healthBefore, after: healthAfter },
      browser,
      navigations,
      diagnostics,
      budget
    },
    failure: captureFailed
      ? {
          code: firstCaptureFailure?.code ?? "CDP_CAPTURE_RESULT_MISSING",
          message: "uma ou mais capturas CDP falharam de forma tipada"
        }
      : null
  });
}

async function main() {
  invariant(process.argv.length === 2, "worker não aceita argumentos livres");
  const envelope = await runExp0021WorkerCampaign();
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
