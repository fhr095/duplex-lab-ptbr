# 016 — Reclassificação do 015 + integridade da autoridade (2026-08-19)

Auditoria do usuário sobre o fechamento 015, aceita integralmente.

## 1. Reclassificação da conclusão

A conclusão correta do marco NÃO é "câmera empiricamente vencedora" —
é **"câmera promovida ao próximo probe de produto"**: as 3 derivações
(boca, trackId, sensor-indisponível), o canal local e a medição com
sinais REAIS nos cenários congelados (012-014) continuam pendentes.
O que a pesquisa estabeleceu: sinais temporais grátis carregam a
supressão-por-fonte mas não o turno-1 nem o endereçamento por
enunciado; embedding perdeu o papel de solução principal; câmera é o
caminho de menor esforço A CONFIRMAR. Plano diretor atualizado com esta
redação.

## 2. Integridade da barreira de autoridade (furos reais, corrigidos)

A v1 tinha 4 furos apontados pela auditoria e confirmados no código:
(a) evidência AUSENTE permitia leitura sensível (fail-open por
optional-chaining); (b) "presumido" valia como evidência — rádio/
anúncios sob cena limpa ficariam "endereçados"; (c) qualquer truthy
era lease; (d) o gate vivia no call-site do Open-Meteo, não num broker.
Correção (obs@08fb72f, 10 testes): evidência ausente/presumida ⇒
INCERTA; leitura-sensivel exige endereçamento "confirmado" (que só
instrumentação real produzirá — hoje sempre bloqueada); lease
estruturado {origem, escopo[], expiraEmMs, usosRestantes} com validação
estrita e consumo one-shot imutável; BROKER ÚNICO
(executarFerramentaComAutoridade) como único caminho de execução, com
teste provando que bloqueio não executa.

**Resposta à pergunta do mandato**: antes desta correção tínhamos "bom
contrato + testes preliminares", NÃO "zero ações não autorizadas por
construção". Depois dela, a construção vale para ferramentas sensíveis
e mutáveis; o REGISTRO honesto permanece: Open-Meteo é leitura pública
e permissiva — fala fantasma ainda pode dispará-lo (custo aceito e
documentado no código).

## 3. Atividade labial — especificação corrigida

Distância instantânea entre landmarks NÃO é atividade labial. O sinal
real observa: movimento ao longo da JANELA do enunciado, confiança da
detecção, pose (yaw extremo degrada), oclusão, múltiplos tracks
(célula: pessoa visível ARTICULANDO durante o áudio, com outras
pessoas paradas visíveis) e sensor-indisponível (≠ ausente). Vai como
requisito do probe de produto, não como suposição.

## 4. Sequência acordada

1. SESSÃO HUMANA da engine ATUAL (usuário) — avalia políticas e
   experiência vivas, INCLUINDO música; não avalia câmera (não
   participa da conversa ainda).
2. Adapter mínimo Habitat→engine (dicas efêmeras; nada de imagem/
   identidade) + as 3 derivações no produto.
3. Executar os cenários JÁ CONGELADOS com sinais reais.
4. Decisão final: promover câmera × reabrir embedding.
Proibições mantidas: sem reconhecimento facial na engine, sem
diarização geral, sem embedding antes da medição real.

## 5. Retorno seguinte (formato)

Separará explicitamente: diagnóstico humano da engine atual ·
integridade corrigida da autoridade (este registro) · resultado causal
dos sinais reais · decisão final.
