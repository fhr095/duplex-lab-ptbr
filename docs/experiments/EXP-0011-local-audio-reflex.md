# EXP-0011 — reflexo local com evidência acústica

## Pergunta

É possível evitar que um pico Silero isolado pause ou substitua a fala do
assistente sem perder a interrupção legítima no caminho
PCM→WebSocket→VAD→player?

## Hipótese

Enquanto o assistente já está audível, um início Silero pode armar um reflexo
local por duas janelas adicionais em vez de pausar imediatamente. Duas janelas
consecutivas com `p >= 0,75` ou uma parcial textual útil confirmam a fala. Se a
evidência não se sustentar, a saída continua; a final tardia do mesmo turno não
pode escapar e criar uma resposta nova.

Fala antes do primeiro áudio e detectores sem probabilidade/amostra continuam
fail-safe: pausam imediatamente.

## Mudança isolada

- `LocalAudioReflex` v0.1 como reducer puro e testável no navegador;
- modo `evidence-gated` com duas janelas adicionais de suporte;
- eventos `vad.control.window` emitidos somente enquanto o Silero está em fala;
- tombstone do turno acusticamente não confirmado até a final, impedindo que
  uma hipótese tardia do ASR substitua a resposta;
- traces distintos para `armed`, `pause`, `suppressed` e
  `transcript-suppressed`;
- modo anterior disponível em `?audioReflex=immediate` como controle;
- `evidence-gated` promovido como padrão;
- pré-ensaio físico exige 1,5 s estável antes da janela causal e registra toda
  interferência anterior sem tratá-la como parte do probe.

## A/B causal

Controle e candidato foram executados no mesmo fingerprint
`56bb0c0c…0dcb7`. Ambos receberam o mesmo início marginal (`p=0,87`), duas
janelas insuficientes (`0,79` e `0,71`) e a mesma final tardia `I'm`.

- controle `immediate`: pausou a fala, confirmou barge-in e criou um turno;
- candidato `evidence-gated`: armou, não pausou, continuou o áudio, descartou a
  final não confirmada e não criou turno;
- todas as regressões não acústicas permaneceram verdes.

O controle termina com `ok=false` deliberadamente porque expõe a falha que o
experimento pretende remover; não é uma quebra do harness.

## Interrupção legítima

A fixture “Espera, eu quis dizer outra coisa” atravessou transporte local,
Silero, reflexo, pausa e renderer:

- controle: 73,42 ms do onset PCM estimado ao último quantum;
- candidato: 157,39 ms;
- orçamento: 350 ms;
- o candidato armou primeiro e pausou somente após evidência acústica
  sustentada;
- o transcript final confirmou a interrupção e nenhuma retomada indevida
  ocorreu.

O custo observado da proteção foi 83,97 ms nessa comparação, ainda com
192,61 ms de margem no orçamento fechado. Essa medição termina no grafo Web
Audio; não mede a cauda física do alto-falante ou da sala.

## Sessão física complementar

O candidato passou 30,147 s de microfone/AEC/VAD físicos com 1.501 frames
aproximados, zero início Silero, zero pausa, zero gap/drop/erro e zero chamada
paga. O pré-ensaio aguardou 33,673 s porque detectou três falas e dois turnos
antes de obter silêncio estável; esses eventos foram preservados como contexto,
mas ficaram fora da janela causal.

Rodadas exploratórias anteriores continham fala ambiente transcrita e não
podem ser chamadas de “autoeco”. Elas permanecem no agregado suplementar como
`unlabelled-concurrent-speech` ou ativação não rotulada. Sem loopback calibrado
ou rótulo humano, um pico durante a saída do assistente não identifica sua
causa.

## Evidência

- 283/283 testes, incluindo reducer, analisador adversarial e integração;
- A/B causal com fontes idênticas;
- candidato com todos os gates do smoke verdes;
- barge-in closed-loop em 157,39 ms, abaixo de 350 ms;
- zero erro de browser, HTTP, transporte ou pipeline;
- zero chamada e zero token pago.

O relatório canônico é
[`exp-0011-local-audio-reflex-v1.json`](../../eval/reports/exp-0011-local-audio-reflex-v1.json).

## Decisão

`promote-local-audio-reflex-slice`.

Promovido:

- reflexo `evidence-gated` como padrão durante saída já audível;
- supressão de pico marginal sem pausa percebida;
- bloqueio da final tardia do mesmo turno não confirmado;
- preservação do STOP local e do modo `immediate` como controle.

Não promovido:

- M2.5 completo;
- alegação geral de especificidade física ou causalidade de eco;
- thresholds universais por dispositivo/voz;
- cauda física da sala, multivoz ou preferência humana.

## Próximo experimento

Completar a reconciliação do reflexo com o runtime comum: representar
`WAIT_FOR_EVIDENCE`, `STOP`, retomada e resultado observado no mesmo lifecycle e
trace, sem mover o comando físico rápido para uma ida ao backend. Em paralelo,
o probe físico deve ganhar loopback/rótulo causal antes de sustentar alegação de
autoeco.
