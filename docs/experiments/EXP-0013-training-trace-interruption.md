# EXP-0013 — trace causal e ledger da interrupção

## Pergunta

Os caminhos de hold, pausa, retomada e confirmação já promovidos conseguem
produzir exemplos causais reproduzíveis para aprendizado, sem duplicar a
autoridade do runtime nem confundir comando enviado com efeito percebido?

## Hipótese

Uma primeira fatia de `training-trace-v1` pode ser materializada inteiramente
no navegador sobre o `OutputInterruptionLifecycle`. Cada transição deve ligar
evento, contexto disponível, decisão, rótulo e efeito; o efeito conserva seu
lifecycle até `completed` ou `cancelled`. O mesmo reducer deve reproduzir a
decisão e uma projeção para o trace v0 só pode emitir STOP após silêncio do
renderer e retomada após `onplaying`.

## Mudança isolada

- `TrainingTraceRecorder` com schema e versão da fatia explícitos;
- IDs locais estáveis para evento, contexto, decisão, efeito e rótulo;
- vínculo da sessão ao fingerprint do runtime;
- validação fail-closed de referências, monotonicidade, contexto futuro,
  autoridade, proveniência e lifecycle de efeitos;
- shadow estruturalmente incapaz de produzir efeitos;
- ledger browser para `accepted`, `dispatched`, `player-received`, `audible`,
  `renderer-silent`, `cancelled` e `completed`;
- decisão posterior registrada em `reconciledByDecisionId` quando supera um
  efeito ainda em voo;
- projeção testada para o vocabulário do trace de avaliação v0;
- bundles expostos apenas na automação local e incorporados ao relatório
  canônico; WAVs e relatórios brutos continuam fora do Git.

## Achado durante o ciclo

No backchannel determinístico, a retomada pode ocorrer antes de o renderer
produzir uma janela de silêncio. A primeira versão deixava `PAUSE_OUTPUT`
aberto. A correção não inventou um STOP: encerrou a pausa como `cancelled`,
reconciliada pela decisão `RESUME_OUTPUT`.

O primeiro ensaio formal também capturava o cenário em que um parcial curto
vira correção apenas 8 ms após a segunda pausa. O evaluator recusou a promoção
porque o efeito ainda estava aberto. O coletor passou a aguardar efeitos
terminais; o critério de silêncio do renderer não foi relaxado.

## Evidência no Chrome

A execução canônica observou seis conversas completas:

1. áudio em preparação segurado e liberado sem player;
2. backchannel determinístico retomado antes de silêncio mensurável;
3. parcial curta retomada e final posterior reabrindo a interrupção;
4. backchannel PCM real com STOP e retomada audível;
5. barge-in PCM confirmado, sem retomada;
6. correção longa mantida em hold até a final.

Resultados:

- **12/12 gates formais**;
- **28/28 decisões** reproduzidas pelo reducer a partir do contexto gravado;
- **22/22 efeitos** encerrados e referencialmente válidos;
- oito tipos de efeito e sete estágios operacionais cobertos;
- resposta iniciada em 185 ms;
- comando local de pausa em 0 ms;
- último quantum não silencioso em 38 ms;
- onset PCM→último quantum em 169,82 ms, abaixo do teto de 350 ms;
- retomada PCM 315,5 ms após o fim acústico, abaixo de 500 ms;
- todos os gates da campanha Chrome corrente verdes, inclusive o probe físico
  de 30,074 s;
- **314/314 testes**;
- zero erro de browser/pipeline e zero chamada paga.

O relatório canônico é
[`exp-0013-training-trace-interruption-v1.json`](../../eval/reports/exp-0013-training-trace-interruption-v1.json).
Ele contém os seis bundles selecionados, replay, projeções, gates e
fingerprints. O relatório bruto da campanha e os WAVs permanecem artefatos
locais ignorados.

## Decisão

`promote-training-trace-interruption-slice`.

Promovido:

- a primeira fatia causal de `training-trace-v1` no caminho real do Chrome;
- ledger local distinguindo decisão, despacho, player e percepção;
- replay exato da decisão a partir de contexto temporalmente válido;
- projeção para o trace v0 baseada somente em efeito percebido;
- shadow sem autoridade e execução inteiramente local.

Não promovido:

- o contrato `training-trace-v1` completo;
- streams acústicos persistidos, hasheados e ligados a posições de amostra;
- mapeamento de clocks entre navegador, servidor e áudio;
- efeitos externos, ferramenta idempotente ou ledger global;
- M4a, checkpoint, ganho de qualidade ou generalização;
- especificidade física universal, apesar do probe corrente verde.

## Próximo experimento

Estender o trace somente pelo necessário para o primeiro M4a acústico:
vincular as fixtures PCM existentes por hash e posição de amostra, registrar as
decisões incrementais do `LocalAudioReflex` e criar split por família não
observada. Um candidato pequeno prediz em shadow
`WAIT_FOR_EVIDENCE / PAUSE_OUTPUT / CONTINUE_OUTPUT`; a política determinística
continua com toda a autoridade e nenhum efeito crítico migra para o modelo.
