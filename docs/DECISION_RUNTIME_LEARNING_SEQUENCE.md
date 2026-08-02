# Decisão — runtime comum e sequência até o primeiro peso

Status: **aceita em 31/07/2026; atualizada em 02/08/2026 após a calibração
EXP-0015 e o candidato M4b EXP-0016; execução incremental em andamento**

## Contexto

Uma auditoria independente e a contranálise subsequente convergiram no alerta
central: a cascata modular é uma baseline funcional e útil, mas não deve crescer
indefinidamente como conjunto de heurísticas desconectadas.

A inspeção do repositório mostrou três centros de decisão parcialmente
diferentes:

1. `src/policies/baseline-policy.mjs`, usado pelo evaluator;
2. `src/audio/live-audio-session.mjs`, com controle acústico/temporal;
3. `web/app.mjs`, com orquestração efetivamente percebida no navegador.

Isso ameaça validade experimental: uma política pode passar no relógio virtual
enquanto a experiência real combina outras regras, timers e estados.

A fundação continua válida no escopo medido: a campanha congelou 223 testes e a
consolidação passou 224/224 após adicionar sua regressão documental; permanecem
7/7 cenários, 20/20 expectativas e fábrica v0.2 íntegra. Esses números provam
engenharia interna, não preferência humana ou generalização aprendida.

## Decisão

O EXP-0007 foi executado depois desta decisão: resolveu a divergência do PCM,
mas foi rejeitado por uma confirmação numérica incorreta. A ramificação causal
foi encerrada: o EXP-0008 encontrou sinal semântico independente, porém lento,
e o EXP-0009 promoveu abstention determinística para o risco monetário. Agora:

- usar a cascata congelada como baseline versionada v0.3;
- extrair `InteractionKernel`, `InteractionRuntime` e
  `LocalAudioReflex`;
- fazer evaluator, backend e navegador compartilharem a mesma semântica, sem
  criar mais de uma autoridade de kernel por sessão real;
- materializar incrementalmente `training-trace-v1`, ledger de efeitos e
  holdout novo — fatia causal concluída no EXP-0013 e extensão acústica no
  EXP-0014;
- preservar o M4a acústico promovido em shadow e sem autoridade;
- calibrar timing/rótulos com uma amostra humana pequena antes de M4b;
- conceder autoridade apenas à capacidade que vencer seus gates.

A ordem executável e seus limites permanecem somente em
[ROADMAP.md](ROADMAP.md#ordem-operacional-consolidada).

## Atualização após o EXP-0010

A primeira fatia da decisão foi executada sem antecipar o restante da
arquitetura:

- `InteractionKernel` v0.1 decide correção e confirmação monetária como reducer
  puro;
- `InteractionRuntime` no backend é a autoridade única por sessão, com LRU e
  retry idempotente;
- o navegador valida e projeta intenções, sem reconstruir a política semântica;
- 5/5 ciclos Chrome preservaram estado nulo antes da confirmação e produziram
  exatamente um rollback/commit depois da repetição inequívoca;
- 270/270 testes e zero chamada paga sustentam
  `promote-stateful-kernel-slice`.

M2.5 continua aberto. Em quatro smokes completos, o gate stateful passou 4/4;
o eixo físico registrou atividade em três, mas sem rótulo/loopback capaz de
atribuir a origem ao assistente. O achado definiu o comparador seguinte sem ser
promovido a alegação causal.

## Atualização após o EXP-0011

O `LocalAudioReflex` v0.1 foi extraído como reducer puro e integrado ao caminho
real. Durante saída audível, o modo promovido arma no primeiro início Silero e
exige duas janelas adicionais com `p >= 0,75` ou parcial textual útil. Um turno
sem essa confirmação não pausa e sua final tardia não pode criar resposta.

No A/B de fonte idêntica, o controle imediato pausou e criou um turno diante do
mesmo pico marginal e `I'm`; o candidato preservou a voz e suprimiu o final. A
interrupção legítima terminou no renderer em 157,39 ms, abaixo do teto de
350 ms, e a sessão física corrente passou 30,147 s sem ativação. Isso sustenta
`promote-local-audio-reflex-slice`, não M2.5 completo nem causalidade de eco.

O fechamento seguinte, concluído no EXP-0012 abaixo, foi reconciliar
`WAIT_FOR_EVIDENCE`, STOP, retomada e efeito observado com o lifecycle do
`InteractionRuntime`, mantendo o comando físico rápido no navegador. Loopback
ou rótulo causal permanece necessário antes de usar o probe físico como prova
de autoeco.

## Atualização após o EXP-0012

Hold, retomada e confirmação da saída passaram a uma única máquina de estados
local, `OutputInterruptionLifecycle` v0.1. O executor do navegador conserva
recursos e executa PAUSE/`play()`, mas não decide mais transições em campos
implícitos. Seis fluxos do Chrome cobriram as quatro fases e tiveram replay
exato; seis corridas assíncronas adicionais falharam fechadas. O STOP terminou
no renderer em 48 ms e onset PCM→último quantum em 183,66 ms, com zero chamada
paga. Isso sustenta `promote-output-interruption-lifecycle-slice`.

O probe causal físico não iniciou neste fingerprint; seus gates permaneceram
falsos e o status global continua em `hold`. M2.5 também continua aberto para
clocks/filas amplos e efeitos externos. O maior retorno seguinte àquela rodada,
concluído no EXP-0013 abaixo, não foi extrair mais heurísticas: foi materializar
uma fatia de `training-trace-v1` e um ledger estreito sobre os caminhos já
promovidos.

## Atualização após o EXP-0013

O caminho real do Chrome agora materializa a primeira fatia de
`training-trace-v1`: evento, contexto disponível, decisão, rótulo e lifecycle
do efeito compartilham IDs e fingerprint de sessão. Seis conversas produziram
28 decisões reproduzidas e 22 efeitos encerrados. Uma pausa retomada antes de
silêncio mensurável fica `cancelled`, não é reescrita como STOP; a projeção v0
só usa `renderer-silent` e `audible`. Shadow é estruturalmente observacional.

Os 12 gates formais passaram, assim como todos os gates do Chrome corrente;
STOP ficou em 38 ms e onset PCM→renderer em 169,82 ms, com zero API paga. Isso
sustenta `promote-training-trace-interruption-slice`. Não sustenta o contrato
completo: faltam streams acústicos hasheados, posições de amostra e mapeamentos
entre clocks; tampouco existe checkpoint ou alegação de generalização.

O maior retorno seguinte é estender somente essa fronteira: ligar as fixtures
PCM já existentes ao trace incremental do `LocalAudioReflex`, criar split por
família e provar M4a acústico em shadow para
`WAIT_FOR_EVIDENCE / PAUSE_OUTPUT / CONTINUE_OUTPUT`. A política determinística
continua autoritativa e nenhum efeito crítico migra para o modelo.

## Atualização após o EXP-0014

Essa extensão foi concluída sem ampliar a autoridade do runtime. Sessenta
streams PCM foram vinculados a hashes e posições de amostra; 330 exemplos
causais foram separados por dez famílias entre treino, desenvolvimento e
holdout. O classificador softmax local treinou duas vezes com resultado
idêntico. No Chrome, 11 decisões cobriram as três classes, tiveram replay exato
de reducer, features e probabilidades, inferência p95 de 0,2 ms e nenhum
efeito. A campanha corrente também preservou o barge-in em 151,75 ms e passou a
janela física de 30,072 s.

Isso sustenta `promote-m4a-acoustic-shadow-infrastructure`. Não sustenta ganho
sobre a regra: os rótulos vêm dela, portanto a acurácia perfeita apenas prova
que o encanamento e o split não vazam entre famílias. O próximo valor de
informação está numa calibração humana pequena de timing/rótulos e num holdout
novo para M4b; a política determinística continua autoritativa.

## Atualização após o EXP-0015

O instrumento da calibração foi concluído sem confundir automação com opinião
humana. O pack contém 12 cenas e 36 trajetórias estéreo cegas. Duas execuções da
v0.1 revelaram opções byte a byte idênticas apresentadas separadamente,
atribuição da fala misturada com timing e ausência de papel interno/externo; por
isso elas permanecem piloto de usabilidade e não foram migradas. A v0.2 agrupa
equivalências, aceita empate, pergunta atribuição separadamente e mantém
comentário opcional somente local. O Chrome do Windows confirmou cenas com 2 e
3 alternativas, escuta obrigatória, empate e atribuição. IDs semânticos e ações
não chegam à interface, o token local é hasheado antes da persistência e o smoke
não envia anotação.

Dezessete gates técnicos sustentam `promote-timing-calibration-instrument`.
Com 3/3 participantes externos e 1 interno, o gabarito v0.2.1 mostra atenção
77,8% base ao lado de 100% emendada. A resolução v0.2.2 preserva 5 rótulos
singulares, reconhece 3 conjuntos de preferência consensuais e fecha 8/9 cenas;
`calibration-sufficient-to-freeze-m4b-experiment` passa. A cena restante fica
explicitamente ambígua. Nenhum registro foi alterado, equivalência não virou
ação única e há zero item `fit-eligible`. CORAA permanece apenas avaliação e o
sintético apenas desenvolvimento. Naquele ponto, M4b exigia um novo artefato
treinável e holdout ainda não observado; o EXP-0016 abaixo os materializou sem
mudar a autoridade determinística.

## Atualização após o EXP-0016

M4b foi aberto com uma capacidade menor e mais testável que a ontologia inteira:
relevância acústica da fala. O dataset versionado contém 108 exemplos derivados
de 36 clips FLEURS PT-BR CC-BY-4.0. Clips e famílias de transformação não
cruzam treino, desenvolvimento e holdout; a calibração humana orienta a
pergunta, mas fornece zero exemplos de fit.

O classificador bruto alcançou 77,8% no holdout contra 50% da baseline. Nas
nove âncoras humanas resolvidas, o mapeamento conservador atingiu 7/9 contra
5/9 e recall de 100% para fala dirigida. O mesmo checkpoint percorreu quatro
probes no Chrome, com paridade exata de probabilidades entre Node e navegador,
zero amostras futuras e zero autoridade. Isso sustenta
`promote-m4b-speaker-relevance-shadow-candidate`.

Autoridade continua determinística. Com limiar 0,8, o veto seguro atingiu só
55,6% no holdout procedural e não passou acurácia, recall por classe ou ganho
operacional. O próximo experimento deve ampliar diversidade e hard negatives,
calibrar apenas em treino/desenvolvimento e congelar um novo holdout antes de
reavaliar qualquer efeito.

## Pontos incorporados

- congelar a cascata como referência, não como código intocável;
- permitir correção causal quando protege segurança, trace, comparação ou M4a;
- manter STOP físico imediato perto do Web Audio;
- separar proposta, aceite, despacho e efeito audível/externo;
- registrar origem e versão de cada rótulo;
- separar prova de infraestrutura (M4a) de modelo comparável (M4b);
- manter política, LLM, ASR, TTS e modelo nativo em comparações causalmente
  separadas.

## Pontos modificados

### Incerteza

O primeiro modelo produz probabilidades. `WAIT_FOR_EVIDENCE` é uma decisão de
autoridade baseada em confiança, risco e deadline. `UNCERTAIN` só vira classe
de treino se houver uma verdade observável e um experimento que justifique.

### Causalidade no trace

`triggeredBy`, `decisionContext`, `supersedes` e `epoch` registram a
cadeia operacional. O trace não chama essa relação de causalidade humana;
causalidade é demonstrada por intervenção e comparação controlada.

### Orçamento da cascata

O padrão é um timebox e até duas hipóteses na ramificação após EXP-0007, não um
limite cego de ciclos. Uma falha grave pode receber exceção explícita; melhoria
cosmética não entra.

### Referência nativa

Preparar o adaptador e desafiar cedo a ontologia é válido. Execução em GPU só
entra quando responder uma pergunta capaz de mudar uma decisão e não bloqueia
M4a. Adoção ou adaptação exige teto modular medido.

### Evidência pública

CI público melhora automação e verificabilidade, mas não transforma teste dos
próprios autores em reprodução externa independente. Manifest e checksums
precedem infraestrutura de assinatura mais complexa.

## Pontos não adotados agora

- treinar de imediato uma política com todas as ações;
- tratar 24 correções sintéticas como base suficiente de comportamento humano;
- mover o interlock físico de áudio para uma ida ao backend;
- armazenar pitch/embeddings como campos obrigatórios do trace canônico;
- tornar avaliação humana ampla ou benchmark nativo pesado bloqueadores;
- comparar política, LLM, ASR e TTS mudando todos ao mesmo tempo;
- interpretar 288 corrupções rejeitadas como 288 bugs do runtime.

## Métrica histórica corrigida

O valor de 187 ms da campanha M1 mede fim sintético de uma entrada textual
injetada pelo harness até `HTMLAudioElement.onplaying`. Ele não inclui
microfone, VAD, ASR nem cauda física do alto-falante/sala e não deve ser
chamado isoladamente de latência voz-a-voz.

## Decisões deliberadamente abertas

Não são bloqueadores do fechamento M2.5:

- eventual mudança da autoridade hoje hospedada no backend; qualquer mudança
  precisa preservar uma única autoridade por sessão;
- calibração segura e eventual autoridade limitada do M4b de relevância;
- candidato nativo e provedor de GPU, somente após pergunta/orçamento;
- eventual expansão da amostra após o piloto EXP-0015 para perguntas novas; o
  gate atual já fechou e não deve receber participantes apenas para forçar ação
  singular onde houve equivalência;
- licença do código, escolhida pelo proprietário em trilha de governança.

## Gatilhos para rever esta decisão

Reabrir a arquitetura somente se evidência mostrar que:

- um kernel comum não consegue representar eventos de um candidato relevante;
- o reflexo local causa mais cortes percebidos do que evita;
- sinais incrementais compactos não conseguem converter o ganho bruto de M4b
  em veto seguro sob diversidade nova;
- um modelo nativo produz ganho humano grande sob os mesmos guardrails;
- custo ou complexidade do trace excede seu valor de replay/aprendizado.

Discordância sem novo experimento ou nova evidência não reabre a decisão.
