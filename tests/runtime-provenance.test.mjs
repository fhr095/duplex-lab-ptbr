import assert from "node:assert/strict";
import test from "node:test";

import {
  measureUsageDelta
} from "../src/eval/runtime-provenance.mjs";

test("mede custo pelo delta do mesmo processo, sem hardcode", () => {
  const before = {
    brain: "openai",
    process: { runId: "run-1" },
    usage: { requests: 2, inputTokens: 10, outputTokens: 5, totalTokens: 15 }
  };
  const after = {
    brain: "openai",
    process: { runId: "run-1" },
    usage: { requests: 3, inputTokens: 17, outputTokens: 8, totalTokens: 25 }
  };
  assert.deepEqual(measureUsageDelta(before, after), {
    requests: 1,
    inputTokens: 7,
    outputTokens: 3,
    totalTokens: 10,
    paidApiCalls: 1,
    externalLlmUsed: true
  });
  assert.throws(
    () => measureUsageDelta(before, {
      ...after,
      process: { runId: "run-2" }
    }),
    /processos diferentes/u
  );
});
