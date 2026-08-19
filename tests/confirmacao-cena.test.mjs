import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FRASE_REPETICAO_SOB_SOM,
  fraseConfirmacao,
  resolverTurnoComCena,
  respostaAfirmativa
} from "../src/interaction/confirmacao-cena.mjs";
import {
  veredictoCena,
  LIMIAR_MUSIC
} from "../src/audio/avaliador-cena.mjs";

const adversa = (extra = {}) => ({
  veredicto: "adversa",
  audioMs: 3_600,
  ...extra
});
const limpa = (extra = {}) => ({
  veredicto: "limpa",
  audioMs: 3_600,
  ...extra
});

test("final curto+confiante sob cena adversa vira confirmação (caso a6c1 turn-2)", () => {
  const decisao = resolverTurnoComCena({
    texto: "Opa, meu avô, deixa eu",
    cena: adversa(),
    kernelPendente: false,
    pendencia: null,
    agoraMs: 1_000
  });
  assert.equal(decisao.acao, "confirmar");
  assert.equal(
    decisao.fala,
    "Não te ouvi bem — você disse “Opa, meu avô, deixa eu”?"
  );
  assert.deepEqual(decisao.pendencia, {
    texto: "Opa, meu avô, deixa eu",
    em: 1_000
  });
});

test("cena limpa nunca confirma", () => {
  const decisao = resolverTurnoComCena({
    texto: "Oi, tudo bem?",
    cena: limpa(),
    kernelPendente: false,
    pendencia: null,
    agoraMs: 0
  });
  assert.equal(decisao.acao, "prosseguir");
  assert.equal(decisao.textoEfetivo, "Oi, tudo bem?");
});

test("sem cena anexada (null) o fluxo segue intacto — fail-open", () => {
  const decisao = resolverTurnoComCena({
    texto: "Transfere trezentos reais",
    cena: null,
    kernelPendente: false,
    pendencia: null,
    agoraMs: 0
  });
  assert.equal(decisao.acao, "prosseguir");
});

test("final LONGO (>5 palavras e >4s) sob adversa não muda a fala (v0)", () => {
  const decisao = resolverTurnoComCena({
    texto: "Eu queria entender melhor como funcionam os juros compostos",
    cena: adversa({ audioMs: 6_800 }),
    kernelPendente: false,
    pendencia: null,
    agoraMs: 0
  });
  assert.equal(decisao.acao, "prosseguir");
});

test("áudio ≤4s dispara mesmo com mais de 5 palavras (OU da regra)", () => {
  const decisao = resolverTurnoComCena({
    texto: "eu acho que talvez seja isso mesmo sabe",
    cena: adversa({ audioMs: 3_100 }),
    kernelPendente: false,
    pendencia: null,
    agoraMs: 0
  });
  assert.equal(decisao.acao, "confirmar");
});

test("kernel com pendência própria (confirmação crítica) tem prioridade", () => {
  const decisao = resolverTurnoComCena({
    texto: "quatrocentos reais",
    cena: adversa(),
    kernelPendente: true,
    pendencia: null,
    agoraMs: 0
  });
  assert.equal(decisao.acao, "prosseguir");
});

test("resposta afirmativa resolve a pendência com o conteúdo original", () => {
  const decisao = resolverTurnoComCena({
    texto: "Isso mesmo.",
    cena: adversa({ audioMs: 900 }),
    kernelPendente: false,
    pendencia: { texto: "Que horas são", em: 0 },
    agoraMs: 4_000
  });
  assert.equal(decisao.acao, "prosseguir");
  assert.equal(decisao.textoEfetivo, "Que horas são");
  assert.equal(decisao.resultado, "confirmada");
});

test("correção clara sob cena limpa prossegue com o texto corrigido", () => {
  const decisao = resolverTurnoComCena({
    texto: "Não, eu perguntei se você está me ouvindo bem agora",
    cena: limpa({ audioMs: 5_200 }),
    kernelPendente: false,
    pendencia: { texto: "Opa, meu avô", em: 0 },
    agoraMs: 5_000
  });
  assert.equal(decisao.acao, "prosseguir");
  assert.equal(
    decisao.textoEfetivo,
    "Não, eu perguntei se você está me ouvindo bem agora"
  );
  assert.equal(decisao.resultado, "corrigida");
});

test("anti-loop: resposta de novo curta+confiante sob adversa NÃO reconfirma — pede repetição citando o som", () => {
  const decisao = resolverTurnoComCena({
    texto: "tá me ouvindo",
    cena: adversa({ audioMs: 2_200 }),
    kernelPendente: false,
    pendencia: { texto: "Opa, meu avô", em: 0 },
    agoraMs: 6_000
  });
  assert.equal(decisao.acao, "repetir");
  assert.equal(decisao.fala, FRASE_REPETICAO_SOB_SOM);
  assert.equal(decisao.pendencia, null);
});

test("pendência vencida (>60s) é ignorada — turno volta ao fluxo normal", () => {
  const decisao = resolverTurnoComCena({
    texto: "sim",
    cena: limpa({ audioMs: 700 }),
    kernelPendente: false,
    pendencia: { texto: "Que horas são", em: 0 },
    agoraMs: 61_000
  });
  assert.equal(decisao.acao, "prosseguir");
  assert.equal(decisao.textoEfetivo, "sim");
  assert.equal(decisao.resultado, null);
});

test("afirmativas cobrem variações faladas; conteúdo novo não é afirmativa", () => {
  for (const sim of ["Sim", "isso", "é isso mesmo", "exato!", "aham", "confirmo"]) {
    assert.equal(respostaAfirmativa(sim), true, sim);
  }
  for (const outro of ["não", "sim, mas o valor é outro", "que horas são", ""]) {
    assert.equal(respostaAfirmativa(outro), false, outro);
  }
});

test("fraseConfirmacao ecoa o texto entendido", () => {
  assert.match(fraseConfirmacao(" oi "), /você disse “oi”\?$/u);
});

test("veredicto: tagger vivo decide por Music (0,50 no meio do vão medido)", () => {
  assert.equal(
    veredictoCena({ modo: "tagger", music: 0.97, gravesVoz: 2 }).veredicto,
    "adversa"
  );
  assert.equal(
    veredictoCena({ modo: "tagger", music: 0.08, gravesVoz: 50 }).veredicto,
    "limpa"
  );
  assert.equal(LIMIAR_MUSIC, 0.5);
});

test("veredicto: fallback grátis só decide sem tagger (FPR 0 no leito)", () => {
  const fallback = veredictoCena({ modo: "gratis", gravesVoz: 48.5 });
  assert.equal(fallback.veredicto, "adversa");
  assert.equal(fallback.fonte, "gratis");
  assert.equal(
    veredictoCena({ modo: "gratis", gravesVoz: 11.9 }).veredicto,
    "limpa"
  );
});

test("veredicto é TRIESTADO: indisponível nunca vira limpa", () => {
  assert.equal(veredictoCena(null).veredicto, "indisponivel");
  assert.equal(veredictoCena({}).veredicto, "indisponivel");
  // a política só age em "adversa" — indisponível atravessa em
  // fail-open explícito, sem se disfarçar de cena boa
  const decisao = resolverTurnoComCena({
    texto: "Que horas são",
    cena: { veredicto: "indisponivel", audioMs: 1_500 },
    kernelPendente: false,
    pendencia: null,
    agoraMs: 0
  });
  assert.equal(decisao.acao, "prosseguir");
});
