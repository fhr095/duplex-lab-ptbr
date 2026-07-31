# Roadmap guiado por gates

## Fase 0 — laboratório de decisão

Status: **implementado**.

Entregas:

- contrato de eventos e traces;
- cenários PT-BR v0.1;
- política determinística;
- regressões automatizadas;
- demo de interação;
- pesquisa inicial de modelos.

Gate: 100% das expectativas de engenharia.

## Fase 1 — primeira vertical com áudio real

Status: **vertical de engenharia promovida; prontidão humana em hold**. Captura
PCM, VAD Silero, ASR aberto incremental, endpoint, cérebro substituível, TTS,
interrupção, recuperação de transporte e campanhas Chrome funcionam juntos. O
gate restante não é integração: é qualidade PT-BR espontânea, acústica física
e preferência humana.

Objetivo: uma conversa PT-BR de ponta a ponta, ainda modular.

Entregas:

1. captura de microfone e render probe separados no grafo Web Audio —
   **implementado; canal físico de loopback pendente**;
2. timestamp monotônico por frame;
3. AEC/noise suppression explícitos;
4. streaming ASR PT-BR — **Whisper `tiny` parcial + Parakeet final em CPU,
   implementado**;
5. política atual ligada a eventos reais — **implementado**;
6. streaming TTS PT-BR cancelável — **provisório via Windows, implementado**;
7. adaptador de LLM externo com `AbortSignal` — **implementado**;
8. relatório acústico — **CORAA, WebSocket e Chrome implementados; cauda
   alto-falante/sala e A/B humano pendentes**.

Regra de custo: regressões e sweeps de engenharia não chamam APIs pagas.
Providers externos entram apenas em canários pequenos e comparações congeladas,
sob o mesmo contrato de traces.

Gate provisório:

- sessão estável de 10 minutos;
- parada acústica p95 ≤ 250 ms;
- primeiro áudio p95 ≤ 1,2 s em respostas simples;
- falso corte ≤ 5% no pack;
- correção/delegação/cancelamento ≥ 95%.

Evidência congelada atual:

- 163/163 testes e 20/20 expectativas de política;
- 10/10 execuções do Chrome, 27/27 gates em cada;
- primeiro áudio simples p95 187 ms;
- parada PCM→renderer p95 83,21 ms;
- retomada de backchannel p95 282,1 ms;
- soak físico de 600,082 s, 30.001 frames e zero falso início, gap ou drop;
- campanha PCM→VAD→endpoint→ASR com 15/15 falas finalizadas e 4/4 controles
  silenciosos.

O comparador registra `engineering-promote`. Ainda faltam loopback acústico
calibrado, diversidade humana e preferência cega; por isso a fase não recebe
`done` de produto.

## Fase 2 — fábrica autônoma de avaliações

Status: **fundação implementada; primeira vertical executada; runtime em
`hold`**.

Objetivo: usar IA para encontrar em escala as falhas que ainda não exigem uma
pessoa real. A vertical de correções já mostrou que a fábrica encontra defeitos
percebidos no caminho real; autonomia de geração/crítica e escala acústica ainda
precisam evoluir.

Entregas:

1. ontologia e schema versionados para correções — **implementados**;
2. blueprints confiáveis, oráculos semânticos/temporais e provenance —
   **implementados; ledger de efeitos pendente**;
3. superfícies linguísticas geradas e mutação adversarial determinística —
   **implementadas; geradores/críticos autônomos pendentes**;
4. fala sintética e ambientalização reproduzível — **uma voz, ganho e ruído
   branco implementados; multivoz, eco e reverberação pendentes**;
5. cobertura pairwise e auditoria metamórfica — **implementadas; novo holdout
   independente pendente**;
6. replay em lote no WebSocket e Chrome texto/PCM — **implementado no
   subconjunto de correções**;
7. relatório agregado com hashes, falhas e custo — **implementado**;
8. agrupamento e reincorporação autônoma de falhas — **pendente**.

Gate: novas rodadas ampliam diversidade sem descobrir continuamente classes
básicas de falha; decisões e efeitos críticos permanecem verificáveis por
oráculos independentes do gerador.

Evidência atual: toolchain `promote`; PCM limpo 5/6 semântico e 6/6 seguro;
PCM com ruído 3/6 semântico e 5/6 seguro. A fábrica foi promovida como
instrumento, não como prova de prontidão do runtime.

## Fase 3 — qualidade modular e local

Status: **iniciada**. Parser de correções, estado semântico e reparo de conflito
numérico antes de commit já existem; o gate ponta a ponta ainda não promove.

Atacar os maiores gargalos produzidos pela fábrica, preservando o caminho
full-duplex já promovido:

- correções, datas, valores, nomes e efeitos externos;
- endpoint e ASR seletivo sem taxar turnos comuns;
- TTS aberto, streaming e cancelável;
- fala simultânea, ruído, eco sintético e pressão de recursos;
- cérebro local opcional sob o mesmo contrato de provider;
- execução com rede bloqueada como gate explícito.

Torneios de componentes entram aqui, sempre no mesmo hardware e evaluator. Um
candidato recebe um spike limitado antes de precisar demonstrar ganho; nenhum
modelo vence por reputação ou demonstração.

Gate: ganho ponta a ponta em falhas medidas, dentro de budgets locais de
latência, memória e CPU, sem regressão de interrupção ou efeitos.

## Fase 4 — primeiro peso proprietário

Hipótese prioritária: ajustar um modelo pequeno de interação usando transcrição
incremental e sinais acústicos compactos.

Entrada:

```text
texto parcial + duração da pausa + sinais acústicos
+ usuário/assistente falando + tarefa ativa + estado corrigível
```

Saída:

```text
WAIT | BACKCHANNEL | SPEAK | STOP | DELEGATE | CANCEL | ROLLBACK
```

Sequência:

1. SFT nos traces sintéticos diversos e âncoras públicas disponíveis;
2. preferência entre decisões melhores/piores geradas e auditadas;
3. proteção semântica e de efeitos;
4. shadow mode contra a política determinística;
5. canário local sem autoridade externa;
6. promoção por ganho no evaluator completo.

Gate: melhora significativa em ao menos um gargalo real sem regressão nos
guardrails. Avaliação humana não é necessária para iniciar o shadow; será
necessária antes de alegar superioridade perceptiva.

## Fase 5 — calibração humana

Só vira caminho crítico quando a fábrica e a vertical local estiverem maduras.
Conversas cegas de 5–10 minutos medem naturalidade, conforto, sotaque,
previsibilidade, confiança, double-talk e cauda física da sala.

O objetivo não é construir primeiro uma base humana perfeita. É medir a
distância entre proxies e pessoas, escolher entre finalistas maduros e descobrir
novas famílias que voltam para a automação.

Gate: preferência e guardrails humanos com desenho estatístico versionado;
nenhum turno da mesma pessoa contado como participante independente.

## Fase 6 — adaptação nativa de áudio

Só começa se houver evidência de que a cascata atingiu um teto em prosódia,
sobreposição ou timing.

Experimentos limitados:

1. zero-shot PT-BR nos backbones finalistas;
2. adaptação do tokenizer/decoder de fala;
3. SFT full-duplex pequeno;
4. ablação com e sem separação semântico-acústica;
5. DPO/RL apenas depois de SFT estável.

Critério de abandono: custo, lock-in ou perda semântica desproporcional ao ganho
no mesmo evaluator.

## Dados como patrimônio transversal

Os dados crescem ao longo de todas as fases:

- v0.1: roteiros determinísticos de engenharia — implementado;
- v0.2: 24 correções geradas sobre blueprints, uma voz, ganho/ruído e replay
  texto/PCM — implementado como pack de desenvolvimento;
- v0.3: falhas adversariais, tarefas e sessões sintéticas longas;
- v0.4: âncoras humanas e descobertas convertidas em regressões;
- v1.0: conjunto humano cego e isolado do treino.

Cada versão recebe hash, proveniência, licença/consentimento quando aplicável,
card de dados e splits por família, gerador e pessoa.

## Ordem dos próximos experimentos

| Ordem | Experimento | Valor da informação | Limite |
| --- | --- | --- | --- |
| 1 | Prefinal acústica determinística no WebSocket e Chrome | separa framing/merge de nondeterminismo do ASR e ataca a cauda | 100 observações; gate congelado no EXP-0007 |
| 2 | Verificador seletivo de slot crítico | testa segurança sem taxar todos os turnos | somente se a causa anterior justificar |
| 3 | Temporalidade causal | transforma pausa, cross-turn e barge-in em estímulos reais | uma família por ciclo |
| 4 | Ledger/test-double de efeitos | prova que intenção obsoleta nunca escapa | seis correções atuais |
| 5 | Repetição + novo holdout | mede caudas e generalização sem otimizar o placar visto | ≥20 observações e pack congelado novo |
| 6 | Diversidade acústica e TTS aberto | mede vozes, salas, cancelamento e custo no caminho completo | após fechar a vertical limpa |
| 7 | Modelo em shadow + gate sem rede | testa peso proprietário e direção offline sem autoridade | um treino/candidato por vez |
| 8 | Sweep nativo full-duplex | mede o teto contra a cascata já madura | ≤2 h GPU/candidato |
| 9 | Loopback e A/B humano | calibra proxies e escolhe finalistas maduros | após gate de entrada |

## Regra de prioridade

```text
impacto × chance de funcionar × reutilização × valor da informação
─────────────────────────────────────────────────────────────────
engenharia + GPU + dados + risco de lock-in
```

Toda tarefa precisa apontar qual decisão ela desbloqueia. Se não desbloqueia
nenhuma, não entra no caminho crítico.
