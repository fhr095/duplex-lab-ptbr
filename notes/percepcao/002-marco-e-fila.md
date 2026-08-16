# Marco 1 da frente + fila de pendências (2026-08-16)

Resultado dos dois primeiros challengers e a fila ORDENADA do que vem
depois — cada item com o contexto de teste e o que deve resolver.
(Números completos: var/observador/testes/smart-turn/RELATORIO.md na
worktree principal; resumos na memória da sessão.)

## Veredictos do marco

- **Smart Turn v3.2 zero-shot: REPROVADO** — AUC 0,606 fim-real×
  hesitação nos 868 momentos reais (benchmark PT dele: 94,5% — a
  micro-pausa conversacional é outra tarefa); troca 1:1 entre cortes
  evitados e fins atrasados; 96ms p50 nesta CPU.
- **Pontuação do Kroko: REPROVADA com mecanismo** — o transducer pontua
  retrospectivamente; na borda da pausa o sinal não existe (3,7% dos
  fins com ./?/!). AUC 0,517.
- **Análise de dano**: zero atropelos no corpus vivo (o barge-in já
  protege o pior caso); o dano real do corte prematuro é FRAGMENTAÇÃO
  do pensamento em turnos + chamadas de cérebro desperdiçadas.
- **Decisão**: nenhum sensor promovido; atacar a fragmentação com
  POLÍTICA (commit revisável, abaixo) antes de qualquer treino.

## Passo 0 — política sem modelo: COMMIT REVISÁVEL

Hoje o commit (~300ms de silêncio, p50) é irreversível: retomada vira
segundo turno → pensamento respondido em pedaços. Mudança: commit
seguido de retomada em <2,5s COM resposta ainda não tocando (100% dos
casos vivos medidos) é ABSORVIDO — fragmento concatena com a
continuação num turno só (estende a concat de cap-finish, já validada,
para commits normais). Implementação na linha da roda (obs); validação
na bateria de replays (os 166 cortes de replay são o banco de teste).
É ele quem decide se o item 2 da fila é necessário.

## Fila de modelos/tratativas

1. **MaAI (VAP, dois canais)** — teste: leito de sobreposição refeito
   por SINAL dos canais usuário×assistente. Resolve: backchannel ×
   interrupção × querer-o-piso pela acústica dos dois lados (hoje:
   duração+texto).
2. **Smart Turn fine-tunado nos nossos momentos** (plano B) — teste:
   mesmos 868 recortes, held-out por sessão. Resolve: fim-real ×
   hesitação nas micro-pausas SEM latência extra. Só se o passo 0 não
   bastar. (Código de treino aberto, BSD, CPU.)
3. **Audio-tagging sherpa-onnx (AudioSet, 26MB, RTF 0,03)** — teste:
   janelas da a6c1 + sessões com música/ruído. Resolve: detectar cena
   adversa para a ação "perguntar em vez de embarcar" (classe "meu
   avô"). Antes dele, testar a métrica grátis graves/voz+flatness.
4. **SenseVoice** — teste: momentos de frustração/urgência do acervo,
   QUANDO a ação estiver desenhada. Resolve: paralinguística que muda
   ação (encurtar, perguntar, ceder). Licença FunASR comercial-ok.
5. **emotion2vec** — teste: mesmo leito do 4, comparação direta.
   Resolve: mesmo alvo; challenger alternativo.
6. **Qwen3-Omni-30B (microscópio; 1 rodada RunPod delimitada)** —
   teste: amostras do acervo + estímulos. Resolve: (a) teto da
   percepção áudio-nativa em PT; (b) PSEUDO-ANOTADOR para outras vozes
   e o acervo (fecha a lacuna só-uma-voz; habilita treinos). Apache.
7. **Step-Audio-R1 (microscópio; mesma rodada)** — teste: mesmas
   amostras, foco cena. Resolve: teto de raciocínio sobre cena
   acústica — base futura de endereçamento/múltiplas pessoas (lacuna
   SEM solução aberta no ecossistema). Apache.
8. **Política própria destilada** (tratativa final) — teste: cabeça
   pequena (prosódia + pseudo-rótulos do 6) julgada no leito. Resolve:
   sensor 100% local e barato se os prontos não bastarem.

## Cortados (não voltar sem fato novo)

Zero-shot ST e pontuação-Kroko (números acima); pyannote (canais já
separados); TEN (7B texto EN/ZH); LiveKit turn-detector (licença
proprietária); Vogent (EN-only); Easy-Turn (850M/263ms); CrisperWhisper
e audeering SER (NC); SAA (API-only); DualTurn (sem pesos — blueprint
de referência).
