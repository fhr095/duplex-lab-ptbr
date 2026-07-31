# EXP-0003 — vertical PCM + Parakeet + barge-in renderizado

Status: `PROMOVIDO COM GATES EXTERNOS EM HOLD`

## Decisão

Promover Parakeet TDT 0.6B v3 ONNX INT8 como ASR final local, manter Whisper
`tiny` para parciais e preservar Whisper `base` como baseline reproduzível.

Isso promove um componente, não o produto inteiro. Qualidade humana espontânea,
cauda física e naturalidade continuam em `hold`.

## Hardware e custo

- AMD Ryzen 5 7430U, 4 núcleos/8 threads, aproximadamente 8 GiB RAM;
- sem GPU;
- Chrome no Windows, backend no WSL;
- zero chamadas de API paga;
- workers persistentes com `OMP_WAIT_POLICY=PASSIVE` e `KMP_BLOCKTIME=0`.

## Hipóteses

1. Uma final TDT rápida reduziria a latência sem perder qualidade agregada.
2. Especular durante pausa aproveitaria CPU antes do endpoint.
3. Tornar a final mais rápida revelaria falsos commits antes escondidos pela
   lentidão.
4. Uma reconciliação e uma graça curta resolveriam esses novos modos de falha
   sem LLM.

## Resultado ASR congelado

| Candidato | WER CORAA | RTF p50 | Decisão |
| --- | ---: | ---: | --- |
| Whisper `base` | 52,82% | 0,46 | baseline |
| Whisper `small` | 36,62% | 1,25 | hold híbrido |
| Parakeet v3 | 38,03% | 0,13 | promote |

No pack sintético de 21 falas, Parakeet obteve WER 4,40% e RTF p50 0,10.
O gate comparativo registrou ganho absoluto de WER de 14,79 pontos e
`materialRegressionRate=0,1667`.

Falhas preservadas:

- clipes curtos/ruidosos podem virar inglês;
- final pode vir vazia;
- “sexta” pode virar “cesta” em comando de agenda;
- o corpus humano absoluto ainda reprova o alvo de WER 25%.

## Mudanças promovidas

- final Parakeet e parcial `tiny` em processos persistentes separados;
- prefinal disparada por parcial completa que chega durante pausa;
- suspensão de parciais redundantes sobre silêncio;
- fallback para a parcial quando a final Parakeet é vazia ou troca claramente
  para inglês;
- graça de commit de 220 ms em conversa comum;
- graça de 500 ms antes de ações potencialmente corrigíveis;
- merge de continuação/correção antes de publicar a final;
- parada medida até o último quantum não silencioso no renderer.

## Evidência user-perceived no Chrome

Configuração efetiva: Parakeet final, `tiny` parcial, endpoint 520 ms, VAD com
10 frames de pausa.

| Métrica | Resultado |
| --- | ---: |
| Sessão física | 30,05 s |
| Frames | 1.500 na janela |
| Falsas ativações/stops | 0 |
| Gaps/drops/erros PCM | 0 |
| WER da fala simples | 0 |
| Fim de fala→voz | 892 ms |
| Endpoint→voz | 372 ms |
| Onset PCM→VAD | 63,7 ms |
| Onset PCM→último quantum | 98,01 ms |
| STOP JS | 1 ms |
| VAD→último quantum | aproximadamente 35 ms |
| Gates Chrome | 11/11 |

A janela de commit elevou a latência da resposta simples, mas ela permaneceu
abaixo do teto provisório de 1,2 s e eliminou uma resposta prematura observada
em continuação espontânea.

## A/B de endpoint

Seis rodadas contrabalanceadas, 72 observações, compararam `520/10` a `450/5`.
O endpoint mediano melhorou 60 ms no challenger, mas a cadeia fim→final não
demonstrou não-inferioridade e a cauda do endpoint piorou. Decisão:
`INCONCLUSIVE`; manter `520/10`.

## Candidato de VAD rejeitado

Uma configuração mais sensível (`minimumOn=0,018`, multiplicador `3`,
onset `3` frames) recuperou o trecho humano baixo antes perdido, com WER 14,29%,
e reduziu o WER da campanha humana de 63,33% para 46,67%. A primeira rodada
física passou, mas a repetição detectou a própria saída como fala após cerca de
9,9 s: um falso barge-in e uma resposta espúria (“Yeah.”).

Decisão: não promover. O default conservador (`0,025 / 4 / 4`) permanece.
Esse resultado mostra que energia isolada não resolve simultaneamente fala baixa
e eco; a próxima solução precisa de referência de saída/AEC melhor ou VAD com
sinais adicionais, não de mais redução cega do limiar.

## O que não foi provado

- som já saído do alto-falante e reverberação da sala;
- AEC em várias caixas, microfones e distâncias;
- preferência ou naturalidade da voz;
- p95 em múltiplos falantes/ambientes;
- 10 minutos contínuos;
- qualidade suficiente para executar slots críticos sem confirmação.

## Próxima hipótese

Usar verificação mais forte somente em baixa confiança, clipe curto ou intenção
com efeito. Em paralelo, capturar loopback físico e executar A/B humano de TTS.
Esses experimentos atacam riscos percebidos pelo usuário; trocar o LLM de
conteúdo agora não ataca nenhum blocker medido.
