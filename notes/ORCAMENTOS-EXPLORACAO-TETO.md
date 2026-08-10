# Orçamentos delimitados — exploração de teto (aguardam autorização)

Cada item tem a pergunta EXATA que o gasto responde e o teto de custo.
Nenhum foi executado.

## B1 — Referência nativa aberta como microscópio (RunPod)
- **Custo**: US$ 5–8 (A40/A6000 spot, 2–3h, com margem para 1 retry de
  ambiente; kill switch nos moldes do runner do EXP-0025-R).
- **Pergunta exata**: o comportamento full-duplex do PersonaPlex-7B
  (interrupção 100%, resposta ~205ms, ouvir-enquanto-fala) sobrevive com
  ÁUDIO PT-BR de entrada, mesmo respondendo em inglês? Quanto degrada vs EN
  no nosso protocolo de barge-in/retomada?
- **Decisão que muda**: se sobrevive → a rota "adaptar Moshi/PersonaPlex
  para PT-BR" (receita provada em ja/hi) tem base viva e vira o programa de
  teto principal; se não → adaptação nativa exige treino de idioma desde o
  codec, custo outra ordem, e a cascata+camada própria fica sem rival
  interno de médio prazo.

## B2 — Régua comercial nativa (gpt-realtime-mini, mesma chave)
- **Custo**: US$ 2–5 (15–20 min de sessão de áudio; confirmar pricing no
  dashboard antes de iniciar).
- **Pergunta exata**: qual é o padrão-ouro comercial de fim-de-fala→voz,
  barge-in e backchannel EM PT-BR, medido pelo NOSSO protocolo (mesmas
  falas de teste, mesmas métricas)? 
- **Decisão que muda**: fixa o alvo quantitativo das famílias (hoje usamos
  ~0,5–0,8s de literatura, não medido por nós em PT-BR).

## B3 — Programas de dados proprietários (custo ~zero, destravam finetunes)
Três corpora DISTINTOS (não misturar):
1. **Arbitragem textual**: turnos PT-BR rotulados
   LOCAL_FINAL/BRIDGE/CLARIFY/PASS com contexto (alvo inicial: 500–1000;
   fontes: uso real do demo + templates + CORAA). Destrava: ensemble
   discriminativo confiável (já provado em 0,04ms) e finetune do 0.6B
   (janela provada em 482ms).
2. **Turn-taking acústico diádico**: áudio 2 canais PT-BR com rótulos de
   shift/hold/backchannel (alvo inicial: 2–4h). Destrava: detector próprio
   (quebra o piso de 520ms do endpoint) e finetune do Smart Turn.
3. **Adaptação duplex nativa**: diálogo espontâneo estéreo em escala
   (alvo: 10k+ horas na receita J-Moshi/Human-1) — só faz sentido após B1
   confirmar base viva; é o programa caro.
