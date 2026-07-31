import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleFactoryPack,
  generationInputHash
} from "../src/eval/factory/assembler.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";

function inputs() {
  const ontology = {
    schemaVersion: 1,
    id: "ontology-test",
    locale: "pt-BR",
    coverage: {
      dimensions: {
        "stimulus.slotType": ["weekday"],
        "stimulus.marker": ["não"],
        "stimulus.timingPattern": ["same-turn-continuous"],
        "stimulus.effectRisk": ["reversible"]
      },
      minCases: 2,
      minPerValue: 1,
      minUniqueTextRatio: 1,
      minPairwiseRatio: 1
    }
  };
  const blueprintSet = {
    schemaVersion: 1,
    id: "blueprints-test",
    outputPackId: "pack-test-v0.2",
    ontologyId: ontology.id,
    blueprints: [
      {
        id: "corr-weekday",
        split: "development",
        seed: 10,
        critical: true,
        minSurfaces: 2,
        slotType: "weekday",
        marker: "não",
        timingPattern: "same-turn-continuous",
        effectRisk: "reversible",
        slots: { obsolete: "terça", current: "sexta" },
        audioPlan: { ttsRef: "windows-maria-local", rate: 1, gain: 1 }
      }
    ]
  };
  const proposals = [
    {
      blueprintId: "corr-weekday",
      text: "Marca para terça, não, sexta.",
      styleTags: ["direct"]
    },
    {
      blueprintId: "corr-weekday",
      text: "Pode ser terça... não, deixa sexta.",
      styleTags: ["hesitation"]
    }
  ];
  const batch = {
    schemaVersion: 1,
    batchId: "batch-test",
    provider: {
      id: "replaceable",
      model: "test",
      promptSha256: "a".repeat(64),
      inputSha256: generationInputHash(ontology, blueprintSet),
      outputSha256: canonicalSha256(proposals)
    },
    seed: 10,
    proposals
  };
  return { ontology, blueprintSet, batch };
}

test("assembler mantém semântica confiável e usa IA só na superfície", () => {
  const { ontology, blueprintSet, batch } = inputs();
  const pack = assembleFactoryPack({
    ontology,
    blueprintSet,
    proposalBatches: [batch]
  });

  assert.equal(pack.cases.length, 2);
  assert.deepEqual(
    pack.cases.map((item) => item.oracle.args.current),
    ["sexta", "sexta"]
  );
  assert.equal(pack.cases[1].familyRootId, pack.cases[0].familyRootId);
  assert.equal(pack.cases[1].split, pack.cases[0].split);
  assert.equal(pack.cases[1].lineage.parentId, pack.cases[0].id);
});

test("assembler rejeita output alterado depois da geração", () => {
  const { ontology, blueprintSet, batch } = inputs();
  batch.proposals[0].text = "Texto adulterado";
  assert.throws(
    () =>
      assembleFactoryPack({
        ontology,
        blueprintSet,
        proposalBatches: [batch]
      }),
    /outputSha256 divergente/iu
  );
});
