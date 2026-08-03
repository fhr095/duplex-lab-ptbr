# Ledger de challengers

Status: **fila decisória canônica de pesquisa — 03/08/2026**.

Este ledger transforma resultados externos em hipóteses locais pequenas. Ele não
é um ranking de modelos nem altera a ordem executável do
[roadmap](../ROADMAP.md). Um resultado publicado pelo próprio projeto é tratado
como **evidência externa autoral**; somente uma comparação pareada no nosso
harness PT-BR conta como **evidência local** e pode mudar o runtime.

## Regras da fila

- `test`: um único challenger ativo, barato e falsificável, ligado a uma decisão
  atual.
- `watch`: mecanismo plausível para um gargalo futuro; acompanhar, sem executar.
- `defer`: dependência, custo ou caso de uso ainda ausente; não investir agora.
- `cut`: hipótese local falsificada ou sem relação com uma decisão relevante.
- Nenhum challenger recebe autoridade diretamente: primeiro qualifica em
  desenvolvimento/replay, passa por shadow e paridade e, quando aplicável,
  enfrenta um holdout próprio congelado. Autoridade exige outro gate.
- Trocar um modelo inteiro é permitido apenas se o mecanismo mínimo vencer e a
  arquitetura modular demonstrar um teto local que ele não resolva.

## Estado local que determina a prioridade

O EXP-0016 mostrou capacidade aprendida de relevância de fala, mas não fechou o
veto seguro: o classificador bruto chegou a 77,8% no holdout contra 50% da
baseline; a versão conservadora preservou 5/5 falas dirigidas nas âncoras
humanas, porém falhou o gate offline. Esses números pertencem ao
[relatório canônico do EXP-0016](../../eval/reports/exp-0016-speaker-relevance-m4b-v1.json),
não aos trabalhos externos. A lacuna torna contexto semântico causal o próximo
probe de maior valor da informação.

O Core do EXP-0017 confirmou esse limite em diversidade sintética nova: `A`
preservou 60/60 falas dirigidas, mas acertou 1/60 fundos e empatou `A0` por
exemplo. A hipótese acústica compacta foi cortada sem holdout. O probe `R`
também foi cortado antes do fit: sua cobertura causal não atingiu os pisos
independentes e seu corpus não isolava destinatário de léxico. O EXP-0018
isolou essa relação: `B1` fez 31/32 contra 16/32 de `B0`, venceu 15 pares
líquidos e passou os 12 gates. O EXP-0019 confirmou que o sinal pode ser
montado causalmente em áudio-oráculo, com 16/16 de paridade e p95 de proposta
de 8,7 ms, mas foi cortado porque a ordem física
`speech.paused`/`render.stopped` não foi determinística. O gargalo imediato
medido agora é lifecycle. ASR continua desconhecido e deferido; o experimento
não autoriza concluir que reconhecimento deixou de ser um gargalo futuro.

## Fila atual

| Challenger / mecanismo | Evidência disponível | Decisão afetada | Menor teste e dependências | Gate | Stop rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **DuplexCascade — microturnos semânticos/contextuais** | Os autores descrevem ASR–LLM–TTS em microturnos de cerca de 600 ms e tokens explícitos de estado. Localmente, EXP-0018 validou o matcher textual e EXP-0019 confirmou causalidade, paridade e latência no áudio-oráculo; o corte veio da ordem física do lifecycle, não do mecanismo semântico. | Se tokens explícitos resolvem uma lacuna semântica local que permaneça depois de estabilizar o STOP. Hoje essa lacuna não está demonstrada. | Nenhuma execução de modelo. Primeiro fechar a corrida `speech.paused`/`render.stopped` no runtime atual; só então formular outro challenger mínimo se surgir um teto semântico. | Nova falha local pareada e atribuível ao mecanismo de microturno, não a ASR, TTS ou lifecycle. | Enquanto o gargalo medido for a corrida física já isolada, não baixar nem adaptar o backbone. | **watch** |
| **Lychee-FD — separação acústico-semântica nativa** | Autores reportam full-duplex nativo e ganhos em seu benchmark; pesos e serving são publicados. Não há evidência local PT-BR nem comparabilidade direta com nosso runtime. | Se existe um teto de sobreposição, timing ou naturalidade causado pela arquitetura modular. | Primeiro, adaptar somente traces e taxonomia ao evaluator comum; executar o modelo em GPU apenas após um teto modular medido. Requer GPU, vocoder e controle do efeito de idioma. | Ganho pareado em um gargalo local previamente congelado, não explicado por ASR, TTS, AEC ou orçamento de latência. | Se não houver tarefa PT-BR comparável ou se o ganho desaparecer ao controlar componentes, não adaptar o backbone. | **watch** |
| **PersonaPlex — prosódia, persona e backchannels** | Autores publicam métricas de transição/interrupção e checkpoint orientado à interação; material é centrado em inglês. Não há A/B local nem evidência PT-BR. | Se pós-treinamento nativo melhora naturalidade percebida além do que política + TTS modular alcançam. | Extrair uma hipótese por vez — timing de backchannel ou contorno prosódico — e julgá-la em A/B humano somente quando naturalidade for o maior gargalo. Requer GPU, revisão de licença e comparabilidade de voz/idioma. | Preferência humana consistente com intelligibilidade, interrupção e latência não inferiores à baseline. | Se o efeito não sobreviver ao controle de voz/conteúdo ou não transferir para PT-BR, manter apenas como referência. | **watch** |
| **MiniCPM-o — entrada contínua multimodal** | Autores demonstram interação contínua de áudio/vídeo e publicam execução/quantização; fala documentada é inglês/chinês. Não há prova local para nossa vertical atual. | Se câmera e proatividade multimodal justificam ampliar o contrato do produto. | Nenhum probe agora. Quando houver caso de uso medido, comparar um evento visual isolado via adaptador antes de integrar o modelo. Depende de requisito multimodal, GPU e avaliação PT-BR. | Evento visual melhora uma tarefa de usuário definida sem regressão da conversa por voz. | Sem caso de uso multimodal prioritário ou sem ganho causal do vídeo, não integrar. | **defer** |
| **DuplexOmni — interação rápida + pensamento assíncrono** | A arquitetura autoral separa interação e raciocínio; o checkpoint publicado exige infraestrutura muito acima da nossa vertical. Não há comparação local. | Se é preciso separar o controlador rápido do cérebro assíncrono. Essa decisão conceitual já está incorporada ao projeto. | Não executar o modelo. Testar delegação e retomada no runtime atual com cérebros intercambiáveis; reconsiderar apenas diante de falha local não resolvida pela separação existente. | Nova execução só se revelar uma capacidade ausente e isolável que altere uma decisão aberta. | Enquanto apenas confirmar a arquitetura já adotada, não gastar GPU nem reproduzir o backbone. | **defer** |

## Regra de atualização

Uma entrada só muda de status com: decisão nomeada, baseline pareada, mecanismo
isolado, orçamento máximo, gate pré-registrado e evidência ligada. Demos,
benchmarks autorais e lançamentos novos podem criar ou atualizar uma entrada,
mas não promovê-la. A síntese de candidatos e suas fontes primárias permanece no
[panorama de modelos](MODEL_LANDSCAPE_2026-07-30.md); este arquivo registra apenas
o delta que pode mudar uma ação.
