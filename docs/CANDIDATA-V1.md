# Candidata v1 — manifesto de promoção (2026-08-15)

A `engine/candidata-v0` (RC v0.1, PR #1) virou snapshot histórico: a linha
`obs/observador-v0` — criada como camada de observação — tornou-se, na
prática, a linha principal (22 commits, +4.382 linhas de engine sobre a
RC). Este documento consolida o que isso significa: **qual configuração é
a candidata v1**, que evidência sustenta cada mecanismo, o que permanece
experimental, e as regras para os próximos ciclos não misturarem pesquisa,
observação e produto.

## 1. A candidata, inequivocamente

```bash
# setup (uma vez)
bash scripts/setup-kroko.sh          # parciais streaming PT (CC-BY-SA)
bash scripts/setup-engine-voices.sh  # Supertonic pinado + fallbacks
cp .env.example .env                 # + OPENAI_API_KEY (segredos/opt-ins)

# arranque — PERFIL ÚNICO (toda a config da candidata vive nele)
bash scripts/start-candidata.sh
# com observador: OBSERVER=1 bash scripts/start-candidata.sh
```

**Contrato de configuração**: o perfil (`start-candidata.sh`) pina o que
difere do default de código; `.env` guarda somente segredos e opt-ins e
NÃO redefine política da candidata (o loader não sobrescreve env real,
mas preenche o que faltar — por isso o `.env.example` não pina valores de
política). Evidência versionada: `eval/evidencia/candidata-v1/`.

Defaults já promovidos no código (não precisam de env): final ASR =
**TAGARELA int8** (`calneymgp/parakeet-tdt-0.6b-v3-ptBR-TAGARELA-onnx-int8`),
teto de enunciado = 30 s, normalização números→extenso antes de qualquer
TTS, voz padrão F4 com seletor na página, cérebro = OpenAI
(`gpt-5.4-mini` interação / `gpt-5.6-luna` tarefas), guarda anti-runaway
de 400 chamadas/processo, VAD Silero 0.85/1 janela, especulação +
fast-ack + streaming de TTS ligados.

## 2. Régua de evidência (a resposta para "replay verde = promover?")

Replay verde NÃO é evidência suficiente de promoção. A régua usada aqui,
em ordem de força:

- **T1 — verdade independente**: dataset com transcrição humana e vozes
  que não são do usuário primário (CORAA, 12 clipes espontâneos).
- **T2 — replay held-out**: bateria de sessões gravadas que NÃO motivaram
  a mudança (hoje: 8 sessões-chave).
- **T3 — estrutural**: correção de bug de máquina de estados/semântica de
  linguagem, coberta por teste de regressão — promove sem T1/T2 porque
  não há parâmetro calibrável ao usuário.
- **T4 — sessão viva fresca**: o defeito original não recorre e a escuta
  cega não acusa efeito colateral.
- **T5 — só replay motivador / só gosto**: fica atrás de flag ou marcado
  provisório.

Risco reconhecido: política conversacional (retenção, concatenação,
limiares de endpoint) é validada com n=1 falante (T2+T4). É a natureza da
fase — usuário primário é o espec — e está flaggeada onde há parâmetro.

## 3. Ledger de mecanismos (v0 → v1)

| Mecanismo | Classe | Evidência | Estado v1 |
|---|---|---|---|
| Fetch binding da especulação | correção estrutural | T3 (teste de semântica de navegador) | promovido |
| Surdez-1: teto→finish idempotente | correção causal | T3+T2 (replay 2e22) | promovido |
| Surdez-2: resumed órfão→onset | correção causal | T3+T2 (replay bd30, telemetria refutou hipótese de limiar) | promovido |
| Concatenação de fala retida | política | T2+T4 (replay 132 s verbatim; viva ok) | promovido |
| Portão de idioma PT×EN na retenção | heurística | T5 (1 incidente f064); população de gatilho esvaziada pelo TAGARELA | mantido (barato, inofensivo), marcado heurística |
| TAGARELA int8 no final | troca de peça | **T1** (CORAA 0,109 vs 0,322 fp32 vs 0,452 int8 genérico) + T2 + T4 | **promovido a default de código** |
| Kroko 64-L nas parciais | troca de peça | **T1** (CORAA 0,387 vs 0,71 do tiny — ~2× melhor em vozes independentes) + T2 + T4 (36ed sem queixa de parciais) | promovido (via env na config candidata) |
| Teto de enunciado 20 s | mitigação obsoleta | motivada pela crise fp32, dissolvida pelo TAGARELA | **revertido para 30 s default** (bateria confirma) |
| Contexto do final (ASR_FINAL_CONTEXT_MS) | experimental | T5 — replay revelou inversão/duplicação/vazamento | **OFF por default** (flag existe; requer strip por decode) |
| Continuação pós-interrupção | política | testes de unidade; **sem exercício vivo** (36ed não teve interrupção); risco de confundir complemento×correção×rejeição×cancelamento | **atrás de flag, OFF na candidata** (`CONTINUACAO_POS_INTERRUPCAO=1` só em sessão de roda, até T4) |
| Números→extenso | normalização | 13 testes + assert semântico (TAGARELA sobre o WAV) + doctor | promovido (todos os providers) |
| Supertonic F4 + seletor | troca de peça | RTF 0,26–0,28 medido; screening objetivo 10 vozes; ouvido do dono (F4/M1) | promovido-provisório (voz é gosto; pocket/piper/windows seguem por env) |
| Erro de turno FALADO (falha do cérebro não é muda) | correção estrutural | T3 (TTS local sempre vivo; caminho de erro determinístico) | promovido |
| Guarda anti-runaway 400 chamadas/processo | **política operacional/custo** (separada da correção acima) | dimensionamento: 2 chamadas/turno × ~3h de conversa; env ajusta | promovido como default; `.env.example` NÃO pina valor baixo (25 matou a 36ed) |
| Observador/escuta cega/replay/minerador | instrumentação | — (não toca o caminho de conversa; OBSERVER=1 opt-in) | promovido como ferramenta |

## 4. Comparação v0 → v1 (as pernas medidas)

| Perna | v0 (RC) | v1 | Fonte |
|---|---|---|---|
| Final ASR (CORAA, divergência média) | 0,452 (parakeet int8) | **0,109** (TAGARELA int8) | pdca-asr.md ciclo 1 + promoção |
| Parciais (CORAA, vozes independentes) | 0,71 (tiny) | **0,387** (Kroko) | testes/kroko/coraa-{tiny-baseline,generalizacao}.json |
| Parciais legíveis em sessão real | 47–80 % | 92–96 % | testes/kroko/RELATORIO.md |
| Custo por atualização de parcial | re-decode integral (centenas de ms) | p50 5 ms / p95 80 ms (delta streaming) | smoke via cliente real |
| Surdez catastrófica (monólogo >30 s) | 44–85 s surdo (2 modos) | finaliza e responde o ouvido; retém e concatena | replays 2e22/bd30 |
| Morte muda por falha do cérebro | erro só escrito; 25 chamadas/processo | falado; 400/processo | sessão 36ed + fix |
| Voz | pocket rafael (streaming, voz rejeitada de ouvido) | Supertonic F4/seletor (1º áudio ~1,7 s, tradeoff documentado) | bake-off v2 + doctor |
| Bateria de regressão v1 (8 sessões-chave) | — | relatório em var/observador/pdca-asr.md (rodada 2026-08-15) | observador-replay-bateria |

Pendências honestas de comparação: sessões FRESCAS com a candidata
completa (próximas sessões do Felipe); continuação pós-interrupção sem
exercício vivo; primeiras-frases e captação abafada seguem na fila.

## 5. Dependências, licenças, recursos

| Peça | Origem | Licença | Recurso |
|---|---|---|---|
| TAGARELA int8 | HF `calneymgp/…-TAGARELA-onnx-int8` (conversão do parakeet NVIDIA) | família parakeet CC-BY-4.0 (conferir card da conversão antes de distribuição comercial) | 890 MB disco, ~900 MB RAM |
| Kroko 64-L | HF `Banafo/Kroko-ASR` (.data desempacotado por `scripts/kroko-desempacotar.py`; sha256 pinado em `setup-kroko.sh`) | CC-BY-SA (comercial ok, share-alike) | 156 MB disco, ~300 MB RAM, 1 thread |
| Supertonic-3 | pip `supertonic` (cache `~/.cache/supertonic3` pinado) | MIT + OpenRAIL-M — **exige revelar que a voz é sintética** (feito no lede da página) e proíbe uso médico/decisão automatizada vinculante | 398 MB disco, ~512 MB RAM, 3 threads |
| Silero VAD | onnx local | MIT | ~50 MB |
| CORAA (avaliação) | HF gabrielrstan/CORAA-v1.1 | CC BY-NC-ND — **só avaliação, nunca produto** | 12 clipes locais |
| Cérebro | API OpenAI | comercial | única dependência externa em runtime |

Pilha completa medida na máquina de 8 GB (WSL): ~2 GB com tudo no ar,
~4 GB disponíveis. Nenhum download em runtime além do 1º arranque.

## 6. Disciplina de branches (daqui em diante)

- **`obs/observador-v0`** — linha de trabalho da roda (exploração +
  instrumentação + correções). É onde o PDCA vive.
- **`engine/candidata-vN`** — cortes curados e etiquetados da linha de
  trabalho, cada um com seu manifesto (este arquivo). Nunca recebem
  commit direto; nascem por corte quando o ledger acima estiver coerente.
- **`exp/caminho-ouro`** — pesquisa (tetos, sondas, carteira). Nunca vira
  produto sem passar pela régua da seção 2.
- PR #1 (v0) = histórico, fechado com nota; PR da v1 o substitui.

## 7. O que destravaria a v2

Validação viva da continuação; gate de energia p/ quase-silêncio; nomes
próprios nas parciais (Kroko fora-de-vocabulário); detector de captação
abafada por dispositivo; 1ª-frase; segundo falante regular (primeira
evidência multi-usuário para a política conversacional).
