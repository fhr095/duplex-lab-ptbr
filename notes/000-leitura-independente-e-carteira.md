# Frente experimental independente — leitura inicial e carteira

Data: 2026-08-09 · Branch: `exp/caminho-ouro` · Base: `f1140d2` (main)

Modo: **exploração** (sem holdout, sem freeze, sem alegação confirmatória).

## Leitura independente da experiência executável

Medições próprias nesta máquina (worktree, servidor baseline, probes em
`probes/latency-probe.mjs` e `scripts/live-audio-probe.mjs`):

| Perna | Medida | Observação |
| --- | ---: | --- |
| Onset de fala (VAD Silero) | 23 ms | excelente |
| Fim de fala → endpoint | 603 ms | 520 ms exigidos + folga |
| Endpoint → final ASR publicada | 220 ms | prefinal especulativa já esconde o Parakeet; resta o commit grace |
| Cérebro mock → 1º delta | 1–5 ms | resposta enlatada |
| Cérebro real (gpt-5.6-luna, effort none) → 1º delta | 731–2.418 ms | mediana ~1–2 s; alta variância; perna dominante |
| TTS Maria (SAPI) por frase | 40–200 ms | rápido, porém robótico |
| Fala da Maria | ~11 chars/s | "Oi, tudo bem?" = 2,06 s de áudio; frase de 80 chars = 7,0 s |

Composição real (cérebro OpenAI): **fim de fala → primeira voz ≈ 2,0–3,4 s.**
Referência GPT-Live: ~0,5–0,8 s. Com cérebro mock: ~0,9–1,1 s (o "sub-1s"
histórico do lab vale só para o mock).

Arquitetura executável: navegador captura PCM → WS → VAD+ASR incremental
(whisper-tiny parcial, Parakeet final) + endpoint adaptativo por regex de
completude → cliente POSTa `/api/turn` (NDJSON) → frases → `/api/tts` (WAV
inteiro, prefetch por frase) → playback com ciclo de barge-in bem resolvido
(pausa evidence-gated, STOP no renderer ~40–180 ms, retomada ~300 ms).

**A composição é estritamente serial: endpoint → cérebro → TTS.** Nada
especula. O prefinal de ASR já existe e o cliente já recebe
`endpoint.prefinal.started` com texto provisório — a extensão natural é
especular também o cérebro (e a primeira frase de TTS) durante a janela de
silêncio, abortando se a fala retomar.

## Confronto com o histórico do lab

Onde concordo:
- Cascata modular promovida funciona ponta a ponta; micro-mecânica de
  interrupção/backchannel tem números bons.
- Microturnos fixos de 600 ms (EXP-0025-R) falharam por latência local; não
  reabrir tal qual.

Onde minha leitura diverge ou o histórico subestima:
1. **EXP-0019→0025: sete experimentos consumidos por falhas do instrumento**
   (CDP, healths, timestamps, cardinalidade), não por perguntas de produto.
   EXP-0026 (diagnóstico do gargalo percebido) morreu bloqueado por prontidão
   operacional. O processo passou a custar mais que o conhecimento — exatamente
   o alerta do mandato.
2. Do primeiro princípio, os três maiores tetos de experiência são visíveis sem
   6 sessões humanas: (a) tempo morto serial até a voz (2–3,4 s), (b) voz Maria
   2012 robótica e lenta, (c) cérebro mock nas demos locais. Nenhum deles tem
   frente ativa.
3. A decisão TTS ficou presa numa comparação injusta (Kokoro 461 ms vs Windows
   100 ms de *início* de síntese) ignorando taxa de fala, naturalidade e
   chunking por streaming.

## Carteira de hipóteses (exploração)

### H1 — Resposta especulativa ("branch prediction" conversacional) — ATIVA
- Pergunta: quanto do tempo morto dá para esconder especulando cérebro+TTS na
  janela pausa→final, com o texto provisório?
- Hipótese: fim de fala→voz cai de ~2–3,4 s para ~max(endpoint, TTFT do LLM) +
  TTS ≈ 1,2–1,6 s com luna; com cérebro local rápido, <900 ms. Taxa de acerto
  provisório≈final alta o bastante (>70%) para custo aceitável.
- Menor teste: challenger no cliente (app.mjs): especular `/api/turn` no
  prefinal, comparar com final normalizada; medir hit-rate e delta de latência
  no harness `live-audio-campaign` + pack existente.
- Muda: arquitetura da camada de interação (mecanismo proprietário,
  LLM-agnóstico). Custo: ~2× chamadas quando erra (mitigável).
- Decisão possível: virar o mecanismo central da camada rápida.

### H2 — Voz neural PT-BR com streaming por chunks — ATIVA
- Pergunta: uma voz neural local (Kokoro-82M pt-br int8; Piper como piso) muda
  a percepção de naturalidade sem estourar latência, considerando prefetch por
  frase + especulação de H1?
- Menor teste: worker Kokoro ONNX espelhando o contrato do worker Windows;
  medir TTFA real com chunking; A/B auditivo informal.
- Muda: decisão "TTS Windows provisório"; destrava demo apresentável.

### H3 — Endpoint semântico aprendido (contínuo, não microturno) — SONDAR
- Pergunta: um classificador leve de completude (partials PT-BR) reduz espera
  em finais verdadeiros (<520 ms) e tomadas prematuras em continuações
  (8/16 na baseline do EXP-0025-R) melhor que a regex atual?
- Candidatos: SoulX-Duplug 0.6B (plugável), Smart Turn v3 (verificar pt),
  classificador próprio sobre embeddings pequenos.
- Menor teste: rodar candidato pronto offline sobre os packs de continuação já
  materializados do lab; comparar curva espera×erro contra a regex.
- Aguarda: mapa SOTA dos agentes (em background).

### H4 — Referência nativa full-duplex como microscópio (GPU) — ADIADA ATÉ AUTORIZAÇÃO
- Pergunta: o que um nativo (MiniCPM-o 4.5 / Lychee-FD / Qwen3-Omni) faz com
  sobreposição/prosódia que a cascata não faz, e transfere para PT-BR?
- Requer RunPod (custo externo) → só com autorização explícita do Felipe.
  Histórico: 2 tentativas D-only bloquearam por ambiente; runner precisa do
  desenho EXTERNAL_CHALLENGER_RUNNER antes de nova tentativa.

### Micro-teste imediato — taxa de fala da Maria
- `/api/tts` aceita `rate`; cliente não envia. Rate 2–3 pode reduzir a
  sensação de lentidão a custo zero enquanto H2 não decide.

## Custo externo consumido nesta sessão
- ~10 chamadas gpt-5.6-luna (probe de latência, 160 tokens máx, cap 25/processo)
  ≈ US$ 0,001. RunPod: zero.
