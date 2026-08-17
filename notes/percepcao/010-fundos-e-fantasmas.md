# 010 — Bancada de fundos sintéticos: curva SNR, turnos-fantasma e o leito do detector de vozes (2026-08-17)

Continuação do 009. O usuário adiou os testes vivos (registrados como
pendência) e autorizou saltos pelo caminho sintético. Ferramentas novas
(obs@592c310): replay com `--fundo/--snr/--fundo-offset` (mistura fundo
contínuo sobre a voz gravada, SNR contra o RMS da fala ativa),
`gerar-fundos-cena.mjs` (burburinho PT de 3 camadas com vozes CORAA —
avaliação local apenas; ruído rosa determinístico; locutor contínuo M2 e
anúncios F2 via Supertonic local) e `observador-replay-fundos.sh`
(bancada de 1 comando). Música real = captura ambiente do usuário.
Rótulo perfeito por construção. Limites honestos documentados no
cabeçalho do replay: a soma digital não simula AGC/AEC do navegador,
reverberação, ducking nem efeito Lombard.

## Curva SNR (janela limpa de referência com 10 finais; 12/8/5/2 dB)

- MÚSICA REAL: turn-taking resiste (8/6/6/6 finais até 2 dB); o dano é
  no TEXTO; a cena flagra as passagens fortes; Regra 1 + anti-loop
  exercitados de ponta a ponta sem falso positivo em cena limpa. Em
  8 dB uma confirmação segurou um final de 14 palavras com áudio ≤4 s
  (braço do OU) — sinergia correta: texto longo em áudio curto é
  fisicamente suspeito.
- BURBURINHO: colapso em QUALQUER SNR (2 finais já a 12 dB; ~0 a 2 dB).
  Morte por VAD-sem-silêncio (turno aberto até o teto de 30 s,
  concatenação vira sopa) e vozes do fundo entram como conteúdo do
  usuário. Cena `limpa` em tudo (Music ~0,02) — por desenho.

## Turnos-fantasma (silêncio digital do usuário + fundo a ~-35 dBFS)

| fundo | fantasmas em 120 s | observação |
|---|---|---|
| rádio-falado (locutor) | **13** | frases do locutor transcritas quase perfeitas; com cérebro real, 13 respostas a ninguém |
| anúncios de loja | **9** | cada rajada vira turno |
| burburinho | **0** | murmúrio difuso baixo não cruza o onset (0,85) — só mata quando COMPETE com fala |
| música real | **0** | silero ignora música sozinha, como esperado |

O caso rádio é o pior do produto em ambiente doméstico real (TV/rádio
ligado = conversa infinita) e é INVISÍVEL às defesas atuais: cena diz
`limpa` (é fala, não música — correto por classe) e o duty do VAD NÃO
satura (o locutor tem pausas → turnos fecham normalmente, como fala de
usuário). A assimetria completa: o fantasma exige VOZ CLARA em nível
moderado; burburinho difuso e música sozinhos não abrem turno — o
silero é um bom detector de fala, e é exatamente por isso que fala
clara alheia passa por fala do usuário.

## Leito do detector "ambiente de vozes" (features grátis, computáveis ao vivo)

dutyVad = fração do tempo em fala (dos eventos user.speech.* que a
engine já emite); maxDuty60 = pior janela rolante de 60 s.

- Burburinho (4 SNRs): dutyVad 0,861–0,971 · maxDuty60 0,959–0,987.
- Limpas/música/rosa sintéticas (7): dutyVad 0,150–0,307.
- SESSÕES VIVAS REAIS (FPR): maxDuty60 0,341–0,594–0,606–**0,708** (o
  0,708 é o minuto do monólogo que estourou o teto na e2c0).

Proposta: gatilho `maxDuty60 ≥ 0,85` (2 janelas consecutivas p/
endurecer) → FPR 0 em todas as sessões reais disponíveis e recall 100%
no burburinho sintético. Margem real-x-adverso = 0,708×0,959 — leito
pequeno (3 sessões vivas, 1 falante); cada sessão viva futura engorda a
base de FPR de graça (telemetria já emite os eventos). SÓ pega
burburinho denso; NÃO pega rádio/voz clara (ver abaixo). PROMOÇÃO:
travada em gravação real de ambiente de vozes (pendência do usuário,
registrada).

## Consequência na fila: challenger de VERIFICAÇÃO DE FALANTE

O fantasma de rádio demonstra que voz clara de fundo é indistinguível
do usuário por atividade, classe acústica ou cena — a separação exige
IDENTIDADE (é a voz do dono?) ou ENDEREÇAMENTO (fala comigo?). O
gatilho da frente adormecida disparou SINTETICAMENTE, e a bancada já
produz o leito de graça: positivos = voz do usuário nos pacotes reais
(horas); negativos = fantasmas de locutor/anúncio/CORAA ilimitados.
Candidatos naturais (varredura 001): embeddings pequenos de falante
(ECAPA-TDNN/CAM++/análogos ONNX, ~20 MB, CPU) rodando por turno em
paralelo como a cena. NÃO integrado — entra como PRÓXIMO CHALLENGER da
fila, um a um contra o leito, sob a régua de sempre.

## Estado

- Ação de cena: inalterada (correta no seu escopo; música coberta).
- Detector ambiente-de-vozes: leito pronto, gatilho proposto, dormindo
  até gravação real (FPR) — mas o mecanismo é barato e o dano do
  burburinho é total (colapso), então a priorização sobe.
- Verificação de falante: challenger aberto com leito sintético pronto.
- Pendências do usuário (não bloqueiam nada): T4 vivo com música;
  gravação real shopping/rádio; escolha de voz F4×M1.
