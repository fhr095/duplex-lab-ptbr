import {
  extractPtBrCurrencyAmounts,
  parsePtBrNumberPhrase
} from "../interaction/ptbr-number.mjs";

const STRONG_ENGLISH_MARKERS = new Set([
  "good",
  "hello",
  "know",
  "okay",
  "okey",
  "please",
  "sorry",
  "thank",
  "thanks",
  "time",
  "yeah",
  "you"
]);

const CORRECTION_MARKERS = new Set([
  "nao", "melhor", "corrigindo"
]);

function normalizedWords(text) {
  return String(text ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function parsePtBrNumberAfterCorrection(text) {
  const words = normalizedWords(text);
  let markerIndex = -1;
  for (let index = 0; index < words.length; index += 1) {
    if (
      CORRECTION_MARKERS.has(words[index]) ||
      (words[index] === "quer" && words[index + 1] === "dizer") ||
      (words[index] === "na" && words[index + 1] === "verdade")
    ) {
      markerIndex = index +
        (["quer", "na"].includes(words[index]) ? 2 : 1);
    }
  }
  if (markerIndex < 0) {
    return null;
  }
  return parsePtBrNumberPhrase(words.slice(markerIndex).join(" "));
}

function lastWrittenNumber(text) {
  const matches = [
    ...String(text).matchAll(/\b\d+(?:\.\d{3})*(?:,\d+)?\b/gu)
  ];
  const raw = matches.at(-1)?.[0];
  if (!raw) {
    return null;
  }
  const value = Number(raw.replaceAll(".", "").replace(",", "."));
  return Number.isFinite(value) ? { raw, value } : null;
}

function detectCriticalNumericConflict(finalText, provisionalText) {
  if (!/(?:r\$|\breais?\b|\btransf\p{L}*)/iu.test(finalText)) {
    return null;
  }
  const extractedAmounts = extractPtBrCurrencyAmounts(finalText);
  const finalNumber = extractedAmounts.length > 0
    ? { value: extractedAmounts.at(-1).value }
    : lastWrittenNumber(finalText);
  const provisionalNumber = parsePtBrNumberAfterCorrection(provisionalText);
  if (
    !finalNumber ||
    !Number.isFinite(provisionalNumber) ||
    finalNumber.value === provisionalNumber
  ) {
    return null;
  }
  return {
    kind: "numeric-correction-conflict",
    finalValue: finalNumber.value,
    provisionalValue: provisionalNumber,
    alternatives: [finalNumber.value, provisionalNumber],
    policy: "clarify-before-commit"
  };
}

function detectCriticalInstability(finalText, provisionalText) {
  if (
    !/(?:r\$|\breais?\b|\b\d[\d.,]*\b)/iu.test(finalText) ||
    /\b(?:não|na verdade|quer dizer|corrigindo|melhor)\b/iu.test(finalText)
  ) {
    return null;
  }
  const finalWords = normalizedWords(finalText).filter((word) => word !== "e");
  const provisionalWords = normalizedWords(provisionalText).filter(
    (word) => word !== "e"
  );
  if (finalWords.length < 3 || provisionalWords.length < 3) {
    return null;
  }
  const provisionalSet = new Set(provisionalWords);
  const overlap = finalWords.filter((word) => provisionalSet.has(word)).length;
  const overlapRatio = overlap / Math.max(finalWords.length, provisionalWords.length);
  return overlapRatio < 0.3
    ? {
        kind: "low-agreement-critical-number",
        overlapRatio,
        policy: "extend-commit-grace"
      }
    : null;
}

export function reconcileFinalTranscript(input) {
  const finalText = String(input.finalText ?? "").trim();
  const provisionalText = String(input.provisionalText ?? "").trim();
  const engine = String(input.engine ?? "");
  const unchanged = {
    text: finalText,
    source: "final",
    reason: null
  };

  if (engine !== "parakeet" || !provisionalText) {
    return unchanged;
  }
  if (!finalText) {
    return {
      text: provisionalText,
      source: "partial-fallback",
      reason: "empty-parakeet-final"
    };
  }

  const finalWords = normalizedWords(finalText);
  const provisionalWords = normalizedWords(provisionalText);
  const englishMarkers = finalWords.filter((word) =>
    STRONG_ENGLISH_MARKERS.has(word)
  ).length;
  if (
    englishMarkers >= 2 &&
    englishMarkers / finalWords.length >= 0.4
  ) {
    return {
      text: provisionalText,
      source: "partial-fallback",
      reason: "english-language-flip"
    };
  }

  if (
    finalWords.length === 1 &&
    finalWords[0] === "no" &&
    provisionalWords.includes("nao")
  ) {
    return {
      text: provisionalText,
      source: "partial-fallback",
      reason: "ambiguous-no-language-flip"
    };
  }

  const criticalConflict = detectCriticalNumericConflict(
    finalText,
    provisionalText
  );
  if (criticalConflict) {
    return {
      ...unchanged,
      criticalConflict
    };
  }

  const criticalInstability = detectCriticalInstability(
    finalText,
    provisionalText
  );
  if (criticalInstability) {
    return {
      ...unchanged,
      criticalInstability
    };
  }

  return unchanged;
}
