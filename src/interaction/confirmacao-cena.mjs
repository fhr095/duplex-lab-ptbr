// CONFIRMA ANTES DE AGIR sob cena acústica adversa — decisão PURA.
// Contrato: notes/percepcao/008-acao-cena.md §3. O caso que manda é o
// turn-2 da a6c1: "Opa, meu avô..." (fonético de "tá me ouvindo?" sob
// música colada no mic) virou conversa fantasma respondida com
// confiança. Sob cena adversa, um final CURTO+confiante não é
// respondido: vira pergunta de confirmação. A cena só muda a FALA —
// nenhum turno é bloqueado, descartado ou segurado.
//
// Quem chama (serve.mjs) mantém a pendência por sessão e intercepta
// ANTES do planTurn — conteúdo não confirmado nunca avança o kernel.

export const CONFIRMACAO_CENA_VERSION = "confirmacao-cena-v0";

export const PADRAO_CENA = Object.freeze({
  maxPalavras: 5,
  maxAudioMs: 4_000,
  validadePendenciaMs: 60_000
});

export const FRASE_REPETICAO_SOB_SOM =
  "Tem um som alto aí perto — pode baixar ou chegar mais perto?";

const RESPOSTA_AFIRMATIVA =
  /^(?:sim|é|foi|isso|exato|exatamente|correto|certo|confirmo|positivo|aham|uhum|(?:é|foi)\s+isso(?:\s+(?:mesmo|a[ií]))?|isso\s+mesmo|isso\s+a[ií]|pode\s+ser)[\s.,!…]*$/iu;

function contarPalavras(texto) {
  return (
    String(texto ?? "")
      .normalize("NFKD")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).length;
}

export function respostaAfirmativa(texto) {
  return RESPOSTA_AFIRMATIVA.test(String(texto ?? "").trim());
}

export function fraseConfirmacao(texto) {
  return `Não te ouvi bem — você disse “${String(texto).trim()}”?`;
}

function finalCurtoConfiante({ texto, audioMs, config }) {
  if (!texto) {
    return false;
  }
  return (
    contarPalavras(texto) <= config.maxPalavras ||
    (Number.isFinite(audioMs) && audioMs <= config.maxAudioMs)
  );
}

// Decide o destino de UM turno. Entradas: texto do final, `cena` anexada
// (com audioMs), pendência de confirmação anterior desta sessão (ou
// null) e se o kernel tem outra pendência (confirmação crítica manda).
// Saída:
//   {acao:"confirmar", fala, pendencia}         — responde perguntando
//   {acao:"repetir",   fala, pendencia:null}    — anti-loop: pede
//       repetição citando o som (máx. 1 confirmação em cadeia)
//   {acao:"prosseguir", textoEfetivo, pendencia:null, resultado}
//       — segue o fluxo normal (resultado: "confirmada" quando o
//       conteúdo pendente foi confirmado; "corrigida" quando o usuário
//       reformulou; null quando não havia pendência)
export function resolverTurnoComCena(input) {
  const config = { ...PADRAO_CENA, ...input.config };
  const texto = String(input.texto ?? "").trim();
  const cena = input.cena ?? null;
  const adversa = cena?.veredicto === "adversa";
  const audioMs = Number.isFinite(cena?.audioMs) ? cena.audioMs : null;
  const agoraMs = input.agoraMs ?? 0;
  const pendencia =
    input.pendencia &&
    agoraMs - input.pendencia.em <= config.validadePendenciaMs
      ? input.pendencia
      : null;

  if (pendencia) {
    if (respostaAfirmativa(texto)) {
      return {
        acao: "prosseguir",
        textoEfetivo: pendencia.texto,
        pendencia: null,
        resultado: "confirmada"
      };
    }
    if (adversa && finalCurtoConfiante({ texto, audioMs, config })) {
      // Resposta à confirmação chegou de novo curta+confiante sob a
      // mesma cena: NÃO confirma de novo — o ambiente está comendo a
      // fala; pede para consertar a captação (Regra 2 como resposta).
      return {
        acao: "repetir",
        fala: FRASE_REPETICAO_SOB_SOM,
        pendencia: null,
        resultado: "anti-loop"
      };
    }
    return {
      acao: "prosseguir",
      textoEfetivo: texto,
      pendencia: null,
      resultado: "corrigida"
    };
  }

  if (
    adversa &&
    texto &&
    !input.kernelPendente &&
    finalCurtoConfiante({ texto, audioMs, config })
  ) {
    return {
      acao: "confirmar",
      fala: fraseConfirmacao(texto),
      pendencia: { texto, em: agoraMs },
      resultado: null
    };
  }

  return {
    acao: "prosseguir",
    textoEfetivo: texto,
    pendencia: null,
    resultado: null
  };
}
