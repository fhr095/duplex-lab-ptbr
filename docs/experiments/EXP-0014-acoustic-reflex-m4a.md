# EXP-0014 — reflexo acústico treinável em shadow

## Decisão que este experimento desbloqueia

O caminho causal já materializado consegue fechar
`dados → treino → checkpoint → inferência online → trace → replay` para uma
capacidade acústica estreita, sem conceder autoridade ao modelo?

## Hipótese

Features incrementais compactas do `LocalAudioReflex`, extraídas somente do PCM
disponível no instante da decisão, bastam para um classificador pequeno imitar
`WAIT_FOR_EVIDENCE / PAUSE_OUTPUT / CONTINUE_OUTPUT` de forma reproduzível e
rodar no Chrome dentro do budget, em shadow e sem efeitos.

## Mudança isolada

- streams PCM reais/derivados ligados por SHA-256, sample rate, canais, tamanho
  e posição de amostra;
- dez famílias separadas entre treino, desenvolvimento e holdout;
- extrator causal de nove features e classificador softmax determinístico, sem
  framework de ML ou API;
- checkpoint validado e carregado no navegador;
- inferência online registrada no `training-trace-v1`, com as três
  probabilidades, rótulo-professor e `OBSERVE_ONLY`;
- replay formal recalculando reducer, features e probabilidades;
- política determinística, lifecycle, PAUSE/STOP e retomada permanecem
  inalterados e autoritativos.

## Amostra e proveniência

- 60 streams PCM, derivados de dez fixtures PT-BR em três taxas;
- para cada fonte, variante sustentada completa e variante marginal cortada
  depois da primeira janela Silero;
- 330 decisões: 198 treino, 66 desenvolvimento e 66 holdout;
- treino: saudação, hesitação, interrupção, correção, delegação e cancelamento;
- desenvolvimento: números e “não” curto;
- holdout: espera curta e mudança para terça;
- rótulos de `local-audio-reflex-v0.1`, registrados como
  `deterministic-invariant`; nenhum rótulo humano.

Os WAV/PCM pesados são reconstruíveis e permanecem fora do Git. O dataset de
features, receitas, hashes, checkpoint e relatório canônico são versionados.

## Gates

1. famílias disjuntas e holdout excluído do ajuste;
2. todas as classes em todos os splits;
3. treino repetido produz checkpoint idêntico;
4. dataset, checkpoint, áudio e fingerprints ligados e válidos;
5. inferência online cobre as três classes e respeita o budget;
6. replay online é exato;
7. toda posição acústica referencia um stream válido;
8. shadow não aceita autoridade nem produz efeito;
9. regressões de interrupção e Chrome permanecem verdes;
10. zero API paga.

## Resultado

- **324/324 testes**;
- **330/330** classificações corretas nos três splits e recall 1 para cada
  classe;
- treinamento repetido bit a bit e checkpoint
  `acoustic-reflex-m4a-c7bb582e896f1300`;
- **11 decisões** selecionadas no Chrome, cobrindo as três classes, com
  concordância integral com o professor e replay exato;
- inferência online p95 de **0,2 ms**;
- zero autoridade e zero efeitos do candidato;
- último quantum do barge-in em **40 ms** e onset PCM→renderer em
  **151,75 ms**, abaixo do teto de 350 ms;
- janela física corrente de **30,072 s** sem falsa ativação;
- todos os 18 gates formais e todos os gates da campanha Chrome verdes;
- zero chamada paga.

O 100% não é uma métrica de qualidade humana: o modelo aprende a fronteira da
regra que gerou os rótulos. O holdout por família demonstra que o encanamento
não depende de memorizar IDs/casos e que a infraestrutura suporta comparação;
não demonstra generalização acústica ou superioridade comportamental.

## Decisão

`promote-m4a-acoustic-shadow-infrastructure`.

Promovido:

- vínculo causal mínimo entre PCM, posição, feature, rótulo e decisão;
- dataset por famílias e treino local reproduzível;
- checkpoint carregado online no caminho real;
- trace e replay exatos das probabilidades;
- M4a para o reflexo acústico, estritamente em shadow.

Não promovido:

- ganho sobre `LocalAudioReflex`;
- preferência, naturalidade ou timing humano;
- generalização para vozes, salas, dispositivos ou ruído;
- autoridade para pausar, retomar ou criar turnos;
- `training-trace-v1` completo ou clocks entre processos;
- prontidão de produto.

## Artefatos

- configuração:
  [`exp-0014-acoustic-reflex.pt-BR.json`](../../eval/experiments/exp-0014-acoustic-reflex.pt-BR.json);
- dataset:
  [`exp-0014-acoustic-reflex-v0.1.json`](../../eval/datasets/exp-0014-acoustic-reflex-v0.1.json);
- checkpoint:
  [`acoustic-reflex-checkpoint.json`](../../web/acoustic-reflex-checkpoint.json);
- relatório:
  [`exp-0014-acoustic-reflex-m4a-v1.json`](../../eval/reports/exp-0014-acoustic-reflex-m4a-v1.json).

## Próxima pergunta

Depois de uma calibração humana pequena de timing/rótulos, um candidato M4b
consegue vencer a regra em famílias novas sob o mesmo runtime, sem aumentar
falsos cortes nem receber autoridade sobre efeitos críticos?
