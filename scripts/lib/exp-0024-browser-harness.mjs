import {
  EXP0021_NETWORK_ENABLE_OPTIONS
} from "./exp-0021-cdp-capture.mjs";
import { EXP0024_CONFIG } from
  "../../src/eval/exp-0024-boundary.mjs";
import {
  EXP0020_FIXED_PHRASE,
  EXP0020_NAVIGATION_COUNT,
  EXP0020_POST_MARKER_HORIZON_MS,
  EXP0020_TOTAL_TRIALS,
  EXP0020_TRIALS_PER_NAVIGATION,
  EXP0020_TRIGGER_DELAY_MS,
  EXP0020_TRIGGER_ERROR_MAX_MS,
  exp0020TrialExpression,
  validateExp0020TrialCollection
} from "./exp-0020-browser-harness.mjs";
import {
  connectExp0022Chrome,
  createExp0022HealthBinding,
  createExp0022NetworkTracker,
  discoverExp0022CdpUrl,
  exp0022BrowserAuditSource,
  exp0022BrowserHealthExpression,
  exp0022ReadyExpression,
  isExp0022AllowedNetworkUrl,
  isExp0022HealthUrl,
  isExp0022TtsUrl,
  parseExp0022TtsPostData
} from "../run-exp-0022-worker.mjs";

export const EXP0024_TARGET_URL =
  EXP0024_CONFIG.targetUrl;
export const EXP0024_TTS_URL =
  new URL("/api/tts", EXP0024_TARGET_URL).href;
export const EXP0024_EXPECTED_WAV_SHA256 =
  EXP0024_CONFIG.expectedWavSha256;
export const EXP0024_EXPECTED_WAV_BYTES =
  EXP0024_CONFIG.expectedWavByteLength;
export const EXP0024_WORKER_ENVELOPE_SCHEMA =
  "exp-0024-physical-stop-worker-envelope-v1";
export const EXP0024_CAMPAIGN_DEADLINE_MS =
  EXP0024_CONFIG.attemptDeadlineMs;

const PAGE_READY_TIMEOUT_MS = 60_000;
const TRIAL_TIMEOUT_MS = 90_000;
const HEX_HASH_PATTERN = /^[a-f0-9]{64}$/u;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`EXP-0024 browser harness: ${message}`);
  }
}

invariant(
  EXP0020_FIXED_PHRASE === EXP0024_CONFIG.phrase &&
    EXP0020_NAVIGATION_COUNT === EXP0024_CONFIG.navigations &&
    EXP0020_TRIALS_PER_NAVIGATION === EXP0024_CONFIG.stopsPerNavigation &&
    EXP0020_TOTAL_TRIALS === EXP0024_CONFIG.totalStops &&
    EXP0020_TRIGGER_DELAY_MS ===
      EXP0024_CONFIG.triggerAfterRenderActiveMs &&
    EXP0020_TRIGGER_ERROR_MAX_MS ===
      EXP0024_CONFIG.triggerTimerErrorMaxMs &&
    EXP0020_POST_MARKER_HORIZON_MS ===
      EXP0024_CONFIG.postStopObservationMs &&
    JSON.stringify(EXP0021_NETWORK_ENABLE_OPTIONS) ===
      JSON.stringify(EXP0024_CONFIG.networkEnable),
  "contratos herdados EXP-0020/0021 divergem do freeze EXP-0024"
);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeMimeType(value) {
  return typeof value === "string"
    ? value.split(";", 1)[0].trim().toLowerCase() || null
    : null;
}

function normalizeHealth(value) {
  invariant(value !== null && typeof value === "object", "health inválido");
  return {
    process: {
      runId: value?.process?.runId ?? null,
      runtimeFingerprint: {
        sha256: value?.process?.runtimeFingerprint?.sha256 ?? null,
        fileCount: value?.process?.runtimeFingerprint?.fileCount ?? null
      }
    },
    brain: value?.brain ?? null,
    usage: {
      requests: value?.usage?.requests ?? null,
      inputTokens: value?.usage?.inputTokens ?? null,
      outputTokens: value?.usage?.outputTokens ?? null,
      totalTokens: value?.usage?.totalTokens ?? null
    },
    asr: { state: value?.asr?.state ?? null },
    vadControl: {
      engine: value?.vadControl?.engine ?? null,
      state: value?.vadControl?.state ?? null
    },
    vadShadow: { state: value?.vadShadow?.state ?? null },
    tts: {
      state: value?.tts?.state ?? null,
      engine: value?.tts?.engine ?? null,
      voice: value?.tts?.voice ?? null,
      culture: value?.tts?.culture ?? null
    }
  };
}

function normalizeBrowserHealth(value) {
  invariant(
    value !== null && typeof value === "object" &&
      value.health !== null && typeof value.health === "object",
    "health do browser inválido"
  );
  return {
    probeId: value.probeId ?? null,
    url: value.url ?? null,
    status: value.status ?? null,
    mimeType: normalizeMimeType(value.mimeType),
    health: normalizeHealth(value.health)
  };
}

function diagnosticOffsets(diagnostics) {
  return Object.fromEntries(Object.entries(diagnostics).map(
    ([key, values]) => [key, Array.isArray(values) ? values.length : 0]
  ));
}

function diagnosticSlice(diagnostics, offsets) {
  return Object.fromEntries(Object.entries(diagnostics).map(
    ([key, values]) => [
      key,
      Array.isArray(values) ? values.slice(offsets[key] ?? 0) : clone(values)
    ]
  ));
}

function snapshotSummary(snapshot) {
  return {
    observedAtMs: snapshot?.observedAtMs ?? null,
    state: clone(snapshot?.state ?? null),
    audio: clone(snapshot?.audio ?? null),
    trace: clone(snapshot?.trace ?? []),
    trainingTrace: clone(snapshot?.trainingTrace ?? null),
    reflexTrainingTrace: clone(snapshot?.reflexTrainingTrace ?? null)
  };
}

function captureProjection(capture) {
  return {
    status: capture?.status ?? "failure",
    code: capture?.code ?? "CDP_CAPTURE_RESULT_MISSING",
    readCount: capture?.readCount ?? 0,
    emptyReadsBeforeSuccess: capture?.emptyReadsBeforeSuccess ?? null,
    attempts: (capture?.attempts ?? []).map((attempt) => ({
      index: attempt?.index ?? null,
      delayBeforeMs: attempt?.delayBeforeMs ?? null,
      requestId: attempt?.requestId ?? null,
      startedAtMs: attempt?.startedAtMs ?? null,
      completedAtMs: attempt?.completedAtMs ?? null,
      outcome: attempt?.outcome ?? null
    })),
    byteLength: capture?.byteLength ?? null,
    sha256: capture?.sha256 ?? null,
    wavValid: capture?.wavValid === true
  };
}

function captureJournalProjection(capture) {
  const projected = captureProjection(capture);
  return {
    status: projected.status === "success" && projected.wavValid
      ? "qualified"
      : "failed",
    code: projected.status === "success" && projected.wavValid
      ? null
      : projected.code ?? "CDP_WAV_INVALID",
    readCount: projected.readCount,
    accumulatedWaitMs: projected.attempts.reduce(
      (sum, attempt) => sum + (attempt.delayBeforeMs ?? 0),
      0
    ),
    sha256: projected.sha256,
    byteLength: projected.byteLength
  };
}

function diagnosticPayload(category, record, navigationIndex) {
  const mapping = {
    structuralErrors: ["structural", record?.code ?? "STRUCTURAL_ERROR"],
    networkViolations: ["network", "NETWORK_VIOLATION"],
    httpErrors: ["http", "HTTP_ERROR"],
    consoleErrors: ["console", "CONSOLE_ERROR"],
    runtimeErrors: ["runtime", "RUNTIME_ERROR"]
  };
  const [normalizedCategory, code] = mapping[category] ?? [
    "structural",
    "UNKNOWN_DIAGNOSTIC"
  ];
  return {
    category: normalizedCategory,
    code,
    message: typeof record === "string" ? record : JSON.stringify(record),
    navigationIndex,
    observedAt: new Date().toISOString(),
    trialId: null
  };
}

function ttsRequestProjection(request, unit) {
  const capture = captureProjection(unit?.cdp?.capture);
  return {
    requestId: unit?.cdp?.requestId ?? null,
    requestOrdinal: request?.requestOrdinal ?? null,
    responseOrdinal: request?.responseOrdinal ?? null,
    terminalOrdinal: request?.finishedOrdinal ?? request?.failedOrdinal ?? null,
    requestTimestamp: request?.timestamp ?? null,
    responseTimestamp: request?.responseTimestamp ?? null,
    terminalTimestamp:
      request?.finishedTimestamp ?? request?.failedTimestamp ?? null,
    requestWillBeSentCount: unit?.cdp?.requestWillBeSentCount ?? 0,
    responseReceivedCount: unit?.cdp?.responseReceivedCount ?? 0,
    loadingFinishedCount: unit?.cdp?.loadingFinishedCount ?? 0,
    loadingFailedCount: request?.loadingFailedCount ?? 0,
    requestUrl: request?.url ?? null,
    responseUrl: request?.responseUrl ?? null,
    method: request?.method ?? null,
    requestText: unit?.cdp?.postData?.text ?? null,
    rate: 1,
    status: request?.status ?? null,
    mimeType: request?.mimeType ?? null,
    encodedDataLength: request?.encodedDataLength ?? null,
    capture
  };
}

function latestNetworkRequest(tracker, requestId) {
  const requests = tracker.getNetworkRequests();
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    if (requests[index]?.requestId === requestId) return requests[index];
  }
  return null;
}

function networkLifecycleFrame(message, tracker, context) {
  const params = message?.params ?? {};
  const eventOrdinal = tracker.networkSnapshot().boundaryOrdinal;
  const request = latestNetworkRequest(tracker, params.requestId);
  const parsedPostData = parseExp0022TtsPostData(
    params.request?.postData ?? null
  );
  if (message?.method === "Network.requestWillBeSent") {
    return {
      type: "NETWORK_REQUEST",
      payload: {
        navigationIndex: context.navigationIndex,
        trialId: context.trialId,
        requestId: params.requestId ?? null,
        url: params.request?.url ?? null,
        method: params.request?.method ?? null,
        resourceType: params.type ?? null,
        timestamp: params.timestamp ?? null,
        loaderId: params.loaderId ?? null,
        frameId: params.frameId ?? null,
        requestOrdinal: eventOrdinal,
        postData: parsedPostData.valid ? { text: parsedPostData.text } : null,
        auditProbeHeader: request?.auditProbeHeader ?? null,
        redirected: params.redirectResponse !== undefined
      }
    };
  }
  if (message?.method === "Network.responseReceived") {
    return {
      type: "NETWORK_RESPONSE",
      payload: {
        navigationIndex: context.navigationIndex,
        trialId: context.trialId,
        requestId: params.requestId ?? null,
        url: params.response?.url ?? null,
        status: params.response?.status ?? null,
        mimeType: normalizeMimeType(params.response?.mimeType),
        timestamp: params.timestamp ?? null,
        responseOrdinal: eventOrdinal,
        loaderId: params.loaderId ?? request?.loaderId ?? null,
        frameId: params.frameId ?? request?.frameId ?? null,
        fromDiskCache: params.response?.fromDiskCache === true,
        fromServiceWorker: params.response?.fromServiceWorker === true
      }
    };
  }
  if (message?.method === "Network.loadingFinished") {
    return {
      type: "NETWORK_TERMINAL",
      payload: {
        navigationIndex: context.navigationIndex,
        trialId: context.trialId,
        requestId: params.requestId ?? null,
        timestamp: params.timestamp ?? null,
        encodedDataLength: params.encodedDataLength ?? null,
        terminalOrdinal: eventOrdinal
      }
    };
  }
  if (message?.method === "Network.loadingFailed") {
    return {
      type: "NETWORK_FAILURE",
      payload: {
        navigationIndex: context.navigationIndex,
        trialId: context.trialId,
        requestId: params.requestId ?? null,
        timestamp: params.timestamp ?? null,
        errorText: params.errorText ?? null,
        canceled: params.canceled === true,
        blockedReason: params.blockedReason ?? null,
        terminalOrdinal: eventOrdinal
      }
    };
  }
  return null;
}

function assignedTtsRequest(tracker, requestOffset) {
  const raw = tracker.getNetworkRequests().slice(requestOffset).filter(
    (request) => isExp0022TtsUrl(request?.url, EXP0024_TARGET_URL)
  );
  const requestId = raw.length === 1 ? raw[0].requestId : null;
  return {
    assignedCount: raw.length,
    requestId,
    request: raw.length === 1 ? raw[0] : null,
    rawCount: raw.length
  };
}

function browserRecord(browserVersion, binding) {
  return {
    protocolVersion: browserVersion?.protocolVersion ?? null,
    product: browserVersion?.product ?? null,
    revision: browserVersion?.revision ?? null,
    userAgent: browserVersion?.userAgent ?? null,
    jsVersion: browserVersion?.jsVersion ?? null,
    cdpBinding: clone(binding ?? null)
  };
}

export function assertExp0024TargetUrl(value = EXP0024_TARGET_URL) {
  let href = null;
  try {
    href = new URL(value).href;
  } catch {
    // Falha fechada abaixo.
  }
  invariant(href === EXP0024_TARGET_URL,
    `target precisa ser exatamente ${EXP0024_TARGET_URL}`);
  return href;
}

export async function fetchExp0024Health(
  targetUrl = EXP0024_TARGET_URL,
  fetchImpl = globalThis.fetch
) {
  assertExp0024TargetUrl(targetUrl);
  invariant(typeof fetchImpl === "function", "fetch health indisponível");
  const response = await fetchImpl(new URL("/api/health", targetUrl), {
    signal: AbortSignal.timeout(10_000)
  });
  invariant(response.ok, `/api/health retornou HTTP ${response.status}`);
  return normalizeHealth(await response.json());
}

export function validateExp0024PhysicalBinding(input = {}) {
  const errors = [];
  const identity = input.identity;
  const request = input.request;
  if (
    !identity || !Number.isSafeInteger(identity.sequence) ||
    !Number.isSafeInteger(identity.navigationIndex) ||
    !Number.isSafeInteger(identity.trialIndex) ||
    !nonEmptyText(identity.trialId) || identity.text !== EXP0020_FIXED_PHRASE
  ) errors.push("identidade física inválida");
  if (
    input.assignedCount !== 1 || input.rawCount !== 1 ||
    !nonEmptyText(input.requestId) || request?.requestId !== input.requestId ||
    !isExp0022TtsUrl(request?.url, EXP0024_TARGET_URL)
  ) errors.push("bijeção trial↔requestId inválida");
  return Object.freeze({ valid: errors.length === 0, errors });
}

function workerBudgetInput(navigations, healthBefore, healthAfter) {
  return {
    healthBefore: clone(healthBefore),
    healthAfter: clone(healthAfter),
    navigationAudits: navigations.map((navigation) => clone(navigation.audit)),
    navigationSnapshots: navigations.map(
      (navigation) => snapshotSummary(navigation.snapshot)
    ),
    networkRequests: navigations.flatMap(
      (navigation) => clone(navigation.networkRequests)
    ),
    declared: {
      gpuRuns: 0,
      challengerRuns: 0,
      backboneRuns: 0,
      canProduceNewAuthority: false
    }
  };
}

export async function runExp0024BrowserCampaign(options = {}) {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const targetUrl = assertExp0024TargetUrl(
    options.targetUrl ?? EXP0024_TARGET_URL
  );
  const emitRecord = options.emitRecord ?? (async () => {});
  invariant(typeof emitRecord === "function", "emitRecord inválido");
  let emissionTail = Promise.resolve();
  const enqueueRecord = (type, payload) => {
    emissionTail = emissionTail.then(() => emitRecord(type, clone(payload)));
    return emissionTail;
  };
  const persistRecord = async (type, payload) => enqueueRecord(type, payload);
  const flushRecords = async () => emissionTail;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const fetchHealth = options.fetchHealth ?? fetchExp0024Health;
  const connectChrome = options.connectChrome ?? connectExp0022Chrome;
  const healthBefore = await fetchHealth(targetUrl, fetchImpl);
  await persistRecord("HEALTH_BEFORE", {
    health: healthBefore,
    observedAt: new Date().toISOString()
  });

  const chrome = options.chrome ?? await connectChrome({
    cdpUrl: options.cdpUrl ?? discoverExp0022CdpUrl(),
    targetUrl,
    fetchImpl,
    WebSocketImpl: options.WebSocketImpl,
    timeoutMs: options.commandTimeoutMs
  });
  const trackerFactory = options.createTracker ?? createExp0022NetworkTracker;
  const tracker = trackerFactory({
    send: chrome.send,
    targetUrl,
    capture: options.capture,
    wait: options.captureWait,
    now: options.captureNow
  });
  let currentNavigationIndex = null;
  let currentTrialId = null;
  const removeListener = chrome.onEvent((message) => {
    tracker.handleEvent(message);
    const frame = networkLifecycleFrame(message, tracker, {
      navigationIndex: currentNavigationIndex,
      trialId: currentTrialId
    });
    if (frame !== null) enqueueRecord(frame.type, frame.payload);
  });
  const navigations = [];
  let browser = null;

  try {
    await Promise.all([
      chrome.send("Runtime.enable"),
      chrome.send("Page.enable"),
      chrome.send("Network.enable", EXP0024_CONFIG.networkEnable)
    ]);
    await chrome.send("Page.addScriptToEvaluateOnNewDocument", {
      source: exp0022BrowserAuditSource()
    });
    browser = browserRecord(
      await chrome.send("Browser.getVersion"),
      chrome.binding
    );
    await persistRecord("BROWSER_BOUND", {
      browser,
      observedAt: new Date().toISOString()
    });
    await chrome.send("Page.bringToFront");

    let sequence = 0;
    for (let navigationIndex = 1;
      navigationIndex <= EXP0020_NAVIGATION_COUNT;
      navigationIndex += 1) {
      currentNavigationIndex = navigationIndex;
      const requestOffset = tracker.getNetworkRequests().length;
      const diagnosticOffset = diagnosticOffsets(tracker.getDiagnostics());
      await persistRecord("NAVIGATION_STARTED", {
        navigationIndex,
        targetUrl,
        startedAt: new Date().toISOString()
      });
      await chrome.send("Page.navigate", { url: targetUrl });
      await chrome.waitFor(
        () => chrome.evaluate(exp0022ReadyExpression()),
        PAGE_READY_TIMEOUT_MS
      );
      await tracker.waitForNetworkIdle();
      const beforeAudit = tracker.networkSnapshot(requestOffset);
      const browserHealth = normalizeBrowserHealth(await chrome.evaluate(
        exp0022BrowserHealthExpression(navigationIndex),
        PAGE_READY_TIMEOUT_MS
      ));
      await tracker.waitForNetworkIdle();
      const afterAudit = tracker.networkSnapshot(requestOffset);
      const healthBinding = createExp0022HealthBinding({
        before: beforeAudit,
        after: afterAudit,
        getHealthRecord: tracker.getHealthRecord
      });
      await persistRecord("NAVIGATION_AUDITED", {
        navigationIndex,
        observedAt: new Date().toISOString(),
        probeId: browserHealth.probeId,
        health: browserHealth.health,
        bootstrapRequestId: healthBinding.bootstrapHealthRequestId,
        auditRequestId: healthBinding.auditHealthRequestId,
        frameId: healthBinding.audit?.frameId ?? null,
        loaderId: healthBinding.audit?.loaderId ?? null
      });

      const trials = [];
      for (let trialIndex = 1;
        trialIndex <= EXP0020_TRIALS_PER_NAVIGATION;
        trialIndex += 1) {
        sequence += 1;
        const identity = {
          sequence,
          navigationIndex,
          trialIndex,
          trialId: `exp0020-nav-${navigationIndex}-trial-${trialIndex}`,
          text: EXP0020_FIXED_PHRASE
        };
        currentTrialId = identity.trialId;
        const trialRequestOffset = tracker.getNetworkRequests().length;
        tracker.beginUnit(identity);
        const physical = await chrome.evaluate(
          exp0020TrialExpression({ navigationIndex, trialIndex }),
          TRIAL_TIMEOUT_MS
        );
        const binding = assignedTtsRequest(tracker, trialRequestOffset);
        await persistRecord("PHYSICAL_TRIAL_COMPLETED", {
          completedAt: new Date().toISOString(),
          navigationIndex,
          trialIndex,
          trialId: identity.trialId,
          turnId: physical?.turnId ?? identity.trialId,
          requestId: binding.requestId,
          trial: clone(physical)
        });

        const unit = await tracker.finishUnit(null);
        await tracker.waitForNetworkIdle();
        const finalBinding = assignedTtsRequest(tracker, trialRequestOffset);
        const collectionValidation = validateExp0020TrialCollection(physical);
        const tts = ttsRequestProjection(finalBinding.request, unit);
        const captureJournal = captureJournalProjection(tts.capture);
        await persistRecord("CAPTURE_COMPLETED", {
          completedAt: new Date().toISOString(),
          navigationIndex,
          trialIndex,
          trialId: identity.trialId,
          turnId: physical?.turnId ?? identity.trialId,
          requestId: tts.requestId,
          ...captureJournal
        });
        currentTrialId = null;
        trials.push({
          ...clone(physical),
          turnId: physical?.turnId ?? identity.trialId,
          timing: {
            renderActiveAtMs: physical?.activeMarker?.atMs ?? null,
            plannedTriggerAtMs:
              physical?.plannedTriggerAtPerformanceMs ?? null,
            actualTriggerAtMs: physical?.triggerAtPerformanceMs ?? null,
            timerErrorMs: physical?.timerErrorMs ?? null,
            latestStopMarkerAtMs:
              physical?.latestMarkerAtPerformanceMs ?? null,
            postStopObservedAtMs:
              physical?.finalSnapshotAtPerformanceMs ?? null,
            postLatestMarkerHorizonMs:
              physical?.postLatestMarkerHorizonMs ?? null
          },
          collectionValidation,
          identity,
          tts
        });
      }

      await tracker.waitForNetworkIdle();
      const pageEvidence = await chrome.evaluate(
        `/*EXP0024_READ_NAVIGATION_EVIDENCE*/ (() => ({
          audit: structuredClone(globalThis.__exp0022Audit),
          snapshot: globalThis.__duplexLab.snapshot()
        }))()`
      );
      const allRequests = tracker.getNetworkRequests();
      const allDiagnostics = tracker.getDiagnostics();
      const navigation = {
        index: navigationIndex,
        targetUrl,
        runtimeFingerprintSha256:
          healthBefore.process.runtimeFingerprint.sha256,
        browser,
        browserHealth,
        healthBinding,
        trials,
        audit: clone(pageEvidence?.audit ?? null),
        snapshot: clone(pageEvidence?.snapshot ?? null),
        networkRequests: allRequests.slice(requestOffset),
        diagnostics: diagnosticSlice(allDiagnostics, diagnosticOffset)
      };
      navigations.push(navigation);
      for (const [category, records] of
        Object.entries(navigation.diagnostics)) {
        for (const record of records) {
          await persistRecord(
            "DIAGNOSTIC",
            diagnosticPayload(category, record, navigationIndex)
          );
        }
      }
      await persistRecord("NAVIGATION_COMPLETED", {
        completedAt: new Date().toISOString(),
        navigationIndex
      });
    }
  } finally {
    removeListener();
    await flushRecords();
    await chrome.closeTarget?.().catch(() => {});
    chrome.close?.();
  }

  const healthAfter = await fetchHealth(targetUrl, fetchImpl);
  await persistRecord("HEALTH_AFTER", {
    health: healthAfter,
    observedAt: new Date().toISOString()
  });
  const budgetInputs = workerBudgetInput(
    navigations,
    healthBefore,
    healthAfter
  );
  await persistRecord("BUDGET_INPUTS", {
    inputs: budgetInputs,
    observedAt: new Date().toISOString()
  });
  const diagnostics = tracker.getDiagnostics();
  invariant(
    navigations.flatMap((navigation) => navigation.trials).length ===
      EXP0020_TOTAL_TRIALS,
    "campanha não materializou 12 trials"
  );
  invariant(
    navigations.every((navigation) =>
      navigation.networkRequests.every((request) =>
        isExp0022AllowedNetworkUrl(request.url, targetUrl)
      ) && navigation.networkRequests.filter((request) =>
        isExp0022HealthUrl(request.url, targetUrl)
      ).length === 2
    ),
    "rede local/health cardinalidade divergente"
  );

  return Object.freeze({
    schemaVersion: EXP0024_WORKER_ENVELOPE_SCHEMA,
    status: "completed",
    startedAt,
    completedAt: options.completedAt ?? new Date().toISOString(),
    campaign: {
      health: { before: healthBefore, after: healthAfter },
      browser,
      navigations,
      diagnostics,
      budgetInputs,
      contract: {
        targetUrl,
        phrase: EXP0020_FIXED_PHRASE,
        navigationCount: EXP0020_NAVIGATION_COUNT,
        trialsPerNavigation: EXP0020_TRIALS_PER_NAVIGATION,
        totalTrials: EXP0020_TOTAL_TRIALS,
        triggerDelayMs: EXP0020_TRIGGER_DELAY_MS,
        triggerErrorMaxMs: EXP0020_TRIGGER_ERROR_MAX_MS,
        postMarkerHorizonMs: EXP0020_POST_MARKER_HORIZON_MS,
        expectedWavSha256: EXP0024_EXPECTED_WAV_SHA256,
        expectedWavByteLength: EXP0024_EXPECTED_WAV_BYTES,
        browserCdpByteIdentity: null
      }
    },
    failure: null
  });
}

export function validateExp0024WorkerEnvelopeShape(envelope) {
  const trials = envelope?.campaign?.navigations?.flatMap(
    (navigation) => navigation?.trials ?? []
  ) ?? [];
  const requestIds = trials.map((trial) => trial?.tts?.requestId);
  const valid = envelope?.schemaVersion === EXP0024_WORKER_ENVELOPE_SCHEMA &&
    envelope?.status === "completed" && envelope?.failure === null &&
    Array.isArray(envelope?.campaign?.navigations) &&
    envelope.campaign.navigations.length === EXP0020_NAVIGATION_COUNT &&
    trials.length === EXP0020_TOTAL_TRIALS &&
    requestIds.every(nonEmptyText) &&
    new Set(requestIds).size === EXP0020_TOTAL_TRIALS &&
    HEX_HASH_PATTERN.test(
      envelope.campaign?.health?.before?.process?.runtimeFingerprint?.sha256 ??
        ""
    );
  return Object.freeze({ valid, errors: valid ? [] : [
    "worker envelope EXP-0024 incompleto"
  ] });
}
