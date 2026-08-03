# EXP-0018 — contexto observável com conteúdo lexical pareado

Status: **instrumentação, crítica cega e fronteira física materializadas e
testadas; freeze pré-fit pendente; fit ainda não autorizado; zero autoridade**

## Decisão que este experimento precisa desbloquear

Descobrir, pelo menor teste informativo, se o contexto conversacional recente
contém sinal incremental para distinguir uma intervenção dirigida ao assistente
de uma fala lateral **quando o microturno atual é lexicalmente idêntico**.

O EXP-0017-R foi encerrado antes do fit: seu destinatário existia sobretudo no
contexto autoral e as famílias lexicais das classes eram diferentes. Além
disso, o alinhamento causal exato não forneceu linhagens independentes
suficientes para os pisos congelados. O EXP-0018 corrige primeiro o constructo,
sem reduzir piso, trocar backbone ou testar ASR real prematuramente.

## Hipótese e mecanismo mínimo

Em pares com o mesmo texto do microturno, um matcher lexical relacional que
compara o alvo com o prefixo audível do assistente e com a fala inbound
imediatamente anterior — sem identidade humana, rótulo ou `intendedContext` —
melhora a decisão shadow em relação ao mesmo controlador que recebe apenas o
microturno.

O mecanismo testado é **seleção lexical entre dois antecedentes com âncoras
explícitas**, não compreensão semântica ampla, paráfrase adversarial,
identificação de voz, prosódia, diarização, ASR, naturalidade ou full-duplex
completo.

## Valor da informação e ordem de custo

1. Construir e auditar apenas cenas textuais pareadas.
2. Executar um teto oráculo local `target-only` versus `target+context`.
3. Cortar se contexto não agregar sob pares válidos.
4. Somente se agregar, materializar o menor subconjunto de áudio necessário
   para testar disponibilidade causal e integração shadow.
5. ASR parcial, modelo maior, GPU/API paga e autoridade permanecem fora desta
   execução.

Assim, não se paga TTS, alinhamento e browser para um constructo que ainda não
demonstrou valor informacional.

## Unidade experimental e matriz mínima

A unidade independente é `crossBlockRootId`; `pairRootId` é apenas a unidade
pareada descritiva. Cada bloco cruzado contém dois alvos (`T0`, `T1`), dois
contextos canônicos (`C0`, `C1`) e o produto cartesiano completo:

- `T0+C0` e `T1+C1` respondem ao prefixo audível do assistente;
- `T0+C1` e `T1+C0` respondem à fala inbound recente;
- cada alvo exato e cada contexto exato reaparecem uma vez por rótulo;
- cada bloco contém dois `pairRootId`, um por alvo, e quatro casos.

Cada raiz pareada contém exatamente dois casos com:

- o mesmo `targetText` normalizado e os mesmos atributos planejados de voz;
- rótulos opostos;
- nenhuma palavra, pontuação ou comprimento do alvo capaz de revelar a classe;
- contextos diferentes, mas ambos plausíveis;
- templates, alvos e linhagens que não atravessam train/calibração/development.

O bloco 2x2 — e não uma coleção solta de pares — é a construção que garante o
contrabalanceamento. Alvo e contexto isolados têm teto empírico exato de 50%;
o sinal pretendido é a **relação de coerência entre eles**. Um saco de palavras
do contexto ou do alvo não pode obter o rótulo apenas por termos que aparecem
de um lado.

`B1` recebe somente:

- `assistantAudiblePrefixAtDecision`, produzido pelo sistema e integralmente
  audível até a decisão, sem texto futuro do output;
- exatamente uma fala inbound recente, sem identidade humana;
- `targetText` causal;
- estado mínimo `assistantSpeaking=true`, igual nos dois braços.

Nesta rodada há exatamente um slot inbound completo anterior ao onset do alvo
e um prefixo audível do assistente em todo caso. Cardinalidade, padding, máscara
e ordem não podem revelar classe.

Ele não recebe `label`, `intendedContext`, nome da condição, ação esperada,
`pairRole`, falante humano verdadeiro nem texto posterior à decisão.
`B0` recebe uma projeção ainda menor, somente `targetText` e
`assistantSpeaking`; o extrator target-only não lê, normaliza nem temporiza os
campos contextuais.

A primeira matriz contém:

- 12 blocos independentes / 24 pares de fit;
- 4 blocos independentes / 8 pares de calibração;
- 8 blocos independentes / 16 pares de development;
- pelo menos quatro famílias: resposta curta, correção, pedido de continuidade
  e instrução/negação;
- pelo menos oito alvos lexicais distintos em development;
- nenhum ancestral semântico compartilhado entre os três papéis.

Isso preserva o custo originalmente previsto de 96 casos, mas torna explícito
que o `n` independente é 12/4/8, não 24/8/16. É um screen barato de mecanismo,
não uma estimativa estável de generalização. Se a fábrica não conseguir esses
pisos sem duplicata/quase-duplicata cruzando papéis, a rodada é cortada antes
do fit.

## Braços

- `D0 — ALL_DIRECTED`: baseline determinística que nunca propõe ignorar a
  fala; não é o checkpoint acústico `A0` do EXP-0017.
- `C0 — context-only`: controle negativo estático; cada contexto canônico
  precisa colidir em rótulos opostos e ter teto empírico de 50%. Não vira
  challenger treinado.
- `B0 — target-only`: controlador local mínimo que recebe apenas o microturno;
  dentro de cada par sua entrada e sua saída devem ser idênticas. Usa a mesma
  dimensão de `B1`, com slots contextuais zerados e máscara explícita desligada.
- `B1 — target+context`: mesmo algoritmo, dimensão e regra de calibração de
  `B0`, acrescentando somente relações explícitas alvo↔prefixo do assistente e
  alvo↔inbound (Jaccard de tokens, cobertura e cosseno de n-gramas de caracteres,
  com deltas) e ligando a máscara correspondente.

`B0` é o controle de atalho lexical. Como o alvo é idêntico no par, qualquer
diferença de sua entrada ou saída entre descendentes invalida a instrumentação.
`B1` é o único challenger. A interação relacional é necessária: features
meramente aditivas de alvo e contexto não separariam o checkerboard. Uma prova
toy com superfícies não vistas precisa passar antes do fit experimental.

## Partição, treino e congelamento

- separação pela maior linhagem (`crossBlockRootId`, ancestral semântico,
  template, alvo e contexto);
- templates e lexemas de contexto contrabalanceados entre classes dentro de
  cada papel, com blocos cruzados mantidos na mesma partição;
- pesos ajustados apenas em `train-fit`;
- limiar escolhido apenas em `train-calibration` para maximizar cobertura de
  fundo sob recall dirigido de 100%;
- código, features, partição e este pré-registro entram no mesmo commit de
  fontes críticas antes do freeze;
- o freeze compromete config, catálogo, três datasets, auditorias, read-set de
  fit, fontes críticas e contratos de permissão; ele próprio precisa ser
  commitado antes do fit;
- fit selado lê apenas config, fit e freeze, produz candidate + attestation e
  ambos precisam ser commitados antes da calibração;
- calibração selada lê apenas config, calibração, freeze, candidate e
  attestation, produz o checkpoint e ele precisa ser commitado antes da
  ativação;
- ativação relê somente a calibração congelada para provar que limiar e tabela
  derivam das predições do checkpoint; ela não recebe development. O consumo
  da abertura não recebe fit, calibração nem development, e cada recibo precisa
  ser commitado em ordem antes do estágio seguinte;
- só então o runner de development recebe o dataset, executa uma única rodada
  de predições `B0`/`B1`, grava features e probabilidades auditáveis contra os
  pesos congelados e emite o relatório canônico;
- antes de conceder essa permissão, o launcher cria com exclusividade (`wx`) um
  recibo de tentativa ligado ao opening; crash, concorrência ou cancelamento
  consomem a tentativa e não autorizam retry silencioso;
- se a tentativa terminar sem relatório, o receipt é commitado e um runner sem
  acesso a development emite `INVALIDATED_SINGLE_DEVELOPMENT_ATTEMPT`: esse
  fechamento técnico tem gates e claim nulos, não decide PASS/CUT e exige novo
  experimento para qualquer nova abertura;
- cada estágio exige worktree limpa, inputs rastreados/commitados, arquivos
  regulares e cadeia de pais sem symlink, fontes iguais ao freeze, ambiente
  sanitizado e allowlists de arquivo exatas pelo Node Permission Model;
- uma attestation train-only compromete integralmente os exemplos lidos pelo
  trainer;
- development e qualquer futuro áudio ficam fora da allowlist física de fit;
- zero holdout e zero alegação confirmatória.

O oracle estrutural (`qual alvo responde a qual antecedente`) vive somente no
catálogo de construção. O dataset entrega ao extrator uma projeção allowlisted
sem oracle, IDs, família, papel, condição ou rótulo. Dois críticos de IA em
contextos isolados leem uma projeção efêmera sem oracle e rejeitam antes do
freeze cenas compatíveis com ambos ou com nenhum antecedente; isso não equivale
a validação humana independente.

## Gates do screen textual

Todos precisam passar:

1. integridade 2x2 e pareada de 100%, zero linhagem cruzando papéis e teto
   target-only/context-only/metadados marginais de exatamente 50%;
2. `B0` com entrada e predição idênticas nos dois lados de todo par;
3. recall de `DIRECTED_TO_ASSISTANT` de `B1` igual a 100%;
4. recall de `BACKGROUND_OR_NOT_DIRECTED` de pelo menos 75%;
5. pelo menos 75% dos pares com os dois descendentes corretos;
6. saldo de vitórias pareadas de pelo menos 4 contra `B0`, ganho positivo em
   pelo menos 6 dos 8 blocos independentes e em todas as quatro famílias;
7. p95 nearest-rank do delta local `B1-B0` menor ou igual a 50 ms, após 20
   warm-ups e 200 repetições intercaladas por caso de calibração, explicitamente
   sem interpretação ponta a ponta;
8. dois fits e duas computações de calibração pré-development com pesos,
   limiares e predições idênticos; depois, uma única rodada de predições em
   development, com trace verificável sem nova decisão do modelo;
9. `canProduceEffects=false`, zero autoridade, zero API/GPU paga.

Com 16 pares de development, esses gates são apenas um screen de viabilidade;
não estimam risco de produção.

## Regras de corte

- falha de integridade ou atalho no alvo: invalidar e corrigir a fábrica, sem
  interpretar qualidade;
- contexto/template/lexema que aparece em apenas uma classe dentro do papel:
  invalidar a fábrica antes do fit;
- cena que crítico sem oracle julga compatível com ambos/nenhum antecedente:
  corrigir antes do freeze ou cortar; depois do freeze não se repara cena;
- nenhum limiar train-only com recall dirigido perfeito: cortar `B1`;
- `B1` sem ganho pareado suficiente: cortar o matcher lexical contextual neste
  desenho, sem alegar que contexto semanticamente mais forte falhou;
- passe textual: congelar `B1` e escrever uma emenda separada antes de gerar
  áudio; não testar ASR ainda;
- necessidade de identidade humana/oráculo de diarização para passar: registrar
  essa dependência e cortar o mecanismo disponível ao runtime atual;
- qualquer tentativa de baixar pisos após cobertura exige novo experimento.
- crash/cancelamento após consumir o receipt: invalidar sem interpretar
  qualidade; nunca apagar o receipt ou repetir sob o mesmo EXP-0018.

## Alegação máxima

Um passe permite afirmar somente que **em cenas sintéticas 2x2 com âncoras
lexicais explícitas, este matcher relacional selecionou entre o antecedente do
assistente e o inbound recente melhor que o alvo isolado**. Ele autoriza o
menor screen causal em áudio do mesmo checkpoint.

Não prova paráfrases ou conflitos lexicais, destinatário em áudio real,
disponibilidade de ASR, diarização, naturalidade, segurança, latência percebida,
generalização humana ou permissão para o runtime ignorar fala.

## Artefatos antes do primeiro fit

- plano 2x2 e card de proveniência;
- auditor de igualdade lexical, duplicatas, linhagens e controles negativos;
- datasets separados de fit, calibração e development;
- prova toy da capacidade relacional;
- duas auditorias cegas de compatibilidade dos antecedentes;
- attestation train-only e freeze-manifest;
- testes adversariais de label/context leakage;
- runner de fit sem acesso físico a development;
- registro explícito de corte se qualquer piso for inviável.

Plano, auditor estrutural, datasets, prova toy, duas leituras cegas, runners
selados e testes adversariais já estão materializados. A primeira leitura
encontrou 12 cenas ambíguas, elas foram reparadas e a reauditoria terminou
24/24 sem bloqueio. A fronteira física separa freeze, fit, calibração, ativação,
consumo da abertura e development por permissões exatas, barreiras de commit e
um receipt single-attempt anterior à leitura de development.
O freeze continua sendo o gate corrente; nenhuma predição ou métrica de
candidato foi calculada em development.
