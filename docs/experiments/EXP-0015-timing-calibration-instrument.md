# EXP-0015 — instrumento cego de calibração de timing

Status: **campanha concluída; instrumento v0.2, gabarito v0.2.1 e resolução
de preferências v0.2.2 promovidos; M4b liberado para congelamento**.

## Pergunta

É possível preparar localmente uma calibração humana pequena para
`WAIT_FOR_EVIDENCE / PAUSE_OUTPUT / CONTINUE_OUTPUT`, separando preferência de
timing, atribuição da fala e equivalência acústica, sem revelar a ação,
fabricar preferência humana, redistribuir o CORAA ou liberar autoridade para o
modelo?

## Decisão

`promote-timing-calibration-instrument` para a v0.2.

Essa decisão promove pack, interface, persistência e agregação. A coleta humana
complementar sustenta `calibration-sufficient-to-freeze-m4b-experiment`. Ela
não promove naturalidade, generalização, qualidade de produto, uso direto dos
dados atuais em ajuste de pesos ou autoridade para o modelo.

## O que o piloto v0.1 revelou

Duas execuções locais da v0.1 foram tratadas como piloto de usabilidade, não
como calibração final. O feedback expôs três problemas de mensuração relevantes:

- quatro cenas mostravam `WAIT` e `CONTINUE` como alternativas separadas mesmo
  quando os WAVs eram byte a byte idênticos;
- a dúvida sobre a fala à direita ser uma interrupção dirigida à assistente ou
  uma voz de fundo estava misturada com a preferência de timing;
- o protocolo não distinguia quem participou do desenvolvimento de uma pessoa
  externa.

As respostas v0.1 permanecem intactas no armazenamento local ignorado pelo Git.
Elas não foram migradas, reinterpretadas nem contadas no gate v0.2. A revisão
adicionou também motivos estruturados e um comentário curto opcional para
capturar dúvidas que as categorias não antecipem.

## Desenho v0.2

O pack congela 12 situações e 36 trajetórias contrafactuais:

- 7 trechos humanos públicos do CORAA, apenas como âncoras
  `evaluation-only`;
- 3 falas sintéticas locais, marcadas `development-synthetic`;
- 2 controles sem fala útil, marcados `control-only`;
- 3 controles de atenção distribuídos entre correção explícita, ruído e
  silêncio.

A assistente domina o canal esquerdo e a fala/som próximo domina o direito, com
crossfeed baixo. As ações alteram apenas o momento em que a saída da assistente
para ou continua. Cada cena dura de 5 a 6,2 segundos e todos os WAVs são PCM
16 kHz estéreo.

A sessão deriva deterministicamente, por participante:

- uma ordem cega de cenas;
- uma ordem cega A/B/C para artefatos acusticamente distintos;
- o agrupamento de ações cujo SHA-256 de áudio é idêntico;
- IDs opacos de cena e alternativa;
- URLs de áudio válidas apenas na sessão.

Por isso, oito cenas exibem três opções e quatro exibem duas. A interface não
recebe família, ação, nome semântico da cena ou tamanho do grupo equivalente.
A escolha só é liberada depois que todas as opções terminam ao menos uma vez.

O participante pode marcar uma ou mais alternativas como igualmente melhores,
ou declarar que não consegue avaliar. Em seguida responde separadamente se a
fala/som à direita parece dirigido à assistente, informa confiança de 1 a 5,
pode selecionar motivos e escrever até 280 caracteres opcionais. A unidade
estatística é a pessoa, não cada clique ou cena.

## Agregação sem preferência inventada

Uma opção formada por WAVs idênticos preserva todas as ações equivalentes. Uma
seleção múltipla preserva o conjunto escolhido. Apenas respostas com exatamente
uma ação alimentam votos para um rótulo singular; equivalências e empates nunca
ganham uma ação vencedora arbitrária.

Para a finalidade distinta de saber se a calibração resolveu a direção do
M4b, o agregado aceita também um **conjunto de preferência estável**: ao menos
três respostas válidas e dois terços escolhendo exatamente o mesmo conjunto de
ações. Isso registra que aquelas ações são equivalentemente aceitáveis na cena,
sem convertê-las em rótulo singular ou dado apto a treino. Dúvidas continuam
fora dos votos e desacordo sem consenso continua irresolvido.

A atribuição da fala é agregada por cena em uma dimensão separada. Nos controles
de atenção, tanto o conjunto de ações quanto a atribuição precisam estar dentro
do esperado. Isso impede que o sistema trate ruído como uma interrupção ou que
uma dúvida semântica pareça uma preferência de timing.

## Emenda aditiva de gabarito v0.2.1

Após duas respostas externas, o placar-base marcou 4/6 controles de atenção. A
decomposição mostrou 6/6 acertos na ação e 4/4 acertos de atribuição em correção
explícita e ruído. As únicas duas falhas vieram do silêncio: ambas as pessoas
marcaram `UNCERTAIN`, enquanto o gabarito-base aceitava somente
`BACKGROUND_OR_NOT_DIRECTED`.

Em 02/08/2026 foi congelada uma emenda estritamente aditiva, vinculada ao hash
do mesmo pack:

- no `silence-control`, `BACKGROUND_OR_NOT_DIRECTED` e `UNCERTAIN` são aceitos;
- `DIRECTED_TO_ASSISTANT` continua incorreto;
- nenhuma aceitação anterior foi removida;
- pack, WAVs, perguntas, opções e registros brutos não foram modificados.

Naquele checkpoint, o agregado preservou os dois placares: **66,7% no
gabarito-base e 100% no gabarito v0.2.1**. Com a terceira resposta, os placares
passaram a 77,8% e 100%, respectivamente. A emenda está em
[`exp-0015-scoring-rubric-v0.2.1.json`](../../eval/calibration/exp-0015-scoring-rubric-v0.2.1.json)
e falha fechado se for usada com outro pack, aceitar as três classes ou remover
a resposta originalmente correta.

## Resolução aditiva de preferências v0.2.2

Com três participantes externos, o placar singular cobriu 5/9 cenas. O
feedback qualitativo e o próprio agregado mostraram que as seleções múltiplas
não eram falta de atenção: nos dois backchannels, `WAIT` e `CONTINUE` apontam
para o mesmo WAV; em fala preparada, as três pessoas escolheram conjuntamente
`WAIT + PAUSE`. Exigir uma ação única descartaria uma conclusão humana estável
que o instrumento foi desenhado para preservar.

A política v0.2.2, vinculada ao mesmo pack, mantém todos os limiares originais
e acrescenta cobertura por conjuntos consensuais:

- 5 cenas têm rótulo singular;
- 3 cenas têm conjunto de preferência estável;
- 1 cena, `filled-pause-mid`, permanece irresolvida;
- cobertura singular permanece **55,6%** e cobertura resolvida passa a
  **88,9%**;
- equivalências não criam rótulo singular, não são `fit-eligible` e não
  autorizam ajuste de pesos.

A política está em
[`exp-0015-preference-resolution-rubric-v0.2.2.json`](../../eval/calibration/exp-0015-preference-resolution-rubric-v0.2.2.json).
Ela falha fechado se mudar os limiares congelados, permitir fit direto, mutar
registros ou se for usada com outro pack.

## Privacidade e integridade

O navegador cria um token local pseudônimo. O servidor persiste somente seu
hash vinculado ao pack e o papel `external` ou `internal`; nome, áudio do
avaliador e token bruto não são gravados. Comentários opcionais ficam somente
na pasta local ignorada pelo Git, com limite de 280 caracteres e aviso para não
incluir dados pessoais. O relatório canônico não exporta comentários.

Uma pessoa não pode concluir duas vezes o mesmo pack. Cada registro é validado
novamente ao agregar: vínculo de pack, hash de conteúdo, cobertura de cenas,
playbacks completos por artefato distinto, taxonomia, atenção, proveniência,
papel do participante e ausência do token bruto. Registro adulterado falha
fechado.

## Fronteira de dados

Os WAVs e mixes ficam em `eval/generated/` e fora do Git. O manifest versionado
guarda receitas, timings e hashes, nunca a transcrição humana. A licença
CC BY-NC-ND 4.0 do CORAA é preservada e os mixes derivados não são
redistribuídos.

Existem quatro estados explícitos de elegibilidade:

```text
fit-eligible | development-synthetic | evaluation-only | control-only
```

O pack corrente possui zero cena `fit-eligible`. Mesmo quando houver consenso
humano, seus resultados calibram a pergunta e o desenho do próximo conjunto;
não podem ser enviados diretamente ao treino. M4b exigirá um artefato novo,
com fonte e licença próprias, além de outro gate.

## Evidência v0.2

Pack congelado:

```text
sha256:30e62d9b64c4781939c3a7d46d5a8c8a54be6eaa8bc4396405436512750d2b65
```

O build reproduzível produziu 12 cenas e 36 WAVs sem clipping. Todas as 10
cenas não-controle têm evidência acústica alinhada à janela de decisão. Em
quatro cenas, `WAIT` e `CONTINUE` são deliberadamente idênticos e agora aparecem
como uma única opção; `PAUSE` permanece o contrafactual distinto.

No Chrome 150 do Windows, acessando o IP direto do WSL:

- sessão cega vinculada ao mesmo hash;
- presença comprovada de cenas com 2 e 3 opções;
- decisão bloqueada até todos os WAVs da cena terminarem;
- empate de duas opções exercitado no smoke;
- atribuição da fala obrigatória exercitada separadamente;
- zero token privado exposto e zero erro de navegador;
- zero anotação submetida pelo smoke;
- zero chamada paga.

O relatório canônico corrente é
[`exp-0015-timing-calibration-instrument-v4.json`](../../eval/reports/exp-0015-timing-calibration-instrument-v4.json).
Seus 17 gates técnicos passam. O placar humano tem 3 participantes externos e
1 interno, 4 registros válidos, atenção de 77,8% no gabarito-base e 100% no
emendado, 5 rótulos singulares e 3 resoluções por conjunto. A campanha fecha em
8/9 cenas resolvidas, zero rótulo elegível a fit e nenhuma autoridade.

O pack e os relatórios
[`v0.1`](../../eval/reports/exp-0015-timing-calibration-instrument-v1.json)
e [`v0.2`](../../eval/reports/exp-0015-timing-calibration-instrument-v2.json)
permanecem versionados como evidência histórica. O primeiro não deve receber
novas anotações; o segundo registra o checkpoint anterior à emenda e à coleta
corrente.

## Reprodução

Com a amostra CORAA local e a voz PT-BR do Windows disponíveis:

```bash
npm run eval:exp:0015:build
npm run eval:exp:0015:check
npm run eval:exp:0015:serve
```

Abra `http://localhost:4174` ou o IP do WSL impresso pelo servidor. Para o smoke
técnico via Chrome do Windows e a consolidação:

```bash
npm run eval:exp:0015:browser
npm run eval:exp:0015:report
```

## Gate humano congelado

A calibração fica suficiente para congelar o experimento M4b quando:

- houver 3 participantes **externos** únicos;
- participantes internos forem preservados apenas como evidência de
  usabilidade e não contarem para o mínimo;
- cada cena resolvida tiver 3 votos válidos de preferência;
- uma ação ou o mesmo conjunto de ações tiver pelo menos 2/3 desses votos;
- ao menos 60% das 9 cenas não-controle forem resolvidas;
- conjuntos de ações não forem convertidos em rótulo singular ou fit direto;
- a taxa agregada de atenção externa sob o gabarito v0.2.1 for pelo menos 80%,
  preservando também o placar-base no relatório;
- não houver registro inválido ou participante duplicado.

Esses mínimos formam um piloto para detectar direção e ambiguidade, não uma
avaliação estatística de produto. Se a discordância for alta, o resultado útil
é preservar a ambiguidade e redesenhar a cena, não aumentar artificialmente o
consenso.

Todos esses critérios passaram. O pack, as respostas e os comentários locais
foram preservados sem alteração.

## Próximo passo

Congelar um experimento M4b separado, com dados novos `fit-eligible`, famílias
de treino separadas e holdout não observado. A política determinística continua
autoritativa; o candidato permanece em shadow até demonstrar ganho no mesmo
runtime e nos guardrails. Nenhum áudio ou rótulo do EXP-0015 entra diretamente
no ajuste de pesos.
