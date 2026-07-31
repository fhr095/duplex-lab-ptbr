import test from "node:test";
import assert from "node:assert/strict";

import {
  extractSpeechChunks,
  readNdjson
} from "../web/stream-utils.mjs";

test("parser NDJSON aceita linhas divididas pelo stream", async () => {
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"del'));
        controller.enqueue(
          encoder.encode('ta","delta":"Oi"}\n{"type":"done"}\n')
        );
        controller.close();
      }
    })
  );

  const events = [];
  for await (const event of readNdjson(response)) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "delta", delta: "Oi" },
    { type: "done" }
  ]);
});

test("segmentador libera frases naturais e preserva a cauda", () => {
  const result = extractSpeechChunks(
    "Esta é a primeira frase completa. A segunda ainda está chegando"
  );

  assert.deepEqual(result.chunks, ["Esta é a primeira frase completa."]);
  assert.equal(result.remaining, "A segunda ainda está chegando");
});

test("segmentador limita blocos longos e descarrega a cauda no fim", () => {
  const longText =
    "Uma resposta falada não deve esperar indefinidamente por pontuação porque isso aumenta demais o tempo até o início acústico para o usuário";
  const partial = extractSpeechChunks(longText, {
    maximumLength: 90,
    targetLength: 65
  });
  const final = extractSpeechChunks(partial.remaining, { flush: true });

  assert.equal(partial.chunks.length, 1);
  assert.ok(partial.chunks[0].length <= 65);
  assert.equal(final.chunks.length, 1);
});
