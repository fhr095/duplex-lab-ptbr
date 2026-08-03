import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  EXP0019_FROZEN_SIGNATURE,
  EXP0019_PAYLOAD_KEYS,
  validateExp0019CausalPayload
} from "../src/eval/exp-0019-causal-audio-bridge.mjs";
import {
  EXP0019_CRITICAL_SOURCE_PATHS,
  EXP0019_INSTRUMENTATION_FREEZE_PATH as BOUNDARY_FREEZE_PATH,
  validateExp0019InstrumentationFreeze
} from "../src/eval/exp-0019-boundary.mjs";
import {
  validateExp0019NodeReplayArtifact
} from "../src/eval/exp-0019-replay.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  validateContextRelevanceCheckpoint
} from "../web/context-relevance-shadow.mjs";

export const EXP0019_BROWSER_REPORT_SCHEMA =
  "exp-0019-browser-campaign-v1";
export const EXP0019_NODE_REPLAY_SCHEMA = "exp-0019-node-replay-v1";
export const EXP0019_BROWSER_REPETITIONS = 2;
export const EXP0019_NODE_REPLAY_PATH =
  "eval/reports/exp-0019-node-replay-v0.1.json";
export const EXP0019_BROWSER_REPORT_PATH =
  "eval/reports/exp-0019-browser-v0.1.json";
export const EXP0019_BROWSER_CHECKPOINT_PATH =
  "web/context-relevance-checkpoint.json";
export const EXP0019_INSTRUMENTATION_FREEZE_PATH =
  BOUNDARY_FREEZE_PATH;
export const EXP0019_BROWSER_TARGET_URL =
  "http://localhost:4173/?automation=1&experiment=0019";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const COMMAND_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 60_000;
const PARITY_RELATIVE_ERROR_LIMIT = 1e-12;
const PROPOSAL_P95_LIMIT_MS = 300;
const CALCULATION_P95_LIMIT_MS = 50;
const RENDER_STOP_P95_LIMIT_MS = 250;
const ARM_NAMES = Object.freeze(["B0", "B1"]);
const CUT_GATE_NAMES = Object.freeze([
  "causalProbes",
  "readyEvaluations",
  "oneProposalPerArmPerScene",
  "nodeBrowserParity",
  "frozenSignature",
  "deterministicNormalizedTrace",
  "proposalP95WithinBudget",
  "calculationP95WithinBudget",
  "lifecycleUnchanged",
  "lifecycleShadowOnOffEquivalent",
  "rendererStopP95WithinBudget",
  "physicalStopContextIsolation",
  "zeroEffects",
  "zeroAuthority"
]);
const CLASS_NAMES = Object.freeze([
  "BACKGROUND_OR_NOT_DIRECTED",
  "DIRECTED_TO_ASSISTANT"
]);
const WALL_CLOCK_KEYS = new Set([
  "baseLatencyMs",
  "calculationCompletedAtPerformanceMs",
  "calculationMs",
  "calculationStartedAtPerformanceMs",
  "checkpointReadyAtPerformanceMs",
  "lastActiveEndContextTime",
  "lastEvidenceAtPerformanceMs",
  "lastRenderedAtMs",
  "latencyMs",
  "observedAtMs",
  "observedContextTime",
  "outputLatencyMs",
  "proposalAtPerformanceMs",
  "proposalLatencyMs",
  "requestedAtPerformanceMs",
  "stopRenderedMs",
  "triggerAtMs"
]);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`EXP-0019 browser runner: ${message}`);
  }
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeSha256(value) {
  if (typeof value !== "string") return null;
  const normalized = value.startsWith("sha256:")
    ? value.toLowerCase()
    : `sha256:${value.toLowerCase()}`;
  return /^sha256:[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

export function exp0019BrowserTargetUrl(value = EXP0019_BROWSER_TARGET_URL) {
  const url = new URL(value);
  url.searchParams.set("automation", "1");
  url.searchParams.set("experiment", "0019");
  invariant(
    ["localhost", "127.0.0.1"].includes(url.hostname),
    "o gate do EXP-0019 aceita somente localhost ou 127.0.0.1"
  );
  return url.href;
}

export function parseExp0019BrowserArgs(args) {
  const options = {
    cdpUrl: null,
    checkpoint: EXP0019_BROWSER_CHECKPOINT_PATH,
    failOnHold: true,
    instrumentationFreeze: EXP0019_INSTRUMENTATION_FREEZE_PATH,
    out: EXP0019_BROWSER_REPORT_PATH,
    replay: EXP0019_NODE_REPLAY_PATH,
    repetitions: EXP0019_BROWSER_REPETITIONS,
    targetUrl: process.env.DUPLEX_URL ?? EXP0019_BROWSER_TARGET_URL
  };
  const fields = {
    "--cdp-url": "cdpUrl",
    "--checkpoint": "checkpoint",
    "--instrumentation-freeze": "instrumentationFreeze",
    "--out": "out",
    "--replay": "replay",
    "--repetitions": "repetitions",
    "--target-url": "targetUrl"
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--no-fail") {
      options.failOnHold = false;
      continue;
    }
    const field = fields[argument];
    invariant(field && index + 1 < args.length,
      `argumento desconhecido ou sem valor: ${argument}`);
    const value = args[++index];
    options[field] = field === "repetitions" ? Number(value) : value;
  }
  invariant(
    options.repetitions === EXP0019_BROWSER_REPETITIONS,
    "o pré-registro permite exatamente duas repetições; terceira execução negada"
  );
  options.targetUrl = exp0019BrowserTargetUrl(options.targetUrl);
  return Object.freeze(options);
}

export function discoverExp0019CdpUrl(environment = process.env) {
  if (nonEmptyText(environment.CDP_URL)) {
    return environment.CDP_URL;
  }
  const route = execFileSync("ip", ["route", "show", "default"], {
    encoding: "utf8"
  });
  const gateway = /\bvia\s+([0-9.]+)/u.exec(route)?.[1];
  invariant(gateway, "gateway do Windows não encontrado");
  return `http://${gateway}:9223`;
}

function diagnosticFromConsole(argumentsList) {
  return argumentsList
    .map((argument) => argument.value ?? argument.description ?? "")
    .join(" ")
    .slice(0, 500);
}

export async function connectExp0019Chrome(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const targetUrl = exp0019BrowserTargetUrl(options.targetUrl);
  const cdpUrl = options.cdpUrl;
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  invariant(typeof fetchImpl === "function", "fetch CDP indisponível");
  invariant(typeof WebSocketImpl === "function", "WebSocket CDP indisponível");
  invariant(nonEmptyText(cdpUrl), "URL CDP ausente");

  const listResponse = await fetchImpl(`${cdpUrl}/json/list`, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  invariant(listResponse.ok, `CDP retornou HTTP ${listResponse.status}`);
  const pages = await listResponse.json();
  const targetOrigin = new URL(targetUrl).origin;
  let page = pages.find((candidate) => {
    if (candidate.type !== "page") return false;
    try {
      return new URL(candidate.url).origin === targetOrigin;
    } catch {
      return false;
    }
  });
  if (!page) {
    const createResponse = await fetchImpl(
      `${cdpUrl}/json/new?${encodeURIComponent(targetUrl)}`,
      {
        method: "PUT",
        signal: AbortSignal.timeout(timeoutMs)
      }
    );
    invariant(createResponse.ok,
      `CDP não criou a aba: HTTP ${createResponse.status}`);
    page = await createResponse.json();
  }

  const socket = new WebSocketImpl(page.webSocketDebuggerUrl);
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

  const pending = new Map();
  const diagnostics = {
    consoleErrors: [],
    runtimeErrors: [],
    httpErrors: []
  };
  let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const operation = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(operation.timer);
      if (message.error) {
        operation.reject(new Error(message.error.message));
      } else {
        operation.resolve(message.result);
      }
      return;
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    ) {
      diagnostics.consoleErrors.push(
        diagnosticFromConsole(message.params.args)
      );
    }
    if (message.method === "Runtime.exceptionThrown") {
      diagnostics.runtimeErrors.push(
        (message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text).slice(0, 500)
      );
    }
    if (
      message.method === "Network.responseReceived" &&
      message.params.response.status >= 400
    ) {
      diagnostics.httpErrors.push({
        status: message.params.response.status,
        url: message.params.response.url
      });
    }
  });
  socket.addEventListener("close", () => {
    for (const operation of pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new Error("CDP desconectado"));
    }
    pending.clear();
  });

  function send(method, params = {}, commandTimeoutMs = timeoutMs) {
    return new Promise((resolveCommand, rejectCommand) => {
      sequence += 1;
      const id = sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCommand(new Error(`timeout CDP: ${method}`));
      }, commandTimeoutMs);
      pending.set(id, {
        resolve: resolveCommand,
        reject: rejectCommand,
        timer
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression, commandTimeoutMs = timeoutMs) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, commandTimeoutMs);
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
      );
    }
    return result.result?.value;
  }

  async function waitFor(probe, waitTimeoutMs = READY_TIMEOUT_MS) {
    const deadline = Date.now() + waitTimeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await probe();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(
      "condição do Chrome não satisfeita" +
        (lastError ? `: ${lastError.message}` : "")
    );
  }

  return Object.freeze({
    page,
    diagnostics,
    evaluate,
    send,
    socket,
    waitFor,
    clearDiagnostics() {
      diagnostics.consoleErrors.length = 0;
      diagnostics.runtimeErrors.length = 0;
      diagnostics.httpErrors.length = 0;
    },
    close() {
      socket.close();
    }
  });
}

export function normalizeExp0019BrowserTrace(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeExp0019BrowserTrace);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !WALL_CLOCK_KEYS.has(key))
      .map(([key, nested]) => [key, normalizeExp0019BrowserTrace(nested)])
  );
}

export function nearestRankP95(values) {
  invariant(
    Array.isArray(values) && values.length > 0 &&
      values.every((value) => Number.isFinite(value) && value >= 0),
    "p95 exige amostras temporais finitas e não negativas"
  );
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function relativeError(observed, expected) {
  if (!Number.isFinite(observed) || !Number.isFinite(expected)) {
    return Number.POSITIVE_INFINITY;
  }
  if (Object.is(expected, 0) || Object.is(expected, -0)) {
    return Object.is(observed, 0) || Object.is(observed, -0)
      ? 0
      : Number.POSITIVE_INFINITY;
  }
  return Math.abs(observed - expected) / Math.abs(expected);
}

function maximumRelativeError(observed, expected) {
  invariant(
    Array.isArray(observed) && Array.isArray(expected) &&
      observed.length === expected.length,
    "vetores de paridade possuem dimensões diferentes"
  );
  return observed.reduce(
    (maximum, value, index) => Math.max(
      maximum,
      relativeError(value, expected[index])
    ),
    0
  );
}

function cloneWithoutSelfHash(value, key) {
  const clone = structuredClone(value);
  delete clone[key];
  return clone;
}

function payloadHasReleasedOnly(payload) {
  const checks = [
    [
      payload.recentInbound.length === 1,
      payload.currentSample >= payload.recentInboundAvailableAtSample
    ],
    [
      nonEmptyText(payload.assistantAudiblePrefixAtDecision),
      payload.currentSample >=
        payload.assistantAudiblePrefixAvailableAtSample
    ],
    [
      nonEmptyText(payload.targetText),
      payload.currentSample >= payload.targetAvailableAtSample
    ]
  ];
  return checks.every(([present, released]) => present === released);
}

function nodeArmTrace(arm) {
  return arm?.trace ?? arm?.proposal ?? arm;
}

function validateNodeDeferArm(arm) {
  return arm?.status === "DEFER_CAUSAL_EVIDENCE" &&
    arm?.classifierExecuted === false &&
    arm?.inferenceCountDelta === 0 &&
    arm?.canProduceEffects === false;
}

function validateNodeReadyArm(arm, name) {
  const trace = nodeArmTrace(arm);
  const envelopeValid = arm !== null && typeof arm === "object" &&
    arm.status === "SHADOW_PROPOSAL" &&
    arm.classifierExecuted === true &&
    arm.inferenceCountDelta === 1 &&
    arm.canProduceEffects === false &&
    arm.frozenTraceExact === true;
  return envelopeValid &&
    (arm.armName === undefined || arm.armName === name) &&
    trace !== null && typeof trace === "object" &&
    exactKeys(trace.probabilities, CLASS_NAMES) &&
    CLASS_NAMES.every((label) =>
      Number.isFinite(trace.probabilities[label])
    );
}

function replayHashValid(replay) {
  return normalizeSha256(replay.replaySha256) ===
    `sha256:${canonicalSha256(cloneWithoutSelfHash(replay, "replaySha256"))}`;
}

function validateProbePayload(scene, probe, expectedBoundary) {
  const payload = probe.payload;
  const validation = validateExp0019CausalPayload(payload, {
    expectedAvailability: scene.ready.payload === undefined ? undefined : {
      recentInboundAvailableAtSample:
        scene.ready.payload.recentInboundAvailableAtSample,
      assistantAudiblePrefixAvailableAtSample:
        scene.ready.payload.assistantAudiblePrefixAvailableAtSample,
      targetAvailableAtSample: scene.ready.payload.targetAvailableAtSample
    }
  });
  if (!validation.valid || !payloadHasReleasedOnly(payload)) return false;
  const boundaryFields = {
    recentInbound: "recentInboundAvailableAtSample",
    assistantAudiblePrefixAtDecision:
      "assistantAudiblePrefixAvailableAtSample",
    targetText: "targetAvailableAtSample"
  };
  const field = boundaryFields[expectedBoundary];
  return field !== undefined && payload.currentSample === payload[field] - 1;
}

export function validateExp0019BrowserReplayInput(replay) {
  const errors = [];
  if (
    replay?.schemaVersion !== EXP0019_NODE_REPLAY_SCHEMA ||
    replay?.experimentId !== "EXP-0019" ||
    !replayHashValid(replay) ||
    !Array.isArray(replay?.scenes) || replay.scenes.length !== 8 ||
    replay?.authority?.canProduceEffects !== false ||
    replayRuntimeFingerprint(replay) === null
  ) {
    errors.push("identidade, hash, cenas ou autoridade do replay incompatíveis");
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  const sceneIds = new Set();
  let readyArms = 0;
  let probesByArm = 0;
  for (const scene of replay.scenes) {
    if (
      !nonEmptyText(scene?.sceneId) || sceneIds.has(scene.sceneId) ||
      !nonEmptyText(scene?.pairRootId) ||
      !Array.isArray(scene?.probes) || scene.probes.length !== 3 ||
      !scene?.ready?.payload || !exactKeys(
        scene.ready.payload,
        EXP0019_PAYLOAD_KEYS
      ) ||
      !exactKeys(scene.ready.arms, ARM_NAMES)
    ) {
      errors.push(`${scene?.sceneId ?? "cena"}: estrutura incompleta`);
      continue;
    }
    sceneIds.add(scene.sceneId);
    const readyValidation = validateExp0019CausalPayload(
      scene.ready.payload
    );
    if (
      !readyValidation.valid ||
      !payloadHasReleasedOnly(scene.ready.payload) ||
      scene.ready.payload.currentSample !==
        scene.ready.payload.targetAvailableAtSample
    ) {
      errors.push(`${scene.sceneId}: payload ready não é causal exato`);
    }
    for (const name of ARM_NAMES) {
      if (!validateNodeReadyArm(scene.ready.arms[name], name)) {
        errors.push(`${scene.sceneId}: arm ready ${name} inválido`);
      } else {
        readyArms += 1;
      }
    }
    const expectedBoundaries = [
      "recentInbound",
      "assistantAudiblePrefixAtDecision",
      "targetText"
    ];
    for (const [index, probe] of scene.probes.entries()) {
      if (
        !probe?.payload || !exactKeys(probe.payload, EXP0019_PAYLOAD_KEYS) ||
        !exactKeys(probe.arms, ARM_NAMES) ||
        probe.currentSample !== probe.payload.currentSample ||
        normalizeSha256(probe.payloadSha256) !==
          `sha256:${canonicalSha256(probe.payload)}` ||
        !validateProbePayload(scene, probe, expectedBoundaries[index])
      ) {
        errors.push(`${scene.sceneId}: probe ${index + 1} inválido`);
        continue;
      }
      for (const name of ARM_NAMES) {
        if (!validateNodeDeferArm(probe.arms[name])) {
          errors.push(
            `${scene.sceneId}: probe ${index + 1}/${name} não deferiu`
          );
        } else {
          probesByArm += 1;
        }
      }
    }
  }
  if (readyArms !== 16 || probesByArm !== 48) {
    errors.push("replay precisa conter 16 proposals e 48 defers por braço");
  }
  if (
    replay?.summary?.scenes !== undefined &&
    replay.summary.scenes !== 8
  ) {
    errors.push("summary.scenes diverge de 8");
  }
  if (
    replay?.summary?.proposals !== undefined &&
    replay.summary.proposals !== 16
  ) {
    errors.push("summary.proposals diverge de 16");
  }
  if (
    replay?.summary?.probes !== undefined &&
    replay.summary.probes !== 48
  ) {
    errors.push("summary.probes diverge de 48");
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

function checkpointIdentity(checkpoint) {
  return {
    schemaVersion: checkpoint.schemaVersion,
    checkpointId: checkpoint.checkpointId,
    browserCheckpointSha256: checkpoint.browserCheckpointSha256,
    sourceCheckpointSha256: checkpoint.source.checkpointSha256,
    arms: Object.fromEntries(ARM_NAMES.map((name) => [name, {
      modelSha256: checkpoint.arms[name].modelSha256,
      threshold: checkpoint.arms[name].threshold
    }])),
    authority: structuredClone(checkpoint.authority),
    adapter: structuredClone(checkpoint.adapter)
  };
}

function checkpointReadyExpression() {
  return `/*EXP0019_CHECKPOINT_READY*/ (async () => {
    const lab = window.__duplexLab;
    if (!lab) return null;
    const snapshot = lab.snapshot().audio?.contextRelevanceShadow ?? null;
    if (snapshot?.state !== "ready") return null;
    const response = await fetch("/context-relevance-checkpoint.json", {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("checkpoint HTTP " + response.status);
    }
    const checkpoint = await response.json();
    return {
      checkpointReadyAtPerformanceMs: performance.now(),
      snapshot,
      servedCheckpoint: {
        schemaVersion: checkpoint.schemaVersion,
        checkpointId: checkpoint.checkpointId,
        browserCheckpointSha256: checkpoint.browserCheckpointSha256,
        sourceCheckpointSha256: checkpoint.source?.checkpointSha256 ?? null,
        arms: {
          B0: {
            modelSha256: checkpoint.arms?.B0?.modelSha256 ?? null,
            threshold: checkpoint.arms?.B0?.threshold ?? null
          },
          B1: {
            modelSha256: checkpoint.arms?.B1?.modelSha256 ?? null,
            threshold: checkpoint.arms?.B1?.threshold ?? null
          }
        },
        authority: checkpoint.authority,
        adapter: checkpoint.adapter
      }
    };
  })()`;
}

function waitReadyExpression() {
  return `/*EXP0019_WAIT_READY*/ (() => {
    const lab = window.__duplexLab;
    if (!lab) return false;
    return lab.snapshot().audio?.contextRelevanceShadow?.state === "ready";
  })()`;
}

function physicalResetExpression() {
  return `/*EXP0019_PHYSICAL_RESET*/ (() => {
    const lab = window.__duplexLab;
    if (!lab) throw new Error("automação indisponível");
    return lab.reset();
  })()`;
}

function physicalStartExpression(stage) {
  return `/*EXP0019_PHYSICAL_START*/ (() => {
    const lab = window.__duplexLab;
    const before = lab.snapshot();
    const requestedAtPerformanceMs = performance.now();
    lab.speakLoop(
      "Esta fala contínua mede se a parada física permanece idêntica com o shadow contextual isolado."
    );
    return {
      stage: ${JSON.stringify(stage)},
      requestedAtPerformanceMs,
      contextCountersBefore: {
        deferCount: before.audio.contextRelevanceShadow.deferCount,
        inferenceCount: before.audio.contextRelevanceShadow.inferenceCount,
        invalidCount: before.audio.contextRelevanceShadow.invalidCount,
        proposalCount: before.audio.contextRelevanceShadow.proposalCount,
        effectsDispatched:
          before.audio.contextRelevanceShadow.effectsDispatched
      }
    };
  })()`;
}

function physicalWaitSpeakingExpression() {
  return `/*EXP0019_PHYSICAL_WAIT_SPEAKING*/ (() => {
    const snapshot = window.__duplexLab.snapshot();
    return snapshot.state.assistantSpeaking && snapshot.trace.some(
      (event) => event.type === "assistant.render.active"
    ) ? snapshot : null;
  })()`;
}

function physicalTriggerExpression() {
  return `/*EXP0019_PHYSICAL_TRIGGER*/ (() => {
    window.__duplexLab.simulateAudioEvent({
      type: "user.speech.started",
      turnId: "exp0019-physical-stop",
      rms: 0.06,
      threshold: 0.025
    });
    return window.__duplexLab.snapshot();
  })()`;
}

function physicalWaitStopExpression() {
  return `/*EXP0019_PHYSICAL_WAIT_STOP*/ (() => {
    const snapshot = window.__duplexLab.snapshot();
    const paused = snapshot.trace.some(
      (event) => event.type === "assistant.speech.paused"
    );
    return paused && snapshot.audio.lastRenderStop !== null
      ? snapshot
      : null;
  })()`;
}

function contextualCounters(snapshot) {
  const value = snapshot?.audio?.contextRelevanceShadow;
  return {
    deferCount: value?.deferCount ?? null,
    inferenceCount: value?.inferenceCount ?? null,
    invalidCount: value?.invalidCount ?? null,
    proposalCount: value?.proposalCount ?? null,
    effectsDispatched: value?.effectsDispatched ?? null
  };
}

function lifecycleTransitions(snapshot) {
  const transitions = [];
  for (const event of snapshot?.trace ?? []) {
    if (event.type !== "output-interruption.transition") continue;
    try {
      const detail = JSON.parse(event.detail);
      transitions.push({
        eventType: detail.eventType,
        previousPhase: detail.previousPhase,
        phase: detail.phase,
        reason: detail.reason,
        pauseKind: detail.pauseKind,
        intents: (detail.intents ?? []).map((intent) => intent.type)
      });
    } catch {
      transitions.push({ parseError: true });
    }
  }
  return transitions;
}

function rendererSequence(snapshot) {
  const allowed = new Set([
    "assistant.render.active",
    "assistant.speech.paused",
    "assistant.render.stopped"
  ]);
  return (snapshot?.trace ?? [])
    .filter((event) => allowed.has(event.type))
    .map((event) => event.type);
}

function projectPhysicalStop(stage, start, snapshot, error = null) {
  const lastRenderStop = snapshot?.audio?.lastRenderStop ?? null;
  const stopRenderedMs = snapshot?.metrics?.stopRenderedMs ?? null;
  const contextCountersAfter = contextualCounters(snapshot);
  const transitions = lifecycleTransitions(snapshot);
  const renderer = rendererSequence(snapshot);
  const pass = error === null &&
    lastRenderStop?.kind === "browser-render-stop" &&
    lastRenderStop?.renderedThroughTrigger === true &&
    Number.isFinite(lastRenderStop?.latencyMs) &&
    lastRenderStop.latencyMs >= 0 &&
    lastRenderStop.latencyMs <= RENDER_STOP_P95_LIMIT_MS &&
    Number.isFinite(stopRenderedMs) && stopRenderedMs >= 0 &&
    stopRenderedMs <= RENDER_STOP_P95_LIMIT_MS &&
    transitions.length > 0 &&
    transitions.some((transition) =>
      transition.eventType === "PAUSE_REQUESTED" &&
      transition.phase === "held"
    ) &&
    renderer.includes("assistant.render.active") &&
    renderer.includes("assistant.speech.paused") &&
    renderer.includes("assistant.render.stopped") &&
    isDeepStrictEqual(start?.contextCountersBefore, contextCountersAfter);
  return {
    stage,
    requestedAtPerformanceMs: start?.requestedAtPerformanceMs ?? null,
    contextCountersBefore: start?.contextCountersBefore ?? null,
    contextCountersAfter,
    transitions,
    rendererSequence: renderer,
    lifecycleFinal: snapshot?.audio?.outputInterruptionLifecycle ?? null,
    lastRenderStop,
    stopRenderedMs,
    error,
    pass
  };
}

async function runPhysicalStop(chrome, stage) {
  let start = null;
  let snapshot = null;
  let error = null;
  try {
    await chrome.evaluate(physicalResetExpression());
    start = await chrome.evaluate(physicalStartExpression(stage));
    await chrome.waitFor(
      () => chrome.evaluate(physicalWaitSpeakingExpression()),
      15_000
    );
    await chrome.evaluate(physicalTriggerExpression());
    snapshot = await chrome.waitFor(
      () => chrome.evaluate(physicalWaitStopExpression()),
      15_000
    );
  } catch (caught) {
    error = caught.message;
    snapshot = await chrome.evaluate(
      `/*EXP0019_PHYSICAL_DIAGNOSTIC*/ window.__duplexLab?.snapshot?.() ?? null`
    ).catch(() => null);
  } finally {
    await chrome.evaluate(physicalResetExpression()).catch(() => {});
  }
  return projectPhysicalStop(stage, start, snapshot, error);
}

function releaseEvidenceExpression(sceneId, currentSample) {
  return `/*EXP0019_RELEASE_EVIDENCE*/ (() => {
    const release = {
      sceneId: ${JSON.stringify(sceneId)},
      currentSample: ${JSON.stringify(currentSample)},
      lastEvidenceAtPerformanceMs: performance.now()
    };
    globalThis.__exp0019EvidenceRelease = release;
    return release;
  })()`;
}

function evaluatePayloadExpression(sceneId, phase, payload) {
  return `/*EXP0019_EVALUATE_${phase.toUpperCase()}*/ (() => {
    const sceneId = ${JSON.stringify(sceneId)};
    const phase = ${JSON.stringify(phase)};
    const payload = ${JSON.stringify(payload)};
    const lab = window.__duplexLab;
    if (!lab?.evaluateContextRelevance) {
      throw new Error("hook EXP-0019 indisponível");
    }
    const beforeLifecycle =
      lab.snapshot().audio?.outputInterruptionLifecycle ?? null;
    const release = phase === "ready"
      ? globalThis.__exp0019EvidenceRelease
      : null;
    if (
      phase === "ready" &&
      (release?.sceneId !== sceneId ||
        release?.currentSample !== payload.currentSample)
    ) {
      throw new Error("marcador da última evidência divergiu");
    }
    const calculationStartedAtPerformanceMs = performance.now();
    const evaluation = lab.evaluateContextRelevance(payload);
    const proposalAtPerformanceMs = performance.now();
    const afterLifecycle =
      lab.snapshot().audio?.outputInterruptionLifecycle ?? null;
    return {
      sceneId,
      phase,
      payload,
      result: evaluation.result,
      snapshot: evaluation.snapshot,
      lifecycle: { before: beforeLifecycle, after: afterLifecycle },
      timing: {
        lastEvidenceAtPerformanceMs:
          release?.lastEvidenceAtPerformanceMs ?? null,
        calculationStartedAtPerformanceMs,
        calculationCompletedAtPerformanceMs: proposalAtPerformanceMs,
        proposalAtPerformanceMs,
        proposalLatencyMs: release === null
          ? null
          : proposalAtPerformanceMs - release.lastEvidenceAtPerformanceMs,
        calculationMs:
          proposalAtPerformanceMs - calculationStartedAtPerformanceMs
      }
    };
  })()`;
}

function cleanDiagnostics(value) {
  return value &&
    ["consoleErrors", "runtimeErrors", "httpErrors"].every(
      (field) => Array.isArray(value[field]) && value[field].length === 0
    );
}

function browserReportDecision(gates) {
  if (Object.values(gates).every(Boolean)) {
    return "BROWSER_RUNNER_PASS_NOT_EXPERIMENT_DECISION";
  }
  return CUT_GATE_NAMES.some((name) => gates[name] === false)
    ? "CUT_CAUSAL_AUDIO_BRIDGE"
    : "INVALIDATE_CAUSAL_AUDIO_INSTRUMENT";
}

function copyDiagnostics(value) {
  return {
    consoleErrors: [...(value?.consoleErrors ?? [])],
    runtimeErrors: [...(value?.runtimeErrors ?? [])],
    httpErrors: structuredClone(value?.httpErrors ?? [])
  };
}

function checkpointReadinessPass(readiness, checkpoint) {
  const expected = checkpointIdentity(checkpoint);
  const snapshot = readiness?.snapshot;
  return readiness !== null &&
    isDeepStrictEqual(readiness.servedCheckpoint, expected) &&
    snapshot?.state === "ready" &&
    snapshot?.checkpointId === checkpoint.checkpointId &&
    snapshot?.sourceCheckpointSha256 ===
      checkpoint.source.checkpointSha256 &&
    snapshot?.deferCount === 0 &&
    snapshot?.inferenceCount === 0 &&
    snapshot?.invalidCount === 0 &&
    snapshot?.proposalCount === 0 &&
    snapshot?.effectsDispatched === 0 &&
    snapshot?.authority?.canProduceEffects === false;
}

async function prepareRepetition(chrome, targetUrl, checkpoint) {
  chrome.clearDiagnostics?.();
  await Promise.all([
    chrome.send("Runtime.enable"),
    chrome.send("Page.enable"),
    chrome.send("Network.enable")
  ]);
  await chrome.send("Page.bringToFront");
  await chrome.send("Page.navigate", { url: targetUrl });
  await chrome.waitFor(
    () => chrome.evaluate(waitReadyExpression()),
    READY_TIMEOUT_MS
  );
  const readiness = await chrome.evaluate(checkpointReadyExpression());
  invariant(
    checkpointReadinessPass(readiness, checkpoint),
    "checkpoint servido/instanciado não está pronto ou divergiu"
  );
  return readiness;
}

async function readRuntimeFingerprint(fetchImpl, targetUrl) {
  const healthUrl = new URL("/api/health", targetUrl);
  const response = await fetchImpl(healthUrl, {
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS)
  });
  invariant(response.ok,
    `health do runtime retornou HTTP ${response.status}`);
  const health = await response.json();
  const sha256 = normalizeSha256(
    health?.process?.runtimeFingerprint?.sha256
  );
  invariant(sha256, "health não publicou runtime fingerprint válido");
  return Object.freeze({ sha256 });
}

function assertProbeObservation(observation, payload) {
  return observation?.phase === "probe" &&
    isDeepStrictEqual(observation.payload, payload) &&
    observation.result?.status === "DEFER_CAUSAL_EVIDENCE" &&
    observation.result?.classifierCalls === 0 &&
    observation.result?.proposal === null &&
    Array.isArray(observation.result?.effects) &&
    observation.result.effects.length === 0 &&
    observation.result?.authority?.canProduceEffects === false &&
    observation.snapshot?.effectsDispatched === 0 &&
    observation.snapshot?.authority?.canProduceEffects === false &&
    isDeepStrictEqual(
      observation.lifecycle?.before,
      observation.lifecycle?.after
    );
}

function expectedProbabilities(trace) {
  if (
    trace?.probabilities &&
    exactKeys(trace.probabilities, CLASS_NAMES) &&
    CLASS_NAMES.every((name) => Number.isFinite(trace.probabilities[name]))
  ) {
    return CLASS_NAMES.map((name) => trace.probabilities[name]);
  }
  if (Number.isFinite(trace?.backgroundProbability)) {
    return [trace.backgroundProbability, 1 - trace.backgroundProbability];
  }
  return null;
}

function compareReadyArm(browserArm, nodeArm, checkpoint, name) {
  const trace = nodeArmTrace(nodeArm);
  const expectedFeatures = trace?.featureValues ??
    (Array.isArray(trace?.features)
      ? trace.features
      : trace?.features?.values);
  const observedFeatures = browserArm?.features?.values;
  const expectedProbabilityValues = expectedProbabilities(trace);
  const observedProbabilityValues = CLASS_NAMES.map(
    (label) => browserArm?.probabilities?.[label]
  );
  let featureRelativeError = null;
  let probabilityRelativeError = null;
  try {
    const observedFeatureError = maximumRelativeError(
      observedFeatures,
      expectedFeatures
    );
    const observedProbabilityError = maximumRelativeError(
      observedProbabilityValues,
      expectedProbabilityValues
    );
    featureRelativeError = Number.isFinite(observedFeatureError)
      ? observedFeatureError
      : null;
    probabilityRelativeError = Number.isFinite(observedProbabilityError)
      ? observedProbabilityError
      : null;
  } catch {
    // Dimensão/shape divergente permanece null e falha fechado sem corromper JSON.
  }
  const exact =
    browserArm?.arm === name &&
    browserArm?.contextEnabled === trace?.contextEnabled &&
    browserArm?.modelSha256 === trace?.modelSha256 &&
    browserArm?.modelSha256 === checkpoint.arms[name].modelSha256 &&
    browserArm?.threshold === trace?.threshold &&
    browserArm?.threshold === checkpoint.arms[name].threshold &&
    browserArm?.rawPredicted === trace?.rawPredicted &&
    browserArm?.predicted === trace?.predicted &&
    isDeepStrictEqual(
      browserArm?.features?.names,
      checkpoint.featureNames
    ) &&
    nodeArm?.frozenTraceExact !== false;
  return Object.freeze({
    exact,
    featureRelativeError,
    probabilityRelativeError,
    pass:
      exact &&
      featureRelativeError !== null &&
      probabilityRelativeError !== null &&
      featureRelativeError <= PARITY_RELATIVE_ERROR_LIMIT &&
      probabilityRelativeError <= PARITY_RELATIVE_ERROR_LIMIT
  });
}

function assertReadyObservation(observation, scene, checkpoint) {
  const payload = scene.ready.payload;
  const arms = {};
  for (const name of ARM_NAMES) {
    arms[name] = compareReadyArm(
      observation?.result?.proposal?.arms?.[name],
      scene.ready.arms[name],
      checkpoint,
      name
    );
  }
  const shapePass = observation?.phase === "ready" &&
    isDeepStrictEqual(observation.payload, payload) &&
    observation.result?.status === "SHADOW_PROPOSAL" &&
    observation.result?.classifierCalls === 2 &&
    exactKeys(observation.result?.proposal?.arms, ARM_NAMES) &&
    Array.isArray(observation.result?.effects) &&
    observation.result.effects.length === 0 &&
    observation.result?.authority?.canProduceEffects === false &&
    observation.snapshot?.effectsDispatched === 0 &&
    observation.snapshot?.authority?.canProduceEffects === false &&
    isDeepStrictEqual(
      observation.lifecycle?.before,
      observation.lifecycle?.after
    ) &&
    Number.isFinite(observation.timing?.proposalLatencyMs) &&
    observation.timing.proposalLatencyMs >= 0 &&
    Number.isFinite(observation.timing?.calculationMs) &&
    observation.timing.calculationMs >= 0;
  return Object.freeze({
    shapePass,
    arms,
    pass: shapePass && ARM_NAMES.every((name) => arms[name].pass)
  });
}

function signatureFromObservations(sceneObservations) {
  const scores = { B0: 0, B1: 0 };
  const classScores = {
    B1: Object.fromEntries(CLASS_NAMES.map((name) => [name, 0]))
  };
  const pairs = new Map();
  const misses = [];
  for (const observation of sceneObservations) {
    const label = observation.scorer.label;
    const pair = pairs.get(observation.pairRootId) ?? { B0: 0, B1: 0 };
    for (const name of ARM_NAMES) {
      const predicted =
        observation.ready.result.proposal.arms[name].predicted;
      if (predicted === label) {
        scores[name] += 1;
        pair[name] += 1;
        if (name === "B1") classScores.B1[label] += 1;
      } else if (name === "B1") {
        misses.push({
          pairRootId: observation.pairRootId,
          targetSurfaceId: observation.scorer.targetSurfaceId,
          contextSurfaceId: observation.scorer.contextSurfaceId,
          expected: label,
          predicted
        });
      }
    }
    pairs.set(observation.pairRootId, pair);
  }
  const outcomes = [...pairs.values()].map((pair) =>
    pair.B1 > pair.B0 ? "WIN" : pair.B1 < pair.B0 ? "LOSS" : "TIE"
  );
  return {
    B0: { correct: scores.B0, observations: sceneObservations.length },
    B1: {
      correct: scores.B1,
      observations: sceneObservations.length,
      directedCorrect: classScores.B1.DIRECTED_TO_ASSISTANT,
      directedObservations: sceneObservations.filter(
        (item) => item.scorer.label === "DIRECTED_TO_ASSISTANT"
      ).length,
      backgroundCorrect: classScores.B1.BACKGROUND_OR_NOT_DIRECTED,
      backgroundObservations: sceneObservations.filter(
        (item) => item.scorer.label === "BACKGROUND_OR_NOT_DIRECTED"
      ).length
    },
    paired: {
      pairs: pairs.size,
      wins: outcomes.filter((value) => value === "WIN").length,
      losses: outcomes.filter((value) => value === "LOSS").length,
      ties: outcomes.filter((value) => value === "TIE").length
    },
    knownMiss: misses.length === 1 ? misses[0] : null
  };
}

function countersPass(sceneObservations) {
  const final = sceneObservations.at(-1)?.ready?.snapshot;
  return final?.deferCount === 24 &&
    final?.inferenceCount === 16 &&
    final?.invalidCount === 0 &&
    final?.proposalCount === 8 &&
    final?.effectsDispatched === 0;
}

async function runRepetition({
  checkpoint,
  chrome,
  fetchImpl,
  index,
  replay,
  targetUrl
}) {
  const fingerprint = await readRuntimeFingerprint(fetchImpl, targetUrl);
  const checkpointReady = await prepareRepetition(
    chrome,
    targetUrl,
    checkpoint
  );
  const physicalControl = await runPhysicalStop(chrome, "control-before-shadow");
  const scenes = [];
  for (const scene of replay.scenes) {
    const probes = [];
    for (const probe of scene.probes) {
      const observation = await chrome.evaluate(
        evaluatePayloadExpression(scene.sceneId, "probe", probe.payload)
      );
      probes.push({
        ...observation,
        pass: assertProbeObservation(observation, probe.payload)
      });
    }
    await chrome.evaluate(releaseEvidenceExpression(
      scene.sceneId,
      scene.ready.payload.currentSample
    ));
    const ready = await chrome.evaluate(
      evaluatePayloadExpression(scene.sceneId, "ready", scene.ready.payload)
    );
    const parity = assertReadyObservation(ready, scene, checkpoint);
    scenes.push({
      sceneId: scene.sceneId,
      pairRootId: scene.pairRootId,
      scorer: structuredClone(scene.scorer),
      probes,
      ready,
      parity
    });
  }
  const physicalShadow = await runPhysicalStop(chrome, "after-shadow");
  const diagnostics = copyDiagnostics(chrome.diagnostics);
  const signature = signatureFromObservations(scenes);
  return {
    index,
    runtimeFingerprintSha256: fingerprint.sha256,
    checkpointReady,
    scenes,
    signature,
    countersPass: countersPass(scenes),
    physical: {
      control: physicalControl,
      shadow: physicalShadow,
      transitionsEquivalent: isDeepStrictEqual(
        physicalControl.transitions,
        physicalShadow.transitions
      ),
      rendererSequenceEquivalent: isDeepStrictEqual(
        physicalControl.rendererSequence,
        physicalShadow.rendererSequence
      )
    },
    diagnostics
  };
}

async function jsonInput(
  value,
  path,
  projectRoot,
  injectedFileSha256 = null
) {
  if (value !== undefined && value !== null) {
    return {
      value: structuredClone(value),
      path: path ?? null,
      fileSha256: normalizeSha256(injectedFileSha256)
    };
  }
  const absolute = resolve(projectRoot, path);
  const bytes = await readFile(absolute).catch((error) => {
    throw new Error(
      `entrada obrigatória ausente em ${path}; execute primeiro o replay Node canônico`,
      { cause: error }
    );
  });
  return {
    value: JSON.parse(bytes.toString("utf8")),
    path,
    fileSha256: sha256Bytes(bytes)
  };
}

async function validateCanonicalReplay(replay, freeze, validator) {
  const local = validateExp0019BrowserReplayInput(replay);
  invariant(local.valid, local.errors.join("; "));
  const external = await (
    validator ?? validateExp0019NodeReplayArtifact
  )(replay, { instrumentationFreeze: freeze });
  invariant(
    external === true || external?.valid === true,
    `replay Node canônico recusado: ${
      external?.errors?.join?.("; ") ?? "validação falhou"
    }`
  );
}

function freezeReplayBindingPass(replay, freezeRecord) {
  const binding = replay?.bindings?.instrumentationFreeze;
  const freeze = freezeRecord.value;
  return binding?.path === freezeRecord.path &&
    normalizeSha256(binding.fileSha256) === freezeRecord.fileSha256 &&
    normalizeSha256(binding.canonicalSha256) ===
      freeze.instrumentationFreezeSha256 &&
    binding.runnerSourceCommit === freeze.runnerSourceCommit;
}

function freezeBrowserCheckpointBindingPass(freeze, checkpointRecord) {
  const binding = freeze?.artifacts?.browserCheckpoint;
  return binding?.path === checkpointRecord.path &&
    normalizeSha256(binding.fileSha256) === checkpointRecord.fileSha256 &&
    normalizeSha256(binding.canonicalSha256) ===
      checkpointRecord.value.browserCheckpointSha256;
}

async function verifyFrozenCriticalSources(
  freeze,
  projectRoot,
  readFileImpl = readFile
) {
  const expectedPaths = [...EXP0019_CRITICAL_SOURCE_PATHS];
  if (
    !Array.isArray(freeze?.criticalSources) ||
    !isDeepStrictEqual(
      freeze.criticalSources.map((source) => source.path),
      expectedPaths
    )
  ) {
    return Object.freeze({ valid: false, errors: [
      "criticalSources diverge do allowlist congelado"
    ] });
  }
  const errors = [];
  for (const source of freeze.criticalSources) {
    const bytes = await readFileImpl(resolve(projectRoot, source.path))
      .catch((error) => {
        errors.push(`${source.path}: ausente (${error.message})`);
        return null;
      });
    if (bytes !== null && sha256Bytes(bytes) !== source.fileSha256) {
      errors.push(`${source.path}: bytes pós-lacre`);
    }
  }
  for (const required of [
    "scripts/smoke-exp-0019-browser.mjs",
    "web/app.mjs",
    "web/context-relevance-shadow.mjs"
  ]) {
    if (!freeze.criticalSources.some((source) => source.path === required)) {
      errors.push(`${required}: fonte crítica não congelada`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

function replayCheckpointBindingPass(replay, checkpointRecord) {
  const binding = replay?.bindings?.checkpoint;
  if (!binding) return false;
  const checkpoint = checkpointRecord.value;
  return binding.path === checkpoint.source.path &&
    normalizeSha256(binding.fileSha256) === checkpoint.source.fileSha256 &&
    normalizeSha256(binding.canonicalSha256) ===
      checkpoint.source.checkpointSha256;
}

function replayRuntimeFingerprint(replay) {
  return normalizeSha256(
    replay?.runtimeFingerprintSha256 ??
      replay?.bindings?.runtimeFingerprint?.sha256
  );
}

export async function runExp0019BrowserCampaign(options = {}) {
  const repetitions = options.repetitions ?? EXP0019_BROWSER_REPETITIONS;
  invariant(
    repetitions === EXP0019_BROWSER_REPETITIONS,
    "o pré-registro permite exatamente duas repetições; terceira execução negada"
  );
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const targetUrl = exp0019BrowserTargetUrl(
    options.targetUrl ?? EXP0019_BROWSER_TARGET_URL
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  invariant(typeof fetchImpl === "function", "fetch indisponível");
  const [replayRecord, checkpointRecord, freezeRecord] = await Promise.all([
    jsonInput(
      options.replay,
      options.replayPath ?? EXP0019_NODE_REPLAY_PATH,
      projectRoot,
      options.replayFileSha256
    ),
    jsonInput(
      options.checkpoint,
      options.checkpointPath ?? EXP0019_BROWSER_CHECKPOINT_PATH,
      projectRoot,
      options.checkpointFileSha256
    ),
    jsonInput(
      options.instrumentationFreeze,
      options.instrumentationFreezePath ??
        EXP0019_INSTRUMENTATION_FREEZE_PATH,
      projectRoot,
      options.instrumentationFreezeFileSha256
    )
  ]);
  const freezeValidation = (
    options.validateInstrumentationFreeze ??
      validateExp0019InstrumentationFreeze
  )(freezeRecord.value);
  invariant(
    freezeValidation === true || freezeValidation?.valid === true,
    `instrumentation freeze inválido: ${
      freezeValidation?.errors?.join?.("; ") ?? "validação falhou"
    }`
  );
  invariant(
    freezeReplayBindingPass(replayRecord.value, freezeRecord),
    "binding replay/instrumentation freeze ausente ou divergente"
  );
  const criticalSources = await verifyFrozenCriticalSources(
    freezeRecord.value,
    projectRoot,
    options.readCriticalSource ?? readFile
  );
  invariant(criticalSources.valid, criticalSources.errors.join("; "));
  await validateCanonicalReplay(
    replayRecord.value,
    freezeRecord.value,
    options.validateNodeReplay
  );
  const checkpointValidation = validateContextRelevanceCheckpoint(
    checkpointRecord.value
  );
  invariant(
    checkpointValidation.valid,
    checkpointValidation.errors.join("; ")
  );
  invariant(
    replayCheckpointBindingPass(replayRecord.value, checkpointRecord),
    "binding replay/checkpoint ausente ou divergente"
  );
  invariant(
    freezeBrowserCheckpointBindingPass(
      freezeRecord.value,
      checkpointRecord
    ),
    "binding freeze/checkpoint browser ausente ou divergente"
  );

  const cdpUrl = options.cdpUrl ?? discoverExp0019CdpUrl();
  const connectChrome = options.connectChrome ?? connectExp0019Chrome;
  const startedAt = (options.nowIso ?? (() => new Date().toISOString()))();
  const chrome = await connectChrome({
    cdpUrl,
    fetchImpl,
    targetUrl,
    timeoutMs: options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
    WebSocketImpl: options.WebSocketImpl
  });
  const repetitionReports = [];
  try {
    for (let index = 1; index <= EXP0019_BROWSER_REPETITIONS; index += 1) {
      repetitionReports.push(await runRepetition({
        checkpoint: checkpointRecord.value,
        chrome,
        fetchImpl,
        index,
        replay: replayRecord.value,
        targetUrl
      }));
    }
  } finally {
    chrome.close();
  }

  const traces = repetitionReports.map((repetition) => ({
    runtimeFingerprintSha256: repetition.runtimeFingerprintSha256,
    experimentFingerprintSha256:
      replayRuntimeFingerprint(replayRecord.value),
    checkpointReady: repetition.checkpointReady,
    scenes: repetition.scenes,
    signature: repetition.signature,
    countersPass: repetition.countersPass,
    physical: repetition.physical,
    diagnostics: repetition.diagnostics
  }));
  const normalizedTraces = traces.map(normalizeExp0019BrowserTrace);
  const normalizedTraceSha256 = normalizedTraces.map(
    (trace) => `sha256:${canonicalSha256(trace)}`
  );
  const readyObservations = repetitionReports.flatMap((repetition) =>
    repetition.scenes.map((scene) => scene.ready)
  );
  const probeObservations = repetitionReports.flatMap((repetition) =>
    repetition.scenes.flatMap((scene) => scene.probes)
  );
  const proposalLatencies = readyObservations.map(
    (observation) => observation.timing.proposalLatencyMs
  );
  const calculationLatencies = readyObservations.map(
    (observation) => observation.timing.calculationMs
  );
  const proposalP95 = safeP95(proposalLatencies);
  const calculationP95 = safeP95(calculationLatencies);
  const fingerprints = repetitionReports.map(
    (repetition) => repetition.runtimeFingerprintSha256
  );
  const physicalStops = repetitionReports.flatMap((repetition) => [
    repetition.physical.control,
    repetition.physical.shadow
  ]);
  const renderStopLatencies = physicalStops
    .map((stop) => stop.lastRenderStop?.latencyMs)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const boundFingerprint = replayRuntimeFingerprint(replayRecord.value);
  const featureErrors = repetitionReports.flatMap((repetition) =>
    repetition.scenes.flatMap((scene) => ARM_NAMES.map(
      (name) => scene.parity.arms[name].featureRelativeError
    ))
  );
  const probabilityErrors = repetitionReports.flatMap((repetition) =>
    repetition.scenes.flatMap((scene) => ARM_NAMES.map(
      (name) => scene.parity.arms[name].probabilityRelativeError
    ))
  );
  const maximumFeatureRelativeError =
    featureErrors.length === 32 && featureErrors.every(Number.isFinite)
      ? Math.max(...featureErrors)
      : null;
  const maximumProbabilityRelativeError =
    probabilityErrors.length === 32 && probabilityErrors.every(Number.isFinite)
      ? Math.max(...probabilityErrors)
      : null;
  const gates = {
    exactlyTwoRepetitions:
      repetitionReports.length === EXP0019_BROWSER_REPETITIONS,
    sameRuntimeFingerprint:
      fingerprints.length === EXP0019_BROWSER_REPETITIONS &&
      new Set(fingerprints).size === 1,
    sameExperimentFingerprint:
      boundFingerprint !== null &&
      repetitionReports.every(() =>
        replayRuntimeFingerprint(replayRecord.value) === boundFingerprint
      ),
    checkpointReady: repetitionReports.every((repetition) =>
      checkpointReadinessPass(repetition.checkpointReady, checkpointRecord.value)
    ),
    replayCheckpointBound:
      replayCheckpointBindingPass(replayRecord.value, checkpointRecord),
    instrumentationFreezeBound:
      freezeReplayBindingPass(replayRecord.value, freezeRecord) &&
      freezeBrowserCheckpointBindingPass(
        freezeRecord.value,
        checkpointRecord
      ) && criticalSources.valid,
    causalProbes:
      probeObservations.length === 48 &&
      probeObservations.every((observation) => observation.pass),
    readyEvaluations:
      readyObservations.length === 16 &&
      repetitionReports.every((repetition) =>
        repetition.scenes.every((scene) => scene.parity.shapePass)
      ),
    oneProposalPerArmPerScene:
      repetitionReports.every((repetition) => repetition.countersPass),
    nodeBrowserParity:
      maximumFeatureRelativeError !== null &&
      maximumProbabilityRelativeError !== null &&
      maximumFeatureRelativeError <= PARITY_RELATIVE_ERROR_LIMIT &&
      maximumProbabilityRelativeError <= PARITY_RELATIVE_ERROR_LIMIT &&
      repetitionReports.every((repetition) =>
        repetition.scenes.every((scene) => scene.parity.pass)
      ),
    frozenSignature: repetitionReports.every((repetition) =>
      isDeepStrictEqual(repetition.signature, EXP0019_FROZEN_SIGNATURE)
    ),
    deterministicNormalizedTrace:
      normalizedTraceSha256.length === 2 &&
      normalizedTraceSha256[0] === normalizedTraceSha256[1] &&
      isDeepStrictEqual(normalizedTraces[0], normalizedTraces[1]),
    proposalP95WithinBudget:
      proposalP95 !== null && proposalP95 <= PROPOSAL_P95_LIMIT_MS,
    calculationP95WithinBudget:
      calculationP95 !== null && calculationP95 <= CALCULATION_P95_LIMIT_MS,
    lifecycleUnchanged: [...probeObservations, ...readyObservations].every(
      (observation) => isDeepStrictEqual(
        observation.lifecycle.before,
        observation.lifecycle.after
      )
    ),
    lifecycleShadowOnOffEquivalent: repetitionReports.every(
      (repetition) =>
        repetition.physical.control.pass &&
        repetition.physical.shadow.pass &&
        repetition.physical.transitionsEquivalent &&
        repetition.physical.rendererSequenceEquivalent
    ),
    rendererStopP95WithinBudget:
      physicalStops.length === 4 &&
      physicalStops.every((stop) => stop.pass) &&
      renderStopLatencies.length === 4 &&
      nearestRankP95(renderStopLatencies) <= RENDER_STOP_P95_LIMIT_MS,
    physicalStopContextIsolation: physicalStops.every((stop) =>
      isDeepStrictEqual(
        stop.contextCountersBefore,
        stop.contextCountersAfter
      )
    ),
    zeroEffects: [...probeObservations, ...readyObservations].every(
      (observation) =>
        observation.result.effects.length === 0 &&
        observation.snapshot.effectsDispatched === 0
    ),
    zeroAuthority: [...probeObservations, ...readyObservations].every(
      (observation) =>
        observation.result.authority.canProduceEffects === false &&
        observation.snapshot.authority.canProduceEffects === false
    ),
    diagnosticsClean: repetitionReports.every((repetition) =>
      cleanDiagnostics(repetition.diagnostics)
    )
  };
  const pass = Object.values(gates).every(Boolean);
  const reportCore = {
    schemaVersion: EXP0019_BROWSER_REPORT_SCHEMA,
    experimentId: "EXP-0019",
    startedAt,
    completedAt: (options.nowIso ?? (() => new Date().toISOString()))(),
    source: {
      nodeReplay: {
        path: replayRecord.path,
        fileSha256: replayRecord.fileSha256,
        replaySha256: replayRecord.value.replaySha256 ??
          `sha256:${canonicalSha256(replayRecord.value)}`
      },
      checkpoint: {
        path: checkpointRecord.path,
        fileSha256: checkpointRecord.fileSha256,
        ...checkpointIdentity(checkpointRecord.value)
      },
      instrumentationFreeze: {
        path: freezeRecord.path,
        fileSha256: freezeRecord.fileSha256,
        canonicalSha256:
          freezeRecord.value.instrumentationFreezeSha256,
        runnerSourceCommit: freezeRecord.value.runnerSourceCommit,
        criticalSourcesVerified: criticalSources.valid,
        criticalSourceCount: freezeRecord.value.criticalSources.length
      }
    },
    target: {
      url: targetUrl,
      cdpUrl,
      browser: "windows-chrome-cdp"
    },
    contract: {
      repetitions: EXP0019_BROWSER_REPETITIONS,
      parityRelativeErrorLimit: PARITY_RELATIVE_ERROR_LIMIT,
      proposalP95LimitMs: PROPOSAL_P95_LIMIT_MS,
      calculationP95LimitMs: CALCULATION_P95_LIMIT_MS,
      rendererStopP95LimitMs: RENDER_STOP_P95_LIMIT_MS,
      normalizedFieldsRemoved: [...WALL_CLOCK_KEYS].sort(),
      canProduceEffects: false
    },
    repetitions: repetitionReports,
    normalizedTraceSha256,
    metrics: {
      scenesPerRepetition: replayRecord.value.scenes.length,
      causalProbeEvaluations: probeObservations.length,
      readyEvaluations: readyObservations.length,
      armPredictions: readyObservations.length * ARM_NAMES.length,
      proposalLatencyP95Ms: proposalP95,
      calculationP95Ms: calculationP95,
      rendererStopP95Ms: renderStopLatencies.length === 4
        ? nearestRankP95(renderStopLatencies)
        : null,
      maximumFeatureRelativeError,
      maximumProbabilityRelativeError,
      effectsDispatched: Math.max(0, ...[
        ...probeObservations,
        ...readyObservations
      ].map((observation) => observation.snapshot.effectsDispatched)),
      paidApiCalls: 0,
      gpuRuns: 0
    },
    gates,
    pass,
    decision: browserReportDecision(gates),
    experimentDecisionEligible: false,
    authorityEligible: false,
    unassessedPreRegisteredGates: []
  };
  const report = {
    ...reportCore,
    browserReportSha256: `sha256:${canonicalSha256(reportCore)}`
  };
  const validation = validateExp0019BrowserReport(report, {
    replay: replayRecord.value,
    checkpoint: checkpointRecord.value,
    instrumentationFreeze: freezeRecord.value,
    validateNodeReplay: options.validateNodeReplay
  });
  invariant(
    validation.valid,
    `relatório browser recusado após recálculo: ${
      validation.errors.join("; ")
    }`
  );
  return report;
}

function projectedPhysicalStopPass(stop) {
  return stop?.error === null &&
    stop?.lastRenderStop?.kind === "browser-render-stop" &&
    stop.lastRenderStop.renderedThroughTrigger === true &&
    Number.isFinite(stop.lastRenderStop.latencyMs) &&
    stop.lastRenderStop.latencyMs >= 0 &&
    stop.lastRenderStop.latencyMs <= RENDER_STOP_P95_LIMIT_MS &&
    Number.isFinite(stop.stopRenderedMs) && stop.stopRenderedMs >= 0 &&
    stop.stopRenderedMs <= RENDER_STOP_P95_LIMIT_MS &&
    Array.isArray(stop.transitions) && stop.transitions.length > 0 &&
    stop.transitions.some((transition) =>
      transition.eventType === "PAUSE_REQUESTED" &&
      transition.phase === "held"
    ) &&
    Array.isArray(stop.rendererSequence) &&
    stop.rendererSequence.includes("assistant.render.active") &&
    stop.rendererSequence.includes("assistant.speech.paused") &&
    stop.rendererSequence.includes("assistant.render.stopped") &&
    isDeepStrictEqual(
      stop.contextCountersBefore,
      stop.contextCountersAfter
    );
}

function reportTrace(repetition, experimentFingerprintSha256) {
  return {
    runtimeFingerprintSha256: repetition.runtimeFingerprintSha256,
    experimentFingerprintSha256,
    checkpointReady: repetition.checkpointReady,
    scenes: repetition.scenes,
    signature: repetition.signature,
    countersPass: repetition.countersPass,
    physical: repetition.physical,
    diagnostics: repetition.diagnostics
  };
}

function safeP95(values) {
  return Array.isArray(values) && values.length > 0 &&
    values.every((value) => Number.isFinite(value) && value >= 0)
    ? nearestRankP95(values)
    : null;
}

function recomputeBrowserReport(report, dependencies) {
  const { replay, checkpoint, instrumentationFreeze } = dependencies;
  const errors = [];
  const repetitions = Array.isArray(report?.repetitions)
    ? report.repetitions
    : [];
  const expectedScenes = new Map(
    (replay?.scenes ?? []).map((scene) => [scene.sceneId, scene])
  );
  const allProbeObservations = [];
  const allReadyObservations = [];
  const allReadyParity = [];
  const allArmParity = [];
  const physicalStops = [];
  const fingerprints = [];

  if (repetitions.length !== EXP0019_BROWSER_REPETITIONS) {
    errors.push("relatório não contém exatamente duas repetições");
  }
  for (const repetition of repetitions) {
    fingerprints.push(repetition.runtimeFingerprintSha256);
    if (
      !checkpointReadinessPass(repetition.checkpointReady, checkpoint)
    ) {
      errors.push(`repetição ${repetition.index}: checkpoint não estava pronto`);
    }
    const scenes = Array.isArray(repetition.scenes)
      ? repetition.scenes
      : [];
    if (
      scenes.length !== 8 ||
      !isDeepStrictEqual(
        scenes.map((scene) => scene.sceneId),
        replay.scenes.map((scene) => scene.sceneId)
      )
    ) {
      errors.push(`repetição ${repetition.index}: seleção de cenas divergiu`);
    }
    for (const scene of scenes) {
      const expected = expectedScenes.get(scene.sceneId);
      if (
        !expected ||
        scene.pairRootId !== expected.pairRootId ||
        !isDeepStrictEqual(scene.scorer, expected.scorer)
      ) {
        errors.push(`${scene.sceneId}: identidade/scorer divergiu`);
        continue;
      }
      if (!Array.isArray(scene.probes) || scene.probes.length !== 3) {
        errors.push(`${scene.sceneId}: probes browser incompletos`);
      } else {
        for (let index = 0; index < 3; index += 1) {
          const observation = scene.probes[index];
          const expectedProbe = expected.probes[index];
          const pass = assertProbeObservation(
            observation,
            expectedProbe.payload
          );
          allProbeObservations.push(observation);
          if (observation.pass !== pass) {
            errors.push(`${scene.sceneId}: probe browser ${index + 1} divergiu`);
          }
        }
      }
      const parity = assertReadyObservation(scene.ready, expected, checkpoint);
      allReadyObservations.push(scene.ready);
      allReadyParity.push(parity);
      allArmParity.push(...ARM_NAMES.map((name) => parity.arms[name]));
      if (!isDeepStrictEqual(scene.parity, parity)) {
        errors.push(`${scene.sceneId}: paridade ready divergente`);
      }
    }
    if (scenes.length === 8) {
      const signature = signatureFromObservations(scenes);
      if (
        !isDeepStrictEqual(repetition.signature, signature)
      ) {
        errors.push(`repetição ${repetition.index}: assinatura divergente`);
      }
      const observedCountersPass = countersPass(scenes);
      if (
        repetition.countersPass !== observedCountersPass
      ) {
        errors.push(`repetição ${repetition.index}: contadores divergentes`);
      }
    }
    const control = repetition?.physical?.control;
    const shadow = repetition?.physical?.shadow;
    physicalStops.push(control, shadow);
    const controlPass = projectedPhysicalStopPass(control);
    const shadowPass = projectedPhysicalStopPass(shadow);
    const transitionsEquivalent = isDeepStrictEqual(
      control?.transitions,
      shadow?.transitions
    );
    const rendererSequenceEquivalent = isDeepStrictEqual(
      control?.rendererSequence,
      shadow?.rendererSequence
    );
    if (
      control?.pass !== controlPass || shadow?.pass !== shadowPass ||
      repetition?.physical?.transitionsEquivalent !== transitionsEquivalent ||
      repetition?.physical?.rendererSequenceEquivalent !==
        rendererSequenceEquivalent
    ) {
      errors.push(`repetição ${repetition.index}: STOP físico divergiu`);
    }
  }

  const experimentFingerprint = replayRuntimeFingerprint(replay);
  const normalizedTraces = repetitions.map((repetition) =>
    normalizeExp0019BrowserTrace(
      reportTrace(repetition, experimentFingerprint)
    )
  );
  const normalizedTraceSha256 = normalizedTraces.map(
    (trace) => `sha256:${canonicalSha256(trace)}`
  );
  const proposalLatencies = allReadyObservations.map(
    (observation) => observation?.timing?.proposalLatencyMs
  );
  const calculationLatencies = allReadyObservations.map(
    (observation) => observation?.timing?.calculationMs
  );
  const renderStopLatencies = physicalStops.map(
    (stop) => stop?.lastRenderStop?.latencyMs
  );
  const featureErrors = allArmParity.map(
    (parity) => parity.featureRelativeError
  );
  const probabilityErrors = allArmParity.map(
    (parity) => parity.probabilityRelativeError
  );
  const proposalP95 = safeP95(proposalLatencies);
  const calculationP95 = safeP95(calculationLatencies);
  const renderStopP95 = safeP95(renderStopLatencies);
  const maximumFeatureRelativeError = featureErrors.length === 32 &&
    featureErrors.every(Number.isFinite)
    ? Math.max(...featureErrors)
    : null;
  const maximumProbabilityRelativeError = probabilityErrors.length === 32 &&
    probabilityErrors.every(Number.isFinite)
    ? Math.max(...probabilityErrors)
    : null;
  const checkpointRecord = {
    path: report?.source?.checkpoint?.path,
    fileSha256: report?.source?.checkpoint?.fileSha256,
    value: checkpoint
  };
  const freezeRecord = {
    path: report?.source?.instrumentationFreeze?.path,
    fileSha256: report?.source?.instrumentationFreeze?.fileSha256,
    value: instrumentationFreeze
  };
  const gates = {
    exactlyTwoRepetitions: repetitions.length === 2,
    sameRuntimeFingerprint:
      fingerprints.length === 2 &&
      fingerprints.every((value) => normalizeSha256(value) !== null) &&
      new Set(fingerprints).size === 1,
    sameExperimentFingerprint: experimentFingerprint !== null,
    checkpointReady: repetitions.length === 2 && repetitions.every(
      (repetition) => checkpointReadinessPass(
        repetition.checkpointReady,
        checkpoint
      )
    ),
    replayCheckpointBound: replayCheckpointBindingPass(
      replay,
      checkpointRecord
    ),
    instrumentationFreezeBound:
      freezeReplayBindingPass(replay, freezeRecord) &&
      freezeBrowserCheckpointBindingPass(
        instrumentationFreeze,
        checkpointRecord
      ) && report?.source?.instrumentationFreeze
        ?.criticalSourcesVerified === true,
    causalProbes:
      allProbeObservations.length === 48 &&
      allProbeObservations.every((observation, observationIndex) => {
        const sceneIndex = Math.floor((observationIndex % 24) / 3);
        const probeIndex = observationIndex % 3;
        return assertProbeObservation(
          observation,
          replay.scenes[sceneIndex].probes[probeIndex].payload
        );
      }),
    readyEvaluations:
      allReadyObservations.length === 16 &&
      allReadyParity.length === 16 &&
      allReadyParity.every((parity) => parity.shapePass),
    oneProposalPerArmPerScene:
      repetitions.length === 2 &&
      repetitions.every((repetition) => countersPass(repetition.scenes)),
    nodeBrowserParity:
      maximumFeatureRelativeError !== null &&
      maximumProbabilityRelativeError !== null &&
      maximumFeatureRelativeError <= PARITY_RELATIVE_ERROR_LIMIT &&
      maximumProbabilityRelativeError <= PARITY_RELATIVE_ERROR_LIMIT &&
      allArmParity.every((parity) => parity.pass),
    frozenSignature: repetitions.length === 2 && repetitions.every(
      (repetition) => isDeepStrictEqual(
        signatureFromObservations(repetition.scenes),
        EXP0019_FROZEN_SIGNATURE
      )
    ),
    deterministicNormalizedTrace:
      normalizedTraceSha256.length === 2 &&
      normalizedTraceSha256[0] === normalizedTraceSha256[1] &&
      isDeepStrictEqual(normalizedTraces[0], normalizedTraces[1]),
    proposalP95WithinBudget:
      proposalP95 !== null && proposalP95 <= PROPOSAL_P95_LIMIT_MS,
    calculationP95WithinBudget:
      calculationP95 !== null && calculationP95 <= CALCULATION_P95_LIMIT_MS,
    lifecycleUnchanged: [...allProbeObservations, ...allReadyObservations]
      .every((observation) => isDeepStrictEqual(
        observation?.lifecycle?.before,
        observation?.lifecycle?.after
      )),
    lifecycleShadowOnOffEquivalent: repetitions.length === 2 &&
      repetitions.every((repetition) =>
        projectedPhysicalStopPass(repetition.physical.control) &&
        projectedPhysicalStopPass(repetition.physical.shadow) &&
        isDeepStrictEqual(
          repetition.physical.control.transitions,
          repetition.physical.shadow.transitions
        ) &&
        isDeepStrictEqual(
          repetition.physical.control.rendererSequence,
          repetition.physical.shadow.rendererSequence
        )
      ),
    rendererStopP95WithinBudget:
      renderStopLatencies.length === 4 &&
      renderStopP95 !== null &&
      renderStopP95 <= RENDER_STOP_P95_LIMIT_MS &&
      physicalStops.every(projectedPhysicalStopPass),
    physicalStopContextIsolation: physicalStops.length === 4 &&
      physicalStops.every((stop) => isDeepStrictEqual(
        stop.contextCountersBefore,
        stop.contextCountersAfter
      )),
    zeroEffects: [...allProbeObservations, ...allReadyObservations]
      .every((observation) =>
        observation?.result?.effects?.length === 0 &&
        observation?.snapshot?.effectsDispatched === 0
      ),
    zeroAuthority: [...allProbeObservations, ...allReadyObservations]
      .every((observation) =>
        observation?.result?.authority?.canProduceEffects === false &&
        observation?.snapshot?.authority?.canProduceEffects === false
      ),
    diagnosticsClean: repetitions.length === 2 && repetitions.every(
      (repetition) => cleanDiagnostics(repetition.diagnostics)
    )
  };
  const metrics = {
    scenesPerRepetition: replay?.scenes?.length ?? 0,
    causalProbeEvaluations: allProbeObservations.length,
    readyEvaluations: allReadyObservations.length,
    armPredictions: allReadyObservations.length * ARM_NAMES.length,
    proposalLatencyP95Ms: proposalP95,
    calculationP95Ms: calculationP95,
    rendererStopP95Ms: renderStopP95,
    maximumFeatureRelativeError,
    maximumProbabilityRelativeError,
    effectsDispatched: Math.max(0, ...[
      ...allProbeObservations,
      ...allReadyObservations
    ].map((observation) => observation?.snapshot?.effectsDispatched ?? 0)),
    paidApiCalls: 0,
    gpuRuns: 0
  };
  return { errors, gates, metrics, normalizedTraceSha256 };
}

export function validateExp0019BrowserReport(report, options = {}) {
  const errors = [];
  const replay = options.replay;
  const checkpoint = options.checkpoint;
  const instrumentationFreeze = options.instrumentationFreeze;
  let selfHashValid = false;
  try {
    selfHashValid = normalizeSha256(report?.browserReportSha256) !== null &&
      report.browserReportSha256 ===
        `sha256:${canonicalSha256(cloneWithoutSelfHash(
          report,
          "browserReportSha256"
        ))}`;
  } catch {
    selfHashValid = false;
  }
  if (
    report?.schemaVersion !== EXP0019_BROWSER_REPORT_SCHEMA ||
    report?.experimentId !== "EXP-0019" ||
    !selfHashValid
  ) {
    errors.push("identidade ou browserReportSha256 divergente");
  }
  const replayValidation = validateExp0019BrowserReplayInput(replay);
  let canonicalReplayValidation = null;
  try {
    canonicalReplayValidation = (
      options.validateNodeReplay ?? validateExp0019NodeReplayArtifact
    )(replay, { instrumentationFreeze });
  } catch (error) {
    canonicalReplayValidation = {
      valid: false,
      errors: [error.message]
    };
  }
  const checkpointValidation = validateContextRelevanceCheckpoint(checkpoint);
  const freezeValidation = validateExp0019InstrumentationFreeze(
    instrumentationFreeze
  );
  if (!replayValidation.valid) {
    errors.push(`replay inválido: ${replayValidation.errors.join("; ")}`);
  }
  if (
    canonicalReplayValidation !== true &&
    canonicalReplayValidation?.valid !== true
  ) {
    errors.push(
      `replay canônico inválido: ${
        canonicalReplayValidation?.errors?.join?.("; ") ??
          "validação falhou"
      }`
    );
  }
  if (!checkpointValidation.valid) {
    errors.push(
      `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`
    );
  }
  if (!freezeValidation.valid) {
    errors.push(`freeze inválido: ${freezeValidation.errors.join("; ")}`);
  }
  if (errors.length > 0) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  const expectedContract = {
    repetitions: EXP0019_BROWSER_REPETITIONS,
    parityRelativeErrorLimit: PARITY_RELATIVE_ERROR_LIMIT,
    proposalP95LimitMs: PROPOSAL_P95_LIMIT_MS,
    calculationP95LimitMs: CALCULATION_P95_LIMIT_MS,
    rendererStopP95LimitMs: RENDER_STOP_P95_LIMIT_MS,
    normalizedFieldsRemoved: [...WALL_CLOCK_KEYS].sort(),
    canProduceEffects: false
  };
  let targetUrlValid = false;
  try {
    targetUrlValid = exp0019BrowserTargetUrl(report?.target?.url) ===
      report.target.url;
  } catch {
    targetUrlValid = false;
  }
  if (
    !isDeepStrictEqual(report.contract, expectedContract) ||
    !targetUrlValid ||
    report?.target?.browser !== "windows-chrome-cdp" ||
    !nonEmptyText(report?.target?.cdpUrl) ||
    !Number.isFinite(Date.parse(report?.startedAt)) ||
    !Number.isFinite(Date.parse(report?.completedAt)) ||
    Date.parse(report.startedAt) > Date.parse(report.completedAt)
  ) {
    errors.push("envelope, alvo ou relógio da campanha divergiu");
  }
  const expectedCheckpointSource = {
    path: instrumentationFreeze.artifacts.browserCheckpoint.path,
    fileSha256:
      instrumentationFreeze.artifacts.browserCheckpoint.fileSha256,
    ...checkpointIdentity(checkpoint)
  };
  const expectedFreezeSource = {
    path: replay.bindings.instrumentationFreeze.path,
    fileSha256: replay.bindings.instrumentationFreeze.fileSha256,
    canonicalSha256: instrumentationFreeze.instrumentationFreezeSha256,
    runnerSourceCommit: instrumentationFreeze.runnerSourceCommit,
    criticalSourcesVerified: true,
    criticalSourceCount: instrumentationFreeze.criticalSources.length
  };
  if (
    !exactKeys(report?.source?.nodeReplay, [
      "path",
      "fileSha256",
      "replaySha256"
    ]) ||
    !nonEmptyText(report.source.nodeReplay.path) ||
    normalizeSha256(report.source.nodeReplay.fileSha256) === null ||
    report.source.nodeReplay.replaySha256 !== replay.replaySha256 ||
    !isDeepStrictEqual(report?.source?.checkpoint, expectedCheckpointSource) ||
    !isDeepStrictEqual(
      report?.source?.instrumentationFreeze,
      expectedFreezeSource
    )
  ) {
    errors.push("bindings de origem do relatório divergiram");
  }
  if (
    !isDeepStrictEqual(
      report?.repetitions?.map((repetition) => repetition.index),
      [1, 2]
    )
  ) {
    errors.push("índices das duas repetições divergiram");
  }
  if (errors.length > 0) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  let derived;
  try {
    derived = recomputeBrowserReport(report, {
      replay,
      checkpoint,
      instrumentationFreeze
    });
  } catch (error) {
    errors.push(`evidência browser malformada: ${error.message}`);
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  errors.push(...derived.errors);
  if (!isDeepStrictEqual(report.gates, derived.gates)) {
    errors.push("gates editáveis divergem da evidência recalculada");
  }
  if (!isDeepStrictEqual(report.metrics, derived.metrics)) {
    errors.push("métricas editáveis divergem da evidência recalculada");
  }
  if (
    !isDeepStrictEqual(
      report.normalizedTraceSha256,
      derived.normalizedTraceSha256
    )
  ) {
    errors.push("hashes dos traces normalizados divergiram");
  }
  const expectedPass = Object.values(derived.gates).every(Boolean);
  if (
    report.pass !== expectedPass ||
    report.decision !== browserReportDecision(derived.gates) ||
    report.experimentDecisionEligible !== false ||
    report.authorityEligible !== false ||
    !isDeepStrictEqual(report.unassessedPreRegisteredGates, [])
  ) {
    errors.push("decisão ou autoridade divergiu dos gates recalculados");
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

async function fileExists(path) {
  return access(path).then(() => true, () => false);
}

async function main() {
  const options = parseExp0019BrowserArgs(process.argv.slice(2));
  const output = resolve(PROJECT_ROOT, options.out);
  invariant(
    !(await fileExists(output)),
    "relatório browser já existe; nova invocação excederia duas execuções"
  );
  const report = await runExp0019BrowserCampaign({
    cdpUrl: options.cdpUrl ?? discoverExp0019CdpUrl(),
    checkpointPath: options.checkpoint,
    instrumentationFreezePath: options.instrumentationFreeze,
    replayPath: options.replay,
    repetitions: options.repetitions,
    targetUrl: options.targetUrl
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `EXP-0019 Chrome ${report.pass ? "PASS técnico" : "HOLD"}: ` +
      `${report.repetitions.length} repetições, ` +
      `paridade=${report.gates.nodeBrowserParity}, ` +
      `determinismo=${report.gates.deterministicNormalizedTrace}`
  );
  console.log(`Relatório bruto: ${output}`);
  if (!report.pass && options.failOnHold) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
