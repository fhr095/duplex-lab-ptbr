// PDCA ciclo 2 (endereçamento) — extrai, por pacote, todos os finais
// comprometidos com: texto, tempos, proposta do shadow de relevância
// (rawLabel/operationalLabel), RMS da janela de fala no mic e contexto.
//   node scripts/pdca-endereco-extrair.mjs <pacote...> > casos.jsonl
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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

for (const pacote of process.argv.slice(2)) {
  const resumo = JSON.parse(
    await readFile(join(pacote, "resumo.json"), "utf8")
  );
  const t0 = resumo.t0;
  const pagina = await jsonl(join(pacote, "pagina.jsonl"));
  const linha = await jsonl(join(pacote, "linha-do-tempo.jsonl"));
  const retranscricao = (
    await jsonl(join(pacote, "retranscricao.jsonl"))
  ).filter((r) => r.canal === "usuario");
  const mic = await readFile(join(pacote, "mic-1.raw"));

  const rms = (deS, ateS) => {
    let soma = 0;
    let total = 0;
    const de = Math.max(0, Math.floor(deS * 16_000));
    const ate = Math.min(mic.length / 2, Math.floor(ateS * 16_000));
    for (let i = de; i < ate; i += 1) {
      const v = mic.readInt16LE(i * 2) / 32_768;
      soma += v * v;
      total += 1;
    }
    return total ? Math.sqrt(soma / total) : 0;
  };

  const trel = (t) => (t - t0) / 1_000;
  const committed = pagina.filter((e) => e.type === "turn.committed");
  const propostas = pagina.filter(
    (e) => e.type === "speaker-relevance-shadow.proposed"
  );
  const falas = linha.filter(
    (e) => e.canal === "ws" && e.type === "user.speech.started"
  );
  const pausas = linha.filter(
    (e) => e.canal === "ws" && e.type === "user.speech.paused"
  );

  for (const turno of committed) {
    const em = trel(turno.t);
    // janela de fala: último started antes do commit → pausa seguinte
    const inicioFala = falas
      .filter((f) => f.trel <= em)
      .at(-1)?.trel ?? em - 1.5;
    const fimFala = pausas
      .filter((p) => p.trel >= inicioFala)
      .at(0)?.trel ?? em;
    const proposta = propostas
      .map((p) => ({ p, delta: Math.abs(trel(p.t) - em) }))
      .filter((x) => x.delta < 3)
      .sort((a, b) => a.delta - b.delta)[0]?.p ?? null;
    let detalhe = null;
    try {
      detalhe = proposta ? JSON.parse(proposta.detail) : null;
    } catch {
      detalhe = null;
    }
    const sobreposta = retranscricao
      .filter((r) => r.fim >= inicioFala - 0.5 && r.inicio <= fimFala + 0.5)
      .map((r) => r.texto)
      .join(" · ");
    console.log(
      JSON.stringify({
        pacote: pacote.split("/").at(-1),
        trel: Math.round(em * 10) / 10,
        final: String(turno.detail ?? ""),
        janela: [
          Math.round(inicioFala * 100) / 100,
          Math.round(fimFala * 100) / 100
        ],
        rmsJanela: Math.round(rms(inicioFala, fimFala) * 10_000) / 10_000,
        palavras: String(turno.detail ?? "")
          .split(/\s+/u)
          .filter(Boolean).length,
        pseudoRef: sobreposta || null,
        rawLabel: detalhe?.rawLabel ?? null,
        operationalLabel: detalhe?.operationalLabel ?? null,
        turnId: detalhe?.turnId ?? null
      })
    );
  }
}
