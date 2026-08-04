import { createHash, randomUUID } from "node:crypto";

export const EXP0026_SCHEMA_VERSION = "exp-0026-session-v1";
export const EXP0026_PHASES = Object.freeze({
  CONSENT: "CONSENT",
  PREFLIGHT: "PREFLIGHT",
  CAMPAIGN: "CAMPAIGN",
  TOP2: "TOP2",
  COMMERCIAL: "COMMERCIAL",
  COMPLETE: "COMPLETE",
  WITHDRAWN: "WITHDRAWN"
});

const MATERIAL_NONE = "NENHUM_PROBLEMA_MATERIAL";
const ROLES = new Set(["dry-run", "external"]);

function invariant(condition, message) {
  if (!condition) {
    throw new TypeError(message);
  }
}

function plainObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function cleanText(value, maximum, field, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) {
    return null;
  }
  invariant(typeof value === "string", `${field} precisa ser texto`);
  const result = value.trim();
  invariant(result.length > 0, `${field} não pode ser vazio`);
  invariant(result.length <= maximum, `${field} excede ${maximum} caracteres`);
  return result;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function validateExp0026Pack(pack) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  check(plainObject(pack), "pack precisa ser objeto JSON");
  if (!plainObject(pack)) return { valid: false, errors };
  check(pack.schemaVersion === "exp-0026-experience-pack-v1", "schemaVersion inválida");
  check(pack.language === "pt-BR", "idioma precisa ser pt-BR");
  check(pack.fitEligibility === "evaluation-only", "fitEligibility precisa ser evaluation-only");
  check(Array.isArray(pack.scenes) && pack.scenes.length === 6, "pack precisa ter seis cenas");
  check(Array.isArray(pack.orders) && pack.orders.length === 6, "pack precisa ter seis ordens");
  check(Array.isArray(pack.categories) && pack.categories.length === 7, "categorias inválidas");
  const sceneIds = new Set((pack.scenes ?? []).map((scene) => scene.id));
  check(sceneIds.size === 6, "IDs de cena precisam ser únicos");
  for (const scene of pack.scenes ?? []) {
    check(Array.isArray(scene.variants) && scene.variants.length === 6, `${scene.id} precisa ter seis variantes`);
  }
  for (const order of pack.orders ?? []) {
    check(
      Array.isArray(order) &&
        order.length === 6 &&
        new Set(order).size === 6 &&
        order.every((id) => sceneIds.has(id)),
      "ordem inválida"
    );
  }
  check(pack.spontaneous?.id === "F0", "bloco espontâneo F0 ausente");
  check(pack.spontaneous?.durationMs === 120_000, "F0 precisa durar dois minutos");
  check(pack.noise?.kind === "seeded-white-noise", "ruído precisa ser branco seeded");
  check(pack.noise?.speechPresent === false, "S5 não pode conter fala concorrente");
  return { valid: errors.length === 0, errors };
}

export function createExp0026Session(pack, options = {}) {
  const validation = validateExp0026Pack(pack);
  invariant(validation.valid, `pack inválido: ${validation.errors.join("; ")}`);
  const role = cleanText(options.role, 20, "role");
  invariant(ROLES.has(role), "role precisa ser dry-run ou external");
  const participantAlias = cleanText(options.participantAlias, 64, "participantAlias");
  invariant(/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/u.test(participantAlias), "participantAlias precisa ser opaco e seguro");
  const orderIndex = Number(options.orderIndex);
  invariant(Number.isSafeInteger(orderIndex) && orderIndex >= 0 && orderIndex < 6, "orderIndex precisa estar entre 0 e 5");
  const processRunId = cleanText(options.processRunId, 100, "processRunId");
  invariant(
    typeof options.withdrawalReceiptHash === "string" &&
      /^[a-f0-9]{64}$/u.test(options.withdrawalReceiptHash),
    "withdrawalReceiptHash privado é obrigatório"
  );
  const rosterSlotId = options.rosterSlotId ?? null;
  invariant(
    role === "dry-run"
      ? rosterSlotId === null
      : /^SLOT-[1-6]$/u.test(rosterSlotId),
    "sessão externa exige rosterSlotId congelado"
  );
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const guided = pack.orders[orderIndex].map((sceneId) => {
    const scene = pack.scenes.find((candidate) => candidate.id === sceneId);
    return {
      id: scene.id,
      title: scene.title,
      capacity: scene.capacity,
      instruction: scene.variants[orderIndex]
    };
  });
  return {
    schemaVersion: EXP0026_SCHEMA_VERSION,
    sessionId: `exp0026-${idFactory()}`,
    participantHash: sha256Text(`exp0026:${participantAlias}`),
    participantAlias,
    withdrawalReceiptHash: options.withdrawalReceiptHash,
    role,
    rosterSlotId,
    analysisEligibility: role === "dry-run" ? "excluded-dry-run" : "candidate",
    fitEligibility: "evaluation-only",
    processRunId,
    orderIndex,
    packId: pack.packId,
    commercialAvailable: options.commercialAvailable === true,
    phase: EXP0026_PHASES.CONSENT,
    createdAt: now(),
    consent: null,
    preflight: null,
    blockOrder: [...guided.map((scene) => scene.id), "F0"],
    guided,
    spontaneous: { ...pack.spontaneous },
    blockCursor: 0,
    activeBlock: null,
    annotations: [],
    top2: null,
    top2SealedAt: null,
    commercial: [],
    audio: null,
    completedAt: null,
    withdrawnAt: null
  };
}

export function publicExp0026Session(session, pack, runtime = null) {
  const categories = pack.categories.map((category) => ({ ...category }));
  return {
    schemaVersion: "exp-0026-public-session-v1",
    sessionId: session.sessionId,
    role: session.role,
    analysisEligibility: session.analysisEligibility,
    fitEligibility: session.fitEligibility,
    phase: session.phase,
    orderIndex: session.orderIndex,
    blockOrder: [...session.blockOrder],
    guided: session.guided.map((scene) => ({ ...scene })),
    spontaneous: { ...session.spontaneous },
    categories,
    severity: pack.severity.map((item) => ({ ...item })),
    blockCursor: session.blockCursor,
    activeBlock: session.activeBlock === null ? null : { ...session.activeBlock },
    annotations: session.annotations.map(({ blockId, category, severity }) => ({
      blockId,
      category,
      severity
    })),
    top2Sealed: session.top2 !== null,
    recording: {
      audio: session.consent?.audio === true,
      trace: session.consent?.trace === true
    },
    commercialAvailable: session.commercialAvailable,
    commercialEnabled: session.consent?.commercial === true,
    runtime
  };
}

export function applyExp0026Consent(session, payload, options = {}) {
  invariant(session.phase === EXP0026_PHASES.CONSENT, "consentimento já foi fechado");
  invariant(plainObject(payload), "consentimento inválido");
  invariant(payload.participation === true, "consentimento de participação é obrigatório");
  invariant(
    payload.commercial !== true || session.commercialAvailable,
    "módulo comercial não está disponível neste freeze"
  );
  const now = options.now ?? (() => new Date().toISOString());
  session.consent = {
    participation: true,
    audio: payload.audio === true,
    trace: payload.trace === true,
    commercial: payload.commercial === true,
    acceptedAt: now()
  };
  session.phase = EXP0026_PHASES.PREFLIGHT;
  return session;
}

export function applyExp0026Preflight(session, payload, runtime, options = {}) {
  invariant(session.phase === EXP0026_PHASES.PREFLIGHT, "preflight fora de ordem");
  invariant(plainObject(payload) && plainObject(runtime), "preflight inválido");
  invariant(runtime.processRunId === session.processRunId, "processRunId divergiu");
  invariant(runtime.brain === "openai", "cérebro precisa ser openai");
  invariant(runtime.interactionModel === "gpt-5.6-luna", "modelo de interação divergiu");
  invariant(runtime.taskModel === "gpt-5.6-luna", "modelo de tarefa divergiu");
  invariant(runtime.requests === 0 && runtime.requestLimit === 25, "orçamento precisa iniciar em 0/25");
  invariant(runtime.activeKernelSessions === 0, "kernel precisa iniciar vazio");
  invariant(runtime.asr?.state === "ready", "ASR precisa estar pronto");
  invariant(runtime.tts?.state === "ready", "TTS precisa estar pronto");
  invariant(payload.deviceMatch === true, "dispositivos não foram confirmados");
  invariant(payload.roomMatch === true, "sala não foi confirmada");
  invariant(payload.noiseProbe === true, "probe de ruído não foi confirmado");
  invariant(payload.recordingDefaultsOff === true, "defaults de gravação não foram confirmados");
  const now = options.now ?? (() => new Date().toISOString());
  session.preflight = {
    ...payload,
    runtime: { ...runtime },
    passedAt: now()
  };
  session.phase = EXP0026_PHASES.CAMPAIGN;
  return session;
}

export function startExp0026Block(session, blockId, options = {}) {
  invariant(session.phase === EXP0026_PHASES.CAMPAIGN, "campanha não está aberta");
  invariant(session.activeBlock === null, "já existe bloco ativo");
  const expected = session.blockOrder[session.blockCursor];
  invariant(blockId === expected, `bloco fora de ordem: esperado ${expected}`);
  const nowMs = options.nowMs ?? Date.now;
  const now = options.now ?? (() => new Date().toISOString());
  session.activeBlock = {
    blockId,
    startedAt: now(),
    startedAtEpochMs: nowMs()
  };
  return session;
}

export function completeExp0026Block(session, payload, pack, options = {}) {
  invariant(session.phase === EXP0026_PHASES.CAMPAIGN, "campanha não está aberta");
  invariant(plainObject(payload), "anotação de bloco inválida");
  invariant(session.activeBlock?.blockId === payload.blockId, "bloco ativo divergiu");
  const categories = new Set(pack.categories.map((category) => category.id));
  invariant(categories.has(payload.category), "categoria inválida");
  const severity = Number(payload.severity);
  invariant(Number.isSafeInteger(severity) && severity >= 0 && severity <= 4, "severidade inválida");
  invariant(
    payload.category === MATERIAL_NONE ? severity === 0 : severity >= 1,
    "categoria e severidade são incompatíveis"
  );
  const nowMs = options.nowMs ?? Date.now;
  const completedAtEpochMs = nowMs();
  if (payload.blockId === "F0") {
    invariant(
      completedAtEpochMs - session.activeBlock.startedAtEpochMs >=
        pack.spontaneous.durationMs,
      "F0 ainda não completou dois minutos"
    );
  }
  const now = options.now ?? (() => new Date().toISOString());
  session.annotations.push({
    blockId: payload.blockId,
    category: payload.category,
    severity,
    comment: cleanText(payload.comment, 1_000, "comentário", { optional: true }),
    startedAt: session.activeBlock.startedAt,
    startedAtEpochMs: session.activeBlock.startedAtEpochMs,
    completedAt: now(),
    completedAtEpochMs,
    elapsedMs: completedAtEpochMs - session.activeBlock.startedAtEpochMs
  });
  session.activeBlock = null;
  session.blockCursor += 1;
  if (session.blockCursor === session.blockOrder.length) {
    session.phase = EXP0026_PHASES.TOP2;
  }
  return session;
}

export function sealExp0026Top2(session, selected, options = {}) {
  invariant(session.phase === EXP0026_PHASES.TOP2, "top-2 fora de ordem");
  invariant(Array.isArray(selected) && selected.length <= 2, "top-2 aceita zero, uma ou duas categorias");
  invariant(new Set(selected).size === selected.length, "top-2 não aceita duplicatas");
  const eligible = new Set(session.annotations
    .filter((annotation) => annotation.severity > 0)
    .map((annotation) => annotation.category));
  invariant(selected.every((category) => eligible.has(category)), "top-2 contém categoria não vivenciada");
  invariant(!selected.includes(MATERIAL_NONE), "nenhum problema não entra no top-2");
  const now = options.now ?? (() => new Date().toISOString());
  session.top2 = [...selected];
  session.top2SealedAt = now();
  session.phase = session.consent.commercial
    ? EXP0026_PHASES.COMMERCIAL
    : EXP0026_PHASES.COMPLETE;
  if (session.phase === EXP0026_PHASES.COMPLETE) session.completedAt = now();
  return session;
}

export function completeExp0026Commercial(session, anchors, options = {}) {
  invariant(session.phase === EXP0026_PHASES.COMMERCIAL, "módulo comercial fora de ordem");
  invariant(Array.isArray(anchors) && anchors.length === 3, "módulo comercial exige três âncoras");
  const scales = new Set(["NOSSO_MUITO_PIOR", "NOSSO_UM_POUCO_PIOR", "SEMELHANTE", "NOSSO_UM_POUCO_MELHOR", "NOSSO_MUITO_MELHOR"]);
  session.commercial = anchors.map((anchor, index) => {
    invariant(plainObject(anchor) && scales.has(anchor.rating), `âncora ${index + 1} inválida`);
    const confidence = Number(anchor.confidence);
    invariant(Number.isSafeInteger(confidence) && confidence >= 1 && confidence <= 5, `confiança ${index + 1} inválida`);
    return {
      anchorId: `C${index + 1}`,
      rating: anchor.rating,
      confidence,
      comment: cleanText(anchor.comment, 1_000, "comentário comercial", { optional: true })
    };
  });
  const now = options.now ?? (() => new Date().toISOString());
  session.completedAt = now();
  session.phase = EXP0026_PHASES.COMPLETE;
  return session;
}

export function withdrawExp0026Session(session, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  session.phase = EXP0026_PHASES.WITHDRAWN;
  session.withdrawnAt = now();
  return session;
}
