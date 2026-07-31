const DEFAULT_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_INTERACTION_MODEL = "gpt-5.6-luna";
const DEFAULT_TASK_MODEL = DEFAULT_INTERACTION_MODEL;
const DEFAULT_MAX_REQUESTS = 25;
const MAX_HISTORY_ITEMS = 12;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_HISTORY_CHARS = 16_000;

const DIRECT_INSTRUCTIONS = `
Você é a camada de conversa por voz de baixa latência do Duplex Lab.
Fale em português brasileiro natural, direto e acolhedor.
Responda primeiro ao que o usuário realmente quis dizer, considerando correções recentes.
Use uma a três frases curtas, sem Markdown, títulos, listas ou introduções genéricas.
Não descreva seu funcionamento e não diga que vai pesquisar ou trabalhar depois.
Se faltar uma informação indispensável, faça uma única pergunta curta.
`.trim();

const DELEGATED_INSTRUCTIONS = `
Você é o cérebro de uma tarefa delegada por uma conversa de voz em português brasileiro.
Entregue o resultado útil diretamente, sem repetir o pedido nem dizer que terminou a tarefa.
Priorize conclusão, evidência essencial, ressalva material e próximo passo.
Use no máximo cinco frases faláveis, sem Markdown, títulos ou listas.
Se não houver dados suficientes para afirmar algo, deixe a limitação explícita.
`.trim();

export class OpenAIResponseError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "OpenAIResponseError";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

function asBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeMessage(message) {
  if (
    !message ||
    !["user", "assistant"].includes(message.role) ||
    typeof message.content !== "string"
  ) {
    return null;
  }

  const content = message.content.trim().slice(0, MAX_MESSAGE_CHARS);
  return content ? { role: message.role, content } : null;
}

export function sanitizeConversation(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  const messages = history
    .slice(-MAX_HISTORY_ITEMS)
    .map(normalizeMessage)
    .filter(Boolean);

  let totalChars = 0;
  const selected = [];
  for (const message of messages.reverse()) {
    if (totalChars + message.content.length > MAX_HISTORY_CHARS) {
      break;
    }
    selected.push(message);
    totalChars += message.content.length;
  }

  return selected.reverse();
}

function parseEventBlock(block) {
  const data = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data || data === "[DONE]") {
    return null;
  }

  return JSON.parse(data);
}

export async function* parseResponseEventStream(body) {
  if (!body) {
    throw new OpenAIResponseError("A API não retornou um corpo de streaming.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let match = /\r?\n\r?\n/u.exec(buffer);
    while (match) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const event = parseEventBlock(block);
      if (event) {
        yield event;
      }
      match = /\r?\n\r?\n/u.exec(buffer);
    }

    if (done) {
      break;
    }
  }

  const finalEvent = parseEventBlock(buffer.trim());
  if (finalEvent) {
    yield finalEvent;
  }
}

function redactSecrets(message, secrets = []) {
  let redacted = String(message).replace(
    /\bsk-[A-Za-z0-9_-]{8,}\b/gu,
    "[REDACTED]"
  );
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
    }
  }
  return redacted;
}

async function readApiError(response, secrets) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    return `OpenAI retornou HTTP ${response.status}.`;
  }

  const apiError = payload?.error;
  return redactSecrets(
    apiError?.message?.slice(0, 500) ??
      `OpenAI retornou HTTP ${response.status}.`,
    secrets
  );
}

function streamFailure(event) {
  const error = event.error ?? event.response?.error;
  return new OpenAIResponseError(
    error?.message ?? `A resposta terminou com o estado ${event.type}.`,
    {
      code: error?.code ?? event.type
    }
  );
}

export function createOpenAIBrain(options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TypeError("OPENAI_API_KEY não está configurada.");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiUrl =
    options.apiUrl ?? process.env.OPENAI_RESPONSES_URL ?? DEFAULT_API_URL;
  const interactionModel =
    options.interactionModel ??
    process.env.OPENAI_INTERACTION_MODEL ??
    DEFAULT_INTERACTION_MODEL;
  const taskModel =
    options.taskModel ?? process.env.OPENAI_TASK_MODEL ?? DEFAULT_TASK_MODEL;
  const reasoningEffort =
    options.reasoningEffort ??
    process.env.OPENAI_REASONING_EFFORT ??
    "none";
  const maxOutputTokens = asBoundedInteger(
    options.maxOutputTokens ?? process.env.OPENAI_MAX_OUTPUT_TOKENS,
    160,
    16,
    1_000
  );
  const requestLimit = asBoundedInteger(
    options.maxRequests ?? process.env.OPENAI_MAX_REQUESTS_PER_PROCESS,
    DEFAULT_MAX_REQUESTS,
    1,
    100_000
  );
  const usage = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };

  return {
    interactionModel,
    taskModel,
    requestLimit,

    getUsage() {
      return { ...usage };
    },

    async *streamTurn({ text, history = [], mode = "direct", signal }) {
      const normalizedText = String(text ?? "").trim();
      if (!normalizedText) {
        throw new TypeError("O turno precisa conter texto.");
      }
      if (normalizedText.length > MAX_MESSAGE_CHARS) {
        throw new RangeError(
          `O turno excede ${MAX_MESSAGE_CHARS} caracteres.`
        );
      }
      if (usage.requests >= requestLimit) {
        throw new OpenAIResponseError(
          `Limite de ${requestLimit} chamadas OpenAI atingido neste processo.`,
          { code: "request_budget_exhausted" }
        );
      }

      const model = mode === "delegate" ? taskModel : interactionModel;
      const requestBody = {
        model,
        instructions:
          mode === "delegate"
            ? DELEGATED_INSTRUCTIONS
            : DIRECT_INSTRUCTIONS,
        input: [
          ...sanitizeConversation(history),
          { role: "user", content: normalizedText }
        ],
        max_output_tokens: maxOutputTokens,
        reasoning: { effort: reasoningEffort },
        store: false,
        stream: true,
        text: { verbosity: "low" }
      };

      usage.requests += 1;
      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal
      });

      if (!response.ok) {
        throw new OpenAIResponseError(await readApiError(response, [apiKey]), {
          status: response.status
        });
      }

      let completed = false;
      for await (const event of parseResponseEventStream(response.body)) {
        if (event.type === "response.created") {
          yield {
            type: "started",
            responseId: event.response?.id ?? null,
            model: event.response?.model ?? model
          };
          continue;
        }

        if (event.type === "response.output_text.delta" && event.delta) {
          yield { type: "delta", delta: event.delta };
          continue;
        }

        if (event.type === "response.completed") {
          completed = true;
          const responseUsage = event.response?.usage;
          usage.inputTokens += responseUsage?.input_tokens ?? 0;
          usage.outputTokens += responseUsage?.output_tokens ?? 0;
          usage.totalTokens += responseUsage?.total_tokens ?? 0;
          yield {
            type: "done",
            responseId: event.response?.id ?? null,
            model: event.response?.model ?? model,
            usage: event.response?.usage ?? null
          };
          continue;
        }

        if (
          event.type === "error" ||
          event.type === "response.failed" ||
          event.type === "response.incomplete"
        ) {
          throw streamFailure(event);
        }
      }

      if (!completed) {
        throw new OpenAIResponseError(
          "O streaming terminou antes de response.completed.",
          { code: "stream_incomplete" }
        );
      }
    }
  };
}
