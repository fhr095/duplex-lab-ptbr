# EXP-0023 — semântica causal de ordinais e timestamps CDP

Status: **pré-registrado; instrumento implementado e testado; aguardando
auditoria e freeze; zero autoridade**

## Decisão que precisa desbloquear

Mantendo byte a byte a campanha que produziu evidência completa no EXP-0022,
um analisador que usa ordinais locais como autoridade da ordem de entrega e
timestamps apenas como limites individuais consegue qualificar
prospectivamente o binding health + captura TTS?

Este experimento não mede renderização, STOP, microfone, ASR, acústica,
conversa ou percepção humana. Ele corrige uma única premissa instrumental antes
de reabrir a medição física que interessa ao usuário.

## Evidência anterior e hipótese

O EXP-0022 foi `EVALUATED` e recuperou 4/4 WAVs, mas ficou terminalmente
invalidado. Nos 40/40 requests, a entrega ao observador respeitou
`requestOrdinal < responseOrdinal < finishedOrdinal`; em todos eles,
`responseTimestamp > finishedTimestamp`. A revisão exata do Chromium explica
o padrão: `responseReceived` usa o instante do handler e `loadingFinished` usa
um completion anterior da rede.

A hipótese mínima é que a causalidade relevante para a completude do ledger é
a ordem serial observada pelo listener CDP, não a comparação entre timestamps
produzidos em pontos distintos do pipeline. Remover somente essa desigualdade
deve fazer o instrumento passar sem aceitar evento ausente, terminal duplicado,
request oculto, ordem de entrega invertida ou sobreposição TTS.

## Challenger mínimo

O worker congelado do EXP-0022, o adaptador CDP, servidor, página, payloads e
fontes de produção serão herdados sem alteração. A captura continuará usando
o target `?automation=1&experiment=0022` e os probes `exp0022_probe`, porque
esses identificadores pertencem ao protocolo herdado; a identidade externa,
freeze, opening, receipt, relatório e decisão serão novos e pertencerão ao
EXP-0023.

A única mudança permitida no avaliador é:

- manter `requestOrdinal < responseOrdinal < terminalOrdinal` como autoridade;
- manter request, response e terminal com timestamps finitos;
- exigir `requestTimestamp <= responseTimestamp` e
  `requestTimestamp <= terminalTimestamp`;
- não exigir uma ordem relativa entre `responseTimestamp` e
  `terminalTimestamp`;
- manter as barreiras entre requests somente pelos ordinais do mesmo stream:
  bootstrap terminado antes do request de audit, audit terminado antes do
  primeiro TTS e um TTS terminado antes do request TTS seguinte.

Não haverá epsilon, tolerância de milissegundos nem ordenação seletiva por URL.
O relatório registrará quantas inversões response/terminal ocorreram e seus
extremos apenas como diagnóstico. Para que a tentativa teste de fato o delta,
pelo menos um dos quatro healths precisa exibir a inversão com ordinais
corretos; caso contrário o resultado não qualifica a nova semântica.

O analisador corrigido deve reaproveitar o contrato fail-closed do EXP-0022 e
provar que somente a autoridade temporal autorizada explica a diferença. Para
isso, uma cópia exclusivamente em memória projeta os timestamps de lifecycle
rastreado nos respectivos ordinais e submete todo o restante ao analisador
legado; em paralelo, os timestamps brutos precisam continuar finitos e não
anteriores ao próprio request. A campanha e o relatório canônicos preservam
sempre os valores brutos originais.

## Campanha fixa

- worker e schema bruto: os mesmos do EXP-0022, byte a byte;
- duas navegações completas;
- navegação 1: A1, B1;
- navegação 2: B2, A2;
- os mesmos textos A/B e rate 1;
- exatamente um health de bootstrap e um health de audit por navegação;
- exatamente quatro `POST /api/tts`, um por vez;
- os mesmos buffers CDP e retry limitado em 0, 8, 24 e 64 ms;
- WAV abaixo de 2 MiB, íntegro e sem bytes/base64 no relatório.

Continuam proibidos playback, Web Audio, Web Speech, microfone, sessão,
barge-in, STOP, training trace, LLM, API paga, GPU, challenger, backbone e
qualquer efeito novo.

## Gates obrigatórios

Todos precisam passar:

1. novo C0, freeze, abertura, receipt write-once e topologia Git válidos;
2. worker EXP-0022 e fontes produtivas byte a byte idênticos às versões
   herdadas;
3. campanha A1/B1/B2/A2, cardinalidades e schemas exatos;
4. ledger bruto com requestId único e exatamente um response e um terminal por
   request rastreado;
5. em todos os lifecycles,
   `requestOrdinal < responseOrdinal < terminalOrdinal` e cada timestamp não
   anterior ao próprio request, sem comparar response contra terminal; todos
   os ordinais brutos de evento são positivos e globalmente únicos, e a faixa
   ordinal de cada navegação termina antes da próxima;
6. pelo menos um health com `responseTimestamp > finishedTimestamp`, para
   exercitar a hipótese prospectivamente;
7. bootstrap/audit distintos, marcados, no mesmo frame/loader, com snapshots e
   delta reconstruídos do ledger;
8. pelos ordinais, audit concluído antes dos dois TTS e TTS estritamente
   sequenciais; timestamps entre requests não concedem nem revogam causalidade;
9. quatro cadeias TTS completas, postData/status/MIME exatos e IDs globais
   disjuntos dos healths;
10. browser=CDP em 4/4, A1=A2, B1=B2, A diferente de B, retry limitado,
    ambiente estável, budget negativo e diagnóstico limpo;
11. relatório sem payload, hash canônico, bindings e checker pós-commit sem
    passe vacuamente inferido; hashes de preregistro/relatório anterior/
    closeout são recalculados do C0, e receipt, freeze, opening, fingerprint e
    horários receipt→worker são reconstruídos dos artefatos reais.

Fixtures precisam demonstrar que timestamp response/finish invertido com
ordinais corretos passa, enquanto ordinal invertido, timestamp anterior ao
request, evento ausente, terceiro health, TTS antes do audit ou TTS sobrepostos
falham.

## Semântica de decisão

| condição prioritária | decisão | próximo movimento |
| --- | --- | --- |
| boundary, schema, worker herdado, lifecycle, ordinais, health causal, exercício da inversão, budget, diagnostics, report ou topologia inválidos | `INVALIDATE_CDP_LIFECYCLE_ORDER_SEMANTICS` | reparar sob outro número; sem STOP |
| instrumento válido, mas captura, bytes ou estabilidade A/B falham | `FIX_CDP_TTS_CAPTURE_AFTER_ORDINAL_BINDING` | diagnosticar captura sob outro número; sem STOP |
| todos os gates passam | `PASS_CDP_TTS_CAPTURE_AFTER_ORDINAL_BINDING` | somente pré-registrar um novo experimento físico de STOP |

A precedência é `INVALIDATE > FIX > PASS`. `claim` existe somente no passe,
`authorityEligible=false` sempre, `sameExperimentRerunAllowed=false` sempre e
execução física de STOP permanece proibida em todos os ramos.

## Ordem operacional

1. commitar closeout do EXP-0022, este pré-registro e a transição do índice;
2. implementar o menor delta de análise, boundary e testes sem Chrome/rede;
3. auditar que o worker herdado e as proteções fail-closed não mudaram;
4. commitar C0 e freeze isolado;
5. aquecer servidor/Chrome sem consumir a tentativa;
6. commitar abertura isolada;
7. executar uma única campanha oficial;
8. commitar receipt + relatório juntos, rodar o checker e consolidar sem rerun.

O passo 2 está concluído em desenvolvimento: o delta ordinal, o boundary, o
supervisor write-once, o checker e as fixtures fail-closed existem. Nenhuma
campanha EXP-0023 foi aberta ou executada; auditoria, C0 e freeze continuam
obrigatórios antes da tentativa única.

## Alegação máxima

Um passe permitirá afirmar somente que, neste Chrome, processo e dois textos,
a ordem de entrega por ordinais qualificou o binding de health e 4/4 capturas
TTS sob o retry limitado, mesmo quando timestamps internos response/finish não
seguiram a mesma ordem. Não mede confiabilidade estatística, áudio renderizado,
interrupção, conversa ou qualidade percebida.
