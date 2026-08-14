import assert from "node:assert/strict";
import test from "node:test";

import { SpeculativeTurn } from "../web/speculative-turn.mjs";

// Regressão da sessão real observada em 2026-08-14: o fetch nativo do
// navegador exige receptor undefined/window; guardar a referência crua e
// invocá-la como this.#fetchImpl(...) chama com this = instância e lança
// "Illegal invocation" — matando especulação E adoção (7 de 11 finais sem
// resposta). Node/undici não valida o receptor, então só um stub com a
// semântica do navegador pega o defeito.
function fetchComSemanticaDeNavegador(corpoNdjson, chamadas) {
  return function (...argumentos) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError(
        "Failed to execute 'fetch' on 'Window': Illegal invocation"
      );
    }
    chamadas.push(argumentos[0]);
    return Promise.resolve(
      new Response(corpoNdjson, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" }
      })
    );
  };
}

test("especulação usa o fetch global com o binding do navegador", async () => {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = fetchComSemanticaDeNavegador(
    '{"type":"route","mode":"direct"}\n{"type":"done"}\n',
    chamadas
  );
  try {
    const turno = new SpeculativeTurn({
      text: "olá, tudo bem?",
      sessionId: "sessao-teste",
      turnId: "turno-teste"
    });
    const recebidos = [];
    for await (const event of turno.events()) {
      recebidos.push(event.type);
    }
    assert.deepEqual(recebidos, ["route", "done"]);
    assert.equal(chamadas.length, 1);
    assert.match(String(chamadas[0]), /\/api\/turn$/u);
  } finally {
    globalThis.fetch = original;
  }
});

test("commit da adoção usa o fetch global com o binding do navegador",
  async () => {
    const original = globalThis.fetch;
    const chamadas = [];
    globalThis.fetch = fetchComSemanticaDeNavegador(
      '{"type":"committed","ok":true,"interaction":{"version":2}}\n',
      chamadas
    );
    try {
      const turno = new SpeculativeTurn({
        text: "olá de novo",
        sessionId: "sessao-teste",
        turnId: "turno-commit"
      });
      const commit = await turno.commit();
      assert.equal(commit.ok, true);
      // duas chamadas: a rodada especulativa do construtor + o commit
      assert.equal(chamadas.length, 2);
    } finally {
      globalThis.fetch = original;
    }
  });
