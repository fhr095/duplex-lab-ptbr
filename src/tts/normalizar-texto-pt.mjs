// Normalização de texto PT-BR para fala: converte dígitos e notações
// (horas, datas, moeda, %, graus, ordinais, decimais) em palavras ANTES do
// TTS. Motivo: nenhum dos TTS plugáveis tem normalização PT nativa — dígito
// cru vira leitura abreviada ou errada. Só o texto FALADO muda; o texto
// exibido/arquivado permanece o original.
//
// Falha segura: qualquer exceção devolve o texto original (fala estranha é
// melhor que fala nenhuma).

const UNIDADES = [
  "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito",
  "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis",
  "dezessete", "dezoito", "dezenove"
];
const DEZENAS = [
  "", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta",
  "oitenta", "noventa"
];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos"
];
// [singular, plural] por grupo de 3 dígitos acima dos milhares.
const ESCALAS = [
  null,
  ["mil", "mil"],
  ["milhão", "milhões"],
  ["bilhão", "bilhões"],
  ["trilhão", "trilhões"]
];

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"
];

const ORDINAL_UNIDADES = [
  "", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto",
  "sétimo", "oitavo", "nono"
];
const ORDINAL_DEZENAS = [
  "", "décimo", "vigésimo", "trigésimo", "quadragésimo", "quinquagésimo",
  "sexagésimo", "septuagésimo", "octogésimo", "nonagésimo"
];
const ORDINAL_CENTENAS = [
  "", "centésimo", "ducentésimo", "trecentésimo", "quadringentésimo",
  "quingentésimo", "sexcentésimo", "septingentésimo", "octingentésimo",
  "noningentésimo"
];

function generoFeminino(palavra) {
  if (palavra === "um") return "uma";
  if (palavra === "dois") return "duas";
  return palavra.replace(/entos$/u, "entas");
}

function trioPorExtenso(n, genero) {
  const partes = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) {
    partes.push(n === 100 ? "cem" : CENTENAS[c]);
  }
  if (resto > 0) {
    if (resto < 20) {
      partes.push(UNIDADES[resto]);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  let texto = partes.join(" e ");
  if (genero === "f") {
    texto = texto.split(" ").map(generoFeminino).join(" ");
  }
  return texto;
}

function digitosUmAUm(digitos) {
  return [...digitos].map((d) => UNIDADES[Number(d)]).join(" ");
}

export function numeroPorExtenso(n, { genero = "m" } = {}) {
  if (!Number.isSafeInteger(n)) {
    return String(n);
  }
  if (n < 0) {
    return `menos ${numeroPorExtenso(-n, { genero })}`;
  }
  if (n === 0) {
    return "zero";
  }
  if (n >= 1e15) {
    return digitosUmAUm(String(n));
  }
  const grupos = [];
  let resto = n;
  while (resto > 0) {
    grupos.push(resto % 1000);
    resto = Math.floor(resto / 1000);
  }
  const pedacos = [];
  for (let i = grupos.length - 1; i >= 0; i -= 1) {
    const grupo = grupos[i];
    if (grupo === 0) {
      continue;
    }
    let texto;
    if (i === 0) {
      texto = trioPorExtenso(grupo, genero);
    } else if (i === 1 && grupo === 1) {
      // "mil", nunca "um mil".
      texto = ESCALAS[1][0];
    } else {
      const escala = ESCALAS[i];
      texto = `${trioPorExtenso(grupo, "m")} ${
        grupo === 1 ? escala[0] : escala[1]
      }`;
    }
    pedacos.push({ grupo, indice: i, texto });
  }
  let resultado = "";
  for (const [posicao, pedaco] of pedacos.entries()) {
    if (posicao === 0) {
      resultado = pedaco.texto;
      continue;
    }
    // "e" liga o último grupo quando ele é < 100 ou centena exata
    // ("mil e duzentos", "mil e vinte", mas "mil duzentos e trinta").
    const ultimo = posicao === pedacos.length - 1 && pedaco.indice === 0;
    const liga = ultimo &&
      (pedaco.grupo < 100 || pedaco.grupo % 100 === 0);
    resultado += liga ? ` e ${pedaco.texto}` : ` ${pedaco.texto}`;
  }
  return resultado;
}

function ordinalPorExtenso(n, genero) {
  if (n < 1 || n > 999) {
    return null;
  }
  const partes = [];
  partes.push(ORDINAL_CENTENAS[Math.floor(n / 100)]);
  partes.push(ORDINAL_DEZENAS[Math.floor((n % 100) / 10)]);
  partes.push(ORDINAL_UNIDADES[n % 10]);
  let texto = partes.filter(Boolean).join(" ");
  if (genero === "f") {
    texto = texto.replaceAll(/o(?= |$)/gu, "a");
  }
  return texto;
}

// Parte decimal: até 2 dígitos sem zero à esquerda lê como cardinal
// ("vírgula vinte e cinco"); caso contrário dígito a dígito ("vírgula zero
// cinco") — é como se dita em PT.
function decimalPorExtenso(fracao) {
  if (fracao.length <= 2 && !fracao.startsWith("0")) {
    return numeroPorExtenso(Number(fracao));
  }
  return digitosUmAUm(fracao);
}

function inteiroPorExtenso(digitos, genero = "m") {
  if (digitos.length > 1 && digitos.startsWith("0")) {
    return digitosUmAUm(digitos);
  }
  return numeroPorExtenso(Number(digitos), { genero });
}

function horaPorExtenso(h, m, s) {
  let texto;
  if (m === 0 || m === null) {
    texto = h === 0
      ? "meia-noite"
      : h === 12
        ? "meio-dia"
        : `${numeroPorExtenso(h, { genero: "f" })} ${
          h === 1 ? "hora" : "horas"
        }`;
  } else {
    const base = h === 0
      ? "meia-noite"
      : h === 12
        ? "meio-dia"
        : `${numeroPorExtenso(h, { genero: "f" })} ${
          h === 1 ? "hora" : "horas"
        }`;
    texto = `${base} e ${numeroPorExtenso(m)} ${
      m === 1 ? "minuto" : "minutos"
    }`;
  }
  if (typeof s === "number" && s > 0) {
    texto += ` e ${numeroPorExtenso(s)} ${s === 1 ? "segundo" : "segundos"}`;
  }
  return texto;
}

function dataPorExtenso(dia, mes, ano) {
  const diaTexto = dia === 1 ? "primeiro" : numeroPorExtenso(dia);
  let texto = `${diaTexto} de ${MESES[mes - 1]}`;
  if (ano !== null) {
    texto += ` de ${numeroPorExtenso(ano)}`;
  }
  return texto;
}

function moedaPorExtenso(inteiroDigitos, centavosDigitos) {
  const reais = Number(inteiroDigitos.replaceAll(".", ""));
  const centavos = centavosDigitos === null
    ? 0
    : Number(centavosDigitos.padEnd(2, "0"));
  const partes = [];
  if (reais > 0 || centavos === 0) {
    partes.push(
      `${numeroPorExtenso(reais)} ${reais === 1 ? "real" : "reais"}`
    );
  }
  if (centavos > 0) {
    partes.push(
      `${numeroPorExtenso(centavos)} ${
        centavos === 1 ? "centavo" : "centavos"
      }`
    );
  }
  return partes.join(" e ");
}

// Números "soltos" restantes: milhar com ponto, decimal com vírgula,
// decimal com ponto (estilo en, ex. versões) e inteiro puro. Lookarounds
// bloqueiam colagem em palavra ("v3.5", "16k" ficam intactos).
const NUMERO_SOLTO =
  /(?<![\w.])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+)(?!\w)/gu;

function renderNumeroSolto(bruto) {
  if (/^\d{1,3}(?:\.\d{3})+/u.test(bruto)) {
    const [inteiro, fracao] = bruto.split(",");
    const base = inteiroPorExtenso(inteiro.replaceAll(".", ""));
    return fracao === undefined
      ? base
      : `${base} vírgula ${decimalPorExtenso(fracao)}`;
  }
  if (bruto.includes(",")) {
    const [inteiro, fracao] = bruto.split(",");
    return `${inteiroPorExtenso(inteiro)} vírgula ${
      decimalPorExtenso(fracao)
    }`;
  }
  if (bruto.includes(".")) {
    const [inteiro, fracao] = bruto.split(".");
    return `${inteiroPorExtenso(inteiro)} ponto ${digitosUmAUm(fracao)}`;
  }
  return inteiroPorExtenso(bruto);
}

export function normalizarTextoParaFala(texto) {
  if (typeof texto !== "string" || texto.length === 0) {
    return texto;
  }
  try {
    return normalizar(texto);
  } catch {
    return texto;
  }
}

// Placeholder de proteção SEM dígitos (índice em letras a-j entre ⁅⁆),
// senão os próprios passes numéricos destruiriam a marca.
function chaveProtegida(i) {
  const letras = [...String(i)].map((d) => "abcdefghij"[Number(d)]).join("");
  return `⁅${letras}⁆`;
}

function normalizar(texto) {
  // URLs e e-mails saem intactos — normalizar dígitos dentro deles só piora.
  const protegidos = new Map();
  let saida = texto.replaceAll(
    /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/gu,
    (m) => {
      const chave = chaveProtegida(protegidos.size);
      protegidos.set(chave, m);
      return chave;
    }
  );

  // Data ISO (AAAA-MM-DD) antes do tratamento de faixas com hífen.
  saida = saida.replaceAll(
    /(?<!\w)(\d{4})-(\d{2})-(\d{2})(?!\w)/gu,
    (m, ano, mes, dia) => {
      const d = Number(dia);
      const me = Number(mes);
      if (d < 1 || d > 31 || me < 1 || me > 12) return m;
      return dataPorExtenso(d, me, Number(ano));
    }
  );

  // Data dd/mm ou dd/mm/aaaa.
  saida = saida.replaceAll(
    /(?<!\w)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\w/])/gu,
    (m, dia, mes, ano) => {
      const d = Number(dia);
      const me = Number(mes);
      if (d < 1 || d > 31 || me < 1 || me > 12) return m;
      return dataPorExtenso(d, me, ano === undefined ? null : Number(ano));
    }
  );

  // Moeda R$ (com milhar e centavos opcionais).
  saida = saida.replaceAll(
    /R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/gu,
    (m, inteiro, centavos) =>
      moedaPorExtenso(inteiro, centavos === undefined ? null : centavos)
  );

  // Horários hh:mm(:ss) e formato Xh / XhYY.
  saida = saida.replaceAll(
    /(?<!\w)([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?![\w:])/gu,
    (m, h, min, seg) => horaPorExtenso(
      Number(h),
      Number(min),
      seg === undefined ? null : Number(seg)
    )
  );
  saida = saida.replaceAll(
    /(?<!\w)([01]?\d|2[0-3])h([0-5]\d)?(?!\w)/gu,
    (m, h, min) =>
      horaPorExtenso(Number(h), min === undefined ? 0 : Number(min), null)
  );
  saida = saida.replaceAll(/(?<!\w)24h(?!\w)/gu, "vinte e quatro horas");

  // Faixa numérica "22-25" → "22 a 25" e sinal negativo "-3" → "menos 3".
  // ANTES de percentual/graus: "-3°C" precisa virar "menos 3°C" primeiro,
  // senão o grau consome o número e o sinal fica órfão.
  saida = saida.replaceAll(/(?<=\d)\s?[-–—]\s?(?=\d)/gu, " a ");
  saida = saida.replaceAll(/(?<=^|[\s(])[-−](?=\d)/gu, "menos ");

  // Percentual (aceita decimal com vírgula).
  saida = saida.replaceAll(
    /(\d+(?:,\d+)?)\s?%/gu,
    (m, numero) => `${renderNumeroSolto(numero)} por cento`
  );

  // Graus: °C / °F (aceita º usado como grau) e ° sozinho.
  saida = saida.replaceAll(
    /(\d+(?:,\d+)?)\s?[°º]\s?([CF])(?!\w)/gu,
    (m, numero, unidade) => `${renderNumeroSolto(numero)} graus ${
      unidade === "C" ? "Celsius" : "Fahrenheit"
    }`
  );
  saida = saida.replaceAll(
    /(\d+(?:,\d+)?)\s?°(?!\w)/gu,
    (m, numero) => `${renderNumeroSolto(numero)} graus`
  );

  // Ordinais 1º/2ª… (º ordinal sem letra de unidade depois).
  saida = saida.replaceAll(
    /(\d+)\s?([ºª])(?!\w)/gu,
    (m, numero, marca) => {
      const texto = ordinalPorExtenso(
        Number(numero),
        marca === "ª" ? "f" : "m"
      );
      return texto ?? m;
    }
  );

  saida = saida.replaceAll(NUMERO_SOLTO, (m) => renderNumeroSolto(m));

  for (const [chave, original] of protegidos) {
    saida = saida.replaceAll(chave, original);
  }
  return saida;
}
