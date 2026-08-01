# EXP-0015 — instrumento cego de calibração de timing

Status: **instrumento promovido; calibração humana em `await` (0/3)**.

## Pergunta

É possível preparar localmente uma calibração humana pequena para
`WAIT_FOR_EVIDENCE / PAUSE_OUTPUT / CONTINUE_OUTPUT`, sem revelar a ação,
fabricar preferência humana, redistribuir o CORAA ou liberar autoridade para o
modelo?

## Decisão

`promote-timing-calibration-instrument`.

Essa decisão promove pack, interface, persistência e agregação. Ela não promove
preferência, naturalidade, generalização, M4b ou uso direto dos dados atuais em
ajuste de pesos. O estado complementar é `await-human-calibration`.

## Desenho

O pack congela 12 situações e três trajetórias contrafactuais por situação:

- 7 trechos humanos públicos do CORAA, apenas como âncoras
  `evaluation-only`;
- 3 falas sintéticas locais, marcadas `development-synthetic`;
- 2 controles sem fala útil, marcados `control-only`;
- 3 controles de atenção distribuídos entre correção explícita, ruído e
  silêncio.

A assistente domina o canal esquerdo e a pessoa o direito, com crossfeed baixo.
As ações alteram apenas o momento em que a saída da assistente para ou continua.
Cada cena dura de 5 a 6,2 segundos e todos os WAVs são PCM 16 kHz estéreo.

A sessão deriva deterministicamente, por participante:

- uma ordem cega de cenas;
- uma ordem cega A/B/C para as três ações;
- IDs opacos de cena e alternativa;
- URLs de áudio válidas apenas na sessão.

A interface não recebe família, ação ou nome semântico da cena. A escolha só é
liberada depois que A, B e C terminam ao menos uma vez. O participante escolhe
uma alternativa ou registra dúvida, informa confiança de 1 a 5 e pode marcar
motivos. A unidade estatística é a pessoa, não cada clique ou cena.

## Privacidade e integridade

O navegador cria um token local pseudônimo. O servidor persiste somente seu
hash vinculado ao pack; nome, texto pessoal, áudio do avaliador e token bruto
não são gravados. Uma pessoa não pode concluir duas vezes o mesmo pack.

Cada registro é validado novamente ao agregar: vínculo de pack, hash de
conteúdo, cobertura de cenas, três playbacks completos, taxonomia, atenção,
proveniência e ausência do token bruto. Registro adulterado falha fechado.
Dúvida e empate permanecem ambíguos; não recebem vencedor arbitrário.

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

## Evidência

Pack congelado:

```text
sha256:6597535dffe70ee7524a41416f416d20b5d3adbe6d7631c30b59933de0aac872
```

O build produziu 12 cenas e 36 WAVs sem clipping, com pelo menos duas
trajetórias materialmente distintas em cada cena. Um gate acústico adicional
exige energia audível na janela de decisão de toda cena não-controle; ele
detectou e corrigiu três cortes inicialmente desalinhados. Algumas cenas de backchannel
e controle tornam `WAIT` e `CONTINUE` deliberadamente idênticos; isso expressa
que evidência curta não confirmou uma pausa, enquanto `PAUSE` permanece
contrafactual.

No Chrome 150 do Windows, acessando o IP direto do WSL:

- sessão cega vinculada ao mesmo hash;
- 12 cenas e 3 opções recebidas;
- decisão bloqueada antes das três reproduções;
- 3/3 WAVs decodificados e concluídos no smoke;
- escolha e confiança liberadas somente depois da escuta;
- zero token privado exposto e zero erro de navegador;
- zero anotação submetida pelo smoke;
- zero chamada paga.

O relatório canônico é
[`exp-0015-timing-calibration-instrument-v1.json`](../../eval/reports/exp-0015-timing-calibration-instrument-v1.json).
Seus 13 gates técnicos passam. O placar humano permanece separado: zero
participante, zero cena rotulada, zero rótulo elegível a fit e nenhuma
autoridade.

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

A calibração só fica suficiente para congelar o experimento M4b se, no mínimo:

- houver 3 participantes únicos;
- cada cena rotulada tiver 3 votos válidos;
- o vencedor tiver pelo menos 2/3 dos votos;
- ao menos 60% das 9 cenas não-controle forem rotuladas;
- a taxa agregada de atenção for pelo menos 80%;
- não houver registro inválido ou participante duplicado.

Esses mínimos formam um piloto para detectar direção e ambiguidade, não uma
avaliação estatística de produto. Se a discordância for alta, o resultado útil
é preservar a ambiguidade e redesenhar a cena, não aumentar artificialmente o
consenso.

## Próximo passo

Coletar o piloto sem alterar pack ou protocolo. Depois, usar somente o agregado
para congelar famílias novas e um holdout M4b ainda não observado. A política
determinística continua autoritativa; o candidato permanece em shadow até
demonstrar ganho no mesmo runtime e nos guardrails.
