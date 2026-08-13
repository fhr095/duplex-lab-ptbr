# Observador de experiência (obs/observador-v0)

Camada de observação EXTERNA à engine: grava uma sessão real de conversa,
escuta-a como uma pessoa (modelo áudio-nativo, às cegas) e só depois
correlaciona o que foi percebido com o que aconteceu tecnicamente. É um
observador da experiência — não uma política de produto e não altera o
comportamento da engine.

## Princípio das duas passagens (ordem estrutural)

1. **Escuta perceptiva cega** — o avaliador áudio-nativo recebe apenas:
   o áudio da sessão (mistura usuário+assistente), a identificação de quem
   é quem e o objetivo geral da interação. Nada de logs, métricas,
   transcrições da engine ou avaliações humanas. O relato é persistido com
   hash (`escuta/escuta-cega.json` + `.sha256`) ANTES de qualquer
   diagnóstico.
2. **Correlação técnica** — `correlacionar` se RECUSA a rodar sem a escuta
   persistida (e confere o hash). Cada momento percebido vira um dossiê
   com os sinais técnicos da janela (ASR, endpoint, arbitragem, TTS,
   reprodução, sistema), mais latências por turno e anomalias fora da
   percepção.

As marcações humanas e o veredicto da pessoa entram DEPOIS da primeira
passagem, para calibrar e confrontar o observador automático — nunca como
hipótese prévia da escuta.

## Como gravar uma sessão real

```bash
OBSERVER=1 bash scripts/start-engine.sh
# abra http://localhost:4173, clique Iniciar e converse normalmente
```

- A página mostra "observador gravando" com botões de marcação
  (demorou / entendeu errado / interrompeu / estranho / ótimo / outro) —
  use-os na hora em que algo acontecer; cada clique vira uma marcação com
  timestamp.
- Cada PROCESSO da engine = um pacote em `var/observador/<carimbo>/`.
  Reinicie a engine para começar um pacote novo.
- Opcional: grave a acústica da sala com o celular (a "experiência
  física"); o arquivo pode ser anexado ao pacote depois.
- `OBSERVER_OBJETIVO="…"` define o objetivo declarado ao avaliador cego.

## O que o pacote preserva

| arquivo | conteúdo |
|---|---|
| `manifesto.json` | configuração, fingerprint, relógios, privacidade |
| `mic-N.raw` + `.indice.jsonl` | PCM16 16 kHz que a engine ouviu + âncoras amostra↔relógio (lacunas viram silêncio) |
| `assistente/<uid>.wav` + `assistente.jsonl` | cada síntese TTS arquivada com texto e tempos |
| `reproducao.jsonl` | o que REALMENTE tocou no navegador: início/fim/corte com posição |
| `pagina.jsonl` | log completo da página (mesmo conteúdo do painel) |
| `marcas.jsonl` | marcações humanas com timestamp |
| `eventos.jsonl` | eventos do servidor: WS (ASR/VAD/endpoint), turnos (rota/fast-path/deltas), sínteses, sysmon 1 s |

Derivados do `empacotar`: `canal-usuario.wav`, `canal-assistente.wav`,
`mistura.wav` (mono, o que o ouvido cego escuta), `mistura-estereo.wav`
(L=usuário, R=assistente), `linha-do-tempo.jsonl`, `resumo.json`.

## Análise (harness)

```bash
node scripts/observador.mjs listar
node scripts/observador.mjs empacotar     --sessao <nome>
node scripts/observador.mjs retranscrever --sessao <nome>   # .venv-obs
node scripts/observador.mjs escutar       --sessao <nome> --autorizo-envio
node scripts/observador.mjs correlacionar --sessao <nome>
node scripts/observador.mjs excluir       --sessao <nome> --confirmo
```

- `retranscrever` usa faster-whisper (large-v3/medium int8, escolhido pela
  RAM livre) como pseudo-referência — NÃO é WER real sem correção humana.
  Setup único: `bash scripts/setup-observador.sh`.
- `escutar` envia SOMENTE o áudio da mistura à API da OpenAI (modelo
  áudio-nativo, ex.: gpt-audio) e exige `--autorizo-envio` explícito.
  Custo típico de uma sessão de 3–6 min: décimos de dólar (estimado no
  relatório; conferir fatura).
- O relatório final (síntese causal, confiança, menor teste) é autoria do
  agente sobre `correlacao/relatorio-base.md` — camadas sempre separadas:
  fatos medidos / escuta / marcações humanas / inferências.

## Privacidade e retenção

- **Opt-in**: nada é gravado sem `OBSERVER=1` no arranque; a página exibe
  o estado de gravação.
- **Local por padrão**: pacotes ficam em `var/observador/` (fora do Git);
  nenhum áudio sai da máquina sem `--autorizo-envio` explícito no comando
  de escuta.
- **Retenção**: pacotes permanecem até decisão de quem gravou; exclusão
  integral por sessão com `excluir --confirmo`.
- Fora do teste do próprio condutor, qualquer participante exige
  consentimento informado, pseudonimização e prazo de retenção — mesma
  regra do FASTPATH_LOG (docs/ENGINE.md).

## Limites conhecidos do v0

- O mic gravado é o sinal PÓS getUserMedia (AEC/NS/AGC) — é o que a
  engine ouve, não a acústica da sala; a experiência física fica para a
  gravação opcional de celular.
- O canal do assistente é reconstruído de sínteses + beacons (±dezenas de
  ms); retomadas após pausa são posicionadas de forma contígua.
- Pausas/retomadas de barge-in aparecem nos eventos, mas o áudio
  reconstruído não reabre o trecho pausado.
- Timestamps do avaliador cego têm precisão limitada (trechos de 75 s
  mitigam); a correlação usa janelas de ±4 s e citações de fala.
- Ensaio sintético (`observador-ensaio.mjs`) valida o encanamento, nunca
  substitui a escuta de sessão real.
