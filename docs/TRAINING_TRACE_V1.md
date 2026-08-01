# Contrato `training-trace-v1`

Status: **decisão de desenho consolidada; implementação da primeira vertical é
o próximo fechamento**

O EXP-0012 criou o precursor operacional: eventos, versões, fases e intenções
de hold/retomada/confirmação já permitem replay exato no Chrome. Eles ainda não
formam este bundle: faltam identidades `eventId/decisionId/effectId`, clocks,
contextos causais, estágios de efeito e projeção validada para o trace v0.

## Objetivo

Registrar evidência causal operacional suficiente para:

- reproduzir uma decisão de interação;
- comparar política determinística e candidato em shadow;
- distinguir proposta, autoridade, despacho e efeito percebido;
- construir exemplos de treino sem confundir regra com verdade humana;
- mapear áudio, ASR incremental, estado conversacional e ações entre processos.

Este contrato não substitui o [trace de avaliação v0](TRACE_CONTRACT.md). O
trace v0 continua pequeno, relativo ao cenário e aceito por qualquer candidato.
O `training-trace-v1` é mais rico, interno ao laboratório e pode ser
projetado para o trace v0 por um adaptador testado.

## Princípios

1. **Observação antes de inferência.** O trace registra o que disparou,
   propôs, autorizou e ocorreu. Um campo `triggeredBy` não afirma que o evento
   foi a causa verdadeira do comportamento humano.
2. **Áudio é referenciado, não duplicado.** Streams imutáveis usam caminho ou
   URI, SHA-256, formato e intervalo de amostras.
3. **Amostras antes de relógio para acústica.** `sampleStart/sampleEnd` são a
   referência primária dentro de um stream. Cada processo mantém seu clock e
   registra mapeamentos.
4. **Proposta não é efeito.** Shadow, runtime, player e mundo externo possuem
   estágios distintos.
5. **Rótulo tem procedência.** Regra, blueprint, professor, humano e resultado
   observado nunca são fundidos silenciosamente.
6. **Derivados ficam fora do núcleo.** Pitch, embeddings, features de modelo e
   n-best entram em manifests versionados quando existirem; não são exigidos no
   formato canônico.
7. **Incerteza é primeiro uma decisão de autoridade.** O modelo emite
   probabilidades; o runtime pode escolher `WAIT_FOR_EVIDENCE`. Só haverá um
   rótulo semântico `UNCERTAIN` se um experimento definir verdade observável e
   provar sua necessidade.

## Unidade e identidade

O bundle é uma sessão. Identificadores mínimos:

- `sessionId`;
- `turnId`, quando o evento já pertence a um turno;
- `utteranceId`, quando existe fala associada;
- `taskId`, quando aplicável;
- `epoch`, para invalidar trabalho obsoleto;
- `eventId`, `decisionId` e `effectId`.

IDs são únicos dentro da sessão. Relações cruzadas usam IDs, nunca posição no
array.

## Envelope mínimo

```json
{
  "schemaVersion": "training-trace-v1",
  "session": {
    "sessionId": "session-01",
    "startedAtEpochMs": 1785466800000,
    "locale": "pt-BR",
    "candidate": "baseline-kernel-v1",
    "configHash": "sha256:..."
  },
  "clocks": [],
  "streams": [],
  "events": [],
  "contexts": [],
  "decisions": [],
  "effects": [],
  "labels": [],
  "derivedFeatureManifests": []
}
```

`startedAtEpochMs` serve para correlacionar artefatos. Métricas de latência
não usam relógio de parede.

## Relógios e áudio

Cada domínio declara um `clockId`, por exemplo:

- `browser-performance`;
- `server-performance`;
- `audio-context`;
- `virtual-evaluator`.

```json
{
  "clockId": "server-performance",
  "kind": "monotonic",
  "processId": "server-01",
  "resolutionMs": 0.1,
  "mappingMethod": "ping-pong-midpoint",
  "maxResidualMs": 1.4,
  "mappingPoints": [
    {
      "localAtMs": 412.3,
      "referenceClockId": "browser-performance",
      "referenceAtMs": 395.8,
      "roundTripMs": 2.4
    }
  ]
}
```

Uma transformação pode ser estimada offline, mas precisa registrar método,
pontos usados e erro residual. Dois clocks não se tornam equivalentes por terem
o mesmo nome de API.

Streams acústicos declaram:

```json
{
  "streamId": "user-mic-01",
  "role": "user-input",
  "mediaRef": "artifacts/session-01/user.wav",
  "sha256": "...",
  "sampleRate": 16000,
  "channels": 1,
  "encoding": "pcm_s16le"
}
```

## Eventos observados

```json
{
  "eventId": "event-018",
  "sessionId": "session-01",
  "turnId": "turn-03",
  "utteranceId": "utt-user-03",
  "epoch": 12,
  "type": "user.transcript.partial",
  "source": "asr-partial",
  "clockId": "server-performance",
  "atMs": 842.7,
  "audioPosition": {
    "streamId": "user-mic-01",
    "sampleStart": 9600,
    "sampleEnd": 14720
  },
  "payload": {
    "text": "agenda para domin..."
  }
}
```

O vocabulário de treinamento pode conter eventos incrementais ausentes do
trace v0, mas cada evento exige definição do instante, schema validado e teste
de projeção quando afetar avaliação.

## Contexto causal da decisão

Um contexto contém somente sinais disponíveis até o instante da decisão:

```json
{
  "contextId": "context-042",
  "turnId": "turn-03",
  "epoch": 12,
  "availableAt": {
    "clockId": "server-performance",
    "atMs": 845.9
  },
  "eventIds": ["event-018"],
  "state": {
    "userSpeaking": true,
    "assistantSpeaking": false,
    "taskActive": false,
    "pauseDurationMs": 180,
    "partialText": "agenda para domin..."
  },
  "derivedFeatureRefs": ["features-vad-v6.2"]
}
```

O schema de `state` é versionado por capacidade. Uma feature calculada com
frames futuros invalida o exemplo causal mesmo que melhore o placar offline.

## Decisões e shadow

```json
{
  "decisionId": "decision-042",
  "turnId": "turn-03",
  "epoch": 12,
  "clockId": "server-performance",
  "atMs": 846.1,
  "triggeredBy": ["event-018"],
  "supersedes": ["decision-039"],
  "policy": {
    "id": "take-floor-shadow",
    "version": "checkpoint-sha256:...",
    "mode": "shadow"
  },
  "outputs": [
    { "intent": "CONTINUE_LISTENING", "probability": 0.72 },
    { "intent": "TAKE_FLOOR", "probability": 0.28 }
  ],
  "proposal": "CONTINUE_LISTENING",
  "authorityDecision": "OBSERVE_ONLY",
  "decisionContextRef": "context-042"
}
```

`decisionContextRef` aponta para um snapshot imutável das features disponíveis
naquele instante. Nenhum dado futuro pode entrar no contexto causal.

Para uma política com autoridade, `authorityDecision` pode registrar
`ACCEPT`, `REJECT`, `WAIT_FOR_EVIDENCE` ou `SAFETY_OVERRIDE`, sempre com
regra/configuração versionada.

## Efeitos

Um efeito conserva todo o lifecycle. O exemplo abaixo é um reflexo local que
ocorre antes da confirmação do kernel:

```json
{
  "effectId": "effect-017",
  "origin": "local-audio-reflex",
  "triggeredBy": ["event-user-speech-021"],
  "decisionId": null,
  "reconciledByDecisionId": "decision-interruption-044",
  "effectType": "PAUSE_OUTPUT",
  "stages": [
    {
      "stage": "accepted",
      "clockId": "browser-performance",
      "atMs": 901.2
    },
    {
      "stage": "player-received",
      "clockId": "browser-performance",
      "atMs": 901.8
    },
    {
      "stage": "renderer-silent",
      "clockId": "audio-context",
      "atMs": 914.1
    }
  ]
}
```

Estágios possíveis incluem `proposed`, `accepted`, `rejected`,
`dispatched`, `player-received`, `audible`, `renderer-silent`,
`cancelled`, `completed` e `externally-observed`. Nem todo efeito possui
todos os estágios.

`effectType` descreve uma operação do adaptador, como `PAUSE_OUTPUT`; não
amplia automaticamente a ontologia conversacional emitida pelo kernel.

Efeitos externos usam ainda uma chave idempotente e evidência do ledger. Texto
falado nunca prova que uma ferramenta executou.

## Rótulos

```json
{
  "labelId": "label-011",
  "targetId": "decision-042",
  "task": "turn-taking",
  "value": "CONTINUE_LISTENING",
  "source": {
    "kind": "human-annotation",
    "ref": "annotation-batch-03",
    "version": "guideline-v2"
  },
  "confidence": 0.8
}
```

`source.kind` deve distinguir ao menos:

- `deterministic-invariant`;
- `blueprint`;
- `synthetic-teacher`;
- `automatic-inference`;
- `human-annotation`;
- `observed-outcome`.

Desacordo é preservado; não se reduz automaticamente a uma maioria. Holdout de
promoção não pode depender apenas do mesmo mecanismo que gerou os exemplos de
treino.

## Features derivadas

Pitch, voicing, embeddings, logits e n-best são materializados separadamente:

```json
{
  "manifestId": "features-vad-v6.2",
  "sourceStreamId": "user-mic-01",
  "extractor": {
    "name": "silero-vad",
    "version": "6.2",
    "artifactHash": "sha256:..."
  },
  "artifactRef": "artifacts/session-01/vad.ndjson",
  "sha256": "..."
}
```

Isso permite recalcular features sem reescrever a história bruta nem prender o
dataset ao primeiro extrator.

## Gate de implementação

O contrato só é considerado materializado quando:

1. schema e IDs falham fechado;
2. posições de amostra são monotônicas e ligadas a áudio hasheado;
3. domínios de clock e seus mapeamentos são explícitos;
4. replay reproduz a mesma entrada do kernel;
5. proposta, autoridade e efeito observado são distinguíveis;
6. shadow nunca produz autoridade por acidente;
7. todo rótulo possui origem e versão;
8. uma projeção testada gera o trace de avaliação v0;
9. nenhum evento usa informação posterior ao instante da decisão;
10. artefatos sensíveis possuem política de retenção e não entram no Git por
    padrão.

## Uso em M4a e M4b

M4a pode usar poucos exemplos e até superajustar para provar a infraestrutura.
Seu relatório precisa dizer explicitamente “sem alegação de generalização”.

M4b exige famílias separadas, holdout não observado, calibração humana pequena
para rótulos sociais/temporais e comparação contra a baseline sob o mesmo
kernel/runtime. Efeitos externos, commit, delegação e cancelamento permanecem
determinísticos até gates específicos concederem autoridade.
