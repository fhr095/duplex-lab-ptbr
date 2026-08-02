# EXP-0017 — veto seguro e probe semântico causal

Status: **emenda pré-fit vigente; artefatos operacionais realinhados;
development-screen não executado; zero autoridade**

Este documento congela a pergunta, a ordem das comparações e as regras de
corte antes de materializar resultados. O EXP-0017 tem um caminho acústico
(`Core`) e um probe semântico curto (`R`). Nesta execução, ambos são somente
screens de desenvolvimento. Nenhum braço consome evidência confirmatória e
nenhum resultado desta execução pode conceder autoridade ao runtime.

## Emenda pré-fit — invalidação do holdout MSWC

Uma auditoria de desenho feita **antes de qualquer fit, seleção de limiar ou
métrica de candidato** invalidou o papel confirmatório originalmente atribuído
ao conjunto MSWC:

- os arquivos de origem, planos, labels, manifest e payload estavam acessíveis
  ao mesmo ambiente de desenvolvimento; o commitment garantia integridade dos
  bytes, mas não cegamento do pesquisador ou do trainer;
- cada exemplo contém uma palavra humana isolada. O contexto
  “dirigido ao assistente” ou “fala de fundo” existe no metadado procedural,
  mas não está presente de forma audível no sinal;
- o vocabulário também não está contrabalanceado entre as classes, permitindo
  que conteúdo lexical ou propriedades acústicas da palavra funcionem como
  atalho para o rótulo.

Essa invalidação é uma conclusão sobre o **constructo experimental**, não um
resultado de modelo. Nenhuma métrica de `A0`, `A`, `B` ou `C` motivou a
invalidação. Os artefatos MSWC foram retirados do conjunto operacional; eventual
cache local ignorado pelo Git não participa desta execução. O corpus só poderá
ser retomado em outro diagnóstico explicitamente separado e nunca poderá ser
chamado de holdout, confirmar segurança, identificação de destinatário ou
generalização humana.

O EXP-0017 passa, portanto, a terminar em uma decisão de
`qualifica/não qualifica em desenvolvimento`. Somente se `A` qualificar, seu
checkpoint, limiar e regra serão congelados e será escrito **outro
pré-registro** para um novo holdout, opaco e com contexto audível. Esse novo
holdout será construído apenas depois do novo pré-registro e não pertence aos
resultados desta execução.

Até serem realinhados com esta emenda, configurações, manifests, commitments,
payloads e contratos que ainda tratem MSWC como `holdout-core` estão
superseded e não podem ser usados para treino ou avaliação. Eles podem ser
preservados imutáveis apenas como trilha de auditoria; sua existência não
constitui abertura válida nem resultado experimental.

## Decisões que este experimento desbloqueia

1. A família acústica compacta do EXP-0016 produz sinal suficiente em
   desenvolvimento para justificar o custo de construir uma confirmação
   independente, ou deve permanecer apenas em shadow?
2. Texto parcial causal contém valor incremental suficiente para tornar um
   controlador semântico mínimo o próximo challenger confirmatório, ou deve ser
   cortado como mecanismo de relevância/veto neste ponto de decisão?

O experimento não escolhe um backbone full-duplex, não reproduz
DuplexCascade e não concede autoridade. Sua saída máxima no Core é autorizar o
pré-registro e a construção de um holdout válido; em `R`, é justificar ou
cortar um teste confirmatório semântico independente.

## Limites da rodada

- no máximo **duas hipóteses**: uma do `Core` e uma do probe `R`;
- no máximo **um challenger ativo por vez**;
- os braços `B` e `C` são duas etapas do mesmo challenger semântico, não duas
  arquiteturas concorrentes;
- nenhuma GPU ou API paga por padrão;
- nenhum fine-tuning de modelo grande e nenhuma troca de arquitetura;
- somente componentes locais/abertos e execução reproduzível;
- o reflexo físico de `PAUSE/STOP` permanece autoritativo e fora do caminho
  semântico;
- todos os candidatos permanecem em shadow, com
  `canProduceEffects=false`;
- esta execução possui **zero holdouts confirmatórios e zero aberturas de
  holdout**;
- MSWC isolado não é input desta execução e teria, no máximo, papel diagnóstico
  em outro protocolo;
- um futuro holdout não pode ser pré-construído, inspecionado ou entregue ao
  processo de desenvolvimento nesta rodada.

O orçamento de `R` é no máximo **8 horas de engenharia ativa**, três execuções
completas de desenvolvimento depois que a instrumentação passar e um único
controlador local mínimo. `R` não pode atrasar a decisão de desenvolvimento do
Core nem consumir dados reservados para uma futura confirmação.

O orçamento inicial do Core é uma única família de features/modelo, uma regra
de calibração, no máximo três seeds reportadas e até 720 exemplos de treino,
desenvolvimento e diagnóstico. Se o mínimo de diversidade não couber nesse
orçamento ou `A` não qualificar em desenvolvimento, a rodada para em
`hold/cut`; não reduz o denominador nem abre uma segunda busca disfarçada de
correção.

Qualquer expansão desses limites exige novo pré-registro, não uma emenda feita
depois de observar métricas.

## Hipóteses

### H1 — Core: sinal acústico sob gate conservador

Mantendo a representação acústica compacta e causal do EXP-0016, maior
diversidade de vozes/ambientes, hard negatives e calibração feita somente em
treino/desenvolvimento aumentam, no screen de desenvolvimento, a cobertura de
fundos corretamente ignoráveis sem classificar nenhuma fala dirigida como
fundo.

O mecanismo proposto é correção de cobertura e calibração da fronteira já
aprendida, não aumento indiscriminado de capacidade. Um passe sustenta somente
o investimento em confirmação independente; não confirma segurança ou
generalização.

### H2 — R: valor incremental de microturnos semânticos

Condicionado ao mesmo prefixo de áudio e ao mesmo estado do assistente,
acrescentar texto parcial causal correto melhora a decisão binária de
relevância/veto sobre casos estratificados como fala dirigida, backchannel e
conversa lateral, preservando todo caso dirigido e sem interferir no `STOP`
físico.

O probe é inspirado no princípio de microturnos do DuplexCascade, mas testa
somente o mecanismo mínimo — informação semântica incremental — dentro do
runtime atual.

## Ordem de execução e braços

### Etapa 0 — emenda e quarentena

- o antigo `holdout-core` MSWC perde permanentemente esse papel e seus
  artefatos ficam identificados como desenvolvimento diagnóstico inválido para
  confirmação;
- nenhum relatório pode interpretar seus labels como intenção humana observada;
- configurações, manifests e runners desta execução devem expor apenas
  `train` e `development`;
- o caminho de treino deve usar uma allowlist de entradas e não pode importar o
  builder, payload, áudio, manifest ou plano de qualquer futuro holdout.

### Etapa Core — development-screen

- `A0 — referência congelada`: checkpoint e regra operacional do EXP-0016;
- `A — acústico calibrado`: mesma classe de features causais, treinada e
  calibrada com a nova diversidade e os hard negatives.

O limiar de `A` é escolhido em desenvolvimento para maximizar cobertura de
`BACKGROUND_OR_NOT_DIRECTED` sob a restrição de recall dirigido igual a 100%.
Arquitetura, features, seed, desempate e regra de seleção ficam versionados
antes de calcular as métricas de desenvolvimento.

Se `A` não qualificar em desenvolvimento, ele é congelado como falha e `A0`
se torna a referência acústica do probe `R`. Se qualificar, `A` é congelado e
se torna essa referência. Neste documento, o nome `A-ref` designa a referência
resultante dessa regra, sem escolha retrospectiva por MSWC ou por qualquer
futuro holdout.

Depois da decisão do Core:

- se `A` não qualificar, nenhum holdout é construído;
- se `A` qualificar, checkpoint, features, limiar, código e relatório são
  congelados; a execução atual termina e um novo pré-registro define a
  confirmação;
- somente depois desse novo pré-registro um operador/processo separado pode
  construir um holdout opaco, com contexto audível e sem expor exemplos,
  labels ou agregados ao ambiente de desenvolvimento.

### Etapa R

- `A — acústico atual`: `A-ref`, recebendo somente o prefixo acústico causal;
- `B — acústico + texto-oráculo`: exatamente `A-ref` mais o texto correto
  pronunciado até a amostra de decisão;
- `C — acústico + ASR parcial real`: o mesmo controlador de `B`, sem
  retreinamento oportunista, substituindo o texto correto pelos eventos
  parciais realmente disponíveis até a mesma decisão.

O “oráculo” de `B` conhece somente a transcrição correta do prefixo já falado.
Ele não recebe o rótulo, a intenção futura, o restante da frase ou a ação
esperada. O controlador semântico deve ser o menor mecanismo local suficiente
e fica congelado antes de sua avaliação exploratória em desenvolvimento.

`C` só pode ser implementado/executado se `B` vencer `A-ref` em desenvolvimento
pelos gates deste documento. Assim:

- se `B` não ganhar, a hipótese semântica é cortada para este gargalo;
- se `B` ganhar e `C` não, `B` fornece sinal exploratório de valor e a falha de
  `C` sugere ASR parcial, representação ou disponibilidade temporal como
  dependência ainda sujeita a confirmação independente;
- se `C` ganhar, há valor suficiente para pré-registrar confirmação semântica
  em dados ainda não observados; o resultado de desenvolvimento não promove o
  controlador.

## Instrumentação compartilhada

Cada observação deve registrar, com hashes e proveniência:

- cena, fonte, família conversacional, falante quando disponível, condição
  acústica e receita de transformação;
- sample rate, posição de onset, posição da decisão e prefixo PCM utilizado;
- eventos de VAD e `LocalAudioReflex` no clock/amostra original;
- estado do assistente (`listening`, `speaking`, `held`), turno corrente e
  progresso causal da resposta;
- prefixo textual correto limitado à amostra de decisão;
- papel de avaliação, split e hashes do dataset/manifest que originaram a
  observação;
- em `C`, cada parcial do ASR com horário de emissão e última amostra de áudio
  coberta;
- tipo analítico de sobreposição: interrupção dirigida, backchannel, conversa
  lateral, fala ambiente, ruído não verbal ou ambígua;
- rótulo operacional binário
  `DIRECTED_TO_ASSISTANT / BACKGROUND_OR_NOT_DIRECTED` e sua proveniência;
- probabilidades, proposta em shadow, latência e motivo de deferência de cada
  braço;
- trace do `PAUSE/STOP` físico e todos os efeitos reais do runtime.

Uma decisão só pode consumir PCM e texto cujo `audioEndSample` seja menor ou
igual à amostra da decisão. O texto-oráculo deve estar vinculado por hash ao
áudio/transcrição e ao intervalo efetivamente coberto, e não apenas receber um
timestamp declarado. Texto emitido depois desse instante conta como
indisponível; não pode ser reatribuído retroativamente ao braço. Toda observação
de `R` deve provar origem em `development`; origem ausente ou diagnóstica é
inválida para seus gates.

## Dados, diversidade e papéis

O conjunto de desenvolvimento deve cobrir, no mínimo, as lacunas conhecidas do
EXP-0016:

- múltiplas vozes e gêneros, sem alegar diversidade que a metadata não prove;
- dispositivos, distâncias, salas, ruído, eco e fala concorrente;
- falas dirigidas baixas, distantes, curtas ou parcialmente sobrepostas como
  hard negatives para o veto;
- backchannels, hesitações, correções, conversa lateral e fala de fundo como
  casos semanticamente próximos;
- fala espontânea/sintética e transformações claramente identificadas por
  proveniência.

Antes do fit, o `development` primário precisa ter ao menos 60 exemplos
dirigidos e 60 não dirigidos, seis famílias conversacionais, oito linhagens de
fonte independentes, quatro perfis de voz e quatro condições acústicas. Entre
as falas dirigidas, cada um dos estratos baixa/distante, curta, parcialmente
sobreposta e correção deve conter ao menos dez exemplos. Nenhuma linhagem pode
fornecer mais de 25% do split. “100% de recall” com denominador menor não
qualifica `A`; mesmo com esse mínimo, zero erros é gate de screen, não
estimativa final de risco em produção.

Dados gerados por IA podem entrar em treino e desenvolvimento, desde que
receitas, gerador e linhagem sejam registrados. Eles não sustentam alegação de
naturalidade humana nem podem aparecer em splits diferentes por simples
transformação do mesmo ancestral.

Antes do primeiro fit, o manifest desta execução deve congelar somente estes
papéis:

1. `train` — ajuste dos parâmetros predefinidos de `A`;
2. `development` — limiar, calibração, seleção de `A`, probe de `B` e decisão
   condicional de executar `C`;
3. `mswc-isolated-diagnostic` — observação procedural separada, excluída de fit,
   calibração, seleção, gates e qualquer alegação confirmatória.

Não existe `holdout-core` válido nesta execução. Qualquer artefato anterior com
esse nome deve ser preservado apenas para rastreabilidade da invalidação e não
pode entrar no runner de treino ou no denominador de decisão.

A unidade de separação é a maior linhagem compartilhada: gravação original,
conversa/roteiro, falante quando identificável, receita e descendentes ficam no
mesmo split. Famílias de transformação e templates semânticos não podem
atravessar `train` e `development` quando isso permitir memorizar o rótulo.
Duplicatas ou quase-duplicatas invalidam a família afetada.

### Requisitos mínimos do futuro holdout condicional

Estes requisitos não criam nem antecipam o futuro conjunto. Se `A` qualificar,
um novo pré-registro deverá congelar sua matriz, denominadores, gates, operador
e protocolo antes de qualquer exemplo ser construído:

1. o prefixo de áudio precisa conter contexto observável suficiente para um
   humano distinguir fala dirigida, lateral e de fundo; intenção presente
   apenas em metadado não é rótulo elegível;
2. conteúdo lexical, templates, condições e classes precisam ser
   contrabalanceados ou cruzados, incluindo conteúdo igual ou semanticamente
   equivalente nos dois lados quando possível;
3. gravações, conversas, falantes e receitas devem ter linhagens independentes
   de `train`, `development`, MSWC e âncoras já observadas;
4. o ambiente de desenvolvimento recebe no máximo identificador, protocolo e
   commitment opaco; não recebe áudio, features, labels, planos de seleção,
   manifest com itens ou agregados;
5. um executor separado avalia `A0` e o `A` já congelado, uma única vez, sem
   permitir calibração ou ajuste posterior;
6. o novo documento deve explicitar o que um passe permite afirmar. Mesmo um
   passe não concede automaticamente autoridade ao runtime.

`B` e `C` usam apenas desenvolvimento nesta rodada. Uma futura confirmação
semântica exige conjunto próprio, pré-registrado e ainda não observado. Âncoras
humanas do EXP-0015 podem ser usadas apenas como reencontro declarado, nunca
para fit, escolha de limiar ou alegação de independência.

## Métricas

### Qualidade operacional

- recall de `DIRECTED_TO_ASSISTANT`;
- recall e cobertura de `BACKGROUND_OR_NOT_DIRECTED`;
- acurácia e matriz de confusão por família, condição e tipo de sobreposição;
- falso veto dirigido: fala dirigida proposta como `CONTINUE_OUTPUT`;
- ganho pareado contra a referência no mesmo caso:
  `ganhos = candidato certo/referência errada`,
  `perdas = candidato errado/referência certa` e
  `ganho líquido = ganhos - perdas`;
- deferências/abstenções e cobertura efetiva do veto seguro.

Como quatro transformações podem descender da mesma fonte, o ganho pareado deve
ser reportado por exemplo e por linhagem. Para o gate, cada raiz de linhagem
contribui uma única vez: `WIN` quando `A` acerta mais descendentes que `A0`,
`LOSS` quando acerta menos e `TIE` quando empata; o ganho líquido decisivo é
`WIN - LOSS`. O resultado bruto por exemplo permanece diagnóstico e não pode
inflar a unidade efetiva.

O `Core` compara `A` com `A0` somente em desenvolvimento. O probe compara `B`
e, condicionalmente, `C` com `A-ref` também somente em desenvolvimento. O gap
entre `B` e `C` mede perda causada por erro/atraso do ASR; nenhum resultado
desta execução é alegação confirmatória. Resultados do MSWC isolado, se
calculados, aparecem em seção diagnóstica própria e nunca são agregados a essas
métricas.

### Causalidade, integração e custo temporal

- amostras futuras utilizadas: exatamente zero;
- latência adicional de decisão p50/p95, medida do fim do prefixo elegível até
  a proposta em shadow;
- em `C`, proporção de parciais disponíveis até a decisão; parcial atrasado
  conta como indisponível/deferência;
- paridade Node/Chrome de 100% para rótulo e proposta operacional;
- paridade numérica de features/probabilidades dentro da tolerância relativa
  de `1e-10` usada pelo caminho browser existente;
- trace e efeitos do `PAUSE/STOP` físico idênticos à baseline;
- latência física dentro do gate já vigente de 350 ms e sem nova falsa
  ativação nas regressões existentes;
- chamadas pagas, GPU paga e exemplos humanos usados no fit: zero.

Para qualificar, o cálculo local adicional de `B` deve ter p95 menor ou igual a
50 ms. Em `C`, o intervalo causal entre `audioEndSample` do prefixo necessário
e a proposta deve ter p95 menor ou igual a 300 ms, e ao menos 90% dos casos em
que `B` propõe precisam possuir parcial real elegível nesse teto. Caso sem texto
a tempo conta como deferência e reduz cobertura; não pode ser removido do
denominador. Esses limites protegem a utilidade perceptiva do veto sem confundir
a latência semântica com o gate físico de STOP de 350 ms.

## Gates pré-registrados

Um candidato só qualifica em desenvolvimento se todos os gates aplicáveis
passarem. “Qualificar” significa apenas justificar a próxima coleta/avaliação;
não significa confirmar o mecanismo:

1. splits, proveniência, licenças e linhagens válidos;
2. recall operacional de fala dirigida igual a **100%**;
3. ganho líquido pareado por linhagem estritamente positivo contra sua
   referência, com o resultado bruto por exemplo também reportado;
4. acurácia total de pelo menos 75%, recall de cada classe de pelo menos 75%
   e ganho de pelo menos 20 pontos percentuais sobre a regra
   `all-vad-positive-speech-is-directed`, preservando os pisos do EXP-0016;
5. zero amostras futuras e zero vazamento do restante da transcrição;
6. `STOP` físico sem alteração de efeito, falsa ativação ou regressão do gate
   de 350 ms;
7. p95 local de `B` ≤ 50 ms; em `C`, p95 causal ≤ 300 ms, disponibilidade
   elegível ≥90% e informação atrasada tratada como deferência;
8. paridade Node/Chrome integral nos termos acima;
9. checkpoint/runtime em shadow, `canProduceEffects=false` e zero autoridade;
10. treino determinístico ou variação entre seeds explicitamente reportada,
    sem seleção por MSWC ou qualquer dado futuro;
11. zero GPU/API paga, salvo novo pré-registro e autorização explícita.

O MSWC isolado não satisfaz, melhora nem substitui nenhum desses gates. Para
`A`, passar desenvolvimento permite somente congelar o candidato e iniciar o
novo pré-registro; **não permite construir o holdout antes desse documento nem
mudar o runtime autoritativo**. Para `B/C`, passar desenvolvimento permite
somente recomendar uma confirmação futura em conjunto distinto e opaco.

## Regras de corte e parada

- **Core sem segurança em desenvolvimento:** se nenhuma calibração da família
  compacta preservar 100% de recall dirigido, parar; não construir holdout nem
  ampliar busca de limiares.
- **Core sem ganho:** se `A` não tiver ganho pareado positivo e os pisos
  herdados em desenvolvimento, manter `A0` e congelar a hipótese acústica
  compacta como limitada para esta rodada.
- **Oráculo sem valor:** se `B` não superar `A-ref` com recall dirigido de
  100% em desenvolvimento, não construir `C` e marcar `cut` para texto parcial
  como mecanismo de relevância/veto neste ponto de decisão. Isso não corta
  hipóteses de microturnos para prosódia, backchannel ou outros gargalos.
- **ASR sem viabilidade:** se `B` passar e `C` falhar por conteúdo ou atraso,
  registrar a decomposição do gap e parar; não treinar controlador maior e não
  chamar API paga.
- **Regressão física:** qualquer mudança no efeito ou guardrail do
  `PAUSE/STOP` encerra o challenger, independentemente da qualidade semântica.
- **Core qualificado:** congelar modelo, limiar, features, código e hashes;
  encerrar esta execução e escrever o novo pré-registro antes de construir o
  holdout contextual.
- **MSWC invalidado:** o conjunto isolado não pode ser renomeado, re-selado ou
  reutilizado como confirmação. Seu eventual resultado é somente diagnóstico.
- **Vazamento do futuro holdout:** qualquer acesso do ambiente de
  desenvolvimento a itens, labels ou agregados invalida esse futuro conjunto;
  nova tentativa exige novos dados.
- **Instrumentação inválida:** resultados com futuro, duplicata entre splits,
  label leakage ou ausência de proveniência são inválidos, não negativos.
- **Budget excedido:** necessidade de GPU, API paga, segundo controlador ou
  terceira hipótese encerra esta rodada e volta para priorização explícita.

Correções puramente instrumentais podem ser feitas antes de observar métricas
de desenvolvimento, desde que sejam registradas. Depois de observar métricas,
qualquer mudança de hipótese, família de modelo, gate ou dataset exige novo
experimento; correção instrumental não autoriza busca oportunista.

## Matriz de resultados e próximo movimento

| Resultado observado | Decisão permitida | Próximo movimento |
| --- | --- | --- |
| `A` qualifica; `B` não qualifica | congelar `A`; `cut` de texto parcial para este ponto | pré-registrar e só então construir holdout contextual opaco do Core |
| `A` não qualifica; `B` e `C` qualificam | manter `A0`; controlador semântico segue apenas como probe | priorizar pré-registro de confirmação semântica em dados novos |
| `B` qualifica e `C` falha | sinal semântico exploratório; ASR/latência é dependência provável | confirmar a decomposição antes de qualquer controlador maior |
| `B` não qualifica | cortar hipótese semântica para relevância da fala | escolher o próximo gargalo medido, não um modelo maior |
| `A` e `C` qualificam | dois sinais de desenvolvimento, sem confirmação | congelar ambos; priorizar o próximo holdout pelo maior valor da informação, começando pelo Core crítico |
| `A` e `C` não qualificam | não promover | revisar rótulos/representação ou escolher outro gargalo sob novo experimento |
| MSWC isolado parece forte ou fraco | nenhuma promoção, confirmação ou corte por si só | registrar como diagnóstico de atalho/proxy, separado dos gates |
| evidência de desenvolvimento inválida | nenhuma conclusão de qualidade | corrigir linhagem/instrumentação e pré-registrar nova execução de desenvolvimento |

Mesmo no melhor resultado, PersonaPlex, Lychee-FD, MiniCPM-o, DuplexOmni ou um
DuplexCascade completo não são automaticamente priorizados. Eles continuam
como referências de mecanismos até que um gargalo medido justifique o custo.

## Resultado

Não executado. A única conclusão registrada é a invalidação pré-fit do desenho
MSWC como holdout, sem observação de métricas de candidato. Preencher resultados
somente depois do congelamento dos artefatos em conformidade com esta emenda e
sem alterar retrospectivamente hipóteses, braços, gates ou regras de parada.

## Artefatos esperados

- esta emenda e um registro de invalidação/quarentena que vincule os hashes dos
  antigos artefatos chamados de `holdout-core` em
  `eval/invalidations/exp-0017-mswc-holdout-v0.1.json`;
- configuração e manifest somente com papéis de desenvolvimento: `train` e
  `development`;
- card de dados e proveniência/licenças;
- traces causais com prefixos acústicos e textuais;
- checkpoints `A` e controlador `B/C`, quando elegíveis;
- relatório único de development-screen do Core e de `R`;
- prova de paridade Node/Chrome;
- relatório canônico com decisão, blockers e próximo experimento.

Não há relatório final confirmatório nem artefato de holdout esperado nesta
execução. Se `A` qualificar, o próximo artefato é o novo pré-registro; somente
depois dele existirão commitment e payload opacos sob responsabilidade de um
executor separado. Os nomes, hashes e comandos serão vinculados aqui somente
após existirem; este documento não inventa artefatos nem resultados.
