# EXP-0002 — baseline autônoma com fala humana

Status: `CONCLUÍDO`

## Decisão

Identificar o gargalo atual da vertical e verificar se a evolução diária pode
ser medida sem chamadas pagas nem gravação manual.

## Hipótese

Uma campanha composta por corpus sintético, fala humana pública e Chrome real
consegue distinguir falhas do ASR de falhas da orquestração conversacional.

## Configuração

- hardware: AMD Ryzen 5 7430U, 4 núcleos/8 threads, 7,8 GiB RAM;
- GPU: indisponível nesta sessão;
- ASR: faster-whisper `base` e `small`, CPU INT8, quatro threads;
- fala sintética: Microsoft Maria PT-BR, velocidades -2, 1 e 3;
- fala humana: 12 trechos determinísticos do teste CORAA ASR v1.1;
- interação: Chrome do Windows, backend WSL, cérebro local;
- API paga: desativada.

## Resultado

| Candidato/camada | Qualidade | Tempo |
| --- | --- | --- |
| `base`, sintético | WER 9,43% | RTF p50 0,28 |
| `base`, humano | WER 49,30% | RTF p50 0,55 |
| `small`, humano | WER 36,62% | RTF p50 1,25 |
| Chrome local | todos os gates | primeiro áudio 715 ms; STOP 1 ms |

Os tempos variam com carga e clipes muito curtos; a campanha preserva p50, p95
e cada caso para evitar decisões com uma única média.

## Conclusão

A hipótese foi confirmada. A camada navegador–brain–TTS–cancelamento passou,
enquanto fala humana espontânea expôs o ASR como gargalo dominante. O `small`
melhorou a qualidade, mas foi retido pelo gate de latência.

## Próxima hipótese

Usar `base` para parcial de baixa latência e `small` como correção assíncrona
antes de delegações ou efeitos externos. O experimento precisa primeiro ligar
captura PCM e ASR incremental à aplicação.
