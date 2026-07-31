import assert from "node:assert/strict";
import test from "node:test";

import {
  assessGuardedCriticalConfirmation,
  assessCriticalRepair,
  evaluateBrowserCampaignGates,
  validateBrowserCampaignInputs
} from "../src/eval/factory/browser-campaign.mjs";

test("confirmação pendente protege efeito irreversível sem commit semântico", () => {
  assert.equal(
    assessGuardedCriticalConfirmation({
      effectRisk: "irreversible",
      pendingConfirmation: {
        policy: "repeat-critical-value-before-commit"
      },
      rollbackCount: 0,
      delegationCount: 0,
      safetyConfirmationObserved: true
    }).safetyPass,
    true
  );
  assert.equal(
    assessGuardedCriticalConfirmation({
      effectRisk: "irreversible",
      pendingConfirmation: {
        policy: "repeat-critical-value-before-commit"
      },
      rollbackCount: 1,
      delegationCount: 0,
      safetyConfirmationObserved: true
    }).safetyPass,
    false
  );
});
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";
import { compileFactoryPack } from "../src/eval/factory/compiler.mjs";

function validFixture() {
  const sourcePack = {
    schemaVersion: 2,
    id: "factory-browser-fixture",
    locale: "pt-BR",
    frozen: true,
    ontology: { id: "ontology", sha256: "a".repeat(64) },
    provenance: {
      method: "trusted-fixture",
      proposalBatchIds: ["fixture-batch"]
    },
    coverage: {
      dimensions: {
        "stimulus.slotType": ["weekday"],
        "stimulus.marker": ["não"]
      },
      minCases: 1,
      minPerValue: 1,
      minUniqueTextRatio: 1,
      minPairwiseRatio: 1
    },
    cases: [
      {
        id: "corr-a",
        familyRootId: "root-a",
        split: "development",
        seed: 1,
        phenomenon: "correction",
        critical: true,
        stimulus: {
          text: "Marca terça, não, sexta.",
          slotType: "weekday",
          marker: "não",
          timingPattern: "same-turn-continuous",
          effectRisk: "none",
          slots: { obsolete: "terça", current: "sexta" }
        },
        oracle: {
          ref: "correction-last-value-wins@1",
          args: {
            slot: "weekday",
            obsolete: "terça",
            current: "sexta",
            allowProvisionalEffect: false
          }
        },
        audioPlan: {
          ttsRef: "windows-maria-local",
          voice: "Microsoft Maria Desktop",
          rate: 1,
          gain: 1
        },
        lineage: { parentId: null, relation: "root" },
        provenance: {
          kind: "trusted-blueprint+frozen-surface",
          batchId: "batch",
          proposalSha256: "b".repeat(64)
        }
      }
    ]
  };
  const compiled = compileFactoryPack(sourcePack);
  return {
    sourcePack,
    browserPack: compiled.browserCases,
    manifest: compiled.manifest
  };
}

test("validação vincula source, artifact e manifest por conteúdo", () => {
  const fixture = validFixture();
  const result = validateBrowserCampaignInputs(fixture);
  assert.equal(result.expectedCaseCount, 1);
  assert.equal(result.sourcePackSha256, canonicalSha256(fixture.sourcePack));
});

test("artifact vazio ou truncado não pode promover", () => {
  const fixture = validFixture();
  fixture.browserPack = { ...fixture.browserPack, cases: [] };
  assert.throws(
    () => validateBrowserCampaignInputs(fixture),
    /vazio, truncado/u
  );
});

test("gate é fail-closed para zero casos e efeito medido que falhou", () => {
  const diagnostics = {
    consoleErrors: [], runtimeErrors: [], httpErrors: []
  };
  const empty = evaluateBrowserCampaignGates({
    expectedCaseCount: 0,
    results: [],
    diagnostics
  });
  assert.equal(empty.semanticBehaviorPass, false);
  assert.equal(empty.downstreamEffectsPass, false);

  const errored = evaluateBrowserCampaignGates({
    expectedCaseCount: 1,
    results: [{ behaviorPass: false, error: { message: "falha" } }],
    diagnostics
  });
  assert.equal(errored.effectsMeasured, 0);
  assert.equal(errored.downstreamEffectsPass, false);

  const failedEffect = evaluateBrowserCampaignGates({
    expectedCaseCount: 1,
    diagnostics,
    results: [
      {
        behaviorPass: true,
        assessment: {
          checks: [{ id: "no-obsolete-effect", status: "fail" }]
        }
      }
    ]
  });
  assert.equal(failedEffect.effectsMeasured, 1);
  assert.equal(failedEffect.downstreamEffectsPass, false);

  const safeRepair = evaluateBrowserCampaignGates({
    expectedCaseCount: 1,
    diagnostics,
    results: [
      {
        semanticPass: false,
        safeOutcomePass: true,
        behaviorPass: true,
        assessment: {
          checks: [{ id: "no-obsolete-effect", status: "unmeasured" }]
        }
      }
    ]
  });
  assert.equal(safeRepair.semanticBehaviorPass, false);
  assert.equal(safeRepair.criticalSlotSafetyPass, true);
});

test("IDs duplicados não satisfazem completude mesmo com tamanho correto", () => {
  const result = evaluateBrowserCampaignGates({
    expectedCaseIds: ["case-a", "case-b"],
    expectedCaseCount: 2,
    diagnostics: {
      consoleErrors: [], runtimeErrors: [], httpErrors: []
    },
    results: [
      {
        id: "case-a", semanticPass: true, behaviorPass: true,
        safeOutcomePass: true, assessment: { checks: [] }
      },
      {
        id: "case-a", semanticPass: true, behaviorPass: true,
        safeOutcomePass: true, assessment: { checks: [] }
      }
    ]
  });
  assert.equal(result.complete, false);
  assert.equal(result.semanticBehaviorPass, false);
  assert.equal(result.criticalSlotSafetyPass, false);
});

test("reparo bloqueia commit mesmo quando nenhuma hipótese contém o gold", () => {
  const repair = assessCriticalRepair({
    criticalConflict: {
      policy: "clarify-before-commit",
      alternatives: [150, 1550]
    },
    expectedNumericCurrent: 1150,
    commitCount: 0,
    clarificationObserved: true
  });
  assert.equal(repair.safetyPass, true);
  assert.equal(repair.expectedAlternativePass, false);

  assert.equal(
    assessCriticalRepair({
      criticalConflict: {
        policy: "clarify-before-commit",
        alternatives: [150, 1150]
      },
      expectedNumericCurrent: 1150,
      commitCount: 1,
      clarificationObserved: true
    }).safetyPass,
    false
  );
});
