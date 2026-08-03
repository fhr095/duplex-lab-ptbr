import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXP0020_BOUNDARY_PATHS,
  EXP0020_BROWSER_COMMAND
} from "../src/eval/exp-0020-boundary.mjs";
import { EXP0020_CONFIG, createExp0020Report } from
  "../src/eval/exp-0020-stop-order.mjs";
import {
  consumeExp0020Attempt,
  createExp0020AttemptReceipt,
  parseExp0020BrowserArgs,
  projectExp0020HarnessCampaign,
  validateExp0020AttemptReceipt,
  validateExp0020HealthPreflight,
  validateExp0020RecordedBinding
} from "../scripts/smoke-exp-0020-browser.mjs";
import { TrainingTraceRecorder } from
  "../web/training-trace-recorder.mjs";

const HEX_A = "a".repeat(64);
const HASH_A = `sha256:${HEX_A}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function boundary(projectRoot) {
  return {
    projectRoot,
    attemptCommit: "d".repeat(40),
    attemptRecord: {
      path: EXP0020_BOUNDARY_PATHS.attempt,
      fileSha256: HASH_A,
      canonicalSha256: HASH_B
    },
    freezeRecord: {
      path: EXP0020_BOUNDARY_PATHS.freeze,
      fileSha256: HASH_B,
      canonicalSha256: HASH_C
    },
    attempt: {
      campaign: {
        nonce: "exp-0020-official-v0.1",
        command: EXP0020_BROWSER_COMMAND,
        targetUrl: EXP0020_CONFIG.targetUrl,
        reportPath: EXP0020_BOUNDARY_PATHS.report
      }
    }
  };
}

function health(fingerprint = HEX_A) {
  return {
    process: {
      runId: "run-fixture",
      runtimeFingerprint: { sha256: fingerprint }
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
      voice: "Maria",
      culture: "pt-BR"
    }
  };
}

function trainingTrace(turnId, renderMarkerAtMs) {
  const recorder = new TrainingTraceRecorder({
    sessionId: `session-${turnId}`,
    startedAtEpochMs: 1,
    locale: "pt-BR",
    candidate: "exp-0020-runner-fixture",
    configHash: HASH_C
  });
  const decision = recorder.recordDecision({
    atMs: 323,
    turnId,
    epoch: 1,
    event: {
      type: "output-interruption.pause_requested",
      source: "local-audio-reflex",
      payload: {}
    },
    context: { state: { assistantSpeaking: true } },
    policy: {
      id: "output-interruption-lifecycle",
      version: "output-interruption-lifecycle-v0.1",
      mode: "authority"
    },
    transition: {
      previousStateVersion: 0,
      stateVersion: 1,
      previousPhase: "idle",
      phase: "held",
      reason: "output-held"
    },
    intents: [{
      type: "PAUSE_OUTPUT",
      origin: "output-interruption-lifecycle"
    }]
  });
  const effectId = decision.effects[0].effectId;
  for (const entry of [
    ["dispatched", 323.1, { command: "HTMLMediaElement.pause" }],
    ["player-received", 323.2, { audioPresent: true, paused: true }],
    ["renderer-silent", renderMarkerAtMs - 0.2, {
      kind: "browser-render-stop",
      latencyMs: 42,
      mapping: "audio-context-output-timestamp"
    }],
    ["completed", renderMarkerAtMs - 0.1, {
      observation: "browser-render-stop"
    }]
  ]) {
    recorder.recordEffectStage(effectId, {
      stage: entry[0],
      atMs: entry[1],
      evidence: entry[2]
    });
  }
  return recorder.snapshot;
}

function harnessTrial(navigationIndex, trialIndex, flatIndex) {
  const turnId = `exp0020-nav-${navigationIndex}-trial-${trialIndex}`;
  const renderMarkerAtMs = 371;
  const pauseMarkerAtMs = flatIndex % 2 === 0
    ? 330
    : renderMarkerAtMs + 2;
  const latestMarkerAtMs = Math.max(renderMarkerAtMs, pauseMarkerAtMs);
  const finalObservedAtMs = latestMarkerAtMs + 250;
  const renderStop = {
    kind: "browser-render-stop",
    triggerAtMs: 323,
    lastRenderedAtMs: 365,
    observedAtMs: 370,
    latencyMs: 42,
    renderedThroughTrigger: true,
    mapping: "audio-context-output-timestamp",
    requiredSilenceQuanta: 2,
    threshold: 0.0003,
    scope: "último quantum não silencioso no grafo Web Audio"
  };
  const pause = {
    atMs: pauseMarkerAtMs,
    type: "assistant.speech.paused",
    detail: "fixture"
  };
  const stopped = {
    atMs: renderMarkerAtMs,
    type: "assistant.render.stopped",
    detail: "fixture"
  };
  const markers = flatIndex % 2 === 0
    ? [pause, stopped]
    : [stopped, pause];
  const trace = [
    { atMs: 1, type: "assistant.render.active", detail: "fixture" },
    {
      atMs: 323,
      type: "output-interruption.transition",
      detail: JSON.stringify({
        eventType: "PAUSE_REQUESTED",
        event: { type: "PAUSE_REQUESTED", turnId },
        previousPhase: "idle",
        phase: "held",
        reason: "output-held",
        turnId,
        pauseKind: "audible",
        intents: [{
          type: "PAUSE_OUTPUT",
          origin: "output-interruption-lifecycle"
        }]
      })
    },
    ...markers
  ];
  return {
    navigationIndex,
    trialIndex,
    turnId,
    tts: {
      wavSha256: HASH_B,
      sha256: HASH_B,
      byteLength: 4_096,
      rate: 1,
      requestBody: { text: EXP0020_CONFIG.phrase, rate: 1 },
      url: "http://localhost:4173/api/tts",
      method: "POST",
      status: 200,
      mimeType: "audio/wav",
      bodyBase64: "UklGRlNFQ1JFVFdBVkU=",
      bytes: Buffer.from("RIFF-SECRET-WAVE")
    },
    timing: {
      renderActiveAtMs: 1,
      plannedTriggerAtMs: 321,
      actualTriggerAtMs: 323,
      timerErrorMs: 2,
      latestStopMarkerAtMs: latestMarkerAtMs,
      postStopObservedAtMs: finalObservedAtMs,
      postLatestMarkerHorizonMs: 250
    },
    startSnapshot: {
      state: { assistantSpeaking: true },
      trace: [{ atMs: 1, type: "assistant.render.active" }]
    },
    renderStopAtMarkers: renderStop,
    finalSnapshot: {
      observedAtMs: finalObservedAtMs,
      state: {
        assistantSpeaking: false,
        potentialBargeIn: "pending"
      },
      audio: {
        outputInterruptionLifecycle: {
          schemaVersion: 1,
          lifecycleVersion: "output-interruption-lifecycle-v0.1",
          phase: "held",
          turnId,
          pauseKind: "audible",
          resumeAttempt: 0
        },
        renderProbe: {
          state: "ready",
          pendingMeasurements: 0,
          requiredSilenceQuanta: 2,
          threshold: 0.0003,
          scope: "último quantum não silencioso no grafo Web Audio"
        },
        lastRenderStop: renderStop
      },
      trainingTrace: trainingTrace(turnId, renderMarkerAtMs),
      trace
    },
    collectionValidation: { valid: true, errors: [] }
  };
}

function harness() {
  let flatIndex = 0;
  return {
    targetUrl: EXP0020_CONFIG.targetUrl,
    runtimeFingerprintSha256: HASH_A,
    browser: { product: "Chrome/150.0.0.0" },
    navigations: Array.from({ length: 2 }, (_, navigationOffset) => {
      const navigationIndex = navigationOffset + 1;
      return {
        navigationIndex,
        targetUrl: EXP0020_CONFIG.targetUrl,
        browser: { product: "Chrome/150.0.0.0" },
        networkRequests: [
          { url: EXP0020_CONFIG.targetUrl },
          { url: "http://localhost:4173/api/tts" }
        ],
        trials: Array.from({ length: 6 }, (_, trialOffset) =>
          harnessTrial(navigationIndex, trialOffset + 1, flatIndex++)
        ),
        diagnostics: {
          consoleErrors: [],
          runtimeErrors: [],
          httpErrors: [],
          networkViolations: [],
          ttsCaptureErrors: []
        }
      };
    })
  };
}

test("CLI recusa qualquer ampliação de campanha ou CDP em modo check", () => {
  assert.deepEqual(parseExp0020BrowserArgs([]), {
    check: false,
    cdpUrl: null
  });
  assert.deepEqual(parseExp0020BrowserArgs([
    "--cdp-url",
    "http://172.20.0.1:9223"
  ]), {
    check: false,
    cdpUrl: "http://172.20.0.1:9223"
  });
  assert.deepEqual(parseExp0020BrowserArgs(["--check"]), {
    check: true,
    cdpUrl: null
  });
  assert.throws(
    () => parseExp0020BrowserArgs(["--repetitions", "24"]),
    /argumento desconhecido/iu
  );
  assert.throws(
    () => parseExp0020BrowserArgs([
      "--check",
      "--cdp-url",
      "http://172.20.0.1:9223"
    ]),
    /não aceita CDP/iu
  );
});

test("preflight recusa cérebro externo, ASR ativo e TTS indisponível", () => {
  assert.deepEqual(validateExp0020HealthPreflight(health()), {
    valid: true,
    errors: []
  });
  for (const mutate of [
    (value) => { value.brain = "openai"; },
    (value) => { value.asr.state = "ready"; },
    (value) => { value.tts.state = "disabled"; },
    (value) => { value.tts.culture = ""; },
    (value) => { value.usage.totalTokens = Number.NaN; }
  ]) {
    const candidate = health();
    mutate(candidate);
    assert.equal(validateExp0020HealthPreflight(candidate).valid, false);
  }
});

test("recibo canônico é ligado à abertura e consumo usa criação exclusiva", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "exp0020-receipt-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const currentBoundary = boundary(projectRoot);
  const receipt = createExp0020AttemptReceipt({
    boundary: currentBoundary,
    startedAt: "2026-08-03T06:00:00.000Z",
    processId: 123
  });
  assert.equal(
    validateExp0020AttemptReceipt(receipt, currentBoundary),
    true
  );
  const tampered = structuredClone(receipt);
  tampered.command = "node outro-runner.mjs";
  assert.equal(
    validateExp0020AttemptReceipt(tampered, currentBoundary),
    false
  );

  const consumed = await consumeExp0020Attempt(currentBoundary, {
    startedAt: "2026-08-03T06:00:00.000Z",
    processId: 123
  });
  const persisted = JSON.parse((await readFile(join(
    projectRoot,
    EXP0020_BOUNDARY_PATHS.receipt
  ))).toString("utf8"));
  assert.deepEqual(persisted, consumed.receipt);
  await assert.rejects(
    () => consumeExp0020Attempt(currentBoundary, {
      startedAt: "2026-08-03T06:01:00.000Z",
      processId: 124
    }),
    /EEXIST/iu
  );
});

test("projeção liga fingerprint hex real e remove bytes WAV do relatório", () => {
  const inputHarness = harness();
  const campaign = projectExp0020HarnessCampaign({
    boundary: boundary("/tmp/unused"),
    receipt: { fileSha256: HASH_C },
    healthBefore: health(),
    healthAfter: health(),
    harness: inputHarness
  });
  assert.equal(
    campaign.navigations[0].runtimeFingerprintSha256,
    HASH_A
  );
  assert.deepEqual(campaign.navigations[0].trials[0].tts, {
    wavSha256: HASH_B,
    byteLength: 4_096,
    rate: 1,
    requestText: EXP0020_CONFIG.phrase,
    requestUrl: "http://localhost:4173/api/tts",
    method: "POST",
    status: 200,
    mimeType: "audio/wav"
  });
  assert.deepEqual(
    campaign.navigations[0].trials[0].renderStopAtMarkers,
    inputHarness.navigations[0].trials[0].renderStopAtMarkers
  );
  const serialized = JSON.stringify(campaign);
  assert.doesNotMatch(serialized, /bodyBase64|bytes|SECRET/iu);
  assert.doesNotMatch(serialized, /collectionValidation/u);
});

test("binding registrado rejeita report ou receipt forjado e rehasheado", () => {
  const currentBoundary = boundary("/tmp/unused");
  const receipt = createExp0020AttemptReceipt({
    boundary: currentBoundary,
    startedAt: "2026-08-03T06:00:00.000Z",
    processId: 123
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const campaign = projectExp0020HarnessCampaign({
    boundary: currentBoundary,
    receipt: { fileSha256: sha256(receiptBytes) },
    healthBefore: health(),
    healthAfter: health(),
    harness: harness()
  });
  const report = createExp0020Report({
    startedAt: receipt.startedAt,
    completedAt: "2026-08-03T06:01:00.000Z",
    campaign
  });
  assert.deepEqual(validateExp0020RecordedBinding({
    boundary: currentBoundary,
    report,
    receipt,
    receiptBytes
  }), { valid: true, errors: [] });

  const forgedCampaign = structuredClone(campaign);
  forgedCampaign.boundary.attemptFileSha256 = HASH_C;
  const forgedReport = createExp0020Report({
    startedAt: receipt.startedAt,
    completedAt: "2026-08-03T06:01:00.000Z",
    campaign: forgedCampaign
  });
  assert.equal(validateExp0020RecordedBinding({
    boundary: currentBoundary,
    report: forgedReport,
    receipt,
    receiptBytes
  }).valid, false);

  const forgedReceipt = structuredClone(receipt);
  forgedReceipt.command = "node runner-forjado.mjs";
  const forgedReceiptBytes = Buffer.from(
    `${JSON.stringify(forgedReceipt, null, 2)}\n`
  );
  assert.equal(validateExp0020RecordedBinding({
    boundary: currentBoundary,
    report,
    receipt: forgedReceipt,
    receiptBytes: forgedReceiptBytes
  }).valid, false);
});

test("projeção falha fechada para drift de fingerprint ou hash WAV", () => {
  const common = {
    boundary: boundary("/tmp/unused"),
    receipt: { fileSha256: HASH_C },
    healthBefore: health(),
    healthAfter: health(),
    harness: harness()
  };
  const drifted = structuredClone(common);
  drifted.healthAfter.process.runtimeFingerprint.sha256 = "e".repeat(64);
  assert.throws(
    () => projectExp0020HarnessCampaign(drifted),
    /fingerprint mudou/iu
  );

  const mismatchedWav = structuredClone(common);
  mismatchedWav.harness.navigations[0].trials[0].tts.sha256 = HASH_C;
  assert.throws(
    () => projectExp0020HarnessCampaign(mismatchedWav),
    /hash CDP íntegro/iu
  );
});
