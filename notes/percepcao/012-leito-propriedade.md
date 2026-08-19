# 012 — Leito de propriedade da fala: desenho v2 + primeiras referências (2026-08-18)

Refinamento do mandato sobre a 011, absorvido integralmente:

1. **Contingência é o SINAL principal, não a definição.** Três
   perguntas distintas, respondidas separadamente no vetor de saída:
   FONTE (mesma origem sonora de antes?), PARTICIPAÇÃO (essa fonte é
   participante da sessão?) e ENDEREÇAMENTO (esta fala é dirigida à
   engine?). Uma pessoa admitida falando com outra = participante NÃO
   endereçando; voz nova interrompendo legitimamente = endereçamento
   sem histórico; rádio alternando por coincidência (ou pelo eco das
   respostas da própria engine) = padrão temporal SEM fonte/
   endereçamento legítimos.
2. **Saída VETORIAL, sem escore único**: continuidade-da-fonte ·
   participação · endereçamento · contingência-temporal ·
   contingência-semântica · campo/proximidade · confiança. Política
   conservadora SÓ para ações com efeito; conversa leve permissiva.
3. **dBFS = baseline declarado, não proximidade verdadeira** (AGC/AEC
   comprimem); campo real exigiria sinal melhor (a comparar com o
   bit de presença do produto, que compete DIRETAMENTE com as soluções
   acústicas — se presença eliminar quase todo o erro, a decisão de
   maior retorno é integração com o produto, não modelo novo).
4. **Decisão terminal do marco** (uma das quatro): sinais gratuitos
   bastam | presença do produto resolve | embedding acrescenta ganho
   residual como acelerador | contingência falha → outra formulação.
   Métricas: fantasmas respondidos, legítimos rejeitados, tempo de
   admissão, tempo de recuperação de âncora errada, calibração,
   latência, ganho MARGINAL por sinal — nunca acurácia agregada.

## 1. Primeiras referências REAIS (leito-propriedade-features.mjs; canais físicos usuário×assistente do pacote, mesmo eixo)

Turnos reais do usuário (4 janelas, 130 turnos, inclui a adversa a6c1):

| janela | turnos | slot p50 | emSlot ≤2,5s | sobreposta p50/p90 | dBFS p50 |
|---|---|---|---|---|---|
| 685b limpa | 41 | 3,4 s | 38% | 0,00/0,15 | −23 |
| e2c0 limpa | 36 | 2,2 s | 67% | 0,00/0,09 | −24 |
| 36ed limpa | 42 | 3,1 s | 44% | 0,00/0,00 | −23 |
| a6c1 música | 11 | 2,8 s | 50% | 0,00/0,25 | −26 |

Fundos (duty de atividade = sobreposta ESPERADA contra qualquer linha
do tempo, por independência): rádio-falado 0,68 · anúncios 0,32 ·
burburinho 0,98.

**Achados que já mudam o desenho:**
- CONTINGÊNCIA TEMPORAL POSITIVA É FRACA COMO ADMISSORA: só 38-67% dos
  turnos reais começam ≤2,5 s após o assistente (pessoas pensam,
  iniciam assuntos). Admissão não pode exigir slot.
- INDIFERENÇA É FORTE COMO REJEITORA: usuário real quase nunca
  atravessa a fala do assistente (p50 0,00; p90 ≤0,25) contra 0,68-
  0,98 esperado das fontes contínuas. Mas é métrica POR FONTE ao longo
  do tempo, não por turno isolado.
- ANÚNCIOS-EM-RAJADA (duty 0,32) são o adversário mais difícil do
  conjunto grátis: uma rajada entre falas do assistente parece "em
  slot" e não atravessa nada — por turno isolado, indistinguível de
  usuário por features temporais. A separação exige CONTINUIDADE DE
  FONTE acumulada (mesma voz voltando fora de contexto) — exatamente o
  eixo onde o embedding efêmero pode ter ganho residual, a medir.

## 2. Contrafactuais casados (obrigatórios no conjunto sintético)

Sempre variando UMA dimensão por par:
(a) mesmo áudio/voz/conteúdo/volume como participante × como fundo, só
o TIMING muda; (b) mesmo timing, só a PROXIMIDADE muda; (c) a MESMA
voz em papel legítimo e alheio; (d) rádio/entrevista com pausas e
respostas semanticamente coincidentes (contingência fabricada); (e)
participante legítimo interrompendo e falando FORA dos slots (não pode
ser rejeitado); (f) participante admitido falando com OUTRA pessoa
(participação sem endereçamento).

## 3. Cenário dinâmico: recuperação de âncora errada (a construir)

O risco apontado: a engine respondendo ao rádio nos próprios silêncios
fabrica alternância rádio→engine→rádio aparentemente contingente.
Bancada engine-in-the-loop: replay estendido com REPRODUÇÃO SIMULADA
(o cliente de replay não toca áudio, mas avança um relógio de
reprodução com a duração das sínteses do sidecar e emite os beacons —
o pacote ganha canal-assistente posicionado e o loop fica físico).
Métrica: TEMPO/Nº DE RESPOSTAS até os sinais acumulados por fonte
(indiferença crescente, ausência de resposta semântica) permitirem
abandonar a fonte errada — recuperação dinâmica, não classificação
isolada. Rodar com rádio (contínuo) e com anúncios (rajadas — o caso
difícil).

## 4. Estado e próximos passos

- Extração de features: probes/percepcao/leito-propriedade-features.mjs
  (versionado; roda sobre qualquer pacote com os dois canais).
- Próximo: gerador de cenários casados (§2) sobre a infra de fundos +
  reprodução simulada no replay (§3) → curvas dos 3 baselines grátis
  por fonte; SÓ DEPOIS embeddings pequenos em shadow, medidos pelo
  ganho MARGINAL sobre o vetor grátis + bit-oráculo de presença.
- Proibições mantidas: nada de plataforma geral de diarização/
  biometria; embedding não integra; identidade sempre efêmera.
