import { validateEvent } from "../contracts/events.mjs";
import { validateScenario } from "./scenario.mjs";

export function simulateScenario(scenario, policy) {
  validateScenario(scenario);

  if (!policy || typeof policy.onEvent !== "function") {
    throw new TypeError("policy precisa implementar onEvent(event)");
  }

  policy.reset?.();

  let sequence = 0;
  const queue = scenario.timeline.map((event) => ({
    event: { ...event, payload: event.payload ?? {}, source: "scenario" },
    id: ++sequence,
    key: null
  }));
  const activeKeys = new Map();
  const trace = [];

  while (queue.length > 0) {
    queue.sort(
      (left, right) =>
        left.event.atMs - right.event.atMs || left.id - right.id
    );

    const item = queue.shift();
    if (item.key && activeKeys.get(item.key) !== item.id) {
      continue;
    }
    if (item.key) {
      activeKeys.delete(item.key);
    }

    trace.push(item.event);
    const commands = policy.onEvent(item.event) ?? [];

    for (const command of commands) {
      if (command.kind === "cancel") {
        activeKeys.delete(command.key);
        continue;
      }

      if (command.kind !== "schedule") {
        throw new TypeError(`comando desconhecido: ${command.kind}`);
      }

      validateEvent(command.event, "comando.event");
      if (command.event.atMs < item.event.atMs) {
        throw new RangeError("a política tentou agendar um evento no passado");
      }

      const queued = {
        event: {
          ...command.event,
          payload: command.event.payload ?? {},
          source: "candidate"
        },
        id: ++sequence,
        key: command.key ?? null
      };

      if (queued.key) {
        activeKeys.set(queued.key, queued.id);
      }
      queue.push(queued);
    }
  }

  return trace;
}
