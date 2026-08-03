# EXP-0023 — fechamento da semântica causal ordinal do CDP

Status: **concluído em 03/08/2026 —
`PASS_CDP_TTS_CAPTURE_AFTER_ORDINAL_BINDING`; tentativa única consumida;
instrumento qualificado no escopo medido e zero autoridade de runtime**

## Resultado executivo

A campanha prospectiva completou as duas navegações e as quatro unidades A1,
B1, B2 e A2. Os dez gates ficaram verdadeiros: 4/4 WAVs foram recuperados,
os bytes observados pelo browser e pelo CDP coincidiram, A1=A2, B1=B2 e A
permaneceu diferente de B. Bootstrap e audit health ficaram distintos e
causalmente ligados, os quatro TTS foram sequenciais e todos os ordinais
brutos foram positivos, únicos e ordenados entre navegações.

O delta que motivou o experimento foi exercitado de fato. Nos 40 requests com
lifecycle, o listener recebeu `request < response < terminal`, enquanto o
timestamp de response ficou posterior ao timestamp terminal em 40/40; quatro
desses casos eram health. Isso confirma, neste instrumento, que a ordem serial
de entrega precisa ser representada pelos ordinais e que timestamps produzidos
em pontos distintos do Chromium não devem impor uma ordem cruzada inexistente.

A decisão oficial é
`PASS_CDP_TTS_CAPTURE_AFTER_ORDINAL_BINDING`, com `pass=true`,
`instrumentValid=true`, `authorityEligible=false` e sem rerun. O passe remove
exclusivamente o bloqueio instrumental para **pré-registrar** uma nova medição;
a execução continua proibida até implementação, auditoria, C0, freeze e
abertura próprios. Ele não mede STOP, áudio renderizado, microfone, ASR,
conversa ou percepção humana.

## Cadeia auditável

- C0 do instrumento: `de919470f0b4b59db4f911b7ae5e40fcc9606707`;
- freeze isolado: `e310185d80d1e4e0a5980a0b749dae80f3635c99`;
- abertura isolada: `30813869f3a2bdbf0c69ca3bf72073b68d54c361`;
- receipt + relatório, juntos e filhos diretos da abertura:
  `ee0d5864aac4a984b33c9bdb86273ca9e7283b38`;
- relatório canônico:
  `eval/reports/exp-0023-cdp-ordinal-timestamp-semantics-v0.1.json`;
- hash canônico do relatório:
  `sha256:4abedd7a55b9a3ddc829eecb88a73ee90c1e4c95f7895d9601ebf6023e6bccc5`;
- freeze canônico:
  `sha256:0671c803e91d478f27bbbe86acb856782f2df7d30e1caa13bcc12acf464f99db`;
- abertura canônica:
  `sha256:fb5a4a7a89bc7bd26f18c150300deaf4861ae548a6f663056e92e86cd1f92cde`.

O checker pós-commit passou e reconstruiu boundary, hashes, receipt,
topologia Git, artefatos congelados e auditorias a partir dos arquivos reais.
Nenhuma campanha oficial foi repetida.

## Evidência preservada

- 2 navegações, 4 unidades e 4 capturas bem-sucedidas em 4 leituras;
- 40 requests rastreados e 120 ordinais de evento, todos globalmente únicos;
- faixas ordinais das navegações estritamente ordenadas;
- 40 inversões response/terminal e 4 inversões em health;
- skew diagnóstico de 0,317 ms a 43,522 ms, mediana de 6,727 ms e p95 de
  41,421 ms;
- WAV A com 237.232 bytes e SHA-256
  `ca2f579e7942db94c2f50029525b2057d94964e91cfe79244bd706eb6f50cd4b`;
- WAV B com 248.918 bytes e SHA-256
  `c9fb2836513fb65f6211b0fda22a6c63da4a1c5b94453f78954353a514817279`;
- zero playback, microfone, STOP, LLM externo, API paga, GPU, challenger,
  backbone ou efeito de produto.

## Alegação máxima e limites

Neste Chrome, processo local e dois textos, ordinais do stream CDP
qualificaram o binding de health e 4/4 capturas TTS com bytes idênticos aos do
browser, inclusive sob timestamps response/finish invertidos. Não há alegação
de confiabilidade estatística em outros ambientes nem de qualidade física ou
percebida da interrupção.

## Próxima decisão

O EXP-0024 será um experimento novo, não um rerun nem uma reinterpretação do
EXP-0020. Ele manterá byte a byte o runtime físico que originou a dúvida,
reutilizará a campanha de 12 STOPs e substituirá somente o coletor TTS que
falhou pelo adaptador diagnosticado nos EXP-0021/0022 e qualificado
prospectivamente apenas no EXP-0023. Antes
de qualquer Chrome físico, precisa de implementação testada, auditoria, C0,
freeze e abertura próprios.
