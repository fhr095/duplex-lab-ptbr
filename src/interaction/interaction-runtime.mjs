import {
  createInteractionState,
  reduceInteraction
} from "./interaction-kernel.mjs";

const DEFAULT_MAX_SESSIONS = 512;
const MAX_REMEMBERED_EVENTS = 32;

function sessionIdentifier(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError("sessionId precisa ser uma string não vazia");
  }
  return normalized;
}

function eventSignature(event) {
  return JSON.stringify({
    type: event?.type,
    id: event?.id,
    text: event?.text
  });
}

export class InteractionRuntime {
  #kernel;
  #maxSessions;
  #sessions = new Map();

  constructor(options = {}) {
    this.#kernel = options.kernel ?? reduceInteraction;
    this.#maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    if (
      typeof this.#kernel !== "function" ||
      !Number.isSafeInteger(this.#maxSessions) ||
      this.#maxSessions < 1
    ) {
      throw new TypeError("configuração do InteractionRuntime é inválida");
    }
  }

  get sessionCount() {
    return this.#sessions.size;
  }

  #touch(sessionId, entry) {
    this.#sessions.delete(sessionId);
    this.#sessions.set(sessionId, entry);
    while (this.#sessions.size > this.#maxSessions) {
      const oldest = this.#sessions.keys().next().value;
      this.#sessions.delete(oldest);
    }
  }

  dispatch(inputSessionId, event) {
    const sessionId = sessionIdentifier(inputSessionId);
    const eventId = String(event?.id ?? "").trim();
    if (!eventId) {
      throw new TypeError("id do evento precisa ser uma string não vazia");
    }
    const signature = eventSignature(event);
    const entry = this.#sessions.get(sessionId) ?? {
      state: createInteractionState(),
      events: new Map()
    };
    const previous = entry.events.get(eventId);
    if (previous) {
      if (previous.signature !== signature) {
        throw new Error(`id do evento ${eventId} foi reutilizado com outro conteúdo`);
      }
      this.#touch(sessionId, entry);
      return previous.transition;
    }

    const transition = this.#kernel(entry.state, event);
    entry.state = transition.state;
    entry.events.set(eventId, { signature, transition });
    while (entry.events.size > MAX_REMEMBERED_EVENTS) {
      entry.events.delete(entry.events.keys().next().value);
    }
    this.#touch(sessionId, entry);
    return transition;
  }

  snapshot(inputSessionId) {
    const sessionId = sessionIdentifier(inputSessionId);
    const entry = this.#sessions.get(sessionId);
    if (!entry) {
      return null;
    }
    this.#touch(sessionId, entry);
    return entry.state;
  }

  reset(inputSessionId) {
    return this.#sessions.delete(sessionIdentifier(inputSessionId));
  }
}

export function createInteractionRuntime(options = {}) {
  return new InteractionRuntime(options);
}
