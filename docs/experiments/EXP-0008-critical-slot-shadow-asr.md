# Experimento EXP-0008 — verificador ASR de slot crítico em shadow

Status: **executado; sinal semântico aprovado e integração em hold de latência**

## Decisão que este experimento desbloqueia

Decidir se há um segundo sinal acústico local capaz de impedir a confirmação
errada de `R$ 150` observada no EXP-0007, sem usar a parcial volátil como prova e
sem conceder autoridade a outro modelo.

## Hipótese

Um ASR de família diferente, aplicado ao PCM final exato, recupera `R$ 1.150`
de forma estável. A comparação entre dois decoders pode então atuar como
interlock: acordo permite seguir; desacordo ou ambiguidade exige esclarecimento.
O verificador nunca escolhe sozinho um valor nem produz efeito externo.

## Intervenção e controles

- reconstruir byte a byte os cinco PCMs finais determinísticos do challenger
  EXP-0007, validando hashes de fonte, segmentos e concatenação;
- executar Whisper `small` int8/CPU como teto de qualidade;
- executar `base` e `tiny` já disponíveis localmente apenas como challengers de
  latência;
- três inferências determinísticas por caso e candidato: 45 observações;
- manter áudio, idioma, beam, temperatura e threads idênticos;
- medir revisão semântica por slot, estabilidade e latência de inferência;
- zero API paga, zero mudança user-facing e zero autoridade.

## Gate de viabilidade congelado

O teto `small` prova o sinal semântico somente se:

1. 5/5 PCMs reconstruídos coincidirem com os hashes do EXP-0007;
2. recuperar `BRL 1150` em 3/3 repetições do caso inseguro;
3. concordar com `16:00` e `11:00` em 6/6 repetições dos controles numéricos
   nos quais o primário preservou o valor atual;
4. produzir transcrição idêntica nas três repetições de cada caso;
5. não realizar chamadas pagas.

Um candidato é viável para integração bloqueante apenas se também cumprir p95
de inferência aquecida ≤ 650 ms. Passar o gate semântico e falhar latência
autoriza somente uma otimização/candidato menor; não autoriza runtime.

## Interpretação pré-declarada

- `small` não recupera `1.150`: rejeitar esta formulação do verificador antes de
  alterar o runtime;
- `small` recupera, mas nenhum candidato cabe no budget: manter apenas evidência
  de shadow e investigar um verificador mais estreito ou execução antecipada;
- candidato rápido recupera e não contradiz controles: implementar como shadow
  observável, ainda sem efeito;
- somente uma campanha ponta a ponta posterior pode autorizar o interlock.

O caso de dia e o de nome são diagnósticos de cobertura. Eles não entram no
gate numérico e não podem compensar falha do valor monetário.

## Evidência de entrada

O manifesto congelado é
[`exp-0008-critical-slot-shadow.pt-BR.json`](../../eval/experiments/exp-0008-critical-slot-shadow.pt-BR.json).
Ele contém hashes, ranges de amostras e os textos primários observados; não
depende de selecionar retrospectivamente uma repetição favorável, pois o
challenger do EXP-0007 produziu o mesmo PCM nas cinco repetições.

## Resultado

`HOLD_LATENCY` — 45/45 observações concluídas, zero chamada paga.

Os cinco PCMs foram reconstruídos byte a byte e coincidiram com os hashes do
EXP-0007. O relatório canônico está em
[`exp-0008-shadow-v1.json`](../../eval/reports/exp-0008-shadow-v1.json).

| Candidato | Valor `1.150` | Controles `16h`/`11h` | Estável | p95 inferência | Decisão |
| --- | --- | --- | --- | --- | --- |
| Whisper `small` | 3/3 | 6/6 | 5/5 casos | 3.100 ms | sinal semântico; lento |
| Whisper `base` | 3/3 | falhou | 5/5 casos | 1.708 ms | rejeitado |
| Whisper `tiny` | falhou | falhou | 5/5 casos | 638 ms | rápido; rejeitado |

O `small` prova que um decoder independente consegue ouvir o valor correto no
mesmo PCM em que o Parakeet retorna `150`. Isso não o torna apropriado para o
caminho bloqueante: seu p95 é quase cinco vezes o budget de 650 ms. Nenhum
candidato recebeu autoridade ou foi integrado ao runtime.

O caso de dia continuou como limitação estável (`domingo→mundo`) também no
`small`; o caso de nome permaneceu correto. Como resposta de maior
retorno/esforço, a ramificação adotou um interlock determinístico: correções de
valor em ações irreversíveis pedem repetição do valor final sem ecoar a hipótese
do ASR. Essa correção é avaliada separadamente no EXP-0009.
