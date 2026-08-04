import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { connectCdpBrowser } from "./lib/cdp-browser.mjs";
import { startExp0026Server } from "./lib/exp-0026-process.mjs";
import {
  createExp0026ReplacementLedger,
  validateExp0026ReplacementLedger
} from "../src/eval/exp-0026-replacements.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const requestedRole = argument("--role");
if (requestedRole && requestedRole !== "external") {
  throw new Error(
    "o dry-run EXP-0026 é terminal; este supervisor abre somente sessões externas"
  );
}
const role = "external";
const participantAlias = argument("--participant");
const orderIndex = Number.parseInt(argument("--order") ?? "", 10);
if (!participantAlias) throw new Error("--participant com alias opaco é obrigatório");
if (!Number.isSafeInteger(orderIndex) || orderIndex < 0 || orderIndex > 5) {
  throw new Error("--order precisa estar entre 0 e 5");
}
let externalFreeze = null;
let rosterSlot = null;
{
  const freezePath = resolve(
    projectRoot,
    "eval/commitments/exp-0026-session-freeze-v0.1.json"
  );
  const freeze = JSON.parse(await readFile(freezePath, "utf8").catch(() => {
    throw new Error(
      "sessão externa bloqueada: freeze final EXP-0026 ainda não existe"
    );
  }));
  if (freeze.status !== "OPEN_FOR_SIX_EXTERNAL_SESSIONS") {
    throw new Error(
      `sessão externa bloqueada: freeze está ${freeze.status ?? "sem status"}`
    );
  }
  if (Date.now() > new Date(freeze.closesAt).valueOf()) {
    throw new Error("sessão externa bloqueada: janela de sete dias expirou");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8"
  }).trim();
  const drift = execFileSync(
    "git",
    ["diff", "--name-only", freeze.sourceCommit, head],
    { cwd: projectRoot, encoding: "utf8" }
  ).trim().split(/\r?\n/u).filter(Boolean);
  if (
    drift.some((path) =>
      path !== "eval/commitments/exp-0026-session-freeze-v0.1.json")
  ) {
    throw new Error("sessão externa bloqueada: código diverge do sourceCommit");
  }
  const dirty = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: projectRoot, encoding: "utf8" }
  ).trim();
  if (dirty !== "") {
    throw new Error("sessão externa bloqueada: worktree não está limpa");
  }
  const ledgerPath = resolve(
    projectRoot,
    "eval/generated/exp-0026/private/replacement-ledger.private.json"
  );
  const ledger = await readFile(ledgerPath, "utf8")
    .then(JSON.parse)
    .catch((error) => error.code === "ENOENT"
      ? createExp0026ReplacementLedger(freeze)
      : Promise.reject(error));
  const ledgerValidation = validateExp0026ReplacementLedger(freeze, ledger);
  if (!ledgerValidation.valid) {
    throw new Error(`ledger de reposições inválido: ${ledgerValidation.errors.join("; ")}`);
  }
  rosterSlot = ledger.slots.find((slot) => slot.activeAlias === participantAlias);
  if (!rosterSlot) {
    throw new Error("alias não está ativo no roster congelado");
  }
  if (rosterSlot.orderIndex !== orderIndex) {
    throw new Error("order não corresponde à posição congelada do alias");
  }
  const sessionsRoot = resolve(
    projectRoot,
    "eval/generated/exp-0026/private/sessions"
  );
  for (const entry of await readdir(sessionsRoot, { withFileTypes: true })
    .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error))) {
    if (!entry.isDirectory()) continue;
    const existing = JSON.parse(await readFile(
      resolve(sessionsRoot, entry.name, "session.private.json"),
      "utf8"
    ));
    if (
      existing.role === "external" &&
      existing.rosterSlotId === rosterSlot.slotId &&
      existing.phase !== "WITHDRAWN"
    ) throw new Error("slot já possui sessão externa; retry ou substituição por resultado é proibido");
  }
  externalFreeze = freeze;
}

execFileSync(process.execPath, [
  "scripts/materialize-exp-0026-stimuli.mjs",
  "--check"
], { cwd: projectRoot, stdio: "ignore" });

const server = await startExp0026Server({
  projectRoot,
  runtime: "full",
  role,
  participantAlias,
  orderIndex,
  rosterSlotId: rosterSlot.slotId,
  dataRoot: "eval/generated/exp-0026/private",
  commercialAvailable: externalFreeze.commercialReference.available,
  mirrorLogs: true
});
const browser = await connectCdpBrowser();
let page = null;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await page?.close().catch(() => {});
  await browser.close().catch(() => {});
  await server.stop();
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });

try {
  {
    const health = server.health;
    if (
      health.process.runtimeFingerprint.sha256 !==
        externalFreeze.runtimeBinding.sha256 ||
      health.brain !== externalFreeze.brain.provider ||
      health.models.interaction !== externalFreeze.brain.interactionModel ||
      health.models.task !== externalFreeze.brain.taskModel ||
      health.usage.requests !== 0 ||
      health.usage.requestLimit !==
        externalFreeze.brain.maxRequestsPerProcess ||
      health.tts.engine !== externalFreeze.tts.engine ||
      health.tts.voice !== externalFreeze.tts.voice ||
      health.tts.culture !== externalFreeze.tts.culture
    ) {
      throw new Error("runtime iniciado diverge do freeze final");
    }
  }
  const targetUrl =
    `http://localhost:${server.port}/exp-0026/?token=${server.accessToken}`;
  page = await browser.createIsolatedPage(targetUrl, {
    permissions: ["audioCapture"],
    newWindow: false
  });
  await page.waitFor(
    "Boolean(window.__exp0026?.snapshot?.()?.sessionId) && " +
      "Boolean(document.querySelector('#voiceFrame')?.contentWindow?.__duplexEvaluation)",
    { timeoutMs: 45_000 }
  );
  const isolation = await page.evaluate(`(() => ({
    parentLocal: Object.keys(localStorage),
    parentSession: Object.keys(sessionStorage),
    voice: document.querySelector('#voiceFrame').contentWindow
      .__duplexEvaluation.isolationSnapshot()
  }))()`);
  if (
    isolation.parentLocal.length > 0 ||
    isolation.parentSession.length > 0 ||
    isolation.voice.localStorageKeys.length > 0 ||
    isolation.voice.sessionStorageKeys.length > 0 ||
    isolation.voice.historyLength !== 0
  ) {
    throw new Error("contexto de navegador não começou vazio");
  }
  process.stdout.write(
    `\nEXP-0026 aberto no Chrome isolado.\n` +
    `Sessão: ${server.health.evaluation.exp0026.sessionId}\n` +
    `Papel: ${role}; slot: ${rosterSlot.slotId}; ordem: ${orderIndex}; orçamento: 0/25.\n` +
    `Recibo de retirada: ${server.withdrawalCode}\n` +
    `Guarde-o por 30 dias: ele permite apagar os dados mesmo após o servidor fechar.\n` +
    `Mantenha este terminal aberto até a confirmação de conclusão.\n\n`
  );
  let phase = "CONSENT";
  while (!new Set(["COMPLETE", "WITHDRAWN"]).has(phase)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    const session = await fetch(
      `${server.localUrl}/api/exp-0026/session`,
      {
        headers: { "x-exp0026-access-token": server.accessToken },
        signal: AbortSignal.timeout(2_000)
      }
    ).then((response) => response.json());
    if (session.phase !== phase) {
      phase = session.phase;
      process.stdout.write(`EXP-0026: ${phase}\n`);
    }
  }
  const health = await fetch(server.healthUrl).then((response) => response.json());
  process.stdout.write(`${JSON.stringify({
    status: phase,
    sessionId: server.health.evaluation.exp0026.sessionId,
    processRunId: health.process.runId,
    usage: health.usage,
    processWillTerminate: true,
    browserContextWillBeDisposed: true
  }, null, 2)}\n`);
} finally {
  await shutdown();
}
