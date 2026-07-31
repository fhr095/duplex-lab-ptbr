import assert from "node:assert/strict";
import test from "node:test";

import {
  commonPrefixLength,
  TranscriptStabilizer
} from "../src/asr/text-stability.mjs";
import {
  summarizeStreamingTrace
} from "../src/asr/streaming-metrics.mjs";

test("compara prefixo ignorando caixa e pontuação superficial", () => {
  assert.equal(
    commonPrefixLength(
      ["Então,", "vamos", "marcar"],
      ["então", "vamos", "mudar"]
    ),
    2
  );
});

test("separa texto provisório de prefixo confirmado por acordo local", () => {
  const stabilizer = new TranscriptStabilizer({ holdbackWords: 1 });
  const first = stabilizer.update("eu quero marcar uma");
  const second = stabilizer.update("Eu quero marcar uma reunião");
  const revised = stabilizer.update("eu quero marcar outra reunião");
  const final = stabilizer.finalize(
    "eu quero marcar outra reunião amanhã"
  );

  assert.equal(first.committedText, "");
  assert.equal(first.unstableText, "eu quero marcar uma");
  assert.equal(second.committedText, "Eu quero marcar");
  assert.equal(second.unstableText, "uma reunião");
  assert.equal(revised.committedText, "Eu quero marcar");
  assert.equal(revised.unstableText, "outra reunião");
  assert.equal(final.correctedAtFinal, true);
  assert.equal(
    final.text,
    "eu quero marcar outra reunião amanhã"
  );
});

test("resume métricas que refletem espera e reescrita percebidas", () => {
  const events = [
    {
      type: "partial",
      atMs: 500,
      elapsedMs: 500,
      text: "eu quero",
      committedText: ""
    },
    {
      type: "partial",
      atMs: 820,
      elapsedMs: 820,
      text: "eu queria marcar",
      committedText: "eu"
    },
    {
      type: "final",
      atMs: 1_150,
      elapsedMs: 1_150,
      text: "eu queria marcar amanhã",
      committedText: "eu queria marcar amanhã"
    }
  ];

  assert.deepEqual(
    summarizeStreamingTrace(events, { endpointAtMs: 900 }),
    {
      partialUpdates: 2,
      visiblePartialUpdates: 2,
      timeToFirstPartialMs: 500,
      timeToUsefulPartialMs: 500,
      timeToFirstCommittedMs: 820,
      finalAfterEndpointMs: 250,
      rewrittenWords: 1,
      finalCorrectionWords: 1,
      stablePrefixViolations: 0
    }
  );
});
