import { isDeepStrictEqual } from "node:util";

function findNth(trace, type, occurrence = 1, startIndex = 0) {
  let seen = 0;
  for (let index = startIndex; index < trace.length; index += 1) {
    if (trace[index].type !== type) {
      continue;
    }
    seen += 1;
    if (seen === occurrence) {
      return { event: trace[index], index };
    }
  }
  return null;
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function scoreLatency(expectation, trace) {
  const from = findNth(
    trace,
    expectation.from,
    expectation.fromOccurrence ?? 1
  );
  const to = from
    ? findNth(
        trace,
        expectation.to,
        expectation.toOccurrence ?? 1,
        from.index + 1
      )
    : null;

  const value = from && to ? to.event.atMs - from.event.atMs : null;
  const passesMin =
    value !== null &&
    (expectation.minMs === undefined || value >= expectation.minMs);
  const passesMax =
    value !== null &&
    (expectation.maxMs === undefined || value <= expectation.maxMs);

  return {
    id: expectation.id,
    kind: expectation.kind,
    metric: expectation.metric ?? null,
    pass: passesMin && passesMax,
    value,
    detail:
      value === null
        ? `não foi possível formar o par ${expectation.from} → ${expectation.to}`
        : `${value} ms`
  };
}

function scoreRequired(expectation, trace) {
  const anchor = expectation.after
    ? findNth(trace, expectation.after, expectation.afterOccurrence ?? 1)
    : { index: -1, event: { atMs: 0 } };
  const found = anchor
    ? findNth(
        trace,
        expectation.event,
        expectation.occurrence ?? 1,
        anchor.index + 1
      )
    : null;
  const latency = found ? found.event.atMs - anchor.event.atMs : null;
  const pass =
    Boolean(found) &&
    (expectation.withinMs === undefined || latency <= expectation.withinMs);

  return {
    id: expectation.id,
    kind: expectation.kind,
    metric: expectation.metric ?? null,
    pass,
    value: expectation.metric ? latency : null,
    detail: found
      ? `evento em ${found.event.atMs} ms${
          expectation.after ? ` (${latency} ms após ${expectation.after})` : ""
        }`
      : `evento ausente: ${expectation.event}`
  };
}

function scoreForbidden(expectation, trace) {
  const after = expectation.after
    ? findNth(trace, expectation.after, expectation.afterOccurrence ?? 1)
    : { index: -1, event: { atMs: -Infinity } };
  const until = expectation.until
    ? findNth(
        trace,
        expectation.until,
        expectation.untilOccurrence ?? 1,
        (after?.index ?? -1) + 1
      )
    : { index: trace.length, event: { atMs: Infinity } };

  let violating = null;
  if (after && until) {
    for (let index = after.index + 1; index < until.index; index += 1) {
      if (trace[index].type === expectation.event) {
        violating = trace[index];
        break;
      }
    }
  }

  return {
    id: expectation.id,
    kind: expectation.kind,
    metric: null,
    pass: Boolean(after && until && !violating),
    value: violating ? 1 : 0,
    detail: violating
      ? `evento proibido em ${violating.atMs} ms: ${expectation.event}`
      : "nenhum evento proibido"
  };
}

function scorePayload(expectation, trace) {
  const found = findNth(
    trace,
    expectation.event,
    expectation.occurrence ?? 1
  );
  const actual = found
    ? getPath(found.event.payload, expectation.path)
    : undefined;
  const pass = Boolean(found) && isDeepStrictEqual(actual, expectation.equals);

  return {
    id: expectation.id,
    kind: expectation.kind,
    metric: null,
    pass,
    value: null,
    detail: found
      ? `${expectation.path}=${JSON.stringify(actual)}`
      : `evento ausente: ${expectation.event}`
  };
}

function scoreSequence(expectation, trace) {
  let cursor = 0;
  const matched = [];

  for (const type of expectation.events) {
    const found = findNth(trace, type, 1, cursor);
    if (!found) {
      return {
        id: expectation.id,
        kind: expectation.kind,
        metric: null,
        pass: false,
        value: null,
        detail: `sequência interrompida antes de ${type}`
      };
    }
    matched.push(found.event.atMs);
    cursor = found.index + 1;
  }

  return {
    id: expectation.id,
    kind: expectation.kind,
    metric: null,
    pass: true,
    value: null,
    detail: `sequência observada em ${matched.join(", ")} ms`
  };
}

export function scoreScenario(scenario, trace) {
  const scorers = {
    forbidden: scoreForbidden,
    latency: scoreLatency,
    payload: scorePayload,
    required: scoreRequired,
    sequence: scoreSequence
  };
  const checks = scenario.expectations.map((expectation) =>
    scorers[expectation.kind](expectation, trace)
  );

  return {
    id: scenario.id,
    category: scenario.category,
    description: scenario.description,
    pass: checks.every((check) => check.pass),
    checks,
    trace
  };
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function summarizeValues(values) {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    average: Math.round((total / values.length) * 100) / 100,
    min: Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values)
  };
}

export function scorePack(pack, tracesByScenarioId) {
  const scenarios = pack.scenarios.map((scenario) =>
    scoreScenario(scenario, tracesByScenarioId.get(scenario.id))
  );
  const checks = scenarios.flatMap((scenario) => scenario.checks);
  const metricValues = new Map();

  for (const check of checks) {
    if (!check.metric || check.value === null) {
      continue;
    }
    const values = metricValues.get(check.metric) ?? [];
    values.push(check.value);
    metricValues.set(check.metric, values);
  }

  const metrics = Object.fromEntries(
    [...metricValues.entries()].map(([name, values]) => [
      name,
      summarizeValues(values)
    ])
  );
  const passedExpectations = checks.filter((check) => check.pass).length;

  return {
    packId: pack.id,
    summary: {
      scenarioCount: scenarios.length,
      passedScenarios: scenarios.filter((scenario) => scenario.pass).length,
      expectationCount: checks.length,
      passedExpectations,
      failedExpectations: checks.length - passedExpectations,
      passRate:
        checks.length === 0
          ? 0
          : Math.round((passedExpectations / checks.length) * 10_000) / 10_000
    },
    metrics,
    scenarios
  };
}
