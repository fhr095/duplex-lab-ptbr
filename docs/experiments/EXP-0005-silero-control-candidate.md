# EXP-0005 — Silero no controle de turnos

Status: `PROMOVIDO PARA ENGENHARIA; PRONTIDÃO HUMANA EM HOLD`

## Decisão

Silero VAD v6.2, com `p≥0,85` em uma janela, substitui o VAD de energia no
caminho de controle desta vertical. A promoção vale para a configuração e o
ambiente medidos; não afirma robustez acústica geral.

Todos os artefatos finais abaixo foram produzidos pelo mesmo código, identificado
pelo fingerprint:

```text
26a069655f453e6ce2fe367fa74532afa6d78696009bba5eb749afb71a838b1d
```

## Baseline

- energia adaptativa: RMS mínimo 0,025, multiplicador 4, quatro frames de onset;
- Parakeet TDT 0.6B v3 final e Whisper `tiny` parcial;
- Chrome do Windows com AEC `all`, supressão de ruído e AGC;
- Ryzen 5 7430U, CPU, aproximadamente 8 GiB;
- zero chamadas pagas.

Em 600,073 s, a baseline de energia manteve a captura íntegra, mas produziu três
falsos inícios de fala. Isso causou pausas e um turno espúrio perceptível.

## PDCA 1 — shadow contínuo

Silero entrou primeiro como auditor sem autoridade para pausar fala ou criar
turnos. O experimento comprovou estado recorrente, ordem de amostras, custo
baixo e especificidade melhor que energia, mas também encontrou um transiente
físico capaz de cruzar limiares permissivos. O contraexemplo foi congelado no
pack negativo.

Decisão: não promover `0,5×2`; ampliar o torneio e manter o challenger em
shadow.

## PDCA 2 — sweep com fala baixa e controles

O pack final contém 15 trechos de fala em quatro ganhos e quatro controles, 64
observações rotuladas no total. `0,85×1` obteve:

- 15/15 detecções em cada ganho: 1, 0,5, 0,25 e 0,125;
- zero falso positivo nos quatro controles;
- 3/3 comandos curtos e baixos detectados na campanha ao vivo;
- custo de uma janela de onset, preservando interrupção rápida.

Decisão: levar `0,85×1` ao caminho de controle, ainda sem promoção.

## PDCA 3 — estabilidade do transporte

O primeiro soak longo revelou overflow depois de minutos. A causa não era o
modelo: buffers e cálculos de percentis copiavam e ordenavam históricos
crescentes a cada frame. O transporte também não tinha recuperação de queda.

Foram introduzidos:

- janelas circulares de métricas com uma única ordenação por snapshot;
- telemetria periódica, em vez de uma mensagem por frame;
- fila limitada e instrumentada no servidor;
- reconexão WebSocket com epoch, sequência e watermark preservados;
- backlog limitado e drenado de forma ritmada;
- queda deliberada de conexão como gate de toda execução no Chrome.

Os testes de contrato cobrem agora cadência de telemetria, retomada com sequência
não nula, overflow explícito e drenagem por watermark.

## PDCA 4 — campanha perceptiva repetida

Dez execuções completas no Chrome do Windows passaram todos os 27 gates:

| Métrica | p50 | p95 |
| --- | ---: | ---: |
| Final textual injetada → `HTMLAudioElement.onplaying` | 123 ms | 187 ms |
| Início de PCM de interrupção → último quantum renderizado | 74,75 ms | 83,21 ms |
| Comando de parada | 7 ms | 18 ms |
| Fim de backchannel → retomada | 272,6 ms | 282,1 ms |
| Fim de correção → nova voz | 1.687 ms | 1.746 ms |
| WER da correção | 0,125 | 0,125 |

Cada repetição exigiu captura física, interrupção fechada, correção, delegação,
cancelamento, ausência de auto-interrupção e recuperação após queda forçada do
WebSocket.

Os 187 ms são uma métrica operacional do harness textual; não incluem
microfone, VAD, ASR nem cauda física da sala.

## PDCA 5 — soak final de 10 minutos

Em 600,082 s de captura física:

- 30.001 frames durante o probe e cobertura de relógio 100,001%;
- zero falsa ativação, gap, drop, erro de protocolo ou erro de processamento;
- fila do servidor: profundidade máxima 2/16, delay p99 1,508 ms;
- Silero controle: 18.750 janelas, inferência p99 1,748 ms;
- Silero shadow: fila máxima 1, inferência p99 1,247 ms;
- barge-in PCM→último quantum: 77,69 ms;
- retomada após backchannel: 288,5 ms;
- recuperação de transporte aprovada depois do soak.

O comparador final passou 11/11 critérios e registrou
`engineering-promote`.

## Campanha de áudio e limite da decisão

No pipeline PCM→VAD→endpoint→ASR:

- 15/15 casos de fala foram detectados e finalizados;
- 4/4 controles permaneceram sem ativação;
- coorte sintética: WER 0,0667;
- coorte humana CORAA: WER 0,2667;
- transporte: zero frame perdido, rejeitado ou não drenado.

O gate de qualidade final permanece em `hold`: uma de 16 frases críticas
sintéticas não foi preservada e um trecho CORAA chegou a WER 0,8571. Além
disso, o probe físico confirma captura e renderer, mas não confirma volume do
alto-falante, cauda da sala ou conforto humano.

## Artefatos finais

Os caminhos abaixo são execuções históricas transitórias locais. A decisão e
os limites permanecem congelados neste documento; esses arquivos não são
pré-requisito de um clone limpo.

- torneio offline: `eval/reports/vad-candidate-ptbr-latest.json`;
- baseline longa: `eval/reports/browser-shadow-10min.json`;
- candidato longo:
  `eval/reports/browser-silero-control-085x1-10min-final.json`;
- campanha Chrome 10×:
  `eval/reports/browser-silero-085x1-campaign-10x-final.json`;
- campanha de áudio:
  `eval/reports/live-audio-campaign-silero-085x1-final.json`;
- decisão:
  `eval/reports/vad-control-comparison-final.json`.

## Próxima pergunta

O sistema preserva a mesma vantagem com múltiplas vozes brasileiras, ruído,
double-talk físico e cauda real de alto-falante? Até essa evidência existir, a
camada de engenharia está promovida e a prontidão percebida pelo usuário
permanece explicitamente em `hold`.
