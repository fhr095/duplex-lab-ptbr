# Demo A/B — baseline vs challenger (frente exp/caminho-ouro)

Tudo roda a partir da worktree:
`cd /home/Felipe/work/duplex-lab-ptbr/.claude/worktrees/frente-caminho-ouro`

## 1. Sidecars de voz (uma vez, em terminais separados)

```bash
# Voz de qualidade (Pocket TTS Kyutai, PT, streaming, ~RTF 0.35 quente)
.venv-probe/bin/pocket-tts serve --host 127.0.0.1 --port 8321 \
  --language portuguese --quantize

# Piso de latência (Piper faber, primeiro chunk ~40ms)
.venv-piper/bin/python -m piper.http_server --host 127.0.0.1 --port 8331 \
  -m /tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models/pt_BR-faber-medium.onnx \
  --length-scale 0.85
```

O Pocket demora ~1–2 min para carregar; o primeiro request aquece (~10s) e
depois fica rápido. Se a máquina estiver com pouca RAM, rode só um dos dois.

## 2. Servidor

Atenção: `npm start` fixa `BRAIN_PROVIDER=local` dentro do script — para o
cérebro real use o comando explícito:

```bash
BASE="VAD_CONTROL=silero VAD_SHADOW=silero SILERO_VAD_THRESHOLD=0.85 SILERO_VAD_ONSET_WINDOWS=1"

# BASELINE (voz Maria + cérebro real)
env $BASE BRAIN_PROVIDER=openai node src/cli/serve.mjs

# CHALLENGER (voz Pocket + cérebro real)  ← já deixei este rodando
env $BASE TTS_PROVIDER=pocket BRAIN_PROVIDER=openai \
  OPENAI_MAX_REQUESTS_PER_PROCESS=60 node src/cli/serve.mjs

# CHALLENGER voz rápida (Piper)
env $BASE TTS_PROVIDER=piper BRAIN_PROVIDER=openai node src/cli/serve.mjs
```

## 3. Navegador (Chrome no Windows)

- Baseline pura: `http://localhost:4173/`
- Challenger completo: `http://localhost:4173/?spec=1&ack=1`
  - `spec=1` — resposta especulativa: o cérebro começa a responder durante a
    janela de silêncio, usando a final preparada do ASR; se a final confirmar,
    a resposta já está pronta (log `speculation.adopted · lead Nms`).
  - `ack=1` — se o cérebro demorar >700ms sem falar, solta um "Hum..." curto.

A métrica fim→voz aparece no painel (e no log `assistant.response.audible`).

## 4. Roteiro de escuta (2–3 min por condição)

1. "Oi, tudo bem?" — resposta curta; sinta o tempo morto.
2. "Que horas são agora em Brasília?" — resposta direta.
3. "Me explica rapidinho o que é juros compostos." — resposta média; interrompa
   no meio com "espera, mais simples" — o corte deve ser <200ms.
4. "Transfere trezentos e cinquenta reais... não, na verdade quatrocentos." —
   correção crítica; deve pedir confirmação do valor.
5. "Pesquisa quais são as três melhores opções de CDB." — delegação; continue
   conversando enquanto ela "trabalha".
6. Fale com hesitação: "Eu queria saber se... hum... se dá pra mudar o horário"
   — não deve cortar sua fala no "hum".

## 5. O que comparar (anote de ouvido)

- Tempo entre você terminar e a voz começar (alvo: challenger perceptivelmente
  mais rápido quando o log mostrar `speculation.adopted`).
- Naturalidade da voz: Maria vs rafael (Pocket) vs faber (Piper).
  Amostras isoladas para ouvir sem rodar nada: `notes/audicao/*.wav`
  (kokoro-* estão aí só para registro — reprovado por lentidão nesta máquina).
- O sotaque do rafael é PT-BR aceitável? (dúvida aberta — decisão é sua)
- O "Hum..." do ack=1 ajuda ou irrita?

## Números já medidos nesta máquina (8GB RAM, Ryzen 5 7430U, sem GPU)

| Componente | Métrica |
| --- | --- |
| Pocket TTS PT quente | TTFB ~2ms (streaming), "Aham, entendi." em 181ms, RTF ~0,35 |
| Piper faber | 1º chunk 34–64ms, RTF 0,06 |
| Kokoro int8 | RTF 1,6–2,3 → cortado nesta CPU |
| Maria (SAPI) | síntese 40–200ms, fala lenta (~11 chars/s), robótica |
| Especulação (servidor) | 10/15 adoções, lead 40–290ms |
| luna TTFT | 0,7–2,4s (variância alta) — ack=1 existe por causa disso |
