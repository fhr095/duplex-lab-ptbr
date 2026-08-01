export const LOCAL_AUDIO_REFLEX_VERSION = "local-audio-reflex-v0.1";

export const LOCAL_AUDIO_REFLEX_MODES = Object.freeze({
  IMMEDIATE: "immediate",
  EVIDENCE_GATED: "evidence-gated"
});

const SILERO_DETECTOR = "silero-vad-v6.2";
const DEFAULT_SUPPORT_PROBABILITY = 0.75;
const DEFAULT_SUPPORT_WINDOWS = 2;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function finiteProbability(value, label) {
  const probability = Number(value);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new TypeError(`${label} precisa estar no intervalo [0, 1]`);
  }
  return probability;
}

function optionalSample(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  const sample = Number(value);
  if (!Number.isSafeInteger(sample) || sample < 0) {
    throw new TypeError(`${label} precisa ser inteiro não negativo`);
  }
  return sample;
}

function nonNegativeInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw new TypeError(`${label} precisa ser inteiro não negativo`);
  }
  return integer;
}

function normalizeMode(value) {
  if (Object.values(LOCAL_AUDIO_REFLEX_MODES).includes(value)) {
    return value;
  }
  throw new TypeError(`modo de reflexo local não suportado: ${value}`);
}

function normalizeConfig(options = {}) {
  const mode = normalizeMode(
    options.mode ?? LOCAL_AUDIO_REFLEX_MODES.IMMEDIATE
  );
  const supportProbability = finiteProbability(
    options.supportProbability ?? DEFAULT_SUPPORT_PROBABILITY,
    "supportProbability"
  );
  const supportWindows = Number(
    options.supportWindows ?? DEFAULT_SUPPORT_WINDOWS
  );
  if (!Number.isSafeInteger(supportWindows) || supportWindows < 1) {
    throw new TypeError("supportWindows precisa ser inteiro positivo");
  }
  return { mode, supportProbability, supportWindows };
}

function idleFields() {
  return {
    status: "idle",
    turnId: null,
    triggerSampleStart: null,
    lastSampleStart: null,
    observedWindows: 0,
    supportingWindows: 0
  };
}

function normalizeState(input) {
  if (
    !input ||
    typeof input !== "object" ||
    input.schemaVersion !== 1 ||
    input.reflexVersion !== LOCAL_AUDIO_REFLEX_VERSION ||
    !Number.isSafeInteger(input.version) ||
    input.version < 0
  ) {
    throw new TypeError("estado do reflexo local é incompatível");
  }
  const config = normalizeConfig(input.config);
  if (!["idle", "armed", "paused", "suppressed"].includes(input.status)) {
    throw new TypeError("status do reflexo local é inválido");
  }
  return {
    schemaVersion: 1,
    reflexVersion: LOCAL_AUDIO_REFLEX_VERSION,
    version: input.version,
    config,
    status: input.status,
    turnId: input.turnId ?? null,
    triggerSampleStart: optionalSample(
      input.triggerSampleStart,
      "triggerSampleStart"
    ),
    lastSampleStart: optionalSample(input.lastSampleStart, "lastSampleStart"),
    observedWindows: nonNegativeInteger(
      input.observedWindows,
      "observedWindows"
    ),
    supportingWindows: nonNegativeInteger(
      input.supportingWindows,
      "supportingWindows"
    )
  };
}

function nextState(state, fields) {
  return {
    ...state,
    ...fields,
    version: state.version + 1
  };
}

function transition(previous, state, intents, reason) {
  return deepFreeze({
    schemaVersion: 1,
    reflexVersion: LOCAL_AUDIO_REFLEX_VERSION,
    previousStateVersion: previous.version,
    state,
    intents,
    reason
  });
}

function pauseIntent(state, reason, evidence = {}) {
  return {
    type: "PAUSE_OUTPUT",
    origin: "local-audio-reflex",
    reason,
    turnId: state.turnId,
    evidence: {
      triggerSampleStart: state.triggerSampleStart,
      observedWindows: state.observedWindows,
      supportingWindows: state.supportingWindows,
      ...evidence
    }
  };
}

function sameTurn(state, event) {
  return (
    state.turnId === null ||
    event.turnId === null ||
    event.turnId === undefined ||
    state.turnId === event.turnId
  );
}

export function createLocalAudioReflexState(options = {}) {
  return deepFreeze({
    schemaVersion: 1,
    reflexVersion: LOCAL_AUDIO_REFLEX_VERSION,
    version: 0,
    config: normalizeConfig(options),
    ...idleFields()
  });
}

export function reduceLocalAudioReflex(inputState, event) {
  const state = normalizeState(inputState);
  if (!event || typeof event.type !== "string") {
    throw new TypeError("evento do reflexo local é obrigatório");
  }

  if (event.type === "RESET" || event.type === "OUTPUT_RELEASED") {
    const reset = nextState(state, idleFields());
    return transition(state, reset, [], event.type.toLowerCase());
  }

  if (event.type === "USER_SPEECH_STARTED") {
    const assistantAudible = event.assistantAudible === true;
    const assistantPending = event.assistantPending === true;
    if (!assistantAudible && !assistantPending) {
      return transition(state, state, [], "no-assistant-output");
    }

    const turnId = event.turnId ?? null;
    const triggerSampleStart = optionalSample(
      event.triggerSampleStart,
      "triggerSampleStart"
    );
    const probability = event.probability === null ||
      event.probability === undefined
      ? null
      : finiteProbability(event.probability, "probability");
    const canGate =
      state.config.mode === LOCAL_AUDIO_REFLEX_MODES.EVIDENCE_GATED &&
      assistantAudible &&
      event.detector === SILERO_DETECTOR &&
      probability !== null &&
      triggerSampleStart !== null;

    if (!canGate) {
      const paused = nextState(state, {
        status: "paused",
        turnId,
        triggerSampleStart,
        lastSampleStart: triggerSampleStart,
        observedWindows: 0,
        supportingWindows: 0
      });
      return transition(
        state,
        paused,
        [pauseIntent(paused, "immediate-or-non-gateable", { probability })],
        "immediate-or-non-gateable"
      );
    }

    const armed = nextState(state, {
      status: "armed",
      turnId,
      triggerSampleStart,
      lastSampleStart: triggerSampleStart,
      observedWindows: 0,
      supportingWindows: 0
    });
    return transition(state, armed, [{
      type: "WAIT_FOR_EVIDENCE",
      origin: "local-audio-reflex",
      reason: "marginal-speech-during-assistant-output",
      turnId,
      evidence: { probability, triggerSampleStart }
    }], "armed");
  }

  if (event.type === "VAD_CONTROL_WINDOW") {
    if (state.status !== "armed" || !sameTurn(state, event)) {
      return transition(state, state, [], "window-not-actionable");
    }
    const sampleStart = optionalSample(event.sampleStart, "sampleStart");
    if (
      sampleStart === null ||
      sampleStart <= (state.lastSampleStart ?? -1)
    ) {
      return transition(state, state, [], "duplicate-or-old-window");
    }
    const probability = finiteProbability(event.probability, "probability");
    const supports = probability >= state.config.supportProbability;
    const observed = nextState(state, {
      lastSampleStart: sampleStart,
      observedWindows: state.observedWindows + 1,
      supportingWindows: supports ? state.supportingWindows + 1 : 0
    });
    if (observed.supportingWindows < state.config.supportWindows) {
      return transition(state, observed, [], "collecting-evidence");
    }
    const paused = {
      ...observed,
      status: "paused"
    };
    return transition(
      state,
      paused,
      [pauseIntent(paused, "sustained-acoustic-evidence", { probability })],
      "sustained-acoustic-evidence"
    );
  }

  if (event.type === "TRANSCRIPT_PARTIAL") {
    if (
      !["armed", "suppressed"].includes(state.status) ||
      !sameTurn(state, event) ||
      !String(event.text ?? "").trim()
    ) {
      return transition(state, state, [], "partial-not-actionable");
    }
    const paused = nextState(state, { status: "paused" });
    return transition(
      state,
      paused,
      [pauseIntent(
        paused,
        state.status === "suppressed"
          ? "delayed-transcript-evidence"
          : "transcript-evidence"
      )],
      state.status === "suppressed"
        ? "delayed-transcript-evidence"
        : "transcript-evidence"
    );
  }

  if (event.type === "USER_SPEECH_PAUSED") {
    if (state.status !== "armed" || !sameTurn(state, event)) {
      return transition(state, state, [], "pause-not-actionable");
    }
    const suppressed = nextState(state, { status: "suppressed" });
    return transition(state, suppressed, [{
      type: "CONTINUE_OUTPUT",
      origin: "local-audio-reflex",
      reason: "insufficient-acoustic-evidence",
      turnId: state.turnId,
      evidence: {
        observedWindows: state.observedWindows,
        supportingWindows: state.supportingWindows
      }
    }], "insufficient-acoustic-evidence");
  }

  if (event.type === "TRANSCRIPT_FINAL") {
    if (!sameTurn(state, event)) {
      return transition(state, state, [], "final-not-actionable");
    }
    const text = String(event.text ?? "").trim();
    if (state.status === "armed" && text) {
      const paused = nextState(state, { status: "paused" });
      return transition(
        state,
        paused,
        [pauseIntent(paused, "transcript-evidence")],
        "transcript-evidence"
      );
    }
    if (state.status !== "suppressed") {
      return transition(state, state, [], "final-not-actionable");
    }
    const cleared = nextState(state, idleFields());
    return transition(state, cleared, [{
      type: "SUPPRESS_TRANSCRIPT",
      origin: "local-audio-reflex",
      reason: "unconfirmed-acoustic-turn",
      turnId: state.turnId,
      evidence: {
        observedWindows: state.observedWindows,
        supportingWindows: state.supportingWindows,
        text
      }
    }], "unconfirmed-acoustic-turn");
  }

  throw new TypeError(`evento do reflexo local não suportado: ${event.type}`);
}

export class LocalAudioReflex {
  #state;

  constructor(options = {}) {
    this.#state = createLocalAudioReflexState(options);
  }

  get snapshot() {
    return this.#state;
  }

  dispatch(event) {
    const result = reduceLocalAudioReflex(this.#state, event);
    this.#state = result.state;
    return result;
  }

  reset(reason = "reset") {
    return this.dispatch({ type: "RESET", reason });
  }
}
