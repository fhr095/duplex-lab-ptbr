import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = resolve(
  PROJECT_ROOT,
  process.env.CALIBRATION_BROWSER_REPORT ??
    "eval/reports/exp-0015-calibration-browser-current.json"
);
const COMMAND_TIMEOUT_MS = 10_000;
const PLAYBACK_TIMEOUT_MS = 12_000;

function privateIpv4() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  throw new Error("IP privado do WSL não encontrado");
}

function cdpOrigin() {
  if (process.env.CDP_URL) {
    return process.env.CDP_URL;
  }
  const route = execFileSync("ip", ["route", "show", "default"], {
    encoding: "utf8"
  });
  const gateway = /\bvia\s+([0-9.]+)/u.exec(route)?.[1];
  if (!gateway) {
    throw new Error("gateway do Windows não encontrado");
  }
  return `http://${gateway}:9223`;
}

const targetUrl = process.env.CALIBRATION_URL ??
  `http://${privateIpv4()}:4174/?automation=1`;
const healthUrl = process.env.CALIBRATION_HEALTH_URL ??
  "http://127.0.0.1:4174/api/health";
const cdpUrl = cdpOrigin();
const startedAt = new Date().toISOString();
const wallStart = performance.now();
const healthResponse = await fetch(healthUrl, {
  signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS)
});
if (!healthResponse.ok) {
  throw new Error(`health da calibração retornou HTTP ${healthResponse.status}`);
}
const health = await healthResponse.json();

const pages = await fetch(`${cdpUrl}/json/list`, {
  signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS)
}).then((response) => response.json());
let page = pages.find((candidate) =>
  candidate.type === "page" &&
  candidate.url.startsWith(new URL(targetUrl).origin)
);
if (!page) {
  const response = await fetch(
    `${cdpUrl}/json/new?${encodeURIComponent(targetUrl)}`,
    {
      method: "PUT",
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS)
    }
  );
  if (!response.ok) {
    throw new Error(`Chrome CDP não abriu a página: HTTP ${response.status}`);
  }
  page = await response.json();
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  const timer = setTimeout(
    () => rejectOpen(new Error("timeout ao conectar no Chrome CDP")),
    COMMAND_TIMEOUT_MS
  );
  socket.addEventListener("open", () => {
    clearTimeout(timer);
    resolveOpen();
  }, { once: true });
  socket.addEventListener("error", () => {
    clearTimeout(timer);
    rejectOpen(new Error("falha ao conectar no Chrome CDP"));
  }, { once: true });
});

let commandId = 0;
const pending = new Map();
const browserErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolveCommand, rejectCommand, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) {
      rejectCommand(new Error(message.error.message));
    } else {
      resolveCommand(message.result);
    }
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    browserErrors.push(
      message.params.exceptionDetails?.text ?? "Runtime.exceptionThrown"
    );
  }
  if (
    message.method === "Log.entryAdded" &&
    ["error", "warning"].includes(message.params.entry?.level)
  ) {
    browserErrors.push(message.params.entry.text);
  }
});

function send(method, params = {}) {
  const id = ++commandId;
  return new Promise((resolveCommand, rejectCommand) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectCommand(new Error(`timeout CDP: ${method}`));
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, { resolveCommand, rejectCommand, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitFor(expression, timeoutMs = COMMAND_TIMEOUT_MS) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const value = await evaluate(expression);
    if (value) {
      return value;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  }
  const diagnostic = await evaluate(`({
    snapshot: window.__duplexCalibration?.snapshot?.() ?? null,
    errorText: document.querySelector('#errorMessage')?.textContent ?? null,
    activeTag: document.activeElement?.tagName ?? null,
    href: location.href
  })`).catch((error) => ({ diagnosticError: error.message }));
  throw new Error(
    `condição não atingida no Chrome: ${expression} · ` +
      JSON.stringify(diagnostic)
  );
}

async function click(selector) {
  const point = await evaluate(`(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) {
    throw new Error(`elemento ausente: ${selector}`);
  }
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1
  });
}

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.navigate", { url: targetUrl });
await waitFor(
  "document.readyState === 'complete' && " +
    "Boolean(window.__duplexCalibration?.snapshot().ready)"
);
const initial = await evaluate("window.__duplexCalibration.snapshot()");
const bodyText = await evaluate("document.body.innerText");
const forbiddenTokens = [
  "WAIT_FOR_EVIDENCE",
  "PAUSE_OUTPUT",
  "CONTINUE_OUTPUT",
  "negation-short-early",
  "explicit-correction"
];
const exposedTokens = forbiddenTokens.filter((token) => bodyText.includes(token));
if (exposedTokens.length > 0) {
  throw new Error(`interface expôs tokens privados: ${exposedTokens.join(", ")}`);
}

await click("#startButton");
await waitFor("window.__duplexCalibration.snapshot().phase === 'campaign'");
const sessionReady = await evaluate("window.__duplexCalibration.snapshot()");
if (sessionReady.sceneCount !== 12 || sessionReady.optionCount !== 3) {
  throw new Error(
    `sessão inesperada: ${sessionReady.sceneCount} cenas / ` +
      `${sessionReady.optionCount} opções`
  );
}
const lockedBeforeListening = await evaluate(
  "document.querySelector('#choicePanel').disabled && " +
    "document.querySelector('#nextButton').disabled"
);
if (!lockedBeforeListening) {
  throw new Error("decisão foi liberada antes das três reproduções");
}

for (let index = 0; index < 3; index += 1) {
  await evaluate(`(() => {
    const audio = document.querySelectorAll('.audio-option audio')[${index}];
    audio.playbackRate = 4;
    audio.preservesPitch = true;
  })()`);
  await click(`.audio-option:nth-child(${index + 1}) .listen-button`);
  await waitFor(
    `window.__duplexCalibration.snapshot().completedOptions >= ${index + 1}`,
    PLAYBACK_TIMEOUT_MS
  );
}
const afterListening = await evaluate("window.__duplexCalibration.snapshot()");
const unlockedAfterListening = await evaluate(
  "!document.querySelector('#choicePanel').disabled && " +
    "document.querySelector('#nextButton').disabled"
);
if (!unlockedAfterListening) {
  throw new Error("escolha/confiança não respeitaram o gate de escuta");
}
await click('input[name="preference"][value="uncertain"]');
await click('input[name="confidence"][value="3"]');
await waitFor("window.__duplexCalibration.snapshot().sceneReady === true");
const readyToAdvance = await evaluate("window.__duplexCalibration.snapshot()");
if (await evaluate("document.querySelector('#nextButton').disabled")) {
  throw new Error("avanço permaneceu bloqueado após resposta completa");
}

const report = {
  schemaVersion: "exp-0015-calibration-browser-smoke-v1",
  startedAt,
  completedAt: new Date().toISOString(),
  targetUrl,
  cdpUrl,
  browser: {
    product: await send("Browser.getVersion"),
    pageId: page.id
  },
  health,
  protocol: {
    realWindowsChrome: true,
    audioPlaybackRate: 4,
    annotationSubmitted: false,
    reason: "smoke técnico não pode contaminar julgamentos humanos"
  },
  observations: {
    initial,
    sessionReady,
    lockedBeforeListening,
    afterListening,
    unlockedAfterListening,
    readyToAdvance,
    exposedTokens,
    browserErrors
  },
  durationMs: performance.now() - wallStart,
  pass:
    initial.phase === "intro" &&
    sessionReady.sceneCount === 12 &&
    sessionReady.optionCount === 3 &&
    lockedBeforeListening &&
    afterListening.completedOptions === 3 &&
    unlockedAfterListening &&
    readyToAdvance.sceneReady &&
    exposedTokens.length === 0 &&
    browserErrors.length === 0
};

await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
await send("Page.navigate", { url: targetUrl }).catch(() => {});
socket.close();

console.log(
  `EXP-0015 Chrome: ${report.pass ? "PASS" : "FAIL"} · ` +
    `${report.observations.afterListening.completedOptions}/3 WAVs concluídos · ` +
    `${report.durationMs.toFixed(0)} ms`
);
console.log(`Relatório bruto: ${REPORT_PATH}`);
if (!report.pass) {
  process.exitCode = 1;
}
