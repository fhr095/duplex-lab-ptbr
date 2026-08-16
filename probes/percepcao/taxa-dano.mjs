// O número que decide o investimento: dos cortes-secos (commit antes da
// retomada), quantos produziram DANO PERCEBIDO = resposta do assistente
// começando a tocar durante/logo após a retomada do usuário (atropelo)?
// Os demais são amortecidos (especulação descartada, retenção/concat, ou
// resposta só depois do novo final).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const GRAV = process.argv[2];
const LEITO = process.argv[3];
const ms = (await readFile(LEITO, "utf8"))
  .split("\n").filter(Boolean).map(JSON.parse);
const cortes = ms.filter(
  (m) => m.classe === "fim-falso-commit" && m.subclasse === "corte-seco"
);

const reproPorPacote = new Map();
async function reproducoes(pacote) {
  if (reproPorPacote.has(pacote)) return reproPorPacote.get(pacote);
  let janelas = [];
  try {
    const manifesto = JSON.parse(
      await readFile(join(GRAV, pacote, "manifesto.json"), "utf8")
    );
    const t0 = manifesto.t0;
    const linhas = (
      await readFile(join(GRAV, pacote, "reproducao.jsonl"), "utf8")
    ).split("\n").filter(Boolean).map(JSON.parse);
    janelas = linhas
      .map((r) => {
        const a = ((r.tInicio ?? r.t ?? 0) - t0) / 1000;
        const b = r.tFim ? (r.tFim - t0) / 1000 : a + (r.duracaoS ?? 3);
        return [a, b];
      })
      .filter(([a, b]) => b > a);
  } catch {
    janelas = [];
  }
  reproPorPacote.set(pacote, janelas);
  return janelas;
}

let atropelo = 0;
let respostaAntesDoFim = 0;
let semDano = 0;
for (const m of cortes) {
  const retomada = m.t + m.deltaRetomadaMs / 1000;
  const janelas = await reproducoes(m.pacote);
  // Resposta COMEÇANDO entre o commit e retomada+2,5s = falou por cima
  // da continuação (ou colidiu com ela na janela imediata).
  const inicioResposta = janelas.find(
    ([a]) => a >= m.t + (m.silencioAteCommitMs ?? 0) / 1000 - 0.2 &&
      a <= retomada + 2.5
  );
  if (inicioResposta && inicioResposta[0] <= retomada + 0.3) {
    respostaAntesDoFim += 1; // já tocava quando/antes de retomar (raro: corte-seco filtrou isso)
  } else if (inicioResposta) {
    atropelo += 1; // começou a tocar DURANTE a fala retomada
  } else {
    semDano += 1; // nenhuma resposta na janela — amortecido
  }
}
console.log(`cortes-secos: ${cortes.length}`);
console.log(`  atropelo (resposta iniciou durante a retomada): ${atropelo} (${(100*atropelo/cortes.length).toFixed(0)}%)`);
console.log(`  resposta já antes/no instante da retomada: ${respostaAntesDoFim}`);
console.log(`  sem resposta na janela (amortecido): ${semDano} (${(100*semDano/cortes.length).toFixed(0)}%)`);
