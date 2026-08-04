import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0026_TECHNICAL_STAGES = Object.freeze([
  "AUDIO",
  "ASR_PARTIAL",
  "ASR_FINAL",
  "ENDPOINT",
  "BRAIN",
  "TTS",
  "INTERRUPTION",
  "TASK",
  "MULTI_STAGE",
  "UNATTRIBUTED"
]);

const CODING_STATUSES = new Set([
  "NO_OBSERVED_VIOLATION",
  "INCIDENT",
  "INSUFFICIENT_EVIDENCE"
]);
const REPRODUCTION_STATUSES = new Set([
  "NOT_ATTEMPTED",
  "REPRODUCED_2_OF_2",
  "NOT_REPRODUCED_0_OF_2",
  "INCONCLUSIVE_1_OF_2",
  "NOT_REPLAYABLE"
]);
const FORBIDDEN_KEYS = new Set([
  "annotations",
  "category",
  "comment",
  "participantAlias",
  "participantHash",
  "severity",
  "top2",
  "top2SealedAt"
]);

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha(value) {
  return `sha256:${canonicalSha256(value)}`;
}

function walkForbidden(value, path = "$") {
  if (value === null || typeof value !== "object") return [];
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...walkForbidden(item, `${path}[${index}]`));
    });
    return errors;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`${path}.${key}`);
    errors.push(...walkForbidden(child, `${path}.${key}`));
  }
  return errors;
}

export function assertExp0026TechnicalBundleBlind(bundle) {
  const forbidden = walkForbidden(bundle);
  invariant(
    forbidden.length === 0,
    `bundle técnico contém campos humanos: ${forbidden.join(", ")}`
  );
  return true;
}

export function createExp0026TechnicalBundle(inputs, options = {}) {
  invariant(Array.isArray(inputs) && inputs.length > 0, "sessões técnicas ausentes");
  const salt = String(options.salt ?? "");
  invariant(salt.length >= 16, "salt técnico precisa ter pelo menos 16 caracteres");
  const technicalSessions = [];
  const privateMapping = [];
  for (const input of inputs) {
    invariant(input.session?.phase === "COMPLETE", "sessão não concluída");
    invariant(input.session?.top2SealedAt, "top-2 humano não está selado");
    const technicalSessionId = `T-${canonicalSha256({
      salt,
      sessionId: input.session.sessionId
    }).slice(0, 16)}`;
    privateMapping.push({
      technicalSessionId,
      sessionId: input.session.sessionId
    });
    const blocks = input.session.blockOrder.map((blockId) => {
      const trace = input.traces?.get(blockId) ?? null;
      return trace === null
        ? {
            blockId,
            evidenceStatus: "NOT_AVAILABLE_NO_CONSENT",
            trace: null
          }
        : {
            blockId,
            evidenceStatus: "AVAILABLE_CONSENTED",
            trace
          };
    });
    technicalSessions.push({ technicalSessionId, blocks });
  }
  const core = {
    schemaVersion: "exp-0026-technical-bundle-v1",
    experimentId: "EXP-0026",
    analysisMode: options.analysisMode ?? "external-six",
    fitEligibility: "evaluation-only",
    humanFormAccess: "SEALED_NOT_EXPOSED",
    createdAt: options.createdAt ?? new Date().toISOString(),
    sessions: technicalSessions
  };
  const bundle = {
    ...core,
    bundleSha256: sha(core)
  };
  assertExp0026TechnicalBundleBlind(bundle);
  return {
    bundle,
    privateMapping: {
      schemaVersion: "exp-0026-technical-private-mapping-v1",
      bundleSha256: bundle.bundleSha256,
      mapping: privateMapping
    }
  };
}

function expectedCodingKeys(bundle) {
  return bundle.sessions.flatMap((session) => session.blocks.map((block) =>
    `${session.technicalSessionId}:${block.blockId}`
  ));
}

export function sealExp0026TechnicalCoding(bundle, coding, options = {}) {
  assertExp0026TechnicalBundleBlind(bundle);
  invariant(coding?.schemaVersion === "exp-0026-technical-coding-v1", "schema de coding inválido");
  invariant(coding.bundleSha256 === bundle.bundleSha256, "coding aponta para outro bundle");
  invariant(Array.isArray(coding.records), "records técnicos ausentes");
  const expected = expectedCodingKeys(bundle).sort();
  const observed = [];
  for (const record of coding.records) {
    const key = `${record.technicalSessionId}:${record.blockId}`;
    observed.push(key);
    invariant(CODING_STATUSES.has(record.status), `${key} tem status inválido`);
    invariant(
      record.primaryStage === null ||
        EXP0026_TECHNICAL_STAGES.includes(record.primaryStage),
      `${key} tem estágio inválido`
    );
    invariant(
      record.status === "INCIDENT" ? record.primaryStage !== null : true,
      `${key} incidente precisa de estágio`
    );
    invariant(
      typeof record.signature === "string" && record.signature.length <= 300,
      `${key} tem assinatura inválida`
    );
    invariant(
      Number.isSafeInteger(record.confidence) &&
        record.confidence >= 1 &&
        record.confidence <= 5,
      `${key} tem confiança inválida`
    );
    invariant(
      REPRODUCTION_STATUSES.has(record.reproduction),
      `${key} tem reprodução inválida`
    );
  }
  invariant(new Set(observed).size === observed.length, "coding contém duplicatas");
  invariant(JSON.stringify(observed.sort()) === JSON.stringify(expected), "coding não cobre exatamente o bundle");
  const codingCore = {
    schemaVersion: coding.schemaVersion,
    bundleSha256: coding.bundleSha256,
    coderId: String(coding.coderId ?? "").trim(),
    records: coding.records
  };
  invariant(codingCore.coderId.length > 0, "coderId opaco é obrigatório");
  const normalizedCoding = {
    ...codingCore,
    codingSha256: sha(codingCore)
  };
  const sealCore = {
    schemaVersion: "exp-0026-technical-coding-seal-v1",
    experimentId: "EXP-0026",
    bundleSha256: bundle.bundleSha256,
    codingSha256: normalizedCoding.codingSha256,
    sealedAt: options.sealedAt ?? new Date().toISOString(),
    humanAggregateOpened: false
  };
  return {
    coding: normalizedCoding,
    seal: { ...sealCore, sealSha256: sha(sealCore) }
  };
}

export function joinExp0026HumanAfterTechnicalSeal(
  bundle,
  mapping,
  coding,
  seal,
  sessions,
  options = {}
) {
  invariant(seal?.humanAggregateOpened === false, "selo técnico inválido");
  invariant(seal.bundleSha256 === bundle.bundleSha256, "selo aponta para outro bundle");
  invariant(seal.codingSha256 === coding.codingSha256, "coding diverge do selo");
  const codingCore = {
    schemaVersion: coding.schemaVersion,
    bundleSha256: coding.bundleSha256,
    coderId: coding.coderId,
    records: coding.records
  };
  invariant(sha(codingCore) === coding.codingSha256, "hash do coding divergiu");
  const sealCore = {
    schemaVersion: seal.schemaVersion,
    experimentId: seal.experimentId,
    bundleSha256: seal.bundleSha256,
    codingSha256: seal.codingSha256,
    sealedAt: seal.sealedAt,
    humanAggregateOpened: false
  };
  invariant(sha(sealCore) === seal.sealSha256, "hash do selo divergiu");
  invariant(mapping.bundleSha256 === bundle.bundleSha256, "mapping divergiu");
  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
  const recordsByTechnical = new Map();
  for (const record of coding.records) {
    const list = recordsByTechnical.get(record.technicalSessionId) ?? [];
    list.push(record);
    recordsByTechnical.set(record.technicalSessionId, list);
  }
  const rows = mapping.mapping.map((item) => {
    const session = sessionsById.get(item.sessionId);
    invariant(session?.phase === "COMPLETE", "sessão humana ausente na abertura");
    return {
      technicalSessionId: item.technicalSessionId,
      sessionId: session.sessionId,
      role: session.role,
      analysisEligibility: session.analysisEligibility,
      annotations: session.annotations,
      top2: session.top2,
      technicalCoding: recordsByTechnical.get(item.technicalSessionId) ?? []
    };
  });
  const core = {
    schemaVersion: "exp-0026-human-technical-join-v1",
    experimentId: "EXP-0026",
    bundleSha256: bundle.bundleSha256,
    codingSha256: coding.codingSha256,
    technicalSealSha256: seal.sealSha256,
    openedAt: options.openedAt ?? new Date().toISOString(),
    rows
  };
  return { ...core, joinSha256: sha(core) };
}
