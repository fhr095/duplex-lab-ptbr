# Contrato de traces

## Objetivo

Permitir que qualquer candidato — política simulada, cascata modular, API
proprietária ou modelo de pesos abertos — seja pontuado pelo mesmo evaluator.

## Bundle

```json
{
  "candidate": "meu-candidato-v1",
  "packId": "mvp-ptbr-v0.1",
  "traces": {
    "turno-simples": [
      {
        "atMs": 0,
        "type": "user.speech.started",
        "payload": {},
        "source": "scenario"
      },
      {
        "atMs": 1080,
        "type": "assistant.speech.started",
        "payload": {
          "kind": "direct"
        },
        "source": "candidate"
      }
    ]
  }
}
```

Cada cenário do pack precisa existir no objeto `traces`.

## Regras

- `atMs` é monotônico, não negativo e relativo ao começo do cenário.
- Empates são permitidos e preservam a ordem registrada.
- `type` deve pertencer ao vocabulário em `src/contracts/events.mjs`.
- `payload` é um objeto; dados específicos ficam nele.
- `source` é recomendado: `scenario`, `candidate`, `runtime` ou `annotator`.
- O adaptador não pode reescrever eventos do cenário.
- Tempo de parede não entra no cálculo; registre-o como metadado externo.

## Vocabulário v0

Entrada e ambiente:

```text
user.speech.started
user.speech.paused
user.hesitation
user.speech.resumed
user.transcript.final
user.correction
user.cancelled
user.speech.ended
environment.speech.detected
```

Saída, estado e ações:

```text
assistant.backchannel
assistant.speech.started
assistant.speech.stopped
assistant.speech.finished
state.rollback
task.delegated
task.cancelled
task.result
```

## Evolução

Mudanças incompatíveis criam nova `schemaVersion`. Novos eventos só entram
depois de:

1. cenário que demonstre a necessidade;
2. definição precisa do instante;
3. teste de validação;
4. migração ou congelamento do pack antigo.

## Avaliar

```bash
npm run eval -- --trace caminho/trace-bundle.json
```
