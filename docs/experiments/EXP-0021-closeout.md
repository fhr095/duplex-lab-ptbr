# EXP-0021 — fechamento da qualificação da captura CDP

Status: **invalidado em 03/08/2026 —
`INVALIDATE_CDP_TTS_CAPTURE_QUALIFICATION`; tentativa única consumida; zero
autoridade e sem qualificação da captura**

## Resultado executivo

A campanha oficial completou as duas navegações e as quatro unidades A1, B1,
B2 e A2. O CDP recuperou 4/4 WAVs na primeira leitura, os comprimentos e
SHA-256 coincidiram com os calculados dentro do browser, A1=A2, B1=B2 e A≠B.
Isso, porém, não produz um passe: o instrumento congelado exigia exatamente um
`GET /api/health` por navegação, enquanto a página já faz um health no bootstrap
e o auditor adicionou outro health explícito. Foram observados exatamente dois
em cada navegação.

Por precedência pré-registrada, `navigationAuditValid=false` torna
`instrumentValid=false` e a decisão é invalidação, mesmo com os cinco gates de
captura verdadeiros. O relatório mantém `claim=null`, `pass=false` e
`authorityEligible=false`. A tentativa não será repetida nem reinterpretada.

## Cadeia auditável

- C0 do instrumento: `2fbe5af88931d49c236cc27f241f2a74c545f1d2`;
- freeze isolado: `7b772a3cc9bdcca97df18ae1dd0e6c9b2f9545c5`;
- abertura isolada: `b334f4d1de3b2b0092b567d69ff5abdc15fa7215`;
- receipt + relatório, juntos e filhos diretos da abertura:
  `5c3d810c065d28b2d8c5f56f5ade4e9e284cc84f`;
- relatório canônico:
  `eval/reports/exp-0021-cdp-capture-qualification-v0.1.json`;
- hash canônico do relatório:
  `sha256:180aa4309f75332c8c843b99f5c36d1542140a5ca046e056f2e60535b8e10ed8`;
- decisão: `INVALIDATE_CDP_TTS_CAPTURE_QUALIFICATION`;
- `measurementStatus=EVALUATED`, `instrumentValid=false`, `pass=false`,
  `claim=null` e `authorityEligible=false`.

O checker da evidência commitada passou e confirmou freeze, abertura, receipt
write-once anterior à rede, fontes, fingerprint C0, hashes e topologia Git.

## Evidência diagnóstica, sem autoridade

O relatório preserva estes fatos para orientar o reparo, sem convertê-los em
qualificação:

- 4/4 cadeias `requestWillBeSent → responseReceived → loadingFinished` foram
  ligadas a requestIds distintos e aos postData esperados;
- todas as quatro capturas terminaram na primeira leitura, sem recovery
  transitório observado;
- A produziu 237.232 bytes e SHA-256
  `ca2f579e7942db94c2f50029525b2057d94964e91cfe79244bd706eb6f50cd4b`;
- B produziu 248.918 bytes e SHA-256
  `c9fb2836513fb65f6211b0fda22a6c63da4a1c5b94453f78954353a514817279`;
- browser=CDP nas quatro unidades, A1=A2, B1=B2 e A≠B;
- cérebro local, ASR desligado, VAD por energia adaptativa, shadow desligado,
  TTS Windows PT-BR pronto e fingerprint C0 permaneceram estáveis;
- zero áudio reproduzido, microfone, STOP, lifecycle, LLM, tokens, API paga,
  GPU, challenger, backbone ou efeito novo.

Nove dos dez gates ficaram verdadeiros. O único gate falso foi
`diagnosticsNetworkAndBindings`, porque `navigationAuditValid=false`. Esses
valores não podem ser usados seletivamente para declarar passe.

## Causa delimitada

Em cada navegação, a sequência real foi:

1. a página carregou e fez seu health de bootstrap;
2. o worker esperou a rede ficar ociosa;
3. o auditor fez um segundo health para ligar browser, runId e fingerprint;
4. A/B foram solicitados por `POST /api/tts`.

O analisador contou os dois healths, mas o contrato aceitava apenas um. A
falha está na cardinalidade do instrumento, não em bytes vazios, retry, WAV,
CDP, TTS ou runtime stale. Ainda assim, separar causa provável de decisão
oficial é obrigatório: o EXP-0021 está terminal e invalidado.

## Próxima decisão

O EXP-0022 manterá a campanha 2×2 e mudará somente o binding de health: deverá
identificar exatamente um request de bootstrap concluído antes da sonda e
exatamente um request explícito produzido pela sonda, ambos locais, distintos
e ordenados. Nenhuma execução de STOP será aberta antes de esse novo
instrumento passar sob novo freeze, abertura e tentativa única.
