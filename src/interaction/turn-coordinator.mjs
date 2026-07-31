import { createLocalBrain } from "../brain/local-brain.mjs";
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
