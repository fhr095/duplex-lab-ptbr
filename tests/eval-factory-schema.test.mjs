import assert from "node:assert/strict";
import test from "node:test";

import {
  validateFactoryPack,
  validateGenerationProposal
} from "../src/eval/factory/schema.mjs";

const SHA = "a".repeat(64);

function proposal(overrides = {}) {
  return {
    schemaVersion: 1,
    batchId: "correction-surfaces-001",
    provider: {
      id: "replaceable-generator",
      model: "model-version",
      promptSha256: SHA,
      inputSha256: SHA,
      outputSha256: SHA
    },
    seed: 4102,
    proposals: [
      {
        blueprintId: "corr-weekday-001",
        text: "Marca para terça... não, sexta.",
        styleTags: ["hesitation", "explicit-repair"]
      }
    ],
    ...overrides
  };
}

function correctionCase(overrides = {}) {
  return {
    id: "corr-weekday-001-surface-a",
    familyRootId: "corr-weekday-001",
    split: "development",
    seed: 4102,
    phenomenon: "correction",
    critical: true,
    stimulus: {
      text: "Marca para terça... não, sexta.",
      slotType: "weekday",
      marker: "não",
      timingPattern: "same-turn-after-pause",
      effectRisk: "reversible",
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
      rate: 1,
      gain: 1
    },
    lineage: { parentId: null, relation: "root" },
    ...overrides
  };
}

function pack(cases = [correctionCase()]) {
  return {
    schemaVersion: 2,
    id: "corrections-ptbr-v0.2",
    locale: "pt-BR",
    frozen: true,
    ontology: { id: "interaction-ptbr-v1", sha256: SHA },
    provenance: {
      method: "ai-assisted-bootstrap",
      proposalBatchIds: ["correction-surfaces-001"]
    },
    coverage: {
      dimensions: {
        "stimulus.slotType": ["weekday"],
        "stimulus.marker": ["não"],
        "stimulus.timingPattern": ["same-turn-after-pause"],
        "stimulus.effectRisk": ["reversible"]
      },
      minCases: 1,
      minPerValue: 1,
      minUniqueTextRatio: 1,
      minPairwiseRatio: 1
    },
    cases
  };
}

test("proposta de IA aceita apenas superfície linguística e proveniência", () => {
  assert.equal(validateGenerationProposal(proposal()).proposals.length, 1);
  assert.throws(
    () =>
      validateGenerationProposal(
        proposal({
          proposals: [
            {
              blueprintId: "corr-weekday-001",
              text: "Não, sexta.",
              styleTags: [],
              oracle: { expected: "sexta" }
            }
          ]
        })
      ),
    /campo não permitido.*oracle/iu
  );
});

test("pack confiável valida oráculo, slots, áudio e IDs", () => {
  assert.equal(validateFactoryPack(pack()).cases.length, 1);
  assert.throws(
    () =>
      validateFactoryPack(
        pack([
          correctionCase(),
          correctionCase({ id: "corr-weekday-001-surface-a" })
        ])
      ),
    /case.id duplicado/iu
  );
  assert.throws(
    () =>
      validateFactoryPack(
        pack([
          correctionCase(),
          correctionCase({
            id: "corr-weekday-001-holdout",
            split: "holdout"
          })
        ])
      ),
    /atravessa splits/iu
  );
});

test("o texto precisa materializar os slots definidos pelo blueprint", () => {
  const invalid = correctionCase({
    stimulus: {
      ...correctionCase().stimulus,
      text: "Marca para sexta."
    }
  });
  assert.throws(
    () => validateFactoryPack(pack([invalid])),
    /slot obsoleto/iu
  );
});

