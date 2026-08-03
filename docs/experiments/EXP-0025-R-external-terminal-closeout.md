# EXP-0025-R — fechamento terminal da referência externa

Status: **`E=NOT_EVALUATED_ENVIRONMENT_BLOCKED`; sentinelas oficiais 4/4;
desenvolvimento PT-BR com zero observações; frente externa cortada; zero
holdout, autoridade ou retry**

Data: 03/08/2026.

## Decisão

Manter `A0` e encerrar nesta rodada a frente externa de tomada de turno por
microturnos. Esse corte não afirma que o DuplexCascade é bom ou ruim em PT-BR:
as duas alocações destinadas a `D` terminaram antes do download do checkpoint
e antes de qualquer inferência. Portanto não há placar de `E` contra
`A0-native` ou `A0@600`, atraso pós-final, casos de ganho/perda ou base para
abrir um holdout externo fresco.

A evidência comportamental válida permanece limitada às quatro sentinelas
inglesas sob o runtime oficial. A reprodução local `L` já havia sido cortada:
seu ganho foi integralmente explicado pela cadência de `A0@600` e seu p95
pós-final chegou a 1.200 ms. Sem observações novas em `D`, insistir em outra
alocação teria menor valor de informação que retornar ao próximo gargalo
percebido da vertical.

## Quinta e última alocação

O freeze prospectivo está no commit `2f7d3df` e autorizava somente uma quinta
alocação H100 para corrigir o caminho de import. Checkpoint, dados, seed,
cadência, adaptador científico e gate permaneceram inalterados; sentinelas e
holdout não seriam executados, e nenhum holdout foi incluído nos inputs.

A H100 ficou disponível a US$ 2,89/h e o primeiro probe SSH passou. A conexão
seguinte, usada para transferir os inputs e iniciar o processo, expirou com
status 255. Não foram recuperados raw, journal ou log remoto; o checkpoint não
foi baixado e a inferência não começou. Logo a tentativa é falha de ambiente,
não resultado do modelo.

O caminho REST também ficou indisponível durante o `finally`, de modo que o
recibo write-once preservou corretamente `termination.confirmed=false`. A
terminação foi então recuperada sem nova alocação pela API GraphQL oficial,
usando `podTerminate` para o `podId` exato ligado ao recibo. A consulta
posterior `myself.pods` confirmou:

- alvo ausente;
- zero Pods do projeto;
- zero Pods ativos na conta.

A mutação foi verificada no SDK oficial `runpod/runpod-python`, commit
`7aee321583c479d45c1a88607d3f73a273dbbf1c`, antes da chamada. O recibo
original não foi reescrito; a confirmação posterior está em artefato separado.

## Consumo conservador

O recibo local parou seu relógio aos 115,85 segundos, antes de conseguir
confirmar a remoção. Por isso ele não é suficiente para o consumo final. O
recovery usa o intervalo entre a criação e a confirmação posterior como limite
superior conservador:

- tentativa 5: até 439,642 segundos e US$ 0,3529;
- acumulado das cinco alocações: até 1.726,939 segundos, ou 28,8 minutos;
- custo externo acumulado: até US$ 1,3864;
- teto de artefatos reidratáveis permanece 70.373.808.158 bytes, abaixo dos
  70 GiB autorizados; nesta tentativa o checkpoint não foi baixado;
- todos os limites de duas GPU-horas e US$ 12 permaneceram folgados.

## Kill criterion e consequência

O pré-registro determina que ausência de execução fiel dentro da tentativa
terminal mantém `E=NOT_EVALUATED_ENVIRONMENT_BLOCKED`, sem trocar
silenciosamente de modelo, provider ou holdout. A quinta alocação consumiu essa
folha. Portanto:

- não existe sexta alocação ou retry automático;
- `H-L` continua inelegível para `E` e não foi lido;
- não haverá `L2`, troca de checkpoint ou segundo modelo nesta rodada;
- Lychee-FD, PersonaPlex e os demais permanecem apenas no ledger;
- o próximo experimento deve voltar a uma capacidade percebida prioritária da
  vertical completa, sob novo pré-registro.

## Evidência

- autorização corretiva:
  `eval/commitments/exp-0025-r-external-d-only-retry-authorization-v0.1.json`;
- recibo write-once da alocação:
  `eval/evidence/exp-0025-r-external-runpod-allocation-v0.5.json`;
- confirmação e orçamento recuperados:
  `eval/evidence/exp-0025-r-external-runpod-allocation-v0.5-termination-recovery.json`;
- resultado anterior das sentinelas:
  `eval/reports/exp-0025-r-external-development-v0.1.json`;
- fechamento local:
  `docs/experiments/EXP-0025-R-local-closeout.md`.
