export const SUPPORTED_INTERACTION_KERNEL_VERSION =
  "interaction-kernel-v0.1";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function copy(value) {
  return value === null ? null : structuredClone(value);
}

function validateTransition(transition) {
  if (!transition || typeof transition !== "object") {
    throw new TypeError("transição autoritativa é obrigatória");
  }
  if (
    transition.kernelVersion !== SUPPORTED_INTERACTION_KERNEL_VERSION ||
    transition.authority !== "backend-interaction-runtime"
  ) {
    throw new TypeError("versão ou autoridade do kernel não é suportada");
  }
  if (
    !transition.state?.semantic ||
    !Array.isArray(transition.state.semantic.revisions) ||
    !Array.isArray(transition.intents)
  ) {
    throw new TypeError("transição do kernel está incompleta");
  }
}

function jsonDetail(value) {
  return JSON.stringify(value);
}

export function projectInteractionTransition(transition) {
  validateTransition(transition);
  const semantic = transition.state.semantic;
  const traceEvents = [];
  const confirmationSpeak = transition.intents.find(
    (intent) =>
      intent.type === "SPEAK" &&
      ["critical-confirmation", "critical-confirmation-retry"].includes(
        intent.purpose
      )
  );
  if (semantic.pendingConfirmation && confirmationSpeak) {
    traceEvents.push({
      type: "state.pending-confirmation",
      detail: jsonDetail(semantic.pendingConfirmation)
    });
    traceEvents.push({
      type: "assistant.safety-confirmation",
      detail: confirmationSpeak.policy
    });
  }

  for (const intent of transition.intents) {
    if (intent.type === "ROLLBACK") {
      traceEvents.push({
        type: "state.rollback",
        detail: jsonDetail({
          previous: intent.previous,
          current: intent.current,
          revisionId: intent.revisionId,
          slot: intent.slot,
          confirmationId: intent.confirmationId ?? null
        })
      });
    } else if (intent.type === "CANCEL") {
      traceEvents.push({
        type: "state.confirmation.cancelled",
        detail: jsonDetail({
          confirmationId: intent.confirmationId,
          reason: intent.reason
        })
      });
    } else if (
      intent.type === "SPEAK" &&
      intent.purpose === "critical-confirmation-accepted"
    ) {
      traceEvents.push({
        type: "assistant.safety-confirmed",
        detail: jsonDetail({
          confirmationId: intent.confirmationId,
          policy: intent.policy
        })
      });
    }
  }

  return deepFreeze({
    authority: transition.authority,
    kernelVersion: transition.kernelVersion,
    eventId: transition.event?.id ?? null,
    previousStateVersion: transition.previousStateVersion,
    stateVersion: transition.state.version,
    semanticState: copy(semantic.committed),
    semanticRevisions: copy(semantic.revisions),
    pendingConfirmation: copy(semantic.pendingConfirmation),
    traceEvents
  });
}
