import assert from "node:assert/strict";
import test from "node:test";

import { deveSegurarInicio } from "../web/gate-entrada.mjs";

// Gate de partida de reprodução: não começar a falar com a cauda de
// fala do usuário ativa (leito v2: entradas de 0,2-0,6s eram a célula
// dominante real da conversa normal).

test("segura enquanto o usuário fala", () => {
  assert.equal(
    deveSegurarInicio({
      kind: "direct",
      usuarioFalando: true,
      msDesdeFimDaFala: 10_000
    }),
    true
  );
});

test("segura durante a folga pós-pausa e libera depois dela", () => {
  assert.equal(
    deveSegurarInicio({
      kind: "direct",
      usuarioFalando: false,
      msDesdeFimDaFala: 120
    }),
    true
  );
  assert.equal(
    deveSegurarInicio({
      kind: "direct",
      usuarioFalando: false,
      msDesdeFimDaFala: 320
    }),
    false
  );
});

test("backchannel NUNCA é segurado (escuta ativa sobrepõe por design)", () => {
  assert.equal(
    deveSegurarInicio({
      kind: "backchannel",
      usuarioFalando: true,
      msDesdeFimDaFala: 0
    }),
    false
  );
});

test("sem fala recente, libera imediatamente (início de sessão)", () => {
  assert.equal(
    deveSegurarInicio({
      kind: "direct",
      usuarioFalando: false,
      msDesdeFimDaFala: Number.POSITIVE_INFINITY
    }),
    false
  );
});

test("clearance é configurável", () => {
  assert.equal(
    deveSegurarInicio({
      kind: "fast-ack",
      usuarioFalando: false,
      msDesdeFimDaFala: 450,
      clearanceMs: 500
    }),
    true
  );
});
