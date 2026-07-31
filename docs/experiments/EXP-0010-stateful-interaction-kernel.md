# EXP-0010 — primeira fatia stateful do InteractionKernel

## Pergunta

É possível fechar o ciclo de confirmação monetária em dois turnos, com uma
única autoridade por sessão, sem duplicar política no navegador nem chamar um
LLM externo?

## Hipótese

Um reducer puro e estreito pode transformar
`estado + USER_TURN_FINAL → próximo estado + intenções`, enquanto um runtime no
backend preserva a sessão e o navegador apenas projeta as intenções no player e
no trace. Isso deve manter o primeiro turno em abstention e registrar exatamente
um rollback somente depois que a pessoa repetir um valor único e não ambíguo.

## Mudança isolada

- `InteractionKernel` v0.1 puro para correções e confirmação monetária;
- `InteractionRuntime` stateful no backend, com sessões isoladas, LRU e retry
  idempotente por `turnId`;
- `TurnCoordinator` como única autoridade da sessão real;
- adaptador do navegador que valida versão/autoridade e só projeta estado e
  eventos;
- provider local ou externo contornado durante todo o ciclo de segurança;
- confirmação aceita apenas com um único valor; negação, dúvida, alternativa,
  ausência de valor e cancelamento permanecem fail-closed;
- `npm start` alinhado à configuração Silero `0.85 × 1` da baseline v0.3.

O escopo não migra ainda backchannel, delegação, clocks acústicos ou STOP para o
kernel.

## Evidência

No fingerprint canônico do experimento:

- 270/270 testes passaram;
- evaluator virtual: 7/7 cenários e 20/20 expectativas;
- fábrica: 24 casos, 288/288 corrupções rejeitadas e 85,7% pairwise;
- Chrome do Windows: 5/5 ciclos completos de dois turnos;
- pergunta neutra p95: 94,9 ms do commit textual ao início da fala;
- aceite p95: 399,9 ms;
- antes da repetição: 0 rollback, estado semântico nulo e versão 1;
- depois da repetição: 1 rollback, `BRL 1150`, versão 2 e pendência nula;
- cinco sessões distintas, sempre com autoridade
  `backend-interaction-runtime` e kernel `interaction-kernel-v0.1`;
- zero chamadas pagas e zero erro de browser/HTTP.

O relatório canônico é
[`exp-0010-stateful-kernel-v1.json`](../../eval/reports/exp-0010-stateful-kernel-v1.json).

## Resultado adversarial paralelo

O smoke completo foi executado quatro vezes ao longo da implementação. A fatia
stateful passou em 4/4 campanhas, mas apenas 1/4 sessões longas passou sem um
pico Silero causado pela própria fala do assistente. Os picos foram próximos ao
limiar e ocorreram antes de qualquer evento do kernel; em ao menos uma execução
o ASR vazio descartou o falso barge-in e retomou o player, mas a pausa provisória
continua perceptível.

Esse achado não é apagado pelo gate causal. O status global do runtime é
`hold-acoustic-stability` e passa a orientar a próxima fatia do M2.5.

## Decisão

`promote-stateful-kernel-slice`.

Promovido:

- estado stateful da confirmação monetária;
- uma autoridade no backend por sessão;
- projeção browser sem política semântica paralela;
- contrato determinístico e idempotente de replay.

Não promovido:

- M2.5 completo;
- estabilidade acústica física atual;
- efeitos financeiros externos;
- generalização linguística ou humana;
- toda a ontologia de interação no kernel.

## Próximo experimento

Extrair e comparar `LocalAudioReflex` durante a fala do assistente. O candidato
deve reduzir pausas por vazamento do próprio áudio sem piorar a parada real no
renderer. Depois, WAIT/BACKCHANNEL/STOP e clocks entram incrementalmente no
runtime comum.
