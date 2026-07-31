import { validateEvent } from "../contracts/events.mjs";
import { applyPerceptionGate } from "./perception-gate.mjs";
import {
  validatePerceptionGate,
  validatePerceptionPack
} from "./perception-schema.mjs";
import { scorePerceptionPack } from "./perception-scorer.mjs";

export function traceBundleFromEvaluationReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new TypeError("relatório de avaliação deve ser um objeto");
  }
  if (!Array.isArray(report.scenarios)) {
    throw new TypeError("relatório de avaliação não contém scenarios");
  }

  return {
    candidate: report.candidate,
    packId: report.packId,
    traces: Object.fromEntries(
      report.scenarios.map((scenario) => [scenario.id, scenario.trace])
    )
  };
}

function validateTraceBundle(pack, bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new TypeError("trace bundle deve ser um objeto");
  }
  if (typeof bundle.candidate !== "string" || bundle.candidate.trim() === "") {
    throw new TypeError("trace bundle precisa de candidate");
  }
  if (bundle.packId !== pack.tracePackId) {
    throw new TypeError(
      `trace bundle usa pack ${bundle.packId}; esperado: ${pack.tracePackId}`
    );
  }

  const traces = new Map();
  for (const scenario of pack.scenarios) {
    const trace = bundle.traces?.[scenario.sourceScenarioId];
    if (!Array.isArray(trace)) {
      throw new TypeError(
        `trace ausente para o cenário: ${scenario.sourceScenarioId}`
      );
    }

    let previousAtMs = -1;
    trace.forEach((event, index) => {
      validateEvent(
        event,
        `traces.${scenario.sourceScenarioId}[${index}]`
      );
      if (event.atMs < previousAtMs) {
        throw new TypeError(
          `trace fora de ordem: ${scenario.sourceScenarioId}`
        );
      }
      previousAtMs = event.atMs;
    });
    traces.set(scenario.sourceScenarioId, trace);
  }
  return traces;
}

export function evaluatePerception(pack, gateConfig, bundle) {
  validatePerceptionPack(pack);
  validatePerceptionGate(gateConfig);
  const traces = validateTraceBundle(pack, bundle);
  const score = scorePerceptionPack(pack, traces);
  const gate = applyPerceptionGate(score, gateConfig);

  return {
    schemaVersion: 1,
    candidate: bundle.candidate,
    ...score,
    gate,
    decision: gate.decision
  };
}
