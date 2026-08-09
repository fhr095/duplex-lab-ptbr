import { createLocalBrain } from "../brain/local-brain.mjs";
import {
  createInteractionState,
  reduceInteraction
} from "./interaction-kernel.mjs";
import { createInteractionRuntime } from "./interaction-runtime.mjs";

export class TurnCoordinator {
  #planner;
  #runtime;

  constructor(options = {}) {
    this.#planner = options.planner ?? createLocalBrain();
    this.#runtime = options.runtime ?? createInteractionRuntime();
    if (
      typeof this.#planner?.planTurn !== "function" ||
      typeof this.#runtime?.dispatch !== "function"
    ) {
      throw new TypeError("planner e runtime precisam implementar seus contratos");
    }
  }

  get sessionCount() {
    return this.#runtime.sessionCount;
  }

  planTurn({ sessionId, turnId, text }) {
    const interaction = this.#runtime.dispatch(sessionId, {
      type: "USER_TURN_FINAL",
      id: turnId,
      text
    });
    return this.#planner.planTurn(text, { interaction });
  }

  // Planeja um turno a partir do snapshot da sessão SEM avançar o estado
  // autoritativo. O kernel é um reducer puro: se a final confirmar o texto
  // provisório, o commit posterior com o mesmo evento produz a mesma
  // transição.
  planTurnSpeculative({ sessionId, turnId, text }) {
    const state = this.#runtime.snapshot(sessionId) ??
      createInteractionState();
    const interaction = reduceInteraction(state, {
      type: "USER_TURN_FINAL",
      id: turnId,
      text
    });
    return this.#planner.planTurn(text, { interaction });
  }

  // Avança o estado autoritativo sem gerar resposta (idempotente por
  // eventId). Usado quando um stream especulativo é adotado.
  commitTurn({ sessionId, turnId, text }) {
    return this.#runtime.dispatch(sessionId, {
      type: "USER_TURN_FINAL",
      id: turnId,
      text
    });
  }

  snapshot(sessionId) {
    return this.#runtime.snapshot(sessionId);
  }

  reset(sessionId) {
    return this.#runtime.reset(sessionId);
  }
}

export function createTurnCoordinator(options = {}) {
  return new TurnCoordinator(options);
}
