# Ciclo autônomo de evolução

## Objetivo

O laboratório deve conseguir encontrar regressões, comparar candidatos e
recusar promoções sem depender de uma pessoa falando ao microfone a cada
mudança. Isso não significa substituir julgamento humano; significa reservá-lo
para calibrar validade externa, em vez de usá-lo como depurador diário.

Na fase atual, IA amplia esse ciclo: gera famílias, critica cobertura, cria
contrafactuais, sintetiza variações e propõe novos ataques. O laboratório não
aceita a primeira saída como dataset final; mede, encontra lacunas e orienta a
próxima geração.

## O comando único da baseline ampla

Depois da preparação inicial:

```bash
npm run setup:asr
npm run eval:auto
```

`eval:auto` executa, na ordem:

1. setup reproduzível dos runtimes abertos;
2. testes unitários e contratos concorrentes;
3. política e proxies de percepção;
4. 21 falas sintéticas PT-BR;
5. baseline Whisper `base` e candidato atual nos mesmos 12 trechos CORAA;
6. decisão formal de promoção ASR;
7. probe e campanha conversacional PCM/WebSocket em tempo real;
8. aplicação real no Chrome do Windows por 30 s;
9. resposta falada, último quantum de barge-in e cancelamento delegado;
10. relatório consolidado em `eval/reports/autonomous-latest.json`.

Esse comando preserva a baseline ampla histórica. Ele ainda não orquestra a
fábrica v0.2 nem os EXP-0007–0013; portanto, “rodar `eval:auto`” não equivale a
avançar automaticamente o roadmap atual.

O runner abre uma porta livre, força `BRAIN_PROVIDER=local`, verifica no
`/api/health` que o provider é local e encerra somente o processo que criou. A
campanha extensiva faz **zero chamadas pagas**, mesmo quando existe
`OPENAI_API_KEY` no `.env`.

Enquanto o ASR humano não cumprir o alvo, o comando termina com código diferente
de zero e status `hold`. Isso é comportamento esperado: um gate não deve ficar
verde quando a vertical ainda não está pronta.

## Evidência disponível hoje

| Nível | O que é real | O que detecta | Limitação |
| --- | --- | --- | --- |
| Contrato | código concorrente | fila, epoch, rollback, cancelamento | não mede áudio |
| Sintético | WAV e inferência local | regressão rápida de ASR e runtime | uma voz artificial |
| Humano público | vozes PT-BR espontâneas | sotaque, ruído, hesitação, segunda voz | não é uma sessão interativa |
| Chrome | microfone, scheduler, HTTP, TTS, player e renderer reais | captura longa, primeira fala, último quantum, falsa ativação | não mede a cauda do alto-falante/sala |

O corpus humano é uma amostra reprodutível do
[CORAA ASR v1.1](https://github.com/nilc-nlp/CORAA). O downloader lê somente 12
arquivos do ZIP remoto por HTTP Range, preserva a licença e não redistribui o
corpus. A seleção cobre hesitação, pausa preenchida, ruído, segunda voz,
sotaques e subcorpora diferentes.

## Estado da fábrica e próximo loop

A primeira vertical da fábrica v0.2 já foi implementada para correções: 24
casos, superfícies geradas, oráculos determinísticos, mutações adversariais,
áudio/ambientes seeded e replay WebSocket/Chrome. Geradores/críticos autônomos
amplos, multivoz, eco e agrupamento automático continuam pendentes.

O próximo loop não é “ampliar tudo”. EXP-0007 classificou a fronteira acústica,
EXP-0008 reteve o verificador forte por latência e EXP-0009 bloqueou a
confirmação monetária insegura. O EXP-0010 promoveu a primeira máquina de
estados compartilhada: 270/270 testes e 5/5 ciclos causais no Chrome, sem commit
prematuro e sem LLM pago. Seus quatro smokes suplementares encontraram atividade
acústica não rotulada, sem base para atribuir autoeco.

A [ordem operacional consolidada](ROADMAP.md#ordem-operacional-consolidada)
registra que o EXP-0011 já atacou esse efeito: no A/B causal, o controle
imediato pausou/criou turno e o `LocalAudioReflex` evidence-gated preservou a
fala e descartou a final tardia; o STOP legítimo ficou em 157,39 ms e 30,147 s
físicos passaram sem ativação. O EXP-0012 reconciliou hold/STOP/retomada local:
seis fluxos do Chrome tiveram replay exato, STOP em 48 ms no renderer e seis
corridas assíncronas falharam fechadas. Seu probe causal físico não iniciou e
permaneceu em `hold`, sem apagar a rodada histórica. O EXP-0013 materializou
essa primeira fatia causal: seis bundles, 28 decisões reproduzidas e 22 efeitos
encerrados, com projeção baseada em STOP renderizado/retomada audível e zero
autoridade shadow. A campanha corrente também passou o probe físico de
30,074 s; isso não generaliza para outros dispositivos.

O próximo loop liga as fixtures PCM existentes a hashes e posições de amostra,
registra as decisões incrementais do `LocalAudioReflex` e prepara um split novo
por família para M4a acústico em shadow. O roadmap, e não este documento de
método, define os fechamentos posteriores.

Modelos fortes podem continuar gerando ou auditando pequenas amostras difíceis;
modelos locais/econômicos e transformações determinísticas fornecem volume. O
mesmo modelo nunca é o único gerador e juiz, e nenhum gerador define seu próprio
oráculo.

## Métricas e promoção

O ASR registra:

- WER canônico, no qual “15” e “quinze” são equivalentes;
- WER literal, que mantém a diferença disponível para auditoria;
- RTF p50, p95 e máximo;
- probabilidade de idioma;
- resultado e tempo de cada trecho.

Uma comparação de candidatos roda com:

```bash
npm run eval:asr:compare
```

O candidato só recebe `promote` quando melhora WER, permanece dentro do orçamento
de tempo real e não piora materialmente muitos casos individuais. Um candidato
mais preciso, porém lento, recebe `hold-for-offline-or-hybrid`; ele pode servir
como segunda passagem, mas não entra no caminho interativo.

## Resultado após a vertical PCM

Na campanha encerrada em 31/07/2026, nesta CPU:

| Camada | Resultado |
| --- | --- |
| Testes | 163/163 |
| Política | 7/7 cenários, 20/20 expectativas |
| ASR sintético Parakeet | WER 4,40%, RTF p50 0,10 |
| ASR humano Parakeet | WER 38,03%, RTF p50 0,13 |
| Comparação com `base` | `promote`; WER 52,82% → 38,03% |
| Chrome | 10/10 execuções, 27/27 gates; final textual injetada→`onplaying` p95 187 ms; PCM→último quantum p95 83,21 ms |
| Sessão física | 600,082 s; 30.001 frames; zero falsa ativação, gap ou drop |
| VAD | Silero v6.2 `0,85×1` promovido; energia teve 3 falsos inícios no baseline equivalente |
| Custo de API | zero |

O `small` continua ligeiramente melhor em WER humano (36,62%), mas seu RTF
mediano de 1,25 impede o caminho rápido. O Parakeet entrega quase essa qualidade
com RTF 0,13; por isso foi promovido. Uma reconciliação local recupera finais
vazias ou trocas claras para inglês, e a graça de commit impede que a nova
velocidade transforme pausas/correções em respostas prematuras.

## Como a evolução acontece

Cada iteração segue um contrato curto:

1. escolher o maior gargalo do relatório;
2. escrever uma hipótese e alterar uma variável;
3. executar a campanha congelada;
4. comparar com a baseline;
5. promover, reter ou rejeitar;
6. guardar os casos em que o candidato piorou;
7. transformar cada falha nova reproduzível em cenário de regressão.

Depois do EXP-0007, uma correção na cascata só entra no caminho crítico se
evitar risco, preservar a fidelidade do trace, remover um confounder de
comparação ou desbloquear M4a. Cada ramificação declara timebox e regra de
parada; duas hipóteses são o orçamento comum, com exceção explícita para falha
grave.

O EXP-0007 mostrou que framing/merge explicava o PCM variável, mas sua variante
não venceu segurança nem latência. O EXP-0008 comprovou que um verificador forte
recupera o valor, porém a 3,1 s p95; por isso não entrou como segunda passagem
indiscriminada. A arquitetura seletiva permanece uma opção futura:

```text
tiny → parcial e sinal de intenção
Parakeet → final rápida
verificador mais forte → apenas slot crítico, baixa confiança ou efeito
```

TTS aberto, cérebro local e modelos nativos entram depois pelo maior gargalo
medido. O primeiro modelo de interação entra antes como M4a estreito, em shadow
e sem alegação de generalização.

## Onde humanos continuam indispensáveis

Automação não mede de forma confiável conforto, naturalidade, incômodo com
backchannels, percepção de eco ou vontade de continuar conversando. Também não
mede a cauda acústica que sai fisicamente pelo alto-falante.

Portanto, gravações do dono do projeto não são necessárias nem são o próximo
bloqueador. Uma amostra humana pequena calibra timing e rótulos depois de M4a e
antes de M4b; ela não promove qualidade de produto. Pessoas entram como caminho
crítico para preferência quando sessões e tarefas já forem robustas sob grande
diversidade, novas campanhas encontrarem principalmente caudas conhecidas e
existirem finalistas maduros que só possam ser separados por percepção. Uma
bateria humana então calibra sotaque, linguagem natural, TTS e eco; suas
descobertas voltam à automação como novas famílias congeladas.
