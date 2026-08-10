# Engine candidata v0 — instalação, configuração principal e demo

Branch `engine/candidata-v0`: extração seletiva dos mecanismos que
sobreviveram à exploração (`exp/caminho-ouro`, onde ficam probes, WAVs e
evidências). Mecanismos: TTS plugável com streaming progressivo; contrato
de arbitragem (LOCAL_FINAL/BRIDGE/PASS, abstencionista); fast-path
determinístico com skills de hora/data; bridge de correção (in-turn e
cross-turn) com no-repeat no reasoner; especulação segura (kernel puro,
commit por versão-base, effectsAllowed preparado); divisão
interaction/task reasoner; telemetria por turno (fim→voz semântica,
fim→ack, tts.first-byte, render.first-audible, speculation.*).

## Instalação (máquina limpa)

```bash
git clone <repo> && cd duplex-lab-ptbr && git checkout engine/candidata-v0
npm ci
npm run setup:asr        # venv Whisper/Parakeet
npm run setup:vad        # Silero v6.2
bash scripts/setup-engine-voices.sh   # Pocket TTS PT + Piper pt-BR (SHA pinado)
cp .env.example .env     # + OPENAI_API_KEY
```

## Configuração principal (a engine)

```bash
FAST_PATH=1 TTS_PROVIDER=pocket BRAIN_PROVIDER=openai \
OPENAI_INTERACTION_MODEL=gpt-5.4-mini OPENAI_TASK_MODEL=gpt-5.6-luna \
VAD_CONTROL=silero VAD_SHADOW=silero SILERO_VAD_THRESHOLD=0.85 \
SILERO_VAD_ONSET_WINDOWS=1 node src/cli/serve.mjs
```

Navegador (Chrome): `http://localhost:4173/` — especulação, fast-ack e
streaming progressivo são **padrão** (`?spec=0&ack=0&ttsstream=0` desliga;
com TTS windows o streaming desliga sozinho). Racional dos modelos:
5.4-mini completa a 1ª frase ~4× mais rápido que luna na interação; luna
segue nas delegações. Voz padrão pocket/rafael **pendente do veredicto de
ouvido** (fallbacks: `TTS_PROVIDER=piper` | `windows`).

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

`FASTPATH_LOG=caminho.jsonl` é **opt-in** e coleta {timestamp, sessionId,
texto do turno, decisão da engine}. Antes de rotular: (1) consentimento
explícito de quem falou; (2) pseudonimização (hash do sessionId, remoção
de nomes/valores pessoais no texto quando pedidos); (3) retenção definida
por lote; (4) **a decisão da engine NÃO é ground truth** — todo rótulo é
atribuído por revisor com as classes LOCAL_FINAL/BRIDGE/CLARIFY/PASS do
conjunto `probes/data/fastpath-turns.pt-BR.json` (na branch de pesquisa).

## Limites conhecidos da v0

TTS windows não suporta GET streaming (fallback automático a blob);
cobertura do fast-path é a whitelist determinística (4,2% no corpus do
lab; fática real maior); ensemble discriminativo e detector de turno
aguardam dados rotulados; PersonaPlex/nativo é trilha de pesquisa.
