import test from "node:test";
import assert from "node:assert/strict";

import { compareAsrReports } from "../src/eval/asr-comparison.mjs";

const gate = {
  minAbsoluteWerGain: 0.02,
  maxCandidateP50RealtimeFactor: 1,
  maxCandidateP95RealtimeFactor: 1.5,
  maxMaterialCaseRegressionRate: 0.25,
  materialCaseRegressionWer: 0.2
};

function report(candidate, wer, p50, p95, cases = [wer]) {
  return {
    candidate,
    packId: "pack",
    summary: {
      corpusWer: wer,
      realtimeFactor: { p50, p95 }
    },
    cases: cases.map((caseWer, index) => ({
      id: `case-${index}`,
      wer: caseWer
    }))
  };
}

test("promove ganho de qualidade que permanece em tempo real", () => {
  const result = compareAsrReports(
    report("base", 0.4, 0.6, 1.2),
    report("candidate", 0.3, 0.8, 1.4),
    gate
  );

  assert.equal(result.decision, "promote");
  assert.equal(result.pass, true);
});

test("retém candidato mais preciso mas lento para uso híbrido", () => {
  const result = compareAsrReports(
    report("base", 0.5, 0.5, 1.2),
    report("candidate", 0.35, 1.4, 2.2),
    gate
  );

  assert.equal(result.decision, "hold-for-offline-or-hybrid");
  assert.equal(result.pass, false);
});

test("rejeita comparação de packs diferentes", () => {
  const baseline = report("base", 0.5, 0.5, 1);
  const candidate = {
    ...report("candidate", 0.3, 0.7, 1.2),
    packId: "outro-pack"
  };

  assert.throws(
    () => compareAsrReports(baseline, candidate, gate),
    /packs incompatíveis/u
  );
});
