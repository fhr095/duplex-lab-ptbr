const NON_INTERRUPTIVE_TOKENS = new Set([
  "ah",
  "aha",
  "aham",
  "hm",
  "hmm",
  "huh",
  "hum",
  "mhm",
  "mm",
  "mmm",
  "uh",
  "uhum"
]);

function tokens(text) {
  return String(text ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Classifica somente o que chegou enquanto o assistente já falava.
 *
 * "não", "espera", correções e reconhecimentos lexicais como "sim" ou
 * "certo" continuam sendo interrupções. Sem contexto da pergunta anterior,
 * descartá-los poderia apagar uma resposta válida. Somente vocalizações
 * inequivocamente não lexicais acompanham a fala sem criar outro turno.
 */
export function classifyPotentialBargeIn(text) {
  const normalizedTokens = tokens(text);
  if (normalizedTokens.length === 0) {
    return Object.freeze({
      kind: "empty",
      shouldInterrupt: false,
      tokens: normalizedTokens
    });
  }

  const isBackchannel =
    normalizedTokens.length <= 2 &&
    normalizedTokens.every((token) =>
      NON_INTERRUPTIVE_TOKENS.has(token)
    );
  return Object.freeze({
    kind: isBackchannel ? "backchannel" : "interrupt",
    shouldInterrupt: !isBackchannel,
    tokens: normalizedTokens
  });
}

/**
 * Só é aplicado quando já existe uma tarefa assíncrona ativa.
 *
 * O vocabulário é deliberadamente estreito: uma frase como "cancela a
 * reunião" pode ser uma nova ação de domínio e não deve desaparecer fora
 * desse contexto. A camada chamadora preserva a transcrição e registra qual
 * taskId foi cancelado.
 */
export function isExplicitTaskCancellation(text) {
  const normalized = tokens(text).join(" ");
  return [
    /^(?:cancela|cancelar|cancele)(?: isso| essa tarefa| a tarefa)?$/u,
    /^(?:deixa|deixe)(?: isso| essa tarefa)? (?:pra|para) la$/u,
    /^(?:esquece|esqueca)(?: isso| essa tarefa)?$/u,
    /^(?:nao precisa|nao precisa mais|pode parar|pare por ai)$/u
  ].some((pattern) => pattern.test(normalized));
}
