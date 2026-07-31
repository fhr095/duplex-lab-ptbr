import assert from "node:assert/strict";
import test from "node:test";

import {
  assessShadowTranscript,
  evaluateExp0008
} from "../scripts/lib/exp-0008-analysis.mjs";

const definitions = [
  {
    id: "amount",
    slot: "amount",
    obsolete: "BRL 1500",
    current: "BRL 1150",
    primaryCurrent: "BRL 150",
    knownUnsafe: true
  },
  {
    id: "time",
    slot: "time",
    obsolete: "14:00",
    current: "16:00",
    primaryCurrent: "16:00",
    knownUnsafe: false
  }
];

function inputFor({ latency = 300, amountText } = {}) {
  const texts = {
    amount:
      amountText ??
      "Transfere 1500 reais, não, 1150 reais.",
    time: "Agenda às 14 horas, na verdade, às 16 horas."
  };
  return {
    pack: {
      repetitions: 3,
      cases: definitions,
      gate: {
        requiredAmountCatchRate: 1,
        requiredNumericAgreementRate: 1,
        requiredTranscriptStabilityRate: 1,
        maxDeployableInferenceP95Ms: 650
      }
    },
    reconstructions: definitions.map((item) => ({ id: item.id, pass: true })),
    candidates: [{
      engine: "whisper",
      model: "small",
      role: "quality-ceiling",
      modelLoadMs: 10,
      observations: definitions.flatMap((definition) =>
        [1, 2, 3].map((repetition) => ({
          caseId: definition.id,
          repetition,
          text: texts[definition.id],
          elapsedMs: latency
        }))
      )
    }],
    paidApiCalls: 0
  };
}

test("segundo decoder correto veta a confirmação monetária errada", () => {
  const assessment = assessShadowTranscript(
    definitions[0],
    "Transfere 1500 reais, não, 1150 reais."
  );
  assert.equal(assessment.currentRecovered, true);
  assert.equal(assessment.primaryAgreement, false);
  assert.equal(assessment.wouldVetoPrimary, true);
});

test("autoriza somente shadow quando semântica, estabilidade e budget passam", () => {
  const report = evaluateExp0008(inputFor());
  assert.equal(report.decision, "authorize-runtime-shadow");
  assert.equal(report.authorizedAuthority, "shadow-only");
  assert.deepEqual(report.deployableCandidates, ["whisper-small"]);
});

test("sinal semântico sem budget permanece em hold de latência", () => {
  const report = evaluateExp0008(inputFor({ latency: 900 }));
  assert.equal(report.decision, "hold-latency");
  assert.equal(report.gates.qualityCeilingSemanticSignal, true);
});

test("teto de qualidade que também erra o valor encerra a hipótese", () => {
  const report = evaluateExp0008(inputFor({
    amountText: "Transfere 1500 reais, não, 150 reais."
  }));
  assert.equal(report.decision, "reject-semantic-signal");
  assert.equal(report.authorizedAuthority, "none");
});
