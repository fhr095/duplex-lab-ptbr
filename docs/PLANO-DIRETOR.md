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
(música ambiente, anúncios, vozes ao fundo), autocustódia em CPU
(máquina de 8 GB, sem GPU em runtime), com "cérebro" LLM externo
substituível na ponta. Consequências de desenho:

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
perfeito por construção — e endurecer a engine **um desafio por vez**,
com descoberta/calibração/regressão baratas em replay. Teste humano
vivo é escasso e caro: serve para PROMOVER o que a bancada já provou,
nunca para descobrir.

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

**Abertos com leito pronto (contribuição direta possível):**
- **Vozes-ambiente (burburinho)**: colapso do VAD medido em qualquer
  SNR; detector proposto `maxDuty60 ≥ 0,85` com FPR 0 nas sessões
  reais disponíveis (probes/percepcao/leito-ambiente-vozes.mjs;
  notes/percepcao/010). Promoção travada em gravação real.
- **Voz-da-sessão (turnos-fantasma)**: rádio-falado gera 13 fantasmas/
  120 s a volume doméstico; separação exige consistência de voz
  EFÊMERA da sessão (embedding em RAM, descartado ao fim). Challenger
  aberto: modelos de speaker embedding pequenos (ONNX/CPU) contra o
  leito de fantasmas. Perguntas de desenho em aberto: âncora de início
  de sessão (sinal não-acústico do produto?) e multiusuário legítimo.

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
