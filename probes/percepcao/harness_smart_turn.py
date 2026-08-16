#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Harness Smart Turn v3 (pipecat-ai) contra o leito de momentos reais.

Primeiro challenger da frente de percepção. Para cada momento das classes
fim-real / hesitacao / fim-falso-commit, fatia o áudio do usuário TERMINANDO
no instante t da pausa (últimos 8 s, pad de zeros à esquerda) e pergunta ao
modelo a probabilidade de "enunciado completo".

Fonte de áudio: mic-N.raw + mic-N.indice.jsonl de cada pacote do observador
(PCM16 mono 16 kHz). NÃO usa canal-usuario.wav: o formato do wav mudou entre
versões do observador (concatenação × linha do tempo com silêncio), enquanto
raw+âncoras é estável — âncora sequencia 0 ↔ amostra 0 do raw, relógio epoch
ms do servidor (mesmo relógio dos eventos usados na extração dos momentos).

Mapeamento do relógio (idêntico ao extrator de momentos + observador.mjs):
    t0     = manifesto.t0 ?? primeiro evento de eventos.jsonl   [epoch ms]
    epoch  = t0 + t_momento*1000
    amostra_no_raw = (âncora_k.amostraInicio − âncora_0.amostraInicio)
                     + (epoch − âncora_k.t) * 16      [âncora_k: última ≤ epoch]

Pré-processamento fiel ao upstream (smart-turn/inference.py @ main):
    - últimos 8 s, pad zeros à ESQUERDA até 128000 amostras
    - WhisperFeatureExtractor(chunk_length=8), do_normalize=True
    - entrada ONNX "input_features" (1, 80, 800) float32
    - saída = probabilidade sigmoide de completo; threshold upstream 0.5

Uso:
    python harness_smart_turn.py rodar   [--limite N]
    python harness_smart_turn.py metricas

Cultura: inferência sequencial (intra_op=1 — parcimônia com a engine viva;
desvio documentado do upstream, que deixa intra_op no default). Uma sonda
opcional mede a latência com threads default ao final.
"""

import argparse
import collections
import hashlib
import json
import os
import re
import sys
import time

import numpy as np

SR = 16000
JANELA_AMOSTRAS = 8 * SR  # 128000
CLASSES_ALVO = ("fim-real", "hesitacao", "fim-falso-commit")
LIMIAR_UPSTREAM = 0.5
TOLERANCIA_MS = 250.0  # cobertura de conexão (mesma ordem do desvio aceito pelo observador)
DISCREPANCIA_AMOSTRAS = 4000  # 0,25 s entre âncora anterior e seguinte → relógio incerto

RAIZ = "/home/Felipe/work/duplex-lab-ptbr/.claude/worktrees/frente-caminho-ouro"
PADRAO_MOMENTOS = (
    "/home/Felipe/work/duplex-lab-ptbr/.claude/worktrees/percepcao-v0/var/momentos-v0.jsonl"
)
PADRAO_AUDIO = os.path.join(RAIZ, "var/observador")
PADRAO_MODELO = os.path.join(
    RAIZ, "var/observador/testes/smart-turn/modelo/smart-turn-v3.2-cpu.onnx"
)
PADRAO_SAIDA = os.path.join(RAIZ, "var/observador/testes/smart-turn/resultados.jsonl")
PADRAO_RESUMO = os.path.join(RAIZ, "var/observador/testes/smart-turn/resumo-execucao.json")


# ---------------------------------------------------------------- áudio


def ler_jsonl(caminho):
    with open(caminho, "r", encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def primeiro_evento_t(base):
    with open(os.path.join(base, "eventos.jsonl"), "r", encoding="utf-8") as f:
        for linha in f:
            if linha.strip():
                return json.loads(linha).get("t")
    return None


def carregar_conexoes(base):
    """Conexões de mic do pacote: âncoras + caminho do raw + tamanho."""
    conexoes = []
    for nome in sorted(os.listdir(base)):
        m = re.match(r"^mic-(\d+)\.indice\.jsonl$", nome)
        if not m:
            continue
        raw = os.path.join(base, f"mic-{m.group(1)}.raw")
        if not os.path.exists(raw):
            continue
        ancoras = [a for a in ler_jsonl(os.path.join(base, nome)) if a.get("tipo") == "ancora"]
        if not ancoras:
            continue
        n_amostras = os.path.getsize(raw) // 2
        a0 = ancoras[0]
        ultima = ancoras[-1]
        fim_epoch = ultima["t"] + (n_amostras - (ultima["amostraInicio"] - a0["amostraInicio"])) / 16.0
        conexoes.append(
            {
                "nome": f"mic-{m.group(1)}",
                "raw": raw,
                "ancoras": ancoras,
                "n_amostras": n_amostras,
                "inicio_epoch": a0["t"],
                "fim_epoch": fim_epoch,
            }
        )
    return conexoes


def epoch_para_amostra(conexao, epoch_ms):
    """Amostra do raw correspondente ao epoch, com sinal de relógio incerto."""
    ancoras = conexao["ancoras"]
    base0 = ancoras[0]["amostraInicio"]
    lo, hi = 0, len(ancoras) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if ancoras[mid]["t"] <= epoch_ms:
            lo = mid
        else:
            hi = mid - 1
    ak = ancoras[lo]
    s = (ak["amostraInicio"] - base0) + (epoch_ms - ak["t"]) * 16.0
    incerto = False
    if lo + 1 < len(ancoras):
        prox = ancoras[lo + 1]
        s_alt = (prox["amostraInicio"] - base0) - (prox["t"] - epoch_ms) * 16.0
        if abs(s - s_alt) > DISCREPANCIA_AMOSTRAS:
            incerto = True
    s = int(round(s))
    s = max(0, min(conexao["n_amostras"], s))
    return s, incerto


def fatiar(conexao, amostra_fim):
    """Últimos 8 s terminando em amostra_fim; pad de zeros à esquerda."""
    ini = amostra_fim - JANELA_AMOSTRAS
    ini_real = max(0, ini)
    with open(conexao["raw"], "rb") as f:
        f.seek(ini_real * 2)
        bruto = f.read((amostra_fim - ini_real) * 2)
    pcm = np.frombuffer(bruto, dtype=np.int16)
    contexto_s = len(pcm) / SR
    if len(pcm) < JANELA_AMOSTRAS:
        pcm = np.concatenate([np.zeros(JANELA_AMOSTRAS - len(pcm), dtype=np.int16), pcm])
    audio = pcm.astype(np.float32) / 32768.0
    return audio, contexto_s, hashlib.sha1(pcm.tobytes()).hexdigest()[:16]


# ---------------------------------------------------------------- modelo


def construir_sessao(caminho_modelo, intra_op):
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.inter_op_num_threads = 1  # upstream
    if intra_op is not None:
        so.intra_op_num_threads = intra_op  # parcimônia local (desvio documentado)
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(caminho_modelo, sess_options=so)


def rodar(args):
    from transformers import WhisperFeatureExtractor

    momentos = ler_jsonl(args.momentos)
    alvo = [
        dict(m, idx=i) for i, m in enumerate(momentos) if m.get("classe") in CLASSES_ALVO
    ]
    alvo.sort(key=lambda m: (m["pacote"], m["t"]))
    if args.limite:
        alvo = alvo[: args.limite]
    print(f"momentos alvo: {len(alvo)} de {len(momentos)}", file=sys.stderr)

    extrator = WhisperFeatureExtractor(chunk_length=8)
    sessao = construir_sessao(args.modelo, intra_op=args.intra_op)

    # aquecimento (fora das medições)
    aquecer = extrator(
        np.zeros(JANELA_AMOSTRAS, dtype=np.float32),
        sampling_rate=SR,
        return_tensors="np",
        padding="max_length",
        max_length=JANELA_AMOSTRAS,
        truncation=True,
        do_normalize=True,
    ).input_features.squeeze(0).astype(np.float32)[None, ...]
    for _ in range(3):
        sessao.run(None, {"input_features": aquecer})

    cache_pacote = {}
    registros = []
    ultimo_features = aquecer
    for m in alvo:
        pacote = m["pacote"]
        if pacote not in cache_pacote:
            base = os.path.join(args.audio_base, pacote)
            info = {"erro": None}
            if not os.path.isdir(base):
                info["erro"] = "pacote ausente"
            else:
                try:
                    with open(os.path.join(base, "manifesto.json"), encoding="utf-8") as f:
                        manifesto = json.load(f)
                except Exception:
                    manifesto = {}
                t0 = manifesto.get("t0")
                if t0 is None:
                    try:
                        t0 = primeiro_evento_t(base)
                    except Exception:
                        t0 = None
                if t0 is None:
                    info["erro"] = "sem t0 (eventos.jsonl)"
                else:
                    info["t0"] = t0
                    info["conexoes"] = carregar_conexoes(base)
                    if not info["conexoes"]:
                        info["erro"] = "sem conexoes de mic"
            cache_pacote[pacote] = info
        info = cache_pacote[pacote]

        reg = {
            "idx": m["idx"],
            "pacote": pacote,
            "classe": m["classe"],
            "t": m["t"],
            "confiancaRotulo": m.get("confiancaRotulo"),
        }
        if info["erro"]:
            reg["erro"] = info["erro"]
            registros.append(reg)
            continue

        epoch = info["t0"] + m["t"] * 1000.0
        conexao = None
        for c in info["conexoes"]:
            if c["inicio_epoch"] - TOLERANCIA_MS <= epoch <= c["fim_epoch"] + TOLERANCIA_MS:
                conexao = c
                break
        if conexao is None:
            reg["erro"] = "epoch fora de qualquer conexao de mic"
            registros.append(reg)
            continue

        amostra_fim, incerto = epoch_para_amostra(conexao, epoch)
        audio, contexto_s, hash_fatia = fatiar(conexao, amostra_fim)
        rms = float(np.sqrt(np.mean(audio**2)))

        t_a = time.perf_counter()
        entradas = extrator(
            audio,
            sampling_rate=SR,
            return_tensors="np",
            padding="max_length",
            max_length=JANELA_AMOSTRAS,
            truncation=True,
            do_normalize=True,
        )
        features = entradas.input_features.squeeze(0).astype(np.float32)[None, ...]
        t_b = time.perf_counter()
        saida = sessao.run(None, {"input_features": features})
        t_c = time.perf_counter()
        ultimo_features = features

        reg.update(
            {
                "prob": round(float(saida[0][0].item()), 6),
                "latenciaMs": round((t_c - t_a) * 1000, 2),
                "featMs": round((t_b - t_a) * 1000, 2),
                "onnxMs": round((t_c - t_b) * 1000, 2),
                "mic": conexao["nome"],
                "amostraFim": amostra_fim,
                "contextoS": round(contexto_s, 2),
                "rmsFatia": round(rms, 5),
                "hashFatia": hash_fatia,
                "relogioIncerto": incerto,
            }
        )
        registros.append(reg)

    with open(args.saida, "w", encoding="utf-8") as f:
        for r in registros:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"resultados: {args.saida} ({len(registros)} registros)", file=sys.stderr)

    # rodapé de execução: RSS, ambiente, sonda de threads default
    rss_kb = pico_kb = None
    with open("/proc/self/status") as f:
        for linha in f:
            if linha.startswith("VmRSS:"):
                rss_kb = int(linha.split()[1])
            elif linha.startswith("VmHWM:"):
                pico_kb = int(linha.split()[1])
    sonda = None
    if args.sonda_threads:
        sessao_livre = construir_sessao(args.modelo, intra_op=None)
        for _ in range(3):
            sessao_livre.run(None, {"input_features": ultimo_features})
        tempos = []
        for _ in range(25):
            t_i = time.perf_counter()
            sessao_livre.run(None, {"input_features": ultimo_features})
            tempos.append((time.perf_counter() - t_i) * 1000)
        sonda = {
            "onnxMsP50_threadsDefault": round(float(np.percentile(tempos, 50)), 2),
            "reps": 25,
        }
    cpu = ""
    with open("/proc/cpuinfo") as f:
        for linha in f:
            if linha.startswith("model name"):
                cpu = linha.split(":", 1)[1].strip()
                break
    import onnxruntime
    import transformers

    resumo = {
        "modelo": args.modelo,
        "modeloBytes": os.path.getsize(args.modelo),
        "sha1Modelo": hashlib.sha1(open(args.modelo, "rb").read()).hexdigest(),
        "rssMB": round(rss_kb / 1024, 1) if rss_kb else None,
        "picoRssMB": round(pico_kb / 1024, 1) if pico_kb else None,
        "cpu": cpu,
        "so": "WSL2 " + os.uname().release,
        "intraOpThreads": args.intra_op,
        "sondaThreadsDefault": sonda,
        "versoes": {
            "onnxruntime": onnxruntime.__version__,
            "transformers": transformers.__version__,
            "numpy": np.__version__,
            "python": sys.version.split()[0],
        },
    }
    with open(args.resumo, "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False, indent=2)
    print(json.dumps(resumo, ensure_ascii=False, indent=2), file=sys.stderr)


# ---------------------------------------------------------------- métricas


def auc_ranks(pos, neg):
    """AUC de Mann-Whitney com correção de empates."""
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


def metricas(args):
    registros = ler_jsonl(args.resultados)
    ok = [r for r in registros if "prob" in r]
    erros = [r for r in registros if "prob" not in r]
    print(f"registros: {len(registros)} | com prob: {len(ok)} | erros: {len(erros)}")
    if erros:
        contagem = collections.Counter((r["classe"], r.get("erro")) for r in erros)
        for (classe, erro), n in sorted(contagem.items()):
            print(f"  erro: {classe} × '{erro}': {n}")

    por_classe = collections.defaultdict(list)
    for r in ok:
        por_classe[r["classe"]].append(r)
    for classe in CLASSES_ALVO:
        rs = por_classe[classe]
        probs = np.array([r["prob"] for r in rs])
        if len(probs) == 0:
            continue
        print(
            f"\n{classe}: n={len(probs)} prob mediana={np.median(probs):.3f} "
            f"média={probs.mean():.3f} p10={np.percentile(probs, 10):.3f} "
            f"p90={np.percentile(probs, 90):.3f}"
        )

    fr = np.array([r["prob"] for r in por_classe["fim-real"]])
    he = np.array([r["prob"] for r in por_classe["hesitacao"]])
    ff = np.array([r["prob"] for r in por_classe["fim-falso-commit"]])

    # 1. discriminação fim-real × hesitacao (fim-real = classe positiva)
    if len(fr) and len(he):
        auc = auc_ranks(fr, he)
        tp = int((fr > LIMIAR_UPSTREAM).sum())
        fn = len(fr) - tp
        fp = int((he > LIMIAR_UPSTREAM).sum())
        tn = len(he) - fp
        acc = (tp + tn) / (len(fr) + len(he))
        print(f"\n== 1. fim-real × hesitacao ==")
        print(f"AUC = {auc:.3f}")
        print(f"acurácia @0.5 = {acc:.3f}  (n={len(fr) + len(he)})")
        print(f"matriz @0.5: fim-real→completo TP={tp} FN={fn} | hesitacao→completo FP={fp} TN={tn}")

    # 2. fim-falso-commit evitados × fim-real atrasados, por limiar
    print(f"\n== 2. gate nos commits (incompleto = prob ≤ limiar) ==")
    print(f"{'limiar':>7} {'FF evitados':>16} {'FR atrasados':>16}")
    for limiar in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        ev = int((ff <= limiar).sum())
        at = int((fr <= limiar).sum())
        print(
            f"{limiar:>7.1f} {ev:>6}/{len(ff)} ({ev / len(ff):>5.1%}) "
            f"{at:>6}/{len(fr)} ({at / len(fr):>5.1%})"
        )
    # hesitacao com prob alta = commits novos se ST fosse acelerador
    if len(he):
        n_alta = int((he > LIMIAR_UPSTREAM).sum())
        print(
            f"hesitacao com prob>0.5 (custo do uso como acelerador): "
            f"{n_alta}/{len(he)} ({n_alta / len(he):.1%})"
        )

    # 3. custo local
    lat = np.array([r["latenciaMs"] for r in ok])
    feat = np.array([r["featMs"] for r in ok])
    onnx = np.array([r["onnxMs"] for r in ok])
    print(f"\n== 3. custo local (n={len(lat)}) ==")
    for nome, v in (("total", lat), ("features", feat), ("onnx", onnx)):
        print(f"{nome}: p50={np.percentile(v, 50):.1f}ms p95={np.percentile(v, 95):.1f}ms")

    # ressalvas quantificadas
    print(f"\n== ressalvas ==")
    hashes = collections.Counter(r["hashFatia"] for r in ok)
    unicos = len(hashes)
    print(f"fatias únicas (sha1): {unicos}/{len(ok)} — replays inflam o n")
    conflitos = 0
    classes_por_hash = collections.defaultdict(set)
    for r in ok:
        classes_por_hash[r["hashFatia"]].add(r["classe"])
    conflitos = sum(1 for c in classes_por_hash.values() if len(c) > 1)
    print(f"hashes com classes conflitantes (mesmo áudio, rótulos ≠): {conflitos}")
    incertos = [r for r in ok if r.get("relogioIncerto")]
    print(f"relógio incerto (gap entre âncoras): {len(incertos)}")
    mudas = [r for r in ok if r.get("rmsFatia", 1) < 0.0005]
    print(f"fatias quase mudas (rms<5e-4): {len(mudas)}")
    curtas = [r for r in ok if r.get("contextoS", 8) < 8]
    print(f"fatias com contexto <8s (pad à esquerda): {len(curtas)}")

    # dedup: métricas na primeira ocorrência de cada hash
    if len(fr) and len(he):
        vistos = set()
        fr_u, he_u, ff_u = [], [], []
        for r in ok:
            if r["hashFatia"] in vistos:
                continue
            vistos.add(r["hashFatia"])
            if r["classe"] == "fim-real":
                fr_u.append(r["prob"])
            elif r["classe"] == "hesitacao":
                he_u.append(r["prob"])
            elif r["classe"] == "fim-falso-commit":
                ff_u.append(r["prob"])
        if fr_u and he_u:
            auc_u = auc_ranks(np.array(fr_u), np.array(he_u))
            print(
                f"deduplicado: fim-real n={len(fr_u)} hesitacao n={len(he_u)} "
                f"fim-falso-commit n={len(ff_u)} | AUC fim-real×hesitacao = {auc_u:.3f}"
            )
        if ff_u:
            ev = sum(1 for p in ff_u if p <= LIMIAR_UPSTREAM)
            at = sum(1 for p in fr_u if p <= LIMIAR_UPSTREAM)
            print(
                f"deduplicado @0.5: FF evitados {ev}/{len(ff_u)} ({ev / len(ff_u):.1%}) | "
                f"FR atrasados {at}/{len(fr_u)} ({at / len(fr_u):.1%})"
            )

    # pacote com interferência conhecida (música): sufixo a6c1
    a6c1 = [r for r in ok if r["pacote"].endswith("a6c1")]
    if a6c1:
        print(f"\npacote a6c1 (música/interferência), n={len(a6c1)}:")
        for r in sorted(a6c1, key=lambda x: x["t"]):
            print(
                f"  {r['classe']:<17} t={r['t']:>9.2f} prob={r['prob']:.3f} "
                f"rms={r['rmsFatia']:.4f} contexto={r['contextoS']}s"
            )

    # confiança de rótulo: subconjunto de maior confiança por classe
    if len(fr) and len(he):
        fr_c = [r["prob"] for r in por_classe["fim-real"] if r.get("confiancaRotulo", 0) >= 0.8]
        he_c = [r["prob"] for r in por_classe["hesitacao"] if r.get("confiancaRotulo", 0) >= 0.7]
        if fr_c and he_c:
            print(
                f"\n(confiança: fim-real=0.8, hesitacao=0.7, fim-falso-commit=0.9 — "
                f"uniformes por classe; sem subconjunto de alta confiança separável)"
            )


def principal():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="modo", required=True)

    pr = sub.add_parser("rodar", help="fatia áudio e roda o modelo")
    pr.add_argument("--momentos", default=PADRAO_MOMENTOS)
    pr.add_argument("--audio-base", default=PADRAO_AUDIO)
    pr.add_argument("--modelo", default=PADRAO_MODELO)
    pr.add_argument("--saida", default=PADRAO_SAIDA)
    pr.add_argument("--resumo", default=PADRAO_RESUMO)
    pr.add_argument("--limite", type=int, default=0, help="apenas os N primeiros (depuração)")
    pr.add_argument("--intra-op", type=int, default=1, help="threads intra-op (1 = parcimônia)")
    pr.add_argument("--sonda-threads", action="store_true", default=True)
    pr.set_defaults(funcao=rodar)

    pm = sub.add_parser("metricas", help="calcula métricas a partir dos resultados")
    pm.add_argument("--resultados", default=PADRAO_SAIDA)
    pm.set_defaults(funcao=metricas)

    args = p.parse_args()
    args.funcao(args)


if __name__ == "__main__":
    principal()
