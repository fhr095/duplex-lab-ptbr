# EXP-0026 — emenda terminal de prontidão operacional

Status: **pré-registrada prospectivamente; zero sessão externa observada;
qualificação física ainda não aberta**

Esta emenda fecha quatro riscos operacionais antes do freeze de roster e
estação. Ela não cria um novo experimento científico, não produz estimativa,
não entra em `n`, não altera cenas, cérebro, categorias, regra de dominância,
DuplexCascade ou qualquer autoridade de runtime.

## Decisão terminal

A única decisão é:

```text
READY_TO_FREEZE_EXP_0026
ou
NOT_READY_FOR_FREEZE_TERMINAL
```

O primeiro resultado exige todos os quatro gates desta emenda. Uma falha não
autoriza reparo, retry físico ou nova versão dentro desta linhagem. Qualquer
movimento posterior deverá ser deliberado sob novo ID operacional, com o
EXP-0026 ainda sem sessões externas.

Testes unitários, checagens de sintaxe, materialização determinística e
preflight sem estímulo físico podem ser repetidos: eles qualificam código e
ambiente, não consomem a abertura. A tentativa física é consumida no primeiro
destes eventos: reprodução do primeiro estímulo audível, primeira instrução
para fala no microfone ou primeiro frame capturado pelo gravador transitório da
qualificação.

## Timebox e orçamento

- implementação e testes: no máximo um dia útil;
- preflight técnico: sem limite científico, mas sem estímulo acústico;
- qualificação aberta: uma execução, no máximo 12 minutos;
- no máximo duas requisições ao cérebro econômico, incluídas no teto global de
  US$ 5 do EXP-0026;
- zero GPU, Pod, runner externo, modelo adicional ou output comercial;
- nenhuma gravação ou trace da qualificação entra em treino ou análise humana.

## Gate OQ-A — cadeia acústica existente e observável

O constructo é **existência e observabilidade da cadeia física na estação que
será congelada**. Não é qualidade de ASR, interrupção, voz, volume, latência ou
experiência.

PASS exige, na mesma execução e estação:

1. Chrome em contexto isolado e origem segura, permissão de microfone concedida
   e track real `live`, com settings e identificadores opacos registrados;
2. captura PCM contínua com frames recebidos, sem erro de protocolo, sequência
   ou sample gap observado;
3. uma fala fixa no microfone produz ao menos um evento de início de fala e um
   final ASR não vazio; conteúdo, CER e slots **não** são gate;
4. TTS congelado inicia e termina no renderer, é fisicamente audível por
   confirmação binária do operador e aparece com energia não silenciosa em uma
   captura acústica raw paralela; preferência de volume não é gate;
5. durante uma sobreposição fixa, a captura continua recebendo frames e o
   trace registra a decisão tomada (`confirm`, `dismiss`, `reopen` ou ausência
   explicitamente observada); parar rápido, classificar certo e transcrever
   certo não são gates;
6. um MediaRecorder da entrada produz blob decodificável, duração positiva,
   energia finita e SHA-256; o artefato bruto é apagado ao terminar;
7. cinco segundos do WAV S5 congelado, reproduzidos pelo dispositivo físico de
   ruído, produzem aumento de energia observável sobre o baseline silencioso e
   o hash do arquivo completo coincide com o pack; SNR, entendimento e conforto
   não são gates; e
8. o relatório contém somente gates técnicos, hashes, settings e o
   acknowledgement binário de audibilidade; não contém áudio, transcrição ou
   julgamento de qualidade.

O manifest privado da estação ainda será preenchido depois desta execução, mas
o freeze só o aceitará se ele citar o hash exato deste relatório e o
`acousticQualificationSha256`. Assim, trocar a estação depois do smoke não
reutiliza silenciosamente a qualificação.

Os thresholds são apenas de existência: track `live`, contagens maiores que
zero, strings finais não vazias, áudio decodificável, métricas finitas e
continuidade sem erro estrutural. Não há gate para acurácia semântica, tempo de
STOP, naturalidade, prosódia, preferência de volume, ausência de falso corte
ou sucesso da interrupção. Um comportamento ruim mas observável permanece para
as seis pessoas julgarem.

O operador usa uma confirmação binária, `TTS_AUDIBLE`, que atesta apenas que a
saída física emitiu fala; não avalia qualidade. A emissão de S5 é comprovada
pelo playback hasheado e pelo aumento de energia no microfone, sem um segundo
julgamento humano. Se a confirmação de TTS estiver ausente, OQ-A falha.

## Gate OQ-B — análise final determinística

Antes da abertura física serão congelados e hasheados:

- vocabulário fechado de `signatureId`, cada ID ligado a exatamente um estágio;
- convenção de mediana, cálculo de `P/Q/S/R`, força de reprodução, ordenação e
  desempate;
- máquina de decisão entre dominante elegível,
  `REPRODUCTION_OR_ATTRIBUTION_ONLY` e `NO_DOMINANT_BOTTLENECK`; e
- testes de fronteira para 3/6, 4/6, baixa severidade, ausência de reprodução,
  reprodução por duas pessoas, replay 2/2 e empate completo.

Depois da primeira sessão externa, nenhum `signatureId` pode ser adicionado,
renomeado ou remapeado. Um incidente sem encaixe claro recebe
`UNATTRIBUTED_NO_SUFFICIENT_EVIDENCE`, `R=false` e não cria vocabulário por
indução. Texto descritivo pode explicar o caso, mas nunca participa da igualdade
usada em `R`.

Para `R=true`, somente contam:

1. o mesmo `blockId + primaryStage + signatureId` em pelo menos dois
   participantes independentes; ou
2. um incidente com `REPRODUCED_2_OF_2`.

`NO_OBSERVED_VIOLATION`, `INSUFFICIENT_EVIDENCE`, `UNATTRIBUTED` e assinatura
fora do vocabulário nunca satisfazem `R`.

## Gate OQ-C — retirada e retenção pós-processo

Cada sessão recebe um código secreto de retirada mostrado ao participante e
persistido somente como hash. A retirada online e o comando offline usam o
mesmo núcleo idempotente.

Uma retirada apaga a raiz privada da sessão e qualquer áudio, trace, comentário,
formulário ou mapping derivado. Ela preserva apenas tombstone sem alias,
transcrição, categoria, severidade ou conteúdo, contendo hash do recibo,
sessionId, momento e fase de invalidação.

- antes de `prepare`: apaga a sessão e permite substituição válida;
- depois de `prepare` ou do selo técnico: invalida e apaga bundle, mapping,
  coding, selo e junção; após substituição, todo o fluxo recomeça;
- depois de `open`: além de apagar os artefatos, exige `coderId` novo que nunca
  teve acesso ao agregado aberto; sem novo codificador, o lote fecha
  `NOT_EVALUATED_WITHDRAWAL_AFTER_OPEN`;
- depois do closeout: o relatório vigente é removido, o closeout privado é
  apagado e um tombstone registra sua invalidação sem preservar o resultado.
  Havendo reserva e dados dentro da retenção, a análise inteira é refeita sob
  nova versão; caso contrário o resultado fecha
  `NOT_EVALUATED_WITHDRAWAL_AFTER_CLOSEOUT`.

O closeout privado inicia a janela de 30 dias. Ao vencê-la, um comando fail-
closed e idempotente apaga raízes de sessão e análise privadas, preservando
somente agregado desidentificado e tombstones de recibo. Depois do purge, uma
solicitação com recibo recebe confirmação de que nenhum dado bruto persiste;
agregados efetivamente anônimos não são reidentificados.

O drill de qualificação usa apenas fixtures temporárias e deverá demonstrar
retirada após `COMPLETE`, invalidação depois de `seal` e `open`, bloqueio de
purge precoce, purge no prazo e idempotência.

## Gate OQ-D — duas reservas sem substituição por resultado

O roster privado contém seis slots primários e exatamente duas reservas
pré-congeladas, todas com metadados próprios autorrelatados. Cada slot mantém
sua ordem do quadrado latino. O freeze registra apenas aliases opacos, hashes e
mappings permitidos.

Antes do freeze, o validador enumera toda combinação permitida de zero, uma ou
duas reservas em slots distintos. Cada composição alcançável precisa conter
seis pessoas únicas e satisfazer novamente idade, exposição de sotaque, uso de
voz e limite de círculo social. Metadados do titular nunca são copiados para a
reserva.

Uma reserva só pode ser ativada por:

- `PRE_SESSION_NO_SHOW`, antes de qualquer sessão do slot ser criada;
- `PRE_SESSION_SCHEDULING_CONFLICT`, antes de qualquer sessão do slot ser
  criada;
- `PRE_SESSION_TECHNICAL_INELIGIBILITY`, antes de qualquer sessão do slot ser
  criada; ou
- `CONSENT_WITHDRAWN`, em qualquer fase, depois de a retirada ter apagado os
  dados da pessoa.

Uma sessão iniciada não pode ser substituída por falha, nota, comentário,
resultado desfavorável, incompletude técnica ou preferência do pesquisador.
Sem retirada, ela permanece experiência observada. A reserva herda somente o
slot e a ordem; recebe processo, histórico, contador, alias e diretório novos.

Toda ativação grava motivo, slot, aliases, instante e hashes do roster/freeze.
Mais de duas ativações, reserva não congelada, reutilização de pessoa, mapping
não permitido ou diversidade inválida falham fechado. Se seis sessões válidas
não forem obtidas, permanece `NOT_EVALUATED_SAMPLE_INCOMPLETE`.

## Qualificação única e kill criteria

A execução produz `eval/reports/exp-0026-operational-readiness-v0.1.json` com
quatro gates booleanos e limitações. `READY_TO_FREEZE_EXP_0026` exige todos.

Kill imediato e terminal:

- tentativa física já consumida e qualquer requisito OQ-A não observado;
- analyzer aceita assinatura fora do vocabulário ou produz resultado não
  determinístico;
- drill preserva dado retirado, não invalida análise ou permite purge cedo;
- qualquer substituição alcançável viola diversidade ou ocorre por resultado;
- mudança em cena, cérebro, categoria, dominância ou frente externa; ou
- estouro de timebox, chamadas ou orçamento.

Não há retry automático, sweep, ajuste de threshold ou segundo smoke acústico.
Uma falha pode ser compreendida no relatório, mas não reparada nesta linhagem.
