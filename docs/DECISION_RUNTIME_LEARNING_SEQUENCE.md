# Decisão — runtime comum e sequência até o primeiro peso

Status: **aceita em 31/07/2026**

## Contexto

Uma auditoria independente e a contranálise subsequente convergiram no alerta
central: a cascata modular é uma baseline funcional e útil, mas não deve crescer
indefinidamente como conjunto de heurísticas desconectadas.

A inspeção do repositório mostrou três centros de decisão parcialmente
diferentes:

1. `src/policies/baseline-policy.mjs`, usado pelo evaluator;
2. `src/audio/live-audio-session.mjs`, com controle acústico/temporal;
3. `web/app.mjs`, com orquestração efetivamente percebida no navegador.

Isso ameaça validade experimental: uma política pode passar no relógio virtual
enquanto a experiência real combina outras regras, timers e estados.

A fundação continua válida no escopo medido: a campanha congelou 223 testes e a
consolidação passou 224/224 após adicionar sua regressão documental; permanecem
7/7 cenários, 20/20 expectativas e fábrica v0.2 íntegra. Esses números provam
engenharia interna, não preferência humana ou generalização aprendida.

## Decisão

O EXP-0007 foi executado depois desta decisão: resolveu a divergência do PCM,
mas foi rejeitado por uma confirmação numérica incorreta. Depois da ramificação
causal limitada agora aberta:

- congelar a cascata como baseline versionada;
- extrair `InteractionKernel`, `InteractionRuntime` e
  `LocalAudioReflex`;
- fazer evaluator, backend e navegador compartilharem a mesma semântica, sem
  criar mais de uma autoridade de kernel por sessão real;
- materializar `training-trace-v1`, ledger de efeitos e holdout novo;
- provar M4a com uma capacidade estreita em shadow e sem autoridade;
- calibrar timing/rótulos com uma amostra humana pequena antes de M4b;
- conceder autoridade apenas à capacidade que vencer seus gates.

A ordem executável e seus limites permanecem somente em
[ROADMAP.md](ROADMAP.md#ordem-operacional-consolidada).

## Pontos incorporados

- congelar a cascata como referência, não como código intocável;
- permitir correção causal quando protege segurança, trace, comparação ou M4a;
- manter STOP físico imediato perto do Web Audio;
- separar proposta, aceite, despacho e efeito audível/externo;
- registrar origem e versão de cada rótulo;
- separar prova de infraestrutura (M4a) de modelo comparável (M4b);
- manter política, LLM, ASR, TTS e modelo nativo em comparações causalmente
  separadas.

## Pontos modificados

### Incerteza

O primeiro modelo produz probabilidades. `WAIT_FOR_EVIDENCE` é uma decisão de
autoridade baseada em confiança, risco e deadline. `UNCERTAIN` só vira classe
de treino se houver uma verdade observável e um experimento que justifique.

### Causalidade no trace

`triggeredBy`, `decisionContext`, `supersedes` e `epoch` registram a
cadeia operacional. O trace não chama essa relação de causalidade humana;
causalidade é demonstrada por intervenção e comparação controlada.

### Orçamento da cascata

O padrão é um timebox e até duas hipóteses na ramificação após EXP-0007, não um
limite cego de ciclos. Uma falha grave pode receber exceção explícita; melhoria
cosmética não entra.

### Referência nativa

Preparar o adaptador e desafiar cedo a ontologia é válido. Execução em GPU só
entra quando responder uma pergunta capaz de mudar uma decisão e não bloqueia
M4a. Adoção ou adaptação exige teto modular medido.

### Evidência pública

CI público melhora automação e verificabilidade, mas não transforma teste dos
próprios autores em reprodução externa independente. Manifest e checksums
precedem infraestrutura de assinatura mais complexa.

## Pontos não adotados agora

- treinar de imediato uma política com todas as ações;
- tratar 24 correções sintéticas como base suficiente de comportamento humano;
- mover o interlock físico de áudio para uma ida ao backend;
- armazenar pitch/embeddings como campos obrigatórios do trace canônico;
- tornar avaliação humana ampla ou benchmark nativo pesado bloqueadores;
- comparar política, LLM, ASR e TTS mudando todos ao mesmo tempo;
- interpretar 288 corrupções rejeitadas como 288 bugs do runtime.

## Métrica histórica corrigida

O valor de 187 ms da campanha M1 mede fim sintético de uma entrada textual
injetada pelo harness até `HTMLAudioElement.onplaying`. Ele não inclui
microfone, VAD, ASR nem cauda física do alto-falante/sala e não deve ser
chamado isoladamente de latência voz-a-voz.

## Decisões deliberadamente abertas

Não são bloqueadores da ramificação causal nem do fechamento M2.5:

- processo que hospedará a única instância autoritativa do kernel;
- primeira família de modelo M4a — começar pela baseline treinável mais simples;
- candidato nativo e provedor de GPU, somente após pergunta/orçamento;
- tamanho e protocolo da calibração humana, definidos depois dos primeiros
  traces M4a;
- licença do código, escolhida pelo proprietário em trilha de governança.

## Gatilhos para rever esta decisão

Reabrir a arquitetura somente se evidência mostrar que:

- um kernel comum não consegue representar eventos de um candidato relevante;
- o reflexo local causa mais cortes percebidos do que evita;
- sinais incrementais compactos não vencem uma baseline simples em M4b;
- um modelo nativo produz ganho humano grande sob os mesmos guardrails;
- custo ou complexidade do trace excede seu valor de replay/aprendizado.

Discordância sem novo experimento ou nova evidência não reabre a decisão.
