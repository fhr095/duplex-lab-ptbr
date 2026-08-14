// PDCA do ASR — extrai as fatias de desenvolvimento (enunciados reais
// capturados) dos pacotes do observador: segmentos da retranscrição forte
// do canal do usuário, com ±0,3 s de folga, prontos para os probes.
//   node scripts/pdca-asr-fatias.mjs <pacote...> > var/pdca-asr/fatias.json
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const fatias = [];
for (const pacote of process.argv.slice(2)) {
  const linhas = (
    await readFile(join(pacote, "retranscricao.jsonl"), "utf8")
  )
    .split("\n")
    .filter(Boolean)
    .map((linha) => JSON.parse(linha))
    .filter((r) => r.canal === "usuario");
  for (const segmento of linhas) {
    fatias.push({
      wav: join(pacote, "canal-usuario.wav"),
      inicio: Math.max(0, segmento.inicio - 0.3),
      fim: segmento.fim + 0.3,
      referencia: segmento.texto,
      origem: pacote.split("/").at(-1)
    });
  }
}
console.log(JSON.stringify(fatias, null, 2));
