# Arquitetura

## Princípio central

Existe um único relógio conversacional e vários fluxos concorrentes. Nenhum
módulo ganha o direito de bloquear os demais.

```text
microfone ──► AEC/NS/VAD ──► adaptador de entrada ──────────────┐
                                                               │
                                      relógio + estado          ▼
                               ┌────────────────────────────────────┐
                               │ MODELO/POLÍTICA DE INTERAÇÃO       │
                               │ WAIT · BACKCHANNEL · SPEAK · STOP  │
                               │ DELEGATE · CANCEL · ROLLBACK       │
                               └──────────────┬─────────────────────┘
                                              │
                         ┌────────────────────┼───────────────────┐
                         ▼                    ▼                   ▼
                  brain adapter        task/tool bus       output scheduler
                  (substituível)        (cancelável)        (TTS ou tokens)
                         │                    │                   │
                         └──── resultado ─────┘                   ▼
                                                          áudio + telemetria
```

## Portas estáveis

### Entrada

Produz chunks de áudio e eventos como:

- começo, pausa, retomada e fim provável de fala;
- transcrição parcial e final;
- energia, voicing, confiança e identidade do falante;
- fala direcionada ou não direcionada;
- perda de pacote e estado de eco.

O detector pode ser substituído sem alterar a política.

### Interação

Consome o estado incremental e emite intenções:

```text
WAIT
BACKCHANNEL(text/style)
SPEAK(content/task-result)
STOP(reason)
DELEGATE(task, context, epoch)
CANCEL(task, epoch)
ROLLBACK(previous, current)
```

A implementação atual é determinística. O primeiro checkpoint proprietário
poderá aprender essa mesma interface.

### Cérebro e ferramentas

Toda chamada é:

- assíncrona;
- cancelável;
- associada a `taskId` e `epoch`;
- idempotente quando houver efeito externo;
- incapaz de falar diretamente no player.

Resultados antigos são descartados se a intenção mudou. Uma ferramenta com
efeito externo exige confirmação de estado final; autocorreção nunca pode
executar o valor provisório.

O contrato de provider expõe apenas `streamTurn()` e eventos normalizados
`started/delta/done`. OpenAI, um servidor local de pesos abertos ou outro
fornecedor ficam atrás dessa porta. A suíte extensiva usa o provider
determinístico local; providers pagos são canários e candidatos de comparação,
nunca infraestrutura obrigatória do laboratório.

### Localidade e rede

VAD, ASR, política, TTS e reprodução já possuem caminho local. Conteúdo
inteligente pode vir de um provider externo hoje, mas a porta não permite que
esse provider assuma captura, timing, player ou estado de ferramenta. Um futuro
cérebro de pesos abertos deve entrar sem mudar o navegador ou os traces.

Dados gerados online são materializados e versionados antes da regressão. Assim,
usar IA externa em P&D não transforma rede ou API em dependência dos testes nem
impede um gate futuro executado com rede bloqueada.

### Saída

O scheduler distingue três tempos:

1. decisão de falar;
2. primeiro sample produzido;
3. primeiro sample realmente audível.

Da mesma forma, `STOP` não significa que o áudio parou. O adaptador precisa
reportar o último sample audível para medir barge-in de verdade.

### Trace

Todos os módulos escrevem no mesmo tempo monotônico. Os canais de microfone e
assistente permanecem separados. Esse trace é o produto principal do
laboratório: permite reproduzir, comparar e treinar.

## Duas implementações sob o mesmo contrato

### Caminho modular

```text
streaming ASR + sinais acústicos
             ↓
modelo de interação leve
             ↓
LLM externo + streaming TTS
```

Vantagens: depuração, português, troca de componentes, inteligência preservada e
treinamento barato.

Riscos: propagação de erros, perda de prosódia e latência entre módulos.

### Caminho nativo

```text
tokens de áudio do usuário ─┐
tokens semânticos/ações ────┼─► backbone full-duplex ─► tokens de fala
tokens de fala do assistente┘
```

Vantagens: timing e acústica aprendidos conjuntamente.

Riscos: custo, interferência semântico-acústica, português fraco e serving mais
difícil.

Os dois caminhos precisam produzir o mesmo trace externo. Assim, a decisão será
empírica e reversível.

## Estado deste repositório

Implementado:

- contrato temporal;
- simulador de relógio virtual;
- política de referência;
- tarefa assíncrona simulada;
- scorer e gates;
- captura física do Chrome/Windows por `AudioWorklet`, mono PCM16 16 kHz, com
  AEC/NS/AGC solicitados, crédito explícito e telemetria de perdas;
- WebSocket binário local recuperável, com fila limitada, watermark, retomada de
  sequência e telemetria; Silero VAD v6.2 recorrente controla pre-roll,
  pausa/retomada e endpoint sem depender do STT do navegador; energia
  adaptativa permanece como baseline;
- ASR incremental em dois caminhos quentes: Whisper `tiny` para parciais e
  Parakeet TDT v3 ONNX INT8 para final em CPU;
- especulação da final durante pausa, cancelada se a fala retomar;
- reconciliação conservadora quando o Parakeet retorna vazio ou troca
  claramente de idioma;
- graça de commit de 220 ms, elevada a 500 ms para ações potencialmente
  corrigíveis, antes de publicar texto ou disparar trabalho;
- TTS provisório do Windows entregue como WAV por worker aquecido;
- player Web Audio instrumentado até o último quantum renderizado;
- barge-in fechado PCM→WebSocket→VAD→STOP→renderer;
- adaptador real da OpenAI Responses API, com streaming, histórico curto e
  `AbortSignal`;
- provider local gratuito como padrão e OpenAI somente por opt-in;
- trava explícita e orçamento reduzido para modelos premium;
- segmentação incremental de texto em blocos faláveis, sintetizados em paralelo
  com a geração;
- avaliadores locais Whisper/Parakeet com fala sintética e humana espontânea;
- campanha Chrome física repetida 10× e soak de 10 minutos para captura,
  resposta, barge-in, render, falsa ativação, reconexão forçada e cancelamento;
- campanha WebSocket com silêncio, hesitação, correção, tarefa, números e
  amostras CORAA;
- comparação de candidatos com gate conjunto de WER e tempo real.

Ainda não implementado:

- fábrica v0.2 de cenários, crítica, mutação e ambientalização por IA;
- loopback físico separado para medir a cauda do alto-falante e da sala;
- AEC controlado por hardware/ambiente além das constraints do navegador;
- TTS aberto promovido por A/B humano;
- WebRTC de produção;
- modelo treinado;
- cérebro aberto de qualidade promovido para operação sem rede;
- avaliação humana.

## Regras de concorrência

- Nova fala cancela qualquer início de resposta ainda não reproduzido.
- Barge-in cancela o buffer do player antes de processar o conteúdo.
- Uma nova `epoch` invalida resultados de tarefas antigas.
- Backchannel nunca adquire o turno principal.
- Resultado externo só entra quando o usuário não está falando ou quando a
  política escolhe uma confirmação mínima.
- Estado de ferramenta é separado de texto conversacional.
