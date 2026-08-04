import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";

import { connectCdpBrowser } from "./lib/cdp-browser.mjs";
import { startExp0026Server } from "./lib/exp-0026-process.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const reportPath = resolve(
  projectRoot,
  process.env.EXP0026_LIFECYCLE_REPORT ??
    "eval/reports/exp-0026-lifecycle-smoke-v0.1.json"
);
execFileSync(process.execPath, [
  "scripts/materialize-exp-0026-stimuli.mjs",
  "--check"
], { cwd: projectRoot, stdio: "ignore" });

let stubRequests = 0;
const openaiStub = createServer(async (request, response) => {
  for await (const _chunk of request) {
    // Drena o corpo para reproduzir o lifecycle HTTP completo.
  }
  stubRequests += 1;
  const responseId = `stub-${stubRequests}`;
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    {
      type: "response.created",
      response: { id: responseId, model: "gpt-5.6-luna" }
    },
    { type: "response.output_text.delta", delta: "Entendido." },
    {
      type: "response.completed",
      response: {
        id: responseId,
        model: "gpt-5.6-luna",
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 }
      }
    }
  ]) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
});
await new Promise((resolveListen, rejectListen) => {
  openaiStub.once("error", rejectListen);
  openaiStub.listen(0, "127.0.0.1", resolveListen);
});
const openaiApiUrl =
  `http://127.0.0.1:${openaiStub.address().port}/v1/responses`;
const browser = await connectCdpBrowser();
const observations = [];
const runIds = new Set();
const contextIds = new Set();
const startedAt = new Date().toISOString();

try {
  for (let index = 0; index < 6; index += 1) {
    const server = await startExp0026Server({
      projectRoot,
      runtime: "lifecycle",
      role: "dry-run",
      participantAlias: `LIFECYCLE-${index + 1}`,
      orderIndex: index,
      dataRoot: "eval/generated/exp-0026/lifecycle-smoke",
      openaiApiUrl
    });
    let page = null;
    let observation = null;
    try {
      const health = server.health;
      assert.equal(health.brain, "openai");
      assert.deepEqual(health.models, {
        interaction: "gpt-5.6-luna",
        task: "gpt-5.6-luna"
      });
      assert.equal(health.usage.requests, 0);
      assert.equal(health.usage.requestLimit, 25);
      assert.equal(health.interaction.activeKernelSessions, 0);
      assert.equal(health.evaluation.exp0026.role, "dry-run");
      assert.equal(
        health.evaluation.exp0026.analysisEligibility,
        "excluded-dry-run"
      );
      assert.equal(runIds.has(health.process.runId), false);
      runIds.add(health.process.runId);

      page = await browser.createIsolatedPage(
        `http://localhost:${server.port}/exp-0026/?token=${server.accessToken}`,
        { newWindow: false }
      );
      assert.equal(contextIds.has(page.browserContextId), false);
      contextIds.add(page.browserContextId);
      await page.waitFor(
        "Boolean(window.__exp0026?.snapshot?.()?.sessionId) && " +
        "Boolean(document.querySelector('#voiceFrame')?.contentWindow?.__duplexEvaluation)",
        { timeoutMs: 30_000 }
      );
      const isolation = await page.evaluate(`(() => {
        const frame = document.querySelector('#voiceFrame').contentWindow;
        return {
          parent: {
            localStorageKeys: Object.keys(localStorage),
            sessionStorageKeys: Object.keys(sessionStorage)
          },
          voice: frame.__duplexEvaluation.isolationSnapshot(),
          publicSession: window.__exp0026.snapshot()
        };
      })()`);
      assert.deepEqual(isolation.parent.localStorageKeys, []);
      assert.deepEqual(isolation.parent.sessionStorageKeys, []);
      assert.deepEqual(isolation.voice.localStorageKeys, []);
      assert.deepEqual(isolation.voice.sessionStorageKeys, []);
      assert.equal(isolation.voice.historyLength, 0);
      assert.equal(isolation.publicSession.runtime.requests, 0);
      assert.equal(isolation.publicSession.runtime.requestLimit, 25);
      assert.equal(isolation.publicSession.runtime.activeKernelSessions, 0);
      await page.evaluate(`(() => {
        localStorage.setItem('exp0026-contamination-probe', 'cycle-${index + 1}');
        document.querySelector('#voiceFrame').contentWindow.localStorage
          .setItem('exp0026-voice-contamination-probe', 'cycle-${index + 1}');
        const bridge = document.querySelector('#voiceFrame').contentWindow
          .__duplexEvaluation;
        bridge.activateDryRun();
        bridge.injectDryRunSpeech('contaminação controlada do ciclo ${index + 1}');
        return true;
      })()`);
      await page.waitFor(
        "document.querySelector('#voiceFrame').contentWindow" +
          ".__duplexEvaluation.isolationSnapshot().historyLength >= 2",
        { timeoutMs: 20_000 }
      );
      const contaminated = await page.evaluate(`(() => ({
        voice: document.querySelector('#voiceFrame').contentWindow
          .__duplexEvaluation.isolationSnapshot()
      }))()`);
      const healthAfter = await fetch(server.healthUrl)
        .then((response) => response.json());
      assert.equal(contaminated.voice.historyLength, 2);
      assert.equal(healthAfter.usage.requests, 1);
      assert.equal(healthAfter.interaction.activeKernelSessions, 1);
      observation = {
        cycle: index + 1,
        processRunId: health.process.runId,
        browserContextId: page.browserContextId,
        sessionId: health.evaluation.exp0026.sessionId,
        usageAtStart: {
          requests: health.usage.requests,
          requestLimit: health.usage.requestLimit
        },
        activeKernelSessionsAtStart:
          health.interaction.activeKernelSessions,
        historyLengthAtStart: isolation.voice.historyLength,
        parentStorageKeysAtStart: isolation.parent,
        voiceStorageKeysAtStart: {
          localStorageKeys: isolation.voice.localStorageKeys,
          sessionStorageKeys: isolation.voice.sessionStorageKeys
        },
        contaminatedBeforeShutdown: {
          historyLength: contaminated.voice.historyLength,
          requests: healthAfter.usage.requests,
          activeKernelSessions:
            healthAfter.interaction.activeKernelSessions
        },
        processStoppedCleanly: null
      };
      observations.push(observation);
    } finally {
      await page?.close().catch(() => {});
      await server.stop();
      if (observation) {
        observation.processStoppedCleanly = server.child.exitCode === 0;
      }
      assert.equal(server.child.exitCode, 0);
    }
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => openaiStub.close(resolveClose));
}

assert.equal(runIds.size, 6);
assert.equal(contextIds.size, 6);
const report = {
  schemaVersion: "exp-0026-lifecycle-smoke-v1",
  experimentId: "EXP-0026",
  analysisEligibility: "excluded-technical-smoke",
  fitEligibility: "evaluation-only",
  startedAt,
  completedAt: new Date().toISOString(),
  browser: {
    product: browser.version.Browser,
    protocolVersion: browser.version["Protocol-Version"],
    isolatedContexts: true
  },
  gates: {
    sixDistinctProcesses: runIds.size === 6,
    sixDistinctBrowserContexts: contextIds.size === 6,
    usageStartsAtZeroOf25: observations.every(
      (item) => item.usageAtStart.requests === 0 &&
        item.usageAtStart.requestLimit === 25
    ),
    historyStartsEmpty: observations.every(
      (item) => item.historyLengthAtStart === 0
    ),
    storageStartsEmpty: observations.every((item) =>
      item.parentStorageKeysAtStart.localStorageKeys.length === 0 &&
      item.parentStorageKeysAtStart.sessionStorageKeys.length === 0 &&
      item.voiceStorageKeysAtStart.localStorageKeys.length === 0 &&
      item.voiceStorageKeysAtStart.sessionStorageKeys.length === 0
    ),
    kernelStartsEmpty: observations.every(
      (item) => item.activeKernelSessionsAtStart === 0
    ),
    eachPriorCycleWasContaminated: observations.every(
      (item) =>
        item.contaminatedBeforeShutdown.historyLength === 2 &&
        item.contaminatedBeforeShutdown.requests === 1 &&
        item.contaminatedBeforeShutdown.activeKernelSessions === 1
    ),
    cleanShutdown: observations.every(
      (item) => item.processStoppedCleanly === true
    )
  },
  observations
};
report.pass = Object.values(report.gates).every(Boolean);
assert.equal(report.pass, true);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  reportPath,
  pass: report.pass,
  gates: report.gates
}, null, 2)}\n`);
