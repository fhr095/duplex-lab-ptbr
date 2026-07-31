import assert from "node:assert/strict";
import test from "node:test";

import {
  createInteractionRuntime
} from "../src/interaction/interaction-runtime.mjs";

function event(id, text) {
  return { type: "USER_TURN_FINAL", id, text };
}

test("runtime mantém uma autoridade isolada por sessão", () => {
  const runtime = createInteractionRuntime();
  const pending = runtime.dispatch(
    "session-a",
    event("turn-1", "Transfere 1500 reais, não, 150 reais.")
  );
  const other = runtime.dispatch(
    "session-b",
    event("turn-1", "Oi, tudo bem?")
  );

  assert.equal(
    runtime.snapshot("session-a").semantic.pendingConfirmation.id,
    pending.state.semantic.pendingConfirmation.id
  );
  assert.equal(other.state.semantic.pendingConfirmation, null);
  assert.equal(runtime.snapshot("session-b").semantic.committed, null);
  assert.equal(runtime.sessionCount, 2);
});

test("retry idêntico é idempotente e id conflitante falha fechado", () => {
  const runtime = createInteractionRuntime();
  const input = event("turn-1", "Marca terça, não, sexta.");
  const first = runtime.dispatch("session-a", input);
  const retry = runtime.dispatch("session-a", { ...input });

  assert.deepEqual(retry, first);
  assert.equal(runtime.snapshot("session-a").version, 1);
  assert.throws(
    () => runtime.dispatch(
      "session-a",
      event("turn-1", "Marca terça, não, quarta.")
    ),
    /reutilizado/iu
  );
});

test("runtime limita sessões por LRU e permite reset explícito", () => {
  const runtime = createInteractionRuntime({ maxSessions: 2 });
  runtime.dispatch("session-a", event("turn-1", "Oi"));
  runtime.dispatch("session-b", event("turn-1", "Oi"));
  runtime.snapshot("session-a");
  runtime.dispatch("session-c", event("turn-1", "Oi"));

  assert.equal(runtime.snapshot("session-b"), null);
  assert.notEqual(runtime.snapshot("session-a"), null);
  assert.equal(runtime.reset("session-a"), true);
  assert.equal(runtime.snapshot("session-a"), null);
  assert.equal(runtime.reset("session-a"), false);
});

test("identificadores de sessão e turno são obrigatórios", () => {
  const runtime = createInteractionRuntime();
  assert.throws(
    () => runtime.dispatch("", event("turn-1", "Oi")),
    /sessionId/iu
  );
  assert.throws(
    () => runtime.dispatch("session-a", event("", "Oi")),
    /id do evento/iu
  );
});
