#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Bancada CENA ACÚSTICA: tagger sherpa-onnx (AudioSet, int8 ~26MB) × métrica grátis
(razão graves/voz + flatness espectral) nas janelas adversariais reais.

Leito:
  ADVERSAS (rótulo=1): janelas da a6c1 com música confirmada (errata) +
    fatias de música pura perto do mic (fora-do-corpus e2c0 mic-3).
  LIMPAS  (rótulo=0): janelas de fala normal de 3 pacotes vivos recentes,
    selecionadas por energia (fala real, cheque de dBFS por janela).

Por janela rotulada: fatias de 4 s, passo 2 s. Para cada fatia:
  (a) métrica grátis  — FFT com hanning por quadro de 1 s, espectro médio da
      fatia, razão de médias por banda (60–250 Hz / 300–3000 Hz), flatness
      espectral geo/arit (60–8000 Hz)  [reimplementação do protótipo da errata a6c1]
  (b) tagger          — top-k classes AudioSet + prob de "Music" e "Speech"

Métricas: AUC adversa×limpa por janela (mediana das fatias) e por fatia;
latência por fatia e RAM (VmRSS) de cada método NESTA CPU, 1 thread.

Uso:
  nice -n 10 .venv-teste-kroko/bin/python var/observador/testes/cena/harness_cena.py

Saídas (no diretório deste arquivo):
  resultados.jsonl  — 1 linha por fatia, 1 por janela, 1 meta final
"""

import os

# 1 thread antes de qualquer runtime carregar
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
           "NUMEXPR_NUM_THREADS", "ORT_NUM_THREADS"):
    os.environ[_v] = "1"

import json
import math
import time
import wave
import platform
import statistics as st

import numpy as np

RAIZ = "/home/Felipe/work/duplex-lab-ptbr/.claude/worktrees/frente-caminho-ouro"
OBS = os.path.join(RAIZ, "var/observador")
AQUI = os.path.dirname(os.path.abspath(__file__))
MODELO_DIR = os.path.join(AQUI, "modelo/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15")
MODELO_INT8 = os.path.join(MODELO_DIR, "model.int8.onnx")
ROTULOS_CSV = os.path.join(MODELO_DIR, "class_labels_indices.csv")
SAIDA = os.path.join(AQUI, "resultados.jsonl")

SR = 16000
FATIA_S = 4.0
PASSO_S = 2.0

# ---------------------------------------------------------------- leitura de áudio

def ler_wav_trecho(caminho, ini_s, fim_s):
    """Lê trecho [ini_s, fim_s) de WAV 16 kHz mono PCM16 -> float32 [-1, 1]."""
    w = wave.open(caminho, "rb")
    assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2, caminho
    ini = int(ini_s * SR)
    n = int((fim_s - ini_s) * SR)
    w.setpos(ini)
    dados = w.readframes(n)
    w.close()
    return np.frombuffer(dados, dtype=np.int16).astype(np.float32) / 32768.0


def ler_raw_trecho(caminho, ini_s, fim_s):
    """Lê trecho de RAW 16 kHz PCM16 headerless -> float32 [-1, 1]."""
    ini_b = int(ini_s * SR) * 2
    n_b = int((fim_s - ini_s) * SR) * 2
    with open(caminho, "rb") as fh:
        fh.seek(ini_b)
        dados = fh.read(n_b)
    return np.frombuffer(dados, dtype=np.int16).astype(np.float32) / 32768.0


def dbfs(x):
    rms = float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0
    return -120.0 if rms <= 0 else 20.0 * math.log10(rms)

# ---------------------------------------------------------------- métrica grátis
# Reimplementação do protótipo da errata a6c1: FFT com hanning (quadros de 1 s),
# razão de médias por banda, flatness geométrica/aritmética.

QUADRO = SR  # 1 s
_JANELA_HANN = np.hanning(QUADRO)
_FREQS = np.fft.rfftfreq(QUADRO, d=1.0 / SR)
_B_GRAVES = (_FREQS >= 60) & (_FREQS <= 250)
_B_VOZ = (_FREQS >= 300) & (_FREQS <= 3000)
_B_FLAT = (_FREQS >= 60) & (_FREQS <= 8000)


def metrica_gratis(x):
    """x: float32 da fatia (>=1 s). Retorna (razao_graves_voz, flatness)."""
    nq = len(x) // QUADRO
    if nq == 0:
        return 0.0, 1.0
    esp = np.zeros(len(_FREQS))
    for i in range(nq):
        q = x[i * QUADRO:(i + 1) * QUADRO] * _JANELA_HANN
        esp += np.abs(np.fft.rfft(q)) ** 2
    esp /= nq
    graves = float(np.mean(esp[_B_GRAVES]))
    voz = float(np.mean(esp[_B_VOZ]))
    razao = graves / voz if voz > 0 else 0.0
    s = esp[_B_FLAT] + 1e-20
    flatness = float(np.exp(np.mean(np.log(s))) / np.mean(s))
    return razao, flatness

# ---------------------------------------------------------------- seleção de janelas

def selecionar_janelas_fala(caminho, ini_s, fim_s, quantas, dur_s=12.0, piso_dbfs=-40.0):
    """Seleciona janelas de fala real por energia: maior fração de segundos
    acima do piso; janelas não sobrepostas dentro da região."""
    x = ler_wav_trecho(caminho, ini_s, fim_s)
    nseg = len(x) // SR
    db_seg = np.array([dbfs(x[i * SR:(i + 1) * SR]) for i in range(nseg)])
    dur = int(dur_s)
    cand = []
    for i in range(0, nseg - dur):
        bloco = db_seg[i:i + dur]
        fracao = float(np.mean(bloco > piso_dbfs))
        cand.append((fracao, float(np.mean(bloco)), i))
    cand.sort(key=lambda c: (-c[0], -c[1]))
    escolhidas, usados = [], []
    for fracao, media, i in cand:
        if any(not (i + dur <= u0 or i >= u1) for u0, u1 in usados):
            continue
        escolhidas.append((ini_s + i, ini_s + i + dur, fracao, media))
        usados.append((i, i + dur))
        if len(escolhidas) == quantas:
            break
    escolhidas.sort()
    return escolhidas


def selecionar_janelas_raw(caminho, quantas=7, dur_s=10.0, piso_dbfs=-45.0):
    """Fatias espalhadas do RAW de música pura (checa energia p/ evitar silêncio)."""
    total_s = os.path.getsize(caminho) // 2 / SR
    alvos = np.linspace(30, total_s - dur_s - 30, quantas)
    janelas = []
    for a in alvos:
        ini = float(a)
        for tent in range(6):  # desloca +15 s se cair em trecho silencioso
            x = ler_raw_trecho(caminho, ini, ini + dur_s)
            m = dbfs(x)
            if m > piso_dbfs:
                break
            ini += 15.0
        janelas.append((ini, ini + dur_s, m))
    return janelas

# ---------------------------------------------------------------- medição

def vm_rss_mb():
    with open("/proc/self/status") as fh:
        for linha in fh:
            if linha.startswith("VmRSS"):
                return round(int(linha.split()[1]) / 1024.0, 1)
    return -1.0


def fatiar(ini_s, fim_s):
    fatias = []
    t = ini_s
    while t + FATIA_S <= fim_s + 1e-9:
        fatias.append((t, t + FATIA_S))
        t += PASSO_S
    if not fatias:  # janela menor que a fatia: usa a janela inteira
        fatias = [(ini_s, fim_s)]
    return fatias


def auc(pos, neg):
    """AUC = P(score_adversa > score_limpa), empates = 0,5 (Mann-Whitney)."""
    if not pos or not neg:
        return float("nan")
    maiores = sum(1 for p in pos for n in neg if p > n)
    empates = sum(1 for p in pos for n in neg if p == n)
    return (maiores + 0.5 * empates) / (len(pos) * len(neg))


def principal():
    print("RSS base (numpy carregado):", vm_rss_mb(), "MB", flush=True)
    rss_base = vm_rss_mb()

    # ---- leito -------------------------------------------------------------
    a6c1 = os.path.join(OBS, "2026-08-15-21-50-40-a6c1/canal-usuario.wav")
    mic3 = os.path.join(RAIZ, "var/fora-do-corpus/2026-08-16-e2c0-mic3/mic-3.raw")
    e2c0 = os.path.join(OBS, "2026-08-16-14-41-30-e2c0/canal-usuario.wav")
    p685b = os.path.join(OBS, "2026-08-16-18-33-30-685b/canal-usuario.wav")
    p36ed = os.path.join(OBS, "2026-08-15-15-23-40-36ed/canal-usuario.wav")

    janelas = []  # (fonte, tipo_de_leitura, ini, fim, rotulo, nota)

    # ADVERSAS — a6c1, música confirmada pela errata (turnos vazio/alucinado)
    for ini, fim, nota in [
        (11763.0, 11777.0, "a6c1 turno-1 vazio + turno-2 'meu avô'"),
        (11772.0, 11776.5, "a6c1 fatia exata do 'meu avô' (curto+confiante)"),
        (11789.0, 11801.5, "a6c1 turno-3 vazio 11,2s"),
        (11814.0, 11820.5, "a6c1 turno-6 vazio 5,9s"),
    ]:
        janelas.append(("a6c1", a6c1, "wav", ini, fim, 1, nota))

    # ADVERSAS — música pura perto do mic (rótulo forte)
    for ini, fim, m in selecionar_janelas_raw(mic3, quantas=7, dur_s=10.0):
        janelas.append(("mic3", mic3, "raw", ini, fim, 1, f"música pura perto do mic ({m:.1f} dBFS)"))

    # LIMPAS — fala normal, selecionada por energia
    for cam, ini, fim, quantas, nome in [
        (e2c0, 3060.0, 3290.0, 4, "e2c0"),
        (p685b, 7086.0, 7283.0, 4, "685b"),
        (p36ed, 170.0, 290.0, 3, "36ed"),
    ]:
        for i0, i1, fracao, media in selecionar_janelas_fala(cam, ini, fim, quantas):
            janelas.append((nome, cam, "wav", i0, i1, 0,
                            f"fala real ({fracao*100:.0f}% seg > -40 dBFS, média {media:.1f} dBFS)"))

    # ---- tagger ------------------------------------------------------------
    import sherpa_onnx
    t0 = time.perf_counter()
    cfg = sherpa_onnx.AudioTaggingConfig(
        model=sherpa_onnx.AudioTaggingModelConfig(
            zipformer=sherpa_onnx.OfflineZipformerAudioTaggingModelConfig(model=MODELO_INT8),
            num_threads=1,
            provider="cpu",
        ),
        labels=ROTULOS_CSV,
        top_k=5,
    )
    tagger = sherpa_onnx.AudioTagging(cfg)
    carga_ms = (time.perf_counter() - t0) * 1000
    rss_pos_carga = vm_rss_mb()
    print(f"tagger carregado em {carga_ms:.0f} ms; RSS {rss_pos_carga} MB "
          f"(Δ carga {rss_pos_carga - rss_base:+.1f} MB)", flush=True)

    def rodar_tagger(x):
        s = tagger.create_stream()
        s.accept_waveform(SR, x)
        eventos = tagger.compute(s, top_k=527)  # todas as classes p/ achar Music/Speech
        music = speech = 0.0
        for e in eventos:
            if e.name == "Music":
                music = float(e.prob)
            elif e.name == "Speech":
                speech = float(e.prob)
        top5 = [(e.name, round(float(e.prob), 3)) for e in eventos[:5]]
        return music, speech, top5

    # aquecimento (fora da medição)
    rodar_tagger(np.zeros(SR * 4, dtype=np.float32))
    rss_pos_aquecer = vm_rss_mb()

    # ---- varredura ---------------------------------------------------------
    linhas = []
    por_janela = []
    lat_gratis, lat_tagger = [], []

    for nome, cam, tipo, ini, fim, rotulo, nota in janelas:
        razoes, flats, musics, speechs = [], [], [], []
        dbs = []
        for f0, f1 in fatiar(ini, fim):
            x = (ler_wav_trecho if tipo == "wav" else ler_raw_trecho)(cam, f0, f1)
            db = dbfs(x)

            t0 = time.perf_counter()
            razao, flat = metrica_gratis(x)
            ms_gratis = (time.perf_counter() - t0) * 1000

            t0 = time.perf_counter()
            music, speech, top5 = rodar_tagger(x)
            ms_tagger = (time.perf_counter() - t0) * 1000

            lat_gratis.append(ms_gratis)
            lat_tagger.append(ms_tagger)
            razoes.append(razao); flats.append(flat)
            musics.append(music); speechs.append(speech)
            dbs.append(db)
            linhas.append({
                "tipo": "fatia", "fonte": nome, "rotulo": rotulo,
                "ini_s": round(f0, 1), "fim_s": round(f1, 1), "dbfs": round(db, 1),
                "graves_voz": round(razao, 3), "flatness": round(flat, 4),
                "tagger_music": round(music, 4), "tagger_speech": round(speech, 4),
                "tagger_top5": top5,
                "ms_gratis": round(ms_gratis, 2), "ms_tagger": round(ms_tagger, 1),
            })

        por_janela.append({
            "tipo": "janela", "fonte": nome, "rotulo": rotulo, "nota": nota,
            "ini_s": round(ini, 1), "fim_s": round(fim, 1),
            "dbfs_medio": round(float(np.mean(dbs)), 1),
            "n_fatias": len(razoes),
            "graves_voz_med": round(float(np.median(razoes)), 3),
            "graves_voz_max": round(max(razoes), 3),
            "flatness_med": round(float(np.median(flats)), 4),
            "tagger_music_med": round(float(np.median(musics)), 4),
            "tagger_music_max": round(max(musics), 4),
            "tagger_speech_med": round(float(np.median(speechs)), 4),
        })
        print(f"[{('ADVERSA' if rotulo else 'limpa '):7s}] {nome:5s} {ini:8.1f}-{fim:8.1f}s "
              f"dB {por_janela[-1]['dbfs_medio']:6.1f} razão_med {por_janela[-1]['graves_voz_med']:7.3f} "
              f"music_med {por_janela[-1]['tagger_music_med']:6.3f} "
              f"speech_med {por_janela[-1]['tagger_speech_med']:6.3f}", flush=True)

    rss_final = vm_rss_mb()

    # ---- AUCs --------------------------------------------------------------
    def scores(chave, rot):
        return [j[chave] for j in por_janela if j["rotulo"] == rot]

    auc_jan = {
        "gratis_razao_med": auc(scores("graves_voz_med", 1), scores("graves_voz_med", 0)),
        "gratis_razao_max": auc(scores("graves_voz_max", 1), scores("graves_voz_max", 0)),
        "tagger_music_med": auc(scores("tagger_music_med", 1), scores("tagger_music_med", 0)),
        "tagger_music_max": auc(scores("tagger_music_max", 1), scores("tagger_music_max", 0)),
    }
    fat = [l for l in linhas if l["tipo"] == "fatia"]
    auc_fat = {
        "gratis_razao": auc([f["graves_voz"] for f in fat if f["rotulo"] == 1],
                            [f["graves_voz"] for f in fat if f["rotulo"] == 0]),
        "tagger_music": auc([f["tagger_music"] for f in fat if f["rotulo"] == 1],
                            [f["tagger_music"] for f in fat if f["rotulo"] == 0]),
    }

    # combinação simples (OR com limiares): limiar = máx. das LIMPAS + margem
    # (FPR = 0 no leito), sensibilidade reportada nas ADVERSAS
    lim_razao = max(scores("graves_voz_med", 0)) * 1.10
    lim_music = min(0.5, max(scores("tagger_music_med", 0)) + 0.05)
    adversas = [j for j in por_janela if j["rotulo"] == 1]
    limpas = [j for j in por_janela if j["rotulo"] == 0]

    def or_decide(j):
        return (j["graves_voz_med"] >= lim_razao) or (j["tagger_music_med"] >= lim_music)

    comb = {
        "limiar_razao": round(lim_razao, 3),
        "limiar_music": round(lim_music, 3),
        "tpr_or": round(sum(or_decide(j) for j in adversas) / len(adversas), 3),
        "fpr_or": round(sum(or_decide(j) for j in limpas) / len(limpas), 3),
        "tpr_so_razao": round(sum(j["graves_voz_med"] >= lim_razao for j in adversas) / len(adversas), 3),
        "tpr_so_music": round(sum(j["tagger_music_med"] >= lim_music for j in adversas) / len(adversas), 3),
    }

    meta = {
        "tipo": "meta",
        "data": time.strftime("%Y-%m-%d %H:%M:%S"),
        "cpu": platform.processor() or platform.machine(),
        "threads": 1,
        "modelo": os.path.relpath(MODELO_INT8, AQUI),
        "modelo_bytes": os.path.getsize(MODELO_INT8),
        "licenca_modelo": "apache-2.0 (card do modelo, README.md do tarball)",
        "n_janelas_adversas": len(adversas),
        "n_janelas_limpas": len(limpas),
        "n_fatias": len(fat),
        "auc_janela": {k: round(v, 3) for k, v in auc_jan.items()},
        "auc_fatia": {k: round(v, 3) for k, v in auc_fat.items()},
        "combinacao_or": comb,
        "latencia_ms": {
            "gratis_med": round(st.median(lat_gratis), 2),
            "gratis_p95": round(float(np.percentile(lat_gratis, 95)), 2),
            "tagger_med": round(st.median(lat_tagger), 1),
            "tagger_p95": round(float(np.percentile(lat_tagger, 95)), 1),
            "tagger_carga_ms": round(carga_ms, 0),
        },
        "rtf_fatia_4s": {
            "gratis": round(st.median(lat_gratis) / 4000.0, 5),
            "tagger": round(st.median(lat_tagger) / 4000.0, 4),
        },
        "ram_mb": {
            "rss_base_numpy": rss_base,
            "rss_apos_carga_tagger": rss_pos_carga,
            "rss_apos_aquecer": rss_pos_aquecer,
            "rss_final": rss_final,
            "delta_tagger": round(rss_pos_aquecer - rss_base, 1),
        },
    }

    with open(SAIDA, "w") as fh:
        for l in linhas + por_janela + [meta]:
            fh.write(json.dumps(l, ensure_ascii=False) + "\n")

    print(json.dumps(meta, indent=2, ensure_ascii=False))
    print("resultados em", SAIDA)


if __name__ == "__main__":
    principal()
