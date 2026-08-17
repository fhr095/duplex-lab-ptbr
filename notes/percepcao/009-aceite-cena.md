# 009 — Aceite da ação de cena (2026-08-17)

A ação especificada em 008 está integrada na engine (linha obs,
commit 2a20fdb) e o aceite foi executado. Registro dos números; o log
detalhado (com transcrições) fica local em
`var/observador/testes/cena/ACEITE-2026-08-17.md`.

## O que entrou na engine

- Worker persistente do tagger (`scripts/cena-tagger-worker.py`, mesmo
  protocolo JSONL do worker de ASR; AudioSet zipformer-small int8;
  métrica grátis sempre computada; degrada para grátis sem modelo) +
  `src/audio/avaliador-cena.mjs` (Music ≥ 0,50 → adversa; fallback
  graves/voz ≥ 12,4 apenas com tagger morto). `CENA_TAGGER=0` desliga.
- Avaliação parte no commit do endpoint, em PARALELO à finalização do
  ASR; janela travada nos últimos 16 s (pior caso 30 s → 7 fatias,
  579 ms medidos, dentro da folga finalização+grace → latência ≈ 0).
- `cena` anexada a transcript.final/rejected; `cena.avaliada` em 100%
  dos turnos (critério §6.4 do 008).
- Regra 1 no servidor (`src/interaction/confirmacao-cena.mjs`, puro,
  14 testes): final curto+confiante sob adversa → confirmação
  determinística local ANTES do kernel/cérebro; anti-loop 1 em cadeia;
  pendência 60 s por sessão; confirmação crítica do kernel prevalece.
- Regra 2 no cliente + especulação nunca adotada sob adversa.
- Replay ganhou `--desde/--ate` (eixo do WAV, sampleStart absoluto) e
  repassa a cena — exercita a política pelo caminho de produção.
- Fix estrutural de carona: `audioEndMs` não era repassado no
  transcript.final — o guard ≥2,5 s do never-mute nunca disparava ao
  vivo. Corrigido nesta integração.

## Aceite adverso — replay a6c1, janela 11700–11830

Engine descartável 4321, BRAIN local, paridade candidata (TAGARELA int8
+ kroko + silero 0,85/1). A linha do tempo original se reproduziu:

- vazio (trel ~11769,7): adversa, Music 0,976 — trace ✓
- **turno fantasma (trel ~11777,1)**: final curto alucinado pelo ASR sob
  música (Music 0,974) → **CONFIRMAÇÃO** («Não te ouvi bem — você
  disse …?») em vez de resposta ao conteúdo. Zero conversa fantasma —
  o critério §6.1 do 008.
- vazio longo (~11802): adversa, Music 0,981 (7 fatias) — trace ✓
- «Alexa, continua» (~11812,7): **limpa** (Music 0,0004) — o ducking da
  Alexa é REAL e o tagger o mediu; pendência resolvida como «corrigida»
  e o fluxo seguiu normal (endereçamento fora de escopo, como no 008).
- vazio (~11819,5): adversa, Music 0,961 — trace ✓

## Contra-prova limpa — replay 685b, janela 7086–7180

10 finais de fala real, vários com ≤5 palavras (candidatos ideais a
falso positivo): 10× limpa (Music 0,0001–0,0041; margem >100× do limiar)
→ **zero confirmações** (critério §6.2). Respostas normais.

## Achados de método

1. **Run-in de replay**: com `--desde 11763` (janela seca) o silero FRIO
   não cruzou 0,85 no trecho música+fala-longe — pico 0,766 nas mesmas
   posições em que a sessão viva disparou (estado LSTM saturado por
   minutos de música). Com `--desde 11700` (63 s de run-in) os onsets
   reproduziram. Regra prática: janela de replay no meio de um bloco
   acústico pede ~60 s de run-in.
2. O que o replay NÃO exercita: as mensagens de vazio (Regra 2) e
   freios são fala local do CLIENTE — validados por testes/lógica;
   T4 (sessão viva com música) segue pendente.
3. O tagger reproduziu a bancada com exatidão (janela «meu avô»:
   Music 0,9759 na engine vs 0,976 no leito).

## Estado

Ação de cena: EXECUTADA e integrada, aguardando T4 vivo. Próximo da
frente: colheita de telemetria das sessões normais (turno.absorvido.*,
reproducao.gate, cena.avaliada/cena.confirmacao) para os gatilhos dos
adormecidos (006 §C).
