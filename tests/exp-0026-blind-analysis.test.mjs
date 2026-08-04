import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExp0026TechnicalBundleBlind,
  createExp0026TechnicalBundle,
  joinExp0026HumanAfterTechnicalSeal,
  sealExp0026TechnicalCoding
} from "../src/eval/exp-0026-blind-analysis.mjs";

function input(sessionId = "session-1") {
  return {
    session: {
      sessionId,
      role: "external",
      analysisEligibility: "candidate",
      phase: "COMPLETE",
      top2SealedAt: "2026-08-03T12:30:00.000Z",
      top2: ["RITMO_E_TROCA_DE_TURNO"],
      blockOrder: ["S1", "F0"],
      annotations: [
        {
          blockId: "S1",
          category: "RITMO_E_TROCA_DE_TURNO",
          severity: 3,
          comment: "A resposta começou antes de eu terminar."
        },
        {
          blockId: "F0",
          category: "NENHUM_PROBLEMA_MATERIAL",
          severity: 0,
          comment: null
        }
      ]
    },
    traces: new Map([
      ["S1", { trace: [{ type: "endpoint.commit", detail: "cedo" }] }],
      ["F0", { trace: [] }]
    ])
  };
}

test("bundle técnico remove percepção, severidade, comentário e top-2", () => {
  const created = createExp0026TechnicalBundle([input()], {
    salt: "0123456789abcdef0123456789abcdef",
    analysisMode: "test",
    createdAt: "2026-08-03T13:00:00.000Z"
  });
  assert.equal(assertExp0026TechnicalBundleBlind(created.bundle), true);
  const serialized = JSON.stringify(created.bundle);
  assert.doesNotMatch(serialized, /RITMO_E_TROCA_DE_TURNO/u);
  assert.doesNotMatch(serialized, /começou antes/iu);
  assert.equal(created.bundle.humanFormAccess, "SEALED_NOT_EXPOSED");
  assert.equal(created.privateMapping.mapping[0].sessionId, "session-1");
});

test("junção humana só aceita coding completo e selo íntegro", () => {
  const source = input();
  const created = createExp0026TechnicalBundle([source], {
    salt: "0123456789abcdef0123456789abcdef",
    analysisMode: "test"
  });
  const technicalSessionId =
    created.bundle.sessions[0].technicalSessionId;
  const codingInput = {
    schemaVersion: "exp-0026-technical-coding-v1",
    bundleSha256: created.bundle.bundleSha256,
    coderId: "coder-opaque-1",
    records: ["S1", "F0"].map((blockId) => ({
      technicalSessionId,
      blockId,
      status: "NO_OBSERVED_VIOLATION",
      primaryStage: null,
      signature: "",
      confidence: 3,
      reproduction: "NOT_ATTEMPTED"
    }))
  };
  assert.throws(
    () => sealExp0026TechnicalCoding(created.bundle, {
      ...codingInput,
      records: codingInput.records.slice(0, 1)
    }),
    /não cobre exatamente/u
  );
  const sealed = sealExp0026TechnicalCoding(
    created.bundle,
    codingInput,
    { sealedAt: "2026-08-03T14:00:00.000Z" }
  );
  const tampered = { ...sealed.seal, codingSha256: "sha256:tampered" };
  assert.throws(
    () => joinExp0026HumanAfterTechnicalSeal(
      created.bundle,
      created.privateMapping,
      sealed.coding,
      tampered,
      [source.session]
    ),
    /diverge/u
  );
  const joined = joinExp0026HumanAfterTechnicalSeal(
    created.bundle,
    created.privateMapping,
    sealed.coding,
    sealed.seal,
    [source.session],
    { openedAt: "2026-08-03T15:00:00.000Z" }
  );
  assert.deepEqual(joined.rows[0].top2, ["RITMO_E_TROCA_DE_TURNO"]);
  assert.equal(joined.rows[0].technicalCoding.length, 2);
});
