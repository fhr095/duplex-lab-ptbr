# Sistema de avaliação

## Por que ele vem primeiro

Uma conversa de voz pode “parecer boa” por trinta segundos e ainda falhar em
interrupção, correção ou sessões longas. O laboratório separa impressão de
evidência e torna cada avanço comparável.

## Seis camadas

### 1. Software determinístico

Testa filas, cancelamento, epochs, ordenação, serialização, buffers e rollback.
Uma única falha bloqueia o merge.

### 2. Política em relógio virtual

Usa eventos conhecidos para testar decisões temporais em milissegundos. É a
base rápida e determinística do laboratório, mas não mede áudio. Está
implementada e continua como guardrail das camadas posteriores.

### 3. Cenários gerados e criticados por IA

Na v0.2, blueprints confiáveis fixam intenção, slots, risco e resultado; IA gera
apenas as superfícies linguísticas, que são congeladas com proveniência. O
assembler e os oráculos determinísticos recusam qualquer superfície que altere
o contrato. A mutação adversarial verifica se os oráculos realmente detectam
resposta obsoleta, commit duplicado, ordem não causal e fala prematura.

Geradores, críticos e adversários autônomos em ciclo ainda são horizonte. Essa
distinção evita chamar um pack de desenvolvimento de distribuição real.

### 4. Áudio sintético ambientalizado

O corte atual materializa uma voz Microsoft Maria, variação de velocidade,
ganho e ruído branco seeded. A matriz v0.2 contém 12 cenas de fala mais um
controle de ruído. Múltiplas vozes, respostas de sala, eco, reverberação e fala
simultânea continuam no roadmap; não são evidência atual.

### 5. Áudio humano público e aplicação real

A campanha histórica M1 usou fala humana espontânea do CORAA e enviou PCM em
tempo real pelo mesmo WebSocket da aplicação. Ela também mediu no Chrome do
Windows microfone físico, constraints AEC/NS/AGC, scheduler, TTS, player,
cancelamento e o último quantum do grafo Web Audio. A campanha v0.2 atual não
reexecutou a coorte humana nem o microfone; canais físicos separados e loopback
de alto-falante continuam pendentes.

### 6. Avaliação humana cega

Compara conversas de 5–10 minutos sem revelar qual sistema está ativo. Mede
naturalidade, conforto, inteligência percebida, previsibilidade, confiança e
vontade de continuar. Ela entra como gate de produto quando as classes de falha
estruturais já estiverem sob controle, não como depurador diário desta fase.

## Fábrica iterativa de avaliação

O pack deixa de crescer apenas por casos escritos manualmente. A v0.2 já fecha
o caminho blueprint→superfície→oráculo→áudio→replay→relatório. O ciclo-alvo,
ainda parcialmente implementado, é:

```text
especificar fenômeno
→ gerar famílias e mutações
→ produzir oráculos e áudio
→ executar em tempo real
→ pontuar e agrupar falhas
→ criticar cobertura
→ gerar contraexemplos direcionados
→ congelar regressões úteis
```

O schema completo deverá preservar:

- família, seed, prompt, gerador e versão;
- intenção e slots semânticos;
- timeline esperada de fala, silêncio e sobreposição;
- decisões obrigatórias e proibidas;
- efeitos externos esperados e estado final;
- voz, prosódia, transformações acústicas e SNR;
- relação metamórfica com o caso de origem.

Um exemplo metamórfico: trocar “terça” por “quinta”, a voz ou o ruído não pode
mudar a obrigação de fazer rollback quando a pessoa diz “não, sexta”.

### Proteções contra autoengano

- IA não define os slots ou gates dos próprios casos;
- efeitos, ordem, timing e cancelamento usam oráculos determinísticos;
- julgamentos abertos registram discordância, não apenas uma média;
- famílias de treino, desenvolvimento e teste ficam separadas;
- um holdout exposto vira desenvolvimento; promoção exige outro conjunto
  congelado e ainda não observado;
- artefatos são cacheados: regressões não dependem de API ou de resposta nova;
- fala pública humana funciona como âncora de realidade durante o
  desenvolvimento;
- somente humanos reais podem promover conforto e preferência.

## Pack de correções PT-BR v0.2

O pack `eval/factory/packs/corrections.pt-BR.v0.2.json` possui 24 casos em 12
famílias. O build canônico `f9be3098` registra 85,7% de cobertura pairwise e
detecta 288/288 mutações adversariais. Texto injetado no Chrome valida a espinha
semântica; PCM valida o caminho VAD→ASR→semântica→brain→TTS. Um resultado verde
no primeiro não substitui o segundo.

Estados de gate:

- `promote`: evidência suficiente no escopo declarado;
- `hold`: evidência executada, mas insuficiente ou com bloqueador observado;
- `fail`: uma invariável bloqueante foi violada;
- `not-run`: o escopo não foi medido.

O holdout v0.2 foi visto durante o PDCA e agora é desenvolvimento. Ele serve
para diagnóstico e regressão, não para alegar generalização.

## Pack inicial PT-BR v0.1

O arquivo `eval/scenarios/mvp.pt-BR.json` está congelado e contém:

- turno simples;
- hesitação com backchannel;
- interrupção durante a fala;
- duas autocorreções com rollback;
- delegação e cancelamento;
- retorno de resultado assíncrono;
- fala ambiente não direcionada.

Ele ainda é um pack de engenharia, não um benchmark estatisticamente
representativo.

## Definições métricas

| Métrica | Início | Fim | Observação |
| --- | --- | --- | --- |
| Latência de decisão | fim semântico do turno | `SPEAK` | isola a política |
| Primeiro áudio | fim semântico do turno | primeiro sample audível | métrica de produto |
| Parada de decisão | onset de interrupção | `STOP` | isola a política |
| Parada acústica | onset de interrupção | último sample audível do assistente | métrica de produto |
| Corte indevido | pausa interna válida | início audível indevido | reportar taxa e duração |
| Backchannel | janela apropriada | início do backchannel | precisa também de julgamento de adequação |
| Delegação | intenção estável | emissão de `DELEGATE` | argumentos avaliados separadamente |
| Cancelamento | intenção de cancelar | confirmação de cancelamento | efeito externo precisa de auditoria |
| Rollback | autocorreção detectada | estado anterior invalidado | nenhum efeito antigo pode escapar |

### Regra crítica

O fim de turno usado para medir latência não pode ser o instante em que o
sistema decidiu que o turno acabou; isso favoreceria detectores lentos. O ground
truth deve vir de anotação humana ou do roteiro do cenário.

## Como medir parada acústica

1. Gravar microfone e saída do assistente em canais separados.
2. Marcar o onset da fala do usuário no canal de entrada.
3. Encontrar o último frame do assistente acima do limiar de audibilidade no
   canal de saída.
4. Subtrair os timestamps monotônicos.
5. Reportar p50, p95, p99 e cauda máxima.

Hoje existem três medições explicitamente separadas:

1. comando JS de parada;
2. último quantum não silencioso no `AudioWorklet`, mapeado por
   `AudioContext.getOutputTimestamp()`;
3. cauda acústica do alto-falante/sala, ainda não medida.

Somente a terceira fecha a parada física completa. A segunda já impede que um
`cancel()` rápido esconda áudio ainda enfileirado no navegador.

## Estatística de promoção

- CI: cenários determinísticos, resultado exato.
- Desenvolvimento acústico: no mínimo 10 repetições por cenário crítico.
- Gate autônomo de promoção: no mínimo 30 repetições por cenário crítico, três
  famílias de voz e três condições acústicas; elas podem ser sintetizadas, mas
  não contam como evidência de preferência humana.
- Avaliação humana: ordem randomizada, identidade escondida e análise por
  participante; não tratar turnos da mesma pessoa como amostras independentes.
- Toda comparação registra hardware, região, rede, versão, seed e configuração.

## Dados

Cada item real deve preservar:

- consentimento e finalidade de uso;
- áudio separado por participante;
- locale, região e condições acústicas;
- timestamps de eventos;
- transcrição literal, inclusive disfluências;
- estado e ações;
- versão do pipeline que gerou anotações automáticas;
- split por pessoa, não por trecho.

O conjunto terá cinco níveis:

1. especificações e timelines geradas;
2. fala sintética multivoz;
3. sintético ambientalizado para ruído, eco e sobreposição;
4. fala humana pública como âncora de desenvolvimento;
5. conversas humanas próprias para validade externa e teste final.

Treino, desenvolvimento e teste não compartilham falantes, sessões nem roteiros
parafraseados.

## Gates

Há placares deliberadamente separados:

- **gate de política:** 100% das expectativas determinísticas;
- **gate de diversidade gerada:** cobertura por família, mutações,
  contrafactuais e invariantes;
- **gate de ASR:** WER, idioma e tempo real em fala sintética e humana;
- **gate WebSocket:** VAD, endpoint, parciais, finais, merges, perda e backlog;
- **gate do Chrome:** captura física longa, resposta, último quantum, falsa
  ativação, cancelamento e erros;
- **gate humano:** naturalidade, conforto, confiança e preferência — ainda
  pendente.

Um ganho só promove versão se melhorar a métrica principal sem ultrapassar
guardrails de semântica, falsos cortes, naturalidade, custo e estabilidade.

## Evidência histórica da M1

| Eixo | Resultado |
| --- | --- |
| Parakeet, 21 falas sintéticas | WER 4,40%; RTF p50 0,10 |
| Parakeet, 12 trechos CORAA | WER 38,03%; RTF p50 0,13 |
| Whisper `base`, mesmos trechos | WER 52,82%; RTF p50 0,46 |
| Chrome, campanha repetida | 10/10 execuções; 27/27 gates em cada |
| Chrome físico, resposta simples | primeiro áudio p95 187 ms |
| Chrome, barge-in closed-loop | onset PCM→último quantum p95 83,21 ms |
| Chrome, sessão longa | 600,082 s; 30.001 frames; zero falsa ativação, gap ou drop |
| Pipeline ao vivo | 15/15 falas finalizadas; 4/4 controles silenciosos |

Os gates comparativos promovem Parakeet e Silero em seus escopos de engenharia.
Esses números permanecem evidência da baseline M1 e não devem ser misturados ao
placar atual da fábrica.

## Evidência canônica da fábrica v0.2 — 31/07/2026

| Gate ou eixo | Resultado | Decisão |
| --- | --- | --- |
| Suíte determinística, verificação local separada | 223/223 testes | `promote`; não é input hasheado do agregado |
| Fábrica | 24 casos; 288/288 mutantes; pairwise 85,7% | `promote` |
| Fixtures | 12 WAVs únicos; 12 cenas + controle; hashes íntegros | `promote` |
| WebSocket limpo | 12/12 operáveis; WER 6,67%; recall crítico 97,22% | operabilidade `promote`; fidelidade `hold` |
| WebSocket acústico | 12/12 operáveis; WER 7,14%; recall crítico 91,67% | operabilidade `promote`; fidelidade `hold` |
| Chrome com texto | 6/6 correções semânticas | `promote` |
| Chrome com PCM limpo | 5/6 estritos; 6/6 seguros; um reparo sem commit | semântica `hold`; segurança `promote` |
| Chrome PCM + ruído 10 dB | 3/6 estritos; 5/6 seguros | `hold` |
| Parada no renderer | 5 casos; máximo 50 ms | `promote` no renderer, não na sala |
| Responsividade PCM | 6 casos; 1.517 e 1.339 ms acima de 1,2 s | `hold`, amostra < 20 |
| Efeitos externos | 0/6 com ledger | `hold` |
| Custo | zero chamadas pagas; zero tokens externos | guardrail preservado |

O agregado registra integridade verdadeira para manifest, packs, áudio,
execuções, toolchain, evaluator, runtime e telemetria. A toolchain da fábrica é
promovida; runtime e prontidão de usuário permanecem em `hold`. O relatório
canônico é `eval/reports/eval-factory-campaign-v0.2.json`.

A evidência acústica ainda usa uma única voz sintética e ruído branco. Não mede
microfone real, AEC, eco de alto-falante, reverberação, double-talk, cauda física
da sala ou preferência humana.

O ciclo completo e seus limites estão em
[AUTONOMOUS_LOOP.md](AUTONOMOUS_LOOP.md).
