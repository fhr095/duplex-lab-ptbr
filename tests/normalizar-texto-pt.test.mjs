import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizarTextoParaFala,
  numeroPorExtenso
} from "../src/tts/normalizar-texto-pt.mjs";

// Ciclo de voz: o cérebro emite dígitos ("17°C", "20:14", "R$ 3,50") e
// nenhum TTS plugável normaliza PT — o Supertonic leu "20:14" abreviado no
// bake-off. Estes testes pinam a convenção falada de cada notação.

test("cardinais básicos e regra do 'e'", () => {
  assert.equal(numeroPorExtenso(0), "zero");
  assert.equal(numeroPorExtenso(17), "dezessete");
  assert.equal(numeroPorExtenso(21), "vinte e um");
  assert.equal(numeroPorExtenso(100), "cem");
  assert.equal(numeroPorExtenso(101), "cento e um");
  assert.equal(numeroPorExtenso(123), "cento e vinte e três");
  assert.equal(numeroPorExtenso(200), "duzentos");
  assert.equal(numeroPorExtenso(1000), "mil");
  assert.equal(numeroPorExtenso(1002), "mil e dois");
  assert.equal(numeroPorExtenso(1100), "mil e cem");
  assert.equal(numeroPorExtenso(1200), "mil e duzentos");
  assert.equal(numeroPorExtenso(1234), "mil duzentos e trinta e quatro");
  assert.equal(numeroPorExtenso(2026), "dois mil e vinte e seis");
  assert.equal(numeroPorExtenso(1_000_000), "um milhão");
  assert.equal(
    numeroPorExtenso(2_300_500),
    "dois milhões trezentos mil e quinhentos"
  );
  assert.equal(numeroPorExtenso(-5), "menos cinco");
});

test("gênero feminino em unidades, dezenas compostas e centenas", () => {
  assert.equal(numeroPorExtenso(1, { genero: "f" }), "uma");
  assert.equal(numeroPorExtenso(2, { genero: "f" }), "duas");
  assert.equal(numeroPorExtenso(21, { genero: "f" }), "vinte e uma");
  assert.equal(numeroPorExtenso(200, { genero: "f" }), "duzentas");
});

test("horários hh:mm e Xh", () => {
  assert.equal(
    normalizarTextoParaFala("Agora são 20:14."),
    "Agora são vinte horas e quatorze minutos."
  );
  assert.equal(
    normalizarTextoParaFala("às 21:00 em ponto"),
    "às vinte e uma horas em ponto"
  );
  assert.equal(
    normalizarTextoParaFala("saio à 1:05"),
    "saio à uma hora e cinco minutos"
  );
  assert.equal(normalizarTextoParaFala("chego às 14h"), "chego às quatorze horas");
  assert.equal(
    normalizarTextoParaFala("reunião às 9h30"),
    "reunião às nove horas e trinta minutos"
  );
  assert.equal(normalizarTextoParaFala("meia-noite: 00:00"), "meia-noite: meia-noite");
  assert.equal(normalizarTextoParaFala("almoço às 12:00"), "almoço às meio-dia");
  assert.equal(
    normalizarTextoParaFala("aberto 24h por dia"),
    "aberto vinte e quatro horas por dia"
  );
});

test("datas dd/mm, dd/mm/aaaa e ISO", () => {
  assert.equal(
    normalizarTextoParaFala("hoje é 13/08"),
    "hoje é treze de agosto"
  );
  assert.equal(
    normalizarTextoParaFala("nasci em 01/03/1990"),
    "nasci em primeiro de março de mil novecentos e noventa"
  );
  assert.equal(
    normalizarTextoParaFala("prazo: 2026-08-15"),
    "prazo: quinze de agosto de dois mil e vinte e seis"
  );
  // Fora de faixa não é data: números viram extenso, barra fica.
  assert.equal(
    normalizarTextoParaFala("resultado 40/20"),
    "resultado quarenta/vinte"
  );
});

test("moeda em reais", () => {
  assert.equal(
    normalizarTextoParaFala("custa R$ 25"),
    "custa vinte e cinco reais"
  );
  assert.equal(normalizarTextoParaFala("é R$ 1"), "é um real");
  assert.equal(
    normalizarTextoParaFala("são R$ 3,50"),
    "são três reais e cinquenta centavos"
  );
  assert.equal(
    normalizarTextoParaFala("R$ 0,99 apenas"),
    "noventa e nove centavos apenas"
  );
  assert.equal(
    normalizarTextoParaFala("total de R$ 1.234,56"),
    "total de mil duzentos e trinta e quatro reais e cinquenta e seis centavos"
  );
  // ",5" convenciona 50 centavos (dinheiro, não decimal).
  assert.equal(
    normalizarTextoParaFala("R$ 2,5"),
    "dois reais e cinquenta centavos"
  );
});

test("percentuais e graus", () => {
  assert.equal(
    normalizarTextoParaFala("subiu 45%"),
    "subiu quarenta e cinco por cento"
  );
  assert.equal(
    normalizarTextoParaFala("caiu 3,5%"),
    "caiu três vírgula cinco por cento"
  );
  assert.equal(
    normalizarTextoParaFala("faz 17°C em São Paulo"),
    "faz dezessete graus Celsius em São Paulo"
  );
  assert.equal(
    normalizarTextoParaFala("mínima de -3°C"),
    "mínima de menos três graus Celsius"
  );
  assert.equal(
    normalizarTextoParaFala("uns 22° lá fora"),
    "uns vinte e dois graus lá fora"
  );
  assert.equal(
    normalizarTextoParaFala("água a 98,6°F"),
    "água a noventa e oito vírgula seis graus Fahrenheit"
  );
});

test("ordinais com º e ª", () => {
  assert.equal(normalizarTextoParaFala("o 1º lugar"), "o primeiro lugar");
  assert.equal(normalizarTextoParaFala("a 3ª vez"), "a terceira vez");
  assert.equal(
    normalizarTextoParaFala("no 21º andar"),
    "no vigésimo primeiro andar"
  );
});

test("faixas e negativos", () => {
  assert.equal(
    normalizarTextoParaFala("entre 22-25 graus"),
    "entre vinte e dois a vinte e cinco graus"
  );
  assert.equal(
    normalizarTextoParaFala("ficou em -5 hoje"),
    "ficou em menos cinco hoje"
  );
});

test("decimais com vírgula e com ponto", () => {
  assert.equal(
    normalizarTextoParaFala("mede 1,75 de altura"),
    "mede um vírgula setenta e cinco de altura"
  );
  assert.equal(
    normalizarTextoParaFala("pesa 0,5 quilo"),
    "pesa zero vírgula cinco quilo"
  );
  assert.equal(
    normalizarTextoParaFala("nota 1,05"),
    "nota um vírgula zero cinco"
  );
  assert.equal(
    normalizarTextoParaFala("versão 3.5 do modelo"),
    "versão três ponto cinco do modelo"
  );
  assert.equal(
    normalizarTextoParaFala("são 1.234 itens"),
    "são mil duzentos e trinta e quatro itens"
  );
});

test("inteiros soltos, com pontuação ao redor", () => {
  assert.equal(normalizarTextoParaFala("tenho 22."), "tenho vinte e dois.");
  assert.equal(
    normalizarTextoParaFala("(17) é primo"),
    "(dezessete) é primo"
  );
  assert.equal(
    normalizarTextoParaFala("o ano de 2026 começou"),
    "o ano de dois mil e vinte e seis começou"
  );
});

test("não toca códigos colados em letras, URLs e e-mails", () => {
  assert.equal(normalizarTextoParaFala("modelo v3.5 beta"), "modelo v3.5 beta");
  assert.equal(normalizarTextoParaFala("arquivo 16k pronto"), "arquivo 16k pronto");
  assert.equal(
    normalizarTextoParaFala("acesse https://exemplo.com/p/123?q=45 agora"),
    "acesse https://exemplo.com/p/123?q=45 agora"
  );
  assert.equal(
    normalizarTextoParaFala("escreva para contato@dadooh.ai hoje"),
    "escreva para contato@dadooh.ai hoje"
  );
  // Duas URLs: placeholders não colidem entre si nem com o texto.
  assert.equal(
    normalizarTextoParaFala("veja www.a1.com e www.b2.com às 10:00"),
    "veja www.a1.com e www.b2.com às dez horas"
  );
});

test("texto sem números sai intacto e entrada inválida é devolvida", () => {
  const frase = "Em São Paulo agora: dezessete graus, céu limpo.";
  assert.equal(normalizarTextoParaFala(frase), frase);
  assert.equal(normalizarTextoParaFala(""), "");
  assert.equal(normalizarTextoParaFala(null), null);
});

test("frases reais do cérebro (clima e hora juntos)", () => {
  assert.equal(
    normalizarTextoParaFala(
      "Em São Paulo: 17°C agora, máxima de 22°C. São 20:14."
    ),
    "Em São Paulo: dezessete graus Celsius agora, máxima de vinte e dois " +
      "graus Celsius. São vinte horas e quatorze minutos."
  );
});
