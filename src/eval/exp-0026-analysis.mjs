import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import {
  EXP0026_SIGNATURE_VOCABULARY,
  EXP0026_SIGNATURE_VOCABULARY_SHA256
} from "./exp-0026-blind-analysis.mjs";

const MATERIAL_NONE = "NENHUM_PROBLEMA_MATERIAL";
const FAMILIES = new Map(
  EXP0026_SIGNATURE_VOCABULARY.categories.map((item) => [item.id, item])
);
const SIGNATURES = new Map(
  EXP0026_SIGNATURE_VOCABULARY.signatures.map((item) => [item.id, item])
);

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha(value) {
  return `sha256:${canonicalSha256(value)}`;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function verifyJoin(join) {
  invariant(
    join?.schemaVersion === "exp-0026-human-technical-join-v1",
    "join EXP-0026 inválido"
  );
  invariant(
    join.signatureVocabularySha256 === EXP0026_SIGNATURE_VOCABULARY_SHA256,
    "join aponta para outro vocabulário"
  );
  const core = structuredClone(join);
  delete core.joinSha256;
  invariant(sha(core) === join.joinSha256, "hash do join divergiu");
  invariant(Array.isArray(join.rows) && join.rows.length === 6, "análise exige exatamente seis sessões");
  invariant(
    new Set(join.rows.map((row) => row.sessionId)).size === 6,
    "sessões da análise precisam ser únicas"
  );
  invariant(
    new Set(join.rows.map((row) => row.technicalSessionId)).size === 6,
    "IDs técnicos da análise precisam ser únicos"
  );
  for (const row of join.rows) {
    invariant(row.role === "external", `${row.sessionId} não é sessão externa`);
    invariant(row.analysisEligibility === "candidate", `${row.sessionId} não é elegível`);
    invariant(Array.isArray(row.annotations) && row.annotations.length === 7, `${row.sessionId} não tem sete blocos`);
    invariant(Array.isArray(row.top2) && row.top2.length <= 2, `${row.sessionId} tem top-2 inválido`);
    invariant(new Set(row.top2).size === row.top2.length, `${row.sessionId} repete top-2`);
    invariant(
      row.top2.every((category) => FAMILIES.has(category)),
      `${row.sessionId} tem família desconhecida no top-2`
    );
    const blockIds = new Set(row.annotations.map((item) => item.blockId));
    invariant(blockIds.size === 7, `${row.sessionId} repete bloco humano`);
    invariant(Array.isArray(row.technicalCoding), `${row.sessionId} não tem coding técnico`);
    invariant(
      row.technicalCoding.length === 7 &&
        new Set(row.technicalCoding.map((item) => item.blockId)).size === 7,
      `${row.sessionId} não tem coding técnico completo`
    );
    for (const annotation of row.annotations) {
      invariant(
        annotation.category === MATERIAL_NONE || FAMILIES.has(annotation.category),
        `${row.sessionId}:${annotation.blockId} tem categoria desconhecida`
      );
      invariant(
        Number.isSafeInteger(annotation.severity) &&
          annotation.severity >= 0 && annotation.severity <= 4,
        `${row.sessionId}:${annotation.blockId} tem severidade inválida`
      );
    }
    for (const record of row.technicalCoding) {
      if (record.status === "INCIDENT") {
        const frozen = SIGNATURES.get(record.signatureId);
        invariant(
          frozen && frozen.stage === record.primaryStage,
          `${row.sessionId}:${record.blockId} tem assinatura técnica não congelada`
        );
      }
    }
  }
}

function reproductionForFamily(rows, familyId) {
  const incidents = [];
  for (const row of rows) {
    const codingByBlock = new Map(
      row.technicalCoding.map((record) => [record.blockId, record])
    );
    for (const annotation of row.annotations) {
      if (annotation.category !== familyId || annotation.severity === 0) continue;
      const record = codingByBlock.get(annotation.blockId);
      if (
        record?.status !== "INCIDENT" ||
        record.primaryStage === "UNATTRIBUTED" ||
        SIGNATURES.get(record.signatureId)?.rEligible === false
      ) continue;
      incidents.push({
        sessionId: row.sessionId,
        blockId: annotation.blockId,
        primaryStage: record.primaryStage,
        signatureId: record.signatureId,
        reproduction: record.reproduction
      });
    }
  }
  const groups = new Map();
  for (const incident of incidents) {
    const key = [
      incident.blockId,
      incident.primaryStage,
      incident.signatureId
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(incident);
    groups.set(key, group);
  }
  const independent = [...groups.entries()]
    .map(([key, group]) => ({
      key,
      participantCount: new Set(group.map((item) => item.sessionId)).size
    }))
    .filter((item) => item.participantCount >= 2)
    .sort((left, right) =>
      right.participantCount - left.participantCount ||
      left.key.localeCompare(right.key)
    );
  if (independent.length > 0) {
    return {
      R: true,
      strength: 2,
      basis: "TWO_INDEPENDENT_PARTICIPANTS",
      evidenceKey: independent[0].key,
      participantCount: independent[0].participantCount
    };
  }
  const replay = incidents
    .filter((item) => item.reproduction === "REPRODUCED_2_OF_2")
    .sort((left, right) =>
      [left.blockId, left.primaryStage, left.signatureId].join("|")
        .localeCompare([right.blockId, right.primaryStage, right.signatureId].join("|"))
    )[0];
  if (replay) {
    return {
      R: true,
      strength: 1,
      basis: "REPLAY_2_OF_2",
      evidenceKey: [replay.blockId, replay.primaryStage, replay.signatureId].join("|"),
      participantCount: 1
    };
  }
  return {
    R: false,
    strength: 0,
    basis: "NOT_REPRODUCED",
    evidenceKey: null,
    participantCount: 0
  };
}

function compareFamilies(left, right) {
  return Number(right.dominantEligible) - Number(left.dominantEligible) ||
    right.P - left.P ||
    right.Q - left.Q ||
    (right.S ?? -1) - (left.S ?? -1) ||
    right.reproduction.strength - left.reproduction.strength ||
    left.tieBreakPriority - right.tieBreakPriority ||
    left.familyId.localeCompare(right.familyId);
}

export function analyzeExp0026HumanTechnicalJoin(join, options = {}) {
  verifyJoin(join);
  const families = [];
  for (const family of FAMILIES.values()) {
    const selectedRows = join.rows.filter((row) => row.top2.includes(family.id));
    const maximumSeverities = selectedRows.map((row) => Math.max(
      ...row.annotations
        .filter((item) => item.category === family.id)
        .map((item) => item.severity)
    ));
    invariant(
      maximumSeverities.every(Number.isFinite),
      `${family.id} aparece no top-2 sem anotação correspondente`
    );
    const reproduction = reproductionForFamily(join.rows, family.id);
    const P = selectedRows.length;
    const Q = maximumSeverities.filter((value) => value >= 3).length;
    const S = median(maximumSeverities);
    families.push({
      familyId: family.id,
      P,
      Q,
      S,
      R: reproduction.R,
      dominantEligible: P >= 4 && S >= 2 && reproduction.R,
      reproduction,
      tieBreakPriority: family.tieBreakPriority,
      tieBreakRationale: family.rationale
    });
  }
  families.sort(compareFamilies);
  const eligible = families.find((item) => item.dominantEligible) ?? null;
  const recurrentMaterial = families.find((item) =>
    item.P >= 4 && item.S >= 2
  ) ?? null;
  const decision = eligible
    ? {
        code: "DOMINANT_BOTTLENECK",
        familyId: eligible.familyId,
        nextExperimentScope: "CAUSAL_EXPERIMENT_FOR_ATTRIBUTED_STAGE"
      }
    : recurrentMaterial
      ? {
          code: "REPRODUCTION_OR_ATTRIBUTION_ONLY",
          familyId: recurrentMaterial.familyId,
          nextExperimentScope: "REPRODUCE_OR_ATTRIBUTE_WITHOUT_OPTIMIZATION"
        }
      : {
          code: "NO_DOMINANT_BOTTLENECK",
          familyId: null,
          nextExperimentScope: "NONE_OR_ONE_DISCRIMINANT_REPLICATION"
        };
  const core = {
    schemaVersion: "exp-0026-deterministic-analysis-v1",
    experimentId: "EXP-0026",
    analysisMode: "participant-session-n6",
    participantCount: join.rows.length,
    joinSha256: join.joinSha256,
    signatureVocabularySha256: EXP0026_SIGNATURE_VOCABULARY_SHA256,
    analyzedAt: options.analyzedAt ?? new Date().toISOString(),
    medianConvention: "SORTED_MIDDLE_OR_ARITHMETIC_MEAN_OF_TWO_MIDDLE_VALUES",
    rankingConvention: "ELIGIBLE_P_Q_S_REPRODUCTION_STRENGTH_FROZEN_COST_PRIORITY_ID",
    families,
    topThree: families.slice(0, 3).map((item) => item.familyId),
    decision
  };
  return { ...core, analysisSha256: sha(core) };
}

export function validateExp0026DeterministicAnalysis(value) {
  try {
    const core = structuredClone(value);
    delete core.analysisSha256;
    return value?.schemaVersion === "exp-0026-deterministic-analysis-v1" &&
      value.participantCount === 6 &&
      value.signatureVocabularySha256 === EXP0026_SIGNATURE_VOCABULARY_SHA256 &&
      Array.isArray(value.families) && value.families.length === FAMILIES.size &&
      sha(core) === value.analysisSha256;
  } catch {
    return false;
  }
}
