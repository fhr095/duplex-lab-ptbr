# EXP-0017 — veto seguro e probe semântico causal

Status: **pré-registrado; não executado; zero autoridade**

Este documento congela a pergunta, a ordem das comparações e as regras de
corte antes de materializar resultados. O EXP-0017 tem um caminho crítico
acústico (`Core`) e um probe semântico curto (`R`). Eles compartilham dados,
timeline e instrumentação de desenvolvimento. Somente o Core consome o holdout
confirmatório desta rodada; `R` é um screen de valor da informação e não pode
bloquear nem observar esse holdout.

## Decisões que este experimento desbloqueia

1. A família acústica compacta do EXP-0016 merece um experimento posterior de
   autoridade limitada para `CONTINUE_OUTPUT`, ou deve permanecer apenas em
   shadow?
2. Texto parcial causal contém valor incremental suficiente para tornar um
   controlador semântico mínimo o próximo challenger confirmatório, ou deve ser
   cortado como mecanismo de relevância/veto neste ponto de decisão?

O experimento não escolhe um backbone full-duplex, não reproduz
DuplexCascade e não concede autoridade. Sua saída máxima no Core é justificar
um teste posterior de autoridade limitada; em `R`, é justificar ou cortar um
teste confirmatório semântico independente.

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
  `canProduceEffects=false`.

O orçamento de `R` é no máximo **8 horas de engenharia ativa**, três execuções
completas de desenvolvimento depois que a instrumentação passar e um único
controlador local mínimo. Se `R` não estiver congelado quando `A` estiver pronto
para abrir o `holdout-core`, ele é cortado desta rodada e o Core prossegue. `R`
não pode ser retomado depois que qualquer resultado do `holdout-core` for
observado; isso exigiria novo conjunto e novo pré-registro.

O orçamento inicial do Core é uma única família de features/modelo, uma regra
de calibração, no máximo três seeds reportadas, até 720 exemplos e uma única
abertura do holdout. Se o mínimo de diversidade não couber nesse orçamento ou
`A` não qualificar em desenvolvimento, a rodada para em `hold/cut`; não reduz o
denominador nem abre uma segunda busca disfarçada de correção.

Qualquer expansão desses limites exige novo pré-registro, não uma emenda feita
depois de observar métricas.

## Hipóteses

### H1 — Core: calibração acústica segura

Mantendo a representação acústica compacta e causal do EXP-0016, maior
diversidade de vozes/ambientes, hard negatives e calibração feita somente em
treino/desenvolvimento aumentam a cobertura de fundos corretamente ignoráveis
sem classificar nenhuma fala dirigida como fundo no holdout congelado.

O mecanismo proposto é correção de cobertura e calibração da fronteira já
aprendida, não aumento indiscriminado de capacidade.

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

### Etapa Core

- `A0 — referência congelada`: checkpoint e regra operacional do EXP-0016;
- `A — acústico calibrado`: mesma classe de features causais, treinada e
  calibrada com a nova diversidade e os hard negatives.

O limiar de `A` é escolhido em desenvolvimento para maximizar cobertura de
`BACKGROUND_OR_NOT_DIRECTED` sob a restrição de recall dirigido igual a 100%.
Arquitetura, features, seed, desempate e regra de seleção ficam versionados
antes da avaliação final.

Se `A` não qualificar em desenvolvimento, ele é congelado como falha e `A0`
se torna a referência acústica do probe `R`. Se qualificar, `A` é congelado e
se torna essa referência. Neste documento, o nome `A-ref` designa a referência
resultante dessa regra, sem escolha retrospectiva pelo holdout.

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
igual à amostra da decisão. Texto emitido depois desse instante conta como
indisponível; não pode ser reatribuído retroativamente ao braço.

## Dados, diversidade e splits

O novo conjunto deve cobrir, no mínimo, as lacunas conhecidas do EXP-0016:

- múltiplas vozes e gêneros, sem alegar diversidade que a metadata não prove;
- dispositivos, distâncias, salas, ruído, eco e fala concorrente;
- falas dirigidas baixas, distantes, curtas ou parcialmente sobrepostas como
  hard negatives para o veto;
- backchannels, hesitações, correções, conversa lateral e fala de fundo como
  casos semanticamente próximos;
- fala espontânea/sintética e transformações claramente identificadas por
  proveniência.

Antes do fit, `development` e `holdout-core` precisam ter, cada um, ao menos 60
exemplos dirigidos e 60 não dirigidos, seis famílias conversacionais, oito
linhagens de fonte independentes, quatro perfis de voz e quatro condições
acústicas. Entre as falas dirigidas, cada um dos estratos baixa/distante,
curta, parcialmente sobreposta e correção deve conter ao menos dez exemplos.
Nenhuma linhagem pode fornecer mais de 25% de um split. “100% de recall” com
denominador menor não abre o holdout nem sustenta o adjetivo seguro; mesmo com
esse mínimo, zero erros é gate desta rodada, não estimativa final de risco em
produção.

Dados gerados por IA podem entrar em treino e desenvolvimento, desde que
receitas, gerador e linhagem sejam registrados. Eles não sustentam alegação
de naturalidade humana nem podem aparecer em splits diferentes por simples
transformação do mesmo ancestral.

Antes do primeiro fit, um manifest deve congelar:

1. `train` — ajuste de parâmetros;
2. `development` — limiar, calibração, seleção de `A`, probe de `B` e decisão
   condicional de executar `C`;
3. `holdout-core` — comparação final pareada de `A0` e `A`, aberta uma única
   vez depois de `A` estar congelado.

A unidade de separação é a maior linhagem compartilhada: gravação original,
conversa/roteiro, falante quando identificável, receita e descendentes ficam
no mesmo split. Famílias de transformação e templates semânticos não podem
atravessar splits quando isso permitir memorizar o rótulo. Duplicatas ou
quase-duplicatas invalidam a família afetada.

O `holdout-core` é comum somente a `A0` e `A`, para comparação pareada, e não
espera o probe `R`. Abrir seus rótulos, erros ou agregados antes de congelar `A`
invalida o split inteiro; qualquer nova tentativa exige outro holdout. `B` e
`C` usam apenas desenvolvimento nesta rodada e não podem consumir features,
rótulos nem agregados do `holdout-core`. Uma futura confirmação semântica exige
outro conjunto pré-registrado e ainda não observado. Âncoras humanas do
EXP-0015 podem ser usadas apenas como reencontro declarado, nunca para fit,
escolha de limiar ou alegação de holdout independente.

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

O `Core` compara `A` com `A0` em desenvolvimento e no `holdout-core`. O probe
compara `B` e, condicionalmente, `C` com `A-ref` somente em desenvolvimento. O
gap entre `B` e `C` mede perda causada por erro/atraso do ASR; nenhum resultado
do probe é alegação confirmatória.

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
passarem. Apenas `A` pode confirmar no `holdout-core` desta rodada, repetindo os
mesmos gates sem ajuste:

1. splits, proveniência, licenças e linhagens válidos;
2. recall operacional de fala dirigida igual a **100%**;
3. ganho líquido pareado estritamente positivo contra sua referência;
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
    sem seleção por holdout;
11. zero GPU/API paga, salvo novo pré-registro e autorização explícita.

Para `A`, passar desenvolvimento habilita a abertura única do `holdout-core`;
passá-lo permite recomendar outro experimento, sem mudar o runtime autoritativo.
Para `B/C`, passar desenvolvimento permite somente recomendar uma confirmação
futura em novo conjunto selado.

## Regras de corte e parada

- **Core sem segurança em desenvolvimento:** se nenhuma calibração da família
  compacta preservar 100% de recall dirigido, parar; não abrir holdout nem
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
- **Holdout aberto:** depois da leitura final, não ajustar modelo, limiar,
  prompt, regra ou taxonomia. Nova tentativa requer novo holdout.
- **Instrumentação inválida:** resultados com futuro, duplicata entre splits,
  label leakage ou ausência de proveniência são inválidos, não negativos.
- **Budget excedido:** necessidade de GPU, API paga, segundo controlador ou
  terceira hipótese encerra esta rodada e volta para priorização explícita.

Correções puramente instrumentais podem ser feitas antes de abrir o holdout,
desde que não revelem rótulos/resultados e sejam registradas. Elas não
autorizam uma nova busca de modelo.

## Matriz de resultados e próximo movimento

| Resultado observado | Decisão permitida | Próximo movimento |
| --- | --- | --- |
| `A` confirma; `B` não qualifica | `cut` de texto parcial para relevância/veto neste ponto | pré-registrar teste de autoridade acústica limitada |
| `A` não confirma no `holdout-core`; `B` e `C` apenas qualificam em desenvolvimento | manter controlador como probe sem autoridade | pré-registrar confirmação semântica em dados novos |
| `B` qualifica e `C` falha | sinal semântico exploratório; ASR/latência é dependência provável | confirmar a decomposição antes de qualquer controlador maior |
| `B` não qualifica | cortar hipótese semântica para relevância da fala | escolher o próximo gargalo medido, não um modelo maior |
| `A` confirma e `C` qualifica | acústica tem evidência confirmatória; semântica tem sinal exploratório | priorizar autoridade acústica; confirmar semântica só se o valor incremental justificar |
| `A` não confirma e `C` não qualifica | não promover | revisar rótulos/representação ou escolher outro gargalo sob novo experimento |
| evidência inválida | nenhuma conclusão de qualidade | corrigir linhagem/instrumentação e congelar novo holdout |

Mesmo no melhor resultado, PersonaPlex, Lychee-FD, MiniCPM-o, DuplexOmni ou um
DuplexCascade completo não são automaticamente priorizados. Eles continuam
como referências de mecanismos até que um gargalo medido justifique o custo.

## Resultado

Não executado. Preencher somente depois do congelamento dos artefatos e sem
alterar retrospectivamente hipóteses, braços, gates ou regras de parada.

## Artefatos esperados

- configuração e manifest de splits/linhagens;
- card de dados e proveniência/licenças;
- traces causais com prefixos acústicos e textuais;
- checkpoints `A` e controlador `B/C`, quando elegíveis;
- relatório de desenvolvimento, incluindo `R`, separado do relatório final do
  `holdout-core`;
- prova de paridade Node/Chrome;
- relatório canônico com decisão, blockers e próximo experimento.

Os nomes, hashes e comandos serão vinculados aqui somente após existirem; este
pré-registro não inventa artefatos nem resultados.
