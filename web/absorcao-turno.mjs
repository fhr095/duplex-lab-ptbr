// Commit revisável — máquina de decisão PURA da absorção de turno.
//
// Problema medido (frente percepção, leito de 1000 momentos): a engine
// commita com p50=301ms de silêncio e as retomadas do usuário têm
// p50=306ms → 44% das pausas-com-retomada viram corte; o dano vivo não
// é atropelo (0 casos no corpus — o barge-in protege), é FRAGMENTAÇÃO:
// o pensamento respondido em pedaços. Nenhum θ fixo resolve sem +500 a
// +1000ms em todo fim (curva de Pareto em probes/percepcao).
//
// Mecanismo: o commit continua disparando na hora (latência zero a
// mais); se o usuário RETOMA a fala dentro da janela e a resposta ainda
// NÃO começou a tocar, o turno em voo é abortado e o texto do fragmento
// fica retido para concatenar com o próximo final — um pensamento, um
// turno. Contrato completo: notes/percepcao/003-matriz-estados.md §2 na
// branch exp/percepcao-v0.
//
// Guardas (cláusulas 3 e 4): só modo direct/pending (delegações e seus
// efeitos externos nunca absorvem); janela curta de retomada (mudança
// de assunto costuma vir depois de pausas longas); teto de tamanho do
// merge; validade do fragmento expira.

const PADRAO = {
  janelaRetomadaMs: 2_500,
  validadeFragmentoMs: 10_000,
  limiteMergeChars: 600
};

export function criarAbsorcao(config = {}) {
  return {
    config: { ...PADRAO, ...config },
    turno: null,
    fragmentos: [],
    fragmentoDesdeMs: null
  };
}

// processTurn disparou uma requisição ao cérebro para `texto`.
export function turnoDisparado(estado, { texto, atMs }) {
  return { ...estado, turno: { texto, atMs } };
}

// O usuário voltou a falar. Decide se o turno em voo deve ser absorvido.
export function falaRetomada(
  estado,
  { atMs, respostaAtiva, audioJaTocou, modo }
) {
  const turno = estado.turno;
  if (!turno) {
    return { estado, absorver: false, motivo: "sem-turno" };
  }
  const deltaMs = atMs - turno.atMs;
  if (deltaMs > estado.config.janelaRetomadaMs) {
    return { estado, absorver: false, motivo: "fora-da-janela" };
  }
  if (!respostaAtiva) {
    return { estado, absorver: false, motivo: "sem-resposta-ativa" };
  }
  if (audioJaTocou) {
    // Resposta audível = interação real; o caminho é o barge-in, nunca
    // a absorção (o usuário reagiu ao que ouviu).
    return { estado, absorver: false, motivo: "audio-ja-tocou" };
  }
  if (modo !== "direct" && modo !== "pending") {
    // Cláusula 4: delegações/efeitos externos não reabrem.
    return { estado, absorver: false, motivo: `modo-${modo}` };
  }
  const fragmentos = [...estado.fragmentos, turno.texto];
  return {
    estado: {
      ...estado,
      turno: null,
      fragmentos,
      fragmentoDesdeMs: estado.fragmentoDesdeMs ?? atMs
    },
    absorver: true,
    deltaMs,
    fragmento: turno.texto,
    motivo: "absorvido"
  };
}

// Chegou um novo transcript.final. Devolve o texto a enviar ao cérebro
// (com fragmentos concatenados quando houver) e o estado seguinte.
export function finalChegou(estado, { texto, atMs }) {
  if (estado.fragmentos.length === 0) {
    return { estado, texto, absorvido: false };
  }
  const idade = atMs - (estado.fragmentoDesdeMs ?? atMs);
  const limpo = { ...estado, fragmentos: [], fragmentoDesdeMs: null };
  if (idade > estado.config.validadeFragmentoMs) {
    return {
      estado: limpo,
      texto,
      absorvido: false,
      descartado: "fragmento-expirado"
    };
  }
  const merged = [...estado.fragmentos, texto].join(" ").trim();
  if (merged.length > estado.config.limiteMergeChars) {
    // Cláusula 3 (guarda v0): merge gigante tem cheiro de assunto novo
    // ou monólogo já coberto pela retenção do ASR — não absorve.
    return {
      estado: limpo,
      texto,
      absorvido: false,
      descartado: "limite-de-tamanho"
    };
  }
  return {
    estado: limpo,
    texto: merged,
    absorvido: true,
    fragmentos: estado.fragmentos
  };
}
