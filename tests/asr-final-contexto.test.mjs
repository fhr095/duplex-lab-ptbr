import assert from "node:assert/strict";
import test from "node:test";

import { IncrementalAsrSession } from "../src/asr/incremental-session.mjs";

// Ciclo 3 do PDCA (fala rápida): fragmentos de continuação decodificados
// sem contexto alucinavam idioma ("…qual o seu nome?" em 1 s → "Also
// nun."). Com finalContexto, o PCM do final anterior é prepended SÓ no
// decode do final e o prefixo sobreposto sai do texto.

function workerFake(respostas, registros) {
  return {
    start: async () => ({}),
    close: async () => {},
    transcribe: async (pedido) => {
      registros.push(pedido);
      return {
        engine: "fake",
        text: respostas.shift() ?? "",
        elapsedMs: 1,
        segments: []
      };
    }
  };
}

function sessaoComContexto({ contexto, respostaFinal, registros }) {
  return new IncrementalAsrSession({
    id: "teste-contexto",
    partialWorker: workerFake([], []),
    finalWorker: workerFake([respostaFinal], registros),
    initialAudioMs: 20,
    stepAudioMs: 20,
    finalContexto: contexto
  });
}

const FRAGMENTO = Buffer.alloc(16_000); // 500 ms de PCM16 @16 kHz
const CONTEXTO_PCM = Buffer.alloc(80_000, 1); // 2,5 s

test("final decodifica com o PCM do contexto prepended e remove o " +
  "prefixo sobreposto", async () => {
  const registros = [];
  const sessao = sessaoComContexto({
    contexto: { pcm: CONTEXTO_PCM, texto: "Tá me ouvindo?" },
    respostaFinal: "tá me ouvindo qual o seu nome?",
    registros
  });
  sessao.pushPcm(FRAGMENTO, { sampleStart: 0 });
  const final = await sessao.finish();
  assert.equal(
    registros.at(-1).pcm.length,
    CONTEXTO_PCM.length + FRAGMENTO.length
  );
  assert.equal(final.text, "qual o seu nome?");
});

test("sem sobreposição o texto fica intacto", async () => {
  const registros = [];
  const sessao = sessaoComContexto({
    contexto: { pcm: CONTEXTO_PCM, texto: "Tá me ouvindo?" },
    respostaFinal: "Qual o seu nome?",
    registros
  });
  sessao.pushPcm(FRAGMENTO, { sampleStart: 0 });
  const final = await sessao.finish();
  assert.equal(final.text, "Qual o seu nome?");
});

test("sobreposição total mantém o texto integral (fallback)", async () => {
  const registros = [];
  const sessao = sessaoComContexto({
    contexto: { pcm: CONTEXTO_PCM, texto: "tá me ouvindo" },
    respostaFinal: "Tá me ouvindo?",
    registros
  });
  sessao.pushPcm(FRAGMENTO, { sampleStart: 0 });
  const final = await sessao.finish();
  assert.equal(final.text, "Tá me ouvindo?");
});

test("sem finalContexto nada muda no pedido ao worker", async () => {
  const registros = [];
  const sessao = new IncrementalAsrSession({
    id: "teste-sem-contexto",
    partialWorker: workerFake([], []),
    finalWorker: workerFake(["Oi, tudo bem?"], registros),
    initialAudioMs: 20,
    stepAudioMs: 20
  });
  sessao.pushPcm(FRAGMENTO, { sampleStart: 0 });
  const final = await sessao.finish();
  assert.equal(registros.at(-1).pcm.length, FRAGMENTO.length);
  assert.equal(final.text, "Oi, tudo bem?");
});
