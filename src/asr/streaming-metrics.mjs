import { commonPrefixLength } from "./text-stability.mjs";

function words(text) {
  return String(text ?? "").trim().split(/\s+/u).filter(Boolean);
}

function round(value) {
  return value === null
    ? null
    : Math.round(value * 100) / 100;
}

export function summarizeStreamingTrace(events, options = {}) {
  const minimumUsefulWords = options.minimumUsefulWords ?? 2;
  const partials = events.filter((event) => event.type === "partial");
  const visiblePartials = partials.filter(
    (event) => words(event.text).length > 0
  );
  const final = events.findLast((event) => event.type === "final") ?? null;
  const firstPartial = visiblePartials[0] ?? null;
  const firstUseful = visiblePartials.find(
    (event) => words(event.text).length >= minimumUsefulWords
  ) ?? null;
  const firstCommitted = partials.find(
    (event) => words(event.committedText).length > 0
  ) ?? null;

  let rewrittenWords = 0;
  let previous = [];
  let stablePrefixViolations = 0;
  let committed = [];
  for (const partial of partials) {
    const current = words(partial.text);
    rewrittenWords +=
      previous.length - commonPrefixLength(previous, current);
    previous = current;

    const nextCommitted = words(partial.committedText);
    if (
      nextCommitted.length < committed.length ||
      commonPrefixLength(committed, nextCommitted) !== committed.length
    ) {
      stablePrefixViolations += 1;
    }
    committed = nextCommitted;
  }

  const finalWords = words(final?.text);
  const finalCorrectionWords = final
    ? previous.length +
      finalWords.length -
      2 * commonPrefixLength(previous, finalWords)
    : null;
  const endpointAtMs = options.endpointAtMs ?? null;

  return {
    partialUpdates: partials.length,
    visiblePartialUpdates: visiblePartials.length,
    timeToFirstPartialMs: firstPartial
      ? round(firstPartial.elapsedMs)
      : null,
    timeToUsefulPartialMs: firstUseful
      ? round(firstUseful.elapsedMs)
      : null,
    timeToFirstCommittedMs: firstCommitted
      ? round(firstCommitted.elapsedMs)
      : null,
    finalAfterEndpointMs:
      final && endpointAtMs !== null
        ? round(final.atMs - endpointAtMs)
        : null,
    rewrittenWords,
    finalCorrectionWords,
    stablePrefixViolations
  };
}
