import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assertExp0026TechnicalBundleBlind,
  createExp0026TechnicalBundle,
  joinExp0026HumanAfterTechnicalSeal,
  sealExp0026TechnicalCoding
} from "../src/eval/exp-0026-blind-analysis.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const command = process.argv[2];
const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await rename(temporary, path);
}

async function loadSessions(sessionsRoot, role, expectedCount) {
  const sessions = [];
  for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = resolve(sessionsRoot, entry.name);
    const session = JSON.parse(await readFile(
      resolve(root, "session.private.json"),
      "utf8"
    ));
    if (
      session.role !== role ||
      session.phase !== "COMPLETE" ||
      !session.top2SealedAt
    ) continue;
    const traces = new Map();
    for (const annotation of session.annotations) {
      if (!annotation.traceArtifact) continue;
      const artifact = JSON.parse(await readFile(
        resolve(root, annotation.traceArtifact.path),
        "utf8"
      ));
      traces.set(annotation.blockId, artifact.snapshot);
    }
    sessions.push({ root, session, traces });
  }
  sessions.sort((left, right) =>
    left.session.createdAt.localeCompare(right.session.createdAt)
  );
  if (role === "dry-run" && sessions.length > expectedCount) {
    return sessions.slice(-expectedCount);
  }
  assert.equal(
    sessions.length,
    expectedCount,
    `esperadas ${expectedCount} sessões ${role}, encontradas ${sessions.length}`
  );
  return sessions;
}

function paths(analysisRoot) {
  return {
    state: resolve(analysisRoot, "analysis-state.private.json"),
    bundle: resolve(analysisRoot, "technical-bundle.for-coder.json"),
    mapping: resolve(analysisRoot, "human-sealed", "mapping.private.json"),
    coding: resolve(analysisRoot, "technical-coding.sealed.json"),
    seal: resolve(analysisRoot, "technical-coding-seal.json"),
    join: resolve(analysisRoot, "human-sealed", "human-technical-join.private.json")
  };
}

async function prepare({ sessionsRoot, analysisRoot, role, expectedCount }) {
  const file = paths(analysisRoot);
  await readFile(file.state).then(
    () => { throw new Error("análise já foi preparada; não sobrescrever"); },
    (error) => {
      if (error.code !== "ENOENT") throw error;
    }
  );
  const inputs = await loadSessions(sessionsRoot, role, expectedCount);
  const created = createExp0026TechnicalBundle(inputs, {
    salt: randomBytes(32).toString("hex"),
    analysisMode: role === "external" ? "external-six" : "excluded-dry-run",
    createdAt: new Date().toISOString()
  });
  await atomicJson(file.bundle, created.bundle);
  await atomicJson(file.mapping, created.privateMapping);
  await atomicJson(file.state, {
    schemaVersion: "exp-0026-blind-analysis-state-v1",
    phase: "TECHNICAL_BUNDLE_SEALED",
    bundleSha256: created.bundle.bundleSha256,
    codingSha256: null,
    technicalSealSha256: null,
    humanDataOpenedAt: null,
    role,
    expectedCount
  });
  return { file, inputs, bundle: created.bundle };
}

async function seal({ analysisRoot, codingPath }) {
  const file = paths(analysisRoot);
  const [state, bundle, coding] = await Promise.all([
    readFile(file.state, "utf8").then(JSON.parse),
    readFile(file.bundle, "utf8").then(JSON.parse),
    readFile(codingPath, "utf8").then(JSON.parse)
  ]);
  assert.equal(state.phase, "TECHNICAL_BUNDLE_SEALED");
  assert.equal(state.humanDataOpenedAt, null);
  const sealed = sealExp0026TechnicalCoding(bundle, coding);
  await atomicJson(file.coding, sealed.coding);
  await atomicJson(file.seal, sealed.seal);
  await atomicJson(file.state, {
    ...state,
    phase: "TECHNICAL_CODING_SEALED",
    codingSha256: sealed.coding.codingSha256,
    technicalSealSha256: sealed.seal.sealSha256
  });
  return { file, bundle, ...sealed };
}

async function openHuman({ sessionsRoot, analysisRoot }) {
  const file = paths(analysisRoot);
  const state = JSON.parse(await readFile(file.state, "utf8"));
  if (state.phase !== "TECHNICAL_CODING_SEALED") {
    throw new Error(
      "abertura humana bloqueada: codificação técnica ainda não foi selada"
    );
  }
  const [bundle, mapping, coding, technicalSeal] = await Promise.all([
    readFile(file.bundle, "utf8").then(JSON.parse),
    readFile(file.mapping, "utf8").then(JSON.parse),
    readFile(file.coding, "utf8").then(JSON.parse),
    readFile(file.seal, "utf8").then(JSON.parse)
  ]);
  const loaded = await loadSessions(
    sessionsRoot,
    state.role,
    state.expectedCount
  );
  const joined = joinExp0026HumanAfterTechnicalSeal(
    bundle,
    mapping,
    coding,
    technicalSeal,
    loaded.map((item) => item.session)
  );
  await atomicJson(file.join, joined);
  await atomicJson(file.state, {
    ...state,
    phase: "HUMAN_OPENED",
    humanDataOpenedAt: joined.openedAt,
    joinSha256: joined.joinSha256
  });
  return { file, joined };
}

async function smoke() {
  const sessionsRoot = resolve(
    projectRoot,
    "eval/generated/exp-0026/dry-run/sessions"
  );
  const analysisRoot = resolve(
    projectRoot,
    "eval/generated/exp-0026/dry-run/blind-order-smoke"
  );
  const reportPath = resolve(
    projectRoot,
    "eval/reports/exp-0026-blind-order-smoke-v0.1.json"
  );
  await rm(analysisRoot, { recursive: true, force: true });
  const prepared = await prepare({
    sessionsRoot,
    analysisRoot,
    role: "dry-run",
    expectedCount: 1
  });
  assertExp0026TechnicalBundleBlind(prepared.bundle);
  const serialized = JSON.stringify(prepared.bundle);
  for (const forbidden of [
    "participantAlias",
    "participantHash",
    '"annotations"',
    '"top2"',
    '"severity"'
  ]) {
    assert.equal(serialized.includes(forbidden), false, `bundle expôs ${forbidden}`);
  }
  let blockedBeforeSeal = false;
  try {
    await openHuman({ sessionsRoot, analysisRoot });
  } catch (error) {
    blockedBeforeSeal = /ainda não foi selada/iu.test(error.message);
  }
  assert.equal(blockedBeforeSeal, true);
  const codingPath = resolve(analysisRoot, "technical-coding.smoke-input.json");
  const records = prepared.bundle.sessions.flatMap((session) =>
    session.blocks.map((block) => ({
      technicalSessionId: session.technicalSessionId,
      blockId: block.blockId,
      status: block.evidenceStatus === "AVAILABLE_CONSENTED"
        ? "NO_OBSERVED_VIOLATION"
        : "INSUFFICIENT_EVIDENCE",
      primaryStage: null,
      signature: "",
      confidence: 3,
      reproduction: block.evidenceStatus === "AVAILABLE_CONSENTED"
        ? "NOT_ATTEMPTED"
        : "NOT_REPLAYABLE"
    }))
  );
  await atomicJson(codingPath, {
    schemaVersion: "exp-0026-technical-coding-v1",
    bundleSha256: prepared.bundle.bundleSha256,
    coderId: "excluded-smoke-coder",
    records
  });
  const sealed = await seal({ analysisRoot, codingPath });
  const opened = await openHuman({ sessionsRoot, analysisRoot });
  assert.equal(opened.joined.rows.length, 1);
  assert.ok(Array.isArray(opened.joined.rows[0].top2));
  const report = {
    schemaVersion: "exp-0026-blind-order-smoke-v1",
    experimentId: "EXP-0026",
    analysisEligibility: "excluded-technical-smoke",
    fitEligibility: "evaluation-only",
    completedAt: new Date().toISOString(),
    bundleSha256: prepared.bundle.bundleSha256,
    codingSha256: sealed.coding.codingSha256,
    technicalSealSha256: sealed.seal.sealSha256,
    joinSha256: opened.joined.joinSha256,
    gates: {
      humanFieldsAbsentFromTechnicalBundle: true,
      openBlockedBeforeTechnicalSeal: blockedBeforeSeal,
      technicalCodingCoveredEveryBlock:
        records.length === prepared.bundle.sessions[0].blocks.length,
      hashesVerifiedBeforeJoin: true,
      humanDataOpenedOnlyAfterSeal: true
    }
  };
  report.pass = Object.values(report.gates).every(Boolean);
  assert.equal(report.pass, true);
  await atomicJson(reportPath, report);
  return report;
}

if (command === "smoke") {
  const report = await smoke();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const sessionsRoot = resolve(
    projectRoot,
    argument("--sessions-root", "eval/generated/exp-0026/private/sessions")
  );
  const analysisRoot = resolve(
    projectRoot,
    argument("--analysis-root", "eval/generated/exp-0026/private/analysis")
  );
  if (command === "prepare") {
    const result = await prepare({
      sessionsRoot,
      analysisRoot,
      role: "external",
      expectedCount: 6
    });
    process.stdout.write(`${JSON.stringify({
      phase: "TECHNICAL_BUNDLE_SEALED",
      bundlePath: result.file.bundle,
      bundleSha256: result.bundle.bundleSha256,
      warning: "entregue somente technical-bundle.for-coder.json ao codificador"
    }, null, 2)}\n`);
  } else if (command === "seal") {
    const codingPath = argument("--coding");
    if (!codingPath) throw new Error("--coding é obrigatório");
    const result = await seal({
      analysisRoot,
      codingPath: resolve(projectRoot, codingPath)
    });
    process.stdout.write(`${JSON.stringify({
      phase: "TECHNICAL_CODING_SEALED",
      codingSha256: result.coding.codingSha256,
      technicalSealSha256: result.seal.sealSha256
    }, null, 2)}\n`);
  } else if (command === "open") {
    const result = await openHuman({ sessionsRoot, analysisRoot });
    process.stdout.write(`${JSON.stringify({
      phase: "HUMAN_OPENED",
      joinPath: result.file.join,
      joinSha256: result.joined.joinSha256
    }, null, 2)}\n`);
  } else {
    throw new Error("uso: exp-0026-blind-analysis.mjs prepare|seal|open|smoke");
  }
}
