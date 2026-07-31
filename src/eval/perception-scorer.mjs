function findEvent(trace, selector, startIndex = 0, endIndex = trace.length) {
  const wantedOccurrence = selector.occurrence ?? 1;
  let seen = 0;

  for (let index = startIndex; index < endIndex; index += 1) {
    if (trace[index].type !== selector.type) {
      continue;
    }
    seen += 1;
    if (seen === wantedOccurrence) {
      return { event: trace[index], index };
    }
  }
  return null;
}

function findFirstAfter(trace, type, startIndex, predicate = () => true) {
  for (let index = startIndex; index < trace.length; index += 1) {
    const event = trace[index];
    if (event.type === type && predicate(event)) {
      return { event, index };
    }
  }
  return null;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ").length : 0;
}

function measurement(name, value, unit = "ms") {
  return { name, value, unit };
}

function result(check, pass, detail, measurements = []) {
  return {
    id: check.id,
    kind: check.kind,
    severity: check.severity,
    proxyFor: check.proxyFor,
    evidence: "automated_proxy",
    pass,
    detail,
    measurements
  };
}

function isUsefulSpeech(event, check) {
  const kind = event.payload?.kind;
  const text = event.payload?.text;
  const kindsPass =
    !check.usableKinds || check.usableKinds.includes(String(kind));
  const textPass =
    check.requireText === false ||
    wordCount(text) >= (check.minWords ?? 1);
  return kindsPass && textPass;
}

function scoreUsefulSpeechLatency(check, trace) {
  const anchor = findEvent(trace, check.anchor);
  if (!anchor) {
    return result(check, false, `âncora ausente: ${check.anchor.type}`);
  }

  const speech = findFirstAfter(
    trace,
    "assistant.speech.started",
    anchor.index + 1,
    (event) => isUsefulSpeech(event, check)
  );
  if (!speech) {
    return result(check, false, "nenhuma fala útil observada após a âncora");
  }

  const latencyMs = speech.event.atMs - anchor.event.atMs;
  const pass =
    latencyMs >= (check.minMs ?? 0) &&
    latencyMs <= check.maxMs;
  return result(
    check,
    pass,
    `primeira fala útil (${speech.event.payload?.kind ?? "sem kind"}) em ${latencyMs} ms`,
    [measurement(check.metric, latencyMs)]
  );
}

function scoreBackchannelAdequacy(check, trace) {
  const anchor = findEvent(trace, check.anchor);
  const until = anchor
    ? findEvent(trace, check.until, anchor.index + 1)
    : null;
  if (!anchor || !until) {
    return result(
      check,
      false,
      "janela de backchannel não pôde ser formada"
    );
  }

  const backchannels = trace
    .slice(anchor.index + 1, until.index)
    .filter((event) => event.type === "assistant.backchannel");
  const first = backchannels[0];
  const latencyMs = first ? first.atMs - anchor.event.atMs : null;
  const normalizedText = normalizeText(first?.payload?.text);
  const allowedTexts = (check.allowedTexts ?? []).map(normalizeText);
  const timingPass =
    latencyMs !== null &&
    latencyMs >= (check.minMs ?? 0) &&
    latencyMs <= check.maxMs;
  const textPass =
    Boolean(first) &&
    (allowedTexts.length === 0 || allowedTexts.includes(normalizedText)) &&
    wordCount(first?.payload?.text) <= (check.maxWords ?? Infinity);
  const countPass = backchannels.length === 1;

  return result(
    check,
    timingPass && textPass && countPass,
    first
      ? `${backchannels.length} backchannel(s), texto=${JSON.stringify(
          first.payload?.text ?? ""
        )}, latência=${latencyMs} ms`
      : "backchannel ausente",
    latencyMs === null
      ? []
      : [measurement("backchannel_perceived_latency_ms", latencyMs)]
  );
}

function scoreFalseCut(check, trace) {
  const from = findEvent(trace, check.from);
  const until = from
    ? findEvent(trace, check.until, from.index + 1)
    : null;
  if (!from || !until) {
    return result(check, false, "janela de possível corte não pôde ser formada");
  }

  const cuts = trace
    .slice(from.index + 1, until.index)
    .filter((event) => event.type === "assistant.speech.started");
  const count = cuts.length;
  return result(
    check,
    count <= check.maxCount,
    count === 0
      ? "nenhuma fala do assistente antes do fim real do turno"
      : `${count} fala(s) do assistente antes do fim real em ${cuts
          .map((event) => `${event.atMs} ms`)
          .join(", ")}`,
    [measurement("false_cut_count", count, "count")]
  );
}

function assistantWasSpeaking(trace, beforeIndex) {
  let speaking = false;
  for (let index = 0; index < beforeIndex; index += 1) {
    if (trace[index].type === "assistant.speech.started") {
      speaking = true;
    }
    if (
      trace[index].type === "assistant.speech.stopped" ||
      trace[index].type === "assistant.speech.finished"
    ) {
      speaking = false;
    }
  }
  return speaking;
}

function scoreInterruptionStop(check, trace) {
  const trigger = findEvent(trace, check.trigger);
  if (!trigger) {
    return result(check, false, `gatilho ausente: ${check.trigger.type}`);
  }
  if (!assistantWasSpeaking(trace, trigger.index)) {
    return result(
      check,
      false,
      "o trace não mostra o assistente falando no instante da interrupção"
    );
  }

  let terminal = null;
  for (let index = trigger.index + 1; index < trace.length; index += 1) {
    if (
      trace[index].type === "assistant.speech.stopped" ||
      trace[index].type === "assistant.speech.finished"
    ) {
      terminal = { event: trace[index], index };
      break;
    }
  }
  if (!terminal || terminal.event.type !== "assistant.speech.stopped") {
    return result(
      check,
      false,
      terminal
        ? "a fala terminou sem um comando de parada associado à interrupção"
        : "comando de parada ausente após a interrupção"
    );
  }

  const latencyMs = terminal.event.atMs - trigger.event.atMs;
  return result(
    check,
    latencyMs <= check.maxMs,
    `comando de parada em ${latencyMs} ms; cauda acústica não medida`,
    [measurement("stop_command_latency_ms", latencyMs)]
  );
}

function scoreCorrectionPreserved(check, trace) {
  const correction = findEvent(trace, check.correction);
  if (!correction) {
    return result(check, false, "correção final ausente");
  }
  const rollback = findFirstAfter(
    trace,
    "state.rollback",
    correction.index + 1
  );
  const expected = normalizeText(check.expectedCurrent);
  const correctionValue = normalizeText(correction.event.payload?.current);
  const rollbackValue = normalizeText(rollback?.event.payload?.current);
  const rollbackLatencyMs = rollback
    ? rollback.event.atMs - correction.event.atMs
    : null;

  const userEnd = findFirstAfter(
    trace,
    "user.speech.ended",
    correction.index + 1
  );
  const userStart = [...trace.slice(0, correction.index + 1)]
    .map((event, index) => ({ event, index }))
    .reverse()
    .find(({ event }) => event.type === "user.speech.started");
  const provisionalDelegation =
    check.forbidDelegationBeforeEnd && userStart && userEnd
      ? trace
          .slice(userStart.index + 1, userEnd.index)
          .some((event) => event.type === "task.delegated")
      : false;
  const pass =
    Boolean(rollback) &&
    (check.forbidDelegationBeforeEnd !== true ||
      Boolean(userStart && userEnd)) &&
    correctionValue === expected &&
    rollbackValue === expected &&
    rollbackLatencyMs <= check.maxRollbackMs &&
    !provisionalDelegation;

  return result(
    check,
    pass,
    rollback
      ? `correção=${JSON.stringify(
          correction.event.payload?.current
        )}, rollback=${JSON.stringify(
          rollback.event.payload?.current
        )}, latência=${rollbackLatencyMs} ms, delegação provisória=${provisionalDelegation}`
      : "rollback da correção final ausente",
    rollbackLatencyMs === null
      ? []
      : [measurement("correction_rollback_latency_ms", rollbackLatencyMs)]
  );
}

function scoreDelegationAck(check, trace) {
  const anchor = findEvent(trace, check.anchor);
  if (!anchor) {
    return result(check, false, `âncora ausente: ${check.anchor.type}`);
  }

  const delegated = findFirstAfter(
    trace,
    "task.delegated",
    anchor.index + 1
  );
  const acknowledgment = findFirstAfter(
    trace,
    "assistant.speech.started",
    anchor.index + 1,
    (event) =>
      event.payload?.kind === "acknowledgment" &&
      wordCount(event.payload?.text) >= (check.minAcknowledgmentWords ?? 1)
  );
  const transcript = [...trace.slice(0, anchor.index + 1)]
    .reverse()
    .find((event) => event.type === "user.transcript.final");
  const turnStart = [...trace.slice(0, anchor.index + 1)]
    .map((event, index) => ({ event, index }))
    .reverse()
    .find(({ event }) => event.type === "user.speech.started");
  const delegatedBeforeEnd = trace
    .slice((turnStart?.index ?? -1) + 1, anchor.index)
    .some((event) => event.type === "task.delegated");
  const delegationLatencyMs = delegated
    ? delegated.event.atMs - anchor.event.atMs
    : null;
  const acknowledgmentLatencyMs = acknowledgment
    ? acknowledgment.event.atMs - anchor.event.atMs
    : null;
  const queryMatches =
    check.requireTranscriptMatch !== true ||
    normalizeText(delegated?.event.payload?.query) ===
      normalizeText(transcript?.payload?.text);

  const pass =
    Boolean(delegated && acknowledgment) &&
    !delegatedBeforeEnd &&
    queryMatches &&
    delegationLatencyMs <= check.maxDelegationMs &&
    acknowledgmentLatencyMs <= check.maxAcknowledgmentMs;

  const measurements = [];
  if (delegationLatencyMs !== null) {
    measurements.push(
      measurement("delegation_commit_latency_ms", delegationLatencyMs)
    );
  }
  if (acknowledgmentLatencyMs !== null) {
    measurements.push(
      measurement(
        "delegation_acknowledgment_latency_ms",
        acknowledgmentLatencyMs
      )
    );
  }

  return result(
    check,
    pass,
    `delegação=${
      delegationLatencyMs === null ? "ausente" : `${delegationLatencyMs} ms`
    }, confirmação=${
      acknowledgmentLatencyMs === null
        ? "ausente"
        : `${acknowledgmentLatencyMs} ms`
    }, antes do fim=${delegatedBeforeEnd}, query preservada=${queryMatches}`,
    measurements
  );
}

function scoreCancellationIntegrity(check, trace) {
  const cancelledByUser = findEvent(trace, check.cancellation);
  if (!cancelledByUser) {
    return result(check, false, "cancelamento do usuário ausente");
  }

  const delegated = [...trace.slice(0, cancelledByUser.index)]
    .reverse()
    .find((event) => event.type === "task.delegated");
  const cancelled = findFirstAfter(
    trace,
    "task.cancelled",
    cancelledByUser.index + 1
  );
  const latencyMs = cancelled
    ? cancelled.event.atMs - cancelledByUser.event.atMs
    : null;
  const sameTask =
    Boolean(delegated && cancelled) &&
    delegated.payload?.taskId === cancelled.event.payload?.taskId;
  const staleResult = trace
    .slice(cancelledByUser.index + 1)
    .some(
      (event) =>
        (event.type === "task.result" &&
          (!delegated ||
            event.payload?.taskId === delegated.payload?.taskId)) ||
        (event.type === "assistant.speech.started" &&
          event.payload?.kind === "delegated-result")
    );
  const pass =
    Boolean(delegated && cancelled) &&
    sameTask &&
    latencyMs <= check.maxMs &&
    !staleResult;

  return result(
    check,
    pass,
    `cancelamento=${
      latencyMs === null ? "ausente" : `${latencyMs} ms`
    }, mesma tarefa=${sameTask}, resultado obsoleto=${staleResult}`,
    latencyMs === null
      ? []
      : [measurement("task_cancellation_latency_ms", latencyMs)]
  );
}

function scoreAsyncResultRecovery(check, trace) {
  const taskResult = findEvent(trace, check.result);
  if (!taskResult) {
    return result(check, false, "resultado assíncrono ausente");
  }

  const speech = findFirstAfter(
    trace,
    "assistant.speech.started",
    taskResult.index + 1,
    (event) => event.payload?.kind === "delegated-result"
  );
  const latencyMs = speech
    ? speech.event.atMs - taskResult.event.atMs
    : null;
  const summaryPreserved =
    check.requireSummaryMatch !== true ||
    normalizeText(speech?.event.payload?.text).includes(
      normalizeText(taskResult.event.payload?.summary)
    );
  const pass =
    Boolean(speech) &&
    latencyMs <= check.maxMs &&
    summaryPreserved;

  return result(
    check,
    pass,
    `reentrada=${
      latencyMs === null ? "ausente" : `${latencyMs} ms`
    }, resumo preservado=${summaryPreserved}`,
    latencyMs === null
      ? []
      : [measurement("async_result_recovery_latency_ms", latencyMs)]
  );
}

function scoreEnvironmentSilence(check, trace) {
  const from = findEvent(trace, check.from);
  if (!from) {
    return result(check, false, `âncora ausente: ${check.from.type}`);
  }

  const forbidden = trace
    .slice(from.index + 1)
    .filter((event) => check.forbiddenTypes.includes(event.type));
  return result(
    check,
    forbidden.length === 0,
    forbidden.length === 0
      ? "nenhuma ativação para fala ambiente não direcionada"
      : `${forbidden.length} ativação(ões) indevida(s): ${forbidden
          .map((event) => `${event.type}@${event.atMs}`)
          .join(", ")}`,
    [measurement("false_activation_count", forbidden.length, "count")]
  );
}

const SCORERS = {
  async_result_recovery: scoreAsyncResultRecovery,
  backchannel_adequacy: scoreBackchannelAdequacy,
  cancellation_integrity: scoreCancellationIntegrity,
  correction_preserved: scoreCorrectionPreserved,
  delegation_ack: scoreDelegationAck,
  environment_silence: scoreEnvironmentSilence,
  false_cut: scoreFalseCut,
  interruption_stop: scoreInterruptionStop,
  useful_speech_latency: scoreUsefulSpeechLatency
};

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(values) {
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

export function scorePerceptionPack(pack, tracesByScenarioId) {
  const scenarios = pack.scenarios.map((scenario) => {
    const trace = tracesByScenarioId.get(scenario.sourceScenarioId);
    const checks = scenario.checks.map((check) =>
      SCORERS[check.kind](check, trace)
    );
    return {
      id: scenario.id,
      sourceScenarioId: scenario.sourceScenarioId,
      category: scenario.category,
      userPerception: scenario.userPerception,
      pass: checks.every((check) => check.pass),
      checks,
      trace
    };
  });
  const checks = scenarios.flatMap((scenario) => scenario.checks);
  const critical = checks.filter((check) => check.severity === "critical");
  const guardrails = checks.filter((check) => check.severity === "guardrail");
  const valuesByMetric = new Map();

  for (const check of checks) {
    for (const item of check.measurements) {
      if (!Number.isFinite(item.value)) {
        continue;
      }
      const values = valuesByMetric.get(item.name) ?? [];
      values.push(item.value);
      valuesByMetric.set(item.name, values);
    }
  }

  const metrics = Object.fromEntries(
    [...valuesByMetric.entries()].map(([name, values]) => [
      name,
      summarize(values)
    ])
  );
  const passed = checks.filter((check) => check.pass).length;
  const weightedTotal = critical.length * 5 + guardrails.length * 2;
  const weightedPassed =
    critical.filter((check) => check.pass).length * 5 +
    guardrails.filter((check) => check.pass).length * 2;

  return {
    packId: pack.id,
    tracePackId: pack.tracePackId,
    summary: {
      scenarioCount: scenarios.length,
      passedScenarios: scenarios.filter((scenario) => scenario.pass).length,
      automatedCheckCount: checks.length,
      passedAutomatedChecks: passed,
      failedAutomatedChecks: checks.length - passed,
      automatedPassRate:
        checks.length === 0
          ? 0
          : Math.round((passed / checks.length) * 10_000) / 10_000,
      criticalCheckCount: critical.length,
      failedCriticalChecks: critical.filter((check) => !check.pass).length,
      guardrailCheckCount: guardrails.length,
      failedGuardrails: guardrails.filter((check) => !check.pass).length,
      diagnosticImpactScore:
        weightedTotal === 0
          ? 0
          : Math.round((weightedPassed / weightedTotal) * 10_000) / 100,
      diagnosticImpactScoreIsAuthoritative: false
    },
    metrics,
    scenarios,
    evidence: {
      automatedProxies: checks.map((check) => ({
        scenarioId: scenarios.find((scenario) =>
          scenario.checks.includes(check)
        )?.id,
        checkId: check.id,
        proxyFor: check.proxyFor,
        severity: check.severity,
        pass: check.pass
      })),
      deferredMeasurements: pack.deferredMeasurements.map((measurement) => ({
        ...measurement,
        evidence: measurement.requires,
        status: "not_measured"
      }))
    }
  };
}
