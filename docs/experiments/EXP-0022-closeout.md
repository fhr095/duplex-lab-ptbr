# EXP-0022 — fechamento do binding bootstrap + audit health

Status: **invalidado em 03/08/2026 —
`INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING`; tentativa única consumida; zero
autoridade e sem qualificação da captura**

## Resultado executivo

A campanha oficial completou duas navegações e as quatro unidades A1, B1, B2 e
A2. Os healths de bootstrap e auditoria ficaram distintos, completos e ligados
por requestId; 4/4 WAVs foram recuperados na primeira leitura, com bytes e
SHA-256 idênticos entre browser e CDP, A1=A2, B1=B2 e A diferente de B. Nove dos
dez gates ficaram verdadeiros.

O instrumento, porém, impôs que o timestamp de `responseReceived` fosse menor
ou igual ao de `loadingFinished`. Nos 40/40 requests com lifecycle, a ordem de
entrega observada foi `requestOrdinal < responseOrdinal < finishedOrdinal`, mas
`responseTimestamp > finishedTimestamp` por 0,267 a 38,792 ms. Essa única
premissa tornou `bootstrapAuditHealthBindingValid=false`,
`navigationAuditValid=false` e, por consequência,
`diagnosticsNetworkAndBindings=false`.

Pela precedência pré-registrada, a decisão oficial é invalidação. O relatório
mantém `claim=null`, `pass=false`, `instrumentValid=false` e
`authorityEligible=false`. A tentativa não será repetida nem reinterpretada
como passe.

## Cadeia auditável

- C0 do instrumento: `29b589a956e4aab487e71673d4c92b141d3c0511`;
- freeze isolado: `ba3f8824bbcadda88b68700bd6d706649e955bf4`;
- abertura isolada: `8d52894a0ba27a758a3a8c87e41ac8f2bdf99a9e`;
- receipt + relatório, juntos e filhos diretos da abertura:
  `b8aba7c49715e846a57bafbcbb1eeb4dee2f8a56`;
- relatório canônico:
  `eval/reports/exp-0022-bootstrap-audit-health-binding-v0.1.json`;
- hash canônico do relatório:
  `sha256:998f59e27d696c29a8abe8e91168bef17c4a54a3b6f77ccec22a07f55793dd28`;
- decisão: `INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING`;
- `measurementStatus=EVALUATED`, `instrumentValid=false`, `pass=false`,
  `claim=null` e `authorityEligible=false`.

O checker pós-commit passou. Ele confirmou binding, hash canônico, topologia
Git e isolamento do evidence commit. O
`evidenceAcceptance.status=PENDING_POST_COMMIT_CHECK` persistido no relatório é
intencional: o aceite depende do commit que contém o próprio relatório e não
pode ser autoatribuído dentro dele.

## Evidência diagnóstica, sem autoridade

O relatório preserva estes fatos, sem convertê-los em qualificação:

- dois healths por navegação, cada um com lifecycle 1→1→1, requestIds distintos,
  mesmo frame/loader e bootstrap concluído antes do audit;
- quatro requests TTS globalmente distintos, disjuntos dos quatro healths e
  estritamente sequenciais;
- 4/4 capturas qualificadas na primeira leitura, sem recovery transitório;
- SHA-256 de A no browser e CDP:
  `ca2f579e7942db94c2f50029525b2057d94964e91cfe79244bd706eb6f50cd4b`;
- SHA-256 de B no browser e CDP:
  `c9fb2836513fb65f6211b0fda22a6c63da4a1c5b94453f78954353a514817279`;
- ambiente, fingerprint, budget negativo e diagnósticos permaneceram estáveis;
- zero playback, microfone, STOP, lifecycle funcional, LLM, API paga, GPU,
  challenger, backbone ou efeito novo.

## Causa delimitada

O contrato estável do CDP descreve `responseReceived` e `loadingFinished` com
`MonotonicTime`, mas não promete a desigualdade cruzada usada pelo analisador.
Na revisão exata do Chromium observada pela campanha
`30f6543ae91e6a860e73b76e3216b663b050f4e5`, o handler de
`ResponseReceived` materializa `TimeTicks::Now()`, enquanto `LoadingFinished`
usa o `completion_time` já registrado pela rede. Portanto o completion pode ter
timestamp anterior e ainda ser entregue depois ao cliente CDP.

Fontes primárias:

- [contrato CDP Network 1.3](https://chromedevtools.github.io/devtools-protocol/1-3/Network/);
- [implementação do Chromium na revisão observada](https://chromium.googlesource.com/chromium/src/+/30f6543ae91e6a860e73b76e3216b663b050f4e5/content/browser/devtools/protocol/network_handler.cc#3699).

Uma contraprova somente em memória, sem alterar artefatos, removeu
exclusivamente `responseTimestamp <= finishedTimestamp`: os dez gates então
ficaram verdadeiros. Isso localiza a hipótese do próximo experimento, mas não
reescreve o resultado oficial.

## Próxima decisão

O EXP-0023 manterá worker, campanha, payloads, TTS, healths, buffers, retry,
budgets e proibição de STOP. A única mudança científica será usar os ordinais
do stream observado como autoridade de ordem de entrega. Timestamps continuarão
finitos e não anteriores ao próprio request, mas não ordenarão entre si
`responseReceived` e `loadingFinished`. Um novo passe prospectivo poderá apenas
autorizar o pré-registro de STOP; a execução física continuará dependendo de
freeze e abertura próprios.
