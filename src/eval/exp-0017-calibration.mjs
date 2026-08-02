import {
  SPEAKER_RELEVANCE_CLASSES
} from "./speaker-relevance-features.mjs";

const BACKGROUND = "BACKGROUND_OR_NOT_DIRECTED";
const DIRECTED = "DIRECTED_TO_ASSISTANT";

function sortedObservations(observations, options = {}) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new TypeError("observations precisa conter casos");
  }
  const result = observations.map((observation, index) => {
    if (
      typeof observation?.exampleId !== "string" ||
      observation.exampleId.length === 0 ||
      !SPEAKER_RELEVANCE_CLASSES.includes(observation.expected) ||
      (options.requirePrediction === true &&
        !SPEAKER_RELEVANCE_CLASSES.includes(observation.predicted)) ||
      (options.requireProbability === true && (
        !Number.isFinite(observation.backgroundProbability) ||
        observation.backgroundProbability < 0 ||
        observation.backgroundProbability > 1
      ))
    ) {
      throw new TypeError(`observation[${index}] é incompatível`);
    }
    return { ...observation };
  }).sort((left, right) => left.exampleId.localeCompare(right.exampleId));
  if (new Set(result.map((item) => item.exampleId)).size !== result.length) {
    throw new TypeError("exampleId duplicado");
  }
  return result;
}

function emptyConfusion() {
  return Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map((expected) => [
    expected,
    Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map(
      (predicted) => [predicted, 0]
    ))
  ]));
}

export function summarizeExp0017Observations(observations) {
  const ordered = sortedObservations(observations, {
    requirePrediction: true
  });
  const confusion = emptyConfusion();
  for (const observation of ordered) {
    confusion[observation.expected][observation.predicted] += 1;
  }
  const correct = ordered.filter(
    (observation) => observation.expected === observation.predicted
  ).length;
  const classRecall = Object.fromEntries(
    SPEAKER_RELEVANCE_CLASSES.map((label) => {
      const total = Object.values(confusion[label]).reduce(
        (sum, count) => sum + count,
        0
      );
      return [label, total === 0 ? null : confusion[label][label] / total];
    })
  );
  return Object.freeze({
    observations: ordered.length,
    correct,
    accuracy: correct / ordered.length,
    classRecall: Object.freeze(classRecall),
    confusion: Object.freeze(confusion),
    errors: Object.freeze(ordered.filter(
      (observation) => observation.expected !== observation.predicted
    ).map((observation) => Object.freeze({ ...observation })))
  });
}

export function evaluateExp0017SafeVetoThreshold(observations, threshold) {
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) {
    throw new RangeError("threshold precisa estar em [0.5, 1]");
  }
  const ordered = sortedObservations(observations, {
    requireProbability: true
  });
  const evaluated = ordered.map((observation) => Object.freeze({
    ...observation,
    predicted: observation.backgroundProbability >= threshold
      ? BACKGROUND
      : DIRECTED,
    correct: observation.expected === (
      observation.backgroundProbability >= threshold ? BACKGROUND : DIRECTED
    )
  }));
  const summary = summarizeExp0017Observations(evaluated);
  return Object.freeze({
    threshold,
    directedRecall: summary.classRecall[DIRECTED],
    backgroundCoverage: summary.classRecall[BACKGROUND],
    accuracy: summary.accuracy,
    falseDirectedVetoes:
      summary.confusion[DIRECTED][BACKGROUND],
    backgroundVetoes:
      summary.confusion[BACKGROUND][BACKGROUND],
    summary,
    observations: Object.freeze(evaluated)
  });
}

function thresholdCandidates(observations, minimumThreshold) {
  return [...new Set([
    minimumThreshold,
    1,
    ...observations
      .map((observation) => observation.backgroundProbability)
      .filter((probability) => probability >= minimumThreshold)
  ])].sort((left, right) => left - right);
}

export function selectExp0017SafeVetoThreshold(observations, options = {}) {
  const minimumThreshold = options.minimumThreshold ?? 0.5;
  if (
    !Number.isFinite(minimumThreshold) ||
    minimumThreshold < 0.5 ||
    minimumThreshold > 1
  ) {
    throw new RangeError("minimumThreshold precisa estar em [0.5, 1]");
  }
  const ordered = sortedObservations(observations, {
    requireProbability: true
  });
  for (const label of SPEAKER_RELEVANCE_CLASSES) {
    if (!ordered.some((observation) => observation.expected === label)) {
      throw new TypeError(`calibração não contém ${label}`);
    }
  }
  const candidates = thresholdCandidates(ordered, minimumThreshold);
  const evaluated = candidates.map((threshold) =>
    evaluateExp0017SafeVetoThreshold(ordered, threshold)
  );
  const safe = evaluated.filter((item) => item.directedRecall === 1).sort(
    (left, right) =>
      right.backgroundCoverage - left.backgroundCoverage ||
      right.accuracy - left.accuracy ||
      right.threshold - left.threshold
  );
  const selected = safe[0] ?? null;
  return Object.freeze({
    schemaVersion: "exp-0017-safe-veto-threshold-selection-v1",
    objective:
      "maximize-background-coverage-subject-to-perfect-directed-recall",
    minimumThreshold,
    requiredDirectedRecall: 1,
    examples: ordered.length,
    candidateThresholds: Object.freeze(candidates),
    evaluated: Object.freeze(evaluated),
    safeCandidates: safe.length,
    safeSolution: selected !== null,
    noSafeSolution: selected === null,
    selected
  });
}

export function compareExp0017Paired(referenceObservations, candidateObservations) {
  if (
    !Array.isArray(referenceObservations) ||
    !Array.isArray(candidateObservations) ||
    referenceObservations.length === 0 ||
    referenceObservations.length !== candidateObservations.length
  ) {
    throw new TypeError("universos pareados são divergentes");
  }
  const reference = sortedObservations(referenceObservations, {
    requirePrediction: true
  });
  const candidate = sortedObservations(candidateObservations, {
    requirePrediction: true
  });
  if (
    reference.length !== candidate.length ||
    reference.some(
      (observation, index) =>
        observation.exampleId !== candidate[index].exampleId
    )
  ) {
    throw new TypeError("universos pareados são divergentes");
  }
  const cases = reference.map((referenceObservation, index) => {
    const candidateObservation = candidate[index];
    if (referenceObservation.expected !== candidateObservation.expected) {
      throw new TypeError(
        `gabarito divergente em ${referenceObservation.exampleId}`
      );
    }
    const referenceCorrect =
      referenceObservation.predicted === referenceObservation.expected;
    const candidateCorrect =
      candidateObservation.predicted === candidateObservation.expected;
    return Object.freeze({
      exampleId: referenceObservation.exampleId,
      expected: referenceObservation.expected,
      referencePredicted: referenceObservation.predicted,
      candidatePredicted: candidateObservation.predicted,
      referenceCorrect,
      candidateCorrect,
      outcome: candidateCorrect && !referenceCorrect
        ? "WIN"
        : !candidateCorrect && referenceCorrect
          ? "LOSS"
          : candidateCorrect
            ? "BOTH_CORRECT"
            : "BOTH_WRONG"
    });
  });
  const byOutcome = (outcome) => cases.filter(
    (item) => item.outcome === outcome
  );
  const wins = byOutcome("WIN");
  const losses = byOutcome("LOSS");
  const bothCorrect = byOutcome("BOTH_CORRECT");
  const bothWrong = byOutcome("BOTH_WRONG");
  return Object.freeze({
    observations: cases.length,
    wins: wins.length,
    losses: losses.length,
    ties: bothCorrect.length + bothWrong.length,
    bothCorrect: bothCorrect.length,
    bothWrong: bothWrong.length,
    netGain: wins.length - losses.length,
    accuracyGain: (wins.length - losses.length) / cases.length,
    winExampleIds: Object.freeze(wins.map((item) => item.exampleId)),
    lossExampleIds: Object.freeze(losses.map((item) => item.exampleId)),
    cases: Object.freeze(cases)
  });
}

export const EXP0017_BACKGROUND_CLASS = BACKGROUND;
export const EXP0017_DIRECTED_CLASS = DIRECTED;
