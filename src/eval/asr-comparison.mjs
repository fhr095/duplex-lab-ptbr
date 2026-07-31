function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function relativeChange(baseline, candidate) {
  return baseline === 0 ? null : round((candidate - baseline) / baseline);
}

export function compareAsrReports(baseline, candidate, gate) {
  if (baseline.packId !== candidate.packId) {
    throw new TypeError(
      `packs incompatíveis: ${baseline.packId} != ${candidate.packId}`
    );
  }

  const baselineCases = new Map(
    baseline.cases.map((item) => [item.id, item])
  );
  const caseDeltas = candidate.cases.map((item) => {
    const previous = baselineCases.get(item.id);
    if (!previous) {
      throw new TypeError(`caso ${item.id} não existe na baseline`);
    }
    return {
      id: item.id,
      baselineWer: previous.wer,
      candidateWer: item.wer,
      werDelta: round(item.wer - previous.wer)
    };
  });
  const materialRegressions = caseDeltas.filter(
    (item) => item.werDelta > gate.materialCaseRegressionWer
  );
  const materialRegressionRate = round(
    materialRegressions.length / caseDeltas.length
  );

  const baselineWer = baseline.summary.corpusWer;
  const candidateWer = candidate.summary.corpusWer;
  const werGain = round(baselineWer - candidateWer);
  const candidateP50 = candidate.summary.realtimeFactor.p50;
  const candidateP95 = candidate.summary.realtimeFactor.p95;
  const checks = {
    qualityGain: werGain >= gate.minAbsoluteWerGain,
    realtimeMedian:
      candidateP50 <= gate.maxCandidateP50RealtimeFactor,
    realtimeTail:
      candidateP95 <= gate.maxCandidateP95RealtimeFactor,
    boundedCaseRegressions:
      materialRegressionRate <= gate.maxMaterialCaseRegressionRate
  };
  const pass = Object.values(checks).every(Boolean);
  let decision = "reject";
  if (pass) {
    decision = "promote";
  } else if (
    checks.qualityGain &&
    checks.boundedCaseRegressions &&
    (!checks.realtimeMedian || !checks.realtimeTail)
  ) {
    decision = "hold-for-offline-or-hybrid";
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    packId: baseline.packId,
    baseline: baseline.candidate,
    candidate: candidate.candidate,
    decision,
    pass,
    checks,
    thresholds: gate,
    deltas: {
      corpusWer: round(candidateWer - baselineWer),
      relativeCorpusWer: relativeChange(baselineWer, candidateWer),
      p50RealtimeFactor: round(
        candidateP50 - baseline.summary.realtimeFactor.p50
      ),
      relativeP50RealtimeFactor: relativeChange(
        baseline.summary.realtimeFactor.p50,
        candidateP50
      ),
      p95RealtimeFactor: round(
        candidateP95 - baseline.summary.realtimeFactor.p95
      ),
      relativeP95RealtimeFactor: relativeChange(
        baseline.summary.realtimeFactor.p95,
        candidateP95
      ),
      materialRegressionRate
    },
    materialRegressions,
    cases: caseDeltas
  };
}
