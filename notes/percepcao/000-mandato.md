# Frente percepção da interação — mandato (2026-08-16)

Pergunta do Felipe: a cascata reduz a conversa a texto antes do cérebro;
capturamos intenção semântica (palavras) e alguma intenção interacional
(dinâmica temporal), mas perdemos sinais ACÚSTICOS que mudariam QUANDO e
COMO responder. Existe base para uma frente autônoma de percepção, sem
transformar a candidata em branch de experimento?

Resposta operacional: SIM — esta worktree (`exp/percepcao-v0`), com a
candidata v1 CONGELADA intocada. Gravações reais em `var/gravacoes`
(symlink read-only para o observador da worktree principal).

## Capacidades-alvo (a taxonomia a mapear)

1. FIM-REAL × HESITAÇÃO (pausa que não era fim)
2. Intenção de CONTINUAR × TOMAR O PISO
3. BACKCHANNEL × INTERRUPÇÃO (hoje: heurística temporal da engine)
4. PERGUNTA / CORREÇÃO / ÊNFASE pela sonoridade (prosódia)
5. INCERTEZA / FRUSTRAÇÃO / URGÊNCIA quando mudarem uma AÇÃO
6. Dinâmica CONJUNTA usuário×assistente (o que ELE falava quando o
   usuário reagiu)
7. (da a6c1) CENA ACÚSTICA: interferência/far-field/endereçamento — já
   com métrica-protótipo (graves/voz + flatness)

## Método (ordem travada)

1. **Leito primeiro**: extrair MOMENTOS ROTULADOS das gravações
   existentes (eventos + desfechos + feedback humano/escuta), SEM dar
   autoridade à decisão da engine — ela é hipótese; o DESFECHO
   (usuário retomou? repetiu? corrigiu? reclamou?) é o rótulo forte.
2. Varredura fresca (HF/papers/implementações) com filtros: PT-BR ou
   agnóstico de idioma, licença comercial, autocustódia, CPU/iGPU 16GB;
   RunPod SÓ como microscópio de teto (áudio-nativos).
3. Challengers EXECUTADOS um a um contra o leito; erros individuais
   compreendidos ANTES de qualquer combinação; sem vencedor a priori.
4. Custo sob a PILHA COMPLETA (ASR+TTS+VAD vivos): um detector bom que
   rouba event-loop é reprovado.
5. Pelo menos UMA voz que não é a do Felipe (CORAA/estímulos).
6. Decisão final: promover sensor pronto | treinar política própria |
   combinar poucos sinais | manter atual.

## Régua da pergunta metodológica central

Para cada capacidade: (a) é NOVA ou duplica ASR/VAD? (b) muda uma AÇÃO
da engine (responder antes/depois, ceder, perguntar, reformular)? — sinal
sem ação é telemetria, não percepção; (c) o ganho é PERCEPTÍVEL pelo
usuário? Prioridade = capacidades com (a) nova + (b) ação clara.

## Restrições herdadas

Privacidade (áudio local; envio externo só com autorização já dada por
sessão de escuta), custos RunPod delimitados por pergunta, sem tocar
`engine/candidata-v1` nem `main`.
