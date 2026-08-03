# EXP-0017 — veto seguro e probe semântico causal

Status: **Core executado e cortado; `R` cortado por inviabilidade instrumental
antes do fit; zero autoridade**

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
- `B` é o único braço semântico executável; `C` permanece uma etapa futura do
  mesmo challenger, condicionada a evidência contextual contrabalanceada;
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

Nesta rodada sintética, o destinatário não é diretamente observável no prefixo:
ele vem do contexto autoral usado para rotular a cena, e as classes também têm
famílias lexicais diferentes. Portanto, mesmo um passe de `R` demonstra no
máximo **separabilidade lexical exploratória neste corpus autoral**. Não prova
detecção real de destinatário, generalização humana nem utilidade de ASR
parcial. O próximo teste permitido por um passe precisa cruzar ou
contrabalancear conteúdo e contexto antes de aumentar o controlador.

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
- `C — acústico + ASR parcial real` (futuro e condicional): o mesmo controlador
  de `B`, sem retreinamento oportunista, substituindo o texto correto pelos
  eventos parciais realmente disponíveis até a mesma decisão.

O “oráculo” de `B` conhece somente a transcrição correta do prefixo já falado.
Ele não recebe o rótulo, a intenção futura, o restante da frase ou a ação
esperada. O controlador semântico deve ser o menor mecanismo local suficiente
e fica congelado antes de sua avaliação exploratória em desenvolvimento.

`C` não é elegível nesta execução sintética. Um passe integral de `B` permite
somente congelar o mecanismo e pré-registrar uma confirmação pequena,
contextual, adversarial e lexicalmente contrabalanceada. Somente esse novo
teste poderá decidir se vale implementar/executar `C`. Assim:

- se `B` não ganhar, a hipótese semântica é cortada para este gargalo;
- se `B` ganhar, existe apenas sinal lexical exploratório suficiente para o
  challenger contrabalanceado seguinte;
- disponibilidade, erro e atraso de ASR parcial permanecem perguntas futuras,
  sem resultado nesta execução.

### Emenda pré-R — protocolo executável e ordem de informação

Uma primeira versão desta emenda foi escrita enquanto o alinhador era
materializado. Depois de inspecionar **somente a disponibilidade de prefixos em
train**, antes de qualquer fit, limiar ou métrica semântica de development, a
partição puramente por hash foi corrigida porque não atingia seu piso
instrumental. Uma auditoria posterior também detectou que o decoder havia
recebido o WAV completo antes do corte por timestamps; esse mapa foi invalidado
e não pode alimentar fit ou avaliação. A configuração atual foi, portanto,
recongelada após essas duas inspeções instrumentais de train e antes de fit ou
métricas de `B`. Margem, família de features e gates de qualidade não foram
escolhidos por resultado do candidato. A configuração canônica é
`eval/experiments/exp-0017-r-oracle-v0.1.json`.

O prefixo-oráculo usa `faster-whisper small` local, versão `1.2.1`, revisão
cacheada `536b0662742c02347bc0e980a01041f333bce120`, timestamps de palavra e
decodificação determinística. O decoder recebe fisicamente apenas um novo WAV
contendo a fonte da amostra zero até `onset + 8960`, o instante da decisão;
nunca recebe amostras posteriores. Os 80 ms entre `7680` e `8960` funcionam
como lookahead causal para confirmar que a última palavra terminou, sem liberar
essa margem como conteúdo. Hashes do WAV e do PCM truncados, onset e intervalo
exato ficam vinculados ao request, à saída bruta e ao mapa canônico. Só entram
palavras completas cujo fim alinhado
seja no máximo a amostra `7680` após o onset: 80 ms antes da decisão na amostra
`8960`. O prefixo alinhado precisa coincidir exatamente, após normalização, com
o início da transcrição de referência. Discordância, ausência ou palavra
incompleta produz `text=null`; nunca se usa a frase inteira por timestamp
declarado.

O primeiro mapa, produzido ao decodificar o áudio completo e filtrar somente a
saída por timestamp, é causalmente inválido porque o decoder podia usar áudio
futuro para influenciar tokens e alinhamento. Nenhum fit, seleção de limiar ou
métrica semântica o consumiu. A invalidação e os hashes substituídos ficam em
`eval/invalidations/exp-0017-r-full-audio-alignment-v0.1.json`.

As 30 linhagens de `train` são separadas por classe e disponibilidade causal de
prefixo, sempre com desempate por hash fixo. Quatro linhagens com prefixo por
classe são reservadas para calibração, a quinta vaga é preenchida primeiro por
uma linhagem sem prefixo, e as dez restantes ajustam pesos. Nenhuma linhagem
cruza esses papéis. Exemplos sem palavra completa e todos os
`competing-speech-proxy` ficam fora do fit do classificador. Na calibração e em
development, porém, continuam no denominador e `B` precisa devolver uma cópia
imutável e exatamente igual a `A0` quando não há texto elegível.

A regra inicial puramente por hash foi executada apenas como checagem de
instrumentação e deixou três, em vez de quatro, linhagens dirigidas elegíveis
na calibração. Antes de fit, limiar ou métricas de `B`, ela foi invalidada sem
reduzir o piso; a correção acima usa somente disponibilidade do prefixo de
`train`, rótulo e hash. O registro é
`eval/invalidations/exp-0017-r-hash-partition-v0.1.json`.

O único delta de `B` sobre `A0` são features do texto normalizado; estado do
assistente não entra no classificador. `A0` é recalculado das features acústicas
do mesmo artefato e precisa corresponder ao checkpoint, modelo e limiar
selecionados pelo relatório Core. Prefixo, cena, WAV/PCM, artefato, split,
linhagem, condição e `A0` são validados contra artefatos canônicos, não apenas
contra hashes fornecidos pela própria observação.

O protocolo previa dois executáveis separados: um trainer limitado a config,
dataset/attestation de `train`, freeze-manifest e `A0`, seguido por um evaluator
de passagem única em development somente após commit do checkpoint. A
inviabilidade de cobertura foi detectada antes da materialização desses
artefatos; por isso os executáveis downstream nunca foram usados e foram
removidos na consolidação do corte.

O ganho decisivo de `R` compara, por raiz, a quantidade de quatro descendentes
corretos em `B` e `A0`: mais é `WIN`, menos é `LOSS`, igualdade é `TIE`.
Métricas por exemplo usam os 120 casos completos, inclusive fallbacks. O p95
local de `B` mede com clock monotônico a invocação na decisão até a proposta,
usa apenas casos com texto e o nearest-rank, após 64 warm-ups fixos no primeiro
caso elegível; fallbacks e a folga amostral entre o fim do prefixo e a decisão
são reportados separadamente. Essa medida exclui alinhamento oráculo, geração e
disponibilidade do texto: é custo computacional local do delta semântico, não
latência percebida nem ponta a ponta. O intervalo fim-do-áudio até proposta
continua reservado a um futuro gate causal de `C`, com eventos em tempo real.

Para poupar engenharia sem reduzir o gate final, `B` passa primeiro pelos gates
de qualidade, causalidade, determinismo, custo local e shadow. Se falhar, é
cortado antes de integração. Se passar, o mesmo checkpoint congelado recebe a
checagem Node/Chrome e a regressão do `STOP` físico; só então pode qualificar
integralmente para o próximo pré-registro contrabalanceado. Este corpus sozinho
não desbloqueia a triagem temporal de `C`.

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
2. `development` — limiar, calibração, seleção de `A` e probe de `B`; não
   executa `C` nesta rodada;
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

`B` usa apenas desenvolvimento nesta rodada. `C` permanece futuro. Uma
confirmação semântica exige conjunto próprio, pré-registrado e ainda não
observado. Âncoras
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
com `A-ref` também somente em desenvolvimento. A futura comparação entre `B`
e `C` poderá medir perda causada por erro/atraso do ASR, mas não pertence a esta
execução. Nenhum resultado desta execução é alegação confirmatória. Resultados
do MSWC isolado, se
calculados, aparecem em seção diagnóstica própria e nunca são agregados a essas
métricas.

### Causalidade, integração e custo temporal

- amostras futuras utilizadas: exatamente zero;
- custo computacional local p50/p95 da invocação de `B` até a proposta em
  shadow, sem alegação de latência percebida ou ponta a ponta;
- em um futuro `C`, proporção de parciais disponíveis até a decisão; parcial
  atrasado conta como indisponível/deferência;
- paridade Node/Chrome de 100% para rótulo e proposta operacional;
- paridade numérica de features/probabilidades dentro da tolerância relativa
  de `1e-10` usada pelo caminho browser existente;
- trace e efeitos do `PAUSE/STOP` físico idênticos à baseline;
- latência física dentro do gate já vigente de 350 ms e sem nova falsa
  ativação nas regressões existentes;
- chamadas pagas, GPU paga e exemplos humanos usados no fit: zero.

Para qualificar, o cálculo local adicional de `B` deve ter p95 menor ou igual a
50 ms. Em um futuro `C`, o intervalo causal entre `audioEndSample` do prefixo necessário
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
7. p95 local de `B` ≤ 50 ms; os gates de `C` (p95 causal ≤ 300 ms,
   disponibilidade elegível ≥90% e informação atrasada como deferência) ficam
   reservados ao futuro pré-registro;
8. paridade Node/Chrome integral nos termos acima;
9. checkpoint/runtime em shadow, `canProduceEffects=false` e zero autoridade;
10. treino determinístico ou variação entre seeds explicitamente reportada,
    sem seleção por MSWC ou qualquer dado futuro;
11. zero GPU/API paga, salvo novo pré-registro e autorização explícita.

O MSWC isolado não satisfaz, melhora nem substitui nenhum desses gates. Para
`A`, passar desenvolvimento permite somente congelar o candidato e iniciar o
novo pré-registro; **não permite construir o holdout antes desse documento nem
mudar o runtime autoritativo**. Para `B`, passar desenvolvimento permite
somente recomendar uma confirmação futura contextual, contrabalanceada e
distinta.

## Regras de corte e parada

- **Core sem segurança em desenvolvimento:** se nenhuma calibração da família
  compacta preservar 100% de recall dirigido, parar; não construir holdout nem
  ampliar busca de limiares.
- **Core sem ganho:** se `A` não tiver ganho pareado positivo e os pisos
  herdados em desenvolvimento, manter `A0` e congelar a hipótese acústica
  compacta como limitada para esta rodada.
- **Oráculo sem valor:** se `B` não superar `A-ref` com recall dirigido de
  100% em desenvolvimento, não priorizar `C` e marcar `cut` para texto parcial
  como mecanismo de relevância/veto neste ponto de decisão. Isso não corta
  hipóteses de microturnos para prosódia, backchannel ou outros gargalos.
- **Oráculo com sinal:** se `B` passar, congelar o mecanismo e pré-registrar o
  challenger contextual/lexicalmente contrabalanceado; não saltar direto para
  ASR parcial nem treinar controlador maior.
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
| `A` não qualifica; `B` qualifica | manter `A0`; há somente sinal lexical exploratório | pré-registrar challenger contextual e lexicalmente contrabalanceado |
| `B` não qualifica | cortar hipótese semântica para relevância da fala | escolher o próximo gargalo medido, não um modelo maior |
| `B` qualifica e integração falha | sinal lexical sem viabilidade no runtime atual | decompor paridade/STOP antes de qualquer `C` |
| MSWC isolado parece forte ou fraco | nenhuma promoção, confirmação ou corte por si só | registrar como diagnóstico de atalho/proxy, separado dos gates |
| evidência de desenvolvimento inválida | nenhuma conclusão de qualidade | corrigir linhagem/instrumentação e pré-registrar nova execução de desenvolvimento |

Mesmo no melhor resultado, PersonaPlex, Lychee-FD, MiniCPM-o, DuplexOmni ou um
DuplexCascade completo não são automaticamente priorizados. Eles continuam
como referências de mecanismos até que um gargalo medido justifique o custo.

## Resultado

O estado pré-fit foi congelado no commit `b2a9cc2` antes da execução oficial.
O Core treinou duas vezes com pesos idênticos, usando 120 exemplos de `train`,
e escolheu limiar `0,7728149613611813` nos 120 exemplos de `development`.

`A` preservou 60/60 falas dirigidas, mas classificou corretamente apenas 1/60
fundos. A acurácia foi `61/120 = 50,83%`, contra `60/120 = 50%` da regra que
trata toda fala como dirigida e `61/120 = 50,83%` de `A0`. Na comparação
pareada por exemplo contra `A0`, houve 10 ganhos e 10 perdas, ganho líquido
zero. A agregação por linhagem teve ganho positivo, mas não compensa as falhas
pré-registradas de acurácia, recall de fundo/classe e ganho sobre a baseline.

Decisão: `retain-a0-and-cut-acoustic-core`. `A0` é `A-ref` para `R`; nenhum
holdout foi construído, nenhuma evidência confirmatória foi alegada e nenhuma
autoridade foi concedida. O relatório canônico é
`eval/reports/exp-0017-core-development-v0.1.json`.

### Resultado de R — corte antes do fit

Uma auditoria causal invalidou o primeiro mapa porque o Whisper havia recebido
o WAV completo. O mapa substituto usa somente WAV físico da amostra zero até
`onset + 8960`, aceita palavra apenas quando
`ceil(end × 16000) - onset <= 7680` e vincula os hashes do áudio truncado e do
snapshot local. A cobertura caiu de forma material: 21/30 linhagens de `train`
possuem prefixo aceito — 11/15 de fundo e 10/15 dirigidas.

O protocolo exige, de forma independente por classe, quatro linhagens elegíveis
para calibração e pelo menos oito para fit. Seriam necessárias 12; existem 11 e
10. Depois de reservar calibração, restariam no máximo sete e seis,
respectivamente. O piso não foi reduzido, nenhuma linhagem foi compartilhada e
a regra lexical não foi relaxada depois de observar cobertura.

Decisão: `cut-r-before-fit-insufficient-independent-causal-prefix-lineages`.
Nenhum dataset/freeze causal foi materializado, nenhum classificador foi
treinado, nenhum limiar foi escolhido e nenhuma métrica semântica de
development foi lida. Portanto, a rodada não conclui que texto ajuda ou não;
conclui somente que este desenho não consegue responder à pergunta sem violar
seus próprios pisos. O registro canônico é
`eval/invalidations/exp-0017-r-insufficient-causal-prefix-coverage-v0.1.json`.

O próximo movimento de maior informação não é reduzir amostra nem trocar de
modelo: é pré-registrar cenas pareadas menores em que o mesmo conteúdo lexical
apareça com contexto de destinatário audível/observável, separando “texto do
microturno” de “contexto recente” antes de qualquer teste com ASR parcial.

## Artefatos esperados

- esta emenda e um registro de invalidação/quarentena que vincule os hashes dos
  antigos artefatos chamados de `holdout-core` em
  `eval/invalidations/exp-0017-mswc-holdout-v0.1.json`;
- configuração e manifest somente com papéis de desenvolvimento: `train` e
  `development`;
- card de dados e proveniência/licenças;
- traces causais com prefixos acústicos e textuais;
- checkpoints `A` e controlador `B`, quando elegíveis;
- relatório único de development-screen do Core e de `R`;
- prova de paridade Node/Chrome;
- relatório canônico com decisão, blockers e próximo experimento.

Não há relatório final confirmatório nem artefato de holdout esperado nesta
execução. Se `A` qualificar, o próximo artefato é o novo pré-registro; somente
depois dele existirão commitment e payload opacos sob responsabilidade de um
executor separado. Os nomes, hashes e comandos serão vinculados aqui somente
após existirem; este documento não inventa artefatos nem resultados.
