# AÇÃO OPERACIONAL — CENA ACÚSTICA ADVERSA (v0)

Desenho da frente percepção (2026-08-16). Especifica O QUE a engine FALA quando a
cena está adversa (música/interferência/far-field). Não é código de engine; é o
contrato da ação. Calibração dos limiares: bancada em `RELATORIO.md` (mesmo
diretório), leito de janelas reais adversas × limpas.

## 1. O caso que manda (a6c1, 2026-08-15)

Música pop colada no mic (Alexa), Felipe falando de longe. O que a engine fez,
turno a turno (linha-do-tempo do pacote `2026-08-15-21-50-40-a6c1`):

| trel | turno | final | áudio | o que a engine fez | o que deveria fazer |
|---|---|---|---|---|---|
| 11769,6 | turn-1 | VAZIO | 5,4 s | nada | (1º vazio: never-mute neutra) |
| 11777,0 | turn-2 | "Opa, meu avô..." | 3,6 s | respondeu ao conteúdo ("Poxa, sinto muito...") e conduziu conversa sobre tema INEXISTENTE | **confirma antes de agir** |
| 11802,3 | turn-3 | VAZIO | 11,2 s | nada | **pede repetição citando o som** |
| 11809,6 | turn-4 | VAZIO | 1,3 s | nada | (freio segura) |
| 11812,8 | turn-5 | "Alexa, continua." | 2,5 s | tratou como turno nosso | fora do escopo desta ação (endereçamento = frente própria) |
| 11820,7 | turn-6 | VAZIO | 5,9 s | nada | (freio segura / repete específica se venceu 30 s) |

O dano dominante não foi ficar mudo: foi **errar com confiança** — um final
curto e plausível ("meu avô", fonético de "me ouvindo") virou conversa fantasma.
A cena estava MEDIDA no áudio (graves/voz até 48×, Music 0,98 no tagger) e nada
usou essa medida.

## 2. O sinal: `cena.avaliada`, por janela de turno

**Janela de turno** = o áudio que sustenta o final (o `audioSnapshot` do
`transcript.final`: sampleStart→sampleEnd). Fallback sem snapshot: últimos 4 s
antes de `endpointAtMs`.

**Cômputo** (fatias de 4 s, passo 2 s; turno < 4 s = fatia única):

- **Detector titular — tagger sherpa-onnx** (AudioSet zipformer-small int8,
  26 MB, Apache-2.0, 1 thread): prob. da classe **Music** por fatia; score da
  janela = **mediana** das fatias.
- **Métrica grátis — sempre computada** (0,7 ms/fatia): razão de energia
  60–250 Hz / 300–3000 Hz (`graves_voz`) + flatness espectral geo/arit
  (`flatness`). Vai no trace de todo turno (explicabilidade + fallback), mas
  **não decide** quando o tagger está vivo — na bancada ela erra dos dois lados
  (AUC 0,92 vs 1,00; detalhes no RELATORIO).

**Veredicto por turno:**

| condição | veredicto |
|---|---|
| Music ≥ **0,50** (mediana das fatias) | `adversa` |
| Music < 0,50 | `limpa` |
| tagger indisponível e `graves_voz` ≥ **12,4** | `adversa` (fallback degradado; pega ~36% das adversas, FPR 0 no leito) |

O limiar 0,50 cai no meio do vão medido (pior fatia limpa 0,08 × pior fatia
adversa 0,97) — não é ponto de operação apertado.

**Quando roda:** em paralelo com a finalização do ASR (finalização mediu
222–679 ms na a6c1; o tagger custa ~76 ms/fatia nesta CPU a 1 thread). O
veredicto fica pronto ANTES do route → latência adicionada esperada ≈ 0.

**Trace (todo turno, inclusive limpa):**

```json
{"canal":"turno","type":"cena.avaliada","turnId":"turn-2",
 "graves_voz":48.5,"flatness":0.0005,"veredicto":"adversa",
 "music":0.976,"fonte":"tagger","fatias":2,"ms":81}
```

Núcleo obrigatório: `graves_voz`, `flatness`, `veredicto`. `music`/`fonte`
registram quem decidiu (`tagger` | `gratis`).

## 3. A ação (vocabulário: espera · pede repetição · cede o piso · encurta a resposta · confirma antes de agir)

A cena **só muda a FALA da resposta**. Nenhum turno é bloqueado, descartado ou
segurado por causa dela.

### Regra 1 — final CURTO+confiante sob cena adversa → **CONFIRMA ANTES DE AGIR**

Condição: `veredicto=adversa` E final não-vazio com **≤ 5 palavras OU áudio
≤ 4 s** (o turn-2 da a6c1: 3 palavras, 3,6 s) E kernel sem outra pendência.

Em vez de responder ao conteúdo, a resposta do turno vira confirmação:

> "Não te ouvi bem — você disse *X*?"

Mecânica: o turno segue o fluxo normal (route/kernel); só a formulação muda. O
kernel já tem `pendingConfirmation` — a confirmação entra por aí, sem estado
novo. Se o usuário confirma, o conteúdo segue; se corrige, o conteúdo corrigido
segue.

**Anti-loop:** máximo **1 confirmação em cadeia** por conteúdo. Se a resposta à
confirmação chegar de novo curta+confiante sob cena adversa, NÃO confirma de
novo — cai na Regra 2 (pede repetição citando o som).

Finais LONGOS (> 5 palavras e > 4 s) sob cena adversa: v0 não muda a fala
(alucinação longa é rara; confirmar tudo viraria nag). Fica no trace para
calibrar v1.

### Regra 2 — finais VAZIOS repetidos sob cena adversa → **PEDE REPETIÇÃO citando o som**

Hoje (never-mute): final vazio com `audioEndMs ≥ 2,5 s` e assistente ocioso →
fala local causa-neutra ("áudio chegou muito baixo — pode chegar mais perto ou
baixar o som?"), freio de 20 s. Isso permanece o gancho ÚNICO para vazios.

Com cena medida:

- **1º vazio** sob cena adversa: mensagem causa-neutra atual (ela já cobre
  "baixar o som"; um vazio isolado ainda pode ser hesitação).
- **2º+ vazio em ≤ 60 s sob a mesma cena adversa**: a mensagem fica
  **ESPECÍFICA** — a repetição confirma que o ambiente está comendo a fala:

> "Tem um som alto aí perto — pode baixar ou chegar mais perto?"

### O que a cena NÃO dispara (v0)

- **espera** — segurar turno por cena é bloqueio disfarçado; espera continua
  governada pelo endpoint/commit-grace.
- **cede o piso** — é reação a sobreposição (barge-in), já coberta.
- **encurta a resposta** — candidata natural de v1 (sob cena adversa, resposta
  curta devolve o piso mais rápido), mas fora da v0: superfície mínima,
  mudança medível.

## 4. Freio anti-nag

- Fala de captação ESPECÍFICA (Regra 2): máximo **1×/30 s**, compartilhando
  estado com o freio de 20 s do never-mute (um único freio de "fala sobre
  captação"; vale o mais restritivo pendente).
- Após **2 específicas sem a cena melhorar**, para de citar o som (volta à
  neutra curta no ritmo do never-mute) — insistir na causa vira atrito.
- Confirmação (Regra 1) não conta no freio — ela É a resposta do turno, não
  fala espontânea; o anti-loop dela (1 em cadeia) é o limite.

## 5. Fora do escopo (explícito)

- **Nada de bloquear/descartar turnos automaticamente** — cena muda a fala,
  nunca engole conteúdo.
- Endpoint/VAD/commit intocados; nenhum abort de TTS por cena.
- Gate de plausibilidade sensível a cena (fila do ciclo): item separado; esta
  ação não pontua plausibilidade de texto.
- Endereçamento ("Alexa, continua" era fala real dirigida a outro dispositivo):
  cena não resolve; frente própria (sinal direcional).
- AGC/realce de captação: fila própria (bancada antes).

## 6. Critérios de aceite (replay a6c1 + sessões vivas)

1. Replay do bloco 11763–11830 da a6c1: turn-2 gera confirmação ("você disse
   'Opa, meu avô'?") em vez de "Poxa, sinto muito..."; vazios geram 1 neutra +
   1 específica no máximo (freios respeitados); zero conversa fantasma.
2. Sessões vivas limpas: **zero** confirmações disparadas por cena (no leito,
   Music < 0,08 em toda fala limpa — margem 6× até o limiar).
3. Latência: p50 do 1º delta inalterada (cômputo em paralelo à finalização).
4. Trace `cena.avaliada` presente em 100% dos turnos, adversos ou não.
5. Custo residente: +~113 MB RSS e ~76 ms/fatia a 1 thread (medidos nesta CPU;
   RELATORIO §custo) — aceito em troca de matar a classe "errado-com-confiança
   sob música".
