# EXP-0018 — fechamento do screen textual contextual

Status: **concluído em 03/08/2026 — `PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN`;
zero autoridade**

Este arquivo registra o resultado sem alterar o
[pré-registro congelado](EXP-0018-context-observability-screen.md). A evidência
canônica é o
[relatório de development](../../eval/reports/exp-0018-context-development-v0.1.json),
fixado no commit `7d03ad715894eb80202d7978fe613f88fc54aacb`.

## Resultado

Sob uma abertura e uma tentativa seladas:

- `B1 target+context`: 31/32, com 16/16 falas dirigidas e 15/16 fundos;
- `B0 target-only`: 16/32, com 16/16 dirigidas e 0/16 fundos;
- comparação pareada: 15 vitórias, zero derrotas e um empate para `B1`;
- ganho positivo em 8/8 blocos independentes e nas quatro famílias;
- 12/12 gates aprovados;
- delta local p95 `B1-B0`: 0,127 ms, somente features + softmax;
- uma rodada de predições, zero holdout, zero efeito e zero API/GPU paga.

O único erro de `B1` foi um fundo da família `correction`, no bloco de versão
versus etiqueta. Ele permanece como borda conhecida; development não será
reaberto para corrigi-lo.

## Alegação permitida

Em cenas textuais sintéticas 2x2 com âncoras lexicais explícitas, o matcher
relacional local selecionou entre o campo que representa o antecedente audível
do assistente e o inbound recente melhor que o alvo isolado.

Em termos de benefício potencial, quando uma frase curta idêntica poderia
responder ao assistente ou a outra pessoa, o contexto recente evitou 15 das 16
reações indevidas do controle a fala lateral sem perder nenhuma das 16 falas
dirigidas. Isso ainda é resultado de simulador, não experiência observada por
usuários.

## O que não foi demonstrado

- destinatário identificado em áudio, ASR, diarização ou identidade;
- sobreposição, ruído, prosódia, paráfrase ou semântica ampla;
- latência percebida ou ponta a ponta;
- generalização para humanos ou para o português brasileiro espontâneo;
- segurança de veto, integração em produção ou autoridade sobre o STOP.

`B0` é um controle deliberadamente sem informação nos pares 50/50; não é a
baseline completa do produto. O campo “audível” foi planejado em texto e ainda
não foi verificado contra PCM.

## Próxima decisão

Pré-registrar um screen causal mínimo com o mesmo checkpoint e oito cenas de
dois blocos 2x2. O texto-oráculo de cada clip só poderá entrar no snapshot após
o fim de seu áudio; Node e Chrome deverão reproduzir as probabilidades
congeladas em shadow, sem tocar no lifecycle autoritativo. Se esse teto passar,
um experimento posterior compara ASR incremental local; se falhar, ASR e
modelos maiores continuam fora.
