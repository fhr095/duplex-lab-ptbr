# EXP-0025 — fechamento terminal do instrumento STOP-R

Status: **concluído em 03/08/2026 —
`CUT_RENDER_STOP_INSTRUMENT_LINEAGE`; tentativa única consumida; STOP-R
`NOT_EVALUATED`; zero autoridade e zero rerun**

## Resultado executivo

A emenda prospectiva retirou health, ledger de rede, captura CDP e hashes WAV
dos gates do constructo. A tentativa oficial foi aberta e executada uma única
vez no Chrome 150 do Windows, sob runtime e instrumentação congelados. Receipt,
journal e relatório foram persistidos; o checker pós-commit reconstruiu os
artefatos e confirmou a decisão terminal.

A campanha ligou o Chrome, iniciou a primeira navegação e então expirou antes
do primeiro trial com `condição CDP não satisfeita`. O journal canônico contém
seis frames: `IN_PROGRESS`, `WORKER_STARTED`, `BROWSER_BOUND`,
`NAVIGATION_STARTED`, um `WORKER_UNCAUGHT` e `WORKER_OUTCOME` com exit 1.
Nenhum resultado de trial ou STOP foi produzido. Consequentemente,
`physicalMeasurementStatus=NOT_EVALUATED`; não existe conclusão sobre latência,
silêncio terminal ou ordem do renderer.

## Causa delimitada

O erro não veio dos requisitos periféricos removidos. O caminho mínimo deixou
de instalar `__exp0022Audit` via `Page.addScriptToEvaluateOnNewDocument`, mas
reutilizou `exp0022ReadyExpression()`, cuja condição ainda exigia exatamente
esse objeto além de `crypto.subtle` e `__duplexLab.snapshot`. Assim, a página
estava automatizável, porém a prontidão herdada nunca poderia ficar verdadeira.

Isso é uma falha estrutural do instrumento congelado, não evidência de falha do
runtime de voz. Como o EXP-0025 foi pré-registrado como tentativa terminal,
essa explicação não autoriza corrigir a expressão e repetir a campanha sob o
mesmo ID.

## O que a emenda conseguiu separar

- health, rede, captura e WAV ficaram `NOT_COLLECTED` e não causaram o corte;
- o ambiente congelado passou: runtime, Node, Chrome/CDP e origem local foram
  vinculados antes da navegação;
- a falha ocorreu no núcleo estrutural necessário para chegar aos trials;
- não houve `Network.getResponseBody`, download de modelo, API paga ou GPU;
- nenhuma alegação física ou de qualidade foi inferida por vacuidade.

## Cadeia auditável

- C0 do instrumento: `9485eadc5469cad0afb4df983c376b5af5a8cb02`;
- freeze isolado: `2b8db80c4d5d33803e0f8593a4cc8458122d05a3`;
- abertura isolada: `ee549a4a114680db52c09350487159bf14454db4`;
- receipt + journal + relatório: `65a7b6019ab4b7231d0c79b0bff724373bdf6aea`;
- freeze canônico:
  `sha256:fcb80332bd7d0c70a2a6a93248b7a04d7e03e22fcd4e68bcb3e4bf298cf3d51c`;
- abertura canônica:
  `sha256:21da1e5e719b920a6065f9093d148f7e46045165e829f0f709a424f51dc5df9b`;
- receipt canônico:
  `sha256:5e26287d710a23b9efe5d7c85e8e7d057f114e2fcac5c728b75bb598972c2221`;
- journal:
  `sha256:b8ee701d66bd3eae751227241517b972d41b81045928a78be0261511e92fc314`;
- relatório:
  `sha256:821e4550a13309c2b531a1d713b5c807aa4e4aac5c2bd11b46c06ae526bf3c3e`.

O comando `npm run eval:exp:0025:report:check` passou depois do commit da
evidência.

## Alegação máxima e limites

Neste runner, a condição de prontidão herdada continuou dependente de um audit
deliberadamente removido e impediu qualquer trial. Isso encerra a linhagem do
instrumento atual; não informa STOP-R, STOP-A, áudio audível, percepção humana
ou qualidade full-duplex.

## Próxima decisão

Não abrir um EXP-0026 apenas para reparar outra vez este instrumento. A trilha
EXP-0025-R depois testou esse headroom: o probe local foi cortado como
equivalente a `A0@600`, e a referência oficial terminou sem observações PT-BR
por bloqueio de ambiente. Uma nova frente crítica deve atacar uma capacidade
percebida diferente e pré-registrada, não reinterpretar este resultado.
