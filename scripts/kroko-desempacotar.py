#!/usr/bin/env python3
"""Desempacota o contêiner .data do Kroko-ASR (Banafo).

Formato observado (engenharia reversa nos primeiros bytes):
  [u32 LE tamanho][bloco] repetido.
  Bloco 0 = JSON de metadados ({"type": "zipformer2", "language": ...}).
  Blocos seguintes = arquivos do modelo (ONNX protobuf / tokens texto).

Uso: python desempacotar_kroko.py <arquivo.data> <dir-saida>
"""
import json
import struct
import sys
from pathlib import Path

entrada = Path(sys.argv[1])
saida = Path(sys.argv[2])
saida.mkdir(parents=True, exist_ok=True)

blocos = []
with entrada.open("rb") as f:
    while True:
        cab = f.read(4)
        if len(cab) < 4:
            break
        (tam,) = struct.unpack("<I", cab)
        dados = f.read(tam)
        if len(dados) != tam:
            print(f"AVISO: bloco truncado (esperado {tam}, lido {len(dados)})")
        blocos.append(dados)

print(f"{len(blocos)} blocos no contêiner:")
meta = None
for i, b in enumerate(blocos):
    inicio = b[:24]
    if b.startswith(b"{"):
        tipo = "json"
        meta = json.loads(b.decode("utf-8"))
    elif b[:4] == b"\x08\x07\x12" or b"onnx" in b[:64] or b"ir_version" in b[:64]:
        tipo = "onnx?"
    else:
        try:
            b[:200].decode("utf-8")
            tipo = "texto"
        except UnicodeDecodeError:
            tipo = "binario"
    print(f"  bloco {i}: {len(b):>12} bytes  tipo={tipo}  inicio={inicio[:16]!r}")

if meta:
    print("metadados:", json.dumps(meta, ensure_ascii=False))
    (saida / "meta.json").write_bytes(blocos[0])

# Heurística de nomeação: entre os blocos não-JSON, o maior é o encoder,
# depois decoder > joiner (pelo tamanho típico: 155MB / 617kB / 337kB),
# e o bloco de texto pequeno são os tokens.
resto = [(i, b) for i, b in enumerate(blocos) if not b.startswith(b"{")]

def eh_texto(b: bytes) -> bool:
    try:
        b.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False

tokens = [(i, b) for i, b in resto if len(b) < 1_000_000 and eh_texto(b)]
onnx = sorted([(i, b) for i, b in resto if (i, b) not in tokens],
              key=lambda x: -len(x[1]))

nomes = ["encoder.onnx", "decoder.onnx", "joiner.onnx"]
for nome, (i, b) in zip(nomes, onnx):
    (saida / nome).write_bytes(b)
    print(f"gravado {nome} <- bloco {i} ({len(b)} bytes)")
if len(onnx) > len(nomes):
    for k, (i, b) in enumerate(onnx[len(nomes):]):
        (saida / f"extra_{i}.bin").write_bytes(b)
        print(f"gravado extra_{i}.bin ({len(b)} bytes)")
for i, b in tokens:
    (saida / "tokens.txt").write_bytes(b)
    print(f"gravado tokens.txt <- bloco {i} ({len(b)} bytes)")
    print("primeiras linhas de tokens.txt:")
    for ln in b.decode("utf-8").splitlines()[:8]:
        print("   ", ln)
