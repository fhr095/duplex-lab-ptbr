import assert from "node:assert/strict";
import test from "node:test";

import {
  criarAbsorcao,
  falaRetomada,
  finalChegou,
  turnoDisparado
} from "../web/absorcao-turno.mjs";

// Commit revisável (frente percepção): retomada rápida sem resposta
// audível absorve o turno em voo; o próximo final concatena. Guardas:
// janela, modo delegate, áudio já tocado, validade e teto de merge.

const base = () =>
  turnoDisparado(criarAbsorcao(), { texto: "Opa, e outra coisa", atMs: 1000 });

test("absorve retomada dentro da janela sem áudio tocado", () => {
  const d = falaRetomada(base(), {
    atMs: 1400,
    respostaAtiva: true,
    audioJaTocou: false,
    modo: "direct"
  });
  assert.equal(d.absorver, true);
  assert.equal(d.deltaMs, 400);
  const f = finalChegou(d.estado, { texto: "queria saber do clima.", atMs: 2600 });
  assert.equal(f.absorvido, true);
  assert.equal(f.texto, "Opa, e outra coisa queria saber do clima.");
  // Estado limpo: segunda chamada não re-absorve.
  const f2 = finalChegou(f.estado, { texto: "e amanhã?", atMs: 3000 });
  assert.equal(f2.absorvido, false);
});

test("não absorve fora da janela de retomada", () => {
  const d = falaRetomada(base(), {
    atMs: 4200,
    respostaAtiva: true,
    audioJaTocou: false,
    modo: "direct"
  });
  assert.equal(d.absorver, false);
  assert.equal(d.motivo, "fora-da-janela");
});

test("não absorve com resposta já audível (caminho é o barge-in)", () => {
  const d = falaRetomada(base(), {
    atMs: 1300,
    respostaAtiva: true,
    audioJaTocou: true,
    modo: "direct"
  });
  assert.equal(d.absorver, false);
  assert.equal(d.motivo, "audio-ja-tocou");
});

test("não absorve delegações (efeitos externos não reabrem)", () => {
  const d = falaRetomada(base(), {
    atMs: 1300,
    respostaAtiva: true,
    audioJaTocou: false,
    modo: "delegate"
  });
  assert.equal(d.absorver, false);
  assert.equal(d.motivo, "modo-delegate");
});

test("fragmento expira se o final demorar demais", () => {
  const d = falaRetomada(base(), {
    atMs: 1200,
    respostaAtiva: true,
    audioJaTocou: false,
    modo: "direct"
  });
  const f = finalChegou(d.estado, { texto: "outra coisa.", atMs: 20_000 });
  assert.equal(f.absorvido, false);
  assert.equal(f.descartado, "fragmento-expirado");
  assert.equal(f.texto, "outra coisa.");
});

test("teto de tamanho evita falso-merge gigante", () => {
  const estado = turnoDisparado(criarAbsorcao({ limiteMergeChars: 40 }), {
    texto: "um fragmento razoavelmente comprido aqui",
    atMs: 1000
  });
  const d = falaRetomada(estado, {
    atMs: 1200,
    respostaAtiva: true,
    audioJaTocou: false,
    modo: "direct"
  });
  const f = finalChegou(d.estado, { texto: "mais texto por cima", atMs: 2000 });
  assert.equal(f.absorvido, false);
  assert.equal(f.descartado, "limite-de-tamanho");
  assert.equal(f.texto, "mais texto por cima");
});

test("cadeia de dois fragmentos concatena na ordem", () => {
  let estado = base();
  let d = falaRetomada(estado, {
    atMs: 1200,
    respostaAtiva: true,
    audioJaTocou: false,
    modo: "direct"
  });
  estado = turnoDisparado(d.estado, { texto: "sobre o tempo", atMs: 2000 });
  d = falaRetomada(estado, {
    atMs: 2300,
    respostaAtiva: true,
    audioJaTocou: false,
    modo: "direct"
  });
  assert.equal(d.absorver, true);
  const f = finalChegou(d.estado, { texto: "em São Paulo hoje.", atMs: 3000 });
  assert.equal(f.absorvido, true);
  assert.equal(
    f.texto,
    "Opa, e outra coisa sobre o tempo em São Paulo hoje."
  );
});

test("sem turno em voo, retomada não faz nada", () => {
  const d = falaRetomada(criarAbsorcao(), {
    atMs: 1000,
    respostaAtiva: false,
    audioJaTocou: false,
    modo: "direct"
  });
  assert.equal(d.absorver, false);
  assert.equal(d.motivo, "sem-turno");
});
