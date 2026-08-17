# Guia operacional para agentes/sessões

## Rodar a engine (candidata v1+roda)

```bash
bash scripts/setup-kroko.sh && bash scripts/setup-engine-voices.sh  # 1ª vez
OBSERVER=1 PORT=4173 bash scripts/start-candidata.sh
```

O perfil pina `ASR_PARTIAL_ENGINE=kroko` e `TTS_PROVIDER=supertonic`;
todo o resto é default de código (final TAGARELA int8, teto 30s, guarda
400 chamadas/processo). `.env` guarda SÓ segredos/opt-ins — nunca
política. Gates: `node --test` (sem modelos) · `node
scripts/engine-doctor.mjs --turns N` (E2E com engine no ar) ·
`bash scripts/clean-room.sh <dir-em-DISCO>` (release; /tmp é tmpfs e
NÃO comporta torch).

## Branches (disciplina)

- `main` = última candidata mergeada. `engine/candidata-vN` = cortes
  CONGELADOS com manifesto (`docs/CANDIDATA-V1.md`) — nunca commit
  direto.
- `obs/observador-v0` = linha de trabalho da roda (engine viva).
- `exp/percepcao-v0` = frente percepção (notes/percepcao/000-007 é a
  linha de raciocínio completa; probes/percepcao/ = harnesses).
- `exp/caminho-ouro` = pesquisa antiga (carteira em notes/).

## Regras que não se negociam

- Privacidade: gravações/transcrições do usuário ficam em `var/`
  (gitignorado) — versionar só agregados sanitizados (`eval/evidencia/`,
  notes). Envio de áudio a APIs externas só com autorização explícita
  por sessão de escuta; pods RunPod auto-controlados exigem autorização
  de gasto com teto e recibo de pods=0 ao final.
- Evidência: decisão da engine e transcrição ao vivo são HIPÓTESES,
  nunca ground truth; régua T1-T5 no `docs/CANDIDATA-V1.md` §2;
  baseline grátis primeiro; replay verde ≠ promoção.
- Observador: pacote = 1 processo de engine (várias sessões de mic);
  wav vive em relógio de AMOSTRAS (âncoras) — nunca posicionar por
  relógio de parede; `corpus-excluir.json` por pacote (eixo do wav)
  exclui janelas que não são teste; leitos nunca leem pacote com engine
  escrevendo (snapshot antes).
- Análise de sessão: `node scripts/observador.mjs empacotar|
  retranscrever|escutar --autorizo-envio --desde <segundos|mm:ss>|
  correlacionar` + minerador de feedback à parte
  (`scripts/observador-minerar-feedback.mjs <pacote>`); escuta cega
  SEMPRE antes de abrir logs. Telemetria de políticas: eventos
  `turno.absorvido.*` e `reproducao.gate` no pagina.jsonl. Health:
  `GET /api/health` (não existe `/health`).
- Replays: SEMPRE em engine DESCARTÁVEL (porta 4321, BRAIN local —
  convenção de `scripts/observador-replay-bateria.sh`); nunca apontar
  replay para a engine viva da 4173 (contamina pacote + gasta cérebro
  real). `--desde/--ate` (segundos|mm:ss, eixo do WAV) recortam janela
  preservando o sampleStart absoluto; janelas no meio de um bloco
  acústico precisam de RUN-IN (~60 s) para o estado do VAD convergir ao
  da sessão viva. Replay toca em tempo real e repassa a `cena` dos
  finais ao /api/turn (exercita a confirmação de cena).

## Estado da frente percepção (2026-08-17)

4 challengers + microscópio Qwen3-Omni: reprovados p/ endpoint/
sobreposição (features grátis vencem; confianças não-calibradas).
Promovidos e VIVOS na engine: políticas commit-revisável + gate-de-
entrada (web/absorcao-turno.mjs, web/gate-entrada.mjs) e a AÇÃO DE CENA
(spec notes/percepcao/008 = `var/observador/testes/cena/ACAO-CENA.md`):
worker `scripts/cena-tagger-worker.py` (setup: `scripts/setup-cena.sh`,
venv do kroko) + `src/audio/avaliador-cena.mjs` → `cena.avaliada` em
todo final + confirma-antes-de-agir no /api/turn
(`src/interaction/confirmacao-cena.mjs`, CENA_TAGGER=0 desliga) +
mensagens de vazio cientes de cena no cliente. Aceite executado
2026-08-17 (replay a6c1 11700–11830: confirmação em vez de conversa
fantasma; contra-prova 685b limpa: zero confirmações) — detalhes em
`var/observador/testes/cena/ACEITE-2026-08-17.md`. Pendente T4: sessão
viva com música. Detalhe e gatilhos dos adormecidos:
`notes/percepcao/006` e `007` na exp/percepcao-v0.
