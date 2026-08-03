# EXP-0020 — fechamento da ordem física do STOP

Status: **invalidado em 03/08/2026 — `INVALIDATE_STOP_ORDER_INSTRUMENT`;
avaliação física não realizada; zero autoridade**

## Resultado executivo

A única tentativa oficial foi aberta, consumida e não repetida. O fluxo
congelado do runner indica que a expressão do trial 1.1 terminou antes da
chamada a `waitForTtsBodies(1)`, mas nenhuma evidência desse trial foi
persistida. Após `Network.loadingFinished`, `Network.getResponseBody` devolveu
corpo vazio para a primeira resposta de `/api/tts`. O runner encerrou antes de
completar qualquer navegação e antes de construir a campanha canônica.

Por contrato, isso invalida o instrumento. Não há resultado sobre ordem dos
marcadores, estado terminal, silêncio, latência ou equivalência física. O corte
`CUT_CAUSAL_AUDIO_BRIDGE` do EXP-0019 permanece inalterado.

## Cadeia auditável

- fonte congelada do runner: `c1d2b62a8d4c58b49ff5a5e46bd5b52d5a45c6c9`;
- freeze isolado: `9b9fe202a1b4593ea43c3278b8e4c89aa6ea8329`;
- abertura isolada: `0d060b02fa0d73ae980966c43e54a4381094f042`;
- receipt + relatório, juntos e filhos diretos da abertura:
  `404a06d5a7eba90ae72690e8870966770b97902a`;
- relatório canônico:
  `eval/reports/exp-0020-stop-order-v0.1.json`;
- decisão: `INVALIDATE_STOP_ORDER_INSTRUMENT`;
- `instrumentValid=false`, `pass=false`, `claim=null` e
  `physicalEvaluation=NOT_EVALUATED`.

O relatório também enumera seis gates que aparecem `true` somente porque o
analisador congelado aplica `every([])` sem trials persistidos. Eles estão
marcados como vacuamente verdadeiros e não sustentam conclusão física. O bloco
de falha é identificado como reconstrução pós-crash a partir do receipt
write-once, stderr e observações somente-leitura; ele não finge ter sido
emitido pelo runner congelado.

## Observações operacionais não decisórias

O relatório preserva sob `observedAfterFailure`, e não como campanha válida:

- cérebro local, ASR desligado e VAD de controle por energia adaptativa;
- TTS Windows `Microsoft Maria Desktop`, cultura `pt-BR`, pronto e aquecido;
- zero requests/tokens de LLM externo e zero GPU;
- servidor ainda saudável e Chrome 150 ainda acessível por CDP 1.3;
- `localhost:4173` ainda acessível pelo Windows.

Uma checagem somente-leitura separada também observou esses requisitos antes
do comando oficial, mas ela não integra o artefato canônico. Dentro do runner,
o receipt foi escrito antes do health/CDP; por isso `campaign.health.before` e
`campaign.health.after` permanecem `null` em vez de serem reconstruídos.

Isso restringe a falha observada ao caminho de coleta do payload TTS. Não prova
que o servidor, o browser ou a pausa física estejam corretos; apenas evita
atribuir o crash a uma precondição sabidamente ausente.

## Diagnóstico exploratório posterior

Depois de tornar a invalidação imutável, três fetches TTS locais, sem STOP e
fora da campanha, consumiram a mesma frase e produziram 237.232 bytes com
SHA-256
`ca2f579e7942db94c2f50029525b2057d94964e91cfe79244bd706eb6f50cd4b`.
O digest calculado dentro do browser coincidiu com os bytes recuperados pelo
CDP em três configurações: buffers explícitos + durable messages, configuração
legada e buffers explícitos sem durable messages.

Esses probes são diagnóstico exploratório, não relatório canônico. Eles
refutam a afirmação de que buffers explícitos, sozinhos, já explicam a
recuperação: o caminho legado que falhou na tentativa oficial também passou
depois. A evidência compatível é de disponibilidade intermitente do corpo, não
de causa fechada.

O [contrato oficial do domínio Network do
CDP](https://chromedevtools.github.io/devtools-protocol/tot/Network/) define
`loadingFinished` como término da requisição, `Network.getResponseBody` como
acesso ao conteúdo servido e os limites de buffer como preservação dos
payloads da sessão. O próximo instrumento pode, portanto, tratar corpo vazio
como falha transitória de coleta, mas deve continuar fail-closed: nunca
inventar bytes nem aceitar WAV vazio.

## Aprendizado metodológico

1. mocks provaram cardinalidade e falha fechada, mas não qualificaram o limite
   real Chrome/CDP;
2. uma campanha física rara não deve ser a primeira execução real de um novo
   coletor de bytes;
3. crash precisa materializar invalidação canônica automaticamente, sem
   reconstrução manual;
4. gates sobre coleções vazias precisam ser `NOT_EVALUATED`, não `true` por
   vacuidade;
5. nenhuma dessas correções exige alterar runtime, modelo, ASR, TTS ou cérebro.

## Próxima decisão

O EXP-0021 qualificará somente o candidato fail-closed do payload CDP em
fetches TTS sem STOP. Um passe autoriza pré-registrar outra medição física da
ordem; não autoriza repetir o EXP-0020, normalizar trace ou promover o bridge.
