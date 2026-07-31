# Experimento EXP-XXXX — título

## Decisão que este experimento desbloqueia

Descreva uma única decisão.

## Hipótese

Se mudarmos **X**, então **Y** melhora, porque **Z**.

## Baseline

- candidato/commit:
- pack e hash:
- hardware:
- runtime:
- kernel/política:
- região/rede:
- seed:

## Mudança isolada

Descreva o que muda e, explicitamente, o que permanece fixo.

## Métrica principal

- nome:
- definição temporal:
- caminho incluído e excluído:
- domínio de clock/amostras:
- direção desejada:
- tamanho mínimo de efeito:

## Guardrails

- falsos cortes:
- qualidade semântica:
- naturalidade:
- estabilidade:
- custo:

## Amostra

- cenários:
- repetições:
- unidades realmente independentes:
- falantes:
- condições acústicas:
- critério de exclusão:

## Orçamento máximo

- engenharia:
- GPU:
- dados:
- data de parada:
- hipóteses/ciclos máximos desta ramificação:

## Gate de screening antes de executar

Qualificar para confirmação se:

Abandonar se:

## Confirmação e nível de evidência

- amostra confirmatória:
- gate de promoção aplicável:
- escopo que poderá ser alegado:
- novo holdout necessário:

## Resultado

Preencher sem mudar a hipótese ou o gate retrospectivamente.
Separar resultado por caso/repetição do agregado e registrar qualquer
informação vista depois do congelamento.

## Artefatos

- configuração:
- trace:
- relatório:
- áudio:
- checkpoint:
- proveniência de rótulos, quando aplicável:

## Decisão

```text
QUALIFICAR_CONFIRMAÇÃO | CONGELAR_BASELINE_EXPERIMENTAL | PROMOVER
REPETIR | ABANDONAR | INCONCLUSIVO
```

Justificativa:

## Próxima pergunta

Qual incerteza passou a ser a mais importante?
