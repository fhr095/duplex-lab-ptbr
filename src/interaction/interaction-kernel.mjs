import { analyzeCorrection } from "./correction-semantics.mjs";
import { planCriticalConfirmation } from "./critical-confirmation.mjs";
import { extractPtBrCurrencyAmounts } from "./ptbr-number.mjs";

export const INTERACTION_KERNEL_VERSION = "interaction-kernel-v0.1";

const MAX_REVISIONS = 20;
const USER_TURN_FINAL = "USER_TURN_FINAL";
const CONFIRMATION_CANCEL =
  /\b(?:cancel\p{Letter}*|desist\p{Letter}*|deixa(?:\s+(?:pra|para))?\s+l[aá]|n[aã]o\s+quero\s+mais)\b/iu;
const CONFIRMATION_UNCERTAIN =
  /\b(?:n[aã]o|ach\p{Letter}*|talvez|duvid\p{Letter}*|(?:pode|podia)\s+ser|ou)\b|\?/iu;
const INITIAL_CONFIRMATION_PROMPT =
  "Só para confirmar com segurança: qual é o valor final da transferência?";
const RETRY_CONFIRMATION_PROMPT =
  "Ainda preciso de um único valor final. Pode repetir o valor da transferência?";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function normalizedText(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

function requireIdentifier(value, label) {
  const normalized = normalizedText(value);
  if (!normalized || normalized.length > 160) {
    throw new TypeError(`${label} precisa ser uma string não vazia`);
  }
  return normalized;
}

function cloneRevision(revision) {
  return {
    id: revision.id,
    slot: revision.slot,
    obsolete: revision.obsolete,
    current: revision.current,
    marker: revision.marker,
    confirmationId: revision.confirmationId ?? null
  };
}

function validateSemanticState(value) {
  if (value === null) {
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.slot !== "string" ||
    typeof value.value !== "string" ||
    typeof value.revisionId !== "string"
  ) {
    throw new TypeError("estado do kernel possui commit semântico inválido");
  }
  return {
    slot: value.slot,
    value: value.value,
    revisionId: value.revisionId
  };
}

function validatePendingConfirmation(value) {
  if (value === null) {
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.id !== "string" ||
    value.policy !== "repeat-critical-value-before-commit" ||
    value.slot !== "amount" ||
    typeof value.proposedValue !== "string" ||
    typeof value.obsolete !== "string"
  ) {
    throw new TypeError("estado do kernel possui confirmação pendente inválida");
  }
  return {
    id: value.id,
    policy: value.policy,
    reason: value.reason,
    slot: value.slot,
    proposedValue: value.proposedValue,
    obsolete: value.obsolete,
    requestedByEventId: value.requestedByEventId
  };
}

function normalizeState(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("estado do kernel precisa ser um objeto válido");
  }
  if (
    input.schemaVersion !== 1 ||
    input.kernelVersion !== INTERACTION_KERNEL_VERSION ||
    !Number.isSafeInteger(input.version) ||
    input.version < 0 ||
    !Number.isSafeInteger(input.revisionSequence) ||
    input.revisionSequence < 0 ||
    !input.semantic ||
    typeof input.semantic !== "object" ||
    !Array.isArray(input.semantic.revisions)
  ) {
    throw new TypeError("estado do kernel é incompatível ou incompleto");
  }
  const revisions = input.semantic.revisions.map((revision) => {
    if (
      !revision ||
      typeof revision !== "object" ||
      typeof revision.id !== "string" ||
      typeof revision.slot !== "string" ||
      typeof revision.current !== "string"
    ) {
      throw new TypeError("estado do kernel possui revisão inválida");
    }
    return cloneRevision(revision);
  });
  return {
    schemaVersion: 1,
    kernelVersion: INTERACTION_KERNEL_VERSION,
    version: input.version,
    revisionSequence: input.revisionSequence,
    semantic: {
      committed: validateSemanticState(input.semantic.committed),
      pendingConfirmation: validatePendingConfirmation(
        input.semantic.pendingConfirmation
      ),
      revisions
    }
  };
}

function normalizeEvent(input) {
  if (!input || typeof input !== "object" || input.type !== USER_TURN_FINAL) {
    throw new TypeError("evento do kernel não é suportado");
  }
  const id = requireIdentifier(input.id, "id do evento");
  const text = normalizedText(input.text);
  if (!text || text.length > 4_000) {
    throw new TypeError("texto do evento precisa ser não vazio e ter até 4.000 caracteres");
  }
  return { type: USER_TURN_FINAL, id, text };
}

function amountValue(value) {
  const formatted = Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
  return `BRL ${formatted}`;
}

function spokenAmount(value) {
  return `R$ ${String(value).replace(/^BRL\s+/u, "")}`;
}

function uniqueAmounts(text) {
  return [
    ...new Set(
      extractPtBrCurrencyAmounts(text)
        .map((item) => item.value)
        .filter(Number.isFinite)
    )
  ];
}

function withVersion(state, semantic, revisionSequence = state.revisionSequence) {
  return {
    schemaVersion: 1,
    kernelVersion: INTERACTION_KERNEL_VERSION,
    version: state.version + 1,
    revisionSequence,
    semantic
  };
}

function waitAndSpeak(event, pending, prompt, purpose) {
  return [
    {
      id: `${event.id}:wait`,
      type: "WAIT",
      reason: "critical-confirmation",
      confirmationId: pending.id
    },
    {
      id: `${event.id}:speak`,
      type: "SPEAK",
      purpose,
      content: prompt,
      policy: pending.policy,
      providerBypass: true,
      confirmationId: pending.id
    }
  ];
}

function appendRevision(state, revision) {
  return [...state.semantic.revisions, revision].slice(-MAX_REVISIONS);
}

function transitionResult(previous, event, state, intents, analysis = {}) {
  return deepFreeze({
    schemaVersion: 1,
    kernelVersion: INTERACTION_KERNEL_VERSION,
    authority: "backend-interaction-runtime",
    event: { id: event.id, type: event.type },
    previousStateVersion: previous.version,
    state,
    intents,
    analysis: {
      correction: analysis.correction ?? null,
      effectiveText: analysis.effectiveText ?? event.text,
      confirmation: analysis.confirmation ?? null
    }
  });
}

function resolvePendingConfirmation(state, event, pending) {
  if (CONFIRMATION_CANCEL.test(event.text)) {
    const nextState = withVersion(state, {
      ...state.semantic,
      pendingConfirmation: null
    });
    return transitionResult(state, event, nextState, [
      {
        id: `${event.id}:cancel`,
        type: "CANCEL",
        target: "critical-confirmation",
        confirmationId: pending.id,
        reason: "user-cancelled"
      },
      {
        id: `${event.id}:speak`,
        type: "SPEAK",
        purpose: "critical-confirmation-cancelled",
        content: "Certo, cancelei essa confirmação.",
        policy: pending.policy,
        providerBypass: true,
        confirmationId: pending.id
      }
    ], {
      confirmation: { status: "cancelled", id: pending.id }
    });
  }

  const amounts = uniqueAmounts(event.text);
  if (
    CONFIRMATION_UNCERTAIN.test(event.text) ||
    amounts.length !== 1
  ) {
    const nextState = withVersion(state, { ...state.semantic });
    return transitionResult(
      state,
      event,
      nextState,
      waitAndSpeak(
        event,
        pending,
        RETRY_CONFIRMATION_PROMPT,
        "critical-confirmation-retry"
      ),
      { confirmation: { status: "pending", id: pending.id } }
    );
  }

  const current = amountValue(amounts[0]);
  const revisionSequence = state.revisionSequence + 1;
  const revision = {
    id: `revision-${revisionSequence}`,
    slot: "amount",
    obsolete: pending.obsolete,
    current,
    marker: "confirmation-repeat",
    confirmationId: pending.id
  };
  const nextState = withVersion(
    state,
    {
      committed: {
        slot: "amount",
        value: current,
        revisionId: revision.id
      },
      pendingConfirmation: null,
      revisions: appendRevision(state, revision)
    },
    revisionSequence
  );
  return transitionResult(state, event, nextState, [
    {
      id: `${event.id}:rollback`,
      type: "ROLLBACK",
      slot: revision.slot,
      previous: revision.obsolete,
      current: revision.current,
      revisionId: revision.id,
      confirmationId: pending.id
    },
    {
      id: `${event.id}:speak`,
      type: "SPEAK",
      purpose: "critical-confirmation-accepted",
      content: `Entendido. Valor final confirmado: ${spokenAmount(current)}.`,
      policy: pending.policy,
      providerBypass: true,
      confirmationId: pending.id
    }
  ], {
    correction: revision,
    effectiveText: event.text,
    confirmation: {
      status: "accepted",
      id: pending.id,
      value: current
    }
  });
}

export function createInteractionState() {
  return deepFreeze({
    schemaVersion: 1,
    kernelVersion: INTERACTION_KERNEL_VERSION,
    version: 0,
    revisionSequence: 0,
    semantic: {
      committed: null,
      pendingConfirmation: null,
      revisions: []
    }
  });
}

export function reduceInteraction(inputState, inputEvent) {
  const state = normalizeState(inputState);
  const event = normalizeEvent(inputEvent);
  const pending = state.semantic.pendingConfirmation;
  if (pending) {
    return resolvePendingConfirmation(state, event, pending);
  }

  const analysis = analyzeCorrection(event.text);
  if (!analysis.isCorrection) {
    return transitionResult(
      state,
      event,
      withVersion(state, { ...state.semantic }),
      [],
      { effectiveText: analysis.effectiveText }
    );
  }

  const safety = planCriticalConfirmation(event.text, analysis.correction);
  if (safety) {
    const pendingConfirmation = {
      id: `confirmation:${event.id}`,
      policy: safety.policy,
      reason: safety.reason,
      slot: safety.slot,
      proposedValue: safety.proposedValue,
      obsolete: analysis.correction.obsolete,
      requestedByEventId: event.id
    };
    const nextState = withVersion(state, {
      ...state.semantic,
      pendingConfirmation
    });
    const proposal = {
      ...analysis.correction,
      id: `proposal:${event.id}`
    };
    return transitionResult(
      state,
      event,
      nextState,
      waitAndSpeak(
        event,
        pendingConfirmation,
        safety.prompt || INITIAL_CONFIRMATION_PROMPT,
        "critical-confirmation"
      ),
      {
        correction: proposal,
        effectiveText: analysis.effectiveText,
        confirmation: { status: "pending", id: pendingConfirmation.id }
      }
    );
  }

  const revisionSequence = state.revisionSequence + 1;
  const revision = {
    ...analysis.correction,
    id: `revision-${revisionSequence}`,
    confirmationId: null
  };
  const nextState = withVersion(
    state,
    {
      committed: {
        slot: revision.slot,
        value: revision.current,
        revisionId: revision.id
      },
      pendingConfirmation: null,
      revisions: appendRevision(state, revision)
    },
    revisionSequence
  );
  return transitionResult(state, event, nextState, [
    {
      id: `${event.id}:rollback`,
      type: "ROLLBACK",
      slot: revision.slot,
      previous: revision.obsolete,
      current: revision.current,
      revisionId: revision.id,
      confirmationId: null
    }
  ], {
    correction: revision,
    effectiveText: analysis.effectiveText
  });
}
