const DEFAULTS = Object.freeze({
  completeSilenceMs: 520,
  hardLimitSilenceMs: 1_500,
  incompleteSilenceMs: 1_050,
  minimumSilenceMs: 280,
  noTranscriptSilenceMs: 900,
  shortSpeechSilenceMs: 720,
  shortSpeechThresholdMs: 420
});

const TRAILING_FILLER =
  /(?:^|\s)(?:ah+n+|ah+m+|hã+|hum+|é+|tipo|assim|bom)\s*$/iu;
const TRAILING_CONNECTIVE =
  /(?:^|\s)(?:a|ao|aos|as|com|da|das|de|do|dos|e|em|mas|na|nas|no|nos|ou|para|porque|por|que|se|sem)\s*$/iu;
const OPEN_CORRECTION =
  /(?:não|quer dizer|na verdade|melhor|desculpa)[,.\s]*$/iu;

function normalize(text) {
  return String(text ?? "").trim().replace(/\s+/gu, " ");
}

export function looksIncompletePtBr(text) {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return (
    TRAILING_FILLER.test(normalized) ||
    TRAILING_CONNECTIVE.test(normalized) ||
    OPEN_CORRECTION.test(normalized)
  );
}

export function decideEndpoint(input, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const silenceMs = Math.max(0, Number(input.silenceMs) || 0);
  const speechMs = Math.max(0, Number(input.speechMs) || 0);
  const transcript = normalize(input.transcript);
  const incomplete = looksIncompletePtBr(transcript);

  let requiredSilenceMs = config.completeSilenceMs;
  let reason = "complete-utterance";

  if (!transcript) {
    requiredSilenceMs = config.noTranscriptSilenceMs;
    reason = "awaiting-transcript";
  } else if (incomplete) {
    requiredSilenceMs = config.incompleteSilenceMs;
    reason = "linguistically-incomplete";
  } else if (speechMs < config.shortSpeechThresholdMs) {
    requiredSilenceMs = config.shortSpeechSilenceMs;
    reason = "short-acoustic-event";
  }

  requiredSilenceMs = Math.min(
    config.hardLimitSilenceMs,
    Math.max(config.minimumSilenceMs, requiredSilenceMs)
  );
  const commit =
    silenceMs >= requiredSilenceMs ||
    silenceMs >= config.hardLimitSilenceMs;

  return {
    action: commit ? "commit" : "wait",
    reason: commit ? `${reason}:silence-satisfied` : reason,
    requiredSilenceMs,
    observedSilenceMs: silenceMs,
    transcript,
    incomplete
  };
}

export const ENDPOINT_DEFAULTS = DEFAULTS;
