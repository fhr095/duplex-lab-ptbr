# EXP-0025-R — referência DuplexCascade e controle local de tomada de turno

Status: **trilha local concluída e cortada; `E` autorizado somente para quatro
sentinelas inglesas + `D`; nenhum holdout autorizado; não bloqueante; zero
autoridade**

Evidência corrente: o pack D e o headroom permanecem versionados; o resultado
one-shot de `L` está em
`eval/reports/exp-0025-r-local-holdout-v0.1.json` e no
[closeout local](EXP-0025-R-local-closeout.md). `L` não venceu porque seu p95
pós-final foi 1.200 ms, acima do gate de 800 ms, e foi equivalente a
`A0@600`. Em 03/08/2026, o responsável autorizou a inferência externa `E`
somente nas quatro sentinelas e no desenvolvimento, dentro dos limites já
congelados. Essa autorização não alcança nenhum holdout, outro checkpoint,
sweep, mapeamento, `L2`, API ou modelo.

## Emenda prospectiva antes de E

O `H` existente não é confirmação cega válida para `E`: ele foi selado e
aberto para uma única inferência de `L`, com `authorizedCandidateId=L` e
`externalExecutionAuthorized=false`, antes de existir um adaptador executável
de `E` congelado. Seu estado para E é `INELIGIBLE_FOR_CONFIRMATION`: uma
leitura futura nesse conjunto seria classificada somente como **exploratória**.
Ela está explicitamente proibida nesta rodada.

A sequência agora é terminal e curta:

1. congelar adaptador, sentinelas, entradas, orçamento e critérios de `D`;
2. executar 4/4 sentinelas inglesas; qualquer falha corta `E` antes de `D`;
3. executar uma única passagem de `E` nas 32 falas de `D`, preservando IDs e
   peças de tokens, texto bruto, prompts tokenizados, trajetória e latência;
4. comparar `E` com `A0-native` e `A0@600` por fala e sessão;
5. cortar a frente, ou apenas **justificar o pré-registro** de um holdout
   externo fresco sob novo ID. Nem a criação nem a abertura desse novo holdout
   estão autorizadas por esta emenda.

O contrato versionado desta autorização fica em
`eval/commitments/exp-0025-r-external-development-authorization-v0.1.json`.
Os textos exatos das sentinelas ficam em
`eval/scenarios/exp-0025-r-external-sentinels-v0.1.json`; não serão adaptados
depois de uma saída do modelo.

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
sentinelas em inglês, fora das métricas, verificam não apenas carga, mas as
quatro transições contextuais publicadas: usuário ainda falando → esperar;
usuário terminou → responder; backchannel do usuário enquanto o assistente
fala → manter a fala corrente; interrupção do usuário enquanto o assistente
fala → parar/ceder. As quatro precisam passar antes de executar `E` em `D`.

Se `E` não for executado, qualquer trabalho local será chamado honestamente de
**probe inspirado no mecanismo publicado**, nunca de comparação externa nem de
reprodução comportamental.

### L — reprodução local mínima

O desenho original permitia construir **um** candidato local `L` depois de
observar `E` somente no desenvolvimento. Como `E` ainda não estava autorizado,
essa exceção foi exercida como probe inspirado no artigo: `L` foi congelado,
avaliado e cortado, sem `L2`. Seu contrato mínimo foi:

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
ground truth do final como feature. `A0-native` é consultado a cada frame de
20 ms, como no runtime, e permanece o comparador decisório. Também será
registrada a projeção diagnóstica `A0@600`: o mesmo código, estado, thresholds
e trace de `A0`, mas com ações observáveis somente nos mesmos ticks de 600 ms
de `E/L`. `A0@600` não é challenger e nunca pode vencer, promover ou mudar um
gate; decompõe apenas a penalidade de cadência. O replay preserva o mesmo
relógio em todas as projeções.

### Mapeamento fechado de E

O protocolo será congelado e testado antes de qualquer holdout. No pack
primário, o assistente está silencioso e o usuário detém o piso na fronteira
crítica. Nesse contexto, o primeiro output acionável de cada tick é reduzido:

- `CONTINUE_LISTENING`: `<|user is talking|>` ou
  `<|user is thinking|>`;
- `TAKE_FLOOR`: `<|user finish talking|>` ou primeiro token de texto comum do
  assistente;
- `PROTOCOL_FAILURE`: `<|user backchannel|>` ou
  `<|user interruption|>` com o assistente silencioso, erro, timeout, EOS ou
  ausência de output acionável.

Nas sentinelas com o assistente falando não há projeção binária artificial:
`<|user backchannel|>` significa `KEEP_ASSISTANT_FLOOR` — ignorar o
backchannel e continuar a resposta corrente — e `<|user interruption|>`
significa `YIELD_FLOOR`. Esses resultados validam o protocolo, mas não entram
em `prematureTakeover` ou `postFinalDecisionDelayMs`.

Esse colapso binário mede cessão/tomada do piso. Ele não afirma que tokens
semanticamente distintos são equivalentes em outras tarefas.

## Falas, splits e unidade estatística

O pack será gerado e hasheado antes da primeira inferência candidata. Cada
fala possui roteiro pt-BR, WAV determinístico para proveniência, agenda-oráculo
de palavras/segmentos, sequência de deltas textuais de 600 ms e intervalos de
atividade e silêncio. A agenda não é forced alignment acústico e não entra na
política: ela documenta a receita causal usada para formar os ticks.

A unidade de desenho é um **par de prefixo**: duas falas têm conteúdo e pausa
idênticos até a fronteira crítica. Na integrante `CONTINUES`, a pessoa retoma
e a fronteira é pausa interna não terminal; na integrante `ENDS`, a mesma
fronteira é o final verdadeiro. Isso mede cessão e latência sem deixar uma
tomada prematura contaminar o estimando pós-final.

As políticas não recebem o WAV nem executam ASR; recebem o trace causal
derivado dele. Isso garante as mesmas falas e isola a política, mas não conta
como teste acústico.

- **desenvolvimento `D`:** 32 falas, 16 pares, oito sessões de quatro;
- **holdout local histórico `H-L`:** 48 falas, 24 pares, oito sessões de seis,
  gerado/selado antes da inferência de `L` e depois aberto uma vez somente para
  `L`; é inelegível para confirmar `E`;
- **holdout externo futuro `H-E`:** não existe e não possui ID; só poderá ser
  pré-registrado e materializado depois de um ganho residual qualificado em
  `D`, com conteúdo fresco e autorização separada;
- quatro famílias balanceadas entre pares: hesitação/filler, continuação
  sintática, correção/recomeço e fechamento lexicalmente ambíguo;
- cada `CONTINUES` contém uma pausa não terminal; cada `ENDS` contém exatamente
  um final verdadeiro na fronteira pareada;
- o assistente está silencioso na fronteira crítica de todas as falas de
  `D/H-L`; backchannel/interrupção enquanto o assistente fala pertencem somente
  às sentinelas de protocolo;
- superfícies, nomes e conteúdos não se repetem entre `D` e `H-L`.

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

O diagnóstico de cadência reportará, por fala e agregado,
`A0@600 − A0-native` para atraso/misses e qualquer mudança de tomada prematura.
O resíduo `E − A0@600` descreve desempenho sob a mesma oportunidade de decisão,
mas não substitui a regra de vitória contra `A0-native`.

Uma tomada de piso de `E` anterior ao final verdadeiro de uma integrante
`ENDS` é registrada separadamente como `preFinalTakeover`, não como latência
pós-final negativa. Ela conta como falha e não pode melhorar artificialmente o
p95.

As atribuições são fechadas: falha em qualquer sentinela produz
`E_PROTOCOL_FAILURE` e impede interpretar `D`; sentinelas 4/4 válidas seguidas
de falha pt-BR produzem `PT_BR_TRANSFER_OR_CONTENT_SHIFT`, não “mecanismo
universalmente refutado”. `A0@600` separa a parcela observável de cadência; com
quatro sentinelas não alegaremos separar definitivamente idioma de distribuição
de conteúdo.

## Gate de necessidade antes do custo externo

`A0` roda primeiro somente em `D`. A pergunta permanece aberta se:

- instrumento e pack passam todos os checks;
- há pelo menos 4/16 integrantes `CONTINUES` com tomada prematura pela
  baseline; e
- `A0` não possui `protocolFailure`.

Se `A0` tiver menos de quatro falhas prematuras, o efeito disponível é pequeno
demais para este probe: `CUT_NO_BASELINE_HEADROOM`, sem baixar pesos, alugar
GPU, tornar `D` mais difícil ou olhar `H`.

Resultado de 03/08/2026: o pack materializado contém 16 pares/32 falas e
prefixo PCM idêntico dentro de cada par. `A0-native` teve 8/16 tomadas
prematuras, zero miss e p95 pós-final de 1.060 ms; `A0@600`, apenas
diagnóstico, teve 4/16, zero miss e p95 de 1.200 ms. O gate produziu
`BASELINE_HEADROOM_CONFIRMED`; naquele momento `E` não estava autorizado e
`H-L` ainda não havia sido aberto.

Resultado local posterior, sem reescrever o pré-registro: um único `L`
article-inspired foi congelado antes de gerar `H` e executado uma vez. Em 24
pares, `A0-native` teve 9 tomadas prematuras e `L` teve 4; foram cinco
correções, zero introduções, duas sessões melhoradas, zero miss e zero falha
de protocolo. `L` falhou somente o gate p95 absoluto: 1.200 ms contra 800 ms.
Como foi exatamente equivalente a `A0@600`, a decisão foi
`KEEP_BASELINE_AND_CUT_MICROTURN_CHALLENGER`, sem `L2` ou autoridade. `E`
permaneceu `NOT_EVALUATED_NO_AUTHORIZATION` até a emenda prospectiva acima.

### Gate residual de E em D

`D` é desenvolvimento e não produz alegação confirmatória. Depois de 4/4
sentinelas válidas, um holdout externo fresco só será **recomendado** se todos
os itens abaixo passarem contra `A0@600`:

1. 32/32 falas e 16/16 pares completos;
2. ao menos uma tomada prematura corrigida e ganho líquido positivo;
3. zero tomada prematura introduzida;
4. ao menos uma sessão deixa de falhar e nenhuma sessão segura regride;
5. zero regressão em `missedTakeover` e zero `preFinalTakeover`;
6. p95 pós-final não pior que `A0@600` e máximo ≤1.200 ms;
7. zero `protocolFailure`.

Passar produz somente
`JUSTIFY_FRESH_EXTERNAL_HOLDOUT_PREREGISTRATION`; falhar produz
`CUT_EXTERNAL_MICROTURN_FRONT`. Falha das sentinelas produz
`CUT_E_PROTOCOL_FAILURE` sem ler `D`. Nenhuma folha autoriza `H-E`, altera o
runtime ou abre uma segunda reprodução local.

## Regra histórica de vitória no holdout local e referência para um futuro H-E

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
- um checkpoint, uma base, uma configuração, um preflight de quatro sentinelas
  e uma passagem em `D`; nenhum `H` nesta autorização;
- no máximo **2 GPU-horas** e **US$ 12** de custo externo, valendo o primeiro
  limite atingido;
- gasto foi autorizado em 03/08/2026 somente para sentinelas + `D`, conforme
  `docs/COST_POLICY.md`; qualquer `H-E` exige autorização explícita separada;
- zero sweep, quantização não oficial, troca de modelo ou rerun para escolher
  seed favorável.

O `H-L` consumiu sua única abertura local. Nenhum crash ou resultado de `D`
permite abri-lo para `E`; prefixos não serão selecionados.

## Kill criteria

A trilha é cortada sem substituição automática quando ocorrer o primeiro:

- falta de headroom de `A0` em `D`;
- trace que precise revelar o final verdadeiro como input;
- necessidade de mudar ASR, TTS, voz, conteúdo ou cadence da baseline para
  fazer o challenger caber;
- checkpoint oficial não carrega ou não produz protocolo válido dentro de
  40 GiB, 2 GPU-horas e US$ 12;
- ausência de ambiente GPU fiel dentro do budget mantém
  `E=NOT_EVALUATED_ENVIRONMENT_BLOCKED`, sem trocar silenciosamente por outro
  modelo ou usar o `H-L`;
- `L` exige segundo candidato, modelo grande, rede em runtime, mais de 50 MiB
  ou excede o timebox;
- vazamento, mutação ou segunda abertura do `H-L`;
- nenhum candidato satisfaz a regra de vitória.

Falha de `E` não autoriza afrouxar o mapeamento de tokens. Falha de `L` não
autoriza um `L2`. Lychee-FD, PersonaPlex e outros permanecem no ledger; não são
fila automática desta rodada.

## Árvore de decisão posterior

A tabela abaixo preserva a árvore original para auditabilidade do resultado de
`L`; ela não autoriza reutilizar `H-L` nem reabrir reprodução local. Para a
rodada corrente, a árvore vigente é apenas o gate de `D` acima: cortar E ou
justificar um pré-registro fresco somente de E.

Depois de uma avaliação válida no desenho original de `H`:

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

## Fontes primárias da referência externa

- [artigo oficial DuplexCascade](https://arxiv.org/html/2603.09180);
- [repositório oficial](https://github.com/sbintuitions/DuplexCascade);
- [checkpoint e model card oficiais](https://huggingface.co/sbintuitions/DuplexCascade).
