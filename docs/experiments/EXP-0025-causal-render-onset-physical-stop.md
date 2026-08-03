# EXP-0025 — âncora causal e STOP renderizado observável

Status: **pré-registro emendado prospectivamente em 03/08/2026, antes de C0,
freeze, abertura ou execução oficial; terminal para esta família de
instrumento; zero autoridade**

## Emenda metodológica e constructo

O nome histórico do arquivo contém `physical-stop`, mas o constructo deste
experimento **não é o último som audível na sala**. O EXP-0025 mede:

> tempo entre o trigger de `PAUSE_REQUESTED` e o fim do último quantum acima do
> limiar no grafo Web Audio do Chrome, mapeado para o relógio de apresentação
> por `AudioContext.getOutputTimestamp()`, seguido de ausência de reativação no
> horizonte observado.

Esse constructo será chamado de **STOP renderizado (`STOP-R`)**. Ele cobre o
grafo Web Audio e a estimativa de apresentação fornecida pelo navegador. Não
mede mixer do SO de forma independente, DAC, transdutor, alto-falante, sala,
reverberação, eco, microfone, loopback ou line-in. O constructo de produto
**STOP audível (`STOP-A`)** continua pendente e só poderá ser fechado por saída
e entrada em canais separados — loopback/line-in calibrado ou outro sensor
acústico com atribuição causal — ou por avaliação perceptiva apropriada.

Consequentemente, nenhuma decisão ou campo do EXP-0025 poderá usar “último
áudio audível”, “silêncio físico completo” ou equivalentes para descrever um
resultado. O experimento pode sustentar parada renderizada; não pode sustentar
parada acústica de sala.

Esta emenda é prospectiva: nenhum C0, freeze, opening, receipt ou dado oficial
do EXP-0025 existe. Protótipos locais pré-C0 não têm autoridade e deverão ser
adaptados a este contrato antes de qualquer freeze.

## Decisão que será alterada

O experimento altera somente estas decisões:

1. se o instrumento atual consegue observar validamente `STOP-R` em 12 STOPs;
2. se o caminho produtivo vigente encerra quanta não silenciosos em até 250 ms
   e permanece sem reativação por pelo menos 250 ms;
3. secundariamente, se as duas ordens entre `assistant.speech.paused` e
   `assistant.render.stopped` podem ser normalizadas como telemetria
   concorrente neste fingerprint.

Um passe de `STOP-R` fecha essa pergunta no renderer e impede nova rodada
automática do mesmo instrumento. Ele não promove runtime, bridge semântico ou
claim de produto. Uma falha válida de `STOP-R` autoriza atacar o menor caminho
de pausa/render. Uma invalidação instrumental encerra esta linhagem: não nasce
automaticamente um EXP-0026 para reparar mais uma premissa do mesmo coletor.

## Baseline, candidato e constante produtiva

- **Instrumento baseline `I0`:** EXP-0024, que exigia exatamente um
  `assistant.render.active` inicial e foi invalidado antes do primeiro STOP
  persistido. Seus fatos permanecem históricos e não serão reexecutados.
- **Instrumento candidato `I1`:** selecionar o primeiro
  `assistant.render.active` pós-reset por posição causal, preservar toda a
  multiplicidade e persistir `COLLECTED` ou `INSTRUMENT_FAILURE` antes de
  qualquer join de captura.
- **Runtime produtivo `P0`:** as dez fontes congeladas desde o EXP-0019,
  byte a byte idênticas. Não existe candidato de produto A/B no EXP-0025.

Portanto, a comparação `I0 → I1` qualifica observabilidade; os 12 resultados de
`P0` estimam `STOP-R`. Melhorar a cardinalidade do coletor não conta como
melhora do produto.

## Relação com a evidência anterior

- o EXP-0020 permanece invalidado e com `STOP-R=NOT_EVALUATED`;
- os EXP-0021 e EXP-0022 permanecem diagnósticos invalidados;
- o EXP-0023 continua qualificando apenas a captura CDP por ordem ordinal;
- o EXP-0024 permanece uma tentativa única invalidada, sem rerun ou
  reinterpretação;
- medições históricas de renderer permanecem evidência de seus fingerprints,
  não substitutos desta campanha;
- o EXP-0025 é novo, prospectivo e terminal para o instrumento atual.

Challengers de modelo não participam desta campanha. A trilha paralela,
não bloqueante e sem autoridade está pré-registrada separadamente no
[EXP-0025-R](EXP-0025-R-duplexcascade-floor-control.md).

## Hipótese instrumental mínima

Depois de um reset com trace vazio:

1. `speakLoop` produz ao menos um `assistant.render.active` com tempo finito;
2. o primeiro evento por posição no trace é uma âncora causal estável para
   planejar o trigger a +320 ms;
3. zero ou mais `render.active` adicionais antes do STOP são segmentos
   observados da mesma solicitação de fala e permanecem fatos brutos, não
   falhas de cardinalidade;
4. nenhum `render.active` aparece depois do marcador de STOP mais tardio no
   horizonte terminal de pelo menos 250 ms;
5. a multiplicidade que invalidou o EXP-0024 aparece em pelo menos um trial
   para que o delta `I0 → I1` seja considerado exercitado.

Ausência de multiplicidade produz `anchorDeltaStatus=NOT_EXERCISED`, mas não
apaga um `STOP-R` validamente coletado. Qualquer resultado iniciado que não
possa ser persistido no schema fechado invalida o instrumento inteiro.

## Campanha fixa e unidade estatística

- Chrome 150 do Windows por CDP a partir do WSL;
- servidor local, `BRAIN_PROVIDER=local`, ASR desligado, VAD adaptativo por
  energia e shadow desligado;
- alvo `http://localhost:4173/?automation=1&experiment=0025`;
- duas navegações completas e seis STOPs por navegação, total 12;
- frase legada e hasheada “Esta fala contínua mede uma única parada física do
  assistente.”; a palavra “física” integra somente o estímulo e não amplia o
  constructo;
- rate 1, mesma voz PT-BR, mesmo processo e mesmo fingerprint;
- um reset e um turnId novo por trial;
- trigger planejado 320 ms após a âncora, erro de 0 a 10 ms;
- horizonte mínimo de 250 ms após o marcador de STOP mais tardio;
- exatamente 12 TTS sequenciais, um por trial;
- mesma captura CDP qualificada, SHA-256 e tamanho pré-fixados no EXP-0024.

A unidade primária é um **STOP individual** (`n=12`). A navegação é unidade de
cluster operacional (`2×6`), não nova amostra independente. Não haverá teste
de população ou alegação de generalização: contagens, diferenças pareadas e
estatísticas descritivas caracterizam somente este fingerprint. Não haverá
repetição para fabricar multiplicidade ou diversidade do scheduler.

## Semântica prospectiva da âncora

Para cada trial, o coletor preservará:

- snapshot imediatamente após o reset;
- primeiro snapshot com `assistantSpeaking=true` e ao menos um
  `assistant.render.active`;
- lista e índices de todos os `render.active` anteriores ao trigger;
- índice e cópia exata da âncora escolhida;
- plano, instante real e erro do trigger;
- snapshots nos marcadores e no horizonte terminal;
- todos os marcadores posteriores, inclusive qualquer reativação.

A âncora é o primeiro `render.active` por posição no trace depois do reset.
Timestamp não desempata posição causal e um evento posterior não pode
substituí-la por produzir timer mais conveniente. Todos os eventos ativos do
snapshot inicial precisam preceder o trigger real. Se o primeiro evento já
estiver mais de 10 ms além da janela planejada quando observado, o trial retorna
falha instrumental tipada; o trigger nunca será retroativo.

## Resultado tipado e persistência

A expressão do browser retorna exatamente um resultado fechado:

- `COLLECTED`, com o bundle de renderer completo; ou
- `INSTRUMENT_FAILURE`, com fase, código, mensagem limitada, identidade,
  requestId quando conhecido e snapshots/marcadores já observados.

O worker persiste o resultado e aguarda ACK fsyncado antes de qualquer join de
captura ou próximo trial. Erro de CDP, serialização ou IPC pode encerrar o
worker, mas o supervisor materializa a falha sem promover prefixos. Body,
base64 e bytes de áudio são proibidos no IPC, journal e relatório.

Receipt write-once, journal NDJSON append-only, lock exclusivo do SO, deadline
total, recovery fail-closed e topologia C0 → freeze → opening → evidence são
novos e isolados. Nenhum artefato EXP-0024 será sobrescrito.

## Estimandos e métricas

### S — STOP renderizado, primário

Por trial:

- `latencyMs = lastRenderedAtMs - triggerAtMs`;
- lifecycle `idle → held` único por `PAUSE_REQUESTED`;
- um efeito `PAUSE_OUTPUT` em `accepted → dispatched → player-received →
  renderer-silent → completed`;
- player presente e pausado antes dos dois marcadores;
- `assistantSpeaking=false`, hold instalado e zero medição pendente;
- zero `assistant.render.active` após o STOP no horizonte terminal.

No agregado: contagem, mínimo, mediana, p95 nearest-rank e máximo. `S=PASS`
exige 12/12 trials válidos, latência individual entre 0 e 250 ms, p95 e máximo
≤250 ms, estado terminal correto e zero reativação.

### A — delta da âncora, instrumental

Contagem de `render.active` pré-trigger, gaps e trials com multiplicidade.
`A=PASS` exige ao menos um trial com multiplicidade; sem isso
`A=NOT_EXERCISED`, nunca `PASS` por vacuidade.

### O — ordem de telemetria, secundário

- `PAUSE_THEN_RENDER`: pausa ocupa posição serial anterior;
- `RENDER_THEN_PAUSE`: render stopped ocupa posição serial anterior.

Serão reportados contagem por classe e deltas absolutos de mediana e p95 de
`STOP-R`. `O=EQUIVALENT` exige ao menos dois trials por classe, projeção
terminal idêntica e deltas ≤16,7 ms. Menor diversidade produz
`O=INSUFFICIENT_DIVERSITY`; diferença maior ou projeção distinta produz
`O=DIVERGENT`. O limiar de 16,7 ms caracteriza o scheduler, não percepção.

## Gates separados

### I — validade do instrumento

1. boundary, commits, hashes, runtime, Chrome, receipt, lock e recovery válidos;
2. exatamente 2×6 resultados tipados e 12 TTS, sem seleção de sobreviventes;
3. ledger health/TTS ordinal completo, local e bijetivo;
4. 12 capturas com SHA-256 e tamanho pré-registrados;
5. 12 âncoras iguais ao primeiro `render.active` pós-reset, trigger
   320 ms + erro 0–10 ms e snapshots referenciais íntegros;
6. zero `INSTRUMENT_FAILURE`, diagnóstico, stderr ou conteúdo proibido;
7. relatório e checker reconstruídos dos artefatos reais.

Qualquer falha em `I` torna `S`, `A` e `O` `NOT_EVALUATED`.

### S, A e O — resultados independentes

- `S` usa somente os predicados de renderer e estado terminal acima;
- `A` registra se a correção de multiplicidade foi exercitada;
- `O` só avalia diversidade e equivalência depois de `S` válido.

Ausência de diversidade em `O` ou multiplicidade em `A` não reclassifica `S`
como inválido. Zero LLM externo, API paga, GPU, challenger, backbone ou nova
autoridade permanece gate global desta campanha.

## Budget, timebox e kill criteria

- restante entre a consolidação desta emenda e C0: no máximo **8 horas de
  engenharia focada** e um único candidato instrumental `I1`;
- nenhuma alteração nas dez fontes produtivas, nenhum novo sensor e nenhum
  segundo candidato de coleta;
- uma C0, uma freeze, uma abertura e **uma invocação oficial**;
- exatamente 12 TTS/STOPs, zero API paga e zero GPU;
- deadline total do supervisor: **600.000 ms**;
- nenhum rerun, recuperação que volte a executar Chrome ou seleção de prefixo.

A trilha morre antes da freeze se terminar exigir identidade nova de player,
hook de bytes produtivo, loopback/microfone/line-in, alteração de runtime ou
mais um grau de liberdade não descrito. Morre depois da abertura diante de
qualquer invalidação instrumental. Em ambos os casos, não se amplia o
instrumento e não se abre sucessor automático do mesmo desenho.

## Árvore de decisão terminal

1. **`I=FAIL`** → `CUT_RENDER_STOP_INSTRUMENT_LINEAGE`;
   `S/A/O=NOT_EVALUATED`; preservar fatos, sem rerun. Se `STOP-A` ou nova
   medição ainda for prioridade, exige sensor/constructo novo e nova revisão de
   valor da informação, não reparo incremental deste coletor.
2. **`I=PASS`, `S=FAIL`** → `FIX_RENDER_STOP_PATH`; corrigir o menor mecanismo
   produtivo sob outro pré-registro. Isso é resultado de renderer, não prova de
   som audível na sala.
3. **`I=PASS`, `S=PASS`, `A=NOT_EXERCISED`** →
   `PASS_RENDER_STOP_HOLD_ANCHOR_DELTA_NOT_EXERCISED`; fechar `STOP-R`, não
   repetir para fabricar multiplicidade e não alegar qualificação de `I1` sobre
   o modo que derrubou o EXP-0024.
4. **`I=PASS`, `S=PASS`, `A=PASS`, `O=INSUFFICIENT_DIVERSITY`** →
   `PASS_RENDER_STOP_HOLD_TELEMETRY_ORDER`; fechar `STOP-R`, manter a
   normalização de ordem em hold e seguir para outro gargalo, sem nova campanha
   para provocar o scheduler.
5. **`I=PASS`, `S=PASS`, `A=PASS`, `O=DIVERGENT`** →
   `PASS_RENDER_STOP_REJECT_TELEMETRY_NORMALIZATION`; a parada renderizada
   passou, mas a ordem não pode ser apagada do contrato.
6. **`I=PASS`, `S=PASS`, `A=PASS`, `O=EQUIVALENT`** →
   `PASS_RENDER_STOP_AND_TELEMETRY_ORDER_EQUIVALENT`; permite apenas
   pré-registrar o menor challenger do bridge, ainda sem autoridade.

Todas as folhas são terminais para o EXP-0025, mantêm
`authorityEligible=false` e `sameExperimentRerunAllowed=false`.

## Alegação máxima

Um `S=PASS` permite afirmar somente que, neste Chrome, dispositivo, runtime e
estímulo local, 12 triggers encerraram quanta não silenciosos observados no
grafo Web Audio em até 250 ms e não reativaram no horizonte de pelo menos
250 ms. Somente `O=EQUIVALENT` permite acrescentar que as duas ordens de
telemetria tiveram projeção terminal e margens equivalentes neste fingerprint.

O EXP-0025 não mede o último som audível, cauda de alto-falante/sala, fala
espontânea, microfone, ASR, AEC, percepção humana, outros dispositivos ou
robustez estatística de produto.
