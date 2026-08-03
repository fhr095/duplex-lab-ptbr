# EXP-0024 — fechamento da equivalência física após captura qualificada

Status: **concluído em 03/08/2026 —
`INVALIDATE_PHYSICAL_STOP_AFTER_CAPTURE_QUALIFICATION`; tentativa única
consumida; físico `NOT_EVALUATED`; zero autoridade e zero rerun**

## Resultado executivo

A tentativa prospectiva foi aberta e executada uma única vez no Chrome 150 do
Windows, sob o runtime, servidor local e coletor CDP congelados. Receipt,
journal e relatório foram persistidos, o journal terminou canônico com 68
frames e o checker pós-commit reconstruiu com sucesso os artefatos e a decisão.

A campanha parou no primeiro trial, antes de persistir qualquer observação
física ou captura ligada ao trial. A expressão herdada do EXP-0020 recusou o
snapshot inicial com a mensagem exata `trial precisa de um único render.active
inicial`. O worker materializou `WORKER_UNCAUGHT`, saiu com código 1 e o
analisador manteve todos os gates físicos em `null`, com
`physicalMeasurementStatus=NOT_EVALUATED`.

Portanto, o EXP-0024 não informa se uma das ordens de STOP é melhor, pior ou
equivalente. Ele informa algo anterior e mais estreito: tratar
`assistant.render.active` como um evento único de início de fala não é uma
premissa válida para este estímulo e este renderizador.

## Causa delimitada

O fato observado é a rejeição por multiplicidade de `render.active` no
snapshot inicial. A explicação do mecanismo é uma inferência verificável nos
bytes produtivos congelados: o `BrowserAudioRenderProbe` emite um novo
`render-active` a cada transição de quantum silencioso para quantum ativo. Uma
fala natural pode conter mais de uma dessas transições antes do STOP; o evento
representa atividade acústica segmentada, não necessariamente um único início
de reprodução.

O erro foi do instrumento, não evidência de falha física do produto. Não houve
mudança de runtime, TTS, VAD, política, modelo ou cérebro.

## Evidência preservada

- execução `FRESH`, com receipt antes do worker e journal append-only válido;
- 68 frames completos, 28.337 bytes e nenhum frame truncado ou malformado;
- 20 requests com lifecycle completo, 60 ordinais CDP e somente rede local;
- uma chamada TTS observada antes da rejeição;
- 0 `PHYSICAL_TRIAL_COMPLETED`, 0 `CAPTURE_COMPLETED`, 0 navegações concluídas;
- um diagnóstico estrutural `WORKER_UNCAUGHT` com a causa exata;
- worker com `WORKER_EXIT_FAILURE`, código 1 e sem erro de protocolo IPC;
- zero LLM externo, API paga, GPU, challenger, backbone ou nova autoridade.

## Cadeia auditável

- C0 do instrumento: `82f8874c391adf41e25c10efcf31ec1f851f8ae3`;
- freeze isolado: `26c7a09ea4d9f9550a43453cb187368f4fab535a`;
- abertura isolada: `a860e7806193286d79bda5a1cfc373ff8d03710d`;
- receipt + journal + relatório, filhos diretos da abertura:
  `5a65d155787f3875973c280c5ed8d576d69d2853`;
- freeze canônico:
  `sha256:bf41a9b3a04e20e6001807be8700917aceb6febbe4ec4c423e90f513dfe048b1`;
- abertura canônica:
  `sha256:caed773a889ab5e792d2eea56f99d8d57349e3536388409bdcae0b4a63099b6d`;
- receipt canônico:
  `sha256:9dcffbe3ee353fa8039e5d40f03f916e67815081e3ddaf41ae15fdf29c8a5500`;
- journal:
  `sha256:43077f02f805c2babde1ccf3e7d6588d9ef6590b0e6d488833a724d73046a90f`;
- relatório:
  `sha256:bc5a108b5ad57124ab71a2732152a3e10a7bdec9b5190651742403d8d8e66d18`.

O comando pós-commit `npm run eval:exp:0024:report:check` passou. A tentativa
não foi repetida e não pode ser reinterpretada sob uma regra nova.

## Alegação máxima e limites

Neste Chrome, processo e frase, o requisito de cardinalidade unitária para
`render.active` invalidou a coleta antes do primeiro STOP persistido. Não há
alegação sobre latência, silêncio terminal, ordem de marcadores, equivalência
física ou qualidade percebida.

## Próxima decisão

O EXP-0025 será um experimento novo. Ele manterá o runtime produtivo e o
coletor qualificado sem mudanças, escolherá por posição causal o primeiro
`render.active` posterior ao reset e tratará eventos adicionais anteriores ao
STOP como atividade acústica observável. Toda tentativa iniciada deverá
persistir um resultado tipado e snapshots suficientes mesmo quando uma
pré-condição falhar; nenhum erro da expressão poderá apagar novamente o ponto
de falha.
