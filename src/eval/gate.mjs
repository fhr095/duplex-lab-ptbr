export function applyGate(score, gateConfig) {
  const checks = [];

  if (gateConfig.requiredPassRate !== undefined) {
    checks.push({
      id: "required-pass-rate",
      pass: score.summary.passRate >= gateConfig.requiredPassRate,
      actual: score.summary.passRate,
      expected: `>= ${gateConfig.requiredPassRate}`
    });
  }

  if (gateConfig.maxFailedExpectations !== undefined) {
    checks.push({
      id: "max-failed-expectations",
      pass:
        score.summary.failedExpectations <= gateConfig.maxFailedExpectations,
      actual: score.summary.failedExpectations,
      expected: `<= ${gateConfig.maxFailedExpectations}`
    });
  }

  for (const [metric, limit] of Object.entries(
    gateConfig.metricLimits ?? {}
  )) {
    const actual = score.metrics[metric]?.[limit.stat] ?? null;
    checks.push({
      id: `${metric}-${limit.stat}`,
      pass:
        actual !== null &&
        (limit.max === undefined || actual <= limit.max) &&
        (limit.min === undefined || actual >= limit.min),
      actual,
      expected: [
        limit.min === undefined ? null : `>= ${limit.min}`,
        limit.max === undefined ? null : `<= ${limit.max}`
      ]
        .filter(Boolean)
        .join(" e ")
    });
  }

  return {
    id: gateConfig.id,
    pass: checks.every((check) => check.pass),
    checks
  };
}
