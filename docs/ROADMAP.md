# Roadmap guiado por gates

Este é o **único documento que define a ordem operacional**. As fases abaixo
organizam capacidades e podem se sobrepor; a tabela
[Ordem operacional consolidada](#ordem-operacional-consolidada) decide o que
entra agora no caminho crítico. O racional e as alternativas estão registrados
na [decisão de runtime e aprendizado](DECISION_RUNTIME_LEARNING_SEQUENCE.md).

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
local promovidas pelos EXP-0010–0013; áudio hasheado, clocks entre processos,
efeitos externos e validade física ampla ainda em `hold`**.

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
   proposta/aceite/efeito observado — **primeira fatia browser promovida;
   streams acústicos e clocks entre processos pendentes**;
7. ledger/test-double de efeitos e holdout ainda não observado — **ledger
   local da interrupção promovido; efeitos externos e holdout M4a pendentes**.

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

## Fase 5 — calibração humana

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

## Fase 6 — adaptação nativa de áudio

Um adaptador de referência pode desafiar o contrato logo após o
`training-trace-v1`, desde que responda uma pergunta concreta e não bloqueie
M4a. Execução paga em GPU exige orçamento explícito.

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
| 10 | Vínculo acústico mínimo para o reflexo — **próximo** | fixtures PCM hasheadas, posições de amostra, decisões incrementais e split novo por família | somente infraestrutura necessária ao primeiro M4a; sem ampliar o runtime global |
| 11 | M4a: shadow acústico estreito | ciclo treino→checkpoint→inferência→trace→replay sem autoridade | `WAIT/PAUSE/CONTINUE`; uma capacidade e um candidato por vez |
| 12 | Calibração humana pequena | corrigir timing/rótulos antes de M4b | não é alegação de preferência de produto |
| 13 | M4b e próximo PDCA | ganho em holdout e autoridade limitada ou rejeição | efeitos críticos continuam determinísticos |

Depois da baseline congelada e da fatia causal do trace, um desafio nativo pode
rodar em paralelo para validar
ontologia/adaptador, desde que exista pergunta decisória. Ele não bloqueia M4a
ou calibração humana; GPU paga exige autorização.

Depois de M4b, ASR, TTS, diversidade acústica, cérebro local, loopback ou
backbone nativo entram pela maior falha percebida no relatório, não por ordem
fixa.

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
