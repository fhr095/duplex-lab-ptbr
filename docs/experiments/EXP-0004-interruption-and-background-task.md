# EXP-0004 — interrupção cooperativa e tarefa realmente paralela

Status: `PROMOVIDO NO ESCOPO DE ENGENHARIA`

## Decisão

Promover a pausa tentativa do player, a retomada rápida de backchannel e a
separação entre resposta conversacional e tarefa delegada. Uma nova fala cancela
a resposta direta que ficou obsoleta, mas não cancela silenciosamente trabalho
externo. Cancelamento de tarefa exige intenção explícita e mantém o `taskId`.

Isso fecha um contrato de concorrência; não prova que o conteúdo de um LLM
externo é correto.

## Falhas encontradas

A auditoria centrada no que a pessoa ouviria encontrou quatro falhas críticas:

- timeout retomava o assistente durante uma fala longa;
- TTS ainda em preparação podia começar sobre o usuário;
- uma pausa tentativa era contada como interrupção confirmada;
- a mesma requisição representava conversa e tarefa, então qualquer novo turno
  abortava a delegação.

Também havia um falso conforto semântico: `sim`, `ok`, `certo` e `entendi`
eram descartados como backchannels mesmo quando poderiam ser respostas. A lista
agora contém apenas vocalizações não lexicais.

## Mudanças promovidas

- o mesmo `HTMLAudioElement` é pausado e retomado;
- nenhum timeout retoma o player enquanto `userSpeaking=true`;
- TTS pronto espera a resolução da pausa tentativa antes de tocar;
- pausa tentativa, interrupção confirmada e backchannel descartado têm métricas
  separadas;
- uma parcial acústica curta como “Ah!” pode retomar cedo, mas a final
  “Ah, espera” reabre e confirma a interrupção;
- tarefas delegadas possuem controller e identidade próprios;
- resultado pronto espera uma janela sem usuário, resposta direta ou áudio
  ativo;
- “deixa para lá” cancela a tarefa; fala nova comum não;
- reset e encerramento drenam tarefa e resultados pendentes.

## Evidência no Chrome do Windows

Relatório:
`eval/reports/browser-background-task-probe.json`.

| Comportamento | Resultado |
| --- | ---: |
| Gates completos | 22/22 |
| Barge-in PCM→último quantum | 134,84 ms |
| Backchannel real | retomada sem novo turno |
| Correção de 5–6 s | um commit; nenhuma retomada intermediária |
| Tarefa + novo turno | ambos concluídos |
| Resultado durante resposta direta | aguardou janela conversacional |
| Resultado pronto→janela | 6.116 ms |
| Resultado pronto→voz | 6.480 ms |
| Cancelamento explícito | 42 ms após delegação no trace |
| Resultado obsoleto após cancelar | zero |

Os 6,48 s não são latência de computação: o mock terminou em 2,2 s e o
resultado esperou a resposta direta já em curso acabar. Esse é o comportamento
correto para não falar por cima; a adequação de quando anunciar um resultado
continua sendo uma pergunta humana.

## Guardrails

- a confirmação curta de cancelamento é audível;
- cancelamento entra no histórico da conversa;
- tarefa substituída recebe abort explícito;
- nenhum resultado cancelado entra na fila de voz;
- o resultado delegado não contamina a métrica de primeiro áudio do turno
  direto;
- o provider continua substituível e o teste usa cérebro local, com custo zero.

## Limites

- uma tarefa simultânea por vez é o comportamento principal;
- modificar argumentos de uma tarefa em voo ainda não possui protocolo próprio;
- a janela ideal para anunciar resultados depende de julgamento humano;
- falha de rede e recuperação persistente entre reloads ainda não foram
  exercitadas.

## Próxima pergunta

Em conversas reais, a pessoa prefere ouvir o resultado assim que houver silêncio,
receber primeiro um microaviso ou pedir explicitamente por ele?
