# Duplex Lab PT-BR

Fundação orientada a testes para construir uma interação de voz full-duplex em
português brasileiro, com um “cérebro” externo substituível.

A direção, os limites das evidências e a estratégia atual estão consolidados na
[referência macro do projeto](docs/PROJECT_REFERENCE.md).

## O que existe hoje

A primeira vertical local já é funcional de ponta a ponta:

- Chrome do Windows captura o microfone em PCM 16 kHz por `AudioWorklet`, com
  AEC, supressão de ruído, AGC, telemetria de gaps e backpressure;
- Silero VAD v6.2 recorrente produz início, pausa, retomada e endpoint no
  backend; energia adaptativa permanece como baseline comparável;
- Whisper `tiny` mantém parciais quentes e Parakeet TDT 0.6B v3 ONNX INT8
  produz a final em CPU;
- uma final especulativa usa a pausa sem ser publicada antes do endpoint;
- troca acidental do Parakeet para inglês ou final vazia recupera a parcial
  local, sem LLM;
- uma janela curta de commit absorve continuações e é maior antes de ações
  corrigíveis;
- `InteractionKernel` v0.1 e um runtime stateful no backend mantêm uma única
  autoridade por sessão para correções e confirmação monetária;
- o navegador valida a transição versionada e apenas projeta intenções, sem
  decidir rollback ou commit em paralelo;
- cérebro local e adaptador OpenAI obedecem ao mesmo contrato cancelável;
- TTS PT-BR aquecido do Windows entrega WAV ao player Web Audio;
- `LocalAudioReflex` evidence-gated aguarda duas janelas Silero durante saída
  já audível, evita pausa por pico isolado e bloqueia a final tardia daquele
  turno quando a acústica e as parciais não o confirmam;
- `OutputInterruptionLifecycle` v0.1 governa hold, retomada e confirmação da
  saída como reducer puro; o Chrome registra e reproduz exatamente cada
  transição, inclusive resultados tardios de `play()`;
- `AcousticReflexShadow` carrega um checkpoint local treinado para
  `WAIT_FOR_EVIDENCE / PAUSE_OUTPUT / CONTINUE_OUTPUT`, registra probabilidades
  sobre PCM hasheado e permanece estruturalmente sem autoridade;
- `SpeakerRelevanceCausalRuntime` carrega o primeiro candidato M4b comparável,
  distingue fala dirigida de fala de fundo em uma janela causal de 560 ms e
  registra a proposta no Chrome sem produzir efeitos;
- fala do usuário mantém a captura contínua, mas cancela resposta, tarefa,
  síntese/player e áudio já enfileirado até o último quantum do renderer;
- campanhas reproduzíveis cobrem fala sintética, CORAA, silêncio, correção,
  delegação, Chrome físico e A/B de endpoint;
- o modo padrão faz zero chamadas pagas, mesmo com chave presente.

Na campanha histórica que fechou a M1, o Chrome passou **27/27 gates em 10/10
execuções**. Em uma entrada textual de automação, o p95 entre o fim sintético
marcado pelo harness e `HTMLAudioElement.onplaying` foi 187 ms; essa métrica
não inclui microfone, VAD, ASR nem a cauda física da sala. O p95 foi 83,21 ms
entre o início do PCM de interrupção e o último quantum renderizado, e 282,1 ms
para retomar após um backchannel. Um soak físico de 600,082 s processou 30.001
frames, sem falsa ativação, gap, drop ou erro. Essa evidência continua válida no
seu escopo; não é o placar da fábrica v0.2.

## Fábrica de avaliações v0.2

A primeira vertical da fábrica está implementada para autocorreções em PT-BR.
A IA fornece superfícies linguísticas diversas, mas blueprints confiáveis
definem slots e comportamento esperado; nenhum modelo gera o próprio oráculo.
O build é imutável, vincula fonte, evaluator e áudio por hash e falha fechado
quando qualquer artefato ou runtime diverge.

Na campanha canônica de 31/07/2026:

- verificação local separada com **223/223 testes**; fábrica com 24 casos em 12
  famílias e **288/288 corrupções de observação rejeitadas pelos oráculos**
  (12 operadores aplicados aos 24 casos);
- 85,7% de cobertura pairwise, 12 WAVs TTS únicos e 12 cenas acústicas;
- operabilidade PCM→VAD→endpoint→ASR promovida em 12/12 casos limpos e 12/12
  com fala baixa/ruído;
- Chrome com entrada textual: **6/6** correções semânticas;
- Chrome com PCM limpo: **5/6** conclusões estritas e **6/6 saídas seguras** —
  o sexto caso perguntou “R$ 150 ou R$ 1.150?” sem registrar commit interno;
- Chrome com ruído branco a 10 dB: **3/6** conclusões estritas e **5/6 saídas
  seguras**;
- parada no renderer em até 50 ms nos cinco casos aplicáveis — não é medição da
  cauda física da sala;
- **zero chamadas pagas e zero tokens externos**.

A toolchain foi promovida; runtime e prontidão de usuário permanecem em
`hold`. Os bloqueadores medidos são falhas de fidelidade do ASR em slots
críticos, segurança sob ruído, efeitos externos ainda sem ledger, temporalidade
ainda parcialmente rotulada, diversidade acústica limitada a uma voz e ausência
de validação humana. O relatório canônico é gerado localmente em
`eval/reports/eval-factory-campaign-v0.2.json`.

O EXP-0014 foi promovido com 324/324 testes. Na fotografia imediatamente após
EXP-0015 e EXP-0016, a suíte possuía **355/355 testes** e também cobria sessão cega,
contrafactuais estéreo, integridade das anotações, fronteira de fit e separação
entre promoção técnica, calibração humana, capacidade aprendida e autoridade.
Os 223/223 acima pertencem à
execução congelada da campanha v0.2 e não são reescritos retrospectivamente.

## Fatias promovidas do runtime comum

O EXP-0010 fechou o ciclo crítico em dois turnos: diante de uma transferência
corrigida, o sistema pergunta o valor sem ecoar a hipótese; somente uma nova
fala com um único valor não negado registra o commit. No Chrome real foram
**5/5 ciclos**, com p95 de 94,9 ms para iniciar a pergunta e 399,9 ms para
aceitar a repetição, sempre sem API paga.

Isso promove a fatia stateful, não o M2.5 inteiro. As quatro sessões físicas
exploratórias daquele experimento continham marcador antigo ou fala sem rótulo;
elas encontraram atividade durante o probe, mas não provaram autoeco.

O EXP-0011 isolou a consequência percebida com A/B causal no mesmo fingerprint.
No controle, um pico marginal seguido da final tardia `I'm` pausou a voz e
criou turno; no candidato, a fala continuou, a final foi descartada e nenhum
turno surgiu. A interrupção PCM legítima permaneceu em **157,39 ms** até o
último quantum, abaixo do teto de 350 ms, e o candidato passou 30,147 s físicos
sem ativação. A decisão é `promote-local-audio-reflex-slice`; causalidade de eco,
cauda da sala e M2.5 completo continuam fora da alegação.

O EXP-0012 removeu a autoridade implícita restante de pausa/retomada do
navegador. Seis fluxos do Chrome foram reproduzidos exatamente pelo mesmo
reducer, cobrindo `idle/held/resuming/confirmed`; o barge-in terminou no
renderer em **183,66 ms**, a retomada PCM ocorreu **312,6 ms** após o fim da
fala e seis corridas assíncronas falharam fechadas. A decisão é
`promote-output-interruption-lifecycle-slice`. O probe físico causal não chegou
a iniciar nesta rodada, portanto seus dois gates permanecem falsos e a
especificidade física global continua em `hold`.

O EXP-0013 materializou a primeira fatia causal de `training-trace-v1` no
caminho real. Seis conversas produziram **28 decisões reproduzidas** e
**22 efeitos encerrados**, com IDs, contexto temporal, rótulo versionado,
reconciliação e projeção v0 baseada somente em silêncio do renderer ou retomada
audível. Os 12 gates formais passaram; o Chrome respondeu em 185 ms, parou o
renderer em 38 ms e fechou onset PCM→silêncio em 169,82 ms. A decisão é
`promote-training-trace-interruption-slice`. Áudio hasheado, posições de
amostra, clocks entre processos, checkpoint e generalização ainda não foram
promovidos.

O EXP-0014 fechou M4a para uma capacidade acústica estreita. Sessenta streams
PCM produziram **330 exemplos** em famílias disjuntas de treino,
desenvolvimento e holdout; o treino local repetido gerou exatamente o mesmo
checkpoint. No Chrome, **11 decisões** cobriram as três classes, tiveram replay
exato, inferência p95 de **0,2 ms**, vínculo de hash/posição de amostra e zero
efeito. A campanha também preservou o barge-in em 151,75 ms e passou 30,072 s
no dispositivo corrente sem falsa ativação. A decisão é
`promote-m4a-acoustic-shadow-infrastructure`: 100% no holdout significa
imitação consistente da regra, não ganho humano ou generalização.

O EXP-0015 fechou o instrumento e a calibração pequena que antecedem M4b.
Doze cenas geraram **36 contrafactuais estéreo**; sete usam trechos
públicos CORAA apenas como âncoras de avaliação, três usam fala sintética local
e duas são controles. Um piloto v0.1 com duas execuções revelou alternativas
byte a byte idênticas apresentadas separadamente, atribuição da fala misturada
ao timing e ausência de distinção entre avaliadores internos e externos.
A v0.2 agrupa os quatro pares equivalentes, aceita empates, pergunta
separadamente se a fala parece dirigida à assistente e preserva comentário
curto opcional somente no armazenamento local. Uma emenda aditiva v0.2.1
passou a aceitar, no controle de silêncio, tanto “não direcionado” quanto “não
consigo saber”; somente “direcionado” falha. O pack e as respostas não foram
alterados. Uma política v0.2.2 passou a contar também conjuntos de ações
consensualmente equivalentes como resolução da cena, sem inventar rótulo
singular ou liberar fit direto. No
Chrome real do Windows, cenas de 2 e 3 opções, empate e atribuição passaram sem
erro ou anotação artificial. A decisão é
`calibration-sufficient-to-freeze-m4b-experiment`: **3/3 participantes
externos**, atenção 77,8% base → 100% emendada e **8/9 cenas resolvidas** — 5
singulares, 3 por conjunto e 1 ambígua. O pack continua com zero rótulos
autorizados para fit direto e nenhuma autoridade sobre o runtime.

O EXP-0016 fechou o primeiro M4b comparável para relevância acústica da fala.
Trinta e seis clips FLEURS PT-BR com licença CC-BY-4.0 geraram **108 exemplos**
em splits de clips e famílias separados; respostas humanas forneceram direção
e avaliação, mas **zero exemplos de fit**. O classificador bruto obteve 77,8%
no holdout contra 50% da regra “toda fala é dirigida”. Nas nove âncoras humanas
resolvidas, o veto conservador acertou **7/9 contra 5/9** e preservou 5/5 falas
dirigidas. Quatro probes no Chrome confirmaram paridade exata com o Node, zero
amostras futuras e zero autoridade. A decisão é
`promote-m4b-speaker-relevance-shadow-candidate`; o veto operacional permanece
em `hold` porque ainda não passa os gates procedurais.

Com o servidor local e o Chrome de depuração abertos, a evidência é reproduzida
por `npm run eval:exp:0013:browser` e consolidada por
`npm run eval:exp:0013:report`. O primeiro comando preserva separadamente os
gates físicos; uma falha ambiental não vira sucesso nem apaga a prova causal
dos caminhos determinísticos.

O ciclo M4a é reproduzido por `npm run eval:exp:0014:data`,
`npm run eval:exp:0014:train`, `npm run eval:exp:0014:browser` e
`npm run eval:exp:0014:report`. Os WAV/PCM pesados e relatórios intermediários
ficam fora do Git; receitas, features, hashes, checkpoint e relatório canônico
são versionados.

O instrumento de calibração é reconstruído e verificado por:

```bash
npm run eval:exp:0015:build
npm run eval:exp:0015:check
npm run eval:exp:0015:serve
```

Ele abre em `http://localhost:4174` e imprime também o IP direto do WSL para o
Chrome do Windows. Com o Chrome de depuração disponível, rode
`npm run eval:exp:0015:browser`; consolide o estado, inclusive quando ainda não
há participantes, com `npm run eval:exp:0015:report`. O smoke técnico nunca
envia uma opinião, para não contaminar a unidade humana de análise.

O ciclo M4b é reproduzido por:

```bash
npm run eval:exp:0016:source
npm run eval:exp:0016:data
npm run eval:exp:0016:train
npm run eval:exp:0016:browser
npm run eval:exp:0016:report
```

Fonte bruta, áudio transformado e relatórios intermediários permanecem fora do
Git. Manifest, features, checkpoint e relatório canônico são versionados.

## Rodar

Requisitos: Node.js 22+, Python 3.12, `uv`, Windows com voz PT-BR e Chrome ou
Chromium. Na primeira execução, o setup instala os runtimes locais e o modelo
Parakeet é baixado para o cache do Hugging Face.

```bash
npm install
npm run setup:asr
npm test
npm run eval
npm start
```

`npm start` sempre usa o provider local e não faz chamadas pagas, mesmo que
exista uma chave no `.env`. Depois, abra `http://localhost:4173` no
Chrome/Chromium do Windows. O servidor escuta em `0.0.0.0` por padrão para
atravessar WSL → Windows e também imprime o IP direto da distro. Use fones no
primeiro teste para reduzir auto-interrupções.

O mesmo comando reproduz o controle promovido da baseline v0.3: Silero VAD
v6.2 com limiar `0.85 × 1`. Para comparar explicitamente o controle legado por
energia, use `npm run start:energy-control`.

O reconhecimento não usa Web Speech nem envia áudio a uma API. A fala é
sintetizada pela voz PT-BR do Windows em WAV e reproduzida por um grafo Web
Audio instrumentado e cancelável.

Para uma conversa real usando a chave do `.env`, a ativação é explícita:

```bash
npm run start:openai
```

Esse modo usa `gpt-5.6-luna` tanto para conversa quanto para delegação, limita
saídas a 160 tokens e aceita no máximo 25 chamadas por processo. Sol nunca é
selecionado automaticamente. Ele exige `OPENAI_TASK_MODEL=gpt-5.6-sol` e
`OPENAI_ALLOW_PREMIUM=true`, além de receber um teto rígido de cinco chamadas
por processo.

Um canário pago de exatamente uma chamada também precisa de autorização
visível:

```bash
ALLOW_PAID_PROBE=1 npm run probe:openai
```

O servidor lê `OPENAI_API_KEY` sem enviá-la ao navegador nem versioná-la. Copie
[`.env.example`](.env.example) para consultar todas as opções.

Cada resposta chega por streaming. Frases completas começam a ser sintetizadas
antes do fim da geração, e uma nova fala aborta tanto o player quanto a chamada
HTTP que ainda estiver em andamento.

Para persistir o relatório da baseline:

```bash
npm run eval:report
```

Para avaliar o trace produzido por outro candidato:

```bash
npm run eval -- --trace caminho/para/trace-bundle.json
```

## Campanha autônoma

Prepare o ASR local uma vez e rode toda a campanha:

```bash
npm run setup:asr
npm run eval:auto
```

Ela roda testes, política, percepção proxy, 21 áudios sintéticos, 12 trechos
humanos espontâneos do CORAA, comparação `base` × Parakeet, campanha
conversacional pelo WebSocket e aplicação no Chrome do Windows. O runner cria
seu servidor em porta livre e faz zero chamadas de API paga.

Essa baseline ampla ainda é separada da fábrica v0.2. Para reconstruir seus
artefatos e oráculos:

```bash
npm run eval:factory
npm run eval:factory:audio
npm run eval:factory:acoustics
npm run eval:factory:check
```

Com o servidor local e o Chrome do Windows abertos, as campanhas canônicas são
`eval:factory:acoustics:run`, `eval:factory:browser`,
`eval:factory:browser:pcm`, `eval:factory:browser:pcm:noise` e, por último,
`eval:factory:summary`. O replay limpo via WebSocket recebe explicitamente o
`live-audio-pack.json` do build informado pelo comando `eval:factory`.

O Parakeet foi promovido sobre a baseline `base`: WER humano caiu de 52,82%
para 38,03% e RTF p50 de 0,46 para 0,13. O produto continua corretamente em
`hold` no gate humano absoluto de 25%, sobretudo por clipes curtos, ruído e
variante PT-PT/PT-BR.

Para reproduzir a baseline anterior:

```bash
ASR_FINAL_ENGINE=whisper ASR_FINAL_MODEL=base npm run eval:auto
npm run eval:asr:compare
```

## Arquitetura em uma frase

Áudio e eventos entram continuamente; a camada de interação decide
`WAIT/BACKCHANNEL/SPEAK/STOP/DELEGATE/CANCEL/ROLLBACK`; tarefas complexas rodam
fora dela e retornam assincronamente; eventos internos usam relógio comparável
e efeitos externos só poderão promover quando houver ledger verificável.

O fechamento M2.5 está em migração incremental. Correção e confirmação crítica
já usam decisão pura (`InteractionKernel`) e autoridade stateful no backend;
o STOP físico imediato usa o `LocalAudioReflex`, e hold/retomada/confirmação da
saída já passam pelo `OutputInterruptionLifecycle` com replay exato. O primeiro
checkpoint acústico roda em shadow sobre traces ligados a PCM. Clocks entre
processos, filas, efeitos externos e a reconciliação ampla com o
kernel/evaluator ainda precisam entrar no mesmo contrato.

## Documentos de decisão

- [Referência macro canônica](docs/PROJECT_REFERENCE.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Produto e hipóteses](docs/PRODUCT.md)
- [Sistema de avaliação](docs/EVALUATION.md)
- [Política de custo e independência](docs/COST_POLICY.md)
- [Ciclo autônomo de evolução](docs/AUTONOMOUS_LOOP.md)
- [Contrato de traces](docs/TRACE_CONTRACT.md)
- [Contrato de trace treinável](docs/TRAINING_TRACE_V1.md)
- [Panorama de modelos em 30/07/2026](docs/research/MODEL_LANDSCAPE_2026-07-30.md)
- [Ledger decisório de challengers](docs/research/CHALLENGER_LEDGER.md)
- [Roadmap por gates](docs/ROADMAP.md)
- [Decisão consolidada de runtime e aprendizado](docs/DECISION_RUNTIME_LEARNING_SEQUENCE.md)
- [Índice verificável de experimentos](eval/EXPERIMENT_INDEX.json)
- [Template de experimento](docs/experiments/TEMPLATE.md)
- [EXP-0000 — baseline concluída](docs/experiments/EXP-0000-policy-baseline.md)
- [EXP-0001 — plano acústico inicial absorvido por campanhas posteriores](docs/experiments/EXP-0001-real-audio-trace.md)
- [EXP-0002 — baseline autônoma concluída](docs/experiments/EXP-0002-autonomous-baseline.md)
- [EXP-0003 — vertical PCM + Parakeet](docs/experiments/EXP-0003-parakeet-full-duplex-vertical.md)
- [EXP-0004 — interrupção e tarefas](docs/experiments/EXP-0004-interruption-and-background-task.md)
- [EXP-0005 — Silero no controle](docs/experiments/EXP-0005-silero-control-candidate.md)
- [EXP-0006 — fábrica v0.2 e correções](docs/experiments/EXP-0006-ai-evaluation-factory.md)
- [EXP-0007 — prefinal acústica determinística](docs/experiments/EXP-0007-deterministic-acoustic-prefinal.md)
- [EXP-0008 — verificador ASR de slot crítico em shadow](docs/experiments/EXP-0008-critical-slot-shadow-asr.md)
- [EXP-0009 — interlock de confirmação monetária](docs/experiments/EXP-0009-critical-amount-confirmation-interlock.md)
- [EXP-0010 — primeira fatia stateful do InteractionKernel](docs/experiments/EXP-0010-stateful-interaction-kernel.md)
- [EXP-0011 — reflexo local com evidência acústica](docs/experiments/EXP-0011-local-audio-reflex.md)
- [EXP-0012 — lifecycle local de interrupção da saída](docs/experiments/EXP-0012-output-interruption-lifecycle.md)
- [EXP-0013 — trace causal e ledger da interrupção](docs/experiments/EXP-0013-training-trace-interruption.md)
- [EXP-0014 — reflexo acústico treinável em shadow](docs/experiments/EXP-0014-acoustic-reflex-m4a.md)
- [EXP-0015 — instrumento cego de calibração de timing](docs/experiments/EXP-0015-timing-calibration-instrument.md)
- [EXP-0016 — relevância acústica da fala em M4b](docs/experiments/EXP-0016-speaker-relevance-m4b.md)
- [EXP-0017 — veto seguro e probe semântico causal](docs/experiments/EXP-0017-safe-veto-and-semantic-probe.md)
- [EXP-0018 — contexto observável com conteúdo pareado](docs/experiments/EXP-0018-context-observability-screen.md)
- [EXP-0018 — fechamento do screen textual](docs/experiments/EXP-0018-closeout.md)
- [EXP-0019 — bridge causal de contexto em áudio](docs/experiments/EXP-0019-causal-audio-context-bridge.md)
- [EXP-0019 — fechamento do bridge causal](docs/experiments/EXP-0019-closeout.md)
- [EXP-0020 — equivalência observável da ordem do STOP no renderer](docs/experiments/EXP-0020-physical-stop-order.md)
- [EXP-0020 — fechamento e invalidação do instrumento](docs/experiments/EXP-0020-closeout.md)
- [EXP-0021 — qualificação fail-closed da captura TTS pelo CDP](docs/experiments/EXP-0021-cdp-capture-recovery.md)
- [EXP-0021 — fechamento e invalidação por cardinalidade de health](docs/experiments/EXP-0021-closeout.md)
- [EXP-0022 — binding causal de bootstrap + audit health](docs/experiments/EXP-0022-bootstrap-audit-health-binding.md)
- [EXP-0022 — fechamento e invalidação por semântica temporal CDP](docs/experiments/EXP-0022-closeout.md)
- [EXP-0023 — semântica causal de ordinais e timestamps CDP](docs/experiments/EXP-0023-cdp-ordinal-timestamp-semantics.md)
- [EXP-0023 — fechamento e passe instrumental](docs/experiments/EXP-0023-closeout.md)
- [EXP-0024 — equivalência física do STOP com captura qualificada](docs/experiments/EXP-0024-physical-stop-after-capture-qualification.md)
- [EXP-0024 — fechamento e invalidação da âncora de render](docs/experiments/EXP-0024-closeout.md)
- [EXP-0025 — âncora causal e STOP renderizado terminal](docs/experiments/EXP-0025-causal-render-onset-physical-stop.md)
- [EXP-0025-R — referência DuplexCascade e controle local de tomada de turno](docs/experiments/EXP-0025-R-duplexcascade-floor-control.md)
- [Baseline de desenvolvimento v0.3](eval/baselines/runtime-baseline-v0.3.json)

## Próximo fechamento

A mecânica local e a fundação da fábrica estão fechadas o bastante para seguir
sem usar pessoas como depuradores de problemas básicos. O EXP-0007 rejeitou a
prefinal acústica, o EXP-0008 encontrou um verificador semanticamente útil mas
lento, e o EXP-0009 bloqueou a confirmação monetária insegura sem LLM. A ordem
executável existe somente no
[roadmap consolidado](docs/ROADMAP.md#ordem-operacional-consolidada): a baseline
v0.3 está congelada e as fatias stateful, de reflexo, lifecycle, trace causal,
M4a e o candidato M4b de relevância em shadow foram promovidas. O instrumento
EXP-0015 concluiu 3/3 participantes externos e liberou o desenho, não o fit.
O EXP-0016 já superou a regra em holdout e reencontrou ganho nas âncoras
humanas. O EXP-0017 Core preservou todas as falas dirigidas, mas acertou só
1/60 fundos e foi cortado sem construir holdout; `A0` permanece referência.
O probe semântico `R` também terminou antes do fit: o mapa causal físico deixou
11/15 e 10/15 linhagens elegíveis por classe, abaixo das 12 independentes
exigidas por seus pisos. O EXP-0018 então isolou o constructo em 24 blocos 2x2,
48 pares e 96 casos. Após freeze, fit e calibração separados por commits, sua
única tentativa de development terminou com 31/32 acertos em `B1` contra 16/32
em `B0`, 15 vitórias líquidas, ganho nos 8/8 blocos e 4/4 famílias e os 12
gates aprovados. O EXP-0019 levou esse matcher a oito cenas de áudio-oráculo:
48 probes não usaram futuro, a paridade Node/Chrome foi exata, a proposta ficou
em p95 de 8,7 ms e o STOP em 56,573 ms. Mesmo assim, o experimento foi cortado
porque a ordem entre `speech.paused` e `render.stopped` variou entre controle,
shadow e repetição; 7/9 gates passaram e nenhuma capacidade ganhou autoridade.
O EXP-0020 abriu esse teste uma única vez, mas o primeiro corpo TTS retornou
vazio pelo CDP. A tentativa foi consumida sem rerun e o físico ficou
`NOT_EVALUATED`. O EXP-0021 recuperou 4/4 respostas TTS com bytes idênticos no
browser e no CDP, mas foi invalidado porque seu contrato esperava um health por
navegação e a página mais o auditor produziram dois. O EXP-0022 distinguiu os
dois healths e repetiu as 4/4 capturas, porém foi invalidado porque comparou
timestamps gerados em pontos diferentes do Chromium: os 40/40 ordinais estavam
corretos enquanto `responseTimestamp > finishedTimestamp`. O EXP-0023 manteve
a mesma campanha sem STOP, mudou somente a autoridade causal e passou 10/10
gates: 4/4 browser=CDP, 40 lifecycles e 120 ordinais globais únicos. O
EXP-0024 integrou esse coletor à campanha física 2×6, mas a tentativa única foi
invalidada no primeiro trial: a fala natural produziu múltiplos
`render.active` e o instrumento exigia exatamente um. Nenhum STOP foi
persistido e o renderer continua `NOT_EVALUATED`. O EXP-0025 está
pré-registrado para escolher o primeiro marcador por posição causal, preservar
os demais e medir somente `STOP-R`: último quantum não silencioso no grafo Web
Audio, não o último som audível na sala. Uma abertura encerra esta família.

Em paralelo, o EXP-0025-R compara a política atual, o checkpoint textual
oficial do DuplexCascade e uma única reprodução local por fala/sessão. A
inferência externa depende de orçamento e autorização de GPU separados; a
trilha não bloqueia o STOP nem concede autoridade.
