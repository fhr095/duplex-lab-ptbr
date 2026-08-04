# EXP-0026 — fechamento da prontidão operacional terminal

Status: **encerrada; `NOT_READY_FOR_FREEZE_TERMINAL`; zero rerun**

Data da execução: 03/08/2026, horário de Brasília. Relatório canônico:
`eval/reports/exp-0026-operational-readiness-v0.1.json`.

## Resultado

| Gate | Estado final | Interpretação permitida |
|---|---|---|
| OQ-A — cadeia física | **FAIL / não observada** | A execução expirou em um prompt do operador depois do consentimento e do consumo da tentativa. Não mede nem refuta a cadeia física. |
| OQ-B — analyzer congelado | **PASS** | Vocabulário fechado, casos desconhecidos sem `R` e ranking determinístico passaram. |
| OQ-C — retirada e retenção | **PASS** | Retirada pós-processo, invalidação, novo codificador após abertura e purge idempotente passaram em drills. |
| OQ-D — reservas | **PASS** | Diversidade exaustiva, motivos administrativos, retirada obrigatória após início e teto de duas ativações passaram. |

A disposição agregada é `NOT_READY_FOR_FREEZE_TERMINAL`. O preflight do commit
selado havia passado runtime, Chrome/CDP, hashes e testes sem abrir microfone,
tocar áudio ou chamar o cérebro externo. Na execução física, a tentativa foi
consumida após o consentimento. Uma pausa operacional ocorreu enquanto a tela
aguardava resposta; ao retomar, o supervisor fechou com
`EXECUTION_EXCEPTION_AFTER_CONSUMPTION` e a condição CDP do prompt não
atingida. O budget permaneceu dentro do teto: 4,98 minutos, uma tentativa e
zero chamadas externas.

## Limite da conclusão

O resultado **não** diz que microfone, ASR, TTS, sobreposição ou ruído físico
falharam. Nenhum desses elos obteve observação completa suficiente. Também não
qualifica qualidade, latência, naturalidade ou interrupção. Os passes B/C/D
são evidência de engenharia sobre código e fixtures, não evidência humana.

Zero sessão externa do EXP-0026 foi aberta. Nenhum áudio ou transcript da
qualificação foi persistido, nenhum roster foi congelado e nenhuma pessoa
entra em `n`.

## Decisão

O freeze de roster e estação permanece proibido. Não haverá retry, reparo de
timeout ou segunda qualificação sob esta emenda. Se a cadeia física voltar a
ser condição necessária, isso exige decisão prospectiva e novo ID operacional;
não reabre nem reinterpreta esta tentativa.

Cenas, cérebro, categorias, regra de dominância, DuplexCascade, runner externo
e GPU permaneceram fora do escopo.
