import {
  analyzeCorrection
} from "../../src/interaction/correction-semantics.mjs";

function round(value, places = 4) {
  const factor = 10 ** places;
  return Number.isFinite(value)
    ? Math.round(value * factor) / factor
    : null;
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{Letter}\p{Number}:]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function equalSemanticValue(left, right) {
  return normalize(left) === normalize(right);
}

function percentile(values, ratio) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) {
    return null;
  }
  return finite[Math.max(0, Math.ceil(finite.length * ratio) - 1)];
}

export function assessShadowTranscript(definition, transcript) {
  const correction = analyzeCorrection(transcript).correction ?? null;
  const parsedCurrent = correction?.slot === definition.slot
    ? correction.current
    : null;
  const parsedObsolete = correction?.slot === definition.slot
    ? correction.obsolete
    : null;
  const currentRecovered = equalSemanticValue(
    parsedCurrent,
    definition.current
  );
  const primaryAgreement =
    definition.primaryCurrent !== null &&
    equalSemanticValue(parsedCurrent, definition.primaryCurrent);
  return {
    transcript,
    parsedSlot: correction?.slot ?? null,
    parsedObsolete,
    parsedCurrent,
    currentRecovered,
    obsoleteRecovered: equalSemanticValue(
      parsedObsolete,
      definition.obsolete
    ),
    primaryAgreement,
    wouldVetoPrimary:
      definition.primaryCurrent === null || !primaryAgreement
  };
}

function ratio(items, predicate) {
  return items.length === 0
    ? null
    : round(items.filter(predicate).length / items.length);
}

function summarizeCandidate(candidate, definitions, gate) {
  const byId = new Map(definitions.map((item) => [item.id, item]));
  const observations = candidate.observations.map((observation) => {
    const definition = byId.get(observation.caseId);
    if (!definition) {
      throw new Error(`caso desconhecido: ${observation.caseId}`);
    }
    return {
      caseId: observation.caseId,
      repetition: observation.repetition,
      elapsedMs: observation.elapsedMs,
      languageProbability: observation.languageProbability ?? null,
      ...assessShadowTranscript(definition, observation.text)
    };
  });
  const amount = observations.filter(
    (item) => byId.get(item.caseId).knownUnsafe === true
  );
  const numericControls = observations.filter((item) => {
    const definition = byId.get(item.caseId);
    return (
      ["amount", "time"].includes(definition.slot) &&
      definition.knownUnsafe !== true &&
      definition.primaryCurrent !== null
    );
  });
  const cases = Object.fromEntries(definitions.map((definition) => {
    const items = observations.filter(
      (item) => item.caseId === definition.id
    );
    const normalizedTranscripts = new Set(
      items.map((item) => normalize(item.transcript))
    );
    return [definition.id, {
      slot: definition.slot,
      observations: items.length,
      stable: normalizedTranscripts.size === 1,
      currentRecoveryRate: ratio(items, (item) => item.currentRecovered),
      primaryAgreementRate: ratio(items, (item) => item.primaryAgreement),
      vetoRate: ratio(items, (item) => item.wouldVetoPrimary),
      inferenceMs: {
        p50: percentile(items.map((item) => item.elapsedMs), 0.5),
        p95: percentile(items.map((item) => item.elapsedMs), 0.95),
        max: percentile(items.map((item) => item.elapsedMs), 1)
      },
      transcripts: [...new Set(items.map((item) => item.transcript))]
    }];
  }));
  const amountCatchRate = ratio(
    amount,
    (item) => item.currentRecovered && item.wouldVetoPrimary
  );
  const numericAgreementRate = ratio(
    numericControls,
    (item) => item.currentRecovered && item.primaryAgreement
  );
  const transcriptStabilityRate = ratio(
    Object.values(cases),
    (item) => item.stable
  );
  const inferenceP95Ms = percentile(
    observations.map((item) => item.elapsedMs),
    0.95
  );
  const gates = {
    amountCatch:
      amountCatchRate >= gate.requiredAmountCatchRate,
    numericControlAgreement:
      numericAgreementRate >= gate.requiredNumericAgreementRate,
    transcriptStability:
      transcriptStabilityRate >= gate.requiredTranscriptStabilityRate,
    deployableLatency:
      inferenceP95Ms <= gate.maxDeployableInferenceP95Ms
  };
  return {
    id: `${candidate.engine}-${candidate.model}`,
    engine: candidate.engine,
    model: candidate.model,
    role: candidate.role,
    modelLoadMs: candidate.modelLoadMs,
    observationCount: observations.length,
    metrics: {
      amountCatchRate,
      numericAgreementRate,
      transcriptStabilityRate,
      inferenceP95Ms
    },
    gates,
    semanticPass:
      gates.amountCatch &&
      gates.numericControlAgreement &&
      gates.transcriptStability,
    deployablePass: Object.values(gates).every(Boolean),
    cases,
    observations
  };
}

export function evaluateExp0008(input) {
  const reconstructionPass =
    input.reconstructions.length === input.pack.cases.length &&
    input.reconstructions.every((item) => item.pass === true);
  const candidates = input.candidates.map((candidate) =>
    summarizeCandidate(candidate, input.pack.cases, input.pack.gate)
  );
  const qualityCeiling = candidates.find(
    (candidate) => candidate.role === "quality-ceiling"
  );
  const deployable = candidates.filter(
    (candidate) => candidate.deployablePass
  );
  const zeroPaidApiCalls = input.paidApiCalls === 0;
  let decision = "authorize-runtime-shadow";
  if (!reconstructionPass) {
    decision = "reject-invalid-input";
  } else if (!qualityCeiling?.semanticPass) {
    decision = "reject-semantic-signal";
  } else if (deployable.length === 0) {
    decision = "hold-latency";
  } else if (!zeroPaidApiCalls) {
    decision = "reject-cost-policy";
  }
  return {
    schemaVersion: 1,
    experimentId: "EXP-0008",
    generatedAt: new Date().toISOString(),
    evidenceLevel: "offline-shadow-feasibility",
    matrix: {
      cases: input.pack.cases.length,
      candidates: candidates.length,
      repetitions: input.pack.repetitions,
      observations: candidates.reduce(
        (total, candidate) => total + candidate.observationCount,
        0
      )
    },
    gates: {
      exactPcmReconstruction: reconstructionPass,
      qualityCeilingSemanticSignal: qualityCeiling?.semanticPass === true,
      deployableCandidate: deployable.length > 0,
      zeroPaidApiCalls
    },
    decision,
    authorizedAuthority:
      decision === "authorize-runtime-shadow" ? "shadow-only" : "none",
    deployableCandidates: deployable.map((item) => item.id),
    reconstructions: input.reconstructions,
    candidates,
    execution: {
      paidApiCalls: input.paidApiCalls
    }
  };
}
