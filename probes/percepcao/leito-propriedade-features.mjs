// Leito de PROPRIEDADE DA FALA — features temporais GRÁTIS por turno de
// usuário, extraídas dos DOIS canais físicos do pacote (canal-usuario +
// canal-assistente, mesmo eixo de amostras por construção do packer).
//
//   node leito-propriedade-features.mjs <pacote>[:iniS:fimS] ...
//
// Por "turno" (intervalo de atividade do canal do usuário ≥400 ms):
//   slotMs      — latência do onset em relação ao FIM da última fala do
//                 assistente (só se ≤12 s; contingência temporal)
//   sobreposta  — fração do turno que atravessa fala ativa do
//                 assistente (indiferença à linha do tempo)
//   dbfs        — nível do turno (baseline de campo; AGC/AEC tornam
//                 isso fraco como proximidade verdadeira — mandato 012)
// Agregados por pacote: p10/p50/p90 de cada feature + fração de turnos
// "em slot" (onset ≤2,5 s após fim de fala do assistente).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SR = 16_000;
const QUADRO = Math.floor(SR * 0.05); // 50 ms

// Controle de robustez (mandato 012): pisos energéticos variáveis para
// checar que as conclusões não dependem do limiar de segmentação.
//   --piso-usuario <dB> (padrão -45) · --piso-assistente <dB> (padrão -50)
const argv = process.argv.slice(2);
function flag(nome, padrao) {
  const i = argv.indexOf(nome);
  return i === -1 ? padrao : Number(argv[i + 1]);
}
const PISO_USUARIO = flag("--piso-usuario", -45);
const PISO_ASSISTENTE = flag("--piso-assistente", -50);
const FLAGS_COM_VALOR = new Set(["--piso-usuario", "--piso-assistente"]);
const specs = argv.filter(
  (a, i) => !a.startsWith("--") && !FLAGS_COM_VALOR.has(argv[i - 1])
);

function atividade(caminho, iniS, fimS, pisoDb) {
  const wav = readFileSync(caminho);
  const pcm = wav.subarray(44);
  const ini = iniS ? Math.floor(iniS * SR) : 0;
  const fim = fimS
    ? Math.min(Math.floor(fimS * SR), pcm.length / 2)
    : pcm.length / 2;
  const quadros = [];
  for (let a = ini; a + QUADRO <= fim; a += QUADRO) {
    let soma = 0;
    for (let i = 0; i < QUADRO; i += 4) {
      const v = pcm.readInt16LE((a + i) * 2) / 32_768;
      soma += v * v;
    }
    const rms = Math.sqrt(soma / (QUADRO / 4));
    quadros.push(20 * Math.log10(rms + 1e-12) > pisoDb);
  }
  // intervalos com fusão de buracos ≤200 ms
  const intervalos = [];
  let aberto = null;
  for (let q = 0; q < quadros.length; q += 1) {
    if (quadros[q]) {
      if (!aberto) {
        aberto = { ini: q, fim: q + 1 };
      } else if (q - aberto.fim <= 4) {
        aberto.fim = q + 1;
      } else {
        intervalos.push(aberto);
        aberto = { ini: q, fim: q + 1 };
      }
    }
  }
  if (aberto) {
    intervalos.push(aberto);
  }
  return {
    intervalos: intervalos.map((i) => ({
      iniS: iniS ?? 0 + 0 + (i.ini * QUADRO) / SR + (iniS ?? 0) * 0,
      ini: ini / SR + (i.ini * QUADRO) / SR,
      fim: ini / SR + (i.fim * QUADRO) / SR
    })),
    pcm,
    iniAmostra: ini
  };
}

function dbfsTrecho(pcm, iniS, fimS) {
  const a0 = Math.floor(iniS * SR);
  const a1 = Math.min(Math.floor(fimS * SR), pcm.length / 2);
  let soma = 0;
  let n = 0;
  for (let a = a0; a < a1; a += 4) {
    const v = pcm.readInt16LE(a * 2) / 32_768;
    soma += v * v;
    n += 1;
  }
  return n === 0 ? -120 : 20 * Math.log10(Math.sqrt(soma / n) + 1e-12);
}

function percentis(valores, ps) {
  const ordenado = [...valores].sort((a, b) => a - b);
  return ps.map((p) => {
    if (ordenado.length === 0) {
      return null;
    }
    return ordenado[
      Math.min(
        ordenado.length - 1,
        Math.floor((p / 100) * ordenado.length)
      )
    ];
  });
}

for (const spec of specs) {
  const [pacote, iniS, fimS] = spec.split(":");
  const usuario = atividade(
    resolve(pacote, "canal-usuario.wav"),
    iniS ? Number(iniS) : null,
    fimS ? Number(fimS) : null,
    PISO_USUARIO
  );
  const assistente = atividade(
    resolve(pacote, "canal-assistente.wav"),
    iniS ? Number(iniS) : null,
    fimS ? Number(fimS) : null,
    PISO_ASSISTENTE
  );

  const turnos = usuario.intervalos.filter(
    (t) => t.fim - t.ini >= 0.4
  );
  const slots = [];
  const sobreposicoes = [];
  const niveis = [];
  let comReferencia = 0;
  for (const turno of turnos) {
    const anteriores = assistente.intervalos.filter(
      (a) => a.fim <= turno.ini
    );
    const ultima = anteriores.at(-1);
    if (ultima && turno.ini - ultima.fim <= 12) {
      comReferencia += 1;
      slots.push((turno.ini - ultima.fim) * 1_000);
    }
    let atravessada = 0;
    for (const a of assistente.intervalos) {
      atravessada += Math.max(
        0,
        Math.min(a.fim, turno.fim) - Math.max(a.ini, turno.ini)
      );
    }
    sobreposicoes.push(atravessada / (turno.fim - turno.ini));
    niveis.push(dbfsTrecho(usuario.pcm, turno.ini, turno.fim));
  }

  // Curva de contingência SEM limiar único (controle metodológico do
  // mandato): fração dos turnos-com-referência cujo onset cai em ≤W,
  // para várias janelas W — e os DENOMINADORES sempre à vista.
  const JANELAS_S = [1, 2.5, 5, 8, 12];
  const curva = JANELAS_S.map((w) => {
    const dentro = slots.filter((s) => s <= w * 1_000).length;
    return `≤${w}s ${comReferencia ? ((dentro / comReferencia) * 100).toFixed(0) : "?"}%`;
  }).join(" ");

  // --serie: sobreposição turno a turno + acumulada (métrica de
  // RECUPERAÇÃO de âncora: em quantos turnos a evidência por fonte
  // cruzaria um limiar de abandono).
  if (argv.includes("--serie")) {
    let acumulada = 0;
    sobreposicoes.forEach((s, i) => {
      acumulada += s;
      console.log(
        `  turno ${i + 1}: sobreposta ${s.toFixed(2)} · média acumulada ` +
          (acumulada / (i + 1)).toFixed(2)
      );
    });
  }

  const [s10, s50, s90] = percentis(slots, [10, 50, 90]);
  const [o50, o90] = percentis(sobreposicoes, [50, 90]);
  const [d10, d50, d90] = percentis(niveis, [10, 50, 90]);
  console.log(
    [
      pacote.split("/").at(-1) + (iniS ? `[${iniS}-${fimS}]` : ""),
      `turnos ${turnos.length} (c/ ref. da engine em ≤12s: ${comReferencia})`,
      `slot p10/50/90 ${s10?.toFixed(0)}/${s50?.toFixed(0)}/${s90?.toFixed(0)}ms`,
      `curva ${curva}`,
      `sobreposta p50/p90 ${o50?.toFixed(2)}/${o90?.toFixed(2)}`,
      `dBFS p10/50/90 ${d10?.toFixed(0)}/${d50?.toFixed(0)}/${d90?.toFixed(0)}`
    ].join(" · ")
  );
}
