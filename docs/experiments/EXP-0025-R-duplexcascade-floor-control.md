# EXP-0025-R — referência DuplexCascade e controle local de tomada de turno

Status: **pré-registrado; duas etapas separadas; implementação, freeze e
execução ausentes; não bloqueante; zero autoridade**

## Pergunta decisória

Diante da mesma fala pt-BR e da mesma sequência causal de texto incremental,
atividade e silêncio, uma política explícita de microturnos reduz tomadas
prematuras do turno sem impor atraso material depois de finais verdadeiros?

O resultado decide se o próximo investimento nesta capacidade será:

- manter a política atual;
- levar um controlador local de microturnos para shadow;
- registrar uma vantagem externa ainda não reproduzida localmente; ou
- cortar esta hipótese sem abrir uma sequência de modelos.

O EXP-0025-R não altera o runtime e não bloqueia o EXP-0025. Ele testa
**controle de turno**, não STOP, ASR, TTS, prosódia ou naturalidade de voz.

## Duas etapas que não serão confundidas

### E — referência comportamental externa

Executar o **checkpoint oficial** do DuplexCascade somente em sua camada LLM
de microturnos, com tokenizer, pesos e protocolo publicados. ASR e TTS do
DuplexCascade ficam fora; os candidatos recebem o mesmo trace-oráculo derivado
das mesmas falas. Portanto `E` é comparação externa de política, não comparação
end-to-end de sistemas de voz.

Artefatos fixos:

- código GitHub `sbintuitions/DuplexCascade` no commit
  `42893024ca90c8de8ac3ed624467ebc123512ff8`;
- snapshot Hugging Face `sbintuitions/DuplexCascade` no commit
  `dca21cb1309bb533d80f5aa5600c7b0cc2c470e3`;
- `model_state.safetensors`: 17.419.657.672 bytes, ETag LFS
  `603070a3251613328859105fa66fe0711e101099a7b0885da41617f575bed5e9`;
- base `Qwen/Qwen2-7B-Instruct` no commit
  `f2826a00ceef68f0f2b946d945ecc0477ce4450c`;
- `overlap_window_s=0.6`, `max_new_tokens=64`, `do_sample=false`, um único
  seed de infraestrutura e zero prompt livre adicionado.

O card oficial declara idioma `en`. A execução principal continuará usando o
pack pt-BR porque a decisão local é transferência para pt-BR. Uma falha pode
ser atribuível a idioma e não falsifica universalmente o mecanismo; ela apenas
impede promover este checkpoint como referência comportamental local. Quatro
sentinelas em inglês, fora das métricas, verificam que pesos, tokenizer e
protocolo carregaram corretamente.

Se `E` não for executado, qualquer trabalho local será chamado honestamente de
**probe inspirado no mecanismo publicado**, nunca de comparação externa nem de
reprodução comportamental.

### L — reprodução local mínima

Depois de observar `E` somente no conjunto de desenvolvimento, será permitido
construir **um** candidato local `L`, congelado antes de abrir o holdout. Ele
reproduzirá o contrato mínimo de microturnos:

- janela causal de até quatro microturnos de 600 ms;
- delta textual corrente ou `NO_VOICE`, transcrição acumulada, duração de fala,
  duração de silêncio e estado de fala do assistente;
- estado explícito entre `USER_TALKING`, `USER_THINKING` e `USER_FINISHED`;
- saída fechada `CONTINUE_LISTENING` ou `TAKE_FLOOR`.

`L` pode ser uma máquina de estados ou classificador compacto definido no
desenvolvimento, mas não pode usar áudio futuro, rótulo de final, saída de `E`
em inferência, LLM remoto, ASR/TTS novo ou modelo de linguagem grande. A ficha
de freeze de `L` registrará algoritmo, parâmetros, features, código, hashes e
latência antes do holdout. Só haverá um freeze e um candidato local; nenhum
segundo limiar ou `L2` será aberto depois de ver o holdout.

Se `E` estiver `NOT_EVALUATED`, `L` poderá ser construído apenas a partir do
artigo/protocolo público e do desenvolvimento local, com o rótulo
`ARTICLE_INSPIRED_MECHANISM_PROBE`.

## Baseline e ações comparáveis

### A0 — política atual

- baseline canônica `runtime-baseline-ptbr-v0.3` em
  `eval/baselines/runtime-baseline-v0.3.json`, SHA-256
  `3ae781436ab7ea68ae3e87d307dc4afd85feebb79ffd19620986efe5f828146f`;
- controlador `src/interaction/adaptive-endpoint.mjs`, SHA-256 pré-registro
  `e6df7e152c9ef3e621050b2825d64f5ba44221dddff4cd03d9c1c60208bbc2a3`;
- `wait → CONTINUE_LISTENING` e `commit → TAKE_FLOOR`;
- thresholds congelados da baseline: 520 ms para fala linguisticamente
  completa, 1.050 ms para incompleta, 900 ms sem transcrição e hard limit de
  1.500 ms.

`A0`, `E` e `L` recebem a mesma trajetória causal. Nenhum recebe o instante
ground truth do final como feature. `A0` é consultado a cada frame de 20 ms,
como no runtime; `E` e `L` atualizam no grid de 600 ms congelado. O replay
preserva o mesmo relógio e registra quando a ação se torna observável.

### Mapeamento fechado de E

O primeiro output acionável de cada tick é reduzido antes da execução:

- `CONTINUE_LISTENING`: `<|user is talking|>`,
  `<|user is thinking|>` ou `<|user interruption|>`;
- `TAKE_FLOOR`: `<|user finish talking|>`, `<|user backchannel|>` ou primeiro
  token de texto comum do assistente;
- `PROTOCOL_FAILURE`: erro, timeout, EOS ou ausência de output acionável.

Esse colapso binário mede cessão/tomada do piso. Ele não afirma que tokens
semanticamente distintos são equivalentes em outras tarefas.

## Falas, splits e unidade estatística

O pack será gerado e hasheado antes da primeira inferência candidata. Cada
fala possui roteiro pt-BR, WAV determinístico para proveniência, alinhamento de
palavras, sequência de deltas textuais de 600 ms e intervalos de atividade e
silêncio.

A unidade de desenho é um **par de prefixo**: duas falas têm conteúdo e pausa
idênticos até a fronteira crítica. Na integrante `CONTINUES`, a pessoa retoma
e a fronteira é pausa interna não terminal; na integrante `ENDS`, a mesma
fronteira é o final verdadeiro. Isso mede cessão e latência sem deixar uma
tomada prematura contaminar o estimando pós-final.

As políticas não recebem o WAV nem executam ASR; recebem o trace causal
derivado dele. Isso garante as mesmas falas e isola a política, mas não conta
como teste acústico.

- **desenvolvimento `D`:** 32 falas, 16 pares, oito sessões de quatro;
- **holdout `H`:** 48 falas, 24 pares, oito sessões de seis, gerado/selado antes da
  inferência e não aberto ao implementar `L`;
- quatro famílias balanceadas entre pares: hesitação/filler, continuação
  sintática, correção/recomeço e fechamento lexicalmente ambíguo;
- cada `CONTINUES` contém uma pausa não terminal; cada `ENDS` contém exatamente
  um final verdadeiro na fronteira pareada;
- superfícies, nomes e conteúdos não se repetem entre `D` e `H`.

As métricas são calculadas por **fala**, mas a unidade estatística primária é o
**par de prefixo** (`n=24` no holdout), porque suas duas integrantes não são
independentes. A sessão (`n=8`) é cluster operacional e unidade secundária de
falha. Microturnos e janelas não são amostras independentes; acurácia por
janela será apenas diagnóstico e nunca gate.

## Métricas por fala e sessão

Para cada fala e candidato:

1. em `CONTINUES`, `prematureTakeover`: houve `TAKE_FLOOR` antes da retomada;
2. em `ENDS`, `postFinalDecisionDelayMs`: primeiro `TAKE_FLOOR` menos o
   instante ground truth do final pareado;
3. em `ENDS`, `missedTakeover`: nenhum `TAKE_FLOOR` até +1.200 ms do final;
4. `protocolFailure`: ação ausente ou fora do contrato;
5. trajetória completa de ações, preservada para auditoria sem virar unidade
   estatística adicional.

Por sessão:

- `sessionPrematureTakeover`: ao menos uma fala com tomada prematura;
- contagem de falas prematuras e `missedTakeover` por sessão.

No agregado serão reportados contagem/taxa, pares discordantes contra `A0` e,
para atraso, mínimo, mediana, p95 nearest-rank e máximo. Latência wall-clock de
inferência será registrada separadamente; por depender do hardware remoto, não
substitui o atraso lógico da política.

## Gate de necessidade antes do custo externo

`A0` roda primeiro somente em `D`. A pergunta permanece aberta se:

- instrumento e pack passam todos os checks;
- há pelo menos 4/16 integrantes `CONTINUES` com tomada prematura pela
  baseline; e
- `A0` não possui `protocolFailure`.

Se `A0` tiver menos de quatro falhas prematuras, o efeito disponível é pequeno
demais para este probe: `CUT_NO_BASELINE_HEADROOM`, sem baixar pesos, alugar
GPU, tornar `D` mais difícil ou olhar `H`.

## Regra de vitória no holdout

Cada candidato (`E` e `L`) vence `A0` somente se **todos** os itens passarem:

1. 48/48 falas e 24/24 pares válidos, sem futuro, vazamento de rótulo ou
   seleção;
2. ao menos quatro falas em que `A0` foi prematura e o candidato não;
3. zero fala em que `A0` foi segura e o candidato introduziu tomada prematura;
4. ao menos duas sessões deixam de conter falha prematura e nenhuma sessão
   segura regride;
5. `missedTakeover` não excede `A0`;
6. p95 de `postFinalDecisionDelayMs` absoluto ≤800 ms, delta de p95 contra
   `A0` ≤300 ms e máximo ≤1.200 ms;
7. zero `protocolFailure`.

O piso de quatro melhorias representa 16,7 pontos percentuais entre as 24
integrantes `CONTINUES` do holdout e é
um gate material de desenvolvimento, não inferência populacional. Empate ou
melhora que compre segurança ao custo de latência fora do gate conta como
**não venceu**.

Para `L`, há ainda gate de viabilidade: inferência CPU p95 ≤20 ms no hardware
local de referência, artefato total ≤50 MiB e zero rede em execução.

## Budget e timebox

### Preparação e candidato local

- pack, adaptador, baseline e freeze externo: até **8 horas de engenharia
  focada**;
- interpretação de `D`, construção e freeze de `L`: mais **8 horas**;
- um pack, um adaptador externo, um candidato local e uma abertura de holdout;
- zero API de LLM paga, zero pessoa humana e zero alteração produtiva;
- nenhuma regeneração de `D/H` depois de observar uma saída candidata.

### Checkpoint externo

- no máximo 40 GiB de download total;
- um checkpoint, uma base, uma configuração, um preflight de quatro sentinelas,
  uma passagem em `D` e uma passagem em `H`;
- no máximo **2 GPU-horas** e **US$ 12** de custo externo, valendo o primeiro
  limite atingido;
- gasto continua **não autorizado** por este pré-registro: exige autorização
  explícita separada conforme `docs/COST_POLICY.md`;
- zero sweep, quantização não oficial, troca de modelo ou rerun para escolher
  seed favorável.

O holdout tem uma única abertura. Crash ou artefato incompleto depois da
abertura invalida a trilha; prefixos não serão selecionados.

## Kill criteria

A trilha é cortada sem substituição automática quando ocorrer o primeiro:

- falta de headroom de `A0` em `D`;
- trace que precise revelar o final verdadeiro como input;
- necessidade de mudar ASR, TTS, voz, conteúdo ou cadence da baseline para
  fazer o challenger caber;
- checkpoint oficial não carrega ou não produz protocolo válido dentro de
  40 GiB, 2 GPU-horas e US$ 12;
- ausência de autorização explícita para GPU mantém `E=NOT_EVALUATED`, sem
  trocar silenciosamente por outro modelo;
- `L` exige segundo candidato, modelo grande, rede em runtime, mais de 50 MiB
  ou excede o timebox;
- vazamento, mutação ou segunda abertura do holdout;
- nenhum candidato satisfaz a regra de vitória.

Falha de `E` não autoriza afrouxar o mapeamento de tokens. Falha de `L` não
autoriza um `L2`. Lychee-FD, PersonaPlex e outros permanecem no ledger; não são
fila automática desta rodada.

## Árvore de decisão posterior

Depois de uma avaliação válida em `H`:

| E vence A0 | L vence A0 | decisão terminal | próximo movimento permitido |
| --- | --- | --- | --- |
| sim | sim | `PROMOTE_PORTABLE_MICROTURN_MECHANISM_TO_SHADOW` | levar somente `L` a um novo pré-registro shadow pt-BR; `E` permanece referência sem dependência produtiva |
| sim | não | `EXTERNAL_ADVANTAGE_NOT_REPRODUCED` | registrar o gap, cortar esta reprodução e manter runtime; nenhuma segunda hipótese local nesta rodada |
| não | sim | `PROMOTE_LOCAL_FLOOR_CONTROL_TO_SHADOW_WITHOUT_EXTERNAL_CLAIM` | levar `L` a shadow; não chamar o resultado de reprodução do DuplexCascade |
| não | não | `KEEP_BASELINE_AND_CUT_MICROTURN_CHALLENGER` | manter `A0`, fechar a frente e voltar ao maior gargalo percebido |

Casos adicionais:

- `E=NOT_EVALUATED`, `L` vence: mesma decisão local da terceira linha, com
  rótulo `ARTICLE_INSPIRED`; nenhuma alegação de comparação externa;
- `E` vence, `L=NOT_EVALUATED`: registrar vantagem externa sem movimento de
  runtime e encerrar;
- instrumento/holdout inválido: `INVALIDATE_EXP_0025_R`, qualidade
  `NOT_EVALUATED`, sem rerun sob o mesmo ID.

“Não” na tabela inclui empate. Nenhuma folha concede autoridade de runtime,
autoriza treino de backbone ou torna uma dependência externa padrão.

## Alegação máxima

`E` vencedor permite afirmar apenas que o checkpoint oficial, executado em sua
camada textual de microturnos e reduzido ao contrato binário, superou a política
atual nestas falas pt-BR oracle-trace. Não demonstra DuplexCascade end-to-end,
ASR, TTS, áudio simultâneo ou qualidade de voz.

`L` vencedor permite afirmar apenas que um controlador local compacto reduziu
tomadas prematuras sob o gate de atraso no holdout congelado. Promoção para
shadow, áudio real ou autoridade exige experimento novo.
