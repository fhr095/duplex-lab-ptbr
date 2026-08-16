// Ferramenta real da engine (RC v0.1): previsão do tempo via Open-Meteo
// (HTTP público, sem credencial). Primeira ferramenta com EFEITO EXTERNO
// verdadeiro na rota de delegação: acknowledgment imediato no cliente,
// execução assíncrona aqui, resultado falado depois, cancelável por
// AbortSignal. NUNCA executa em estágio especulativo (effectsAllowed).

const INTENT =
  /\b(?:previs[aã]o|tempo|clima|chover|chuva|temperatura)\b/iu;
const CITY =
  /\b(?:em|de|para|pra)\s+([\p{Letter}][\p{Letter}\s]{2,40}?)(?:\s+(?:hoje|amanh[aã]|agora))?[?.!]*$/iu;

export function weatherIntent(query) {
  return INTENT.test(String(query ?? ""));
}

export function extractCity(query) {
  const match = CITY.exec(String(query ?? "").trim());
  return match?.[1]?.trim() ?? "São Paulo";
}

const CODES = new Map([
  [0, "céu limpo"], [1, "predominantemente limpo"],
  [2, "parcialmente nublado"], [3, "nublado"],
  [45, "neblina"], [51, "garoa fraca"], [53, "garoa"],
  [61, "chuva fraca"], [63, "chuva"], [65, "chuva forte"],
  [80, "pancadas de chuva"], [95, "trovoadas"]
]);

export async function fetchWeatherSummary(query, { signal } = {}) {
  const city = extractCity(query);
  const geo = await fetch(
    "https://geocoding-api.open-meteo.com/v1/search?count=1" +
      `&language=pt&name=${encodeURIComponent(city)}`,
    { signal }
  ).then((response) => response.json());
  const place = geo?.results?.[0];
  if (!place) {
    return `Não encontrei a cidade "${city}" para consultar o tempo.`;
  }
  const forecast = await fetch(
    "https://api.open-meteo.com/v1/forecast?current=temperature_2m," +
      "weather_code&daily=temperature_2m_max,temperature_2m_min," +
      "precipitation_probability_max&timezone=auto&forecast_days=2" +
      `&latitude=${place.latitude}&longitude=${place.longitude}`,
    { signal }
  ).then((response) => response.json());
  const current = forecast?.current;
  const daily = forecast?.daily;
  if (!current || !daily) {
    return `A consulta do tempo para ${place.name} falhou agora.`;
  }
  const condition = CODES.get(current.weather_code) ?? "tempo estável";
  return `Em ${place.name} agora: ${Math.round(current.temperature_2m)}` +
    `°C, ${condition}. Amanhã: máxima de ` +
    `${Math.round(daily.temperature_2m_max[1])}°C, mínima de ` +
    `${Math.round(daily.temperature_2m_min[1])}°C, com ` +
    `${daily.precipitation_probability_max[1] ?? 0}% de chance de chuva.`;
}
