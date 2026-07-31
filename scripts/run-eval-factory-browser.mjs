import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import {
  assessGuardedCriticalConfirmation,
  assessCriticalRepair,
  evaluateBrowserCampaignGates,
  validateBrowserCampaignInputs
} from "../src/eval/factory/browser-campaign.mjs";
import {
  browserSnapshotToCorrectionObservation
} from "../src/eval/factory/browser-observation.mjs";
import {
  assessCorrectionObservation
} from "../src/eval/factory/oracles.mjs";
import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  measureUsageDelta,
  RUNTIME_FINGERPRINT_ROOTS
} from "../src/eval/runtime-provenance.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const TARGET_URL =
  process.env.DUPLEX_URL ?? "http://localhost:4173/?automation=1";
const DEFAULT_BUILD_REPORT = "eval/reports/eval-factory-latest.json";
const DEFAULT_PACK = "eval/factory/packs/corrections.pt-BR.v0.2.json";
const TIMEOUT_MS = 20_000;

function parseArgs(args) {
  const options = {
    acousticCondition: null,
    audioOverrides: null,
    caseIds: [],
    cases: null,
    failOnHold: true,
    input: "text",
    pack: DEFAULT_PACK,
    out: null,
    repetitions: 1,
    textOverrides: null
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--no-fail") {
      options.failOnHold = false;
    } else if (argument === "--case") {
      options.caseIds.push(args[++index]);
    } else if (
      [
        "--acoustic-condition",
        "--audio-overrides",
        "--cases",
        "--input",
        "--pack",
        "--out",
        "--repetitions",
        "--text-overrides"
      ]
        .includes(argument)
    ) {
      const field = argument.slice(2).replace(
        /-([a-z])/gu,
        (_, letter) => letter.toUpperCase()
      );
      const value = args[++index];
      options[field] = field === "repetitions"
        ? Number.parseInt(value, 10)
        : value;
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  if (!["text", "pcm"].includes(options.input)) {
    throw new TypeError("--input precisa ser text ou pcm");
  }
  if (
    options.acousticCondition !== null &&
    !["quiet-12db", "noise-10db"].includes(options.acousticCondition)
  ) {
    throw new TypeError("--acoustic-condition inválida");
  }
  if (options.acousticCondition !== null && options.input !== "pcm") {
    throw new TypeError("--acoustic-condition exige --input pcm");
  }
  if (options.audioOverrides !== null && options.input !== "pcm") {
    throw new TypeError("--audio-overrides exige --input pcm");
  }
  if (options.textOverrides !== null && options.input !== "text") {
    throw new TypeError("--text-overrides exige --input text");
  }
  if (
    !Number.isSafeInteger(options.repetitions) ||
    options.repetitions < 1
  ) {
    throw new TypeError("--repetitions precisa ser inteiro positivo");
  }
  return options;
}

function evaluateRepeatedCampaignGates({
  definitions,
  diagnostics,
  repetitions,
  results
}) {
  const expectedObservations = definitions.length * repetitions;
  const expectedCounts = new Map(
    definitions.map((definition) => [
      definition.id,
      repetitions
    ])
  );
  const actualCounts = new Map();
  for (const result of results) {
    actualCounts.set(
      result.id,
      (actualCounts.get(result.id) ?? 0) + 1
    );
  }
  const complete =
    results.length === expectedObservations &&
    [...expectedCounts].every(
      ([id, count]) => actualCounts.get(id) === count
    );
  const diagnosticsPass = [
    diagnostics.consoleErrors,
    diagnostics.runtimeErrors,
    diagnostics.httpErrors
  ].every((items) => Array.isArray(items) && items.length === 0);
  const effects = results.map((item) =>
    item.assessment?.checks?.find(
      (check) => check.id === "no-obsolete-effect"
    )
  );
  const effectsMeasured = effects.filter(
    (check) => check && check.status !== "unmeasured"
  ).length;
  return {
    complete,
    diagnosticsPass,
    semanticBehaviorPass:
      complete &&
      diagnosticsPass &&
      results.every((item) => item.semanticPass === true && !item.error),
    interactionBehaviorPass:
      complete &&
      diagnosticsPass &&
      results.every((item) => item.behaviorPass === true && !item.error),
    criticalSlotSafetyPass:
      complete &&
      diagnosticsPass &&
      results.every((item) => item.safeOutcomePass === true && !item.error),
    downstreamEffectsPass:
      complete &&
      effectsMeasured === expectedObservations &&
      effects.every((check) => check?.status === "pass"),
    effectsMeasured,
    effectsRequired: expectedObservations
  };
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJsonWithBytes(relativePath) {
  const bytes = await readFile(resolve(PROJECT_ROOT, relativePath));
  return {
    bytes,
    sha256: sha256Bytes(bytes),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

async function readRuntimeHealth() {
  const healthUrl = new URL("/api/health", TARGET_URL);
  const response = await fetch(healthUrl, {
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`health do runtime retornou HTTP ${response.status}`);
  }
  return response.json();
}

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

async function connectChrome(cdpUrl) {
  const pagesResponse = await fetch(`${cdpUrl}/json/list`, {
    signal: AbortSignal.timeout(10_000)
  });
  if (!pagesResponse.ok) {
    throw new Error(`CDP retornou HTTP ${pagesResponse.status}.`);
  }
  const pages = await pagesResponse.json();
  const targetOrigin = new URL(TARGET_URL).origin;
  let page = pages.find(
    (candidate) =>
      candidate.type === "page" &&
      (() => {
        try {
          return new URL(candidate.url).origin === targetOrigin;
        } catch {
          return false;
        }
      })()
  );
  if (!page) {
    const response = await fetch(
      `${cdpUrl}/json/new?${encodeURIComponent(TARGET_URL)}`,
      { method: "PUT", signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) {
      throw new Error(`CDP não criou a aba: HTTP ${response.status}`);
    }
    page = await response.json();
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const diagnostics = { consoleErrors: [], runtimeErrors: [], httpErrors: [] };
  let nextId = 0;
  await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new Error("Timeout ao conectar ao CDP")),
      10_000
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolvePromise();
    }, { once: true });
    socket.addEventListener("error", rejectPromise, { once: true });
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
      diagnostics.consoleErrors.push(
        payload.params.args
          .map((argument) => argument.value ?? argument.description ?? "")
          .join(" ")
      );
    }
    if (payload.method === "Runtime.exceptionThrown") {
      diagnostics.runtimeErrors.push(
        payload.params.exceptionDetails.exception?.description ??
          payload.params.exceptionDetails.text
      );
    }
    if (
      payload.method === "Network.responseReceived" &&
      payload.params.response.status >= 400
    ) {
      diagnostics.httpErrors.push({
        status: payload.params.response.status,
        url: payload.params.response.url
      });
    }
  });
  socket.addEventListener("close", () => {
    for (const operation of pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new Error("CDP desconectado da página"));
    }
    pending.clear();
  });

  function send(method, params = {}, timeoutMs = 30_000) {
    if (socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP desconectado da página"));
    }
    const id = ++nextId;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectPromise(new Error(`CDP não respondeu a ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression, timeoutMs = 30_000) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
      );
    }
    return result.result.value;
  }
  async function waitFor(check, timeoutMs = TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) {
        return value;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Condição do Chrome não satisfeita em ${timeoutMs} ms`);
  }
  return { diagnostics, evaluate, page, send, socket, waitFor };
}

async function runCase(chrome, definition, sourceCase, options) {
  const { evaluate, waitFor } = chrome;
  await evaluate("window.__duplexLab.reset()");
  await waitFor(() => evaluate(`(() => {
    const state = window.__duplexLab.snapshot().state;
    return !state.assistantPreparing && !state.assistantSpeaking &&
      !state.responseActive && state.audioQueueLength === 0;
  })()`));
  if (definition.timingPattern === "cross-turn") {
    await evaluate(
      `window.__duplexLab.injectSpeech(${JSON.stringify(
        `Considere ${definition.slots.obsolete}.`
      )})`
    );
    await waitFor(() =>
      evaluate(`window.__duplexLab.snapshot().state.assistantSpeaking`)
    );
  } else if (definition.timingPattern === "barge-in") {
    await evaluate(
      `window.__duplexLab.speakLoop(${JSON.stringify(
        "Estou explicando uma resposta longa para que você possa me interromper a qualquer momento sem esperar o final."
      )})`
    );
    await waitFor(() =>
      evaluate(`window.__duplexLab.snapshot().state.assistantSpeaking`)
    );
  }
  const beforeStimulus = await evaluate("window.__duplexLab.snapshot()");
  const baseline = {
    commits: beforeStimulus.trace.filter(
      (event) => event.type === "turn.committed"
    ).length,
    brainCompleted: beforeStimulus.trace.filter(
      (event) => event.type === "brain.completed"
    ).length,
    speechFinished: beforeStimulus.trace.filter(
      (event) =>
        event.type === "assistant.speech.finished" &&
        event.detail === "direct"
    ).length,
    repairFinished: beforeStimulus.trace.filter(
      (event) =>
        event.type === "assistant.speech.finished" &&
        event.detail === "repair"
    ).length,
    clarifications: beforeStimulus.trace.filter(
      (event) => event.type === "assistant.clarification"
    ).length
  };
  let acousticInput = null;
  if (options.input === "pcm") {
    const audioPath =
      options.audioOverrideValues?.[definition.id] ??
      (
        options.acousticCondition
          ? `eval/generated/factory/acoustic/${definition.id}--` +
            `${options.acousticCondition}.wav`
          : definition.audio
      );
    const wave = await readFile(resolve(PROJECT_ROOT, audioPath));
    const decoded = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 });
    acousticInput = {
      path: audioPath,
      waveSha256: sha256Bytes(wave),
      pcmSha256: sha256Bytes(decoded.pcm),
      pcmBytes: decoded.pcm.length,
      durationMs: Math.round(decoded.pcm.length / 2 / 16_000 * 1_000)
    };
    const replayOptions = {
      reset: false,
      mode:
        ["barge-in", "cross-turn"].includes(definition.timingPattern)
          ? "barge-in"
          : "replay",
      silenceMs: 1_800,
      stopAfterInterruption: false
    };
    await evaluate(
      `window.__duplexLab.replayPcmBase64(` +
        `${JSON.stringify(decoded.pcm.toString("base64"))}, ` +
        `${JSON.stringify(replayOptions)})`
    );
  } else {
    await evaluate(
      `window.__duplexLab.injectSpeech(${JSON.stringify(
        options.textOverrideValues?.[definition.id] ?? definition.text
      )})`
    );
  }
  const snapshot = await waitFor(() =>
    evaluate(`(() => {
      const snapshot = window.__duplexLab.snapshot();
      const commits = snapshot.trace.filter(
        (event) => event.type === "turn.committed"
      ).length;
      const completed = snapshot.trace.filter(
        (event) => event.type === "brain.completed"
      ).length;
      const spoken = snapshot.trace.filter(
        (event) =>
          event.type === "assistant.speech.finished" &&
          event.detail === "direct"
      ).length;
      const repairs = snapshot.trace.filter(
        (event) =>
          event.type === "assistant.speech.finished" &&
          event.detail === "repair"
      ).length;
      const clarifications = snapshot.trace.filter(
        (event) => event.type === "assistant.clarification"
      ).length;
      const normalOutcome = commits > ${baseline.commits} &&
        completed > ${baseline.brainCompleted} &&
        spoken > ${baseline.speechFinished};
      const safeRepair =
        clarifications > ${baseline.clarifications} &&
        repairs > ${baseline.repairFinished};
      return (normalOutcome || safeRepair) &&
        !snapshot.state.responseActive &&
        !snapshot.state.assistantPreparing &&
        !snapshot.state.assistantSpeaking &&
        snapshot.state.audioQueueLength === 0
        ? snapshot
        : null;
    })()`)
  );
  const observation = browserSnapshotToCorrectionObservation(
    definition,
    snapshot,
    { scopeStartAtMs: beforeStimulus.observedAtMs }
  );
  const assessment = assessCorrectionObservation(sourceCase, observation);
  const browserErrors = snapshot.trace.filter((event) =>
    event.type.endsWith(".error") &&
    event.type !== "assistant.render.stop.error"
  );
  const interruptionExpected = ["barge-in", "cross-turn"].includes(
    definition.timingPattern
  );
  const bargeInPass = !interruptionExpected ||
    (
      snapshot.metrics.stopCommandMs !== null &&
      snapshot.metrics.stopCommandMs <= 100 &&
      snapshot.trace.some((event) =>
        [
          "assistant.speech.stopped",
          "assistant.speech.paused",
          "barge-in.confirmed"
        ].includes(event.type)
      )
    );
  const renderStopPass = !interruptionExpected ||
    (
      snapshot.metrics.stopRenderedMs !== null &&
      snapshot.metrics.stopRenderedMs >= 0 &&
      snapshot.metrics.stopRenderedMs <= 250 &&
      snapshot.audio.lastRenderStop?.kind === "browser-render-stop"
    );
  const responseLatencyMs = options.input === "pcm"
    ? snapshot.metrics.responseAfterEndpointMs
    : snapshot.metrics.responseStartMs;
  const responseLatencyPass =
    responseLatencyMs !== null && responseLatencyMs <= 1_200;
  const conflictEvent = snapshot.trace.findLast(
    (event) => event.type === "transcript.critical-conflict"
  );
  let criticalConflict = null;
  try {
    criticalConflict = conflictEvent
      ? JSON.parse(conflictEvent.detail)
      : null;
  } catch {
    criticalConflict = null;
  }
  const expectedNumericCurrent = Number(
    /[\d.,]+/u.exec(sourceCase.oracle.args.current)?.[0]
      ?.replaceAll(".", "")
      .replace(",", ".")
  );
  const commitsAfterStimulus = snapshot.trace.filter(
    (event) =>
      event.type === "turn.committed" &&
      event.atMs >= beforeStimulus.observedAtMs
  ).length;
  const criticalRepair = assessCriticalRepair({
    criticalConflict,
    expectedNumericCurrent,
    commitCount: commitsAfterStimulus,
    clarificationObserved: snapshot.trace.some(
      (event) => event.type === "assistant.clarification"
    )
  });
  const safeRepairPass = criticalRepair.safetyPass;
  const pendingConfirmationEvent = snapshot.trace.findLast(
    (event) => event.type === "state.pending-confirmation"
  );
  let pendingConfirmation = null;
  try {
    pendingConfirmation = pendingConfirmationEvent
      ? JSON.parse(pendingConfirmationEvent.detail)
      : null;
  } catch {
    pendingConfirmation = null;
  }
  const guardedConfirmation = assessGuardedCriticalConfirmation({
    effectRisk: definition.effectRisk,
    pendingConfirmation,
    rollbackCount: snapshot.trace.filter(
      (event) =>
        event.type === "state.rollback" &&
        event.atMs >= beforeStimulus.observedAtMs
    ).length,
    delegationCount: snapshot.trace.filter(
      (event) =>
        event.type === "task.delegated" &&
        event.atMs >= beforeStimulus.observedAtMs
    ).length,
    safetyConfirmationObserved: snapshot.trace.some(
      (event) =>
        event.type === "assistant.safety-confirmation" &&
        event.atMs >= beforeStimulus.observedAtMs
    )
  });
  const guardedConfirmationPass = guardedConfirmation.safetyPass;
  const semanticPass =
    assessment.checks.every((check) =>
      check.id === "no-obsolete-effect"
        ? check.status !== "fail"
        : check.status === "pass"
    ) && browserErrors.length === 0;
  const currentValueSafetyChecks = new Set([
    "final-transcript-current",
    "final-semantic-state",
    "single-commit",
    "single-semantic-revision",
    "no-premature-main-speech",
    "causal-event-order",
    "assistant-confirms-current",
    "audible-confirms-current",
    "no-obsolete-delegation"
  ]);
  const currentValueChecks = assessment.checks.filter((check) =>
    currentValueSafetyChecks.has(check.id)
  );
  const currentValueSafetyPass =
    currentValueChecks.length === currentValueSafetyChecks.size &&
    currentValueChecks.every((check) => check.status === "pass") &&
    browserErrors.length === 0;
  const safeOutcomePass =
    semanticPass ||
    safeRepairPass ||
    guardedConfirmationPass ||
    currentValueSafetyPass;
  const behaviorPass =
    (semanticPass || safeRepairPass || guardedConfirmationPass) &&
    bargeInPass &&
    responseLatencyPass;
  const timingPatternExecuted =
    definition.timingPattern === "same-turn-continuous" ||
    definition.timingPattern === "barge-in";
  return {
    id: definition.id,
    timingPattern: definition.timingPattern,
    effectRisk: definition.effectRisk,
    semanticPass,
    safeOutcomePass,
    safeRepairPass,
    guardedConfirmationPass,
    repairExpectedAlternativePass: criticalRepair.expectedAlternativePass,
    currentValueSafetyPass,
    criticalConflict,
    behaviorPass,
    bargeInPass,
    renderStopPass,
    responseLatencyMs,
    responseLatencyPass,
    timingPatternExecuted,
    timingLimitation:
      timingPatternExecuted
        ? null
        : definition.timingPattern === "cross-turn"
          ? "segundo turno repete os dois valores; não prova dependência do estado anterior"
          : "a pausa vem da prosódia/TTS e não possui fronteiras físicas anotadas",
    acousticInput,
    assessment,
    observation,
    metrics: snapshot.metrics,
    semantic: snapshot.semantic,
    transcript: snapshot.text.user,
    assistantText: snapshot.text.assistant,
    trace: snapshot.trace,
    audioRuntimeEvidence:
      snapshot.audio?.runtimeEvidence ?? [],
    browserErrors
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildReport = options.cases === null
    ? await readJsonWithBytes(DEFAULT_BUILD_REPORT)
    : null;
  const casesPath = options.cases ??
    `${buildReport.value.build.artifactRoot}/browser-cases.json`;
  const manifestPath = `${dirname(casesPath)}/artifact-manifest.json`;
  const outPath = options.out ??
    (
      options.input === "pcm"
        ? options.acousticCondition
          ? `eval/reports/eval-factory-browser-pcm-` +
            `${options.acousticCondition}-latest.json`
          : "eval/reports/eval-factory-browser-pcm-latest.json"
        : "eval/reports/eval-factory-browser-latest.json"
    );
  const acousticBuildInput = options.acousticCondition
    || options.audioOverrides
    ? await readJsonWithBytes("eval/reports/eval-factory-acoustic-latest.json")
    : null;
  const audioOverridesInput = options.audioOverrides
    ? await readJsonWithBytes(options.audioOverrides)
    : null;
  const textOverridesInput = options.textOverrides
    ? await readJsonWithBytes(options.textOverrides)
    : null;
  const audioOverrideValues =
    audioOverridesInput?.value.overrides ??
    audioOverridesInput?.value ??
    null;
  if (
    audioOverrideValues !== null &&
    (
      typeof audioOverrideValues !== "object" ||
      Array.isArray(audioOverrideValues)
    )
  ) {
    throw new TypeError("--audio-overrides precisa apontar para um objeto");
  }
  options.audioOverrideValues = audioOverrideValues;
  const textOverrideValues =
    textOverridesInput?.value.overrides ??
    textOverridesInput?.value ??
    null;
  if (
    textOverrideValues !== null &&
    (
      typeof textOverrideValues !== "object" ||
      Array.isArray(textOverrideValues)
    )
  ) {
    throw new TypeError("--text-overrides precisa apontar para um objeto");
  }
  options.textOverrideValues = textOverrideValues;
  const [browserInput, sourceInput, manifestInput, runtimeHealth] =
    await Promise.all([
      readJsonWithBytes(casesPath),
      readJsonWithBytes(options.pack),
      readJsonWithBytes(manifestPath),
      readRuntimeHealth()
  ]);
  const browserPack = browserInput.value;
  const sourcePack = sourceInput.value;
  const provenance = validateBrowserCampaignInputs({
    sourcePack,
    browserPack,
    manifest: manifestInput.value
  });
  if (
    acousticBuildInput &&
    (
      acousticBuildInput.value.source.buildSha256 !==
        buildReport?.value.build.buildSha256 ||
      acousticBuildInput.value.source.browserPackSha256 !==
        provenance.browserPackSha256
    )
  ) {
    throw new TypeError("matriz acústica não pertence ao build/browser pack atual");
  }
  const currentRuntimeFingerprint = await createSourceFingerprint(
    PROJECT_ROOT,
    { roots: RUNTIME_FINGERPRINT_ROOTS }
  );
  const runtimeComparable =
    runtimeHealth.process?.runtimeFingerprint?.sha256 ===
      currentRuntimeFingerprint.sha256;
  const sourceById = new Map(
    sourcePack.cases.map((item) => [item.id, item])
  );
  const definitions = browserPack.cases.filter(
    (definition) =>
      options.caseIds.length === 0 ||
      options.caseIds.includes(definition.id)
  );
  const unknownCaseIds = options.caseIds.filter(
    (id) => !browserPack.cases.some((definition) => definition.id === id)
  );
  if (unknownCaseIds.length > 0) {
    throw new TypeError(
      `casos de browser desconhecidos: ${unknownCaseIds.join(", ")}`
    );
  }
  if (definitions.length === 0) {
    throw new TypeError("nenhum caso de browser selecionado");
  }
  for (const [id, path] of Object.entries(audioOverrideValues ?? {})) {
    if (
      !browserPack.cases.some((definition) => definition.id === id) ||
      typeof path !== "string" ||
      !path
    ) {
      throw new TypeError(`override de áudio inválido: ${id}`);
    }
  }
  for (const [id, text] of Object.entries(textOverrideValues ?? {})) {
    if (
      !browserPack.cases.some((definition) => definition.id === id) ||
      typeof text !== "string" ||
      !text.trim()
    ) {
      throw new TypeError(`override de texto inválido: ${id}`);
    }
  }
  const cdpUrl = discoverCdpUrl();
  let chrome = await connectChrome(cdpUrl);
  const campaignDiagnostics = {
    consoleErrors: [],
    runtimeErrors: [],
    httpErrors: []
  };
  const pageIds = new Set();
  let cdpReconnectCount = 0;
  const cdpRecoveryEvents = [];
  const results = [];
  const absorbDiagnostics = () => {
    for (const field of Object.keys(campaignDiagnostics)) {
      campaignDiagnostics[field].push(
        ...chrome.diagnostics[field]
      );
      chrome.diagnostics[field].length = 0;
    }
  };
  const prepareChrome = async () => {
    await Promise.all([
      chrome.send("Runtime.enable"),
      chrome.send("Page.enable"),
      chrome.send("Network.enable")
    ]);
    pageIds.add(chrome.page.id);
    await chrome.send("Page.bringToFront");
    await chrome.send("Page.navigate", { url: TARGET_URL });
    await chrome.waitFor(() =>
      chrome.evaluate(
        `document.readyState === "complete" && Boolean(window.__duplexLab)`
      )
    );
    chrome.diagnostics.consoleErrors.length = 0;
    chrome.diagnostics.runtimeErrors.length = 0;
    chrome.diagnostics.httpErrors.length = 0;
  };
  const reconnectChrome = async (detail) => {
    cdpRecoveryEvents.push(detail);
    absorbDiagnostics();
    chrome.socket.close();
    chrome = await connectChrome(cdpUrl);
    cdpReconnectCount += 1;
    await prepareChrome();
  };
  try {
    await prepareChrome();

    for (
      let repetition = 1;
      repetition <= options.repetitions;
      repetition += 1
    ) {
      const offset = (repetition - 1) % definitions.length;
      const ordered = [
        ...definitions.slice(offset),
        ...definitions.slice(0, offset)
      ];
      for (const definition of ordered) {
        process.stdout.write(
          `Chrome ${definition.id} ` +
            `[r${repetition}/${options.repetitions}]... `
        );
        let result = null;
        let cdpRetryCount = 0;
        while (result === null) {
          try {
            result = await runCase(
              chrome,
              definition,
              sourceById.get(definition.id),
              options
            );
          } catch (error) {
            const cdpLost =
              /CDP (?:não respondeu|desconectado)/u.test(error.message);
            if (cdpLost && cdpRetryCount < 1) {
              cdpRetryCount += 1;
              await reconnectChrome({
                id: definition.id,
                repetition,
                recovered: true,
                message: error.message
              });
              continue;
            }
            result = {
              id: definition.id,
              timingPattern: definition.timingPattern,
              effectRisk: definition.effectRisk,
              behaviorPass: false,
              error: { name: error.name, message: error.message },
              trace: cdpLost
                ? []
                : await chrome.evaluate(
                    "window.__duplexLab.snapshot().trace",
                    5_000
                  ).catch(() => [])
            };
            if (cdpLost) {
              await reconnectChrome({
                id: definition.id,
                repetition,
                recovered: false,
                message: error.message
              });
            }
          }
        }
        result.repetition = repetition;
        result.cdpRetryCount = cdpRetryCount;
        result.observationId =
          `${definition.id}#r${repetition}`;
        results.push(result);
        console.log(result.behaviorPass ? "PASS" : "HOLD");
      }
    }
  } finally {
    absorbDiagnostics();
    chrome.socket.close();
  }
  const runtimeHealthAfter = await readRuntimeHealth();
  const usageDelta = measureUsageDelta(runtimeHealth, runtimeHealthAfter);
  const sameProcess =
    runtimeHealth.process?.runId === runtimeHealthAfter.process?.runId;
  const customExecution =
    options.caseIds.length > 0 ||
    options.repetitions !== 1 ||
    options.audioOverrides !== null ||
    options.textOverrides !== null;
  const campaignGates = customExecution
    ? evaluateRepeatedCampaignGates({
        definitions,
        diagnostics: campaignDiagnostics,
        repetitions: options.repetitions,
        results
      })
    : evaluateBrowserCampaignGates({
        expectedCaseIds: provenance.expectedCaseIds,
        expectedCaseCount: provenance.expectedCaseCount,
        results,
        diagnostics: campaignDiagnostics
      });
  const comparable = runtimeComparable && sameProcess;
  const semanticPass =
    campaignGates.semanticBehaviorPass && comparable;
  const behaviorPass =
    campaignGates.interactionBehaviorPass && comparable;
  const temporalPatternsPass =
    results.length === definitions.length * options.repetitions &&
    results.every((item) => item.timingPatternExecuted === true);
  const interruptionResults = results.filter((item) =>
    ["barge-in", "cross-turn"].includes(item.timingPattern)
  );
  const renderStopPass =
    interruptionResults.length > 0 &&
    interruptionResults.every((item) => item.renderStopPass === true);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: await createSourceFingerprint(PROJECT_ROOT),
    candidate:
      options.input === "pcm"
        ? options.acousticCondition
          ? `windows-chrome-local-pcm-${options.acousticCondition}-path`
          : "windows-chrome-local-pcm-path"
        : "windows-chrome-local-text-path",
    provenance: {
      ...provenance,
      casesPath,
      casesFileSha256: browserInput.sha256,
      sourcePackPath: options.pack,
      sourcePackFileSha256: sourceInput.sha256,
      manifestPath,
      manifestFileSha256: manifestInput.sha256,
      buildReportPath: buildReport ? DEFAULT_BUILD_REPORT : null,
      buildReportFileSha256: buildReport?.sha256 ?? null,
      acousticBuildReportPath: acousticBuildInput
        ? "eval/reports/eval-factory-acoustic-latest.json"
        : null,
      acousticBuildReportFileSha256:
        acousticBuildInput?.sha256 ?? null,
      audioOverridesPath: options.audioOverrides,
      audioOverridesFileSha256:
        audioOverridesInput?.sha256 ?? null,
      textOverridesPath: options.textOverrides,
      textOverridesFileSha256:
        textOverridesInput?.sha256 ?? null
    },
    runtime: {
      health: runtimeHealth,
      healthAfter: runtimeHealthAfter,
      currentRuntimeFingerprint,
      comparable
    },
    browser: {
      cdpUrl,
      pageIds: [...pageIds],
      cdpReconnectCount,
      cdpRecoveryEvents,
      targetUrl: TARGET_URL
    },
    execution: {
      ...usageDelta,
      input: options.input,
      acousticCondition: options.acousticCondition,
      caseCount: results.length,
      repetitions: options.repetitions,
      selectedCaseIds: definitions.map((item) => item.id)
    },
    gates: {
      browserSemanticCorrection: {
        decision: semanticPass ? "promote" : "hold",
        pass: semanticPass,
        scope:
          options.input === "pcm"
            ? "PCM sintético → VAD → ASR → rollback e confirmação corretos"
            : "texto injetado → rollback e confirmação corretos",
        runtimeComparable: comparable
      },
      browserBehavior: {
        decision: behaviorPass ? "promote" : "hold",
        pass: behaviorPass,
        scope:
          options.input === "pcm"
            ? "PCM sintético → VAD → ASR → estado semântico → brain → TTS no Chrome"
            : "texto injetado → estado semântico → brain → TTS no Chrome",
        runtimeComparable: comparable
      },
      criticalSlotSafety: {
        decision:
          campaignGates.criticalSlotSafetyPass && comparable
            ? "promote"
            : "hold",
        pass:
          campaignGates.criticalSlotSafetyPass && comparable,
      reason:
        "valor correto é confirmado, conflito gera reparo ou ação irreversível aguarda confirmação"
      },
      temporalPatternFidelity: {
        decision: temporalPatternsPass ? "promote" : "hold",
        pass: temporalPatternsPass,
        reason:
          temporalPatternsPass
            ? "todos os padrões declarados foram executados fisicamente"
            : "pausa e cross-turn ainda não possuem driver causal equivalente ao rótulo"
      },
      browserRenderStop: {
        decision: renderStopPass ? "promote" : "hold",
        pass: renderStopPass,
        measuredCases: interruptionResults.length,
        required: "último quantum <= 250 ms"
      },
      downstreamEffects: {
        decision:
          campaignGates.downstreamEffectsPass ? "promote" : "hold",
        pass: campaignGates.downstreamEffectsPass,
        measuredCases: campaignGates.effectsMeasured,
        requiredCases: campaignGates.effectsRequired,
        reason:
          "não há adaptador de ações externas nesta vertical local"
      },
      userFacingReadiness: {
        decision: "hold",
        reason:
          "efeitos externos, repetição estatística e validade humana continuam não medidos"
      }
    },
    diagnostics: campaignDiagnostics,
    results
  };
  const output = resolve(PROJECT_ROOT, outPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Browser behavior: ${report.gates.browserBehavior.decision}; ` +
      `efeitos: ${report.gates.downstreamEffects.decision}.`
  );
  console.log(`Relatório: ${outPath}`);
  if (options.failOnHold && !behaviorPass) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main();
}
