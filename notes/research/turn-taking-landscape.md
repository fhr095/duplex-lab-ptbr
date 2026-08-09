# Detecção de fim de turno, turn-taking, barge-in e VAD para agentes de voz — panorama agosto/2026

Pesquisa web realizada em 2026-08-09. Foco: componentes prontos com pesos abertos, suporte a PT-BR, latência e viabilidade em CPU/16GB RAM, para um serviço de voz conversacional PT-BR estilo GPT-Live que hoje usa VAD de energia + Silero VAD + heurísticas.

Convenções: **[INCERTO]** = não confirmado em fonte primária; **[INFERIDO]** = derivado por aritmética/leitura indireta, não afirmado pela fonte. Números sem marcação vêm das fontes citadas.

---

## 0. Resumo do panorama

O padrão da indústria em ago/2026 é uma arquitetura em duas camadas: (1) um VAD leve e rápido (Silero v6, TEN VAD ou proprietário) detecta a pausa candidata; (2) um **modelo de turno aprendido** — cada vez mais **áudio-nativo**, não baseado em transcrição — confirma se o usuário terminou ou está só hesitando, permitindo encurtar o timeout base de silêncio. A segunda tendência forte de 2025-2026 é o **endpointing entrar dentro do ASR** ("conversational speech recognition"): Deepgram Flux (EOT integrado, mediana <300ms, multilíngue desde abr/2026), AssemblyAI Universal-Streaming (token semântico de fim de turno), LiveKit Turn Detector v1 (áudio nativo), Kyutai STT (cabeça de "semantic VAD" no decoder). Barge-in deixou de ser "VAD disparou → corta TTS" e virou classificação: interrupção legítima vs backchannel/ruído (LiveKit "adaptive interruption handling", filtros min-words/min-duration em Pipecat).

Para pesos abertos + PT + CPU, o componente dominante é **Smart Turn v3 (Pipecat/Daily)**: 8M parâmetros, 8MB int8 ONNX, ~12-60ms de inferência em CPU, 23 línguas incluindo português (95,42% no test set interno), licença BSD-2, dados e código de treino abertos.

---

## 1. Eixos de avaliação (as 4 falhas do lab)

| Eixo | O que resolve hoje (ago/2026) |
|---|---|
| Tomada prematura de turno (corta hesitação) | Modelo de completude semântica sobre o áudio do turno (Smart Turn v3, UltraVAD) chamado quando o VAD vê silêncio curto; estende a espera se turno incompleto |
| Demora após final verdadeiro | Encurtar timeout base (200-300ms) e deixar o modelo confirmar; referência comercial: Deepgram Flux mediana ~260ms de EOT |
| Backchannels do usuário tratados corretamente | Filtros min-words/min-duration + lista de backchannels; estado da arte acadêmico: VAP fine-tunado para predição contínua de backchannel (NAACL 2025); LiveKit adaptive interruption (fechado) |
| Barge-in legítimo vs falso | AEC + VAD + confirmação por ASR (palavras reconhecidas) + retomada após interrupção falsa (padrão LiveKit `resume_false_interruption`); classificador contextual (UltraVAD) |

---

## 2. Tabela comparativa (componentes prontos)

| Componente | Tipo | Entrada | PT? | Tamanho | Latência CPU | Licença | Standalone? |
|---|---|---|---|---|---|---|---|
| Smart Turn v3.x | fim de turno | áudio 16kHz mono, ≤8s | **sim (pt, 95,42% v3)** | 8MB int8 / 32MB fp | 12-60ms | BSD-2 (pesos+dados+treino) | sim (ONNX) |
| LiveKit turn detector (texto, legado) | fim de turno | texto (histórico chat) | sim (14 línguas) | ~0,1B, q8 ONNX, <500MB RAM | dezenas de ms [INCERTO] | LiveKit Model License (proíbe uso fora do LiveKit Agents) | **não (licença)** |
| LiveKit Turn Detector v1 / v1-mini | fim de turno | áudio direto | 14 línguas ("state of the art in 14 languages"; lista com pt não confirmada na fonte) [INCERTO] | v1-mini: LLM podado+quantizado | v1-mini roda local em CPU | código Apache-2, pesos LiveKit Model License | **não (licença)** |
| UltraVAD (fixie-ai) | fim de turno contextual | áudio + histórico do diálogo | **sim (26 línguas, pt)** | ~0,7B (BF16 ≈1,4GB [INFERIDO]) | 65-110ms em A6000 (GPU); CPU não publicado [INCERTO] | não declarada na ficha (issue aberta) [INCERTO] | sim (transformers) |
| TEN Turn Detection | fim de turno | texto | **não (EN/ZH)** | Qwen2.5-7B | inviável CPU tempo real [INFERIDO] | Apache-2 + condições | sim, mas pesado |
| TEN VAD | VAD | áudio 16kHz, frames 10-16ms | agnóstico | lib 306KB | RTF 0,0086-0,016 | Apache-2 + cláusula de não-competir com Agora | sim (ONNX/WASM/C) |
| Silero VAD v6.x | VAD | áudio 8/16kHz, chunks ~30ms | agnóstico | ~2MB | RTF baixíssimo (1 chunk <1ms típico) | MIT | sim |
| VAP / VAP-Realtime / MaAI | turn-taking contínuo + backchannel | áudio estéreo (2 falantes) 16kHz | **não (EN/JA/ZH/FR; zero-shot cross-língua ruim)** | dezenas de M [INCERTO] | tempo real em CPU (afirmado) | código MIT; **pesos CC-BY-NC-ND / acadêmico** | sim (pesquisa) |
| turnsense (latishab) | completude (texto) | texto | não (EN) | SmolLM2-135M, ONNX | dezenas de ms [INCERTO] | aberto (HF) | sim |
| TurnSense (Baiji-Team) | completude (áudio+texto) | áudio+texto | não (ZH) | 47M / ~50MB int8 | p50 ≈55ms | Apache-2 + condições | sim |

---

## 3. Detectores de fim de turno prontos

### 3.1 Smart Turn v1/v2/v3 (Pipecat / Daily)

1. **O que é / status.** Modelo open source de "semantic VAD"/fim de turno nativo em áudio: classifica se o usuário terminou de falar e espera resposta. Linha do tempo: v1 (início 2025, só inglês, base wav2vec2-BERT [INCERTO na variante exata]); v2 (2025, 14 línguas incl. português, wav2vec2, 360MB, "6x menor que v1" → v1 ≈2,2GB [INFERIDO], 12ms para 8s de áudio em GPU L40S); **v3 (set/2025)**: troca para **encoder do Whisper Tiny + cabeça linear, 8M parâmetros**, 23 línguas, QAT int8; v3.1 e v3.2 (2025-2026) melhoram acurácia com dados humanos reais (parceiros Liva AI, Midcentury, MundoAI) substituindo TTS sintético. Projeto ativo, é o detector recomendado por padrão no Pipecat (`LocalSmartTurnAnalyzerV3`).
2. **Pesos/licença/tamanho.** BSD-2-Clause — pesos, dados de treino (`pipecat-ai/smart-turn-data-v3.1-train`, 270k amostras) e código de treino abertos. 8MB (int8 ONNX) ou 32MB (fp ONNX).
3. **Entrada/latência.** Áudio 16kHz mono PCM, janela de até 8s (pad de zeros no início; fala alinhada ao fim do vetor). Latência medida (v3): 12,6ms (AWS c7a.2xlarge), 15,2ms (c8g.2xlarge), 33,8ms (t3.2xlarge), 59,8ms (c8g.medium); <10ms em GPU. Chamado **apenas quando o VAD detecta silêncio**, não continuamente.
4. **PT-BR.** Português entre as 23 línguas; **95,42% de acurácia no test set interno (v3)**. A ficha não distingue pt-BR de pt-PT [INCERTO qual variante domina os dados]; o projeto aceita contribuição de dados e rotulagem por língua (jogo de rotulagem em smart-turn-dataset.pipecat.ai), então dá para auditar/contribuir PT-BR.
5. **Evidência.** Benchmarks próprios reproduzíveis (`benchmark.py`); v3.1: EN 88,3%→94,7% (8MB) / 95,6% (32MB), ES 86,7%→90,1%/91,0%; "demais 21 línguas com desempenho similar ao v3.0". Contraponto: paper de mar/2026 (arXiv 2603.13379) reporta recall de 58,9% para Smart Turn v3 no benchmark deles vs 87,7% do modelo proposto — sinal de que a acurácia cai fora da distribuição de teste do próprio projeto [INCERTO: benchmark de terceiro, condições diferentes].
6. **Integração Node+Python.** Trivial: modelo ONNX + `onnxruntime` (Python) ou `onnxruntime-node`; repo traz `inference.py`/`predict_endpoint()`. Precisa apenas do buffer do turno atual (16kHz) e do gatilho do VAD que vocês já têm. Sem dependência do Pipecat.
7. **Menor probe.** 1 dia: baixar ONNX 8MB, rodar sobre 50-100 turnos PT-BR gravados do próprio produto (metade completos, metade com hesitação no meio), medir acurácia + latência no hardware alvo.

URLs: https://huggingface.co/pipecat-ai/smart-turn-v3 · https://github.com/pipecat-ai/smart-turn · https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/ · https://www.daily.co/blog/improved-accuracy-in-smart-turn-v3-1/ · https://www.daily.co/blog/smart-turn-v2-faster-inference-and-13-new-languages-for-voice-ai/ · https://docs.pipecat.ai/api-reference/server/utilities/turn-detection/smart-turn-overview

### 3.2 LiveKit turn detector / end-of-utterance

1. **O que é / status.** Duas gerações. (a) **Modelo de texto (legado, plugin `livekit-plugins-turn-detector`, hoje deprecated)**: recebe o histórico transcrito (formato de chat, ≤6 turnos/128 tokens) e dá probabilidade de fim de turno; versão EN baseada em SmolLM2-135M, versão multilíngue fine-tunada de **Qwen2.5-0.5B-Instruct** com destilação de um professor 7B, publicada como ~0,1B parâmetros q8 ONNX. (b) **Turn Detector v1 (2026)**: modelo **áudio-nativo** unificado (`livekit.agents.inference.TurnDetector`) — ramo semântico (encoder de áudio + adapter + LLM fine-tunado) e ramo acústico (encoder + camada recorrente para prosódia/ritmo), sem transcrição no caminho. v1 completo roda na LiveKit Cloud (grátis para agentes lá); **v1-mini** (backbone podado + quantizado) roda local em CPU, embutido no SDK (Python ≥1.6.1, Node ≥1.4.7).
2. **Pesos/licença/tamanho.** Modelo de texto: ~0,1B q8 ONNX, <500MB RAM. v1-mini: tamanho não publicado [INCERTO]. **Licença: LiveKit Model License — proíbe expressamente "usar qualquer LiveKit Model de forma standalone ou com frameworks que não sejam LiveKit Agents"** e proíbe usar as saídas para treinar outros modelos. Código Apache-2.
3. **Entrada/latência.** Texto (legado) ou áudio (v1). CPU-only suportado; LiveKit recomenda instâncias compute-optimized. Números de latência de inferência não publicados nas fontes consultadas [INCERTO].
4. **PT-BR.** Modelo de texto multilíngue: 14 línguas **incluindo português** (TP >99,3% em todas; TN varia 85,1-96,3% por língua). v1: "state of the art em 14 línguas" — lista exata não confirmada nas fontes que li [INCERTO se pt está no v1].
5. **Evidência.** Blogs LiveKit: modelo de turno reduziu interrupções em 39% vs VAD puro; v1 a 300ms de orçamento: 9,9% de falso corte vs Deepgram Flux 12,9% e ultraVAD 27,7%; a 600ms: 4,5% (benchmark do próprio vendor).
6. **Integração Node+Python.** **Bloqueada pela licença fora do LiveKit Agents.** Só vale se vocês migrarem o runtime para LiveKit Agents (que tem SDK Node). Como referência de arquitetura, porém, é o melhor documentado.
7. **Menor probe.** Se quiserem testar: subir um agente LiveKit Agents mínimo com v1-mini e falar PT-BR com ele; senão, ignorar por licença.
8. **Extra relevante — barge-in:** LiveKit "adaptive interruption handling": modelo treinado em áudio conversacional real para distinguir tentativa real de interrupção de fala não-interruptiva (backchannel/ruído), default em Agents ≥1.5.0; além de `resume_false_interruption`/`false_interruption_timeout` (retomar TTS quando a interrupção não gera transcrição). O *padrão de projeto* é copiável mesmo sem o modelo.

URLs: https://huggingface.co/livekit/turn-detector · https://huggingface.co/livekit/turn-detector/blob/main/LICENSE · https://docs.livekit.io/agents/logic/turns/turn-detector/ · https://livekit.com/blog/solving-end-of-turn-detection · https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39 · https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/

### 3.3 UltraVAD (fixie-ai / Ultravox)

1. **O que é / status.** Anunciado set/2025, open-sourced: endpointing **áudio-nativo e contextual** — recebe o histórico do diálogo + o último trecho de áudio do usuário e produz probabilidade do token de fim de turno (threshold sugerido 0,1). Uso recomendado: rodar ao lado de um VAD streaming leve; a cada silêncio curto, chamar UltraVAD. Default no stack Ultravox.ai Realtime.
2. **Pesos/licença/tamanho.** Pesos no HF (`fixie-ai/ultraVAD`), safetensors BF16, ~0,7B parâmetros (projetor de áudio Ultravox + backbone LM pós-treinado; a ficha menciona pós-treino a partir de Llama — detalhe confuso na ficha) [INCERTO]. ≈1,4GB em BF16 [INFERIDO]. **Licença não declarada na ficha; há discussion aberta pedindo a licença** [INCERTO — verificar antes de uso comercial].
3. **Entrada/latência.** Áudio + texto do histórico; 65-110ms em GPU A6000. CPU: sem números publicados; para 0,7B, espere centenas de ms por chamada em CPU int8 [INFERIDO/INCERTO]. Cabe em 16GB RAM com folga.
4. **PT-BR.** **Sim — 26 línguas incluindo pt** (sem distinção BR/PT na ficha).
5. **Evidência.** Ficha: 77,5% acc / 81,3% F1 / 89,6% AUC em dados dependentes de contexto; 93,7% em single-turn. LiveKit mediu 27,7% de falso corte a 300ms no benchmark deles (desfavorável, vendor rival) [INCERTO].
6. **Integração Node+Python.** Python transformers com `trust_remote_code=True`; serviria como microserviço Python chamado pelo runtime Node. Mais pesado que Smart Turn; ganho potencial: usa contexto do diálogo (bom para "barge-in legítimo vs falso" e turnos cuja completude depende da pergunta do agente).
7. **Menor probe.** Meio dia com GPU qualquer (ou CPU paciente): rodar sobre os mesmos 50-100 turnos PT-BR do probe do Smart Turn, comparar acurácia com e sem contexto de diálogo.

URLs: https://huggingface.co/fixie-ai/ultraVAD · https://www.ultravox.ai/blog/ultravad-is-now-open-source-introducing-the-first-context-aware-audio-native-endpointing-model

### 3.4 TEN Turn Detection (TEN framework / Agora)

1. **O que é / status.** Classificador de turno **baseado em texto** sobre **Qwen2.5-7B**: rotula o enunciado transcrito como `finished` / `unfinished` / `wait` (usuário pediu pausa — classe interessante para barge-in de comando). Mantido pelo ecossistema TEN/Agora.
2. **Pesos/licença/tamanho.** HF `TEN-framework/TEN_Turn_Detection`; Apache-2.0 **com condições adicionais** (ver LICENSE). 7B parâmetros → ≈14GB fp16, ≈4-5GB int4 [INFERIDO].
3. **Entrada/latência.** Texto. Latência não documentada; em CPU, um 7B por decisão de turno é inviável para tempo real [INFERIDO]. Em GPU, dezenas-centenas de ms.
4. **PT-BR.** **Não — inglês e mandarim apenas.** Custo de adaptar: fine-tune de 7B multilíngue + dados PT-BR rotulados; não compensa frente às alternativas.
5. **Evidência.** Benchmarks próprios: EN 90,64% finished / 98,44% unfinished / 91% wait; ZH 98,90% / 92,74% / 92%.
6. **Integração.** Python/transformers; pesado demais para o alvo CPU/16GB.
7. **Menor probe.** Não recomendado para o lab; útil só como referência do esquema de 3 classes (`wait` é boa ideia para PT-BR: "peraí", "só um segundo").

URLs: https://github.com/ten-framework/ten-turn-detection · https://huggingface.co/TEN-framework/TEN_Turn_Detection

### 3.5 VAP — Voice Activity Projection (Ekstedt/Skantze; Inoue/Kyoto; MaAI)

1. **O que é / status.** Família de modelos **preditivos e contínuos** de turn-taking: a cada frame, prevê a atividade de voz dos dois falantes nos próximos 2s (bins 0-200/200-600/600-1200/1200-2000ms, vocabulário de 256 estados). Cobre fim de turno, shift vs hold, **predição de backchannel** e até aceno de cabeça. Repos: `ErikEkstedt/VAP` e `ErikEkstedt/VoiceActivityProjection` (originais, pouco ativos, 1 checkpoint EN em `examples/`); `inokoj/VAP-Realtime` (implementação tempo real, sendo arquivada); **`MaAI-Kyoto/MaAI` (sucessor ativo, `pip install maai`, v0.2.0 abr/2026)** com ~30 modelos no HF (`maai-kyoto`): VAP JP/ZH/FR/trilíngue (EN-ZH-JA), variantes noise-robust, mono-canal, backchannel multilíngue (nov/2025), VAD, nodding; encoders CPC (Libri-light) ou Mimi (CC-BY-4.0).
2. **Pesos/licença/tamanho.** **Código MIT; pesos restritos**: VAP-Realtime declara "somente uso acadêmico"; modelo MaAI verificado (`vap_jp`) é **CC-BY-NC-ND-4.0** (não comercial, sem derivados). Tamanhos não publicados; ordem de dezenas de M de parâmetros (CPC ~grande + transformer pequeno) [INCERTO].
3. **Entrada/latência.** **Áudio estéreo 16kHz com um canal por falante** (variante mono-canal existe no MaAI); taxas 5/10/20Hz, contexto 2,5-5s. "Opera em tempo real em CPU" (afirmação dos autores; VAP-Realtime paper IWSDS 2024 confirma CPU tempo real com degradação mínima).
4. **PT-BR.** **Não há checkpoint pt.** O paper multilíngue (LREC-COLING 2024, arXiv 2403.06487) mostra que **modelos monolíngues não transferem entre línguas**, mas um modelo treinado nas 3 línguas iguala os monolíngues — ou seja, para PT-BR é preciso treinar com dados PT-BR. Custo: o gargalo é corpus de diálogo diádico com canais separados (ver §9); o pipeline de treino é aberto (MIT). Existência do checkpoint **francês** (`vap_mc_fr`) sugere que ~20h de diálogo telefônico bastam por língua [INCERTO — volume usado não confirmado].
5. **Evidência.** Linha de pesquisa mais citada do campo; NAACL 2025 (backchannel contínuo), ICMI 2025 (multimodal EOT+backchannel), Interspeech 2025 (timing de backchannel para HRI).
6. **Integração Node+Python.** `pip install maai`, entrada por microfone/TCP/chunks, mono ou estéreo — fácil de pendurar como sidecar Python. **Mas pesos NC-ND barram produção comercial**; uso legítimo: baseline de pesquisa e professor para rotular dados.
7. **Menor probe.** 1 semana: rodar MaAI com checkpoint trilíngue (ou FR, língua românica) sobre diálogos PT-BR re-canalizados, medir zero-shot em shift/hold e backchannel — só avaliação interna (licença). Serve para estimar o teto do que um VAP PT-BR próprio entregaria.

URLs: https://github.com/ErikEkstedt/VAP · https://github.com/ErikEkstedt/VoiceActivityProjection · https://erikekstedt.github.io/VAP/ · https://github.com/inokoj/VAP-Realtime · https://github.com/MaAI-Kyoto/MaAI · https://huggingface.co/maai-kyoto · https://arxiv.org/abs/2403.06487 · https://arxiv.org/abs/2401.04868

---

## 4. VADs

### 4.1 Silero VAD v5 → v6.x

1. **Status.** v6.0 em 25/ago/2025; v6.2 em 10/dez/2025 (ONNX "ifless", modelos tinygrad 16k); pacote 6.2.1 (fev/2026) tornou onnxruntime opcional. Ativo.
2. **Pesos/licença/tamanho.** MIT; ~2MB; JIT e ONNX.
3. **Entrada/latência.** 8/16kHz, chunks ~30ms; RTF desprezível em CPU (<1ms/chunk em desktop típico) [INFERIDO da classe do modelo; números oficiais por chunk não republicados no v6].
4. **PT-BR.** Agnóstico de língua (treino multi-domínio massivo).
5. **Evidência/limites.** v6: 16% menos erros em dados ruidosos reais, 11% menos em validação multi-domínio; mudança no algoritmo de treino p/ robustez; **limitações reconhecidas: música com instrumentos que imitam voz e vozes muito agudas (desenhos, crianças pequenas)**. Crítica externa (repo TEN VAD): Silero atrasa "várias centenas de ms" para detectar transição fala→silêncio e perde silêncios curtos entre palavras — exatamente a cauda que infla a latência de endpointing [INCERTO: benchmark do concorrente].
6. **Integração.** Vocês já usam; upgrade v5→v6 é troca de arquivo ONNX.
7. **Probe.** Meio dia: A/B v5 vs v6 nos logs de áudio do produto medindo (a) atraso fala→silêncio, (b) falsos disparos com TV/música de fundo.

URLs: https://github.com/snakers4/silero-vad/discussions/678 · https://github.com/snakers4/silero-vad/releases · https://github.com/snakers4/silero-vad/wiki/Version-history-and-Available-Models

### 4.2 TEN VAD

1. **Status.** VAD frame-level do TEN framework/Agora, ativo, multiplataforma (Linux/Win/mac/Android/iOS/WASM).
2. **Pesos/licença/tamanho.** Lib 306KB (Linux); ONNX + pré-processamento abertos; **Apache-2.0 com condição adicional de não usar para competir com as ofertas da Agora** (cláusula não-OSI; risco jurídico baixo para vocês, mas existe).
3. **Entrada/latência.** 16kHz, frames de 160/256 amostras (10/16ms); RTF 0,0086-0,016 (medições próprias em várias plataformas).
4. **PT-BR.** Agnóstico.
5. **Evidência.** Precision-recall superior ao Silero em testsets anotados (LibriSpeech/GigaSpeech/DNS Challenge, anotação própria); **detecção de transição fala→não-fala muito mais rápida que Silero** (benchmark próprio). Independente: Silero v6 adicionou comparação com TEN VAD no seu release [conclusões dessa comparação não detalhadas — INCERTO].
6. **Integração.** ONNX Runtime ≥1.17 (Python/Node) ou lib C; drop-in ao lado do Silero.
7. **Probe.** Junto com o A/B do Silero v6: TEN VAD como terceiro braço, foco na latência de fim de fala (é o número que corta a percepção de "demora após final verdadeiro").

URLs: https://github.com/ten-framework/ten-vad · https://huggingface.co/TEN-framework/ten-vad

---

## 5. Endpointing semântico via texto/LLM

**Padrão consolidado (heurística de pontuação):** quando o silêncio atinge um mínimo, olhar o parcial do ASR: pontuação terminal (. ? !) → fecha o turno; sem pontuação terminal → espera mais. É literalmente o mecanismo descrito pela AssemblyAI para seu endpointing "semântico + neural + VAD". Custo zero, funciona em PT-BR se o ASR pontuar (faster-whisper e Parakeet v3 pontuam; Vosk não). Limite: hesitações com frase gramaticalmente completa ("eu queria saber…") e ASR sem pontuação estável.

**Modelos pequenos de completude de enunciado (texto):**
- **turnsense (latishab)** — SmolLM2-135M + LoRA, EOU para edge/Raspberry Pi, ONNX, EN apenas, 97,5% acc (test pequeno, 2k amostras de treino). Receita simples e replicável em PT-BR. https://github.com/latishab/turnsense · https://huggingface.co/latishab/turnsense
- **TurnSense (Baiji-Team)** — 47M params, ~50MB int8, p50 55ms CPU, 3 estados (complete/incomplete/invalid), ZH; F1 ~92-96% nos testsets ZH. Modelo áudio+texto [entrada exata mista — INCERTO]. https://huggingface.co/Baiji-Team/TurnSense
- **LiveKit texto (legado)** e **TEN Turn Detection** (acima) são a mesma ideia em 0,1B e 7B.

**Usar o próprio LLM do agente:** duas variantes documentadas na literatura: (a) prompt/cabeça auxiliar que decide "responder agora vs esperar" a cada parcial — *Speculative End-Turn Detector* (arXiv 2503.23439) explora decodificação especulativa para isso; (b) *Phoenix-VAD* (arXiv 2509.20410): LLM com janela deslizante para detecção de endpoint semântico streaming, treinável e desacoplável do LLM principal. EMNLP 2024 Findings ("LLMs Know What To Say But Not When") mostra que texto sozinho não resolve o *timing* — prosódia importa. Na prática da indústria, LLM-como-juiz de turno a cada parcial é caro/lento demais; o consenso é modelo dedicado pequeno.

**Receita de adaptação a língua nova (relevante p/ PT-BR):** o paper tailandês (arXiv 2510.04016, "Thai Semantic End-of-Turn Detection") mostra o caminho de menor esforço: fine-tune de LLM compacto sobre transcrições com rótulo fim-de-turno/não-fim, dados construídos de corpora existentes + sintéticos. O análogo PT-BR: pares (parcial, completo?) extraídos de CORAA/NURC-SP com pontuação como supervisão fraca + geração sintética por LLM (receita Syn-TurnTurk, arXiv 2604.13620, fez isso para turco).

---

## 6. Streaming ASR como insumo do endpointing

O endpointing semântico texto-baseado depende de: latência do parcial, estabilidade do parcial (parciais que "dançam" quebram classificadores) e timestamps de palavra (para alinhar com o silêncio do VAD).

### 6.1 NVIDIA Parakeet TDT 0.6b v3 (multilingual)
- 600M, FastConformer-TDT, **25 línguas europeias incl. pt**, CC-BY-4.0, pontuação/capitalização automáticas, **timestamps de palavra e segmento nativos**, chunked inference oficial (chunks de 2s, contexto esq/dir 10s/2s). WER pt: 4,76% (FLEURS) / 7,50% (MLS). **Alerta da própria ficha: treino usa português EUROPEU (Granary); desempenho pode diferir em PT-BR.** Top de throughput no Open ASR Leaderboard multilíngue (média 6,34% WER). Decodificação TDT é incremental por natureza, mas o modelo v3 é offline/chunked, não cache-aware — parciais vêm por janela (≥ ~2s de granularidade no script oficial). CPU: ficha pede 2GB RAM e otimiza para GPU; relatos de comunidade rodando rápido em CPU existem mas não são números oficiais [INCERTO]. Hospedado como "Realtime API" por terceiros (Together).
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
### 6.2 NVIDIA Nemotron 3.5 ASR Streaming 0.6b (jan/2026)
- Cache-aware FastConformer-RNNT 600M, **streaming de verdade** com chunks configuráveis 80ms-1,12s sem retreino, mediana time-to-final 24ms (blog), **40 language-locales com pt-BR e pt-PT no tier "transcription-ready"**, licença OpenMDW-1.1. **GPU-orientado; CPU não é viável na prática segundo a própria documentação** (runtime C++ NeMo-Speech.cpp mira Jetson/edge-GPU). Timestamps: não documentados na ficha [INCERTO]. É o melhor candidato *se* houver GPU pequena no futuro.
- https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b · https://huggingface.co/blog/nvidia/nemotron-speech-asr-scaling-voice-agents
### 6.3 Canary 1b v2 (+ fine-tune PT-BR comunitário)
- 978M AED (FastConformer + Transformer decoder), 25 línguas incl. pt, CC-BY-4.0, offline (não streaming; issue aberta sobre modo streaming "stale"). Mesmo alerta pt-PT (Granary). Existe **`freds0/canary-1b-ptbr`** — fine-tune comunitário em PT-BR no HF (qualidade não verificada) [INCERTO].
- https://huggingface.co/nvidia/canary-1b-v2 · https://huggingface.co/freds0/canary-1b-ptbr
### 6.4 Kyutai STT
- Decoder-only streaming (Delayed Streams Modeling): `stt-1b-en_fr` — delay 0,5s, timestamps de palavra, **cabeça de semantic VAD integrada** (prediz probabilidade de fim de fala, feita para agentes de voz); `stt-2.6b-en` delay 2,5s. CC-BY-4.0. **Só EN/FR — sem pt.** Relevante como *arquitetura de referência* (ASR com endpointing embutido, exatamente a tendência 2026); custo de PT-BR = retreino completo (fora de alcance de lab pequeno).
- https://kyutai.org/stt/ · https://huggingface.co/kyutai/stt-1b-en_fr · https://github.com/kyutai-labs/delayed-streams-modeling
### 6.5 faster-whisper + camadas de streaming
- **SimulStreaming (UFAL, 2025)**: sucessor do whisper_streaming, política AlignAtt (atenção encoder-decoder decide o ponto seguro de emissão), ~5x mais rápido que WhisperStreaming, vencedor do IWSLT 2025; timestamps de palavra em JSONL; **licença MIT (o repo hoje declara MIT)**; mas dimensionado para Whisper large-v3 em GPU ("CPU funcional porém lento demais para tempo real"). Com modelos menores (small/base int8 via faster-whisper) CPU tempo real é atingível — o próprio whisper_streaming clássico reporta ~2s de latência final com chunk de 1s [números do antecessor]. PT-BR: Whisper é forte em PT-BR (dados BR dominam o pt do Whisper) [INCERTO grau exato].
- **WhisperLiveKit (Apache-2)**: servidor pronto com backends SimulStreaming/faster-whisper/Voxtral/SenseVoice/Qwen3-ASR, VAD+VAC integrados, diarização (Sortformer/Diart), suporta pt; foco GPU, CPU possível sem números publicados.
- Estabilidade de parciais: LocalAgreement/AlignAtt emitem só prefixos confirmados → parciais estáveis porém com atraso; bom para heurística de pontuação, ruim para reação <300ms sem VAD acústico junto.
- https://github.com/ufal/SimulStreaming · https://github.com/ufal/whisper_streaming · https://github.com/QuentinFuxa/WhisperLiveKit
### 6.6 Vosk (pt)
- Kaldi-based, modelo pt-BR pequeno ~50MB (~300MB RAM), streaming nativo com **parciais sub-200ms** (medição em Cortex-A53) e timestamps de palavra (`SetWords`), Apache-2. WER bem pior que Whisper/Parakeet; **sem pontuação** → inviabiliza heurística de pontuação, mas é o parcial mais rápido e estável que existe em CPU fraca; útil como "sensor de palavras" para min-words de barge-in, não como transcrição final.
- https://alphacephei.com/vosk/models · https://github.com/alphacep/vosk-api

---

## 7. Pesquisa acadêmica 2024-2026 (predição contínua de turn-taking)

- **Multilingual VAP** (Inoue et al., LREC-COLING 2024, arXiv 2403.06487): VAP EN/ZH/JA; monolíngue não transfere; multilíngue iguala monolíngues e aprende a identificar a língua. Implicação direta: **PT-BR exige dados PT-BR (ou ao menos fine-tune)**.
- **VAP tempo real** (Inoue et al., IWSDS 2024, arXiv 2401.04868): CPU tempo real com perda mínima.
- **Backchannel contínuo** ("Yeah, Un, Oh", NAACL 2025, arXiv 2410.15929): VAP fine-tunado prediz timing e tipo de backchannel frame a frame — melhor resultado publicado para o eixo "backchannels".
- **Predicting End-of-turn and Backchannel multimodal** (ICMI 2025, doi 10.1145/3716553.3750781) e **timing de backchannel** (Interspeech 2025, paierl25): variantes multimodais/HRI.
- **Turn-taking + backchannel via fusão acústica+LLM** (arXiv 2401.14717).
- **Prompt-Guided Turn-Taking** (arXiv 2506.21191): controle do comportamento de turno via prompt textual no modelo preditivo.
- **Talking Turns** (arXiv 2503.01174): benchmark de turn-taking para modelos de áudio; conclui que modelos atuais **interrompem inadequadamente e quase não fazem backchannel** — mede exatamente os 4 eixos do lab.
- **Phoenix-VAD** (arXiv 2509.20410): endpoint semântico streaming com LLM, janela deslizante.
- **Speculative End-Turn Detector** (arXiv 2503.23439): EOT eficiente colado no chatbot de fala.
- **Thai Semantic EOT** (arXiv 2510.04016): receita de adaptação a língua de poucos recursos — molde para PT-BR.
- **Syn-TurnTurk** (arXiv 2604.13620): dataset sintético de turn-taking para turco gerado por LLM — outra receita replicável em PT-BR.
- **Hierarchical End-of-Turn com segmentação de falante primário** (arXiv 2603.13379, IEEE CAI 2026, Helwani et al.): **1,14M parâmetros** (wav2vec2 destilado em MFCC), 87,7% recall com mediana de **36ms** de latência de detecção vs 58,9% / 800-1300ms que eles medem para Smart Turn v3. Sem código/pesos publicados até onde vi [INCERTO]. Mostra que o teto de eficiência ainda está longe.
- **τ-Voice** (arXiv 2603.13686): benchmark de agentes full-duplex em domínios reais.
- **Surveys 2025**: "Turn-Taking Modelling in Conversational Systems" (Technologies 13(12):591) e IWSDS 2025 (aclanthology 2025.iwsds-1.27).
- **PT-BR especificamente: não encontrei nenhum modelo nem dataset de *predição* de turn-taking para PT-BR (2024-2026).** O que existe é linguística descritiva (análise de TRP/footing no C-ORAL-BRASIL, ABRALIN; análise de turnos em debates, GELNE) e os corpora do §9. PROPOR 2026 é o venue a monitorar. **Lacuna aberta = oportunidade do lab.**

URLs principais: https://aclanthology.org/2025.naacl-long.367/ · https://arxiv.org/abs/2403.06487 · https://arxiv.org/abs/2503.01174 · https://arxiv.org/pdf/2603.13379 · https://doi.org/10.3390/technologies13120591

---

## 8. O que os pipelines usam hoje (padrão da indústria, ago/2026)

| Plataforma | Endpointing padrão |
|---|---|
| **Pipecat** (open) | Silero VAD + **Smart Turn v3 local (`LocalSmartTurnAnalyzerV3`, ONNX CPU)** — recomendado por default; estratégias de interrupção plugáveis (`MinWordsInterruptionStrategy`) |
| **LiveKit Agents** (open core) | VAD + **Turn Detector v1 (áudio) na cloud / v1-mini local CPU**; adaptive interruption (barge-in classificado) default ≥1.5.0; fallback: STT endpointing |
| **Vapi** (fechado) | "Smart Endpointing Plan": **modelo próprio de fusão áudio+texto**; pausa default 0,2s ajustável; heurísticas por regex/idioma como fallback |
| **Retell** (fechado) | Modelo de turn-taking proprietário ("knows when to stop and listen") |
| **Vocode** (open) | Endpointing básico (VAD/heurística); projeto bem menos ativo que Pipecat/LiveKit [INCERTO nível de manutenção 2026] |
| **Deepgram Flux** (API) | ASR conversacional com **EOT integrado ao modelo** (~260ms; eventos EagerEndOfTurn p/ geração precoce); **Flux Multilingual desde 29/abr/2026, mediana EOT <300ms** — pt incluído? [INCERTO] |
| **AssemblyAI Universal-Streaming** (API) | Token semântico de fim de turno aprendido + pontuação + VAD |
| **Ultravox Realtime** (API/open) | **ultraVAD** default |
| **Kyutai/Unmute** (open) | semantic VAD embutido no STT |

Síntese: **duas camadas (VAD rápido → confirmador de turno aprendido) é o padrão universal; a fronteira é fundir endpointing no ASR.** Em open-weights/CPU, Smart Turn v3 é o de facto standard; nenhum player abre um detector *contínuo* (estilo VAP) em produção — isso ainda é território acadêmico (e a licença NC do MaAI mantém assim).

URLs: https://docs.pipecat.ai/api-reference/server/utilities/turn-detection/smart-turn-overview · https://docs.pipecat.ai/server/utilities/interruption-strategies · https://docs.livekit.io/agents/logic/turns/turn-detector/ · https://docs.vapi.ai/customization/speech-configuration · https://www.retellai.com/glossary/turn-taking-endpoints · https://deepgram.com/learn/fluxing-conversational-state-and-speech-to-text · https://developers.deepgram.com/docs/flux/configuration · https://www.assemblyai.com/blog/turn-detection-endpointing-voice-agent

---

## 9. Recursos PT-BR para treinar/avaliar

- **CORAA ASR** (~290h validadas, espontânea+preparada; ALIP, C-ORAL-BRASIL I, NURC-Recife, SP2010, TEDx pt): áudio+transcrição — bom para classificador de completude textual e para minerar pares turno-completo/incompleto. https://link.springer.com/article/10.1007/s10579-022-09621-4 · https://arxiv.org/abs/2110.15731
- **CORAA NURC-SP Minimal Corpus** (~18h, 21 áudios, transcrição multinível alinhada por unidade entoacional — anotação prosódica é ouro para rótulos de fim de turno). https://portulanclarin.net/repository/browse/coraa-nurc-sao-paulo-minimal-corpus/
- **C-ORAL-BRASIL I** (21h, 139 sessões, fala informal mineira, unidades entoacionais): diálogos espontâneos; **canais de falante separados? — na maioria gravação de campo mono/mixada [INCERTO]** — verificar sessões com microfones individuais.
- **LDC "Multi-Language Conversational Telephone Speech 2014 — Spanish & Portuguese"** (~123,8h ES+PT, telefonia, **2 canais separados por falante**): o único corpus identificado que serve *diretamente* para treinar VAP PT-BR sem re-anotação; requer licença LDC paga. (Não existe CALLFRIEND/CALLHOME português.) https://catalog.ldc.upenn.edu/
- **Dados próprios do produto**: turnos reais PT-BR com rótulo implícito (o usuário continuou falando? o corte gerou reclamação?) — para fine-tune do Smart Turn v3 é o dataset mais valioso e barato.
- Sem corpus PT-BR público de *predição de turno* rotulado; sem paper PT-BR 2024-2026 de turn-taking preditivo (ver §7).

---

## 10. Recomendações para o lab

### Mudança de patamar nos 4 eixos, com o que existe hoje
1. **Tomada prematura**: sim, muda — Smart Turn v3 (pt) como confirmador sobre o gate do Silero: silêncio de 200ms → chama modelo → incompleto = estende espera (p.ex. +600-800ms). Evidências de vendors: -39% interrupções (LiveKit, modelo análogo).
2. **Demora após final verdadeiro**: muda ao permitir timeout base curto (200-300ms) porque o modelo segura os casos incompletos; a cauda passa a ser dominada pela latência do VAD (testar TEN VAD vs Silero v6 aqui).
3. **Backchannels**: sem componente pronto+aberto+PT. Curto prazo: gate léxico-duracional (lista PT-BR "uhum/aham/tá/certo/sim" + <700ms + sem crescimento de parcial) copiando o padrão min-words do Pipecat e o resume-on-false-interruption do LiveKit. Médio prazo: VAP PT-BR (rota C).
4. **Barge-in legítimo vs falso**: AEC + VAD + confirmação por ASR (interrupção só se ≥N palavras não-backchannel) + retomada de TTS se a "interrupção" não gerar transcrição. UltraVAD é o único aberto que promete classificação contextual — testar, mas licença pendente.

### As 3 apostas imediatas para PT-BR
1. **Smart Turn v3.2 int8 ONNX** — encaixa no runtime atual (Node chama sidecar Python/onnxruntime ou onnxruntime-node), 8MB, 12-60ms CPU, PT incluído, BSD-2, fine-tunável com dados próprios.
2. **Heurística semântica sobre parciais do ASR** (pontuação terminal + classificador de completude PT-BR pequeno, SmolLM2-135M/BERTimbau fine-tunado com CORAA — receita turnsense/Thai-EOT), combinada por regra com o Smart Turn (2 sinais > 1).
3. **Upgrade da camada VAD**: Silero v6.2 + A/B com TEN VAD para reduzir a latência de detecção do fim de fala (o "piso físico" da resposta).

### Rota para um detector proprietário PT-BR (em ordem de esforço)
- **Rota A (semanas): fine-tune do Smart Turn v3 em PT-BR.** Treino aberto (`train.py`, Modal ou local), dados abertos como base + 10-50h de turnos PT-BR próprios/minerados de CORAA [estimativa de volume — INCERTO]; mantém 8MB/CPU. Maior razão benefício/esforço; contribui de volta e vira co-autoria do dataset pt.
- **Rota B (semanas): classificador textual de completude PT-BR** (135M → ONNX int8, <100ms CPU): depende da estabilidade dos parciais do ASR; ótimo como segundo sinal, não como único.
- **Rota C (meses): VAP PT-BR** — código MIT (VoiceActivityProjection/MaAI), treino com LDC ES-PT CTS 2014 + dados próprios re-canalizados; entrega predição **contínua** (shift/hold/backchannel/overlap) que nenhum concorrente aberto tem em PT-BR; é também o único caminho para backchannel *generation* bem cronometrado. Risco: dados diádicos estéreo escassos; pesos de referência NC impedem atalho.

### Menores probes (ordem sugerida)
1. **P0 (meio dia)**: A/B Silero v5 vs v6.2 vs TEN VAD nos logs — latência de fim de fala e falsos disparos.
2. **P1 (1 dia)**: Smart Turn v3.2 ONNX standalone sobre 100 turnos PT-BR reais rotulados à mão (completo/incompleto/backchannel) — acurácia + latência no hardware alvo. Este probe sozinho responde "muda de patamar?".
3. **P2 (2 dias)**: shadow mode no produto: gate atual decide; Smart Turn + heurística de pontuação apenas logam o que *teriam* decidido; medir cortes prematuros evitados e ms economizados por turno.
4. **P3 (1 semana, pesquisa)**: MaAI trilíngue zero-shot em diálogos PT-BR (avaliação interna, licença NC) para estimar o teto da Rota C antes de comprar dados LDC.

---

## 11. Fontes principais

- Smart Turn: https://huggingface.co/pipecat-ai/smart-turn-v3 · https://github.com/pipecat-ai/smart-turn · https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/ · https://www.daily.co/blog/improved-accuracy-in-smart-turn-v3-1/
- LiveKit: https://huggingface.co/livekit/turn-detector · https://livekit.com/blog/solving-end-of-turn-detection · https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/ · https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection
- TEN: https://github.com/ten-framework/ten-turn-detection · https://github.com/ten-framework/ten-vad
- Silero: https://github.com/snakers4/silero-vad/discussions/678
- VAP/MaAI: https://github.com/ErikEkstedt/VAP · https://github.com/inokoj/VAP-Realtime · https://github.com/MaAI-Kyoto/MaAI · https://arxiv.org/abs/2403.06487 · https://aclanthology.org/2025.naacl-long.367/
- UltraVAD: https://huggingface.co/fixie-ai/ultraVAD · https://www.ultravox.ai/blog/ultravad-is-now-open-source-introducing-the-first-context-aware-audio-native-endpointing-model
- EOU pequenos: https://github.com/latishab/turnsense · https://huggingface.co/Baiji-Team/TurnSense
- ASR: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 · https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b · https://huggingface.co/nvidia/canary-1b-v2 · https://huggingface.co/kyutai/stt-1b-en_fr · https://github.com/ufal/SimulStreaming · https://github.com/QuentinFuxa/WhisperLiveKit · https://alphacephei.com/vosk/models
- Indústria: https://docs.vapi.ai/customization/speech-configuration · https://deepgram.com/learn/fluxing-conversational-state-and-speech-to-text · https://www.assemblyai.com/blog/turn-detection-endpointing-voice-agent · https://www.retellai.com/glossary/turn-taking-endpoints
- Acadêmico 2026: https://arxiv.org/pdf/2603.13379 · https://arxiv.org/abs/2503.01174 · https://arxiv.org/pdf/2510.04016 · https://arxiv.org/pdf/2509.20410
- PT-BR: https://link.springer.com/article/10.1007/s10579-022-09621-4 · https://portulanclarin.net/repository/browse/coraa-nurc-sao-paulo-minimal-corpus/ · https://catalog.ldc.upenn.edu/
