import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0022_ATTEMPT_PATH,
  EXP0022_AUDIT_KEYS,
  EXP0022_CAPTURE_FAILURE_CODES,
  EXP0022_CONFIG,
  EXP0022_DECISIONS,
  EXP0022_NEXT_MOVES,
  EXP0022_ORDER,
  EXP0022_PASS_CLAIM,
  EXP0022_POST_COMMIT_AUDIT_KEYS,
  EXP0022_PAYLOAD_A,
  EXP0022_PAYLOAD_B,
  EXP0022_PATHS,
  EXP0022_RECEIPT_PATH,
  EXP0022_WORKER_ENVELOPE_SCHEMA,
  analyzeExp0022Campaign,
  createExp0022Report,
  validateExp0022Report
} from "../src/eval/exp-0022-bootstrap-audit-health-binding.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;

function health() {
  return {
    process: {
      runId: "runtime-exp0022",
      runtimeFingerprint: { sha256: HASH_C }
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

function diagnostics() {
  return {
    structuralErrors: [],
    networkViolations: [],
    httpErrors: [],
    consoleErrors: [],
    runtimeErrors: []
  };
}

function snapshot() {
  return {
    state: {
      active: false,
      inputMode: null,
      assistantSpeaking: false
    },
    traceEventTypes: ["automation.ready"],
    trainingTrace: { decisions: 0, effects: 0 },
    reflexTrainingTrace: { decisions: 0, effects: 0 },
    audio: {
      capture: null,
      transport: { socketReadyState: null },
      vadControl: { state: "unknown" },
      vadShadow: { health: { state: "unknown" } },
      outputInterruptionLifecycle: { phase: "idle" }
    }
  };
}

function navigationAudit(firstUnitTrialId) {
  return {
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
    installedAtMs: 1,
    singleTtsInFlight: true,
    retryIssuedRequest: false,
    firstUnitTrialId,
    instrumentationInstalled: true
  };
}

function successCapture(requestId, sha256, byteLength, options = {}) {
  const emptyReads = options.emptyReads ?? 0;
  let completedAtMs = 10;
  const attempts = Array.from({ length: emptyReads + 1 }, (_, index) => {
    const delayBeforeMs = EXP0022_CONFIG.capture.delayBeforeReadMs[index];
    const startedAtMs = completedAtMs + delayBeforeMs;
    completedAtMs = startedAtMs + 1;
    return {
      index: index + 1,
      delayBeforeMs,
      requestId,
      startedAtMs,
      completedAtMs,
      outcome: index < emptyReads ? "empty" : "success"
    };
  });
  return {
    status: "success",
    code: null,
    readCount: attempts.length,
    emptyReadsBeforeSuccess: emptyReads,
    attempts,
    base64Encoded: true,
    byteLength,
    sha256,
    wavValid: true
  };
}

function unit(expected, options = {}) {
  const payload = expected.payloadId === "A"
    ? EXP0022_PAYLOAD_A
    : EXP0022_PAYLOAD_B;
  const defaultSha = expected.payloadId === "A" ? HASH_A : HASH_B;
  const defaultLength = expected.payloadId === "A" ? 64 : 80;
  const requestId = options.requestId ?? `request-${expected.trialId}`;
  const browserSha = options.browserSha ?? defaultSha;
  const browserLength = options.browserLength ?? defaultLength;
  const capture = options.capture ?? successCapture(
    requestId,
    options.cdpSha ?? defaultSha,
    options.cdpLength ?? defaultLength,
    { emptyReads: options.emptyReads }
  );
  return {
    navigationIndex: expected.navigationIndex,
    unitIndex: expected.unitIndex,
    trialId: expected.trialId,
    payloadId: expected.payloadId,
    text: payload.text,
    sequence: expected.sequence,
    browser: {
      url: EXP0022_CONFIG.ttsUrl,
      status: options.browserStatus ?? 200,
      mimeType: options.browserMimeType ?? "audio/wav",
      byteLength: browserLength,
      sha256: browserSha
    },
    cdp: {
      observedRequestIds: options.observedRequestIds ?? [requestId],
      requestId,
      requestWillBeSentCount: 1,
      responseReceivedCount: 1,
      loadingFinishedCount: 1,
      url: EXP0022_CONFIG.ttsUrl,
      method: "POST",
      postData: structuredClone(payload.postData),
      status: options.cdpStatus ?? 200,
      mimeType: options.cdpMimeType ?? "audio/wav",
      encodedDataLength: options.encodedDataLength ?? defaultLength,
      capture
    }
  };
}

function boundary() {
  return {
    freezePath: EXP0022_PATHS.freeze,
    freezeCanonicalSha256: HASH_A,
    freezeFileSha256: HASH_B,
    freezeVerified: true,
    attemptPath: EXP0022_ATTEMPT_PATH,
    attemptCanonicalSha256: HASH_C,
    attemptFileSha256: HASH_D,
    attemptVerified: true,
    receiptPath: EXP0022_RECEIPT_PATH,
    receiptFileSha256: HASH_A,
    expectedRuntimeFingerprintSha256: HASH_C,
    receiptVerified: true,
    receiptWriteOnce: true,
    receiptBeforeNetwork: true,
    rerunAllowed: false
  };
}

function audits() {
  return Object.fromEntries(EXP0022_AUDIT_KEYS.map((key) => [key, true]));
}

function auditHealthUrl(index) {
  const url = new URL("/api/health", EXP0022_CONFIG.targetUrl);
  url.searchParams.set(
    EXP0022_CONFIG.healthBinding.auditQueryName,
    EXP0022_CONFIG.healthBinding.auditProbeIds[index - 1]
  );
  return url.href;
}

function healthLifecycle({
  requestId,
  url,
  auditProbeHeader,
  loaderId,
  frameId,
  requestOrdinal,
  timestamp
}) {
  return {
    requestId,
    requestWillBeSentCount: 1,
    responseReceivedCount: 1,
    loadingFinishedCount: 1,
    loadingFailedCount: 0,
    redirectCount: 0,
    url,
    method: "GET",
    auditProbeHeader,
    resourceType: "Fetch",
    loaderId,
    frameId,
    status: 200,
    mimeType: "application/json",
    requestTimestamp: timestamp,
    responseTimestamp: timestamp + 0.1,
    finishedTimestamp: timestamp + 0.2,
    requestOrdinal,
    responseOrdinal: requestOrdinal + 1,
    finishedOrdinal: requestOrdinal + 2
  };
}

function rawNetworkRecord({
  requestId,
  url,
  method,
  type,
  timestamp,
  auditProbeHeader = null,
  requestOrdinal,
  loaderId,
  frameId,
  postData = null,
  status = 200,
  mimeType,
  encodedDataLength = 100
}) {
  return {
    requestId,
    url,
    method,
    type,
    timestamp,
    auditProbeHeader,
    requestOrdinal,
    loaderId,
    frameId,
    redirected: false,
    postData,
    tracksLoadingLifecycle: true,
    responseReceivedCount: 1,
    responseUrl: url,
    status,
    mimeType,
    responseTimestamp: timestamp + 0.1,
    responseOrdinal: requestOrdinal + 1,
    loadingFinishedCount: 1,
    encodedDataLength,
    finishedTimestamp: timestamp + 0.2,
    finishedOrdinal: requestOrdinal + 2,
    loadingFailedCount: 0,
    failedTimestamp: null,
    failedOrdinal: null
  };
}

function navigation(index, units) {
  const firstTrialId = index === 1 ? "A1" : "B2";
  const base = (index - 1) * 40;
  const documentId = `document-${index}`;
  const bootstrapId = `bootstrap-${index}`;
  const auditId = `audit-${index}`;
  const loaderId = `loader-${index}`;
  const frameId = `frame-${index}`;
  const bootstrapUrl = new URL(
    "/api/health",
    EXP0022_CONFIG.targetUrl
  ).href;
  const auditUrl = auditHealthUrl(index);
  const bootstrap = healthLifecycle({
    requestId: bootstrapId,
    url: bootstrapUrl,
    auditProbeHeader: null,
    loaderId,
    frameId,
    requestOrdinal: base + 4,
    timestamp: base + 4
  });
  const audit = healthLifecycle({
    requestId: auditId,
    url: auditUrl,
    auditProbeHeader: EXP0022_CONFIG.healthBinding.auditHeaderValue,
    loaderId,
    frameId,
    requestOrdinal: base + 11,
    timestamp: base + 11
  });
  units.forEach((candidate, position) => {
    candidate.cdp.requestOrdinal = base + 16 + position * 3;
  });
  return {
    index,
    targetUrl: EXP0022_CONFIG.targetUrl,
    browserHealth: {
      probeId: EXP0022_CONFIG.healthBinding.auditProbeIds[index - 1],
      url: auditUrl,
      status: 200,
      mimeType: "application/json",
      health: health()
    },
    healthBinding: {
      schemaVersion: "exp-0022-bootstrap-audit-health-binding-v1",
      beforeAudit: {
        boundaryOrdinal: base + 7,
        networkRequestIds: [documentId, bootstrapId],
        healthRequestIds: [bootstrapId],
        pendingRequestIds: []
      },
      afterAudit: {
        boundaryOrdinal: base + 14,
        networkRequestIds: [documentId, bootstrapId, auditId],
        healthRequestIds: [bootstrapId, auditId],
        pendingRequestIds: []
      },
      newNetworkRequestIds: [auditId],
      newHealthRequestIds: [auditId],
      bootstrapHealthRequestId: bootstrapId,
      auditHealthRequestId: auditId,
      bootstrapFinishedBeforeAudit: true,
      bootstrap,
      audit
    },
    units,
    audit: navigationAudit(firstTrialId),
    snapshot: snapshot(),
    networkRequests: [
      rawNetworkRecord({
        requestId: `document-${index}`,
        url: EXP0022_CONFIG.targetUrl,
        method: "GET",
        type: "Document",
        timestamp: base + 1,
        auditProbeHeader: null,
        requestOrdinal: base + 1,
        loaderId,
        frameId,
        mimeType: "text/html"
      }),
      rawNetworkRecord({
        requestId: bootstrapId,
        url: bootstrapUrl,
        method: "GET",
        type: "Fetch",
        timestamp: bootstrap.requestTimestamp,
        auditProbeHeader: null,
        requestOrdinal: bootstrap.requestOrdinal,
        loaderId,
        frameId,
        mimeType: "application/json"
      }),
      rawNetworkRecord({
        requestId: auditId,
        url: auditUrl,
        method: "GET",
        type: "Fetch",
        timestamp: audit.requestTimestamp,
        auditProbeHeader: EXP0022_CONFIG.healthBinding.auditHeaderValue,
        requestOrdinal: audit.requestOrdinal,
        loaderId,
        frameId,
        mimeType: "application/json"
      }),
      ...units.map((candidate) => rawNetworkRecord({
        requestId: candidate.cdp.requestId,
        url: EXP0022_CONFIG.ttsUrl,
        method: "POST",
        type: "Fetch",
        timestamp: candidate.cdp.requestOrdinal,
        auditProbeHeader: null,
        requestOrdinal: candidate.cdp.requestOrdinal,
        loaderId,
        frameId,
        postData: JSON.stringify(candidate.cdp.postData),
        status: candidate.cdp.status,
        mimeType: candidate.cdp.mimeType,
        encodedDataLength: candidate.cdp.encodedDataLength
      }))
    ],
    diagnostics: diagnostics()
  };
}

function campaign(options = {}) {
  const units = EXP0022_ORDER.map((expected, index) =>
    unit(expected, options.unit?.(expected, index) ?? {})
  );
  const envelope = {
    schemaVersion: EXP0022_WORKER_ENVELOPE_SCHEMA,
    status: options.workerStatus ?? "completed",
    startedAt: "2026-08-03T06:00:00.000Z",
    completedAt: "2026-08-03T06:01:00.000Z",
    campaign: {
      health: { before: health(), after: health() },
      browser: {
        product: "Chrome/150.0.0.0",
        protocolVersion: "1.3",
        revision: "fixture-revision",
        userAgent: "fixture",
        jsVersion: "fixture-js",
        cdpBinding: {
          endpoint: "http://172.20.0.1:9223/",
          hostPolicy: "wsl-default-gateway",
          initialTarget: "about:blank",
          targetId: "target-exp0022",
          webSocketPath: "/devtools/page/target-exp0022"
        }
      },
      navigations: [
        navigation(1, units.slice(0, 2)),
        navigation(2, units.slice(2, 4))
      ],
      diagnostics: diagnostics(),
      budget: structuredClone(EXP0022_CONFIG.negativeBudget)
    },
    failure: options.failure ?? null
  };
  return {
    boundary: boundary(),
    workerEnvelope: envelope,
    audits: audits()
  };
}

function report(inputCampaign = campaign()) {
  return createExp0022Report({
    startedAt: "2026-08-03T06:00:00.000Z",
    completedAt: "2026-08-03T06:01:00.000Z",
    campaign: inputCampaign
  });
}

function rehash(value) {
  const core = structuredClone(value);
  delete core.reportSha256;
  value.reportSha256 = `sha256:${canonicalSha256(core)}`;
}

test("constantes congelam paths, payloads, rate default e ordem A1/B1/B2/A2", () => {
  assert.equal(
    EXP0022_ATTEMPT_PATH,
    "eval/commitments/exp-0022-capture-attempt-v0.1.json"
  );
  assert.equal(
    EXP0022_RECEIPT_PATH,
    "eval/generated/exp-0022/capture-attempt-consumed-v0.1.json"
  );
  assert.deepEqual(EXP0022_ORDER.map((entry) => entry.trialId), [
    "A1", "B1", "B2", "A2"
  ]);
  assert.deepEqual(EXP0022_PAYLOAD_A.postData, {
    text: EXP0022_PAYLOAD_A.text
  });
  assert.equal(EXP0022_PAYLOAD_A.rate, 1);
  assert.equal(EXP0022_PAYLOAD_B.rate, 1);
  assert.notEqual(EXP0022_PAYLOAD_A.text, EXP0022_PAYLOAD_B.text);
});

test("campanha completa passa 10/10 somente como qualification", () => {
  const analysis = analyzeExp0022Campaign(campaign());
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.decision, EXP0022_DECISIONS.pass);
  assert.deepEqual(
    analysis.nextMove,
    EXP0022_NEXT_MOVES[EXP0022_DECISIONS.pass]
  );
  assert.equal(analysis.pass, true);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.metrics.successfulCaptures, 4);
  assert.equal(Object.keys(analysis.gates).length, 10);
  assert.equal(
    Object.values(analysis.gates).every((value) => value === true),
    true
  );
  assert.equal(analysis.transientRecoveryObserved, false);

  const canonical = report();
  assert.equal(canonical.claim, EXP0022_PASS_CLAIM);
  assert.equal(canonical.authorityEligible, false);
  assert.deepEqual(canonical.evidenceAcceptance, {
    status: "PENDING_POST_COMMIT_CHECK",
    requiredChecks: EXP0022_POST_COMMIT_AUDIT_KEYS
  });
  assert.equal(
    Object.keys(canonical.campaign.audits).some((key) =>
      EXP0022_POST_COMMIT_AUDIT_KEYS.includes(key)),
    false
  );
  assert.deepEqual(canonical.nextMove, analysis.nextMove);
  assert.deepEqual(validateExp0022Report(canonical), {
    valid: true,
    errors: []
  });
});

test("recovery transitório só é observado em vazio seguido de sucesso", () => {
  const analysis = analyzeExp0022Campaign(campaign({
    unit: (_, index) => index === 2 ? { emptyReads: 1 } : {}
  }));
  assert.equal(analysis.decision, EXP0022_DECISIONS.pass);
  assert.equal(analysis.transientRecoveryObserved, true);
  assert.equal(analysis.metrics.transientRecoveries, 1);
  assert.equal(analysis.metrics.totalReads, 5);
});

test("A/B stale é FIX interpretável, não passe nem invalidação", () => {
  const analysis = analyzeExp0022Campaign(campaign({
    unit: (expected) => expected.payloadId === "B"
      ? {
          browserSha: HASH_A,
          browserLength: 64,
          cdpSha: HASH_A,
          cdpLength: 64
        }
      : {}
  }));
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.gates.browserCdpByteIdentity, true);
  assert.equal(analysis.gates.payloadStabilityAndDistinction, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.fix);
  assert.deepEqual(
    analysis.nextMove,
    EXP0022_NEXT_MOVES[EXP0022_DECISIONS.fix]
  );
});

test("digest browser/CDP divergente exige FIX", () => {
  const analysis = analyzeExp0022Campaign(campaign({
    unit: (_, index) => index === 1 ? { cdpSha: HASH_D } : {}
  }));
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.gates.browserCdpByteIdentity, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.fix);
});

test("status HTTP tipado permanece FIX mesmo registrado em diagnostics", () => {
  const code = EXP0022_CAPTURE_FAILURE_CODES.statusInvalid;
  const preReadFailure = {
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
  const input = campaign({
    workerStatus: "capture-failure",
    failure: { code, message: "status TTS inválido" },
    unit: (_, index) => index === 0
      ? {
          browserStatus: 503,
          cdpStatus: 503,
          capture: preReadFailure
        }
      : {}
  });
  const first = input.workerEnvelope.campaign.navigations[0].units[0];
  const error = {
    requestId: first.cdp.requestId,
    url: EXP0022_CONFIG.ttsUrl,
    status: 503
  };
  input.workerEnvelope.campaign.navigations[0]
    .diagnostics.httpErrors.push(structuredClone(error));
  input.workerEnvelope.campaign.diagnostics.httpErrors.push(error);
  const analysis = analyzeExp0022Campaign(input);
  assert.equal(analysis.structural.diagnosticsValid, true);
  assert.equal(analysis.structural.attemptBindingsValid, true);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.gates.cdpChainAndResponse, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.fix);
});

test("quatro vazios tipados preservam instrumento e retornam FIX", () => {
  const code = EXP0022_CAPTURE_FAILURE_CODES.bodyEmpty;
  const failedRequestId = "request-A1";
  const failedCapture = {
    status: "failure",
    code,
    readCount: 4,
    emptyReadsBeforeSuccess: null,
    attempts: (() => {
      let completedAtMs = 10;
      return EXP0022_CONFIG.capture.delayBeforeReadMs.map(
        (delayBeforeMs, index) => {
          const startedAtMs = completedAtMs + delayBeforeMs;
          completedAtMs = startedAtMs + 1;
          return {
            index: index + 1,
            delayBeforeMs,
            requestId: failedRequestId,
            startedAtMs,
            completedAtMs,
            outcome: "empty"
          };
        }
      );
    })(),
    base64Encoded: null,
    byteLength: null,
    sha256: null,
    wavValid: false
  };
  const input = campaign({
    workerStatus: "capture-failure",
    failure: { code, message: "quatro corpos vazios" },
    unit: (_, index) => index === 0 ? { capture: failedCapture } : {}
  });
  const analysis = analyzeExp0022Campaign(input);
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.structural.attemptBindingsValid, true);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.gates.boundedFailClosedCapture, false);
  assert.equal(analysis.gates.firstResponsePerNavigation, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.fix);
  assert.equal(analysis.transientRecoveryObserved, false);
});

test("overflow detectado após leitura continua sendo FIX tipado", () => {
  const code = EXP0022_CAPTURE_FAILURE_CODES.resourceBufferExceeded;
  const requestId = "request-A1";
  const input = campaign({
    workerStatus: "capture-failure",
    failure: { code, message: "payload excedeu o buffer por recurso" },
    unit: (_, index) => index === 0 ? {
      capture: {
        status: "failure",
        code,
        readCount: 1,
        emptyReadsBeforeSuccess: null,
        attempts: [{
          index: 1,
          delayBeforeMs: 0,
          requestId,
          startedAtMs: 10,
          completedAtMs: 11,
          outcome: "error"
        }],
        base64Encoded: null,
        byteLength: null,
        sha256: null,
        wavValid: false
      }
    } : {}
  });
  const analysis = analyzeExp0022Campaign(input);
  assert.equal(analysis.structural.attemptBindingsValid, true);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.decision, EXP0022_DECISIONS.fix);
});

test("crash ou envelope sem protocolo invalida e não interpreta captura", () => {
  const input = campaign();
  input.workerEnvelope.status = "crash";
  input.workerEnvelope.failure = {
    code: "WORKER_EXIT_WITHOUT_ENVELOPE",
    message: "exit 1"
  };
  const analysis = analyzeExp0022Campaign(input);
  assert.equal(analysis.measurementStatus, "NOT_EVALUATED");
  assert.equal(analysis.gates.boundaryAndSupervisor, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
  assert.deepEqual(
    analysis.nextMove,
    EXP0022_NEXT_MOVES[EXP0022_DECISIONS.invalidate]
  );
  for (const name of [
    "cdpChainAndResponse",
    "browserCdpByteIdentity",
    "payloadStabilityAndDistinction",
    "boundedFailClosedCapture",
    "firstResponsePerNavigation"
  ]) assert.equal(analysis.gates[name], null);
});

test("coleção vazia nunca passa por every([])", () => {
  const analysis = analyzeExp0022Campaign({});
  assert.equal(analysis.measurementStatus, "NOT_EVALUATED");
  assert.equal(analysis.metrics.unitCount, 0);
  assert.equal(analysis.metrics.successfulCaptures, 0);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
  assert.equal(Object.values(analysis.gates).includes(true), false);
  assert.equal(analysis.gates.browserCdpByteIdentity, null);
});

test("requestId stale e budget divergente têm precedência INVALIDATE", () => {
  const stale = campaign({
    unit: (_, index) => index === 3
      ? { observedRequestIds: ["request-A1"] }
      : {}
  });
  let analysis = analyzeExp0022Campaign(stale);
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.structural.requestBindingsValid, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);

  const overBudget = campaign();
  overBudget.workerEnvelope.campaign.budget.gpuRuns = 1;
  analysis = analyzeExp0022Campaign(overBudget);
  assert.equal(analysis.gates.negativeBudgetExact, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
});

test("health visto pelo browser e autoridade CDP ligam o runtime medido", () => {
  const wrongBrowserRuntime = campaign();
  wrongBrowserRuntime.workerEnvelope.campaign.navigations[1]
    .browserHealth.health.process.runId = "runtime-alheio";
  let analysis = analyzeExp0022Campaign(wrongBrowserRuntime);
  assert.equal(analysis.gates.environmentStable, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);

  const staleCommittedRuntime = campaign();
  staleCommittedRuntime.boundary.expectedRuntimeFingerprintSha256 = HASH_D;
  analysis = analyzeExp0022Campaign(staleCommittedRuntime);
  assert.equal(analysis.gates.environmentStable, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);

  const remoteCdp = campaign();
  remoteCdp.workerEnvelope.campaign.browser.cdpBinding.endpoint =
    "https://example.com:9223/";
  analysis = analyzeExp0022Campaign(remoteCdp);
  assert.equal(analysis.gates.environmentStable, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);

  const missingBrowserHealthRequest = campaign();
  missingBrowserHealthRequest.workerEnvelope.campaign.navigations[0]
    .networkRequests = missingBrowserHealthRequest.workerEnvelope.campaign
      .navigations[0].networkRequests.filter((request) =>
        request.requestId !== "audit-1");
  analysis = analyzeExp0022Campaign(missingBrowserHealthRequest);
  assert.equal(analysis.structural.navigationAuditValid, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
});

test("requestId cross-trial e delay apenas declarado invalidam bindings", () => {
  const reused = campaign();
  const a1 = reused.workerEnvelope.campaign.navigations[0].units[0];
  const a2 = reused.workerEnvelope.campaign.navigations[1].units[1];
  const oldRequestId = a2.cdp.requestId;
  a2.cdp.requestId = a1.cdp.requestId;
  a2.cdp.observedRequestIds = [a1.cdp.requestId];
  for (const attempt of a2.cdp.capture.attempts) {
    attempt.requestId = a1.cdp.requestId;
  }
  const networkRecord = reused.workerEnvelope.campaign.navigations[1]
    .networkRequests.find((entry) => entry.requestId === oldRequestId);
  networkRecord.requestId = a1.cdp.requestId;
  let analysis = analyzeExp0022Campaign(reused);
  assert.equal(analysis.structural.requestBindingsValid, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);

  const fakeDelay = campaign({
    unit: (_, index) => index === 0 ? { emptyReads: 1 } : {}
  });
  const attempts = fakeDelay.workerEnvelope.campaign.navigations[0]
    .units[0].cdp.capture.attempts;
  attempts[1].startedAtMs = attempts[0].completedAtMs + 7;
  attempts[1].completedAtMs = attempts[1].startedAtMs + 1;
  analysis = analyzeExp0022Campaign(fakeDelay);
  assert.equal(analysis.structural.attemptBindingsValid, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);

  const crossType = campaign();
  const navigationOne = crossType.workerEnvelope.campaign.navigations[0];
  const firstUnit = navigationOne.units[0];
  const previousTtsId = firstUnit.cdp.requestId;
  firstUnit.cdp.requestId = "bootstrap-1";
  firstUnit.cdp.observedRequestIds = ["bootstrap-1"];
  for (const attempt of firstUnit.cdp.capture.attempts) {
    attempt.requestId = "bootstrap-1";
  }
  navigationOne.networkRequests.find(({ requestId }) =>
    requestId === previousTtsId).requestId = "bootstrap-1";
  analysis = analyzeExp0022Campaign(crossType);
  assert.equal(analysis.structural.requestBindingsValid, true);
  assert.equal(analysis.structural.bootstrapAuditHealthBindingValid, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
});

test("schema exato recusa campos e ausências não registrados", async (t) => {
  const cases = [
    ["campaign extra", (input) => {
      input.workerEnvelope.campaign.unregisteredEffect = true;
    }],
    ["unit extra", (input) => {
      input.workerEnvelope.campaign.navigations[0]
        .units[0].unregisteredEffect = true;
    }],
    ["capture ausente", (input) => {
      delete input.workerEnvelope.campaign.navigations[0]
        .units[0].cdp.capture;
    }],
    ["envelope externo extra", (input) => {
      input.unregisteredEffect = true;
    }],
    ["snapshot aninhado extra", (input) => {
      input.workerEnvelope.campaign.navigations[0]
        .snapshot.audio.transport.unregisteredEffect = true;
    }]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = campaign();
      mutate(input);
      const analysis = analyzeExp0022Campaign(input);
      assert.equal(analysis.measurementStatus, "NOT_EVALUATED");
      assert.equal(analysis.instrumentValid, false);
      assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
      for (const gate of [
        "cdpChainAndResponse",
        "browserCdpByteIdentity",
        "payloadStabilityAndDistinction",
        "boundedFailClosedCapture",
        "firstResponsePerNavigation"
      ]) assert.equal(analysis.gates[gate], null);
    });
  }

  const boundaryExtra = campaign();
  boundaryExtra.boundary.unregisteredEffect = true;
  const analysis = analyzeExp0022Campaign(boundaryExtra);
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.structural.boundaryValid, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
});

test("ledger bruto é a fonte de lifecycle, snapshots e delta", async (t) => {
  const cases = [
    ["URL bootstrap bruta", (navigation) => {
      navigation.networkRequests.find(({ requestId }) =>
        requestId === "bootstrap-1").url =
          `${new URL("/api/health", EXP0022_CONFIG.targetUrl).href}?unexpected=1`;
    }],
    ["frame audit bruto", (navigation) => {
      navigation.networkRequests.find(({ requestId }) =>
        requestId === "audit-1").frameId = "frame-alheio";
    }],
    ["redirect audit bruto", (navigation) => {
      navigation.networkRequests.find(({ requestId }) =>
        requestId === "audit-1").redirected = true;
    }],
    ["método audit bruto", (navigation) => {
      navigation.networkRequests.find(({ requestId }) =>
        requestId === "audit-1").method = "POST";
    }],
    ["failure fantasma no health", (navigation) => {
      const audit = navigation.networkRequests.find(({ requestId }) =>
        requestId === "audit-1");
      audit.failedTimestamp = audit.timestamp + 0.15;
      audit.failedOrdinal = audit.requestOrdinal + 2;
    }],
    ["failure fantasma no TTS", (navigation) => {
      const tts = navigation.networkRequests.find(({ requestId }) =>
        requestId === navigation.units[0].cdp.requestId);
      tts.failedTimestamp = tts.timestamp + 0.15;
      tts.failedOrdinal = tts.requestOrdinal + 2;
    }],
    ["TTS simultâneos", (navigation) => {
      const [first, second] = navigation.networkRequests.filter((request) =>
        request.url === EXP0022_CONFIG.ttsUrl);
      second.requestOrdinal = first.finishedOrdinal;
      second.timestamp = first.finishedTimestamp;
      navigation.units[1].cdp.requestOrdinal = second.requestOrdinal;
    }],
    ["request oculto durante a sonda", (navigation) => {
      navigation.networkRequests.splice(2, 0, rawNetworkRecord({
        requestId: "hidden-during-probe",
        url: new URL("/hidden", EXP0022_CONFIG.targetUrl).href,
        method: "GET",
        type: "Fetch",
        timestamp: 8,
        requestOrdinal: 8,
        loaderId: "loader-1",
        frameId: "frame-1",
        mimeType: "application/json"
      }));
    }]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = campaign();
      mutate(input.workerEnvelope.campaign.navigations[0]);
      const analysis = analyzeExp0022Campaign(input);
      assert.equal(analysis.measurementStatus, "EVALUATED");
      assert.equal(
        analysis.structural.bootstrapAuditHealthBindingValid,
        false
      );
      assert.equal(analysis.structural.navigationAuditValid, false);
      assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
    });
  }
});

test("health causal falha fechado para marcador, cardinalidade e lifecycle", async (t) => {
  const cases = [
    ["dois healths sem marcador", (navigation) => {
      navigation.healthBinding.audit.auditProbeHeader = null;
      navigation.networkRequests.find(({ requestId }) => requestId === "audit-1")
        .auditProbeHeader = null;
    }],
    ["query da sonda ausente", (navigation) => {
      const baseUrl = new URL("/api/health", EXP0022_CONFIG.targetUrl).href;
      navigation.healthBinding.audit.url = baseUrl;
      navigation.browserHealth.url = baseUrl;
      navigation.networkRequests.find(({ requestId }) => requestId === "audit-1")
        .url = baseUrl;
    }],
    ["token da outra navegação", (navigation) => {
      const wrongUrl = auditHealthUrl(2);
      navigation.healthBinding.audit.url = wrongUrl;
      navigation.browserHealth.url = wrongUrl;
      navigation.browserHealth.probeId = "nav-2";
      navigation.networkRequests.find(({ requestId }) => requestId === "audit-1")
        .url = wrongUrl;
    }],
    ["query inesperada extra", (navigation) => {
      const unexpected = new URL(auditHealthUrl(1));
      unexpected.searchParams.set("extra", "1");
      navigation.healthBinding.audit.url = unexpected.href;
      navigation.browserHealth.url = unexpected.href;
      navigation.networkRequests.find(({ requestId }) => requestId === "audit-1")
        .url = unexpected.href;
    }],
    ["terceiro health", (navigation) => {
      navigation.networkRequests.push({
        ...structuredClone(navigation.networkRequests[1]),
        requestId: "health-extra-1",
        requestOrdinal: 10
      });
    }],
    ["zero bootstrap no snapshot", (navigation) => {
      navigation.healthBinding.beforeAudit.healthRequestIds = [];
      navigation.healthBinding.bootstrapHealthRequestId = null;
    }],
    ["dois audits na janela", (navigation) => {
      navigation.healthBinding.newHealthRequestIds.push("audit-extra-1");
    }],
    ["ID derivado adulterado", (navigation) => {
      navigation.healthBinding.auditHealthRequestId = "bootstrap-1";
    }],
    ["redirect", (navigation) => {
      navigation.healthBinding.audit.redirectCount = 1;
    }],
    ["response ausente", (navigation) => {
      navigation.healthBinding.audit.responseReceivedCount = 0;
    }],
    ["loadingFailed", (navigation) => {
      navigation.healthBinding.audit.loadingFinishedCount = 0;
      navigation.healthBinding.audit.loadingFailedCount = 1;
    }],
    ["status incorreto", (navigation) => {
      navigation.healthBinding.audit.status = 503;
    }],
    ["MIME incorreto", (navigation) => {
      navigation.healthBinding.audit.mimeType = "text/plain";
    }],
    ["ordem CDP invertida", (navigation) => {
      navigation.healthBinding.audit.responseOrdinal =
        navigation.healthBinding.audit.requestOrdinal;
    }],
    ["timestamp regressivo", (navigation) => {
      navigation.healthBinding.audit.responseTimestamp =
        navigation.healthBinding.audit.requestTimestamp - 1;
    }],
    ["loader divergente", (navigation) => {
      navigation.healthBinding.audit.loaderId = "loader-alheio";
    }],
    ["frame divergente", (navigation) => {
      navigation.healthBinding.audit.frameId = "frame-alheio";
    }],
    ["TTS antes do audit finish", (navigation) => {
      navigation.units[0].cdp.requestOrdinal =
        navigation.healthBinding.audit.finishedOrdinal;
    }],
    ["browser ligado a URL diferente", (navigation) => {
      navigation.browserHealth.url =
        new URL("/api/health", EXP0022_CONFIG.targetUrl).href;
    }]
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = campaign();
      mutate(input.workerEnvelope.campaign.navigations[0]);
      const analysis = analyzeExp0022Campaign(input);
      assert.equal(analysis.measurementStatus, "EVALUATED");
      assert.equal(analysis.structural.bootstrapAuditHealthBindingValid, false);
      assert.equal(analysis.structural.navigationAuditValid, false);
      assert.equal(analysis.instrumentValid, false);
      assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
      assert.equal(analysis.pass, false);
      assert.equal(report(input).claim, null);
    });
  }
});

test("health estrutural inválido precede falha TTS tipada", () => {
  const code = EXP0022_CAPTURE_FAILURE_CODES.bodyEmpty;
  const input = campaign({
    workerStatus: "capture-failure",
    failure: { code, message: "corpo vazio" },
    unit: (expected, index) => index === 0 ? {
      capture: {
        status: "failure",
        code,
        readCount: 4,
        emptyReadsBeforeSuccess: null,
        attempts: (() => {
          let completedAtMs = 10;
          return EXP0022_CONFIG.capture.delayBeforeReadMs.map(
            (delayBeforeMs, attemptIndex) => {
              const startedAtMs = completedAtMs + delayBeforeMs;
              completedAtMs = startedAtMs + 1;
              return {
                index: attemptIndex + 1,
                delayBeforeMs,
                requestId: `request-${expected.trialId}`,
                startedAtMs,
                completedAtMs,
                outcome: "empty"
              };
            }
          );
        })(),
        base64Encoded: null,
        byteLength: null,
        sha256: null,
        wavValid: false
      }
    } : {}
  });
  input.workerEnvelope.campaign.navigations[0]
    .healthBinding.audit.responseReceivedCount = 0;
  const analysis = analyzeExp0022Campaign(input);
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.gates.boundedFailClosedCapture, false);
  assert.equal(analysis.structural.bootstrapAuditHealthBindingValid, false);
  assert.equal(analysis.decision, EXP0022_DECISIONS.invalidate);
  assert.equal(report(input).claim, null);
});

test("validador recalcula campanha e rejeita interpretação rehasheada", () => {
  const canonical = structuredClone(report());
  canonical.claim = "qualificação pronta para produção";
  rehash(canonical);
  let validation = validateExp0022Report(canonical);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /estrutura|interpretação/iu);

  const evidenceTamper = structuredClone(report());
  evidenceTamper.campaign.workerEnvelope.campaign.navigations[0]
    .units[0].browser.sha256 = HASH_D;
  rehash(evidenceTamper);
  validation = validateExp0022Report(evidenceTamper);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /análise|campanha/iu);
});

test("reportSha256 cobre todo o core e report recusa bytes/base64", () => {
  const canonical = report();
  const core = structuredClone(canonical);
  delete core.reportSha256;
  assert.equal(
    canonical.reportSha256,
    `sha256:${canonicalSha256(core)}`
  );
  const withBody = campaign();
  withBody.workerEnvelope.campaign.navigations[0]
    .units[0].cdp.capture.body = "UklGRg==";
  assert.throws(
    () => report(withBody),
    /não pode incorporar bytes\/base64/iu
  );
});

test("relatório canônico também materializa crash como invalidação", () => {
  const input = campaign();
  input.workerEnvelope.status = "invalidated";
  input.workerEnvelope.campaign = null;
  input.workerEnvelope.failure = {
    code: "WORKER_TIMEOUT",
    message: "timeout"
  };
  const canonical = report(input);
  assert.equal(canonical.measurementStatus, "NOT_EVALUATED");
  assert.equal(canonical.decision, EXP0022_DECISIONS.invalidate);
  assert.equal(canonical.claim, null);
  assert.deepEqual(validateExp0022Report(canonical), {
    valid: true,
    errors: []
  });
});
