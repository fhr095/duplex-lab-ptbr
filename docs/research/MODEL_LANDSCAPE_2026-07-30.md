# Panorama de modelos abertos — 30/07/2026

Status: **snapshot técnico de candidatos**. A ordem operacional vigente está na
[referência macro](../PROJECT_REFERENCE.md); em 31/07/2026, a fábrica autônoma
de avaliações passou à frente de coleta humana e de novos backbones.

## Conclusão executiva

Não há hoje um vencedor confirmado que reúna simultaneamente:

1. full-duplex nativo convincente;
2. português brasileiro forte na entrada e na saída;
3. pesos e treinamento adaptáveis;
4. custo acessível para esta máquina/equipe.

Portanto, escolher um único backbone agora seria prematuro. A estratégia de
maior retorno é um torneio curto sob o evaluator PT-BR, com três papéis
separados:

- **baseline de produto:** cascata modular PT-BR, agora funcional;
- **referência de interação:** modelos nativos full-duplex;
- **candidato de adaptação:** base pequena com receita de fine-tuning.

## Candidatos

| Candidato | Evidência útil | Gap principal | Papel inicial |
| --- | --- | --- | --- |
| Parakeet TDT 0.6B v3 | 25 idiomas incluindo português, licença CC-BY-4.0 e checkpoint ajustável. Via ONNX INT8, rodou nesta CPU com RTF p50 0,13 e WER CORAA 38,03%. | A própria NVIDIA alerta para treino PT-PT versus benchmarks PT-BR; em clipes curtos houve final vazia e troca para inglês. | ASR final rápido promovido, com reconciliação e futuro verificador seletivo. |
| Qwen3-Omni-30B-A3B | O repositório declara entrada de fala em 19 idiomas e saída em 10, incluindo português, além de streaming em tempo real. | Não está demonstrado no material consultado que continue ouvindo enquanto fala; 30B total torna adaptação cara. | Referência de qualidade PT e teacher. |
| MiniCPM-o 4.5 (9B) | Full-duplex real com entrada e saída concorrentes; demo WebRTC; 28 GB VRAM em precisão completa e opção quantizada a partir de 12 GB. | A fala é anunciada como bilíngue inglês/chinês, não português. | Referência compacta de mecanismo full-duplex. |
| Lychee-FD | Full-duplex nativo, separação semântico-acústica, pesos e serving publicados sob Apache-2.0. | Model card marca inglês/chinês; runtime recomenda GPUs para backbone e Token2Wav. | Referência arquitetural e possível transferência. |
| BayLing-Duplex | Converte GLM-4-Voice com tokens de estado; checkpoint de aproximadamente 19,1 GB; código/modelo disponíveis. | Português não é anunciado; precisa ser testado antes de qualquer compromisso. | Teste da hipótese “conversão simples funciona”. |
| PersonaPlex / Moshi | Full-duplex maduro, interrupção e persona; ecossistema de serving aberto. | Treino e exemplos são centrados em inglês; licença dos pesos deve ser revisada para o uso pretendido. | Referência comportamental, não base PT imediata. |
| LFM2.5-Audio-1.5B | Speech-to-speech compacto, geração intercalada e receita oficial de fine-tuning. | O fluxo publicado é por turnos, não full-duplex nativo; PT-BR precisa de avaliação/adaptação. | Melhor hipótese de treinamento barato. |
| DuplexCascade | Cascata VAD-free com micro-turnos e tokens de controle; código MIT. | Backends publicados de ASR/TTS não fecham PT-BR prontos. | Blueprint do primeiro modelo de interação modular. |
| SoulX-Duplug 0.6B | Semantic VAD streaming plugável, checkpoints e treino publicados; aprende `idle/non-idle/speak/blank`. | Configuração oficial está centrada em chinês/inglês e usa buffer ASR de 3,2 s; não há evidência PT-BR. | Candidato direto ao futuro peso de interação, não ao ASR atual. |
| Easy Turn | Classifica `complete/incomplete/backchannel/wait` com sinais acústicos e linguísticos; projeto reporta runtime compacto. | Dados/demos consultados são majoritariamente chineses e o artefato ainda não fechou serving PT-BR local. | Referência para rótulos e evaluator de turn-taking. |

## Fontes primárias

- [Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni)
- [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [onnx-asr](https://github.com/istupakov/onnx-asr)
- [MiniCPM-o 4.5](https://github.com/OpenBMB/MiniCPM-V)
- [Lychee-FD — código](https://github.com/HITsz-TMG/Lychee-FD) e
  [model card](https://huggingface.co/HIT-TMG/Lychee-FD)
- [BayLing-Duplex — model card](https://huggingface.co/BayLing-Models/BayLing-Duplex)
- [PersonaPlex](https://github.com/NVIDIA/personaplex)
- [Moshi](https://github.com/kyutai-labs/moshi)
- [Liquid Audio / LFM2.5](https://github.com/Liquid4All/liquid-audio)
- [DuplexCascade](https://github.com/sbintuitions/DuplexCascade)
- [Full-Duplex-Bench](https://github.com/DanielLin94144/Full-Duplex-Bench)
- [DuplexSLA](https://github.com/hyzhang24/DuplexSLA)
- [SoulX-Duplug](https://github.com/Soul-AILab/SoulX-Duplug)
- [Easy Turn](https://aslp-lab.github.io/Easy-Turn/)
- [HumDial-FDBench](https://github.com/ASLP-lab/HumDial-FDBench)

## Correções à pré-análise

As ideias da pré-análise são boas, mas alguns itens precisam de qualificação:

- DuplexSLA é uma referência arquitetural valiosa, porém o repositório ainda
  informa que checkpoint, inference code e benchmark estão “coming soon”. Não é
  base operacional hoje.
- “Streaming speech-to-speech” não implica full-duplex. O teste precisa provar
  entrada concorrente durante a saída, barge-in e retomada.
- Sucesso em inglês/chinês não prevê qualidade PT-BR. Tokenizer, decoder,
  prosódia e dados precisam ser avaliados separadamente.
- Um checkpoint disponível não garante licença adequada para produto,
  fine-tuning ou redistribuição.
- Resultados publicados usam hardware, datasets e condições diferentes; não
  devem ser comparados diretamente fora do nosso harness.

## Decisão recomendada

### Agora

Manter a baseline modular promovida e ampliar primeiro o instrumento que decide
os próximos investimentos:

1. fábrica de cenários, crítica, contrafactuais e áudio ambientalizado por IA;
2. PT-BR curto/ruidoso, correções e slots críticos encontrados pela fábrica;
3. torneio local de TTS e cérebro aberto;
4. loopback físico e julgamento humano somente entre finalistas maduros.

### Primeiro sweep em GPU

1. Qwen3-Omni: PT-BR e semântica.
2. MiniCPM-o, Lychee-FD e BayLing: interrupção e timing, mesmo que o PT falhe.
3. LFM2.5-Audio: custo, latência e facilidade de adaptação.
4. PersonaPlex: referência full-duplex em inglês para validar o evaluator.

### Primeiro treino

Preferir um modelo de interação leve, inspirado na ideia de micro-turnos do
DuplexCascade, antes de retreinar um backbone acústico de 7–30B. Ele pode usar
um LLM aberto pequeno, dados PT-BR e as ações já definidas neste repositório.

### Gate para mudar de rumo

Partir para adaptação nativa somente se a baseline modular demonstrar um teto
mensurável em naturalidade, sobreposição ou timing que não seja explicado por
runtime, AEC, ASR, TTS ou dados. A latência modular simples já ficou abaixo de
1 s nesta máquina; o argumento a favor de um backbone nativo terá de vir de
qualidade percebida, prosódia ou sobreposição, não de uma suposição.

## TTS local: decisão provisória

Kokoro-82M possui vozes PT-BR explícitas, mas o probe CPU local levou cerca de
461–500 ms até gerar respostas de uma palavra, contra aproximadamente 100 ms do
worker Windows aquecido; o próprio card alerta para fraqueza em textos muito
curtos. Pocket-TTS e MOSS-TTS-Nano continuam candidatos de streaming/voz
própria. Benchmarks e críticos de IA podem reduzir autonomamente o torneio;
promoção perceptiva final continua reservada a A/B auditivo entre os poucos
finalistas que passarem latência, cancelamento, custo e inteligibilidade.
