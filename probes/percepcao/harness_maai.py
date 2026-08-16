#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
harness_maai.py — MaAI (família VAP, Kyoto) como challenger de dinâmica de dois
canais contra o leito congelado de sobreposição (59 momentos, PT-BR).

TESTE DE TRANSFERÊNCIA ZERO-SHOT: português NÃO é idioma coberto pelos pesos.
O resultado julga a transferência para PT, não a arquitetura VAP.

Licenças (lidas card a card em 2026-08-16):
  - código maai 0.2.15: MIT
  - pesos usados (todos MIT): maai-kyoto/vap_tri_kyoto, vap_en_kyoto,
    vap_mc_tri_kyoto, vap_bc_tri
  - encoder CPC congelado: checkpoint público libri-light (FAIR),
    baixado de dl.fbaipublicfiles.com via torch.hub
  - NÃO usados por licença restritiva (CC-BY-NC-ND/SA): vap_en, vap_ch, vap_jp,
    vap_fr, vap_ca, vap_mc_* (não-kyoto), vap_tri, vap_mc_tri, vad_jp, vad_ch
    (nota: fr e ca seriam os mais próximos do PT; ficaram de fora pela licença)
  - vap_bc_2type_jp: sem licença declarada -> não usado

Uso:
  .venv-teste-maai/bin/python harness_maai.py rodar     # inferência -> resultados.jsonl + custo.json
  .venv-teste-maai/bin/python harness_maai.py analisar  # métricas -> métricas no stdout + metricas.json

Ambiente: CPU, 1 thread torch, sequencial (máquina compartilhada com engine viva).
"""
import contextlib
import io
import json
import math
import os
import sys
import time
import wave

RAIZ = os.environ.get(
    "DUPLEX_RAIZ",
    "/home/Felipe/work/duplex-lab-ptbr/.claude/worktrees/frente-caminho-ouro",
)
LEITO = os.environ.get(
    "LEITO_SOBREPOSICAO",
    "/home/Felipe/work/duplex-lab-ptbr/.claude/worktrees/percepcao-v0/var/momentos-sobreposicao-v1.jsonl",
)
BASE_PACOTES = os.path.join(RAIZ, "var", "observador")
DIR_TESTE = os.path.join(RAIZ, "var", "observador", "testes", "maai")
DIR_MODELOS = os.path.join(DIR_TESTE, "modelos")
ARQ_RESULTADOS = os.path.join(DIR_TESTE, "resultados.jsonl")
ARQ_CUSTO = os.path.join(DIR_TESTE, "custo.json")
ARQ_METRICAS = os.path.join(DIR_TESTE, "metricas.json")

SR = 16000
FRAME_HZ = 10.0
CHUNK = int(SR / FRAME_HZ)  # 1600 amostras = 100 ms
CTX_SEC = 20
PRE_EVAL_S = 2.0    # janela pedida: [a-2s, b+1s]
POS_EVAL_S = 1.0
WARMUP_S = 10.0     # contexto extra antes de a-2s (modelo usa até 20 s de contexto)
LIMIAR_ASSIST_DB = -50.0  # atividade do canal do assistente
EXCLUIR_E2C0 = (6629.0, 7641.0)  # corpus-excluir.json (faixa em s)

# (rótulo, mode, lang) — todos com pesos MIT
MODELOS = [
    ("vap_tri_kyoto", "vap", "tri_kyoto"),
    ("vap_en_kyoto", "vap", "en_kyoto"),
    ("vap_mc_tri_kyoto", "vap_mc", "tri_kyoto"),
    ("vap_bc_tri_invertido", "bc", "tri"),  # probe: ch1=assistente, ch2=usuário
]


def ler_leito():
    momentos = [json.loads(l) for l in open(LEITO)]
    assert len(momentos) == 59, f"leito esperado com 59 momentos, veio {len(momentos)}"
    # respeita corpus-excluir do e2c0: nenhuma janela dentro da faixa
    for m in momentos:
        if m["pacote"].endswith("e2c0"):
            a, b = m["janela"]
            assert not (a < EXCLUIR_E2C0[1] and b > EXCLUIR_E2C0[0]), (
                f"janela {m['janela']} intersecta faixa excluída {EXCLUIR_E2C0}"
            )
    return momentos


def ler_wav_seg(caminho, t0_s, t1_s):
    import numpy as np

    with wave.open(caminho) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2
        n = w.getnframes()
        i0 = max(0, int(round(t0_s * SR)))
        i1 = min(n, int(round(t1_s * SR)))
        w.setpos(i0)
        bruto = w.readframes(max(0, i1 - i0))
    x = np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0
    esperado = int(round((t1_s - t0_s) * SR))
    if len(x) < esperado:  # borda: preenche com silêncio
        x = np.concatenate([np.zeros(esperado - len(x), dtype=np.float32), x]) if i0 == 0 else np.concatenate([x, np.zeros(esperado - len(x), dtype=np.float32)])
    return x


def rms_db(x):
    import numpy as np

    if len(x) == 0:
        return -120.0
    return float(20 * np.log10(np.sqrt(np.mean(x**2) + 1e-12) + 1e-12))


def onset_assistente(xa, t0_s, de_s, ate_s, limiar_db=LIMIAR_ASSIST_DB):
    """Primeiro instante (s, linha do wav) com energia sustentada (>=150 ms) no canal
    do assistente dentro de [de_s, ate_s]. None se não houver."""
    import numpy as np

    win = int(0.05 * SR)
    i0 = max(0, int((de_s - t0_s) * SR))
    i1 = min(len(xa), int((ate_s - t0_s) * SR))
    seg = xa[i0:i1]
    if len(seg) < 3 * win:
        return None
    nwin = len(seg) // win
    e = seg[: nwin * win].reshape(nwin, win)
    db = 20 * np.log10(np.sqrt((e**2).mean(axis=1) + 1e-12) + 1e-12)
    ativo = db > limiar_db
    for k in range(nwin - 2):
        if ativo[k] and ativo[k + 1] and ativo[k + 2]:
            return de_s + k * win / SR
    return None


def vmrss_mb():
    try:
        for linha in open("/proc/self/status"):
            if linha.startswith("VmRSS"):
                return int(linha.split()[1]) / 1024.0
    except OSError:
        pass
    return float("nan")


def rodar():
    os.environ["TORCH_HOME"] = os.path.join(DIR_MODELOS, "torch-home")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    import numpy as np
    import torch

    torch.set_num_threads(1)
    from maai import Maai, MaaiInput

    momentos = ler_leito()
    os.makedirs(DIR_MODELOS, exist_ok=True)
    custo = {"maquina": "CPU 1 thread torch, nice 19", "modelos": {}}
    saida = open(ARQ_RESULTADOS, "w")

    for rotulo, mode, lang in MODELOS:
        t_load0 = time.time()
        m = Maai(
            mode=mode,
            lang=lang,
            frame_rate=FRAME_HZ,
            context_len_sec=CTX_SEC,
            audio_ch1=MaaiInput.Zero(),
            audio_ch2=MaaiInput.Zero(),
            device="cpu",
            cache_dir=os.path.join(DIR_MODELOS, "hf"),
            model_type="normal",
        )
        t_load = time.time() - t_load0
        rss_pos_load = vmrss_mb()
        lat_chunk = []
        s_audio_total = 0.0
        t_wall0 = time.time()

        for mo in momentos:
            pac_dir = os.path.join(BASE_PACOTES, mo["pacote"])
            a, b = mo["janela"]
            ini_aval = a - PRE_EVAL_S
            ini_feed = max(0.0, ini_aval - WARMUP_S)
            fim_feed = b + POS_EVAL_S
            xu = ler_wav_seg(os.path.join(pac_dir, "canal-usuario.wav"), ini_feed, fim_feed)
            xa = ler_wav_seg(os.path.join(pac_dir, "canal-assistente.wav"), ini_feed, fim_feed)
            nch = min(len(xu), len(xa)) // CHUNK
            m.reset_runtime_state()
            with m.result_dict_queue.mutex:
                m.result_dict_queue.queue.clear()

            # vap*: ch1=usuário, ch2=assistente. bc (probe invertido): ch1=assistente, ch2=usuário
            invertido = mode == "bc"
            ts, pnow_u, pfut_u, vad_u, vad_a, pbc, pbc_det = [], [], [], [], [], [], []
            lixo = io.StringIO()
            for k in range(nch):
                c1 = xu[k * CHUNK : (k + 1) * CHUNK]
                c2 = xa[k * CHUNK : (k + 1) * CHUNK]
                if invertido:
                    c1, c2 = c2, c1
                t0c = time.perf_counter()
                with contextlib.redirect_stdout(lixo):  # suprime print de debug do vap_bc
                    m.process(c1, c2)
                lat_chunk.append(time.perf_counter() - t0c)
                while not m.result_dict_queue.empty():
                    r = m.result_dict_queue.get()
                    t_frame = ini_feed + (k + 1) * (CHUNK / SR)
                    if t_frame < ini_aval - 1e-9:
                        continue
                    ts.append(round(t_frame, 2))
                    if mode == "bc":
                        pbc.append(round(float(r["p_bc"]), 4))
                        pbc_det.append(round(float(r["p_bc_detect"]), 4))
                    else:
                        pnow_u.append(round(float(r["p_now"][0]), 4))
                        pfut_u.append(round(float(r["p_future"][0]), 4))
                        vad_u.append(round(float(r["vad"][0]), 4))
                        vad_a.append(round(float(r["vad"][1]), 4))
            s_audio_total += nch * (CHUNK / SR)

            # diagnóstico da cena alimentada
            bu0, bu1 = mo["burst"]
            xa_burst = ler_wav_seg(os.path.join(pac_dir, "canal-assistente.wav"), bu0 - 0.2, bu1)
            assist_db_burst = rms_db(xa_burst)
            on_assist = onset_assistente(xa, ini_feed, max(ini_aval, bu0 - 0.5), min(fim_feed, bu1 + 0.5))

            linha = {
                "pacote": mo["pacote"],
                "t": mo["t"],
                "celula": mo["celula"],
                "confiancaRotulo": mo.get("confiancaRotulo"),
                "burst": mo["burst"],
                "burstDurS": mo.get("burstDurS"),
                "janela": mo["janela"],
                "modelo": rotulo,
                "series": {
                    "t": ts,
                    **({"p_bc": pbc, "p_bc_detect": pbc_det} if mode == "bc" else
                       {"p_now_usuario": pnow_u, "p_future_usuario": pfut_u,
                        "vad_usuario": vad_u, "vad_assistente": vad_a}),
                },
                "cena": {
                    "assist_db_burst": round(assist_db_burst, 1),
                    "assist_ativo_burst": bool(assist_db_burst > LIMIAR_ASSIST_DB),
                    "onset_assist_no_burst": round(on_assist, 2) if on_assist is not None else None,
                },
            }
            saida.write(json.dumps(linha, ensure_ascii=False) + "\n")
            saida.flush()

        t_wall = time.time() - t_wall0
        custo["modelos"][rotulo] = {
            "carga_s": round(t_load, 1),
            "rss_pos_carga_mb": round(rss_pos_load, 0),
            "rss_fim_mb": round(vmrss_mb(), 0),
            "audio_s": round(s_audio_total, 1),
            "wall_s": round(t_wall, 1),
            "rtf_1thread": round(t_wall / s_audio_total, 3),
            "latencia_chunk_ms_p50": round(1000 * sorted(lat_chunk)[len(lat_chunk) // 2], 1),
            "latencia_chunk_ms_p95": round(1000 * sorted(lat_chunk)[int(len(lat_chunk) * 0.95)], 1),
            "streaming": "sim (chunks de 100 ms, KV-cache causal, contexto 20 s)",
        }
        print(f"[{rotulo}] {len(momentos)} momentos, RTF={custo['modelos'][rotulo]['rtf_1thread']}", file=sys.stderr)
        del m

    saida.close()
    json.dump(custo, open(ARQ_CUSTO, "w"), ensure_ascii=False, indent=1)
    print(f"ok -> {ARQ_RESULTADOS}\nok -> {ARQ_CUSTO}", file=sys.stderr)


# ---------------------------------------------------------------- análise ----

def _serie(l, nome):
    return l["series"]["t"], l["series"][nome]


def _max_em(ts, vs, t0, t1):
    xs = [v for t, v in zip(ts, vs) if t0 - 1e-9 <= t <= t1 + 1e-9]
    return max(xs) if xs else None


def _valor_em(ts, vs, t_alvo):
    """último frame <= t_alvo"""
    ult = None
    for t, v in zip(ts, vs):
        if t <= t_alvo + 1e-9:
            ult = v
        else:
            break
    return ult


def _cruzamento(ts, vs, limiar, t0, t1, sustenta=2):
    """primeiro t em [t0,t1] com vs>=limiar sustentado por `sustenta` frames"""
    idx = [i for i, t in enumerate(ts) if t0 - 1e-9 <= t <= t1 + 1e-9]
    for j, i in enumerate(idx):
        if all(vs[k] >= limiar for k in idx[j : j + sustenta]) and len(idx[j : j + sustenta]) == sustenta:
            return ts[i]
    return None


def _cruzamento_pos_queda(ts, vs, limiar, b0, t1, sustenta=2):
    """Cruzamento sustentado de `limiar` APÓS a última queda abaixo do limiar
    que precede b0 (evita contar sinal que já estava alto antes da cena).
    Retorna (t_cruzamento, ja_alto_antes)."""
    t_queda = None
    for t, v in zip(ts, vs):
        if t > b0 + 1e-9:
            break
        if v < limiar:
            t_queda = t
    if t_queda is None:
        return None, True  # nunca caiu abaixo antes do burst: sinal já alto
    tc = _cruzamento(ts, vs, limiar, t_queda, t1, sustenta)
    return tc, False


def onset_entrada_estrita(pacote, b0, b1):
    """Entrada ESTRITA do assistente durante o burst no par alimentado:
    primeiro t em [b0+0.05, b1] com >=150 ms ativos (>-50dB) precedidos de
    >=300 ms de silêncio. None se o assistente não ENTRA durante o burst."""
    import numpy as np

    cam = os.path.join(BASE_PACOTES, pacote, "canal-assistente.wav")
    de, ate = b0 - 0.5, b1 + 0.05
    x = ler_wav_seg(cam, de, ate)
    win = int(0.05 * SR)
    nwin = len(x) // win
    if nwin < 9:
        return None
    e = x[: nwin * win].reshape(nwin, win)
    db = 20 * np.log10(np.sqrt((e**2).mean(axis=1) + 1e-12) + 1e-12)
    ativo = db > LIMIAR_ASSIST_DB
    for k in range(6, nwin - 2):
        t_k = de + k * win / SR
        if t_k < b0 + 0.05 or t_k > b1:
            continue
        if ativo[k] and ativo[k + 1] and ativo[k + 2] and not any(ativo[k - 6 : k]):
            return round(t_k, 2)
    return None


def analisar():
    linhas = [json.loads(l) for l in open(ARQ_RESULTADOS)]
    por_modelo = {}
    for l in linhas:
        por_modelo.setdefault(l["modelo"], []).append(l)
    # gate estrito da célula 3, recalculado do áudio (cache por momento)
    entrada_estrita = {}
    for l in linhas:
        if l["celula"] == "assistente-entrou-sobre-usuario":
            ch = (l["pacote"], l["t"])
            if ch not in entrada_estrita:
                entrada_estrita[ch] = onset_entrada_estrita(l["pacote"], *l["burst"])
            l["cena"]["onset_assist_no_burst"] = entrada_estrita[ch]

    LIMIAR = 0.5
    met = {
        "limiar_padrao": LIMIAR,
        "nota_gate": (
            "GATE DE CENA: célula com premissa de sobreposição só é avaliada se o canal do "
            "assistente está ativo (>-50dB) durante o burst no PAR DE ÁUDIO ALIMENTADO. "
            "O leito v1 comparou bursts (eixo do wav) com eventos de reprodução (eixo iniciadoEm); "
            "o zero desses eixos difere por pacote (36ed +1,88s, a6c1 +17,16s, e2c0 -0,91s), "
            "então parte dos rótulos não corresponde a sobreposição física no par. "
            "Célula assistente-entrou exige entrada ESTRITA (silêncio >=300 ms antes de "
            "onset dentro do burst) no par alimentado."
        ),
        "modelos": {},
    }

    CELULAS_SOBREPOSICAO = (
        "backchannel-atravessado", "segurou-contra-piso", "cedeu-a-burst-curto",
        "interrupcao-atendida", "ack-substituido-por-conteudo",
    )

    def valido(l):
        c = l["celula"]
        if c in CELULAS_SOBREPOSICAO:
            return bool(l["cena"]["assist_ativo_burst"])
        if c == "assistente-entrou-sobre-usuario":
            return l["cena"]["onset_assist_no_burst"] is not None
        return True  # nao-causal: avaliado à parte sem gate

    for rotulo, ls in por_modelo.items():
        eh_bc = rotulo.startswith("vap_bc")
        cel, cel_ok = {}, {}
        for l in ls:
            cel.setdefault(l["celula"], []).append(l)
            if valido(l):
                cel_ok.setdefault(l["celula"], []).append(l)

        r = {
            "n_por_celula": {c: len(v) for c, v in sorted(cel.items())},
            "n_validos_no_par": {c: len(v) for c, v in sorted(cel_ok.items())},
            "cortados_por_cena": [
                {"pacote": l["pacote"][-4:], "t": l["t"], "celula": l["celula"],
                 "assist_db_burst": l["cena"]["assist_db_burst"]}
                for l in ls if not valido(l)
            ],
        }

        if not eh_bc:
            def feats(l, sinal="p_future_usuario"):
                ts, pf = _serie(l, sinal)
                b0, b1 = l["burst"]
                tc, ja_alto = _cruzamento_pos_queda(ts, pf, LIMIAR, b0, min(b1, b0 + 1.5))
                return {
                    "on500": _max_em(ts, pf, b0, b0 + 0.5),
                    "burst": _max_em(ts, pf, b0, b1),
                    "cruz": tc,
                    "ja_alto_antes": ja_alto,
                }

            # 1. segurou-contra-piso (o prêmio)
            seg = []
            for l in cel_ok.get("segurou-contra-piso", []):
                f5, fN = feats(l), feats(l, "p_now_usuario")
                seg.append({"pacote": l["pacote"][-4:], "t": l["t"],
                            "max_pfut_on500": f5["on500"], "max_pnow_on500": fN["on500"],
                            "burstDurS": l["burstDurS"]})
            r["segurou_contra_piso"] = {
                "n_valido": len(seg),
                "corrigiria@0.5_pfut_ate500ms": sum(1 for s in seg if (s["max_pfut_on500"] or 0) >= LIMIAR),
                "corrigiria@0.5_pnow_ate500ms": sum(1 for s in seg if (s["max_pnow_on500"] or 0) >= LIMIAR),
                "detalhe": seg,
            }

            # 2. backchannel-atravessado (não regredir)
            bca = []
            for l in cel_ok.get("backchannel-atravessado", []):
                f5, fN = feats(l), feats(l, "p_now_usuario")
                bca.append({"pacote": l["pacote"][-4:], "t": l["t"],
                            "max_pfut_burst": f5["burst"], "max_pfut_on500": f5["on500"],
                            "max_pnow_on500": fN["on500"], "burstDurS": l["burstDurS"]})
            r["backchannel_atravessado"] = {
                "n_valido": len(bca),
                "falso_shift@0.5_pfut_burst": sum(1 for s in bca if (s["max_pfut_burst"] or 0) >= LIMIAR),
                "falso_shift@0.5_pfut_on500": sum(1 for s in bca if (s["max_pfut_on500"] or 0) >= LIMIAR),
                "detalhe": bca,
            }

            # 3. assistente-entrou-sobre-usuario
            ent = []
            for l in cel_ok.get("assistente-entrou-sobre-usuario", []):
                ts, pf = _serie(l, "p_future_usuario")
                _, pn = _serie(l, "p_now_usuario")
                on = l["cena"]["onset_assist_no_burst"]
                ent.append({"pacote": l["pacote"][-4:], "t": l["t"], "onset_assist": on,
                            "pfut_no_onset": _valor_em(ts, pf, on),
                            "pnow_no_onset": _valor_em(ts, pn, on)})
            r["assistente_entrou_sobre_usuario"] = {
                "n_valido": len(ent),
                "diria_nao_entrar@0.5_pfut": sum(1 for e in ent if (e["pfut_no_onset"] or 0) >= LIMIAR),
                "detalhe": ent,
            }

            # 4. células raras: caso a caso
            raros = []
            for c in ("cedeu-a-burst-curto", "interrupcao-atendida", "ack-substituido-por-conteudo"):
                for l in cel_ok.get(c, []):
                    f5 = feats(l)
                    raros.append({"celula": c, "pacote": l["pacote"][-4:], "t": l["t"],
                                  "max_pfut_on500": f5["on500"], "max_pfut_burst": f5["burst"],
                                  "burstDurS": l["burstDurS"]})
            r["celulas_raras_caso_a_caso"] = raros

            # 5. antecipação (momentos válidos de tomada de piso)
            leads, ja_altos = [], 0
            for c in ("segurou-contra-piso", "interrupcao-atendida"):
                for l in cel_ok.get(c, []):
                    f5 = feats(l)
                    if f5["ja_alto_antes"]:
                        ja_altos += 1
                    elif f5["cruz"] is not None:
                        leads.append(round(f5["cruz"] - l["burst"][0], 2))
            leads.sort()
            r["antecipacao_s_rel_onset_burst"] = {
                "n_com_cruzamento": len(leads), "valores": leads, "ja_alto_antes_do_burst": ja_altos,
                "p50": leads[len(leads) // 2] if leads else None,
                "p90": leads[min(len(leads) - 1, int(len(leads) * 0.9))] if leads else None,
                "nota": ("cruzamento sustentado de 0,5 APÓS a última queda pré-burst; "
                         "negativo = antes do início físico do burst; "
                         "ja_alto = sinal nunca caiu abaixo de 0,5 antes do burst"),
            }

            # 6. matriz de confusão com limiar varrido (10x falso-continuar)
            def curva_de(sinal):
                pos, neg = [], []
                for c, alvo in (("segurou-contra-piso", pos), ("interrupcao-atendida", pos),
                                ("backchannel-atravessado", neg)):
                    for l in cel_ok.get(c, []):
                        ts, pf = _serie(l, sinal)
                        b0 = l["burst"][0]
                        mx = _max_em(ts, pf, b0, b0 + 0.5)
                        if mx is not None:
                            alvo.append(mx)
                curva = []
                for i in range(5, 100, 5):
                    th = i / 100
                    vp = sum(1 for v in pos if v >= th)
                    fp = sum(1 for v in neg if v >= th)
                    curva.append({"limiar": th, "VP": vp, "FN": len(pos) - vp, "FP": fp,
                                  "VN": len(neg) - fp, "custo_10xFN+FP": 10 * (len(pos) - vp) + fp})
                melhor = min(curva, key=lambda c: c["custo_10xFN+FP"]) if curva else None
                return {"n_pos": len(pos), "n_neg": len(neg), "curva": curva, "melhor_ponto": melhor}

            r["confusao_varrida_pfut"] = curva_de("p_future_usuario")
            r["confusao_varrida_pnow"] = curva_de("p_now_usuario")

            # 7. não-causais (conf 0,5) à parte
            nc = []
            for l in cel.get("sobreposicao-nao-causal", []):
                f5 = feats(l)
                if f5["on500"] is not None:
                    nc.append(round(f5["on500"], 3))
            nc.sort()
            r["nao_causal_a_parte"] = {
                "n": len(nc),
                "mediana_max_pfut_on500": nc[len(nc) // 2] if nc else None,
                "acima_0.5": sum(1 for v in nc if v >= 0.5),
            }
        else:
            resumo = {}
            for c, ls_c in sorted(cel_ok.items()):
                vals = []
                for l in ls_c:
                    ts, pd = _serie(l, "p_bc_detect")
                    b0, b1 = l["burst"]
                    v = _max_em(ts, pd, b0, min(b1 + 0.5, b0 + 2.0))
                    if v is not None:
                        vals.append(round(v, 3))
                vals.sort()
                resumo[c] = {"n": len(vals), "mediana": vals[len(vals) // 2] if vals else None,
                             "valores": vals}
            r["p_bc_detect_max_burst_por_celula_validos"] = resumo

        met["modelos"][rotulo] = r

    # baseline grátis: heurística duração-do-burst (>=1.2s = quer piso)
    leito = ler_leito()
    her = {"limiar_s": 1.2, "por_celula": {}}
    for m in leito:
        c = m["celula"]
        d = her["por_celula"].setdefault(c, {"n": 0, "burst>=1.2s": 0})
        d["n"] += 1
        if m.get("burstDurS", 0) >= 1.2:
            d["burst>=1.2s"] += 1
    her["nota"] = ("decide 'quer piso' quando o burst dura >=1.2s; latência de decisão = 1.2s. "
                   "No leito v1: acerta 14/14 segurou-contra-piso e 1/1 interrupcao-atendida, "
                   "0/17 falso-shift em backchannel-atravessado (nenhum bc chega a 1.2s).")
    met["heuristica_duracao_burst"] = her

    json.dump(met, open(ARQ_METRICAS, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(met, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("rodar", "analisar"):
        print(__doc__)
        sys.exit(2)
    if sys.argv[1] == "rodar":
        rodar()
    else:
        analisar()
