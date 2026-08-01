export const TRAINING_TRACE_VERSION = "training-trace-v1";
export const INTERRUPTION_TRACE_SLICE_VERSION =
  "output-interruption-training-trace-v0.1";

const EFFECT_STAGES = Object.freeze([
  "accepted",
  "rejected",
  "dispatched",
  "player-received",
  "audible",
  "renderer-silent",
  "cancelled",
  "completed",
  "externally-observed"
]);
const TERMINAL_EFFECT_STAGES = new Set([
  "rejected",
  "cancelled",
  "completed"
]);
const POLICY_MODES = new Set(["authority", "shadow"]);
const AUTHORITY_DECISIONS = new Set([
  "ACCEPT",
  "REJECT",
  "WAIT_FOR_EVIDENCE",
  "SAFETY_OVERRIDE",
  "OBSERVE_ONLY"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function identifier(value, label, options = {}) {
  if (value === null && options.optional === true) {
    return null;
  }
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > (options.maxLength ?? 200)) {
    throw new TypeError(`${label} precisa ser um identificador válido`);
  }
  return normalized;
}

function finiteNumber(value, label, options = {}) {
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    (options.nonNegative === true && number < 0) ||
    (options.positive === true && number <= 0)
  ) {
    throw new TypeError(`${label} precisa ser um número válido`);
  }
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${label} precisa ser inteiro não negativo`);
  }
  return number;
}

function sha256Ref(value, label) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) {
    throw new TypeError(`${label} precisa usar sha256:<64 hex>`);
  }
  return normalized;
}

function jsonValue(value, label) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} contém número não finito`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      jsonValue(item, `${label}[${index}]`)
    );
  }
  if (
    value &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    const normalized = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) {
        throw new TypeError(`${label}.${key} não pode ser undefined`);
      }
      normalized[key] = jsonValue(nested, `${label}.${key}`);
    }
    return normalized;
  }
  throw new TypeError(`${label} precisa ser JSON serializável`);
}

function nextId(sequences, prefix) {
  const next = (sequences[prefix] ?? 0) + 1;
  sequences[prefix] = next;
  return `${prefix}-${String(next).padStart(6, "0")}`;
}

function normalizeClock(clock = {}) {
  return {
    clockId: identifier(
      clock.clockId ?? "browser-performance",
      "clockId"
    ),
    kind: "monotonic",
    processId: identifier(
      clock.processId ?? "browser-main",
      "processId"
    ),
    resolutionMs: finiteNumber(
      clock.resolutionMs ?? 0.1,
      "resolutionMs",
      { positive: true }
    ),
    mappingMethod: clock.mappingMethod ?? "identity-within-process",
    mappingPoints: []
  };
}

export function createTrainingTraceBundle(options = {}) {
  const clock = normalizeClock(options.clock);
  return deepFreeze({
    schemaVersion: TRAINING_TRACE_VERSION,
    sliceVersion: INTERRUPTION_TRACE_SLICE_VERSION,
    session: {
      sessionId: identifier(options.sessionId, "sessionId"),
      startedAtEpochMs: nonNegativeInteger(
        options.startedAtEpochMs,
        "startedAtEpochMs"
      ),
      locale: identifier(options.locale ?? "pt-BR", "locale"),
      candidate: identifier(options.candidate, "candidate"),
      configHash: sha256Ref(options.configHash, "configHash")
    },
    clocks: [clock],
    streams: [],
    events: [],
    contexts: [],
    decisions: [],
    effects: [],
    labels: [],
    derivedFeatureManifests: [],
    limitations: [
      "fatia sem áudio persistido; posições acústicas e streams hasheados " +
        "permanecem fora deste bundle"
    ]
  });
}

function mutableBundle(options) {
  return structuredClone(createTrainingTraceBundle(options));
}

function normalizeIntent(intent, index) {
  if (!intent || typeof intent !== "object") {
    throw new TypeError(`intents[${index}] precisa ser objeto`);
  }
  const type = identifier(intent.type, `intents[${index}].type`);
  const origin = identifier(
    intent.origin ?? "unknown-policy",
    `intents[${index}].origin`
  );
  const payload = { ...intent };
  delete payload.type;
  delete payload.origin;
  return {
    type,
    origin,
    payload: jsonValue(payload, `intents[${index}].payload`)
  };
}

function terminalStage(effect) {
  return effect.stages.findLast((entry) =>
    TERMINAL_EFFECT_STAGES.has(entry.stage)
  )?.stage ?? null;
}

export class TrainingTraceRecorder {
  #bundle;
  #sequences = {};
  #effects = new Map();

  constructor(options) {
    this.reset(options);
  }

  get sessionId() {
    return this.#bundle.session.sessionId;
  }

  get snapshot() {
    return deepFreeze(structuredClone(this.#bundle));
  }

  reset(options) {
    this.#bundle = mutableBundle(options);
    this.#sequences = {};
    this.#effects = new Map();
    return this.snapshot;
  }

  recordDecision(input = {}) {
    const atMs = finiteNumber(input.atMs, "atMs", {
      nonNegative: true
    });
    const clockId = identifier(
      input.clockId ?? this.#bundle.clocks[0].clockId,
      "clockId"
    );
    if (!this.#bundle.clocks.some((clock) => clock.clockId === clockId)) {
      throw new TypeError(`clockId desconhecido: ${clockId}`);
    }
    const turnId = input.turnId === null || input.turnId === undefined
      ? null
      : identifier(input.turnId, "turnId");
    const epoch = nonNegativeInteger(input.epoch, "epoch");
    const eventType = identifier(input.event?.type, "event.type");
    const eventSource = identifier(
      input.event?.source,
      "event.source"
    );
    const eventPayload = jsonValue(
      input.event?.payload ?? {},
      "event.payload"
    );
    const contextState = jsonValue(
      input.context?.state ?? {},
      "context.state"
    );
    const policyId = identifier(input.policy?.id, "policy.id");
    const policyVersion = identifier(
      input.policy?.version,
      "policy.version"
    );
    const policyMode = identifier(
      input.policy?.mode ?? "authority",
      "policy.mode"
    );
    if (!POLICY_MODES.has(policyMode)) {
      throw new TypeError(`policy.mode não suportado: ${policyMode}`);
    }
    const intents = (input.intents ?? []).map(normalizeIntent);
    const authorityDecision = input.authorityDecision ?? (
      policyMode === "shadow"
        ? "OBSERVE_ONLY"
        : intents.length > 0
          ? "ACCEPT"
          : "REJECT"
    );
    if (!AUTHORITY_DECISIONS.has(authorityDecision)) {
      throw new TypeError(
        `authorityDecision não suportada: ${authorityDecision}`
      );
    }
    if (policyMode === "shadow" && authorityDecision !== "OBSERVE_ONLY") {
      throw new TypeError("política shadow não pode receber autoridade");
    }
    if (authorityDecision === "ACCEPT" && intents.length === 0) {
      throw new TypeError("ACCEPT exige ao menos uma intenção");
    }
    const transition = jsonValue(
      input.transition ?? {},
      "transition"
    );

    const eventId = nextId(this.#sequences, "event");
    const contextId = nextId(this.#sequences, "context");
    const decisionId = nextId(this.#sequences, "decision");
    this.#bundle.events.push({
      eventId,
      sessionId: this.#bundle.session.sessionId,
      turnId,
      epoch,
      type: eventType,
      source: eventSource,
      clockId,
      atMs,
      payload: eventPayload
    });
    this.#bundle.contexts.push({
      contextId,
      turnId,
      epoch,
      availableAt: { clockId, atMs },
      eventIds: [eventId],
      state: contextState,
      derivedFeatureRefs: []
    });
    const decision = {
      decisionId,
      turnId,
      epoch,
      clockId,
      atMs,
      triggeredBy: [eventId],
      supersedes: [],
      policy: {
        id: policyId,
        version: policyVersion,
        mode: policyMode
      },
      outputs: intents.map((intent) => ({
        intent: intent.type,
        origin: intent.origin,
        payload: intent.payload
      })),
      proposal: intents[0]?.type ?? null,
      authorityDecision,
      decisionContextRef: contextId,
      transition
    };
    this.#bundle.decisions.push(decision);

    const labelId = nextId(this.#sequences, "label");
    this.#bundle.labels.push({
      labelId,
      targetId: decisionId,
      task: "output-interruption-intent",
      value: intents.map((intent) => intent.type),
      source: {
        kind: "deterministic-invariant",
        ref: policyId,
        version: policyVersion
      },
      confidence: 1
    });

    const effects = [];
    if (authorityDecision === "ACCEPT") {
      for (const intent of intents) {
        const effectId = nextId(this.#sequences, "effect");
        const effect = {
          effectId,
          origin: intent.origin,
          triggeredBy: [eventId],
          decisionId,
          reconciledByDecisionId: null,
          effectType: intent.type,
          epoch,
          status: "accepted",
          payload: intent.payload,
          stages: [{
            stage: "accepted",
            clockId,
            atMs,
            evidence: {}
          }]
        };
        this.#bundle.effects.push(effect);
        this.#effects.set(effectId, effect);
        effects.push({ effectId, effectType: intent.type });
      }
    }

    return deepFreeze({
      eventId,
      contextId,
      decisionId,
      effects
    });
  }

  recordEffectStage(effectId, input = {}) {
    const normalizedId = identifier(effectId, "effectId");
    const effect = this.#effects.get(normalizedId);
    if (!effect) {
      throw new TypeError(`effectId desconhecido: ${normalizedId}`);
    }
    const stage = identifier(input.stage, "stage");
    if (!EFFECT_STAGES.includes(stage) || stage === "accepted") {
      throw new TypeError(`estágio de efeito não suportado: ${stage}`);
    }
    if (terminalStage(effect) !== null) {
      throw new TypeError(
        `efeito ${normalizedId} já terminou em ${terminalStage(effect)}`
      );
    }
    if (effect.stages.some((entry) => entry.stage === stage)) {
      throw new TypeError(
        `efeito ${normalizedId} já registrou o estágio ${stage}`
      );
    }
    const clockId = identifier(
      input.clockId ?? this.#bundle.clocks[0].clockId,
      "clockId"
    );
    if (!this.#bundle.clocks.some((clock) => clock.clockId === clockId)) {
      throw new TypeError(`clockId desconhecido: ${clockId}`);
    }
    const atMs = finiteNumber(input.atMs, "atMs", {
      nonNegative: true
    });
    const previous = effect.stages.at(-1);
    if (previous.clockId === clockId && atMs < previous.atMs) {
      throw new RangeError("estágio de efeito não pode voltar no tempo");
    }
    if (
      input.reconciledByDecisionId !== null &&
      input.reconciledByDecisionId !== undefined
    ) {
      const reconciliationId = identifier(
        input.reconciledByDecisionId,
        "reconciledByDecisionId"
      );
      if (
        !this.#bundle.decisions.some(
          (decision) => decision.decisionId === reconciliationId
        )
      ) {
        throw new TypeError(
          `reconciledByDecisionId desconhecido: ${reconciliationId}`
        );
      }
      if (
        effect.reconciledByDecisionId !== null &&
        effect.reconciledByDecisionId !== reconciliationId
      ) {
        throw new TypeError(
          `efeito ${normalizedId} já foi reconciliado por outra decisão`
        );
      }
      effect.reconciledByDecisionId = reconciliationId;
    }
    effect.stages.push({
      stage,
      clockId,
      atMs,
      evidence: jsonValue(input.evidence ?? {}, "evidence")
    });
    effect.status = stage;
    return deepFreeze(structuredClone(effect));
  }
}

function duplicateIds(records, field) {
  const seen = new Set();
  return records
    .map((record) => record?.[field])
    .filter((id) => {
      if (seen.has(id)) {
        return true;
      }
      seen.add(id);
      return false;
    });
}

export function validateTrainingTraceBundle(bundle) {
  const errors = [];
  if (bundle?.schemaVersion !== TRAINING_TRACE_VERSION) {
    errors.push("schemaVersion incompatível");
  }
  if (bundle?.sliceVersion !== INTERRUPTION_TRACE_SLICE_VERSION) {
    errors.push("sliceVersion incompatível");
  }
  try {
    identifier(bundle?.session?.sessionId, "sessionId");
    sha256Ref(bundle?.session?.configHash, "configHash");
  } catch (error) {
    errors.push(error.message);
  }
  const collections = [
    ["events", "eventId"],
    ["contexts", "contextId"],
    ["decisions", "decisionId"],
    ["effects", "effectId"],
    ["labels", "labelId"]
  ];
  for (const [name, field] of collections) {
    if (!Array.isArray(bundle?.[name])) {
      errors.push(`${name} precisa ser array`);
      continue;
    }
    if (duplicateIds(bundle[name], field).length > 0) {
      errors.push(`${name} contém IDs duplicados`);
    }
  }
  if (errors.some((error) => /precisa ser array/u.test(error))) {
    return deepFreeze({ valid: false, errors, counts: {} });
  }

  const clockIds = new Set(
    (bundle.clocks ?? []).map((clock) => clock.clockId)
  );
  const eventIds = new Set(bundle.events.map((event) => event.eventId));
  const contextIds = new Set(
    bundle.contexts.map((context) => context.contextId)
  );
  const decisionIds = new Set(
    bundle.decisions.map((decision) => decision.decisionId)
  );
  for (const event of bundle.events) {
    if (!clockIds.has(event.clockId)) {
      errors.push(`${event.eventId} usa clock desconhecido`);
    }
    if (event.sessionId !== bundle.session?.sessionId) {
      errors.push(`${event.eventId} usa sessionId divergente`);
    }
  }
  for (const context of bundle.contexts) {
    if (!clockIds.has(context.availableAt?.clockId)) {
      errors.push(`${context.contextId} usa clock desconhecido`);
    }
    if (!context.eventIds?.every((id) => eventIds.has(id))) {
      errors.push(`${context.contextId} referencia evento ausente`);
    }
    for (const eventId of context.eventIds ?? []) {
      const event = bundle.events.find(
        (candidate) => candidate.eventId === eventId
      );
      if (
        event?.clockId === context.availableAt?.clockId &&
        event.atMs > context.availableAt.atMs
      ) {
        errors.push(`${context.contextId} inclui evento do futuro`);
      }
    }
  }
  for (const decision of bundle.decisions) {
    if (!contextIds.has(decision.decisionContextRef)) {
      errors.push(`${decision.decisionId} referencia contexto ausente`);
    }
    if (!decision.triggeredBy?.every((id) => eventIds.has(id))) {
      errors.push(`${decision.decisionId} referencia evento ausente`);
    }
    for (const eventId of decision.triggeredBy ?? []) {
      const event = bundle.events.find(
        (candidate) => candidate.eventId === eventId
      );
      if (
        event?.clockId === decision.clockId &&
        event.atMs > decision.atMs
      ) {
        errors.push(`${decision.decisionId} usa evento do futuro`);
      }
    }
    if (!clockIds.has(decision.clockId)) {
      errors.push(`${decision.decisionId} usa clock desconhecido`);
    }
    if (
      decision.policy?.mode === "shadow" &&
      decision.authorityDecision !== "OBSERVE_ONLY"
    ) {
      errors.push(`${decision.decisionId} deu autoridade a shadow`);
    }
    if (!POLICY_MODES.has(decision.policy?.mode)) {
      errors.push(`${decision.decisionId} usa policy.mode inválido`);
    }
    if (!AUTHORITY_DECISIONS.has(decision.authorityDecision)) {
      errors.push(`${decision.decisionId} usa authorityDecision inválida`);
    }
    const context = bundle.contexts.find(
      (candidate) => candidate.contextId === decision.decisionContextRef
    );
    if (
      context?.availableAt?.clockId === decision.clockId &&
      context.availableAt.atMs > decision.atMs
    ) {
      errors.push(`${decision.decisionId} usa contexto do futuro`);
    }
    const effects = bundle.effects.filter(
      (effect) => effect.decisionId === decision.decisionId
    );
    if (decision.authorityDecision === "ACCEPT") {
      const expected = decision.outputs.map((output) => output.intent).sort();
      const observed = effects.map((effect) => effect.effectType).sort();
      if (JSON.stringify(expected) !== JSON.stringify(observed)) {
        errors.push(`${decision.decisionId} diverge de seus efeitos`);
      }
    } else if (effects.length > 0) {
      errors.push(`${decision.decisionId} sem ACCEPT produziu efeito`);
    }
  }
  for (const effect of bundle.effects) {
    const effectDecision = bundle.decisions.find(
      (decision) => decision.decisionId === effect.decisionId
    );
    if (!decisionIds.has(effect.decisionId)) {
      errors.push(`${effect.effectId} referencia decisão ausente`);
    }
    if (!effect.triggeredBy?.every((id) => eventIds.has(id))) {
      errors.push(`${effect.effectId} referencia evento ausente`);
    }
    if (
      effect.reconciledByDecisionId !== null &&
      !decisionIds.has(effect.reconciledByDecisionId)
    ) {
      errors.push(`${effect.effectId} referencia reconciliação ausente`);
    }
    if (effect.stages?.[0]?.stage !== "accepted") {
      errors.push(`${effect.effectId} não começa em accepted`);
    }
    if (
      effectDecision &&
      (
        effect.stages?.[0]?.clockId !== effectDecision.clockId ||
        effect.stages?.[0]?.atMs !== effectDecision.atMs
      )
    ) {
      errors.push(`${effect.effectId} não nasce com sua decisão`);
    }
    const seenStages = new Set();
    let terminalSeen = false;
    let previous = null;
    for (const stage of effect.stages ?? []) {
      if (!EFFECT_STAGES.includes(stage.stage)) {
        errors.push(`${effect.effectId} possui estágio inválido`);
      }
      if (seenStages.has(stage.stage)) {
        errors.push(`${effect.effectId} duplica estágio ${stage.stage}`);
      }
      if (terminalSeen) {
        errors.push(`${effect.effectId} possui estágio após término`);
      }
      if (!clockIds.has(stage.clockId)) {
        errors.push(`${effect.effectId} usa clock desconhecido`);
      }
      if (
        previous?.clockId === stage.clockId &&
        stage.atMs < previous.atMs
      ) {
        errors.push(`${effect.effectId} volta no tempo`);
      }
      seenStages.add(stage.stage);
      terminalSeen ||= TERMINAL_EFFECT_STAGES.has(stage.stage);
      previous = stage;
    }
    if (effect.status !== effect.stages?.at(-1)?.stage) {
      errors.push(`${effect.effectId} possui status divergente`);
    }
  }
  for (const label of bundle.labels) {
    if (!decisionIds.has(label.targetId)) {
      errors.push(`${label.labelId} referencia decisão ausente`);
    }
    if (
      !label.source?.kind ||
      !label.source?.ref ||
      !label.source?.version
    ) {
      errors.push(`${label.labelId} não possui proveniência completa`);
    }
  }
  for (const decision of bundle.decisions) {
    if (!bundle.labels.some((label) => label.targetId === decision.decisionId)) {
      errors.push(`${decision.decisionId} não possui rótulo`);
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    counts: {
      events: bundle.events.length,
      contexts: bundle.contexts.length,
      decisions: bundle.decisions.length,
      effects: bundle.effects.length,
      labels: bundle.labels.length
    }
  });
}

export function projectTrainingTraceToEvaluationTrace(bundle) {
  const validation = validateTrainingTraceBundle(bundle);
  if (!validation.valid) {
    throw new TypeError(
      `training trace inválido: ${validation.errors.join("; ")}`
    );
  }
  const projected = [];
  for (const effect of bundle.effects) {
    if (effect.effectType === "PAUSE_OUTPUT") {
      const stopped = effect.stages.find(
        (stage) => stage.stage === "renderer-silent"
      );
      if (stopped) {
        projected.push({
          absoluteAtMs: stopped.atMs,
          clockId: stopped.clockId,
          type: "assistant.speech.stopped",
          payload: {
            effectId: effect.effectId,
            intent: effect.effectType,
            measurement: "browser-renderer"
          },
          source: "runtime"
        });
      }
    }
    if (effect.effectType === "RESUME_OUTPUT") {
      const audible = effect.stages.find(
        (stage) => stage.stage === "audible"
      );
      if (audible) {
        projected.push({
          absoluteAtMs: audible.atMs,
          clockId: audible.clockId,
          type: "assistant.speech.started",
          payload: {
            effectId: effect.effectId,
            intent: effect.effectType,
            kind: "resumed"
          },
          source: "runtime"
        });
      }
    }
  }
  projected.sort(
    (left, right) => left.absoluteAtMs - right.absoluteAtMs
  );
  const originAtMs = projected[0]?.absoluteAtMs ?? 0;
  return deepFreeze({
    schemaVersion: "trace-v0-projection-v1",
    sessionId: bundle.session.sessionId,
    mapping: {
      pause: "PAUSE_OUTPUT.renderer-silent -> assistant.speech.stopped",
      resume: "RESUME_OUTPUT.audible -> assistant.speech.started"
    },
    events: projected.map(({ absoluteAtMs, ...event }) => ({
      ...event,
      atMs: absoluteAtMs - originAtMs
    }))
  });
}

export { EFFECT_STAGES };
