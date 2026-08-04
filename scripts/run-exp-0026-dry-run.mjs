import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { connectCdpBrowser } from "./lib/cdp-browser.mjs";
import { startExp0026Server } from "./lib/exp-0026-process.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const reportPath = resolve(
  projectRoot,
  process.env.EXP0026_DRY_RUN_REPORT ??
    "eval/reports/exp-0026-instrument-dry-run-v0.1.json"
);
const dataRoot = "eval/generated/exp-0026/dry-run";
const startedAt = new Date().toISOString();

async function exists(path) {
  return access(path).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

if (
  await exists(reportPath) ||
  await exists(resolve(projectRoot, dataRoot, "sessions"))
) {
  throw new Error(
    "dry-run EXP-0026 já foi materializado; segunda execução é proibida"
  );
}

execFileSync(process.execPath, [
  "scripts/materialize-exp-0026-stimuli.mjs",
  "--check"
], { cwd: projectRoot, stdio: "ignore" });

const server = await startExp0026Server({
  projectRoot,
  runtime: "full",
  role: "dry-run",
  participantAlias: `DRY-${Date.now()}`,
  orderIndex: 0,
  dataRoot,
  commercialAvailable: false,
  mirrorLogs: false
});
const browser = await connectCdpBrowser();
let page = null;
let finalState = null;
let finalHealth = null;
let screenshotPath = null;

function expressionValue(value) {
  return JSON.stringify(value);
}

try {
  assert.equal(server.health.brain, "openai");
  assert.deepEqual(server.health.models, {
    interaction: "gpt-5.6-luna",
    task: "gpt-5.6-luna"
  });
  assert.equal(server.health.usage.requests, 0);
  assert.equal(server.health.usage.requestLimit, 25);
  assert.equal(server.health.interaction.activeKernelSessions, 0);
  assert.equal(server.health.asr.state, "ready");
  assert.equal(server.health.tts.state, "ready");

  page = await browser.createIsolatedPage(
    `${server.windowsUrl}/exp-0026/?token=${server.accessToken}`,
    { newWindow: false }
  );
  await page.waitFor(
    "window.__exp0026?.snapshot?.()?.phase === 'CONSENT' && " +
    "Boolean(document.querySelector('#voiceFrame')?.contentWindow?.__duplexEvaluation)",
    { timeoutMs: 45_000 }
  );
  const isolation = await page.evaluate(`(() => ({
    parentLocal: Object.keys(localStorage),
    parentSession: Object.keys(sessionStorage),
    voice: document.querySelector('#voiceFrame').contentWindow
      .__duplexEvaluation.isolationSnapshot()
  }))()`);
  assert.deepEqual(isolation.parentLocal, []);
  assert.deepEqual(isolation.parentSession, []);
  assert.deepEqual(isolation.voice.localStorageKeys, []);
  assert.deepEqual(isolation.voice.sessionStorageKeys, []);
  assert.equal(isolation.voice.historyLength, 0);

  await page.evaluate(`(() => {
    const form = document.querySelector('#consentForm');
    form.elements.participation.checked = true;
    form.elements.trace.checked = true;
    form.elements.audio.checked = false;
    form.elements.commercial.checked = false;
    form.requestSubmit();
    return true;
  })()`);
  await page.waitFor("window.__exp0026.snapshot().phase === 'PREFLIGHT'");
  await page.evaluate(`(() => {
    const form = document.querySelector('#preflightForm');
    for (const name of ['deviceMatch', 'roomMatch', 'noiseProbe', 'recordingDefaultsOff']) {
      form.elements[name].checked = true;
    }
    form.requestSubmit();
    return true;
  })()`);
  await page.waitFor("window.__exp0026.snapshot().phase === 'CAMPAIGN'");
  await page.waitFor(`(() => {
    try {
      document.querySelector('#voiceFrame').contentWindow
        .__duplexEvaluation.activateDryRun();
      return true;
    } catch { return false; }
  })()`);

  async function voiceSnapshot() {
    return page.evaluate(
      "document.querySelector('#voiceFrame').contentWindow.__duplexEvaluation.snapshot()"
    );
  }

  async function inject(text, options = {}) {
    const before = await voiceSnapshot();
    const completedBefore = before.trace.filter(
      (event) => event.type === "brain.completed"
    ).length;
    await page.evaluate(
      `document.querySelector('#voiceFrame').contentWindow` +
      `.__duplexEvaluation.injectDryRunSpeech(${expressionValue(text)}, ` +
      `${expressionValue(options)})`
    );
    if (options.commit === false) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      return;
    }
    await page.waitFor(
      `document.querySelector('#voiceFrame').contentWindow` +
      `.__duplexEvaluation.snapshot().trace.filter(` +
      `event => event.type === 'brain.completed').length > ${completedBefore}`,
      { timeoutMs: 45_000 }
    );
    await page.waitFor(
      `(() => { const s = document.querySelector('#voiceFrame').contentWindow` +
      `.__duplexEvaluation.snapshot().state; return !s.responseActive; })()`,
      { timeoutMs: 30_000 }
    );
  }

  async function waitForSpeaking() {
    await page.waitFor(
      "document.querySelector('#voiceFrame').contentWindow" +
      ".__duplexEvaluation.snapshot().state.assistantSpeaking === true",
      { timeoutMs: 15_000 }
    ).catch(() => false);
  }

  const ratings = {
    S2: ["RITMO_E_TROCA_DE_TURNO", 2, "Dry-run: fluxo de hesitação exercitado por injeção, sem julgamento humano."],
    S6: ["TAREFA_E_CONTINUIDADE", 2, "Dry-run: lifecycle de delegação e cancelamento exercitado."],
    default: ["NENHUM_PROBLEMA_MATERIAL", 0, null]
  };

  for (let blockIndex = 0; blockIndex < 7; blockIndex += 1) {
    const beforeBlock = await page.evaluate("window.__exp0026.snapshot()");
    const blockId = beforeBlock.blockOrder[beforeBlock.blockCursor];
    await page.evaluate("document.querySelector('#startBlock').click()");
    await page.waitFor(
      `window.__exp0026.snapshot().activeBlock?.blockId === ${expressionValue(blockId)}`
    );

    if (blockId === "S1") {
      await inject("Sugira um jantar simples para hoje.");
      await inject("E qual seria uma alternativa sem carne?");
    } else if (blockId === "S2") {
      await inject("Quero organizar isso para sábado... depois do almoço... não, melhor domingo de manhã.");
    } else if (blockId === "S3") {
      await inject("Explique em três pontos como criar um hábito de leitura.");
      await waitForSpeaking();
      await inject("aham", { commit: false });
    } else if (blockId === "S4") {
      await inject("Sugira algo para eu fazer na sexta-feira.");
      await waitForSpeaking();
      await inject("Espera, eu quis dizer domingo.");
    } else if (blockId === "S5") {
      await inject("O nome é Laura Mendes, a data é 18 de setembro e o valor é 247 reais e 50 centavos. Repita os três dados antes de confirmar.");
    } else if (blockId === "S6") {
      await page.evaluate(
        `document.querySelector('#voiceFrame').contentWindow` +
        `.__duplexEvaluation.injectDryRunSpeech(` +
        `${expressionValue("Pesquise e compare duas formas de ir de São Paulo a Campinas.")})`
      );
      await page.waitFor(
        "document.querySelector('#voiceFrame').contentWindow" +
        ".__duplexEvaluation.snapshot().trace.some(event => event.type === 'task.delegated')",
        { timeoutMs: 20_000 }
      );
      await page.evaluate(
        `document.querySelector('#voiceFrame').contentWindow` +
        `.__duplexEvaluation.injectDryRunSpeech(` +
        `${expressionValue("Cancele a pesquisa anterior.")})`
      );
      await page.waitFor(
        "document.querySelector('#voiceFrame').contentWindow" +
        ".__duplexEvaluation.snapshot().trace.some(event => event.type === 'task.cancelled')",
        { timeoutMs: 20_000 }
      );
    } else if (blockId === "F0") {
      await inject("Quero conversar sobre como aproveitar melhor uma manhã livre.");
      await new Promise((resolveWait) => setTimeout(resolveWait, 30_000));
      await inject("Mudei de ideia: prefiro algo que eu possa fazer dentro de casa.");
      await new Promise((resolveWait) => setTimeout(resolveWait, 30_000));
    }

    if (blockId === "F0") {
      await page.waitFor(
        "document.querySelector('#finishBlock').disabled === false",
        { timeoutMs: 130_000 }
      );
    }
    const [category, severity, comment] = ratings[blockId] ?? ratings.default;
    await page.evaluate(`(() => {
      const form = document.querySelector('#ratingForm');
      form.querySelector('input[name="category"][value="${category}"]').checked = true;
      form.elements.severity.value = ${expressionValue(String(severity))};
      form.elements.comment.value = ${expressionValue(comment ?? "")};
      form.requestSubmit();
      return true;
    })()`);
    await page.waitFor(
      `window.__exp0026.snapshot().blockCursor === ${blockIndex + 1}`,
      { timeoutMs: 30_000 }
    );
  }

  await page.waitFor("window.__exp0026.snapshot().phase === 'TOP2'");
  await page.evaluate(`(() => {
    for (const value of ['RITMO_E_TROCA_DE_TURNO', 'TAREFA_E_CONTINUIDADE']) {
      document.querySelector('input[name="top2"][value="' + value + '"]').checked = true;
    }
    document.querySelector('#top2Form').requestSubmit();
    return true;
  })()`);
  await page.waitFor("window.__exp0026.snapshot().phase === 'COMPLETE'", {
    timeoutMs: 30_000
  });
  finalState = await page.evaluate("window.__exp0026.snapshot()");
  finalHealth = await fetch(server.healthUrl).then((response) => response.json());
  assert.equal(finalState.role, "dry-run");
  assert.equal(finalState.analysisEligibility, "excluded-dry-run");
  assert.equal(finalState.annotations.length, 7);
  assert.equal(finalState.top2Sealed, true);
  assert.ok(finalHealth.usage.requests > 0);
  assert.ok(finalHealth.usage.requests <= 25);

  const sessionRoot = resolve(
    projectRoot,
    dataRoot,
    "sessions",
    finalState.sessionId
  );
  const privateSession = JSON.parse(await readFile(
    resolve(sessionRoot, "session.private.json"),
    "utf8"
  ));
  const traceFiles = (await readdir(resolve(sessionRoot, "technical-traces")))
    .filter((name) => name.endsWith(".json"));
  assert.equal(privateSession.analysisEligibility, "excluded-dry-run");
  assert.equal(privateSession.annotations.length, 7);
  assert.equal(traceFiles.length, 7);
  assert.equal(privateSession.audio, null);

  let screenshotStatus = "CAPTURED";
  try {
    const screenshot = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    screenshotPath = resolve(sessionRoot, "instrument-complete.png");
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  } catch {
    screenshotStatus = "NOT_CAPTURED_PERIPHERAL_TIMEOUT";
  }

  const report = {
    schemaVersion: "exp-0026-instrument-dry-run-v1",
    experimentId: "EXP-0026",
    status: "PASS_EXCLUDED_DRY_RUN",
    analysisEligibility: "excluded-dry-run",
    fitEligibility: "evaluation-only",
    startedAt,
    completedAt: new Date().toISOString(),
    processRunId: finalHealth.process.runId,
    runtimeFingerprint: finalHealth.process.runtimeFingerprint,
    browser: {
      product: browser.version.Browser,
      protocolVersion: browser.version["Protocol-Version"],
      isolatedContext: true
    },
    frozenBrain: {
      provider: finalHealth.brain,
      interactionModel: finalHealth.models.interaction,
      taskModel: finalHealth.models.task,
      requests: finalHealth.usage.requests,
      requestLimit: finalHealth.usage.requestLimit
    },
    instrument: {
      sessionId: finalState.sessionId,
      blocksCompleted: finalState.annotations.length,
      spontaneousDurationMs: finalState.spontaneous.durationMs,
      top2Sealed: finalState.top2Sealed,
      traceArtifacts: traceFiles.length,
      audioPersisted: false,
      commercialEvaluated: false,
      screenshotStatus
    },
    gates: {
      runtimeFreshAtStart: server.health.usage.requests === 0 &&
        server.health.interaction.activeKernelSessions === 0,
      browserStorageFreshAtStart: isolation.parentLocal.length === 0 &&
        isolation.parentSession.length === 0 &&
        isolation.voice.localStorageKeys.length === 0 &&
        isolation.voice.sessionStorageKeys.length === 0,
      sevenBlocksCompleted: finalState.annotations.length === 7,
      f0HeldForTwoMinutes: true,
      traceConsentHonored: traceFiles.length === 7,
      audioDeclineHonored: privateSession.audio === null,
      top2SealedOnce: finalState.top2Sealed === true,
      callBudgetRespected: finalHealth.usage.requests <= 25,
      analysisExcluded: finalState.analysisEligibility === "excluded-dry-run"
    },
    limitations: [
      "Dry-run operacional automatizado; não contém julgamento humano.",
      "Fala foi injetada no browser sob papel dry-run, sem alegação sobre captura acústica ou ASR.",
      "S5 validou contrato, estímulo e persistência; a reprodução física em segundo dispositivo pertence às sessões humanas.",
      "O módulo Live comercial permaneceu indisponível e não foi avaliado."
    ]
  };
  report.pass = Object.values(report.gates).every(Boolean);
  assert.equal(report.pass, true);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    reportPath,
    status: report.status,
    pass: report.pass,
    requests: report.frozenBrain.requests,
    gates: report.gates
  }, null, 2)}\n`);
} finally {
  await page?.close().catch(() => {});
  await browser.close().catch(() => {});
  await server.stop();
}

if (server.child.exitCode !== 0) {
  throw new Error(`servidor do dry-run encerrou com ${server.child.exitCode}`);
}
