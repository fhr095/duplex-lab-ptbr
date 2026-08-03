# External Challenger Runner — desenho preservado, não implementado

Status: **desenho de infraestrutura; zero implementação, imagem publicada,
GPU, Pod, cache remoto ou execução científica autorizados**

## Por que este desenho existe

O EXP-0025-R chegou a carregar o checkpoint oficial e passou as quatro
sentinelas sob a semântica publicada, mas não produziu uma observação pt-BR em
`D`. Download, diretório de import, transferência e transporte SSH falharam em
momentos diferentes. Isso não refuta o mecanismo DuplexCascade; mostra que a
infraestrutura externa não havia sido qualificada como produto reutilizável
antes do aluguel da GPU.

Este documento preserva a correção arquitetural sem reabrir o experimento. O
runner só entra em implementação se um diagnóstico de produto tornar uma
comparação externa novamente decisiva.

## Contrato mínimo futuro

Um runner qualificado deverá ter:

- imagem imutável por digest, com CUDA, Python e dependências lockadas;
- entrypoint executável a partir de qualquer diretório, preferencialmente
  `python -m pacote.modulo`, sem depender do `cwd`;
- teste local/CI de import, CLI, schemas, mounts e permissões antes de GPU;
- preflight no ambiente remoto exato antes de baixar pesos grandes;
- cache persistente, content-addressed e verificado por tamanho/SHA-256 para
  checkpoint, base e tokenizer;
- inputs montados read-only e outputs em diretório novo por run ID;
- journal append-only e recibo de provedor mesmo em falha;
- desligamento idempotente e consulta posterior que prove zero recursos ativos;
- sentinelas separadas de desenvolvimento e holdout;
- preservação de tokens/trajetórias brutas antes do agregador.

## Máquina de estados

```text
IMAGE_VERIFIED
  -> REMOTE_ENVIRONMENT_QUALIFIED
  -> CACHE_VERIFIED
  -> MODEL_READY
  -> SCIENTIFIC_ATTEMPT_OPENED
  -> SENTINELS_COMPLETE
  -> DEVELOPMENT_COMPLETE
  -> TERMINATED
```

Nenhuma entrada de desenvolvimento ou holdout pode ser lida antes de
`SCIENTIFIC_ATTEMPT_OPENED`. Cada transição grava ambiente, digest, timestamps,
hashes e estado do recurso.

## Retry de infraestrutura versus tentativa científica

Um retry é **idempotente de infraestrutura** somente quando:

- nenhum input científico foi aberto;
- nenhum token/model output foi produzido;
- nenhum dado de desenvolvimento ou holdout foi observado; e
- ele repete a mesma imagem, entrypoint, checkpoint, configuração e run plan.

Nesse estado podem existir no máximo dois retries automáticos, ambos dentro do
mesmo teto pré-registrado e com recibos próprios. Falha de rede, mount ou
download não consome uma tentativa científica, mas continua consumindo custo e
orçamento de infraestrutura.

A partir do primeiro acesso a uma entrada científica ou do primeiro token, a
tentativa está consumida. Timeout, crash ou output parcial depois desse ponto
não autoriza retry automático, reconstrução seletiva nem abertura de holdout.
Nova passagem exige decisão e autorização prospectivas do experimento.

## Cache e transporte

O cache persistente não é fonte de confiança por existência. Cada objeto deve
ser validado contra revisão, tamanho e SHA-256 congelados antes de montar uma
visão read-only. Download parcial fica em namespace temporário e só é promovido
atomicamente depois da verificação. O transporte do código e dos pequenos
inputs deve ocorrer antes de alocar GPU sempre que o provedor permitir.

SSH não pode ser o único plano de controle. Criação, health, execução,
heartbeat, término e confirmação posterior precisam de operações idempotentes
com timeouts e um canal oficial do provedor para recovery.

## Qualificação antes de GPU

Uma futura implementação só estará apta a um experimento quando, sem ler seu
desenvolvimento ou holdout:

1. construir a mesma imagem duas vezes com digest verificável;
2. passar testes de import/entrypoint a partir de `/` e de um diretório vazio;
3. montar fixtures read-only e persistir output/journal em 2/2 execuções;
4. sobreviver a download interrompido e retomar pelo cache sem corrompê-lo;
5. terminar duas vezes de forma idempotente e confirmar zero recursos;
6. passar uma sentinela sintética pequena no ambiente remoto exato;
7. produzir um recibo completo tanto em sucesso quanto em falha.

O modelo grande e a GPU entram somente depois desses gates. A qualificação de
infraestrutura não conta como evidência do challenger.

## Relação com o EXP-0026

O diagnóstico de experiência ponta a ponta decide se gestão de piso voltou ao
caminho crítico. Se não voltar, este desenho permanece
`UNIMPLEMENTED — DEFERRED BY PRODUCT PRIORITY`.

Se voltar, um **novo ID experimental** deverá incluir a qualificação deste
runner no budget e separar:

- retries idempotentes de infraestrutura;
- uma passagem científica em desenvolvimento;
- decisão explícita de cortar ou justificar holdout fresco.

EXP-0025-R permanece terminal em todos os casos.
