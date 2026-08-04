import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXP0026_PHASES,
  applyExp0026Consent,
  applyExp0026Preflight,
  completeExp0026Block,
  createExp0026Session,
  publicExp0026Session,
  sealExp0026Top2,
  startExp0026Block,
  validateExp0026Pack
} from "../src/eval/exp-0026-instrument.mjs";

const pack = JSON.parse(await readFile(new URL(
  "../eval/experiments/exp-0026-experience-pack.pt-BR.json",
  import.meta.url
), "utf8"));

function runtime(overrides = {}) {
  return {
    processRunId: "process-1",
    brain: "openai",
    interactionModel: "gpt-5.6-luna",
    taskModel: "gpt-5.6-luna",
    requests: 0,
    requestLimit: 25,
    activeKernelSessions: 0,
    asr: { state: "ready" },
    tts: { state: "ready" },
    ...overrides
  };
}

function session(options = {}) {
  return createExp0026Session(pack, {
    role: "dry-run",
    participantAlias: "DRY-001",
    orderIndex: 0,
    processRunId: "process-1",
    idFactory: () => "session-1",
    now: () => "2026-08-03T12:00:00.000Z",
    ...options
  });
}

function openCampaign(current, options = {}) {
  applyExp0026Consent(current, {
    participation: true,
    audio: options.audio ?? false,
    trace: options.trace ?? true,
    commercial: options.commercial ?? false
  });
  applyExp0026Preflight(current, {
    deviceMatch: true,
    roomMatch: true,
    noiseProbe: true,
    recordingDefaultsOff: true
  }, runtime());
  return current;
}

test("pack EXP-0026 tem quadrado latino, F0 fixo e ruído sem fala", () => {
  const validation = validateExp0026Pack(pack);
  assert.deepEqual(validation, { valid: true, errors: [] });
  const sceneIds = pack.scenes.map((scene) => scene.id);
  for (const sceneId of sceneIds) {
    const positions = pack.orders.map((order) => order.indexOf(sceneId));
    assert.deepEqual([...positions].sort(), [0, 1, 2, 3, 4, 5]);
  }
  assert.equal(pack.spontaneous.durationMs, 120_000);
  assert.equal(pack.noise.kind, "seeded-white-noise");
  assert.equal(pack.noise.speechPresent, false);
  assert.match(pack.noise.sha256, /^[a-f0-9]{64}$/u);
});

test("sessão pública não expõe alias, hash, comentários ou top-2", () => {
  const current = session();
  const publicSession = publicExp0026Session(current, pack, runtime());
  assert.equal(publicSession.sessionId, "exp0026-session-1");
  assert.equal(publicSession.role, "dry-run");
  assert.equal(publicSession.analysisEligibility, "excluded-dry-run");
  assert.equal("participantAlias" in publicSession, false);
  assert.equal("participantHash" in publicSession, false);
  assert.equal("top2" in publicSession, false);
});

test("preflight falha fechado se orçamento, modelo, health ou kernel vazarem", () => {
  for (const divergent of [
    { requests: 1 },
    { requestLimit: 24 },
    { interactionModel: "outro" },
    { activeKernelSessions: 1 },
    { asr: { state: "error" } },
    { tts: { state: "error" } }
  ]) {
    const current = session();
    applyExp0026Consent(current, { participation: true });
    assert.throws(() => applyExp0026Preflight(current, {
      deviceMatch: true,
      roomMatch: true,
      noiseProbe: true,
      recordingDefaultsOff: true
    }, runtime(divergent)));
    assert.equal(current.phase, EXP0026_PHASES.PREFLIGHT);
  }
});

test("consentimento comercial é recusado quando não está congelado", () => {
  assert.throws(() => applyExp0026Consent(session(), {
    participation: true,
    commercial: true
  }), /não está disponível/u);
  const enabled = session({ commercialAvailable: true });
  applyExp0026Consent(enabled, { participation: true, commercial: true });
  assert.equal(enabled.consent.commercial, true);
});

test("cenas seguem ordem e F0 não fecha antes de dois minutos", () => {
  const current = openCampaign(session());
  let clockMs = 1_000;
  for (const blockId of current.blockOrder) {
    startExp0026Block(current, blockId, {
      nowMs: () => clockMs,
      now: () => `t-${clockMs}`
    });
    if (blockId === "F0") {
      assert.throws(() => completeExp0026Block(current, {
        blockId,
        category: "NENHUM_PROBLEMA_MATERIAL",
        severity: 0,
        comment: null
      }, pack, { nowMs: () => clockMs + 119_999 }), /dois minutos/u);
      clockMs += 120_000;
    }
    completeExp0026Block(current, {
      blockId,
      category: blockId === "S2"
        ? "RITMO_E_TROCA_DE_TURNO"
        : "NENHUM_PROBLEMA_MATERIAL",
      severity: blockId === "S2" ? 2 : 0,
      comment: blockId === "S2" ? "Cortou minha pausa." : null
    }, pack, {
      nowMs: () => clockMs,
      now: () => `t-${clockMs}`
    });
    clockMs += 1_000;
  }
  assert.equal(current.phase, EXP0026_PHASES.TOP2);
  assert.equal(current.annotations.length, 7);
  assert.equal(current.annotations.at(-1).elapsedMs, 120_000);
});

test("top-2 aceita somente problemas vivenciados e sela uma vez", () => {
  const current = openCampaign(session());
  let clockMs = 1_000;
  for (const blockId of current.blockOrder) {
    startExp0026Block(current, blockId, { nowMs: () => clockMs });
    if (blockId === "F0") clockMs += 120_000;
    completeExp0026Block(current, {
      blockId,
      category: blockId === "S1"
        ? "QUALIDADE_DA_RESPOSTA"
        : "NENHUM_PROBLEMA_MATERIAL",
      severity: blockId === "S1" ? 3 : 0,
      comment: null
    }, pack, { nowMs: () => clockMs });
    clockMs += 1_000;
  }
  assert.throws(
    () => sealExp0026Top2(current, ["VOZ_E_ENTREGA"]),
    /não vivenciada/u
  );
  sealExp0026Top2(current, ["QUALIDADE_DA_RESPOSTA"]);
  assert.equal(current.phase, EXP0026_PHASES.COMPLETE);
  assert.deepEqual(current.top2, ["QUALIDADE_DA_RESPOSTA"]);
  assert.throws(() => sealExp0026Top2(current, []), /fora de ordem/u);
});
