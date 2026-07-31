import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenAIBrain,
  OpenAIResponseError,
  sanitizeConversation
} from "../src/brain/openai-brain.mjs";

function sse(events) {
  return events
    .map(
      (event) =>
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    )
    .join("");
}

test("adaptador usa Responses, faz streaming e mantém a chave no backend", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(
      sse([
        {
          type: "response.created",
          response: { id: "resp_test", model: "gpt-test-fast" }
        },
        { type: "response.output_text.delta", delta: "Olá" },
        { type: "response.output_text.delta", delta: ", Felipe." },
        {
          type: "response.completed",
          response: {
            id: "resp_test",
            model: "gpt-test-fast",
            usage: { total_tokens: 12 }
          }
        }
      ]),
      {
        headers: { "content-type": "text/event-stream" }
      }
    );
  };
  const brain = createOpenAIBrain({
    apiKey: "sk-test-secret",
    fetchImpl,
    interactionModel: "gpt-test-fast",
    taskModel: "gpt-test-deep",
    maxOutputTokens: 80
  });
  const controller = new AbortController();

  const events = [];
  for await (const event of brain.streamTurn({
    text: "Oi",
    history: [{ role: "assistant", content: "Pode falar." }],
    signal: controller.signal
  })) {
    events.push(event);
  }

  const request = JSON.parse(captured.options.body);
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.authorization, "Bearer sk-test-secret");
  assert.equal(captured.options.signal, controller.signal);
  assert.equal(request.model, "gpt-test-fast");
  assert.equal(request.stream, true);
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, "none");
  assert.equal(request.text.verbosity, "low");
  assert.deepEqual(request.input.at(-1), { role: "user", content: "Oi" });
  assert.deepEqual(
    events.map((event) => event.type),
    ["started", "delta", "delta", "done"]
  );
  assert.equal(
    events
      .filter((event) => event.type === "delta")
      .map((event) => event.delta)
      .join(""),
    "Olá, Felipe."
  );
  assert.deepEqual(brain.getUsage(), {
    requests: 1,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 12
  });
});

test("tarefas delegadas usam o modelo de qualidade", async () => {
  let request;
  const brain = createOpenAIBrain({
    apiKey: "sk-test",
    interactionModel: "gpt-test-fast",
    taskModel: "gpt-test-deep",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(
        sse([
          {
            type: "response.created",
            response: { id: "resp_task", model: "gpt-test-deep" }
          },
          {
            type: "response.completed",
            response: { id: "resp_task", model: "gpt-test-deep" }
          }
        ])
      );
    }
  });

  for await (const _event of brain.streamTurn({
    text: "Analise isto",
    mode: "delegate"
  })) {
    // Consumir o stream é parte do contrato sob teste.
  }

  assert.equal(request.model, "gpt-test-deep");
  assert.match(request.instructions, /tarefa delegada/iu);
});

test("erro HTTP da API vira erro tipado e não inclui a chave", async () => {
  const brain = createOpenAIBrain({
    apiKey: "sk-never-leak-this",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            message:
              "modelo indisponível para sk-never-leak-this",
            code: "model_not_found"
          }
        }),
        {
          status: 404,
          headers: { "content-type": "application/json" }
        }
      )
  });

  await assert.rejects(
    async () => {
      for await (const _event of brain.streamTurn({ text: "Oi" })) {
        // O erro acontece antes do primeiro evento normalizado.
      }
    },
    (error) => {
      assert.ok(error instanceof OpenAIResponseError);
      assert.equal(error.status, 404);
      assert.match(error.message, /modelo indisponível/);
      assert.doesNotMatch(error.message, /never-leak/);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
});

test("histórico inválido ou excessivo é descartado e limitado", () => {
  const history = [
    { role: "system", content: "não aceitar" },
    ...Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `mensagem ${index}`
    })),
    { role: "user", content: " " }
  ];

  const sanitized = sanitizeConversation(history);
  assert.equal(sanitized.length, 11);
  assert.deepEqual(sanitized.at(-1), {
    role: "assistant",
    content: "mensagem 19"
  });
  assert.ok(sanitized.every((message) => message.role !== "system"));
});

test("orçamento de chamadas bloqueia loops acidentais", async () => {
  let fetchCount = 0;
  const brain = createOpenAIBrain({
    apiKey: "sk-test",
    maxRequests: 1,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(
        sse([
          {
            type: "response.created",
            response: { id: "resp_budget", model: "gpt-5.6-luna" }
          },
          {
            type: "response.completed",
            response: { id: "resp_budget", model: "gpt-5.6-luna" }
          }
        ])
      );
    }
  });

  for await (const _event of brain.streamTurn({ text: "primeira" })) {
    // A primeira chamada cabe no orçamento.
  }

  await assert.rejects(
    async () => {
      for await (const _event of brain.streamTurn({ text: "segunda" })) {
        // O erro ocorre antes do fetch.
      }
    },
    /Limite de 1 chamadas/
  );
  assert.equal(fetchCount, 1);
});
