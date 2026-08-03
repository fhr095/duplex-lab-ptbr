# EXP-0025 — âncora causal de render e STOP físico observável

Status: **pré-registrado; implementação, freeze, abertura e execução ausentes;
zero autoridade**

## Decisão de maior valor agora

Determinar se a campanha física de STOP pode ser medida de forma válida quando
o início é ancorado no primeiro `assistant.render.active` posterior ao reset,
sem confundir retomadas acústicas naturais antes do STOP com uma nova
reprodução e sem perder evidência quando uma pré-condição falha.

O EXP-0024 não mediu a física: ele refutou a premissa instrumental de que uma
fala em loop teria exatamente um `render.active` inicial. O menor challenger
não altera produto ou modelo. Ele muda somente a semântica de coleta e torna o
resultado parcial obrigatório.

## Relação com a evidência anterior

- o EXP-0020 permanece invalidado e fisicamente `NOT_EVALUATED`;
- os EXP-0021 e EXP-0022 permanecem diagnósticos invalidados;
- o EXP-0023 continua sendo a qualificação prospectiva do coletor CDP;
- o EXP-0024 permanece uma tentativa única invalidada, sem rerun ou
  reinterpretação;
- o EXP-0025 é um experimento novo e prospectivo.

As dez fontes produtivas congeladas desde o EXP-0019 deverão continuar byte a
byte idênticas. O C0 poderá modificar somente instrumentação, schemas,
analisador e testes EXP-0025. Challengers de modelo continuam fora da execução,
pois ainda não existe falha física ou percebida que justifique um backbone.

## Hipótese instrumental mínima

Depois de um reset com trace vazio:

1. `speakLoop` produz ao menos um `assistant.render.active` com tempo finito;
2. o primeiro evento por posição no trace é uma âncora causal estável para
   planejar o trigger a +320 ms;
3. zero ou mais `render.active` adicionais antes do STOP são segmentos da mesma
   reprodução e permanecem fatos brutos, não falhas de cardinalidade;
4. nenhum `render.active` pode aparecer depois do marcador de STOP mais tardio
   durante o horizonte terminal de pelo menos 250 ms;
5. a multiplicidade que invalidou o EXP-0024 precisa aparecer em pelo menos um
   trial para que o novo tratamento seja considerado exercitado.

Se a multiplicidade não aparecer, a campanha pode preservar seus fatos, mas
não qualifica a mudança e termina em hold. Se aparecer e os demais gates forem
válidos, os predicados físicos podem ser avaliados.

## Campanha fixa

- Chrome 150 do Windows por CDP a partir do WSL;
- servidor local, `BRAIN_PROVIDER=local`, ASR desligado, VAD adaptativo por
  energia e shadow desligado;
- alvo `http://localhost:4173/?automation=1&experiment=0025`;
- duas navegações completas e seis STOPs por navegação, total 12;
- frase “Esta fala contínua mede uma única parada física do assistente.”;
- rate 1, mesma voz PT-BR, mesmo processo e mesmo fingerprint;
- um reset e um turnId novo por trial;
- trigger planejado 320 ms após a âncora selecionada, erro de 0 a 10 ms;
- horizonte mínimo de 250 ms após o marcador de STOP mais tardio;
- exatamente 12 TTS sequenciais, um por trial;
- mesma captura CDP qualificada, SHA-256 e tamanho pré-fixados no EXP-0024.

Não haverá repetição para fabricar multiplicidade acústica ou diversidade de
ordem do scheduler.

## Semântica prospectiva da âncora

Para cada trial, o coletor deverá preservar:

- snapshot imediatamente após o reset;
- snapshot que primeiro satisfez `assistantSpeaking=true` e contém ao menos um
  `assistant.render.active`;
- lista completa e índices de todos os `render.active` anteriores ao trigger;
- índice e cópia exata da âncora escolhida;
- plano, instante real e erro do trigger;
- snapshots nos marcadores e no horizonte terminal;
- todos os marcadores posteriores, inclusive qualquer reativação.

A âncora é o primeiro `render.active` por posição no trace depois do reset.
Timestamp não desempata posição causal e nenhum evento posterior pode
substituí-la porque produziu um timer mais conveniente. Todos os eventos ativos
presentes no snapshot inicial precisam preceder o trigger real. O trigger não
pode ser retroativo; se o primeiro evento já estiver mais de 10 ms além da
janela planejada quando observado, o trial é falha instrumental tipada.

## Resultado tipado obrigatório

A expressão do browser não poderá encerrar o trial com `throw` antes de
produzir evidência. Ela retornará exatamente um resultado fechado:

- `COLLECTED`, com o bundle físico completo; ou
- `INSTRUMENT_FAILURE`, com fase, código, mensagem limitada, identidade,
  requestId quando conhecido e todos os snapshots/marcadores já observados.

O worker persistirá esse resultado e aguardará ACK fsyncado antes de qualquer
join de captura ou início de outro trial. Erro de CDP, serialização ou IPC ainda
pode encerrar o worker, mas o supervisor materializará a falha sem promover
prefixos sobreviventes. Body, base64 e bytes de áudio continuam proibidos no
IPC, journal e relatório.

Receipt write-once, journal NDJSON append-only, lock exclusivo do SO, deadline
total, recovery fail-closed e topologia C0 → freeze → opening → evidence serão
novos e isolados para o EXP-0025. Nenhum artefato EXP-0024 será sobrescrito.

## Predicados físicos

Depois da qualificação da âncora, permanecem os predicados físicos do
EXP-0020/0024:

- exatamente um lifecycle `idle → held` por `PAUSE_REQUESTED`;
- exatamente um efeito `PAUSE_OUTPUT` em todos os estágios até `completed`;
- player presente e pausado antes dos dois marcadores de STOP;
- exatamente um `assistant.speech.paused` e um
  `assistant.render.stopped`, ordenados pela posição serial do trace;
- render stop causal ao trigger, latência entre 0 e 250 ms e mesma latência no
  estágio `renderer-silent`;
- `assistantSpeaking=false`, hold instalado, probe sem medição pendente e
  render stop estável no horizonte;
- nenhum `assistant.render.active` depois do marcador mais tardio;
- projeção terminal idêntica removendo somente identidade, relógios, contagens
  acústicas pré-trigger e classe;
- ambas as classes de ordem com ao menos dois trials e deltas de mediana e p95
  de latência de no máximo 16,7 ms.

Eventos `render.active` adicionais antes do STOP ficam no relatório bruto e em
métricas de contagem/gap. Eles não são removidos da evidência, apenas da
projeção terminal de equivalência.

## Gates obrigatórios

1. boundary, commits, hashes, runtime, Chrome, receipt, lock e recovery válidos;
2. exatamente 2×6 resultados tipados e 12 TTS sem seleção de sobreviventes;
3. ledger health/TTS ordinal completo, local e bijetivo;
4. 12 capturas qualificadas com SHA-256 e tamanho pré-registrados;
5. 12 âncoras iguais ao primeiro `render.active` pós-reset, com trigger
   320 ms + erro 0–10 ms e snapshots referenciais íntegros;
6. ao menos um trial com mais de um `render.active` pré-STOP, exercitando a
   correção instrumental;
7. zero resultado `INSTRUMENT_FAILURE`, diagnóstico ou stderr;
8. predicados de lifecycle, efeito, player, silêncio e estado terminal em
   12/12 trials;
9. projeção terminal equivalente, diversidade mínima por classe e margem
   temporal satisfeita;
10. zero LLM externo, API paga, GPU, challenger, backbone ou nova autoridade;
11. relatório e checker reconstruídos exclusivamente dos artefatos reais.

## Decisões congeladas

- falha de boundary, journal, rede, captura, âncora ou resultado tipado:
  `INVALIDATE_CAUSAL_RENDER_ONSET_INSTRUMENT`, físico `NOT_EVALUATED`;
- instrumento válido, mas nenhuma multiplicidade pré-STOP observada:
  `HOLD_RENDER_ONSET_DELTA_NOT_EXERCISED`;
- instrumento válido e falha de lifecycle, efeito, silêncio, estado ou margem:
  `FIX_PHYSICAL_STOP_PATH`;
- físico válido, mas menos de dois trials em alguma classe:
  `HOLD_ORDER_DIVERSITY`;
- todos os gates válidos:
  `PASS_CAUSAL_RENDER_ONSET_AND_TELEMETRY_ORDER_EQUIVALENT`.

Todas as decisões mantêm `authorityEligible=false` e
`sameExperimentRerunAllowed=false`.

## Valor da informação e regra de corte

Este movimento vale porque corrige a única falha observada, não altera produto
e, se falhar de novo, preservará o estado exato que faltou no EXP-0024. Se o
primeiro marcador causal não puder ser observado dentro da janela ou se a
multiplicidade revelar players/gerações distintos, a normalização será cortada
e o próximo passo será instrumentar identidade de reprodução — não alargar
heurísticas nem trocar arquitetura.
