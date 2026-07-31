function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function latestBefore(trace, type, beforeAtMs) {
  return trace.findLast(
    (event) => event.type === type && event.atMs <= beforeAtMs
  ) ?? null;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function userSpeechIntervals(trace, scopeStartAtMs) {
  const intervals = [];
  let startedAtMs = null;
  for (const event of trace) {
    if (event.atMs < scopeStartAtMs) {
      continue;
    }
    if (event.type === "user.speech.started") {
      if (startedAtMs !== null) {
        intervals.push({ startAtMs: startedAtMs, endAtMs: null });
      }
      startedAtMs = event.atMs;
    } else if (
      event.type === "user.speech.ended" &&
      startedAtMs !== null
    ) {
      intervals.push({ startAtMs: startedAtMs, endAtMs: event.atMs });
      startedAtMs = null;
    }
  }
  if (startedAtMs !== null) {
    intervals.push({ startAtMs: startedAtMs, endAtMs: null });
  }
  return intervals;
}

export function browserSnapshotToCorrectionObservation(
  definition,
  snapshot,
  options = {}
) {
  if (!snapshot || !Array.isArray(snapshot.trace)) {
    throw new TypeError("snapshot do Chrome precisa conter trace");
  }
  const trace = snapshot.trace;
  const explicitScopeStartAtMs = Number.isFinite(options.scopeStartAtMs)
    ? options.scopeStartAtMs
    : null;
  const rollback = trace.findLast(
    (event) =>
      event.type === "state.rollback" &&
      (
        explicitScopeStartAtMs === null ||
        event.atMs >= explicitScopeStartAtMs
      )
  );
  const correctionSpeechStart = explicitScopeStartAtMs === null
    ? latestBefore(trace, "user.speech.started", rollback?.atMs ?? Infinity)
    : trace.find(
      (event) =>
        event.type === "user.speech.started" &&
        event.atMs >= explicitScopeStartAtMs
    ) ?? null;
  const correctionScopeStartAtMs =
    explicitScopeStartAtMs ?? correctionSpeechStart?.atMs ?? -Infinity;
  const matchingCommits = trace.filter(
    (event) =>
      event.type === "turn.committed" &&
      event.atMs >= (explicitScopeStartAtMs ?? -Infinity) &&
      normalize(event.detail) === normalize(definition.text)
  );
  const scopedCommits = trace.filter(
    (event) =>
      event.type === "turn.committed" &&
      event.atMs >= correctionScopeStartAtMs
  );
  const scopedRollbacks = trace.filter(
    (event) =>
      event.type === "state.rollback" &&
      event.atMs >= correctionScopeStartAtMs
  );
  const commit = matchingCommits.at(-1) ?? scopedCommits.at(-1) ??
    latestBefore(trace, "turn.committed", rollback?.atMs ?? Infinity);
  const userEnd = latestBefore(
    trace,
    "user.speech.ended",
    commit?.atMs ?? Infinity
  );
  const assistantSpeechStartsAtMs = trace
    .filter(
      (event) =>
        event.type === "assistant.speech.started" &&
        event.atMs >= correctionScopeStartAtMs &&
        !["acknowledgment", "backchannel"].includes(event.detail)
    )
    .map((event) => event.atMs);
  const observation = {
    finalTranscript: commit?.detail ?? snapshot.text?.user,
    semanticState: snapshot.semantic?.state ?? null,
    rollback: parseJsonObject(scopedRollbacks.at(-1)?.detail),
    userSpeechStartedAtMs: correctionSpeechStart?.atMs,
    userSpeechEndedAtMs: userEnd?.atMs,
    commitAtMs: commit?.atMs,
    rollbackAtMs: scopedRollbacks.at(-1)?.atMs,
    userSpeechIntervals: userSpeechIntervals(
      trace,
      correctionScopeStartAtMs
    ),
    assistantSpeechStartsAtMs,
    assistantText: snapshot.text?.assistant,
    spokenUtterances: trace
      .filter(
        (event) =>
          event.type === "assistant.utterance.started" &&
          event.atMs >= correctionScopeStartAtMs
      )
      .map((event) => parseJsonObject(event.detail))
      .filter(Boolean),
    commitCount:
      explicitScopeStartAtMs !== null
        ? scopedCommits.length
        : Math.max(matchingCommits.length, scopedCommits.length),
    revisionCount: scopedRollbacks.length,
    delegations: trace
      .filter(
        (event) =>
          event.type === "task.delegated" &&
          event.atMs >= correctionScopeStartAtMs
      )
      .map((event) => ({ detail: event.detail }))
  };
  if (options.effectsMeasured === true) {
    observation.effects = options.effects ?? [];
  }
  return observation;
}
