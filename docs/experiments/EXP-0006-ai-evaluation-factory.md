# Experimento EXP-0006 — fábrica v0.2 e vertical de correções

Data: 31/07/2026

## Decisão que este experimento desbloqueia

Decidir se a fábrica v0.2 é confiável para escolher o próximo gargalo do
runtime sem depender de API paga ou de avaliação humana precoce.

## Hipótese

Se IA variar apenas a superfície linguística sobre blueprints confiáveis, e
oráculos determinísticos forem auditados por mutação, então uma campanha local
texto/PCM encontrará falhas reais de correção sem permitir que o gerador defina
o próprio acerto.

## Baseline

- build: `f9be30987613d5f11ce42a34136a63cc922e2cfaabe506068bca37af8b9cda8e`;
- pack: `corrections-ptbr-v0.2`, SHA-256
  `788bd57e1b6abb111cc7be0baa95482d3d4fea7388224b5282d1a95bd9a1398d`;
- runtime: Silero v6.2, Whisper `tiny` parcial, Parakeet TDT 0.6B v3 final,
  cérebro local determinístico e Microsoft Maria TTS;
- hardware: máquina local do laboratório, WSL + Chrome do Windows;
- custo externo permitido: zero.

## Mudança isolada

Foi adicionada uma fábrica reproduzível com:

- 12 blueprints confiáveis e 24 superfícies linguísticas;
- fatores de slot, marcador, timing e risco combinados por cobertura pairwise;
- compilação para traces, percepção, WebSocket e Chrome;
- auditoria adversarial dos oráculos;
- TTS cacheado e cenas seeded de fala baixa/ruído;
- replay no WebSocket e Chrome com texto, PCM limpo e PCM a 10 dB;
- hashes de build, manifest, áudio executado, evaluator e runtime;
- agregado que recalcula gates a partir dos resultados brutos.

O provider permaneceu local e nenhum LLM externo participou das regressões.

## Métrica principal

- integridade da toolchain: 100% dos artefatos vinculados e 100% dos mutantes
  de oráculo detectados;
- guardrail: nenhum valor crítico incerto pode ser confirmado ou executado
  silenciosamente;
- métrica de produto intermediária: conclusão semântica e saída segura no
  caminho Chrome PCM.

## Guardrails

- IDs completos e únicos em cada campanha;
- ordem causal, rollback, revisão e commit únicos;
- confirmação textual e audível do valor atual;
- nenhuma fala principal antes do fim do usuário;
- nenhuma confirmação obsoleta antes da correta;
- zero perda, frame rejeitado ou erro de protocolo;
- interrupção no renderer ≤250 ms;
- zero chamada paga e zero token externo.

## Amostra

- fábrica: 24 casos, 12 famílias;
- áudio WebSocket: 12 limpos e 12 acústicos, mais controles silencioso/ruído;
- Chrome: 6 casos por modo — texto, PCM limpo e PCM com ruído branco a 10 dB;
- voz: Microsoft Maria;
- repetições: uma campanha canônica; insuficiente para p95 promocional.

## Resultado

### Integridade e cobertura

- 223/223 testes na verificação local separada; esse total não é um input
  hasheado do agregado;
- 288/288 corrupções de observação rejeitadas pelos oráculos — 12 operadores
  aplicados aos 24 casos; isso mede sensibilidade dos oráculos, não mutação do
  código de produção;
- 85,7% de cobertura pairwise;
- 12 WAVs únicos e 12 cenas acústicas sem clipping;
- todas as provas de manifest, packs, áudio, execução, toolchain, evaluator,
  runtime e custo passaram.

### Caminho em tempo real

- WebSocket limpo: 12/12 operáveis, WER 6,67%, recall crítico 97,22%;
- WebSocket acústico: 12/12 operáveis, WER 7,14%, recall crítico 91,67%;
- Chrome textual: 6/6 correções semânticas;
- Chrome PCM limpo: 5/6 estritos, 6/6 seguros;
- no sexto caso, a final divergiu entre R$ 150 e R$ 1.150; o sistema fez uma
  pergunta curta e registrou zero commit;
- Chrome PCM a 10 dB: 3/6 estritos, 5/6 seguros;
- parada no renderer: cinco casos medidos, máximo de 50 ms;
- responsividade: seis observações; 1.517 ms e 1.339 ms excederam 1,2 s;
- custo: zero chamadas pagas, zero tokens.

Falhas críticas observadas incluem `Luísa`, `domingo`, `14 horas` e a forma
ruidosa de `1.150 reais`. Sob ruído, o caso `domingo→mundo` não preservou o
valor atual e por isso bloqueia prontidão.

## Limites

- uma única voz e ruído branco; sem eco, reverberação ou double-talk;
- pausa e cross-turn ainda não possuem driver causal em todos os casos;
- efeitos externos não têm ledger/test-double;
- o pack foi exposto durante o PDCA e deixou de ser holdout independente;
- não há amostra suficiente para p95 promocional;
- microfone/sala e preferência humana não foram medidos nesta campanha.

## Artefatos

- build: `eval/generated/factory/builds/f9be30987613d5f1/`;
- agregado: `eval/reports/eval-factory-campaign-v0.2.json`;
- execuções intermediárias abaixo são transitórias locais e não integram o
  bundle canônico:
- WebSocket limpo: `eval/reports/eval-factory-live-audio-current.json`;
- WebSocket acústico: `eval/reports/eval-factory-acoustic-live-latest.json`;
- Chrome texto: `eval/reports/eval-factory-browser-latest.json`;
- Chrome PCM: `eval/reports/eval-factory-browser-pcm-latest.json`;
- Chrome PCM/ruído: `eval/reports/eval-factory-browser-pcm-noise-10db-latest.json`.

## Decisão

`PROMOVER` a toolchain da fábrica como instrumento de decisão.

`HOLD` para runtime de engenharia e prontidão do usuário. A campanha cumpriu a
hipótese porque produziu evidência íntegra, encontrou falhas no caminho PCM e
protegeu o caso numérico ambíguo; ela não autoriza alegar robustez sob ruído.

## Próxima pergunta

A diferença observada no mesmo slot crítico entre WebSocket e Chrome nasce do
snapshot prefinal condicionado ao texto parcial, de framing/merge ou do decoder?
O [EXP-0007](EXP-0007-deterministic-acoustic-prefinal.md) congela um A/B de
prefinal acústica com 100 observações e hashes do PCM antes de testar outro ASR.
