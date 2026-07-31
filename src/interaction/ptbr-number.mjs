const VALUES = new Map([
  ["zero", 0], ["um", 1], ["uma", 1], ["dois", 2], ["duas", 2],
  ["tres", 3], ["quatro", 4], ["cinco", 5], ["seis", 6],
  ["sete", 7], ["oito", 8], ["nove", 9], ["dez", 10],
  ["onze", 11], ["doze", 12], ["treze", 13], ["catorze", 14],
  ["quatorze", 14], ["quinze", 15], ["dezesseis", 16],
  ["dezessete", 17], ["dezoito", 18], ["dezenove", 19],
  ["vinte", 20], ["trinta", 30], ["quarenta", 40],
  ["cinquenta", 50], ["sessenta", 60], ["setenta", 70],
  ["oitenta", 80], ["noventa", 90], ["cem", 100],
  ["cento", 100], ["centro", 100], ["duzentos", 200],
  ["duzentas", 200], ["trezentos", 300], ["trezentas", 300],
  ["quatrocentos", 400], ["quatrocentas", 400],
  ["quinhentos", 500], ["quinhentas", 500], ["seiscentos", 600],
  ["seiscentas", 600], ["setecentos", 700], ["setecentas", 700],
  ["oitocentos", 800], ["oitocentas", 800], ["novecentos", 900],
  ["novecentas", 900]
]);

function normalizeToken(value) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function localizedNumericValue(value) {
  const raw = String(value);
  if (!/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$|^\d+(?:,\d+)?$/u.test(raw)) {
    return null;
  }
  const parsed = Number(raw.replaceAll(".", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function lexicalTokens(text) {
  return [...String(text ?? "").matchAll(
    /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?|[\p{L}]+/gu
  )].map((match) => ({
    raw: match[0],
    normalized: normalizeToken(match[0]),
    start: match.index,
    end: match.index + match[0].length
  }));
}

function normalizedTokens(text) {
  return lexicalTokens(text).map((token) => {
    const numeric = localizedNumericValue(token.raw);
    return numeric === null ? token.normalized : String(numeric);
  });
}

export function parsePtBrNumberPhrase(text) {
  const tokens = normalizedTokens(text);
  let total = 0;
  let group = 0;
  let found = false;
  for (const token of tokens) {
    if (/^\d+$/u.test(token)) {
      if (found) {
        break;
      }
      group = Number.parseInt(token, 10);
      found = true;
      continue;
    }
    if (token === "e" && found) {
      continue;
    }
    if (VALUES.has(token)) {
      group += VALUES.get(token);
      found = true;
      continue;
    }
    if (token === "mil") {
      total += (group || 1) * 1_000;
      group = 0;
      found = true;
      continue;
    }
    if (token === "milhao" || token === "milhoes") {
      total += (group || 1) * 1_000_000;
      group = 0;
      found = true;
      continue;
    }
    if (found) {
      break;
    }
  }
  return found ? total + group : null;
}

export function extractPtBrCurrencyAmounts(text) {
  const source = String(text ?? "");
  const results = [];
  const occupied = [];
  for (const match of source.matchAll(
    /r\s*\$\s*([\d.]+(?:,\d{1,2})?)/giu
  )) {
    const value = Number.parseFloat(
      match[1].replaceAll(".", "").replace(",", ".")
    );
    results.push({
      value,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
    occupied.push([match.index, match.index + match[0].length]);
  }
  const tokens = lexicalTokens(source);
  for (let index = 0; index < tokens.length; index += 1) {
    const currency = tokens[index];
    if (!["real", "reais"].includes(currency.normalized)) {
      continue;
    }
    let first = index - 1;
    let hasNumber = false;
    while (first >= 0) {
      const token = tokens[first];
      const numeric = localizedNumericValue(token.raw);
      const numberWord =
        numeric !== null ||
        VALUES.has(token.normalized) ||
        ["mil", "milhao", "milhoes"].includes(token.normalized);
      if (numberWord) {
        hasNumber = true;
        first -= 1;
        continue;
      }
      if (token.normalized === "e" && hasNumber) {
        first -= 1;
        continue;
      }
      break;
    }
    first += 1;
    while (tokens[first]?.normalized === "e") {
      first += 1;
    }
    if (!hasNumber || first >= index) {
      continue;
    }
    const start = tokens[first].start;
    const end = currency.end;
    if (occupied.some(([left, right]) => start < right && end > left)) {
      continue;
    }
    const amountText = source.slice(start, currency.start).trim();
    const directNumeric = first === index - 1
      ? localizedNumericValue(tokens[first].raw)
      : null;
    const value = directNumeric ?? parsePtBrNumberPhrase(amountText);
    if (Number.isFinite(value)) {
      results.push({ value, raw: source.slice(start, end), start, end });
    }
  }
  return results.sort((left, right) => left.start - right.start);
}
