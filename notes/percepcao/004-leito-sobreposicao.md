# 004 — Leito de sobreposição por sinal (2026-08-16)

Substitui o leito por eventos (confiança 0,6): lado do assistente vem do
registro FÍSICO de reprodução (inicio/fim por uid, motivo="cortado",
posição onde parou, kind) e lado do usuário da energia do canal-usuario
com limiar adaptativo. Probe: probes/percepcao/leito-sobreposicao.mjs.
Dados: var/momentos-sobreposicao-v1.jsonl (worktree percepcao, fora do
Git — contém janelas de fala).

## Números (15 pacotes vivos; replays excluídos por regra de linhagem)

60 sobreposições ≥180ms:

| célula | n | leitura |
|---|---|---|
| backchannel-atravessado | 17 | desejado: burst curto, assistente completou |
| **segurou-contra-piso** | **14** | RUIM: usuário insistindo (≥1,2s), sistema seguiu falando |
| **assistente-entrou-sobre-usuario** | **7** | RUIM: reprodução começou com usuário JÁ falando |
| cedeu-a-burst-curto | 2 | possível cessão indevida a backchannel |
| interrupcao-atendida | 1 | cedeu a burst longo |
| ack-substituido-por-conteudo | 1 | corte por conteúdo pronto (não é interrupção) |
| sobreposicao-nao-causal | 18 | pares sem atribuição causal (conf. 0,5; refinar) |

Tempo de reação ao ceder (cortes causados por usuário): p50=502ms,
p90=1322ms — n=3, pequeno.

## Validação anti-eco

Amostras de segurou-contra-piso e não-causal cruzadas com a
retranscrição do canal-usuario: TODAS com palavras reais do usuário
("Tamo aqui só trocando uma ideia", "como você chama?") — o AEC do
navegador segura o eco; os bursts são fala genuína.

## O que isso diz ao MaAI (challenger seguinte)

A assimetria medida: o sistema fala POR CIMA do usuário (21 casos) ~10×
mais do que cede indevidamente (2). O prêmio do VAP/MaAI não é "ceder
menos" — é RECONHECER usuário-quer-o-piso (e não entrar quando ele já
fala). Métricas do teste devem pesar as células por essa assimetria.

## Limitações honestas

n=60 de 1 falante; 18/60 sem atribuição causal (multi-burst por janela —
refinamento futuro); bursts por energia (sem VAD neural no leito);
reação com n=3.
