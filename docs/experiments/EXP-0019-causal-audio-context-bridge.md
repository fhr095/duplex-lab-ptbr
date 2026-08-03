# EXP-0019 — bridge causal de contexto em áudio

Status: **pré-registrado; instrumentação ainda não materializada; zero
autoridade**

Este experimento materializa como caminho crítico o bridge de áudio planejado
como `EXP-0018-R`. Ele não reabre o development textual e não treina outro
modelo.

## Decisão que precisa desbloquear

Descobrir se os três campos que deram ganho ao checkpoint textual do EXP-0018
— `targetText`, `recentInbound` e `assistantAudiblePrefixAtDecision` — podem ser
montados somente de eventos já ocorridos em uma timeline de áudio sobreposta,
com paridade Node/Chrome, latência útil e nenhum efeito no STOP autoritativo.

Se o teto com texto-oráculo causal falhar, ASR, diarização, backbone maior e
otimização de qualidade continuam fora. Se passar, autoriza apenas um novo
experimento que compare ASR incremental local contra esse teto.

## Hipótese

Com o mesmo checkpoint congelado no EXP-0018, o runtime consegue:

1. liberar cada texto somente após o fim amostral do áudio que o sustenta;
2. reconstruir exatamente a observação textual congelada;
3. reproduzir em Node e Chrome as features, probabilidades e decisões de
   `B0/B1` em até 300 ms após a última evidência necessária;
4. permanecer em shadow, sem alterar lifecycle, renderer ou efeitos.

Este é um teste de disponibilidade causal e integração. A assinatura semântica
já é conhecida e funciona como checksum; não é uma nova estimativa de
qualidade.

## Unidade e seleção mínima

A unidade independente continua sendo o bloco 2x2. Serão usados exatamente
dois blocos completos / quatro pares / oito cenas já observadas:

- `development-correction-version-label`: contém o único erro e a menor margem
  de `B1`, portanto preserva a borda conhecida;
- `development-short-meeting-shirt`: contém microturnos curtos e margens altas,
  portanto exercita o caminho rápido.

A seleção é deliberadamente adversarial e barata, não amostragem representativa.
Nenhum caso será trocado depois da materialização.

Assinatura congelada esperada:

- `B0`: 4/8;
- `B1`: 7/8, com 4/4 dirigidas e 3/4 fundos;
- três pares vencidos por `B1`, zero perdidos e um empate;
- o fundo `version-label / green-label` permanece errado.

Qualquer resultado “melhor” sem mudança pré-registrada do mecanismo é drift,
não ganho.

## Áudio mínimo

O pack terá doze streams WAV PCM16 mono de 16 kHz, gerados localmente com o
Supertonic já cacheado e sem rede:

- quatro targets, um por `targetSurfaceId`;
- quatro prefixos do assistente, um por `contextSurfaceId`;
- quatro inbounds anteriores, um por `contextSurfaceId`.

O target deve ser byte a byte idêntico nos dois descendentes de cada par. Uma
voz não-assistente única atende target e inbound; uma voz distinta atende o
assistente. Voz, duração, volume, caminho e hash não podem revelar rótulo.
Áudio bruto permanece local e ignorado pelo Git; plano, manifest, hashes,
sample counts e proveniência são commitados.

Cada stream do assistente contém o prefixo canônico seguido por uma cauda
falada neutra longa o bastante para manter `assistantSpeaking=true` até a
proposta. Prefixo e cauda são concatenados em PCM com fronteira amostral
explícita; somente o prefixo entra no snapshot.

## Schedule causal

Para cada cena:

1. o inbound toca por completo; seu texto-oráculo entra no ledger apenas em
   `inboundEndSample`;
2. após uma lacuna fixa, o prefixo do assistente toca e só entra no ledger em
   `assistantPrefixEndSample`;
3. a cauda da saída continua no mesmo stream;
4. o target começa 80 ms depois da fronteira do prefixo;
5. o texto-oráculo do target só é liberado em `targetEndSample`;
6. `B0-causal` e `B1-causal` produzem exatamente uma proposta em shadow.

Uma tentativa de avaliar antes de qualquer uma das três disponibilidades deve
retornar `DEFER_CAUSAL_EVIDENCE` sem executar o classificador. O scorer e o
manifest podem conhecer IDs/rótulos; o payload do adapter recebe somente
texto, disponibilidades amostrais, sample corrente e `assistantSpeaking=true`.

## Comparação

- `B0-causal`: target-only, mesmo modelo e limiar do braço `B0`;
- `B1-causal`: target + snapshot contextual, mesmo modelo e limiar de `B1`;
- trace textual do EXP-0018: somente checksum offline, nunca terceiro
  candidato nem fonte de decisão no navegador.

Duas execuções Chrome são permitidas porque medem determinismo de integração,
não abrem dados ocultos. Os traces são normalizados removendo apenas relógio de
parede e precisam permanecer idênticos.

## Gates

Todos são obrigatórios:

1. 8/8 cenas com inbound, prefixo, target, onset, snapshot e bundle causal
   completos;
2. zero texto/PCM futuro; probes imediatamente anteriores a cada fronteira
   deferem e não incrementam o contador de inferência;
3. target WAV e schedule idênticos dentro de cada par; payload sem `label`,
   família, IDs experimentais ou ação esperada;
4. assinatura `B0=4/8`, `B1=7/8`, três vitórias, zero derrotas e um empate,
   reproduzindo inclusive o erro conhecido;
5. features, thresholds, labels e probabilidades iguais entre trace textual,
   Node e Chrome nas 16 previsões, com erro relativo máximo `1e-12`;
6. exatamente uma proposta por braço/cena e duas execuções Chrome com trace
   normalizado idêntico;
7. p95 nearest-rank da última evidência textual até a proposta menor ou igual a
   300 ms; cálculo local p95 menor ou igual a 50 ms;
8. sequência do `OutputInterruptionLifecycle` idêntica com shadow ligado e
   desligado, parada até o renderer p95 menor ou igual a 250 ms e zero efeito
   despachado por `B0/B1`;
9. checkpoint/hash iguais aos do EXP-0018, `canProduceEffects=false`, zero
   novo treino, zero holdout, zero API paga e zero GPU.

Também serão registrados, sem gate de promoção, onset→proposta e o tempo
contrafactual de hold nos quatro fundos.

## Decisões

- `PASS_CAUSAL_AUDIO_BRIDGE_SHADOW`: todos os gates passam; autoriza somente
  pré-registrar a comparação de ASR incremental local contra o teto-oráculo.
- `CUT_CAUSAL_AUDIO_BRIDGE`: causalidade, paridade, disponibilidade, latência
  ou isolamento de efeitos falha; localizar o defeito no trace/adapter/runtime
  antes de adicionar reconhecimento ou modelo.
- `INVALIDATE_CAUSAL_AUDIO_INSTRUMENT`: WAV, hash, schedule, payload ou
  execução Chrome não satisfaz o contrato; não interpretar qualidade.

Nenhuma decisão concede autoridade ou altera o controlador determinístico.

## Alegação máxima

Um passe permite afirmar apenas que, nestas oito cenas sintéticas e com texto
oráculo liberado no fim de cada clip, o checkpoint textual foi reproduzido
causalmente no Chrome dentro do orçamento e sem efeitos. Não prova ASR,
diarização, áudio humano, naturalidade, benefício percebido, segurança de
produção ou generalização.

## Ordem de execução

1. commitar este pré-registro e a transição do índice;
2. materializar plano, adapter e testes sem gerar áudio;
3. auditar igualdade pareada, payload, causalidade e assinatura congelada;
4. congelar código, plano e configuração de TTS;
5. gerar os doze streams locais e commitar somente o manifest;
6. executar e commitar o replay Node;
7. executar exatamente duas campanhas Chrome no mesmo fingerprint;
8. emitir relatório canônico e decidir PASS, CUT ou INVALIDATE.
