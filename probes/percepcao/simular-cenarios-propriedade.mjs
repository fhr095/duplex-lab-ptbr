// CONTRAFACTUAIS CASADOS de propriedade da fala — simulação em nível de
// LINHA DO TEMPO (determinística). Sinais temporais são definidos sobre
// timelines; o pipeline físico já foi validado no loop fechado (013).
// Áudio real entra só quando embeddings forem avaliados (ganho marginal).
//
// Papéis num cenário de 300 s com a mesma assistente (durações de
// resposta VARIADAS 4/7/10/14 s — controle do mandato):
//   P  participante-1: fala em slot, perto, com 2 barge-ins legítimos e
//      1 iniciativa fora de slot (células que NÃO podem ser rejeitadas)
//   L  participante-2 (entra aos 120 s): alterna com P nos slots, perto
//   R  rádio: enunciados contínuos independentes, longe
//   J  rajadas: 6 s a cada 18 s, longe (o caso difícil do 012)
//   C1/C2 conversa alheia: alternam ENTRE SI (contingentes um ao outro,
//      indiferentes à assistente), longe. C1 usa A MESMA VOZ de P
//      (mesma-voz-em-dois-papéis: o que o agrupamento por voz colide).
//
// Saída: por fonte, lift de sobreposição vs duty da assistente, curva
// de slot, exposição; avaliação de uma REGRA CANDIDATA de supressão
// por fonte (lift acumulado ≥0,5 com ≥8 s de exposição à fala da
// assistente) → fantasmas até a supressão e legítimos rejeitados.

const FIM = 300;

function lcg(semente) {
  let estado = semente >>> 0;
  return () => {
    estado = (estado * 1_664_525 + 1_013_904_223) >>> 0;
    return estado / 4_294_967_296;
  };
}

// ---- construir a linha do tempo -----------------------------------
const rnd = lcg(20_260_819);
const assistente = [];
const enunciados = []; // {fonte, ini, fim, campo, nota}

function falar(fonte, ini, dur, campo, nota = "") {
  enunciados.push({ fonte, ini, fim: ini + dur, campo, nota });
  return ini + dur;
}

// P conversa com a assistente a sessão toda; L entra aos 120 s e
// alterna. Assistente responde 1,2 s após o fim do turno, com durações
// cíclicas variadas.
const DURACOES = [4, 7, 10, 14];
let t = 2;
let vez = 0;
let quemFala = () => (t < 120 ? "P" : vez % 2 === 0 ? "P" : "L");
while (t < FIM - 20) {
  const fonte = quemFala();
  const durTurno = 2 + rnd() * 3;
  const fimTurno = falar(fonte, t, durTurno, 1, "slot");
  const durResp = DURACOES[vez % DURACOES.length];
  const iniResp = fimTurno + 1.2;
  assistente.push({ ini: iniResp, fim: iniResp + durResp });
  vez += 1;
  t = iniResp + durResp + 0.8 + rnd() * 1.4; // próximo turno em slot
}
// células que não podem ser rejeitadas: 2 barge-ins de P (durante a
// fala da assistente, perto) + 1 iniciativa fora de slot (silêncio longo)
const a3 = assistente[3];
falar("P", a3.ini + 1.0, 1.8, 1, "barge-in");
const a7 = assistente[7];
falar("P", a7.ini + 2.0, 2.2, 1, "barge-in");
falar("P", assistente.at(-1).fim + 9.5, 3.0, 1, "fora-de-slot");

// R rádio contínuo independente (longe)
for (let tr = 0.5; tr < FIM; ) {
  const dur = 6 + rnd() * 3;
  tr = falar("R", tr, Math.min(dur, FIM - tr), 0.3) + 0.5;
}
// J rajadas periódicas (longe)
for (let tj = 5; tj < FIM; tj += 18) {
  falar("J", tj, 6, 0.3, "rajada");
}
// C1/C2 conversa alheia: contingentes ENTRE SI, longe. C1 = mesma voz de P.
let tc = 8;
let vezC = 0;
while (tc < FIM - 6) {
  const fonte = vezC % 2 === 0 ? "C1" : "C2";
  tc = falar(fonte, tc, 2 + rnd() * 3.5, 0.3, "entre-si") + 0.5 + rnd();
  vezC += 1;
}

// ---- métricas por fonte -------------------------------------------
const dutyAssistente =
  assistente.reduce((s, a) => s + (a.fim - a.ini), 0) / FIM;

function sobrepoe(e) {
  let s = 0;
  for (const a of assistente) {
    s += Math.max(0, Math.min(a.fim, e.fim) - Math.max(a.ini, e.ini));
  }
  return s / (e.fim - e.ini);
}
function slotMs(e) {
  const anteriores = assistente.filter((a) => a.fim <= e.ini);
  const ultima = anteriores.at(-1);
  return ultima && e.ini - ultima.fim <= 12
    ? (e.ini - ultima.fim) * 1_000
    : null;
}

const fontes = {};
for (const e of enunciados) {
  const f = (fontes[e.fonte] ??= {
    enunciados: 0,
    sobreposicoes: [],
    slots: [],
    campo: e.campo,
    exposicaoS: 0,
    supressaoNoEnunciado: null,
    liftFinal: null
  });
  f.enunciados += 1;
  f.sobreposicoes.push(sobrepoe(e));
  const s = slotMs(e);
  if (s !== null) {
    f.slots.push(s);
  }
}

// REGRA CANDIDATA de supressão por fonte (com rótulo de fonte perfeito
// — teto superior; produção precisa do agrupamento, ver nota): percorre
// os enunciados em ordem; exposição = tempo de fala da assistente
// decorrido desde o 1º enunciado da fonte; suprime quando
// liftAcumulado ≥ 0,5 e exposição ≥ 8 s.
const porFonteOrdenado = {};
for (const e of [...enunciados].sort((a, b) => a.ini - b.ini)) {
  const f = (porFonteOrdenado[e.fonte] ??= {
    primeiroIni: e.ini,
    somaSobre: 0,
    n: 0,
    suprimidoNo: null
  });
  f.somaSobre += sobrepoe(e);
  f.n += 1;
  const exposicao = assistente
    .filter((a) => a.ini >= f.primeiroIni && a.fim <= e.fim)
    .reduce((s, a) => s + (a.fim - a.ini), 0);
  const lift = f.somaSobre / f.n / Math.max(0.05, dutyAssistente);
  if (f.suprimidoNo === null && lift >= 0.5 && exposicao >= 8) {
    f.suprimidoNo = f.n;
  }
}

console.log(
  `cenário ${FIM}s · assistente duty ${dutyAssistente.toFixed(2)} · ` +
    `${assistente.length} respostas (durações ${DURACOES.join("/")}s)`
);
for (const [nome, f] of Object.entries(fontes)) {
  const oMed = f.sobreposicoes.sort((a, b) => a - b)[
    Math.floor(f.sobreposicoes.length / 2)
  ];
  const emSlot = f.slots.filter((s) => s <= 2_500).length;
  const sup = porFonteOrdenado[nome].suprimidoNo;
  console.log(
    [
      `${nome} (campo ${f.campo})`,
      `enunciados ${f.enunciados}`,
      `sobreposta p50 ${oMed.toFixed(2)} · lift ${(oMed / dutyAssistente).toFixed(2)}`,
      `emSlot≤2,5s ${f.slots.length ? `${emSlot}/${f.slots.length}` : "—"}`,
      `supressão por lift: ${sup === null ? "NUNCA" : `no enunciado ${sup}`}`
    ].join(" · ")
  );
}
console.log(
  "\ncélulas críticas: barge-ins e fora-de-slot de P NÃO podem causar " +
    "rejeição de P; C1 tem a MESMA voz de P (agrupamento por voz os " +
    "colide — fonte ≠ endereçamento); J (rajada) e o 1º enunciado de " +
    "cada fonte medem o residual dos sinais temporais."
);
