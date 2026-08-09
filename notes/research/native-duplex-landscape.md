# Panorama: fala conversacional full-duplex / speech-to-speech nativa (agosto/2026)

Pesquisa web realizada em 2026-08-09. Foco: pesos abertos, mecanismo de duplex, viabilidade PT-BR.
Convenções: "NV" = não verificado (não encontrei fonte primária); números só quando reportados em fonte citada.
Contexto de leitura: nosso alvo é experiência tipo GPT-Live/Realtime (turnos naturais, barge-in, backchannels,
ouvir-enquanto-fala, raciocínio assíncrono) com camada proprietária de interação sobre pesos abertos e LLM intercambiável;
cliente final com 16 GB RAM, pesquisa com GPU grande.

---

## 0. Sumário em uma tela

| Modelo | Duplex nativo? | Pesos | Licença pesos | PT-BR fala/entende | Roda em 16GB cliente? |
|---|---|---|---|---|---|
| Moshi (Kyutai) | Sim (streams paralelos) | Sim, ~7.7B | CC-BY 4.0 | Não (EN) | Sim (int4/MLX) |
| moshika-rl-seamless | Sim (Moshi+RL) | Sim, 8B | CC-BY-**NC** 4.0 | Não (EN) | Sim |
| PersonaPlex-7B (NVIDIA) | Sim (Moshi arch) | Sim (gated HF) | NVIDIA Open Model (comercial OK) | Não (EN) | Provável (MLX port) |
| Nemotron 3 VoiceChat 12B | Sim | Early access | NV | NV | Não (12B, NV) |
| MiniCPM-o 4.5 (9B) | Sim (TDM omni) | Sim | NV (histórico: MiniCPM License) | Não explícito (en/zh voz; "30+ línguas" texto) | Limite (12GB GPU / 24GB M4) |
| DuplexCascade (SB Intuitions) | Duplex de sistema (micro-turnos) | Sim (código+ckpt) | MIT | Não (backbone Qwen2-7B; línguas NV) | Depende dos componentes |
| Lychee-FD (HITsz) | Sim (multi-stream hierárquico) | Sim (HF) | Apache 2.0 | NV (provável zh/en) | NV |
| GLM-4-Voice 9B | Não (half-duplex, tokens intercalados) | Sim | Apache 2.0 (código) | Não (zh/en) | Justo (9B) |
| Qwen3-Omni 30B-A3B | Não (turn-based) | Sim | Apache 2.0 | **Sim: PT entrada E saída de voz** | Não (~70-145GB bf16) |
| Qwen2.5-Omni 7B/3B | Não (turn-based) | Sim | Apache 2.0 | Entende PT; fala só zh/en | 3B talvez |
| Freeze-Omni | Duplex por preditor de estado | Sim | NV | Não (zh/en) | Justo (7B backbone) |
| LLaMA-Omni2 (0.5-14B) | Não (half-duplex streaming) | Sim | NV | Não (en/zh) | Sim (0.5-1.5B) |
| Step-Audio 2 mini (8B) | Não (turn-based S2S) | Sim | Apache 2.0 | Não (zh/en) | Justo |
| StepAudio 2.5 Realtime | Sim (E2E realtime) | **Não** (API) | — | Não (zh/en) | — |
| Kimi-Audio 7B | Não | Sim | MIT+Apache | Não (zh/en foco) | Justo |
| Baichuan-Audio | Não (interleaved) | Sim | Apache 2.0 | Não (zh foco) | Justo |
| VITA-Audio | Não (acelerador de 1º pacote) | Sim | NV | Não | Justo |
| SpeechGPT-2.0-preview | Parcial (interrupção tempo-real) | Sim (7B) | NV | Não (**só chinês**) | Justo |
| Ultravox v0.6/v0.7 | Não (audio-in/text-out) | Sim | MIT | Entende PT (42 línguas no v0.5) | Sim (8B) |
| Sesame CSM-1B | Não (gerador de fala contextual) | Sim | Apache 2.0 | Não (EN; finetunes comunitários) | Sim (1B) |
| Human-1 (Josh Talks, hindi) | Sim (Moshi arch) | Sim | NV | Não (hindi) | Sim (Moshi-class) |
| J-Moshi (japonês) | Sim (Moshi arch) | Sim | CC-BY-NC 4.0 | Não (ja) | Sim |
| Fechados: GPT-Realtime-2, Gemini 3.1 Flash Live, Nova 2 Sonic, Hume EVI 3 | Vário | Não | — | **Nova 2 Sonic: PT-BR nativo**; Realtime/Gemini multilíngue | — |

**Fato central para nós:** em agosto/2026 NÃO existe modelo full-duplex NATIVO de pesos abertos que fale PT-BR.
O caminho é (a) adaptar a família Moshi/PersonaPlex a PT-BR (precedentes: J-Moshi/japonês, Human-1/hindi), ou
(b) duplex de sistema (micro-turnos estilo DuplexCascade) sobre componentes PT-BR, ou (c) Qwen3-Omni como cérebro
falante de PT server-side com camada de interação própria. Detalhes na seção 9.

---

## 1. Ecossistema Kyutai (Moshi e derivados)

### 1.1 Moshi
1. **O que é / status**: primeiro LLM falado full-duplex em tempo real (paper set/2024, arXiv:2410.00037); framework ativo e mantido em 2026 (732 commits; repositório vivo). Não existe "Moshi 2" com esse nome — a evolução veio como pós-treinos (RL), variantes (RAG, Vis) e adoção por terceiros (PersonaPlex, J-Moshi, Human-1).
2. **Pesos/licença/tamanho**: Moshiko/Moshika (~7B Temporal Transformer Helium + Depth Transformer; HF card do derivado RL lista 8B total). Pesos CC-BY 4.0; código MIT (Python) / Apache 2.0 (Rust). Quantizações bf16/int8/int4 (PyTorch, MLX, Rust/candle).
3. **Mecanismo de duplex**: modelagem multi-stream síncrona — o RQ-Transformer prevê a cada frame de 80ms os tokens Mimi do canal do assistente EM PARALELO ao canal de áudio do usuário (sempre ouvindo), com "inner monologue" (stream de texto do próprio assistente) como scaffold semântico.
4. **Latência**: 160ms teórica / ~200ms prática em GPU L4 (oficial). Mimi: 24kHz, 12.5Hz frame rate, 1.1kbps, 80ms de latência de frame.
5. **Idiomas**: inglês apenas. Sem PT.
6. **Hardware**: bf16 PyTorch ~24GB VRAM; int4/int8 rodam em MacBook (MLX) e via Rust — compatível com cliente 16GB.
7. **Código**: https://github.com/kyutai-labs/moshi — excelente, 3 backends, servidor web incluso; finetune oficial: https://github.com/kyutai-labs/moshi-finetune (+ não-oficial nu-dialogue/moshi-finetune).
8. **Superioridade genuína**: menor latência conversacional da classe aberta e comportamento full-duplex real (overlap, backchannels) com footprint que roda local.
9. **Hipótese do mecanismo**: duplex vem de tratar a conversa como ÚNICA sequência multi-stream áudio-áudio sincronizada por relógio (12.5Hz) — o modelo nunca "decide falar", ele emite continuamente (silêncio incluído), então turn-taking emerge da distribuição dos dados estéreo; o inner monologue preserva qualidade linguística.
10. **Menor experimento**: rodar moshika int4 local, medir com Full-Duplex-Bench nossos 4 eixos (pausa, turno, backchannel, interrupção); em paralelo, testar Mimi como codec de PT-BR (encode/decode de fala espontânea PT-BR e medir inteligibilidade/WER com ASR) — se Mimi preserva PT-BR (evidência indireta: Hibiki-Zero usa entrada PT), o caminho de adaptação abre sem retreinar codec.

### 1.2 moshika-rl-seamless (pós-treino RL, jun/2026)
1. Moshi pós-treinado com RL para interatividade ("Post-training full-duplex spoken dialogue models with RL", blog Kyutai 2026-06-10; HF: https://huggingface.co/kyutai/moshika-rl-seamless).
2. 8B bf16; **CC-BY-NC 4.0 (não comercial!)**.
3. Mecanismo: GRPO com recompensas por eixo (pause handling, turn-taking, backchanneling, interrupção) + LLM-judge para preservar qualidade de conteúdo, sobre o mesmo esqueleto multi-stream do Moshi.
4. Latência: herda Moshi; reporta melhora de latência de resposta em troca de turno (números específicos não publicados no card; avaliado em Full-Duplex-Bench v1/v2).
5. Inglês. 6. Igual Moshi. 7. Roda com `python -m moshi.server --hf-repo kyutai/moshika-rl-seamless`.
8. Superior em: reduzir barge-in indevido do modelo e backchannels bem posicionados.
9. Hipótese: timing conversacional é otimizável por RL SEPARADAMENTE do conteúdo (mesma tese do DuplexPO, arXiv:2607.07148, NTU/Hung-yi Lee: "Factorized Conversational Dynamics Reward" com GRPO).
10. Experimento: A/B moshika base vs rl-seamless no Full-Duplex-Bench v1.5 local para quantificar o ganho do RL — define o teto do que RL nos daria num Moshi-PT.

### 1.3 MoshiRAG (abr/2026) — raciocínio/conhecimento assíncrono
1. Moshi + recuperação de conhecimento assíncrona (blog: https://kyutai.org/blog/2026-04-30-moshi-rag/ ; arXiv:2604.12928; repo: https://github.com/kyutai-labs/moshi-rag ; pesos: kyutai/moshika-rag-pytorch-bf16).
2. Pesos no HF (licença NV; presumo CC-BY 4.0 como família — NV).
3. Mecanismo: o modelo full-duplex prevê um **token gatilho de retrieval**; o contexto vai para um back-end texto-em/texto-fora (LLM ou busca) enquanto o diálogo CONTINUA; o front-end fala conteúdo "pre-RAG" leve (reconhecimentos, resposta grosseira) até a referência chegar — front-end/back-end desacoplados.
4. Latência: mantém interatividade do Moshi (benchmarks full-duplex preservados; números específicos NV).
5. Inglês. 6. Igual Moshi. 7. Repo oficial com avaliação.
8. Superior em: factualidade em QA sem congelar a fala — exatamente o padrão "raciocínio assíncrono sem travar" que buscamos.
9. Hipótese: um canal de controle discreto (token de gatilho) dentro do stream duplex é suficiente para orquestrar serviços externos lentos; a naturalidade vem de treinar o modelo a PREENCHER a espera com fala fática.
10. Experimento: reproduzir o padrão trigger-token com o back-end trocado por um LLM forte via API; medir factualidade vs. Moshi puro e a distribuição do tempo-até-conteúdo. É o blueprint da nossa "camada proprietária com LLM intercambiável" em versão nativa.

### 1.4 Hibiki / Hibiki-Zero (tradução simultânea)
1. Hibiki (fev/2025): tradução simultânea fala-fala FR→EN, ICML 2025. **Hibiki-Zero (fev/2026)**: tradução simultânea SEM dados alinhados, de **FR/ES/PT/DE → EN** (blog: https://kyutai.org/blog/2026-02-12-hibiki-zero/ ; repo: https://github.com/kyutai-labs/hibiki-zero ; HF: kyutai/hibiki-zero-3b-pytorch-bf16).
2. Hibiki: CC-BY 4.0, com variante Hibiki-M para smartphone. Hibiki-Zero: 3B.
3. Mecanismo: transformer hierárquico multi-stream (mesma família Moshi) a 12.5Hz que acumula contexto "just enough" e emite fala+texto traduzidos em tempo real com transferência de voz.
4. Latência: tempo-real, chunk a chunk (números exatos NV); áudio a 2.2kbps.
5. **PORTUGUÊS COMO ENTRADA** (Hibiki-Zero) — primeira evidência direta de que o stack Kyutai (Mimi + RQ-Transformer) processa fala PT.
6. Hibiki-Zero 3B: 8GB VRAM funciona, 12GB confortável; Hibiki-M roda em iPhone (MLX-swift).
7. Repos oficiais PyTorch/Rust/MLX, qualidade alta.
8. Superior em: fidelidade e naturalidade de fluxo em tradução simultânea on-device.
9. Hipótese: o "delayed streams modeling" (defasar o stream alvo em relação à fonte) converte tradução em problema de modelagem síncrona multi-stream — mesma primitiva do duplex.
10. Experimento: passar 1h de fala espontânea PT-BR (com sotaques variados) pelo Hibiki-Zero e medir qualidade de tradução — proxy barato para "o quão bem o ecossistema Kyutai já representa PT-BR".

### 1.5 MoshiVis (mar/2025)
- Moshi + visão: adaptadores de imagem sobre Moshi congelado; checkpoints completos (Mimi + tokenizer Helium + encoder de imagem + Moshi base) em https://github.com/kyutai-labs/moshivis. Prova que Moshi aceita módulos perceptuais plugáveis sem perder duplex. Licença: pesos CC-BY 4.0 (NV). Experimento mínimo: nenhum prioritário (visão fora de escopo).

### 1.6 J-Moshi (japonês, Interspeech 2025) — precedente de adaptação de idioma nº1
1. Nagoya University (nu-dialogue): Moshi adaptado a japonês (arXiv:2506.02979; https://github.com/nu-dialogue/j-moshi).
2. Pesos: nu-dialogue/j-moshi e j-moshi-ext no HF, **CC-BY-NC 4.0** (herda restrição de pesquisa).
3. Mecanismo: mesmo do Moshi. Adaptação: **Mimi congelado** (codifica japonês bem sem retreino!), tokenizer de texto trocado por SentencePiece japonês (embeddings reinicializados), RQ-Transformer inteiro retreinado.
4. Latência: herda Moshi. 
5. Japonês (não PT) — mas é a RECEITA: corpora usados: J-CHAT (podcast/YouTube), Callhome japonês, CSJ, corpus de agência de viagens + 2 proprietários; variante -ext com dados sintéticos de **TTS multi-stream** a partir de corpora de diálogo em texto.
6. Compute da adaptação: **128× V100 32GB** (DeepSpeed ZeRO-3, fp16, batch 512).
7. Repo bom; também mantêm moshi-finetune não-oficial.
8. Superior em: demonstrar que UMA língua nova entra no Moshi com dados + retreino do transformer, sem tocar no codec.
9. Hipótese: o gargalo de idioma está no par (tokenizer de texto, distribuição do RQ-Transformer), não no codec acústico — bom para PT-BR (Mimi já viu PT via Hibiki-Zero).
10. Experimento: replicar o pipeline J-Moshi em MINIATURA para PT-BR: gerar 100-500h de diálogo PT-BR sintético multi-stream (dois canais TTS com overlap/backchannel scriptados), finetunar Moshi com moshi-finetune em 8×A100/H100 e ver se emerge fala PT inteligível — o "hello world" da nossa aposta central.

### 1.7 Human-1 (Josh Talks, hindi, 2026) — precedente de adaptação nº2
1. Primeiro full-duplex aberto em hindi, arquitetura Moshi (HF: https://huggingface.co/JoshTalksAI/Human-1 ; paper: arXiv:2604.23295).
2. Pesos abertos no HF (licença NV); dados de treino privados.
3. Mecanismo: Moshi multi-stream.
4. Latência NV (classe Moshi).
5. Hindi (imprensa cita "bilíngue" hindi-inglês — NV além disso).
6. Classe Moshi (7B).
7. Model card + release; qualidade de engenharia NV.
8. Superior em: provar a adaptação com **26.000 horas de conversas espontâneas REAIS em estéreo** (canais separados por falante → aprende overlap/turnos sem diarização).
9. Hipótese: gravação estéreo com canal por falante é o formato-ouro de dado para duplex; escala (dezenas de milhares de horas) compra naturalidade de turno.
10. Experimento: avaliar Human-1 qualitativamente (é o retrato do que ~26k h compram); usar como calibrador do tamanho de corpus PT-BR necessário (entre as ~E7k h efetivas do J-Moshi e as 26k h do Human-1).

### 1.8 unmute.sh + Kyutai STT/TTS + Pocket TTS (cascata aberta da Kyutai)
1. **Unmute** (mai/2025; open-source jul/2025): envolve QUALQUER LLM de texto com STT/TTS streaming da Kyutai (https://github.com/kyutai-labs/unmute). **Kyutai STT** (jun/2025): stt-1b-en_fr com **VAD semântico** embutido e delay de 0.5s; stt-2.6b-en. **Kyutai TTS** (jul/2025): 1.6B, "delayed streams modeling", começa a falar antes do texto completo. **Pocket TTS** (jan/2026; multilíngue mai/2026): 100M params, tempo-real em CPU, **seis línguas incluindo PORTUGUÊS** (https://kyutai.org/blog/2026-05-04-pocket-tts-multilingual/ ; https://github.com/kyutai-labs/pocket-tts).
2. Tudo open-source; licenças permissivas (CC-BY 4.0 pesos / MIT-Apache código — checar por repo; NV granular). Voice Donation Project (jun/2025-fev/2026): 228 vozes verificadas para TTS.
3. Mecanismo de duplex: NENHUM nativo — é cascata streaming otimizada; turn-taking por VAD semântico do STT (prediz fim de turno pelo conteúdo, não só silêncio).
4. Latência: TTS ~220ms até primeiro áudio; resposta total <1s (~450ms em produção unmute.sh; ~750ms em um L40S único); STT espera +500ms após VAD.
5. **PT: Pocket TTS fala PT**; STT Kyutai NÃO tem PT (en/fr/en apenas) — o buraco PT na cascata Kyutai é o STT.
6. Hardware: Pocket TTS roda em CPU (cliente 16GB OK); pipeline completo em GPU única modesta.
7. Código oficial excelente e production-minded (Docker, WebSocket).
8. Superior em: melhor cascata aberta de baixa latência com LLM 100% intercambiável — nosso requisito de produto direto.
9. Hipótese: VAD semântico + TTS que fala antes do texto terminar recuperam boa parte da percepção de naturalidade sem duplex nativo.
10. Experimento: montar unmute com STT trocado (Whisper-streaming ou similar PT-BR), LLM PT (ex.: Qwen/Llama PT finetune) e Pocket TTS PT; medir voice-to-voice p50/p95 e taxa de falso corte de turno em conversas PT-BR reais. É a BASELINE de produto a bater.

---

## 2. PersonaPlex (NVIDIA) e a linha Nemotron VoiceChat

### 2.1 PersonaPlex-7B-v1 (jan/2026)
1. Modelo S2S full-duplex tempo-real com controle de persona (prompt de papel em texto + condicionamento de voz por áudio), **baseado na arquitetura e nos PESOS do Moshi** (backbone Helium). Paper: arXiv:2602.06053. Repo: https://github.com/NVIDIA/personaplex. HF (gated): https://huggingface.co/nvidia/personaplex-7b-v1.
2. 7B; código MIT; **pesos NVIDIA Open Model License (uso comercial permitido)** — diferencial vs. moshika-rl-seamless (NC).
3. Mecanismo: multi-stream Moshi + pós-treino com dados de diálogo sintéticos/atuados com personas variadas e condicionamento de voz; 16 vozes naturais + 10 variadas empacotadas.
4. Latência/benchmarks (paper): **100% de sucesso em interrupção de usuário** (vs 43.9% Gemini Live, 60.6% Moshi); latência média de resposta ~205ms; troca de falante ~70ms-0.17s (TOR 0.908); resposta a interrupção 0.24s (TOR 0.950); MOS naturalidade de diálogo 2.95 vs Moshi 2.44, Gemini 2.80, Qwen2.5-Omni 2.81, Freeze-Omni 2.51; task adherence 4.34/5; ServiceDuplexBench 4.40/5.
5. Inglês somente. PT não mencionado.
6. GPU (VRAM exata não documentada; classe Moshi ~16-24GB bf16, menos quantizado); CPU-offload via accelerate; port MLX comunitário (https://github.com/mu-hashmi/personaplex-mlx) roda em Apple Silicon.
7. Código oficial executável com Docker, web UI, modo servidor live e offline; tutorial DataCamp; repo com 22 commits (jovem mas funcional).
8. Superior em: MELHOR full-duplex aberto em métricas de interação (interrupção, troca de turno) E controle de persona/voz — hoje é o estado da arte aberto no "sentir do GPT-Live".
9. Hipótese: (a) herdou o duplex do Moshi de graça; (b) o pós-treino com muitos pares (persona-prompt, voz) LIBERTA o conhecimento do backbone que o pós-treino original do Moshi (persona única "Moshi") suprimia — persona vira variável de prompt, não constante do treino.
10. Experimento: rodar PersonaPlex local, dar prompt de papel em PORTUGUÊS e áudio de voz PT-BR e documentar o que sai (esperado: inglês com sotaque/code-switching — mede quanto PT "sobrou" no Helium); depois, finetune curto (moshi-finetune é compatível com a arquitetura) com nossas primeiras horas PT-BR sintéticas. PersonaPlex é o candidato nº1 a base da adaptação PT-BR por causa da licença comercial.

### 2.2 Nemotron 3 VoiceChat (early access, GTC mar/2026)
1. Modelo E2E full-duplex de 12B (Nemotron Nano v2 backbone + encoder Parakeet + decoder TTS), anunciado 16/mar/2026; early access: https://developer.nvidia.com/nemotron-voicechat-early-access.
2. Pesos: em early access (imprensa chama de "open"; disponibilidade geral NV).
3. Mecanismo: LLM streaming unificado que analisa áudio e gera áudio direto, chunks de 80ms processados mais rápido que tempo-real.
4. Latência: alvo sub-300ms E2E; 77.8% conversational-dynamics no FullDuplexBench (early benchmark).
5. Idiomas NV (provável EN primeiro).
6. 12B → acima do cliente 16GB em bf16; NV quantizado.
7. Containers de deploy de referência + trilha guiada de fine-tuning no EA.
8. Superior em (aparente): unificar ASR-LLM-TTS num único modelo streaming com backbone de agente (tool use).
9. Hipótese: encoder ASR forte (Parakeet) + LLM agentic pré-treinado dá mais inteligência que a linhagem Moshi/Helium, ao custo de duplex menos "orgânico".
10. Experimento: inscrever o laboratório no early access agora; perguntar explicitamente sobre roadmap multilíngue/PT e trilha de fine-tuning — se a NVIDIA aceitar PT-BR como caso de fine-tune guiado, muda nosso custo de treino.

---

## 3. MiniCPM-o (OpenBMB)

### 3.1 MiniCPM-o 2.6 (jan/2025) → **MiniCPM-o 4.5 (fev/2026)**
1. 2.6: omni 8B (SigLip-400M + Whisper-medium + ChatTTS-200M + Qwen2.5-7B), live streaming multimodal, half/full-duplex limitado. **4.5 (anunciado 2026-02-03/06)**: 9B (SigLip2 + Whisper-medium + CosyVoice2 + **Qwen3-8B**), "nível Gemini 2.5 Flash" em visão+fala, **full-duplex omni streaming**. Paper: arXiv:2604.27393. Repo: https://github.com/OpenBMB/MiniCPM-o.
2. Pesos no HF; licença do 4.5 NV (histórico OpenBMB: código Apache 2.0, pesos "MiniCPM Model License" com uso comercial mediante registro — confirmar antes de decidir).
3. Mecanismo de duplex: **time-division multiplexing (TDM)** — divide os streams paralelos omni-modais em grupos de informação sequenciais dentro de fatias de tempo periódicas curtas (o LLM alterna rapidíssimo entre "ouvir/ver" e "falar" dentro de cada slice, simulando paralelismo num decoder único).
4. Latência: TTFT 0.6s (bf16 em GPU).
5. Idiomas: conversa de voz em tempo real bilíngue **inglês/chinês** (vozes configuráveis); "capacidades multilíngues em 30+ línguas" no texto — PT falado NÃO explícito. CosyVoice2 (o gerador de voz) tem suporte multilíngue limitado (zh/en/ja/ko + dialetos; PT NV).
6. Hardware: full-duplex omni: M4 Max 24GB RAM ou GPU NVIDIA ≥12GB; half-duplex: M3/M4 16GB. Ou seja: full-duplex fica NO LIMITE do cliente 16GB.
7. Repo grande e ativo, demos (web, iOS), llama.cpp/ollama para os modos não-omni; qualidade boa mas historicamente com arestas nos servidores de streaming.
8. Superior em: ÚNICO aberto com full-duplex OMNI (vê enquanto ouve enquanto fala) em hardware de consumidor.
9. Hipótese: TDM converte duplex em problema de agendamento de contexto (não de arquitetura), permitindo usar um LLM denso padrão (Qwen3-8B) sem streams paralelos — perde a granularidade de 80ms do Moshi, ganha inteligência do backbone.
10. Experimento: rodar o demo full-duplex do 4.5 numa RTX 4090; falar PT-BR com ele (Whisper-medium entende PT) e ver se responde em PT falado via CosyVoice2; medir latência de barge-in vs PersonaPlex. Se a resposta em PT sair aceitável, é o atalho mais barato para um protótipo PT parcial.

### 3.2 Paper relacionado: LWS — Listen-Write-Speak (arXiv:2606.07547)
- Autores da órbita OpenBMB/THUNLP (Yuan Yao et al. — mesma linhagem MiniCPM; afiliação no abstract NV). Paradigma tri-canal "text-first": um único LLM autoregressivo ouve áudio continuamente, ESCREVE texto livre como canal primário e fala em paralelo; Token Schema sem mudança de arquitetura; consistência escrita-fala 92.6%; VoiceBench AlpacaEval 4.72. Código/dataset no project page (royalzhang.com/project/lws-page/).
- Relevância: é a ponte conceitual entre "inner monologue" do Moshi e backbones LLM fortes — candidata a técnica da NOSSA camada de interação.

---

## 4. Os dois "obscuros" pedidos

### 4.1 DuplexCascade (SB Intuitions/SoftBank, mar/2026)
1. Pipeline em cascata ASR-LLM-TTS **sem VAD** com "micro-turnos": full-duplex de sistema com inteligência de LLM texto preservada. arXiv:2603.09180; repo: https://github.com/sbintuitions/DuplexCascade ; HF: sbintuitions/DuplexCascade.
2. **MIT** (código e checkpoint do LLM finetunado); backbone **Qwen2-7B-Instruct** finetunado para duplex.
3. Mecanismo: converte turnos longos em **interações chunk-a-chunk (micro-turnos)**: o ASR streaming alimenta o LLM periodicamente; um conjunto de **tokens especiais de controle conversacional** (falar/continuar/ceder/backchannel) coordena timing sob restrição de streaming; TTS streaming sintetiza em tempo real.
4. Latência: números específicos NV (paper afirma SOTA full-duplex turn-taking em Full-Duplex-Bench e forte em VoiceBench entre sistemas S2S abertos).
5. Idiomas: NV (SB Intuitions é japonesa; benchmarks usados são ingleses — provável EN, talvez JA; PT não).
6. Hardware: componentes 7B + ASR + TTS — uma GPU de 24GB deve servir (NV).
7. Código oficial no GitHub (qualidade NV em detalhe; org séria).
8. Superior em: provar que CASCATA bem orquestrada empata/supera duplex nativo em turn-taking, mantendo o LLM trocável.
9. Hipótese: o que produz naturalidade é a POLÍTICA de micro-turnos + tokens de controle (decisões a cada chunk), não a fusão acústica — logo a política pode ser destilada para qualquer língua/LLM.
10. Experimento (alta prioridade): reproduzir a receita em PT-BR — finetunar um Qwen (ou Llama PT) com os tokens de controle deles sobre transcrições PT-BR de conversa espontânea (dá para sintetizar o esquema de controle a partir de timestamps de corpora dual-channel, ex. NURC/CORAA), plugar ASR PT + Pocket TTS PT. É o caminho mais curto para "duplex percebido" em PT-BR com LLM intercambiável — exatamente nossa tese de produto.

### 4.2 Lychee-FD (HITsz-TMG, jul/2026)
1. SLM full-duplex nativo end-to-end; paper "Hierarchical Acoustic-Semantic Modeling" (arXiv:2607.06540, ACL 2026; menção em lista de outstanding papers — NV). Repo: https://github.com/HITsz-TMG/Lychee-FD.
2. **Apache 2.0**; pesos em HF `HIT-TMG/Lychee-FD` (tamanho/backbone não documentados no repo; NV); vocoder Token2Wav reaproveitado do **Step-Audio-2-mini**.
3. Mecanismo: multi-stream com **camadas inferiores compartilhadas + camadas superiores desacopladas** em três trilhas (semântica, acústica, controle de diálogo) + um **canal de alinhamento semântico** — ataca a "interferência de modalidade" (conflito de gradiente acústico×semântico) que degrada inteligência em SLMs duplex.
4. Latência: E2E não quantificada; serving vLLM multi-stream customizado com 2.96× speedup em rodadas de fala e -23% de crescimento de memória GPU em sessões longas.
5. Idiomas: não documentados (provável zh/en; PT não).
6. GPU; Docker com CUDA configurável.
7. Código + Docker + frontend web; recém-lançado (10/jul/2026) — maturidade a confirmar.
8. Superior em: +7.4% Spoken QA e +28.5% FullDuplexBench 1.5 sobre baseline mantendo eficiência — melhor trade inteligência×fluidez da safra 2026.
9. Hipótese: separar acústica de semântica em profundidade (hierarquia) resolve o dilema central dos duplex nativos ("modelo que fala bem fica burro") — o mesmo problema que Moshi ataca com inner monologue e MiniCPM com TDM.
10. Experimento: rodar o serving vLLM deles e medir FullDuplexBench local; inspecionar se o backbone é trocável (se as camadas compartilhadas são um LLM padrão, é candidato à nossa camada com LLM PT).

---

## 5. Família chinesa half-duplex / turn-based (cérebros falantes)

### 5.1 GLM-4-Voice (Zhipu/Z.ai, out/2024)
- 9B sobre GLM-4-9B; **tokens de fala e texto intercalados em razão fixa 13:26**; zh/en; controla emoção/dialeto/ritmo por instrução. Código Apache 2.0; repo: https://github.com/zai-org/GLM-4-Voice ; arXiv:2412.02612. Sem sucessor de voz aberto encontrado em 2025-26 (GLM-4.6+/GLM-5 são texto; voice via API DeepInfra). Half-duplex; sem PT. Hardware: ~20GB bf16 (NV). Superior em: expressividade controlável por instrução. Hipótese: intercalação com razão fixa dá alinhamento texto-fala estável. Experimento: baixa prioridade (zh/en, half-duplex, linha aparentemente parada).

### 5.2 Qwen2.5-Omni (mar/2025) e **Qwen3-Omni (set/2025)** — thinker-talker
1. Qwen2.5-Omni 7B/3B: primeira geração Thinker-Talker. **Qwen3-Omni-30B-A3B** (22/set/2025; arXiv:2509.17765; repo: https://github.com/QwenLM/Qwen3-Omni): Thinker-Talker **MoE** (30B total, ~3B ativos), variantes Instruct / Thinking / Captioner (+ "Flash" mencionada sem detalhe).
2. **Apache 2.0**, pesos no HF.
3. Mecanismo: **thinker-talker** — Thinker gera texto/razão; Talker consome representações de alto nível do Thinker EM STREAMING e emite tokens de fala multi-codebook com módulo MTP leve + codec decoder → NÃO é full-duplex (turn-based com VAD do lado do app), mas o talker fala enquanto o thinker ainda gera.
4. Latência: primeiro pacote teórico de ~234ms reportado (relato de imprensa citando o tech report; confirmar no paper); RTF<1 sob concorrência. Na prática com HF transformers usuários reportam TTFA alto (issue #357) — inferência otimizada requer vLLM-Omni.
5. **Idiomas: entrada de fala em 19 línguas INCLUINDO PORTUGUÊS; SAÍDA de fala em 10 línguas INCLUINDO PORTUGUÊS** — único peso aberto que FALA PT hoje com qualidade de LLM grande. (Qwen2.5-Omni falava só zh/en.)
6. Hardware: pesado — 78.85GB bf16 para 15s de vídeo (30B-A3B-Instruct); áudio puro menos, mas classe A100/H100 ou multi-GPU; NÃO cabe no cliente 16GB (quantizações comunitárias NV).
7. Código oficial bom; vLLM suportado; cookbook extenso.
8. Superior em: inteligência multimodal + fala PT nativa de saída + tool use — o melhor "cérebro que fala PT" aberto.
9. Hipótese: desacoplar razão (thinker) de vocalização (talker) permite MoE grande pensar sem bloquear o stream de voz — meio caminho para talker-reasoner.
10. Experimento: servir Qwen3-Omni-30B-A3B-Instruct em vLLM numa A100/H100; medir TTFA real em PT-BR, qualidade/sotaque do PT falado (avaliação MOS interna com falantes BR) e comportamento de barge-in com nosso orquestrador cortando o talker. Decide se ele é o motor server-side do MVP.
- **Qwen3.5-Omni (30/mar/2026)**: unifica tudo em MoE 30B; tech report arXiv:2604.15804; **status de pesos abertos NÃO confirmado** — sinais de pivô da Qwen para flagships fechados (releases jul/2026 API-only). Monitorar.

### 5.3 Freeze-Omni (Tencent/VITA-MLLM, ICML 2025)
- S2S com **LLM congelado** (Qwen2-7B): encoder e decoder de fala treinados ao redor; duplex via **camada de classificação de estado** sobre a última camada do LLM que prediz se o usuário está interrompendo (state predictor servindo de "VAD cognitivo"). Repo: https://github.com/VITA-MLLM/Freeze-Omni. Pesos: NV licença. zh/en. MOS diálogo 2.51 (medição do paper PersonaPlex). Superior em: preservar 100% a inteligência do LLM base e trocar de LLM barato (nada de esquecimento). Hipótese: duplex "de decisão" (classificador) é mais barato que duplex "de geração" (streams), mas menos natural (sem backchannel espontâneo). Experimento: testar o state-predictor deles como componente isolado da nossa camada de interação (prever interrupção/fim de turno em PT-BR com um classificador raso sobre um LLM PT congelado).

### 5.4 LLaMA-Omni2 (ICTNLP, mai/2025)
- Série 0.5B-14B sobre Qwen2.5 + decoder TTS autoregressivo streaming (fala e texto simultâneos); treinado com só 200k diálogos e supera GLM-4-Voice em SQA. HF: ICTNLP/LLaMA-Omni2-*; repo: https://github.com/ictnlp/LLaMA-Omni2. Licença NV (código Apache 2.0 NV). en/zh. Half-duplex. Superior em: eficiência de dados brutal (200k amostras). Hipótese: reaproveitar CosyVoice-style flow + LLM forte torna a "voz" um adaptador barato. Experimento: candidato a "voz PT barata": finetunar o decoder streaming deles com dados TTS PT-BR sobre um Qwen2.5 que já sabe PT — mede quanto custa dar fala PT a um LLM que já entende PT.

### 5.5 Step-Audio 2 / 2.5 (StepFun)
- **Step-Audio 2 mini (29/ago/2025)**: 8B S2S direto (áudio→áudio), **Apache 2.0**, HF stepfun-ai/Step-Audio-2-mini; paralinguagem forte (sussurro, emoção), RAG multimodal com busca de áudio, tool calling; WER EN 3.14% (vs GPT-4o Transcribe 4.5%), CER zh 3.08%. zh/en; PT não. Turn-based.
- **StepAudio 2.5 Realtime (mai/2026)**: E2E realtime com RLHF por persona; varreu os 5 benchmarks de voz de abr/2026 (bateu GPT Realtime 1.5 e Gemini Live); **API-only (wss), pesos não encontrados** — referência fechada, não candidato.
- Também: Step-Audio-EditX (3B, edição de emoção/estilo, aberto) e Step-Audio-R1 (raciocínio em áudio, HF).
- Experimento: usar Step-Audio 2 mini como réguas de paralinguagem (detecção de emoção em PT-BR? NV) — prioridade baixa.

### 5.6 Kimi-Audio (Moonshot, abr/2025)
- 7B sobre Qwen2.5-7B, 13M+ horas de pré-treino, tokens híbridos 12.5Hz; ASR/AQA/AAC/SER/conversa E2E; licença MIT (partes Apache 2.0 herdadas), comercial OK. HF: moonshotai/Kimi-Audio-7B-Instruct. zh/en foco; PT NV (provável fraco). Turn-based, sem duplex. Superior em: entendimento de áudio universal (benchmarks de understanding). Experimento: régua de understanding PT-BR (rodar ASR/emoção em PT e medir degradação) — baixa prioridade.

### 5.7 Baichuan-Audio (fev/2025)
- Framework E2E com tokenizer próprio 12.5Hz (RVQ-8, encoder Whisper Large) + LLM que **intercala tokens de texto e áudio** com troca de modalidade por tokens especiais + decoder flow-matching; 142k h ITTS + 393k h INTLV. Apache 2.0; HF Baichuan-Audio-Base/Instruct; repo: https://github.com/baichuan-inc/Baichuan-Audio. Chinês foco. Half-duplex. Também Baichuan-Omni-1.5. Experimento: nenhum prioritário; receita de dados intercalados é referência para gerar dados PT.

### 5.8 VITA-1.5 / VITA-Audio (VITA-MLLM, NeurIPS 2025)
- VITA-Audio: módulo **MCTP (Multiple Cross-modal Token Prediction)** — gera múltiplos tokens de áudio por forward do LLM; primeiro áudio no PRIMEIRO forward; 3-5× speedup em 7B; treinado só com dados abertos; HF VITA-MLLM/VITA-Audio-* (backbone Qwen2.5-7B; licença NV). Superior em: matar a latência de primeiro pacote em arquiteturas token-based. Hipótese: predição multi-token cross-modal é um "turbo" ortogonal — combinável com qualquer talker token-based nosso. Experimento: medir TTFA do VITA-Audio-Plus-Vanilla vs LLaMA-Omni2 em GPU única; avaliar MCTP como técnica para nossa camada.

### 5.9 SpeechGPT-2.0-preview (Fudan/OpenMOSS, jan/2025)
- 7B treinado em milhões de horas; interação em tempo real com interrupção, estilos/emoções ricos; **APENAS CHINÊS** (sem inglês sequer); pesos no HF (fnlp/SpeechGPT-2.0-preview-7B), código no GitHub. Latência "nível milissegundos" (marketing; NV). Sem PT; sem relevância direta além de referência arquitetural.

---

## 6. Ultravox e Sesame (peças complementares)

### 6.1 Ultravox (Fixie.ai)
- LLM multimodal audio-in/text-out: projetor de fala treina sobre QUALQUER LLM aberto congelado (Llama 3, Gemma 3, Qwen 3, GLM); **MIT**; v0.5 ampliou de 15→42 línguas (PT incluído — NV explícito mas Qwen/Llama backbones sabem PT); v0.6 (ago/2025, +Hindi, robustez a ruído; HF fixie-ai/ultravox-v0_6-*); **v0.7 sobre GLM-4.6 já existe** (fixie-ai/ultravox-v0_7-glm-4_6). TTFT ~150ms (texto). Não fala — precisa de TTS. Repo: https://github.com/fixie-ai/ultravox (bom, ativo).
- Relevância: prova o padrão "adaptador de audição plugável em LLM trocável" — metade de entrada da nossa camada. Experimento: avaliar compreensão de PT-BR falado (sotaques, fala espontânea) do v0_6-qwen-3-32b vs Whisper-large-v3+texto; se empatar, ganhamos audição E2E com LLM intercambiável.

### 6.2 Sesame CSM / Maya
- CSM-1B (13/mar/2025, **Apache 2.0**; HF sesame/csm-1b; repo: https://github.com/SesameAILabs/csm): gerador de fala conversacional — Llama backbone + decoder de áudio que emite tokens **Mimi** RVQ condicionado ao HISTÓRICO da conversa (texto+áudio intercalados). NÃO é modelo de diálogo full-duplex: é o componente de voz do sistema Maya/Miles (demo viral fev/2025, ~sub-300ms no produto hospedado). 3B/8B treinados mas NÃO liberados. Inglês; multilíngue fraco; comunidade finetuna para outras línguas (guia Speechmatics: blog.speechmatics.com/sesame-finetune).
- Superior em: prosódia/expressividade contextual de conversa (o "som de gente").
- Hipótese: condicionar o TTS no histórico DE ÁUDIO da conversa (não só texto) é o que produz prosódia socialmente adequada — backchannels que soam certos.
- Experimento: finetunar CSM-1B com 50-100h de diálogo PT-BR (receita pública) e comparar naturalidade percebida vs Pocket TTS PT e CosyVoice — decide a voz do nosso stack cascata.

---

## 7. Referências fechadas (termômetro; só o que é público)

### 7.1 OpenAI Realtime / GPT-Live
- gpt-realtime GA 28/ago/2025: S2S num único modelo (sem cascata), WebRTC/WebSocket/SIP, MCP, entrada de imagem (https://openai.com/index/introducing-gpt-realtime/). Linhagem reportada: gpt-realtime → gpt-realtime-1.5 (início 2026) → **GPT-Realtime-2 (mai/2026, "raciocínio classe GPT-5 no pipeline de áudio")** + GPT-Realtime-Translate (70+ línguas → 13) [fonte: rywalker.com/research/openai-realtime-api e cobertura de imprensa; detalhes de arquitetura NÃO públicos].
- Latência prática: ~800ms voice-to-voice em produção (medição de terceiros, forasoft; não oficial).
- PT: suporte multilíngue amplo, PT incluído em prática (lista oficial granular NV).
- Termômetro: turn detection ainda é semântica/VAD do lado do servidor + interrupção rápida; não há evidência pública de full-duplex "sempre-falando" à la Moshi.

### 7.2 Gemini Live
- Gemini 2.5 Flash Native Audio → **Gemini 3.1 Flash Live (26/mar/2026)**: native audio S2S, WebSockets, barge-in, **Proactive Audio** (responde só quando relevante — decide FALAR ou FICAR QUIETO), affective dialogue, 70+ línguas (PT incluído), ~400ms E2E em produção (número de comparativo de terceiros; não oficial) (https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview ; https://deepmind.google/models/gemini-audio/).
- Nota: no FullDuplexBench medido pelo paper do PersonaPlex, Gemini Live tinha 43.9% de sucesso em interrupção e ~1.26s de troca de falante — full-duplex percebido dele ainda perde de duplex nativo aberto em timing.

### 7.3 Amazon Nova Sonic / **Nova 2 Sonic (dez/2025)**
- Arquitetura pública: speech encoder + LLM multimodal + speech renderer unificados, streaming-first, turn-taking natural e interrupção (tech report: assets.amazon.science "Nova Sonic Technical Report").
- **Nova 2 Sonic adicionou PORTUGUÊS (BR)**: 22 vozes expressivas incluindo PT-BR, e **vozes poliglotas** que trocam de língua na mesma conversa (https://aws.amazon.com/blogs/aws/introducing-amazon-nova-2-sonic-next-generation-speech-to-speech-model-for-conversational-ai/). Fechado (Bedrock).
- Termômetro-chave: prova que S2S nativo PT-BR com turn-taking natural é alcançável comercialmente HOJE — nosso benchmark de qualidade PT-BR.

### 7.4 Hume EVI 3 (mai/2025)
- Speech-LM unificado (transcrição+linguagem+fala), voz arbitrária por prompt (100k+ vozes), ~300ms conversacional; línguas: melhor em EN, depois fr/de/it/es — PT não listado. API fechada (https://www.hume.ai/blog/introducing-evi-3). EVI 4: não encontrado (NV).

---

## 8. Talker-Reasoner e raciocínio assíncrono acoplado a fala

1. **Talker-Reasoner (Google DeepMind, out/2024, arXiv:2410.08328)**: dual-system Kahneman — Talker (Sistema 1) conversa continuamente; Reasoner (Sistema 2) planeja multi-step e atualiza memória de crenças de forma ASSÍNCRONA; validado em agente de coaching de sono. Sem código oficial (NV).
2. **DuplexOmni (jun/2026, arXiv:2606.09186; Muye Huang et al., afiliação com autores de indústria — Meituan-adjacente NV)**: separa explicitamente **camada de interação** (modelo E2E full-duplex que ouve/vê/fala em streaming) de **camada de pensamento**, colaborando assíncrona e paralelamente. Dataset aberto (HF MuyeHuang/DuplexOmni-Data); pesos NV. É a realização 2026 mais literal do talker-reasoner em fala — e a validação acadêmica da NOSSA arquitetura-alvo.
3. **MoshiRAG** (seção 1.3): trigger-token + back-end assíncrono + fala fática de preenchimento.
4. **ProAct (fev/2026, arXiv:2602.14048)**: dual-system para agentes sociais proativos embodied.
5. **"Prepared Mind, Fast Response" (arXiv:2510.08175)**: desacoplamento temporal para orquestração de conhecimento em diálogo aberto (antecipa recuperação enquanto o usuário ainda fala).
6. **DuplexSLA (mai/2026, arXiv:2605.20755)**: full-duplex sincronizando fala, linguagem E AÇÃO (tool use dentro do duplex).
7. **Full-Duplex-Bench-v3 (2026, arXiv:2604.04847)**: benchmark de TOOL USE sob disfluência em agentes full-duplex — sinal de que a fronteira 2026 é exatamente "agir e raciocinar sem congelar a fala".
- Hipótese consolidada: o padrão vencedor tem três peças — (i) stream de interação rápido e contínuo; (ii) canal de controle discreto (tokens/estados) que dispara trabalho lento; (iii) política de "fala de espera" treinada. Nossa camada proprietária deve implementar (ii) e (iii) explicitamente.
- Menor experimento: no baseline unmute-PT, injetar um segundo LLM assíncrono (forte) atrás de um gatilho por classificador de "pergunta difícil", com o LLM rápido cobrindo a espera — medir naturalidade percebida vs pipeline single-LLM.

---

## 9. Outros full-duplex 2025-2026 relevantes (varredura)

- **SALMONN-omni (Tsinghua/ByteDance-adjacente, arXiv:2505.17060)**: full-duplex standalone SEM codec no espaço de tokens do LLM; mecanismo de "dynamic thinking" (tokens de pensamento decidem transição falar↔ouvir). Pesos NV.
- **OmniFlatten (Alibaba, arXiv:2410.17799)**: achata (flatten) streams de fala do usuário + fala/texto do assistente numa ÚNICA sequência intercalada; treino progressivo half→full duplex.
- **SyncLLM (arXiv 2024)**: tokens de fala dedup + marcadores periódicos de sincronização de relógio para inferência chunk-level.
- **SALM-Duplex (arXiv:2505.15670)**: "duplex modeling direto e eficiente" para S2S (detalhes/pesos NV).
- **FlexDuo (arXiv:2502.13472)**: controlador de duplex PLUGÁVEL que adiciona full-duplex a sistemas half-duplex existentes (relevante à nossa camada).
- **TiCo (arXiv:2603.22267)**: diálogo falado com controle de TEMPO (quando responder).
- **Human-1** (seção 1.7), **J-Moshi** (1.6).
- **Sommelier (arXiv:2603.25750)**: pipeline ABERTO de pré-processamento de áudio multi-turno para TREINAR SLMs full-duplex (diarização→streams) — ferramenta direta para construir corpus PT-BR duplex a partir de podcasts/áudio mono.
- **Covo-Audio (arXiv:2602.09823)**: tech report de modelo de áudio 2026 (org/pesos NV — não investigado a fundo).
- **Decoupling Conversational Dynamics / DuplexPO (arXiv:2607.07148, NTU + NVIDIA-adjacente)**: RL (GRPO) com recompensa fatorada de dinâmica conversacional; confirma a tendência "RL para timing".
- Meta: nada full-duplex novo encontrado em 2025-26 (Spirit LM, out/2024, é interleaved text-speech research-only, licença não comercial FAIR; sem sucessor localizado). NV exaustivo.

### Benchmarks para nosso lab adotar
- Full-Duplex-Bench v1 (arXiv:2503.04721), **v1.5 overlap** (arXiv:2507.23159; v4 do paper abr/2026), v3 tool-use (arXiv:2604.04847); repo: https://github.com/DanielLin94144/Full-Duplex-Bench
- M3-DuplexBench (arXiv:2607.29125): multi-turno/multilíngue/multidomínio — **só EN/JA; NÃO tem PT** → oportunidade: contribuir um track PT-BR.
- MTR-DuplexBench (arXiv:2511.10262), FD-Bench (Interspeech 2025), EchoChain (arXiv:2604.16456, raciocínio sob interrupção), VoiceBench, URO-Bench, ServiceDuplexBench (NVIDIA).
- Observatório: https://www.fullduplex.ai/ (curadoria contínua de S2S/full-duplex).

---

## 10. Análise PT-BR e recomendação

### Evidências PT no ecossistema aberto (ago/2026)
| Evidência | O que prova |
|---|---|
| Qwen3-Omni fala e entende PT (10 línguas out) | Existe "cérebro falante de PT" aberto (Apache 2.0), server-side |
| Hibiki-Zero aceita PT como entrada (3B, 8-12GB) | Mimi + stack Kyutai representam bem fala PT |
| Pocket TTS fala PT em CPU (100M) | Voz PT aberta ultra-leve para cliente 16GB |
| Ultravox v0.5+ entende 42 línguas | Audição PT plugável em LLM trocável |
| J-Moshi (ja) e Human-1 (hi, 26k h estéreo) | A receita de adaptação de idioma do Moshi está provada 2× |
| Nova 2 Sonic PT-BR (fechado) | O alvo de qualidade PT-BR é comercialmente alcançável |
| Nenhum full-duplex nativo aberto fala PT | Nossa janela de diferenciação |

### Três apostas (podem correr em paralelo)
1. **Trilha nativa (pesquisa, GPU grande)**: PersonaPlex-7B como base (licença comercial + melhor interação medida) → adaptação PT-BR estilo J-Moshi/Human-1: manter Mimi congelado, trocar tokenizer de texto (ou manter e verificar cobertura PT do Helium tokenizer), retreinar RQ-Transformer com (a) dados sintéticos multi-stream TTS-PT (bootstrap), (b) corpora reais dual-channel PT-BR (NURC-SP/Recife, C-ORAL-BRASIL, CORAA, callcenter licenciado; alvo 10-26k h à la Human-1), processados com Sommelier → depois RL de timing (receita moshika-rl-seamless/DuplexPO). Cliente 16GB atendido via int4/MLX/Rust.
2. **Trilha de sistema (produto, agora)**: DuplexCascade-em-PT — micro-turnos + tokens de controle finetunados num LLM PT trocável, ASR streaming PT, Pocket TTS PT (ou CSM-1B-PT finetunado para prosódia melhor); camada assíncrona estilo MoshiRAG/Talker-Reasoner para raciocínio pesado. Baseline: unmute adaptado.
3. **Trilha server-side rica**: Qwen3-Omni-30B-A3B (fala PT nativa) atrás da nossa camada de interação (barge-in/turn-policy nossos), para clientes com conectividade — enquanto a trilha 1 não madura.

### Riscos marcados
- Licenças NC contaminam a linha Kyutai RL e J-Moshi (não copiar pesos, só receitas).
- MiniCPM-o 4.5: licença e PT falado não confirmados.
- Qwen pode fechar os Omni futuros (3.5-Omni ainda NV como aberto).
- Números de latência de terceiros (Gemini ~400ms, gpt-realtime ~800ms) não são oficiais.

---

## 11. Fontes principais
- Moshi: github.com/kyutai-labs/moshi · arxiv.org/abs/2410.00037 · kyutai.org/Moshi.pdf
- RL seamless: huggingface.co/kyutai/moshika-rl-seamless · kyutai.org/blog (2026-06-10)
- MoshiRAG: github.com/kyutai-labs/moshi-rag · arxiv.org/abs/2604.12928 · kyutai.org/blog/2026-04-30-moshi-rag/
- Hibiki/Zero: github.com/kyutai-labs/hibiki · kyutai.org/blog/2026-02-12-hibiki-zero/ · huggingface.co/kyutai/hibiki-zero-3b-pytorch-bf16
- Pocket TTS: kyutai.org/blog/2026-05-04-pocket-tts-multilingual/ · github.com/kyutai-labs/pocket-tts
- unmute: github.com/kyutai-labs/unmute · kyutai.org/blog/2025-07-03-tts-unmute-open-source/
- J-Moshi: github.com/nu-dialogue/j-moshi · arxiv.org/abs/2506.02979
- Human-1: huggingface.co/JoshTalksAI/Human-1 · arxiv.org/abs/2604.23295
- PersonaPlex: github.com/NVIDIA/personaplex · huggingface.co/nvidia/personaplex-7b-v1 · arxiv.org/abs/2602.06053
- Nemotron 3 VoiceChat: developer.nvidia.com/nemotron-voicechat-early-access
- MiniCPM-o: github.com/OpenBMB/MiniCPM-o · arxiv.org/abs/2604.27393 · LWS: arxiv.org/abs/2606.07547
- DuplexCascade: github.com/sbintuitions/DuplexCascade · arxiv.org/abs/2603.09180
- Lychee-FD: github.com/HITsz-TMG/Lychee-FD · arxiv.org/abs/2607.06540 · aclanthology.org/2026.acl-long.419
- GLM-4-Voice: github.com/zai-org/GLM-4-Voice · arxiv.org/abs/2412.02612
- Qwen: github.com/QwenLM/Qwen3-Omni · arxiv.org/abs/2509.17765 · arxiv.org/abs/2604.15804 (3.5)
- Freeze-Omni: github.com/VITA-MLLM/Freeze-Omni · arxiv.org/abs/2411.00774
- LLaMA-Omni2: github.com/ictnlp/LLaMA-Omni2 · arxiv.org/abs/2505.02625
- Step-Audio: github.com/stepfun-ai/Step-Audio2 · arxiv.org/abs/2507.16632 · 2.5: arxiv.org/html/2605.23463
- Kimi-Audio: github.com/MoonshotAI/Kimi-Audio · Baichuan-Audio: github.com/baichuan-inc/Baichuan-Audio · arxiv.org/abs/2502.17239
- VITA-Audio: github.com/VITA-MLLM/VITA-Audio · arxiv.org/abs/2505.03739
- SpeechGPT-2.0: github.com/OpenMOSS/SpeechGPT-2.0-preview
- Ultravox: github.com/fixie-ai/ultravox · huggingface.co/fixie-ai
- Sesame: github.com/SesameAILabs/csm · huggingface.co/sesame/csm-1b · blog.speechmatics.com/sesame-finetune
- Fechados: openai.com/index/introducing-gpt-realtime/ · ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview · aws.amazon.com/blogs/aws/introducing-amazon-nova-2-sonic... · hume.ai/blog/introducing-evi-3
- Talker-Reasoner: arxiv.org/abs/2410.08328 · DuplexOmni: arxiv.org/abs/2606.09186 · DuplexPO: arxiv.org/abs/2607.07148
- Surveys/benchmarks: arxiv.org/abs/2509.14515 · arxiv.org/html/2606.19453 · github.com/DanielLin94144/Full-Duplex-Bench · arxiv.org/abs/2507.23159 · arxiv.org/abs/2604.04847 · arxiv.org/abs/2607.29125 · Sommelier: arxiv.org/abs/2603.25750 · fullduplex.ai
