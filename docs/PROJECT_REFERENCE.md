# Referência macro do projeto

Status: **referência canônica — consolidada em 02/08/2026 após auditoria,
contranálise, calibração EXP-0015 e M4b acústico EXP-0016 em shadow**

## Tese

Construir uma camada proprietária de interação por voz full-duplex para
português brasileiro, apoiada inicialmente em pesos abertos, capaz de ouvir
enquanto fala, administrar o turno e delegar inteligência pesada para qualquer
LLM ou ferramenta sem quebrar a conversa.

O projeto não pretende treinar um foundation model do zero. A propriedade deve
nascer primeiro do comportamento, dos traces, do sistema de avaliação, dos
dados e do pós-treinamento da interação. Um backbone nativo de áudio só entra
quando a vertical modular demonstrar um teto mensurável.

No horizonte de produto, a experiência completa deve poder operar localmente,
sem internet. Isso não impede usar modelos online durante P&D para gerar dados,
criticar experimentos ou servir como referência: desenvolvimento assistido por
IA e dependência online no runtime são decisões diferentes.

## Experiência desejada

Para o usuário, o sistema deve parecer um interlocutor cooperativo:

- escuta continuamente, inclusive enquanto produz fala;
- distingue pausa, hesitação, backchannel, interrupção e correção;
- para de falar rapidamente quando o usuário toma o turno;
- não executa uma intenção ainda provisória;
- confirma de forma curta apenas quando isso ajuda;
- mantém ritmo enquanto tarefas externas rodam;
- cancela, corrige e reincorpora resultados sem perder contexto;
- fala português brasileiro de forma inteligível, natural e previsível.

O parâmetro de sucesso é o que a pessoa percebe no caminho completo, não a
latência ou a acurácia isolada de um componente.

## Separações que protegem a estratégia

### Interação não é o cérebro profundo

A camada de interação decide:

```text
WAIT | BACKCHANNEL | SPEAK | STOP | DELEGATE | CANCEL | ROLLBACK
```

Conhecimento, pesquisa, raciocínio e ferramentas ficam atrás de uma porta
assíncrona e substituível. Assim, trocar o cérebro não exige reconstruir voz,
turn-taking ou dados de interação.

### Vertical de engenharia não é prontidão humana

Uma versão pode ser promovida para engenharia quando transporte, áudio,
concorrência e comportamento passam seus gates. Isso não autoriza afirmar que
a voz é confortável, que o sotaque é natural ou que funciona em qualquer sala.
Os dois placares permanecem separados.

### Escala sintética não é validade externa

IA produz diversidade e velocidade. Humanos verificam, mais tarde, se essa
diversidade representa o mundo e se a experiência é agradável. Nesta fase
preliminar, dados humanos não são o gargalo do caminho crítico; usá-los como
depurador de bugs estruturais teria baixo retorno.

## Princípios originais preservados

1. avaliação antes de treinamento;
2. verticais completas antes de refinamento isolado;
3. maior retorno e valor de informação por unidade de esforço;
4. uma hipótese, uma baseline e gates de proteção por experimento;
5. pesos abertos e providers substituíveis;
6. zero dependência de API paga nas regressões extensivas;
7. promoção por evidência repetível, nunca por impressão;
8. treinamento próprio somente sobre falhas e capacidades já medidas;
9. caminho nativo full-duplex como challenger, não como crença inicial;
10. experiência percebida no limite do usuário como critério final.

## Posição atual

### M1 permanece promovida

A primeira vertical modular local foi promovida para engenharia na campanha
histórica:

- 163/163 testes e 20/20 expectativas de política;
- 10/10 execuções no Chrome, com 27/27 gates em cada;
- final textual injetada→`HTMLAudioElement.onplaying` p95 de 187 ms; exclui
  microfone, VAD, ASR e cauda física da sala;
- interrupção PCM até último quantum renderizado p95 de 83,21 ms;
- retomada após backchannel p95 de 282,1 ms;
- sessão física de 600,082 s e 30.001 frames, sem falso início, gap ou drop;
- 15/15 falas detectadas e finalizadas no pipeline ao vivo;
- Silero v6.2 promovido sobre a baseline de energia;
- ASR, VAD, controle e TTS rodam localmente; LLM externo é opcional.

Isso prova a fundação full-duplex modular no escopo medido naquela campanha.

### A fundação M2 existe e encontrou o próximo gargalo

A fábrica v0.2 executou uma vertical completa de autocorreções. O build canônico
`f9be3098` contém 24 casos, rejeitou 288/288 corrupções de observação pelos
oráculos — 12 operadores aplicados aos 24 casos — e cobriu 85,7% dos pares de
fatores. Os 12 WAVs e 12 cenas acústicas estão vinculados às execuções por
hash; evaluator, runtime, artefatos e telemetria de custo passaram todas as
provas de integridade.

Resultados ponta a ponta:

- WebSocket limpo: 12/12 casos operáveis, WER 6,67% e recall crítico 97,22%;
- WebSocket com fala baixa/ruído: 12/12 operáveis, WER 7,14% e recall crítico
  91,67%;
- Chrome textual: 6/6 correções semânticas;
- Chrome PCM limpo: 5/6 conclusões estritas e 6/6 saídas seguras;
- o caso divergente `R$ 150` × `R$ 1.150` virou pergunta curta sem commit;
- Chrome PCM a 10 dB: 3/6 conclusões estritas e 5/6 saídas seguras;
- renderer parou em no máximo 50 ms nos cinco casos aplicáveis;
- zero chamadas pagas e zero tokens externos.

Decisão: toolchain da fábrica `promote`; runtime de engenharia e experiência do
usuário `hold`. O primeiro gargalo reproduzível são as falhas de fidelidade de
nomes, dias, horários e valores ao atravessar o ASR, sobretudo sob ruído.

O estado atual ainda não prova:

- naturalidade e conforto comparáveis às melhores referências;
- robustez ampla a pessoas, sotaques, salas e double-talk;
- qualidade semântica elevada em conversa aberta;
- ausência de efeitos obsoletos em ferramentas externas;
- pausa e cross-turn causalmente fiéis em toda a matriz;
- TTS aberto promovido;
- peso comportamental que supere a baseline ou demonstre generalização;
- operação inteligente totalmente offline.

## Estratégia de dados nesta fase: fábrica de avaliações por IA

Não construiremos um dataset sintético único e o trataremos como verdade. A
primeira vertical já implementada usa IA apenas para superfícies linguísticas,
sobre blueprints confiáveis que fixam semântica, risco e oráculo:

```text
blueprint confiável + fatores pairwise
        ↓
superfície linguística de IA congelada
        ↓
assembler + oráculo determinístico
        ↓
mutação adversarial do oráculo
        ↓
Maria TTS + ganho/ruído seeded
        ↓
replay WebSocket e Chrome texto/PCM
        ↓
relatório agregado com hashes e gates
```

Esse caminho já existe para correções. O loop autônomo gerador→adversário→
crítico, os clusters que geram novos casos e a ambientalização multivoz com
salas/eco/sobreposição são o horizonte da fábrica, não capacidades atuais.

A fábrica deverá variar de forma independente:

- intenção, conteúdo, vocabulário e complexidade;
- pausas, hesitações, correções e mudanças de ideia;
- momento e duração de interrupções e backchannels;
- falante, voz, velocidade, volume e prosódia;
- ruído, reverberação, eco, distância e fala simultânea;
- tarefa, ferramenta, atraso, cancelamento e resultado tardio;
- falhas de transporte, scheduler e recursos locais.

### Papéis da IA

Hoje, o papel materializado é o de gerador de superfícies; mutações e julgamento
dos invariantes são determinísticos. À medida que os demais papéis entrarem,
eles permanecerão substituíveis:

- **gerador:** cria famílias diversas de conversas;
- **adversário:** procura ambiguidades e contraexemplos;
- **crítico:** identifica cobertura artificial ou repetitiva;
- **mutador:** cria variações mínimas que deveriam preservar uma decisão;
- **juiz semântico:** avalia conteúdo aberto onde não há resposta literal única;
- **professor:** propõe rótulos e preferências para o primeiro modelo de
  interação.

Timing, perda de áudio, ordem, cancelamento, argumentos de ação e rollback usam
oráculos determinísticos sempre que possível. Julgamento de IA não substitui
uma invariável verificável.

### Proteções contra viés sintético

- blueprints e oráculos confiáveis, não o gerador, definem o acerto;
- casos aprovados são congelados com seed, versão, prompt e proveniência;
- treino, desenvolvimento e teste mantêm famílias e variações separadas;
- invariantes metamórficas verificam que mudanças irrelevantes não alterem a
  decisão;
- todo holdout exposto durante um PDCA vira desenvolvimento; promoção de
  generalização exige um conjunto novo, congelado e ainda não observado;
- geradores, vozes e críticos diferentes reduzem monocultura;
- casos públicos humanos podem servir como âncoras sem virar o caminho crítico;
- a avaliação humana final mede a distância sintético→real.

## Escada de maturidade

### M0 — contratos de avaliação e relógio virtual

Filas, eventos, ações, cancelamento e métricas determinísticas.
**Concluído no evaluator.** A equivalência entre a política avaliada e a
combinação realmente executada no navegador/backend pertence ao fechamento
M2.5; não deve ser inferida apenas da promoção histórica de M0.

### M1 — vertical modular full-duplex

Microfone, VAD, ASR, política, cérebro substituível, TTS, player e interrupção
no mesmo caminho. **Promovido para engenharia.**

### M2 — robustez autônoma em escala

Fábrica por IA, centenas e depois milhares de variações, falhas agrupadas e
reincorporadas como regressões. **Fundação implementada; primeira vertical
executada; escala e promoção do runtime pendentes.**

### M2.5 — validade experimental do runtime

Unificar a semântica de decisão hoje distribuída entre evaluator, backend e
navegador. O alvo é separar:

- `InteractionKernel`: decisão pura e reproduzível;
- `InteractionRuntime`: relógios, filas, lifecycle e efeitos;
- `LocalAudioReflex`: pausa/STOP físico imediato próximo ao Web Audio.

Evaluator e experiência real devem usar o mesmo kernel. Um
`training-trace-v1` separado registra contexto incremental, relógios,
decisões propostas/aceitas/observadas e proveniência de rótulos.
**Em andamento; primeira fatia causal e extensão acústica materializadas.** O
EXP-0010 promoveu a primeira fatia: confirmação monetária
stateful, runtime autoritativo no backend e navegador sem política semântica
paralela. Em 5/5 ciclos de dois turnos houve zero commit prematuro e exatamente
um commit após a repetição inequívoca, com p95 de 94,9 ms para a pergunta neutra
e 399,9 ms para o aceite.

Isso não fecha M2.5. Os quatro smokes suplementares registraram atividade
acústica em três execuções, mas marcador antigo, ausência de rótulo humano e
falta de loopback impedem atribuir a origem ao áudio do assistente.

O EXP-0011 fechou a fatia seguinte. `LocalAudioReflex` v0.1 evidence-gated é o
padrão: no A/B de fonte idêntica, preservou a fala e bloqueou uma final tardia
onde o controle pausou/criou turno. O barge-in legítimo permaneceu em 157,39 ms
até o renderer e o probe físico corrente passou 30,147 s sem ativação. A decisão
é `promote-local-audio-reflex-slice`; lifecycle/clocks comuns, equivalência ampla
e especificidade física causal continuam em `hold`.

O EXP-0012 fechou o lifecycle local da saída. Hold, retomada, confirmação e
resultados tardios de `play()` agora passam por `OutputInterruptionLifecycle`
v0.1; seis fluxos reais do Chrome foram reproduzidos exatamente pelo mesmo
reducer. STOP no renderer ficou em 48 ms e onset PCM→último quantum em
183,66 ms. A decisão é `promote-output-interruption-lifecycle-slice`. O probe
físico causal não iniciou neste fingerprint e seus gates permaneceram falsos;
clocks/filas globais, efeitos externos e M2.5 completo continuam em `hold`.

O EXP-0013 fechou a primeira fatia causal do trace treinável. Seis conversas
reais do Chrome produziram 28 decisões reproduzidas e 22 efeitos encerrados,
com vínculo de sessão/fingerprint, proveniência, reconciliação e projeção v0
baseada somente em STOP renderizado e retomada audível. STOP ficou em 38 ms,
onset PCM→renderer em 169,82 ms e os 12 gates formais passaram, sem API paga.
A decisão é `promote-training-trace-interruption-slice`. O contrato completo,
streams acústicos hasheados, clocks entre processos, efeitos externos e M4a
continuam em `hold`; o probe físico corrente verde não implica universalidade.

O EXP-0014 fechou a infraestrutura M4a para o reflexo acústico. Sessenta
streams PCM geraram 330 exemplos em dez famílias separadas entre treino,
desenvolvimento e holdout. Um classificador local simples foi treinado duas
vezes com checkpoint idêntico; no Chrome, 11 decisões cobriram
`WAIT_FOR_EVIDENCE / PAUSE_OUTPUT / CONTINUE_OUTPUT`, com replay exato,
inferência p95 de 0,2 ms e zero autoridade/efeito. Barge-in permaneceu em
151,75 ms e a janela física corrente ficou verde por 30,072 s. A decisão é
`promote-m4a-acoustic-shadow-infrastructure`. Como os rótulos imitam a regra,
100% nos splits não prova ganho percebido nem generalização.

O EXP-0015 fechou o próximo artefato autônomo: um instrumento cego de
calibração temporal com 12 cenas e 36 contrafactuais estéreo. Sete cenas usam
CORAA somente como `evaluation-only`, três usam TTS local como
`development-synthetic` e duas são controles; nenhuma é `fit-eligible`. Duas
execuções da v0.1 foram um piloto de usabilidade: revelaram quatro pares de WAVs
idênticos apresentados separadamente, atribuição da fala confundida com timing
e falta de proveniência interno/externo. A v0.2 agrupa equivalências, aceita
empates, separa atribuição, permite comentário local opcional e reserva o gate
humano a participantes externos. O Chrome do Windows confirmou cenas com 2 e 3
opções sem expor ação ou cena, sem erro e sem submeter opinião artificial. A
decisão técnica é `promote-timing-calibration-instrument`. Com 3 participantes
externos e 1 interno, o gabarito aditivo v0.2.1 preserva atenção de 77,8% base e
100% emendada. A resolução v0.2.2 preserva 5 rótulos singulares e reconhece 3
conjuntos de ações consensualmente equivalentes: 8/9 cenas ficam resolvidas e
`calibration-sufficient-to-freeze-m4b-experiment` passa. Pack, perguntas e
registros permanecem intactos; há zero fit direto e nenhuma autoridade.

### M3 — qualidade modular local

Melhorar correções, semântica, TTS aberto, sobreposição e execução offline sem
regredir o full-duplex. É uma trilha contínua, não um bloco que precisava ser
“concluído” antes de M4a; agora, só falhas causais que afetem segurança, trace,
comparação ou aprendizado entram no caminho crítico.

### M4a — prova da infraestrutura de aprendizado

Fechar `dados → treino → checkpoint → inferência online → trace → replay`
com uma capacidade estreita em shadow mode. Pode usar poucos casos e até
superajustar; não recebe autoridade nem sustenta alegação de generalização.
**Promovido no EXP-0014 para o reflexo acústico estreito.**

### M4b — primeiro peso comportamental comparável

Treinar uma capacidade estreita sobre famílias separadas, medir em holdout
independente, calibrar rótulos sociais/temporais com uma amostra humana pequena
e comparar contra a baseline determinística. Autoridade só entra para a
capacidade que vencer seus gates; efeitos externos continuam protegidos por
regras determinísticas.

**Primeira capacidade promovida em shadow no EXP-0016; autoridade em hold.**
O agregado do EXP-0015 congelou a pergunta sem entrar no fit. O EXP-0016 usou
36 clips FLEURS PT-BR CC-BY-4.0 para construir 108 exemplos procedurais, com
clips e famílias separados entre treino, desenvolvimento e holdout. O modelo
bruto atingiu 77,8% no holdout contra 50% da baseline. No reencontro com nove
âncoras humanas resolvidas, o modo conservador atingiu 7/9 contra 5/9 e recall
5/5 em fala dirigida. Quatro probes no Chrome confirmaram paridade Node/browser,
zero futuro e zero autoridade.

Isso sustenta `promote-m4b-speaker-relevance-shadow-candidate`, não autoridade.
O veto conservador ainda atinge apenas 55,6% no holdout procedural e falha os
gates operacionais. O próximo valor de informação é ampliar diversidade,
calibrar abstention sem olhar o holdout final e congelar um novo conjunto não
visto.

### M5 — calibração e avaliação humana

Uma calibração pequena de timing e rótulos entra entre M4a e M4b para impedir
que regras e dados sintéticos definam sozinhos o comportamento social desejado.
Ela não é uma avaliação de produto. Quando os erros estruturais estiverem
raros, conversas cegas maiores medem naturalidade, conforto, sotaque, confiança
e cauda acústica. Falhas reais voltam para a fábrica como novas famílias.

**Piloto concluído; calibração suficiente para congelar M4b.** O gate manteve
três participantes externos únicos, mínimo de atenção de 80% — com 100%
observado após a emenda —, três votos de preferência por cena, consenso de dois
terços e cobertura resolvida de 60%.
Uma resolução pode ser singular ou um conjunto de ações consensual; somente a
primeira pode virar rótulo, e ainda depende de origem `fit-eligible`. O resultado
corrente é 8/9 resolvidas, uma ambígua e zero fit direto. Trata-se de um detector
barato de direção e ambiguidade, não de uma estimativa final de produto.

### M6 — adaptação nativa de áudio, se necessária

Só começa se a cascata demonstrar teto persistente em prosódia, timing ou
sobreposição que não seja explicado por ASR, TTS, runtime ou dados.

## Próximos fechamentos por retorno/esforço

A ordem executável existe em um único lugar:
[Roadmap — ordem operacional consolidada](ROADMAP.md#ordem-operacional-consolidada).
Esta referência preserva apenas a lógica macro:

1. preservar o `reject-safety` do EXP-0007 e o `hold-latency` do verificador
   EXP-0008;
2. manter o interlock monetário EXP-0009 como guardrail, sem alegar que ele
   recupera o valor;
3. usar a baseline v0.3 congelada como comparador de desenvolvimento;
4. preservar as fatias promovidas do kernel, reflexo, lifecycle, trace causal
   e M4a acústico local;
5. preservar o EXP-0015 concluído, sem transformar equivalências em ação única
   ou o piloto em avaliação de produto;
6. preservar o candidato M4b EXP-0016 em shadow como evidência de capacidade,
   sem confundir seu rótulo bruto com uma decisão segura;
7. calibrar o veto sobre diversidade nova e um holdout pré-congelado;
8. conceder autoridade somente se houver ganho percebido sem regressão dos
   guardrails;
9. desafiar contrato/evaluator com referência nativa apenas quando houver uma
   pergunta experimental concreta;
10. continuar escolhendo ASR, TTS, acústica ou cérebro pelo maior gargalo
   observado, não por ordem fixa.

Qualidade de ASR, TTS, acústica ou cérebro entra depois pelo maior gargalo
medido, não por uma fase presumida.

## Gate para envolver humanos como caminho crítico

Humanos passam a ser o próximo experimento, e não apenas uma verificação
ocasional, quando:

- sessões longas, interrupção, correção e tarefas estiverem estáveis sob grande
  diversidade sintética;
- novas rodadas de geração encontrarem principalmente variações já cobertas;
- dois ou mais candidatos maduros exigirem uma decisão perceptiva;
- os erros restantes forem naturalidade, conforto, sotaque, eco físico ou
  comportamento social difícil de reduzir a uma regra.

O conjunto humano não precisa ser enorme para essa função: ele calibra a
validade externa, mede preferência e revela o que a fábrica ainda não modela.
Depois, essas descobertas ampliam novamente a automação.

## O que não entra agora no caminho crítico

- montar a melhor base humana possível antes de fechar problemas estruturais;
- treinar um foundation model de áudio do zero;
- usar modelos premium em toda regressão;
- escolher um backbone por demonstração ou reputação;
- otimizar um componente sem medir efeito ponta a ponta;
- confundir voz reproduzida no renderer com áudio realmente ouvido na sala;
- declarar nível de referência com base apenas em proxies sintéticos.

## Hierarquia documental

Este documento é a referência macro canônica. Os demais detalham partes dela:

- [Produto e hipóteses](PRODUCT.md): experiência e hipóteses falsificáveis;
- [Arquitetura](ARCHITECTURE.md): contratos e implementação;
- [Sistema de avaliação](EVALUATION.md): dados, métricas e gates;
- [Ciclo autônomo](AUTONOMOUS_LOOP.md): execução dos PDCAs;
- [Roadmap](ROADMAP.md): ordem de decisões;
- [Decisão runtime/aprendizado](DECISION_RUNTIME_LEARNING_SEQUENCE.md):
  racional consolidado e alternativas;
- [Trace de treinamento](TRAINING_TRACE_V1.md): contrato causal para shadow e
  aprendizado;
- [Experimentos](experiments/): evidências e promoções;
- pré-análise original `opiniao_chatgpt_sobre_conversacional.md`, mantida
  fora do repositório: fonte histórica da tese, não estado operacional do
  projeto.
