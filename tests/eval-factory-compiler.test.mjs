import assert from "node:assert/strict";
import test from "node:test";

import { validatePerceptionPack } from "../src/eval/perception-schema.mjs";
import { evaluateBaseline } from "../src/eval/runner.mjs";
import { validateScenarioPack } from "../src/eval/scenario.mjs";
import {
  compileFactoryPack
} from "../src/eval/factory/compiler.mjs";

function factoryPack() {
  const base = {
    familyRootId: "root-a",
    split: "development",
    seed: 5,
    phenomenon: "correction",
    critical: true,
    oracle: {
      ref: "correction-last-value-wins@1",
      args: {
        slot: "weekday",
        obsolete: "terça",
        current: "sexta",
        allowProvisionalEffect: false
      }
    },
    audioPlan: { ttsRef: "windows-maria-local", rate: 1, gain: 1 },
    lineage: { parentId: null, relation: "root" }
  };
  return {
    schemaVersion: 2,
    id: "factory-test",
    locale: "pt-BR",
    frozen: true,
    ontology: { id: "ontology", sha256: "a".repeat(64) },
    provenance: { method: "test", proposalBatchIds: ["batch"] },
    coverage: {
      dimensions: {
        "stimulus.slotType": ["weekday"],
        "stimulus.marker": ["não", "na verdade"],
        "stimulus.timingPattern": [
          "same-turn-continuous",
          "barge-in"
        ],
        "stimulus.effectRisk": ["reversible"]
      },
      minCases: 2,
      minPerValue: 1,
      minUniqueTextRatio: 1,
      minPairwiseRatio: 0.75
    },
    cases: [
      {
        ...base,
        id: "corr-a",
        stimulus: {
          text: "Marca para terça, não, sexta.",
          slotType: "weekday",
          marker: "não",
          timingPattern: "same-turn-continuous",
          effectRisk: "reversible",
          slots: { obsolete: "terça", current: "sexta" }
        }
      },
      {
        ...base,
        id: "corr-b",
        familyRootId: "root-b",
        seed: 6,
        stimulus: {
          text: "Terça; na verdade, sexta.",
          slotType: "weekday",
          marker: "na verdade",
          timingPattern: "barge-in",
          effectRisk: "reversible",
          slots: { obsolete: "terça", current: "sexta" }
        }
      }
    ]
  };
}

test("compilador emite packs válidos para relógio, percepção, áudio e Chrome", () => {
  const artifacts = compileFactoryPack(factoryPack());
  validateScenarioPack(artifacts.tracePack);
  validatePerceptionPack(artifacts.perceptionPack);

  assert.equal(
    artifacts.liveAudioPack.cases.filter((item) => item.expectSpeech !== false)
      .length,
    2
  );
  assert.equal(artifacts.browserCases.cases.length, 2);
  assert.match(artifacts.manifest.packSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    artifacts.tracePack.scenarios[0].metadata.evidenceLevel,
    "semantic-event-compiled"
  );
});

test("pack compilado atravessa o evaluator atual sem falso corte", () => {
  const { tracePack } = compileFactoryPack(factoryPack());
  const report = evaluateBaseline(tracePack, {
    minScenarioPassRate: 1,
    maxCriticalFailures: 0,
    metricLimits: {}
  });

  assert.equal(report.summary.scenarioCount, 2);
  assert.equal(report.summary.passedScenarios, 2);
});
