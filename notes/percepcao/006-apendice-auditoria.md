# 006 — Apêndice de auditoria (evidência sanitizada e gatilhos)

Para auditoria externa: agregados completos dos quatro challengers (SEM
texto de fala do usuário — dados brutos por-momento permanecem locais em
`var/observador/testes/*/` por privacidade, reproduzíveis pelos
harnesses versionados em `probes/percepcao/`), a tabela de sobrevivência
com gatilho de retorno por item, e o mapa reivindicação→fonte.

## A. Evidência agregada por challenger

### Smart Turn v3.2 (áudio; 868 fatias, 782 únicas)
- AUC fim-real×hesitação 0,606 (IC95 0,559-0,651); acc@0,5 57,5% vs
  55,3% trivial; "completo" em 61,3% das hesitações.
- Gate nos 237 falso-commits: evita 28,3%±5,7 × atrasa 27,2%±4,7 dos
  349 fins — troca ~1:1 em TODOS os thresholds (AUC 0,561).
- Contraprovas: v3.1 pior (0,564); cauda-de-silêncio como classificador
  AUC 0,39-0,48; corr prob×silêncio 0,04 (não é silêncio disfarçado);
  hangover das fatias ~280ms igual nas 3 classes (alinhamento ok).
- Custo: p50 95,7ms / p95 121,8ms @1 thread (features 12,8 + ONNX 82,9);
  RSS 151MB; 8,3MB int8; BSD-2; PT entre 23 idiomas (benchmark próprio
  94,5% — contraste com leito real).

### Pontuação do Kroko (mesmas fatias, sha1 conferido)
- Acc balanceada 0,488; AUC cross-fit 0,517 (dedup 0,489).
- Mecanismo: pontuação RETROSPECTIVA (nasce com contexto à direita);
  fins-reais com ./?/! na borda: 3,7%; hesitações sem pontuação/vírgula:
  94% — denominador do sinal não existe.
- Gate degenerado: evitaria 90,7% dos cortes atrasando 96,3% dos fins.
- Contraprova de cauda: 0,5/1,0/2,0s → mesma distribuição (não é falta
  de silêncio; é falta de contexto futuro). 116 fatias (13,4%)
  transcrevem vazio com áudio presente (família de replays + a6c1).

### Namo-Turn-Detector-v1-Portuguese (texto; mesmas fatias)
- fp32: AUC 0,551 (0,506-0,597), acc bal 0,476; colapsa p/ "não
  terminou" (P(EOT) mediana 0,007 nas 3 classes); spearman −0,622 com
  nº de palavras. Dedup 0,566; sem a6c1 0,551; sem vazias 0,590; vazio
  → P=0,5046. Custo 27,4ms p50, RSS 728MB.
- quant PUBLICADO (do snippet oficial): logits constantes — MORTO.
- eot-bench PT (1.143 pausas/400 turnos): Namo 0,811 (0,785-0,835) MAS
  regra grátis "./?/!" = 0,821; restrito a já-pontuados: 0,491; sem
  pontuação: 0,665 → o sinal mora na FORMATAÇÃO.
- Baselines nossos: comprimento a-priori 0,374; comprimento INVERTIDO
  cross-fit 0,626 (> todos os zero-shot).

### MaAI/VAP (2 canais; zero-shot PT)
- Gate de cena: 52/59 momentos do leito v1 inválidos (bug de eixo,
  abaixo) → n=5 válidos: 2/2 segurou-contra-piso corrigidos (cruzamento
  +0,19/+0,27s; heurística grátis: 1,2s); 0/2 falso-shift em p_now;
  1 marginal em p_future (0,59). Probe bc detecta bc do SISTEMA (0,83
  no ack), não do usuário (0,02-0,09).
- Custo: RTF 0,194-0,220 @1 thread; decisão incremental ~120ms; 309MB
  RSS; streaming real (KV-cache 20s). Licenças: usados SÓ MIT
  (vap_*_kyoto, bc_tri, CPC); fr/ca (mais próximos de PT) são NC.

## B. Bug de eixo e leito v2 (a correção que muda conclusões)

- v1: reproduções por relógio de parede vs wav em relógio de AMOSTRAS
  (âncoras); skew +1,88s (36ed), +17,16s (a6c1), ±1s (e2c0).
- v2: dois canais do EMPACOTADOR (canal-usuario + canal-assistente,
  mesmo t0=min(conexões) e tDaAmostra por âncoras) → 26 sobreposições
  reais: backchannel-atravessado 10 · entrou-sobre-usuario 11 (5 =
  música a6c1; 6 = caudas 0,2-0,6s, metade sem palavra confirmada) ·
  segurou-contra-piso 2 (era 14 — fantasmas) · cedeu-curto 2 ·
  interrupção 1; reação causal p50 420ms (n=4).
- Implicação honesta: assimetria "20×2" do v1 RETRATADA; conversa
  normal da engine é boa; dor concentra-se em cena adversarial +
  caudas de entrada.

## C. Sobrevivência da fila (com gatilho de retorno)

| item | estado | gatilho que o acorda |
|---|---|---|
| MaAI (2 canais) | estacionado com mérito (capacidade provada; doença ausente no corpus) | corpus multi-pessoa OU telemetria viva acusando dor de 2 canais |
| Fine-tune Smart Turn | condicional | telemetria do commit-revisável: falsos-merge ou cortes residuais |
| Cabeça própria (features) | condicional (compete c/ fine-tune) | mesmo gatilho; primeira forma: comprimento-invertido+prosódia+pontuação |
| Audio-tagging cena | o mais próximo de entrar | fechar a AÇÃO "cena adversa → perguntar" (classe música/"meu avô") |
| SenseVoice / emotion2vec | vivos | ação de frustração/urgência desenhada |
| Qwen3-Omni × Step R1.1 | plano congelado (005 §) | autorização de gasto (~US$5-8); pré-GPU qualificado |
| Política destilada | destino final possível | professores mostrarem ganho que features não reproduzem |
| Pontuador streaming PT | candidato NOVO | priorização (destrava regra 0,82 do eot-bench) |
| Gate de entrada | PRÓXIMA política | — (implementação direta na linha obs) |

## D. Mapa reivindicação→fonte

- Números e métodos: notas 001-005 (esta branch) + harnesses
  probes/percepcao/ (reproduzem tudo na máquina de origem).
- Dados brutos por-momento (contêm fala do usuário): var/observador/
  testes/{smart-turn,namo,maai,eot-bench}/ + leitos em
  worktree percepcao var/ — LOCAIS por privacidade, por design.
- Políticas promovidas: engine na branch obs (commit revisável
  ab038f6 + validação viva registrada no PDCA local e na sessão e2c0).
- Candidata/produto: main (merge 6603460) + docs/CANDIDATA-V1.md +
  eval/evidencia/candidata-v1/ (evidência sanitizada da engine).
