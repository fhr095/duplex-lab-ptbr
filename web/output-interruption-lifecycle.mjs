export const OUTPUT_INTERRUPTION_LIFECYCLE_VERSION =
  "output-interruption-lifecycle-v0.1";

const PHASES = Object.freeze([
  "idle",
  "held",
  "resuming",
  "confirmed"
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

function optionalIdentifier(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError(`${label} precisa ser um identificador válido`);
  }
  return normalized;
}

function optionalEpoch(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new TypeError(`${label} precisa ser inteiro não negativo`);
  }
  return epoch;
}

function nonNegativeInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw new TypeError(`${label} precisa ser inteiro não negativo`);
  }
  return integer;
}

function idleFields() {
  return {
    phase: "idle",
    turnId: null,
    outputEpoch: null,
    pauseKind: null,
    resumeAttempt: 0
  };
}

function normalizeState(input) {
  if (
    !input ||
    typeof input !== "object" ||
    input.schemaVersion !== 1 ||
    input.lifecycleVersion !== OUTPUT_INTERRUPTION_LIFECYCLE_VERSION ||
    !Number.isSafeInteger(input.version) ||
    input.version < 0 ||
    !PHASES.includes(input.phase)
  ) {
    throw new TypeError("estado do lifecycle de interrupção é incompatível");
  }
  const pauseKind = input.pauseKind ?? null;
  if (
    pauseKind !== null &&
    !["audible", "acoustic-pending", "response-pending"].includes(
      pauseKind
    )
  ) {
    throw new TypeError("pauseKind do lifecycle é inválido");
  }
  return {
    schemaVersion: 1,
    lifecycleVersion: OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
    version: input.version,
    phase: input.phase,
    turnId: optionalIdentifier(input.turnId, "turnId"),
    outputEpoch: optionalEpoch(input.outputEpoch, "outputEpoch"),
    pauseKind,
    resumeAttempt: nonNegativeInteger(
      input.resumeAttempt,
      "resumeAttempt"
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

function transition(previous, state, intents, eventType, reason) {
  return deepFreeze({
    schemaVersion: 1,
    lifecycleVersion: OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
    previousStateVersion: previous.version,
    eventType,
    state,
    intents,
    reason
  });
}

function oneIntent(type, fields = {}) {
  return [{
    type,
    origin: "output-interruption-lifecycle",
    ...fields
  }];
}

export function createOutputInterruptionState() {
  return deepFreeze({
    schemaVersion: 1,
    lifecycleVersion: OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
    version: 0,
    ...idleFields()
  });
}

export function reduceOutputInterruption(inputState, event) {
  const state = normalizeState(inputState);
  if (!event || typeof event.type !== "string") {
    throw new TypeError("evento do lifecycle de interrupção é obrigatório");
  }

  if (event.type === "CLEAR") {
    if (state.phase === "idle") {
      return transition(state, state, [], event.type, "already-idle");
    }
    return transition(
      state,
      nextState(state, idleFields()),
      oneIntent("SETTLE_CLEARED", { reason: event.reason ?? "cleared" }),
      event.type,
      "cleared"
    );
  }

  if (event.type === "PAUSE_REQUESTED") {
    const turnId = optionalIdentifier(event.turnId, "turnId");
    const outputEpoch = optionalEpoch(event.outputEpoch, "outputEpoch");
    const hasAudibleOutput = event.hasAudibleOutput === true;
    const hasAcousticOutput = event.hasAcousticOutput === true;
    const hasActiveResponse = event.hasActiveResponse === true;

    if (state.phase === "confirmed") {
      return transition(
        state,
        state,
        [],
        event.type,
        "already-confirmed"
      );
    }
    if (state.phase === "held") {
      const held = nextState(state, {
        turnId: state.turnId ?? turnId
      });
      return transition(
        state,
        held,
        oneIntent("KEEP_OUTPUT_HELD"),
        event.type,
        "already-held"
      );
    }
    if (state.phase === "resuming") {
      const held = nextState(state, {
        phase: "held",
        turnId: state.turnId ?? turnId,
        resumeAttempt: state.resumeAttempt + 1
      });
      return transition(
        state,
        held,
        oneIntent("CANCEL_RESUME_AND_PAUSE", {
          resumeAttempt: held.resumeAttempt
        }),
        event.type,
        "speech-during-resume"
      );
    }
    if (
      !hasAudibleOutput &&
      !hasAcousticOutput &&
      !hasActiveResponse
    ) {
      return transition(
        state,
        state,
        [],
        event.type,
        "no-output-to-hold"
      );
    }

    const pauseKind = hasAudibleOutput
      ? "audible"
      : hasAcousticOutput
        ? "acoustic-pending"
        : "response-pending";
    const held = nextState(state, {
      phase: "held",
      turnId,
      outputEpoch,
      pauseKind,
      resumeAttempt: 0
    });
    return transition(
      state,
      held,
      oneIntent(
        hasAudibleOutput ? "PAUSE_OUTPUT" : "HOLD_OUTPUT",
        { pauseKind }
      ),
      event.type,
      "output-held"
    );
  }

  if (event.type === "DISMISS_REQUESTED") {
    if (state.phase !== "held") {
      return transition(
        state,
        state,
        [],
        event.type,
        "nothing-held"
      );
    }
    const currentOutputEpoch = optionalEpoch(
      event.currentOutputEpoch,
      "currentOutputEpoch"
    );
    const resumable =
      event.hasResumableAudio === true &&
      state.outputEpoch !== null &&
      state.outputEpoch === currentOutputEpoch;
    if (!resumable) {
      return transition(
        state,
        nextState(state, idleFields()),
        oneIntent("SETTLE_WITHOUT_RESUME"),
        event.type,
        "output-no-longer-resumable"
      );
    }
    const resuming = nextState(state, {
      phase: "resuming",
      resumeAttempt: state.resumeAttempt + 1
    });
    return transition(
      state,
      resuming,
      oneIntent("RESUME_OUTPUT", {
        resumeAttempt: resuming.resumeAttempt
      }),
      event.type,
      "resume-requested"
    );
  }

  if (
    event.type === "RESUME_SUCCEEDED" ||
    event.type === "RESUME_FAILED"
  ) {
    const resumeAttempt = nonNegativeInteger(
      event.resumeAttempt,
      "resumeAttempt"
    );
    if (
      state.phase !== "resuming" ||
      resumeAttempt !== state.resumeAttempt
    ) {
      const staleSuccessIntent = ["held", "confirmed"].includes(
        state.phase
      )
        ? "PAUSE_STALE_RESUME"
        : "IGNORE_STALE_RESUME";
      return transition(
        state,
        state,
        event.type === "RESUME_SUCCEEDED"
          ? oneIntent(staleSuccessIntent, { resumeAttempt })
          : [],
        event.type,
        "stale-resume-result"
      );
    }
    return transition(
      state,
      nextState(state, idleFields()),
      oneIntent(
        event.type === "RESUME_SUCCEEDED"
          ? "SETTLE_RESUMED"
          : "RELEASE_OUTPUT",
        { resumeAttempt }
      ),
      event.type,
      event.type === "RESUME_SUCCEEDED"
        ? "resume-observed"
        : "resume-failed"
    );
  }

  if (event.type === "CONFIRM_REQUESTED") {
    if (!["held", "resuming"].includes(state.phase)) {
      return transition(
        state,
        state,
        [],
        event.type,
        "nothing-to-confirm"
      );
    }
    const confirmed = nextState(state, { phase: "confirmed" });
    return transition(
      state,
      confirmed,
      oneIntent("CONFIRM_INTERRUPTION", {
        reason: event.reason ?? "confirmed"
      }),
      event.type,
      "interruption-confirmed"
    );
  }

  throw new TypeError(
    `evento do lifecycle de interrupção não suportado: ${event.type}`
  );
}

export class OutputInterruptionLifecycle {
  #state = createOutputInterruptionState();

  get snapshot() {
    return this.#state;
  }

  dispatch(event) {
    const result = reduceOutputInterruption(this.#state, event);
    this.#state = result.state;
    return result;
  }

  clear(reason = "cleared") {
    return this.dispatch({ type: "CLEAR", reason });
  }
}
