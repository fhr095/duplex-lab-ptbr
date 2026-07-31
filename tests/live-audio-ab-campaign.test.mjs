import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  bootstrapMedianInterval,
  compareCandidates,
  distribution,
  summarizeCandidate
} from "../scripts/live-audio-ab-campaign.mjs";

const fixture = JSON.parse(await readFile(resolve(
  import.meta.dirname,
  "fixtures/live-audio-ab-observations.json"
), "utf8"));

function caseResult({
  category,
  coherent = true,
  endpointMs,
  finalMs,
  id,
  critical = true
}) {
  return {
    id,
    category,
    cohort: "synthetic",
    expectSpeech: true,
    eventCounts: { finals: 1 },
    turnIntegrity: {
      coherentSingleTurn: coherent,
      rawPrematureEndpoint: false,
      prematureEndpoint: false
    },
    timing: {
      endpointAfterLastActiveMs: endpointMs,
      finalAfterEndpointMs: finalMs - endpointMs
    },
    transcript: {
      errors: 0,
      expectedWords: 5,
      wer: 0
    },
    criticalPhrases: {
      recall: category === "correction" ? (critical ? 1 : 0.5) : null
    },
    transport: {
      clientUnsentFrames: 0,
      serverLostFrames: 0,
      rejectedFrames: 0,
      protocolErrors: 0,
      maxBufferedAmountBytes: 0
    }
  };
}

function observations({ regression = false } = {}) {
  const output = [];
  const ids = ["saudacao", "correcao"];
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    for (const candidateId of ["baseline", "challenger"]) {
      output.push({
        candidateId,
        repetition,
        orderIndex:
          candidateId === "baseline"
            ? (repetition % 2 === 1 ? 0 : 1)
            : (repetition % 2 === 1 ? 1 : 0),
        case: {
          id: "silencio",
          category: "false-activation",
          cohort: "control",
          expectSpeech: false,
          eventCounts: { finals: 0, speechStarts: 0 },
          turnIntegrity: {},
          timing: {},
          transcript: null,
          criticalPhrases: { recall: null },
          transport: {
            clientUnsentFrames: 0,
            serverLostFrames: 0,
            rejectedFrames: 0,
            protocolErrors: 0,
            maxBufferedAmountBytes: 0
          }
        }
      });
    }
    for (let index = 0; index < ids.length; index += 1) {
      const position = (repetition - 1) * 2 + index;
      const id = ids[index];
      const category = id === "correcao" ? "correction" : "greeting";
      output.push({
        candidateId: "baseline",
        repetition,
        orderIndex: repetition % 2 === 1 ? 0 : 1,
        case: caseResult({
          category,
          endpointMs: fixture.series.baselineEndpointMs[position],
          finalMs: fixture.series.baselineFinalMs[position],
          id
        })
      });
      output.push({
        candidateId: "challenger",
        repetition,
        orderIndex: repetition % 2 === 1 ? 1 : 0,
        case: caseResult({
          category,
          coherent: !(regression && id === "correcao" && repetition === 2),
          critical: !(regression && id === "correcao" && repetition === 2),
          endpointMs: fixture.series.challengerEndpointMs[position],
          finalMs: fixture.series.challengerFinalMs[position],
          id
        })
      });
    }
  }
  return output;
}

test("p95 só aparece com amostra suficiente e cauda não unitária", () => {
  const small = distribution([1, 2, 3, 4, 5], {
    minimumP95Samples: 6
  });
  const sufficient = distribution([1, 2, 3, 4, 5, 6], {
    minimumP95Samples: 6
  });

  assert.equal(small.p95, null);
  assert.equal(small.p95Eligible, false);
  assert.equal(sufficient.p95, 6);
  assert.equal(sufficient.p95Eligible, true);
  assert.equal(sufficient.p95TailObservations, 1);
});

test("bootstrap pareado é determinístico e preserva sinal", () => {
  const first = bootstrapMedianInterval([-70, -69, -71, -68], {
    iterations: 500,
    seed: 42
  });
  const second = bootstrapMedianInterval([-70, -69, -71, -68], {
    iterations: 500,
    seed: 42
  });

  assert.deepEqual(first, second);
  assert.ok(first.high < 0);
});

test("resumo exige cobertura por cenário e mede fim de fala até final", () => {
  const result = summarizeCandidate(
    "baseline",
    observations(),
    fixture.experiment
  );

  assert.equal(result.completeCoverage, true);
  assert.equal(result.speechObservations, 6);
  assert.equal(result.controlObservations, 3);
  assert.equal(result.falseActivations, 0);
  assert.equal(result.timing.speechEndToFinalMs.n, 6);
  assert.equal(result.correctionSuccessRate, 1);
});

test("ganho pareado seguro promove challenger", () => {
  const result = compareCandidates(
    fixture.experiment,
    observations()
  );

  assert.equal(result.paired.endpoint.pairedSamples, 6);
  assert.ok(result.paired.endpoint.deltaMs.p50 <= -60);
  assert.ok(
    result.paired.endpoint.bootstrapMedian95CiMs.high < 0
  );
  assert.equal(
    result.paired.byScenario.correcao.pairedSamples,
    3
  );
  assert.equal(
    result.paired.endpoint.orderStrata["challenger-first"].n,
    2
  );
  assert.equal(result.recommendation.safe, true);
  assert.equal(result.recommendation.beneficial, true);
  assert.equal(
    result.recommendation.decision,
    "promote-challenger"
  );
});

test("uma regressão de correção bloqueia ganho de latência", () => {
  const result = compareCandidates(
    fixture.experiment,
    observations({ regression: true })
  );

  assert.equal(
    result.paired.binary.correctionSuccess.challengerRegressions,
    1
  );
  assert.equal(
    result.recommendation.safetyChecks.correctionCoherent,
    false
  );
  assert.equal(result.recommendation.safe, false);
  assert.equal(result.recommendation.decision, "reject-challenger");
});

test("final ausente não entra como latência rápida e torna evidência insuficiente", () => {
  const values = observations();
  const missing = values.find(
    (item) =>
      item.candidateId === "challenger" &&
      item.repetition === 1 &&
      item.case.id === "saudacao"
  );
  missing.case.eventCounts.finals = 0;
  missing.case.timing.finalAfterEndpointMs = null;
  const result = compareCandidates(fixture.experiment, values);

  assert.equal(result.paired.speechEndToFinal.pairedSamples, 5);
  assert.equal(
    result.recommendation.evidenceChecks.speechEndToFinalPairs,
    false
  );
  assert.equal(result.recommendation.evidenceAdequate, false);
  assert.equal(result.recommendation.decision, "inconclusive");
});

test("falsa ativação no silêncio bloqueia challenger", () => {
  const values = observations();
  const control = values.find(
    (item) =>
      item.candidateId === "challenger" &&
      item.repetition === 2 &&
      item.case.id === "silencio"
  );
  control.case.eventCounts.speechStarts = 1;
  const result = compareCandidates(fixture.experiment, values);

  assert.equal(
    result.paired.binary.falseActivationControl
      .challengerRegressions,
    1
  );
  assert.equal(
    result.recommendation.safetyChecks.noChallengerFalseActivations,
    false
  );
  assert.equal(result.recommendation.decision, "reject-challenger");
});
