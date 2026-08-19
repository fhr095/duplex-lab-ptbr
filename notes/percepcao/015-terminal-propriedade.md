# 015 — Retorno TERMINAL do marco de propriedade da fala (2026-08-19)

Fecha o marco aberto na 011 com a decisão entre: sinais gratuitos
bastam | presença do produto resolve | embedding residual | reformular.

## 1. Células causais finais (trajetória de crença/ação por enunciado)

Duas regras comparadas: lift ACUMULADO eterno × JANELA móvel (6):
- **N (pessoa nova que começa com 2 interrupções longas)**: suprimida
  do e2 ao e6 nas DUAS regras; sem janela, suprimida PARA SEMPRE; com
  janela, reabilita no e7. → O "zero legítimos rejeitados" da 014 era
  dependente de ordem, como o mandato suspeitou: começo hostil gera
  janela real de falsa rejeição que SÓ sinal contemporâneo desfaz.
- **M (mesma pessoa, mesmo track, alternando engine ↔ acompanhante)**:
  suprimido a partir do e4 e — crítico — **continua suprimido nos
  e7-e9 já de volta à engine** (a janela ainda carrega os enunciados ao
  acompanhante). → Prova terminal de fonte ≠ participação ≠
  endereçamento: estatística por fonte serve como PRIOR lento;
  ENDEREÇAMENTO é decisão POR ENUNCIADO.
- **Pool de não-participantes**: com rádio dentro (lift ~0,9), pessoa
  nova herdaria a reputação. Veredicto de desenho: pool NUNCA rejeita
  indivíduo — só rebaixa autoridade de efeito e marca cena de vozes.

## 2. Auditoria objetiva do Habitat (o que EXISTE, não o possível)

Feita sobre o código real (frontend/svelte/src/lib/faceapi):
- **Existe pronto**: MediaPipe FaceLandmarker (WASM, ~5,5 Hz com pessoa
  / 2 Hz ocioso), 468 landmarks 2D/3D por face, pose yaw/pitch/roll
  (ORIENTAÇÃO), distância estimada (PROXIMIDADE), eventos
  presence-detected/lost com debounce e histerese; NearTracker com
  trackId monotônico, mutual-best IoU e graça de oclusão — porém
  MONITOR-ONLY atrás de flag (nenhum evento publica trackId);
  telemetria de custo rica.
- **Pequeno de derivar (produto)**: (a) ATIVIDADE LABIAL — os
  landmarks 13/14 (lábios internos) JÁ são extraídos por frame e o
  normalizador (interOcular) já é computado na mesma função; falta
  publicar `hypot(lm14−lm13)/interOcular` em vez de descartar; (b)
  promover trackId aos payloads (flag PER_TRACK_IDENTITY_EXPERIMENT já
  existe); (c) expor score e estado explícito de câmera-negada (hoje
  câmera negada é INDISTINGUÍVEL de "ninguém presente" — viola o sinal
  "sensor indisponível" do contrato).
- **NÃO existe (e é estrutural)**: SINCRONIZAÇÃO AUDIOVISUAL FINA —
  não há timestamp de CAPTURA de frame (só de processamento, jitter
  180-500 ms de ciclo + até ~1 s de debounce no canal HTTP), relógio
  monotônico nunca é serializado, blendshapes desligados, e não há
  canal local de baixa latência para uma engine co-residente (só HTTP
  debounced → Node-RED).

## 3. DECISÃO TERMINAL

**Câmera é o caminho — na forma GROSSA — e o speaker embedding é
CORTADO do caminho principal** (adormecido com gatilho, abaixo).

Arquitetura decidida (vetor, sem escore único):
1. **Endereçamento por ENUNCIADO** = presença + proximidade/orientação
   + ATIVIDADE LABIAL GROSSA na janela do enunciado (a 5,5 Hz, um
   enunciado de 2-5 s tem 11-27 amostras de boca — suficiente para
   "havia alguém visível articulando enquanto este áudio entrou";
   rádio/anúncio falha isso por construção). Sincronização FINA é
   desnecessária para o residual e cara de construir — descartada.
2. **Prior por fonte** = indiferença acumulada (lift) com janela móvel,
   agrupada por trackId quando presente, pool degradado sem câmera.
3. **Pool** = só cena de vozes + rebaixamento de autoridade.
4. **Autoridade de efeito** = barreira independente já implementada
   (obs@c86813f): leitura-publica/leitura-sensivel/escrita
   (desconhecida=escrita, fail-closed), escrita exige lease; todo turno
   carrega `propriedade` no trace; delegações emitem
   ferramenta.autorizacao. Mata o fantasma-que-delega (013).
5. **Incerteza muda a FALA** (confirma antes de agir), nunca bloqueia.

**Condição da decisão** (honestidade): "câmera suficiente" está
condicionada às 3 derivações pequenas no PRODUTO (boca, trackId,
sensor-indisponível) + um canal local de dicas efêmeras
(presenca/track/boca/proximidade/orientação/confiança/indisponível —
nada de imagem/identidade). O protocolo de medição está pronto: os
cenários contrafactuais (012-014) recebem os sinais reais e medem
fantasmas-até-supressão, legítimos rejeitados, tempo de admissão e
recuperação — ANTES de qualquer promoção (régua de sempre).

**Embedding de voz — adormecido com gatilho explícito**: reabre
somente se a medição real dos sinais de câmera falhar nos cenários
contrafactuais, OU para instalações SEM câmera (variante de produto),
OU se o agrupamento por trackId se mostrar insuficiente entre alheias
fora de quadro. Sempre efêmero, nunca chave única (colisão mesma-voz,
014).

## 4. Erros prioritários (por cenário)

1. Fantasma-que-delega (013) — morto por construção pela barreira de
   autoridade quando houver ferramenta mutável; até lá, leitura pública
   apenas.
2. Começo hostil (N) — falsa rejeição de 4-5 enunciados; mitigação:
   endereçamento contemporâneo (câmera) sobrepõe prior temporal.
3. Acompanhante (M) — falsa supressão pós-retorno; mitigação: decisão
   por enunciado, prior nunca decide sozinho.
4. Rajada em regime quieto — residual temporal; mitigação: boca/
   presença; sem câmera, aceita-se confirmação barata.
5. Câmera negada invisível (auditoria) — produto precisa expor
   sensor-indisponível; a engine trata indisponível ≠ ausente (mesma
   regra do triestado da cena).

## 5. Custo (pilha completa, medido/estimado)

Engine hoje: ~2 GB RSS com tudo (cena +113 MB; alvo 16 GB folgado).
Sinais de câmera: já pagos pelo produto (pipeline roda de qualquer
forma); a derivação labial é aritmética sobre landmarks existentes;
canal local = HTTP/WS local leve. Embedding cortado = 0.

## 6. Depois deste fechamento

SESSÃO HUMANA HOLÍSTICA (pendência do usuário, registrada): verificar
que o ganho é perceptível na conversa — inclui T4 da música, e agora
também a percepção geral das políticas vivas. A frente de propriedade
só reabre pela régua: integração dos sinais reais + medição no
protocolo acima.
