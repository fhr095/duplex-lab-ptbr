# Produto e hipóteses

## North star

Construir uma camada proprietária de interação por voz que faça a conversa
parecer cooperativa em tempo real, mesmo quando o raciocínio profundo está em
outro processo ou modelo.

Ela deve:

- ouvir enquanto fala;
- ceder o turno imediatamente diante de uma interrupção real;
- não confundir pausa ou hesitação com fim de turno;
- usar confirmações curtas quando elas ajudam;
- aceitar correções e invalidar estado anterior;
- delegar e cancelar trabalho sem congelar a conversa;
- manter uma identidade vocal consistente;
- operar em português brasileiro sob ruído e eco.

## Três coisas diferentes

É importante não misturar:

1. **Barge-in:** o player para quando detecta fala. É necessário, mas não basta.
2. **Pipeline full-duplex:** entrada, raciocínio e saída rodam concorrentemente,
   mesmo que ASR, política, LLM e TTS sejam módulos distintos.
3. **Modelo nativo full-duplex:** um backbone aprende conjuntamente áudio,
   timing, fala e possivelmente ações.

O produto pode validar valor no nível 2 antes de provar que o nível 3 é
necessário. A vantagem proprietária pode começar nos dados, na política de
interação e no pós-treinamento, sem exigir um foundation model novo.

## Hipóteses ordenadas por valor da informação

### H0 — Uma cascata bem controlada já fecha boa parte do gap

Streaming ASR PT-BR + sinais acústicos + um pequeno modelo de interação +
streaming TTS podem produzir uma conversa suficientemente fluida para validar
produto e dados.

**Teste:** comparar uma vertical modular contra referências nativas no mesmo
pack.
**Mata a hipótese:** latência, cortes e backchannels continuam ruins mesmo
depois de instrumentação e micro-turnos.

### H1 — O primeiro peso proprietário deve aprender interação, não conhecimento

Um modelo pequeno recebe transcrição incremental, pausas, energia, estado do
player e tarefas; ele emite ações temporais. O LLM externo fornece conteúdo.

**Teste:** substituir a política determinística por um checkpoint ajustado em
traces PT-BR.
**Mata a hipótese:** sinais textuais/acústicos compactos não bastam para
desambiguar hesitação, fala paralela e interrupção.

### H2 — Um backbone nativo acrescenta naturalidade que a cascata não alcança

Modelagem conjunta de áudio e texto pode melhorar sobreposição, prosódia e
microtiming.

**Teste:** adaptar uma base aberta somente depois de medir o teto modular.
**Mata a hipótese:** ganho humano pequeno diante do custo, perda semântica ou
restrições de licença/serving.

## Estratégia da fase atual

O projeto ainda está cedo demais para tornar uma base humana ampla o gargalo do
caminho crítico. Há falhas de arquitetura, timing, semântica, áudio e runtime
que podem ser encontradas com muito mais velocidade por geração e replay
automatizados.

Nesta fase, uma fábrica de avaliações por IA cria famílias de conversas,
contrafactuais, vozes, timings e ambientes. Críticos independentes procuram
lacunas; cada falha reproduzível vira regressão congelada. Essa base é iterativa,
não uma entrega única cuja distribuição aceitamos passivamente.

Pessoas reais entram como decisão principal quando o sistema já é funcional e
as dúvidas restantes são naturalidade, conforto, sotaque, comportamento social
ou acústica física. Assim, humanos calibram a validade externa e lapidam a
experiência, em vez de serem usados para depurar problemas fundamentais.

## Contrato de experiência

O usuário pode:

- começar a falar a qualquer momento;
- mudar de ideia sem “resetar” a conversa;
- ouvir uma confirmação curta enquanto formula uma frase longa;
- continuar falando enquanto uma tarefa externa roda;
- cancelar ou modificar essa tarefa;
- receber o resultado quando houver uma janela conversacional adequada.

O sistema não deve:

- executar estado provisório;
- responder à televisão ou a conversa lateral;
- usar backchannel sobre uma palavra importante;
- continuar uma frase depois de ter cedido o turno;
- falar só para esconder latência;
- inventar que uma tarefa terminou.

## Critérios de sucesso por maturidade

### MVP de engenharia

Prova que a arquitetura completa possui potencial:

- estabilidade de dez minutos;
- interrupção até o renderer com p95 abaixo de 250 ms;
- primeiro áudio simples com p95 abaixo de 1,2 s;
- cortes indevidos abaixo de 5% no pack;
- correção, delegação e cancelamento em pelo menos 95% dos casos
  determinísticos.

Este gate está promovido na configuração local atual. Ele não contém uma
alegação de preferência humana.

### Qualidade autônoma

Antes de mobilizar uma avaliação humana como caminho crítico, o sistema deve:

- sobreviver a famílias amplas de conteúdo, timing, acústica e falhas geradas
  por IA;
- preservar slots e efeitos críticos em correções e mudanças de intenção;
- manter os budgets de interrupção e resposta sob concorrência local;
- comparar TTS e modelos de interação no mesmo replay reproduzível;
- demonstrar que novas gerações adversariais encontram sobretudo caudas, e não
  novas classes fundamentais de falha.

### Prontidão humana

Somente depois, conversas cegas avaliam naturalidade, conforto, confiança,
sotaque, eco físico e vontade de continuar. Esses resultados recalibram os
proxies sintéticos e podem devolver o sistema a uma nova rodada autônoma.
