import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { encodePcm16Wave } from "../src/audio/wav.mjs";
import { scoreTranscript } from "../src/eval/transcript-metrics.mjs";
import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  withinWindowCoverage
} from "../src/eval/window-coverage.mjs";

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
const REQUIRE_VAD_SHADOW =
  process.env.REQUIRE_VAD_SHADOW === "1";
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
    secureContext: window.isSecureContext
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
  const falseActivationPlaybackRestarts = 0;
  if (microphoneProbe.state.inputMode === "local-pcm") {
    await evaluate(
      `window.__duplexLab.speakLoop(
        ${JSON.stringify(FALSE_ACTIVATION_TEXT)}
      )`
    );
    const startedSnapshot = await waitFor(
      () =>
        evaluate(`(() => {
          const snapshot = window.__duplexLab.snapshot();
          return snapshot.trace.some(
            (event) => event.type === "assistant.speech.started"
          ) ? snapshot : null;
        })()`),
      15_000
    );
    falseActivationStarted = startedSnapshot.trace.findLast(
      (event) => event.type === "assistant.speech.started"
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
  }
  const microphoneDrain =
    microphoneProbe.state.inputMode === "local-pcm"
      ? await evaluate(`window.__duplexLab.flushAudio()`)
      : null;
  const microphoneCaptureSnapshot = await evaluate(
    `window.__duplexLab.refreshCaptureTelemetry()`
  );
  const rawAudioAudit = await evaluate(
    `window.__duplexLab.audioAudit()`
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
        return types.includes("barge-in.reopened") &&
          types.includes("barge-in.confirmed") &&
          types.includes("turn.committed")
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

  const gates = {
    automationAvailable: pageState.automation,
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
        (event) => event.type === "assistant.speech.started"
      );
      return (
        assistantStartIndex >= 0 &&
        !microphoneCapture.trace.slice(assistantStartIndex + 1).some(
          (event) =>
            event.type === "user.speech.started" ||
            event.type === "assistant.speech.stopped" ||
            event.type === "assistant.speech.paused"
        )
      );
    })(),
    longSessionNoFalseActivation: (() => {
      const assistantStartIndex = microphoneCapture.trace.findIndex(
        (event) => event.type === "assistant.speech.started"
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
      preparingBargeInInitial.before,
      preparingBargeInInitial.after,
      preparingBargeInHeld,
      preparingBargeInReleased,
      potentialBargeInRecovery,
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
    microphoneCapture: {
      ...microphoneCapture,
      scope:
        "captura real e saída enviada pelo Chrome em sessão contínua; " +
        "sem fala humana rotulada, confirmação de acoplamento acústico " +
        "ou medição do último sample físico"
    },
    directTurn,
    preparingBargeIn: {
      initial: preparingBargeInInitial,
      held: preparingBargeInHeld,
      released: preparingBargeInReleased
    },
    potentialBargeInRecovery,
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
  if (!ok) {
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
