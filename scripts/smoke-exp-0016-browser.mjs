import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import {
  extractSpeakerRelevanceFeatures
} from "../src/eval/speaker-relevance-features.mjs";
import {
  predictSpeakerRelevance
} from "../web/speaker-relevance-shadow.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const TARGET_URL = process.env.DUPLEX_URL ??
  "http://localhost:4173/?automation=1&experiment=0016";
const REPORT_PATH = resolve(
  PROJECT_ROOT,
  process.env.BROWSER_REPORT ??
    "eval/generated/exp-0016/browser-shadow-report.json"
);
const COMMAND_TIMEOUT_MS = 10_000;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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
    throw new Error("gateway do Windows não encontrado");
  }
  return `http://${gateway}:9223`;
}

async function connectPage(cdpUrl) {
  const response = await fetch(`${cdpUrl}/json/list`, {
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`CDP retornou HTTP ${response.status}`);
  }
  const pages = await response.json();
  let page = pages.find((candidate) =>
    candidate.type === "page" &&
    candidate.url.startsWith(new URL(TARGET_URL).origin)
  );
  if (!page) {
    const created = await fetch(
      `${cdpUrl}/json/new?${encodeURIComponent(TARGET_URL)}`,
      {
        method: "PUT",
        signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS)
      }
    );
    if (!created.ok) {
      throw new Error(`não foi possível abrir aba: HTTP ${created.status}`);
    }
    page = await created.json();
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((accept, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout conectando ao CDP")),
      COMMAND_TIMEOUT_MS
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      accept();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("falha conectando ao CDP"));
    }, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const item = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) {
      item.reject(new Error(message.error.message));
    } else {
      item.accept(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((accept, reject) => {
    sequence += 1;
    const id = sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout CDP: ${method}`));
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, { accept, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
      );
    }
    return result.result.value;
  };
  await Promise.all([send("Page.enable"), send("Runtime.enable")]);
  await send("Page.navigate", { url: TARGET_URL });
  return { socket, evaluate };
}

async function waitFor(probe, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await probe();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((accept) => setTimeout(accept, 100));
  }
  throw new Error(
    `condição do Chrome não satisfeita` +
      (lastError ? `: ${lastError.message}` : "")
  );
}

function relativeDifference(left, right) {
  return Math.abs(left - right) / Math.max(1e-12, Math.abs(right));
}

const [dataset, checkpoint] = await Promise.all([
  readFile(resolve(
    PROJECT_ROOT,
    "eval/datasets/exp-0016-speaker-relevance-v0.1.json"
  )).then(JSON.parse),
  readFile(resolve(
    PROJECT_ROOT,
    "web/speaker-relevance-checkpoint.json"
  )).then(JSON.parse)
]);
const selected = [
  "interrupcao--rate-1.wav",
  "correcao--rate-1.wav",
  "hesitacao--rate-1.wav",
  "cancelamento--rate-1.wav"
].map((fileName) => ({
  probeId: fileName.replace(/\.wav$/u, ""),
  path: `eval/generated/asr/audio/${fileName}`,
  evaluationRole: "browser-runtime-contract-only",
  fitEligibility: "excluded-from-fit"
}));

const cdpUrl = discoverCdpUrl();
const { socket, evaluate } = await connectPage(cdpUrl);
try {
  const ready = await waitFor(() => evaluate(`(() => {
    const lab = window.__duplexLab;
    if (!lab) return null;
    const snapshot = lab.snapshot();
    return snapshot.audio.speakerRelevanceShadow?.state === "ready"
      ? snapshot.audio.speakerRelevanceShadow
      : null;
  })()`), 60_000);
  if (
    ready.modelSha256 !== checkpoint.modelSha256 ||
    ready.authority !== false
  ) {
    throw new Error("checkpoint do navegador não corresponde ao esperado");
  }
  const cases = [];
  for (const probe of selected) {
    const wave = await readFile(resolve(PROJECT_ROOT, probe.path));
    const waveSha256 = sha256(wave);
    const decoded = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 });
    await evaluate(`window.__duplexLab.replayPcmBase64(
      ${JSON.stringify(decoded.pcm.toString("base64"))},
      { realtime: true, silenceMs: 800 }
    )`);
    const snapshot = await waitFor(() => evaluate(`(() => {
      const snapshot = window.__duplexLab.snapshot();
      return snapshot.audio.speakerRelevanceShadow.decisionCount > 0
        ? snapshot
        : null;
    })()`));
    const browser = snapshot.audio.speakerRelevanceShadow.decisions.at(-1);
    const pcm = decoded.pcm.subarray(
      browser.onsetSample * 2,
      browser.decisionSample * 2
    );
    const features = extractSpeakerRelevanceFeatures({
      pcm,
      sampleRate: 16_000,
      onsetSample: 0,
      decisionSample: pcm.length / 2
    });
    const node = predictSpeakerRelevance(checkpoint, features);
    const probabilityParity = Object.keys(node.probabilities).every(
      (label) => relativeDifference(
        browser.probabilities[label],
        node.probabilities[label]
      ) < 1e-10
    );
    cases.push({
      probeId: probe.probeId,
      evaluationRole: probe.evaluationRole,
      fitEligibility: probe.fitEligibility,
      artifact: { path: probe.path, waveSha256 },
      onsetSample: browser.onsetSample,
      decisionSample: browser.decisionSample,
      browser: {
        rawLabel: browser.rawLabel,
        operationalLabel: browser.operationalLabel,
        suggestedAction: browser.suggestedAction,
        probabilities: browser.probabilities,
        futureSamplesUsed: browser.futureSamplesUsed,
        authority: browser.authority
      },
      node: {
        rawLabel: node.rawLabel,
        operationalLabel: node.operationalLabel,
        probabilities: node.probabilities
      },
      parity: {
        labels:
          browser.rawLabel === node.rawLabel &&
          browser.operationalLabel === node.operationalLabel,
        probabilities: probabilityParity
      }
    });
  }
  const gates = {
    checkpointLoaded:
      ready.modelSha256 === checkpoint.modelSha256,
    fourRuntimeCases: cases.length === 4,
    distinctAudio:
      new Set(cases.map((item) => item.artifact.waveSha256)).size === 4,
    causal: cases.every((item) => item.browser.futureSamplesUsed === 0),
    nodeBrowserParity: cases.every(
      (item) => item.parity.labels && item.parity.probabilities
    ),
    noAuthority: cases.every((item) => item.browser.authority === false)
  };
  const report = {
    schemaVersion: "exp-0016-browser-shadow-report-v1",
    experimentId: dataset.datasetId,
    target: {
      url: TARGET_URL,
      browser: "windows-chrome-cdp"
    },
    checkpoint: {
      id: checkpoint.checkpointId,
      modelSha256: checkpoint.modelSha256
    },
    dataset: {
      id: dataset.datasetId,
      sha256: dataset.datasetSha256,
      fitExamplesFromBrowserProbes: 0
    },
    cases,
    metrics: {
      cases: cases.length,
      rawLabels: Object.fromEntries(
        dataset.classes.map((label) => [
          label,
          cases.filter((item) => item.browser.rawLabel === label).length
        ])
      ),
      operationalLabels: Object.fromEntries(
        dataset.classes.map((label) => [
          label,
          cases.filter(
            (item) => item.browser.operationalLabel === label
          ).length
        ])
      ),
      maximumFutureSamplesUsed: Math.max(
        ...cases.map((item) => item.browser.futureSamplesUsed)
      )
    },
    gates,
    pass: Object.values(gates).every(Boolean),
    authorityEligible: false,
    paidApiCalls: 0
  };
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `EXP-0016 Chrome ${report.pass ? "PASS" : "HOLD"}: ` +
      `${report.metrics.cases} casos, paridade=${gates.nodeBrowserParity}, ` +
      `autoridade=${report.authorityEligible}`
  );
  if (!report.pass) {
    process.exitCode = 1;
  }
} finally {
  socket.close();
}
