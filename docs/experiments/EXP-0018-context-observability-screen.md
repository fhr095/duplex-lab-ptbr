# EXP-0018 — contexto observável com conteúdo lexical pareado

Status: **pré-registrado; instrumentação ainda não materializada; zero
autoridade**

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

Em pares com o mesmo texto do microturno, acrescentar uma janela curta de
contexto — último turno conhecido do assistente e fala ambiente imediatamente
anterior, sem identidade do humano, rótulo ou `intendedContext` — melhora a
decisão shadow de relevância em relação ao mesmo controlador que recebe apenas
o microturno.

O mecanismo testado é **coerência contextual de microturno**, não identificação
de voz, prosódia, diarização, ASR, naturalidade ou full-duplex completo.

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

A unidade decisiva é `pairRootId`. Cada raiz contém exatamente dois casos com:

- o mesmo `targetText` normalizado e os mesmos atributos planejados de voz;
- rótulos opostos;
- nenhuma palavra, pontuação ou comprimento do alvo capaz de revelar a classe;
- contextos diferentes, mas ambos plausíveis;
- templates, alvos e linhagens que não atravessam train/calibração/development.

Os pares são agrupados também em blocos cruzados: cada template/contexto de
superfície e cada família lexical contextual precisa aparecer nas duas classes
dentro do mesmo papel experimental. Alvo e contexto isolados ficam
contrabalanceados; o sinal pretendido é a **relação de coerência entre eles**.
Um saco de palavras do contexto não pode obter o rótulo apenas por termos que
só aparecem de um lado.

O candidato recebe somente:

- `assistantLastTurn`, produzido pelo próprio sistema e portanto conhecido;
- zero ou mais falas inbound recentes, sem identidade humana;
- `targetText` causal;
- estado mínimo `assistantSpeaking=true`, igual nos dois braços.

Ele não recebe `label`, `intendedContext`, nome da condição, ação esperada,
`pairRole`, falante humano verdadeiro nem texto posterior à decisão.

A primeira matriz deve conter, no mínimo:

- 24 pares de fit;
- 8 pares de calibração;
- 16 pares de development;
- pelo menos quatro famílias: resposta curta, correção, pedido de continuidade
  e instrução/negação;
- pelo menos oito alvos lexicais distintos em development;
- nenhum ancestral semântico compartilhado entre os três papéis.

Se a fábrica não conseguir esses pisos sem duplicata/quase-duplicata, a rodada
é cortada antes do fit.

## Braços

- `D0 — ALL_DIRECTED`: baseline determinística que nunca propõe ignorar a
  fala; não é o checkpoint acústico `A0` do EXP-0017.
- `B0 — target-only`: controlador local mínimo que recebe apenas o microturno;
  dentro de cada par sua entrada e sua saída devem ser idênticas. Usa a mesma
  dimensão de `B1`, com slots contextuais zerados e máscara explícita desligada.
- `B1 — target+context`: mesmo algoritmo, dimensão e regra de calibração de
  `B0`, acrescentando somente a janela contextual permitida e ligando a máscara
  correspondente.

`B0` é o controle de atalho lexical. Como o alvo é idêntico no par, qualquer
diferença de sua saída entre descendentes invalida a instrumentação. `B1` é o
único challenger.

## Partição, treino e congelamento

- separação pela maior linhagem (`pairRootId`, template semântico e alvo);
- templates e lexemas de contexto contrabalanceados entre classes dentro de
  cada papel, com blocos cruzados mantidos na mesma partição;
- pesos ajustados apenas em `train-fit`;
- limiar escolhido apenas em `train-calibration` para maximizar cobertura de
  fundo sob recall dirigido de 100%;
- código, features, partição, limiar e checkpoint commitados antes de uma única
  passagem por development;
- uma attestation train-only compromete integralmente os exemplos lidos pelo
  trainer;
- development e qualquer futuro áudio ficam fora da allowlist física de fit;
- zero holdout e zero alegação confirmatória.

## Gates do screen textual

Todos precisam passar:

1. integridade pareada de 100% e zero alvo/linhagem cruzando papéis;
2. `B0` com entrada e predição idênticas nos dois lados de todo par;
3. recall de `DIRECTED_TO_ASSISTANT` de `B1` igual a 100%;
4. recall de `BACKGROUND_OR_NOT_DIRECTED` de pelo menos 75%;
5. pelo menos 75% dos pares com os dois descendentes corretos;
6. ganho líquido pareado por raiz de pelo menos 4 contra `B0` e positivo contra
   `D0`;
7. p95 local do delta contextual menor ou igual a 50 ms, explicitamente sem
   interpretação ponta a ponta;
8. duas execuções com pesos e predições idênticos;
9. `canProduceEffects=false`, zero autoridade, zero API/GPU paga.

Com 16 pares de development, esses gates são apenas um screen de viabilidade;
não estimam risco de produção.

## Regras de corte

- falha de integridade ou atalho no alvo: invalidar e corrigir a fábrica, sem
  interpretar qualidade;
- contexto/template/lexema que aparece em apenas uma classe dentro do papel:
  invalidar a fábrica antes do fit;
- nenhum limiar train-only com recall dirigido perfeito: cortar `B1`;
- `B1` sem ganho pareado suficiente: cortar contexto semântico neste desenho;
- passe textual: congelar `B1` e escrever uma emenda separada antes de gerar
  áudio; não testar ASR ainda;
- necessidade de identidade humana/oráculo de diarização para passar: registrar
  essa dependência e cortar o mecanismo disponível ao runtime atual;
- qualquer tentativa de baixar pisos após cobertura exige novo experimento.

## Alegação máxima

Um passe permite afirmar somente que **contexto textual recente, quando
disponível e sob pares sintéticos controlados, contém sinal incremental além do
microturno isolado**. Ele autoriza o menor screen causal em áudio do mesmo
checkpoint.

Não prova destinatário em áudio real, disponibilidade de ASR, diarização,
naturalidade, segurança, latência percebida, generalização humana ou permissão
para o runtime ignorar fala.

## Artefatos esperados antes do primeiro fit

- plano de pares e card de proveniência;
- auditor de igualdade lexical, duplicatas e linhagens;
- datasets separados de fit, calibração e development;
- attestation train-only e freeze-manifest;
- testes adversariais de label/context leakage;
- runner de fit sem acesso físico a development;
- registro explícito de corte se qualquer piso for inviável.
