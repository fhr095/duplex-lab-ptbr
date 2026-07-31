import { createLocalBrain } from "./local-brain.mjs";
import { createOpenAIBrain } from "./openai-brain.mjs";

const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

function asBoolean(value) {
  return /^(1|true|yes|on)$/iu.test(String(value ?? "").trim());
}

function abortError() {
  const error = new Error("Operação cancelada.");
  error.name = "AbortError";
  return error;
}

function wait(delayMs, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(abortError());
      return;
    }

    const timer = setTimeout(resolvePromise, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        rejectPromise(abortError());
      },
      { once: true }
    );
  });
}

export function isPremiumOpenAIModel(model) {
  return model === "gpt-5.6" || /^gpt-5\.6-sol(?:$|-)/u.test(model);
}

export function createLocalStreamingBrain(options = {}) {
  const planner = options.planner ?? createLocalBrain();

  return {
    interactionModel: "deterministic-mock",
    taskModel: "deterministic-mock",
    requestLimit: null,

    getUsage() {
      return {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      };
    },

    async *streamTurn({ text, signal, turnPlan }) {
      const plan = turnPlan ?? planner.planTurn(text);
      yield {
        type: "started",
        responseId: null,
        model: "deterministic-mock"
      };

      if (plan.mode === "delegate") {
        await wait(plan.task.delayMs, signal);
        yield { type: "delta", delta: plan.task.result };
      } else {
        yield { type: "delta", delta: plan.response };
      }

      yield {
        type: "done",
        responseId: null,
        model: "deterministic-mock",
        usage: null
      };
    }
  };
}

export function createConfiguredBrain(options = {}) {
  const environment = options.environment ?? process.env;
  const planner = options.planner ?? createLocalBrain();
  const provider = String(
    options.provider ?? environment.BRAIN_PROVIDER ?? "local"
  )
    .trim()
    .toLowerCase();

  if (provider === "local") {
    return {
      provider,
      brain: createLocalStreamingBrain({ planner })
    };
  }

  if (provider === "openai") {
    const interactionModel =
      environment.OPENAI_INTERACTION_MODEL ?? DEFAULT_OPENAI_MODEL;
    const taskModel =
      environment.OPENAI_TASK_MODEL ?? interactionModel;
    const premiumTask = isPremiumOpenAIModel(taskModel);

    if (
      premiumTask &&
      !asBoolean(environment.OPENAI_ALLOW_PREMIUM)
    ) {
      throw new Error(
        `${taskModel} exige OPENAI_ALLOW_PREMIUM=true. ` +
          "Use o modelo barato como padrão e reserve premium para benchmarks."
      );
    }

    return {
      provider,
      brain: createOpenAIBrain({
        apiKey: environment.OPENAI_API_KEY,
        apiUrl: environment.OPENAI_RESPONSES_URL,
        fetchImpl: options.fetchImpl,
        interactionModel,
        taskModel,
        reasoningEffort: environment.OPENAI_REASONING_EFFORT,
        maxOutputTokens: environment.OPENAI_MAX_OUTPUT_TOKENS,
        maxRequests: premiumTask
          ? 5
          : environment.OPENAI_MAX_REQUESTS_PER_PROCESS
      })
    };
  }

  throw new Error(
    `BRAIN_PROVIDER=${provider} não é suportado. Opções atuais: local, openai.`
  );
}
