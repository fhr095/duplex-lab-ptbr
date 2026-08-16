# 005 — Marco 2 da frente percepção (2026-08-16)

Fecha o ciclo de challengers da matriz (003) com os leitos corrigidos e
a decisão. Quatro challengers EXECUTADOS, dois leitos reconstruídos, uma
política validada ao vivo, um bug de eixo encontrado e corrigido — e a
conclusão honesta de que, no corpus atual, NENHUM sensor pronto tem
prêmio demonstrado sobre políticas + features grátis.

## Matriz — atualização de estados

### EXECUTADO (com números)
| challenger | resultado | veredicto |
|---|---|---|
| Smart Turn v3.2 (áudio) | AUC 0,606; troca 1:1; 96ms | não promover |
| Pontuação Kroko | AUC 0,517; pontuação é retrospectiva | não promover |
| Namo PT (texto) | AUC 0,551 (colapsa p/ "não terminou"); quant publicado MORTO; 27ms/728MB | não promover |
| MaAI/VAP (2 canais) | zero-shot PT TRANSFERE (n=5 válidos: 2/2 segurou corrigidos em ~250ms; 0/2 falso-shift; RTF 0,2; 309MB; streaming ~120ms; pesos MIT) | promissor SEM prêmio no corpus atual (ver leito v2) — condicional a corpus com dor real de 2 canais |

### Baselines grátis que venceram modelos
- comprimento INVERTIDO (menos palavras na pausa = completo): AUC 0,626
  > todos os zero-shot no nosso leito.
- "termina em ./?/!": 0,821 no eot-bench (> Namo 0,811) — o sinal
  textual mora na PONTUAÇÃO → candidato novo: PONTUADOR STREAMING na
  perna de parciais (Kroko não serve: retrospectivo).

### Políticas (o que de fato moveu a experiência)
- Commit revisável: VALIDADO T4 ao vivo (e2c0: retomada 1453ms →
  1 turno; veredicto do Felipe em voz alta na escuta cega, +2).
- Próxima política barata (do leito v2): GATE DE ENTRADA — não iniciar
  reprodução enquanto a cauda de fala do usuário está ativa (~300ms de
  clearance); ataca a célula dominante real.

## Leitos v2 (pós-bug de eixo)

**Bug (achado pelo harness MaAI)**: v1 posicionava reproduções por
relógio de parede vs wav em relógio de amostras (skew +1,9s a +17s) —
52/59 pareamentos inválidos; assimetria "20 falas-por-cima × 2" SUSPENSA
e agora CORRIGIDA pelo v2.

**v2 (dois canais do EMPACOTADOR, mesmo eixo por âncoras; gate de cena
inerente — energia real dos dois lados)**: 26 sobreposições reais em 15
pacotes vivos:

| célula | n | leitura |
|---|---|---|
| backchannel-atravessado | 10 | bom comportamento confirmado |
| assistente-entrou-sobre-usuario | 11 | 5 = música da a6c1 (cena adversarial); 6 = entradas ~0,2-0,6s na cauda, metade sem palavra confirmada |
| segurou-contra-piso | 2 | era 14 no v1 — fantasmas de skew |
| cedeu-a-burst-curto | 2 · interrupcao-atendida 1 | reação p50 420ms (n=4) |

**Leitura honesta**: na conversa NORMAL, o turn-taking da engine é bom;
a dor real de sobreposição concentra-se na CENA ADVERSARIAL (música/
far-field) e em entradas curtas na cauda — política + cena acústica,
não modelo de 2 canais, no corpus atual.

## Decisão do marco (a escolha do §8)

**MANTER política + features; NENHUM sensor promovido; NENHUM fine-tune
agora.** Justificativa: (a) commit revisável comeu a fragmentação
(validado); (b) todos os zero-shot < features grátis nos leitos; (c) as
células que justificariam MaAI dissolveram com eixos corretos; (d) o
fine-tune de endpoint só se reavalia se a telemetria viva do commit
revisável mostrar dano residual (falsos-merge ou cortes que a absorção
não pegou). Próximas AÇÕES: gate de entrada (política, linha obs);
pontuador streaming PT (bancada quando priorizado); MaAI fica
CONDICIONAL a corpus multi-falante/dor real de 2 canais.

## Plano CONGELADO da rodada microscópio (Qwen3-Omni × Step-Audio R1.1)

Uma única rodada RunPod, quando destravada; nada roda antes de:
imagem+entrypoint+import+cache qualificados offline (post-mortem
PersonaPlex). AMOSTRAS FIXAS (congeladas neste marco): 12 momentos
estratificados dos leitos v2 (4 endpoint: 2 corte-seco + 2 fim-real; 4
sobreposição: 2 entrou-sobre + 2 backchannel; 4 cena a6c1
música/far-field) + 8 pausas do eot-bench PT (áudio, vozes externas).
PERGUNTAS FIXAS: (1) teto: o áudio-nativo resolve endpoint/backchannel/
cena onde cascata+features falham? (2) professor: pseudo-rótulos com
prompt congelado, N=3 repetições, confiança, CRUZAMENTO Qwen×Step;
divergência → fila humana; calibração contra os rótulos de desfecho.
Step: verificar R1.1 reproduzível ANTES (R1.5 radar). Custo-teto da
rodada: ~US$5-8 (A40/A100 spot 1-2h) — pedir autorização de gasto na
hora.

## Pendências que continuam vivas (sem dono nesta rodada)

Gate de entrada (política); pontuador streaming; ação operacional de
cena (a6c1) e de emoção; validação multi-falante (eot-bench áudio como
held-out); refino não-causal; telemetria viva do commit revisável
acumulando para a decisão de fine-tune.
