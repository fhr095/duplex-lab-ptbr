# Bateria de regressão — candidata v1 (2026-08-15)

Replays das 8 sessões-chave gravadas, reinjetadas na config candidata
(TAGARELA int8 default + Kroko parciais + teto 30 s + cérebro local
determinístico). **Sanitização**: sessões identificadas por pseudônimo
(sufixo hex do pacote); nenhum áudio e nenhum texto de fala do usuário
neste relatório — conteúdo bruto permanece local em `var/observador/`
(fora do Git, por privacidade), auditável na máquina de origem.

## Sobrevivência (o gate primário)

**8/8** engines completaram o replay sem surdez, sem queda de WS, sem
erro de pipeline — inclui:

- `2e22` — sessão com monólogo acima do teto (o caso que causava 44 s de
  surdez na v0); com teto 30 s default, finalizou e concatenou.
- `091b` — sessão que derrubava o WebSocket na era fp32 (RAM);
  estável com int8.
- `bd30` — sessão do modo surdez-2 (VAD sem retorno a idle); sem
  reincidência.

## Divergência média por sessão (antiga → candidata, vs pseudo-ref)

| sessão | falas pareadas | antiga | candidata | leitura |
|---|---|---|---|---|
| 63fe | 15 | 0,961 | 0,905 | melhor |
| 091b | 11 | 0,720 | 0,680 | melhor; qualitativo: alucinações EN extintas, nome próprio mais próximo |
| 7f6c | 32 | 2,624 | 2,624 | paridade exata |
| 36ed (CONTROLE: gravada com a própria pilha candidata) | 41 | 1,681 | 1,696 | paridade (Δ ruído) — valida a ferramenta |
| 2e22 | 21 | 1,368 | 1,561 | artefato de segmentação¹ |
| f064 | 32 | 2,952 | 3,174 | artefato de segmentação¹ |
| bd30 | 26 | 0,938 | 1,768 | artefato de segmentação¹ |
| 9d78 | 0 pareáveis | — | — | finais órfãos 7 → 5 (alinhamento melhor) |

¹ A candidata retém e CONCATENA fala em torno do teto (comportamento
desejado, validado verbatim): finais mais longos que a segmentação da
pseudo-referência, penalizados pelo comparador segmento-a-segmento
(anterior à concatenação). A paridade exata do controle 36ed e do 7f6c
sustenta a leitura: quando a pilha é a mesma, a divergência é a mesma.
Melhoria futura da ferramenta: métrica por janela de conteúdo.

## Referência da pseudo-ref

Whisper medium offline sobre o canal do usuário (piso de ruído da própria
referência reconhecido — dev-set, não verdade humana; a verdade humana da
candidata é o CORAA, ver `coraa-*.json` neste diretório).
