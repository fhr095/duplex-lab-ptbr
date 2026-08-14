// PDCA do ASR — agrega resultados-*.jsonl em uma tabela por candidato:
// divergência média/mediana, % casos ruins (>0,5), latência p50/p95.
//   node scripts/pdca-asr-resumo.mjs var/pdca-asr/resultados-ciclo1.jsonl
import { readFile } from "node:fs/promises";

const linhas = (await readFile(process.argv[2], "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((linha) => JSON.parse(linha));

const grupos = new Map();
for (const r of linhas) {
  const chave = `${r.candidato} · ${r.conjunto}`;
  if (!grupos.has(chave)) {
    grupos.set(chave, []);
  }
  grupos.get(chave).push(r);
}

const quantil = (valores, q) => {
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[
    Math.min(ordenados.length - 1, Math.floor(q * ordenados.length))
  ];
};

console.log(
  "| candidato · conjunto | n | div média | div p50 | ruins>0,5 | " +
    "ms p50 | ms p95 |"
);
console.log("|---|---|---|---|---|---|---|");
for (const [chave, itens] of [...grupos.entries()].sort()) {
  const divs = itens.map((i) => i.divergencia);
  const tempos = itens.map((i) => i.ms);
  const media = divs.reduce((a, b) => a + b, 0) / divs.length;
  const ruins = divs.filter((d) => d > 0.5).length;
  console.log(
    `| ${chave} | ${itens.length} | ${media.toFixed(3)} | ` +
      `${quantil(divs, 0.5).toFixed(3)} | ${ruins} | ` +
      `${quantil(tempos, 0.5)} | ${quantil(tempos, 0.95)} |`
  );
}

// piores casos por candidato (para leitura qualitativa)
for (const [chave, itens] of [...grupos.entries()].sort()) {
  const piores = itens
    .filter((i) => i.divergencia > 0.5)
    .sort((a, b) => b.divergencia - a.divergencia)
    .slice(0, 4);
  if (piores.length) {
    console.log(`\n${chave} — piores:`);
    for (const p of piores) {
      console.log(
        `  [${p.id}] div=${p.divergencia} ref «${p.referencia.slice(0, 55)}» ` +
          `→ «${p.texto.slice(0, 55)}»`
      );
    }
  }
}
