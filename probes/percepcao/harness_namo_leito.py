#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Sonda 3 — Namo-Turn-Detector-v1-Portuguese (videosdk-live) como baseline
TEXTUAL de completude semântica no leito de momentos v0.

Hipótese: um classificador semântico de fim-de-turno (DistilBERT multilingual
fine-tuned, Apache-2.0, ONNX) sobre O TEXTO DISPONÍVEL NO INSTANTE DA PAUSA
discrimina fim-real × hesitação melhor que o Smart Turn v3.2 (áudio, AUC 0,606)
e que a pontuação do Kroko (AUC 0,517).

Texto de entrada: a parcial do Kroko 64-L por fatia já produzida pela Sonda 2
(resultados-kroko-pontuacao.jsonl) — o texto que o runtime teria DE VERDADE
(parcial ASR streaming, com ruído e 13,4% de fatias vazias), não o final bonito.

Contrato do card (README do HF, lido na fonte):
    tokenizer(texto, truncation=True, max_length=512) → input_ids+attention_mask
    logits → softmax → índice 1 = "End of Turn"; decisão = argmax (⇔ p₁ > 0,5)

Baseline TRIVIAL na mesa (grátis): comprimento do texto em palavras
(mais palavras → mais provável completo). O Namo precisa vencê-lo.

Uso:
    python harness_namo_leito.py rodar    [--modelo-onnx model.onnx] [--limite N]
    python harness_namo_leito.py metricas [--resultados ...]

Cultura: 1 thread (parcimônia com a engine viva), nice no chamador; números
com fonte; veredicto honesto.
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
PADRAO_ENTRADA = os.path.join(
    RAIZ, "var/observador/testes/smart-turn/resultados-kroko-pontuacao.jsonl"
)
PADRAO_MODELO_DIR = os.path.join(DIR_NAMO, "modelo")
PADRAO_SAIDA = os.path.join(DIR_NAMO, "resultados-namo-leito.jsonl")
PADRAO_RESUMO = os.path.join(DIR_NAMO, "resumo-namo-leito.json")

CLASSES_ALVO = ("fim-real", "hesitacao", "fim-falso-commit")
LIMIAR_CARD = 0.5  # argmax do softmax binário ⇔ p(EOT) > 0,5
SEMENTE_BOOTSTRAP = 1337
REPS_BOOTSTRAP = 10000


# ------------------------------------------------------------------ util

def ler_jsonl(caminho):
    with open(caminho, "r", encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def auc_ranks(pos, neg):
    """AUC de Mann-Whitney com correção de empates (idêntica à Sonda 1)."""
    valores = np.concatenate([pos, neg])
    ordem = np.argsort(valores, kind="mergesort")
    ranks = np.empty(len(valores))
    i = 0
    ordenados = valores[ordem]
    while i < len(valores):
        j = i
        while j + 1 < len(valores) and ordenados[j + 1] == ordenados[i]:
            j += 1
        ranks[ordem[i : j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1
    soma_pos = ranks[: len(pos)].sum()
    return (soma_pos - len(pos) * (len(pos) + 1) / 2.0) / (len(pos) * len(neg))


def auc_ic_bootstrap(pos, neg, reps=REPS_BOOTSTRAP, semente=SEMENTE_BOOTSTRAP):
    """IC95 percentílico do AUC por bootstrap estratificado (reamostra pos e neg)."""
    rng = np.random.default_rng(semente)
    pos = np.asarray(pos, dtype=float)
    neg = np.asarray(neg, dtype=float)
    aucs = np.empty(reps)
    for k in range(reps):
        p = pos[rng.integers(0, len(pos), len(pos))]
        n = neg[rng.integers(0, len(neg), len(neg))]
        aucs[k] = auc_ranks(p, n)
    return float(np.percentile(aucs, 2.5)), float(np.percentile(aucs, 97.5))


def ic_binomial(frac, n):
    """±1,96·√(p(1−p)/n) — mesmo IC do relatório da Sonda 1."""
    return 1.96 * float(np.sqrt(frac * (1 - frac) / n)) if n else float("nan")


def spearman(a, b):
    """Correlação de postos (empates por rank médio), sem scipy."""
    def postos(x):
        x = np.asarray(x, dtype=float)
        ordem = np.argsort(x, kind="mergesort")
        r = np.empty(len(x))
        i = 0
        xs = x[ordem]
        while i < len(x):
            j = i
            while j + 1 < len(x) and xs[j + 1] == xs[i]:
                j += 1
            r[ordem[i : j + 1]] = (i + j) / 2.0 + 1.0
            i = j + 1
        return r
    ra, rb = postos(a), postos(b)
    ra -= ra.mean(); rb -= rb.mean()
    den = np.sqrt((ra ** 2).sum() * (rb ** 2).sum())
    return float((ra * rb).sum() / den) if den else float("nan")


# ------------------------------------------------------------------ rodar

def softmax(x):
    e = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def rodar(args):
    import onnxruntime as ort
    from transformers import AutoTokenizer

    entrada = [r for r in ler_jsonl(args.entrada) if "texto" in r]
    entrada.sort(key=lambda r: (r["pacote"], r["t"]))
    if args.limite:
        entrada = entrada[: args.limite]
    print(f"fatias com texto da Sonda 2: {len(entrada)}", file=sys.stderr)

    caminho_modelo = os.path.join(args.modelo_dir, args.modelo_onnx)
    tok = AutoTokenizer.from_pretrained(args.modelo_dir)
    so = ort.SessionOptions()
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.intra_op_num_threads = args.threads
    so.inter_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    t0 = time.perf_counter()
    sessao = ort.InferenceSession(caminho_modelo, sess_options=so)
    print(f"modelo {args.modelo_onnx} carregado em {time.perf_counter()-t0:.1f}s",
          file=sys.stderr)

    def inferir(texto):
        t_a = time.perf_counter()
        i = tok(texto, truncation=True, max_length=512, return_tensors="np")
        t_b = time.perf_counter()
        saida = sessao.run(None, {"input_ids": i["input_ids"],
                                  "attention_mask": i["attention_mask"]})
        t_c = time.perf_counter()
        p_eot = float(softmax(saida[0][0])[1])
        return p_eot, int(i["input_ids"].shape[1]), (t_b - t_a) * 1000, (t_c - t_b) * 1000

    for _ in range(3):  # aquecimento fora das medições
        inferir("aquecimento do modelo com uma frase qualquer")

    registros = []
    for r in entrada:
        texto = r["texto"]
        p_eot, n_tokens, tok_ms, onnx_ms = inferir(texto)
        registros.append({
            "idx": r["idx"],
            "pacote": r["pacote"],
            "classe": r["classe"],
            "t": r["t"],
            "confiancaRotulo": r.get("confiancaRotulo"),
            "hashFatia": r["hashFatia"],
            "texto": texto,
            "textoVazio": not texto.strip(),
            "nPalavras": len(texto.split()),
            "nTokens": n_tokens,
            "pEot": round(p_eot, 6),
            "latMs": round(tok_ms + onnx_ms, 2),
            "tokMs": round(tok_ms, 2),
            "onnxMs": round(onnx_ms, 2),
        })

    with open(args.saida, "w", encoding="utf-8") as f:
        for reg in registros:
            f.write(json.dumps(reg, ensure_ascii=False) + "\n")
    print(f"saida: {args.saida} ({len(registros)} registros)", file=sys.stderr)

    # sonda de latência controlada (12 e 64 tokens aproximados) + RSS
    frase12 = "eu queria saber se você pode me ajudar com isso"
    frase64 = " ".join(["então eu fui lá e falei com ele sobre o problema"] * 6)
    lat12 = []; lat64 = []
    for _ in range(50):
        _, _, a, b = inferir(frase12); lat12.append(a + b)
        _, _, a, b = inferir(frase64); lat64.append(a + b)
    p_vazia, ntok_vazia, _, _ = inferir("")

    rss_kb = pico_kb = None
    with open("/proc/self/status") as f:
        for linha in f:
            if linha.startswith("VmRSS:"):
                rss_kb = int(linha.split()[1])
            elif linha.startswith("VmHWM:"):
                pico_kb = int(linha.split()[1])
    cpu = ""
    with open("/proc/cpuinfo") as f:
        for linha in f:
            if linha.startswith("model name"):
                cpu = linha.split(":", 1)[1].strip()
                break
    import onnxruntime, transformers
    lats = [x["latMs"] for x in registros]
    resumo = {
        "modeloId": "videosdk-live/Namo-Turn-Detector-v1-Portuguese",
        "arquivoOnnx": args.modelo_onnx,
        "modeloBytes": os.path.getsize(caminho_modelo),
        "sha1Modelo": hashlib.sha1(open(caminho_modelo, "rb").read()).hexdigest(),
        "threads": args.threads,
        "n": len(registros),
        "latMsLeito": {"p50": round(float(np.percentile(lats, 50)), 2),
                       "p95": round(float(np.percentile(lats, 95)), 2)},
        "latMs12tokens": {"p50": round(float(np.percentile(lat12, 50)), 2),
                          "p95": round(float(np.percentile(lat12, 95)), 2)},
        "latMs64tokens": {"p50": round(float(np.percentile(lat64, 50)), 2),
                          "p95": round(float(np.percentile(lat64, 95)), 2)},
        "pEotTextoVazio": round(p_vazia, 6),
        "nTokensTextoVazio": ntok_vazia,
        "rssMB": round(rss_kb / 1024, 1) if rss_kb else None,
        "picoRssMB": round(pico_kb / 1024, 1) if pico_kb else None,
        "cpu": cpu,
        "so": "WSL2 " + os.uname().release,
        "versoes": {"onnxruntime": onnxruntime.__version__,
                    "transformers": transformers.__version__,
                    "numpy": np.__version__,
                    "python": sys.version.split()[0]},
    }
    with open(args.resumo, "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False, indent=2)
    print(json.dumps(resumo, ensure_ascii=False, indent=2), file=sys.stderr)


# ------------------------------------------------------------------ métricas

def bloco_metricas(nome, regs, score=lambda r: r["pEot"], gate_limiares=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9), limiar_acc=LIMIAR_CARD, com_ic=True):
    """Métricas idênticas às das Sondas 1–2 sobre um subconjunto de registros."""
    por_classe = collections.defaultdict(list)
    for r in regs:
        por_classe[r["classe"]].append(score(r))
    fr = np.array(por_classe["fim-real"], dtype=float)
    he = np.array(por_classe["hesitacao"], dtype=float)
    ff = np.array(por_classe["fim-falso-commit"], dtype=float)
    print(f"\n== {nome} (n: fr={len(fr)} he={len(he)} ff={len(ff)}) ==")
    if not (len(fr) and len(he)):
        print("classes insuficientes")
        return
    auc = auc_ranks(fr, he)
    if com_ic:
        lo, hi = auc_ic_bootstrap(fr, he)
        print(f"AUC fim-real×hesitação = {auc:.3f} (IC95 bootstrap {lo:.3f}–{hi:.3f})")
    else:
        print(f"AUC fim-real×hesitação = {auc:.3f}")
    if len(ff):
        auc_ff = auc_ranks(fr, ff)
        print(f"AUC fim-real×fim-falso-commit = {auc_ff:.3f}")
    tp = int((fr > limiar_acc).sum()); fn = len(fr) - tp
    fp = int((he > limiar_acc).sum()); tn = len(he) - fp
    acc = (tp + tn) / (len(fr) + len(he))
    bal = (tp / len(fr) + tn / len(he)) / 2
    print(f"@{limiar_acc}: acurácia={acc:.3f} balanceada={bal:.3f} | "
          f"matriz: fr→completo TP={tp} FN={fn} | he→completo FP={fp} TN={tn}")
    if len(he):
        n_alta = int((he > limiar_acc).sum())
        print(f"hesitação com score>{limiar_acc} (custo como acelerador): "
              f"{n_alta}/{len(he)} ({n_alta/len(he):.1%})")
    if len(ff):
        print(f"{'limiar':>7} {'FF evitados':>18} {'FR atrasados':>18}")
        for lim in gate_limiares:
            ev = int((ff <= lim).sum()); at = int((fr <= lim).sum())
            extra = ""
            if lim == limiar_acc:
                extra = (f"  (±{ic_binomial(ev/len(ff), len(ff)):.1%} / "
                         f"±{ic_binomial(at/len(fr), len(fr)):.1%})")
            print(f"{lim:>7} {ev:>7}/{len(ff)} ({ev/len(ff):>5.1%}) "
                  f"{at:>7}/{len(fr)} ({at/len(fr):>5.1%}){extra}")


def metricas(args):
    registros = ler_jsonl(args.resultados)
    ok = [r for r in registros if "pEot" in r]
    print(f"registros: {len(registros)} | com pEot: {len(ok)}")

    por_classe = collections.defaultdict(list)
    for r in ok:
        por_classe[r["classe"]].append(r)
    print("\n== distribuição de P(EOT) por classe ==")
    for classe in CLASSES_ALVO:
        ps = np.array([r["pEot"] for r in por_classe[classe]])
        if not len(ps):
            continue
        print(f"{classe:<17} n={len(ps):>3} mediana={np.median(ps):.3f} "
              f"média={ps.mean():.3f} p10={np.percentile(ps,10):.3f} "
              f"p90={np.percentile(ps,90):.3f}")

    vazios = [r for r in ok if r["textoVazio"]]
    p_vazios = sorted({r["pEot"] for r in vazios})
    print(f"\nfatias com texto vazio: {len(vazios)}/{len(ok)} "
          f"({len(vazios)/len(ok):.1%}) | P(EOT) do vazio: {p_vazios}")
    cont_vazio = collections.Counter(r["classe"] for r in vazios)
    print(f"vazias por classe: {dict(cont_vazio)}")

    # principal: todos os 868 (com vazias — é o que o runtime enfrentaria)
    bloco_metricas("NAMO — todos (com vazias)", ok)

    # sem vazias
    bloco_metricas("NAMO — sem fatias de texto vazio", [r for r in ok if not r["textoVazio"]])

    # dedup por hashFatia (primeira ocorrência — mesma regra da Sonda 1)
    vistos = set()
    unicos = [r for r in ok if not (r["hashFatia"] in vistos or vistos.add(r["hashFatia"]))]
    bloco_metricas(f"NAMO — deduplicado por hashFatia ({len(unicos)} únicas)", unicos, com_ic=False)

    # sem o pacote a6c1 (música/interferência)
    sem_a6c1 = [r for r in ok if not r["pacote"].endswith("a6c1")]
    bloco_metricas("NAMO — sem pacote a6c1", sem_a6c1, com_ic=False)

    # baseline grátis: comprimento em palavras (score = nPalavras)
    bloco_metricas("BASELINE comprimento (nPalavras)", ok,
                   score=lambda r: float(r["nPalavras"]),
                   gate_limiares=(1, 2, 3, 4, 6, 8, 10, 15),
                   limiar_acc=6)
    bloco_metricas("BASELINE comprimento — sem vazias",
                   [r for r in ok if not r["textoVazio"]],
                   score=lambda r: float(r["nPalavras"]),
                   gate_limiares=(1, 2, 3, 4, 6, 8, 10, 15),
                   limiar_acc=6, com_ic=False)

    # baseline comprimento INVERTIDO com sinal aprendido em cross-fit por pacote
    # (a-priori "mais palavras = completo" dá AUC<0,5 neste leito; a inversão
    #  só é legítima se cada fold a aprende no outro — mesmo desenho da Sonda 2)
    pacotes = sorted({r["pacote"] for r in ok})
    fold = {p: i % 2 for i, p in enumerate(pacotes)}
    sc_fr, sc_he = [], []
    for lado in (0, 1):
        treino = [r for r in ok if fold[r["pacote"]] == lado]
        teste = [r for r in ok if fold[r["pacote"]] != lado]
        fr_t = np.array([float(r["nPalavras"]) for r in treino if r["classe"] == "fim-real"])
        he_t = np.array([float(r["nPalavras"]) for r in treino if r["classe"] == "hesitacao"])
        sinal = 1.0 if auc_ranks(fr_t, he_t) >= 0.5 else -1.0
        print(f"cross-fit fold treino={lado}: AUC treino={auc_ranks(fr_t, he_t):.3f} → sinal={sinal:+.0f}")
        for r in teste:
            if r["classe"] == "fim-real":
                sc_fr.append(sinal * float(r["nPalavras"]))
            elif r["classe"] == "hesitacao":
                sc_he.append(sinal * float(r["nPalavras"]))
    print(f"BASELINE comprimento cross-fit (sinal aprendido no outro fold): "
          f"AUC = {auc_ranks(np.array(sc_fr), np.array(sc_he)):.3f}")

    # o Namo é comprimento disfarçado?
    nao_vazios = [r for r in ok if not r["textoVazio"]]
    rho = spearman([r["pEot"] for r in nao_vazios], [r["nPalavras"] for r in nao_vazios])
    print(f"\nspearman P(EOT)×nPalavras (sem vazias): {rho:.3f}")

    # custo
    lats = np.array([r["latMs"] for r in ok])
    toks = np.array([r["onnxMs"] for r in ok])
    print(f"\n== custo local (n={len(lats)}, 1 thread) ==")
    print(f"total (tokenizar+onnx): p50={np.percentile(lats,50):.1f}ms "
          f"p95={np.percentile(lats,95):.1f}ms | só onnx: "
          f"p50={np.percentile(toks,50):.1f}ms p95={np.percentile(toks,95):.1f}ms")

    # a6c1 à parte
    a6c1 = [r for r in ok if r["pacote"].endswith("a6c1")]
    if a6c1:
        print(f"\npacote a6c1 (música/interferência), n={len(a6c1)}:")
        for r in sorted(a6c1, key=lambda x: x["t"]):
            print(f"  {r['classe']:<17} t={r['t']:>9.2f} pEot={r['pEot']:.3f} "
                  f"texto=…{r['texto'][-40:]!r}")


def principal():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="modo", required=True)

    pr = sub.add_parser("rodar")
    pr.add_argument("--entrada", default=PADRAO_ENTRADA,
                    help="resultados-kroko-pontuacao.jsonl da Sonda 2 (textos por fatia)")
    pr.add_argument("--modelo-dir", default=PADRAO_MODELO_DIR)
    pr.add_argument("--modelo-onnx", default="model.onnx",
                    help="model.onnx (fp32) ou model_quant.onnx (int8)")
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
