# 003 — Matriz de estados, linhagem e protocolos (revisão 2026-08-16)

Revisão do Felipe incorporada: cinco estados explícitos (a lista linear
misturava runtime, evidência offline, mineração e produto final),
correções factuais (Namo PT, eot-bench), inconsistências resolvidas
(pyannote, TurnSense, TEN VAD), contrato ampliado do commit revisável,
linhagem de dados e protocolo de pseudo-rótulos.

## 1. Matriz de estados

### EXECUTADO
| item | resultado |
|---|---|
| Smart Turn v3.2 zero-shot | REPROVADO: AUC 0,606; troca 1:1 cortes×atrasos; 96 ms p50 nesta CPU (relatório smart-turn/) |
| Pontuação do Kroko | REPROVADA com mecanismo: pontuação é retrospectiva; 3,7% dos fins com ./?/! na borda |
| Curva de baseline de silêncio | fronteira θ→(cortes,latência); engine p50 301 ms × retomadas p50 306 ms = 44% cortes |
| Análise de dano | zero atropelo vivo; dano real = FRAGMENTAÇÃO + chamadas desperdiçadas |

### PRONTO PARA TESTE (ordem de execução)
| item | tipo | pergunta que responde |
|---|---|---|
| **Commit revisável** (passo 0) | política na engine (roda/obs) | a fragmentação some sem nenhum modelo? Contrato de validação na §2 |
| Leito de sobreposição por SINAL | instrumento | rótulos fortes p/ C2/C6 a partir dos DOIS canais separados (substitui pyannote no nosso acervo) |
| **MaAI** (família VAP) | challenger runtime, 2 canais | dinâmica conjunta usuário×assistente. ZERO-SHOT TRANSFER (PT não coberto — resultado julga a transferência, NÃO a arquitetura VAP). Métricas separadas: backchannel→interrupção; interrupção→backchannel; usuário-quer-piso×sistema-segue; usuário-acompanha×sistema-cede; antecipação temporal; custo sob ASR+VAD+TTS ativos |
| **Namo-Turn-Detector-v1-Portuguese** (correção do Felipe; a varredura não o localizou — verificar repo/licença/ONNX no teste) | baseline textual barato | completude SEMÂNTICA do texto parcial no endpoint — baseline, não substituto dos acústicos |
| **livekit/eot-bench (PT)** | leito EXTERNO | diversidade fora-do-Felipe + curva falsos-cortes×latência comparável; sem adotar o detector proprietário deles |

### CONDICIONAL A FALHA RESIDUAL
| item | condição de entrada |
|---|---|
| Smart Turn FINE-TUNE nos nossos momentos | só se o commit revisável deixar dano residual fim-real×hesitação; julgado na comparação 5-vias (§5) com held-out por sessão E por falante |
| **Cabeça própria pequena (prosódia+texto)** | tratativa INTERMEDIÁRIA separada da destilação — mais barata; entra na mesma condição do fine-tune e compete com ele |
| TEN VAD | só com evidência de atraso de TRANSIÇÃO do Silero v6.2 (única vantagem alegada); licença "Apache com condições" a ler antes |
| Destilação de professor áudio-nativo | só se microscópios mostrarem ganho que features simples não reproduzem (§6) |

### MICROSCÓPIO / PROFESSOR OFFLINE (nunca runtime)
| item | papel |
|---|---|
| Qwen3-Omni-30B-A3B (Apache) | teto de percepção PT + professor RUIDOSO (pseudo-rótulos sob protocolo §7) |
| Step-Audio **R1.1** (verificar reprodutibilidade do pacote antes de qualquer aluguel; R1.5 fica no RADAR até haver pacote reproduzível) | teto de raciocínio de cena/paralinguística; segundo professor p/ cruzamento |
| Rodada RunPod | ÚNICA e delimitada, MESMAS amostras p/ ambos; pré-GPU qualificar imagem, entrypoint, import, cache e execução offline (post-mortem PersonaPlex: capacidade intermitente, stock-pip quebrado, SIGPIPE) |

### RADAR OU CORTADO
| item | estado | motivo |
|---|---|---|
| pyannote segmentation-3.0 | RADAR (fallback) | nosso acervo tem canais SEPARADOS → sinal direto o substitui integralmente HOJE; volta se/quando houver cenário multi-pessoa em canal único (caso de uso real dele) |
| brgroup/TurnSense v1.1 | RADAR | 47M ONNX Apache mas sem PT declarado; reavaliar se publicarem PT |
| latishab/turnsense | CORTADO | EN-only, quieto desde mar/2025 |
| TEN Turn Detection | CORTADO | 7B texto EN/ZH |
| LiveKit turn-detector | CORTADO (detector) | licença proprietária; o eot-bench deles ENTRA como instrumento |
| Vogent-Turn-80M | CORTADO | EN-only |
| Easy-Turn | CORTADO | 850M/263 ms |
| CrisperWhisper, audeering SER | CORTADOS | licença NC |
| SAA endereçamento | CORTADO | API-only |
| DualTurn | BLUEPRINT | referência de desenho (5 ações/78 ms) até haver pesos+código+licença |

### VIVOS AGUARDANDO AÇÃO OPERACIONAL (não rodam antes dela — §4)
audio-tagging sherpa-onnx (cena) · SenseVoice (C4) · emotion2vec (C4)

## 2. Contrato de validação do COMMIT REVISÁVEL (além do texto)

1. Resposta e chamada de cérebro do fragmento: CANCELADAS ou marcadas
   obsoletas antes de qualquer fala.
2. Nenhum resultado atrasado volta a falar (teste de corrida explícito).
3. Mudança clara de assunto NÃO é absorvida (guarda semântica/limite;
   medir taxa de falso-merge nos replays).
4. Efeitos externos (delegações, ferramentas, confirmações críticas)
   não reabrem nem duplicam.
5. Endpoints BRUTOS permanecem observáveis no trace: commit original e
   absorção são eventos DISTINTOS (a observabilidade do leito depende
   disso — sem isso, o extrator de momentos cega).
Validação: unidades de corrida + bateria de replays (os 166 cortes de
replay = banco de teste) + sessão viva; métricas: fragmentações
evitadas, falsos-merge, latência adicionada.

## 3. Linhagem dos dados (519→868) e protocolo de rótulos

- Extração ÚNICA (probes/percepcao/extrair-momentos.mjs) sobre 57
  pacotes → 1000 momentos. NÃO houve novos exemplos entre os números:
  **519** = momentos com desfecho de retomada (hesitação 282 +
  fim-falso-commit 237), base da curva; **868** = classes de endpoint
  dos harnesses (519 + fim-real 349); **782** fatias únicas pós-dedup
  (replays duplicam sessões-fonte).
- Cada momento carrega `fonteRotulo` (desfecho-eventos |
  desfecho-reproducao | marcador-textual) e `confiancaRotulo`.
- Regras: decisão da engine NUNCA é ground truth; rótulos que dependem
  do comportamento do assistente EXCLUEM replays; subconjunto humano e
  multiusuário (eot-bench PT + anotação própria) fica INTOCADO — nunca
  entra em treino, só em julgamento.
- Splits de qualquer fine-tune: held-out POR SESSÃO e POR FALANTE
  (hoje 1 falante → o held-out de falante é o subconjunto externo).

## 4. Ação operacional exigida antes de sensores (C4/C5)

Sinal só roda com a ação fechada (espera | pede repetição | cede o
piso | encurta a resposta | confirma antes de agir):
- cena adversa/música → **pede repetição** ("baixar o som?") ou
  **confirma antes de agir** em finais curtos confiantes (classe "meu
  avô") — desenho a fechar antes do teste do tagger;
- frustração → **encurta** + **confirma**;
- urgência → **encurta** e age;
- incerteza do usuário → **confirma antes de agir**.

## 5. Comparação 5-vias do endpoint (quando a condicional abrir)

política atual | commit revisável | Namo PT | ST zero-shot | ST
fine-tunado — mesmas fatias, mesma fronteira (cortes×latência),
held-out §3, diversidade externa via eot-bench PT.

## 6. Cabeça pequena vs destilação (ordem obrigatória)

Antes de qualquer encoder próprio: comparar cabeça pequena
(prosódia librosa/torchaudio + sinais do parcial) contra destilação dos
professores. Encoder próprio SÓ se os professores mostrarem ganho
residual que as features simples não reproduzem.

## 7. Protocolo de pseudo-rótulo (professores)

Prompt CONGELADO e versionado; N repetições por amostra; confiança
declarada; cruzamento Qwen×Step; calibração contra subconjunto humano;
divergências → fila de anotação. Pseudo-rótulo NUNCA vira ground truth.

## 8. Próximo retorno macro (critérios do Felipe)

matriz atualizada com resultados · resultado CAUSAL do commit revisável
· leito de sobreposição reconstruído · MaAI em replay/shadow · emenda
Namo PT + eot-bench · linhagem e protocolo aplicados · decisão
justificada sobre fine-tune · plano congelado Qwen×Step · escolha final
(política | cabeça pequena | destilar | não mexer). A lista é mapa de
investigação, não obrigação de promoção; se outra família responder
melhor, segui-la.
