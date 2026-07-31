import test from "node:test";
import assert from "node:assert/strict";

import {
  createConfiguredBrain,
  createLocalStreamingBrain,
  isPremiumOpenAIModel
} from "../src/brain/provider.mjs";

function completedStream(model = "gpt-5.6-luna") {
  return new Response(
    [
      `data: ${JSON.stringify({
        type: "response.created",
        response: { id: "resp_provider", model }
      })}`,
      "",
      `data: ${JSON.stringify({
        type: "response.completed",
        response: { id: "resp_provider", model }
      })}`,
      "",
      ""
    ].join("\n")
  );
}

test("provider local é o padrão mesmo quando existe chave", async () => {
  let fetched = false;
  const configured = createConfiguredBrain({
    environment: { OPENAI_API_KEY: "sk-test-present" },
    fetchImpl: async () => {
      fetched = true;
      return completedStream();
    }
  });

  const events = [];
  for await (const event of configured.brain.streamTurn({ text: "Oi" })) {
    events.push(event);
  }

  assert.equal(configured.provider, "local");
  assert.equal(fetched, false);
  assert.deepEqual(
    events.map((event) => event.type),
    ["started", "delta", "done"]
  );
});

test("provider local respeita o plano semântico já resolvido pelo roteador", async () => {
  const brain = createLocalStreamingBrain({
    planner: {
      planTurn() {
        throw new Error("não deve replanejar");
      }
    }
  });
  const turnPlan = {
    mode: "direct",
    response: "Entendi. Vou considerar sexta."
  };
  const events = [];
  for await (const event of brain.streamTurn({
    text: "Marca para sexta.",
    turnPlan
  })) {
    events.push(event);
  }

  assert.equal(
    events.find((event) => event.type === "delta").delta,
    turnPlan.response
  );
});

test("OpenAI exige opt-in e usa Luna nos dois papéis por padrão", () => {
  const configured = createConfiguredBrain({
    environment: {
      BRAIN_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test"
    },
    fetchImpl: async () => completedStream()
  });

  assert.equal(configured.provider, "openai");
  assert.equal(configured.brain.interactionModel, "gpt-5.6-luna");
  assert.equal(configured.brain.taskModel, "gpt-5.6-luna");
});

test("Sol requer autorização premium explícita", () => {
  assert.equal(isPremiumOpenAIModel("gpt-5.6-sol"), true);
  assert.equal(isPremiumOpenAIModel("gpt-5.6"), true);
  assert.equal(isPremiumOpenAIModel("gpt-5.6-luna"), false);

  assert.throws(
    () =>
      createConfiguredBrain({
        environment: {
          BRAIN_PROVIDER: "openai",
          OPENAI_API_KEY: "sk-test",
          OPENAI_TASK_MODEL: "gpt-5.6-sol"
        }
      }),
    /OPENAI_ALLOW_PREMIUM=true/
  );

  const configured = createConfiguredBrain({
    environment: {
      BRAIN_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      OPENAI_TASK_MODEL: "gpt-5.6-sol",
      OPENAI_ALLOW_PREMIUM: "true"
    }
  });
  assert.equal(configured.brain.taskModel, "gpt-5.6-sol");
  assert.equal(configured.brain.requestLimit, 5);
});
