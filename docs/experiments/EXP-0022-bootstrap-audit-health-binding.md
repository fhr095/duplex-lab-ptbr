# EXP-0022 — binding bootstrap + audit health da captura CDP

Status: **pré-registrado; instrumento implementado e testado; aguardando freeze;
zero autoridade**

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

Fontes de produção, servidor, página, TTS, payloads, buffers e retry permanecem
byte a byte iguais ao C0 do EXP-0021
`2fbe5af88931d49c236cc27f241f2a74c545f1d2`. O adaptador de captura
`scripts/lib/exp-0021-cdp-capture.mjs` e seus testes também são reutilizados sem
alteração.

O C0 precisa ser filho direto da base de desenvolvimento
`dbd4204c3961c2950d0c72885253339095f96fcb` e seu diff precisa conter
exatamente os 18 paths registrados na allowlist — qualquer path extra falha o
freeze e o supervisor. Em todos os roots de runtime, o diff contra o C0 do
EXP-0021 também é exato e limitado a quatro paths: `package.json`, boundary e
analisador EXP-0022, mais `experiment-index`. Além do adaptador/teste de captura,
`canonical-hash`, `runtime-provenance` e `source-fingerprint` são dependências
herdadas e precisam
permanecer byte a byte idênticas ao EXP-0021. O plumbing de freeze/open, docs e
índice necessários à consolidação fazem parte da allowlist C0; não são tratados
como mudança produtiva.

Para cada navegação:

1. após `Page.navigate`, ready e rede ociosa, o worker registra os requests e o
   ordinal do stream CDP vistos até aquele limite;
2. precisa existir exatamente um `GET /api/health` local de bootstrap, sem
   query nem marcador, com cadeia única
   `requestWillBeSent → responseReceived(200, application/json) →
   loadingFinished` já concluída;
3. imediatamente antes da sonda, o worker congela requestIds, pendências e o
   ordinal do mesmo stream CDP;
4. a expressão explícita faz um único health marcado: navegação 1 usa
   `/api/health?exp0022_probe=nav-1`, navegação 2 usa
   `/api/health?exp0022_probe=nav-2`, e ambas enviam o header fixo
   `x-duplex-exp-0022-audit: audit-health-v0.1`;
5. a expressão retorna `probeId`, URL, status, MIME e identidade de runtime; a
   diferença após seu término precisa conter exatamente esse novo request e
   nenhuma outra requisição;
6. o audit também precisa completar a cadeia 1→1→1, sem redirect ou
   `loadingFailed`, no mesmo frame/loader do bootstrap. Ordinais do stream CDP
   são normativos e timestamps monotônicos confirmam a ordem;
7. `bootstrapHealthRequestId`, `auditHealthRequestId`, snapshots antes/depois,
   delta, lifecycle, frame, loader, ordinais e timestamps ficam no envelope;
8. somente após `loadingFinished` do audit os dois fetches TTS sequenciais da
   navegação podem começar.

Não será aceito simplesmente “dois healths em qualquer lugar”. Conta como
health qualquer URL local cujo pathname seja `/api/health`, inclusive query
inesperada. Zero, um, três, marcador ausente, token da outra navegação,
requestId repetido, ordem invertida, origem/frame/loader diferente, redirect,
lifecycle incompleto ou health fora da janela invalidam o instrumento.
`networkRequests` é a evidência normativa enriquecida com request, response,
finish/failure, status, MIME, frame/loader, timestamps e ordinais. Lifecycle,
snapshots e delta são reconstruídos dessa lista; os resumos no binding só são
aceitos se forem projeções idênticas, impedindo request oculto ou resumo
autodeclarado.

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
   retry e com postData exato; os quatro IDs TTS e os quatro IDs de health são
   globalmente únicos e disjuntos;
7. em 4/4 unidades, comprimento e SHA-256 browser=CDP;
8. A1=A2, B1=B2, A≠B, WAV íntegro e captura fail-closed limitada;
9. A1 e B2, primeiros TTS após os dois healths de cada navegação, passam;
10. budget negativo, diagnostics, ausência de bytes no relatório, hash
    canônico e bindings commitados passam sem valor vacuamente aprovado.

O exercício real do retry não é exigido. Se todas as capturas ocorrerem na
primeira leitura, não haverá alegação de recovery transitório.

## Semântica congelada da avaliação

- envelope e campanha 2×2 completos e bem formados produzem
  `measurementStatus=EVALUATED`, mesmo quando o health causal invalida o
  instrumento;
- crash, timeout, signal, órfão, envelope malformado ou campanha incompleta
  produzem `NOT_EVALUATED`; os cinco gates de captura ficam `null` e nenhuma
  coleção vazia pode passar;
- envelope, campaign, navigation, unidade, captura, snapshot e ledger usam
  schemas exatos e recursivos; chave extra ou campo obrigatório ausente também
  é campanha malformada e produz `NOT_EVALUATED`;
- `instrumentValid=true` somente se todos os bindings estruturais forem
  verdadeiros; health estrutural inválido tem precedência sobre falha TTS;
- `pass` equivale exatamente à decisão `PASS_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING`;
- o claim fica `null` em INVALIDATE/FIX. Somente PASS materializa, literalmente:
  “Qualificação limitada: neste Chrome, processo e dois textos locais, um
  health de bootstrap e um health explícito foram distinguidos causalmente em
  cada navegação; 4/4 respostas TTS foram capturadas pelo CDP com os mesmos
  bytes observados no browser.”

O relatório não autoatribui checks que só existem depois do commit. Ele nasce
com `evidenceAcceptance.status=PENDING_POST_COMMIT_CHECK`; binding do relatório,
hash canônico, topologia e isolamento do commit são calculados pelo checker
pós-commit. Um checker válido imprime `CHECK PASS` junto da decisão, sem chamar
uma decisão INVALIDATE de “report PASS”. O núcleo desse checker possui provas
positiva e negativas para parent, allowlist, blobs, binding e hash.

## Decisões e próximo movimento

| condição prioritária | decisão | próximo movimento |
| --- | --- | --- |
| freeze, abertura, receipt, fontes, fingerprint, campanha, health causal, requestId, budget, diagnostics, report ou topologia inválidos; crash/timeout/órfão | `INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING` | reparar e reauditar sob outro número; não pré-registrar nem executar STOP |
| instrumento válido, mas captura tipada falha, hashes divergem ou A/B perde estabilidade/distinção | `FIX_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING` | diagnosticar o menor challenger de captura sob outro número; não pré-registrar nem executar STOP |
| 10/10 gates passam | `PASS_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING` | somente pré-registrar um novo experimento físico de STOP; execução continua proibida |

A precedência é `INVALIDATE > FIX > PASS`. Todos os ramos proíbem rerun do
EXP-0022 e execução física. `authorityEligible=false` em qualquer resultado.

O receipt é escrito atomicamente e write-once antes de worker, health, CDP,
Chrome ou rede. Receipt existente recusa um segundo worker; receipt órfão gera
INVALIDATE local sem reabrir rede/Chrome. Throw, exit, signal, timeout ou output
malformado do worker também são persistidos como INVALIDATE.

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
