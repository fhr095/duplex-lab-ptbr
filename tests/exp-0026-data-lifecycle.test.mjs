import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  createExp0026WithdrawalCode,
  hashExp0026WithdrawalCode,
  purgeExp0026Retention,
  withdrawExp0026PersistedSession
} from "../src/eval/exp-0026-data-lifecycle.mjs";

async function exists(path) {
  return access(path).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

async function fixture(t) {
  const projectRoot = await mkdtemp(join(tmpdir(), "exp0026-lifecycle-"));
  const dataRoot = resolve(projectRoot, "eval/generated/exp-0026/private");
  await mkdir(resolve(dataRoot, "sessions"), { recursive: true });
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return { projectRoot, dataRoot };
}

async function writeSession(dataRoot, index, options = {}) {
  const code = options.code ?? createExp0026WithdrawalCode();
  const sessionId = `exp0026-lifecycle-${String(index).padStart(4, "0")}`;
  const root = resolve(dataRoot, "sessions", sessionId);
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, "session.private.json"), JSON.stringify({
    schemaVersion: "exp-0026-session-v1",
    sessionId,
    participantAlias: `SECRET-${index}`,
    participantHash: "c".repeat(64),
    withdrawalReceiptHash: hashExp0026WithdrawalCode(code),
    rosterSlotId: `SLOT-${index}`,
    phase: options.phase ?? "COMPLETE"
  }));
  await writeFile(resolve(root, "microphone.webm"), "private-audio");
  return { code, sessionId, root };
}

test("retirada posterior ao closeout apaga fonte, análise e relatório publicado", async (t) => {
  const { projectRoot, dataRoot } = await fixture(t);
  const target = await writeSession(dataRoot, 1);
  const reportPath = "eval/reports/exp-0026-human-closeout-v0.1.json";
  await mkdir(resolve(projectRoot, "eval/reports"), { recursive: true });
  await writeFile(resolve(projectRoot, reportPath), "derived-human-result\n");
  const analysisRoot = resolve(dataRoot, "analysis");
  await mkdir(analysisRoot, { recursive: true });
  await writeFile(resolve(analysisRoot, "analysis-state.private.json"), JSON.stringify({
    phase: "ANALYSIS_COMPLETE"
  }));
  await writeFile(resolve(analysisRoot, "technical-coding.sealed.json"), JSON.stringify({
    coderId: "CODER-EXPOSED"
  }));
  const sessionIds = [target.sessionId];
  for (let index = 2; index <= 6; index += 1) {
    sessionIds.push((await writeSession(dataRoot, index)).sessionId);
  }
  await writeFile(resolve(dataRoot, "closeout.private.json"), JSON.stringify({
    schemaVersion: "exp-0026-private-closeout-v1",
    experimentId: "EXP-0026",
    closedAt: "2026-08-03T12:00:00.000Z",
    sessionIds,
    analysisSha256: `sha256:${"a".repeat(64)}`,
    publishedArtifacts: [{
      path: reportPath,
      fileSha256: `sha256:${"b".repeat(64)}`
    }]
  }));
  const result = await withdrawExp0026PersistedSession({
    projectRoot,
    dataRoot,
    code: target.code,
    withdrawnAt: "2026-08-04T12:00:00.000Z"
  });
  assert.equal(result.status, "WITHDRAWN_AND_DELETED");
  assert.equal(result.freshCoderRequired, true);
  assert.equal(result.publicCloseoutInvalidationRequired, true);
  assert.equal(await exists(target.root), false);
  assert.equal(await exists(analysisRoot), false);
  assert.equal(await exists(resolve(dataRoot, "closeout.private.json")), false);
  assert.equal(await exists(resolve(projectRoot, reportPath)), false);
  const tombstone = JSON.parse(await readFile(resolve(
    dataRoot,
    "withdrawn-tombstones",
    `${target.sessionId}.json`
  ), "utf8"));
  assert.equal(tombstone.status, "WITHDRAWN_AND_DELETED");
  assert.equal(tombstone.rosterSlotId, "SLOT-1");
  assert.equal("participantAlias" in tombstone, false);
  assert.equal("participantHash" in tombstone, false);
  const invalidation = JSON.parse(await readFile(resolve(
    dataRoot,
    "analysis-invalidations",
    `${target.sessionId}.json`
  ), "utf8"));
  assert.equal(invalidation.invalidatedCoderId, "CODER-EXPOSED");
  assert.deepEqual(invalidation.invalidatedPublishedArtifacts, [reportPath]);
  const retry = await withdrawExp0026PersistedSession({
    projectRoot,
    dataRoot,
    code: target.code
  });
  assert.equal(retry.status, "ALREADY_WITHDRAWN");
  assert.equal(retry.idempotent, true);
});

test("retirada antes da abertura invalida o selo, mas não exige codificador novo", async (t) => {
  const { projectRoot, dataRoot } = await fixture(t);
  const target = await writeSession(dataRoot, 1);
  const analysisRoot = resolve(dataRoot, "analysis");
  await mkdir(analysisRoot, { recursive: true });
  await writeFile(resolve(analysisRoot, "analysis-state.private.json"), JSON.stringify({
    phase: "TECHNICAL_CODING_SEALED"
  }));
  await writeFile(resolve(analysisRoot, "technical-coding.sealed.json"), JSON.stringify({
    coderId: "CODER-BLIND"
  }));
  const result = await withdrawExp0026PersistedSession({
    projectRoot,
    dataRoot,
    code: target.code
  });
  assert.equal(result.invalidatedAnalysisPhase, "TECHNICAL_CODING_SEALED");
  assert.equal(result.freshCoderRequired, false);
  assert.equal(await exists(analysisRoot), false);
});

test("retenção bloqueia antes de 30 dias, permite preview e purga exatamente os alvos", async (t) => {
  const { dataRoot } = await fixture(t);
  const sessions = [];
  for (let index = 1; index <= 6; index += 1) {
    sessions.push(await writeSession(dataRoot, index));
  }
  await mkdir(resolve(dataRoot, "analysis"), { recursive: true });
  await writeFile(resolve(dataRoot, "analysis/result.json"), "private-analysis");
  const closeoutManifest = {
    schemaVersion: "exp-0026-private-closeout-v1",
    experimentId: "EXP-0026",
    closedAt: "2026-08-01T00:00:00.000Z",
    sessionIds: sessions.map((item) => item.sessionId),
    analysisSha256: `sha256:${"d".repeat(64)}`,
    publishedArtifacts: []
  };
  const early = await purgeExp0026Retention({
    dataRoot,
    closeoutManifest,
    asOf: "2026-08-30T23:59:59.000Z"
  });
  assert.equal(early.status, "BLOCKED_NOT_DUE");
  const preview = await purgeExp0026Retention({
    dataRoot,
    closeoutManifest,
    asOf: "2026-08-31T00:00:00.000Z"
  });
  assert.equal(preview.status, "READY_TO_PURGE");
  assert.equal(sessions.every((item) => item.root), true);
  const applied = await purgeExp0026Retention({
    dataRoot,
    closeoutManifest,
    asOf: "2026-08-31T00:00:00.000Z",
    apply: true
  });
  assert.equal(applied.status, "PURGED");
  assert.equal(applied.sessionsDeleted, 6);
  assert.equal(await exists(resolve(dataRoot, "analysis")), false);
  assert.equal((await Promise.all(sessions.map((item) => exists(item.root)))).some(Boolean), false);
  const retry = await purgeExp0026Retention({
    dataRoot,
    closeoutManifest,
    asOf: "2026-09-01T00:00:00.000Z",
    apply: true
  });
  assert.equal(retry.status, "ALREADY_PURGED");
});
