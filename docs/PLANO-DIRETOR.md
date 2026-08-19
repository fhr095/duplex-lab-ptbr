# Plano diretor — engine duplex PT-BR (2026-08-18)

Autoridade estratégica ATUAL do projeto. Substitui a direção dos
documentos da era pré-engine (`PROJECT_REFERENCE.md`, `PRODUCT.md`,
`ROADMAP.md` — mantidos como histórico congelado com banner). Este
documento existe para auditoria externa: cada afirmação aponta para a
evidência versionada; críticas devem atacar os leitos e as réguas, não
opiniões.

## 1. Tese do produto

Engine de conversa por voz **full-duplex em PT-BR** para interações
reais em **espaços públicos** (totens/instalações): usuários ROTATIVOS
(cada hora uma voz, sem cadastro), ambiente acústico ADVERSO por padrão
(música ambiente, anúncios, vozes ao fundo), autocustódia em CPU sem
GPU em runtime — **alvo de hardware: até 16 GB de RAM** (premissa
original do produto; a máquina de desenvolvimento de 8 GB é o piso
conservador em que tudo é medido, não o teto que corta challengers) —
com "cérebro" LLM externo substituível na ponta. Consequências de desenho:

- identidade de voz só pode ser **efêmera por sessão** (nunca
  enrollment persistente; LGPD em espaço público);
- robustez a fundo sonoro não é edge case — é o REGIME de operação;
- tudo que é reflexo, proteção e reparo fala **localmente** (a engine
  nunca fica muda por falha do cérebro — docs/CANDIDATA-V1.md §3);
- multiusuário simultâneo (duas pessoas interagindo juntas) é cenário
  legítimo, não invasão — restringe os desenhos possíveis de gate de
  voz.

## 2. Arco estratégico

A candidata v1 (docs/CANDIDATA-V1.md) provou a conversa na sala
comportada. A fase atual: **fabricar o mundo adverso em bancada** —
adversidade sintética determinística sobre gravações reais, com rótulo
perfeito por construção — e endurecer a engine **um desafio por vez**.

O ciclo metodológico (corrigido em 2026-08-18; a formulação anterior
"humano nunca descobre" contradizia a própria história da frente —
a6c1, 36ed e e2c0 foram descobertas humanas):

**descoberta humana → reprodução sintética → correção em bancada →
promoção humana.** Sessões vivas são o radar de falhas novas e o
carimbo final; a bancada é onde a falha vira caso reproduzível,
correção calibrada e regressão permanente. O que muda com a bancada é
que o humano deixa de ser o GARGALO do meio do ciclo — não que deixe
de ser a fonte e o juiz das pontas.

Sequência de desafios (estado em §4): música ✓ → vazios/alucinação sob
som ✓ → vozes-ambiente (leito pronto) → voz-da-sessão (challenger
aberto) → multi-pessoa/endereçamento (adormecido com gatilho).

## 3. Doutrina operacional (como se decide e se constrói)

1. **Espinha determinística; decisão em código puro.** O caminho da
   conversa é pipeline explícito (VAD → ASR streaming → kernel →
   cérebro → TTS). Toda política é máquina de estados PURA e testada
   (`web/absorcao-turno.mjs`, `web/gate-entrada.mjs`,
   `src/interaction/confirmacao-cena.mjs` + testes em `tests/`).
   Modelo emite SINAL (trace); código com limiar calibrado em leito
   AGE.
2. **Sensores = modelos prontos, pequenos, em paralelo.** Silero VAD,
   TAGARELA int8, Kroko 64-L, tagger AudioSet 26 MB — todos prontos,
   ONNX/CPU, fora do caminho crítico de latência. Entram UM A UM
   batendo o leito; reputação não pontua (SmartTurn 0,606, Namo morto,
   Qwen-professor reprovado — notes/percepcao/005-006 na
   exp/percepcao-v0).
3. **Features grátis antes de modelo.** Comprimento-invertido venceu o
   SmartTurn (0,626×0,606); duty-cycle do VAD detecta burburinho sem
   modelo novo (notes/percepcao/010); graves/voz é fallback da cena.
   Complexidade só se compra quando o grátis perde no leito.
4. **Benchmark é o motor.** Nada entra sem leito; nada promove sem a
   régua T1–T5 (docs/CANDIDATA-V1.md §2). Ferramentas: replay pelo
   caminho de produção com janela e fundo
   (`scripts/observador-replay.mjs --desde/--ate/--fundo/--snr`),
   bancada de fundos (`scripts/observador-replay-fundos.sh`), fundos
   determinísticos (`scripts/gerar-fundos-cena.mjs`), leitos e
   harnesses em `probes/percepcao/` (exp/percepcao-v0).
5. **Fine-tuning adormecido por desenho.** Só acorda com telemetria de
   dano residual que sensor pronto + política não cubram (gatilhos
   registrados em notes/percepcao/006 §C). Hoje: zerado.
6. **Cérebro trocável; áudio-nativo é teto de pesquisa.** Adaptador
   LLM na ponta (OpenAI hoje; contrato cancelável). Modelos
   fala-a-fala nativos foram MEDIDOS como bloqueados por idioma
   (notes na exp/caminho-ouro; retratações v2.1) — seguem como régua
   de teto, não como caminho.

## 4. Mapa de desafios (para atacar, criticar ou contribuir)

**Resolvidos (com evidência e aceite):**
- Turn-taking em fala limpa: endpoint adaptativo + commit-revisável +
  gate-de-entrada (validados ao vivo; telemetria `turno.absorvido.*`,
  `reproducao.gate`).
- Surdez catastrófica/monólogos; morte muda do cérebro
  (docs/CANDIDATA-V1.md §3-§4).
- Música/cena adversa: tagger + confirma-antes-de-agir + mensagens
  específicas (spec notes/percepcao/008; aceite 009 — replay reproduz
  a falha real e a corrige; falta só T4 vivo, pendência registrada).

**Propriedade/endereçamento da fala — pesquisa FECHADA
(notes/percepcao/011–016):** conclusão, na classificação honesta:
**câmera grossa PROMOVIDA AO PRÓXIMO PROBE DE PRODUTO** (não
"empiricamente vencedora" — as 3 derivações no produto e a medição com
sinais REAIS nos cenários congelados continuam pendentes); speaker
embedding CORTADO do caminho principal (adormecido com gatilhos:
medição real falhar | instalação sem câmera | agrupamento
insuficiente). Arquitetura decidida: endereçamento POR ENUNCIADO
(presença + proximidade/orientação + atividade labial em JANELA — não
distância instantânea de landmarks: movimento ao longo da janela,
confiança, pose, oclusão, múltiplos tracks, sensor-indisponível) +
prior de indiferença por fonte (nunca decide sozinho — células N/M) +
pool só p/ cena/autoridade + BARREIRA DE AUTORIDADE fail-closed com
broker único e lease estruturado/escopado/expirável/one-shot
(src/tools/autoridade.mjs; Open-Meteo = leitura pública, e o registro
reconhece: fala fantasma ainda pode dispará-lo — protegida por
construção está a primeira ferramenta sensível/mutável). Sequência:
sessão humana holística da engine ATUAL (avalia políticas vivas, NÃO a
câmera) → adapter mínimo Habitat→engine → cenários congelados com
sinais reais → decisão final promover-câmera × reabrir-embedding.
- **Vozes-ambiente (burburinho)**: colapso do VAD medido em qualquer
  SNR; detector proposto `maxDuty60 ≥ 0,85` com FPR 0 nas sessões
  reais disponíveis (probes/percepcao/leito-ambiente-vozes.mjs;
  notes/percepcao/010). Promoção travada em gravação real.
- **A cena é um VETOR de eixos triestados** (adversa|limpa|
  indisponivel por eixo; hoje só "musica" tem detector promovido) —
  "limpa" significa "sem adversidade detectada no eixo", nunca
  "entrada confiável"; "indisponivel" jamais se disfarça de limpa.

**Adormecidos com gatilho explícito (não reabrir sem o gatilho —
notes/percepcao/006 §C):** fine-tune de endpoint; MaAI/VAP
(multi-falante endereçado); pontuador streaming PT; Step-Audio R1.5;
emoção (SenseVoice/emotion2vec — ação desenhada); microscópio como
anotador de cena.

## 5. Como auditar e contribuir

- **Linha de raciocínio completa**: notes/percepcao/000–010 na branch
  `exp/percepcao-v0` (mandato → varredura → leitos → vereditos →
  specs → aceites). Engine e políticas: branch `obs/observador-v0`;
  cortes promovidos: `engine/candidata-vN` congeladas + `main`.
- **Reproduzir**: `AGENTS.md` (operação), `docs/ENGINE.md`
  (instalação), `bash scripts/clean-room.sh` (release limpo),
  evidência sanitizada versionada em `eval/evidencia/`.
- **Privacidade**: gravações/transcrições reais vivem em `var/`
  (LOCAL, gitignorado, por desenho). Auditoria externa opina sobre
  agregados sanitizados e sobre o MÉTODO; replays com dados reais
  rodam na máquina do dono dos dados.
- **Para derrubar um veredito**: traga fato novo AO LEITO (novo caso
  real, nova métrica, erro no harness) — os leitos são reexecutáveis;
  opinião sem leito não move a fila.

## 6. Riscos e limites reconhecidos

- Política conversacional calibrada com n=1 falante (usuário primário
  é o espec da fase); primeira evidência multiusuário pendente.
- Bancada sintética não simula AGC/AEC do navegador, reverberação,
  ducking nem efeito Lombard — SNRs reais tendem a ser mais brandos
  (documentado no cabeçalho do replay).
- Voz-da-sessão: risco de enrolar na voz errada se a sessão começar
  sob fala alheia — depende da âncora de início de sessão do produto.
- Dependências e licenças por peça: docs/CANDIDATA-V1.md §5 (inclui
  restrições: CORAA só avaliação; OpenRAIL-M do TTS exige revelar voz
  sintética).

## 7. Pendências humanas registradas (não bloqueiam a roda)

1. T4 vivo da ação de cena (sessão com música perto do mic).
2. Gravação real em ambiente de vozes (promove o detector §4).
3. Escolha de voz F4×M1 (gosto; seletor na página).
