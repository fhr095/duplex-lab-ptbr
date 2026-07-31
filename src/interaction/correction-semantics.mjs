import { extractPtBrCurrencyAmounts } from "./ptbr-number.mjs";

const WEEKDAYS = new Map([
  ["segunda", "segunda"],
  ["segunda-feira", "segunda"],
  ["terça", "terça"],
  ["terca", "terça"],
  ["terça-feira", "terça"],
  ["terca-feira", "terça"],
  ["quarta", "quarta"],
  ["quarta-feira", "quarta"],
  ["quinta", "quinta"],
  ["quinta-feira", "quinta"],
  ["sexta", "sexta"],
  ["sexta-feira", "sexta"],
  ["sábado", "sábado"],
  ["sabado", "sábado"],
  ["domingo", "domingo"]
]);

const MARKER_RE = /\b(não|na verdade|quer dizer|corrigindo|melhor|deixa(?:\s+(?:para|pra|na|no))?)\b/iu;

function cleanEffectiveText(value) {
  return value
    .replace(/\s+([,.;!?])/gu, "$1")
    .replace(/([,;])\s*[.;]/gu, ".")
    .replace(/\.{2,}/gu, ".")
    .replace(/\s+/gu, " ")
    .trim();
}

function weekdayCandidates(text) {
  const regex = /\b(segunda(?:-feira)?|terça(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|sabado|domingo)\b/giu;
  return [...text.matchAll(regex)].map((match) => ({
    slot: "weekday",
    value: WEEKDAYS.get(match[0].toLocaleLowerCase("pt-BR")),
    raw: match[0],
    start: match.index,
    end: match.index + match[0].length
  }));
}

function timeCandidates(text) {
  const regex = /(?:às|as)\s+(\d{1,2})(?:(?::|h)\s*(\d{0,2}))?(?:\s*horas?)?\b/giu;
  return [...text.matchAll(regex)].map((match) => {
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2] || "0", 10);
    return {
      slot: "time",
      value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length
    };
  }).filter((item) => {
    const [hour, minute] = item.value.split(":").map(Number);
    return hour <= 23 && minute <= 59;
  });
}

function amountCandidates(text) {
  return extractPtBrCurrencyAmounts(text).map((match) => {
    const numeric = match.value;
    const formatted = Number.isInteger(numeric)
      ? String(numeric)
      : numeric.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
    return {
      slot: "amount",
      value: `BRL ${formatted}`,
      raw: match.raw,
      start: match.start,
      end: match.end
    };
  });
}

function nameCandidates(text) {
  const regex = /\b(?:com|nome\s+de)\s+(?:(?:o|a)\s+)?([\p{Lu}][\p{L}'-]{1,40})\b/gu;
  return [...text.matchAll(regex)].map((match) => {
    const name = match[1];
    const offset = match[0].lastIndexOf(name);
    const start = match.index + offset;
    return {
      slot: "name",
      value: name,
      raw: name,
      start,
      end: start + name.length
    };
  });
}

function markerBetween(text, previous, current) {
  const middle = text.slice(previous.end, current.start);
  return MARKER_RE.exec(middle)?.[1] ?? null;
}

function findRevision(text) {
  for (const candidates of [
    weekdayCandidates(text),
    timeCandidates(text),
    amountCandidates(text),
    nameCandidates(text)
  ]) {
    if (candidates.length < 2) {
      continue;
    }
    const current = candidates.at(-1);
    const previous = candidates.at(-2);
    const marker = markerBetween(text, previous, current);
    if (!marker) {
      continue;
    }
    return { previous, current, marker };
  }
  return null;
}

export function analyzeCorrection(rawText) {
  const text = String(rawText ?? "").trim().replace(/\s+/gu, " ");
  const found = findRevision(text);
  if (!found) {
    return {
      isCorrection: false,
      effectiveText: text,
      revisions: []
    };
  }
  const effectiveText = cleanEffectiveText(
    text.slice(0, found.previous.start) +
      found.current.raw +
      text.slice(found.current.end)
  );
  const revision = {
    id: "revision-1",
    slot: found.current.slot,
    obsolete: found.previous.value,
    current: found.current.value,
    marker: found.marker.toLocaleLowerCase("pt-BR")
  };
  return {
    isCorrection: true,
    effectiveText,
    revisions: [revision],
    correction: revision
  };
}
