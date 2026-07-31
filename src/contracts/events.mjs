export const EVENT_TYPES = Object.freeze([
  "assistant.backchannel",
  "assistant.speech.finished",
  "assistant.speech.started",
  "assistant.speech.stopped",
  "environment.speech.detected",
  "state.rollback",
  "task.cancelled",
  "task.delegated",
  "task.result",
  "user.cancelled",
  "user.correction",
  "user.hesitation",
  "user.speech.ended",
  "user.speech.paused",
  "user.speech.resumed",
  "user.speech.started",
  "user.transcript.final"
]);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

export function isKnownEventType(type) {
  return EVENT_TYPE_SET.has(type);
}

export function validateEvent(event, label = "evento") {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError(`${label} deve ser um objeto`);
  }

  if (!Number.isFinite(event.atMs) || event.atMs < 0) {
    throw new TypeError(`${label}.atMs deve ser um número não negativo`);
  }

  if (!isKnownEventType(event.type)) {
    throw new TypeError(`${label}.type desconhecido: ${String(event.type)}`);
  }

  if (
    event.payload !== undefined &&
    (!event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload))
  ) {
    throw new TypeError(`${label}.payload deve ser um objeto`);
  }

  return event;
}

export function makeEvent(type, atMs, payload = {}) {
  return validateEvent({ type, atMs, payload });
}
