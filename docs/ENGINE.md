# Engine candidata v1 — instalação, configuração principal e demo

Branch `engine/candidata-v1` (manifesto e ledger de evidência:
docs/CANDIDATA-V1.md; a v0 é histórica — PR #1 fechado, baseline
congelada v0.3 reproduzível por env). Mecanismos: TTS plugável com streaming progressivo; contrato
de arbitragem (LOCAL_FINAL/BRIDGE/PASS, abstencionista); fast-path
determinístico com skills de hora/data; bridge de correção (in-turn e
cross-turn) com no-repeat no reasoner; especulação segura (kernel puro,
commit por versão-base, effectsAllowed preparado); divisão
interaction/task reasoner; telemetria por turno (fim→voz semântica,
fim→ack, tts.first-byte, render.first-audible, speculation.*).

## Instalação (máquina limpa)

```bash
git clone <repo> && cd duplex-lab-ptbr && git checkout main
npm ci
npm run setup:asr        # venv Whisper/Parakeet
npm run setup:vad        # Silero v6.2
bash scripts/setup-engine-voices.sh   # Supertonic pinado + Pocket/Piper fallbacks
bash scripts/setup-kroko.sh           # parciais streaming PT (sha256 pinado)
cp .env.example .env     # + OPENAI_API_KEY (só segredos/opt-ins)
```

Arranque: `bash scripts/start-candidata.sh` (perfil único da candidata,
com pré-checagem de setup). Verificação: `GET /api/health`.

## Configuração principal (candidata v1 — ver docs/CANDIDATA-V1.md)

```bash
bash scripts/start-candidata.sh   # PERFIL ÚNICO: pina kroko+supertonic
```

O manifesto da candidata (docs/CANDIDATA-V1.md) registra o ledger de
mecanismos, a régua de evidência e as licenças. Config da RC v0.1
(baseline congelada v0.3) segue disponível por env:

```bash
FAST_PATH=1 TTS_PROVIDER=pocket BRAIN_PROVIDER=openai \
ASR_FINAL_MODEL=nemo-parakeet-tdt-0.6b-v3 \
OPENAI_INTERACTION_MODEL=gpt-5.4-mini OPENAI_TASK_MODEL=gpt-5.6-luna \
VAD_CONTROL=silero VAD_SHADOW=silero SILERO_VAD_THRESHOLD=0.85 \
SILERO_VAD_ONSET_WINDOWS=1 node src/cli/serve.mjs
```

Navegador (Chrome): `http://localhost:4173/` — especulação, fast-ack e
streaming progressivo são **padrão** (`?spec=0&ack=0&ttsstream=0` desliga;
com TTS windows o streaming desliga sozinho). Racional dos modelos:
5.4-mini completa a 1ª frase ~4× mais rápido que luna na interação; luna
segue nas delegações. Voz padrão: **Supertonic F4** (veredicto de ouvido
2026-08-15; rafael/pocket rejeitada; seletor F1..M5 na página; fallbacks
`TTS_PROVIDER=pocket|piper|windows`).

`TTS_PROVIDER=supertonic` liga o Supertonic-3 local (sidecar na 8341, voz
via `SUPERTONIC_VOICE`, F1..F5/M1..M5, padrão F4; `SUPERTONIC_STEPS=4`
dobra a velocidade com qualidade a validar). Antes de QUALQUER provider a
engine converte números→extenso PT no texto falado
(`src/tts/normalizar-texto-pt.mjs`): horas, datas, R$, %, graus, ordinais,
faixas e decimais; o texto exibido continua original. Licença OpenRAIL-M
do Supertonic exige deixar claro ao usuário que a voz é sintética.

## Demo de 10–15 min (comportamentos principais)

1. "Oi, tudo bem?" → LOCAL_FINAL (~50ms de rota; voz em ~1s).
2. "Que horas são?" / "Que dia é hoje?" → skills determinísticas.
3. "O valor é de trezentos reais." → PASS com memória. Depois:
   "Na verdade, quatrocentos reais." → BRIDGE cross-turn («Entendi:
   R$ 400.») com continuação sem repetição.
4. "Transfere R$ 350. Na verdade, R$ 400." → interlock de confirmação
   crítica (kernel manda; reasoner não fala).
5. "Me explica juros compostos" e INTERROMPA no meio → corte <200ms;
   "aham" durante a fala → ela continua.
6. "Pesquisa as três melhores opções de CDB" → delegação com
   acknowledgment e resultado assíncrono; continue conversando no meio.
7. Fale com hesitação ("Eu queria… hum… mudar o horário") → sem corte.
8. Métricas ao vivo no log da página: `assistant.response.audible`
   (fim→voz semântica), `assistant.ack.audible`, `speculation.adopted`,
   `turn.fast-path`.

## Dados de uso (governança)

`OBSERVER=1` grava uma sessão completa (áudio do mic, sínteses, eventos,
marcações) para o observador de experiência — opt-in, local, fora do Git;
regras, análise em duas passagens e exclusão em **docs/OBSERVADOR.md**.

`FASTPATH_LOG=caminho.jsonl` é **opt-in** e coleta {timestamp, sessionId,
texto do turno, decisão da engine}. Antes de rotular: (1) consentimento
explícito de quem falou; (2) pseudonimização (hash do sessionId, remoção
de nomes/valores pessoais no texto quando pedidos); (3) retenção definida
por lote; (4) **a decisão da engine NÃO é ground truth** — todo rótulo é
atribuído por revisor com as classes LOCAL_FINAL/BRIDGE/CLARIFY/PASS do
conjunto `probes/data/fastpath-turns.pt-BR.json` (na branch de pesquisa).

## Limites conhecidos

TTS windows não suporta GET streaming (fallback automático a blob);
cobertura do fast-path é a whitelist determinística (4,2% no corpus do
lab; fática real maior); ensemble discriminativo e detector de turno
aguardam dados rotulados; PersonaPlex/nativo é trilha de pesquisa.
