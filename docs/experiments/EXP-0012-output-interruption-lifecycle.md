# EXP-0012 — lifecycle local de interrupção da saída

## Pergunta

É possível substituir os estados implícitos de pausa/retomada do navegador por
uma única máquina de estados reproduzível, sem adicionar ida ao backend no STOP
físico nem regredir o que o usuário percebe?

## Hipótese

O `LocalAudioReflex` deve continuar decidindo se existe evidência inicial para
pausar. Depois dessa decisão, um reducer local separado pode governar
`hold → resume | confirm | clear`, incluindo resultados tardios de
`HTMLMediaElement.play()`. O navegador executa os efeitos, registra evento,
estado e intenção e o evaluator reproduz exatamente a mesma transição.

## Mudança isolada

- `OutputInterruptionLifecycle` v0.1 como reducer puro;
- fases explícitas `idle`, `held`, `resuming` e `confirmed`;
- intenções para pausar, segurar preparação, retomar, confirmar, liberar e
  bloquear resultado obsoleto;
- `outputEpoch` e `resumeAttempt` impedem que áudio antigo reabra a fala;
- o player continua sendo pausado localmente, sem round-trip de rede;
- trace `output-interruption.transition` contém evento, versões, fase,
  contexto e intenções suficientes para replay;
- o smoke do Chrome reproduz cada trace com o mesmo reducer e falha se o efeito
  divergir ou se surgir uma decisão vazia/redundante;
- o pré-ensaio físico agora registra silêncio/probe não resolvido e continua os
  cenários determinísticos, sem transformar ausência de medição em gate verde.

## Evidência no Chrome

Seis fluxos completos foram observados e reproduzidos exatamente:

1. preparação de áudio segurada e liberada sem player existente;
2. backchannel determinístico com `held → resuming → idle`;
3. parcial curta retomada e final posterior reabrindo a interrupção;
4. backchannel PCM real retomado;
5. barge-in PCM confirmado, sem retomada;
6. correção longa mantida em hold até a final.

O replay cobriu as quatro fases e oito intenções efetivamente executadas. Uma
auditoria direta adicional protege seis condições de corrida: fala durante
`play()`, sucesso tardio após novo hold, resultado antigo durante retomada mais
nova, confirmação durante `play()`, época de áudio obsoleta e ausência de
saída.

Resultados da execução canônica:

- resposta iniciada em 178 ms;
- comando local de pausa observado em 0 ms no relógio do browser;
- último quantum não silencioso em 48 ms;
- onset PCM→último quantum em 183,66 ms, abaixo do teto de 350 ms;
- retomada do backchannel PCM 312,6 ms depois do fim acústico, abaixo de
  500 ms;
- zero erro de browser, HTTP ou pipeline;
- zero chamada e zero token pago;
- 299/299 testes locais.

O relatório canônico é
[`exp-0012-output-interruption-lifecycle-v1.json`](../../eval/reports/exp-0012-output-interruption-lifecycle-v1.json).

## Limite físico observado

O ambiente ofereceu 1,5 s de silêncio inicial, mas o probe causal rotulado não
começou em 15 s porque nova atividade segurou a preparação do TTS. Por isso
`noSelfInterruptionUnderDeviceAec` e `longSessionNoFalseActivation` continuam
falsos e o status global permanece `hold-labelled-physical-specificity`.

Isso não regride a evidência física histórica do EXP-0011 e também não a
transfere para este fingerprint. A promoção deste experimento depende do
caminho PCM→VAD→player, do renderer real e do replay exato; não alega
especificidade acústica por dispositivo, ausência universal de autoeco ou
cauda física da sala.

## Decisão

`promote-output-interruption-lifecycle-slice`.

Promovido:

- uma autoridade local explícita para hold, retomada e confirmação da saída;
- replay exato dos efeitos observados no Chrome;
- falha fechada das corridas assíncronas de `play()`;
- continuidade do STOP físico junto ao Web Audio.

Não promovido:

- M2.5 completo;
- lifecycle global de clocks, filas, tarefas e efeitos externos;
- especificidade física causal ampla;
- `training-trace-v1`, ledger de efeitos, política treinada ou preferência
  humana.

## Próximo experimento

Materializar uma primeira vertical de `training-trace-v1` e ledger de efeitos
observados sobre os caminhos já promovidos. O objetivo é provar que
contexto→decisão→intenção→efeito pode alimentar replay e M4a sem duplicar a
autoridade nem expandir a cascata. Clocks/filas adicionais migram quando forem
necessários para essa vertical; o loopback físico segue como trilha paralela.
