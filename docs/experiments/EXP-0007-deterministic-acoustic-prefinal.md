# Experimento EXP-0007 — prefinal acústica determinística

Status: **executado e rejeitado por segurança em 31/07/2026**

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

`REJECT_SAFETY` — 5/9 gates aprovados.

A matriz congelada foi executada integralmente: cinco casos, duas políticas,
dois caminhos e cinco repetições por célula, totalizando **100 observações**.
Os quatro relatórios brutos têm o mesmo fingerprint de runtime
`d208c4bf4c28b08a33ecc5c2b9c4b66602d254c1116a1f2596f67286f40a7542`,
sem chamadas pagas. A evidência compacta e seus hashes de proveniência estão em
[`exp-0007-screening-v1.json`](../../eval/reports/exp-0007-screening-v1.json).

| Gate congelado | Resultado |
| --- | --- |
| matriz completa e comparável | passou |
| segurança dos casos Chrome primários | **falhou** |
| nenhuma confirmação incorreta nova | **falhou** |
| p95 endpoint→voz < 1.200 ms | **falhou**: 1.253 ms |
| ganho ≥ 25% nos dois casos lentos | **falhou**: valor 3,24%; nome 15,45% |
| PCM final idêntico entre WebSocket e Chrome | passou nos 5/5 casos |
| fronteira acústica instrumentada exatamente | passou |
| sem regressão de pipeline ou renderer | passou |
| zero chamadas pagas | passou |

### O que a hipótese explicou

O controle produziu hashes finais variáveis para horário `14→16` e nome
`Ana→Marina`. O challenger produziu um único hash por caso, igual entre as
cinco repetições e entre WebSocket e Chrome. Portanto, congelar no limite
acústico resolveu de fato a não determinação do PCM que motivou o experimento.

Também houve melhora de latência perceptível em casos específicos: o p95
endpoint→voz de `14→16` caiu de 1.341 para 968 ms e o de nome caiu de 1.482
para 1.253 ms. O agregado caiu de 1.455 para 1.253 ms, ainda acima do gate.

### Falha decisiva

Na terceira repetição Chrome do valor `1.500→1.150`, o ASR final retornou
`“Transfere 1500 reais. Não, 150 reais.”` e a parcial mais recente também
convergiu para `150`. Sem divergência entre parcial e final, o reparo atual não
teve um segundo sinal e o sistema respondeu
`“Entendi a correção. Vou considerar R$ 150.”`.

Nas outras quatro repetições do challenger, a parcial divergiu o suficiente
para provocar esclarecimento seguro. No controle, isso ocorreu nas cinco. A
segurança, portanto, estava apoiada em uma parcial volátil, não em evidência
independente. Uma única confirmação crítica incorreta basta para rejeitar o
challenger, independentemente de seus ganhos médios.

### Decisão e aprendizado causal

- `linguistic-complete` permanece como padrão;
- `acoustic-eager-fixed-boundary` fica somente atrás de flag experimental;
- não executar a campanha de confirmação, pois o screening falhou;
- preservar hashes, limites de amostra e evidência do navegador: eles tornaram
  a causa observável e serão reutilizados;
- a primeira ramificação causal será um verificador ASR independente, em
  shadow e sem autoridade, apenas para slots críticos;
- otimização de commit grace, TTS ou concorrência do worker fica depois da
  segurança numérica.

O mecanismo provável — ainda hipótese — é que iniciar a final pesada em toda
pausa acústica altere o escalonamento das parciais. Isso será distinguido de
erro estável do decoder por intervenção controlada; não é tratado como causa
provada por esta rodada.
