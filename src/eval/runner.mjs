import { BaselineInteractionPolicy } from "../policies/baseline-policy.mjs";
import { validateEvent } from "../contracts/events.mjs";
import { applyGate } from "./gate.mjs";
import { scorePack } from "./scorer.mjs";
import { simulateScenario } from "./simulator.mjs";

function finalize(candidate, pack, gateConfig, traces) {
  const score = scorePack(pack, traces);
  return {
    schemaVersion: 1,
    candidate,
    ...score,
    gate: applyGate(score, gateConfig)
  };
}

export function evaluateBaseline(pack, gateConfig, policyConfig = {}) {
  const traces = new Map();

  for (const scenario of pack.scenarios) {
    const policy = new BaselineInteractionPolicy(policyConfig);
    traces.set(scenario.id, simulateScenario(scenario, policy));
  }

  return finalize("baseline-policy-v0", pack, gateConfig, traces);
}

export function evaluateTraceBundle(pack, gateConfig, bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new TypeError("trace bundle deve ser um objeto");
  }
  if (!bundle.candidate || typeof bundle.candidate !== "string") {
    throw new TypeError("trace bundle precisa de candidate");
  }
  if (bundle.packId !== pack.id) {
    throw new TypeError(
      `trace bundle usa pack ${bundle.packId}; esperado: ${pack.id}`
    );
  }

  const traces = new Map();
  for (const scenario of pack.scenarios) {
    const trace = bundle.traces?.[scenario.id];
    if (!Array.isArray(trace)) {
      throw new TypeError(`trace ausente para o cenário: ${scenario.id}`);
    }

    let previousAtMs = -1;
    trace.forEach((event, index) => {
      validateEvent(event, `traces.${scenario.id}[${index}]`);
      if (event.atMs < previousAtMs) {
        throw new TypeError(`trace fora de ordem: ${scenario.id}`);
      }
      previousAtMs = event.atMs;
    });
    traces.set(scenario.id, trace);
  }

  return finalize(bundle.candidate, pack, gateConfig, traces);
}
