import { isKnownEventType, validateEvent } from "../contracts/events.mjs";

const EXPECTATION_KINDS = new Set([
  "forbidden",
  "latency",
  "payload",
  "required",
  "sequence"
]);

function assertEventType(type, label) {
  if (!isKnownEventType(type)) {
    throw new TypeError(`${label} contém tipo de evento desconhecido: ${type}`);
  }
}

function validateExpectation(expectation, index) {
  const label = `expectations[${index}]`;

  if (!expectation || typeof expectation !== "object") {
    throw new TypeError(`${label} deve ser um objeto`);
  }

  if (!expectation.id || typeof expectation.id !== "string") {
    throw new TypeError(`${label}.id é obrigatório`);
  }

  if (!EXPECTATION_KINDS.has(expectation.kind)) {
    throw new TypeError(`${label}.kind desconhecido: ${expectation.kind}`);
  }

  if (expectation.kind === "latency") {
    assertEventType(expectation.from, `${label}.from`);
    assertEventType(expectation.to, `${label}.to`);
    if (
      expectation.minMs === undefined &&
      expectation.maxMs === undefined
    ) {
      throw new TypeError(`${label} precisa de minMs ou maxMs`);
    }
  }

  if (expectation.kind === "required") {
    assertEventType(expectation.event, `${label}.event`);
    if (expectation.after) {
      assertEventType(expectation.after, `${label}.after`);
    }
  }

  if (expectation.kind === "forbidden") {
    assertEventType(expectation.event, `${label}.event`);
    if (expectation.after) {
      assertEventType(expectation.after, `${label}.after`);
    }
    if (expectation.until) {
      assertEventType(expectation.until, `${label}.until`);
    }
  }

  if (expectation.kind === "payload") {
    assertEventType(expectation.event, `${label}.event`);
    if (!expectation.path || typeof expectation.path !== "string") {
      throw new TypeError(`${label}.path é obrigatório`);
    }
  }

  if (expectation.kind === "sequence") {
    if (!Array.isArray(expectation.events) || expectation.events.length < 2) {
      throw new TypeError(`${label}.events precisa de ao menos dois eventos`);
    }
    expectation.events.forEach((type, eventIndex) =>
      assertEventType(type, `${label}.events[${eventIndex}]`)
    );
  }
}

export function validateScenario(scenario, label = "cenário") {
  if (!scenario || typeof scenario !== "object") {
    throw new TypeError(`${label} deve ser um objeto`);
  }

  for (const field of ["id", "category", "description"]) {
    if (!scenario[field] || typeof scenario[field] !== "string") {
      throw new TypeError(`${label}.${field} é obrigatório`);
    }
  }

  if (!Array.isArray(scenario.timeline) || scenario.timeline.length === 0) {
    throw new TypeError(`${label}.timeline não pode estar vazia`);
  }

  let previousAtMs = -1;
  scenario.timeline.forEach((event, index) => {
    validateEvent(event, `${label}.timeline[${index}]`);
    if (event.atMs < previousAtMs) {
      throw new TypeError(`${label}.timeline deve estar ordenada por atMs`);
    }
    previousAtMs = event.atMs;
  });

  if (
    !Array.isArray(scenario.expectations) ||
    scenario.expectations.length === 0
  ) {
    throw new TypeError(`${label}.expectations não pode estar vazia`);
  }

  scenario.expectations.forEach(validateExpectation);
  return scenario;
}

export function validateScenarioPack(pack) {
  if (!pack || typeof pack !== "object") {
    throw new TypeError("pack deve ser um objeto");
  }

  if (pack.schemaVersion !== 1) {
    throw new TypeError(`schemaVersion não suportada: ${pack.schemaVersion}`);
  }

  if (!pack.id || typeof pack.id !== "string") {
    throw new TypeError("pack.id é obrigatório");
  }

  if (!Array.isArray(pack.scenarios) || pack.scenarios.length === 0) {
    throw new TypeError("pack.scenarios não pode estar vazio");
  }

  const ids = new Set();
  pack.scenarios.forEach((scenario, index) => {
    validateScenario(scenario, `scenarios[${index}]`);
    if (ids.has(scenario.id)) {
      throw new TypeError(`scenario.id duplicado: ${scenario.id}`);
    }
    ids.add(scenario.id);
  });

  return pack;
}
