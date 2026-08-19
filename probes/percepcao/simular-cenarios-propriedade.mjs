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

// ================= CENÁRIO 2 — células CAUSAIS (mandato v4) =========
// Trajetória de crença e ação A CADA ENUNCIADO (não só o lift final),
// comparando duas regras:
//   ACUM   — lift acumulado eterno (a regra do cenário 1; sem perdão)
//   JAN6   — lift em janela móvel dos últimos 6 enunciados (reabilita)
// Células:
//   N  pessoa nova que COMEÇA mal: 2 interrupções LONGAS (sobre a fala
//      da assistente, perto) ANTES de acumular comportamento bom.
//      Pergunta causal: a regra a rejeita antes da redenção?
//   M  MESMA pessoa, MESMO track: 3 enunciados à engine (slots) → 3 ao
//      acompanhante (indiferentes) → 3 à engine de novo. Teste direto
//      de fonte ≠ participação ≠ endereçamento SEM criar 2 IDs.
console.log("\n═══ CENÁRIO 2 — trajetórias causais ═══");
const assist2 = [];
for (let i = 0; i < 12; i += 1) {
  const ini = 4 + i * 14;
  assist2.push({ ini, fim: ini + 7 });
}
const duty2 =
  assist2.reduce((s, a) => s + (a.fim - a.ini), 0) / (12 * 14 + 4);

function sobrepoe2(e) {
  let s = 0;
  for (const a of assist2) {
    s += Math.max(0, Math.min(a.fim, e.fim) - Math.max(a.ini, e.ini));
  }
  return s / (e.fim - e.ini);
}

// N: 2 interrupções longas (5 s inteiras sobre a resposta) e depois 6
// turnos bem-comportados em slot.
const N = [
  { ini: assist2[0].ini + 1, fim: assist2[0].ini + 6, nota: "interrupção-longa" },
  { ini: assist2[1].ini + 1, fim: assist2[1].ini + 6, nota: "interrupção-longa" }
];
for (let i = 2; i < 8; i += 1) {
  N.push({ ini: assist2[i].fim + 1.0, fim: assist2[i].fim + 3.5, nota: "slot" });
}
// M: 3 slots → 3 ao acompanhante (indiferentes, atravessam) → 3 slots.
const M = [];
for (let i = 0; i < 3; i += 1) {
  M.push({ ini: assist2[i].fim + 1.2, fim: assist2[i].fim + 3.8, nota: "→engine" });
}
for (let i = 3; i < 6; i += 1) {
  M.push({ ini: assist2[i].ini + 2, fim: assist2[i].ini + 6.5, nota: "→acompanhante" });
}
for (let i = 6; i < 9; i += 1) {
  M.push({ ini: assist2[i].fim + 1.2, fim: assist2[i].fim + 3.8, nota: "→engine" });
}

function trajetoria(nome, lista) {
  console.log(`\n${nome}:`);
  const historico = [];
  let somaAcum = 0;
  for (const [i, e] of lista.entries()) {
    const o = sobrepoe2(e);
    somaAcum += o;
    historico.push(o);
    const liftAcum = somaAcum / (i + 1) / duty2;
    const jan = historico.slice(-6);
    const liftJan = jan.reduce((s, v) => s + v, 0) / jan.length / duty2;
    const acaoAcum = liftAcum >= 0.5 && i + 1 >= 2 ? "SUPRIMIR" : "ok";
    const acaoJan = liftJan >= 0.5 && i + 1 >= 2 ? "SUPRIMIR" : "ok";
    console.log(
      `  e${i + 1} (${e.nota}) sobre ${o.toFixed(2)} · ` +
        `ACUM lift ${liftAcum.toFixed(2)}→${acaoAcum} · ` +
        `JAN6 lift ${liftJan.toFixed(2)}→${acaoJan}`
    );
  }
}
trajetoria("N — pessoa nova que começa com 2 interrupções longas", N);
trajetoria("M — mesmo track alternando engine ↔ acompanhante", M);

// Pool de não-participantes: perigo de herança de reputação.
const poolRadio = 0.9; // lift típico do rádio já acumulado no pool
console.log(
  "\nPOOL não-participante: com rádio dentro (lift ~" +
    poolRadio.toFixed(2) +
    "), o 1º enunciado de uma pessoa nova ainda-não-admitida HERDARIA " +
    "essa reputação se o pool pudesse rejeitar indivíduos. VEREDICTO " +
    "DE DESENHO: pool só rebaixa AUTORIDADE DE EFEITO e marca cena de " +
    "vozes — nunca rejeita fonte individual; rejeição individual exige " +
    "estatística DA fonte (track/voz) ou sinal contemporâneo."
);
