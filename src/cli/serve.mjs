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
import { createExp0026SessionStore } from
  "../eval/exp-0026-session-store.mjs";
import {
  closeWindowsSpeechSynthesizer,
  prewarmWindowsSpeech,
  synthesizeWindowsSpeech
} from "../tts/windows-system-tts.mjs";
import { normalizarTextoParaFala } from "../tts/normalizar-texto-pt.mjs";
import {
  arbitrateTurn,
  createFastPathMemory,
  FAST_PATH_VERSION
} from "../interaction/fast-path.mjs";
import {
  extractPtBrCurrencyAmounts
} from "../interaction/ptbr-number.mjs";
import {
  fetchWeatherSummary,
  weatherIntent
} from "../tools/weather.mjs";
import {
  INTERACTION_KERNEL_VERSION
} from "../interaction/interaction-kernel.mjs";
import {
  createTurnCoordinator
} from "../interaction/turn-coordinator.mjs";
import {
  createSessionRecorder
} from "../observer/session-recorder.mjs";

await loadEnvFile();

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WEB_ROOT = resolve(PROJECT_ROOT, "web");
const processRunId = randomUUID();
const processStartedAt = new Date().toISOString();
const runtimeFingerprint = await createSourceFingerprint(PROJECT_ROOT, {
  roots: [
    "src",
    "web",
    "eval/experiments/exp-0026-experience-pack.pt-BR.json",
    "package.json",
    "package-lock.json",
    "requirements-asr.txt"
  ]
});
const localBrain = createLocalBrain();
const turnCoordinator = createTurnCoordinator({ planner: localBrain });
const configuredBrain = createConfiguredBrain({ planner: localBrain });
const brain = configuredBrain.brain;
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const host = process.env.HOST ?? "0.0.0.0";
const prefinalPolicy = normalizePrefinalPolicy(
  process.env.PREFINAL_POLICY
);
const fastPathEnabled = process.env.FAST_PATH === "1";
const fastPathMemory = createFastPathMemory();
// Programa de dados 1 (arbitragem textual): FASTPATH_LOG=arquivo.jsonl
// acumula {texto, decisão, contexto} de uso real para rotulagem posterior.
const fastPathLogPath = process.env.FASTPATH_LOG?.trim() || null;
async function appendFastPathLog(entry) {
  if (!fastPathLogPath) {
    return;
  }
  const { appendFile } = await import("node:fs/promises");
  await appendFile(
    fastPathLogPath,
    `${JSON.stringify(entry)}\n`
  ).catch(() => {});
}
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
// ASR_PARTIAL_ENGINE=kroko troca a perna de parciais para o transducer
// streaming PT (modelo local em KROKO_MODEL_DIR; venv em KROKO_PYTHON).
const asrPartialEngine =
  process.env.ASR_PARTIAL_ENGINE?.trim() || "whisper";
const asrFinalModel =
  process.env.ASR_FINAL_MODEL?.trim() ||
  (asrFinalEngine === "parakeet"
    // Promovido na candidata v1: TAGARELA int8 mediu 0,109 de divergência
    // média no CORAA (verdade humana) contra 0,322 do parakeet fp32 e
    // 0,452 do int8 genérico — além de matar o EN-drift e a crise de RAM.
    // O v3 genérico segue disponível por env (baseline v0.3 congelada).
    ? "calneymgp/parakeet-tdt-0.6b-v3-ptBR-TAGARELA-onnx-int8"
    : asrModel);
const asrRuntime = asrEnabled
  ? createCpuStreamingAsr({
      finalEngine: asrFinalEngine,
      finalModel: asrFinalModel,
      // ASR_FINAL_COMPUTE=fp32 remove a quantização SÓ da perna final
      // (parciais tiny continuam int8) — ver PDCA ASR ciclo 1.
      finalComputeType:
        process.env.ASR_FINAL_COMPUTE?.trim() || undefined,
      partialEngine: asrPartialEngine,
      partialModel: asrPartialModel,
      krokoModelDir: process.env.KROKO_MODEL_DIR?.trim() || undefined,
      krokoPython: process.env.KROKO_PYTHON?.trim() || undefined,
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
        ),
        // Teto do enunciado: decodes fp32 longos estouram RAM/event-loop
        // na máquina de 8 GB (sessão 091b: 12 s de queda de WS aos 138 s);
        // com a concatenação de fala retida, tetos menores custam ~zero.
        maxTurnMs: Number.parseInt(
          process.env.ASR_MAX_TURN_MS ?? "30000",
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
const ttsProviderEnv = process.env.TTS_PROVIDER?.trim().toLowerCase() ||
  "windows";
const ttsWarmup = ttsProviderEnv !== "windows"
  ? (async () => {
      // Health real: sem sidecar respondendo, o estado é error — nunca
      // "ready" por suposição.
      const sidecarUrl = process.env.TTS_SIDECAR_URL?.trim() ||
        (ttsProviderEnv === "pocket"
          ? "http://127.0.0.1:8321/tts"
          : ttsProviderEnv === "supertonic"
            ? "http://127.0.0.1:8341"
            : "http://127.0.0.1:8331");
      const healthUrl = ttsProviderEnv === "pocket"
        ? sidecarUrl.replace(/\/tts\/?$/u, "/health")
        : sidecarUrl;
      try {
        const probe = await fetch(healthUrl, {
          signal: AbortSignal.timeout(5_000)
        });
        if (!probe.ok) {
          throw new Error(`sidecar retornou HTTP ${probe.status}`);
        }
        ttsHealth = {
          state: "ready",
          engine: `${ttsProviderEnv}-sidecar`,
          voice: ttsProviderEnv === "pocket"
            ? "rafael"
            : ttsProviderEnv === "supertonic"
              ? process.env.SUPERTONIC_VOICE?.trim() || "F4"
              : "pt_BR-faber",
          culture: "pt-BR",
          sidecarUrl,
          primed: false
        };
      } catch (error) {
        ttsHealth = {
          state: "error",
          engine: `${ttsProviderEnv}-sidecar`,
          code: "tts_sidecar_unreachable",
          message: `${healthUrl}: ${error.message}`
        };
        console.error(
          `TTS sidecar ${ttsProviderEnv} indisponível: ${error.message}`
        );
      }
    })()
  : prewarmWindowsSpeech().then(
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

// Observador de experiência (OBSERVER=1): captura opt-in e local de uma
// sessão real (mic, sínteses, eventos, beacons) para escuta perceptiva e
// correlação técnica posteriores. Nunca altera o comportamento da engine.
const observador = process.env.OBSERVER === "1"
  ? await createSessionRecorder({
      root: resolve(
        PROJECT_ROOT,
        process.env.OBSERVER_DIR ?? "var/observador"
      ),
      meta: {
        processRunId,
        runtimeFingerprint,
        brain: configuredBrain.provider,
        models: {
          interaction: brain.interactionModel,
          task: brain.taskModel
        },
        fastPathEnabled,
        prefinalPolicy,
        endpoint: endpointConfig,
        finalCommitGraceMs,
        effectfulFinalCommitGraceMs,
        criticalFinalCommitGraceMs,
        mergeWindowMs,
        asr: asrHealth,
        vadControl: vadControlHealth,
        tts: ttsHealth
      }
    })
  : null;
if (observador) {
  console.log(
    `Observador ATIVO: gravando sessão em var/observador/${observador.pasta}`
  );
}

const exp0026Enabled = process.env.EXP0026_INSTRUMENT === "1";
const exp0026Store = exp0026Enabled
  ? await createExp0026SessionStore({
      projectRoot: PROJECT_ROOT,
      packPath: "eval/experiments/exp-0026-experience-pack.pt-BR.json",
      dataRoot:
        process.env.EXP0026_DATA_ROOT ??
        "eval/generated/exp-0026/private",
      role: process.env.EXP0026_SESSION_ROLE,
      participantAlias: process.env.EXP0026_PARTICIPANT_ALIAS,
      orderIndex: Number.parseInt(
        process.env.EXP0026_ORDER_INDEX ?? "",
        10
      ),
      rosterSlotId: process.env.EXP0026_ROSTER_SLOT_ID || null,
      commercialAvailable:
        process.env.EXP0026_COMMERCIAL_AVAILABLE === "1",
      processRunId,
      accessToken: process.env.EXP0026_ACCESS_TOKEN,
      withdrawalCode: process.env.EXP0026_WITHDRAWAL_CODE,
      runtimeSnapshot() {
        const usage = brain.getUsage();
        return {
          processRunId,
          runtimeFingerprint,
          brain: configuredBrain.provider,
          interactionModel: brain.interactionModel,
          taskModel: brain.taskModel,
          requests: usage.requests,
          requestLimit: brain.requestLimit,
          activeKernelSessions: turnCoordinator.sessionCount,
          asr: asrHealth,
          tts: ttsHealth
        };
      }
    })
  : null;

const STATIC_ROUTES = new Map([
  ["/", "index.html"],
  ["/absorcao-turno.mjs", "absorcao-turno.mjs"],
  ["/gate-entrada.mjs", "gate-entrada.mjs"],
  ["/exp-0026", "exp-0026/index.html"],
  ["/exp-0026/", "exp-0026/index.html"],
  ["/exp-0026/app.mjs", "exp-0026/app.mjs"],
  ["/exp-0026/styles.css", "exp-0026/styles.css"],
  ["/acoustic-reflex-checkpoint.json", "acoustic-reflex-checkpoint.json"],
  ["/acoustic-reflex-shadow.mjs", "acoustic-reflex-shadow.mjs"],
  [
    "/speaker-relevance-checkpoint.json",
    "speaker-relevance-checkpoint.json"
  ],
  ["/speaker-relevance-shadow.mjs", "speaker-relevance-shadow.mjs"],
  [
    "/context-relevance-checkpoint.json",
    "context-relevance-checkpoint.json"
  ],
  ["/context-relevance-shadow.mjs", "context-relevance-shadow.mjs"],
  ["/app.mjs", "app.mjs"],
  ["/observador-cliente.mjs", "observador-cliente.mjs"],
  ["/critical-conflict.mjs", "critical-conflict.mjs"],
  ["/interaction-browser-adapter.mjs", "interaction-browser-adapter.mjs"],
  ["/local-audio-reflex.mjs", "local-audio-reflex.mjs"],
  [
    "/output-interruption-lifecycle.mjs",
    "output-interruption-lifecycle.mjs"
  ],
  ["/pcm-capture-worklet.js", "pcm-capture-worklet.js"],
  ["/pcm-capture.mjs", "pcm-capture.mjs"],
  ["/pcm-dsp.mjs", "pcm-dsp.mjs"],
  ["/pcm-wire.mjs", "pcm-wire.mjs"],
  ["/speculative-turn.mjs", "speculative-turn.mjs"],
  ["/stream-utils.mjs", "stream-utils.mjs"],
  ["/training-trace-recorder.mjs", "training-trace-recorder.mjs"],
  ["/turn-taking.mjs", "turn-taking.mjs"],
  ["/styles.css", "styles.css"]
]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".webm": "audio/webm"
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
  if (
    typeof body.sessionId !== "string" ||
    !body.sessionId.trim() ||
    body.sessionId.length > 160
  ) {
    throw new TypeError("O campo sessionId é obrigatório.");
  }
  if (
    typeof body.turnId !== "string" ||
    !body.turnId.trim() ||
    body.turnId.length > 160
  ) {
    throw new TypeError("O campo turnId é obrigatório.");
  }
}

async function streamTurn(request, response, body) {
  validateTurn(body);

  // Estágios do challenger de resposta especulativa (exp/caminho-ouro):
  //  - "speculative": planeja sobre snapshot sem avançar o kernel e gera a
  //    resposta; o estado autoritativo só muda no commit.
  //  - "commit": avança o kernel (idempotente por turnId) sem gerar resposta,
  //    usado quando o stream especulativo é adotado pela final confirmada.
  //  - default: comportamento original (dispatch + resposta).
  const stage = body.stage === "speculative" || body.stage === "commit"
    ? body.stage
    : "full";

  // Tee do observador: todo evento NDJSON enviado ao cliente é gravado com
  // o mesmo payload + identidade do turno (sem alterar o que o cliente vê).
  const emit = (event) => {
    sendNdjson(response, event);
    observador?.evento("turno", {
      sessionId: body.sessionId,
      turnId: body.turnId,
      stage,
      ...event
    });
  };
  observador?.evento("turno", {
    type: "requisicao",
    sessionId: body.sessionId,
    turnId: body.turnId,
    stage,
    texto: body.text
  });

  if (stage === "commit") {
    const commit = turnCoordinator.commitTurn({
      sessionId: body.sessionId,
      turnId: body.turnId,
      text: body.text,
      expectedPreviousVersion: body.expectedPreviousVersion
    });
    response.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    });
    emit(commit.ok
      ? { type: "committed", ok: true, interaction: commit.transition }
      : {
          type: "committed",
          ok: false,
          reason: commit.reason,
          currentVersion: commit.currentVersion
        });
    response.end();
    return;
  }

  const plan = stage === "speculative"
    ? turnCoordinator.planTurnSpeculative({
        sessionId: body.sessionId,
        turnId: body.turnId,
        text: body.text
      })
    : turnCoordinator.planTurn({
        sessionId: body.sessionId,
        turnId: body.turnId,
        text: body.text
      });
  const mode = plan.mode;
  // Arbitragem da camada rápida (FAST_PATH=1): decisão pura ANTES de acionar
  // o reasoner — custo zero de latência serial. PASS mantém o fluxo original;
  // LOCAL_FINAL responde localmente sem chamar o provider; BRIDGE fala uma
  // ponte semântica imediata (sinal estruturado do kernel) enquanto o
  // reasoner gera, com contrato no-repeat no prompt.
  const fastPath = fastPathEnabled
    ? arbitrateTurn({
        text: body.text,
        plan,
        crossTurn: {
          lastAmount: fastPathMemory.lastAmount(body.sessionId),
          amounts: extractPtBrCurrencyAmounts(body.text)
            .map((item) => item.value)
            .filter(Number.isFinite)
        }
      })
    : null;
  // A memória observa só no estágio full (especulação não muta nada).
  if (fastPathEnabled && stage === "full") {
    fastPathMemory.observe(
      body.sessionId,
      body.text,
      extractPtBrCurrencyAmounts
    );
    void appendFastPathLog({
      at: new Date().toISOString(),
      sessionId: body.sessionId,
      text: body.text,
      decision: fastPath
        ? { action: fastPath.action, class: fastPath.class }
        : null,
      mode
    });
  }
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

  emit({
    type: "route",
    mode,
    semantic: plan.semantic ?? null,
    safety: plan.safety ?? null,
    interaction: plan.interaction,
    fastPath: fastPath
      ? { action: fastPath.action, class: fastPath.class }
      : null,
    acknowledgment: mode === "delegate" ? plan.acknowledgment : null,
    taskId: mode === "delegate" ? plan.task.id : null,
    query: mode === "delegate" ? plan.task.query : null
  });

  if (fastPath?.action === "LOCAL_FINAL") {
    emit({
      type: "started",
      responseId: null,
      model: FAST_PATH_VERSION
    });
    if (!controller.signal.aborted) {
      emit({ type: "delta", delta: fastPath.response });
      emit({
        type: "done",
        responseId: null,
        model: FAST_PATH_VERSION,
        usage: null
      });
    }
    response.end();
    return;
  }

  // Ponte semântica imediata: falada pelo cliente enquanto o reasoner
  // trabalha. O texto da ponte segue no request do reasoner (spokenPrefix)
  // para que a continuação não repita nem contradiga o que já foi dito.
  if (fastPath?.action === "BRIDGE") {
    emit({
      type: "bridge",
      text: fastPath.bridge,
      class: fastPath.class
    });
  }

  try {
    // Ferramenta real (RC v0.1): delegações com intenção de tempo executam
    // Open-Meteo de verdade — SOMENTE fora de especulação (effectsAllowed).
    // Especulativo cai no comportamento normal do cérebro, sem efeito.
    if (
      mode === "delegate" &&
      stage !== "speculative" &&
      weatherIntent(plan.task?.query ?? body.text)
    ) {
      emit({
        type: "started",
        responseId: null,
        model: "tool:open-meteo"
      });
      try {
        const summary = await fetchWeatherSummary(
          plan.task?.query ?? body.text,
          { signal: controller.signal }
        );
        emit({ type: "delta", delta: summary });
        emit({
          type: "done",
          responseId: null,
          model: "tool:open-meteo",
          usage: null
        });
        response.end();
        return;
      } catch (error) {
        if (error.name === "AbortError") {
          response.end();
          return;
        }
        emit({
          type: "delta",
          delta: "A consulta de tempo falhou; seguindo sem a ferramenta. "
        });
        // cai para o cérebro normal abaixo
      }
    }
    // Contrato do challenger: um turno especulativo NUNCA pode disparar
    // efeitos externos (ferramentas, ações, side-effects); este flag é a
    // autoridade que as desabilita até o commit/adoção.
    for await (const event of brain.streamTurn({
      text: plan.effectiveText ?? body.text,
      history: body.history,
      mode,
      signal: controller.signal,
      turnPlan: plan,
      speculative: stage === "speculative",
      effectsAllowed: stage !== "speculative",
      spokenPrefix: fastPath?.action === "BRIDGE"
        ? fastPath.bridge
        : null,
      // Ciclo continuação/interrupção: a resposta anterior foi cortada
      // pelo usuário — o cérebro integra o contexto interrompido.
      // FLAG até T4 (validação viva): a política pode confundir
      // complemento×correção×rejeição×cancelamento; sem exercício vivo,
      // fica fora do perfil da candidata (régua docs/CANDIDATA-V1.md §2).
      respostaInterrompida:
        process.env.CONTINUACAO_POS_INTERRUPCAO === "1" &&
        body.respostaInterrompida &&
        typeof body.respostaInterrompida.texto === "string" &&
        body.respostaInterrompida.texto.length <= 600
          ? body.respostaInterrompida
          : null
    })) {
      emit(event);
    }

    response.end();
  } catch (error) {
    if (error.name !== "AbortError") {
      emit({
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

// Challenger exp/caminho-ouro: TTS plugável. windows = worker SAPI original;
// pocket/piper = sidecars HTTP locais (Pocket TTS Kyutai transmite o WAV em
// streaming; repassamos os bytes assim que chegam).
const ttsProvider = process.env.TTS_PROVIDER?.trim().toLowerCase() ||
  "windows";
const ttsSidecarUrl = process.env.TTS_SIDECAR_URL?.trim() ||
  (ttsProvider === "pocket"
    ? "http://127.0.0.1:8321/tts"
    : ttsProvider === "supertonic"
      ? "http://127.0.0.1:8341"
      : "http://127.0.0.1:8331");

async function proxySidecarTts(request, response, body, controller, tee) {
  let upstream;
  if (ttsProvider === "pocket") {
    const form = new FormData();
    form.set("text", body.text);
    upstream = await fetch(ttsSidecarUrl, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
  } else {
    // Voz por requisição (seletor da plataforma): só o supertonic entende
    // ?voz=; valores fora de F1..F5/M1..M5 caem na voz padrão do sidecar.
    const alvo = ttsProvider === "supertonic" &&
      typeof body.voz === "string" && /^[FM][1-5]$/u.test(body.voz)
      ? `${ttsSidecarUrl}?voz=${body.voz}`
      : ttsSidecarUrl;
    upstream = await fetch(alvo, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: body.text,
      signal: controller.signal
    });
  }
  if (!upstream.ok) {
    throw new Error(`TTS sidecar retornou HTTP ${upstream.status}`);
  }
  // Modo streaming (GET ?stream=1): repassa os bytes do sidecar assim que
  // chegam — o navegador toca o WAV progressivamente e o primeiro áudio
  // audível deixa de esperar a síntese completa.
  if (body.stream) {
    if (response.destroyed || response.writableEnded) {
      return;
    }
    response.writeHead(200, {
      "content-type": "audio/wav",
      "cache-control": "no-store"
    });
    let interrompido = false;
    for await (const chunk of upstream.body) {
      if (response.destroyed || controller.signal.aborted) {
        interrompido = true;
        break;
      }
      tee?.pedaco(chunk);
      response.write(chunk);
    }
    tee?.concluir(null, interrompido ? { interrompido: true } : {});
    response.end();
    return;
  }
  // Modo bufferizado (POST): acumula e corrige os tamanhos RIFF que sidecars
  // de streaming deixam abertos (0/0xFFFFFFFF), mantendo o WAV compatível
  // com decodeWaveToPcm16 e com os harnesses.
  const chunks = [];
  for await (const chunk of upstream.body) {
    if (controller.signal.aborted) {
      tee?.concluir(Buffer.concat(chunks), { interrompido: true });
      return;
    }
    chunks.push(chunk);
  }
  const audio = Buffer.concat(chunks);
  if (audio.length >= 44 && audio.toString("ascii", 0, 4) === "RIFF") {
    audio.writeUInt32LE(audio.length - 8, 4);
    let offset = 12;
    while (offset + 8 <= audio.length) {
      const id = audio.toString("ascii", offset, offset + 4);
      const declared = audio.readUInt32LE(offset + 4);
      if (id === "data") {
        audio.writeUInt32LE(audio.length - offset - 8, offset + 4);
        break;
      }
      offset += 8 + declared + (declared % 2);
    }
  }
  tee?.concluir(Buffer.from(audio));
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.writeHead(200, {
    "content-type": "audio/wav",
    "content-length": audio.length,
    "cache-control": "no-store"
  });
  response.end(audio);
}

async function synthesizeTts(request, response, body) {
  // Números→extenso SÓ no texto falado; o texto exibido na UI e o campo
  // `texto` do observador continuam originais (dígitos).
  const textoFalado = normalizarTextoParaFala(body.text);
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

  // Tee do observador: arquiva o áudio sintetizado sob o uid gerado pelo
  // cliente — a chave que os beacons de reprodução usam depois.
  const tee = observador?.iniciarTts({
    uid: typeof body.uid === "string" && body.uid.length <= 80
      ? body.uid
      : null,
    texto: body.text,
    textoFalado,
    stream: Boolean(body.stream),
    provider: ttsProvider,
    voz: typeof body.voz === "string" && /^[FM][1-5]$/u.test(body.voz)
      ? body.voz
      : null
  }) ?? null;

  try {
    if (ttsProvider !== "windows") {
      await proxySidecarTts(
        request,
        response,
        { ...body, text: textoFalado },
        controller,
        tee
      );
      return;
    }
    const audio = await synthesizeWindowsSpeech(textoFalado, {
      rate: body.rate,
      signal: controller.signal
    });
    tee?.concluir(Buffer.from(audio));
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
    tee?.falhar(error);
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

    if (url.pathname.startsWith("/api/exp-0026/")) {
      if (!exp0026Store) {
        sendJson(response, 404, { error: "exp0026_instrument_disabled" });
        return;
      }
      await exp0026Store.handle(request, response, url);
      return;
    }

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
          authority: "backend-interaction-runtime",
          kernelVersion: INTERACTION_KERNEL_VERSION,
          activeKernelSessions: turnCoordinator.sessionCount,
          audioPipelineMaxFrames,
          endpoint: endpointConfig,
          effectfulFinalCommitGraceMs,
          criticalFinalCommitGraceMs,
          finalCommitGraceMs,
          mergeWindowMs,
          prefinalPolicy,
          vad: vadConfig
        },
        tts: ttsHealth,
        observador: observador === null
          ? { ativo: false }
          : { ativo: true, pasta: observador.pasta },
        evaluation: exp0026Store === null
          ? { exp0026: { enabled: false } }
          : {
              exp0026: {
                enabled: true,
                sessionId: exp0026Store.session.sessionId,
                role: exp0026Store.session.role,
                analysisEligibility:
                  exp0026Store.session.analysisEligibility
              }
            }
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

    // GET permite <audio src> com download progressivo (playback começa
    // antes da síntese terminar). Disponível apenas para sidecars.
    if (request.method === "GET" && url.pathname === "/api/tts") {
      const text = (url.searchParams.get("text") ?? "").trim();
      if (!text || text.length > 700) {
        sendJson(response, 400, { error: "invalid_text" });
        return;
      }
      if (ttsProvider === "windows") {
        sendJson(response, 400, { error: "stream_requires_sidecar" });
        return;
      }
      await synthesizeTts(request, response, {
        text,
        uid: url.searchParams.get("uid") ?? null,
        stream: url.searchParams.get("stream") === "1",
        voz: url.searchParams.get("voz") ?? null
      });
      return;
    }

    // Beacons do observador: reproduções, log da página e marcações
    // humanas enviados pelo cliente quando OBSERVER=1 (senão, no-op).
    if (
      request.method === "POST" &&
      url.pathname === "/api/observador/beacon"
    ) {
      const lote = await readJsonBody(request);
      observador?.beacon(lote, Date.now());
      sendJson(response, 200, { ok: true, ativo: observador !== null });
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
        // Ciclo 3: decode do final com N ms do enunciado anterior como
        // contexto (0 = desligado; ver var/observador/pdca-asr.md)
        finalContextMs: Number.parseInt(
          process.env.ASR_FINAL_CONTEXT_MS ?? "0",
          10
        ),
        maxPipelineFrames: audioPipelineMaxFrames,
        vadControlRuntime:
          vadControlMode === "silero" ? vadShadowRuntime : null,
        vadShadowRuntime:
          vadShadowMode === "silero" ? vadShadowRuntime : null,
        vadConfig,
        observador
      })
    : null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Encerrando Duplex Lab (${signal})...`);
  await observador?.fechar().catch(() => {});
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
      ? `VAD de controle: Silero ` +
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
