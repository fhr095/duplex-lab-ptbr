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

## Ciclo 1 — evidência colhida (2026-08-09)

### H1 (resposta especulativa) — TESTADA, mecanismo implementado
- Implementação: stages `speculative`/`commit` no `/api/turn` (kernel puro não
  avança na especulação; commit idempotente por turnId), evento novo
  `endpoint.prefinal.text` quando o Parakeet preparado resolve, módulo
  `web/speculative-turn.mjs`, probe `probes/speculation-probe.mjs`.
- **Estágio 1 (texto provisório) morreu: 0/15 hits.** Parciais atrasam um
  passo (~320ms) e perdem sistematicamente a cauda da fala; `base` no lugar de
  `tiny` não resolve e ainda atrasa o gatilho do preparado. Redundante com o
  estágio 2 por construção.
- **Estágio 2 (final preparada) funciona: 10/15 hits, lead 40–290ms**, teto
  estrutural = silêncio 520 + grace 220 − inferência Parakeet. Merges são miss
  correto (resposta deve ser regerada). Manter `tiny` nos parciais.
- Com luna (N=5), a variância do TTFT (±800ms) engole o efeito em A/B direto;
  a métrica certa é hit-rate × lead (determinística).
- Decisão: **manter como componente** (esconde o grace + ASR final), não como
  lever principal. Integrar no cliente para o demo.

### H3 (endpoint aprendido) — SONDADA, drop-in reprovado
- Smart Turn v3.2 (PT incluído, 8MB, BSD-2, ~105ms de inferência nesta CPU):
  - No pack EXP-0025-R dev: **os pares têm áudio idêntico até o boundary**
    (p iguais aos pares) — o pack mede paciência/recuperação, não predição;
    nenhum detector poderia separar. Insight sobre o instrumento, não o modelo.
  - Em fala real (CORAA, 18 pontos de decisão): **acc 61%, AUC 0.60** —
    completos 10/11, incompletos 1/7. Diz "completo" em quase toda pausa
    interna espontânea. Rótulos ruidosos (monólogo≠diálogo), mas inviabiliza
    encurtar o silêncio de 520ms com ele hoje.
- Decisão: drop-in **cortado**; rota re-priorizada para **detector PT-BR
  próprio** (finetune do Smart Turn com dado conversacional PT-BR — receita e
  treino abertos; não existe modelo nem corpus público de turno PT-BR → o dado
  é o fosso). Trilha média, não quick win.

### Integração do mapa SOTA (3 relatórios em notes/research/)
- **Não existe full-duplex nativo aberto que fale PT-BR** (ago/2026) — a
  janela de diferenciação está aberta. Nova 2 Sonic (fechado) prova que o alvo
  é alcançável.
- Trilha nativa de referência: PersonaPlex-7B (licença comercial NVIDIA,
  interrupção 100%, ~205ms; base Moshi) + receita de adaptação de idioma
  provada 2× (J-Moshi/ja, Human-1/hi com 26k h estéreo). Microscópio futuro em
  GPU (H4, aguarda autorização).
- Trilha de produto imediata: **DuplexCascade-em-PT** (MIT, microturnos com
  tokens de controle, LLM intercambiável) + **Pocket TTS Kyutai (100M, CPU,
  fala PT desde mai/2026)**. O buraco PT da cascata Kyutai é só o STT — que
  nós já temos (Parakeet/whisper).
- TTS: CPU → Kokoro-82M (3 vozes pt-br, Apache-2.0, RTF ~0.5 4-core) e
  Supertonic 3 (mais rápido, menos natural); GPU → Chatterbox Multilingual v3
  com pack pt-br dedicado (MIT) e Qwen3-TTS (Apache, streaming ~97ms).
  F5-pt-br e Voxtral são CC-BY-NC (fora p/ comercial); Orpheus/CosyVoice sem pt.
- Turn-taking: padrão da indústria = VAD + confirmador aprendido com timeout
  base ~200-300ms; LiveKit detector tem licença restrita; VAP PT-BR é a rota
  de teto alto (falta corpus diádico PT-BR público — oportunidade).

### Leitura recomposta do caminho de ouro (após evidência)
O tempo morto real com cérebro externo é dominado por TTFT 0,7–2,4s + piso
740ms. Ordem de ataque revista:
1. **Perna do cérebro**: fast-path local para turnos curtos/fáticos + ack
   falado imediato quando TTFT estoura (~talker-reasoner), mantendo luna/sol
   para conteúdo — é a tese DuplexCascade e nossa camada proprietária.
2. **Voz**: Kokoro pt-br / Pocket TTS PT no lugar da Maria (CPU ok) com
   chunking por frase; rate como paliativo imediato.
3. **H1-estágio 2** integrado (esconde grace+ASR; já implementado).
4. **Detector de turno PT-BR próprio** (dados + finetune) — trilha média.
5. **Referência nativa em GPU** (H4) — só com autorização de custo.

## Ciclo 2 — voz neural + challenger integrado (2026-08-09, tarde)

### Hardware real desta máquina (fato novo importante)
Ryzen 5 7430U, **7–8 GB de RAM visível no WSL, sem GPU** — abaixo do piso de
16 GB do produto. Tudo que rodar aqui roda no cliente final.

### H2 (voz) — probes concluídos nesta CPU
- **Kokoro-82M int8: RTF 1,6–2,3 → CORTADO nesta máquina** (benchmarks de
  referência com RTF ~0,5 não se reproduzem neste hardware).
- **Pocket TTS Kyutai `portuguese_24l` quantizado: RTF ~0,35 quente, TTFB
  ~2ms (streaming HTTP real), "Aham, entendi." em 181ms** — voz de qualidade
  viável em CPU; é preview não-destilado (o final tende a melhorar). Voz
  "rafael"; sotaque PT-BR a confirmar de ouvido.
- **Piper faber/edresson: 1º chunk 34–64ms, RTF 0,04–0,07** — piso garantido;
  prosódia sintética. Licenças: piper código GPL-3.0 (uso server-side ok),
  vozes com cards próprios; Pocket pesos CC-BY-4.0 (verificar atribuição).
- Amostras para audição em `notes/audicao/*.wav`.

### Challenger integrado (servidor + cliente)
- `TTS_PROVIDER=windows|pocket|piper` no serve.mjs com pass-through de
  streaming dos sidecars; health adaptado; 889/889 testes passam.
- Cliente: `?spec=1` adota stream especulado quando a final confirma a
  preparada (commit idempotente no kernel antes de adotar); `?ack=1` fala
  "Hum..." quando TTFT >700ms; higiene de especulação órfã em
  rejected/cancelled/final-vazia (gap conhecido: branches de backchannel
  dismiss não abortam — inócuo, substituída no próximo prefinal).
- Guia completo do A/B humano em `notes/DEMO.md`.

## Custo externo consumido (sessão 2026-08-09)
- ~24 chamadas gpt-5.6-luna (probes de latência e especulação; caps do repo
  respeitados) ≈ US$ 0,005. RunPod: zero.
