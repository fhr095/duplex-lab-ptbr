# 007 — Cena promovida e microscópio executado (2026-08-16/17)

Fecho do lote autorizado pelo Felipe ("tudo relacionado a próximos
itens, inclusive o gasto de 5-8 dólares"). Relatórios completos locais:
var/observador/testes/{cena,microscopio}/RELATORIO.md (worktree
principal); harness de cena versionado em probes/percepcao/.

## Cena — 1º sensor promovido pela régua

- Tagger sherpa-onnx AudioSet 26MB int8 (apache-2.0): **AUC 1,000** com
  vão vazio (pior limpa 0,081 × pior adversa 0,971; limiar 0,5 folga
  6×) em 22 janelas rotuladas por desfecho (adversas: a6c1 + gravação
  de músicas do usuário; limpas: fala real de 3 sessões).
- Métrica grátis graves/voz RETRATADA como gatilho: 0,917 mas não
  generaliza (música far-field 2,6× < fala limpa baixinha 11,3× →
  nagaria na classe fala-baixa). Vira trace/fallback.
- Custo: 75,5ms/fatia de 4s @1 thread, EM PARALELO à finalização do ASR
  (222-679ms) → ≈0 latência adicionada; +113MB RSS.
- AÇÃO (ACAO-CENA.md): final curto+confiante sob cena → CONFIRMA antes
  de agir; vazios repetidos sob cena → PEDE REPETIÇÃO específica;
  freios 1×/30s c/ never-mute; nenhum turno bloqueado; trace
  cena.avaliada em 100% dos turnos; aceite = replay a6c1 (confirmação
  em vez de "Poxa, sinto muito").

## Microscópio — Qwen3-Omni em H100 (US$1,09 de US$8; pods auditados=0)

- Qwen/Qwen3-Omni-30B-A3B-Instruct (apache-2.0) BF16 em H100 80GB
  ($3,29/h); 60/60 chamadas válidas em 12,6min; tentativa 1 (US$0,40)
  falhou por dtype do harness — reportada com artefatos.
- **Endpoint e sobreposição: REPROVADOS como professor** — vieses de
  classe ("sempre completo"; "tudo backchannel") com confiança fixa
  0,92-0,95. Convergência forte: nem áudio-nativo 35B zero-shot resolve
  a borda da pausa — a tarefa exige treino específico, não escala.
- **Cena: APROVADO como anotador** (música 12/12, descrições
  específicas, confiança cai nas difíceis = comportamento calibrado).
- **Step-Audio R1.1 CORTADO na qualificação**: público (Apache, 33B)
  mas inferência oficial exige 4×GPU (sem caminho 1×80GB) → estouraria
  o teto. R1.5 radar. Sem cruzamento Qwen×Step: fila de anotação por
  divergência entre repetições + maioria-vs-desfecho.

## Estado da matriz após o lote

- PROMOVIDO: tagger de cena (integração = próximo ciclo de engine).
- Professores: só cena; endpoint/sobreposição SEM professor viável →
  caminho de treino futuro = anotação humana, não destilação.
- Políticas vivas (commit-revisável + gate de entrada) validadas na
  sessão 685b (10 absorções/0 falsos-merge; gate segurou 2,8s).
- Adormecidos com gatilho: fine-tune (telemetria), MaAI (corpus
  2-canais), pontuador streaming (priorização), Step R1.5 (pacote
  reproduzível).
