# EXP-0020 — equivalência observável da ordem do STOP no renderer

Status: **pré-registrado; instrumento ainda não implementado; zero autoridade**

Este experimento responde somente à falha que cortou o EXP-0019. Ele não
reabre aquele resultado, não avalia o matcher semântico e não troca ASR, TTS,
VAD, cérebro ou backbone.

## Decisão que precisa desbloquear

Descobrir se a alternância entre `assistant.speech.paused` e
`assistant.render.stopped` representa uma diferença no estado autoritativo ou
no áudio renderizado pelo grafo Web Audio, ou apenas a ordem variável de duas
telemetrias concorrentes emitidas depois do mesmo comando de pausa.

O código atual registra o aceite de `HTMLMediaElement.pause()` no ledger de
efeitos e observa o silêncio separadamente em um `AudioWorklet`. O primeiro
marcador de interface roda em `requestAnimationFrame`; o segundo chega pelo
render probe. Essa explicação é uma hipótese de mecanismo, não a conclusão.

## Hipótese

Nas duas ordens observáveis:

1. o lifecycle transita uma única vez de `idle` para `held` por
   `PAUSE_REQUESTED`;
2. o efeito `PAUSE_OUTPUT` registra `player-received` com `paused=true` antes
   de qualquer um dos dois marcadores concorrentes;
3. `assistantSpeaking=false`, o recurso de hold permanece instalado e o
   render probe termina sem medição pendente e não volta a observar áudio
   ativo por pelo menos 250 ms depois do último marcador;
4. o último quantum não silencioso fica dentro do mesmo orçamento físico;
5. a projeção terminal, removendo apenas IDs e relógios, é idêntica.

Se isso ocorrer e as duas ordens aparecerem, a sequência bruta não carrega uma
diferença física observável neste instrumento e poderá receber uma
normalização causal explícita em outro experimento. Se estado, efeito ou render
divergir, o runtime precisa de um happens-before explícito.

## Unidade e campanha fixa

A unidade é um STOP físico do mesmo runtime, não uma conversa nem uma pessoa.
As repetições caracterizam uma corrida de scheduler neste fingerprint; não são
amostra de usuários, dispositivos ou ambientes.

A única campanha oficial terá exatamente:

- duas navegações completas do Chrome do Windows;
- seis STOPs consecutivos por navegação;
- doze STOPs no total;
- a frase fixa em loop “Esta fala contínua mede uma única parada física do
  assistente.”, o mesmo processo servidor e o mesmo fingerprint;
- um `reset()` e um novo `assistant.render.active` antes de cada trigger;
- trigger planejado 320 ms após o log do primeiro `assistant.render.active`,
  com erro do timer principal entre 0 e 10 ms;
- um `turnId` único por STOP.

Doze tentativas são suficientes para procurar as duas ordens com baixo custo,
considerando que ambas já apareceram nos quatro STOPs exploratórios do
EXP-0019. Esses quatro resultados históricos não entram na contagem nem nos
gates do EXP-0020. Se a campanha nova produzir menos de duas tentativas em
qualquer ordem, não haverá execução adicional: o resultado será
`HOLD_ORDER_DIVERSITY` e uma eventual perturbação controlada do scheduler
exigirá novo pré-registro.

## Instrumento mínimo

O runner usará apenas hooks de automação já existentes e o snapshot terminal.
Não será adicionado hook ao runtime para fabricar a ordem desejada. Para cada
STOP ele preservará:

- trace bruto e timestamps dos dois marcadores;
- transição completa do `OutputInterruptionLifecycle`;
- efeito `PAUSE_OUTPUT` e todos os seus estágios;
- estado terminal do assistente e do hold;
- snapshot e evidência terminal do render probe;
- horizonte pós-STOP mínimo de 250 ms e qualquer reativação nesse intervalo;
- latência até o último quantum não silencioso;
- diagnóstico do Chrome e saúde/custo do servidor.

Arquivos de produção do lifecycle, player, render probe, trace e servidor
precisam permanecer byte a byte iguais aos bytes usados no fechamento do
EXP-0019. Somente runner, analisador, testes, freeze e documentação do novo
experimento podem ser acrescentados antes da campanha.

O runner capturará pelo CDP os bytes das doze respostas WAV de `/api/tts`.
Todos os hashes precisam ser iguais; o primeiro hash observado não seleciona
casos e serve apenas de referência para os onze seguintes. O processo deve
preservar a mesma voz/cultura declarada em `/api/health`, e o rate congelado é
o default `1` usado pelo app. A combinação de WAV idêntico e trigger
ativo-relativo limita variação de estímulo sem alterar o player que produziu a
corrida original.

Depois dos testes, um freeze ligará hashes das fontes críticas, commit do
runner, configuração, alvo local e caminho único do relatório. Em seguida, uma
abertura de campanha separada fixará freeze, nonce, comando, commit e output;
ela será commitada sozinha antes de qualquer Chrome. O runner deve recusar
abertura ausente/não commitada, relatório preexistente, quantidade diferente
de repetições, origem que não seja localhost, provider externo, ASR ativo ou
TTS local indisponível. Crash depois da abertura consome a tentativa e resulta
em invalidação, nunca rerun sob o EXP-0020.

## Classes e projeção

Cada tentativa pertence a exatamente uma classe:

- `PAUSE_THEN_RENDER`: `assistant.speech.paused` aparece primeiro;
- `RENDER_THEN_PAUSE`: `assistant.render.stopped` aparece primeiro.

Empate, ausência ou duplicidade de qualquer marcador invalida a tentativa.

A projeção de equivalência conserva somente semântica observável:

- evento, fase, razão, `pauseKind` e intents da transição;
- `assistantSpeaking`, presença do hold e estado do render probe;
- tipo do efeito e sequência categórica de estágios;
- comando despachado, presença/pausa do player e conclusão por renderer;
- tipo do render stop, `renderedThroughTrigger`, limiar e quanta de silêncio.

Ela remove IDs de sessão/turno/efeito, versões incrementais, epoch, timestamps,
latências e a própria classe de ordenamento. Os valores removidos continuam no
relatório bruto e são avaliados por gates temporais próprios; não podem ocultar
evento, estado, efeito ou falha física.

Equivalência temporal é definida antes da execução. Cada classe precisa de no
mínimo duas tentativas. A diferença absoluta entre as medianas das classes e a
diferença absoluta entre seus p95 nearest-rank precisam ser, cada uma, menores
ou iguais a 16,7 ms — um frame de 60 Hz, a fila concorrente que origina um dos
marcadores. Essa margem é de contrato do scheduler, não limiar perceptivo.

## Gates

Todos são obrigatórios para passe:

1. freeze válido, fontes de produção iguais ao EXP-0019 e relatório ausente
   antes da única campanha;
2. abertura válida e consumida uma única vez; exatamente duas navegações, seis
   STOPs por navegação e doze no total, no mesmo processo, fingerprint, Chrome
   e origem local;
3. cada tentativa parte de render ativo e contém exatamente um
   `PAUSE_REQUESTED: idle → held`, um `PAUSE_OUTPUT` e um exemplar de cada
   marcador concorrente;
4. todo efeito segue `accepted → dispatched → player-received →
   renderer-silent → completed`, despacha `HTMLMediaElement.pause()`, registra
   player presente e `paused=true`, e `player-received.atMs` não é posterior
   ao primeiro marcador; essa é evidência de ordenamento do software, não
   medição física independente;
5. os doze WAVs possuem o mesmo SHA-256 e os doze triggers ocorrem 320 ms após
   o primeiro render ativo, com erro individual de timer em 0–10 ms;
6. em 12/12 tentativas, `assistantSpeaking=false`, hold pendente, lifecycle
   `held/audible`, zero medição de render pendente e último quantum válido em
   0–250 ms; após o marcador mais tardio, o runner espera no mínimo 250 ms e
   não aceita novo `assistant.render.active`, mudança do stop ou reativação;
7. a projeção terminal pós-horizonte é idêntica nas doze tentativas e,
   portanto, entre as
   duas classes;
8. `PAUSE_THEN_RENDER` e `RENDER_THEN_PAUSE` aparecem pelo menos duas vezes
   cada; diferenças absolutas de mediana e p95 de STOP entre as classes são
   ambas ≤ 16,7 ms;
9. trace de treino válido, nenhum erro/invariante/efeito duplicado, somente
   rede local, zero chamada paga, zero token externo, zero GPU e nenhuma nova
   autoridade.

Serão reportados por classe e no agregado: contagem, latência mínima, mediana,
p95 nearest-rank e máxima, além da distância temporal entre os dois marcadores.

## Decisões

- `PASS_TELEMETRY_ORDER_EQUIVALENT`: todos os gates passam; autoriza somente
  pré-registrar uma normalização causal explícita e então reavaliar o bridge.
- `FIX_PHYSICAL_STOP_PATH`: a campanha é válida, mas estado, efeito, silêncio,
  latência ou projeção terminal diverge/falha; corrigir o runtime antes de
  retomar o bridge.
- `HOLD_ORDER_DIVERSITY`: todos os gates físicos e de coleta passam, mas uma
  das ordens possui menos de duas tentativas; não concluir equivalência entre
  classes nem repetir a campanha.
- `INVALIDATE_STOP_ORDER_INSTRUMENT`: freeze, abertura, cardinalidade, origem,
  fingerprint, trace, WAV/fase ou coleta viola o contrato; não interpretar o
  resultado.

A precedência é total: `INVALIDATE` para instrumento/coleta inválidos;
`FIX` para qualquer gate físico/temporal falho em campanha válida; `HOLD`
somente quando todos esses gates passam mas uma classe tem menos de duas
tentativas; `PASS` somente quando todos os gates passam.

Nenhuma decisão muda retroativamente o `CUT_CAUSAL_AUDIO_BRIDGE`, concede
autoridade ou libera ASR.

## Alegação máxima

Um passe permite afirmar apenas que, neste Chrome, dispositivo, runtime e
frase sintética local, as duas ordens de telemetria ocorreram depois do mesmo
aceite de pausa e produziram a mesma projeção terminal no grafo Web Audio em
doze STOPs, sem reativação por pelo menos 250 ms. Não mede alto-falante/sala,
percepção humana, ASR, conversa espontânea, outros schedulers, robustez de
produto ou generalização.

## Ordem de execução

1. commitar este pré-registro e a transição do índice;
2. implementar runner/analisador e testes sem abrir o Chrome real;
3. auditar projeção, gates, recusa de rerun e igualdade das fontes de produção;
4. commitar o freeze da instrumentação;
5. materializar e commitar isoladamente a única abertura de campanha;
6. executar uma única campanha, que internamente faz duas navegações e doze
   STOPs; crash ou output ausente invalida a tentativa;
7. commitar a evidência, emitir a decisão canônica e consolidar a memória.

## Trilha paralela

`EXP-0020-R` é apenas o marcador explícito de que challengers de modelo estão
**deferidos**. Ele não possui execução, orçamento, download, GPU ou autoridade;
somente poderá receber outro pré-registro depois da decisão física principal.
