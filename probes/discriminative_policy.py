#!/usr/bin/env python
"""Política discriminativa leve para a arbitragem (não-LLM).

Desenho honesto: treina APENAS em exemplos sintéticos gerados por templates;
testa no conjunto rotulado real (probes/data/fastpath-turns.pt-BR.json),
nunca visto no treino. Compara com o controle determinístico (83,7%).
Modelo: regressão logística multinomial sobre char n-grams hasheados +
features artesanais. Latência-alvo: <5ms CPU.
"""

import json
import re
import time
import unicodedata
from pathlib import Path

import numpy as np

RNG = np.random.default_rng(7)
LABELS = ["LOCAL_FINAL", "BRIDGE", "CLARIFY", "PASS"]

# ---------- geração sintética por templates (treino) ----------

GREET = ["oi", "olá", "e aí", "opa", "bom dia", "boa tarde", "boa noite",
         "eai", "salve"]
GREET_TAIL = ["", " tudo bem?", " tudo bom?", " beleza?", " como vai?",
              ", tudo certo?"]
THANK = ["obrigado", "obrigada", "muito obrigado", "valeu", "brigadão",
         "valeu demais", "obrigado viu", "agradecido"]
BYE = ["tchau", "até mais", "até logo", "falou", "até amanhã",
       "tchau tchau", "a gente se fala", "até a próxima"]
CLOCK = ["que horas são?", "que horas são agora?", "qual é a hora?",
         "me diz que horas são", "que hora é?", "que dia é hoje?",
         "qual é a data de hoje?", "que dia da semana é hoje?"]
VALUES = ["cem reais", "duzentos reais", "trezentos e cinquenta reais",
          "quinhentos reais", "mil reais", "R$ 250", "R$ 80",
          "quarenta reais"]
MARKER = ["na verdade", "quer dizer", "não,", "aliás", "melhor", "pensando bem"]
CONTENT_Q = ["qual é a capital da {x}?", "me explica o que é {x}",
             "como funciona {x}?", "quanto custa {x}?",
             "o que você acha de {x}?", "me ajuda com {x}",
             "resume {x} pra mim", "por que {x} acontece?",
             "quando abre {x}?", "onde fica {x}?"]
CONTENT_X = ["a poupança", "o CDI", "a França", "o contrato", "a reunião",
             "o pedido", "a fatura", "o boleto", "a entrega", "o plano"]
SHORT_PASS = ["espera", "aham", "entendi", "tá", "pera aí", "hum",
              "repete por favor", "fala de novo", "como assim?",
              "por quê?", "oi?", "alô?", "sério?", "que legal",
              "deixa pra lá", "cancela isso", "esquece"]
AMBIG = ["pode ser {a} ou {b}, tanto faz", "uns {a}, talvez {b}",
         "{a}... ou {b}, não sei"]

def synth():
    rows = []
    for greeting in GREET:
        for tail in GREET_TAIL:
            rows.append((f"{greeting}{tail}", "LOCAL_FINAL", False))
    for thank in THANK:
        rows.append((thank, "LOCAL_FINAL", False))
        rows.append((f"{thank}!", "LOCAL_FINAL", False))
    for bye in BYE:
        rows.append((bye, "LOCAL_FINAL", False))
    for clock in CLOCK:
        rows.append((clock, "LOCAL_FINAL", False))
    for marker in MARKER:
        for value in VALUES:
            rows.append((f"{marker} {value}", "BRIDGE", True))
            rows.append((f"{marker} {value}.", "BRIDGE", True))
    for template in AMBIG:
        for _ in range(4):
            first, second = RNG.choice(VALUES, 2, replace=False)
            rows.append((template.format(a=first, b=second),
                         "CLARIFY", True))
    for question in CONTENT_Q:
        for x in CONTENT_X:
            rows.append((question.format(x=x), "PASS", False))
    for short in SHORT_PASS:
        rows.append((short, "PASS", False))
    # saudação + conteúdo → PASS (a classe de armadilha)
    for greeting in GREET[:5]:
        for question in CONTENT_Q[:6]:
            rows.append((f"{greeting}, {question.format(x='o pedido')}",
                         "PASS", False))
    # marcador sem valor → PASS
    for marker in MARKER:
        rows.append((f"{marker} deixa quieto", "PASS", False))
        rows.append((f"{marker} me explica de novo", "PASS", False))
    return rows

# ---------- features ----------

DIM = 2048
AMOUNT_RE = re.compile(
    r"\d+|reais|real\b|r\$|cem|duzent|trezent|quatrocent|quinhent|mil\b",
    re.I)
MARKER_RE = re.compile(
    r"^(?:na verdade|quer dizer|não[, ]|aliás|melhor |pensando bem)", re.I)
GREET_RE = re.compile(
    r"\b(?:oi|olá|ola|bom dia|boa tarde|boa noite|e aí|eai|opa|salve)\b",
    re.I)
THANK_RE = re.compile(r"\b(?:obrigad|valeu|brigad|agradec)", re.I)
CLOCK_RE = re.compile(r"\bque (?:horas?|dia|data)\b", re.I)

def normalize(text):
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))

def featurize(text, context_has_amount):
    x = np.zeros(DIM + 8, dtype=np.float32)
    normalized = normalize(text)
    padded = f"^{normalized}$"
    for n in (2, 3, 4):
        for i in range(len(padded) - n + 1):
            x[hash(padded[i:i + n]) % DIM] += 1.0
    x[:DIM] /= max(1.0, np.linalg.norm(x[:DIM]))
    x[DIM + 0] = min(len(normalized), 80) / 80
    x[DIM + 1] = 1.0 if "?" in text else 0.0
    x[DIM + 2] = 1.0 if MARKER_RE.search(text) else 0.0
    x[DIM + 3] = 1.0 if AMOUNT_RE.search(text) else 0.0
    x[DIM + 4] = 1.0 if context_has_amount else 0.0
    x[DIM + 5] = 1.0 if GREET_RE.search(text) else 0.0
    x[DIM + 6] = 1.0 if THANK_RE.search(text) else 0.0
    x[DIM + 7] = 1.0 if CLOCK_RE.search(text) else 0.0
    return x

# ---------- treino (regressão logística multinomial, GD) ----------

train_rows = synth()
X = np.stack([featurize(t, c) for t, _, c in train_rows])
y = np.array([LABELS.index(l) for _, l, _ in train_rows])
print(f"treino sintético: {len(train_rows)} exemplos "
      f"({[ (l, int((y == i).sum())) for i, l in enumerate(LABELS) ]})")

W = np.zeros((X.shape[1], len(LABELS)), dtype=np.float32)
lr, reg = 0.5, 1e-4
for epoch in range(300):
    logits = X @ W
    logits -= logits.max(axis=1, keepdims=True)
    p = np.exp(logits)
    p /= p.sum(axis=1, keepdims=True)
    grad = X.T @ (p - np.eye(len(LABELS))[y]) / len(y) + reg * W
    W -= lr * grad

# ---------- avaliação no conjunto real (nunca visto) ----------

data = json.loads(Path(
    __file__).parent.joinpath("data/fastpath-turns.pt-BR.json").read_text())
turns = data["turns"]

def has_amount(text):
    return bool(AMOUNT_RE.search(text or ""))

correct, errors, times = 0, [], []
per = {l: {"tp": 0, "fp": 0, "fn": 0} for l in LABELS}
for item in turns:
    started = time.perf_counter()
    x = featurize(item["text"], has_amount(item.get("context")))
    scores = x @ W
    predicted = LABELS[int(scores.argmax())]
    times.append((time.perf_counter() - started) * 1000)
    truth = item["label"]
    if predicted == truth:
        correct += 1
        per[truth]["tp"] += 1
    else:
        per[truth]["fn"] += 1
        per[predicted]["fp"] += 1
        errors.append(f"«{item['text']}» {truth}→{predicted}")

print(f"\nteste no conjunto REAL (n={len(turns)}, nunca visto): "
      f"{correct}/{len(turns)} = {correct / len(turns) * 100:.1f}%")
for label in LABELS:
    tp, fp, fn = per[label]["tp"], per[label]["fp"], per[label]["fn"]
    precision = tp / (tp + fp) * 100 if tp + fp else float("nan")
    recall = tp / (tp + fn) * 100 if tp + fn else float("nan")
    print(f"  {label:11s} precisão={precision:5.1f}% recall={recall:5.1f}%")
print(f"latência por inferência: p50 "
      f"{sorted(times)[len(times) // 2]:.2f}ms")
print("\nerros:")
for error in errors:
    print(f"  {error}")
