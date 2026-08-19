// Autoridade de EFEITO — barreira independente do classificador de
// propriedade (notes/percepcao/014-016). Revisão fail-closed do
// mandato 2026-08-19:
//   - evidência AUSENTE ou PRESUMIDA conta como INCERTA (presunção não
//     é evidência);
//   - leitura-sensivel é fail-closed até existir endereçamento
//     POSITIVO (só instrumentação real — câmera/confirmação — produz
//     "confirmado"); hoje, portanto, sempre bloqueada;
//   - lease é ESTRUTURADO, escopado, expirável e one-shot — nunca um
//     truthy qualquer;
//   - TODA ferramenta passa pelo BROKER único
//     (executarFerramentaComAutoridade) — o call-site não decide.
//
// REGISTRO HONESTO: Open-Meteo segue leitura-publica e permissivo —
// fala fantasma AINDA PODE dispará-lo (custo aceito: consulta pública,
// sem efeito). O que está protegido por construção é a primeira
// ferramenta sensível/mutável que chegar.

export const CLASSES_FERRAMENTA = Object.freeze({
  "open-meteo": "leitura-publica"
});

export function classeDaFerramenta(nome) {
  return CLASSES_FERRAMENTA[nome] ?? "escrita";
}

// Lease estruturado: {origem, escopo:[ferramentas], concedidoEmMs,
// expiraEmMs, usosRestantes}. Validação estrita — shape errado, escopo
// que não cobre a ferramenta, vencido ou sem usos ⇒ inválido.
export function validarLease(lease, { ferramenta, agoraMs }) {
  if (
    !lease ||
    typeof lease !== "object" ||
    typeof lease.origem !== "string" ||
    !Array.isArray(lease.escopo) ||
    !Number.isFinite(lease.expiraEmMs) ||
    !Number.isInteger(lease.usosRestantes)
  ) {
    return { valido: false, motivo: "lease-malformado" };
  }
  if (!lease.escopo.includes(ferramenta)) {
    return { valido: false, motivo: "lease-fora-de-escopo" };
  }
  if (agoraMs >= lease.expiraEmMs) {
    return { valido: false, motivo: "lease-vencido" };
  }
  if (lease.usosRestantes < 1) {
    return { valido: false, motivo: "lease-esgotado" };
  }
  return { valido: true };
}

// Consumo one-shot: devolve o lease decrementado (imutável).
export function consumirLease(lease) {
  return { ...lease, usosRestantes: lease.usosRestantes - 1 };
}

// Evidência que TODO turno carrega no trace — honesta sobre o que a
// engine sabe. IMPORTANTE: "presumido" é PRESUNÇÃO, não evidência —
// nada acima de leitura-publica se apoia nele. "confirmado" só
// existirá quando instrumentação real (sinais do produto/confirmação
// explícita) o produzir.
export function evidenciaPropriedade({ cena, pendenciaCena } = {}) {
  return {
    fonte: "nao-instrumentada",
    participacao: "presumida-unica",
    enderecamento:
      cena?.veredicto === "adversa" || pendenciaCena
        ? "incerto-cena"
        : "presumido",
    autoridade: "conversa",
    lease: null
  };
}

function decidir({ classe, propriedade, lease, ferramenta, agoraMs }) {
  if (classe === "leitura-publica") {
    return { ok: true };
  }
  if (classe === "leitura-sensivel") {
    // fail-closed: ausência e presunção contam como incerteza.
    return propriedade?.enderecamento === "confirmado"
      ? { ok: true }
      : { ok: false, motivo: "enderecamento-nao-confirmado" };
  }
  // escrita (inclui ferramenta desconhecida)
  const validacao = validarLease(lease ?? propriedade?.lease, {
    ferramenta,
    agoraMs
  });
  return validacao.valido
    ? { ok: true }
    : { ok: false, motivo: validacao.motivo };
}

// BROKER ÚNICO: o único caminho legítimo para executar ferramenta.
// Decide pela classe, executa apenas se autorizado e devolve o evento
// de trace pronto. Call-sites NUNCA chamam a ferramenta diretamente.
export async function executarFerramentaComAutoridade({
  nome,
  propriedade,
  lease = null,
  agoraMs = Date.now(),
  executar
}) {
  const classe = classeDaFerramenta(nome);
  const decisao = decidir({
    classe,
    propriedade,
    lease,
    ferramenta: nome,
    agoraMs
  });
  const evento = {
    type: "ferramenta.autorizacao",
    ferramenta: nome,
    classe,
    ok: decisao.ok,
    motivo: decisao.motivo ?? null
  };
  if (!decisao.ok) {
    return { ok: false, motivo: decisao.motivo, evento };
  }
  return {
    ok: true,
    resultado: await executar(),
    evento,
    leaseConsumido:
      classe === "escrita"
        ? consumirLease(lease ?? propriedade.lease)
        : null
  };
}
