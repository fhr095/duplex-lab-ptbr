# EXP-0025-R — fechamento da trilha local de microturnos

Status: **trilha local concluída em 03/08/2026 —
`KEEP_BASELINE_AND_CUT_MICROTURN_CHALLENGER`; `E=NOT_EVALUATED`; zero
autoridade, zero rerun e zero segundo candidato**

## Resultado executivo

O controlador local `L-article-inspired-thinking-state-v0.1` foi construído
somente com o pack de desenvolvimento, congelado antes de gerar o holdout e
executado uma vez em 24 pares/48 falas pt-BR seladas. Ele reduziu tomadas
prematuras de 9/24 para 4/24, corrigiu cinco falas sem introduzir nenhuma nova,
eliminou falhas em duas das oito sessões e não aumentou misses.

Mesmo assim, `L` não venceu. Seu p95 de decisão depois de finais verdadeiros
foi 1.200 ms, acima do gate perceptível de 800 ms. Os outros nove gates
passaram. Como seus resultados foram exatamente iguais aos de `A0@600`, não
existe resíduo atribuível a uma política semântica nova: nesta reprodução
mínima, toda a mudança observada veio da cadência de decisão.
A atribuição canônica é `CANDIDATE_EQUIVALENT_TO_A0_AT_600`.

Portanto, a decisão congelada é manter `A0-native`, cortar `L` e não abrir
`L2`, outro limiar ou ajuste depois do holdout.

## O que foi testado

- `D`: 16 pares/32 falas, oito sessões e quatro famílias; `A0-native` mostrou
  8/16 tomadas prematuras e confirmou headroom;
- `L`: máquina causal com ticks de 600 ms e estados `USER_TALKING`,
  `USER_THINKING` e `USER_FINISHED`; prefixos pt-BR abertos esperam o segundo
  tick e os demais tomam o piso no primeiro;
- `H`: 24 pares/48 falas, oito sessões, seis pares por família e a mesma
  distribuição de pausas `[480, 560, 600, 720, 900, 1140]` em cada uma;
- nenhuma superfície de texto de `D` foi repetida em `H`;
- o WAV documenta a receita e preserva PCM de prefixo idêntico dentro do par,
  mas não entra na política;
- o receipt foi persistido antes da única inferência e o checker posterior não
  repete inferência.

## Placar confirmatório

| Medida | `A0-native` | `L` | Gate de `L` |
| --- | ---: | ---: | --- |
| tomadas prematuras | 9/24 | 4/24 | 5 corrigidas, 0 introduzidas — passou |
| sessões com tomada prematura | 5/8 | 3/8 | 2 melhoradas, 0 regressões — passou |
| misses até +1.200 ms | 0/24 | 0/24 | passou |
| atraso p95 depois de final | 1.060 ms | 1.200 ms | **falhou: limite 800 ms** |
| atraso máximo | 1.060 ms | 1.200 ms | passou |
| falhas de protocolo | 0 | 0 | passou |

`A0@600` produziu exatamente o mesmo placar, trajetórias agregadas e
discordâncias de `L`. Ele continua sendo diagnóstico, não challenger.

## Cadeia auditável

- implementação e desenvolvimento de `L`:
  `79f2f21582952d2125289a6c5e734dd87aeed2a5`;
- freeze local commitado:
  `4c8439e2937f6b1ffe8bd0e2613933cf954f4784`;
- freeze canônico:
  `sha256:dab0852e5aade351b28fa4eb28bf570d20a2194f0d5de20be88edffdedd7fd7e`;
- holdout materializado:
  `3eea2e3bbce098a6c907509edba2a009ea778a14`;
- pack H:
  `sha256:a72b6d380595d9df4446d4f890a5b641bae1630e3cd64e6d059e467f05b3d1b1`;
- seal commitado: `ffa94fe127704d067237ef84a4f4aad21168fb5a`;
- seal canônico:
  `sha256:247c6d4e2eefe936b43757ece1bf8b4632f0c62c2e5e05771fb0d064e330c2e9`;
- abertura commitada:
  `e949ec88ed2e83dad266a12234f70d7a1cc8cd06`;
- abertura canônica:
  `sha256:615172303fa7fb35831b952297c103981192e99af2b1d9e7b816d074128ca3e7`;
- receipt:
  `sha256:2ef004aea9de4e1e4819c2c5276faff1a4618999cf7c2b26a6d1264e5325f0dd`;
- evidência one-shot:
  `0b3fda7bda09e46b3f212d34c5c9d4fe8895dae0`;
- relatório:
  `sha256:c35745cba0361222272dc07fa2ed9b12f934dbb06cafdf2d974a1e43275516ba`.

O relatório canônico é
`eval/reports/exp-0025-r-local-holdout-v0.1.json`. O comando
`npm run eval:exp:0025:r:holdout:report:check` valida hashes, receipt, opening e
pack sem executar novamente a política.

## Limites da alegação

Este é um teste causal de controle de piso sobre traces-oráculo sintéticos. Ele
não mede ASR, ruído real, prosódia, TTS percebido, double-talk, áudio
full-duplex end-to-end ou preferência humana. Os WAVs são proveniência, não
entrada da política. A conclusão não é que microturnos nunca funcionam; é que
esta reprodução local de 600 ms não comprou segurança sem atraso perceptível
demais no nosso desenho congelado.

## Estado de `E` e próxima decisão

O checkpoint oficial DuplexCascade não foi baixado nem executado. Nenhuma API,
GPU ou gasto externo foi usado; `E=NOT_EVALUATED_NO_AUTHORIZATION`.

A única decisão ainda aberta nesta trilha é autorizar ou recusar `E` dentro do
budget já congelado: no máximo 40 GiB de download, 2 GPU-horas e US$ 12, com
quatro sentinelas inglesas antes do pack pt-BR. Mesmo uma vitória de `E` apenas
registraria `EXTERNAL_ADVANTAGE_NOT_REPRODUCED`; não promoveria runtime nem
reabriria `L`. Sem essa autorização, o EXP-0025-R deve ser fechado e a carteira
volta a escolher o maior gargalo percebido.
