# Evidência versionada — candidata v1

Este diretório carrega no Git a EVIDÊNCIA da candidata (não só a síntese
do manifesto), sob regras de sanitização:

- **nunca** áudio; **nunca** texto de fala do usuário primário;
- sessões gravadas aparecem só por pseudônimo (sufixo hex do pacote);
- dados brutos permanecem locais em `var/observador/` (fora do Git);
- CORAA é dataset público com transcrição humana (CC BY-NC-ND, uso
  restrito a avaliação) — seus textos podem aparecer;
- frases do bake-off de vozes são sintéticas (sem fala de usuário).

## Conteúdo

| arquivo | o que prova |
|---|---|
| `coraa-kroko-parciais.json` | generalização das parciais Kroko em vozes independentes: divergência média 0,387 |
| `coraa-tiny-baseline.json` | a régua do que foi substituído: whisper-tiny 0,71 nos mesmos clipes |
| `bakeoff-vozes-v2.json` | screening objetivo das 10 vozes Supertonic (frases sintéticas, dobra numérica na métrica) |
| `bateria-replays-2026-08-15.md` | 8/8 replays sem surdez/queda + controle em paridade; métricas por sessão pseudonimizada |
| `config-fingerprint.json` | fingerprint sha256 da árvore de código + modelos/vozes/envs do runtime que gerou a evidência |

Números de contexto do CORAA para o final ASR (TAGARELA 0,109 vs 0,452
do int8 genérico) estão no PDCA local (`var/observador/pdca-asr.md`,
ciclo 1 e promoção) e resumidos no manifesto `docs/CANDIDATA-V1.md`.
