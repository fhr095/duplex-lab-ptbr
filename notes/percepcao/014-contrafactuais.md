# 014 — Contrafactuais casados + normalização: o agrupamento é pré-requisito, com três caminhos (2026-08-19)

Refinamento v3 do mandato incorporado. Instrumentos: probe com lift
normalizado pelo duty da assistente + reação-ao-onset; simulador de
cenários casados em nível de linha-do-tempo (sinais temporais são
definidos sobre timelines; o pipeline físico foi validado no loop 013;
áudio real entra quando embeddings forem avaliados).

## 1. Normalização (controle do mandato) — a separação sobrevive

| fonte | sobreposta p50 | duty assistente | **lift** |
|---|---|---|---|
| usuário real (2 janelas vivas) | 0,00 | 0,21–0,22 | **0,00** |
| rádio (loop físico dd53) | 0,48 | 0,55 | **0,87** |
| anúncios (loop físico d25e) | 0,54 | 0,56 | **0,97** |

Lift ≈ 1 = independência pura; a suspeita de inflação por duty alto
está descartada. Achado honesto: a métrica reação-ao-onset saiu ≈0 dos
DOIS lados (usuário −0,07/−0,08; fontes +0,03/+0,09) — na estrutura de
turn-taking o usuário JÁ cedeu antes do onset da assistente, então o
denominador "ativo no onset" quase não existe para legítimos. A reação
não discrimina nesta forma; o lift carrega a separação.

## 2. Matriz casada (300 s, durações de resposta 4/7/10/14 s, duty 0,54)

| papel | enunciados | lift | supressão (regra: lift acum ≥0,5 c/ ≥8 s de exposição) |
|---|---|---|---|
| P participante (c/ 2 barge-ins + 1 fora-de-slot) | 17 | 0,00 | **NUNCA** (0 legítimos rejeitados) |
| L segunda pessoa (entra aos 120 s) | 5 | 0,00 | NUNCA |
| R rádio | 38 | 0,90 | enunciado **3** (bate com o loop físico) |
| J rajada | 17 | 1,24 | enunciado 2 * |
| C1/C2 conversa alheia (contingentes ENTRE SI) | 31/30 | 1,28/0,78 | enunciados 5/4 |

Células críticas: barge-ins e iniciativa fora-de-slot do participante
são ABSORVIDOS pela estatística acumulada por fonte (não rejeitam);
conversa alheia cai pela independência da linha da ASSISTENTE mesmo
sendo contingente entre si. (*) Rajada foi suprimível AQUI porque o
duty da assistente era alto (0,54) — com assistente quieta, rajadas
esparsas seguem duras: o residual é DEPENDENTE DE REGIME, registrado.

## 3. A pergunta central do mandato: agrupar-por-fonte é pré-requisito — SIM, com três caminhos

Toda a supressão acima usou rótulo de fonte PERFEITO (teto superior).
Em produção, acumular indiferença exige atribuir turnos a fontes.
Caminhos, do mais barato ao mais caro:
(a) **pool não-participante** (sem agrupamento): tudo que não é
    participante admitido acumula JUNTO — suficiente para suprimir
    resposta ao pool sob fundo dominante; incapaz de separar duas
    alheias ou reabilitar uma delas; a admissão por enunciado (slot +
    campo + presença) continua deixando L entrar.
(b) **track visual efêmero do produto** (Habitat já tem): agrupa por
    pessoa-vista; resolve também o turno-1 se houver sincronização
    labial.
(c) **continuidade de voz (embedding efêmero)**: agrupa por timbre —
    com a COLISÃO demonstrada na matriz: C1 usa a MESMA voz de P
    (pessoa admitida falando com outra) e os stats temporais os separam
    por PAPEL (0,00 × 1,28); agrupar por voz os fundiria. Logo voz NÃO
    pode ser a chave única de agrupamento — fonte ≠ endereçamento; a
    atribuição precisa de época comportamental ou sinal por enunciado.
Ordem de confronto mantida: grátis → presença REAL → fala visual/
sincronização → continuidade de voz → composição. Se a câmera resolver
o residual com menos complexidade, corta-se o embedding (vitória).

## 4. Interface com o produto (contrato; nada de imagem/identidade)

Sinais DIFERENCIADOS que a engine pode consumir (efêmeros, booleanos/
timestamps): presença · track efêmero (id-de-sessão-visual opaco) ·
atividade labial · SINCRONIZAÇÃO audiovisual (boca ativa correlacionada
com o áudio captado — boca sozinha ≠ autoria, inclusive com múltiplas
pessoas visíveis) · proximidade · direção/orientação ·
indisponibilidade do sensor (nunca se disfarça de "ausente").
"1ª resposta fantasma inevitável" fica REESCRITO: inevitável apenas
para sinais temporais pós-resposta; presença/track/sincronização são
contemporâneos e competem para impedir o primeiro fantasma.

## 5. Barreira de efeito (independente do classificador final)

Contrato: ferramenta com EFEITO MUTÁVEL exige confirmação explícita OU
lease de autoridade do produto (presença/toque/participante admitido);
consultas de LEITURA (Open-Meteo hoje) seguem permissivas. No estado
atual a engine não tem ferramenta mutável — a barreira entra como GATE
de aceite para a primeira que chegar, e o relatório terminal separa
leitura × mutável. O disparo de delegação por fantasma (013) é o erro
prioritário que esta barreira mata por construção.

## 6. Estado do retorno terminal (perguntas do mandato)

- Indiferença com fonte descoberta: útil VIA um dos 3 caminhos de
  agrupamento (§3); pool cobre o grosso; separação fina pede track/voz.
- Fantasmas até supressão: 2-5 enunciados (matriz) / ~3 (físico).
- 1º fantasma: aberto para sinais contemporâneos — próxima etapa mede
  presença/sincronização REAIS do produto contra ele.
- Rajadas: dependentes de regime (duras com assistente quieta).
- Ganho marginal do embedding: espremido para {agrupamento fino entre
  alheias, rajada em regime quieto, turno-1 sem câmera} — e com a
  colisão mesma-voz limitando-o a coadjuvante.
- Legítimos rejeitados: 0 na matriz (barge-ins/fora-de-slot absorvidos).
- Contrato de zero ações não autorizadas: §5.
