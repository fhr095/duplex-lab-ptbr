// Autoridade de EFEITO — barreira independente do classificador de
// propriedade (notes/percepcao/014 §5, mandato 2026-08-19). Toda
// ferramenta é CLASSIFICADA; escrita exige lease de autoridade do
// produto (presença/toque/participante admitido) ou confirmação
// explícita. Hoje a engine só tem leitura pública (Open-Meteo) — esta
// barreira é o GATE da primeira ferramenta consequencial: o caminho
// fica pronto ANTES de ela existir.

export const CLASSES_FERRAMENTA = Object.freeze({
  "open-meteo": "leitura-publica"
});

export function classeDaFerramenta(nome) {
  return CLASSES_FERRAMENTA[nome] ?? "escrita";
}

// Decide se a ferramenta pode executar NESTE turno.
//   leitura-publica  → permissiva (conversa leve segue fluida)
//   leitura-sensivel → exige endereçamento não-incerto
//   escrita          → exige lease de autoridade explícito
export function podeExecutarFerramenta({ classe, propriedade }) {
  if (classe === "leitura-publica") {
    return { ok: true };
  }
  if (classe === "leitura-sensivel") {
    return propriedade?.enderecamento?.startsWith("incerto")
      ? { ok: false, motivo: "enderecamento-incerto" }
      : { ok: true };
  }
  return propriedade?.lease
    ? { ok: true }
    : { ok: false, motivo: "escrita-sem-lease" };
}

// Evidência de propriedade que TODO turno carrega no trace — honesta
// sobre o que a engine sabe hoje (sinais do produto ainda não chegam):
// fonte/participação não-instrumentadas; endereçamento presumido, ou
// incerto sob cena adversa/pendência de confirmação.
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
