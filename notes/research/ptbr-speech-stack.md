# Estado da arte: TTS de baixa latência + ASR streaming para PT-BR (levantamento ago/2026)

Pesquisa web realizada em 2026-08-09. Foco: pesos abertos, licença comercial, streaming real (TTFA), viabilidade CPU 16GB vs GPU, qualidade conversacional em português brasileiro.

**Convenções:** TTFA = time to first audio. RTF = real-time factor (menor = mais rápido; <1 = mais rápido que tempo real). Números de vendor são marcados como tal. `[incerto]` = não consegui confirmar em fonte primária; **não** tratar como fato.

---

## 0. Quadro-resumo TTS

| Modelo | pt-BR | Licença pesos | Comercial | Streaming/TTFA | CPU 16GB | Clonagem | Veredito p/ nosso caso |
|---|---|---|---|---|---|---|---|
| **Chatterbox Multilingual v3 + pack pt-br** | Sim (finetune dedicado) | MIT | **Sim** | TTFB <300ms (H100); streaming não documentado no repo oficial | Não (0.5B, GPU) | Sim (zero-shot) | **Melhor equilíbrio qualidade+licença+pt-BR** |
| **Kokoro-82M** | Sim (3 vozes, suporte fino) | Apache-2.0 | **Sim** | Sem streaming nativo; chunk por sentença; RTF ~0.5 em CPU 4-core | **Sim** | Não | Melhor CPU-only com naturalidade aceitável |
| **Supertonic 3** | pt genérico (variante BR não especificada) | OpenRAIL-M (código MIT) | Sim (com restrições de uso RAIL) | Extremamente rápido em CPU (RTF 0.165–0.31 em 4-core) | **Sim (folga)** | Não (só via serviço pago) | Melhor latência CPU; qualidade 5-step "inteligível", não conversacional |
| **Qwen3-TTS 0.6B/1.7B** | pt entre 10 línguas (variante BR? [incerto]) | Apache-2.0 | **Sim** | Streaming nativo; ~97ms E2E (vendor, GPU c/ FlashAttention) | Não (precisa GPU 4–6GB+) | Sim (3s) + voice design | **Candidato forte GPU**: streaming + prosódia instruível |
| **XTTS-v2** (fork Idiap) | Sim (pt em 17 línguas, muitos finetunes BR) | CPML (não comercial) | **Não** | Streaming <150–200ms (GPU) | Marginal (lento) | Sim (6s) | Bom para protótipo; licença mata produção |
| **F5-TTS-pt-br (firstpixel)** | Sim (finetune 200h+) | CC-BY-NC-4.0 | **Não** | Não é streaming nativo | Não (difusão, GPU) | Sim (ref. 5–9s) | Qualidade pt-BR boa p/ offline; NC + latência inviabilizam |
| **Piper (piper1-gpl)** | Sim (faber/edresson/cadu + vozes OVOS) | Código GPL-3.0; vozes variam por MODEL_CARD | Em geral sim (checar voz a voz) | Tempo real em RPi5; ~10x RT em desktop; TTFA <300ms viável | **Sim (trivial)** | Não | Fallback CPU ultra-leve; prosódia claramente sintética |
| **Orpheus-TTS 3B** | **Não** (multilingual sem pt) | Apache-2.0 | Sim | ~200ms streaming (GPU, vLLM); ~100ms com input streaming | Não | Sim | Só com finetune próprio pt-BR (guia existe) |
| **CosyVoice 2/3** | **Não** (9 línguas, sem pt) | Apache-2.0 (código; modelo [incerto]) | Provável sim | 150ms (vendor, GPU) | Não | Sim | Descartar para pt |
| **Voxtral TTS 4B (Mistral)** | pt entre 9 línguas | **CC-BY-NC-4.0** | **Não** | 70ms TTFA (vendor, H200); streaming nativo | Não (GPU 16GB) | Sim (3s) | Qualidade/latência de ponta, mas NC |
| **OpenAudio S1 / S1-mini (Fish)** | pt entre 13 línguas | Fish Audio Research / CC-BY-NC-SA | **Não** | RTF ~1:7 em RTX 4090; streaming via ferramentas | Não | Sim | Emoção multilíngue boa; NC descarta |
| **Chatterbox Nano/Turbo** | [incerto] (provavelmente só en) | MIT | Sim | Nano: 3x RT em 8 cores CPU | **Sim (se houver pt)** | Sim | Vigiar: se sair pack pt, vira opção CPU |
| **MMS-TTS-por (Meta)** | pt (voz única) | CC-BY-NC-4.0 | **Não** | VITS rápido em CPU | Sim | Não | Descartar (NC + qualidade mediana) |
| IndexTTS-2 | Não (zh/en) | Custom Bilibili (comercial exige autorização) | Não sem acordo | Não é foco streaming | Não | Sim | Descartar |
| MegaTTS3 | Não (zh/en) | Apache-2.0 (encoder WaveVAE retido) | Sim, mas clonagem travada | Sem streaming (difusão) | Não | Parcial | Descartar |
| VibeVoice (MS) | Não (en/zh) | MIT (repo oficial retirado set/2025) | Sim (mirrors) | Variante Realtime-0.5B existe | Talvez (0.5B) | Sim | Descartar p/ pt |
| Dia 1.6B (Nari) | Não nativo; finetune BR comunitário | Apache-2.0 | Sim | Sem streaming de baixa latência | Não (~10GB VRAM) | Sim (áudio prompt) | Curiosidade; finetune BR perdeu expressividade |
| Sesame CSM-1B | Não (en) | Apache-2.0 | Sim | Conversacional, mas gera pós-contexto; GPU | Não | Via contexto | Arquitetura inspiradora; pt exigiria treino |
| EdgeTTS (cloud grátis) | Sim (Antonio/Francisca/Thalita) | API não oficial (ToS risco) | Zona cinza | WebSocket chunks; latência de rede varia (sem número público) | N/A (cloud) | Não | Fallback grátis para demos, nunca produção |

---

## 1. Kokoro-82M (v1.0+)

- **Status/maturidade:** Estável, muito popular. v1.0 lançado 2025-01-27; 54 vozes / 8 línguas, áudio 24kHz. Arquitetura derivada de StyleTTS2 (não autoregressivo), 82M params.
- **Licença:** Apache-2.0 (pesos). Comercial: **sim**.
- **pt-BR:** Nativo, código de língua `p`. **3 vozes**: `pf_dora` (F), `pm_alex` (M), `pm_santa` (M). ATENÇÃO: no VOICES.md as vozes pt-br **não têm nota de qualidade nem horas de treino** (vozes en têm notas A–F); o próprio card avisa que línguas não-inglesas podem ter suporte "fino" por G2P fraco/poucos dados. Ou seja: pt-BR funciona, mas é cidadão de segunda classe. Não achei MOS publicado para pt.
- **Latência/streaming:** Sem streaming interno; pratica-se chunking por sentença. Benchmark independente em CPU 4-core (AMD EPYC 7763, 15.6GB RAM): **RTF ~0.47 (PyTorch) / ~0.51 (ONNX)**; sentença de 59 chars ≈ 1.8s de wall-clock. Em CPU desktop 8+ cores deve cair, mas TTFA <300ms em CPU puro só com chunks muito curtos (primeira frase pequena) — borderline. Em GPU é folgado.
- **Hardware:** CPU 16GB: **viável** (o caso de uso canônico do modelo). GPU qualquer ajuda.
- **Qualidade:** Em en, considerado o melhor "peso-pena" ("muito menos robótico que os pares"). Em pt-br: utilizável, sotaque BR correto, mas prosódia menos rica que en; sem avaliação formal publicada. Demo hospedada: fal.ai tem endpoint "Kokoro Brazilian Portuguese"; HF Space `leonelhs/kokoro-tts-portuguese`.
- **Clonagem:** Não.
- **Menor probe:** `pip install kokoro-onnx` (ou `kokoro` PyTorch), gerar 20 frases conversacionais pt-br com `pf_dora`/`pm_alex`, medir wall-clock do 1º chunk no nosso CPU alvo.
- URLs: https://huggingface.co/hexgrad/Kokoro-82M · https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md · https://heyneo.com/blog/kokoro-tts-vs-supertonic-3-tts · https://fal.ai/models/fal-ai/kokoro/brazilian-portuguese

## 2. Orpheus-TTS (Canopy Labs)

- **Status:** Ativo; 3B (Llama backbone) lançado mar/2025; multilingual research preview abr/2025. Tamanhos 1B/400M/150M constam como **checklist não entregue** no README (só 3B disponível; confirmar antes de contar com eles).
- **Licença:** Apache-2.0. Comercial: sim.
- **pt-BR:** **NÃO.** A org no HF tem pares pretrained/finetuned para zh, hi, ko, de, fr, es_it — **sem pt**. Existe issue aberta pedindo pt-BR (canopyai/Orpheus-TTS#295); paliativo relatado: texto pt com vozes espanholas soa "espanholado". Caminho real: finetune próprio (guia oficial de treino publicado; ~50–300 exemplos/falante para adaptação de voz, mas língua nova exige muito mais).
- **Latência/streaming:** ~200ms streaming (vendor; GPU com vLLM), ~100ms com input streaming; claims de 25–50ms com cache [incerto, condições ideais].
- **Hardware:** 3B → GPU (A100/4090 classe para tempo real com vLLM). llama.cpp sem GPU existe, mas não em tempo real conversacional. CPU 16GB: não.
- **Qualidade:** Em en, referência em fala "humana" com tags paralinguísticas (`<laugh>`, `<sigh>`, `<yawn>`...). Nada publicado para pt.
- **Clonagem:** Zero-shot sim.
- **Menor probe:** Não vale probe para pt hoje; só se decidirmos financiar um finetune pt-BR (dataset CETUC/CORAA + guia deles).
- URLs: https://github.com/canopyai/Orpheus-TTS · https://huggingface.co/canopylabs · https://github.com/canopyai/Orpheus-TTS/issues/295

## 3. CosyVoice 2 / 3 (Alibaba FunAudioLLM)

- **Status:** Maduro, ativo (Fun-CosyVoice3-0.5B aberto; paper CosyVoice 3 mai/2025).
- **Licença:** Código Apache-2.0; licença dos pesos não explícita no README [incerto — verificar antes de uso comercial].
- **pt-BR:** **Não.** 9 línguas (zh, en, ja, ko, de, es, fr, it, ru) + 18 dialetos chineses. Cross-lingual cloning não cobre pt oficialmente.
- **Latência/streaming:** Streaming bidirecional (texto-in/áudio-out), **150ms** de latência de primeiro pacote (vendor, GPU).
- **Hardware:** GPU. CPU 16GB: não para tempo real.
- **Qualidade:** SOTA em zh/en; irrelevante para nós sem pt.
- **Clonagem:** Sim, zero-shot.
- **Probe:** Descartar para pt-BR.
- URLs: https://github.com/FunAudioLLM/CosyVoice · https://arxiv.org/html/2505.17589v2

## 4. F5-TTS + finetunes pt-BR

- **Status:** F5-TTS (flow matching, não autoregressivo) maduro e popular. Finetunes BR: `firstpixel/F5-TTS-pt-br` (o mais citado; ~200h+, Common Voice ~3500 falantes + outros, treinado em A100/T4/2×3090) e `ModelsLab/F5-tts-brazilian`.
- **Licença:** **CC-BY-NC-4.0** (tanto os pesos base SWivid/F5-TTS quanto o finetune firstpixel). Comercial: **não**. (Código F5 é MIT, mas isso não salva os pesos.)
- **pt-BR:** Finetune disponível, qualidade considerada boa pela comunidade BR para leitura/narração; exige texto minúsculo + `num2words`, referências de 5–9s, vírgulas para pausas; degrada em trechos longos.
- **Latência/streaming:** **Não é streaming nativo** — gera utterance inteira via difusão/flow (RTF ~0.15 em GPU boa; TTFA = duração da geração da primeira sentença, tipicamente ≥0.5–1s+ em GPU, muito mais em CPU). Existem wrappers de chunking comunitários, mas nada que entregue <300ms honestos [incerto sobre variantes "streaming" — não achei fork oficial].
- **Hardware:** GPU recomendada; CPU 16GB impraticável para conversação.
- **Qualidade:** Das melhores em pt-BR aberto para clonagem/narração (opinião comunitária; sem MOS formal pt publicado).
- **Clonagem:** Sim (é o ponto forte).
- **Menor probe:** Vale 1h de probe **só como régua de qualidade** (gerar as mesmas 20 frases e comparar cegamente com Chatterbox/Kokoro), não como candidato de produção (NC).
- URLs: https://huggingface.co/firstpixel/F5-TTS-pt-br · https://huggingface.co/ModelsLab/F5-tts-brazilian · https://github.com/SWivid/F5-TTS/discussions/774

## 5. XTTS-v2 (Coqui † → fork Idiap)

- **Status:** Coqui fechou jan/2024; código mantido vivo no fork `idiap/coqui-ai-TTS` (pacote `coqui-tts`). Modelo congelado (sem XTTS-v3).
- **Licença:** Código MPL-2.0; **pesos CPML = não comercial**, e não há mais quem venda a licença comercial. Comercial: **não** (beco sem saída jurídico; finetunes herdam CPML).
- **pt-BR:** Sim, pt entre 17 línguas; ecossistema BR grande (muitos finetunes/vozes BR no HF).
- **Latência/streaming:** **Streaming real** com <150–200ms de latência em GPU consumer (número da Coqui/relatos); 200–400ms para primeira sentença longa em H100. CPU: lento demais para conversa.
- **Hardware:** GPU 4GB+ VRAM. CPU 16GB: não em tempo real.
- **Qualidade:** Boa em pt-BR (clonagem 6s), prosódia razoável; envelhecendo frente a 2025-26.
- **Clonagem:** Sim, zero-shot 3–6s.
- **Menor probe:** Só para benchmark interno de naturalidade pt (não produção). `pip install coqui-tts`, modo streaming, medir TTFA na nossa GPU.
- URLs: https://github.com/idiap/coqui-ai-TTS · https://huggingface.co/coqui/XTTS-v2 · https://github.com/coqui-ai/TTS/discussions/4304

## 6. Piper (rhasspy → OHF-Voice/piper1-gpl)

- **Status:** Repo original arquivado out/2025; sucessor ativo **OHF-Voice/piper1-gpl** (v1.6.0, jul/2026), código GPL-3.0, ONNX + espeak-ng.
- **Licença:** Código GPL-3.0 (atenção se embarcar no cliente); **vozes têm licença própria por MODEL_CARD** — checar faber/cadu/edresson individualmente antes de uso comercial [não verifiquei cada card].
- **pt-BR:** 3 vozes oficiais: `faber` (medium), `cadu` (medium), `edresson` (low). Voz "jeff": **não encontrei** no repositório oficial de vozes (pode ser voz comunitária avulsa — [incerto]). Comunidade OpenVoiceOS publicou vozes novas pt-BR (M/F) no HF (discussão piper1-gpl#27).
- **Latência/streaming:** Tempo real em Raspberry Pi 5; ~10x tempo real em CPU desktop. Saída raw por sentença → TTFA <300ms em CPU comum é plausível para frases curtas. É o mais rápido do lote em CPU depois do Supertonic.
- **Hardware:** CPU qualquer. 16GB sobra.
- **Qualidade:** Inteligível e estável, mas prosódia visivelmente TTS ("assistente de voz"), sem emoção — quebra a ilusão de diálogo num produto estilo GPT-Live. Sem MOS pt publicado.
- **Clonagem:** Não (treino de voz nova é processo offline).
- **Menor probe:** 30min: `piper` CLI com `pt_BR-faber-medium`, medir TTFA/RTF no CPU alvo, e teste cego de naturalidade vs Kokoro.
- URLs: https://github.com/OHF-Voice/piper1-gpl · https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_BR · https://github.com/OHF-Voice/piper1-gpl/discussions/27

## 7. Chatterbox (Resemble AI) — original, Multilingual v3, packs, Turbo/Nano

- **Status:** Muito ativo. Original 0.5B (mai/2025, en); Multilingual 23 línguas (2025); **Multilingual v3 lançado 2026-06-10** (25 línguas/4 dialetos, 36.7k h de treino, watermark PerTh embutido); **Single Language Packs** com finetune dedicado **pt-BR** (`ResembleAI/Chatterbox-Multilingual-pt-br`) e pt-PT; Turbo 350M e Nano 110M (Nano "3x tempo real em 8 cores de CPU" — línguas do Nano/Turbo provavelmente só en [incerto]).
- **Licença:** **MIT** (repo e modelos). Comercial: **sim**. Watermark PerTh por padrão (avaliar implicações; remoção viola espírito, não a letra? — decisão de produto).
- **pt-BR:** **Sim, com modelo dedicado** — o pack pt-BR promete dialeto e prosódia BR melhores que o multilingual genérico.
- **Latência/streaming:** v3: **TTFB <300ms em H100, RTF ~5x** (blog oficial); marketing cita "sub-200ms". Streaming por chunks **não documentado no repo oficial** — existem forks de streaming comunitários (ex.: davidbrowne17/chatterbox-streaming, para o original en) [incerto se funcionam com v3/pt-br]. NIM da NVIDIA dá 2–39x throughput.
- **Hardware:** 0.5B Llama backbone → GPU (uma 4090/L4 deve dar TTFA conversacional; H100 é o número publicado). CPU 16GB: não para o 0.5B em tempo real (Nano sim, mas sem pt confirmado).
- **Qualidade:** Em benchmarks cegos da Resemble, preferido vs ElevenLabs em side-by-side (marketing, en). v3: menos alucinação, melhor similaridade de falante. pt-BR dedicado: sem MOS público ainda — **é exatamente o que nosso probe deve medir**.
- **Clonagem:** Zero-shot com clipe de referência + controle de `exaggeration` (emoção).
- **Menor probe (recomendado #1):** baixar `ResembleAI/Chatterbox-Multilingual-pt-br`, GPU local/nuvem, gerar diálogo pt-BR com hesitações escritas ("é...", "aham", "hum, deixa eu ver"), medir TTFA com chunking por sentença + testar fork de streaming.
- URLs: https://github.com/resemble-ai/chatterbox · https://www.resemble.ai/resources/chatterbox-multilingual-v3-tts-with-embedded-watermarking-for-25-languages · https://huggingface.co/ResembleAI (páginas HF pedem login p/ fetch anônimo)

## 8. Fish-Speech / OpenAudio S1

- **Status:** Ativo; S1 (4B, proprietário via API) e **S1-mini 0.5B** aberto.
- **Licença:** Pesos S1-mini: **CC-BY-NC-SA-4.0 / Fish Audio Research License → não comercial** (monetização exige licença paga). Comercial: **não** com pesos abertos.
- **pt-BR:** pt entre 13 línguas suportadas (genérico, não "pt-BR" explícito).
- **Latência/streaming:** RTF ~1:7 em RTX 4090 (rápido); streaming disponível no tooling. TTFA <300ms plausível em GPU boa [sem número oficial].
- **Hardware:** GPU. CPU: não.
- **Qualidade:** Forte em emoção/marcadores (`(excited)`, `(whispering)` etc.) multilíngue — no papel, o melhor controle expressivo aberto que inclui pt; qualidade pt real sem avaliação publicada.
- **Clonagem:** Sim.
- **Probe:** Só como régua expressiva (NC). Testar marcadores de emoção em pt no playground grátis antes de gastar GPU.
- URLs: https://github.com/fishaudio/fish-speech · https://huggingface.co/fishaudio/openaudio-s1-mini · https://github.com/fishaudio/fish-speech/discussions/1001

## 9. Supertonic 3 (Supertone)

- **Status:** Lançado **2026-04-29**; muito ativo/viral. ~99M params, ONNX puro, roda até em browser (WebGPU/WASM) e RPi.
- **Licença:** Código MIT; **pesos OpenRAIL-M** → comercial **sim**, com restrições de uso RAIL (ler cláusulas; ok para produto de voz normal).
- **pt-BR:** **pt entre as 31 línguas** — mas listado como `pt` genérico; não confirmei se o sotaque é BR ou PT-PT ([incerto]; o v2 tinha só 5 línguas, lista que não confirmei). Vozes preset fixas (quantidade por língua não documentada).
- **Latência/streaming:** O mais rápido em CPU que encontrei: benchmark independente (4-core EPYC, 15.6GB RAM): **RTF 0.165 (2-step) / 0.313 (5-step)**; sentença curta em 0.73s wall-clock; RPi: RTF ~0.3. TTFA <300ms em CPU comum com chunking: **realista** (único do lote junto com Piper).
- **Hardware:** **CPU 16GB: sim, com folga.** Também mobile/edge.
- **Qualidade:** Trade-off explícito: 2-step soa robótico; **5-step "claramente inteligível"** mas benchmark independente (en) considerou Kokoro mais natural/humano. Ou seja: ganha em latência, perde em conversacionalidade. Qualidade pt não avaliada publicamente.
- **Clonagem:** Não nos pesos abertos (só no serviço comercial Voice Builder).
- **Menor probe (recomendado p/ trilha CPU):** repo `supertone-inc/supertonic`, voz pt, medir TTFA/RTF no CPU alvo + teste cego pt-BR vs Kokoro `pf_dora`. Verificar sotaque (BR ou europeu?) — critério eliminatório.
- URLs: https://github.com/supertone-inc/supertonic · https://huggingface.co/Supertone/supertonic-3 · https://heyneo.com/blog/kokoro-tts-vs-supertonic-3-tts

## 10. MegaTTS3, IndexTTS-2, VibeVoice, Dia, Sesame CSM-1B (bloco rápido)

- **MegaTTS3 (ByteDance):** Apache-2.0, zh/en (sem pt), difusão (sem streaming de baixa latência), encoder WaveVAE **não liberado** (clonagem exige enviar áudio à ByteDance; há reupload comunitário `drbaph/MegaTTS3-WaveVAE`). Descartar. https://arxiv.org/pdf/2502.18924
- **IndexTTS-2 (Bilibili):** zh/en apenas; licença própria — **uso comercial exige autorização escrita** (issue #228 confirma ambiguidade Apache vs restrição). Excelente controle emocional, mas irrelevante sem pt. Descartar. https://github.com/index-tts/index-tts/issues/228
- **VibeVoice (Microsoft):** MIT, en/zh, multi-speaker long-form; repo/pesos oficiais **retirados set/2025** (mirrors persistem); variante Realtime-0.5B citada na comunidade. Sem pt → descartar. https://github.com/microsoft/VibeVoice
- **Dia 1.6B (Nari Labs):** Apache-2.0, **só inglês** nativo; diálogo ultra-realista com (laughs) etc.; ~10GB VRAM; sem streaming de baixa latência. **Existe finetune BR comunitário** `Alissonerdx/Dia1.6-pt_BR-v1` (144h CETUC, 1 falante, Apache-2.0) — mas o autor admite que **perdeu a expressividade** original no processo. Sinal de que a rota "finetunar modelo de diálogo en para pt" é cara e com perdas. https://github.com/nari-labs/dia · https://huggingface.co/Alissonerdx/Dia1.6-pt_BR-v1
- **Sesame CSM-1B:** Apache-2.0, **inglês apenas**; modelo *conversacional* de verdade (condiciona no histórico de áudio/texto do diálogo — arquitetura mais próxima do que queremos "sentir"). pt exigiria treino do zero/continuado. Guardar como referência de arquitetura. https://huggingface.co/sesame/csm-1b · https://github.com/SesameAILabs/csm

## 11. MMS-TTS-por (Meta), VITS/StyleTTS2 comunitários, EdgeTTS

- **MMS-TTS-por:** VITS 1-voz, **CC-BY-NC-4.0** (não comercial), qualidade "funciona mas datada", rápido em CPU. Descartar exceto experimentos. https://huggingface.co/facebook/mms-tts-por
- **VITS/StyleTTS2 pt-br comunitários:** ecossistema pulverizado; nada com tração comparável a F5-pt-br ou aos packs Chatterbox. YourTTS (Coqui, 2022) tem pt mas licença/idade jogam contra [não re-verifiquei licença dos checkpoints]. Kokoro já é o "StyleTTS2 com pt" prático.
- **EdgeTTS (`rany2/edge-tts`):** API gratuita **não oficial** do serviço do Edge; vozes pt-BR: `pt-BR-AntonioNeural`, `pt-BR-FranciscaNeural`, `pt-BR-ThalitaNeural` (+ ThalitaMultilingual). Qualidade Azure Neural = alta para leitura, prosódia conversacional limitada, **sem controle fino, sem SLA, risco de ToS/quebra**. Latência: rede-dependente, sem número público confiável (não invento; medir se for usar). Fallback de demo, não de produto. https://github.com/rany2/edge-tts

## 12. Prosódia conversacional / backchannels ("aham") em pt — quem faz?

Estado honesto: **nenhum modelo aberto faz backchannel/hesitação nativa em pt-BR hoje**. Aproximações, da melhor para a pior:
1. **Qwen3-TTS (Apache-2.0, pt):** controle por instrução de emoção/tom/ritmo — a rota aberta mais promissora para "jeito de fala" em pt; backchannels via texto roteirizado ("aham", "é...", "hum") — modelos LLM-based costumam pronunciá-los naturalmente. Testar é obrigatório.
2. **Chatterbox pt-br:** knob de `exaggeration` + prosódia do finetune dedicado; hesitações roteirizadas no texto.
3. **OpenAudio S1 (NC):** melhor sistema de marcadores emocionais que inclui pt — bom para calibrar expectativa, inviável comercialmente.
4. **Orpheus/Dia/CSM:** têm o vocabulário paralinguístico certo (<laugh> etc.), mas **não em pt**.
5. **Cloud:** ElevenLabs v3 (audio tags, 70+ línguas) faz isso bem em pt-BR, porém v3 não é o modelo de latência baixa (Flash v2.5 é rápido mas sem tags ricas).
Nota prática para o duplex-lab: backchannels curtos ("aham", "sei") podem ser **pré-sintetizados e cacheados** — latência zero, e qualquer TTS serve para gerá-los uma vez.

## 13. Cloud como régua de latência (números públicos, TTS)

- **ElevenLabs Flash v2.5:** ~**75ms de inferência** (vendor; exclui rede), 32 línguas **incl. pt-BR**; benchmark independente (Coval): **P50 TTFA ~288ms**. https://elevenlabs.io/docs/eleven-api/concepts/latency
- **Cartesia Sonic-3/3.5:** TTFA **~40–90ms** (vendor, WebSocket), 42 línguas incl. pt (tier de qualidade alto segundo vendor); Coval: **P50 ~188ms**. https://openbenchmarks.com/text-to-speech-benchmark-by-coval/elevenlabs-vs-cartesia
- Régua realista para nosso servidor: **TTFA servidor <300ms coloca a gente na mesma classe percebida dos clouds medidos de fora**.

---

## 14. ASR streaming PT-BR (secundário)

| Opção | pt | Licença | Streaming real | CPU 16GB | Precisão pt | Nota |
|---|---|---|---|---|---|---|
| **Voxtral Mini 4B Realtime (Mistral, fev/2026)** | Sim (13 línguas) | **Apache-2.0** | **Sim, nativo** (delay configurável 80–1200ms; 480ms = sweet spot, ~1–2% WER de custo) | Não (GPU ≥16GB, vLLM) | Alta (nível offline) | **Melhor ASR streaming pt aberto hoje (GPU)** |
| **Parakeet TDT 0.6B v3 (NVIDIA)** | Sim (25 línguas, auto-detect) | CC-BY-4.0 (comercial ok) | Pseudo (chunks ~2s; sherpa-onnx confirma que não há streaming verdadeiro) | Sim via ONNX int8 (~670MB disco/2GB RAM), rápido | **WER pt 4.76% (Fleurs) / 7.5% (MLS)** + pontuação/timestamps | Melhor custo-benefício com latência ~1–2.5s |
| **faster-whisper large-v3-turbo (+ WhisperLiveKit/SimulStreaming)** | Sim | MIT (Whisper + faster-whisper); checar licença SimulStreaming [incerto] | Pseudo (AlignAtt/LocalAgreement; sub-segundo a ~2s) | **Borderline-sim** (turbo int8 em 8+ cores; large-v3 puro é 2.5x mais lento que RT em i9) | Alta em pt (large-v3 referência multilíngue) | **Melhor rota CPU-only** hoje |
| **Vosk (small-pt 0.3 / fb-v0.1.1)** | Sim | Apache-2.0 / GPLv3 | **Sim, verdadeiro** (Kaldi online) | Sim (31MB!) | Fraca: WER CV 32.6% (small) / 27.7% (fb); CORAA 68.9/54.3 | Só para wake/rascunho parcial, não para entender fala |
| **wav2vec2-xlsr-53-portuguese (jonatasgrosman)** | Sim | Apache-2.0 | CTC → chunking simples | Sim (pesado mas roda) | WER CV ~11.3% (9.0 c/ LM) | Datado (2021); ainda útil como parcial rápido |
| **Kyutai STT (unmute)** | **Não** (en/fr apenas) | CC-BY 4.0 [conferir] | Sim (delay 0.5s, VAD semântico) | Não (GPU) | — | Arquitetura ideal, língua errada |
| **Canary 1B v2 (NVIDIA)** | Sim (25 línguas) | CC-BY-4.0 | Não (offline) | Não ideal | WER pt 4.39% (Fleurs) | Régua de precisão offline |

Detalhes/URLs ASR:
- Voxtral Realtime: ~3.4B LM + ~970M encoder causal, sliding-window p/ streaming "infinito"; vLLM ≥0.20; 1 GPU 16GB. https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602 · https://mistral.ai/news/voxtral-transcribe-2/
- Parakeet v3: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 (WER pt no card); CPU/ONNX: https://github.com/achetronic/parakeet ; sherpa-onnx sobre a ausência de streaming real: https://github.com/k2-fsa/sherpa-onnx/issues/2918
- WhisperLiveKit (SimulStreaming AlignAtt, diarização, WebSocket): https://github.com/QuentinFuxa/WhisperLiveKit
- Vosk modelos pt: https://alphacephei.com/vosk/models
- wav2vec2 pt: https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-portuguese
- Kyutai: https://kyutai.org/stt/ · https://huggingface.co/kyutai/stt-1b-en_fr
- Panorama ASR 2026: https://www.marktechpost.com/2026/07/23/best-open-speech-recognition-asr-models-in-2026-wer-languages-latency-and-license-compared/
- [Não verificado a fundo] Meta "Omnilingual ASR" (2025, 1600+ línguas) — checar licença/pt se precisarmos de alternativa offline.

---

## 15. Recomendações de probes para o duplex-lab (ordem)

1. **PROBE-TTS-A (GPU, principal):** `ResembleAI/Chatterbox-Multilingual-pt-br` — TTFA real com chunking por sentença na nossa GPU, naturalidade em diálogo com hesitações roteirizadas, interrupção (matar geração meio-chunk). Critério: TTFA <300ms e "passa no teste do ouvido BR". MIT limpa para produção.
2. **PROBE-TTS-B (GPU, streaming nativo):** Qwen3-TTS-0.6B/1.7B — validar claim de streaming ~97ms na prática (com FlashAttention 2!), qualidade pt (sotaque BR?), controle de tom por instrução. Apache-2.0.
3. **PROBE-TTS-C (CPU 16GB):** Kokoro `pf_dora`/`pm_alex` vs Supertonic 3 pt — TTFA de primeira frase curta no CPU alvo + teste cego de naturalidade + sotaque do Supertonic (eliminatório se for pt-PT). Piper faber como piso de latência.
4. **PROBE-ASR-A (GPU):** Voxtral Mini 4B Realtime com delay 480ms em pt-BR coloquial (vLLM).
5. **PROBE-ASR-B (CPU):** WhisperLiveKit + faster-whisper large-v3-turbo int8 — latência de parcial e WER percebido em pt coloquial no CPU alvo.
6. **Régua:** mesmas 20 frases no ElevenLabs Flash v2.5 (pt-BR) para ancorar expectativa de qualidade/latência.

## 16. O que mudou em 2025→2026 (para não pesquisarmos de novo)

- Jan/2026: **Qwen3-TTS** aberto (Apache, pt, streaming) — primeiro TTS LLM-based aberto com pt e licença limpa.
- Fev/2026: **Voxtral Realtime** (ASR streaming aberto com pt, Apache).
- Mar/2026: **Voxtral TTS 4B** (pt, 70ms, mas **CC-BY-NC** → fora para produção).
- Abr/2026: **Supertonic 3** (31 línguas incl. pt, CPU absurda, OpenRAIL-M).
- Jun/2026: **Chatterbox Multilingual v3 + pack dedicado pt-BR** (MIT) — provável novo padrão para pt-BR aberto.
- Tendência: latência aberta em GPU já alcançou a classe dos clouds; o gargalo pt-BR virou **qualidade conversacional/expressividade**, não cobertura.
