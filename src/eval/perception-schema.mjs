import { isKnownEventType } from "../contracts/events.mjs";

const CHECK_KINDS = new Set([
  "async_result_recovery",
  "backchannel_adequacy",
  "cancellation_integrity",
  "correction_preserved",
  "delegation_ack",
  "environment_silence",
  "false_cut",
  "interruption_stop",
  "useful_speech_latency"
]);

const SEVERITIES = new Set(["critical", "guardrail"]);
const EVIDENCE_KINDS = new Set(["human_judgment", "physical_audio"]);

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} deve ser uma string não vazia`);
  }
}

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} deve ser um número não negativo`);
  }
}

function assertEventType(type, label) {
  if (!isKnownEventType(type)) {
    throw new TypeError(`${label} contém tipo de evento desconhecido: ${type}`);
  }
}

function validateSelector(selector, label) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    throw new TypeError(`${label} deve ser um objeto`);
  }
  assertEventType(selector.type, `${label}.type`);
  if (
    selector.occurrence !== undefined &&
    (!Number.isInteger(selector.occurrence) || selector.occurrence < 1)
  ) {
    throw new TypeError(`${label}.occurrence deve ser um inteiro positivo`);
  }
}

function validateStringArray(value, label, minimumLength = 1) {
  if (!Array.isArray(value) || value.length < minimumLength) {
    throw new TypeError(`${label} precisa de ao menos ${minimumLength} item(ns)`);
  }
  value.forEach((item, index) =>
    assertNonEmptyString(item, `${label}[${index}]`)
  );
}

function validateCheck(check, label) {
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    throw new TypeError(`${label} deve ser um objeto`);
  }

  assertNonEmptyString(check.id, `${label}.id`);
  if (!CHECK_KINDS.has(check.kind)) {
    throw new TypeError(`${label}.kind desconhecido: ${check.kind}`);
  }
  if (!SEVERITIES.has(check.severity)) {
    throw new TypeError(`${label}.severity desconhecida: ${check.severity}`);
  }
  assertNonEmptyString(check.proxyFor, `${label}.proxyFor`);

  if (check.anchor) {
    validateSelector(check.anchor, `${label}.anchor`);
  }
  if (check.trigger) {
    validateSelector(check.trigger, `${label}.trigger`);
  }
  if (check.from) {
    validateSelector(check.from, `${label}.from`);
  }
  if (check.until) {
    validateSelector(check.until, `${label}.until`);
  }
  if (check.correction) {
    validateSelector(check.correction, `${label}.correction`);
  }
  if (check.cancellation) {
    validateSelector(check.cancellation, `${label}.cancellation`);
  }
  if (check.result) {
    validateSelector(check.result, `${label}.result`);
  }

  for (const field of [
    "maxMs",
    "minMs",
    "maxCount",
    "maxWords",
    "maxDelegationMs",
    "maxAcknowledgmentMs",
    "maxRollbackMs"
  ]) {
    if (check[field] !== undefined) {
      assertFiniteNonNegative(check[field], `${label}.${field}`);
    }
  }

  if (check.usableKinds) {
    validateStringArray(check.usableKinds, `${label}.usableKinds`);
  }
  if (check.allowedTexts) {
    validateStringArray(check.allowedTexts, `${label}.allowedTexts`);
  }
  if (check.forbiddenTypes) {
    validateStringArray(check.forbiddenTypes, `${label}.forbiddenTypes`);
    check.forbiddenTypes.forEach((type, index) =>
      assertEventType(type, `${label}.forbiddenTypes[${index}]`)
    );
  }

  const requiredByKind = {
    async_result_recovery: ["result", "maxMs"],
    backchannel_adequacy: ["anchor", "until", "maxMs"],
    cancellation_integrity: ["cancellation", "maxMs"],
    correction_preserved: ["correction", "expectedCurrent", "maxRollbackMs"],
    delegation_ack: [
      "anchor",
      "maxDelegationMs",
      "maxAcknowledgmentMs"
    ],
    environment_silence: ["from", "forbiddenTypes"],
    false_cut: ["from", "until", "maxCount"],
    interruption_stop: ["trigger", "maxMs"],
    useful_speech_latency: ["anchor", "maxMs", "metric"]
  };

  for (const field of requiredByKind[check.kind]) {
    if (check[field] === undefined) {
      throw new TypeError(`${label}.${field} é obrigatório`);
    }
  }

  if (check.metric !== undefined) {
    assertNonEmptyString(check.metric, `${label}.metric`);
  }
  if (check.expectedCurrent !== undefined) {
    assertNonEmptyString(check.expectedCurrent, `${label}.expectedCurrent`);
  }
}

function validateDeferredMeasurement(measurement, label) {
  if (
    !measurement ||
    typeof measurement !== "object" ||
    Array.isArray(measurement)
  ) {
    throw new TypeError(`${label} deve ser um objeto`);
  }

  for (const field of ["id", "metric", "whyProxyIsInsufficient"]) {
    assertNonEmptyString(measurement[field], `${label}.${field}`);
  }
  if (!EVIDENCE_KINDS.has(measurement.requires)) {
    throw new TypeError(`${label}.requires desconhecido: ${measurement.requires}`);
  }
  if (typeof measurement.blocksUserFacingRelease !== "boolean") {
    throw new TypeError(
      `${label}.blocksUserFacingRelease deve ser booleano`
    );
  }
}

export function validatePerceptionPack(pack) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    throw new TypeError("pack perceptual deve ser um objeto");
  }
  if (pack.schemaVersion !== 1) {
    throw new TypeError(
      `schemaVersion perceptual não suportada: ${pack.schemaVersion}`
    );
  }

  for (const field of ["id", "tracePackId", "locale"]) {
    assertNonEmptyString(pack[field], `pack.${field}`);
  }
  if (!Array.isArray(pack.scenarios) || pack.scenarios.length === 0) {
    throw new TypeError("pack.scenarios não pode estar vazio");
  }

  const scenarioIds = new Set();
  const checkIds = new Set();
  pack.scenarios.forEach((scenario, scenarioIndex) => {
    const label = `pack.scenarios[${scenarioIndex}]`;
    for (const field of [
      "id",
      "sourceScenarioId",
      "userPerception",
      "category"
    ]) {
      assertNonEmptyString(scenario[field], `${label}.${field}`);
    }
    if (scenarioIds.has(scenario.id)) {
      throw new TypeError(`scenario.id duplicado: ${scenario.id}`);
    }
    scenarioIds.add(scenario.id);

    if (!Array.isArray(scenario.checks) || scenario.checks.length === 0) {
      throw new TypeError(`${label}.checks não pode estar vazio`);
    }
    scenario.checks.forEach((check, checkIndex) => {
      validateCheck(check, `${label}.checks[${checkIndex}]`);
      if (checkIds.has(check.id)) {
        throw new TypeError(`check.id duplicado: ${check.id}`);
      }
      checkIds.add(check.id);
    });
  });

  if (
    !Array.isArray(pack.deferredMeasurements) ||
    pack.deferredMeasurements.length === 0
  ) {
    throw new TypeError(
      "pack.deferredMeasurements deve explicitar o que a automação não mede"
    );
  }
  pack.deferredMeasurements.forEach((measurement, index) =>
    validateDeferredMeasurement(
      measurement,
      `pack.deferredMeasurements[${index}]`
    )
  );

  return pack;
}

export function validatePerceptionGate(gate) {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    throw new TypeError("gate perceptual deve ser um objeto");
  }
  if (gate.schemaVersion !== 1) {
    throw new TypeError(
      `schemaVersion do gate não suportada: ${gate.schemaVersion}`
    );
  }
  for (const field of ["id", "decisionScope"]) {
    assertNonEmptyString(gate[field], `gate.${field}`);
  }
  if (
    !Number.isFinite(gate.minAutomatedPassRate) ||
    gate.minAutomatedPassRate < 0 ||
    gate.minAutomatedPassRate > 1
  ) {
    throw new TypeError("gate.minAutomatedPassRate deve estar entre 0 e 1");
  }
  if (
    !Number.isInteger(gate.maxFailedGuardrails) ||
    gate.maxFailedGuardrails < 0
  ) {
    throw new TypeError("gate.maxFailedGuardrails deve ser um inteiro >= 0");
  }

  for (const [metric, requirement] of Object.entries(
    gate.requiredMetricSamples ?? {}
  )) {
    assertNonEmptyString(metric, "nome da métrica");
    if (!Number.isInteger(requirement) || requirement < 1) {
      throw new TypeError(
        `gate.requiredMetricSamples.${metric} deve ser um inteiro positivo`
      );
    }
  }

  for (const [metric, limit] of Object.entries(gate.metricLimits ?? {})) {
    assertNonEmptyString(metric, "nome da métrica");
    if (!["average", "max", "min", "p50", "p95"].includes(limit.stat)) {
      throw new TypeError(
        `gate.metricLimits.${metric}.stat não é suportado: ${limit.stat}`
      );
    }
    if (limit.min === undefined && limit.max === undefined) {
      throw new TypeError(
        `gate.metricLimits.${metric} precisa de min ou max`
      );
    }
    if (limit.min !== undefined) {
      assertFiniteNonNegative(
        limit.min,
        `gate.metricLimits.${metric}.min`
      );
    }
    if (limit.max !== undefined) {
      assertFiniteNonNegative(
        limit.max,
        `gate.metricLimits.${metric}.max`
      );
    }
  }

  return gate;
}
