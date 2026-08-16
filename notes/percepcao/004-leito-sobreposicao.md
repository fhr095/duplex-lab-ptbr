# 004 — Leito de sobreposição por sinal (2026-08-16)

Substitui o leito por eventos (confiança 0,6): lado do assistente vem do
registro FÍSICO de reprodução (inicio/fim por uid, motivo="cortado",
posição onde parou, kind) e lado do usuário da energia do canal-usuario
com limiar adaptativo. Probe: probes/percepcao/leito-sobreposicao.mjs.
Dados: var/momentos-sobreposicao-v1.jsonl (worktree percepcao, fora do
Git — contém janelas de fala).

## Números (15 pacotes vivos; replays excluídos por regra de linhagem)

59 sobreposições ≥180ms (a rodada inicial acusou 60: o pacote e2c0
estava VIVO, com reproducao.jsonl em escrita entre rodadas — lição
registrada: leito roda sobre pacote quiescido/snapshot):

| célula | n | leitura |
|---|---|---|
| backchannel-atravessado | 17 | desejado: burst curto, assistente completou |
| **segurou-contra-piso** | **14** | RUIM: usuário insistindo (≥1,2s), sistema seguiu falando |
| **assistente-entrou-sobre-usuario** | **6** | RUIM: reprodução começou com usuário JÁ falando |
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

A assimetria medida: o sistema fala POR CIMA do usuário (20 casos) ~10×
mais do que cede indevidamente (2). O prêmio do VAP/MaAI não é "ceder
menos" — é RECONHECER usuário-quer-o-piso (e não entrar quando ele já
fala). Métricas do teste devem pesar as células por essa assimetria.

## Exclusão de corpus (mesma data, à tarde)

A captura de MÚSICAS AMBIENTE do Felipe (mic-3 do e2c0, 16,3 min — NÃO
era teste; a engine respondeu à música com 31 reproduções) saiu do
corpus: raw em quarentena (var/fora-do-corpus/, fora do observador),
áudio entregue ao Felipe em
Downloads/duplex-audios/musicas-ambiente-2026-08-16.wav, e o pacote
ganhou `corpus-excluir.json` [{deS, ateS, motivo}] que os DOIS
extratores agora respeitam (extrair-momentos e leito-sobreposicao) —
re-execuções futuras ignoram a janela. Verificado por diff com/sem
manifesto (nenhum momento legítimo afetado).

## Limitações honestas

n=59 de 1 falante; 18/59 sem atribuição causal (multi-burst por janela —
refinamento futuro); bursts por energia (sem VAD neural no leito);
reação com n=3.
