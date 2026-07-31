const NUMBER_WORDS = new Map([
  [0, "zero"],
  [1, "um"],
  [2, "dois"],
  [3, "três"],
  [4, "quatro"],
  [5, "cinco"],
  [6, "seis"],
  [7, "sete"],
  [8, "oito"],
  [9, "nove"],
  [10, "dez"],
  [11, "onze"],
  [12, "doze"],
  [13, "treze"],
  [14, "quatorze"],
  [15, "quinze"],
  [16, "dezesseis"],
  [17, "dezessete"],
  [18, "dezoito"],
  [19, "dezenove"],
  [20, "vinte"],
  [30, "trinta"],
  [40, "quarenta"],
  [50, "cinquenta"],
  [60, "sessenta"],
  [70, "setenta"],
  [80, "oitenta"],
  [90, "noventa"],
  [100, "cem"],
  [200, "duzentos"],
  [300, "trezentos"],
  [400, "quatrocentos"],
  [500, "quinhentos"],
  [600, "seiscentos"],
  [700, "setecentos"],
  [800, "oitocentos"],
  [900, "novecentos"]
]);

function integerToPortuguese(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 9_999) {
    return String(value);
  }
  if (NUMBER_WORDS.has(value)) {
    return NUMBER_WORDS.get(value);
  }
  if (value < 100) {
    const tens = Math.floor(value / 10) * 10;
    return `${NUMBER_WORDS.get(tens)} e ${NUMBER_WORDS.get(value % 10)}`;
  }
  if (value < 1_000) {
    const hundreds = Math.floor(value / 100) * 100;
    const remainder = value % 100;
    const prefix =
      hundreds === 100 ? "cento" : NUMBER_WORDS.get(hundreds);
    return `${prefix} e ${integerToPortuguese(remainder)}`;
  }

  const thousands = Math.floor(value / 1_000);
  const remainder = value % 1_000;
  const prefix =
    thousands === 1 ? "mil" : `${integerToPortuguese(thousands)} mil`;
  if (remainder === 0) {
    return prefix;
  }
  const connector = remainder < 100 || remainder % 100 === 0 ? " e " : " ";
  return `${prefix}${connector}${integerToPortuguese(remainder)}`;
}

export function normalizeTranscript(text, options = {}) {
  const canonical = options.canonical ?? true;
  let normalized = String(text ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR");

  if (canonical) {
    normalized = normalized
      .replace(/\ba\s*[.]\s*h\s*[.]\s*n[.]?\b/gu, "ahn")
      .replace(
        /r\s*\$\s*(\d{1,4})(?:[.,](\d{2}))?/gu,
        (_match, major, cents) =>
          cents && cents !== "00"
            ? `${major} reais e ${cents} centavos`
            : `${major} reais`
      )
      .replace(/\b(\d{1,2})(?::00|\s*h)\b/gu, "$1 horas")
      .replace(/\b\d{1,4}\b/gu, (token) =>
        integerToPortuguese(Number.parseInt(token, 10))
      );
  }

  return normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function editDistance(expected, actual) {
  const previous = Array.from(
    { length: actual.length + 1 },
    (_, index) => index
  );

  for (let left = 1; left <= expected.length; left += 1) {
    const current = [left];
    for (let right = 1; right <= actual.length; right += 1) {
      current[right] = Math.min(
        current[right - 1] + 1,
        previous[right] + 1,
        previous[right - 1] +
          (expected[left - 1] === actual[right - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous.at(-1);
}

function scoreNormalized(expectedText, actualText, canonical) {
  const expectedWords = normalizeTranscript(expectedText, { canonical })
    .split(" ")
    .filter(Boolean);
  const actualWords = normalizeTranscript(actualText, { canonical })
    .split(" ")
    .filter(Boolean);
  const errors = editDistance(expectedWords, actualWords);

  return {
    actualWords: actualWords.length,
    errors,
    expectedWords: expectedWords.length,
    wer:
      expectedWords.length === 0
        ? 0
        : Math.round((errors / expectedWords.length) * 10_000) / 10_000
  };
}

export function scoreTranscript(expectedText, actualText) {
  const canonical = scoreNormalized(expectedText, actualText, true);
  const literal = scoreNormalized(expectedText, actualText, false);

  return {
    ...canonical,
    literalErrors: literal.errors,
    literalWer: literal.wer,
    normalization: "pt-BR-v1"
  };
}
