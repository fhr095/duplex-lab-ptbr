import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalBrain } from "../brain/local-brain.mjs";
import { createConfiguredBrain } from "../brain/provider.mjs";
import { loadEnvFile } from "../config/load-env.mjs";
import { attachAudioWebSocket } from "../audio/audio-websocket.mjs";
import {
  normalizePrefinalPolicy
} from "../audio/prefinal-policy.mjs";
import {
  createSileroVadShadowRuntime
} from "../audio/silero-vad-shadow.mjs";
import { createCpuStreamingAsr } from "../asr/index.mjs";
import { createSourceFingerprint } from "../eval/source-fingerprint.mjs";
import {
  closeWindowsSpeechSynthesizer,
  prewarmWindowsSpeech,
  synthesizeWindowsSpeech
} from "../tts/windows-system-tts.mjs";

await loadEnvFile();

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WEB_ROOT = resolve(PROJECT_ROOT, "web");
const processRunId = randomUUID();
const processStartedAt = new Date().toISOString();
const runtimeFingerprint = await createSourceFingerprint(PROJECT_ROOT, {
  roots: ["src", "web", "package.json", "package-lock.json", "requirements-asr.txt"]
});
const localBrain = createLocalBrain();
const configuredBrain = createConfiguredBrain({ planner: localBrain });
const brain = configuredBrain.brain;
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const host = process.env.HOST ?? "0.0.0.0";
const prefinalPolicy = normalizePrefinalPolicy(
  process.env.PREFINAL_POLICY
);
const endpointConfig = {
  completeSilenceMs: Number.parseInt(
    process.env.ENDPOINT_COMPLETE_MS ?? "520",
    10
  ),
  incompleteSilenceMs: Number.parseInt(
    process.env.ENDPOINT_INCOMPLETE_MS ?? "1050",
    10
  ),
  noTranscriptSilenceMs: Number.parseInt(
    process.env.ENDPOINT_NO_TRANSCRIPT_MS ?? "900",
    10
  )
};
const vadConfig = {
  minimumOnThreshold: Number.parseFloat(
    process.env.VAD_MIN_ON_THRESHOLD ?? "0.025"
  ),
  onMultiplier: Number.parseFloat(
    process.env.VAD_ON_MULTIPLIER ?? "4"
  ),
  onsetFrames: Number.parseInt(process.env.VAD_ONSET_FRAMES ?? "4", 10),
  pauseFrames: Number.parseInt(process.env.VAD_PAUSE_FRAMES ?? "10", 10)
};
const mergeWindowMs = Number.parseInt(
  process.env.ENDPOINT_MERGE_WINDOW_MS ?? "1400",
  10
);
const finalCommitGraceMs = Number.parseInt(
  process.env.FINAL_COMMIT_GRACE_MS ?? "220",
  10
);
const effectfulFinalCommitGraceMs = Number.parseInt(
  process.env.EFFECTFUL_COMMIT_GRACE_MS ?? "650",
  10
);
const criticalFinalCommitGraceMs = Number.parseInt(
  process.env.CRITICAL_FINAL_COMMIT_GRACE_MS ?? "1100",
  10
);
const audioPipelineMaxFrames = Number.parseInt(
  process.env.AUDIO_PIPELINE_MAX_FRAMES ?? "16",
  10
);
if (
  !Number.isSafeInteger(audioPipelineMaxFrames) ||
  audioPipelineMaxFrames < 1
) {
  throw new RangeError("AUDIO_PIPELINE_MAX_FRAMES precisa ser positivo");
}
const asrEnabled = process.env.ASR_ENABLED !== "0";
const asrModel = process.env.ASR_MODEL?.trim() || "base";
const asrFinalEngine =
  process.env.ASR_FINAL_ENGINE?.trim() || "parakeet";
const asrPartialModel =
  process.env.ASR_PARTIAL_MODEL?.trim() || "tiny";
const asrFinalModel =
  process.env.ASR_FINAL_MODEL?.trim() ||
  (asrFinalEngine === "parakeet"
    ? "nemo-parakeet-tdt-0.6b-v3"
    : asrModel);
const asrRuntime = asrEnabled
  ? createCpuStreamingAsr({
      finalEngine: asrFinalEngine,
      finalModel: asrFinalModel,
      partialModel: asrPartialModel,
      finalThreads: Number.parseInt(
        process.env.ASR_FINAL_THREADS ?? "3",
        10
      ),
      partialThreads: Number.parseInt(
        process.env.ASR_PARTIAL_THREADS ?? "1",
        10
      ),
      partialWarmupMs: Number.parseInt(
        process.env.ASR_PARTIAL_WARMUP_MS ?? "2000",
        10
      ),
      finalWarmupMs: Number.parseInt(
        process.env.ASR_FINAL_WARMUP_MS ?? "6000",
        10
      ),
      sessionDefaults: {
        initialAudioMs: Number.parseInt(
          process.env.ASR_INITIAL_AUDIO_MS ?? "320",
          10
        ),
        stepAudioMs: Number.parseInt(
          process.env.ASR_STEP_AUDIO_MS ?? "320",
          10
        )
      }
    })
  : null;
const vadShadowMode =
  process.env.VAD_SHADOW?.trim().toLocaleLowerCase() || "disabled";
const vadControlMode =
  process.env.VAD_CONTROL?.trim().toLocaleLowerCase() || "energy";
if (!["energy", "silero"].includes(vadControlMode)) {
  throw new Error(
    `VAD_CONTROL=${vadControlMode} não é suportado; use energy ou silero`
  );
}
let vadShadowRuntime = null;
let vadShadowHealth = {
  state: vadShadowMode === "silero" ? "starting" : "disabled",
  mode: vadShadowMode
};
let vadControlHealth = vadControlMode === "silero"
  ? { state: "starting", engine: "silero-vad" }
  : { state: "ready", engine: "adaptive-energy-vad" };
let asrHealth = {
  state: asrEnabled ? "starting" : "disabled",
  model: asrEnabled ? asrFinalModel : null
};
let ttsHealth = { state: "starting" };
const ttsWarmup = prewarmWindowsSpeech().then(
  (status) => {
    ttsHealth = {
      state: "ready",
      engine: "windows-system-speech",
      voice: status.worker?.voice ?? null,
      culture: status.worker?.culture ?? null,
      primed: status.primed
    };
  },
  (error) => {
    ttsHealth = {
      state: "error",
      engine: "windows-system-speech",
      code: error.code ?? "tts_start_error",
      message: error.message
    };
    console.error(`TTS do Windows indisponível: ${error.message}`);
  }
);

if (asrRuntime) {
  try {
    const ready = await asrRuntime.start();
    asrHealth = {
      state: "ready",
      engine: ready.final.engine,
      model: ready.final.model,
      partialModel: ready.partial.model,
      finalModel: ready.final.model,
      device: ready.final.device,
      computeType: ready.final.computeType,
      workers: 2,
      partialThreads: ready.partial.threadsPerWorker,
      finalThreads: ready.final.threadsPerWorker,
      modelLoadMs:
        ready.partial.modelLoadMs + ready.final.modelLoadMs,
      warmupMs: Math.max(
        ready.partial.warmupMs,
        ready.final.warmupMs
      )
    };
  } catch (error) {
    asrHealth = {
      state: "error",
      engine: asrFinalEngine,
      model: asrFinalModel,
      code: error.code ?? "asr_start_error",
      message: error.message
    };
    console.error(`ASR local indisponível: ${error.message}`);
  }
}
if (vadShadowMode === "silero" || vadControlMode === "silero") {
  try {
    vadShadowRuntime = await createSileroVadShadowRuntime({
      modelPath:
        process.env.SILERO_VAD_MODEL_PATH ??
        resolve(
          PROJECT_ROOT,
          "eval/generated/vad/models/silero_vad_v6.2.onnx"
        ),
      threshold: Number.parseFloat(
        process.env.SILERO_VAD_THRESHOLD ?? "0.5"
      ),
      onsetWindows: Number.parseInt(
        process.env.SILERO_VAD_ONSET_WINDOWS ?? "2",
        10
      ),
      mode: vadControlMode === "silero"
        ? "candidate-control"
        : "shadow",
      controlPathChanged: vadControlMode === "silero"
    });
    if (vadShadowMode === "silero") {
      vadShadowHealth = vadShadowRuntime.health;
    }
    if (vadControlMode === "silero") {
      vadControlHealth = vadShadowRuntime.health;
    }
  } catch (error) {
    const health = {
      state: "error",
      engine: "silero-vad",
      code: error.code ?? "silero_vad_start_error",
      message: error.message
    };
    if (vadShadowMode === "silero") {
      vadShadowHealth = { ...health, mode: "shadow" };
    }
    if (vadControlMode === "silero") {
      vadControlHealth = {
        ...health,
        mode: "candidate-control"
      };
    }
    console.error(`Silero VAD indisponível: ${error.message}`);
  }
}
if (
  vadControlMode === "silero" &&
  vadControlHealth.state !== "ready"
) {
  throw new Error(
    `VAD de controle Silero não iniciou: ${vadControlHealth.message}`
  );
}
await ttsWarmup;

const STATIC_ROUTES = new Map([
  ["/", "index.html"],
  ["/app.mjs", "app.mjs"],
  ["/critical-conflict.mjs", "critical-conflict.mjs"],
  ["/pcm-capture-worklet.js", "pcm-capture-worklet.js"],
  ["/pcm-capture.mjs", "pcm-capture.mjs"],
  ["/pcm-dsp.mjs", "pcm-dsp.mjs"],
  ["/pcm-wire.mjs", "pcm-wire.mjs"],
  ["/stream-utils.mjs", "stream-utils.mjs"],
  ["/turn-taking.mjs", "turn-taking.mjs"],
  ["/styles.css", "styles.css"]
]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8"
};

function findPrivateIpv4() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return null;
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 65_536) {
      throw new RangeError("corpo da requisição excede 64 KiB");
    }
  }
  return JSON.parse(body || "{}");
}

function sendJson(response, status, value) {
  if (response.destroyed || response.writableEnded) {
    return false;
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(value)}\n`);
  return true;
}

function sendNdjson(response, value) {
  if (!response.destroyed && !response.writableEnded) {
    response.write(`${JSON.stringify(value)}\n`);
  }
}

function validateTurn(body) {
  if (typeof body.text !== "string" || !body.text.trim()) {
    throw new TypeError("O campo text é obrigatório.");
  }
  if (body.text.length > 4_000) {
    throw new RangeError("O campo text excede 4.000 caracteres.");
  }
}

async function streamTurn(request, response, body) {
  validateTurn(body);

  const plan = localBrain.planTurn(body.text);
  const mode = plan.mode;
  const controller = new AbortController();
  const abortUpstream = () => controller.abort();

  request.once("aborted", abortUpstream);
  response.once("close", () => {
    if (!response.writableEnded) {
      abortUpstream();
    }
  });

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-content-type-options": "nosniff"
  });

  sendNdjson(response, {
    type: "route",
    mode,
    semantic: plan.semantic ?? null,
    acknowledgment: mode === "delegate" ? plan.acknowledgment : null,
    taskId: mode === "delegate" ? plan.task.id : null,
    query: mode === "delegate" ? plan.task.query : null
  });

  try {
    for await (const event of brain.streamTurn({
      text: plan.effectiveText ?? body.text,
      history: body.history,
      mode,
      signal: controller.signal,
      turnPlan: plan
    })) {
      sendNdjson(response, event);
    }

    response.end();
  } catch (error) {
    if (error.name !== "AbortError") {
      sendNdjson(response, {
        type: "error",
        code: error.code ?? "brain_error",
        message: error.message
      });
    }
    if (!response.writableEnded) {
      response.end();
    }
  }
}

async function synthesizeTts(request, response, body) {
  const controller = new AbortController();
  const abortSynthesis = () => controller.abort();
  const abortOnClose = () => {
    if (!response.writableEnded) {
      abortSynthesis();
    }
  };
  request.once("aborted", abortSynthesis);
  response.once("close", abortOnClose);
  if (request.aborted) {
    abortSynthesis();
  }

  try {
    const audio = await synthesizeWindowsSpeech(body.text, {
      rate: body.rate,
      signal: controller.signal
    });
    if (
      controller.signal.aborted ||
      response.destroyed ||
      response.writableEnded
    ) {
      return;
    }
    response.writeHead(200, {
      "content-type": "audio/wav",
      "content-length": audio.length,
      "cache-control": "no-store"
    });
    response.end(audio);
  } catch (error) {
    if (error.name !== "AbortError") {
      throw error;
    }
  } finally {
    request.off("aborted", abortSynthesis);
    response.off("close", abortOnClose);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? host}`);

    if (request.method === "GET" && STATIC_ROUTES.has(url.pathname)) {
      const filename = STATIC_ROUTES.get(url.pathname);
      const body = await readFile(resolve(WEB_ROOT, filename));
      response.writeHead(200, {
        "content-type":
          CONTENT_TYPES[extname(filename)] ?? "application/octet-stream",
        "cache-control": "no-store"
      });
      response.end(body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        status: "ok",
        process: {
          runId: processRunId,
          startedAt: processStartedAt,
          runtimeFingerprint
        },
        brain: configuredBrain.provider,
        models: {
          interaction: brain.interactionModel,
          task: brain.taskModel
        },
        usage: {
          ...brain.getUsage(),
          requestLimit: brain.requestLimit
        },
        asr: asrHealth,
        vadControl: vadControlHealth,
        vadShadow: vadShadowHealth,
        interaction: {
          audioPipelineMaxFrames,
          endpoint: endpointConfig,
          effectfulFinalCommitGraceMs,
          criticalFinalCommitGraceMs,
          finalCommitGraceMs,
          mergeWindowMs,
          prefinalPolicy,
          vad: vadConfig
        },
        tts: ttsHealth
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/turn") {
      const body = await readJsonBody(request);
      await streamTurn(request, response, body);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/tts") {
      const body = await readJsonBody(request);
      await synthesizeTts(request, response, body);
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(response, 400, {
      error: "bad_request",
      message: error.message
    });
  }
});

const audioWebSocket =
  asrRuntime && asrHealth.state === "ready"
    ? attachAudioWebSocket({
        server,
        asrRuntime,
        effectfulFinalCommitGraceMs,
        criticalFinalCommitGraceMs,
        endpointConfig,
        finalCommitGraceMs,
        prefinalPolicy,
        mergeWindowMs,
        maxPipelineFrames: audioPipelineMaxFrames,
        vadControlRuntime:
          vadControlMode === "silero" ? vadShadowRuntime : null,
        vadShadowRuntime:
          vadShadowMode === "silero" ? vadShadowRuntime : null,
        vadConfig
      })
    : null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Encerrando Duplex Lab (${signal})...`);
  await audioWebSocket?.close().catch(() => {});
  await asrRuntime?.close().catch(() => {});
  await vadShadowRuntime?.close().catch(() => {});
  await closeWindowsSpeechSynthesizer({ drain: false }).catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

server.listen(port, host, () => {
  const wslIp = findPrivateIpv4();
  console.log(`Duplex Lab disponível em http://localhost:${port}`);
  if (wslIp) {
    console.log(`Acesso direto pelo Windows: http://${wslIp}:${port}`);
  }
  console.log(
    `Cérebro: ${configuredBrain.provider} ` +
      `(${brain.interactionModel} / ${brain.taskModel})`
  );
  console.log(
    vadControlMode === "silero"
      ? `VAD de controle (candidato): Silero ` +
        `${vadControlHealth.version} ` +
        `(p>=${vadControlHealth.threshold} × ` +
        `${vadControlHealth.onsetWindows})`
      : "VAD de controle: energia adaptativa"
  );
  console.log(
    vadShadowHealth.state === "ready"
      ? `VAD shadow: Silero ${vadShadowHealth.version} ` +
        `(p>=${vadShadowHealth.threshold} × ` +
        `${vadShadowHealth.onsetWindows})`
      : `VAD shadow: ${vadShadowHealth.state}`
  );
  console.log(
    ttsHealth.state === "ready"
      ? `TTS aquecido: ${ttsHealth.voice} (${ttsHealth.culture})`
      : `TTS: ${ttsHealth.state}`
  );
  console.log(
    asrHealth.state === "ready"
      ? `ASR local: ${asrHealth.model} aquecido (${asrHealth.workers} workers)`
      : `ASR local: ${asrHealth.state}`
  );
  console.log("Use Chromium/Chrome e, no primeiro teste, prefira fones.");
});
