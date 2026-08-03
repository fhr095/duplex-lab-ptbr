# EXP-0021 — qualificação fail-closed da captura TTS pelo CDP

Status: **pré-registrado; instrumento implementado e aprovado em testes puros;
ainda não congelado nem aberto; zero Chrome, TTS oficial ou autoridade**

## Decisão que precisa desbloquear

Qualificar o limite Chrome/CDP que invalidou o EXP-0020 antes de gastar outra
tentativa física: o payload `/api/tts` consumido pelo browser pode ser ligado
ao request correto e recuperado integralmente, com identidade byte a byte e
falha fechada, em duas navegações novas?

Este experimento não mede STOP, lifecycle, silêncio, conversa, ASR ou
percepção. Ele remove ou confirma um bloqueio de instrumentação.

## Evidência anterior e hipótese

Na única tentativa do EXP-0020, a primeira chamada a
`Network.getResponseBody`, feita depois de `Network.loadingFinished`,
devolveu corpo vazio e consumiu a abertura. Depois do fechamento, três probes
exploratórios sem STOP recuperaram o mesmo WAV tanto com buffers explícitos
quanto com a configuração antiga. Logo, “faltavam buffers” não está
demonstrado como causa suficiente.

Hipótese mínima: buffers dimensionados para os payloads, combinados com uma
janela curta de novas leituras do **mesmo requestId**, qualificam a captura sob
disponibilidade intermitente sem refazer a requisição, trocar seus bytes ou
perturbar áudio. Corpo ausente depois do orçamento continua sendo erro.

O bundle buffers + retry é um único challenger. Esta rodada não atribuirá ganho
causal a um de seus elementos. `maxPostDataSize` protege a visibilidade do
request body; ele não é apresentado como buffer da resposta.

## Nome e limite da decisão

O outcome positivo é `PASS_CDP_TTS_CAPTURE_QUALIFICATION`, não “recovery”.
Se nenhuma sequência vazio→válido ocorrer naturalmente, o passe afirma apenas
que 4/4 respostas foram capturadas; o retry permanece provado por teste
determinístico. Se ao menos uma ocorrer, o relatório pode acrescentar
`transientRecoveryObserved=true`, limitado às ocorrências registradas.

Nenhum resultado deste experimento autoriza repetir o EXP-0020, executar uma
medição física de STOP, interpretar ordem física ou promover runtime. Um passe
autoriza somente escrever e revisar o pré-registro de outro número.

## Challenger mínimo

Somente o adaptador de instrumentação poderá mudar:

1. `Network.enable` recebe 16 MiB de buffer total, 2 MiB por recurso e 64 KiB
   para post data; `enableDurableMessages` permanece desligado porque não há
   navegação cross-process entre resposta e leitura;
2. para cada requestId há no máximo quatro leituras. Antes das leituras 1–4, o
   worker espera respectivamente 0, 8, 24 e 64 ms; se todas forem necessárias,
   o atraso acumulado é 96 ms;
3. depois do primeiro sucesso nenhum timer ou leitura adicional é criado;
4. somente `{ body: "", base64Encoded: true }` pode avançar à leitura
   seguinte. A flag é validada antes do vazio; erro de comando,
   `base64Encoded !== true`, base64/WAV inválido ou corpo ainda vazio na
   quarta leitura encerra aquela captura como falha;
5. cada resultado registra requestId, sequência, timestamps das quatro janelas
   possíveis, quantidade de leituras, vazios anteriores ao sucesso e
   `encodedDataLength` de `loadingFinished`;
6. nenhuma leitura dispara fetch e nenhum byte vem do servidor por um segundo
   caminho.

O retry não entra em métrica de produto. O browser já recebeu a resposta; o
instrumento mede somente a disponibilidade posterior do corpo no CDP.

## Supervisor, worker e crash

O processo que usa Chrome não pode ser responsável sozinho por registrar a
própria morte.

- um supervisor externo valida worktree, commits, freeze e abertura;
- ainda sem health, CDP ou qualquer rede, o supervisor cria o receipt por
  operação atômica/write-once;
- somente então ele inicia um worker separado para health e Chrome;
- sucesso ou falha esperada de coleta retorna um envelope estruturado e
  limitado ao supervisor. Erro de comando CDP, quatro vazios, status/MIME
  inválido, overflow, base64/WAV inválido ou mismatch são códigos tipados; se
  campanha e bindings permanecem válidos, o analisador emite `FIX`;
- throw não classificado, exit sem envelope válido, signal, timeout ou envelope
  malformado faz o supervisor criar automaticamente
  `INVALIDATE_CDP_TTS_CAPTURE_QUALIFICATION`;
- se o supervisor inteiro morrer depois do receipt e antes do relatório, a
  próxima invocação entra apenas em recuperação: não abre rede nem Chrome e
  materializa uma invalidação por tentativa órfã;
- receipt existente nunca autoriza novo worker.

O freeze liga por hash supervisor, worker, adaptador, analisador, boundary,
testes, package, gitignore, paths, configuração, fontes de produção e
pré-registro. A topologia Git exigida é:

```text
C0 instrumento → freeze isolado → abertura isolada → receipt+report isolados
```

O commit de evidência precisa ser filho direto da abertura e adicionar somente
receipt + report. Checkers posteriores aceitam descendentes, mas validam os
bytes e commits históricos.

O endpoint CDP oficial não é livre: ele precisa ser HTTP no gateway padrão do
WSL, porta 9223. Um `CDP_URL` herdado só é aceito se for exatamente essa mesma
autoridade. A aba nasce em `about:blank`; o targetId retornado precisa coincidir
com o path `/devtools/page/<targetId>`, e o worker reconstrói a autoridade do
WebSocket a partir do endpoint validado, em vez de confiar no host declarado
pelo Chrome. Endpoint, política, targetId e path ficam no envelope.

## Unidade, payloads e campanha fixa

A unidade é uma resposta TTS local, não uma fala renderizada. A única campanha
oficial terá duas navegações completas para
`http://localhost:4173/?automation=1&experiment=0021` e duas requisições
sequenciais por navegação, quatro no total.

Dois payloads distinguíveis impedem que uma resposta stale ou trocada passe:

| ID | texto exato | rate |
| --- | --- | ---: |
| A | Esta fala contínua mede uma única parada física do assistente. | 1 |
| B | Esta resposta diferente verifica o vínculo correto da captura local. | 1 |

A ordem é balanceada e congelada:

- navegação 1: A1, B1;
- navegação 2: B2, A2.

Para cada unidade, o próprio browser calcula SHA-256 e comprimento do
`ArrayBuffer`. Em paralelo, a cadeia CDP precisa conter exatamente um
`requestWillBeSent → responseReceived → loadingFinished` sob o mesmo
requestId, com postData do payload esperado. Somente uma requisição TTS fica em
voo; sequência, payload A/B e requestId ligam o digest do browser aos bytes do
CDP.

Os gates exigem A1=A2, B1=B2 e A≠B, além de browser=CDP em cada unidade. Probes
exploratórios anteriores ficam fora da contagem.

Em cada navegação, o próprio browser também faz um único `GET /api/health`.
Seu runId, fingerprint, brain, ASR, VAD, estado/engine/voz/cultura TTS precisam
coincidir com os health externos antes/depois. Assim, browser, servidor local
e processo medido ficam ligados pela mesma identidade de runtime. O freeze
calcula ainda o fingerprint esperado diretamente da árvore C0 usando o mesmo
algoritmo do servidor; o supervisor o recalcula do commit e do worktree, e o
analisador rejeita um servidor stale mesmo que ele seja internamente estável.

Não haverá `Audio`, `AudioContext`, `HTMLMediaElement.play`, `speak`,
`speakLoop`, sessão ativa, barge-in, STOP ou evento de lifecycle. Um script
CDP instalado antes dos scripts da página contará construções/chamadas de
áudio; snapshot/trace e o worker fecharão os demais contadores.

## Budget negativo obrigatório

No intervalo oficial, o relatório precisa conter estes valores exatos:

- 4 requests e 4 sínteses locais Windows TTS via `POST /api/tts`;
- 0 construções de `Audio`, `AudioContext` ou
  `webkitAudioContext`;
- 0 chamadas observadas de `HTMLMediaElement.play` ou Web Speech
  `speechSynthesis.speak`;
- o worker não chama `__duplexLab.speak` ou `speakLoop`; como a interface
  exposta pela página é congelada, essa ausência não recebe contador
  inventado: fica ligada ao source freeze, aos quatro fetches diretos exatos,
  à cardinalidade de `/api/tts`, ao trace e aos contadores de áudio;
- 0 eventos de barge-in, STOP ou transição de lifecycle;
- 0 decisões/efeitos no training trace;
- 0 ativações de microfone, captura, ASR ou VAD;
- 0 requests de LLM, tokens, APIs pagas, GPU, modelo challenger ou backbone;
- 0 recursos externos; somente a origem local congelada.

O aquecimento do servidor ocorre antes da abertura e não entra na campanha. O
delta health antes/depois do worker precisa permanecer zero para uso externo.

## Qualificação determinística antes do Chrome

Os testes precisam provar, por doubles controlados:

- sucesso na primeira leitura;
- primeiro corpo vazio seguido de corpo válido;
- quatro corpos vazios e nenhum quinto comando;
- erro de protocolo sem retry;
- corpo vazio com `base64Encoded=false`, base64 e WAV inválidos sem retry;
- WAV com RIFF/WAVE mas sem chunks `fmt ` e `data` coerentes sendo rejeitado;
- CDP restrito ao gateway WSL e WebSocket preso ao targetId criado;
- fingerprint do servidor stale divergindo da árvore C0 congelada;
- delays pré-leitura exatos [0, 8, 24, 64], mesmo requestId, timestamps
  monotônicos e nenhum timer após sucesso;
- uma única requisição por unidade, mesmo quando há quatro leituras;
- associação A/B-requestId e rejeição de resposta stale/cross-trial;
- erro de comando CDP retornando envelope estruturado e decisão `FIX`, separado
  de throw/crash sem envelope, que produz `INVALIDATE`;
- supervisor emitindo invalidação para throw, exit, signal e timeout;
- recuperação de receipt órfão sem health, rede ou Chrome;
- coleções vazias como `measurementStatus=NOT_EVALUATED`, nunca aprovadas por
  `every([])`.

Somente depois desses testes e de revisão independente o instrumento pode ser
congelado e a abertura commitada.

## Gates

Todos são obrigatórios para passe:

1. freeze e abertura válidos e commitados antes do Chrome, receipt write-once
   antes de rede, supervisor/worker congelados e recusa de rerun;
2. duas navegações, ordem A1/B1/B2/A2 e quatro unidades no total;
3. quatro cadeias CDP completas, cada uma com um único requestId, request POST,
   status 200, MIME `audio/wav`, postData exato e sem request produzido pelo
   retry;
4. em 4/4 unidades, comprimento e SHA-256 do browser são idênticos aos bytes
   CDP do mesmo trial;
5. A1=A2, B1=B2, A≠B e todos os WAVs têm mais de 44 bytes, menos de
   2 MiB e chunks `fmt ` + `data` estruturalmente coerentes;
6. cada captura usa 1–4 leituras no mesmo requestId, respeita os delays e só
   aceita `base64Encoded=true` com WAV íntegro;
7. A1 e B2, primeiras respostas **TTS** pós-health em cada navegação, passam;
8. endpoint/target CDP, runId e fingerprint vistos pelo Node e pelo browser,
   fingerprint esperado derivado da árvore C0, Chrome, voz e cultura
   permanecem ligados e iguais;
9. todos os contadores do budget negativo têm os valores exatos;
10. diagnostics, cardinalidade, receipt/report binding, hash canônico e
    topologia Git passam sem valor vacuamente aprovado.

O exercício real do retry não é exigido: flutuação ausente não será fabricada.

## Tabela total de decisões

| Condição prioritária | Decisão | próximo movimento mínimo congelado |
| --- | --- | --- |
| freeze, abertura, receipt, origem, cardinalidade, payload/ordem, cadeia/requestId, fingerprint, budget negativo, binding, report ou topologia inválidos; crash/timeout/órfão | `INVALIDATE_CDP_TTS_CAPTURE_QUALIFICATION` | reparar e reauditar o instrumento; pré-registrar outro número de captura; não medir STOP |
| campanha estruturalmente válida, mas comando CDP falha; quatro corpos ficam vazios; status/MIME, `encodedDataLength`, `base64Encoded`, base64 ou WAV diverge; buffer é excedido; digest/comprimento diverge; A/B perde estabilidade ou distinção | `FIX_CDP_TTS_CAPTURE_QUALIFICATION` | diagnosticar o código tipado e pré-registrar o menor challenger de captura; não medir STOP |
| 10/10 gates passam | `PASS_CDP_TTS_CAPTURE_QUALIFICATION` | pré-registrar um novo experimento físico de STOP |

A precedência é `INVALIDATE > FIX > PASS`. Nenhuma falha de coleta vira
invalidação se a campanha e seus bindings forem válidos; nenhuma violação de
campanha vira “fix” interpretável.
Nenhum dos três ramos autoriza rerun sob o número EXP-0021 ou execução física
de STOP; até no passe, a única permissão é pré-registrar outro experimento.

## Alternativas cortadas nesta rodada

- refazer `/api/tts` pelo Node: poderia gerar outro WAV e não prova os bytes
  consumidos pelo browser;
- interceptar e pausar a resposta pelo domínio `Fetch`: altera o timing do
  caminho que a medição física futura pretende observar;
- aceitar apenas buffers explícitos: os probes exploratórios não os isolaram
  como causa;
- usar quatro frases idênticas: não detecta resposta stale ou cross-trial;
- reabrir já os 12 STOPs: repetiria o erro de estrear o coletor durante a
  campanha mais cara.

## Alegação máxima

Um passe permite afirmar apenas que, neste Chrome, processo e dois textos
locais, quatro respostas TTS em duas navegações foram corretamente associadas
e recuperadas pelo CDP com os mesmos bytes observados dentro do browser, sob um
retry limitado e fail-closed. Se nenhum retry real ocorrer, não há alegação de
recuperação transitória. Não mede confiabilidade estatística, renderização,
interrupção, acústica, conversa ou qualidade para usuários.

## Ordem de execução

1. commitar este pré-registro, o closeout do EXP-0020 e a transição do índice;
2. implementar supervisor, worker, adaptador, analisador e testes sem Chrome;
3. auditar retry, A/B, budget negativo, crash e `NOT_EVALUATED`;
4. congelar a instrumentação;
5. materializar e commitar isoladamente a abertura;
6. executar A1/B1/B2/A2 uma única vez;
7. commitar receipt + relatório e consolidar a decisão;
8. somente um passe pode pré-registrar outro número experimental para STOP
   físico; a execução desse novo número exige seu próprio freeze e abertura.

## Trilha paralela

`EXP-0021-R` mantém challengers de modelo como `deferred`, sem download,
GPU, execução ou autoridade. Qualificar um coletor não é evidência a favor ou
contra DuplexCascade, Lychee-FD, PersonaPlex, MiniCPM-o ou DuplexOmni.
