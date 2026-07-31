# Referência macro do projeto

Status: **referência canônica — 31/07/2026**

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
- primeiro áudio simples p95 de 187 ms;
- interrupção PCM até último quantum renderizado p95 de 83,21 ms;
- retomada após backchannel p95 de 282,1 ms;
- sessão física de 600,082 s e 30.001 frames, sem falso início, gap ou drop;
- 15/15 falas detectadas e finalizadas no pipeline ao vivo;
- Silero v6.2 promovido sobre a baseline de energia;
- ASR, VAD, controle e TTS rodam localmente; LLM externo é opcional.

Isso prova a fundação full-duplex modular no escopo medido naquela campanha.

### A fundação M2 existe e encontrou o próximo gargalo

A fábrica v0.2 executou uma vertical completa de autocorreções. O build canônico
`f9be3098` contém 24 casos, matou 288/288 mutantes de oráculo e cobriu 85,7% dos
pares de fatores. Os 12 WAVs e 12 cenas acústicas estão vinculados às execuções
por hash; evaluator, runtime, artefatos e telemetria de custo passaram todas as
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
- pesos proprietários treinados;
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

### M0 — contratos e relógio

Filas, eventos, ações, cancelamento e métricas determinísticas. **Concluído.**

### M1 — vertical modular full-duplex

Microfone, VAD, ASR, política, cérebro substituível, TTS, player e interrupção
no mesmo caminho. **Promovido para engenharia.**

### M2 — robustez autônoma em escala

Fábrica por IA, centenas e depois milhares de variações, falhas agrupadas e
reincorporadas como regressões. **Fundação implementada; primeira vertical
executada; escala e promoção do runtime pendentes.**

### M3 — qualidade modular local

Melhorar correções, semântica, TTS aberto, sobreposição e execução offline sem
regredir o full-duplex.

### M4 — primeiro peso proprietário de interação

Treinar um modelo pequeno sobre os traces e ações atuais; rodar em shadow contra
a política determinística; promover somente por ganho medido.

### M5 — calibração humana

Quando os erros estruturais estiverem raros, executar conversas cegas com
pessoas reais para naturalidade, conforto, sotaque, confiança e cauda acústica.
Falhas reais voltam para a fábrica como novas famílias de casos.

### M6 — adaptação nativa de áudio, se necessária

Só começa se a cascata demonstrar teto persistente em prosódia, timing ou
sobreposição que não seja explicado por ASR, TTS, runtime ou dados.

## Próximos fechamentos por retorno/esforço

1. **Prefinal acústica determinística:** comparar a política atual com snapshot
   fixo na pausa, repetindo o mesmo PCM no WebSocket e Chrome; separar
   framing/merge de nondeterminismo do decoder e atacar a cauda de latência.
2. **Proteger slots de risco:** testar verificador ASR condicional somente se o
   experimento anterior provar ganho, sem taxar todo turno nem afrouxar o
   oráculo.
3. **Temporalidade e efeitos reais:** encenar pausa/cross-turn causalmente e
   adicionar ledger/test-double para provar que valores obsoletos não escapam.
4. **Repetição e generalização:** obter amostra suficiente para caudas e criar
   um novo holdout congelado que o ciclo ainda não viu.
5. **Diversidade acústica e TTS local aberto:** só então ampliar vozes, salas,
   eco e sobreposição e comparar candidatos por primeiro PCM, cancelamento,
   CPU, memória e adequação conversacional.
6. **Modelo de interação em shadow e modo sem rede:** aprender as ações atuais
   sem autoridade e validar o caminho offline sob os mesmos gates.
7. **Torneio nativo limitado:** medir referências full-duplex somente quando a
   pergunta experimental estiver clara.

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
- [Experimentos](experiments/): evidências e promoções;
- [Pré-análise original](../../opiniao_chatgpt_sobre_conversacional.md): fonte
  histórica da tese, não estado operacional do projeto.
