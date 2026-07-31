# EXP-0001 — primeiro trace com áudio real PT-BR

Status: `SUPERADO SEM EXECUÇÃO DIRETA`

O plano não foi executado com esta amostra exata. Seus objetivos foram
absorvidos e superados pelas campanhas EXP-0002, EXP-0003 e EXP-0005. Este
arquivo permanece como registro histórico da hipótese inicial, não como próximo
experimento.

## Decisão

Descobrir se a primeira vertical modular consegue cumprir os gates acústicos ou
se o gargalo inicial está em captura/AEC, endpointing, ASR, TTS ou scheduler.

## Hipótese

Uma cascata streaming, instrumentada por frame e com saída cancelável, consegue
parar acusticamente em até 250 ms p95 e iniciar respostas simples em até 1,2 s
p95.

## Baseline

Demo de navegador da EXP-0000. Ela serve para UX e eventos, mas não fornece
timestamps acústicos confiáveis.

## Mudança isolada

Substituir Web Speech por adaptadores que exponham PCM e timestamps. Manter
política, cenários e cérebro mock fixos.

## Métrica principal

Parada acústica após barge-in:

```text
último sample audível do assistente - onset da fala do usuário
```

## Guardrails

- primeiro sample audível;
- taxa de cortes indevidos;
- WER/transcrição semântica PT-BR;
- perda de frames;
- sessões sem crash;
- CPU, RAM, VRAM e custo por minuto.

## Amostra mínima

- 30 interrupções;
- 30 pausas internas;
- três vozes;
- ambiente silencioso, ruído moderado e eco;
- canais de usuário e assistente separados.

## Orçamento máximo

- engenharia: dois dias para o primeiro trace;
- integração: uma opção por componente;
- GPU: nenhuma sessão longa antes de o trace ser validado;
- treinamento: proibido neste experimento.

## Gate

Continuar se:

- todos os frames e eventos puderem ser reproduzidos;
- parada acústica p95 ≤ 250 ms;
- primeiro áudio p95 ≤ 1,2 s;
- falso corte ≤ 5%.

Se falhar, atribuir a falha a exatamente um estágio antes de trocar modelo.

## Artefatos esperados

- bundle conforme `docs/TRACE_CONTRACT.md`;
- WAV/PCM separado por canal;
- configuração de runtime;
- relatório do evaluator;
- três exemplos audíveis de sucesso e três de falha.
