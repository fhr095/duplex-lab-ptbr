import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0021_ATTEMPT_PATH,
  EXP0021_AUDIT_KEYS,
  EXP0021_CAPTURE_FAILURE_CODES,
  EXP0021_CONFIG,
  EXP0021_DECISIONS,
  EXP0021_NEXT_MOVES,
  EXP0021_ORDER,
  EXP0021_PAYLOAD_A,
  EXP0021_PAYLOAD_B,
  EXP0021_PATHS,
  EXP0021_RECEIPT_PATH,
  EXP0021_WORKER_ENVELOPE_SCHEMA,
  analyzeExp0021Campaign,
  createExp0021Report,
  validateExp0021Report
} from "../src/eval/exp-0021-capture-qualification.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;

function health() {
  return {
    process: {
      runId: "runtime-exp0021",
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
    vadControl: { state: "ready", engine: "adaptive-energy-vad" },
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
    schemaVersion: "exp-0021-browser-negative-budget-v1",
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
    const delayBeforeMs = EXP0021_CONFIG.capture.delayBeforeReadMs[index];
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
    ? EXP0021_PAYLOAD_A
    : EXP0021_PAYLOAD_B;
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
      url: EXP0021_CONFIG.ttsUrl,
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
      url: EXP0021_CONFIG.ttsUrl,
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
    freezePath: EXP0021_PATHS.freeze,
    freezeCanonicalSha256: HASH_A,
    freezeFileSha256: HASH_B,
    freezeVerified: true,
    attemptPath: EXP0021_ATTEMPT_PATH,
    attemptCanonicalSha256: HASH_C,
    attemptFileSha256: HASH_D,
    attemptVerified: true,
    receiptPath: EXP0021_RECEIPT_PATH,
    receiptFileSha256: HASH_A,
    expectedRuntimeFingerprintSha256: HASH_C,
    receiptVerified: true,
    receiptWriteOnce: true,
    receiptBeforeNetwork: true,
    rerunAllowed: false
  };
}

function audits() {
  return Object.fromEntries(EXP0021_AUDIT_KEYS.map((key) => [key, true]));
}

function navigation(index, units) {
  const firstTrialId = index === 1 ? "A1" : "B2";
  return {
    index,
    targetUrl: EXP0021_CONFIG.targetUrl,
    browserHealth: {
      url: new URL("/api/health", EXP0021_CONFIG.targetUrl).href,
      status: 200,
      mimeType: "application/json",
      health: health()
    },
    units,
    audit: navigationAudit(firstTrialId),
    snapshot: snapshot(),
    networkRequests: [
      {
        requestId: `document-${index}`,
        url: EXP0021_CONFIG.targetUrl,
        method: "GET",
        type: "Document",
        timestamp: 1
      },
      {
        requestId: `health-${index}`,
        url: new URL("/api/health", EXP0021_CONFIG.targetUrl).href,
        method: "GET",
        type: "Fetch",
        timestamp: 2
      },
      ...units.map((candidate) => ({
        requestId: candidate.cdp.requestId,
        url: EXP0021_CONFIG.ttsUrl,
        method: "POST",
        type: "Fetch",
        timestamp: candidate.sequence + 1
      }))
    ],
    diagnostics: diagnostics()
  };
}

function campaign(options = {}) {
  const units = EXP0021_ORDER.map((expected, index) =>
    unit(expected, options.unit?.(expected, index) ?? {})
  );
  const envelope = {
    schemaVersion: EXP0021_WORKER_ENVELOPE_SCHEMA,
    status: options.workerStatus ?? "completed",
    startedAt: "2026-08-03T06:00:00.000Z",
    completedAt: "2026-08-03T06:01:00.000Z",
    campaign: {
      health: { before: health(), after: health() },
      browser: {
        product: "Chrome/150.0.0.0",
        protocolVersion: "1.3",
        userAgent: "fixture",
        cdpBinding: {
          endpoint: "http://172.20.0.1:9223/",
          hostPolicy: "wsl-default-gateway",
          initialTarget: "about:blank",
          targetId: "target-exp0021",
          webSocketPath: "/devtools/page/target-exp0021"
        }
      },
      navigations: [
        navigation(1, units.slice(0, 2)),
        navigation(2, units.slice(2, 4))
      ],
      diagnostics: diagnostics(),
      budget: structuredClone(EXP0021_CONFIG.negativeBudget)
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
  return createExp0021Report({
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
    EXP0021_ATTEMPT_PATH,
    "eval/commitments/exp-0021-capture-attempt-v0.1.json"
  );
  assert.equal(
    EXP0021_RECEIPT_PATH,
    "eval/generated/exp-0021/capture-attempt-consumed-v0.1.json"
  );
  assert.deepEqual(EXP0021_ORDER.map((entry) => entry.trialId), [
    "A1", "B1", "B2", "A2"
  ]);
  assert.deepEqual(EXP0021_PAYLOAD_A.postData, {
    text: EXP0021_PAYLOAD_A.text
  });
  assert.equal(EXP0021_PAYLOAD_A.rate, 1);
  assert.equal(EXP0021_PAYLOAD_B.rate, 1);
  assert.notEqual(EXP0021_PAYLOAD_A.text, EXP0021_PAYLOAD_B.text);
});

test("campanha completa passa 10/10 somente como qualification", () => {
  const analysis = analyzeExp0021Campaign(campaign());
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.decision, EXP0021_DECISIONS.pass);
  assert.deepEqual(
    analysis.nextMove,
    EXP0021_NEXT_MOVES[EXP0021_DECISIONS.pass]
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
  assert.match(canonical.claim, /qualifica/iu);
  assert.equal(canonical.authorityEligible, false);
  assert.deepEqual(canonical.nextMove, analysis.nextMove);
  assert.deepEqual(validateExp0021Report(canonical), {
    valid: true,
    errors: []
  });
});

test("recovery transitório só é observado em vazio seguido de sucesso", () => {
  const analysis = analyzeExp0021Campaign(campaign({
    unit: (_, index) => index === 2 ? { emptyReads: 1 } : {}
  }));
  assert.equal(analysis.decision, EXP0021_DECISIONS.pass);
  assert.equal(analysis.transientRecoveryObserved, true);
  assert.equal(analysis.metrics.transientRecoveries, 1);
  assert.equal(analysis.metrics.totalReads, 5);
});

test("A/B stale é FIX interpretável, não passe nem invalidação", () => {
  const analysis = analyzeExp0021Campaign(campaign({
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
  assert.equal(analysis.decision, EXP0021_DECISIONS.fix);
  assert.deepEqual(
    analysis.nextMove,
    EXP0021_NEXT_MOVES[EXP0021_DECISIONS.fix]
  );
});

test("digest browser/CDP divergente exige FIX", () => {
  const analysis = analyzeExp0021Campaign(campaign({
    unit: (_, index) => index === 1 ? { cdpSha: HASH_D } : {}
  }));
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.gates.browserCdpByteIdentity, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.fix);
});

test("status HTTP tipado permanece FIX mesmo registrado em diagnostics", () => {
  const code = EXP0021_CAPTURE_FAILURE_CODES.statusInvalid;
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
    url: EXP0021_CONFIG.ttsUrl,
    status: 503
  };
  input.workerEnvelope.campaign.navigations[0]
    .diagnostics.httpErrors.push(structuredClone(error));
  input.workerEnvelope.campaign.diagnostics.httpErrors.push(error);
  const analysis = analyzeExp0021Campaign(input);
  assert.equal(analysis.structural.diagnosticsValid, true);
  assert.equal(analysis.structural.attemptBindingsValid, true);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.gates.cdpChainAndResponse, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.fix);
});

test("quatro vazios tipados preservam instrumento e retornam FIX", () => {
  const code = EXP0021_CAPTURE_FAILURE_CODES.bodyEmpty;
  const failedRequestId = "request-A1";
  const failedCapture = {
    status: "failure",
    code,
    readCount: 4,
    emptyReadsBeforeSuccess: null,
    attempts: (() => {
      let completedAtMs = 10;
      return EXP0021_CONFIG.capture.delayBeforeReadMs.map(
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
  const analysis = analyzeExp0021Campaign(input);
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.structural.attemptBindingsValid, true);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.gates.boundedFailClosedCapture, false);
  assert.equal(analysis.gates.firstResponsePerNavigation, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.fix);
  assert.equal(analysis.transientRecoveryObserved, false);
});

test("overflow detectado após leitura continua sendo FIX tipado", () => {
  const code = EXP0021_CAPTURE_FAILURE_CODES.resourceBufferExceeded;
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
  const analysis = analyzeExp0021Campaign(input);
  assert.equal(analysis.structural.attemptBindingsValid, true);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.decision, EXP0021_DECISIONS.fix);
});

test("crash ou envelope sem protocolo invalida e não interpreta captura", () => {
  const input = campaign();
  input.workerEnvelope.status = "crash";
  input.workerEnvelope.failure = {
    code: "WORKER_EXIT_WITHOUT_ENVELOPE",
    message: "exit 1"
  };
  const analysis = analyzeExp0021Campaign(input);
  assert.equal(analysis.measurementStatus, "NOT_EVALUATED");
  assert.equal(analysis.gates.boundaryAndSupervisor, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);
  assert.deepEqual(
    analysis.nextMove,
    EXP0021_NEXT_MOVES[EXP0021_DECISIONS.invalidate]
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
  const analysis = analyzeExp0021Campaign({});
  assert.equal(analysis.measurementStatus, "NOT_EVALUATED");
  assert.equal(analysis.metrics.unitCount, 0);
  assert.equal(analysis.metrics.successfulCaptures, 0);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);
  assert.equal(Object.values(analysis.gates).includes(true), false);
  assert.equal(analysis.gates.browserCdpByteIdentity, null);
});

test("requestId stale e budget divergente têm precedência INVALIDATE", () => {
  const stale = campaign({
    unit: (_, index) => index === 3
      ? { observedRequestIds: ["request-A1"] }
      : {}
  });
  let analysis = analyzeExp0021Campaign(stale);
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.equal(analysis.structural.requestBindingsValid, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);

  const overBudget = campaign();
  overBudget.workerEnvelope.campaign.budget.gpuRuns = 1;
  analysis = analyzeExp0021Campaign(overBudget);
  assert.equal(analysis.gates.negativeBudgetExact, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);
});

test("health visto pelo browser e autoridade CDP ligam o runtime medido", () => {
  const wrongBrowserRuntime = campaign();
  wrongBrowserRuntime.workerEnvelope.campaign.navigations[1]
    .browserHealth.health.process.runId = "runtime-alheio";
  let analysis = analyzeExp0021Campaign(wrongBrowserRuntime);
  assert.equal(analysis.gates.environmentStable, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);

  const staleCommittedRuntime = campaign();
  staleCommittedRuntime.boundary.expectedRuntimeFingerprintSha256 = HASH_D;
  analysis = analyzeExp0021Campaign(staleCommittedRuntime);
  assert.equal(analysis.gates.environmentStable, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);

  const remoteCdp = campaign();
  remoteCdp.workerEnvelope.campaign.browser.cdpBinding.endpoint =
    "https://example.com:9223/";
  analysis = analyzeExp0021Campaign(remoteCdp);
  assert.equal(analysis.gates.environmentStable, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);

  const missingBrowserHealthRequest = campaign();
  missingBrowserHealthRequest.workerEnvelope.campaign.navigations[0]
    .networkRequests = missingBrowserHealthRequest.workerEnvelope.campaign
      .navigations[0].networkRequests.filter((request) =>
        request.requestId !== "health-1");
  analysis = analyzeExp0021Campaign(missingBrowserHealthRequest);
  assert.equal(analysis.structural.navigationAuditValid, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);
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
  let analysis = analyzeExp0021Campaign(reused);
  assert.equal(analysis.structural.requestBindingsValid, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);

  const fakeDelay = campaign({
    unit: (_, index) => index === 0 ? { emptyReads: 1 } : {}
  });
  const attempts = fakeDelay.workerEnvelope.campaign.navigations[0]
    .units[0].cdp.capture.attempts;
  attempts[1].startedAtMs = attempts[0].completedAtMs + 7;
  attempts[1].completedAtMs = attempts[1].startedAtMs + 1;
  analysis = analyzeExp0021Campaign(fakeDelay);
  assert.equal(analysis.structural.attemptBindingsValid, false);
  assert.equal(analysis.decision, EXP0021_DECISIONS.invalidate);
});

test("validador recalcula campanha e rejeita interpretação rehasheada", () => {
  const canonical = structuredClone(report());
  canonical.claim = "qualificação pronta para produção";
  rehash(canonical);
  let validation = validateExp0021Report(canonical);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /estrutura|interpretação/iu);

  const evidenceTamper = structuredClone(report());
  evidenceTamper.campaign.workerEnvelope.campaign.navigations[0]
    .units[0].browser.sha256 = HASH_D;
  rehash(evidenceTamper);
  validation = validateExp0021Report(evidenceTamper);
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
  assert.equal(canonical.decision, EXP0021_DECISIONS.invalidate);
  assert.equal(canonical.claim, null);
  assert.deepEqual(validateExp0021Report(canonical), {
    valid: true,
    errors: []
  });
});
