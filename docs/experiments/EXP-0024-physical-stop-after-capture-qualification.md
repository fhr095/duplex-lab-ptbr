# EXP-0024 — equivalência física do STOP com captura qualificada

Status: **pré-registrado; implementação e tentativa ainda não abertas; zero
autoridade**

## Decisão de maior valor agora

Determinar se as duas ordens já observadas entre
`assistant.speech.paused` e `assistant.render.stopped` correspondem à mesma
parada física e ao mesmo estado terminal, ou se revelam uma divergência real
que um usuário poderia perceber.

Esse é o gargalo de maior valor de informação porque o instrumento de bytes
acabou de ser qualificado e o runtime, a expressão física do trial, o
analisador e os testes do EXP-0020 já existem. Não há troca de arquitetura,
modelo, ASR, TTS ou cérebro. Challengers continuam no ledger e fora da
execução até que um mecanismo concreto possa atacar uma falha medida.

## Relação com a evidência anterior

Este é um experimento novo. O EXP-0020 permanece terminalmente invalidado e
`NOT_EVALUATED`; nenhum de seus gates físicos será reinterpretado. EXP-0021 e
EXP-0022 produziram diagnósticos invalidados que refinaram o caminho sem STOP;
somente o EXP-0023 o qualificou prospectivamente, com 4/4 browser=CDP e
ordinais causais válidos.

O challenger mínimo do EXP-0024 é integrar duas peças já auditadas:

1. a campanha e a semântica física do EXP-0020;
2. retry limitado, ledger de rede/health, ordinais e boundary fail-closed dos
   EXP-0021 a EXP-0023.

As dez fontes de produção congeladas pelo EXP-0020 continuam byte a byte
iguais ao evidence commit do EXP-0019 e precisam permanecer assim até a
evidência. Somente instrumentação EXP-0024 pode mudar.

## Hipótese física

Nas duas classes de ordem:

1. o lifecycle faz exatamente uma transição `idle → held` por
   `PAUSE_REQUESTED`;
2. um único `PAUSE_OUTPUT` percorre `accepted → dispatched → player-received
   → renderer-silent → completed`, com player presente e pausado antes dos
   dois marcadores;
3. `assistantSpeaking=false`, hold instalado, render probe sem medição
   pendente e nenhum novo `assistant.render.active` por pelo menos 250 ms;
4. último quantum não silencioso, latência de STOP e projeção terminal ficam
   dentro do mesmo contrato nas duas classes;
5. removendo apenas identidade, relógios e a própria classe, a projeção
   terminal das 12 tentativas é idêntica.

Se todos os itens passarem e ambas as ordens aparecerem pelo menos duas vezes,
a variação de ordem será tratada como telemetria concorrente equivalente neste
fingerprint. Divergência de estado, efeito, silêncio ou latência indica que o
runtime físico precisa ser corrigido antes de retomar o bridge.

## Campanha fixa

- Chrome do Windows acessado pelo CDP a partir do WSL;
- servidor local explícito, `BRAIN_PROVIDER=local`, ASR desligado, VAD control
  por energia adaptativa e shadow desligado;
- alvo exato `http://localhost:4173/?automation=1&experiment=0024`;
- duas navegações completas e seis STOPs por navegação, total 12;
- frase em loop: “Esta fala contínua mede uma única parada física do
  assistente.”;
- um reset, um único `assistant.render.active` inicial e um turnId novo por
  trial;
- trigger 320 ms após o primeiro render active, erro individual de 0 a 10 ms;
- horizonte mínimo de 250 ms após o marcador mais tardio;
- rate local 1, mesma voz/cultura e mesmo fingerprint na campanha inteira;
- exatamente 12 `POST /api/tts`, um por trial, estritamente sequenciais.

Os quatro STOPs exploratórios do EXP-0019 e o trial não persistido do EXP-0020
não entram em contagem ou gates. Não haverá repetição para fabricar diversidade
de scheduler.

## Instrumento de captura qualificado

O novo harness não poderá chamar o coletor de uma leitura do EXP-0020. Para
cada TTS ele deverá:

- habilitar `Network` com buffers 16 MiB total, 2 MiB por recurso, postData 64
  KiB e durable messages desligado;
- iniciar o capture promise dentro do handler do terminal
  `Network.loadingFinished`, sem aguardar o fim do trial físico; executar as
  quatro leituras sequencialmente: esperar 0 ms, tentar; depois da tentativa
  anterior esperar +8 ms, tentar; depois +24 ms, tentar; depois +64 ms e tentar.
  Somente os sleeps somam 96 ms; latência dos comandos CDP é adicional e não há
  alegação de limite wall-clock. Tudo roda em paralelo ao horizonte restante do
  STOP; falha de captura vira dado tipado e não cancela a expressão física em
  andamento;
- exigir request POST com exatamente a frase congelada, status 200, MIME
  `audio/wav`, base64 canônico, RIFF/WAVE íntegro, mais de 44 bytes e menos de
  2 MiB;
- registrar SHA-256 e tamanho, sem persistir bytes ou base64 no relatório;
- exigir nas 12 respostas o digest pré-observado para essa frase,
  `sha256:ca2f579e7942db94c2f50029525b2057d94964e91cfe79244bd706eb6f50cd4b`,
  e 237.232 bytes; o primeiro trial não poderá selecionar a referência;
- usar um ordinal global serial para request, response e terminal; todos os
  ordinais precisam ser positivos, únicos, `request < response < terminal` e
  as faixas de navegação não podem se sobrepor ou inverter;
- exigir timestamps finitos e não anteriores ao próprio request, sem impor
  ordem entre response e terminal;
- distinguir exatamente um health de bootstrap e um health explícito de
  auditoria por navegação, ligados pelo mesmo frame/loader e pelo ledger;
- provar pelo ledger que audit termina antes do primeiro TTS e cada TTS
  termina antes do próximo;
- abrir a unidade causal antes de `speakLoop`, atribuir a ela exatamente um
  requestId TTS globalmente único e exigir que request, response, terminal e
  capture pertençam a esse mesmo ID dentro da janela serial do trial, com
  contagens 1→1→1, zero `loadingFailed` e zero terminal duplicado;
- reconstruir a bijeção trial↔request do ledger bruto, nunca de um campo
  resumido `trial.tts`; nenhum TTS pode ocorrer sem unidade ativa, depois do
  fechamento dela ou entre trials, e `terminal(TTS_i) < request(TTS_i+1)`;
- ligar o mesmo request ao único caminho produtivo congelado
  `fetch → blob → player → assistant.render.active`, sem introduzir hook de
  bytes; relógios CDP nunca serão comparados a `performance.now()` do browser.

Como o player do app consome o próprio fetch, o EXP-0024 não adicionará um
segundo fetch nem um hook produtivo apenas para recalcular o digest no browser.
O EXP-0023 qualificou browser=CDP no mesmo endpoint e, no payload A, com a
mesma frase; isso justifica reutilizar o adaptador e pré-fixar o digest, mas
**não transfere o gate** para o fetch interno do player. No EXP-0024,
`browserCdpByteIdentity=NOT_EVALUATED`: a alegação limita-se aos bytes CDP da
resposta exata causalmente ligada ao request do app. Render ativo, bijeção
trial↔request e o SHA/tamanho pré-registrados são evidências complementares,
não uma identidade de bytes calculada dentro do browser.

## Persistência e falha fechada

Dentro do comando oficial, o supervisor escreverá um receipt exclusivo antes
de qualquer ação de worker, rede ou CDP da campanha e criará um journal NDJSON
append-only antes de autorizar o worker. Receipt,
journal, execução oficial e recovery compartilharão um lock advisory exclusivo
do SO, adquirido sem espera e mantido aberto por toda a vida do processo; uma
segunda invocação falha enquanto o owner existir, e recovery só pode começar
depois de adquirir o mesmo lock já liberado por término/crash. O arquivo de
lock é operacional, ignorado pelo Git e nunca integra evidência. O worker
iniciará a captura no terminal CDP, mas, assim que a expressão física retornar,
enviará por IPC um registro `physical-trial-completed` ao supervisor **antes**
de aguardar o capture promise. O supervisor validará identidade/sequência,
fará append + `fsync` e só então confirmará o IPC; depois receberá o registro
de captura ligado ao mesmo requestId. Portanto um erro de captura não apaga o
trial, e um crash/SIGKILL não depende de um envelope monolítico no stdout.

O primeiro frame fsyncado do journal será `IN_PROGRESS`, com nonce, PID,
opening e deadline total congelado de 600.000 ms. O supervisor vivo precisa
encerrar/cancelar o worker nesse prazo e materializar a invalidação; recovery
só é permitido após adquirir o lock liberado e observar `IN_PROGRESS` sem
report terminal. Assim uma segunda invocação não pode converter uma campanha
ativa em recovery.

Os frames possuem schemas e ordem exatos. `capture-completed` pode conter
somente identidade, requestId, status/código, contagens de leitura, espera
acumulada, SHA-256 e byteLength; body, base64, `Buffer`, `Uint8Array` ou bytes
de áudio são proibidos no IPC, journal e relatório. Validadores e checker
percorrem recursivamente cada artefato, rejeitam chaves extras ou conteúdo
binário e nunca confiam apenas na ausência desses campos no resumo final.

O journal é a fonte bruta completa, não apenas um salvamento dos trials. Em
ordem tipada e fsyncada ele registrará: `IN_PROGRESS` e worker-start do
supervisor; health antes/depois; versão/binding do browser; início/fim de cada
navegação e audit health; cada request/response/terminal/failure de rede;
diagnósticos de console/runtime/HTTP; cada physical trial; cada resultado de
captura; inputs brutos de custo/budget; e outcome terminal do worker. Nenhum
health, ledger, diagnóstico, budget ou envelope terminal poderá existir apenas
dentro do relatório.

O relatório será uma função determinística somente de freeze, opening, receipt
e journal, e o checker reconstruirá boundary, campanha, métricas, gates,
decisão e hash a partir desses bytes. `receipt.consumedAt <= worker.startedAt`
será recalculado dos registros supervisor-owned. Qualquer falha de boundary,
journal, ledger ou captura mantém os fatos brutos, mas torna todos os gates
físicos `NOT_EVALUATED`; nunca haverá passe por `every([])`, coleção parcial,
campo-resumo forjado ou seleção dos trials sobreviventes.

O estado de recuperação fica congelado:

- sem receipt/journal/report: execução oficial fresca pode começar;
- receipt válido + report ausente, com journal ausente, totalmente válido ou
  em estado `TRUNCATED_TAIL`: **recovery-only** depois de adquirir o lock; é
  proibido iniciar worker, Chrome ou rede e uma única invalidação canônica deve
  fechar a tentativa consumida. `TRUNCATED_TAIL` significa no máximo um
  fragmento final sem newline após zero ou mais frames completos válidos. O
  report preserva hash e tamanho do journal inteiro e tamanho/hash da tail,
  além do código de falha. Frames completos anteriores podem aparecer apenas
  como fatos diagnósticos; nenhum prefixo/record sobrevivente entra em gates
  físicos ou é selecionado para conclusão;
- report presente: somente checker; execução e recovery recusados;
- receipt inválido; journal sem receipt válido; frame completo malformado,
  nonce/schema/ordem inválidos ou conteúdo proibido; output extra; ou combinação
  não enumerada: recusa fail-closed, sem report e sem reaproveitar a tentativa.

Freeze, abertura, receipt, journal, relatório e evidência terão paths novos e
topologia Git isolada: C0 → freeze-only → opening-only → evidence. O evidence
commit normal poderá conter somente receipt+journal+report; recovery antes da
criação do journal poderá conter somente receipt+report. Em ambos os casos ele
será filho direto da abertura. Source drift, cardinalidade parametrizada,
segunda execução, segundo recovery ou rerun precisam ser recusados.

## Classes, métricas e projeção

- `PAUSE_THEN_RENDER`: pause ocupa posição anterior no trace serial;
- `RENDER_THEN_PAUSE`: render stopped ocupa posição anterior.

Igualdade numérica dos timestamps não é empate; a posição serial do logger é a
ordem observada. Ausência, duplicidade ou impossibilidade de ordenar os dois
marcadores invalida a coleta e deixa o físico `NOT_EVALUATED`. Em contraste,
um trace estruturalmente válido que exponha lifecycle, efeito, player, estado
ou silêncio semanticamente incorretos é um resultado físico `FIX`, não falha
do instrumento.

A projeção conserva transição e intents; estado do assistente e hold; lifecycle;
render probe e último render stop; efeito, status, estágios e evidências
categóricas. Remove apenas IDs, contadores incrementais, timestamps, latências
e classe. Os campos removidos permanecem no relatório bruto e nos gates
temporais.

Os predicados físicos herdados do EXP-0020 permanecem exatos. Dentro do relógio
do browser, o trigger do render stop deve satisfazer `triggerAtMs ≥` trigger
externo, evento da transição e estágio `accepted`, e `triggerAtMs ≤` primeiro
marcador;
`lastRenderedAtMs ≥ triggerAtMs`, `observedAtMs ≥ lastRenderedAtMs`, e
`latencyMs = lastRenderedAtMs - triggerAtMs` com tolerância máxima de 0,02 ms.
A mesma latência deve aparecer em `renderer-silent`, ficar entre 0 e 250 ms, e
o marcador `render.stopped` não pode anteceder a observação. O stop final deve
permanecer idêntico após o horizonte e não pode haver reativação. Esses campos
usam um único clock do browser; nenhum deles é ordenado contra timestamp CDP.
O aceite do player usa exatamente a regra herdada
`roundHundredth(playerReceivedAt) ≤ roundHundredth(firstMarkerAt)`.

Por classe e no agregado serão reportados contagem, mínimo, mediana, p95
nearest-rank e máximo de latência do STOP, além do gap entre marcadores. Cada
classe exige no mínimo dois trials. Diferenças absolutas entre medianas e entre
p95 das classes precisam ser ≤16,7 ms. Essa margem caracteriza o scheduler
observado; não é alegação de limiar perceptivo.

## Gates obrigatórios

1. boundary, hashes, Node/Chrome, runtime fingerprint, receipt write-once,
   topologia e fontes congeladas válidos;
2. exatamente 2×6 trials e 12 TTS, sem coleção vazia ou parcial interpretada;
3. ledger health/TTS completo sob ordinais globais e política temporal do
   EXP-0023, com bijeção reconstruída entre 12 trials e 12 requestIds;
4. 12 capturas qualificadas, request/status/MIME exatos e o SHA-256/tamanho
   pré-registrados do estímulo;
5. cada trial parte de render ativo, respeita 320 ms + erro 0–10 ms, tem trace
   válido/referencialmente íntegro e exatamente um exemplar ordenável de cada
   marcador;
6. em 12/12 traces válidos há exatamente um lifecycle e um efeito; pause chega
   ao player antes dos marcadores, o efeito completa, output fica
   terminalmente parado e não reativa por ≥250 ms;
7. projeção terminal idêntica nos 12 trials;
8. ambas as classes aparecem ao menos duas vezes e deltas de mediana e p95 são
   ≤16,7 ms;
9. trace e diagnósticos limpos, somente rede local, zero LLM externo, API
   paga, GPU, modelo challenger ou nova autoridade;
10. relatório, decisão e checker pós-commit são reconstruídos dos artefatos e
    não podem passar por vacuidade ou campos-resumo forjados.

## Decisões e precedência

A partição é normativa. São gates de **instrumento**: todo o gate 1; gate 2;
gates 3 e 4; no gate 5, identidade, `startActive`, trigger 320 ms + erro 0–10
ms, janela e schema/referências/marcadores; todo o gate 9, incluindo ambiente,
diagnósticos, rede local e budgets; e gate 10. Qualquer um falso invalida e
deixa o físico `NOT_EVALUATED`. São gates **físicos** somente as semânticas de
lifecycle/efeito/player/estado/silêncio do gate 6 e a projeção do gate 7;
instrumento válido com qualquer um deles falso produz `FIX`. O gate 8 é
avaliado por último: primeiro diversidade, depois equivalência temporal.

| condição prioritária | decisão | próximo movimento |
| --- | --- | --- |
| qualquer gate de instrumento definido acima falso — inclusive environment, timing, diagnostics ou budget | `INVALIDATE_PHYSICAL_STOP_AFTER_CAPTURE_QUALIFICATION` | `physicalMeasurementStatus=NOT_EVALUATED`; reparar sob outro número |
| instrumento válido, mas lifecycle, efeito, player, estado, silêncio, projeção ou latência falha | `FIX_PHYSICAL_STOP_PATH` | resultado físico; corrigir o menor mecanismo e retestar sob novo pré-registro |
| instrumento e todos os gates físicos válidos, mas alguma classe tem menos de 2 trials | `HOLD_ORDER_DIVERSITY` | não repetir; decidir se perturbação controlada vale novo experimento |
| diversidade suficiente, mas delta de mediana ou p95 excede 16,7 ms | `FIX_PHYSICAL_STOP_PATH` | resultado físico temporal; localizar o mecanismo antes de novo teste |
| instrumento, físico, diversidade e equivalência temporal passam | `PASS_TELEMETRY_ORDER_EQUIVALENT` | pré-registrar normalização causal mínima e reavaliar o bridge |

A precedência é `INVALIDATE > FIX > HOLD > PASS`. Todas as decisões mantêm
`authorityEligible=false`, `sameExperimentRerunAllowed=false` e não alteram
retroativamente EXP-0019 ou EXP-0020.

## Alegação máxima

Um passe permitirá afirmar somente que, neste Chrome, dispositivo, runtime e
frase sintética local, as duas ordens de telemetria produziram o mesmo aceite
de pausa, silêncio observado e projeção terminal em 12 STOPs, sem reativação
por pelo menos 250 ms. Não mede alto-falante/sala, fala espontânea, microfone,
ASR, percepção humana, outros schedulers ou robustez de produto.

## Ordem operacional

1. commitar este pré-registro, closeout do EXP-0023 e transição do índice;
2. implementar o menor adaptador EXP-0024, preservando runtime e sem Chrome;
3. testar falhas, vacuidade, projeção, cardinalidade e boundary;
4. auditar instrumento e valor da informação antes de abrir a campanha;
5. commitar C0 e freeze isolado;
6. iniciar servidor/Chrome e concluir preflight sem STOP **antes** da abertura;
   é permitido consultar readiness/CDP, mas não navegar no alvo de automação
   nem gerar qualquer trial oficial;
7. commitar a abertura isolada e não executar outro preflight;
8. iniciar o supervisor oficial, que grava receipt+journal antes de qualquer
   worker, navegação, rede ou comando Chrome da campanha, e executar uma única
   tentativa;
9. commitar receipt+journal+relatório (ou o branch de recovery permitido),
   rodar checker e consolidar sem rerun.

`EXP-0024-R` permanece uma trilha somente documental e não bloqueante:
nenhum download, inferência, API, GPU ou troca de backbone será feito enquanto
o resultado físico ainda puder escolher o mecanismo de maior valor.
