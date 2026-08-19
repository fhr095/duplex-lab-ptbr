# 013 — Loop fechado observado: indiferença promovida a fato, slot morto (2026-08-19)

Controles metodológicos do mandato incorporados como contrato: (a)
indiferença era HIPÓTESE (duty esperado) até este registro — agora há
curva OBSERVADA em canal físico; (b) contingência reportada como CURVA
multi-janela com denominadores à vista, sem limiar único; (c)
robustez a pisos energéticos verificada (±3 dB: conclusões estáveis);
(d) simulação TEMPORAL declarada — beacons + duração real do TTS provam
contingência e recuperação; NADA aqui alega AEC/reverb/sala; (e)
contrafactuais casados + holdout por voz/fonte obrigatórios na próxima
etapa; (f) embedding só será avaliado por ganho MARGINAL sobre grátis +
presença, com falas curtas/ruidosas no conjunto.

## Instrumento novo

Replay com `--reproducao-simulada`: sintetiza cada resposta no sidecar
real (uid → sinteses/), emite beacons de reprodução avançando relógio
simulado → o pacote ganha canal-assistente FÍSICO posicionado e o loop
fonte→engine→fonte vira mensurável. Probe atualizado
(leito-propriedade-features: curva multi-janela, denominadores,
--piso-*, --serie).

## Loop fechado (silêncio do usuário + fonte, BRAIN local, TTS real)

Dois pacotes (180 s cada): rádio-falado (dd53) e anúncios-loja (d25e).
Dano bruto: 11 e 14 respostas-fantasma; a engine passou ~100% da janela
falando com ninguém; nos DOIS cenários uma resposta fantasma disparou
DELEGAÇÃO DE TAREFA (caminho com efeito) — erro prioritário nº 1.

Curvas observadas × referência real (130 turnos de usuário, 3 janelas):

| feature | usuário real | rádio (loop) | anúncios (loop) |
|---|---|---|---|
| sobreposta p50 (por fonte) | **0,00** | **0,48** | **0,54** |
| sobreposta p90 | 0,00–0,15 | 1,00 | 1,00 |
| slot ≤2,5 s (curva) | 38–67% | 52% | 42% |
| dBFS p50 | −23/−24 | −34 | −30 |

**Veredictos desta etapa:**
1. **Contingência temporal FABRICADA confirmada fisicamente**: a curva
   de slot das fontes no loop é indistinguível da do usuário real — o
   próprio responder da engine cria os "slots". Slot está MORTO como
   sinal de admissão isolado (já era fraco: só 38-67% dos turnos
   legítimos ≤2,5 s, denominadores 29/24/36).
2. **Indiferença promovida a discriminador físico POR FONTE**: p50
   0,48-0,54 e p90 1,00 contra 0,00 do usuário. Série por turno
   (rádio): 7 turnos com 0,00 ANTES da primeira resposta (sem
   evidência possível), depois 0,24 → 0,44 → 1,00 —
   **recuperação de âncora errada em ~3 enunciados da fonte** após a
   primeira fala da engine, com qualquer limiar acumulado são (≥0,3).
   Usuário real nunca é rejeitado por este sinal (acumulado fica 0).
3. **A primeira resposta fantasma é INEVITÁVEL por sinais temporais**
   — antes de a engine falar, indiferença não existe. O problema
   residual se reduz a: (a) turno-1 da sessão (presença do produto,
   campo, ou custo aceito de 1 confirmação barata); (b) rajadas
   esparsas que nunca sobrepõem (anúncio isolado entre falas). É AQUI
   que presença × campo × embedding disputam o ganho marginal.
4. dBFS separou porque EU escolhi o nível de injeção — segue baseline
   declarado, sem valor causal.

## Próxima etapa (única)

Gerador de CONTRAFACTUAIS CASADOS (012 §2) para os papéis que faltam
no leito — segunda-pessoa-legítima nos slots × conversa-alheia × mesma
voz nos dois papéis × interrupção legítima fora de slot — com HOLDOUT
por voz (clipes CORAA reservados fora do desenho). Depois: embeddings
pequenos em shadow medidos por ganho marginal sobre
{indiferença-por-fonte + campo + bit-oráculo de presença},
especialmente no caso rajada + turno-1 + falas curtas/ruidosas.
