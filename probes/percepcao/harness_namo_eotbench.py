#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Sonda 3b — Namo PT sobre a fatia PT do livekit/eot-bench-data.

Primeira leitura de GENERALIZAÇÃO fora-do-Felipe do caminho textual:
o eot-bench (HF: livekit/eot-bench-data, licença dos dados CC-BY-4.0;
código do repo Apache-2.0) traz turnos reais humano→agente em 14 línguas,
com transcript por palavra (com tempos) e pausas de silêncio ≥100 ms
anotadas; a ÚLTIMA pausa do turno é o fim verdadeiro (`eot`), todas as
anteriores são hesitações (`hold`) — o mesmo desenho fim-real × hesitação
do nosso leito, com outras vozes.

Construção causal (idêntica em espírito ao harness do eot-bench):
para cada pausa, o texto disponível NAQUELE INSTANTE = palavras cujo fim
≤ início da pausa (+50 ms de tolerância de float). Namo recebe só o
enunciado corrente (contrato do card — sem histórico de chat; o campo
`messages` do bench não é usado e isso fica dito).

Mismatch declarado: transcripts do bench são alinhados/limpos por
construção do dataset (não a parcial ASR ruidosa do nosso runtime);
falantes, domínio (task-oriented) e variante de PT podem diferir do leito.

Uso:
    python harness_namo_eotbench.py stats
    python harness_namo_eotbench.py rodar    [--modelo-onnx model.onnx]
    python harness_namo_eotbench.py metricas
"""

import argparse
import collections
import hashlib
import json
import os
import sys
import time

import numpy as np

RAIZ = "/home/Felipe/work/duplex-lab-ptbr/.claude/worktrees/frente-caminho-ouro"
DIR_NAMO = os.path.join(RAIZ, "var/observador/testes/namo")
DIR_BENCH = os.path.join(RAIZ, "var/observador/testes/eot-bench")
PADRAO_PARQUET = os.path.join(DIR_BENCH, "pt-validation-00000-of-00001.parquet")
PADRAO_MODELO_DIR = os.path.join(DIR_NAMO, "modelo")
PADRAO_SAIDA = os.path.join(DIR_NAMO, "resultados-namo-eotbench.jsonl")
PADRAO_RESUMO = os.path.join(DIR_NAMO, "resumo-namo-eotbench.json")

TOLERANCIA_S = 0.05
LIMIAR_CARD = 0.5
SEMENTE_BOOTSTRAP = 1337
REPS_BOOTSTRAP = 10000

sys.path.insert(0, DIR_NAMO)
from harness_namo_leito import (  # noqa: E402
    auc_ranks, auc_ic_bootstrap, ic_binomial, spearman, softmax, ler_jsonl,
)


# ------------------------------------------------------------- carregar bench

def _campo(d, *nomes, obrigatorio=True):
    for n in nomes:
        if n in d and d[n] is not None:
            return d[n]
    if obrigatorio:
        raise KeyError(f"nenhum dos campos {nomes} em {list(d.keys())}")
    return None


def carregar_decisoes(caminho_parquet):
    """Parquet PT → 1 decisão por pausa de silêncio (coluna de áudio NÃO é lida)."""
    import pyarrow.parquet as pq

    colunas = ["id", "language", "duration", "silence_spans", "words", "messages"]
    esquema = pq.read_schema(caminho_parquet)
    presentes = [c for c in colunas if c in esquema.names]
    tabela = pq.read_table(caminho_parquet, columns=presentes)
    linhas = tabela.to_pylist()

    decisoes = []
    turnos = []
    for linha in linhas:
        spans = linha.get("silence_spans") or []
        palavras = linha.get("words") or []
        pal_norm = []
        for w in palavras:
            pal_norm.append({
                "texto": _campo(w, "word", "text", "w"),
                "inicio": float(_campo(w, "start", "start_time", "s")),
                "fim": float(_campo(w, "end", "end_time", "e")),
            })
        pal_norm.sort(key=lambda w: w["fim"])
        spans_norm = sorted(
            [{"inicio": float(_campo(s, "start", "start_time")),
              "fim": float(_campo(s, "end", "end_time"))} for s in spans],
            key=lambda s: s["inicio"],
        )
        turnos.append({
            "id": linha.get("id"),
            "duration": linha.get("duration"),
            "nSpans": len(spans_norm),
            "nPalavrasTurno": len(pal_norm),
            "temMessages": bool(linha.get("messages")),
            "palavras": pal_norm,
            "spans": spans_norm,
        })
        for i, s in enumerate(spans_norm):
            # palavras vêm em estilo Whisper (" Oi," — espaço à esquerda,
            # pontuação e caixa embutidas): strip por palavra + join simples
            texto = " ".join(
                w["texto"].strip() for w in pal_norm
                if w["fim"] <= s["inicio"] + TOLERANCIA_S
            ).strip()
            decisoes.append({
                "id": linha.get("id"),
                "spanIdx": i,
                "nSpans": len(spans_norm),
                "label": "eot" if i == len(spans_norm) - 1 else "hold",
                "spanInicio": round(s["inicio"], 3),
                "spanDurMs": round((s["fim"] - s["inicio"]) * 1000, 1),
                "texto": texto,
                "textoVazio": not texto,
                "nPalavras": len(texto.split()),
            })
    return turnos, decisoes


# ------------------------------------------------------------------ stats

def stats(args):
    turnos, decisoes = carregar_decisoes(args.parquet)
    print(f"turnos (linhas): {len(turnos)} | decisões (pausas): {len(decisoes)}")
    eot = [d for d in decisoes if d["label"] == "eot"]
    hold = [d for d in decisoes if d["label"] == "hold"]
    print(f"eot: {len(eot)} ({len(eot)/len(decisoes):.1%} positivos) | hold: {len(hold)}")

    ns = np.array([t["nSpans"] for t in turnos])
    print(f"pausas/turno: p50={np.percentile(ns,50):.0f} média={ns.mean():.2f} "
          f"máx={ns.max()} | turnos com 1 pausa (sem hold): {(ns==1).sum()} "
          f"({(ns==1).mean():.1%})")
    dur = np.array([t["duration"] for t in turnos if t["duration"]])
    print(f"duração do turno (s): p10={np.percentile(dur,10):.1f} "
          f"p50={np.percentile(dur,50):.1f} p90={np.percentile(dur,90):.1f} "
          f"máx={dur.max():.1f}")
    npal = np.array([t["nPalavrasTurno"] for t in turnos])
    print(f"palavras/turno: p10={np.percentile(npal,10):.0f} p50={np.percentile(npal,50):.0f} "
          f"p90={np.percentile(npal,90):.0f} máx={npal.max()} | turnos sem palavras: {(npal==0).sum()}")
    for nome, ds in (("eot", eot), ("hold", hold)):
        nv = sum(1 for d in ds if d["textoVazio"])
        np_ = np.array([d["nPalavras"] for d in ds])
        print(f"{nome}: texto vazio {nv}/{len(ds)} ({nv/len(ds):.1%}) | "
              f"nPalavras p10={np.percentile(np_,10):.0f} p50={np.percentile(np_,50):.0f} "
              f"p90={np.percentile(np_,90):.0f}")
    sdur = np.array([d["spanDurMs"] for d in decisoes])
    print(f"duração das pausas (ms): p50={np.percentile(sdur,50):.0f} "
          f"p90={np.percentile(sdur,90):.0f} máx={sdur.max():.0f}")
    com_msg = sum(1 for t in turnos if t["temMessages"])
    print(f"turnos com messages (contexto de chat disponível, NÃO usado): "
          f"{com_msg}/{len(turnos)}")

    print("\namostras de texto causal no eot (pontuação/caixa como vêm no bench):")
    rng = np.random.default_rng(7)
    for d in rng.choice([d for d in eot if not d["textoVazio"]], 8, replace=False):
        print(f"  {d['texto'][:110]!r}")
    print("amostras de texto causal em hold:")
    for d in rng.choice([d for d in hold if not d["textoVazio"]], 6, replace=False):
        print(f"  {d['texto'][:110]!r}")


# ------------------------------------------------------------------ rodar

def rodar(args):
    import onnxruntime as ort
    from transformers import AutoTokenizer

    turnos, decisoes = carregar_decisoes(args.parquet)
    if args.limite:
        decisoes = decisoes[: args.limite]
    print(f"decisões (pausas): {len(decisoes)}", file=sys.stderr)

    caminho_modelo = os.path.join(args.modelo_dir, args.modelo_onnx)
    tok = AutoTokenizer.from_pretrained(args.modelo_dir)
    so = ort.SessionOptions()
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.intra_op_num_threads = args.threads
    so.inter_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sessao = ort.InferenceSession(caminho_modelo, sess_options=so)

    def inferir(texto):
        t_a = time.perf_counter()
        i = tok(texto, truncation=True, max_length=512, return_tensors="np")
        saida = sessao.run(None, {"input_ids": i["input_ids"],
                                  "attention_mask": i["attention_mask"]})
        ms = (time.perf_counter() - t_a) * 1000
        return float(softmax(saida[0][0])[1]), int(i["input_ids"].shape[1]), ms

    for _ in range(3):
        inferir("aquecimento do modelo com uma frase qualquer")

    cache = {}
    inferencias = 0
    lats = []
    with open(args.saida, "w", encoding="utf-8") as f:
        for d in decisoes:
            if d["texto"] in cache:
                p_eot, n_tokens = cache[d["texto"]]
                lat = None
            else:
                p_eot, n_tokens, lat = inferir(d["texto"])
                cache[d["texto"]] = (p_eot, n_tokens)
                inferencias += 1
                lats.append(lat)
            reg = dict(d)
            reg.update({"pEot": round(p_eot, 6), "nTokens": n_tokens,
                        "latMs": round(lat, 2) if lat else None,
                        "cache": lat is None})
            f.write(json.dumps(reg, ensure_ascii=False) + "\n")
    print(f"saida: {args.saida} ({len(decisoes)} decisões, {inferencias} inferências)",
          file=sys.stderr)

    pico_kb = None
    with open("/proc/self/status") as f:
        for linha in f:
            if linha.startswith("VmHWM:"):
                pico_kb = int(linha.split()[1])
    import onnxruntime, transformers
    resumo = {
        "benchmark": "livekit/eot-bench-data (config pt, split validation)",
        "licencaDados": "cc-by-4.0 (card HF); repo do código Apache-2.0",
        "parquet": args.parquet,
        "parquetBytes": os.path.getsize(args.parquet),
        "modeloId": "videosdk-live/Namo-Turn-Detector-v1-Portuguese",
        "arquivoOnnx": args.modelo_onnx,
        "sha1Modelo": hashlib.sha1(open(caminho_modelo, "rb").read()).hexdigest(),
        "threads": args.threads,
        "nTurnos": len(turnos),
        "nDecisoes": len(decisoes),
        "inferencias": inferencias,
        "latMsInferencia": {"p50": round(float(np.percentile(lats, 50)), 2),
                            "p95": round(float(np.percentile(lats, 95)), 2)},
        "picoRssMB": round(pico_kb / 1024, 1) if pico_kb else None,
        "versoes": {"onnxruntime": onnxruntime.__version__,
                    "transformers": transformers.__version__,
                    "numpy": np.__version__,
                    "python": sys.version.split()[0]},
    }
    with open(args.resumo, "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False, indent=2)
    print(json.dumps(resumo, ensure_ascii=False, indent=2), file=sys.stderr)


# ------------------------------------------------------------------ métricas

def bloco(nome, regs, score=lambda r: r["pEot"], limiares=(0.1, 0.3, 0.5, 0.7, 0.9),
          limiar_acc=LIMIAR_CARD, com_ic=True):
    eot = np.array([score(r) for r in regs if r["label"] == "eot"], dtype=float)
    hold = np.array([score(r) for r in regs if r["label"] == "hold"], dtype=float)
    print(f"\n== {nome} (n: eot={len(eot)} hold={len(hold)}) ==")
    if not (len(eot) and len(hold)):
        print("classes insuficientes")
        return
    auc = auc_ranks(eot, hold)
    if com_ic:
        lo, hi = auc_ic_bootstrap(eot, hold)
        print(f"AUC eot×hold = {auc:.3f} (IC95 bootstrap {lo:.3f}–{hi:.3f})")
    else:
        print(f"AUC eot×hold = {auc:.3f}")
    tp = int((eot > limiar_acc).sum()); fn = len(eot) - tp
    fp = int((hold > limiar_acc).sum()); tn = len(hold) - fp
    acc = (tp + tn) / (len(eot) + len(hold))
    bal = (tp / len(eot) + tn / len(hold)) / 2
    print(f"@{limiar_acc}: acurácia={acc:.3f} balanceada={bal:.3f} | "
          f"matriz: eot→completo TP={tp} FN={fn} | hold→completo FP={fp} TN={tn}")
    print(f"{'limiar':>7} {'holds cortados (FP)':>22} {'eots atrasados (FN)':>22}")
    for lim in limiares:
        fp_ = int((hold > lim).sum()); fn_ = int((eot <= lim).sum())
        extra = ""
        if lim == limiar_acc:
            extra = (f"  (±{ic_binomial(fp_/len(hold), len(hold)):.1%} / "
                     f"±{ic_binomial(fn_/len(eot), len(eot)):.1%})")
        print(f"{lim:>7} {fp_:>8}/{len(hold)} ({fp_/len(hold):>5.1%}) "
              f"{fn_:>8}/{len(eot)} ({fn_/len(eot):>5.1%}){extra}")


def auc_intra_turno(regs, score=lambda r: r["pEot"]):
    """Média por turno do AUC eot×hold DENTRO do turno (turnos com ≥1 hold).
    Controla o confundidor estrutural do pooled: no eot o texto causal é o
    turno inteiro, nos holds é prefixo — comprimento ganha AUC de graça."""
    por_turno = collections.defaultdict(list)
    for r in regs:
        por_turno[r["id"]].append(r)
    aucs = []
    for rs in por_turno.values():
        eot = np.array([score(r) for r in rs if r["label"] == "eot"], dtype=float)
        hold = np.array([score(r) for r in rs if r["label"] == "hold"], dtype=float)
        if len(eot) and len(hold):
            aucs.append(auc_ranks(eot, hold))
    return float(np.mean(aucs)) if aucs else float("nan"), len(aucs)


def metricas(args):
    regs = ler_jsonl(args.resultados)
    print(f"decisões: {len(regs)}")
    vazios = [r for r in regs if r["textoVazio"]]
    p_v = sorted({r["pEot"] for r in vazios})
    print(f"texto causal vazio: {len(vazios)}/{len(regs)} ({len(vazios)/len(regs):.1%}) "
          f"| P(EOT) do vazio: {p_v}")
    cont = collections.Counter(r["label"] for r in vazios)
    print(f"vazios por label: {dict(cont)}")

    for nome, ds in (("eot", [r for r in regs if r['label']=='eot']),
                     ("hold", [r for r in regs if r['label']=='hold'])):
        ps = np.array([r["pEot"] for r in ds])
        print(f"{nome:<5} n={len(ps):>4} P(EOT): mediana={np.median(ps):.3f} "
              f"média={ps.mean():.3f} p10={np.percentile(ps,10):.3f} "
              f"p90={np.percentile(ps,90):.3f}")

    bloco("NAMO — todas as pausas (com vazias)", regs)
    bloco("NAMO — sem texto causal vazio", [r for r in regs if not r["textoVazio"]])
    a, n = auc_intra_turno(regs)
    print(f"AUC intra-turno (média por turno, {n} turnos com ≥1 hold): {a:.3f}")

    bloco("BASELINE comprimento (nPalavras)", regs,
          score=lambda r: float(r["nPalavras"]),
          limiares=(1, 2, 4, 6, 8, 12, 20), limiar_acc=6, com_ic=True)
    a_b, n_b = auc_intra_turno(regs, score=lambda r: float(r["nPalavras"]))
    print(f"BASELINE comprimento — AUC intra-turno ({n_b} turnos): {a_b:.3f}")

    # decomposição: quanto do sinal é pontuação terminal retrospectiva?
    def categoria(t):
        t = t.strip()
        if not t:
            return "vazia"
        if t.endswith("..."):
            return "reticencias"
        return {",": "virgula", ".": "ponto", "?": "interrogacao",
                "!": "exclamacao"}.get(t[-1], "sem-pontuacao")

    COMPLETO = {"ponto", "interrogacao", "exclamacao"}
    print("\n== decomposição por pontuação terminal (categoria do texto causal) ==")
    for lab in ("eot", "hold"):
        cc = collections.Counter(categoria(r["texto"]) for r in regs if r["label"] == lab)
        n = sum(cc.values())
        print(f"{lab}: " + " ".join(f"{k}={v} ({v/n:.0%})"
              for k, v in sorted(cc.items(), key=lambda x: -x[1])))
    bloco("REGRA grátis 'termina em ./?/!'", regs,
          score=lambda r: 1.0 if categoria(r["texto"]) in COMPLETO else 0.0,
          limiares=(0.5,), com_ic=True)
    com_p = [r for r in regs if categoria(r["texto"]) in COMPLETO]
    sem_p = [r for r in regs if categoria(r["texto"]) not in COMPLETO]
    for nome, sub in (("NAMO só nos SEM ./?/!", sem_p), ("NAMO só nos COM ./?/!", com_p)):
        eot = np.array([r["pEot"] for r in sub if r["label"] == "eot"])
        hold = np.array([r["pEot"] for r in sub if r["label"] == "hold"])
        if len(eot) and len(hold):
            print(f"{nome}: AUC={auc_ranks(eot, hold):.3f} (n={len(eot)}+{len(hold)})")

    nao_vazios = [r for r in regs if not r["textoVazio"]]
    rho = spearman([r["pEot"] for r in nao_vazios],
                   [r["nPalavras"] for r in nao_vazios])
    print(f"\nspearman P(EOT)×nPalavras (sem vazias): {rho:.3f}")
    lats = [r["latMs"] for r in regs if r.get("latMs")]
    print(f"latência por inferência (n={len(lats)}, 1 thread): "
          f"p50={np.percentile(lats,50):.1f}ms p95={np.percentile(lats,95):.1f}ms")


def principal():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="modo", required=True)

    ps = sub.add_parser("stats")
    ps.add_argument("--parquet", default=PADRAO_PARQUET)
    ps.set_defaults(funcao=stats)

    pr = sub.add_parser("rodar")
    pr.add_argument("--parquet", default=PADRAO_PARQUET)
    pr.add_argument("--modelo-dir", default=PADRAO_MODELO_DIR)
    pr.add_argument("--modelo-onnx", default="model.onnx")
    pr.add_argument("--saida", default=PADRAO_SAIDA)
    pr.add_argument("--resumo", default=PADRAO_RESUMO)
    pr.add_argument("--limite", type=int, default=0)
    pr.add_argument("--threads", type=int, default=1)
    pr.set_defaults(funcao=rodar)

    pm = sub.add_parser("metricas")
    pm.add_argument("--resultados", default=PADRAO_SAIDA)
    pm.set_defaults(funcao=metricas)

    args = p.parse_args()
    args.funcao(args)


if __name__ == "__main__":
    principal()
