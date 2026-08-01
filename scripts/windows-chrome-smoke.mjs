import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { encodePcm16Wave } from "../src/audio/wav.mjs";
import { scoreTranscript } from "../src/eval/transcript-metrics.mjs";
import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  withinWindowCoverage
} from "../src/eval/window-coverage.mjs";
import {
  OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
  createOutputInterruptionState,
  reduceOutputInterruption
} from "../web/output-interruption-lifecycle.mjs";

const TARGET_URL =
  process.env.DUPLEX_URL ?? "http://localhost:4173/?automation=1";
const RUN_NONCE = process.env.BROWSER_RUN_NONCE?.trim() || null;
const REPORT_PATH = resolve(
  import.meta.dirname,
  "..",
  process.env.BROWSER_REPORT ?? "eval/reports/browser-latest.json"
);
const CDP_COMMAND_TIMEOUT_MS = 10_000;
const RESPONSE_START_LIMIT_MS = 2_500;
const STOP_COMMAND_LIMIT_MS = 100;
const RENDER_STOP_LIMIT_MS = 250;
const PCM_ONSET_TO_RENDER_STOP_LIMIT_MS = 350;
const PCM_ONSET_RMS = 0.025;
const VAD_INFERENCE_P95_LIMIT_MS = 5;
const VAD_INFERENCE_P99_LIMIT_MS = 20;
const FALSE_ACTIVATION_PROBE_MS = Math.max(
  5_000,
  Number.parseInt(
    process.env.FALSE_ACTIVATION_PROBE_MS ?? "30000",
    10
  )
);
const FALSE_ACTIVATION_PREFLIGHT_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(
    process.env.FALSE_ACTIVATION_PREFLIGHT_TIMEOUT_MS ?? "60000",
    10
  )
);
const REQUIRE_VAD_SHADOW =
  process.env.REQUIRE_VAD_SHADOW === "1";
const RUN_ACOUSTIC_REFLEX_SHADOW_PROBE =
  process.env.ACOUSTIC_REFLEX_SHADOW_PROBE === "1";
const ALLOW_FAILED_GATES =
  process.env.ALLOW_FAILED_GATES === "1";
const CRITICAL_CONFIRMATION_REPETITIONS = Math.max(
  1,
  Number.parseInt(
    process.env.CRITICAL_CONFIRMATION_REPETITIONS ?? "1",
    10
  )
);
const REQUIRED_VAD_CONTROL =
  process.env.REQUIRE_VAD_CONTROL?.trim() || null;
const REQUIRED_SILERO_THRESHOLD = Number.parseFloat(
  process.env.REQUIRE_SILERO_THRESHOLD ?? "0.85"
);
const REQUIRED_SILERO_ONSET_WINDOWS = Number.parseInt(
  process.env.REQUIRE_SILERO_ONSET_WINDOWS ?? "1",
  10
);
if (
  REQUIRED_VAD_CONTROL !== null &&
  (
    !Number.isFinite(REQUIRED_SILERO_THRESHOLD) ||
    !Number.isSafeInteger(REQUIRED_SILERO_ONSET_WINDOWS) ||
    REQUIRED_SILERO_ONSET_WINDOWS < 1
  )
) {
  throw new TypeError("política Silero esperada é inválida");
}
const SILERO_VAD_MODEL_SHA256 =
  "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";
const TARGET_ORIGIN = new URL(TARGET_URL).origin;
const SOURCE_FINGERPRINT = await createSourceFingerprint(
  resolve(import.meta.dirname, "..")
);
const AUDIO_EXPECTED = "Espera, eu quis dizer outra coisa.";
const LONG_CORRECTION_EXPECTED =
  "Marque para sexta. Não, na verdade, para domingo.";
const FALSE_ACTIVATION_TEXT = [
  "Estou mantendo uma fala contínua para verificar se a própria voz do sistema atravessa o cancelamento de eco e causa uma interrupção indevida.",
  "Enquanto esta mensagem é reproduzida, o microfone permanece aberto, os frames continuam chegando e nenhum evento de fala do usuário deveria surgir.",
  "A observação precisa durar o bastante para incluir mudanças de volume, pausas naturais, consoantes fortes e várias frases completas.",
  "Se o detector confundir esta saída com uma nova pessoa falando, o player vai parar e o teste registrará a falsa ativação imediatamente.",
  "Continuo falando por alguns instantes para transformar um teste curto e confortável em uma sessão acústica de desenvolvimento mais exigente."
].join(" ");
const audioFixtureWave = await readFile(resolve(
  import.meta.dirname,
  "../eval/generated/asr/audio/interrupcao--rate-1.wav"
));
const audioFixture = decodeWaveToPcm16(audioFixtureWave);
const audioBase64 = audioFixture.pcm.toString("base64");
let acousticReflexMarginalFixture = null;
if (RUN_ACOUSTIC_REFLEX_SHADOW_PROBE) {
  const dataset = JSON.parse(await readFile(resolve(
    import.meta.dirname,
    "../eval/datasets/exp-0014-acoustic-reflex-v0.1.json"
  )));
  const stream = dataset.streams.find(
    (candidate) =>
      candidate.family === "interrupcao" &&
      candidate.rate === 1 &&
      candidate.variant === "marginal"
  );
  if (!stream) {
    throw new Error("fixture marginal EXP-0014 não encontrada");
  }
  const decodedPcmSha256 = createHash("sha256")
    .update(audioFixture.pcm)
    .digest("hex");
  if (stream.source.decodedPcmSha256 !== decodedPcmSha256) {
    throw new Error("PCM marginal EXP-0014 diverge do dataset");
  }
  const cutSample = stream.recipe.cutSample;
  acousticReflexMarginalFixture = {
    base64: audioFixture.pcm.subarray(0, cutSample * 2).toString("base64"),
    mediaRef: stream.mediaRef,
    sampleCount: stream.sampleCount,
    silenceMs:
      stream.recipe.tailSilenceSamples / 16_000 * 1_000,
    streamId: `browser-${stream.streamId}`,
    streamSha256: `sha256:${stream.sha256}`
  };
}
const longCorrectionFixtureWave = await readFile(resolve(
  import.meta.dirname,
  "../eval/generated/asr/audio/correcao--rate-1.wav"
));
const longCorrectionFixture = decodeWaveToPcm16(
  longCorrectionFixtureWave
);
const longCorrectionBase64 =
  longCorrectionFixture.pcm.toString("base64");

async function synthesizePcmFixture(text) {
  const response = await fetch(`${TARGET_ORIGIN}/api/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(
      `TTS de fixture retornou HTTP ${response.status}.`
    );
  }
  return decodeWaveToPcm16(
    Buffer.from(await response.arrayBuffer())
  );
}

const backchannelFixture = await synthesizePcmFixture("Aham.");
const backchannelBase64 =
  backchannelFixture.pcm.toString("base64");

function findPcmOnsetMs(
  pcm,
  sampleRate,
  options = {}
) {
  const frameMs = options.frameMs ?? 20;
  const threshold = options.threshold ?? PCM_ONSET_RMS;
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength / 2
  );
  const frameSamples = Math.round(sampleRate * frameMs / 1_000);

  for (
    let sampleStart = 0;
    sampleStart < samples.length;
    sampleStart += frameSamples
  ) {
    const sampleEnd = Math.min(
      samples.length,
      sampleStart + frameSamples
    );
    let energy = 0;
    for (let index = sampleStart; index < sampleEnd; index += 1) {
      const normalized = samples[index] / 32_768;
      energy += normalized * normalized;
    }
    const rms = Math.sqrt(energy / (sampleEnd - sampleStart));
    if (rms >= threshold) {
      return sampleStart / sampleRate * 1_000;
    }
  }
  throw new Error("Fixture de barge-in não contém onset de fala.");
}

const audioSpeechOnsetMs = findPcmOnsetMs(
  audioFixture.pcm,
  audioFixture.sampleRate
);

function discoverCdpUrl() {
  if (process.env.CDP_URL) {
    return process.env.CDP_URL;
  }

  const route = execFileSync("ip", ["route", "show", "default"], {
    encoding: "utf8"
  });
  const gateway = /\bvia\s+([0-9.]+)/u.exec(route)?.[1];
  if (!gateway) {
    throw new Error("Não foi possível descobrir o gateway do Windows.");
  }
  return `http://${gateway}:9223`;
}

const cdpUrl = discoverCdpUrl();
const pagesResponse = await fetch(`${cdpUrl}/json/list`, {
  signal: AbortSignal.timeout(CDP_COMMAND_TIMEOUT_MS)
});
if (!pagesResponse.ok) {
  throw new Error(`CDP retornou HTTP ${pagesResponse.status}.`);
}

const pages = await pagesResponse.json();
let createdPage = false;
let page = pages.find(
  (candidate) =>
    candidate.type === "page" &&
    new URL(candidate.url).origin === new URL(TARGET_URL).origin
);
if (!page) {
  const createResponse = await fetch(
    `${cdpUrl}/json/new?${encodeURIComponent(TARGET_URL)}`,
    {
      method: "PUT",
      signal: AbortSignal.timeout(CDP_COMMAND_TIMEOUT_MS)
    }
  );
  if (!createResponse.ok) {
    throw new Error(
      `Não foi possível criar uma aba para ${TARGET_URL}: ` +
        `HTTP ${createResponse.status}.`
    );
  }
  page = await createResponse.json();
  createdPage = true;
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
const consoleErrors = [];
const runtimeErrors = [];
const httpErrors = [];
const permissionErrors = [];
let nextId = 0;
let originalMicrophonePermission = null;
let permissionOverridden = false;

await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Timeout ao conectar ao WebSocket CDP.")),
    CDP_COMMAND_TIMEOUT_MS
  );
  socket.addEventListener(
    "open",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true }
  );
  socket.addEventListener(
    "error",
    (error) => {
      clearTimeout(timer);
      reject(error);
    },
    { once: true }
  );
});

socket.addEventListener("message", (message) => {
  const payload = JSON.parse(message.data);
  if (payload.id && pending.has(payload.id)) {
    const operation = pending.get(payload.id);
    pending.delete(payload.id);
    clearTimeout(operation.timer);
    if (payload.error) {
      operation.reject(new Error(payload.error.message));
    } else {
      operation.resolve(payload.result);
    }
    return;
  }

  if (
    payload.method === "Runtime.consoleAPICalled" &&
    payload.params.type === "error"
  ) {
    consoleErrors.push(
      payload.params.args
        .map((argument) => argument.value ?? argument.description ?? "")
        .join(" ")
        .slice(0, 500)
    );
  }

  if (payload.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(
      (
        payload.params.exceptionDetails.exception?.description ??
        payload.params.exceptionDetails.text
      ).slice(0, 500)
    );
  }

  if (
    payload.method === "Network.responseReceived" &&
    payload.params.response.status >= 400
  ) {
    httpErrors.push({
      status: payload.params.response.status,
      url: payload.params.response.url
    });
  }
});

function send(method, params = {}) {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          `CDP não respondeu a ${method} em ${CDP_COMMAND_TIMEOUT_MS} ms.`
        )
      );
    }, CDP_COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text
    );
  }
  return result.result.value;
}

async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condição não satisfeita em ${timeoutMs} ms.`);
}

async function waitForStable(
  check,
  stableMs,
  timeoutMs = 10_000
) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= stableMs) {
        return value;
      }
    } else {
      stableSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Condição não permaneceu estável por ${stableMs} ms ` +
      `dentro de ${timeoutMs} ms.`
  );
}

function assessStatefulCriticalConfirmation({ pending, accepted }) {
  const transitions = accepted.trace
    .filter((event) => event.type === "interaction.transition")
    .map((event) => JSON.parse(event.detail));
  const rollbacks = accepted.trace.filter(
    (event) => event.type === "state.rollback"
  );
  return (
    pending.semantic.authority === "backend-interaction-runtime" &&
    pending.semantic.kernelStateVersion === 1 &&
    pending.semantic.state === null &&
    pending.semantic.revisions.length === 0 &&
    pending.semantic.pendingConfirmation?.policy ===
      "repeat-critical-value-before-commit" &&
    !/\d/u.test(pending.text.assistant) &&
    accepted.semantic.authority === "backend-interaction-runtime" &&
    accepted.semantic.kernelStateVersion === 2 &&
    accepted.semantic.pendingConfirmation === null &&
    accepted.semantic.state?.value === "BRL 1150" &&
    accepted.semantic.revisions.length === 1 &&
    accepted.semantic.revisions[0].current === "BRL 1150" &&
    rollbacks.length === 1 &&
    transitions.length === 2 &&
    transitions.every(
      (transition) =>
        transition.authority === "backend-interaction-runtime" &&
        transition.kernelVersion === "interaction-kernel-v0.1"
    ) &&
    /1150/u.test(accepted.text.assistant)
  );
}

function replayOutputInterruptionLifecycle(label, snapshot) {
  const observed = snapshot.trace
    .filter(
      (event) => event.type === "output-interruption.transition"
    )
    .map((event) => {
      try {
        return { atMs: event.atMs, detail: JSON.parse(event.detail) };
      } catch (error) {
        return { atMs: event.atMs, parseError: error.message };
      }
    });
  const errors = [];
  const steps = [];
  if (observed.length === 0) {
    errors.push("nenhuma transição observada");
    return {
      label,
      ok: false,
      errors,
      steps,
      terminalPhase: null
    };
  }
  if (observed[0].parseError) {
    errors.push(`JSON inválido em ${observed[0].atMs} ms`);
    return {
      label,
      ok: false,
      errors,
      steps,
      terminalPhase: null
    };
  }

  const first = observed[0].detail;
  let state = {
    ...createOutputInterruptionState(),
    version: first.previousStateVersion
  };
  if (first.previousPhase !== "idle") {
    errors.push(
      `trace não autocontido: inicia em ${first.previousPhase}`
    );
  }

  for (const item of observed) {
    if (item.parseError) {
      errors.push(`JSON inválido em ${item.atMs} ms`);
      continue;
    }
    const detail = item.detail;
    let replayed;
    try {
      replayed = reduceOutputInterruption(state, detail.event);
    } catch (error) {
      errors.push(
        `${detail.eventType ?? "evento"}: ${error.message}`
      );
      continue;
    }
    const expectedProjection = {
      lifecycleVersion: replayed.lifecycleVersion,
      previousStateVersion: replayed.previousStateVersion,
      stateVersion: replayed.state.version,
      eventType: replayed.eventType,
      previousPhase: state.phase,
      phase: replayed.state.phase,
      reason: replayed.reason,
      turnId: replayed.state.turnId,
      outputEpoch: replayed.state.outputEpoch,
      pauseKind: replayed.state.pauseKind,
      resumeAttempt: replayed.state.resumeAttempt,
      intents: replayed.intents
    };
    const observedProjection = {
      lifecycleVersion: detail.lifecycleVersion,
      previousStateVersion: detail.previousStateVersion,
      stateVersion: detail.stateVersion,
      eventType: detail.eventType,
      previousPhase: detail.previousPhase,
      phase: detail.phase,
      reason: detail.reason,
      turnId: detail.turnId,
      outputEpoch: detail.outputEpoch,
      pauseKind: detail.pauseKind,
      resumeAttempt: detail.resumeAttempt,
      intents: detail.intents
    };
    const equivalent = isDeepStrictEqual(
      observedProjection,
      expectedProjection
    );
    if (!equivalent) {
      errors.push(
        `${detail.eventType}: efeito observado diverge do replay`
      );
    }
    steps.push({
      atMs: item.atMs,
      eventType: detail.eventType,
      previousPhase: detail.previousPhase,
      phase: detail.phase,
      stateVersion: detail.stateVersion,
      intents: detail.intents.map((intent) => intent.type),
      equivalent
    });
    state = replayed.state;
  }

  return {
    label,
    ok: errors.length === 0,
    errors,
    steps,
    terminalPhase: state.phase
  };
}

try {
  await Promise.all([
    send("Runtime.enable"),
    send("Page.enable"),
    send("Network.enable")
  ]);
  await send("Page.bringToFront");
  await send("Page.navigate", { url: TARGET_URL });
  await waitFor(() =>
    evaluate(
      `document.readyState === "complete" &&
       document.querySelector("#brainLabel")?.textContent !== "verificando…" &&
       Boolean(window.__duplexLab)`
    )
  );

  consoleErrors.length = 0;
  runtimeErrors.length = 0;
  httpErrors.length = 0;

  const pageState = await evaluate(`({
    title: document.title,
    url: location.href,
    brain: document.querySelector("#brainLabel")?.textContent,
    input: document.querySelector("#inputLabel")?.textContent,
    automation: Boolean(window.__duplexLab),
    recognition: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    secureContext: window.isSecureContext,
    localAudioReflex: window.__duplexLab.snapshot().audio.localAudioReflex,
    outputInterruptionLifecycle:
      window.__duplexLab.snapshot().audio.outputInterruptionLifecycle
  })`);

  originalMicrophonePermission = await evaluate(
    `navigator.permissions.query({ name: "microphone" })
      .then((permission) => permission.state)
      .catch(() => "prompt")`
  );
  try {
    await send("Browser.setPermission", {
      origin: TARGET_ORIGIN,
      permission: { name: "microphone" },
      setting: "granted"
    });
    permissionOverridden = true;
  } catch (error) {
    permissionErrors.push(error.message);
  }
  await evaluate(`document.querySelector("#startButton").click()`);
  const microphoneProbe = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const settled = snapshot.state.inputMode === "local-pcm" ||
          snapshot.trace.some((event) =>
            ["session.error", "session.unsupported"].includes(event.type)
          );
        return settled ? snapshot : null;
      })()`),
    15_000
  );
  let falseActivationStarted = null;
  let falseActivationCaptureStartFrames = null;
  let falseActivationControlStartWindows = null;
  let falseActivationShadowStart = null;
  let falseActivationStartDrain = null;
  let falseActivationPreflight = null;
  const falseActivationPlaybackRestarts = 0;
  if (microphoneProbe.state.inputMode === "local-pcm") {
    const preflightStartedAt = Date.now();
    let quietSnapshot = null;
    try {
      quietSnapshot = await waitForStable(
        () =>
          evaluate(`(() => {
            const snapshot = window.__duplexLab.snapshot();
            const quiet = !snapshot.state.userSpeaking &&
              !snapshot.state.potentialBargeIn &&
              !snapshot.state.assistantPreparing &&
              !snapshot.state.assistantSpeaking &&
              !snapshot.state.responseActive &&
              snapshot.state.audioQueueLength === 0;
            return quiet ? snapshot : null;
          })()`),
        1_500,
        FALSE_ACTIVATION_PREFLIGHT_TIMEOUT_MS
      );
    } catch (error) {
      if (!/Condição não permaneceu estável/u.test(error.message)) {
        throw error;
      }
      falseActivationPreflight = {
        status: "unresolved",
        waitedMs: Date.now() - preflightStartedAt,
        requiredStableQuietMs: 1_500,
        error: error.message,
        scope:
          "probe causal não iniciado: fala ambiente ou estado ativo " +
          "impediu silêncio estável; gates físicos permanecem falsos"
      };
    }
    if (quietSnapshot) {
    const preflightTrace = quietSnapshot.trace.slice(
      microphoneProbe.trace.length
    );
    falseActivationPreflight = {
      status: "resolved",
      waitedMs: Date.now() - preflightStartedAt,
      requiredStableQuietMs: 1_500,
      observedUserSpeechEvents: preflightTrace.filter(
        (event) => event.type === "user.speech.started"
      ).length,
      committedTurns: preflightTrace.filter(
        (event) => event.type === "turn.committed"
      ).length,
      scope:
        "protege o início causal do probe contra fala ambiente já ativa; " +
        "não rotula o ambiente durante a janela medida"
    };
    try {
    const falseActivationRequest = await evaluate(
      `(() => {
        const traceStartIndex = window.__duplexLab.snapshot().trace.length;
        const requestedAtMs = performance.now();
        window.__duplexLab.speakLoop(
          ${JSON.stringify(FALSE_ACTIVATION_TEXT)}
        );
        return { traceStartIndex, requestedAtMs };
      })()`
    );
    const startedSnapshot = await waitFor(
      () =>
        evaluate(`(() => {
          const snapshot = window.__duplexLab.snapshot();
          return snapshot.trace.slice(
            ${JSON.stringify(falseActivationRequest.traceStartIndex)}
          ).some(
            (event) =>
              event.type === "assistant.speech.started" &&
              event.detail === "automation-probe" &&
              event.atMs >= ${JSON.stringify(
                falseActivationRequest.requestedAtMs
              )}
          ) ? snapshot : null;
        })()`),
      15_000
    );
    falseActivationStarted = startedSnapshot.trace.find(
      (event, index) =>
        index >= falseActivationRequest.traceStartIndex &&
        event.type === "assistant.speech.started" &&
        event.detail === "automation-probe" &&
        event.atMs >= falseActivationRequest.requestedAtMs
    );
    falseActivationStartDrain = await evaluate(
      `window.__duplexLab.flushAudio()`
    );
    falseActivationCaptureStartFrames =
      falseActivationStartDrain.capture?.receivedFrames ?? null;
    falseActivationControlStartWindows =
      falseActivationStartDrain.server?.vadControl?.telemetry
        ?.processedWindows ?? 0;
    falseActivationShadowStart = {
      windows:
        falseActivationStartDrain.server?.vadShadow?.telemetry
          ?.processedWindows ?? 0,
      resets:
        falseActivationStartDrain.server?.vadShadow?.telemetry
          ?.resetCount ?? 0
    };
    await new Promise((resolve) =>
      setTimeout(resolve, FALSE_ACTIVATION_PROBE_MS)
    );
    } catch (error) {
      if (!/Condição não satisfeita/u.test(error.message)) {
        throw error;
      }
      falseActivationPreflight = {
        ...falseActivationPreflight,
        status: "probe-start-unresolved",
        error: error.message,
        scope:
          "silêncio inicial existiu, mas o probe causal não iniciou; " +
          "gates físicos permanecem falsos"
      };
    }
    }
  }
  const microphoneDrain =
    microphoneProbe.state.inputMode === "local-pcm"
      ? await evaluate(`window.__duplexLab.flushAudio()`)
      : null;
  const microphoneCaptureSnapshot = await evaluate(
    `window.__duplexLab.refreshCaptureTelemetry()`
  );
  const rawAudioAudit = (
    await evaluate(`window.__duplexLab.audioAudit()`)
  ).filter(
    (clip) =>
      falseActivationStarted === null ||
      clip.receivedAtMs >= falseActivationStarted.atMs
  );
  const audioAudit = [];
  for (const clip of rawAudioAudit) {
    const pcm = Buffer.from(clip.pcmBase64, "base64");
    const path = REPORT_PATH.endsWith(".json")
      ? REPORT_PATH.replace(
          /\.json$/u,
          `--audio-${clip.index}.wav`
        )
      : `${REPORT_PATH}--audio-${clip.index}.wav`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encodePcm16Wave(pcm));
    audioAudit.push({
      ...clip,
      pcmBase64: undefined,
      path
    });
  }
  const falseActivationTrace = falseActivationStarted
    ? microphoneCaptureSnapshot.trace.filter(
        (event) =>
          event.atMs >= falseActivationStarted.atMs &&
          event.atMs <=
            (
              microphoneDrain?.observedAtMs ??
              microphoneCaptureSnapshot.observedAtMs
            )
      )
    : [];
  const captureStats =
    microphoneDrain?.capture ??
    microphoneCaptureSnapshot.audio.capture ??
    {};
  const potentialRecoveryMeasurements = falseActivationTrace
    .filter((event) => event.type === "assistant.speech.paused")
    .map((paused, index, pauses) => {
      const nextPauseAtMs = pauses[index + 1]?.atMs ?? Infinity;
      const dismissed = falseActivationTrace.find(
        (event) =>
          event.type === "barge-in.dismissed" &&
          event.atMs >= paused.atMs &&
          event.atMs < nextPauseAtMs
      );
      const resumed = falseActivationTrace.find(
        (event) =>
          event.type === "assistant.speech.resumed" &&
          event.atMs >= paused.atMs &&
          event.atMs < nextPauseAtMs
      );
      return {
        pausedAtMs: paused.atMs,
        dismissedAtMs: dismissed?.atMs ?? null,
        resumedAtMs: resumed?.atMs ?? null,
        pauseToResumeMs:
          resumed === undefined
            ? null
            : Math.round((resumed.atMs - paused.atMs) * 100) / 100
      };
    });
  const microphoneCapture = {
    ...microphoneCaptureSnapshot,
    falseActivationProbe: {
      preflight: falseActivationPreflight,
      requestedDurationMs: FALSE_ACTIVATION_PROBE_MS,
      observedDurationMs: falseActivationStarted
        ? Math.round(
            (
              microphoneDrain?.observedAtMs ??
              microphoneCaptureSnapshot.observedAtMs
            ) -
            falseActivationStarted.atMs
          )
        : null,
      captureFramesDuringProbe: Math.max(
        0,
        (captureStats.receivedFrames ?? 0) -
        (
          falseActivationCaptureStartFrames ??
          microphoneProbe.audio.capture?.receivedFrames ??
          0
        )
      ),
      playbackRestarts: falseActivationPlaybackRestarts,
      assistantStillSpeaking:
        microphoneCaptureSnapshot.state.assistantSpeaking,
      unexpectedUserSpeechEvents: falseActivationTrace.filter(
        (event) => event.type === "user.speech.started"
      ).length,
      unexpectedAssistantStopEvents: falseActivationTrace.filter(
        (event) => event.type === "assistant.speech.stopped"
      ).length,
      unexpectedAssistantPauseEvents: falseActivationTrace.filter(
        (event) => event.type === "assistant.speech.paused"
      ).length,
      recoveredPotentialBargeIns: falseActivationTrace.filter(
        (event) => event.type === "barge-in.dismissed"
      ).length,
      confirmedPotentialBargeIns: falseActivationTrace.filter(
        (event) => event.type === "barge-in.confirmed"
      ).length,
      potentialRecoveryMeasurements,
      completedSpeechChunks: falseActivationTrace.filter(
        (event) => event.type === "assistant.speech.finished"
      ).length,
      captureIntegrity: {
        deliveryErrors: captureStats.deliveryErrors ?? null,
        protocolErrors: captureStats.protocolErrors ?? null,
        observedSequenceGaps:
          captureStats.observedSequenceGaps ?? null,
        observedSampleGaps: captureStats.observedSampleGaps ?? null,
        processorErrors: captureStats.processorErrors ?? null,
        droppedFrames: captureStats.worklet?.droppedFrames ?? null,
        emptyInputQuanta:
          captureStats.worklet?.emptyInputQuanta ?? null
      },
      captureContinuity: {
        maxFrameArrivalGapMs:
          captureStats.maxFrameArrivalGapMs ?? null,
        telemetryReason:
          captureStats.worklet?.reason ?? null,
        clockRealtimeRatio:
          captureStats.clock?.realtimeRatio ?? null
      },
      startDrain: falseActivationStartDrain,
      drain: microphoneDrain,
      audioAudit,
      vadShadow: {
        health:
          microphoneCaptureSnapshot.audio.vadShadow?.health ?? null,
        windowsDuringProbe: Math.max(
          0,
          (
            microphoneDrain?.server?.vadShadow?.telemetry
              ?.processedWindows ??
            0
          ) - (falseActivationShadowStart?.windows ?? 0)
        ),
        startsDuringProbe: falseActivationTrace.filter(
          (event) => event.type === "vad.shadow.speech.started"
        ).length,
        resetsDuringProbe: Math.max(
          0,
          (
            microphoneDrain?.server?.vadShadow?.telemetry
              ?.resetCount ??
            0
          ) - (falseActivationShadowStart?.resets ?? 0)
        ),
        errorsDuringProbe: falseActivationTrace.filter(
          (event) =>
            event.type === "vad.shadow.reset" &&
            event.detail === "inference-error"
        ).length,
        telemetry:
          microphoneCaptureSnapshot.audio.vadShadow ?? null
      },
      vadControl: {
        health:
          microphoneCaptureSnapshot.audio.vadControl ?? null,
        windowsDuringProbe: Math.max(
          0,
          (
            microphoneDrain?.server?.vadControl?.telemetry
              ?.processedWindows ?? 0
          ) - (falseActivationControlStartWindows ?? 0)
        ),
        telemetry:
          microphoneCaptureSnapshot.audio.vadControl?.telemetry ??
          null
      },
      scope:
        "saída enviada ao dispositivo padrão e microfone real; " +
        "não verifica volume, transdutor ou acoplamento acústico"
    }
  };
  let audioTransportRecovery = null;
  if (microphoneProbe.state.inputMode === "local-pcm") {
    const before = await evaluate(
      `window.__duplexLab.snapshot()`
    );
    await evaluate(
      `window.__duplexLab.dropAudioTransport()`
    );
    const recovered = await waitFor(
      () =>
        evaluate(`(() => {
          const snapshot = window.__duplexLab.snapshot();
          return snapshot.audio.transport.disconnectCount >
              ${before.audio.transport.disconnectCount} &&
            snapshot.audio.transport.reconnectCount >
              ${before.audio.transport.reconnectCount} &&
            snapshot.audio.transport.reconnecting === false &&
            snapshot.audio.transport.socketReadyState === 1 &&
            snapshot.audio.capture?.state === "running"
            ? snapshot
            : null;
        })()`),
      10_000
    );
    const settled = await waitFor(
      () =>
        evaluate(`(() => {
          const snapshot = window.__duplexLab.snapshot();
          return snapshot.audio.capture?.pendingDeliveries === 0 &&
            snapshot.audio.transport.socketReadyState === 1
            ? snapshot
            : null;
        })()`),
      5_000
    );
    const drain = await evaluate(
      `window.__duplexLab.flushAudio()`
    );
    const after = await evaluate(
      `window.__duplexLab.refreshCaptureTelemetry()`
    );
    audioTransportRecovery = {
      before,
      recovered,
      settled,
      drain,
      after
    };
  }
  microphoneCapture.transportRecovery = audioTransportRecovery;
  await evaluate(`document.querySelector("#stopButton").click()`);
  await waitFor(
    () => evaluate(`!window.__duplexLab.snapshot().state.active`)
  );

  await evaluate(`window.__duplexLab.replayPcmBase64(
    ${JSON.stringify(audioBase64)}
  )`);
  const localAudio = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const types = snapshot.trace.map((event) => event.type);
        return types.includes("user.speech.started") &&
          types.includes("user.transcript.final") &&
          types.includes("assistant.speech.started") &&
          types.includes("brain.completed")
          ? snapshot
          : null;
      })()`),
    15_000
  );
  const localAudioTranscript = scoreTranscript(
    AUDIO_EXPECTED,
    localAudio.text.user
  );

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.injectSpeech("Oi, tudo bem?")`
  );
  const directTurn = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const types = snapshot.trace.map((event) => event.type);
        return types.includes("assistant.speech.started") &&
          types.includes("brain.completed")
          ? snapshot
          : null;
      })()`),
    15_000
  );

  const criticalConfirmationRuns = [];
  for (
    let repetition = 1;
    repetition <= CRITICAL_CONFIRMATION_REPETITIONS;
    repetition += 1
  ) {
    await evaluate(`window.__duplexLab.reset()`);
    await evaluate(
      `window.__duplexLab.injectSpeech(
        "Transfere 1500 reais, não, 150 reais."
      )`
    );
    const pending = await waitFor(
      () =>
        evaluate(`(() => {
          const snapshot = window.__duplexLab.snapshot();
          return snapshot.semantic.pendingConfirmation &&
            snapshot.trace.some(
              (event) => event.type === "assistant.safety-confirmation"
            ) &&
            snapshot.trace.some(
              (event) =>
                event.type === "assistant.speech.finished" &&
                event.detail === "direct"
            ) &&
            !snapshot.state.responseActive &&
            !snapshot.state.assistantPreparing &&
            !snapshot.state.assistantSpeaking
            ? snapshot
            : null;
        })()`),
      15_000
    );
    await evaluate(
      `window.__duplexLab.injectSpeech(
        "O valor final é 1150 reais."
      )`
    );
    const accepted = await waitFor(
      () =>
        evaluate(`(() => {
          const snapshot = window.__duplexLab.snapshot();
          return snapshot.semantic.state?.value === "BRL 1150" &&
            snapshot.semantic.pendingConfirmation === null &&
            snapshot.trace.some(
              (event) => event.type === "assistant.safety-confirmed"
            ) &&
            snapshot.trace.filter(
              (event) =>
                event.type === "assistant.speech.finished" &&
                event.detail === "direct"
            ).length >= 2 &&
            !snapshot.state.responseActive &&
            !snapshot.state.assistantPreparing &&
            !snapshot.state.assistantSpeaking
            ? snapshot
            : null;
        })()`),
      15_000
    );
    criticalConfirmationRuns.push({ repetition, pending, accepted });
  }
  await evaluate(`window.__duplexLab.reset()`);
  const preparingBargeInInitial = await evaluate(`(() => {
    window.__duplexLab.speak(
      "Esta fala foi deixada longa de propósito para manter uma síntese pendente enquanto uma nova atividade de voz é detectada."
    );
    const before = window.__duplexLab.snapshot();
    window.__duplexLab.simulateAudioEvent({
      type: "user.speech.started",
      rms: 0.06,
      threshold: 0.025
    });
    return {
      before,
      after: window.__duplexLab.snapshot()
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const preparingBargeInHeld = await evaluate(
    `window.__duplexLab.snapshot()`
  );
  await evaluate(
    `window.__duplexLab.simulateAudioEvent({
      type: "transcript.final",
      text: "Mm."
    })`
  );
  const preparingBargeInReleased = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        return snapshot.trace.some(
          (event) => event.type === "barge-in.dismissed"
        ) && snapshot.trace.some(
          (event) => event.type === "assistant.speech.started"
        ) ? snapshot : null;
      })()`),
    15_000
  );

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.speakLoop(
      "Vou continuar falando enquanto você apenas sinaliza que está acompanhando."
    )`
  );
  await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        return snapshot.state.assistantSpeaking &&
          snapshot.trace.some(
            (event) => event.type === "assistant.render.active"
          );
      })()`),
    15_000
  );
  await evaluate(
    `window.__duplexLab.simulateAudioEvent({
      type: "user.speech.started",
      rms: 0.06,
      threshold: 0.025
    })`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().trace.some(
        (event) => event.type === "assistant.speech.paused"
      )`)
  );
  await evaluate(
    `window.__duplexLab.simulateAudioEvent({
      type: "transcript.final",
      text: "Mm."
    })`
  );
  const potentialBargeInRecovery = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const types = snapshot.trace.map((event) => event.type);
        return types.includes("barge-in.dismissed") &&
          types.includes("assistant.speech.resumed") &&
          snapshot.state.assistantSpeaking
          ? snapshot
          : null;
      })()`),
    10_000
  );

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.speakLoop(
      "Vou continuar falando durante um pico acústico isolado de teste."
    )`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().state.assistantSpeaking`),
    15_000
  );
  await evaluate(`(() => {
    window.__duplexLab.simulateAudioEvent({
      type: "user.speech.started",
      turnId: "automation-marginal-reflex",
      detector: "silero-vad-v6.2",
      probability: 0.87,
      triggerSampleStart: 1000
    });
    return window.__duplexLab.snapshot();
  })()`);
  const marginalReflexStarted = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const mode = snapshot.audio.localAudioReflex.config.mode;
        const types = snapshot.trace.map((event) => event.type);
        const observed = mode === "evidence-gated"
          ? types.includes("local-audio-reflex.armed") &&
            !types.includes("assistant.speech.paused")
          : types.includes("local-audio-reflex.pause") &&
            types.includes("assistant.speech.paused");
        return observed ? snapshot : null;
      })()`),
    10_000
  );
  await evaluate(`window.__duplexLab.simulateAudioEvent({
    type: "vad.control.window",
    turnId: "automation-marginal-reflex",
    probability: 0.79,
    sampleStart: 1512
  })`);
  await evaluate(`window.__duplexLab.simulateAudioEvent({
    type: "vad.control.window",
    turnId: "automation-marginal-reflex",
    probability: 0.71,
    sampleStart: 2024
  })`);
  await evaluate(`window.__duplexLab.simulateAudioEvent({
    type: "user.speech.paused",
    turnId: "automation-marginal-reflex"
  })`);
  const marginalFinalText = "I'm";
  await evaluate(`window.__duplexLab.simulateAudioEvent({
    type: "transcript.final",
    turnId: "automation-marginal-reflex",
    text: ${JSON.stringify(marginalFinalText)}
  })`);
  const marginalReflexSettled = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const mode = snapshot.audio.localAudioReflex.config.mode;
        const types = snapshot.trace.map((event) => event.type);
        const settled = mode === "evidence-gated"
          ? types.includes("local-audio-reflex.suppressed") &&
            types.includes(
              "local-audio-reflex.transcript-suppressed"
            ) &&
            !types.includes("assistant.speech.paused") &&
            !types.includes("turn.committed") &&
            snapshot.state.assistantSpeaking
          : types.includes("assistant.speech.paused") &&
            types.includes("barge-in.confirmed") &&
            types.includes("turn.committed");
        return settled ? snapshot : null;
      })()`),
    10_000
  );
  const marginalReflex = {
    started: marginalReflexStarted,
    settled: marginalReflexSettled
  };

  let acousticReflexShadowPcm = null;
  if (acousticReflexMarginalFixture) {
    await evaluate(`window.__duplexLab.reset()`);
    await evaluate(
      `window.__duplexLab.speakLoop(
        "Esta fala deve continuar durante uma evidência acústica marginal real."
      )`
    );
    await waitFor(
      () =>
        evaluate(`window.__duplexLab.snapshot().state.assistantSpeaking`),
      15_000
    );
    await evaluate(`(() => {
      void window.__duplexLab.replayPcmBase64(
        ${JSON.stringify(acousticReflexMarginalFixture.base64)},
        {
          reset: false,
          silenceMs: ${acousticReflexMarginalFixture.silenceMs},
          mediaRef: ${JSON.stringify(acousticReflexMarginalFixture.mediaRef)},
          streamId: ${JSON.stringify(acousticReflexMarginalFixture.streamId)},
          expectedStreamSha256: ${JSON.stringify(
            acousticReflexMarginalFixture.streamSha256
          )}
        }
      ).catch(() => {});
      return true;
    })()`);
    acousticReflexShadowPcm = await waitFor(
      () =>
        evaluate(`(() => {
          const snapshot = window.__duplexLab.snapshot();
          const training = snapshot.reflexTrainingTrace;
          const labels = training.labels.map((label) => label.value);
          const valid =
            labels.includes("CONTINUE_OUTPUT") &&
            training.decisions.length > 0 &&
            training.decisions.every(
              (decision) => decision.authorityDecision === "OBSERVE_ONLY"
            ) &&
            training.effects.length === 0 &&
            training.events.every((event) => event.audioPosition) &&
            training.streams.some(
              (stream) =>
                stream.streamId === ${JSON.stringify(
                  acousticReflexMarginalFixture.streamId
                )} &&
                stream.sha256 === ${JSON.stringify(
                  acousticReflexMarginalFixture.streamSha256
                )}
            ) &&
            snapshot.audio.acousticReflexShadow.labels.CONTINUE_OUTPUT > 0 &&
            snapshot.audio.acousticReflexShadow.authority === false &&
            snapshot.state.assistantSpeaking;
          return valid ? snapshot : null;
        })()`),
      15_000
    );
  }

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.speakLoop(
      "Vou retomar cedo, mas preciso aceitar que um parcial curto ainda pode virar uma correção."
    )`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().state.assistantSpeaking`),
    15_000
  );
  await evaluate(`(() => {
    window.__duplexLab.simulateAudioEvent({
      type: "user.speech.started",
      turnId: "automation-reopen",
      rms: 0.06,
      threshold: 0.025
    });
    window.__duplexLab.simulateAudioEvent({
      type: "user.speech.paused",
      turnId: "automation-reopen"
    });
    window.__duplexLab.simulateAudioEvent({
      type: "transcript.partial",
      turnId: "automation-reopen",
      text: "Ah!"
    });
    return true;
  })()`);
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().trace.some(
        (event) => event.type === "assistant.speech.resumed"
      )`),
    10_000
  );
  await evaluate(
    `window.__duplexLab.simulateAudioEvent({
      type: "transcript.final",
      turnId: "automation-reopen",
      text: "Ah, espera."
    })`
  );
  const reopenedBackchannel = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const types = snapshot.trace.map((event) => event.type);
        const effects = snapshot.trainingTrace?.effects ?? [];
        const effectsTerminal = effects.length > 0 && effects.every(
          (effect) => [
            "rejected",
            "cancelled",
            "completed"
          ].includes(effect.status)
        );
        return types.includes("barge-in.reopened") &&
          types.includes("barge-in.confirmed") &&
          types.includes("turn.committed") &&
          effectsTerminal
          ? snapshot
          : null;
      })()`),
    10_000
  );

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.speakLoop(
      "Vou continuar falando enquanto você apenas sinaliza que está acompanhando."
    )`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().state.assistantSpeaking`),
    15_000
  );
  await evaluate(
    `(() => {
      void window.__duplexLab.replayPcmBase64(
        ${JSON.stringify(backchannelBase64)},
        { reset: false, silenceMs: 1800 }
      ).catch(() => {});
      return true;
    })()`
  );
  const realBackchannel = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const types = snapshot.trace.map((event) => event.type);
        return types.includes("user.transcript.final") &&
          (
            types.includes("user.backchannel") ||
            types.includes("user.backchannel.finalized")
          ) &&
          types.includes("barge-in.dismissed") &&
          types.includes("assistant.speech.resumed") &&
          snapshot.state.assistantSpeaking
          ? snapshot
          : null;
      })()`),
    20_000
  );
  const realBackchannelPause = realBackchannel.trace.find(
    (event) => event.type === "assistant.speech.paused"
  );
  const realBackchannelSpeechEnd = realBackchannel.trace.find(
    (event) => event.type === "user.speech.paused"
  );
  const realBackchannelResume = realBackchannel.trace.find(
    (event) => event.type === "assistant.speech.resumed"
  );
  realBackchannel.recovery = {
    pauseToResumeMs:
      realBackchannelPause && realBackchannelResume
        ? Math.round(
            (
              realBackchannelResume.atMs -
              realBackchannelPause.atMs
            ) * 100
          ) / 100
        : null,
    speechEndToResumeMs:
      realBackchannelSpeechEnd && realBackchannelResume
        ? Math.round(
            (
              realBackchannelResume.atMs -
              realBackchannelSpeechEnd.atMs
            ) * 100
          ) / 100
        : null
  };

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.speak(
      "Esta resposta é longa o bastante para validar uma interrupção real no player do Chrome e devolver imediatamente o turno."
    )`
  );
  await waitFor(
    () =>
      evaluate(`(() => {
        const trace = window.__duplexLab.snapshot().trace;
        const speechStartIndex = trace.findLastIndex(
          (event) => event.type === "assistant.speech.started"
        );
        return speechStartIndex >= 0 &&
          trace.slice(speechStartIndex + 1).some(
            (event) => event.type === "assistant.render.active"
          );
      })()`),
    15_000
  );
  await evaluate(
    `(() => {
      void window.__duplexLab.bargeInPcmBase64(
        ${JSON.stringify(audioBase64)}
      ).catch(() => {});
      return true;
    })()`
  );
  const bargeInSnapshot = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const vadTriggered = snapshot.trace.some(
          (event) =>
            event.type === "user.speech.started" &&
            event.detail.startsWith("local PCM")
        );
        const commandStopped = snapshot.trace.some(
          (event) =>
            event.type === "assistant.speech.stopped" ||
            event.type === "assistant.speech.paused"
        );
        const renderSettled = snapshot.trace.some(
          (event) =>
            event.type === "assistant.render.stopped" ||
            event.type === "assistant.render.stop.error"
        );
        const confirmedIndex = snapshot.trace.findIndex(
          (event) => event.type === "barge-in.confirmed"
        );
        const turnCommitted = confirmedIndex >= 0 &&
          snapshot.trace.slice(confirmedIndex + 1).some(
            (event) => event.type === "turn.committed"
          );
        const nextResponseStarted = confirmedIndex >= 0 &&
          snapshot.trace.slice(confirmedIndex + 1).some(
            (event) => event.type === "assistant.speech.started"
          );
        return vadTriggered && commandStopped && renderSettled &&
          turnCommitted && nextResponseStarted
          ? snapshot
          : null;
      })()`),
    20_000
  );
  const pcmFeedStarted = bargeInSnapshot.trace.find(
    (event) => event.type === "automation.pcm.feed.started"
  );
  const vadSpeechStarted = bargeInSnapshot.trace.find(
    (event) =>
      event.type === "user.speech.started" &&
      event.detail.startsWith("local PCM")
  );
  const estimatedSpeechOnsetAtMs =
    pcmFeedStarted === undefined
      ? null
      : pcmFeedStarted.atMs + audioSpeechOnsetMs;
  const bargeIn = {
    ...bargeInSnapshot,
    closedLoop: {
      kind: "pcm-vad-to-browser-render",
      sourceOnsetRms: PCM_ONSET_RMS,
      sourceSpeechOnsetMs: audioSpeechOnsetMs,
      feedStartedAtMs: pcmFeedStarted?.atMs ?? null,
      estimatedSpeechOnsetAtMs,
      vadEventObservedAtMs: vadSpeechStarted?.atMs ?? null,
      speechOnsetToVadObservedMs:
        estimatedSpeechOnsetAtMs === null ||
        vadSpeechStarted === undefined
          ? null
          : Math.round(
              (vadSpeechStarted.atMs - estimatedSpeechOnsetAtMs) * 100
            ) / 100,
      speechOnsetToLastRenderMs:
        estimatedSpeechOnsetAtMs === null ||
        bargeInSnapshot.audio.lastRenderStop === null
          ? null
          : Math.round(
              (
                bargeInSnapshot.audio.lastRenderStop.lastRenderedAtMs -
                estimatedSpeechOnsetAtMs
              ) * 100
            ) / 100,
      scope:
        "fixture PCM em tempo real → transporte local → VAD → STOP → " +
        "último quantum do Chrome; não atravessa microfone ou sala"
    }
  };

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.speakLoop(
      "Esta resposta deve permanecer pausada durante toda uma correção longa do usuário."
    )`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().state.assistantSpeaking`),
    15_000
  );
  await evaluate(
    `(() => {
      void window.__duplexLab.replayPcmBase64(
        ${JSON.stringify(longCorrectionBase64)},
        { reset: false, silenceMs: 1800 }
      ).catch(() => {});
      return true;
    })()`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().trace.some(
        (event) =>
          event.type === "user.speech.started" &&
          event.detail.startsWith("local PCM")
      )`)
  );
  await new Promise((resolve) => setTimeout(resolve, 4_500));
  const longCorrectionMidSpeech = await evaluate(
    `window.__duplexLab.snapshot()`
  );
  const longCorrectionCompleted = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        const types = snapshot.trace.map((event) => event.type);
        return types.includes("automation.pcm.feed.completed") &&
          types.includes("barge-in.confirmed") &&
          types.includes("turn.committed") &&
          types.includes("user.transcript.final")
          ? snapshot
          : null;
      })()`),
    20_000
  );
  const longCorrectionTranscript = scoreTranscript(
    LONG_CORRECTION_EXPECTED,
    longCorrectionCompleted.text.user
  );

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.injectSpeech(
      "Pesquise e compare as três melhores opções para mim."
    )`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().trace.some(
        (event) => event.type === "task.delegated"
      )`)
  );
  await evaluate(
    `window.__duplexLab.injectSpeech(
      "Enquanto isso, me diga apenas oi."
    )`
  );
  const delegatedWhileConversing = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        return snapshot.trace.some(
          (event) => event.type === "task.result.delivered"
        ) &&
          !snapshot.state.assistantPreparing &&
          !snapshot.state.assistantSpeaking &&
          snapshot.state.audioQueueLength === 0 &&
          snapshot.state.activeTaskId === null &&
          snapshot.state.pendingTaskResults === 0
          ? snapshot
          : null;
      })()`),
    30_000
  );

  await evaluate(`window.__duplexLab.reset()`);
  await evaluate(
    `window.__duplexLab.injectSpeech(
      "Pesquise e compare as três melhores opções para mim."
    )`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().trace.some(
        (event) => event.type === "task.delegated"
      )`)
  );
  await evaluate(
    `window.__duplexLab.injectSpeech("Deixa para lá.")`
  );
  await waitFor(
    () =>
      evaluate(`window.__duplexLab.snapshot().trace.some(
        (event) => event.type === "task.cancelled"
      )`)
  );
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const cancellation = await waitFor(
    () =>
      evaluate(`(() => {
        const snapshot = window.__duplexLab.snapshot();
        return snapshot.trace.some(
          (event) =>
            event.type === "assistant.speech.finished" &&
            event.detail === "task-cancellation"
        ) &&
          !snapshot.state.assistantPreparing &&
          !snapshot.state.assistantSpeaking &&
          snapshot.state.audioQueueLength === 0
          ? snapshot
          : null;
      })()`),
    10_000
  );

  const outputInterruptionSnapshots = [
    ["pending-audio", preparingBargeInReleased],
    ["deterministic-backchannel", potentialBargeInRecovery],
    ["reopened-backchannel", reopenedBackchannel],
    ["pcm-backchannel", realBackchannel],
    ["pcm-barge-in", bargeIn],
    ["long-correction", longCorrectionCompleted]
  ];
  const outputInterruptionReplays =
    outputInterruptionSnapshots.map(([label, snapshot]) =>
      replayOutputInterruptionLifecycle(label, snapshot)
    );
  const outputInterruptionSteps =
    outputInterruptionReplays.flatMap((replay) => replay.steps);
  const outputInterruptionCoverage = {
    phases: [...new Set(
      outputInterruptionSteps.flatMap(
        (step) => [step.previousPhase, step.phase]
      )
    )].sort(),
    intents: [...new Set(
      outputInterruptionSteps.flatMap((step) => step.intents)
    )].sort(),
    transitions: [...new Set(
      outputInterruptionSteps.map(
        (step) => `${step.previousPhase}->${step.phase}`
      )
    )].sort()
  };

  const gates = {
    automationAvailable: pageState.automation,
    outputInterruptionLifecycleAdvertised:
      pageState.outputInterruptionLifecycle?.lifecycleVersion ===
        OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
    outputInterruptionLifecycleReplay:
      outputInterruptionReplays.every(
        (replay) => replay.ok && replay.terminalPhase === "idle"
      ),
    outputInterruptionLifecycleCoverage:
      ["idle", "held", "resuming", "confirmed"].every(
        (phase) => outputInterruptionCoverage.phases.includes(phase)
      ) &&
      [
        "PAUSE_OUTPUT",
        "HOLD_OUTPUT",
        "KEEP_OUTPUT_HELD",
        "RESUME_OUTPUT",
        "SETTLE_WITHOUT_RESUME",
        "SETTLE_RESUMED",
        "CONFIRM_INTERRUPTION",
        "SETTLE_CLEARED"
      ].every(
        (intent) => outputInterruptionCoverage.intents.includes(intent)
      ),
    outputInterruptionLifecycleNoInvariantError:
      outputInterruptionSnapshots.every(([, snapshot]) =>
        !snapshot.trace.some(
          (event) =>
            event.type === "output-interruption.invariant.error" ||
            event.type === "assistant.speech.resume.blocked"
        )
      ),
    physicalMicrophoneCapture:
      microphoneCapture.state.inputMode === "local-pcm" &&
      microphoneCapture.trace.some(
        (event) => event.type === "capture.started"
      ) &&
      (microphoneCapture.audio.capture?.receivedFrames ?? 0) > 0,
    audioTransportRecovery: (() => {
      const recovery = microphoneCapture.transportRecovery;
      if (microphoneCapture.state.inputMode !== "local-pcm") {
        return recovery === null;
      }
      const before = recovery?.before;
      const after = recovery?.after;
      const settled = recovery?.settled;
      const drain = recovery?.drain?.server;
      const watermark = drain?.watermark;
      const pipeline = drain?.pipeline;
      return (
        after?.state?.active === true &&
        after?.state?.inputMode === "local-pcm" &&
        after?.audio?.transport?.disconnectCount ===
          before?.audio?.transport?.disconnectCount + 1 &&
        after?.audio?.transport?.reconnectCount ===
          before?.audio?.transport?.reconnectCount + 1 &&
        after?.audio?.transport?.reconnecting === false &&
        after?.audio?.transport?.socketReadyState === 1 &&
        after?.audio?.capture?.state === "running" &&
        settled?.audio?.capture?.pendingDeliveries === 0 &&
        after?.audio?.capture?.deliveryErrors ===
          before?.audio?.capture?.deliveryErrors &&
        after?.audio?.capture?.observedSequenceGaps ===
          before?.audio?.capture?.observedSequenceGaps &&
        after?.audio?.capture?.observedSampleGaps ===
          before?.audio?.capture?.observedSampleGaps &&
        after?.audio?.capture?.worklet?.droppedFrames ===
          before?.audio?.capture?.worklet?.droppedFrames &&
        watermark?.firstReceivedSampleStart > 0 &&
        watermark?.receivedSequence >= watermark?.expectedSequence &&
        watermark?.receivedSampleEnd >= watermark?.expectedSampleEnd &&
        pipeline?.overflowCount === 0 &&
        pipeline?.processingErrorCount === 0 &&
        pipeline?.lastProcessedSequence >=
          watermark?.expectedSequence &&
        pipeline?.lastProcessedSampleEnd >=
          watermark?.expectedSampleEnd
      );
    })(),
    requestedVadControlSelected:
      REQUIRED_VAD_CONTROL === null ||
      microphoneCapture.audio.vadControl?.engine ===
        REQUIRED_VAD_CONTROL,
    sileroControlIntegrity: (() => {
      if (REQUIRED_VAD_CONTROL === null) {
        return true;
      }
      const control =
        microphoneCapture.falseActivationProbe.vadControl;
      const drain =
        microphoneCapture.falseActivationProbe.drain?.server;
      const drainedControl = drain?.vadControl;
      const watermark = drain?.watermark;
      const expectedWindows = Math.floor(
        microphoneCapture.falseActivationProbe
          .captureFramesDuringProbe * 320 / 512
      );
      return (
        control.health?.engine === REQUIRED_VAD_CONTROL &&
        control.health?.threshold === REQUIRED_SILERO_THRESHOLD &&
        control.health?.onsetWindows ===
          REQUIRED_SILERO_ONSET_WINDOWS &&
        control.health?.sha256 === SILERO_VAD_MODEL_SHA256 &&
        withinWindowCoverage(
          control.windowsDuringProbe,
          expectedWindows
        ) &&
        control.telemetry?.gapResetCount === 0 &&
        control.telemetry?.inferenceErrorCount === 0 &&
        control.telemetry?.inferenceMs?.p95 !== null &&
        control.telemetry?.inferenceMs?.p95 <
          VAD_INFERENCE_P95_LIMIT_MS &&
        control.telemetry?.inferenceMs?.p99 !== null &&
        control.telemetry?.inferenceMs?.p99 <
          VAD_INFERENCE_P99_LIMIT_MS &&
        drainedControl?.health?.engine === REQUIRED_VAD_CONTROL &&
        drainedControl.health.threshold === REQUIRED_SILERO_THRESHOLD &&
        drainedControl.health.onsetWindows ===
          REQUIRED_SILERO_ONSET_WINDOWS &&
        drainedControl.health.sha256 === SILERO_VAD_MODEL_SHA256 &&
        drainedControl.telemetry?.gapResetCount === 0 &&
        drainedControl.telemetry?.inferenceErrorCount === 0 &&
        drainedControl.telemetry?.lastProcessedSampleEnd >=
          watermark?.expectedFullWindowEnd
      );
    })(),
    audioDrainedThroughWatermark: (() => {
      const drain =
        microphoneCapture.falseActivationProbe.drain?.server;
      const watermark = drain?.watermark;
      return (
        Number.isSafeInteger(watermark?.expectedSequence) &&
        Number.isSafeInteger(watermark?.expectedSampleEnd) &&
        watermark.receivedSequence >= watermark.expectedSequence &&
        watermark.receivedSampleEnd >= watermark.expectedSampleEnd
      );
    })(),
    serverAudioPipelineIntegrity: (() => {
      const drain =
        microphoneCapture.falseActivationProbe.drain?.server;
      const watermark = drain?.watermark;
      const pipeline = drain?.pipeline;
      return (
        pipeline?.overflowCount === 0 &&
        pipeline?.processingErrorCount === 0 &&
        pipeline?.maximumPendingFrames <= 8 &&
        pipeline?.lastProcessedSequence >=
          watermark?.expectedSequence &&
        pipeline?.lastProcessedSampleEnd >=
          watermark?.expectedSampleEnd &&
        pipeline?.queueDelayMs?.p99 !== null &&
        pipeline?.queueDelayMs?.p99 < 10
      );
    })(),
    noSelfInterruptionUnderDeviceAec: (() => {
      const assistantStartIndex = microphoneCapture.trace.findIndex(
        (event) =>
          falseActivationStarted !== null &&
          event.type === falseActivationStarted.type &&
          event.atMs === falseActivationStarted.atMs &&
          event.detail === falseActivationStarted.detail
      );
      return (
        assistantStartIndex >= 0 &&
        !microphoneCapture.trace.slice(assistantStartIndex + 1).some(
          (event) =>
            event.type === "assistant.speech.stopped" ||
            event.type === "assistant.speech.paused" ||
            event.type === "barge-in.confirmed" ||
            event.type === "turn.committed"
        )
      );
    })(),
    longSessionNoFalseActivation: (() => {
      const assistantStartIndex = microphoneCapture.trace.findIndex(
        (event) =>
          falseActivationStarted !== null &&
          event.type === falseActivationStarted.type &&
          event.atMs === falseActivationStarted.atMs &&
          event.detail === falseActivationStarted.detail
      );
      const tail = assistantStartIndex < 0
        ? []
        : microphoneCapture.trace.slice(assistantStartIndex + 1);
      const observedDurationMs =
        microphoneCapture.falseActivationProbe.observedDurationMs;
      const expectedFrames =
        microphoneCapture.falseActivationProbe.requestedDurationMs /
        20;
      const capturedFrames =
        microphoneCapture.falseActivationProbe.captureFramesDuringProbe;
      const captureCoverage = capturedFrames / expectedFrames;
      const clockRatio =
        microphoneCapture.audio.capture?.clock?.realtimeRatio;
      const track =
        microphoneCapture.audio.capture?.track;
      return (
        assistantStartIndex >= 0 &&
        observedDurationMs >=
          FALSE_ACTIVATION_PROBE_MS - 250 &&
        captureCoverage >= 0.995 &&
        captureCoverage <= 1.02 &&
        clockRatio >= 0.995 &&
        clockRatio <= 1.005 &&
        track?.muted === false &&
        track?.readyState === "live" &&
        track?.muteEvents === 0 &&
        track?.settings?.echoCancellation === "all" &&
        microphoneCapture.falseActivationProbe
          .captureContinuity.maxFrameArrivalGapMs <= 100 &&
        microphoneCapture.falseActivationProbe
          .captureContinuity.telemetryReason === "requested" &&
        microphoneCapture.falseActivationProbe.assistantStillSpeaking &&
        microphoneCapture.falseActivationProbe.playbackRestarts === 0 &&
        microphoneCapture.falseActivationProbe
          .unexpectedUserSpeechEvents === 0 &&
        microphoneCapture.falseActivationProbe
          .unexpectedAssistantStopEvents === 0 &&
        microphoneCapture.falseActivationProbe
          .unexpectedAssistantPauseEvents === 0 &&
        Object.values(
          microphoneCapture.falseActivationProbe.captureIntegrity
        ).every((value) => value === 0) &&
        !tail.some(
          (event) =>
            event.type === "user.speech.started" ||
            event.type === "assistant.speech.stopped" ||
            event.type === "assistant.speech.paused"
        )
      );
    })(),
    sileroShadowIntegrity: (() => {
      const shadow =
        microphoneCapture.falseActivationProbe.vadShadow;
      const drain =
        microphoneCapture.falseActivationProbe.drain?.server;
      const drainedShadow = drain?.vadShadow;
      const watermark = drain?.watermark;
      if (shadow.health?.state !== "ready") {
        return !REQUIRE_VAD_SHADOW;
      }
      const expectedWindows = Math.floor(
        microphoneCapture.falseActivationProbe
          .captureFramesDuringProbe * 320 / 512
      );
      return (
        withinWindowCoverage(
          shadow.windowsDuringProbe,
          expectedWindows
        ) &&
        shadow.resetsDuringProbe === 0 &&
        shadow.errorsDuringProbe === 0 &&
        shadow.telemetry.observedSampleGaps === 0 &&
        shadow.telemetry.maximumQueueDepth <= 8 &&
        shadow.telemetry.inferenceMs.p95 !== null &&
        shadow.telemetry.inferenceMs.p95 <
          VAD_INFERENCE_P95_LIMIT_MS &&
        shadow.telemetry.inferenceMs.p99 !== null &&
        shadow.telemetry.inferenceMs.p99 <
          VAD_INFERENCE_P99_LIMIT_MS &&
        shadow.telemetry.queueDelayMs.p99 !== null &&
        shadow.telemetry.queueDelayMs.p99 < 10 &&
        drainedShadow?.health?.state === "ready" &&
        drainedShadow.telemetry?.resetCount === 0 &&
        drainedShadow.telemetry?.overflowCount === 0 &&
        drainedShadow.telemetry?.staleResultCount === 0 &&
        drainedShadow.telemetry?.lastProcessedSampleEnd >=
          watermark?.expectedFullWindowEnd
      );
    })(),
    sileroShadowAssistantOnlySpecificity: (() => {
      const shadow =
        microphoneCapture.falseActivationProbe.vadShadow;
      return shadow.health?.state !== "ready"
        ? !REQUIRE_VAD_SHADOW
        : shadow.startsDuringProbe === 0;
    })(),
    sileroShadowFixtureSensitivity: (() => {
      const snapshots = [
        realBackchannel,
        bargeIn,
        longCorrectionCompleted
      ];
      const shadowReady = snapshots.every(
        (snapshot) =>
          snapshot.audio.vadShadow?.health?.state === "ready"
      );
      return !shadowReady
        ? !REQUIRE_VAD_SHADOW
        : snapshots.every(
            (snapshot) =>
              snapshot.audio.vadShadow.starts.length > 0
          );
    })(),
    potentialBargeInRecovery:
      microphoneCapture.falseActivationProbe
        .confirmedPotentialBargeIns === 0 &&
      potentialRecoveryMeasurements.every(
        (measurement) =>
          measurement.dismissedAtMs !== null &&
          measurement.resumedAtMs !== null &&
          measurement.pauseToResumeMs >= 0 &&
          measurement.pauseToResumeMs <= 2_500
      ),
    deterministicPotentialBargeInRecovery:
      potentialBargeInRecovery.state.assistantSpeaking &&
      potentialBargeInRecovery.trace.some(
        (event) => event.type === "assistant.speech.paused"
      ) &&
      potentialBargeInRecovery.trace.some(
        (event) => event.type === "barge-in.dismissed"
      ) &&
      potentialBargeInRecovery.trace.some(
        (event) => event.type === "assistant.speech.resumed"
      ) &&
      !potentialBargeInRecovery.trace.some(
        (event) =>
          event.type === "barge-in.confirmed" ||
          event.type === "turn.committed" ||
          event.type === "assistant.speech.stopped"
      ),
    localAudioReflexAdvertised:
      pageState.localAudioReflex?.reflexVersion ===
        "local-audio-reflex-v0.1" &&
      ["immediate", "evidence-gated"].includes(
        pageState.localAudioReflex?.config?.mode
      ),
    marginalSpikeHandledByReflex: (() => {
      const mode =
        marginalReflex.settled.audio.localAudioReflex.config.mode;
      const startedTypes = marginalReflex.started.trace.map(
        (event) => event.type
      );
      const settledTypes = marginalReflex.settled.trace.map(
        (event) => event.type
      );
      if (mode === "evidence-gated") {
        return (
          startedTypes.includes("local-audio-reflex.armed") &&
          !startedTypes.includes("assistant.speech.paused") &&
          settledTypes.includes("local-audio-reflex.suppressed") &&
          settledTypes.includes(
            "local-audio-reflex.transcript-suppressed"
          ) &&
          !settledTypes.includes("assistant.speech.paused") &&
          !settledTypes.includes("turn.committed") &&
          marginalReflex.settled.state.assistantSpeaking
        );
      }
      return false;
    })(),
    marginalSpikeControlObserved: (() => {
      const mode =
        marginalReflex.settled.audio.localAudioReflex.config.mode;
      if (mode === "evidence-gated") {
        return true;
      }
      const startedTypes = marginalReflex.started.trace.map(
        (event) => event.type
      );
      const settledTypes = marginalReflex.settled.trace.map(
        (event) => event.type
      );
      return (
        startedTypes.includes("local-audio-reflex.pause") &&
        startedTypes.includes("assistant.speech.paused") &&
        settledTypes.includes("barge-in.confirmed") &&
        settledTypes.includes("turn.committed")
      );
    })(),
    acousticReflexShadowPcm:
      !RUN_ACOUSTIC_REFLEX_SHADOW_PROBE ||
      (
        acousticReflexShadowPcm !== null &&
        acousticReflexShadowPcm.reflexTrainingTrace.effects.length === 0 &&
        acousticReflexShadowPcm.audio.acousticReflexShadow.authority === false
      ),
    earlyBackchannelPartialCanReopen:
      reopenedBackchannel.metrics.interruptions === 1 &&
      reopenedBackchannel.metrics.dismissedBackchannels === 0 &&
      reopenedBackchannel.trace.some(
        (event) => event.type === "user.backchannel.early"
      ) &&
      reopenedBackchannel.trace.some(
        (event) => event.type === "assistant.speech.resumed"
      ) &&
      reopenedBackchannel.trace.some(
        (event) => event.type === "barge-in.reopened"
      ) &&
      reopenedBackchannel.trace.some(
        (event) => event.type === "barge-in.confirmed"
      ) &&
      reopenedBackchannel.trace.some(
        (event) =>
          event.type === "turn.committed" &&
          event.detail.includes("espera")
      ),
    pendingAudioHeldDuringPotentialBargeIn:
      preparingBargeInInitial.before.state.assistantPreparing &&
      preparingBargeInInitial.after.state.potentialBargeIn === "pending" &&
      preparingBargeInHeld.state.potentialBargeIn === "pending" &&
      !preparingBargeInHeld.trace.some(
        (event) => event.type === "assistant.speech.started"
      ) &&
      preparingBargeInReleased.trace.some(
        (event) => event.type === "barge-in.dismissed"
      ) &&
      preparingBargeInReleased.trace.some(
        (event) => event.type === "assistant.speech.started"
      ) &&
      preparingBargeInReleased.metrics.interruptions === 0,
    realPcmBackchannelRecovered:
      realBackchannel.recovery.speechEndToResumeMs !== null &&
      realBackchannel.recovery.speechEndToResumeMs >= 0 &&
      realBackchannel.recovery.speechEndToResumeMs <= 500 &&
      realBackchannel.metrics.tentativePauses === 1 &&
      realBackchannel.metrics.interruptions === 0 &&
      realBackchannel.metrics.dismissedBackchannels === 1 &&
      !realBackchannel.trace.some(
        (event) =>
          event.type === "barge-in.confirmed" ||
          event.type === "turn.committed"
      ),
    localAudioVertical:
      pageState.input?.includes("ASR aberto") &&
      localAudio.state.inputMode === "automation-pcm" &&
      localAudioTranscript.wer <= 0.2 &&
      localAudio.metrics.responseStartMs !== null &&
      localAudio.metrics.responseStartMs <= RESPONSE_START_LIMIT_MS,
    responseStarted:
      directTurn.metrics.responseStartMs !== null &&
      directTurn.metrics.responseStartMs <= RESPONSE_START_LIMIT_MS,
    statefulCriticalConfirmation:
      criticalConfirmationRuns.length ===
        CRITICAL_CONFIRMATION_REPETITIONS &&
      criticalConfirmationRuns.every(
        assessStatefulCriticalConfirmation
      ),
    stoppedOnBargeIn:
      bargeIn.metrics.stopCommandMs !== null &&
      bargeIn.metrics.stopCommandMs <= STOP_COMMAND_LIMIT_MS &&
      bargeIn.metrics.interruptions === 1 &&
      bargeIn.state.inputMode === "automation-pcm-barge-in" &&
      bargeIn.trace.some(
        (event) =>
          event.type === "user.speech.started" &&
          event.detail.startsWith("local PCM")
      ) &&
      bargeIn.trace.some(
        (event) => event.type === "barge-in.confirmed"
      ) &&
      bargeIn.trace.some(
        (event) => event.type === "turn.committed"
      ) &&
      !bargeIn.trace.some(
        (event) => event.type === "assistant.speech.resumed"
      ),
    localAudioReflexPreservesBargeIn: (() => {
      const mode = bargeIn.audio.localAudioReflex.config.mode;
      const armedAt = bargeIn.trace.findIndex(
        (event) => event.type === "local-audio-reflex.armed"
      );
      const pausedAt = bargeIn.trace.findIndex(
        (event) => event.type === "local-audio-reflex.pause"
      );
      if (mode === "evidence-gated") {
        return (
          armedAt >= 0 &&
          pausedAt > armedAt &&
          /sustained-acoustic-evidence|transcript-evidence/u.test(
            bargeIn.trace[pausedAt].detail
          )
        );
      }
      return (
        pausedAt >= 0 &&
        /immediate-or-non-gateable/u.test(
          bargeIn.trace[pausedAt].detail
        )
      );
    })(),
    closedLoopPcmBargeIn:
      bargeIn.closedLoop.kind === "pcm-vad-to-browser-render" &&
      bargeIn.closedLoop.speechOnsetToVadObservedMs !== null &&
      bargeIn.closedLoop.speechOnsetToVadObservedMs >= 0 &&
      bargeIn.closedLoop.speechOnsetToLastRenderMs !== null &&
      bargeIn.closedLoop.speechOnsetToLastRenderMs >= 0 &&
      bargeIn.closedLoop.speechOnsetToLastRenderMs <=
        PCM_ONSET_TO_RENDER_STOP_LIMIT_MS,
    browserRenderPathStoppedOnBargeIn:
      bargeIn.metrics.stopRenderedMs !== null &&
      bargeIn.metrics.stopRenderedMs >= 0 &&
      bargeIn.metrics.stopRenderedMs <= RENDER_STOP_LIMIT_MS &&
      bargeIn.audio.lastRenderStop?.kind === "browser-render-stop" &&
      bargeIn.audio.lastRenderStop.renderedThroughTrigger === true,
    longCorrectionNeverResumedMidSpeech:
      !longCorrectionMidSpeech.state.assistantSpeaking &&
      longCorrectionMidSpeech.state.potentialBargeIn === "pending" &&
      (() => {
        const pauseIndex = longCorrectionMidSpeech.trace.findIndex(
          (event) => event.type === "assistant.speech.paused"
        );
        const tail = pauseIndex < 0
          ? []
          : longCorrectionMidSpeech.trace.slice(pauseIndex + 1);
        return pauseIndex >= 0 &&
          !tail.some(
            (event) =>
              event.type === "assistant.speech.resumed" ||
              event.type === "assistant.speech.started" ||
              event.type === "barge-in.confirmed" ||
              event.type === "turn.committed"
          );
      })() &&
      longCorrectionCompleted.trace.some(
        (event) => event.type === "barge-in.confirmed"
      ) &&
      longCorrectionCompleted.trace.some(
        (event) => event.type === "turn.committed"
      ) &&
      longCorrectionCompleted.trace.filter(
        (event) => event.type === "turn.committed"
      ).length === 1 &&
      !longCorrectionCompleted.trace.some(
        (event) => event.type === "assistant.speech.resumed"
      ) &&
      longCorrectionTranscript.wer <= 0.5 &&
      /\bdomingo\b/iu.test(longCorrectionCompleted.text.user),
    delegatedTaskCancelled: (() => {
      const trace = cancellation.trace;
      const cancelledAt = trace.findIndex(
        (event) => event.type === "task.cancelled"
      );
      const acknowledgmentStartedAt = trace.findIndex(
        (event) =>
          event.type === "assistant.speech.started" &&
          event.detail === "task-cancellation"
      );
      const acknowledgmentFinishedAt = trace.findIndex(
        (event) =>
          event.type === "assistant.speech.finished" &&
          event.detail === "task-cancellation"
      );
      return (
        cancelledAt >= 0 &&
        acknowledgmentStartedAt > cancelledAt &&
        acknowledgmentFinishedAt > acknowledgmentStartedAt &&
        !cancellation.state.assistantPreparing &&
        !cancellation.state.assistantSpeaking &&
        cancellation.state.audioQueueLength === 0 &&
        !trace.some(
          (event) =>
            event.type === "task.result.ready" ||
            event.type === "task.result" ||
            event.type === "task.result.audible" ||
            event.type === "task.result.delivered" ||
            (
              event.type === "assistant.speech.started" &&
              event.detail === "delegated-result"
            )
        ) &&
        !trace.some((event) => event.type.endsWith(".error"))
      );
    })(),
    delegatedTaskSurvivesConversation:
      (() => {
        const trace = delegatedWhileConversing.trace;
        const indexOf = (type, detail = null) =>
          trace.findIndex(
            (event) =>
              event.type === type &&
              (detail === null || event.detail === detail)
          );
        const delegatedAt = indexOf("task.delegated");
        const directStartedAt = indexOf(
          "assistant.speech.started",
          "direct"
        );
        const directFinishedAt = indexOf(
          "assistant.speech.finished",
          "direct"
        );
        const readyAt = indexOf("task.result.ready");
        const offeredAt = indexOf("task.result.offered");
        const resultStartedAt = indexOf(
          "assistant.speech.started",
          "delegated-result"
        );
        const deliveredAt = indexOf("task.result.delivered");
        const interruptedBeforeDelivery = trace
          .slice(resultStartedAt + 1, deliveredAt)
          .some(
            (event) =>
              event.type === "assistant.speech.stopped" ||
              event.type === "task.cancelled"
          );
        return (
          delegatedAt >= 0 &&
          trace.filter(
            (event) => event.type === "turn.committed"
          ).length >= 2 &&
          directStartedAt > delegatedAt &&
          directFinishedAt > directStartedAt &&
          readyAt > delegatedAt &&
          offeredAt > directFinishedAt &&
          resultStartedAt > offeredAt &&
          deliveredAt > resultStartedAt &&
          !interruptedBeforeDelivery &&
          !trace
            .slice(offeredAt, deliveredAt + 1)
            .some((event) => event.type.endsWith(".error")) &&
          trace.filter(
            (event) =>
              event.type === "assistant.speech.started" &&
              event.detail === "delegated-result"
          ).length ===
            trace.filter(
              (event) =>
                event.type === "assistant.speech.finished" &&
                event.detail === "delegated-result"
            ).length &&
          !delegatedWhileConversing.state.assistantPreparing &&
          !delegatedWhileConversing.state.assistantSpeaking &&
          delegatedWhileConversing.state.audioQueueLength === 0 &&
          delegatedWhileConversing.state.activeTaskId === null &&
          delegatedWhileConversing.state.pendingTaskResults === 0 &&
          !trace.some(
            (event) => event.type === "task.cancelled"
          )
        );
      })(),
    noAudioPipelineErrors: [
      microphoneCapture,
      microphoneCapture.transportRecovery?.after,
      directTurn,
      ...criticalConfirmationRuns.flatMap(
        (run) => [run.pending, run.accepted]
      ),
      preparingBargeInInitial.before,
      preparingBargeInInitial.after,
      preparingBargeInHeld,
      preparingBargeInReleased,
      potentialBargeInRecovery,
      marginalReflex.started,
      marginalReflex.settled,
      acousticReflexShadowPcm,
      reopenedBackchannel,
      realBackchannel,
      localAudio,
      bargeIn,
      longCorrectionCompleted,
      delegatedWhileConversing,
      cancellation
    ].filter(Boolean).every(
      (snapshot) =>
        !snapshot.trace.some(
          (event) => event.type.endsWith(".error")
        )
    ),
    noBrowserErrors:
      consoleErrors.length === 0 &&
      runtimeErrors.length === 0 &&
      httpErrors.length === 0
  };
  const ok = Object.values(gates).every(Boolean);

  const report = {
    schemaVersion: 2,
    runNonce: RUN_NONCE,
    sourceFingerprint: SOURCE_FINGERPRINT,
    generatedAt: new Date().toISOString(),
    candidate: "browser-windows-chrome-local",
    fixtures: {
      backchannelPcmSha256: createHash("sha256")
        .update(backchannelFixture.pcm)
        .digest("hex"),
      bargeInWaveSha256: createHash("sha256")
        .update(audioFixtureWave)
        .digest("hex"),
      correctionWaveSha256: createHash("sha256")
        .update(longCorrectionFixtureWave)
        .digest("hex")
    },
    ok,
    cdpUrl,
    pageId: page.id,
    page: pageState,
    thresholds: {
      responseStartMs: RESPONSE_START_LIMIT_MS,
      stopCommandMs: STOP_COMMAND_LIMIT_MS,
      browserRenderStopMs: RENDER_STOP_LIMIT_MS,
      pcmOnsetToBrowserRenderStopMs:
        PCM_ONSET_TO_RENDER_STOP_LIMIT_MS,
      falseActivationProbeMs: FALSE_ACTIVATION_PROBE_MS,
      vadControlRequired: REQUIRED_VAD_CONTROL,
      vadShadowRequired: REQUIRE_VAD_SHADOW
    },
    gates,
    outputInterruptionLifecycle: {
      version: OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
      replays: outputInterruptionReplays,
      coverage: outputInterruptionCoverage,
      scope:
        "replay exato das decisões locais de hold, retomada e confirmação; " +
        "efeitos físicos continuam observados pelos gates do Chrome"
    },
    microphoneCapture: {
      ...microphoneCapture,
      scope:
        "captura real e saída enviada pelo Chrome em sessão contínua; " +
        "sem fala humana rotulada, confirmação de acoplamento acústico " +
        "ou medição do último sample físico"
    },
    directTurn,
    criticalConfirmation: {
      repetitions: CRITICAL_CONFIRMATION_REPETITIONS,
      runs: criticalConfirmationRuns
    },
    preparingBargeIn: {
      initial: preparingBargeInInitial,
      held: preparingBargeInHeld,
      released: preparingBargeInReleased
    },
    potentialBargeInRecovery,
    marginalReflex,
    acousticReflexShadowPcm,
    reopenedBackchannel,
    realBackchannel,
    localAudio: {
      ...localAudio,
      expected: AUDIO_EXPECTED,
      transcript: localAudioTranscript
    },
    bargeIn: {
      ...bargeIn,
      triggerScope:
        "fixture PCM em tempo real injetada após atividade comprovada no " +
        "renderer; atravessa transporte e VAD, mas não o microfone",
      measurementScope:
        "STOP de render = último quantum não silencioso observado no " +
        "AudioWorklet e mapeado por AudioContext.getOutputTimestamp; " +
        "não inclui a cauda do alto-falante ou da sala"
    },
    longCorrection: {
      midSpeech: longCorrectionMidSpeech,
      completed: longCorrectionCompleted,
      expected: LONG_CORRECTION_EXPECTED,
      transcript: longCorrectionTranscript
    },
    delegatedWhileConversing,
    limitations: [
      "O STOP acústico físico exige microfone de medição ou loopback " +
        "calibrado; este gate termina no relógio de apresentação do Chrome.",
      "A sessão de autoativação usa microfone real e a saída padrão, mas " +
        "não comprova que o alto-falante estava audível para o microfone.",
      "O barge-in closed-loop usa uma fixture PCM após o áudio ficar ativo; " +
        "ele atravessa transporte/VAD, mas não captura o ambiente físico."
    ],
    cancellation,
    consoleErrors,
    runtimeErrors,
    httpErrors,
    permissionErrors
  };
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      ok,
      responseStartMs: directTurn.metrics.responseStartMs,
      stopCommandMs: bargeIn.metrics.stopCommandMs,
      browserRenderStopMs: bargeIn.metrics.stopRenderedMs,
      pcmOnsetToBrowserRenderStopMs:
        bargeIn.closedLoop.speechOnsetToLastRenderMs,
      falseActivationObservedMs:
        microphoneCapture.falseActivationProbe.observedDurationMs,
      gates,
      report: REPORT_PATH
    })
  );
  if (!ok && !ALLOW_FAILED_GATES) {
    process.exitCode = 1;
  }
} finally {
  if (permissionOverridden && socket.readyState === WebSocket.OPEN) {
    await send("Browser.setPermission", {
      origin: TARGET_ORIGIN,
      permission: { name: "microphone" },
      setting: originalMicrophonePermission ?? "prompt"
    }).catch(() => {});
  }
  if (createdPage && socket.readyState === WebSocket.OPEN) {
    await send("Page.close").catch(() => {});
  }
  socket.close();
}
