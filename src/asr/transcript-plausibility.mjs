function words(text) {
  return String(text ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function maximumFrequencyRatio(tokens, size) {
  if (tokens.length < size) {
    return 0;
  }
  const counts = new Map();
  let maximum = 0;
  const total = tokens.length - size + 1;
  for (let index = 0; index < total; index += 1) {
    const key = tokens.slice(index, index + size).join(" ");
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    maximum = Math.max(maximum, count);
  }
  return maximum / total;
}

export function assessTranscriptPlausibility(input, options = {}) {
  const tokens = words(input.text);
  const audioMs = Math.max(0, Number(input.audioMs) || 0);
  const maxWordsPerSecond = options.maxWordsPerSecond ?? 5.5;
  const minimumWordAllowance = options.minimumWordAllowance ?? 4;
  const maxWords = Math.max(
    minimumWordAllowance,
    Math.ceil(audioMs / 1_000 * maxWordsPerSecond)
  );
  const unigramRepeatRatio = maximumFrequencyRatio(tokens, 1);
  const trigramRepeatRatio = maximumFrequencyRatio(tokens, 3);
  const reasons = [];

  if (tokens.length > maxWords) {
    reasons.push("impossible-speaking-rate");
  }
  if (tokens.length >= 9 && unigramRepeatRatio > 0.45) {
    reasons.push("degenerate-word-repetition");
  }
  if (tokens.length >= 12 && trigramRepeatRatio > 0.3) {
    reasons.push("degenerate-phrase-repetition");
  }

  return {
    pass: reasons.length === 0,
    reasons,
    audioMs,
    wordCount: tokens.length,
    maxWords,
    wordsPerSecond:
      audioMs > 0
        ? Math.round(tokens.length / (audioMs / 1_000) * 100) / 100
        : null,
    unigramRepeatRatio:
      Math.round(unigramRepeatRatio * 10_000) / 10_000,
    trigramRepeatRatio:
      Math.round(trigramRepeatRatio * 10_000) / 10_000
  };
}
