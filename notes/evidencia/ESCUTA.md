# Guia de escuta (15 min, fones)

Tudo relativo a `notes/` desta branch. Anote impressões livres; nada é gate.

## 1. Vozes candidatas do challenger (mesmas frases)
`notes/audicao/`:
- `pocket-rafael-*.wav` — a voz atual do challenger. **Pergunta: o sotaque
  serve para produto BR?**
- `piper-faber-*.wav` — o piso rápido. Suportável como fallback?
- `kokoro-*.wav` — só registro (cortado por lentidão).
- Compare com a Maria do Windows abrindo o demo baseline.

## 2. O teto comercial em PT-BR
`notes/evidencia/realtime-v2/gpt-realtime-2.1-mini-server/latencia-rep0.wav`
e `.../gpt-realtime-2.1-semantic/latencia-rep0.wav` — as respostas do
Realtime às MESMAS falas do nosso protocolo. **Pergunta: quanto a
prosódia/naturalidade deles está acima do Pocket?** (a distância que
sobra depois da latência, que já está pareada).

## 3. O mecanismo nativo
`notes/evidencia/moshi/gpu-reply-en.wav` — Moshi em inglês: repare o
engate quase instantâneo e a sobreposição natural. É ISSO que o programa
de dados nativo compraria em PT-BR.
`notes/evidencia/moshi/gpu-reply.wav` — o mesmo modelo com entrada PT:
o silêncio/aleatoriedade é a ausência de idioma, não de mecanismo.

## 4. Demo interativo (opcional, +10 min)
`notes/DEMO.md` — challenger completo vs baseline no navegador.
