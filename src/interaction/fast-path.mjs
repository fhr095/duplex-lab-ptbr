// Contrato de arbitragem da camada rápida (challenger exp/caminho-ouro).
//
// O ativo proprietário é o CONTRATO, não o ocupante do slot rápido: uma
// função pura, abstencionista, com schema fechado, decide se o turno pode
// ser respondido localmente ANTES de acionar o reasoner. O ocupante v0 é
// determinístico (regex + relógio); um modelo pequeno só entra depois, como
// challenger deste controle, medido pela cobertura que ADICIONA.
//
// Ações do schema fechado:
//   LOCAL_FINAL — a camada rápida responde por inteiro; reasoner nem é
//                 chamado (economia de custo e latência).
//   PASS        — abstenção (default): fluxo normal via reasoner.
// (BRIDGE e CLARIFY estão reservados no contrato; BRIDGE exige handoff com
//  prefixo injetado no reasoner e entra junto com o fast-path aprendido.
//  CLARIFY hoje é coberto pelo interlock de confirmação crítica do kernel.)
//
// Regra de segurança: "turno curto" NÃO implica "seguro para responder
// localmente" — só classes explicitamente whitelistadas retornam LOCAL_FINAL,
// e qualquer sinal de conteúdo adicional força PASS.

export const FAST_PATH_VERSION = "fast-path-v0";

const GREETING =
  /^(?:oi+|olá|ola|opa|e aí|eai|bom dia|boa tarde|boa noite)[!.,\s]*(?:tudo bem|tudo bom|como vai)?[?!.\s]*$/iu;
const THANKS =
  /^(?:muito\s+)?(?:obrigad[oa]+|valeu|brigad[oa]+)[!.,\s]*(?:viu|mesmo|demais)?[?!.\s]*$/iu;
const FAREWELL =
  /^(?:tchau+|até mais|até logo|até amanhã|falou|boa noite)[!.,\s]*$/iu;
const ASK_TIME =
  /^(?:me diz(?:er)?\s+)?(?:que horas são|qual\s+(?:é\s+)?a hora|que hora é)(?:\s+agora)?[?!.\s]*$/iu;
const ASK_DATE =
  /^(?:que dia é hoje|qual\s+(?:é\s+)?a data(?:\s+de)?(?:\s+hoje)?|que data é hoje)[?!.\s]*$/iu;
const ASK_WEEKDAY =
  /^(?:que dia da semana é hoje|hoje é que dia da semana)[?!.\s]*$/iu;

const WEEKDAYS = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado"
];
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"
];

function saoPauloNow(now) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    minute: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "long",
    hour12: false
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    hour: Number.parseInt(get("hour"), 10),
    minute: Number.parseInt(get("minute"), 10),
    day: Number.parseInt(get("day"), 10),
    month: Number.parseInt(get("month"), 10),
    weekday: get("weekday")
  };
}

function spokenTime({ hour, minute }) {
  const hours = `${hour} ${hour === 1 ? "hora" : "horas"}`;
  if (minute === 0) {
    return `${hours} em ponto`;
  }
  return `${hours} e ${minute} ${minute === 1 ? "minuto" : "minutos"}`;
}

const RESPONDERS = [
  ["saudacao", GREETING, () =>
    "Oi! Tudo bem por aqui. Pode falar."],
  ["agradecimento", THANKS, () =>
    "De nada! Precisando, é só falar."],
  ["despedida", FAREWELL, () =>
    "Até mais! Foi bom falar com você."],
  ["hora", ASK_TIME, (now) =>
    `Agora são ${spokenTime(saoPauloNow(now))} em Brasília.`],
  ["data", ASK_DATE, (now) => {
    const { day, month } = saoPauloNow(now);
    return `Hoje é dia ${day} de ${MONTHS[month - 1]}.`;
  }],
  ["dia-semana", ASK_WEEKDAY, (now) => {
    const { weekday } = saoPauloNow(now);
    return `Hoje é ${weekday}.`;
  }]
];

export function classifyFastPath(rawText, options = {}) {
  const text = String(rawText ?? "").trim().replace(/\s+/gu, " ");
  const now = options.now ?? new Date();

  if (!text || text.length > 60) {
    return { version: FAST_PATH_VERSION, action: "PASS", class: null };
  }
  // "Oi?"/"Alô?" isolados são estranhamento (pedido de repetição), não
  // saudação — falso LOCAL_FINAL medido pelo conjunto rotulado v0.1.
  if (/^(?:oi|alô|alo)\?+$/iu.test(text)) {
    return { version: FAST_PATH_VERSION, action: "PASS", class: null };
  }
  for (const [klass, pattern, respond] of RESPONDERS) {
    if (pattern.test(text)) {
      return {
        version: FAST_PATH_VERSION,
        action: "LOCAL_FINAL",
        class: klass,
        response: respond(now)
      };
    }
  }
  return { version: FAST_PATH_VERSION, action: "PASS", class: null };
}

function spokenCorrectionValue(value) {
  const normalized = String(value ?? "");
  if (normalized.startsWith("BRL ")) {
    return `R$ ${normalized.slice(4)}`;
  }
  if (/^\d{2}:\d{2}$/u.test(normalized)) {
    const [hour, minute] = normalized.split(":");
    return minute === "00"
      ? `${Number.parseInt(hour, 10)} horas`
      : `${hour}:${minute}`;
  }
  return normalized;
}

// Memória leve da camada rápida: última menção de valor por sessão.
// Vive FORA do kernel formal (que só comita slots via correção); permite a
// ponte cross-turn "— O valor é de 300 reais. — Na verdade, 400." sem tocar
// o reducer congelado. Autoridade semântica continua no kernel/reasoner.
const CROSS_TURN_MARKER =
  /^(?:não[,.\s]+|na verdade[,.\s]*|quer dizer[,.\s]*|aliás[,.\s]*|melhor[,.\s]+)/iu;

export function createFastPathMemory(options = {}) {
  const maxSessions = options.maxSessions ?? 512;
  const sessions = new Map();

  return {
    observe(sessionId, text, extractAmounts) {
      const amounts = extractAmounts(String(text ?? ""));
      if (amounts.length === 1 && Number.isFinite(amounts[0].value)) {
        sessions.delete(sessionId);
        sessions.set(sessionId, { lastAmount: amounts[0].value });
        while (sessions.size > maxSessions) {
          sessions.delete(sessions.keys().next().value);
        }
      }
    },
    lastAmount(sessionId) {
      return sessions.get(sessionId)?.lastAmount ?? null;
    }
  };
}

// Arbitragem completa do turno: LOCAL_FINAL | BRIDGE | PASS.
//
// BRIDGE nasce de sinais ESTRUTURADOS do turnPlan/kernel disponíveis no
// instante do disparo do reasoner — condição necessária para o contrato
// no-repeat entrar no prompt. Um ocupante aprendido que decida DEPOIS do
// disparo só pode LOCAL_FINAL (abortando o reasoner) ou PASS; por isso o
// lugar natural dele é a janela especulativa (prefinal→final), onde a
// corrida não custa latência serial.
export function arbitrateTurn({ text, plan, now, crossTurn = null }) {
  if (plan?.mode !== "direct" || plan?.safety) {
    return { version: FAST_PATH_VERSION, action: "PASS", class: null };
  }

  const correction = plan.semantic?.correction ?? null;
  if (correction?.current) {
    return {
      version: FAST_PATH_VERSION,
      action: "BRIDGE",
      class: "correcao",
      bridge:
        `Entendi: ${spokenCorrectionValue(correction.current)}.`
    };
  }

  // Correção cross-turn: marcador inicial + exatamente um valor novo +
  // menção anterior de valor na sessão (memória da camada rápida).
  if (crossTurn?.lastAmount !== null &&
      crossTurn?.lastAmount !== undefined) {
    const normalized = String(text ?? "").trim();
    if (normalized.length <= 48 &&
        CROSS_TURN_MARKER.test(normalized) &&
        Array.isArray(crossTurn.amounts) &&
        crossTurn.amounts.length === 1 &&
        crossTurn.amounts[0] !== crossTurn.lastAmount) {
      const value = crossTurn.amounts[0];
      const formatted = Number.isInteger(value)
        ? String(value)
        : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
      return {
        version: FAST_PATH_VERSION,
        action: "BRIDGE",
        class: "correcao-cross-turn",
        bridge: `Entendi: R$ ${formatted}.`
      };
    }
  }

  return classifyFastPath(plan.effectiveText ?? text, { now });
}
