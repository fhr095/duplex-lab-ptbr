import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeExp0026HumanTechnicalJoin,
  validateExp0026DeterministicAnalysis
} from "../src/eval/exp-0026-analysis.mjs";
import {
  createExp0026TechnicalBundle,
  joinExp0026HumanAfterTechnicalSeal,
  sealExp0026TechnicalCoding
} from "../src/eval/exp-0026-blind-analysis.mjs";

const BLOCKS = ["S1", "S2", "S3", "S4", "S5", "S6", "F0"];
const NONE = "NENHUM_PROBLEMA_MATERIAL";
const RITMO = "RITMO_E_TROCA_DE_TURNO";
const ENTENDIMENTO = "ENTENDIMENTO_DO_QUE_EU_DISSE";

function buildJoin(rows) {
  const sessions = rows.map((row, index) => ({
    sessionId: `session-${index + 1}`,
    role: "external",
    analysisEligibility: "candidate",
    phase: "COMPLETE",
    top2SealedAt: "2026-08-04T12:00:00.000Z",
    top2: row.top2,
    blockOrder: BLOCKS,
    annotations: BLOCKS.map((blockId, blockIndex) => {
      const annotation = row.annotations?.[blockId];
      return {
        blockId,
        category: annotation?.category ?? NONE,
        severity: annotation?.severity ?? 0,
        comment: null,
        elapsedMs: 1_000 + blockIndex
      };
    })
  }));
  const created = createExp0026TechnicalBundle(
    sessions.map((session) => ({
      session,
      traces: new Map(BLOCKS.map((blockId) => [blockId, { trace: [] }]))
    })),
    {
      salt: "0123456789abcdef0123456789abcdef",
      analysisMode: "test",
      createdAt: "2026-08-04T12:30:00.000Z"
    }
  );
  const records = created.bundle.sessions.flatMap((technical, index) =>
    BLOCKS.map((blockId) => {
      const incident = rows[index].incidents?.[blockId];
      return incident
        ? {
            technicalSessionId: technical.technicalSessionId,
            blockId,
            status: "INCIDENT",
            primaryStage: incident.stage,
            signatureId: incident.signatureId,
            signature: incident.note ?? "violação objetiva",
            confidence: 4,
            reproduction: incident.reproduction ?? "NOT_ATTEMPTED"
          }
        : {
            technicalSessionId: technical.technicalSessionId,
            blockId,
            status: "NO_OBSERVED_VIOLATION",
            primaryStage: null,
            signatureId: "NONE",
            signature: "",
            confidence: 3,
            reproduction: "NOT_ATTEMPTED"
          };
    })
  );
  const sealed = sealExp0026TechnicalCoding(created.bundle, {
    schemaVersion: "exp-0026-technical-coding-v1",
    bundleSha256: created.bundle.bundleSha256,
    signatureVocabularySha256: created.bundle.signatureVocabularySha256,
    coderId: "blind-coder-1",
    records
  }, { sealedAt: "2026-08-04T13:00:00.000Z" });
  return joinExp0026HumanAfterTechnicalSeal(
    created.bundle,
    created.privateMapping,
    sealed.coding,
    sealed.seal,
    sessions,
    { openedAt: "2026-08-04T14:00:00.000Z" }
  );
}

function row(family = null, severity = 0, options = {}) {
  return {
    top2: family ? [family] : [],
    annotations: family
      ? { S1: { category: family, severity } }
      : {},
    incidents: options.incident
      ? {
          S1: {
            stage: options.stage ?? "ENDPOINT",
            signatureId:
              options.signatureId ?? "ENDPOINT_PREMATURE_COMMIT",
            reproduction: options.reproduction ?? "NOT_ATTEMPTED"
          }
        }
      : {}
  };
}

test("3/6 nunca vira dominante mesmo com severidade e reprodução", () => {
  const join = buildJoin([
    row(RITMO, 4, { incident: true }),
    row(RITMO, 3, { incident: true }),
    row(RITMO, 3),
    row(), row(), row()
  ]);
  const result = analyzeExp0026HumanTechnicalJoin(join, {
    analyzedAt: "2026-08-04T15:00:00.000Z"
  });
  const ritmo = result.families.find((item) => item.familyId === RITMO);
  assert.deepEqual({ P: ritmo.P, Q: ritmo.Q, S: ritmo.S, R: ritmo.R }, {
    P: 3, Q: 3, S: 3, R: true
  });
  assert.equal(result.decision.code, "NO_DOMINANT_BOTTLENECK");
  assert.equal(validateExp0026DeterministicAnalysis(result), true);
});

test("4/6 sem severidade material não fabrica dominante", () => {
  const join = buildJoin([
    row(RITMO, 1, { incident: true }),
    row(RITMO, 1, { incident: true }),
    row(RITMO, 1), row(RITMO, 2), row(), row()
  ]);
  const result = analyzeExp0026HumanTechnicalJoin(join);
  assert.equal(result.families[0].P, 4);
  assert.equal(result.families[0].S, 1);
  assert.equal(result.decision.code, "NO_DOMINANT_BOTTLENECK");
});

test("4/6 material sem R autoriza somente reprodução ou atribuição", () => {
  const join = buildJoin([
    row(RITMO, 2), row(RITMO, 2), row(RITMO, 3), row(RITMO, 4), row(), row()
  ]);
  const result = analyzeExp0026HumanTechnicalJoin(join);
  assert.equal(result.decision.code, "REPRODUCTION_OR_ATTRIBUTION_ONLY");
  assert.equal(result.decision.familyId, RITMO);
  assert.equal(result.families[0].S, 2.5);
});

test("mesma assinatura em duas pessoas satisfaz R e elege dominante", () => {
  const join = buildJoin([
    row(RITMO, 2, { incident: true }),
    row(RITMO, 3, { incident: true }),
    row(RITMO, 3), row(RITMO, 4), row(), row()
  ]);
  const result = analyzeExp0026HumanTechnicalJoin(join);
  assert.equal(result.decision.code, "DOMINANT_BOTTLENECK");
  assert.equal(result.decision.familyId, RITMO);
  assert.equal(result.families[0].reproduction.basis, "TWO_INDEPENDENT_PARTICIPANTS");
  assert.equal(result.families[0].reproduction.strength, 2);
});

test("replay 2/2 satisfaz R com força menor e desempate permanece congelado", () => {
  const rows = [0, 1, 2, 3, 4, 5].map((index) => ({
    top2: index < 4 ? [RITMO, ENTENDIMENTO] : [],
    annotations: index < 4 ? {
      S1: { category: RITMO, severity: 2 },
      S2: { category: ENTENDIMENTO, severity: 2 }
    } : {},
    incidents: index === 0 ? {
      S1: {
        stage: "ENDPOINT",
        signatureId: "ENDPOINT_PREMATURE_COMMIT",
        reproduction: "REPRODUCED_2_OF_2"
      },
      S2: {
        stage: "ASR_FINAL",
        signatureId: "ASR_FINAL_OMISSION",
        reproduction: "REPRODUCED_2_OF_2"
      }
    } : {}
  }));
  const result = analyzeExp0026HumanTechnicalJoin(buildJoin(rows));
  assert.equal(result.families[0].familyId, RITMO);
  assert.equal(result.families[1].familyId, ENTENDIMENTO);
  assert.equal(result.families[0].reproduction.basis, "REPLAY_2_OF_2");
});

test("signatureId novo ou incompatível é recusado antes do selo", () => {
  const session = {
    sessionId: "unknown-signature",
    role: "external",
    analysisEligibility: "candidate",
    phase: "COMPLETE",
    top2SealedAt: "2026-08-04T12:00:00.000Z",
    top2: [RITMO],
    blockOrder: ["S1"],
    annotations: [{ blockId: "S1", category: RITMO, severity: 2 }]
  };
  const created = createExp0026TechnicalBundle([{
    session,
    traces: new Map([["S1", { trace: [] }]])
  }], { salt: "0123456789abcdef" });
  assert.throws(() => sealExp0026TechnicalCoding(created.bundle, {
    schemaVersion: "exp-0026-technical-coding-v1",
    bundleSha256: created.bundle.bundleSha256,
    signatureVocabularySha256: created.bundle.signatureVocabularySha256,
    coderId: "coder",
    records: [{
      technicalSessionId: created.bundle.sessions[0].technicalSessionId,
      blockId: "S1",
      status: "INCIDENT",
      primaryStage: "ENDPOINT",
      signatureId: "CRIADA_DEPOIS_DOS_DADOS",
      signature: "não permitido",
      confidence: 4,
      reproduction: "NOT_ATTEMPTED"
    }]
  }), /fora do vocabulário/iu);
});
