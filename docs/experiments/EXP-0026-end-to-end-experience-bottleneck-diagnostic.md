# EXP-0026 — diagnóstico formativo dos gargalos da experiência ponta a ponta

Status: **pré-registrado; instrumento ainda não implementado; zero dry-run,
zero sessão humana e zero bloco comercial executados; zero GPU, runner externo
ou mudança de runtime autorizados**

## Decisão que este experimento desbloqueia

Escolher **uma única próxima pergunta experimental** a partir do maior gargalo
realmente percebido na vertical completa, ou recusar essa escolha quando seis
sessões não produzirem convergência suficiente.

Este é um diagnóstico formativo de produto. Ele não compara candidatos de
runtime, não promove componente, não confirma prontidão humana ampla e não
transforma preferência em dado de treino. Seu resultado poderá:

1. priorizar uma família de capacidade para um novo experimento;
2. priorizar primeiro a reprodução técnica de uma falha percebida ainda não
   atribuída; ou
3. declarar `NO_DOMINANT_BOTTLENECK`, sem fabricar consenso.

Ao final serão apresentados os três gargalos mais relevantes, cada qual com
impacto humano e evidência técnica separados, mas será proposto **no máximo um
próximo experimento**.

## Hipótese diagnóstica

Um protocolo curto, repetível e ponta a ponta consegue encontrar um gargalo
dominante somente se a mesma família de problema:

- estiver entre os dois maiores problemas de pelo menos 4 dos 6 participantes;
- tiver severidade mediana material; e
- estiver ligada a uma falha técnica reproduzível no pipeline local.

Se essa conjunção não ocorrer, o experimento terá cumprido sua função ao
impedir investimento prematuro. A ausência de dominante não significa que a
experiência está pronta; significa apenas que esta amostra não sustenta uma
prioridade única.

## Constructo e não alegações

O constructo primário é **impacto percebido por participante durante uma
sessão completa e congelada**, não acurácia por turno nem quantidade de
eventos. A unidade estatística é o participante/sessão (`n=6`). Cenas, turnos,
palavras, chunks, frames e traces são medidas aninhadas e diagnósticas; não
aumentam `n`.

O experimento não poderá alegar:

- representatividade da população brasileira;
- superioridade sobre um produto comercial;
- causalidade de componente baseada apenas no relato humano;
- qualidade do DuplexCascade em português brasileiro;
- prontidão para produção, treinamento ou autoridade no runtime.

## Baseline e condição congelada

A condição local é a vertical modular corrente, derivada da baseline
`runtime-baseline-ptbr-v0.3`, com uma única exceção deliberada: o cérebro
determinístico será substituído pelo adaptador externo já existente para que a
conversa aberta seja funcional. Isso não torna o provider parte da arquitetura
proprietária nem o elege como cérebro definitivo.

Antes de qualquer sessão analisável, um único artefato
`eval/commitments/exp-0026-session-freeze-v0.1.json` deverá registrar e hashear:

- commit executado e fingerprint das fontes `src/`, `web/`, manifests e locks;
- `BRAIN_PROVIDER=openai`;
- modelos de interação e tarefa `gpt-5.6-luna`;
- URL de Responses API, `reasoning.effort=none`, `max_output_tokens=160`,
  `store=false`, `stream=true`, `text.verbosity=low`, ausência de parâmetro de
  temperatura e teto de 25 requisições por processo;
- SHA-256 das instruções direta e delegada de
  `src/brain/openai-brain.mjs`, além do corpo efetivo de configuração sem
  segredos;
- identificador de modelo devolvido em cada resposta; divergência do
  identificador exposto entre sessões invalida a comparabilidade do lote;
- VAD, ASR parcial/final, endpoint, política e todos os thresholds efetivos;
- TTS `windows-system-speech`, voz `Microsoft Maria Desktop`, cultura `pt-BR`,
  rate `1`, formato e health antes de cada sessão;
- computador, Windows/WSL, build do Chrome, versão do servidor, microfone,
  saída, dispositivo de ruído, sample rate, canais, AEC, noise suppression,
  AGC, volumes, posição física e sala;
- condição de rede, relógios disponíveis e forma de sincronização dos traces;
- pack, ordem das cenas, formulários, escala de severidade, arquivo de ruído,
  seed, SHA-256, ganho e receita de reprodução.

Modelo premium é proibido. As seis sessões precisam ocorrer em uma janela
máxima de sete dias corridos a partir do freeze; ultrapassá-la exige novo
freeze antes de recrutar outra pessoa.

Uma chave, token, nome civil ou identificador de conta nunca entra nesse
artefato. O alias remoto pode ocultar mudanças server-side; portanto o escopo
de reprodutibilidade do cérebro se limita ao identificador e aos parâmetros
expostos pelo provider. Ausência da API ou mudança de configuração termina o
preflight; não há fallback silencioso para cérebro local.

## Sequência de implementação, dry-run e freeze

O pré-registro congela agora as cenas, estimandos, gates e árvore de decisão.
A sequência futura é:

1. implementar somente o instrumento e os registros necessários;
2. executar **um dry-run interno**, com ID separado e excluído de toda análise;
3. corrigir apenas defeito operacional que impeça aplicar o protocolo;
4. materializar o freeze final descrito acima;
5. abrir as seis sessões externas.

O dry-run não pode calibrar severidade, alterar a regra de 4/6, escolher outra
categoria, adicionar cenas ou antecipar o ranking. Qualquer mudança de
constructo, métrica ou gate exige emenda prospectiva, novo dry-run e novo
freeze. Dados do dry-run não entram no relatório, no top-2, na reprodução
técnica ou na calibração comercial.

## Participantes e amostra

- exatamente 6 participantes externos únicos, falantes de português
  brasileiro, uma sessão por pessoa;
- uma única estação física e os mesmos dispositivos nas seis sessões;
- um dry-run interno adicional, explicitamente excluído;
- sessão local alvo de 10 a 12 minutos; módulo comercial opcional limitado a
  mais 4 minutos;
- as seis sessões analisáveis são concluídas dentro da janela de sete dias do
  freeze;
- seis ordens de cena em quadrado latino congelado, uma por participante, para
  que cada cena ocupe cada posição uma vez;
- nenhuma repetição seletiva de uma cena porque o resultado pareceu ruim.

Só são exclusões válidas antes do início da primeira cena: freeze divergente,
consentimento de participação ausente ou impossibilidade física de aplicar o
protocolo. Uma quebra depois do início é experiência observada e permanece na
sessão, inclusive quando impede completá-la. Retirada de consentimento apaga a
sessão e permite reposição por uma nova pessoa sob o mesmo protocolo; no
máximo duas reposições administrativas são permitidas. Se seis sessões válidas
não forem obtidas dentro desse limite, o resultado é
`NOT_EVALUATED_SAMPLE_INCOMPLETE`.

## Cenas congeladas

Cada cena define objetivo e evento obrigatório, mas permite fala natural. O
roteiro e suas variantes semânticas serão versionados antes do dry-run.

| ID | Situação | Capacidade exercitada |
| --- | --- | --- |
| S1 | conversa simples com pergunta e seguimento | entendimento, início da resposta e naturalidade |
| S2 | hesitação seguida de continuação e mudança de ideia | ASR incremental e endpoint sem cortar o usuário |
| S3 | backchannel curto enquanto o assistente fala | manter o piso sem interpretar “sim/aham” como interrupção |
| S4 | barge-in com correção enquanto o assistente fala | parar, incorporar a correção e retomar coerentemente |
| S5 | nome, data e valor críticos sob ruído congelado | captura, ASR parcial/final e confirmação segura |
| S6 | tarefa delegada, seguida de alteração ou cancelamento | delegação assíncrona, obsolescência e resultado correto |

O mesmo objetivo, risco e evento obrigatório são preservados entre variantes;
nomes e conteúdos mudam apenas para reduzir memorização. O observador não pode
ajudar o sistema, reformular a fala ou orientar o participante durante a cena.

## Ruído repetível

A cena S5 usa um WAV de ruído branco seeded, sem fala de terceiros, produzido
pela mesma receita determinística já usada pela fábrica. O artefato bruto,
seed, PCM, duração, ganho e SHA-256 serão congelados. Ele será reproduzido por
um segundo dispositivo na mesma posição e volume, qualificados antes de cada
sessão por um probe curto com tolerância congelada.

O experimento caracteriza essa **condição de reprodução**, não promete SNR
idêntico para vozes humanas de intensidades diferentes. Se o probe falhar, a
sessão não começa; volume ou posição não podem ser reajustados depois de ver
uma resposta do sistema.

## Consentimento, finalidade e retenção

Há consentimentos separados e revogáveis para:

1. participação, respostas aos formulários e processamento transitório da
   fala/transcrição pelo cérebro externo informado no termo;
2. gravação de áudio local;
3. persistência dos traces locais, que podem conter transcrição;
4. processamento no serviço comercial opcional.

Áudio e traces só são gravados quando o respectivo consentimento estiver
ativo. Recusar áudio, trace ou módulo comercial não invalida a sessão
principal nem altera seu denominador humano. Sem áudio/trace, a percepção
continua válida, mas aquela sessão isoladamente não pode satisfazer o requisito
de reprodução técnica.

Todos esses dados recebem `fitEligibility=evaluation-only`:

- nunca entram em treino, teacher data, prompt, fábrica, regressão ou
  `training-trace-v1` por derivação automática;
- áudio, traces, comentários e consentimentos ficam fora do Git, com acesso
  local restrito e pseudônimos;
- o agregado versionável não contém voz, texto livre identificável nem nome;
- áudio e traces brutos são apagados até 30 dias após o closeout ou antes, se
  houver retirada; a tabela agregada desidentificada pode ser preservada;
- converter uma descoberta em regressão exige um caso novo, com proveniência
  própria e sem copiar fala humana ou output comercial.

## Instrumento humano

Depois de cada cena o participante registra exatamente:

- uma categoria principal ou `NENHUM_PROBLEMA_MATERIAL`;
- severidade; e
- comentário opcional.

As categorias, apresentadas em linguagem de usuário, são:

```text
ENTENDIMENTO_DO_QUE_EU_DISSE
RITMO_E_TROCA_DE_TURNO
QUALIDADE_DA_RESPOSTA
VOZ_E_ENTREGA
TAREFA_E_CONTINUIDADE
OUTRO
NENHUM_PROBLEMA_MATERIAL
```

A escala de severidade é congelada:

- `0`: nenhum problema material;
- `1`: perceptível, mas não atrapalhou;
- `2`: atrapalhou o ritmo ou exigiu repetição;
- `3`: impediu ou alterou materialmente o objetivo;
- `4`: quebrou a sessão, criou risco ou produziu ação incorreta relevante.

Ao final das seis cenas, e **uma única vez por participante**, a pessoa escolhe
até dois problemas que mais prejudicaram a experiência. Ela pode escolher
zero ou um; o formulário não força dois. A escolha se limita às categorias que
a própria pessoa marcou com severidade maior que zero; `NENHUM_PROBLEMA_MATERIAL`
é exclusivo e não pode coexistir com outra categoria. Esse top-2 é selado antes
de abrir o módulo comercial e não pode ser refeito depois de ouvir a referência.

## Atribuição técnica por estágio

Todo problema relatado recebe uma análise local que pode apontar um estágio
primário, estágios contribuintes ou `UNATTRIBUTED`. Não se força causa única
quando a evidência não separa a cadeia.

| Estágio | Evidência mínima de atribuição |
| --- | --- |
| `AUDIO` | gap, clip, nível, canal, AEC/NS/AGC ou corrupção já presente antes do ASR |
| `ASR_PARTIAL` | parcial incorreta/instável participa da decisão, enquanto áudio e final não sustentam o mesmo erro |
| `ASR_FINAL` | final omite ou troca conteúdo audível, sobretudo slot crítico, antes do cérebro |
| `ENDPOINT` | conteúdo disponível é compatível, mas o commit ocorre cedo ou tarde demais |
| `BRAIN` | entrada final correta chega ao provider, porém conteúdo, coerência ou decisão conversacional falha |
| `TTS` | texto correto existe antes da síntese, mas voz, onset, chunking, prosódia ou áudio entregue falha |
| `INTERRUPTION` | evidência de barge-in/backchannel existe, mas pausa, cessão, retomada ou lifecycle executa ação errada |
| `TASK` | delegação, cancelamento, obsolescência ou reintegração falha apesar dos estágios anteriores corretos |

`MULTI_STAGE` é permitido quando dois estágios são inseparáveis;
`UNATTRIBUTED` é obrigatório quando faltam dados. A referência comercial não
possui traces internos e nunca participa dessa atribuição.

## Falha técnica reproduzível

Para uma família, `R=true` exige estágio e assinatura objetiva compatíveis por
um destes caminhos congelados:

1. a mesma violação aparece em pelo menos dois participantes independentes sob
   a mesma cena/condição; ou
2. quando o consentimento e o componente permitem replay, o input preservado
   reproduz a mesma violação em 2/2 replays sob o freeze.

Relato isolado, comentário, opinião do analista ou diferença contra o produto
comercial não satisfazem `R`. Replays são diagnósticos e não acrescentam
participantes ao denominador.

## Métrica e regra de prioridade

Para cada família `f`, calculam-se por participante:

- `P_f`: número de participantes cujo top-2 final inclui `f` (`0..6`);
- `Q_f`: entre esses participantes, quantos tiveram ao menos uma cena de `f`
  com severidade `3` ou `4`;
- `S_f`: mediana da maior severidade de `f` por participante que a colocou no
  top-2;
- `R_f`: falha técnica reproduzível, conforme a regra anterior.

Uma família é **dominante elegível** somente com `P_f >= 4`, `S_f >= 2` e
`R_f=true`. Não há soma opaca ou casas decimais artificiais para `n=6`. A
ordenação é lexicográfica e auditável:

1. elegibilidade dominante;
2. `P_f` decrescente;
3. `Q_f` decrescente;
4. `S_f` decrescente;
5. força da reprodução: dois participantes antes de replay único;
6. em empate completo, maior reutilização e menor custo do próximo teste.

O relatório mostra `P`, `Q`, `S` e `R` separadamente para os três primeiros.
Se nenhuma família aparecer no top-2 de ao menos 4/6 participantes, a decisão
é obrigatoriamente `NO_DOMINANT_BOTTLENECK`, independentemente de uma cena
muito ruim ou de uma falha técnica isolada.

Se `P>=4` e a severidade passar, mas `R=false`, a próxima pergunta pode ser
somente reproduzir/atribuir essa falha; otimizar o componente ainda não é
autorizado. Se não houver dominante, qualquer proposta futura deve ser um
único diagnóstico discriminante/replicação sob novo ID, nunca a soma de três
frentes de implementação.

## Calibração opcional com referência Live comercial

Este módulo é um termômetro de distância perceptiva, não um A/B confirmatório.
Ele só ocorre **depois** de selados severidades e top-2 locais e requer
consentimento separado para processamento por terceiro.

O dry-run decide se o módulo inteiro cabe no tempo e pode ser aplicado com
acesso/configuração estáveis. Se não puder, ele é marcado como não viável no
freeze e não aparece para nenhum participante; nunca entra parcialmente depois
de a coleta externa começar.

São usadas três âncoras semanticamente equivalentes às cenas locais:

1. hesitação + continuação/backchannel;
2. barge-in com correção;
3. nome/data/valor sob a mesma condição de ruído.

Pares de superfície A/B são congelados e contrabalanceados 3/3 entre
participantes. O mesmo participante, microfone, saída, sala, posição e janela
temporal curta são preservados. Serão registrados produto/surface, plano,
cliente/versão quando expostos, voz, configurações, data/hora e ausência de
memória/personalização. Backend, prompt e versão server-side não expostos são
marcados `unknown`, nunca inferidos.

Por âncora registra-se apenas:

```text
nosso muito pior | um pouco pior | semelhante | um pouco melhor | muito melhor
confiança: 1..5
motivo opcional
```

Não se gravam áudio, tela, transcrição nem output do produto comercial. Seus
outputs não entram em treino, exemplos, prompts, regressões ou engenharia
reversa. O bloco não soma prevalência, severidade ou reprodução, não muda o
ranking e não escolhe o próximo experimento. Com menos de seis participantes
elegíveis, ou quando termos/privacidade/configuração impedirem comparabilidade,
o módulo inteiro é `NOT_EVALUATED_REFERENCE_INCOMPLETE` sem invalidar o
diagnóstico local. Mesmo completo, o resultado é descritivo e sujeito a marca,
ordem, memória, rede e mudança server-side.

## Orçamento e timebox

- implementação do instrumento: no máximo 2 dias úteis;
- um dry-run interno, excluído;
- 6 sessões válidas e no máximo 2 reposições administrativas;
- até 25 chamadas externas por processo, 150 no lote analisável, mais até 25
  no dry-run e US$ 5 cumulativos no máximo; atingir o teto encerra novas
  sessões sem substituir resultados;
- módulo comercial: até 3 âncoras e 4 minutos por participante;
- análise e closeout: no máximo 1 dia útil depois da sexta sessão;
- GPU: `0`; External Challenger Runner: `0`; DuplexCascade: `0`.

## Gate antes de abrir a primeira sessão

Todos precisam passar:

1. teste do contrato do instrumento e formulários;
2. dry-run interno concluído e excluído;
3. freeze final existente, hasheado e coerente com o processo em execução;
4. health de ASR/TTS/cérebro e teto de custo ativos;
5. dispositivos e sala iguais ao freeze;
6. probe de ruído dentro da tolerância;
7. gravação de áudio/trace desligada por padrão e ativada somente pelo
   consentimento correspondente;
8. caminho local para dados sensíveis fora do Git e política de deleção ativa;
9. persistência incremental ou snapshot fechado por cena; o buffer visual de
   eventos do navegador não pode ser a única fonte de trace;
10. zero Pod/GPU e zero External Challenger Runner.

Uma falha antes da primeira cena impede abrir a sessão; ela não pode ser
reinterpretada como resposta humana.

## Árvore de decisão terminal

### Gestão de piso dominante

Se `RITMO_E_TROCA_DE_TURNO` for a dominante elegível e a atribuição principal
for `ENDPOINT` ou `INTERRUPTION`, registrar um **novo experimento e novo ID**.
O EXP-0025-R não reabre. Nesse novo experimento:

- a pergunta DuplexCascade volta de `UNRESOLVED — DEFERRED BY PRODUCT
  PRIORITY` para ativa;
- o External Challenger Runner precisa ser qualificado antes de qualquer GPU;
- qualquer execução de `E` em `D` usa adaptador/runner novos e um holdout fresco
  só pode nascer após ganho residual em desenvolvimento.

### Outra família dominante

Registrar somente o menor experimento causal para o estágio indicado. A
pergunta DuplexCascade permanece `UNRESOLVED — DEFERRED BY PRODUCT PRIORITY`;
nenhuma comparação externa é autorizada por associação.

### Percepção recorrente sem reprodução

Registrar somente um experimento de atribuição/reprodução da família líder.
Não alterar runtime, treinar ou comparar backbone.

### Nenhuma família em 4/6

Fechar como `NO_DOMINANT_BOTTLENECK`. Não escolher o maior número por mera
ordem. Se ainda houver valor de informação, propor no máximo uma replicação
curta e discriminante sob novo ID; caso contrário registrar
`NEXT_EXPERIMENT_NOT_JUSTIFIED`.

## Entrega final obrigatória

O closeout deverá conter:

1. seis linhas participant-level desidentificadas e exclusões administrativas;
2. integridade do freeze, consentimento e ruído;
3. top-2 selado de cada participante;
4. três gargalos ordenados com `P`, `Q`, `S` e `R`;
5. incidentes e atribuição entre `AUDIO`, `ASR_PARTIAL`, `ASR_FINAL`,
   `ENDPOINT`, `BRAIN`, `TTS`, `INTERRUPTION` e `TASK`;
6. módulo comercial em apêndice separado, ou seu motivo de não avaliação;
7. exatamente zero ou uma proposta de próximo experimento;
8. disposição explícita da pergunta DuplexCascade.

## Proibições nesta rodada

- implementar ou alugar infraestrutura do External Challenger Runner;
- criar Pod, usar GPU ou executar o DuplexCascade;
- reabrir EXP-0025 ou EXP-0025-R;
- usar o holdout histórico `H-L` para outro candidato;
- treinar, ajustar prompt/modelo ou selecionar cenas depois de respostas
  externas;
- converter outputs humanos ou comerciais em dataset de treino;
- promover qualquer mudança de runtime a partir deste diagnóstico.

## Resultado

Ainda não executado. Nenhum dado humano ou comercial foi observado neste
experimento.

## Decisão

```text
PENDING_END_TO_END_BOTTLENECK_DIAGNOSIS
```

## Próxima pergunta

Qual estágio da vertical completa merece o próximo experimento causal, se
algum, quando percepção recorrente, severidade material e reprodução técnica
forem consideradas em conjunto?
