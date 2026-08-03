# EXP-0019 — fechamento do bridge causal em áudio

Status: **concluído em 03/08/2026 — `CUT_CAUSAL_AUDIO_BRIDGE`; instrumento
válido; zero autoridade**

Este arquivo registra o resultado sem alterar o
[pré-registro congelado](EXP-0019-causal-audio-context-bridge.md). A evidência
canônica é o
[relatório final](../../eval/reports/exp-0019-causal-audio-v0.1.json), fixado
no commit `0127322ad18a5b1d98de53d9e45898249e05888d`.

## Resultado

A única materialização oficial produziu 12 WAVs locais com Supertonic, seed
congelada e zero rede, API paga ou GPU. O áudio bruto permanece ignorado; seu
manifest e hashes estão no Git. O instrumento passou todas as nove validações
de proveniência e executou exatamente um replay Node e duas navegações Chrome.

Sete dos nove gates finais passaram:

- bundle causal completo: 8 cenas, 4 pares e 12 streams;
- 48 probes imediatamente anteriores às fronteiras, com zero inferência;
- assinatura congelada reproduzida: `B0=4/8`, `B1=7/8`, três vitórias, zero
  derrotas, um empate e o erro conhecido preservado;
- 16/16 previsões com paridade Node/Chrome; erro relativo máximo de features e
  probabilidades igual a zero;
- p95 Node de `2,958 ms`, proposta Chrome de `8,7 ms` e cálculo Chrome de
  `5,5 ms`;
- STOP até o renderer p95 de `56,573 ms`;
- zero efeito, zero autoridade, zero API paga e zero GPU.

Dois gates falharam. Na primeira repetição, o controle físico registrou
`assistant.speech.paused` antes de `assistant.render.stopped`, enquanto o
shadow registrou a ordem inversa. Na segunda repetição, controle e shadow
registraram a ordem inversa e coincidiram. Todos os quatro STOPs pararam dentro
do orçamento e mantiveram a mesma transição autoritativa `PAUSE_REQUESTED →
held`, mas o trace normalizado não foi determinístico e o lifecycle shadow
ligado/desligado não ficou byte a byte equivalente.

## Interpretação

O bridge semântico não falhou em causalidade, paridade semântica congelada ou
latência: ele montou somente evidência já disponível, reproduziu o checkpoint
e ficou muito abaixo dos budgets. O corte localiza uma corrida no ordenamento
observado entre pausa da fala e parada do renderer. Qualidade perceptiva e
naturalidade não foram medidas.

Ainda não sabemos se a corrida representa estados ou renderização fisicamente
diferentes, ou somente a chegada concorrente de duas telemetrias equivalentes. O
pré-registro exigia sequência idêntica; portanto o resultado não pode ser
reinterpretado como passe nem repetido depois de ver a falha.

## Próxima decisão

Pré-registrar o menor probe físico de lifecycle, sem matcher, ASR, TTS novo ou
modelo externo, que distinga:

1. **corrida fisicamente observável:** o estado autoritativo ou o áudio renderizado muda
   com a ordem; corrigir o happens-before do runtime;
2. **telemetria concorrente equivalente:** estado, último quantum e resultado
   renderizado são iguais; definir uma normalização causal explícita em um
   novo experimento, sem reescrever o EXP-0019.

ASR incremental continua fora até esse gate fechar. Backbones nativos também
não atacam a falha localizada e permanecem no ledger.

## Alegação máxima

Nestas oito cenas sintéticas com texto-oráculo liberado no fim de cada clip, a
ponte contextual foi causal, semanticamente exata, rápida e sem efeitos. Ela
não foi promovida porque duas execuções físicas não preservaram o contrato de
ordem do lifecycle. Isso não demonstra ASR, áudio humano, naturalidade,
generalização ou prontidão de produto.
