# EXP-0000 — baseline determinística de interação

## Decisão

Verificar se o laboratório consegue expressar os comportamentos essenciais e
bloquear uma regressão antes de integrar áudio ou modelos.

## Hipótese

Uma política determinística pequena, executada em relógio virtual, deve passar
pelos cenários de engenharia; uma mutação deliberadamente lenta deve falhar.

## Baseline

Não havia baseline anterior. Este experimento estabelece `baseline-policy-v0`.

## Pack

`mvp-ptbr-v0.1`, congelado, com sete cenários e vinte expectativas.

## Métrica principal

Taxa de expectativas satisfeitas.

## Guardrails

- latência de início da resposta;
- latência de decisão de parada;
- ausência de resposta em pausa e fala ambiente;
- rollback final correto;
- cancelamento de tarefa;
- retorno assíncrono.

## Gate definido antes da execução

- 100% das expectativas;
- zero falhas;
- limites temporais em `eval/gates/mvp.json`;
- uma política mutante com parada de 600 ms precisa falhar.

## Resultado

Executado em 30/07/2026.

- cenários: 7/7;
- expectativas: 20/20;
- resposta p95: 280 ms;
- decisão de parada p95: 80 ms;
- backchannel: 120 ms;
- delegação: 60 ms;
- cancelamento: 20 ms;
- rollback: 10 ms;
- retorno de tarefa: 100 ms;
- mutante de interrupção: corretamente reprovado.

## Limitação

Os tempos são do simulador, não samples acústicos. Eles validam a política e o
evaluator, não a experiência vocal.

## Decisão

`PROMOVER`

Usar o contrato e o evaluator como fundação da primeira vertical de áudio.

## Artefatos

- `eval/scenarios/mvp.pt-BR.json`
- `eval/gates/mvp.json`
- `eval/reports/baseline-v0.json` — relatório histórico transitório local; a
  baseline canônica vigente é a v0.3 ligada no índice de experimentos;
- `tests/eval-suite.test.mjs`
