# Experimento EXP-0007 — prefinal acústica determinística

Status: **planejado, não executado**

## Decisão que este experimento desbloqueia

Decidir se a prefinal deve ser disparada por um limite acústico fixo, em vez de
depender de a transcrição parcial parecer linguisticamente completa.

## Evidência que motivou a hipótese

- o mesmo WAV de valor limpo terminou em `1.150` no WebSocket e `150` no Chrome;
- no horário com ruído, o WebSocket preservou `16h` e o Chrome perdeu o slot;
- o PCM limpo teve respostas de 1.517 e 1.339 ms; sob ruído, Marina levou
  1.498 ms;
- a maior espera ocorre entre endpoint e final, enquanto a parada no renderer
  continua em até 50 ms.

Hoje, `tryPrepareFinal` depende de a parcial parecer completa. Uma parcial tardia
pode alterar a quantidade de silêncio incluída no snapshot; uma parcial errada
mas “completa” pode habilitar a prefinal enquanto uma parcial correta terminada
em “na verdade” pode bloqueá-la.

## Hipótese

Se o snapshot PCM da prefinal for congelado no limite de amostra da pausa
acústica, independentemente do texto parcial, então WebSocket e Chrome
consumirão o mesmo áudio, reduzirão a latência bimodal e preservarão mais slots
críticos sem publicar antes do endpoint.

## Baseline e challenger

Controle: política atual, condicionada à completude linguística da parcial.

Challenger `acoustic-eager-fixed-boundary`:

1. ao receber `speech.paused`, após o mínimo acústico existente, congelar o
   snapshot naquele limite de amostra;
2. iniciar a prefinal independentemente do conteúdo parcial;
3. invalidá-la em `speech.resumed`;
4. nunca publicar antes do endpoint;
5. manter VAD, endpoint, commit grace, ASR, brain e TTS idênticos.

## Instrumentação obrigatória

Para prefinal e final:

- SHA-256 e número de amostras do PCM;
- limite acústico, cauda de silêncio e trigger;
- origem escolhida: final preparada ou fresh;
- instante em que a final bruta fica pronta e espera de commit grace;
- transcript, slot atual, slot obsoleto e decisão semântica;
- endpoint→final, final→primeiro quantum e fim acústico→primeiro quantum;
- fila, cancelamentos e invalidações do worker.

O caso de valor deve registrar separadamente os hashes antes e depois do merge.

## Amostra

Cinco casos:

1. valor limpo `1.500→1.150`, com divergência atual;
2. horário ruidoso `14h→16h`, inseguro no Chrome;
3. dia ruidoso `quinta→domingo`, controle de limitação estável do modelo;
4. nome ruidoso `Ana→Marina`, correto porém lento;
5. horário ruidoso `9h→11h`, controle estável e rápido.

Matriz contrabalanceada: 5 casos × 2 políticas × 2 caminhos (WebSocket e
Chrome) × 5 repetições = **100 observações**.

As 100 observações não são 100 conversas independentes: existem somente cinco
conteúdos principais. A análise deve mostrar consistência por caso e por
repetição, melhorias e regressões, além do agregado.

## Gate de screening congelado

Levar o challenger à confirmação somente se:

- valor limpo e horário ruidoso terminarem corretos ou em esclarecimento seguro
  em 100% das repetições Chrome;
- nenhum valor incorreto novo for confirmado;
- segurança ruidosa subir de 5/6 para 6/6, ou permanecer 5/6 apenas pelo erro
  estável `domingo→mundo` enquanto latência e determinismo melhoram;
- p95 endpoint→voz ficar abaixo de 1.200 ms e melhorar ao menos 25% nos casos
  lentos;
- o mesmo caso produzir o mesmo hash PCM final nos dois caminhos;
- não houver regressão de parciais, backlog, falsa final ou parada do renderer.

Abandonar a hipótese se os hashes já forem iguais e o challenger não melhorar
segurança/latência. Nesse caso, a árvore seguinte é:

- hash igual e transcript variável: A/B Parakeet `finalThreads=3` versus `1`;
- hash igual e erro estável: Whisper `small` em shadow e, se recuperar o slot,
  verificador condicional apenas para ações críticas;
- final pronta cedo e voz tardia: investigar commit grace;
- final→voz acima de 250 ms: investigar TTS.

## Confirmação e promoção

As cinco repetições por célula são screening e não promovem o runtime.

Se o challenger passar:

1. repetir cada caso crítico com pelo menos 10 observações por célula para
   confirmação de desenvolvimento;
2. inspecionar distribuição e regressões por caso, não apenas p95 agregado;
3. reexecutar os seis casos canônicos de correção limpa e ruidosa;
4. exigir o gate autônomo de promoção definido em
   [EVALUATION.md](../EVALUATION.md#estatística-de-promoção) antes de alegar
   generalização acústica.

Uma vitória pode congelar uma baseline experimental versionada após a
confirmação de desenvolvimento; não autoriza alegação humana nem ampla.

## Orçamento máximo

- engenharia e testes: 6–9 horas;
- screening: 30–45 minutos;
- confirmação: só existe se o screening passar e recebe orçamento próprio
  antes da execução;
- API paga, gravação humana e treinamento: zero;
- parada: não ampliar modelo ou corpus antes de classificar a causa.

## Resultado

`NOT_RUN`

Este documento congela hipótese e gate antes da implementação.
