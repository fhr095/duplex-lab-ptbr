import { extractSpeechChunks, readNdjson } from "/stream-utils.mjs";
import {
  BrowserAudioRenderProbe,
  BrowserPcmCapture
} from "/pcm-capture.mjs";
import { encodePcmFrame } from "/pcm-wire.mjs";
import {
  createCriticalConflictClarification
} from "/critical-conflict.mjs";
import {
  projectInteractionTransition
} from "/interaction-browser-adapter.mjs";
import {
  LOCAL_AUDIO_REFLEX_MODES,
  LocalAudioReflex
} from "/local-audio-reflex.mjs";
import {
  ACOUSTIC_REFLEX_CLASSES,
  AcousticReflexShadow,
  acousticReflexTeacherLabel,
  isAcousticReflexDecisionPoint
} from "/acoustic-reflex-shadow.mjs";
import {
  OutputInterruptionLifecycle
} from "/output-interruption-lifecycle.mjs";
import {
  ACOUSTIC_REFLEX_TRACE_SLICE_VERSION,
  TrainingTraceRecorder
} from "/training-trace-recorder.mjs";
import {
  classifyPotentialBargeIn,
  isExplicitTaskCancellation
} from "/turn-taking.mjs";

const Recognition =
  window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
const pageParameters = new URLSearchParams(window.location.search);
const automationEnabled =
  pageParameters.get("automation") === "1" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);
const localAudioReflexMode =
  pageParameters.get("audioReflex") === LOCAL_AUDIO_REFLEX_MODES.IMMEDIATE
    ? LOCAL_AUDIO_REFLEX_MODES.IMMEDIATE
    : LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED;
const localAudioReflex = new LocalAudioReflex({
  mode: localAudioReflexMode
});
const outputInterruptionLifecycle = new OutputInterruptionLifecycle();
const AUTOMATION_AUDIT_PRE_ROLL_FRAMES = 100;
const AUTOMATION_AUDIT_POST_ROLL_FRAMES = 100;
const AUDIO_RECONNECT_DELAYS_MS = Object.freeze([100, 250, 500]);
const MAX_BROWSER_TELEMETRY_SAMPLES = 30_000;
let interactionSessionSequence = 0;

function createInteractionSessionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  interactionSessionSequence += 1;
  return [
    "browser",
    Date.now().toString(36),
    interactionSessionSequence.toString(36),
    Math.random().toString(36).slice(2)
  ].join("-");
}

const AUTOMATION_AUDIO_EVIDENCE_EVENTS = new Set([
  "audio.error",
  "audio.frames.dropped",
  "endpoint.committed",
  "endpoint.prefinal.cancelled",
  "endpoint.prefinal.started",
  "transcript.error",
  "transcript.final",
  "transcript.partial",
  "transcript.rejected",
  "user.speech.paused",
  "user.speech.resumed",
  "user.speech.started"
]);

function createVadShadowTelemetry() {
  return {
    health: { state: "unknown" },
    windowCount: 0,
    starts: [],
    ends: 0,
    resets: 0,
    errors: 0,
    observedSampleGaps: 0,
    lastSampleEnd: null,
    lastWindow: null,
    maximumQueueDepth: 0,
    inferenceMs: [],
    queueDelayMs: []
  };
}

const elements = {
  assistantText: document.querySelector("#assistantText"),
  brainLabel: document.querySelector("#brainLabel"),
  clearButton: document.querySelector("#clearButton"),
  demoButton: document.querySelector("#demoButton"),
  eventLog: document.querySelector("#eventLog"),
  interruptMetric: document.querySelector("#interruptMetric"),
  responseMetric: document.querySelector("#responseMetric"),
  startButton: document.querySelector("#startButton"),
  status: document.querySelector("#status"),
  statusDot: document.querySelector("#statusDot"),
  stopButton: document.querySelector("#stopButton"),
  stopMetric: document.querySelector("#stopMetric"),
  userText: document.querySelector("#userText")
};

const session = {
  active: false,
  activeTask: null,
  audioFlushWaiters: new Map(),
  audioFlushSequence: 0,
  audioPipelineTelemetry: null,
  audioReconnectPromise: null,
  audioReconnectCount: 0,
  audioDisconnectCount: 0,
  audioRecoveryPacingUntilMs: 0,
  audioLastFrameSentAtMs: null,
  audioTransportEpoch: 0,
  assistantAudio: null,
  assistantAudioSource: null,
  assistantAudioUrl: null,
  assistantPreparing: false,
  assistantSpeaking: false,
  asrAvailable: null,
  audioLevel: null,
  audioEpoch: 0,
  audioPumpActive: false,
  audioQueue: [],
  audioSocket: null,
  capture: null,
  captureTelemetry: null,
  endpointTimer: null,
  earlyBackchannelTurnIds: new Set(),
  finalText: "",
  finishCurrentAudio: null,
  history: [],
  backchannelCount: 0,
  dismissedPotentialCount: 0,
  interruptCount: 0,
  inputMode: null,
  lastEndpointCommittedAt: null,
  lastRenderStopEvidence: null,
  renderStopGeneration: 0,
  lastResponseAfterEndpointMs: null,
  lastSpeechEndedAt: null,
  mediaStream: null,
  pendingTaskResults: [],
  recognition: null,
  responseActive: false,
  responseAudioStarted: false,
  responseGeneration: 0,
  responseText: "",
  interactionSessionId: createInteractionSessionId(),
  interactionStateVersion: 0,
  interactionTurnSequence: 0,
  pendingConfirmation: null,
  semanticRevisions: [],
  semanticState: null,
  potentialBargeIn: null,
  assistantResumeReason: null,
  automationPcmAudit: {
    activeClip: null,
    clips: [],
    ring: []
  },
  audioRuntimeEvidence: [],
  acousticReflexShadow: {
    agreements: 0,
    decisions: 0,
    inferenceMs: [],
    labels: {}
  },
  acousticTraceStreamId: null,
  acousticTraceStreamSampleCount: null,
  acousticTraceStreamSequence: 0,
  speechBuffer: "",
  tentativePauseCount: 0,
  taskDeliveryTimer: null,
  trace: [],
  ttsAbortControllers: new Set(),
  turnAbortController: null,
  userSpeaking: false,
  vadControl: { state: "unknown" },
  vadControlTelemetry: null,
  vadShadow: createVadShadowTelemetry()
};

let runtimeTrainingConfigHash = `sha256:${"0".repeat(64)}`;
const trainingTraceRecorder = new TrainingTraceRecorder({
  sessionId: session.interactionSessionId,
  startedAtEpochMs: Date.now(),
  locale: "pt-BR",
  candidate: "duplex-lab-output-interruption-v0.1",
  configHash: runtimeTrainingConfigHash
});
const reflexTrainingTraceRecorder = new TrainingTraceRecorder({
  sessionId: session.interactionSessionId,
  startedAtEpochMs: Date.now(),
  locale: "pt-BR",
  candidate: "acoustic-reflex-shadow-m4a-v0.1",
  configHash: runtimeTrainingConfigHash,
  sliceVersion: ACOUSTIC_REFLEX_TRACE_SLICE_VERSION,
  limitations: [
    "somente replays PCM de automação possuem stream persistível e posição acústica",
    "candidato em shadow não possui autoridade nem produz efeitos"
  ],
  label: { task: "acoustic-reflex-intent" }
});
let acousticReflexShadow = null;
let acousticReflexShadowState = Object.freeze({
  state: "loading",
  authority: false
});

async function loadAcousticReflexShadow() {
  try {
    const response = await fetch("/acoustic-reflex-checkpoint.json");
    if (!response.ok) {
      throw new Error(`checkpoint retornou HTTP ${response.status}`);
    }
    acousticReflexShadow = new AcousticReflexShadow(await response.json());
    acousticReflexShadowState = acousticReflexShadow.snapshot;
    log(
      "acoustic-reflex-shadow.ready",
      `${acousticReflexShadowState.checkpointId} · sem autoridade`
    );
  } catch (error) {
    acousticReflexShadow = null;
    acousticReflexShadowState = Object.freeze({
      state: "error",
      authority: false,
      message: error.message
    });
    log("acoustic-reflex-shadow.error", error.message);
  }
}

function resetTrainingTraceRecorder() {
  const output = trainingTraceRecorder.reset({
    sessionId: session.interactionSessionId,
    startedAtEpochMs: Date.now(),
    locale: "pt-BR",
    candidate: "duplex-lab-output-interruption-v0.1",
    configHash: runtimeTrainingConfigHash
  });
  reflexTrainingTraceRecorder.reset({
    sessionId: session.interactionSessionId,
    startedAtEpochMs: Date.now(),
    locale: "pt-BR",
    candidate: "acoustic-reflex-shadow-m4a-v0.1",
    configHash: runtimeTrainingConfigHash,
    sliceVersion: ACOUSTIC_REFLEX_TRACE_SLICE_VERSION,
    limitations: [
      "somente replays PCM de automação possuem stream persistível e posição acústica",
      "candidato em shadow não possui autoridade nem produz efeitos"
    ],
    label: { task: "acoustic-reflex-intent" }
  });
  session.acousticTraceStreamId = null;
  session.acousticTraceStreamSampleCount = null;
  session.acousticReflexShadow = {
    agreements: 0,
    decisions: 0,
    inferenceMs: [],
    labels: {}
  };
  return output;
}

const MAX_SOCKET_BUFFER_BYTES = 256 * 1024;

function nowLabel(elapsed = performance.now()) {
  return `${(elapsed / 1000).toFixed(2)}s`;
}

function log(type, detail = "") {
  const atMs = performance.now();
  session.trace.push({
    atMs: Math.round(atMs * 100) / 100,
    type,
    detail
  });
  session.trace = session.trace.slice(
    automationEnabled ? -5_000 : -500
  );

  const item = document.createElement("li");
  item.innerHTML =
    `<time>${nowLabel(atMs)}</time><code>${type}</code><span></span>`;
  item.querySelector("span").textContent = detail;
  elements.eventLog.prepend(item);
}

function interruptionTrainingContext(previous) {
  return {
    assistantSpeaking: session.assistantSpeaking,
    assistantPreparing: session.assistantPreparing,
    responseActive: session.responseActive,
    audioQueueLength: session.audioQueue.length,
    hasAssistantAudio: Boolean(session.assistantAudio),
    userSpeaking: session.userSpeaking,
    hasPotentialBargeIn: Boolean(session.potentialBargeIn),
    lifecycle: { ...previous }
  };
}

function trainingEffectId(transition, effectType) {
  return transition.trainingTrace?.effects.find(
    (effect) => effect.effectType === effectType
  )?.effectId ?? null;
}

function markTrainingEffectId(
  effectId,
  stage,
  evidence = {},
  options = {}
) {
  if (!effectId) {
    return null;
  }
  try {
    return trainingTraceRecorder.recordEffectStage(effectId, {
      stage,
      atMs: options.atMs ?? performance.now(),
      evidence,
      reconciledByDecisionId:
        options.reconciledByDecisionId ?? null
    });
  } catch (error) {
    log("training-trace.effect.error", error.message);
    return null;
  }
}

function markTrainingEffect(transition, effectType, stage, evidence = {}) {
  return markTrainingEffectId(
    trainingEffectId(transition, effectType),
    stage,
    evidence
  );
}

function dispatchOutputInterruption(event, options = {}) {
  const previous = outputInterruptionLifecycle.snapshot;
  const atMs = performance.now();
  const transition = outputInterruptionLifecycle.dispatch(event);
  let trainingTrace = null;
  try {
    trainingTrace = trainingTraceRecorder.recordDecision({
      atMs,
      turnId: event.turnId ?? transition.state.turnId ?? null,
      epoch:
        event.outputEpoch ??
        event.currentOutputEpoch ??
        previous.outputEpoch ??
        session.audioEpoch,
      event: {
        type: `output-interruption.${event.type.toLowerCase()}`,
        source: options.source ?? "browser-output-runtime",
        payload: { lifecycleEvent: { ...event } }
      },
      context: {
        state: interruptionTrainingContext(previous)
      },
      policy: {
        id: "output-interruption-lifecycle",
        version: transition.lifecycleVersion,
        mode: "authority"
      },
      transition: {
        previousStateVersion: transition.previousStateVersion,
        stateVersion: transition.state.version,
        previousPhase: previous.phase,
        phase: transition.state.phase,
        reason: transition.reason
      },
      intents: transition.intents
    });
  } catch (error) {
    log("training-trace.decision.error", error.message);
  }
  if (
    transition.state.version !== previous.version ||
    transition.intents.length > 0 ||
    event.type !== "CLEAR"
  ) {
    log(
      "output-interruption.transition",
      JSON.stringify({
        lifecycleVersion: transition.lifecycleVersion,
        previousStateVersion: transition.previousStateVersion,
        stateVersion: transition.state.version,
        eventType: transition.eventType,
        event: { ...event },
        previousPhase: previous.phase,
        phase: transition.state.phase,
        reason: transition.reason,
        turnId: transition.state.turnId,
        outputEpoch: transition.state.outputEpoch,
        pauseKind: transition.state.pauseKind,
        resumeAttempt: transition.state.resumeAttempt,
        intents: transition.intents.map((intent) => ({ ...intent }))
      })
    );
  }
  return {
    ...transition,
    trainingTrace
  };
}

const assistantRenderProbe = new BrowserAudioRenderProbe({
  onEvent(event) {
    if (event.type === "assistant.render.probe.ready") {
      log(
        event.type,
        `${event.sampleRate} Hz · ` +
          `${event.outputTimestampAvailable ? "output timestamp" : "estimado"}`
      );
    } else if (event.type === "assistant.render.active") {
      log(
        event.type,
        `${event.mapping} · quantum não silencioso`
      );
    }
  }
});

function setStatus(status, mode = "idle") {
  elements.status.textContent = status;
  elements.statusDot.dataset.mode = mode;
}

function formatMs(value) {
  return `${Math.max(0, Math.round(value))} ms`;
}

function setListeningStatus() {
  if (session.userSpeaking) {
    setStatus("usuário falando", "user");
  } else if (session.assistantSpeaking) {
    setStatus("falando e ouvindo", "speaking");
  } else if (
    session.assistantPreparing ||
    session.audioQueue.length > 0
  ) {
    setStatus("preparando voz", "speaking");
  } else if (session.responseActive) {
    setStatus("pensando e ouvindo", "speaking");
  } else if (session.activeTask) {
    setStatus("ouvindo · tarefa em paralelo", "live");
  } else {
    setStatus(
      session.active ? "ouvindo" : "parado",
      session.active ? "live" : "idle"
    );
  }
}

function cleanupCurrentAudio() {
  const audio = session.assistantAudio;
  const source = session.assistantAudioSource;
  session.assistantAudio = null;
  session.assistantAudioSource = null;

  if (audio) {
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  assistantRenderProbe.disconnectSource(source);

  if (session.assistantAudioUrl) {
    URL.revokeObjectURL(session.assistantAudioUrl);
    session.assistantAudioUrl = null;
  }

  const finish = session.finishCurrentAudio;
  session.finishCurrentAudio = null;
  finish?.();
}

function clearPotentialBargeIn(reason = "cleared") {
  const potential = session.potentialBargeIn;
  if (potential?.timer) {
    clearTimeout(potential.timer);
  }
  const cleared = dispatchOutputInterruption(
    { type: "CLEAR", reason },
    { source: "browser-output-runtime" }
  );
  if (potential?.resumeEffectId) {
    markTrainingEffectId(
      potential.resumeEffectId,
      "cancelled",
      { reason },
      {
        reconciledByDecisionId: cleared.trainingTrace?.decisionId
      }
    );
    potential.resumeEffectId = null;
  }
  markTrainingEffect(cleared, "SETTLE_CLEARED", "dispatched", {
    reason
  });
  markTrainingEffect(cleared, "SETTLE_CLEARED", "completed", {
    resourceSettled: Boolean(potential)
  });
  session.potentialBargeIn = null;
  session.assistantResumeReason = null;
  potential?.settle?.({ kind: reason });
  if (localAudioReflex.snapshot.status !== "idle") {
    localAudioReflex.reset(reason);
  }
}

function releaseAssistantAudio() {
  clearPotentialBargeIn();
  session.audioEpoch += 1;
  for (const controller of session.ttsAbortControllers) {
    controller.abort();
  }
  session.ttsAbortControllers.clear();
  session.audioQueue = [];
  cleanupCurrentAudio();
  session.audioPumpActive = false;
  session.assistantPreparing = false;
  session.assistantSpeaking = false;
}

async function prepareSpeech(text, kind, epoch, options = {}) {
  const controller = new AbortController();
  session.ttsAbortControllers.add(controller);

  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`TTS retornou HTTP ${response.status}`);
    }

    return {
      blob: await response.blob(),
      epoch,
      kind,
      loop: options.loop === true,
      taskId: options.taskId ?? null,
      taskResultDelivery: options.taskResultDelivery ?? null,
      taskResultChunkCount: options.taskResultChunkCount ?? null,
      taskResultChunkIndex: options.taskResultChunkIndex ?? null,
      taskResultReadyAt: options.taskResultReadyAt ?? null,
      semantic: session.semanticState === null
        ? null
        : { ...session.semanticState },
      text
    };
  } finally {
    session.ttsAbortControllers.delete(controller);
  }
}

async function playPreparedSpeech(item) {
  if (item.epoch !== session.audioEpoch) {
    return;
  }
  const pendingBargeIn = session.potentialBargeIn;
  if (pendingBargeIn) {
    await pendingBargeIn.settledPromise;
    if (item.epoch !== session.audioEpoch) {
      return;
    }
  }

  const audioUrl = URL.createObjectURL(item.blob);
  const audio = new Audio(audioUrl);
  audio.loop = item.loop === true;
  let audioSource = null;
  try {
    audioSource = await assistantRenderProbe.attachMediaElement(audio);
  } catch (error) {
    log("assistant.render.probe.error", error.message);
  }
  if (item.epoch !== session.audioEpoch) {
    assistantRenderProbe.disconnectSource(audioSource);
    URL.revokeObjectURL(audioUrl);
    return;
  }
  session.assistantAudio = audio;
  session.assistantAudioSource = audioSource;
  session.assistantAudioUrl = audioUrl;
  session.assistantPreparing = false;

  await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      session.finishCurrentAudio = null;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    session.finishCurrentAudio = () => settle();
    audio.onplaying = () => {
      if (
        session.potentialBargeIn?.audio === audio &&
        ["held", "confirmed"].includes(
          outputInterruptionLifecycle.snapshot.phase
        )
      ) {
        audio.pause();
        session.assistantSpeaking = false;
        session.assistantResumeReason = null;
        log(
          "assistant.speech.resume.blocked",
          outputInterruptionLifecycle.snapshot.phase
        );
        return;
      }
      const startedAt = performance.now();
      const resumedPotential = session.potentialBargeIn;
      if (
        resumedPotential?.audio === audio &&
        resumedPotential.resumeEffectId &&
        !resumedPotential.resumeAudibleObserved
      ) {
        markTrainingEffectId(
          resumedPotential.resumeEffectId,
          "audible",
          { event: "HTMLMediaElement.onplaying" }
        );
        resumedPotential.resumeAudibleObserved = true;
      }
      session.assistantSpeaking = true;
      setStatus("falando e ouvindo", "speaking");
      if (session.assistantResumeReason) {
        log("assistant.speech.resumed", session.assistantResumeReason);
        session.assistantResumeReason = null;
      } else {
        log("assistant.speech.started", item.kind);
      }
      log(
        "assistant.utterance.started",
        JSON.stringify({
          kind: item.kind,
          text: item.text,
          semantic: item.semantic
        })
      );

      if (
        item.kind === "delegated-result" &&
        Number.isFinite(item.taskResultReadyAt)
      ) {
        log(
          "task.result.audible",
          `${item.taskId ?? "task"} · pronto→voz ` +
            `${formatMs(startedAt - item.taskResultReadyAt)}`
        );
      } else if (
        !session.responseAudioStarted &&
        session.lastSpeechEndedAt !== null
      ) {
        session.responseAudioStarted = true;
        const endToResponseMs = startedAt - session.lastSpeechEndedAt;
        session.lastResponseAfterEndpointMs =
          session.lastEndpointCommittedAt === null
            ? null
            : startedAt - session.lastEndpointCommittedAt;
        elements.responseMetric.textContent = formatMs(endToResponseMs);
        log(
          "assistant.response.audible",
          `fim→voz ${formatMs(endToResponseMs)}` +
            (session.lastResponseAfterEndpointMs === null
              ? ""
              : ` · endpoint→voz ${formatMs(
                  session.lastResponseAfterEndpointMs
                )}`)
        );
      }
    };
    audio.onended = () => settle();
    audio.onerror = () => settle(new Error("audio-playback-failed"));
    audio.play().catch(settle);
  });
}

async function pumpSpeechQueue(epoch) {
  if (session.audioPumpActive) {
    return;
  }
  session.audioPumpActive = true;

  try {
    while (epoch === session.audioEpoch && session.audioQueue.length > 0) {
      const queued = session.audioQueue.shift();
      session.assistantPreparing = true;
      setStatus("preparando voz", "speaking");

      try {
        const preparedResult = await queued.preparation;
        if (preparedResult.error) {
          throw preparedResult.error;
        }
        const prepared = preparedResult.value;
        if (epoch !== session.audioEpoch) {
          return;
        }
        await playPreparedSpeech(prepared);
        if (epoch !== session.audioEpoch) {
          return;
        }
        cleanupCurrentAudio();
        session.assistantSpeaking = false;
        log("assistant.speech.finished", prepared.kind);
        if (
          prepared.kind === "delegated-result" &&
          prepared.taskResultDelivery
        ) {
          prepared.taskResultDelivery.completed += 1;
          if (
            !prepared.taskResultDelivery.failed &&
            prepared.taskResultDelivery.completed ===
              prepared.taskResultDelivery.total
          ) {
            log(
              "task.result.delivered",
              `${prepared.taskId ?? "task"} · ` +
                `${prepared.taskResultChunkCount} bloco(s) · ` +
                `pronto→fim ${formatMs(
                  performance.now() - prepared.taskResultReadyAt
                )}`
            );
          }
        }
      } catch (error) {
        if (queued.taskResultDelivery) {
          queued.taskResultDelivery.failed = true;
        }
        cleanupCurrentAudio();
        session.assistantSpeaking = false;
        if (error.name !== "AbortError" && epoch === session.audioEpoch) {
          log("assistant.speech.error", error.message);
          if (queued.kind === "delegated-result") {
            log(
              "task.result.delivery.error",
              `${queued.taskId ?? "task"} · ${error.message}`
            );
          }
        }
      }
    }
  } finally {
    if (epoch === session.audioEpoch) {
      session.audioPumpActive = false;
      session.assistantPreparing = false;
      session.assistantSpeaking = false;
      setListeningStatus();
      schedulePendingTaskResult();
    }
  }
}

function enqueueSpeech(text, kind = "direct", options = {}) {
  const normalized = text.trim();
  if (!normalized) {
    return;
  }

  const epoch = session.audioEpoch;
  session.assistantPreparing = true;
  session.audioQueue.push({
    kind,
    taskId: options.taskId ?? null,
    taskResultDelivery: options.taskResultDelivery ?? null,
    preparation: prepareSpeech(normalized, kind, epoch, options).then(
      (value) => ({ value }),
      (error) => ({ error })
    )
  });
  void pumpSpeechQueue(epoch);
}

function queueCompleteText(text, kind, options = {}) {
  const { chunks } = extractSpeechChunks(text, { flush: true });
  const taskResultDelivery = kind === "delegated-result"
    ? {
        completed: 0,
        failed: false,
        total: chunks.length
      }
    : null;
  for (const [index, chunk] of chunks.entries()) {
    enqueueSpeech(chunk, kind, {
      ...options,
      taskResultDelivery,
      taskResultChunkCount:
        kind === "delegated-result" ? chunks.length : null,
      taskResultChunkIndex:
        kind === "delegated-result" ? index : null
    });
  }
}

function schedulePendingTaskResult(delayMs = 80) {
  clearTimeout(session.taskDeliveryTimer);
  session.taskDeliveryTimer = null;
  if (session.pendingTaskResults.length === 0 || !session.active) {
    return;
  }
  const blocked =
    session.userSpeaking ||
    session.responseActive ||
    Boolean(session.potentialBargeIn) ||
    session.assistantPreparing ||
    session.assistantSpeaking ||
    session.audioQueue.length > 0;
  if (blocked) {
    session.taskDeliveryTimer = setTimeout(
      schedulePendingTaskResult,
      delayMs
    );
    return;
  }

  const result = session.pendingTaskResults.shift();
  const offeredAt = performance.now();
  elements.assistantText.textContent = result.text;
  appendHistory("assistant", result.text);
  log("task.result", result.id);
  queueCompleteText(result.text, "delegated-result", {
    taskId: result.id,
    taskResultReadyAt: result.readyAt
  });
  log(
    "task.result.offered",
    `${result.id} · pronto→janela ${formatMs(
      offeredAt - result.readyAt
    )}`
  );
}

function speakStandalone(text, kind = "direct") {
  cancelActiveResponse("probe manual");
  releaseAssistantAudio();
  session.lastRenderStopEvidence = null;
  session.renderStopGeneration += 1;
  session.responseAudioStarted = false;
  elements.assistantText.textContent = text;
  queueCompleteText(text, kind);
}

function speakLoopingStandalone(text, kind = "automation-probe") {
  const normalized = String(text ?? "").trim();
  if (!normalized || normalized.length > 700) {
    throw new RangeError(
      "fala em loop precisa conter entre 1 e 700 caracteres"
    );
  }
  cancelActiveResponse("probe manual em loop");
  releaseAssistantAudio();
  session.lastRenderStopEvidence = null;
  session.renderStopGeneration += 1;
  session.responseAudioStarted = false;
  elements.assistantText.textContent = normalized;
  enqueueSpeech(normalized, kind, { loop: true });
}

function appendHistory(role, content) {
  session.history.push({ role, content });
  session.history = session.history.slice(-12);
}

function cancelActiveResponse(reason) {
  if (!session.responseActive) {
    return;
  }

  session.turnAbortController?.abort();
  session.turnAbortController = null;
  session.responseActive = false;
  session.responseGeneration += 1;
  session.speechBuffer = "";
  log("turn.cancelled", reason);
}

function cancelActiveTask(reason, options = {}) {
  const task =
    session.activeTask ??
    session.pendingTaskResults.at(-1) ??
    null;
  if (!task) {
    return false;
  }
  if (session.activeTask === task) {
    session.activeTask = null;
    task.controller.abort();
  } else {
    session.pendingTaskResults =
      session.pendingTaskResults.filter(
        (result) => result.id !== task.id
      );
  }
  clearTimeout(session.taskDeliveryTimer);
  session.taskDeliveryTimer = null;
  log("task.cancelled", `${task.id} · ${reason}`);

  if (options.acknowledge === true) {
    releaseAssistantAudio();
    const acknowledgment = "Certo, cancelei.";
    elements.assistantText.textContent = acknowledgment;
    queueCompleteText(acknowledgment, "task-cancellation");
  }
  setListeningStatus();
  return true;
}

function handleExplicitTaskCancellation(text) {
  if (
    !session.activeTask &&
    session.pendingTaskResults.length === 0
  ) {
    return false;
  }
  if (!isExplicitTaskCancellation(text)) {
    return false;
  }
  appendHistory("user", text);
  const cancelled = cancelActiveTask(text, {
    acknowledge: true
  });
  if (cancelled) {
    appendHistory("assistant", "Certo, cancelei.");
  }
  return cancelled;
}

function interruptAssistant() {
  const hadAudibleOutput = session.assistantSpeaking === true;
  const hadAcousticOutput =
    session.assistantPreparing ||
    session.assistantSpeaking ||
    Boolean(session.assistantAudio) ||
    session.audioQueue.length > 0;
  const hadActiveResponse = session.responseActive;

  if (!hadAcousticOutput && !hadActiveResponse) {
    return;
  }

  const requestedAt = performance.now();
  const renderStopGeneration = session.renderStopGeneration + 1;
  session.renderStopGeneration = renderStopGeneration;
  session.lastRenderStopEvidence = null;
  const renderStopPromise =
    session.assistantSpeaking && session.assistantAudioSource
      ? assistantRenderProbe.measureStop(requestedAt)
      : null;
  releaseAssistantAudio();
  cancelActiveResponse("nova fala do usuário");

  if (hadAudibleOutput) {
    session.interruptCount += 1;
    elements.interruptMetric.textContent = String(session.interruptCount);

    requestAnimationFrame(() => {
      const commandLatency = performance.now() - requestedAt;
      elements.stopMetric.textContent = formatMs(commandLatency);
      log(
        "assistant.speech.stopped",
        `comando em ${formatMs(commandLatency)}`
      );
    });

    if (renderStopPromise) {
      void renderStopPromise.then(
        (evidence) => {
          if (session.renderStopGeneration !== renderStopGeneration) {
            return;
          }
          session.lastRenderStopEvidence = evidence;
          log(
            "assistant.render.stopped",
            `último quantum em ${formatMs(evidence.latencyMs)} · ` +
              evidence.mapping
          );
        },
        (error) => {
          if (session.renderStopGeneration === renderStopGeneration) {
            log("assistant.render.stop.error", error.message);
          }
        }
      );
    }
  } else if (hadAcousticOutput) {
    log(
      "assistant.preparation.cancelled",
      "voz ainda não havia começado"
    );
  }
}

function acousticReflexAudioPosition(event) {
  if (
    session.acousticTraceStreamId === null ||
    !Number.isSafeInteger(session.acousticTraceStreamSampleCount)
  ) {
    return null;
  }
  const sampleStart = event.type === "USER_SPEECH_STARTED"
    ? event.triggerSampleStart
    : event.type === "VAD_CONTROL_WINDOW"
      ? event.sampleStart
      : event.triggerSampleStart;
  if (
    !Number.isSafeInteger(sampleStart) ||
    sampleStart < 0 ||
    sampleStart >= session.acousticTraceStreamSampleCount
  ) {
    return null;
  }
  return {
    streamId: session.acousticTraceStreamId,
    sampleStart,
    sampleEnd: Math.min(
      session.acousticTraceStreamSampleCount,
      sampleStart + 512
    )
  };
}

function observeAcousticReflexShadow(
  previous,
  event,
  transition,
  sourceEvent
) {
  if (
    acousticReflexShadow === null ||
    !isAcousticReflexDecisionPoint(previous, event)
  ) {
    return null;
  }
  const teacherLabel = acousticReflexTeacherLabel(
    previous,
    event,
    transition
  );
  if (teacherLabel === null) {
    return null;
  }
  const startedAtMs = performance.now();
  const prediction = acousticReflexShadow.predict(previous, event);
  const completedAtMs = performance.now();
  const inferenceMs = completedAtMs - startedAtMs;
  const telemetry = session.acousticReflexShadow;
  telemetry.decisions += 1;
  telemetry.agreements += prediction.proposal === teacherLabel ? 1 : 0;
  telemetry.inferenceMs.push(inferenceMs);
  telemetry.inferenceMs = telemetry.inferenceMs.slice(-5_000);
  telemetry.labels[prediction.proposal] =
    (telemetry.labels[prediction.proposal] ?? 0) + 1;
  log(
    "acoustic-reflex-shadow.proposed",
    JSON.stringify({
      proposal: prediction.proposal,
      teacherLabel,
      agreement: prediction.proposal === teacherLabel,
      inferenceMs: Math.round(inferenceMs * 1_000) / 1_000,
      authority: false
    })
  );

  const audioPosition = acousticReflexAudioPosition(event);
  if (audioPosition === null) {
    return prediction;
  }
  try {
    const rankedOutputs = ACOUSTIC_REFLEX_CLASSES.map((type) => ({
      type,
      origin: "acoustic-reflex-shadow",
      probability: prediction.probabilities[type]
    })).sort((left, right) => right.probability - left.probability);
    reflexTrainingTraceRecorder.recordDecision({
      atMs: completedAtMs,
      turnId: event.turnId ?? null,
      epoch: session.audioEpoch,
      event: {
        type: `local-audio-reflex.${event.type.toLowerCase()}`,
        source: sourceEvent.detector ?? "browser-audio-runtime",
        audioPosition,
        payload: {
          reflexEvent: { ...event },
          sourceEventType: sourceEvent.type ?? null,
          sourceEventAtMs: sourceEvent.atMs ?? null
        }
      },
      context: {
        state: {
          assistantAudible: session.assistantSpeaking,
          assistantPending:
            session.assistantPreparing || session.responseActive,
          localAudioReflex: previous,
          features: {
            version: prediction.features.featureVersion,
            names: prediction.features.names,
            values: prediction.features.values
          }
        }
      },
      policy: {
        id: "acoustic-reflex-shadow",
        version: `checkpoint-${prediction.modelSha256}`,
        mode: "shadow"
      },
      proposal: prediction.proposal,
      intents: rankedOutputs,
      transition: {
        teacherLabel,
        teacherReason: transition.reason,
        teacherPreviousStateVersion: transition.previousStateVersion,
        teacherStateVersion: transition.state.version,
        inferenceMs
      },
      label: {
        value: teacherLabel,
        source: {
          kind: "deterministic-invariant",
          ref: "local-audio-reflex",
          version: transition.reflexVersion
        }
      }
    });
  } catch (error) {
    log("acoustic-reflex-trace.decision.error", error.message);
  }
  return prediction;
}

function dispatchLocalAudioReflex(reflexEvent, sourceEvent = {}) {
  const event = reflexEvent.type === "USER_SPEECH_STARTED"
    ? {
        ...reflexEvent,
        assistantAudible: session.assistantSpeaking,
        assistantPending:
          session.assistantPreparing ||
          session.assistantSpeaking ||
          Boolean(session.assistantAudio) ||
          session.audioQueue.length > 0 ||
          session.responseActive
      }
    : reflexEvent;
  const previous = localAudioReflex.snapshot;
  const transition = localAudioReflex.dispatch(event);
  try {
    observeAcousticReflexShadow(
      previous,
      event,
      transition,
      sourceEvent
    );
  } catch (error) {
    log("acoustic-reflex-shadow.inference.error", error.message);
  }
  for (const intent of transition.intents) {
    if (intent.type === "WAIT_FOR_EVIDENCE") {
      log(
        "local-audio-reflex.armed",
        JSON.stringify({
          mode: localAudioReflexMode,
          reason: intent.reason,
          turnId: intent.turnId,
          ...intent.evidence
        })
      );
    } else if (intent.type === "PAUSE_OUTPUT") {
      log(
        "local-audio-reflex.pause",
        JSON.stringify({
          mode: localAudioReflexMode,
          reason: intent.reason,
          turnId: intent.turnId,
          ...intent.evidence
        })
      );
      pauseAssistantForPotentialBargeIn(sourceEvent);
    } else if (intent.type === "CONTINUE_OUTPUT") {
      log(
        "local-audio-reflex.suppressed",
        JSON.stringify({
          mode: localAudioReflexMode,
          reason: intent.reason,
          turnId: intent.turnId,
          ...intent.evidence
        })
      );
    } else if (intent.type === "SUPPRESS_TRANSCRIPT") {
      log(
        "local-audio-reflex.transcript-suppressed",
        JSON.stringify({
          mode: localAudioReflexMode,
          reason: intent.reason,
          turnId: intent.turnId,
          ...intent.evidence
        })
      );
    }
  }
  return transition;
}

function pauseAssistantForPotentialBargeIn(event = {}) {
  const hadAudibleOutput = session.assistantSpeaking === true;
  const hadAcousticOutput =
    session.assistantPreparing ||
    session.assistantSpeaking ||
    Boolean(session.assistantAudio) ||
    session.audioQueue.length > 0;
  const hadActiveResponse = session.responseActive;
  const transition = dispatchOutputInterruption(
    {
      type: "PAUSE_REQUESTED",
      turnId: event.turnId ?? null,
      outputEpoch: session.audioEpoch,
      hasAudibleOutput: hadAudibleOutput,
      hasAcousticOutput: hadAcousticOutput,
      hasActiveResponse: hadActiveResponse
    },
    { source: "local-audio-reflex" }
  );
  const intentTypes = new Set(
    transition.intents.map((intent) => intent.type)
  );
  const current = session.potentialBargeIn;

  if (
    intentTypes.has("KEEP_OUTPUT_HELD") ||
    intentTypes.has("CANCEL_RESUME_AND_PAUSE")
  ) {
    if (!current) {
      for (const effect of transition.trainingTrace?.effects ?? []) {
        markTrainingEffectId(effect.effectId, "cancelled", {
          reason: "missing-hold-resource"
        });
      }
      log(
        "output-interruption.invariant.error",
        "lifecycle ativo sem recurso de hold"
      );
      dispatchOutputInterruption({
        type: "CLEAR",
        reason: "missing-hold-resource"
      });
      return;
    }
    current.turnId ??= event.turnId ?? null;
    clearTimeout(current.timer);
    current.timer = null;
    if (intentTypes.has("CANCEL_RESUME_AND_PAUSE")) {
      if (current.resumeEffectId) {
        markTrainingEffectId(current.resumeEffectId, "cancelled", {
          reason: "speech-during-resume"
        }, {
          reconciledByDecisionId: transition.trainingTrace?.decisionId
        });
        current.resumeEffectId = null;
        current.resumeAudibleObserved = false;
      }
      markTrainingEffect(
        transition,
        "CANCEL_RESUME_AND_PAUSE",
        "dispatched",
        { command: "HTMLMediaElement.pause" }
      );
      current.audio?.pause();
      markTrainingEffect(
        transition,
        "CANCEL_RESUME_AND_PAUSE",
        "player-received",
        { paused: current.audio?.paused ?? true }
      );
      markTrainingEffect(
        transition,
        "CANCEL_RESUME_AND_PAUSE",
        "completed",
        { resumeInvalidated: true }
      );
      session.assistantResumeReason = null;
      session.assistantSpeaking = false;
      log("barge-in.resume.cancelled", "nova fala detectada");
    } else {
      markTrainingEffect(
        transition,
        "KEEP_OUTPUT_HELD",
        "dispatched",
        { holdResourcePresent: true }
      );
      markTrainingEffect(
        transition,
        "KEEP_OUTPUT_HELD",
        "completed",
        { outputRemainedHeld: true }
      );
    }
    schedulePotentialBargeInTimeout(
      "timeout de segurança durante fala",
      30_000
    );
    return;
  }

  const shouldCreateHold =
    intentTypes.has("PAUSE_OUTPUT") ||
    intentTypes.has("HOLD_OUTPUT");
  if (!shouldCreateHold) {
    return;
  }

  if (current) {
    clearTimeout(current.timer);
    current.settle({ kind: "replaced-inconsistent-hold" });
    session.potentialBargeIn = null;
    log(
      "output-interruption.invariant.error",
      "recurso de hold substituído pelo lifecycle"
    );
  }

  const requestedAt = performance.now();
  const renderStopGeneration = session.renderStopGeneration + 1;
  session.renderStopGeneration = renderStopGeneration;
  session.lastRenderStopEvidence = null;
  const epoch = session.audioEpoch;
  const audio = session.assistantAudio;
  const pauseEffectId = trainingEffectId(
    transition,
    hadAudibleOutput ? "PAUSE_OUTPUT" : "HOLD_OUTPUT"
  );
  const renderStopPromise =
    session.assistantSpeaking && session.assistantAudioSource
      ? assistantRenderProbe.measureStop(requestedAt)
      : null;
  if (hadAudibleOutput) {
    markTrainingEffectId(pauseEffectId, "dispatched", {
      command: "HTMLMediaElement.pause"
    });
  }
  if (audio && !audio.paused) {
    audio.pause();
  }
  if (hadAudibleOutput) {
    markTrainingEffectId(pauseEffectId, "player-received", {
      audioPresent: Boolean(audio),
      paused: audio?.paused ?? null
    });
  }
  session.assistantSpeaking = false;
  let settle;
  const settledPromise = new Promise((resolve) => {
    settle = resolve;
  });
  const potentialResource = {
    audio,
    epoch,
    requestedAt,
    turnId: event.turnId ?? null,
    userPausedAt: null,
    timer: null,
    pauseEffectId,
    pauseEffectTerminal: !pauseEffectId,
    resumeEffectId: null,
    resumeAudibleObserved: false,
    settle,
    settledPromise
  };
  session.potentialBargeIn = potentialResource;
  schedulePotentialBargeInTimeout(
    "timeout de segurança durante fala",
    30_000
  );

  if (!hadAudibleOutput) {
    markTrainingEffectId(pauseEffectId, "dispatched", {
      holdResourceInstalled: true
    });
    markTrainingEffectId(pauseEffectId, "completed", {
      outputBlockedBeforePlayback: true
    });
    potentialResource.pauseEffectTerminal = true;
  }

  if (hadAudibleOutput) {
    session.tentativePauseCount += 1;
    requestAnimationFrame(() => {
      const commandLatency = performance.now() - requestedAt;
      elements.stopMetric.textContent = formatMs(commandLatency);
      log(
        "assistant.speech.paused",
        `barge-in pendente · comando em ${formatMs(commandLatency)}`
      );
    });
  } else if (hadAcousticOutput) {
    log(
      "assistant.preparation.held",
      "barge-in pendente antes do primeiro áudio"
    );
  }

  if (renderStopPromise) {
    void renderStopPromise.then(
      (evidence) => {
        if (
          session.renderStopGeneration !== renderStopGeneration ||
          potentialResource.pauseEffectTerminal
        ) {
          return;
        }
        session.lastRenderStopEvidence = evidence;
        markTrainingEffectId(pauseEffectId, "renderer-silent", {
          kind: evidence.kind,
          latencyMs: evidence.latencyMs,
          mapping: evidence.mapping
        });
        markTrainingEffectId(pauseEffectId, "completed", {
          observation: "browser-render-stop"
        });
        potentialResource.pauseEffectTerminal = true;
        log(
          "assistant.render.stopped",
          `último quantum em ${formatMs(evidence.latencyMs)} · ` +
            evidence.mapping
        );
      },
      (error) => {
        if (session.renderStopGeneration === renderStopGeneration) {
          log("assistant.render.stop.error", error.message);
        }
      }
    );
  }
}

function schedulePotentialBargeInTimeout(reason, delayMs = 5_000) {
  const potential = session.potentialBargeIn;
  if (!potential) {
    return;
  }
  clearTimeout(potential.timer);
  potential.timer = setTimeout(() => {
    if (
      session.potentialBargeIn !== potential ||
      outputInterruptionLifecycle.snapshot.phase !== "held"
    ) {
      return;
    }
    if (session.userSpeaking) {
      schedulePotentialBargeInTimeout(reason, 5_000);
      return;
    }
    void dismissPotentialBargeIn(reason);
  }, delayMs);
}

async function dismissPotentialBargeIn(reason) {
  const potential = session.potentialBargeIn;
  const hasResumableAudio = Boolean(
    potential &&
    potential.epoch === session.audioEpoch &&
    potential.audio &&
    session.assistantAudio === potential.audio
  );
  const transition = dispatchOutputInterruption(
    {
      type: "DISMISS_REQUESTED",
      currentOutputEpoch: session.audioEpoch,
      hasResumableAudio
    },
    { source: "browser-turn-taking" }
  );
  const resumeIntent = transition.intents.find(
    (intent) => intent.type === "RESUME_OUTPUT"
  );
  const settleWithoutResume = transition.intents.some(
    (intent) => intent.type === "SETTLE_WITHOUT_RESUME"
  );
  if (!resumeIntent && !settleWithoutResume) {
    return false;
  }
  if (!potential) {
    log(
      "output-interruption.invariant.error",
      "dismiss sem recurso de hold"
    );
    return false;
  }
  clearTimeout(potential.timer);
  potential.timer = null;
  log("barge-in.dismissed", reason);
  session.dismissedPotentialCount += 1;

  if (settleWithoutResume) {
    markTrainingEffect(
      transition,
      "SETTLE_WITHOUT_RESUME",
      "dispatched",
      { reason }
    );
    if (session.potentialBargeIn === potential) {
      session.potentialBargeIn = null;
    }
    potential.settle({ kind: "dismissed-without-audio" });
    localAudioReflex.reset("dismissed-without-audio");
    markTrainingEffect(
      transition,
      "SETTLE_WITHOUT_RESUME",
      "completed",
      { resourceSettled: true }
    );
    setListeningStatus();
    return true;
  }

  const resumeAttempt = resumeIntent.resumeAttempt;
  const resumeEffectId = trainingEffectId(
    transition,
    "RESUME_OUTPUT"
  );
  if (!potential.pauseEffectTerminal) {
    markTrainingEffectId(potential.pauseEffectId, "cancelled", {
      reason: "resume-before-render-silent",
      resumeAttempt
    }, {
      reconciledByDecisionId: transition.trainingTrace?.decisionId
    });
    potential.pauseEffectTerminal = true;
  }
  potential.resumeEffectId = resumeEffectId;
  potential.resumeAudibleObserved = false;

  session.assistantResumeReason = reason;
  try {
    markTrainingEffectId(resumeEffectId, "dispatched", {
      command: "HTMLMediaElement.play",
      resumeAttempt
    });
    const playPromise = potential.audio.play();
    markTrainingEffectId(resumeEffectId, "player-received", {
      paused: potential.audio.paused,
      resumeAttempt
    });
    await playPromise;
  } catch (error) {
    const failedAtMs = performance.now();
    const failed = dispatchOutputInterruption(
      {
        type: "RESUME_FAILED",
        resumeAttempt
      },
      { source: "browser-player" }
    );
    if (potential.resumeEffectId === resumeEffectId) {
      markTrainingEffectId(resumeEffectId, "cancelled", {
        reason: "play-rejected",
        message: error.message,
        resumeAttempt
      }, {
        atMs: failedAtMs,
        reconciledByDecisionId: failed.trainingTrace?.decisionId
      });
      potential.resumeEffectId = null;
      potential.resumeAudibleObserved = false;
    }
    if (
      failed.intents.some((intent) => intent.type === "RELEASE_OUTPUT")
    ) {
      markTrainingEffect(failed, "RELEASE_OUTPUT", "dispatched", {
        reason: "play-rejected",
        resumeAttempt
      });
      session.assistantResumeReason = null;
      log("assistant.speech.resume.error", error.message);
      if (session.potentialBargeIn === potential) {
        session.potentialBargeIn = null;
        potential.settle({ kind: "resume-error" });
        localAudioReflex.reset("resume-error");
        releaseAssistantAudio();
      }
      markTrainingEffect(failed, "RELEASE_OUTPUT", "completed", {
        resourceReleased: true,
        resumeAttempt
      });
    }
    setListeningStatus();
    return false;
  }
  const resumeObservedAtMs = performance.now();
  const resumed = dispatchOutputInterruption(
    {
      type: "RESUME_SUCCEEDED",
      resumeAttempt
    },
    { source: "browser-player" }
  );
  if (
    resumed.intents.some(
      (intent) => intent.type === "PAUSE_STALE_RESUME"
    )
  ) {
    markTrainingEffect(
      resumed,
      "PAUSE_STALE_RESUME",
      "dispatched",
      { command: "HTMLMediaElement.pause", resumeAttempt }
    );
    potential.audio.pause();
    markTrainingEffect(
      resumed,
      "PAUSE_STALE_RESUME",
      "player-received",
      { paused: potential.audio.paused, resumeAttempt }
    );
    session.assistantSpeaking = false;
    markTrainingEffect(
      resumed,
      "PAUSE_STALE_RESUME",
      "completed",
      { staleResumeContained: true, resumeAttempt }
    );
    setListeningStatus();
    return false;
  }
  if (
    resumed.intents.some(
      (intent) => intent.type === "IGNORE_STALE_RESUME"
    )
  ) {
    markTrainingEffect(
      resumed,
      "IGNORE_STALE_RESUME",
      "dispatched",
      { resumeAttempt }
    );
    markTrainingEffect(
      resumed,
      "IGNORE_STALE_RESUME",
      "completed",
      { newerResumePreserved: true, resumeAttempt }
    );
    setListeningStatus();
    return false;
  }
  if (
    resumed.intents.some((intent) => intent.type === "SETTLE_RESUMED")
  ) {
    if (
      potential.resumeEffectId === resumeEffectId &&
      potential.resumeAudibleObserved
    ) {
      markTrainingEffectId(resumeEffectId, "completed", {
        observation: "play-resolved-after-onplaying",
        resumeAttempt
      }, {
        atMs: resumeObservedAtMs,
        reconciledByDecisionId: resumed.trainingTrace?.decisionId
      });
    }
    if (potential.resumeEffectId === resumeEffectId) {
      potential.resumeEffectId = null;
      potential.resumeAudibleObserved = false;
    }
    markTrainingEffect(resumed, "SETTLE_RESUMED", "dispatched", {
      resumeAttempt
    });
    if (session.potentialBargeIn === potential) {
      session.potentialBargeIn = null;
    }
    potential.settle({ kind: "dismissed-and-resumed" });
    localAudioReflex.reset("dismissed-and-resumed");
    markTrainingEffect(resumed, "SETTLE_RESUMED", "completed", {
      resourceSettled: true,
      resumeAttempt
    });
    setListeningStatus();
    return true;
  }
  setListeningStatus();
  return false;
}

function confirmPotentialBargeIn(reason) {
  const potential = session.potentialBargeIn;
  const transition = dispatchOutputInterruption(
    {
      type: "CONFIRM_REQUESTED",
      reason
    },
    { source: "browser-turn-taking" }
  );
  if (
    !potential ||
    !transition.intents.some(
      (intent) => intent.type === "CONFIRM_INTERRUPTION"
    )
  ) {
    return false;
  }
  if (potential.resumeEffectId) {
    markTrainingEffectId(potential.resumeEffectId, "cancelled", {
      reason: "interruption-confirmed"
    }, {
      reconciledByDecisionId: transition.trainingTrace?.decisionId
    });
    potential.resumeEffectId = null;
    potential.resumeAudibleObserved = false;
  }
  markTrainingEffect(
    transition,
    "CONFIRM_INTERRUPTION",
    "dispatched",
    {
      command: potential.audio
        ? "HTMLMediaElement.pause"
        : "settle-held-resource",
      reason
    }
  );
  if (potential.audio) {
    potential.audio.pause();
    markTrainingEffect(
      transition,
      "CONFIRM_INTERRUPTION",
      "player-received",
      { paused: potential.audio.paused }
    );
  }
  session.assistantSpeaking = false;
  session.assistantResumeReason = null;
  clearTimeout(potential.timer);
  potential.timer = null;
  potential.settle({ kind: "confirmed" });
  localAudioReflex.reset("confirmed");
  markTrainingEffect(
    transition,
    "CONFIRM_INTERRUPTION",
    "completed",
    { resourceSettled: true, reason }
  );
  session.interruptCount += 1;
  elements.interruptMetric.textContent = String(session.interruptCount);
  log("barge-in.confirmed", reason);
  return true;
}

function consumeTextDelta(delta, kind) {
  session.responseText += delta;
  session.speechBuffer += delta;
  elements.assistantText.textContent = session.responseText;

  const split = extractSpeechChunks(session.speechBuffer);
  session.speechBuffer = split.remaining;
  for (const chunk of split.chunks) {
    enqueueSpeech(chunk, kind);
  }
}

function flushSpeechBuffer(kind) {
  const split = extractSpeechChunks(session.speechBuffer, { flush: true });
  session.speechBuffer = "";
  for (const chunk of split.chunks) {
    enqueueSpeech(chunk, kind);
  }
}

async function processTurn() {
  clearTimeout(session.endpointTimer);
  session.endpointTimer = null;

  const text = session.finalText.trim();
  session.finalText = "";
  if (!text || !session.active) {
    return;
  }

  session.turnAbortController?.abort();
  releaseAssistantAudio();
  const controller = new AbortController();
  const generation = session.responseGeneration + 1;
  const history = session.history.slice();
  const context = {
    controller,
    generation,
    id: null,
    mode: "pending",
    query: text,
    resultText: ""
  };
  session.responseGeneration = generation;
  session.turnAbortController = controller;
  session.responseActive = true;
  session.responseAudioStarted = false;
  session.responseText = "";
  session.speechBuffer = "";
  const turnId = `turn-${++session.interactionTurnSequence}`;
  appendHistory("user", text);
  log("turn.committed", text);
  setStatus("pensando e ouvindo", "speaking");

  let completed = false;

  try {
    const response = await fetch("/api/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        history,
        sessionId: session.interactionSessionId,
        turnId
      }),
      signal: controller.signal
    });

    for await (const event of readNdjson(response)) {
      const ownsFlow = context.mode === "delegate"
        ? session.activeTask === context
        : generation === session.responseGeneration;
      if (!ownsFlow) {
        return;
      }

      if (event.type === "route") {
        context.mode =
          event.mode === "delegate" ? "delegate" : "direct";
        log("turn.routed", event.mode);
        const projection = projectInteractionTransition(event.interaction);
        session.interactionStateVersion = projection.stateVersion;
        session.semanticState = projection.semanticState;
        session.semanticRevisions = projection.semanticRevisions;
        session.pendingConfirmation = projection.pendingConfirmation;
        log(
          "interaction.transition",
          JSON.stringify({
            authority: projection.authority,
            eventId: projection.eventId,
            kernelVersion: projection.kernelVersion,
            previousStateVersion: projection.previousStateVersion,
            stateVersion: projection.stateVersion
          })
        );
        for (const traceEvent of projection.traceEvents) {
          log(traceEvent.type, traceEvent.detail);
        }
        if (context.mode === "delegate") {
          if (
            session.activeTask &&
            session.activeTask !== context
          ) {
            cancelActiveTask("substituída por nova tarefa");
          }
          context.id = event.taskId ?? `task-${generation}`;
          session.activeTask = context;
          if (session.turnAbortController === controller) {
            session.turnAbortController = null;
          }
          session.responseActive = false;
          log(
            "task.delegated",
            `${context.id} · ${event.query ?? text}`
          );
          if (event.acknowledgment) {
            enqueueSpeech(event.acknowledgment, "acknowledgment");
          }
          setListeningStatus();
        }
        continue;
      }

      if (event.type === "started") {
        log(
          "brain.started",
          context.mode === "delegate"
            ? `${context.id} · ${event.model}`
            : event.model
        );
        continue;
      }

      if (event.type === "delta") {
        if (context.mode === "delegate") {
          context.resultText += event.delta;
        } else {
          consumeTextDelta(event.delta, "direct");
        }
        continue;
      }

      if (event.type === "done") {
        completed = true;
        const model = event.model ?? event.provider ?? "";
        if (context.mode === "delegate") {
          const result = context.resultText.trim();
          const resultReadyAt = performance.now();
          session.activeTask = null;
          log("brain.completed", `${context.id} · ${model}`);
          if (result) {
            session.pendingTaskResults.push({
              id: context.id,
              readyAt: resultReadyAt,
              text: result
            });
            log("task.result.ready", context.id);
            schedulePendingTaskResult();
          }
          setListeningStatus();
        } else {
          flushSpeechBuffer("direct");
          log("brain.completed", model);
        }
        continue;
      }

      if (event.type === "error") {
        throw new Error(event.message ?? "Falha no cérebro externo.");
      }
    }

    if (!completed) {
      throw new Error("A resposta terminou sem confirmação de conclusão.");
    }

    if (
      context.mode !== "delegate" &&
      session.responseText.trim()
    ) {
      appendHistory("assistant", session.responseText.trim());
    }
  } catch (error) {
    if (context.mode === "delegate") {
      if (session.activeTask === context) {
        session.activeTask = null;
      }
      if (error.name !== "AbortError") {
        log("task.error", `${context.id} · ${error.message}`);
      }
    } else if (
      error.name !== "AbortError" &&
      generation === session.responseGeneration
    ) {
        releaseAssistantAudio();
        elements.assistantText.textContent =
          "Não consegui concluir esta resposta. Pode tentar de novo?";
        log("turn.error", error.message);
    }
  } finally {
    if (
      context.mode !== "delegate" &&
      generation === session.responseGeneration
    ) {
      session.responseActive = false;
      session.turnAbortController = null;
      setListeningStatus();
    } else if (context.mode === "delegate") {
      setListeningStatus();
    }
  }
}

function scheduleEndpoint() {
  clearTimeout(session.endpointTimer);
  session.endpointTimer = setTimeout(processTurn, 280);
}

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/audio`;
}

async function waitForSocketCapacity(socket, signal) {
  const deadline = performance.now() + 240;
  while (
    socket.readyState === WebSocket.OPEN &&
    socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES
  ) {
    if (signal?.aborted) {
      throw new DOMException("Captura encerrada.", "AbortError");
    }
    if (performance.now() >= deadline) {
      throw new Error("transporte PCM congestionado");
    }
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error("socket de áudio fechado");
  }
}

function recordAutomationPcm(frame) {
  if (!automationEnabled) {
    return;
  }
  const audit = session.automationPcmAudit;
  const recorded = {
    pcm16: frame.pcm16.slice(),
    sampleStart: frame.sampleStart,
    sequence: frame.sequence
  };
  audit.ring.push(recorded);
  audit.ring = audit.ring.slice(-AUTOMATION_AUDIT_PRE_ROLL_FRAMES);

  const clip = audit.activeClip;
  if (!clip || recorded.sequence <= clip.lastSequence) {
    return;
  }
  clip.frames.push(recorded);
  clip.lastSequence = recorded.sequence;
  clip.remainingFrames -= 1;
  if (clip.remainingFrames <= 0) {
    audit.clips.push(clip);
    audit.clips = audit.clips.slice(-5);
    audit.activeClip = null;
  }
}

function startAutomationPcmAuditClip(event) {
  if (!automationEnabled) {
    return;
  }
  const audit = session.automationPcmAudit;
  if (audit.activeClip) {
    audit.clips.push(audit.activeClip);
  }
  const seed = audit.ring.map((frame) => ({
    ...frame,
    pcm16: frame.pcm16.slice()
  }));
  audit.activeClip = {
    receivedAtMs: performance.now(),
    serverEventAtMs: event.atMs ?? null,
    onsetSequence: event.onsetSequence ?? null,
    triggerSequence: event.triggerSequence ?? null,
    frames: seed,
    lastSequence: seed.at(-1)?.sequence ?? -1,
    remainingFrames: AUTOMATION_AUDIT_POST_ROLL_FRAMES
  };
  audit.clips = audit.clips.slice(-5);
}

function pcmFramesToBase64(frames) {
  const byteLength = frames.reduce(
    (total, frame) => total + frame.pcm16.byteLength,
    0
  );
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const frame of frames) {
    const source = new Uint8Array(
      frame.pcm16.buffer,
      frame.pcm16.byteOffset,
      frame.pcm16.byteLength
    );
    bytes.set(source, offset);
    offset += source.byteLength;
  }

  let binary = "";
  const chunkBytes = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkBytes) {
    binary += String.fromCharCode(
      ...bytes.subarray(start, start + chunkBytes)
    );
  }
  return btoa(binary);
}

function automationAudioAudit() {
  const audit = session.automationPcmAudit;
  const clips = [
    ...audit.clips,
    ...(audit.activeClip ? [audit.activeClip] : [])
  ];
  return clips.map((clip, index) => ({
    index,
    receivedAtMs: clip.receivedAtMs,
    serverEventAtMs: clip.serverEventAtMs,
    onsetSequence: clip.onsetSequence,
    triggerSequence: clip.triggerSequence,
    firstSequence: clip.frames[0]?.sequence ?? null,
    lastSequence: clip.frames.at(-1)?.sequence ?? null,
    onsetOffsetMs:
      clip.onsetSequence === null || clip.frames[0] === undefined
        ? null
        : (clip.onsetSequence - clip.frames[0].sequence) * 20,
    triggerOffsetMs:
      clip.triggerSequence === null || clip.frames[0] === undefined
        ? null
        : (clip.triggerSequence - clip.frames[0].sequence) * 20,
    frameCount: clip.frames.length,
    durationMs: clip.frames.length * 20,
    pcmBase64: pcmFramesToBase64(clip.frames)
  }));
}

function audioEventDetail(event) {
  if (event.type.startsWith("transcript.")) {
    return event.text ?? event.message ?? event.reason ?? "";
  }
  if (event.type === "endpoint.committed") {
    return `${Math.round(event.silenceMs)} ms · ${event.reason}`;
  }
  if (event.type === "audio.frames.dropped") {
    return `${event.lostFrames} frames · ${event.lostSamples} amostras`;
  }
  return event.turnId ?? "";
}

function recordVadShadowEvent(event) {
  const shadow = session.vadShadow;
  if (event.type === "vad.shadow.window") {
    if (
      shadow.lastSampleEnd !== null &&
      event.sampleStart !== shadow.lastSampleEnd
    ) {
      shadow.observedSampleGaps += 1;
    }
    shadow.windowCount += 1;
    shadow.lastSampleEnd = event.sampleEnd;
    shadow.lastWindow = {
      sampleStart: event.sampleStart,
      sampleEnd: event.sampleEnd,
      probability: event.probability,
      state: event.state
    };
    shadow.maximumQueueDepth = Math.max(
      shadow.maximumQueueDepth,
      Number(event.queueDepth) || 0
    );
    shadow.inferenceMs.push(Number(event.inferenceMs) || 0);
    shadow.queueDelayMs.push(Number(event.queueDelayMs) || 0);
    if (
      shadow.inferenceMs.length >
      MAX_BROWSER_TELEMETRY_SAMPLES
    ) {
      shadow.inferenceMs.splice(
        0,
        MAX_BROWSER_TELEMETRY_SAMPLES / 5
      );
      shadow.queueDelayMs.splice(
        0,
        MAX_BROWSER_TELEMETRY_SAMPLES / 5
      );
    }
    return;
  }
  if (event.type === "vad.shadow.speech.started") {
    shadow.starts.push({
      onsetSampleStart: event.onsetSampleStart,
      triggerSampleStart: event.triggerSampleStart,
      emittedAtMs: event.emittedAtMs,
      probability: event.probability
    });
    shadow.starts = shadow.starts.slice(-100);
    log(
      event.type,
      `p=${Number(event.probability).toFixed(3)} · shadow`
    );
    return;
  }
  if (event.type === "vad.shadow.speech.ended") {
    shadow.ends += 1;
    log(event.type, "shadow");
    return;
  }
  if (event.type === "vad.shadow.reset") {
    shadow.resets += 1;
    if (event.reason === "inference-error") {
      shadow.errors += 1;
    }
    log(event.type, event.reason ?? "");
  }
}

function numberDistribution(values) {
  const finite = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const rank = (ratio) =>
    finite.length === 0
      ? null
      : finite[Math.max(0, Math.ceil(finite.length * ratio) - 1)];
  return {
    n: finite.length,
    p50: rank(0.5),
    p95: rank(0.95),
    p99: rank(0.99),
    max: rank(1)
  };
}

function vadShadowSnapshot() {
  const shadow = session.vadShadow;
  return {
    health: shadow.health,
    windowCount: shadow.windowCount,
    starts: shadow.starts.map((event) => ({ ...event })),
    ends: shadow.ends,
    resets: shadow.resets,
    errors: shadow.errors,
    observedSampleGaps: shadow.observedSampleGaps,
    lastSampleEnd: shadow.lastSampleEnd,
    lastWindow: shadow.lastWindow,
    maximumQueueDepth: shadow.maximumQueueDepth,
    inferenceMs: numberDistribution(shadow.inferenceMs),
    queueDelayMs: numberDistribution(shadow.queueDelayMs)
  };
}

function handleLocalAudioEvent(event) {
  if (!event || typeof event.type !== "string") {
    return;
  }
  if (
    automationEnabled &&
    AUTOMATION_AUDIO_EVIDENCE_EVENTS.has(event.type)
  ) {
    session.audioRuntimeEvidence.push({
      ...event,
      observedAtMs: Math.round(performance.now() * 100) / 100
    });
    session.audioRuntimeEvidence =
      session.audioRuntimeEvidence.slice(-1_000);
  }
  if (event.type === "audio.flushed") {
    session.audioPipelineTelemetry =
      event.pipeline ?? session.audioPipelineTelemetry;
    session.vadControlTelemetry =
      event.vadControl?.telemetry ??
      session.vadControlTelemetry;
    const waiter = session.audioFlushWaiters.get(event.requestId);
    if (waiter) {
      clearTimeout(waiter.timer);
      session.audioFlushWaiters.delete(event.requestId);
      waiter.resolve(event);
    }
    log(
      "audio.flushed",
      `${event.requestId} · amostra ` +
        `${event.watermark?.expectedSampleEnd ?? "?"}`
    );
    return;
  }
  if (event.type === "audio.error" && event.requestId) {
    const waiter = session.audioFlushWaiters.get(event.requestId);
    if (waiter) {
      clearTimeout(waiter.timer);
      session.audioFlushWaiters.delete(event.requestId);
      waiter.reject(new Error(event.message ?? "audio.flush falhou"));
    }
  }
  if (event.type.startsWith("vad.shadow.")) {
    recordVadShadowEvent(event);
    return;
  }
  if (event.type === "vad.control.telemetry") {
    session.vadControlTelemetry = event.snapshot ?? null;
    return;
  }
  if (event.type === "audio.pipeline.telemetry") {
    session.audioPipelineTelemetry = event.snapshot ?? null;
    return;
  }
  if (event.type === "vad.control.window") {
    dispatchLocalAudioReflex({
      type: "VAD_CONTROL_WINDOW",
      turnId: event.turnId ?? null,
      probability: event.probability,
      sampleStart: event.sampleStart
    }, event);
    return;
  }

  if (event.type === "audio.level") {
    session.audioLevel = {
      rms: event.rms,
      noiseFloor: event.noiseFloor,
      onThreshold: event.onThreshold,
      offThreshold: event.offThreshold,
      vadState: event.vadState,
      detector: event.detector ?? null,
      speechProbability: event.speechProbability ?? null
    };
    return;
  }
  if (event.type === "user.speech.started") {
    startAutomationPcmAuditClip(event);
    clearTimeout(session.endpointTimer);
    session.userSpeaking = true;
    dispatchLocalAudioReflex({
      type: "USER_SPEECH_STARTED",
      turnId: event.turnId ?? null,
      detector: event.detector ?? null,
      probability: event.probability ?? null,
      triggerSampleStart: event.triggerSampleStart ?? null
    }, event);
    setStatus("usuário falando", "user");
    log(
      "user.speech.started",
      event.detector === "silero-vad-v6.2"
        ? `local PCM · p=${Number(
            event.probability ?? 0
          ).toFixed(4)} · Silero`
        : `local PCM · rms=${Number(event.rms ?? 0).toFixed(4)}` +
          ` · limiar=${Number(event.threshold ?? 0).toFixed(4)}`
    );
    return;
  }
  if (event.type === "user.speech.paused") {
    session.userSpeaking = false;
    dispatchLocalAudioReflex({
      type: "USER_SPEECH_PAUSED",
      turnId: event.turnId ?? null,
      probability: event.probability ?? null,
      triggerSampleStart:
        event.triggerSampleStart ?? event.pauseSampleStart ?? null
    }, event);
    if (session.potentialBargeIn) {
      session.potentialBargeIn.userPausedAt = performance.now();
    }
    schedulePotentialBargeInTimeout(
      "timeout aguardando transcrição final"
    );
    setStatus("aguardando continuação", "live");
    log("user.speech.paused", audioEventDetail(event));
    return;
  }
  if (event.type === "user.speech.resumed") {
    session.userSpeaking = true;
    if (event.turnId) {
      session.earlyBackchannelTurnIds.delete(event.turnId);
    }
    dispatchLocalAudioReflex({
      type: "USER_SPEECH_STARTED",
      turnId: event.turnId ?? null,
      detector: event.detector ?? null,
      probability: event.probability ?? null,
      triggerSampleStart: event.triggerSampleStart ?? null
    }, event);
    setStatus("usuário falando", "user");
    log("user.speech.resumed", audioEventDetail(event));
    return;
  }
  if (event.type === "transcript.partial") {
    dispatchLocalAudioReflex({
      type: "TRANSCRIPT_PARTIAL",
      turnId: event.turnId ?? null,
      text: event.text ?? ""
    }, event);
    if (session.potentialBargeIn && session.userSpeaking) {
      schedulePotentialBargeInTimeout(
        "timeout de segurança durante fala",
        30_000
      );
    }
    elements.userText.textContent = event.text || "Estou ouvindo…";
    log("user.transcript.partial", event.text ?? "");
    const potential = session.potentialBargeIn;
    if (
      potential &&
      event.turnId &&
      !session.userSpeaking &&
      potential.userPausedAt !== null &&
      potential.userPausedAt - potential.requestedAt <= 900
    ) {
      const decision = classifyPotentialBargeIn(event.text);
      if (!decision.shouldInterrupt && decision.kind === "backchannel") {
        session.earlyBackchannelTurnIds.add(event.turnId);
        session.backchannelCount += 1;
        log("user.backchannel.early", event.text ?? "");
        void dismissPotentialBargeIn(
          `parcial acústico curto: ${event.text}`
        );
      }
    }
    return;
  }
  if (event.type === "endpoint.committed") {
    session.userSpeaking = false;
    schedulePotentialBargeInTimeout(
      "timeout aguardando resultado do ASR"
    );
    session.lastEndpointCommittedAt = performance.now();
    session.lastSpeechEndedAt =
      session.lastEndpointCommittedAt -
      Math.max(0, Number(event.silenceMs) || 0);
    log("user.speech.ended", audioEventDetail(event));
    setListeningStatus();
    return;
  }
  if (event.type === "transcript.final") {
    const text = String(event.text ?? "").trim();
    const reflexTransition = dispatchLocalAudioReflex({
      type: "TRANSCRIPT_FINAL",
      turnId: event.turnId ?? null,
      text
    }, event);
    elements.userText.textContent = text || "Não identifiquei fala útil.";
    log("user.transcript.final", text);
    if (
      reflexTransition.intents.some(
        (intent) => intent.type === "SUPPRESS_TRANSCRIPT"
      )
    ) {
      session.finalText = "";
      elements.userText.textContent =
        "Ruído acústico descartado; continuando a resposta.";
      return;
    }
    if (event.criticalConflict) {
      if (session.potentialBargeIn) {
        confirmPotentialBargeIn("conflito numérico crítico");
      }
      releaseAssistantAudio();
      session.finalText = "";
      const clarification = createCriticalConflictClarification(
        event.criticalConflict
      );
      elements.assistantText.textContent = clarification;
      appendHistory("user", text);
      appendHistory("assistant", clarification);
      log(
        "transcript.critical-conflict",
        JSON.stringify(event.criticalConflict)
      );
      log("assistant.clarification", clarification);
      queueCompleteText(clarification, "repair");
      return;
    }
    if (
      event.turnId &&
      session.earlyBackchannelTurnIds.has(event.turnId)
    ) {
      session.earlyBackchannelTurnIds.delete(event.turnId);
      const finalDecision = classifyPotentialBargeIn(text);
      if (!finalDecision.shouldInterrupt) {
        log("user.backchannel.finalized", text);
        return;
      }
      session.backchannelCount = Math.max(
        0,
        session.backchannelCount - 1
      );
      log("barge-in.reopened", text);
      pauseAssistantForPotentialBargeIn(event);
      confirmPotentialBargeIn(`parcial corrigido pelo final: ${text}`);
    }
    if (
      session.potentialBargeIn &&
      outputInterruptionLifecycle.snapshot.phase !== "confirmed"
    ) {
      const decision = classifyPotentialBargeIn(text);
      if (!decision.shouldInterrupt) {
        session.userSpeaking = false;
        if (decision.kind === "backchannel") {
          session.backchannelCount += 1;
        }
        log("user.backchannel", decision.kind);
        void dismissPotentialBargeIn(
          decision.kind === "empty"
            ? "ruído sem fala útil"
            : `backchannel: ${text}`
        );
        return;
      }
      confirmPotentialBargeIn(`fala útil: ${text}`);
    }
    if (text && handleExplicitTaskCancellation(text)) {
      session.finalText = "";
      return;
    }
    if (text) {
      session.finalText = text;
      void processTurn();
    }
    return;
  }
  if (event.type === "transcript.rejected") {
    if (event.turnId) {
      session.earlyBackchannelTurnIds.delete(event.turnId);
    }
    session.userSpeaking = false;
    if (!session.potentialBargeIn) {
      localAudioReflex.reset("transcript-rejected");
    }
    if (session.potentialBargeIn) {
      elements.userText.textContent =
        "Ruído descartado; continuando a resposta.";
      log(
        "user.transcript.rejected",
        event.plausibility?.reasons?.join(", ") ?? "implausível"
      );
      void dismissPotentialBargeIn("transcrição implausível");
      return;
    }
    elements.userText.textContent =
      "Ouvi algo, mas a transcrição não parece confiável.";
    log(
      "user.transcript.rejected",
      event.plausibility?.reasons?.join(", ") ?? "implausível"
    );
    enqueueSpeech(
      "Não consegui entender com segurança. Pode repetir?",
      "repair"
    );
    return;
  }
  if (event.type === "transcript.cancelled") {
    if (event.turnId) {
      session.earlyBackchannelTurnIds.delete(event.turnId);
    }
    log("user.transcript.cancelled", event.reason ?? "");
    if (!session.potentialBargeIn) {
      localAudioReflex.reset("transcript-cancelled");
    }
    void dismissPotentialBargeIn("transcrição cancelada");
    return;
  }
  if (event.type === "assistant.backchannel.suggested") {
    if (
      !session.potentialBargeIn &&
      !session.assistantPreparing &&
      !session.assistantSpeaking &&
      !session.responseActive
    ) {
      const text = String(event.text ?? "Aham.").trim();
      log("assistant.backchannel", text);
      enqueueSpeech(text, "backchannel");
    }
    return;
  }
  if (event.type.endsWith(".error")) {
    log(event.type, event.message ?? "");
    void dismissPotentialBargeIn("erro de transcrição");
    return;
  }
  if (
    event.type === "audio.frames.dropped" ||
    event.type === "audio.frame.rejected"
  ) {
    log(event.type, audioEventDetail(event));
  }
}

function rejectAudioFlushWaiters(reason) {
  for (const waiter of session.audioFlushWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(reason));
  }
  session.audioFlushWaiters.clear();
}

async function flushLocalAudio(options = {}) {
  const socket = session.audioSocket;
  if (
    !session.capture ||
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    throw new Error("captura PCM local não está ativa");
  }
  const capture = await session.capture.requestTelemetry({
    timeoutMs: options.telemetryTimeoutMs ?? 2_000
  });
  const observedAtMs = performance.now();
  const expectedSequence =
    capture.worklet?.lastGeneratedSequence;
  const expectedSampleEnd =
    capture.worklet?.nextSampleStart;
  if (
    !Number.isSafeInteger(expectedSequence) ||
    expectedSequence < 0 ||
    !Number.isSafeInteger(expectedSampleEnd) ||
    expectedSampleEnd <= 0
  ) {
    throw new Error("worklet não forneceu watermark PCM válido");
  }
  const requestId = `flush-${++session.audioFlushSequence}`;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const flushed = new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        session.audioFlushWaiters.delete(requestId);
        reject(new Error(`audio.flush expirou: ${requestId}`));
      }, timeoutMs)
    };
    session.audioFlushWaiters.set(requestId, waiter);
  });
  socket.send(JSON.stringify({
    type: "audio.flush",
    requestId,
    expectedSequence,
    expectedSampleEnd
  }));
  return {
    capture,
    observedAtMs,
    server: await flushed
  };
}

async function connectLocalAudio() {
  const socket = new WebSocket(socketUrl());
  socket.binaryType = "arraybuffer";
  session.audioSocket = socket;

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail("ASR local não respondeu em 10 s");
        socket.close();
      }, 10_000);
      const fail = (message) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(new Error(message));
      };
      const succeed = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => fail("não foi possível abrir o ASR local");
      socket.onclose = () => fail("ASR local fechou antes de iniciar");
      socket.onmessage = ({ data }) => {
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          fail("ASR local retornou protocolo inválido");
          return;
        }
        if (event.type === "audio.ready") {
          session.audioPipelineTelemetry =
            event.audioPipeline ?? null;
          session.vadControl = event.vadControl ?? {
            state: "unknown"
          };
          session.vadControlTelemetry = null;
          session.vadShadow.health = event.vadShadow ?? {
            state: "disabled"
          };
          socket.send(JSON.stringify({
            type: "audio.start",
            sampleRate: 16_000,
            encoding: "pcm_s16le"
          }));
        } else if (event.type === "audio.started") {
          succeed();
        } else if (event.type === "audio.error") {
          fail(event.message ?? "falha no ASR local");
        }
      };
    });
  } catch (error) {
    if (session.audioSocket === socket) {
      session.audioSocket = null;
    }
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
    throw error;
  }

  socket.onmessage = ({ data }) => {
    try {
      handleLocalAudioEvent(JSON.parse(data));
    } catch (error) {
      log("audio.protocol.error", error.message);
    }
  };
  socket.onclose = (event) => {
    registerLocalAudioDisconnect(socket, {
      code: event.code || "?",
      reason: event.reason || "sem motivo"
    });
  };
  socket.onerror = () => {
    if (session.active) {
      log("audio.socket.error");
    }
  };
  return socket;
}

function registerLocalAudioDisconnect(socket, detail = {}) {
  rejectAudioFlushWaiters("socket de áudio fechado");
  if (session.audioSocket !== socket) {
    return false;
  }
  session.audioSocket = null;
  if (session.active && session.inputMode === "local-pcm") {
    session.audioDisconnectCount += 1;
    setStatus("reconectando ASR local…", "error");
    log(
      "audio.socket.closed",
      `${detail.code ?? "?"} · ${detail.reason ?? "sem motivo"}`
    );
    scheduleLocalAudioReconnect();
  }
  return true;
}

async function usableLocalAudioSocket(signal) {
  let socket = session.audioSocket;
  if (socket?.readyState === WebSocket.OPEN) {
    return socket;
  }
  // CLOSING pode preceder o evento close; segure o frame no crédito do
  // AudioWorklet enquanto a reconexão é iniciada.
  if (
    !session.audioReconnectPromise &&
    session.active &&
    session.inputMode === "local-pcm"
  ) {
    registerLocalAudioDisconnect(socket, {
      code: "send-path",
      reason: "socket indisponível durante captura"
    });
  }
  if (session.audioReconnectPromise) {
    socket = await session.audioReconnectPromise;
  }
  if (signal?.aborted) {
    throw new DOMException("Captura encerrada.", "AbortError");
  }
  if (socket?.readyState !== WebSocket.OPEN) {
    throw new Error("socket de áudio indisponível");
  }
  return socket;
}

async function paceRecoveredAudio(signal) {
  if (performance.now() >= session.audioRecoveryPacingUntilMs) {
    return;
  }
  const minimumGapMs = 4;
  const waitMs = Math.max(
    0,
    (session.audioLastFrameSentAtMs ?? 0) +
      minimumGapMs -
      performance.now()
  );
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  if (signal?.aborted) {
    throw new DOMException("Captura encerrada.", "AbortError");
  }
}

async function deactivateLocalAudioAfterFailure(error, transportEpoch) {
  if (session.audioTransportEpoch !== transportEpoch) {
    return;
  }
  const capture = session.capture;
  await capture?.stop("audio-transport-unavailable").catch(() => {});
  if (session.capture === capture) {
    session.capture = null;
  }
  session.active = false;
  session.inputMode = null;
  elements.startButton.disabled = false;
  elements.stopButton.disabled = true;
  setStatus("ASR local indisponível; tente reiniciar", "error");
  log("audio.socket.reconnect.exhausted", error.message);
}

function scheduleLocalAudioReconnect() {
  if (
    session.audioReconnectPromise ||
    !session.active ||
    session.inputMode !== "local-pcm"
  ) {
    return;
  }
  const transportEpoch = session.audioTransportEpoch;
  const reconnectPromise = (async () => {
    let lastError = new Error("ASR local desconectado");
    for (
      let attempt = 0;
      attempt < AUDIO_RECONNECT_DELAYS_MS.length;
      attempt += 1
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, AUDIO_RECONNECT_DELAYS_MS[attempt])
      );
      if (
        session.audioTransportEpoch !== transportEpoch ||
        !session.active ||
        session.inputMode !== "local-pcm"
      ) {
        return null;
      }
      try {
        const socket = await connectLocalAudio();
        if (session.audioTransportEpoch !== transportEpoch) {
          socket.close();
          return null;
        }
        session.audioReconnectCount += 1;
        session.audioRecoveryPacingUntilMs =
          performance.now() + 1_000;
        setStatus("ouvindo localmente", "live");
        log(
          "audio.socket.recovered",
          `tentativa ${attempt + 1}`
        );
        return socket;
      } catch (error) {
        lastError = error;
        log(
          "audio.socket.reconnect.failed",
          `tentativa ${attempt + 1} · ${error.message}`
        );
      }
    }
    throw lastError;
  })();
  session.audioReconnectPromise = reconnectPromise;
  void reconnectPromise
    .catch((error) =>
      deactivateLocalAudioAfterFailure(error, transportEpoch)
    )
    .finally(() => {
      if (session.audioReconnectPromise === reconnectPromise) {
        session.audioReconnectPromise = null;
      }
    });
}

async function startLocalPcmSession() {
  session.audioTransportEpoch += 1;
  session.audioReconnectPromise = null;
  session.audioDisconnectCount = 0;
  session.audioReconnectCount = 0;
  session.audioRecoveryPacingUntilMs = 0;
  session.audioLastFrameSentAtMs = null;
  await connectLocalAudio();
  const capture = new BrowserPcmCapture({
    async onFrame(frame, { signal }) {
      recordAutomationPcm(frame);
      const activeSocket = await usableLocalAudioSocket(signal);
      await paceRecoveredAudio(signal);
      await waitForSocketCapacity(activeSocket, signal);
      if (session.audioSocket !== activeSocket) {
        throw new Error("transporte PCM mudou durante o envio");
      }
      activeSocket.send(encodePcmFrame(frame));
      session.audioLastFrameSentAtMs = performance.now();
    },
    onEvent(event) {
      if (
        event.type === "capture.started" ||
        event.type.includes("error") ||
        event.type === "capture.backpressure"
      ) {
        log(
          event.type,
          event.trackSettings
            ? JSON.stringify(event.trackSettings)
            : event.message ?? ""
        );
      }
    },
    onTelemetry(telemetry) {
      session.captureTelemetry = telemetry;
    }
  });
  session.capture = capture;
  await capture.start();
  session.active = true;
  session.inputMode = "local-pcm";
  elements.startButton.disabled = true;
  elements.stopButton.disabled = false;
  setStatus("ouvindo localmente", "live");
  log("session.started", "PCM 16 kHz · ASR aberto local");
}

function createRecognition() {
  const recognition = new Recognition();
  recognition.lang = "pt-BR";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    setStatus("ouvindo", "live");
    log("session.listening");
  };

  recognition.onspeechstart = () => {
    clearTimeout(session.endpointTimer);
    session.userSpeaking = true;
    interruptAssistant();
    setStatus("usuário falando", "user");
    log("user.speech.started");
  };

  recognition.onspeechend = () => {
    session.userSpeaking = false;
    session.lastSpeechEndedAt = performance.now();
    log("user.speech.ended");
    scheduleEndpoint();
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (
      let index = event.resultIndex;
      index < event.results.length;
      index += 1
    ) {
      const text = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) {
        session.finalText = `${session.finalText} ${text}`.trim();
        log("user.transcript.final", text);
      } else {
        interim = `${interim} ${text}`.trim();
      }
    }

    elements.userText.textContent =
      [session.finalText, interim].filter(Boolean).join(" ") ||
      "Estou ouvindo…";

    if (session.finalText && !session.userSpeaking) {
      scheduleEndpoint();
    }
  };

  recognition.onerror = (event) => {
    if (!["aborted", "no-speech"].includes(event.error)) {
      setStatus(`erro: ${event.error}`, "error");
      log("recognition.error", event.error);
    }
  };

  recognition.onend = () => {
    if (session.active) {
      try {
        recognition.start();
      } catch {
        setTimeout(() => recognition.start(), 150);
      }
    }
  };

  return recognition;
}

async function startBrowserRecognitionSession() {
  try {
    session.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    session.active = true;
    session.inputMode = "browser-speech";
    session.recognition = createRecognition();
    session.recognition.start();
    elements.startButton.disabled = true;
    elements.stopButton.disabled = false;
    log("session.started", "fallback Web Speech pt-BR");
  } catch (error) {
    setStatus("microfone bloqueado", "error");
    log("session.error", error.message);
  }
}

let healthPromise;

async function startSession() {
  elements.startButton.disabled = true;
  await healthPromise;

  if (session.asrAvailable) {
    try {
      await startLocalPcmSession();
      return;
    } catch (error) {
      await session.capture?.stop("local-start-error").catch(() => {});
      session.capture = null;
      session.audioSocket?.close();
      session.audioSocket = null;
      log("session.local-fallback", error.message);
    }
  }

  if (Recognition) {
    await startBrowserRecognitionSession();
    return;
  }
  elements.startButton.disabled = false;
  setStatus("entrada de voz indisponível", "error");
  log("session.unsupported", "ASR local e Web Speech indisponíveis");
}

async function stopSession() {
  session.audioTransportEpoch += 1;
  session.active = false;
  clearTimeout(session.endpointTimer);
  clearTimeout(session.taskDeliveryTimer);
  cancelActiveResponse("sessão encerrada");
  cancelActiveTask("sessão encerrada");
  session.pendingTaskResults = [];
  rejectAudioFlushWaiters("sessão encerrada");
  session.recognition?.abort();
  session.mediaStream?.getTracks().forEach((track) => track.stop());
  await session.capture?.stop("session-ended").catch(() => {});
  session.capture = null;
  if (session.audioSocket?.readyState === WebSocket.OPEN) {
    session.audioSocket.send(JSON.stringify({ type: "audio.stop" }));
  }
  session.audioSocket?.close();
  session.audioSocket = null;
  session.inputMode = null;
  releaseAssistantAudio();
  session.userSpeaking = false;
  elements.startButton.disabled = false;
  elements.stopButton.disabled = true;
  setStatus("parado", "idle");
  log("session.ended");
}

function metricValue(element) {
  const match = /[\d.]+/u.exec(element.textContent);
  return match ? Number.parseFloat(match[0]) : null;
}

function automationSnapshot() {
  const outputInterruption = outputInterruptionLifecycle.snapshot;
  return {
    observedAtMs: Math.round(performance.now() * 100) / 100,
    trainingTrace: trainingTraceRecorder.snapshot,
    reflexTrainingTrace: reflexTrainingTraceRecorder.snapshot,
    state: {
      active: session.active,
      assistantPreparing: session.assistantPreparing,
      assistantSpeaking: session.assistantSpeaking,
      audioQueueLength: session.audioQueue.length,
      activeTaskId: session.activeTask?.id ?? null,
      pendingTaskResults: session.pendingTaskResults.length,
      responseActive: session.responseActive,
      responseGeneration: session.responseGeneration,
      inputMode: session.inputMode,
      userSpeaking: session.userSpeaking,
      potentialBargeIn: outputInterruption.phase === "idle"
        ? null
        : outputInterruption.phase === "held"
          ? "pending"
          : outputInterruption.phase
    },
    audio: {
      asrAvailable: session.asrAvailable,
      transport: {
        disconnectCount: session.audioDisconnectCount,
        reconnectCount: session.audioReconnectCount,
        reconnecting: session.audioReconnectPromise !== null,
        recoveryPacing:
          performance.now() < session.audioRecoveryPacingUntilMs,
        socketReadyState: session.audioSocket?.readyState ?? null
      },
      level: session.audioLevel,
      capture: session.capture?.stats ?? session.captureTelemetry,
      pipeline: session.audioPipelineTelemetry,
      renderProbe: assistantRenderProbe.snapshot,
      lastRenderStop: session.lastRenderStopEvidence,
      vadShadow: vadShadowSnapshot(),
      vadControl: {
        ...session.vadControl,
        telemetry: session.vadControlTelemetry
      },
      localAudioReflex: {
        ...localAudioReflex.snapshot,
        config: { ...localAudioReflex.snapshot.config }
      },
      acousticReflexShadow: {
        ...acousticReflexShadowState,
        decisions: session.acousticReflexShadow.decisions,
        agreements: session.acousticReflexShadow.agreements,
        agreementRate: session.acousticReflexShadow.decisions === 0
          ? null
          : session.acousticReflexShadow.agreements /
            session.acousticReflexShadow.decisions,
        labels: { ...session.acousticReflexShadow.labels },
        inferenceMs: numberDistribution(
          session.acousticReflexShadow.inferenceMs
        ),
        activeStreamId: session.acousticTraceStreamId
      },
      outputInterruptionLifecycle: {
        ...outputInterruption
      },
      runtimeEvidence:
        session.audioRuntimeEvidence.map((event) => ({ ...event }))
    },
    metrics: {
      responseStartMs: metricValue(elements.responseMetric),
      responseAfterEndpointMs:
        session.lastResponseAfterEndpointMs === null
          ? null
          : Math.round(session.lastResponseAfterEndpointMs),
      stopCommandMs: metricValue(elements.stopMetric),
      stopRenderedMs:
        session.lastRenderStopEvidence === null
          ? null
          : Math.round(session.lastRenderStopEvidence.latencyMs),
      interruptions: Number.parseInt(
        elements.interruptMetric.textContent,
        10
      ),
      tentativePauses: session.tentativePauseCount,
      dismissedBackchannels: session.backchannelCount,
      dismissedPotentials: session.dismissedPotentialCount
    },
    text: {
      assistant: elements.assistantText.textContent,
      user: elements.userText.textContent
    },
    semantic: {
      authority: "backend-interaction-runtime",
      sessionId: session.interactionSessionId,
      kernelStateVersion: session.interactionStateVersion,
      pendingConfirmation:
        session.pendingConfirmation === null
          ? null
          : { ...session.pendingConfirmation },
      revisions: session.semanticRevisions.map((revision) => ({
        ...revision
      })),
      state:
        session.semanticState === null
          ? null
          : { ...session.semanticState }
    },
    trace: session.trace.map((event) => ({ ...event }))
  };
}

function resetAutomation() {
  session.audioTransportEpoch += 1;
  session.active = false;
  clearTimeout(session.endpointTimer);
  clearTimeout(session.taskDeliveryTimer);
  session.endpointTimer = null;
  session.taskDeliveryTimer = null;
  cancelActiveResponse("reset de automação");
  cancelActiveTask("reset de automação");
  session.pendingTaskResults = [];
  rejectAudioFlushWaiters("reset de automação");
  session.recognition?.abort();
  session.mediaStream?.getTracks().forEach((track) => track.stop());
  void session.capture?.stop("automation-reset").catch(() => {});
  session.capture = null;
  session.audioSocket?.close();
  session.audioSocket = null;
  session.inputMode = null;
  session.mediaStream = null;
  session.recognition = null;
  releaseAssistantAudio();
  session.finalText = "";
  session.earlyBackchannelTurnIds.clear();
  session.history = [];
  session.backchannelCount = 0;
  session.dismissedPotentialCount = 0;
  session.interruptCount = 0;
  session.lastSpeechEndedAt = null;
  session.lastEndpointCommittedAt = null;
  session.lastRenderStopEvidence = null;
  session.renderStopGeneration += 1;
  session.lastResponseAfterEndpointMs = null;
  session.responseActive = false;
  session.responseAudioStarted = false;
  session.responseText = "";
  session.interactionSessionId = createInteractionSessionId();
  resetTrainingTraceRecorder();
  session.interactionStateVersion = 0;
  session.interactionTurnSequence = 0;
  session.pendingConfirmation = null;
  session.semanticRevisions = [];
  session.semanticState = null;
  session.speechBuffer = "";
  session.automationPcmAudit = {
    activeClip: null,
    clips: [],
    ring: []
  };
  session.audioRuntimeEvidence = [];
  session.tentativePauseCount = 0;
  session.userSpeaking = false;
  session.vadControl = { state: "unknown" };
  session.vadControlTelemetry = null;
  session.audioPipelineTelemetry = null;
  session.vadShadow = createVadShadowTelemetry();
  session.trace = [];
  elements.eventLog.replaceChildren();
  elements.responseMetric.textContent = "—";
  elements.stopMetric.textContent = "—";
  elements.interruptMetric.textContent = "0";
  elements.userText.textContent = "A transcrição aparecerá aqui.";
  setStatus("parado", "idle");
  return automationSnapshot();
}

function bytesFromBase64(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
    throw new TypeError("PCM base64 precisa conter PCM16LE alinhado.");
  }
  return bytes;
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function registerAutomationAcousticStream(
  audio,
  silenceSamples,
  options
) {
  const sampleCount = audio.byteLength / 2 + silenceSamples;
  const bytes = new Uint8Array(sampleCount * 2);
  bytes.set(audio);
  const hash = await sha256Bytes(bytes);
  if (
    options.expectedStreamSha256 !== undefined &&
    options.expectedStreamSha256 !== `sha256:${hash}`
  ) {
    throw new Error("hash do stream PCM diverge do esperado");
  }
  session.acousticTraceStreamSequence += 1;
  const streamId = options.streamId ??
    `automation-pcm-${session.acousticTraceStreamSequence}-${hash.slice(0, 12)}`;
  reflexTrainingTraceRecorder.registerStream({
    streamId,
    role: "user-input-fixture",
    mediaRef: options.mediaRef ?? `inline:pcm-sha256:${hash}`,
    sha256: `sha256:${hash}`,
    sampleRate: 16_000,
    channels: 1,
    encoding: "pcm_s16le",
    sampleCount
  });
  session.acousticTraceStreamId = streamId;
  session.acousticTraceStreamSampleCount = sampleCount;
  return { streamId, sha256: `sha256:${hash}`, sampleCount };
}

async function replayAutomationPcm(base64, options = {}) {
  if (options.reset !== false) {
    resetAutomation();
  }
  const audio = bytesFromBase64(base64);
  const frameMs = options.frameMs ?? 20;
  const samplesPerFrame = 16_000 * frameMs / 1_000;
  const silenceSamples = Math.round(
    16_000 * (options.silenceMs ?? 1_800) / 1_000
  );
  if (!Number.isInteger(samplesPerFrame)) {
    throw new RangeError("frameMs não produz amostras inteiras.");
  }
  const acousticStream = await registerAutomationAcousticStream(
    audio,
    silenceSamples,
    options
  );

  const socket = await connectLocalAudio();
  session.active = true;
  const mode = options.mode === "barge-in"
    ? "automation-pcm-barge-in"
    : "automation-pcm";
  session.inputMode = mode;
  setStatus("reproduzindo áudio de avaliação", "live");
  log("session.started", "PCM de avaliação · mesmo transporte local");
  log(
    "automation.pcm.feed.started",
    `${mode} · ${acousticStream.streamId}`
  );

  const audioSamples = audio.byteLength / 2;
  const totalSamples = audioSamples + silenceSamples;
  const startedAt = performance.now();
  const interruptBaseline = session.interruptCount;
  let sequence = 0;
  for (
    let sampleStart = 0;
    sampleStart < totalSamples;
    sampleStart += samplesPerFrame
  ) {
    if (options.realtime !== false) {
      const targetAt = startedAt + sampleStart / 16_000 * 1_000;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, targetAt - performance.now()))
      );
    }
    if (
      session.audioSocket !== socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return automationSnapshot();
    }
    if (
      options.stopAfterInterruption &&
      session.interruptCount > interruptBaseline
    ) {
      break;
    }
    const count = Math.min(
      samplesPerFrame,
      totalSamples - sampleStart
    );
    const frame = new Int16Array(count);
    if (sampleStart < audioSamples) {
      const sourceCount = Math.min(count, audioSamples - sampleStart);
      frame.set(new Int16Array(
        audio.buffer,
        audio.byteOffset + sampleStart * 2,
        sourceCount
      ));
    }
    await waitForSocketCapacity(socket);
    socket.send(encodePcmFrame({
      sequence,
      sampleStart,
      pcm16: frame
    }));
    sequence += 1;
  }
  if (
    options.stopAfterInterruption &&
    session.interruptCount > interruptBaseline &&
    session.audioSocket === socket
  ) {
    socket.close();
    session.audioSocket = null;
    log("automation.pcm.feed.stopped", "interrupção observada");
  }
  log("automation.pcm.feed.completed", `${sequence} frames enviados`);
  return automationSnapshot();
}

function injectAutomationSpeech(rawText, options = {}) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    throw new TypeError("A fala injetada não pode ser vazia.");
  }

  const commit = options.commit !== false;
  session.active = true;
  clearTimeout(session.endpointTimer);
  session.endpointTimer = null;
  session.userSpeaking = true;
  log("user.speech.started", "automation");
  interruptAssistant();
  elements.userText.textContent = text;
  log("user.transcript.final", text);
  session.userSpeaking = false;
  session.lastSpeechEndedAt = performance.now();
  log("user.speech.ended", "automation");

  if (commit) {
    if (handleExplicitTaskCancellation(text)) {
      session.finalText = "";
    } else {
      session.finalText = text;
      void processTurn();
    }
  } else {
    session.finalText = "";
    setListeningStatus();
  }

  return automationSnapshot();
}

async function loadHealth() {
  await loadAcousticReflexShadow();
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    const runtimeFingerprint =
      health.process?.runtimeFingerprint?.sha256;
    if (/^[a-f0-9]{64}$/iu.test(runtimeFingerprint ?? "")) {
      runtimeTrainingConfigHash = `sha256:${runtimeFingerprint.toLowerCase()}`;
      resetTrainingTraceRecorder();
    } else {
      log(
        "training-trace.config.error",
        "runtime fingerprint ausente ou inválido"
      );
    }
    const brain =
      health.brain === "openai"
        ? `OpenAI: ${health.models.interaction} + ${health.models.task}`
        : "mock local";
    elements.brainLabel.textContent = brain;
    session.asrAvailable = health.asr?.state === "ready";
    session.vadShadow.health = health.vadShadow ?? {
      state: "disabled"
    };
    session.vadControl = health.vadControl ?? {
      state: "unknown"
    };
    const inputLabel = document.querySelector("#inputLabel");
    if (inputLabel) {
      inputLabel.textContent = session.asrAvailable
        ? `ASR aberto ${health.asr.model} no servidor local`
        : Recognition
          ? "fallback Web Speech do Chrome"
          : "indisponível";
    }
    log("brain.connected", brain);
    log(
      "asr.health",
      session.asrAvailable
        ? `${health.asr.model} · ${health.asr.workers} workers`
        : health.asr?.state ?? "ausente"
    );
    if (!session.asrAvailable && !Recognition) {
      elements.startButton.disabled = true;
      setStatus("entrada de voz indisponível", "error");
    }
  } catch (error) {
    session.asrAvailable = false;
    elements.brainLabel.textContent = "indisponível";
    log("brain.health.error", error.message);
  }
}

elements.startButton.addEventListener("click", () => {
  void startSession();
});
elements.stopButton.addEventListener("click", () => {
  void stopSession();
});
elements.demoButton.addEventListener("click", () => {
  speakStandalone(
    "Esta é uma resposta propositalmente longa. Comece a falar a qualquer momento para verificar se eu paro imediatamente e devolvo o turno para você.",
    "barge-in-probe"
  );
});
elements.clearButton.addEventListener("click", () => {
  elements.eventLog.replaceChildren();
  session.trace = [];
});

if (automationEnabled) {
  Object.defineProperty(window, "__duplexLab", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      injectSpeech: injectAutomationSpeech,
      bargeInPcmBase64(base64, options = {}) {
        return replayAutomationPcm(base64, {
          ...options,
          mode: "barge-in",
          reset: false,
          silenceMs: options.silenceMs ?? 1_800,
          stopAfterInterruption: true
        });
      },
      replayPcmBase64: replayAutomationPcm,
      audioAudit: automationAudioAudit,
      simulateAudioEvent(event) {
        handleLocalAudioEvent(event);
        return automationSnapshot();
      },
      async refreshCaptureTelemetry() {
        await session.capture?.requestTelemetry();
        return automationSnapshot();
      },
      flushAudio: flushLocalAudio,
      dropAudioTransport() {
        const socket = session.audioSocket;
        if (
          !session.active ||
          session.inputMode !== "local-pcm" ||
          socket?.readyState !== WebSocket.OPEN
        ) {
          throw new Error("transporte PCM local não está ativo");
        }
        socket.close(4000, "automation-transport-drop");
        return automationSnapshot();
      },
      reset: resetAutomation,
      snapshot: automationSnapshot,
      speak(text) {
        session.active = true;
        speakStandalone(String(text), "automation-probe");
        return automationSnapshot();
      },
      speakLoop(text) {
        session.active = true;
        speakLoopingStandalone(String(text));
        return automationSnapshot();
      }
    })
  });
  log("automation.ready", "localhost");
}

healthPromise = loadHealth();
