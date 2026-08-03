# EXP-0025-R — fechamento das sentinelas externas

Status: **sentinelas oficiais 4/4; desenvolvimento `NOT_EVALUATED`; nenhuma
inferência em holdout; aguardando decisão explícita sobre uma única alocação
adicional `D`-only e sobre ampliar o teto cumulativo de download**

Data: 03/08/2026.

## Resultado decisório

O checkpoint oficial do DuplexCascade passou as quatro transições inglesas
quando suas saídas são interpretadas pela semântica do `server.py` oficial:

1. usuário falando e assistente calado → continuar ouvindo;
2. usuário terminou → tomar o piso;
3. backchannel enquanto o assistente fala → manter a fala;
4. usuário falando enquanto o assistente fala → ceder o piso.

O resultado corrente é
`DO_NOT_CUT_E_DO_NOT_CLAIM_D_GAIN`: o protocolo oficial demonstrou validade
comportamental mínima, mas `D` contém zero observações. Logo não existe ainda
placar de `E` contra `A0-native` ou `A0@600`, medida de atraso pós-final,
ganhos/perdas pt-BR ou justificativa para um holdout fresco.

## Por que o executor parou em 3/4

O adaptador congelado tratava `<|user is talking|>` sempre como
`CONTINUE_LISTENING`. Na quarta sentinela o assistente já estava falando; o
`server.py` fixado no commit oficial reinicia o TTS tanto para
`<|user interruption|>` quanto para `<|user is talking|>`, portanto a ação
observável correta naquele contexto é `YIELD_FLOOR`.

Esta correção é registrada como
`POST_RUN_CONSTRUCT_INTERPRETATION_CORRECTION`: nenhum token foi alterado,
nenhuma sentinela foi repetida e o código executado não foi reescrito. A
leitura do adaptador permanece preservada como 3/4 e fail-closed; a leitura
vinculada ao runtime oficial é 4/4. `D` não foi inferido antes dessa distinção,
o que preserva seu papel de desenvolvimento prospectivo.

## Validade do carregamento

- código oficial: `42893024ca90c8de8ac3ed624467ebc123512ff8`;
- snapshot DuplexCascade:
  `dca21cb1309bb533d80f5aa5600c7b0cc2c470e3`;
- base Qwen2-7B-Instruct:
  `f2826a00ceef68f0f2b946d945ecc0477ce4450c`;
- tokens, prompts, trajetórias e latências brutas das quatro gerações foram
  preservados;
- o carregador reportou 112 chaves base `q_proj/v_proj` inesperadas e 112
  equivalentes `base_layer` ausentes por diferença de nomeação PEFT;
- a auditoria byte a byte comparou os 112 tensores do checkpoint com a base
  fixada: 112/112 foram idênticos, enquanto as chaves LoRA foram carregadas.

Assim, a diferença de nomeação não mudou os pesos efetivos usados pelas
sentinelas. Essa conclusão valida apenas o carregamento e o protocolo textual;
não demonstra DuplexCascade end-to-end, voz, ASR, TTS ou transferência pt-BR.

## Consumo e segurança operacional

As três alocações foram encerradas e a consulta final confirmou zero Pods
ativos. O consumo cumulativo foi:

- 1.193,49 segundos de GPU, cerca de 19,9 minutos;
- US$ 0,9581 estimado;
- limite superior de 37.706.974.907 bytes transferidos, 35,12 GiB;
- 112 comparações de tensores incluídas nesse limite.

GPU e custo permanecem muito abaixo dos tetos de duas horas e US$ 12. O
volume do checkpoint foi removido ao encerrar o Pod, como previsto. Restam
apenas 4,88 GiB sob o teto cumulativo de 40 GiB, enquanto uma reidratação fiel
exige 30,42 GiB. O mínimo matemático para reidratar e executar `D` é 65,54
GiB cumulativos.

## Próxima decisão e fronteira de autoridade

O menor movimento informativo é autorizar **uma única quarta alocação**, apenas
para reidratar o mesmo checkpoint e executar uma passagem `D`-only, e ampliar
o teto cumulativo de download de 40 para 70 GiB. Checkpoint, base,
configuração e mapeamento contextual permanecem fixados.

Essa autorização precisa excepcionar prospectivamente apenas a marca
`terminalInfrastructureAttempt` da terceira alocação. Ela não transforma as
tentativas anteriores em descartáveis e seu consumo continua somando nos
mesmos budgets cumulativos.

Essa proposta não pede mais GPU-horas ou custo, não repete sentinelas, não usa
`H`, não troca checkpoint/modelo, não abre sweep, seed favorável, `L2`, API,
ASR ou TTS. Ela ainda requer autorização explícita tanto para a alocação final
quanto para o novo teto; até lá não haverá nova alocação externa.

Depois de `D`, a árvore já congelada volta a valer:

- ganho residual seguro sobre `A0@600` → apenas justificar o pré-registro de
  um holdout externo fresco sob novo ID;
- ausência desse ganho → cortar a frente externa de microturnos;
- em nenhuma folha abrir `H`, mudar o runtime ou criar automaticamente outra
  reprodução local.

## Evidência canônica

- relatório agregado:
  `eval/reports/exp-0025-r-external-development-v0.1.json`;
- saída bruta:
  `eval/evidence/exp-0025-r-external-development-raw-v0.1.json`;
- journal append-only:
  `eval/evidence/exp-0025-r-external-development-raw-v0.1.journal.ndjson`;
- recibos RunPod:
  `eval/evidence/exp-0025-r-external-runpod-allocation-v0.1.json` até
  `v0.3.json`;
- equivalência PEFT/base:
  `eval/evidence/exp-0025-r-external-peft-base-equivalence-v0.1.json`.
