function metricLimitPass(actual, limit) {
  return (
    actual !== null &&
    actual !== undefined &&
    (limit.min === undefined || actual >= limit.min) &&
    (limit.max === undefined || actual <= limit.max)
  );
}

export function applyPerceptionGate(score, gateConfig) {
  const allChecks = score.scenarios.flatMap((scenario) =>
    scenario.checks.map((check) => ({
      ...check,
      scenarioId: scenario.id
    }))
  );
  const failedCritical = allChecks.filter(
    (check) => check.severity === "critical" && !check.pass
  );
  const failedGuardrails = allChecks.filter(
    (check) => check.severity === "guardrail" && !check.pass
  );
  const checks = [
    {
      id: "no-critical-failures",
      pass: failedCritical.length === 0,
      actual: failedCritical.map(
        (check) => `${check.scenarioId}/${check.id}`
      ),
      expected: "nenhuma falha crítica"
    },
    {
      id: "minimum-automated-pass-rate",
      pass:
        score.summary.automatedPassRate >= gateConfig.minAutomatedPassRate,
      actual: score.summary.automatedPassRate,
      expected: `>= ${gateConfig.minAutomatedPassRate}`
    },
    {
      id: "max-failed-guardrails",
      pass: failedGuardrails.length <= gateConfig.maxFailedGuardrails,
      actual: failedGuardrails.map(
        (check) => `${check.scenarioId}/${check.id}`
      ),
      expected: `<= ${gateConfig.maxFailedGuardrails}`
    }
  ];

  for (const [metric, minimumSamples] of Object.entries(
    gateConfig.requiredMetricSamples ?? {}
  )) {
    const actual = score.metrics[metric]?.count ?? 0;
    checks.push({
      id: `${metric}-minimum-samples`,
      pass: actual >= minimumSamples,
      actual,
      expected: `>= ${minimumSamples}`
    });
  }

  for (const [metric, limit] of Object.entries(
    gateConfig.metricLimits ?? {}
  )) {
    const actual = score.metrics[metric]?.[limit.stat] ?? null;
    checks.push({
      id: `${metric}-${limit.stat}`,
      pass: metricLimitPass(actual, limit),
      actual,
      expected: [
        limit.min === undefined ? null : `>= ${limit.min}`,
        limit.max === undefined ? null : `<= ${limit.max}`
      ]
        .filter(Boolean)
        .join(" e ")
    });
  }

  const pass = checks.every((check) => check.pass);
  const deferredReleaseBlockers = score.evidence.deferredMeasurements.filter(
    (measurement) => measurement.blocksUserFacingRelease
  );

  return {
    id: gateConfig.id,
    scope: gateConfig.decisionScope,
    pass,
    decision: pass ? "promote" : "hold",
    checks,
    criticalFailures: failedCritical.map((check) => ({
      scenarioId: check.scenarioId,
      checkId: check.id,
      detail: check.detail
    })),
    rule:
      "falha crítica sempre bloqueia; médias e o score diagnóstico nunca a compensam",
    userFacingReadiness: {
      decision:
        deferredReleaseBlockers.length === 0 && pass ? "promote" : "hold",
      scope: "user-facing-release",
      blockers: deferredReleaseBlockers.map((measurement) => ({
        id: measurement.id,
        requires: measurement.requires,
        metric: measurement.metric
      }))
    }
  };
}
