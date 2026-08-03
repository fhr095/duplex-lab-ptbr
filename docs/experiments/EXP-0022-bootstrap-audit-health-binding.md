# EXP-0022 — binding bootstrap + audit health da captura CDP

Status: **pré-registrado; instrumento ainda não implementado; zero autoridade**

## Decisão que precisa desbloquear

O instrumento consegue distinguir o health natural de bootstrap da página do
health explícito do auditor e, sob essa cardinalidade correta, qualificar a
captura TTS browser=CDP em duas navegações novas?

Este experimento continua sem medir renderização, STOP, microfone, ASR,
acústica, conversa ou percepção humana. Ele repara somente a última violação
estrutural observada no EXP-0021.

## Evidência anterior e hipótese

A tentativa única do EXP-0021 foi invalidada porque o contrato exigia um
`GET /api/health` por navegação, mas observou dois. O relatório canônico mostra
que a página fez um health durante o bootstrap e que o worker fez depois o
health explícito pré-registrado. Todos os demais bindings estruturais passaram,
assim como 4/4 cadeias TTS, WAVs, hashes browser=CDP, estabilidade A/B, runtime,
budget e ausência de efeitos.

Isso não qualifica a captura anterior. A hipótese mínima para outro número é:
classificar por posição causal os dois healths já necessários — um concluído
antes da sonda explícita e um novo request produzido por ela — remove a falsa
violação sem relaxar cardinalidade, origem ou identidade.

## Challenger mínimo

Somente supervisor, worker, analisador, boundary e testes do instrumento podem
mudar. Fontes de produção, servidor, página, TTS, payloads, buffers e retry
permanecem byte a byte iguais aos congelados no C0 do EXP-0021.

Para cada navegação:

1. após `Page.navigate`, ready e rede ociosa, o worker registra os requests
   vistos até aquele limite;
2. precisa existir exatamente um `GET /api/health` local de bootstrap;
3. imediatamente antes da sonda, o worker congela os requestIds já vistos;
4. a expressão explícita faz um único `GET /api/health`, retorna status, MIME e
   identidade de runtime, e a rede volta a ficar ociosa;
5. a diferença precisa conter exatamente um novo health, com requestId
   distinto e timestamp posterior ao bootstrap;
6. `bootstrapHealthRequestId` e `auditHealthRequestId` ficam no envelope;
7. somente então os dois fetches TTS sequenciais da navegação são executados.

Não será aceito simplesmente “dois healths em qualquer lugar”. Zero, um, três,
requestId repetido, ordem invertida, origem diferente ou health novo fora da
janela explícita invalidam o instrumento.

## Campanha fixa

A campanha oficial continua mínima e comparável:

- URL: `http://localhost:4173/?automation=1&experiment=0022`;
- duas navegações completas;
- navegação 1: A1, B1;
- navegação 2: B2, A2;
- A: `Esta fala contínua mede uma única parada física do assistente.`;
- B: `Esta resposta diferente verifica o vínculo correto da captura local.`;
- quatro `POST /api/tts`, rate 1, um por vez;
- buffers CDP: 16 MiB total, 2 MiB por recurso e 64 KiB de postData;
- até quatro leituras do mesmo requestId, após 0, 8, 24 e 64 ms;
- somente corpo vazio com `base64Encoded=true` permite nova leitura;
- WAV precisa ter RIFF/WAVE, chunks `fmt ` + `data`, frames coerentes e menos
  de 2 MiB.

Não haverá playback, `Audio`, `AudioContext`, Web Speech, `__duplexLab.speak`,
microfone, sessão, barge-in, STOP, decisão de training trace, LLM, API paga,
GPU, challenger, backbone ou nova autoridade.

## Gates obrigatórios

Todos precisam passar:

1. C0, freeze, abertura, receipt write-once e topologia Git válidos;
2. fontes produtivas idênticas ao C0 do EXP-0021 e fingerprint runtime ligado
   ao novo C0 instrumental;
3. duas navegações e ordem A1/B1/B2/A2 exatas;
4. por navegação, exatamente um health de bootstrap antes da sonda e um health
   de audit produzido por ela, requestIds distintos e ordem causal válida;
5. health explícito do browser, health Node antes/depois, runId, fingerprint,
   brain, ASR, VAD, TTS, voz e cultura idênticos;
6. quatro cadeias TTS completas sob requestIds distintos, sem request novo por
   retry e com postData exato;
7. em 4/4 unidades, comprimento e SHA-256 browser=CDP;
8. A1=A2, B1=B2, A≠B, WAV íntegro e captura fail-closed limitada;
9. A1 e B2, primeiros TTS após os dois healths de cada navegação, passam;
10. budget negativo, diagnostics, ausência de bytes no relatório, hash
    canônico e bindings commitados passam sem valor vacuamente aprovado.

O exercício real do retry não é exigido. Se todas as capturas ocorrerem na
primeira leitura, não haverá alegação de recovery transitório.

## Decisões e próximo movimento

| condição prioritária | decisão | próximo movimento |
| --- | --- | --- |
| freeze, abertura, receipt, fontes, fingerprint, campanha, health causal, requestId, budget, diagnostics, report ou topologia inválidos; crash/timeout/órfão | `INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING` | reparar e reauditar sob outro número; não pré-registrar nem executar STOP |
| instrumento válido, mas captura tipada falha, hashes divergem ou A/B perde estabilidade/distinção | `FIX_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING` | diagnosticar o menor challenger de captura sob outro número; não pré-registrar nem executar STOP |
| 10/10 gates passam | `PASS_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING` | somente pré-registrar um novo experimento físico de STOP; execução continua proibida |

A precedência é `INVALIDATE > FIX > PASS`. Todos os ramos proíbem rerun do
EXP-0022 e execução física. `authorityEligible=false` em qualquer resultado.

## Ordem operacional

1. commitar closeout do EXP-0021, este pré-registro e a transição do índice;
2. implementar o delta de health e testes sem abrir Chrome/rede;
3. auditar cardinalidade, ordem causal, captura e ramos decisórios;
4. commitar C0 e gerar/commitar freeze isolado;
5. aquecer e validar o servidor antes da abertura;
6. gerar/commitar abertura isolada;
7. executar uma única campanha oficial;
8. commitar receipt + relatório juntos e consolidar a decisão sem rerun.

## Alegação máxima

Um passe permite afirmar somente que, neste Chrome, processo e dois textos,
o instrumento distinguiu os healths de bootstrap/audit e qualificou 4/4
capturas TTS browser=CDP sob retry limitado. Não mede confiabilidade
estatística, áudio renderizado, interrupção, conversa ou qualidade percebida.
