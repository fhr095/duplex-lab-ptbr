# Roadmap guiado por gates

Este é o **único documento que define a ordem operacional**. As fases abaixo
organizam capacidades e podem se sobrepor; a tabela
[Ordem operacional consolidada](#ordem-operacional-consolidada) decide o que
entra agora no caminho crítico. O racional e as alternativas estão registrados
na [decisão de runtime e aprendizado](DECISION_RUNTIME_LEARNING_SEQUENCE.md).

## Carteira ativa em 03/08/2026

Esta é a leitura operacional curta. Se outra página usar “próximo” em um relato
histórico, esta carteira prevalece.

- **Concluído/cortado — EXP-0017 Core:** `A` preservou 60/60 falas dirigidas,
  mas acertou só 1/60 fundos e empatou `A0` em 50,8% por exemplo; nenhum
  holdout foi construído e a autoridade continua desligada.
- **Concluído/cortado — EXP-0017-R:** o alinhamento causal físico aceitou 11/15
  linhagens de fundo e 10/15 dirigidas em train, abaixo das 12 independentes
  exigidas por classe. Nenhum fit, limiar ou métrica semântica foi executado;
  os pisos não foram reduzidos.
- **Concluído — EXP-0018:** sob uma única abertura selada, `B1` acertou 31/32
  casos contra 16/32 de `B0`, preservou 16/16 falas dirigidas, recuperou 15/16
  fundos, venceu 15 pares líquidos e melhorou nos 8/8 blocos e 4/4 famílias.
  Os 12 gates passaram; o delta local p95 foi 0,127 ms. Isso valida apenas o
  matcher relacional nas cenas textuais sintéticas contrabalanceadas, sem
  autoridade, holdout, áudio real ou alegação de compreensão ampla.
- **Concluído/cortado — EXP-0019:** a única materialização fechou 8 cenas, 12
  streams e 48 probes sem futuro; Node/Chrome tiveram paridade exata e proposta
  p95 de 8,7 ms. O trace físico, porém, alternou a ordem entre
  `speech.paused` e `render.stopped`; 7/9 gates passaram e nada foi promovido.
- **Concluído/invalidado — EXP-0020:** freeze, abertura e tentativa única foram
  preservados, mas o primeiro `Network.getResponseBody` devolveu corpo vazio.
  Nenhuma navegação ou trial foi persistido; a avaliação física é
  `NOT_EVALUATED`, sem rerun e sem alteração do corte anterior.
- **Concluído/invalidado — EXP-0021:** 4/4 WAVs foram recuperados na primeira
  leitura, com bytes e SHA-256 idênticos entre browser e CDP, estabilidade A/B
  e todos os gates de captura verdadeiros. O instrumento, porém, exigia um
  health por navegação e observou corretamente dois — bootstrap + auditoria.
  A tentativa foi consumida, o claim permaneceu nulo e não há qualificação.
- **Concluído/invalidado — EXP-0022:** os dois healths foram distinguidos e 4/4
  capturas repetidas, mas o instrumento misturou ordem de entrega com
  timestamps de origem. Em 40/40 requests, os ordinais estavam corretos e
  `responseTimestamp > finishedTimestamp`; nove de dez gates passaram, claim
  permaneceu nulo e a tentativa não será repetida.
- **Concluído — EXP-0023:** a tentativa única passou os dez gates. Foram 4/4
  WAVs browser=CDP, 40 requests e 120 ordinais globais únicos; os 40
  timestamps response/finish invertidos exercitaram o delta prospectivamente.
  O coletor está qualificado neste escopo, sem STOP ou autoridade de runtime.
- **Concluído/invalidado — EXP-0024:** a única campanha chegou ao primeiro
  trial, mas a expressão exigiu exatamente um `render.active` inicial. A fala
  natural produziu múltiplas transições acústicas; nenhum STOP foi persistido,
  o físico permanece `NOT_EVALUATED` e não houve rerun.
- **Concluído/cortado — EXP-0025:** a tentativa única ligou o Chrome e iniciou
  a primeira navegação, mas a prontidão ainda exigia `__exp0022Audit`, que o
  caminho mínimo já não instalava. Foram seis frames canônicos, zero trials e
  `STOP-R=NOT_EVALUATED`. A linhagem deste instrumento está encerrada sem
  rerun; health, rede e WAV permaneceram fora dos gates e não causaram o corte.
- **Paralelo ativo, trilha local cortada — EXP-0025-R:** no holdout one-shot,
  `L` reduziu tomadas prematuras de 9/24 para 4/24, corrigiu cinco falas sem
  introduzir falhas e melhorou duas sessões, mas falhou o gate p95: 1.200 ms
  contra 800 ms. Como foi equivalente a `A0@600`, mantemos `A0` e não abrimos
  `L2`. A referência externa `E` segue `NOT_EVALUATED`, condicionada a
  autorização explícita de até 40 GiB, 2 GPU-horas e US$ 12.
- **Estacionado:** executar backbones nativos end-to-end em GPU, otimizar prosódia/TTS,
  ampliar multimodalidade e conduzir avaliação humana ampla de produto. Cada
  frente só volta quando for o maior gargalo percebido e houver comparação
  local capaz de mudar uma decisão.

O fechamento anterior, o contrato congelado e o resultado corrente estão no
[EXP-0017](experiments/EXP-0017-safe-veto-and-semantic-probe.md), no
[closeout do EXP-0018](experiments/EXP-0018-closeout.md), no
[pré-registro do EXP-0019](experiments/EXP-0019-causal-audio-context-bridge.md)
e em seu [closeout](experiments/EXP-0019-closeout.md). A tentativa física e sua
invalidação estão no [EXP-0020](experiments/EXP-0020-physical-stop-order.md) e
no [closeout](experiments/EXP-0020-closeout.md). A qualificação invalidada está
no [pré-registro](experiments/EXP-0021-cdp-capture-recovery.md) e no
[closeout do EXP-0021](experiments/EXP-0021-closeout.md). O EXP-0022 está no
[pré-registro](experiments/EXP-0022-bootstrap-audit-health-binding.md) e no
[closeout do EXP-0022](experiments/EXP-0022-closeout.md). O EXP-0023 está no
[pré-registro](experiments/EXP-0023-cdp-ordinal-timestamp-semantics.md) e no
[closeout](experiments/EXP-0023-closeout.md). O EXP-0024 está no
[pré-registro](experiments/EXP-0024-physical-stop-after-capture-qualification.md)
e no [closeout](experiments/EXP-0024-closeout.md). O EXP-0025 está no
[pré-registro](experiments/EXP-0025-causal-render-onset-physical-stop.md) e no
[closeout terminal](experiments/EXP-0025-closeout.md). Não há novo caminho
crítico registrado enquanto a decisão externa da trilha paralela aguarda
autorização.
O [ledger de challengers](research/CHALLENGER_LEDGER.md) controla a pesquisa sem
criar uma segunda prioridade crítica; o
[EXP-0025-R](experiments/EXP-0025-R-duplexcascade-floor-control.md) define seu
único probe ativo e o
[closeout local](experiments/EXP-0025-R-local-closeout.md) preserva o corte de
`L`; o
[índice de experimentos](../eval/EXPERIMENT_INDEX.json) liga decisões a
artefatos canônicos verificáveis.

## Fase 0 — laboratório de decisão

Status: **implementado**.

Entregas:

- contrato de eventos e traces;
- cenários PT-BR v0.1;
- política determinística;
- regressões automatizadas;
- demo de interação;
- pesquisa inicial de modelos.

Gate: 100% das expectativas de engenharia.

## Fase 1 — primeira vertical com áudio real

Status: **vertical de engenharia promovida; prontidão humana em hold**. Captura
PCM, VAD Silero, ASR aberto incremental, endpoint, cérebro substituível, TTS,
interrupção, recuperação de transporte e campanhas Chrome funcionam juntos. O
gate restante não é integração: é qualidade PT-BR espontânea, acústica física
e preferência humana.

Objetivo: uma conversa PT-BR de ponta a ponta, ainda modular.

Entregas:

1. captura de microfone e render probe separados no grafo Web Audio —
   **implementado; canal físico de loopback pendente**;
2. timestamp monotônico por frame;
3. AEC/noise suppression explícitos;
4. streaming ASR PT-BR — **Whisper `tiny` parcial + Parakeet final em CPU,
   implementado**;
5. política atual ligada a eventos reais — **implementado**;
6. streaming TTS PT-BR cancelável — **provisório via Windows, implementado**;
7. adaptador de LLM externo com `AbortSignal` — **implementado**;
8. relatório acústico — **CORAA, WebSocket e Chrome implementados; cauda
   alto-falante/sala e A/B humano pendentes**.

Regra de custo: regressões e sweeps de engenharia não chamam APIs pagas.
Providers externos entram apenas em canários pequenos e comparações congeladas,
sob o mesmo contrato de traces.

Gate provisório:

- sessão estável de 10 minutos;
- parada acústica p95 ≤ 250 ms;
- primeiro áudio p95 ≤ 1,2 s em respostas simples;
- falso corte ≤ 5% no pack;
- correção/delegação/cancelamento ≥ 95%.

Evidência congelada da promoção M1:

- 163/163 testes e 20/20 expectativas de política;
- 10/10 execuções do Chrome, 27/27 gates em cada;
- final textual injetada→`HTMLAudioElement.onplaying` p95 187 ms; não inclui
  microfone, VAD, ASR ou cauda física da sala;
- parada PCM→renderer p95 83,21 ms;
- retomada de backchannel p95 282,1 ms;
- soak físico de 600,082 s, 30.001 frames e zero falso início, gap ou drop;
- campanha PCM→VAD→endpoint→ASR com 15/15 falas finalizadas e 4/4 controles
  silenciosos.

O comparador registra `engineering-promote`. Ainda faltam loopback acústico
calibrado, diversidade humana e preferência cega; por isso a fase não recebe
`done` de produto. Essa campanha histórica não apaga instabilidade física nova:
o EXP-0010 encontrou atividade não rotulada em 3/4 smokes longos. O EXP-0011
removeu o efeito percebido de um pico marginal em A/B causal e passou um probe
físico corrente de 30,147 s, mas loopback causal e escala por dispositivo ainda
permanecem em `hold`. No fingerprint do EXP-0012, o probe causal não conseguiu
iniciar após o silêncio inicial; a ausência de nova medição ficou explícita e
não substitui a evidência histórica. A campanha canônica do EXP-0013 passou
30,074 s no probe corrente e fechou todos os gates físicos, mas isso continua
sendo evidência daquele dispositivo/ambiente, não especificidade universal.

## Fase 2 — fábrica autônoma de avaliações

Status: **fundação implementada; primeira vertical executada; runtime em
`hold`**.

Objetivo: usar IA para encontrar em escala as falhas que ainda não exigem uma
pessoa real. A vertical de correções já mostrou que a fábrica encontra defeitos
percebidos no caminho real; autonomia de geração/crítica e escala acústica ainda
precisam evoluir.

Entregas:

1. ontologia e schema versionados para correções — **implementados**;
2. blueprints confiáveis, oráculos semânticos/temporais e provenance —
   **implementados; ledger local da interrupção promovido e ledger externo
   pendente**;
3. superfícies linguísticas geradas e mutação adversarial determinística —
   **implementadas; geradores/críticos autônomos pendentes**;
4. fala sintética e ambientalização reproduzível — **uma voz, ganho e ruído
   branco implementados; multivoz, eco e reverberação pendentes**;
5. cobertura pairwise e auditoria metamórfica — **implementadas; novo holdout
   independente pendente**;
6. replay em lote no WebSocket e Chrome texto/PCM — **implementado no
   subconjunto de correções**;
7. relatório agregado com hashes, falhas e custo — **implementado**;
8. agrupamento e reincorporação autônoma de falhas — **pendente**.

Gate: novas rodadas ampliam diversidade sem descobrir continuamente classes
básicas de falha; decisões e efeitos críticos permanecem verificáveis por
oráculos independentes do gerador.

Evidência atual: toolchain `promote`; PCM limpo 5/6 semântico e 6/6 seguro;
PCM com ruído 3/6 semântico e 5/6 seguro. A fábrica foi promovida como
instrumento, não como prova de prontidão do runtime.

## Fase 2.5 — validade experimental do runtime

Status: **em andamento; fatias stateful, de reflexo, lifecycle e trace causal
local promovidas pelos EXP-0010–0013, e vínculo acústico mínimo promovido no
EXP-0014; clocks entre processos, efeitos externos e validade física ampla
ainda em `hold`**.

Objetivo: eliminar a diferença entre “política avaliada” e “política realmente
executada”. Hoje a decisão está distribuída entre a política do evaluator, o
controle acústico/temporal do backend e a orquestração do navegador.

Entregas:

1. `InteractionKernel` puro: estado + evento → próximo estado + intenções —
   **implementado para correção e confirmação monetária; demais intenções
   pendentes**;
2. `InteractionRuntime`: relógios, filas, lifecycle, autoridade e efeitos —
   **sessão autoritativa, LRU/retry e lifecycle local de saída implementados;
   clocks/filas globais e efeitos externos pendentes**;
3. `LocalAudioReflex`: pausa/STOP imediato no navegador, conciliado depois
   com o kernel — **reducer evidence-gated e integração browser promovidos;
   hold/retomada/confirm foi reconciliado no lifecycle local; política temporal
   ampla permanece pendente**;
4. adaptadores para evaluator, backend e navegador sob a mesma semântica, com
   uma única instância autoritativa por sessão real — **backend e navegador
   implementados na fatia crítica; evaluator e áudio pendentes**;
5. teste de equivalência entre replay virtual e caminho real — **gate causal
   de dois turnos implementado para a fatia crítica e replay exato de seis
   fluxos de interrupção local; equivalência ampla pendente**;
6. `training-trace-v1` com clocks, causalidade operacional, proveniência e
   proposta/aceite/efeito observado — **primeira fatia browser e extensão
   acústica com stream hasheado/posição de amostra promovidas; clocks entre
   processos pendentes**;
7. ledger/test-double de efeitos e holdout ainda não observado — **ledger
   local da interrupção e holdout por família de M4a promovidos; efeitos
   externos pendentes**.

Gate: o mesmo evento e estado produzem a mesma intenção nos três ambientes;
uma sessão real nunca possui duas autoridades de política; qualquer diferença
de efeito físico é atribuível e observável no runtime, não a uma política
paralela.

Evidência EXP-0010: 270/270 testes, 5/5 ciclos Chrome stateful, zero commit
antes da confirmação, exatamente um rollback/commit para `BRL 1150` depois da
repetição, p95 de 94,9/399,9 ms e zero chamada paga. A promoção vale somente
para essa fatia. Os smokes físicos suplementares continham atividade sem rótulo
e não sustentam atribuição causal de eco.

Evidência EXP-0011: 283/283 testes e A/B no mesmo fingerprint; o controle
pausou/criou turno diante do pico marginal e final tardia, enquanto o candidato
preservou a fala e suprimiu ambos. O barge-in legítimo fechou em 157,39 ms
contra teto de 350 ms;
o candidato passou 30,147 s físicos sem ativação e zero erro/API paga. A decisão
é `promote-local-audio-reflex-slice`, não promoção de M2.5 nem de especificidade
física universal.

Evidência EXP-0012: 299/299 testes; seis fluxos do Chrome cobriram as quatro
fases do `OutputInterruptionLifecycle` e oito intenções, todas reproduzidas
exatamente. STOP no renderer ficou em 48 ms, onset PCM→último quantum em
183,66 ms e backchannel PCM retomou 312,6 ms após o fim da fala. Seis corridas
assíncronas falharam fechadas e não houve erro/API paga. O probe físico causal
não iniciou; seus gates permaneceram falsos. A decisão é
`promote-output-interruption-lifecycle-slice`, não fechamento de M2.5.

Evidência EXP-0013: 314/314 testes; seis conversas do Chrome materializaram
28 decisões e 22 efeitos em bundles causais. Todas as decisões foram
reproduzidas a partir do contexto gravado; todos os efeitos terminaram; shadow
permaneceu sem autoridade; a projeção v0 emitiu STOP apenas após silêncio do
renderer e retomada apenas após `onplaying`. STOP ficou em 38 ms,
onset PCM→renderer em 169,82 ms e retomada em 315,5 ms após o fim acústico.
Os 12 gates formais e todos os gates da campanha corrente passaram, sem API
paga. A decisão é `promote-training-trace-interruption-slice`, não o contrato
completo nem M4a.

Evidência EXP-0014: 324/324 testes; 330 exemplos de 60 streams PCM em famílias
disjuntas; treino repetido bit a bit; as três classes presentes em todos os
splits e em 11 decisões online do Chrome. Trace, áudio, checkpoint e runtime
foram ligados por hashes/posições; o replay recalculou reducer, features e
probabilidades exatamente; inferência p95 ficou em 0,2 ms e o candidato
produziu zero efeitos. Barge-in terminou no renderer em 151,75 ms e a janela
física corrente de 30,072 s ficou verde. A decisão é
`promote-m4a-acoustic-shadow-infrastructure`, não ganho sobre a regra,
generalização, autoridade ou qualidade humana.

## Fase 3 — qualidade modular e local

Status: **iniciada**. Parser de correções, estado semântico e reparo de conflito
numérico antes de commit já existem; o gate ponta a ponta ainda não promove.

Até fechar a validade experimental do runtime, somente correções causais que
afetem segurança, fidelidade do trace, comparação entre candidatos ou o
primeiro treinamento entram no caminho crítico. Melhorias genéricas de WER,
TTS, regex ou poucos milissegundos sem impacto percebido ficam no backlog.

Atacar os maiores gargalos produzidos pela fábrica, preservando o caminho
full-duplex já promovido:

- correções, datas, valores, nomes e efeitos externos;
- endpoint e ASR seletivo sem taxar turnos comuns;
- TTS aberto, streaming e cancelável;
- fala simultânea, ruído, eco sintético e pressão de recursos;
- cérebro local opcional sob o mesmo contrato de provider;
- execução com rede bloqueada como gate explícito.

Torneios de componentes entram aqui, sempre no mesmo hardware e evaluator. Um
candidato recebe um spike limitado antes de precisar demonstrar ganho; nenhum
modelo vence por reputação ou demonstração.

Gate: ganho ponta a ponta em falhas medidas, dentro de budgets locais de
latência, memória e CPU, sem regressão de interrupção ou efeitos.

## Fase 4a — prova da infraestrutura de aprendizado

Status: **promovida no EXP-0014 para o reflexo acústico estreito, em shadow e
sem autoridade**.

Objetivo: provar o ciclo
`dados → treino → checkpoint → inferência online → trace → replay` com um
modelo pequeno, em shadow mode e sem autoridade.

Entrada:

```text
probabilidade VAD incremental + duração/evidência acústica
+ usuário/assistente falando + estado do reflexo + época da saída
```

Primeira saída:

```text
probabilidade de WAIT_FOR_EVIDENCE | PAUSE_OUTPUT | CONTINUE_OUTPUT
```

O runtime pode escolher `WAIT_FOR_EVIDENCE` quando confiança, risco ou prazo
não autorizam uma ação. Incerteza é inicialmente uma política de abstention,
não uma classe de verdade obrigatória.

Gate: checkpoint reproduzível, inferência online instrumentada e replay
determinístico. Superajuste é aceitável neste marco; ganho de qualidade e
generalização não são alegados.

## Fase 4b — primeiro peso comportamental comparável

Status: **primeira capacidade promovida em shadow no EXP-0016; veto seguro e
autoridade em hold**.

Hipótese: sinais incrementais compactos bastam para vencer a política
determinística em uma capacidade observada, sem reduzir os guardrails.

Sequência:

1. famílias de treino/desenvolvimento separadas do holdout;
2. rótulos com origem explícita: regra, blueprint, professor, humano ou
   resultado observado;
3. calibração humana pequena de timing e rótulos sociais;
4. comparação shadow contra a política determinística;
5. autoridade limitada apenas para a capacidade aprovada;
6. proteção determinística de efeitos, commit, delegação e cancelamento;
7. promoção por ganho no evaluator e no caminho real equivalentes.

Gate: melhora significativa em ao menos um gargalo real sem regressão nos
guardrails e em casos não vistos. A primeira capacidade é estreita; a ontologia
`WAIT/BACKCHANNEL/SPEAK/STOP/DELEGATE/CANCEL/ROLLBACK` continua sendo o
contrato de longo prazo, não a saída obrigatória do primeiro checkpoint.

O EXP-0015 promoveu a v0.2 do instrumento e concluiu a calibração que alimenta
o item 3, mas não produziu rótulos para fit. As duas execuções da v0.1 foram
reclassificadas como piloto de
usabilidade após revelarem opções idênticas separadas, atribuição da fala
confundida com timing e ausência de proveniência interno/externo. O agregado
humano v0.2.2 congelou a direção do novo experimento; o dataset M4b deverá
ser outro artefato, com famílias ainda não observadas e fontes explicitamente
`fit-eligible`.

O EXP-0016 executou os itens 1–4 e 7 para uma primeira capacidade estreita:
relevância acústica da fala. Com 108 exemplos derivados de 36 clips FLEURS
PT-BR CC-BY-4.0, o classificador bruto atingiu 77,8% no holdout contra 50% da
baseline. O modo conservador reencontrou ganho nas âncoras humanas — 7/9 contra
5/9, com recall dirigido 5/5 — e percorreu quatro probes no Chrome com paridade
exata, zero futuro e zero autoridade. O candidato M4b foi promovido em shadow;
o item 5 continua bloqueado porque o veto seguro ainda não passa os gates
procedurais.

## Fase 5 — calibração humana

Status: **instrumento e calibração pequena promovidos no EXP-0015; M4b
congelado e executado no EXP-0016; nova avaliação humana ampla não é caminho
crítico**.

Há duas atividades diferentes:

1. **calibração pequena de dados/rótulos**, entre M4a e M4b, para pausas,
   backchannels, interrupções e retomadas;
2. **avaliação humana de produto**, que só vira caminho crítico quando a
   fábrica e a vertical local estiverem maduras.

Conversas cegas de produto de 5–10 minutos medem naturalidade, conforto,
sotaque, previsibilidade, confiança, double-talk e cauda física da sala.

O objetivo não é construir primeiro uma base humana perfeita. É medir a
distância entre proxies e pessoas, escolher entre finalistas maduros e descobrir
novas famílias que voltam para a automação.

Gate: preferência e guardrails humanos com desenho estatístico versionado;
nenhum turno da mesma pessoa contado como participante independente.

O piloto de timing usou 12 cenas, comparação cega com duas ou três opções,
empate/dúvida explícitos, atribuição da fala separada e participante como
unidade. Comentários opcionais permanecem somente locais. O instrumento passou
17 gates técnicos no Chrome do Windows. O agregado corrente tem 3/3
participantes externos e 1 interno; internos não contam para o mínimo. A emenda
de gabarito v0.2.1 preserva 77,8% no placar-base e aceita 100% sob a
interpretação congelada do silêncio. A resolução v0.2.2 mantém 5/9 rótulos
singulares, reconhece 3 conjuntos consensuais e fecha 8/9 cenas, sem mutar
respostas nem autorizar fit direto. Isso promove o congelamento do experimento
M4b, não uma avaliação de produto ou autoridade no runtime.

## Fase 6 — adaptação nativa de áudio

Um mecanismo extraído de uma referência pode desafiar o contrato quando
responder uma pergunta concreta da carteira ativa sem desviar seu caminho
crítico. Os probes semânticos EXP-0017-R/0018 são resultados históricos;
executar outro mecanismo, backbone nativo ou GPU paga exige um gargalo local
novo, medido e com orçamento explícito.

Adaptação ou adoção só começa se houver evidência de que a cascata atingiu um
teto em prosódia, sobreposição ou timing.

Experimentos limitados:

1. zero-shot PT-BR nos backbones finalistas;
2. adaptação do tokenizer/decoder de fala;
3. SFT full-duplex pequeno;
4. ablação com e sem separação semântico-acústica;
5. DPO/RL apenas depois de SFT estável.

Critério de abandono: custo, lock-in ou perda semântica desproporcional ao ganho
no mesmo evaluator.

## Dados como patrimônio transversal

Os dados crescem ao longo de todas as fases:

- v0.1: roteiros determinísticos de engenharia — implementado;
- v0.2: 24 correções geradas sobre blueprints, uma voz, ganho/ruído e replay
  texto/PCM — implementado como pack de desenvolvimento;
- v0.3: falhas adversariais, tarefas e sessões sintéticas longas;
- v0.4: âncoras humanas e descobertas convertidas em regressões;
- v1.0: conjunto humano cego e isolado do treino.

Cada versão recebe hash, proveniência, licença/consentimento quando aplicável,
card de dados e splits por família, gerador e pessoa.

## Ordem operacional consolidada

| Ordem | Decisão/experimento | Saída necessária | Limite |
| --- | --- | --- | --- |
| 1 | EXP-0007: screening de prefinal acústica — **concluído, `reject-safety`** | PCM determinístico, mas uma confirmação crítica incorreta | 100/100 observações; challenger não promovido |
| 2 | Confirmação do vencedor — **não autorizada** | screening não produziu vencedor seguro | gate preservado; não gastar mais amostra na variante rejeitada |
| 3 | EXP-0008: verificador independente — **`hold-latency`** | `small` recuperou `1.150`, mas nenhum candidato venceu semântica e 650 ms | 45/45 observações; nenhum modelo integrado |
| 4 | EXP-0009: interlock monetário — **`promote-safety-guard`** | valor incerto vira pergunta neutra, sem estado, delegação ou LLM | proteção estreita; não alega recuperar o slot |
| 5 | Baseline experimental versionada — **concluída, v0.3** | configuração, artefatos, métricas e nível de evidência congelados | comparador de desenvolvimento; prontidão humana permanece hold |
| 6 | EXP-0010: kernel stateful crítico — **`promote-stateful-kernel-slice`** | confirmação em dois turnos, autoridade backend e projeção browser | 5/5 causal; não promove M2.5 inteiro |
| 7 | EXP-0011: `LocalAudioReflex` evidence-gated — **`promote-local-audio-reflex-slice`** | pico marginal não pausa/não cria turno; barge-in legítimo preservado | 157,39 ms < 350 ms; causalidade de eco não alegada |
| 8 | EXP-0012: lifecycle local da saída — **`promote-output-interruption-lifecycle-slice`** | hold/retomada/confirmação com replay exato no Chrome | 183,66 ms < 350 ms; físico causal permanece hold |
| 9 | EXP-0013: trace causal + ledger local — **`promote-training-trace-interruption-slice`** | seis bundles; 28 decisões reproduzidas; 22 efeitos encerrados; projeção v0 perceptiva | fatia sem áudio persistido, clocks entre processos ou generalização |
| 10 | EXP-0014: vínculo acústico mínimo — **concluído** | 60 streams PCM hasheados, posições de amostra, features causais e split por família | WAV/PCM pesado local; clocks entre processos não promovidos |
| 11 | EXP-0014: M4a shadow acústico — **`promote-m4a-acoustic-shadow-infrastructure`** | treino reproduzível, checkpoint, 11 decisões Chrome, replay exato, três classes e zero efeitos | imita a regra; sem ganho, generalização ou autoridade |
| 12a | EXP-0015 v0.2 + gabaritos v0.2.1/v0.2.2 — **`promote-timing-calibration-instrument`** | 12 cenas, 36 WAVs, equivalências agrupadas, empate + atribuição, 17 gates e Chrome real | emendas vinculadas ao pack; dados brutos intactos; zero fit direto |
| 12b | Calibração humana piloto — **`calibration-sufficient-to-freeze-m4b-experiment`** | 3/3 externos; atenção 77,8% base → 100%; 5 singulares + 3 conjuntos = 8/9 resolvidas | equivalência não vira rótulo singular; uma cena ambígua; não é preferência de produto |
| 13 | EXP-0016: relevância acústica M4b — **`promote-m4b-speaker-relevance-shadow-candidate`** | 108 exemplos/36 clips; holdout bruto 77,8% vs 50%; humano conservador 7/9 vs 5/9; 4 probes Chrome com paridade | veto conservador ainda falha no holdout; uma só faixa de gênero; zero autoridade |
| 14a | EXP-0017 Core: calibração segura do veto — **`retain-a0-and-cut-acoustic-core`** | 240 exemplos train/dev; `A` 50,8%, 60/60 dirigidas e 1/60 fundos; empate pareado por exemplo com `A0` | nenhum holdout; `A0` vira `A-ref`; família acústica compacta cortada nesta rodada |
| 14b | EXP-0017-R: probe semântico causal — **cortado antes do fit** | mapa causal físico: 21/30 train; 11 fundos e 10 dirigidas elegíveis | pisos exigiam 12/classe; nenhum fit/limiar/métrica semântica; zero autoridade |
| 15 | EXP-0018: contexto observável com conteúdo pareado — **`PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN`** | 31/32 em `B1` versus 16/32 em `B0`; 16/16 dirigidas, 15/16 fundos; 15 vitórias líquidas; ganho em 8/8 blocos e 4/4 famílias; 12/12 gates | uma abertura e uma tentativa; screen textual sintético sem holdout, áudio, ASR ou autoridade; claim limitado ao matcher relacional |
| 16 | EXP-0019: bridge causal em áudio — **`CUT_CAUSAL_AUDIO_BRIDGE`** | 8 cenas/4 pares/12 streams; 48 probes sem inferência; 16/16 paridade Node/Chrome; proposta p95 8,7 ms; STOP p95 56,573 ms; 7/9 gates | ordem `speech.paused`/`render.stopped` variou; trace e lifecycle on/off não determinísticos; zero autoridade/API/GPU; ASR não autorizado |
| 17 | EXP-0020: equivalência observável da ordem no renderer — **`INVALIDATE_STOP_ORDER_INSTRUMENT`** | freeze + abertura isolados; tentativa única consumida; primeiro payload TTS vazio no CDP; zero trials persistidos | físico `NOT_EVALUATED`; seis gates vacuamente true explicitados; sem rerun, API, GPU ou autoridade |
| 18 | EXP-0021: qualificação fail-closed da captura TTS — **`INVALIDATE_CDP_TTS_CAPTURE_QUALIFICATION`** | 4/4 WAVs na primeira leitura; browser=CDP; A1=A2, B1=B2 e A≠B; 9/10 gates | contrato esperava um health por navegação, mas bootstrap + auditor produziram dois; tentativa consumida, fatos apenas diagnósticos, zero autoridade |
| 19 | EXP-0022: binding bootstrap + audit health — **`INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING`** | 4/4 WAVs; dois healths/nav corretamente ligados; ordinais válidos em 40/40, mas todos com response timestamp posterior ao completion | gate congelado comparou relógios semânticos diferentes; tentativa consumida, fatos diagnósticos, zero autoridade |
| 20 | EXP-0023: semântica causal ordinal do CDP — **`PASS_CDP_TTS_CAPTURE_AFTER_ORDINAL_BINDING`** | 4/4 browser=CDP; 40 lifecycles, 120 ordinais globais únicos, 40 inversões response/finish e 10/10 gates | qualifica só o instrumento neste Chrome/processo; zero STOP, rerun ou autoridade |
| 21 | EXP-0024: equivalência física com captura qualificada — **`INVALIDATE_PHYSICAL_STOP_AFTER_CAPTURE_QUALIFICATION`** | tentativa única chegou ao primeiro trial; fala natural produziu múltiplos `render.active` e a expressão exigia cardinalidade unitária | físico `NOT_EVALUATED`; zero trial/captura física persistida, rerun, mudança de produto ou autoridade |
| 22 | EXP-0025: âncora causal + STOP renderizado — **`CUT_RENDER_STOP_INSTRUMENT_LINEAGE`** | Chrome ligado e primeira navegação iniciada; prontidão herdada exigiu audit removido; journal válido com 6 frames e zero trials | `STOP-R=NOT_EVALUATED`; health/rede/WAV não causaram o corte; tentativa terminal, zero rerun ou autoridade |
| 23 | EXP-0025-R local: microturnos de 600 ms — **`KEEP_BASELINE_AND_CUT_MICROTURN_CHALLENGER`** | holdout selado de 24 pares: 9→4 tomadas prematuras, 5 correções, 0 introduções, 2 sessões melhoradas e 0 misses | p95 `L=1.200 ms` falhou o limite de 800 ms; `L=A0@600`, sem resíduo semântico, `L2`, runtime ou autoridade; `E` aguarda autorização |

O EXP-0019 está terminal e cortado. O EXP-0020 foi invalidado pelo coletor antes
de produzir evidência física. EXP-0021 e EXP-0022 também estão terminais: suas
4/4 capturas são diagnósticas, não uma qualificação. O EXP-0023 qualificou
prospectivamente a captura sob semântica ordinal. O EXP-0024 foi invalidado
antes de medir STOP porque confundiu atividade acústica segmentada com um único
início. O EXP-0025 também encerrou sem medir STOP: sua condição de prontidão
continuou exigindo um audit removido do caminho mínimo. A linhagem do
instrumento foi cortada em vez de abrir outro reparo. Em paralelo, o
EXP-0025-R confirmou headroom e encerrou sua trilha local no holdout: `L`
comprou menos cortes ao custo de p95 de 1.200 ms e foi cortado sem segunda
hipótese. A inferência da política oficial DuplexCascade continua condicionada
a preflight, orçamento fechado e autorização explícita de GPU; nenhum
resultado concede autoridade ou troca de backbone.

Depois do veto M4b, ASR, TTS, cérebro local, loopback ou backbone nativo entram
pela maior falha percebida no relatório, não por ordem fixa. O matcher textual
já demonstrou valor informacional e sobreviveu causalmente ao áudio-oráculo; o
renderer permanece desconhecido, mas seu valor de informação marginal não
justifica outro ciclo instrumental imediato. Na tomada de turno, a trilha local
já respondeu e foi cortada; resta decidir explicitamente se o valor da
referência externa `E` justifica seu budget. `STOP-A` continua exigindo
loopback/line-in ou outro sensor causal quando voltar a ser o maior gargalo.

## Trilha paralela de governança

Não bloqueia o EXP-0007 nem M2.5, mas deve fechar antes de aceitar contribuição
ou alegar reprodução pública independente:

- licença do código escolhida pelo proprietário e avisos/licenças de terceiros;
- CI público para a suíte determinística;
- lock transitivo de Python e revisões exatas dos modelos;
- bundle de evidência compacto com manifest, checksums, comando e ambiente;
- proteção da branch quando o fluxo por pull request começar.

CI público melhora automação e verificabilidade; reprodução externa só existe
quando um terceiro executa a campanha de forma independente.

## Regra de prioridade

```text
impacto × chance de funcionar × reutilização × valor da informação
─────────────────────────────────────────────────────────────────
engenharia + GPU + dados + risco de lock-in
```

Toda tarefa precisa apontar qual decisão ela desbloqueia. Se não desbloqueia
nenhuma, não entra no caminho crítico.
