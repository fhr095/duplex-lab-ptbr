// A curva que todo challenger de fim-de-turno precisa VENCER:
// limiar fixo de silêncio θ → (cortes prematuros, latência de commit).
//
// Semântica: a engine commita após θ ms de silêncio. Um corte é
// prematuro se o usuário retomou ANTES de θ (deltaRetomadaMs > θ = o
// commit não teria acontecido; deltaRetomadaMs ≤ θ = cortou antes da
// retomada → corte). População: corte-seco + hesitacao (retomadas
// reais) vs fim-real (a latência que o usuário paga em TODO fim).
//
// Saída: tabela θ × cortes × latência — a fronteira de Pareto do
// "não-modelo". Um detector só se justifica ACIMA dela: menos cortes
// com MENOS latência do que qualquer θ fixo consegue.

import { readFile } from "node:fs/promises";

const LEITO = process.argv[2];
const ms = (await readFile(LEITO, "utf8"))
  .split("\n").filter(Boolean).map(JSON.parse);

const retomadas = ms.filter(
  (m) =>
    (m.classe === "hesitacao" ||
      (m.classe === "fim-falso-commit" && m.subclasse === "corte-seco")) &&
    Number.isFinite(m.deltaRetomadaMs)
);
const fins = ms.filter((m) => m.classe === "fim-real");

console.log(
  `população: ${retomadas.length} retomadas reais (hesitação+corte-seco) · ` +
  `${fins.length} fins verdadeiros`
);

// Distribuição do que a engine FEZ (baseline adaptativo observado):
const silencios = ms
  .filter((m) => Number.isFinite(m.silencioAteCommitMs))
  .map((m) => m.silencioAteCommitMs)
  .sort((a, b) => a - b);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
console.log(
  `silêncio-até-commit observado (engine atual): ` +
  `p10=${q(silencios, 0.1)}ms p50=${q(silencios, 0.5)}ms p90=${q(silencios, 0.9)}ms`
);
const cortesAtuais = retomadas.filter(
  (m) => m.classe === "fim-falso-commit"
).length;
console.log(
  `engine atual: ${cortesAtuais} cortes prematuros em ` +
  `${retomadas.length} retomadas (${(100 * cortesAtuais / retomadas.length).toFixed(0)}%)\n`
);

console.log("θ(ms) | cortes prematuros | % | latência de commit em TODO fim");
console.log("---|---|---|---");
for (const theta of [300, 400, 500, 600, 700, 800, 1000, 1200, 1500, 2000, 2500]) {
  // Corte prematuro: o silêncio atingiu θ ANTES da retomada (Δr > θ) —
  // a engine commitou com o usuário ainda por voltar.
  const cortes = retomadas.filter((m) => m.deltaRetomadaMs > theta).length;
  console.log(
    `${theta} | ${cortes}/${retomadas.length} | ` +
    `${(100 * cortes / retomadas.length).toFixed(0)}% | +${theta}ms`
  );
}

// Distribuição das retomadas (onde o corte dói):
const deltas = retomadas.map((m) => m.deltaRetomadaMs).sort((a, b) => a - b);
console.log(
  `\nretomadas: p10=${q(deltas, 0.1)}ms p25=${q(deltas, 0.25)}ms ` +
  `p50=${q(deltas, 0.5)}ms p75=${q(deltas, 0.75)}ms p90=${q(deltas, 0.9)}ms`
);
