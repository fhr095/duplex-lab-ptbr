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

Após o EXP-0010, a suíte corrente possui **270/270 testes**, incluindo a
consistência documental, o kernel puro, isolamento/idempotência de sessões e a
projeção browser. Os 223/223 acima pertencem à execução congelada da campanha
v0.2 e não são reescritos retrospectivamente.

## Primeira fatia do runtime comum

O EXP-0010 fechou o ciclo crítico em dois turnos: diante de uma transferência
corrigida, o sistema pergunta o valor sem ecoar a hipótese; somente uma nova
fala com um único valor não negado registra o commit. No Chrome real foram
**5/5 ciclos**, com p95 de 94,9 ms para iniciar a pergunta e 399,9 ms para
aceitar a repetição, sempre sem API paga.

Isso promove a fatia stateful, não o M2.5 inteiro. Em quatro smokes completos,
a nova semântica passou 4/4, mas a sessão acústica longa passou apenas 1/4 sem
um pico de autoativação causado pela própria fala do assistente. O runtime
global permanece em `hold-acoustic-stability`; o próximo ataque é o
`LocalAudioReflex`, preservando a interrupção rápida.

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
lifecycle acústico, evaluator comum, efeitos e o STOP físico imediato
(`LocalAudioReflex`) ainda precisam entrar no mesmo contrato.

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
- [Roadmap por gates](docs/ROADMAP.md)
- [Decisão consolidada de runtime e aprendizado](docs/DECISION_RUNTIME_LEARNING_SEQUENCE.md)
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
- [Baseline de desenvolvimento v0.3](eval/baselines/runtime-baseline-v0.3.json)

## Próximo fechamento

A mecânica local e a fundação da fábrica estão fechadas o bastante para seguir
sem usar pessoas como depuradores de problemas básicos. O EXP-0007 rejeitou a
prefinal acústica, o EXP-0008 encontrou um verificador semanticamente útil mas
lento, e o EXP-0009 bloqueou a confirmação monetária insegura sem LLM. A ordem
executável existe somente no
[roadmap consolidado](docs/ROADMAP.md#ordem-operacional-consolidada): a baseline
v0.3 está congelada, a primeira fatia do M2.5 foi promovida e o próximo
fechamento é o reflexo local contra autoativação acústica.

Modelos nativos full-duplex continuam no torneio como referências. Eles só
entram cedo quando desafiam uma decisão concreta do contrato/evaluator e só
substituem a cascata quando vencerem os mesmos gates em PT-BR.
