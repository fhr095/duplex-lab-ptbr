#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Sonda 2 — pontuação do Kroko como sinal de fim de turno (custo ~zero).

Hipótese: a pontuação final da parcial do Kroko 64-L (zipformer2 transducer
streaming PT, sherpa-onnx) NO INSTANTE DA PAUSA discrimina fim-real ×
hesitação: vírgula/sem pontuação → vai continuar; ./?/! → terminou.

Protocolo: MESMAS fatias da Sonda 1 (Smart Turn) — dirigidas por
resultados.jsonl (pacote, mic, amostraFim) e verificadas por sha1 da fatia,
bit a bit. Cada fatia (últimos 8 s terminando no evento de pausa, com o
hangover ~280 ms do VAD) é alimentada a um stream novo + 0,5 s de silêncio,
decodificada até esgotar; o texto resultante aproxima a parcial que a perna
Kroko da engine teria no momento do commit.

Mapeamento binário declarado A PRIORI (antes de olhar os números):
    completo   = termina em "." "?" "!"
    incompleto = termina em "," | reticências "..." | sem pontuação | vazia
(Reticências = suspensão → continua, pela convenção da língua.)

Custo em runtime: ~0 ADICIONAL quando a perna de parciais é o Kroko
(ASR_PARTIAL_ENGINE=kroko) — o texto já é computado ao vivo; o default atual
da engine é whisper-tiny, e nesse caso o custo é o da troca de perna, não
desta sonda. O custo do decode offline é reportado por honestidade.

Uso:
    python harness_kroko_pontuacao.py rodar   [--limite N]
    python harness_kroko_pontuacao.py metricas
"""

import argparse
import collections
import hashlib
import json
import os
import sys
import time

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from harness_smart_turn import (  # noqa: E402
    SR,
    CLASSES_ALVO,
    ler_jsonl,
    carregar_conexoes,
    fatiar,
    auc_ranks,
)

RAIZ = "/home/Felipe/work/duplex-lab-ptbr/.claude/worktrees/frente-caminho-ouro"
PADRAO_ENTRADA = os.path.join(RAIZ, "var/observador/testes/smart-turn/resultados.jsonl")
PADRAO_AUDIO = os.path.join(RAIZ, "var/observador")
PADRAO_MODELO_DIR = os.path.join(RAIZ, "var/observador/testes/kroko/modelos/pt-64L")
PADRAO_SAIDA = os.path.join(
    RAIZ, "var/observador/testes/smart-turn/resultados-kroko-pontuacao.jsonl"
)
PADRAO_RESUMO = os.path.join(
    RAIZ, "var/observador/testes/smart-turn/resumo-kroko-pontuacao.json"
)

COMPLETO = {"ponto", "interrogacao", "exclamacao"}
INCOMPLETO = {"virgula", "reticencias", "sem-pontuacao", "vazia"}


def categoria_final(texto):
    t = texto.strip()
    if not t:
        return "vazia"
    if t.endswith("..."):
        return "reticencias"
    c = t[-1]
    if c == ",":
        return "virgula"
    if c == ".":
        return "ponto"
    if c == "?":
        return "interrogacao"
    if c == "!":
        return "exclamacao"
    return "sem-pontuacao"


# ---------------------------------------------------------------- rodar


def rodar(args):
    import sherpa_onnx

    entrada = [r for r in ler_jsonl(args.entrada) if "prob" in r]
    entrada.sort(key=lambda r: (r["pacote"], r["t"]))
    if args.limite:
        entrada = entrada[: args.limite]
    print(f"fatias a decodificar: {len(entrada)}", file=sys.stderr)

    t0 = time.perf_counter()
    rec = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=os.path.join(args.modelo_dir, "tokens.txt"),
        encoder=os.path.join(args.modelo_dir, "encoder.onnx"),
        decoder=os.path.join(args.modelo_dir, "decoder.onnx"),
        joiner=os.path.join(args.modelo_dir, "joiner.onnx"),
        num_threads=args.threads,
        sample_rate=SR,
        feature_dim=80,
        decoding_method="greedy_search",
        enable_endpoint_detection=False,
        provider="cpu",
    )
    print(f"modelo carregado em {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    cauda = np.zeros(SR // 2, dtype=np.float32)  # 0,5 s de silêncio
    cache_conexoes = {}
    cache_texto = {}  # hashFatia → (texto, latMs do decode original)
    registros = []
    decodes = 0
    for r in entrada:
        reg = {
            "idx": r["idx"],
            "pacote": r["pacote"],
            "classe": r["classe"],
            "t": r["t"],
            "confiancaRotulo": r.get("confiancaRotulo"),
            "hashFatia": r["hashFatia"],
        }
        if r["hashFatia"] in cache_texto:
            texto, _ = cache_texto[r["hashFatia"]]
            reg.update(
                {
                    "texto": texto,
                    "categoria": categoria_final(texto),
                    "nPalavras": len(texto.split()),
                    "latMs": None,
                    "cache": True,
                    "hashConfere": True,
                }
            )
            registros.append(reg)
            continue

        base = os.path.join(args.audio_base, r["pacote"])
        if r["pacote"] not in cache_conexoes:
            cache_conexoes[r["pacote"]] = carregar_conexoes(base)
        conexao = next(
            (c for c in cache_conexoes[r["pacote"]] if c["nome"] == r["mic"]), None
        )
        if conexao is None:
            reg["erro"] = "conexao nao encontrada"
            registros.append(reg)
            continue
        audio, _, hash_fatia = fatiar(conexao, r["amostraFim"])
        reg["hashConfere"] = hash_fatia == r["hashFatia"]
        if not reg["hashConfere"]:
            reg["erro"] = "hash da fatia divergiu da Sonda 1"
            registros.append(reg)
            continue

        t_a = time.perf_counter()
        s = rec.create_stream()
        s.accept_waveform(SR, audio)
        s.accept_waveform(SR, cauda)
        s.input_finished()
        while rec.is_ready(s):
            rec.decode_stream(s)
        texto = rec.get_result(s).strip()
        lat_ms = (time.perf_counter() - t_a) * 1000
        decodes += 1
        cache_texto[r["hashFatia"]] = (texto, lat_ms)
        reg.update(
            {
                "texto": texto,
                "categoria": categoria_final(texto),
                "nPalavras": len(texto.split()),
                "latMs": round(lat_ms, 1),
                "cache": False,
            }
        )
        registros.append(reg)

    with open(args.saida, "w", encoding="utf-8") as f:
        for reg in registros:
            f.write(json.dumps(reg, ensure_ascii=False) + "\n")
    print(f"saida: {args.saida} ({len(registros)} registros, {decodes} decodes)", file=sys.stderr)

    rss_kb = None
    with open("/proc/self/status") as f:
        for linha in f:
            if linha.startswith("VmHWM:"):
                rss_kb = int(linha.split()[1])
    import sherpa_onnx as so

    lats = [x["latMs"] for x in registros if x.get("latMs")]
    resumo = {
        "modeloDir": args.modelo_dir,
        "modeloBytesTotal": sum(
            os.path.getsize(os.path.join(args.modelo_dir, n))
            for n in os.listdir(args.modelo_dir)
        ),
        "threads": args.threads,
        "decodes": decodes,
        "fatiasCache": len(registros) - decodes,
        "latMsDecodeFatia": {
            "p50": round(float(np.percentile(lats, 50)), 1),
            "p95": round(float(np.percentile(lats, 95)), 1),
        }
        if lats
        else None,
        "rtfAprox": round(float(np.mean(lats)) / 1000.0 / 8.5, 4) if lats else None,
        "picoRssMB": round(rss_kb / 1024, 1) if rss_kb else None,
        "versoes": {"sherpa_onnx": so.__version__, "numpy": np.__version__},
    }
    with open(args.resumo, "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False, indent=2)
    print(json.dumps(resumo, ensure_ascii=False, indent=2), file=sys.stderr)


# ---------------------------------------------------------------- métricas


def metricas(args):
    registros = ler_jsonl(args.resultados)
    ok = [r for r in registros if "categoria" in r]
    erros = [r for r in registros if "categoria" not in r]
    print(f"registros: {len(registros)} | com categoria: {len(ok)} | erros: {len(erros)}")

    ordem_cat = ["ponto", "interrogacao", "exclamacao", "virgula", "reticencias", "sem-pontuacao", "vazia"]
    por_classe = collections.defaultdict(list)
    for r in ok:
        por_classe[r["classe"]].append(r)

    print("\n== distribuição bruta: classe × categoria final da parcial ==")
    cab = f"{'classe':<17}" + "".join(f"{c[:9]:>11}" for c in ordem_cat) + f"{'n':>6}"
    print(cab)
    for classe in CLASSES_ALVO:
        rs = por_classe[classe]
        cont = collections.Counter(r["categoria"] for r in rs)
        linha = f"{classe:<17}"
        for c in ordem_cat:
            frac = cont.get(c, 0) / len(rs) if rs else 0
            linha += f"{cont.get(c, 0):>4} {frac:>5.1%}"
        print(linha + f"{len(rs):>6}")

    # respostas diretas do item 5 do mandato
    he = por_classe["hesitacao"]
    fr = por_classe["fim-real"]
    ff = por_classe["fim-falso-commit"]
    he_inc = sum(1 for r in he if r["categoria"] in ("virgula", "sem-pontuacao", "vazia", "reticencias"))
    fr_com = sum(1 for r in fr if r["categoria"] in COMPLETO)
    print(
        f"\nhesitações terminando SEM pontuação/vírgula/reticências/vazia: "
        f"{he_inc}/{len(he)} ({he_inc / len(he):.1%})"
    )
    print(f"fins-reais terminando com . ? ! : {fr_com}/{len(fr)} ({fr_com / len(fr):.1%})")

    # binário a priori: completo = {. ? !}
    def eh_completo(r):
        return r["categoria"] in COMPLETO

    tp = sum(1 for r in fr if eh_completo(r))
    fn = len(fr) - tp
    fp = sum(1 for r in he if eh_completo(r))
    tn = len(he) - fp
    sens = tp / len(fr)
    espec = tn / len(he)
    print(f"\n== 1. fim-real × hesitação (mapeamento a priori) ==")
    print(f"matriz: fim-real→completo TP={tp} FN={fn} | hesitacao→completo FP={fp} TN={tn}")
    print(f"acurácia = {(tp + tn) / (len(fr) + len(he)):.3f}  balanceada = {(sens + espec) / 2:.3f}")
    print(f"sensibilidade (fim-real como completo) = {sens:.3f} | especificidade = {espec:.3f}")

    # AUC com score calibrado em split honesto por pacote (cross-fit 2 folds)
    pacotes = sorted({r["pacote"] for r in ok})
    fold = {p: i % 2 for i, p in enumerate(pacotes)}

    def calibrar(rs):
        # P(fim-real | categoria) com suavização de Laplace (α=1)
        n_fr = collections.Counter()
        n_tot = collections.Counter()
        for r in rs:
            if r["classe"] in ("fim-real", "hesitacao"):
                n_tot[r["categoria"]] += 1
                if r["classe"] == "fim-real":
                    n_fr[r["categoria"]] += 1
        return {c: (n_fr.get(c, 0) + 1) / (n_tot.get(c, 0) + 2) for c in ordem_cat}

    scores_fr, scores_he = [], []
    for lado in (0, 1):
        treino = [r for r in ok if fold[r["pacote"]] == lado]
        teste = [r for r in ok if fold[r["pacote"]] != lado]
        tab = calibrar(treino)
        for r in teste:
            s = tab.get(r["categoria"], 0.5)
            if r["classe"] == "fim-real":
                scores_fr.append(s)
            elif r["classe"] == "hesitacao":
                scores_he.append(s)
    auc = auc_ranks(np.array(scores_fr), np.array(scores_he))
    print(f"AUC (score calibrado cross-fit por pacote) = {auc:.3f} "
          f"(n={len(scores_fr)}+{len(scores_he)}; replays cruzam folds — ver ressalva)")

    # dedup por hash
    vistos = set()
    u = [r for r in ok if not (r["hashFatia"] in vistos or vistos.add(r["hashFatia"]))]
    fr_u = [r for r in u if r["classe"] == "fim-real"]
    he_u = [r for r in u if r["classe"] == "hesitacao"]
    ff_u = [r for r in u if r["classe"] == "fim-falso-commit"]
    tp_u = sum(1 for r in fr_u if eh_completo(r))
    tn_u = sum(1 for r in he_u if not eh_completo(r))
    print(
        f"deduplicado: balanceada = "
        f"{(tp_u / len(fr_u) + tn_u / len(he_u)) / 2:.3f} (n={len(fr_u)}+{len(he_u)})"
    )

    # 2. gate nos commits no MESMO ponto de operação (incompleto a priori)
    ev = sum(1 for r in ff if not eh_completo(r))
    at = sum(1 for r in fr if not eh_completo(r))
    print(f"\n== 2. gate nos commits (incompleto = sem ./?/!) ==")
    print(f"FF evitados: {ev}/{len(ff)} ({ev / len(ff):.1%}) | FR atrasados: {at}/{len(fr)} ({at / len(fr):.1%})")
    ev_u = sum(1 for r in ff_u if not eh_completo(r))
    at_u = sum(1 for r in fr_u if not eh_completo(r))
    print(
        f"deduplicado: FF evitados {ev_u}/{len(ff_u)} ({ev_u / len(ff_u):.1%}) | "
        f"FR atrasados {at_u}/{len(fr_u)} ({at_u / len(fr_u):.1%})"
    )

    # 3. custo
    lats = [r["latMs"] for r in ok if r.get("latMs")]
    if lats:
        print(f"\n== 3. custo offline do decode da fatia (8,5 s de áudio, 1 thread) ==")
        print(
            f"p50={np.percentile(lats, 50):.0f}ms p95={np.percentile(lats, 95):.0f}ms "
            f"(RTF≈{np.mean(lats) / 1000 / 8.5:.3f}; em runtime o texto já existe "
            f"na perna kroko — custo adicional ≈ 0)"
        )

    # a6c1 à parte
    a6c1 = [r for r in ok if r["pacote"].endswith("a6c1")]
    if a6c1:
        print(f"\npacote a6c1 (música/interferência), n={len(a6c1)}:")
        for r in sorted(a6c1, key=lambda x: x["t"]):
            print(f"  {r['classe']:<17} t={r['t']:>9.2f} cat={r['categoria']:<14} texto=…{r['texto'][-48:]!r}")

    incoerentes = [r for r in ok if not r.get("hashConfere", True)]
    print(f"\nfatias com hash divergente da Sonda 1: {len(incoerentes)} (integridade do pareamento)")


def principal():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="modo", required=True)

    pr = sub.add_parser("rodar")
    pr.add_argument("--entrada", default=PADRAO_ENTRADA, help="resultados.jsonl da Sonda 1 (fatias)")
    pr.add_argument("--audio-base", default=PADRAO_AUDIO)
    pr.add_argument("--modelo-dir", default=PADRAO_MODELO_DIR)
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
