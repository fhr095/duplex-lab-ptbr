# EXP-0016 — relevância acústica da fala em M4b

Status: **`promote-m4b-speaker-relevance-shadow-candidate`; autoridade em
`hold`**

## Pergunta

Um classificador acústico causal pequeno consegue distinguir fala percebida
como fundo/não dirigida de fala dirigida à assistente melhor que a regra atual
“toda fala detectada é dirigida”, sem usar respostas humanas como treino e sem
receber autoridade prematura?

## Por que esta capacidade

O EXP-0015 mostrou que atribuição da fala muda a preferência temporal: fala
percebida como fundo favorece continuar; fala dirigida não pode ser ignorada
por um veto inseguro. Isso tornou relevância do falante uma capacidade M4b
mais informativa que tentar reaprender toda a ontologia
`WAIT / PAUSE / CONTINUE` de uma vez.

## Dados e separações

A fonte treinável é o recorte PT-BR do FLEURS, com licença CC-BY-4.0 e revisão,
archive, metadata, tamanho, ETag e hashes congelados no
[`manifest de fonte`](../../eval/sources/exp-0016-fleurs-pt-br-v0.1.json).
O downloader percorre o archive oficial em streaming e guarda localmente
somente os WAVs selecionados.

- 36 clips distintos: 18 treino, 9 desenvolvimento e 9 holdout;
- treino usa o split upstream `validation`; desenvolvimento e holdout usam
  clips distintos do split upstream `test`;
- 8 famílias de receitas acústicas, sem família compartilhada entre splits;
- 108 exemplos: 72 treino, 18 desenvolvimento e 18 holdout;
- duas classes: `BACKGROUND_OR_NOT_DIRECTED` e `DIRECTED_TO_ASSISTANT`;
- todos os 36 clips desse recorte são masculinos e `speakerId` não está
  disponível; isso bloqueia qualquer alegação ampla por gênero ou falante;
- WAVs, PCM e transcrições ficam fora do Git; features causais, proveniência e
  hashes ficam no
  [`dataset versionado`](../../eval/datasets/exp-0016-speaker-relevance-v0.1.json).

Os rótulos de treino são proxies procedurais explícitos. O EXP-0015 orienta as
famílias e volta como âncora de avaliação, mas contribui com **zero exemplos de
fit**. Seus trechos CORAA continuam `evaluation-only`.

## Modelo e causalidade

O candidato é uma regressão logística softmax local sobre 12 features
acústicas compactas: duração observada, níveis, atividade, variação, cruzamentos
por zero, crest factor, periodicidade e descritores espectrais. A janela de
decisão do runtime tem 560 ms e usa zero amostras futuras.

O treinamento full-batch parte de pesos zero, usa somente o split de treino e
é repetido duas vezes. O
[`checkpoint`](../../web/speaker-relevance-checkpoint.json) fica em `shadow`,
declara `canProduceEffects=false` e faz duas leituras diferentes:

1. `rawLabel`, usada para verificar se a capacidade foi aprendida;
2. `operationalLabel`, que só propõe `CONTINUE_OUTPUT` quando a probabilidade
   de fundo é pelo menos 0,8; qualquer dúvida ou fala dirigida volta para a
   política determinística.

Os extratores Node e navegador são numericamente idênticos por teste. O buffer
do navegador só libera uma decisão quando toda a faixa
`onset → decisionSample` está presente.

## Resultados

| Evidência | Baseline | Candidato | Leitura |
| --- | ---: | ---: | --- |
| desenvolvimento procedural, rótulo bruto | 50,0% | 100% | capacidade separável |
| holdout procedural, rótulo bruto | 50,0% | 77,8% | ganho de 27,8 p.p.; recall 77,8% nas duas classes |
| holdout procedural, veto conservador | 50,0% | 55,6% | ainda não passa o gate de autoridade |
| 9 âncoras humanas resolvidas, baseline | 5/9 | — | regra trata tudo como dirigido |
| 9 âncoras humanas, rótulo bruto | 5/9 | 8/9 | erra uma fala dirigida; não é seguro para agir |
| 9 âncoras humanas, veto conservador | 5/9 | 7/9 | ganho de 2 cenas e recall dirigido 5/5 |

O reencontro humano usa somente o canal direito até a amostra de decisão. Essa
janela é idêntica nas três trajetórias contrafactuais de cada cena, impedindo
vazamento da ação que seria avaliada. Uma cena sem consenso de atribuição e os
dois controles ficam fora, resultando em nove âncoras.

No Chrome do Windows, quatro WAVs distintos atravessaram
`replay PCM → transporte → Silero VAD → evento de início → buffer causal →
checkpoint`. Node e navegador produziram rótulos e probabilidades idênticos;
todas as decisões usaram zero futuro e permaneceram sem autoridade. Esses
quatro probes validam integração, não qualidade.

## Decisão honesta

Promover a **capacidade M4b estreita em shadow**. Há ganho sobre a baseline em
holdout não usado no fit e um reencontro humano favorável. Não promover o veto
para autoridade: sua configuração segura preserva fala dirigida, mas perde
muitos fundos no holdout procedural e ainda não atinge os gates de acurácia,
recall por classe e ganho.

Essa separação evita dois erros opostos: descartar uma capacidade real porque o
limiar operacional é conservador, ou liberar uma ação porque a classificação
bruta parece boa.

## Próximo PDCA

O próximo experimento é calibração segura do veto, não mais participantes no
EXP-0015 nem um modelo maior por padrão:

1. ampliar diversidade de gênero, falante e ambiente com fonte aberta;
2. acrescentar hard negatives de fala baixa, distante e concorrente;
3. escolher calibração somente em treino/desenvolvimento;
4. congelar um novo holdout antes da comparação final;
5. exigir ganho operacional, recall dirigido de 100% e paridade no navegador;
6. manter `CONTINUE_OUTPUT` sem efeito até todos esses gates passarem.

Se esse ciclo não elevar o veto conservador, a hipótese de features acústicas
compactas fica limitada e o próximo challenger deve incorporar contexto
semântico ou embeddings abertos, ainda sob o mesmo evaluator.

## Reprodução

```bash
npm run eval:exp:0016:source
npm run eval:exp:0016:data
npm run eval:exp:0016:train
npm run eval:exp:0016:browser
npm run eval:exp:0016:report
```

As variantes `:check` de fonte, dados, treino e relatório verificam os
artefatos já materializados. O browser exige o servidor local e o Chrome do
Windows com CDP; não faz chamadas pagas.

Artefatos canônicos:

- [configuração](../../eval/experiments/exp-0016-speaker-relevance-m4b.pt-BR.json);
- [manifest da fonte](../../eval/sources/exp-0016-fleurs-pt-br-v0.1.json);
- [dataset de features](../../eval/datasets/exp-0016-speaker-relevance-v0.1.json);
- [checkpoint](../../web/speaker-relevance-checkpoint.json);
- [relatório](../../eval/reports/exp-0016-speaker-relevance-m4b-v1.json).

Chamadas pagas: **zero**.
