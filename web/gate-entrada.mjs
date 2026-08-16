// Gate de entrada — decisão PURA de "posso COMEÇAR a falar agora?".
//
// Leito de sobreposição v2 (frente percepção, eixos corretos): na
// conversa normal a célula dominante real são entradas do assistente
// com a CAUDA de fala do usuário ainda ativa (0,2-0,6s de atropelo no
// início da reprodução). Correção: segurar o INÍCIO de um item de áudio
// enquanto o usuário fala e por uma folga curta após a pausa.
//
// Exceção deliberada: kind="backchannel" ("aham" de escuta ativa) DEVE
// poder sobrepor — é o comportamento desejado, validado no leito
// (célula backchannel-atravessado é a boa). Itens JÁ tocando nunca são
// afetados (isto é gate de partida, não de continuação — interrupção é
// papel do barge-in).

export const CLEARANCE_PADRAO_MS = 300;

export function deveSegurarInicio({
  kind,
  usuarioFalando,
  msDesdeFimDaFala,
  clearanceMs = CLEARANCE_PADRAO_MS
}) {
  if (kind === "backchannel") {
    return false;
  }
  if (usuarioFalando) {
    return true;
  }
  return msDesdeFimDaFala < clearanceMs;
}
