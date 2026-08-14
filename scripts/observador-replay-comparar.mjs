// Compara um replay com a sessão original: para cada fala da
// pseudo-referência (mesmo áudio nos dois), acha o final mais próximo da
// engine ANTIGA (pacote original) e da NOVA (pacote do replay) e mede a
// divergência de palavras de cada um.
//   node scripts/observador-replay-comparar.mjs \
//     --original var/observador/<antigo> --replay var/observador/<novo>
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const ORIGINAL = arg("--original");
const REPLAY = arg("--replay");

async function jsonl(caminho) {
  return (await readFile(caminho, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((linha) => {
      try {
        return JSON.parse(linha);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizar(texto) {
  return String(texto)
    .toLocaleLowerCase("pt-BR")
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

function divergencia(referencia, hipotese) {
  const a = normalizar(referencia);
  const b = normalizar(hipotese);
  if (!a.length && !b.length) {
    return 0;
  }
  const tabela = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let anterior = tabela[0];
    tabela[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const atual = tabela[j];
      tabela[j] = Math.min(
        tabela[j] + 1,
        tabela[j - 1] + 1,
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      anterior = atual;
    }
  }
  // Normaliza pelo tamanho da REFERÊNCIA (WER clássico): hipóteses
  // verbosas são penalizadas, não amortecidas (achado F2 da auditoria).
  return (
    Math.round((tabela[b.length] / Math.max(a.length, 1)) * 1_000) /
    1_000
  );
}

const finaisDe = async (pacote) =>
  (await jsonl(join(pacote, "linha-do-tempo.jsonl")))
    .filter((e) => e.canal === "ws" && e.type === "transcript.final")
    .map((e) => ({ trel: e.trel, texto: String(e.text ?? "").trim() }))
    .filter((f) => f.texto);

const referencias = (
  await jsonl(join(ORIGINAL, "retranscricao.jsonl"))
).filter((r) => r.canal === "usuario");
const antigos = await finaisDe(ORIGINAL);
const novos = await finaisDe(REPLAY);

const maisProximo = (lista, alvo) =>
  lista
    .map((f) => ({ f, delta: Math.abs(f.trel - alvo) }))
    .filter((x) => x.delta < 6)
    .sort((a, b) => a.delta - b.delta)[0]?.f ?? null;

let somaAntiga = 0;
let somaNova = 0;
let casos = 0;
console.log(
  "| fala (pseudo-ref) | engine antiga | replay novo | div antiga | div nova |"
);
console.log("|---|---|---|---|---|");
for (const ref of referencias) {
  const antigo = maisProximo(antigos, ref.fim);
  const novo = maisProximo(novos, ref.fim);
  const divAntiga = antigo ? divergencia(ref.texto, antigo.texto) : 1;
  const divNova = novo ? divergencia(ref.texto, novo.texto) : 1;
  somaAntiga += divAntiga;
  somaNova += divNova;
  casos += 1;
  console.log(
    `| ${ref.texto.slice(0, 38)} | ${(antigo?.texto ?? "—").slice(0, 30)} | ` +
      `${(novo?.texto ?? "—").slice(0, 30)} | ${divAntiga} | ${divNova} |`
  );
}
console.log(
  `\nmédia divergência (norm. pela ref): antiga ` +
    `${(somaAntiga / casos).toFixed(3)} → nova ` +
    `${(somaNova / casos).toFixed(3)} (${casos} falas)`
);
console.log(
  `finais emitidos: antiga ${antigos.length} · replay ${novos.length}`
);

// Anti-junção (achado F3): finais sem referência próxima = candidatos a
// fantasma/espúrio — o modo de falha dominante precisa ser visível.
const semRef = (lista, rotulo) => {
  const orfaos = lista.filter(
    (f) =>
      !referencias.some((r) => Math.abs(f.trel - r.fim) < 6) &&
      !referencias.some((r) => Math.abs(f.trel - r.inicio) < 6)
  );
  console.log(
    `finais sem referência (±6 s) — ${rotulo}: ${orfaos.length}` +
      (orfaos.length
        ? ` → ${orfaos
            .map((f) => `«${f.texto.slice(0, 25)}»`)
            .join(" · ")}`
        : "")
  );
};
semRef(antigos, "antiga");
semRef(novos, "replay");
