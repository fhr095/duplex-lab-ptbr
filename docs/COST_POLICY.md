# Política de custo e independência de provider

## Decisão

Nenhum teste extensivo depende de uma API paga ou de um modelo específico.
Todos os candidatos implementam a mesma porta de streaming e produzem o mesmo
contrato de traces. Um provider externo é uma dependência de experimento, não
uma dependência da camada de voz.

Uma IA externa pode participar da criação ou crítica de dados. Sua saída deve
ser armazenada com proveniência e transformada em artefato reproduzível antes
de entrar na regressão. O custo ocorre uma vez na geração, não em toda execução.

## Quatro faixas

| Faixa | Uso | Chamadas pagas | Gate |
| --- | --- | ---: | --- |
| Regressão | testes, cenários, UI e política temporal | 0 | todo commit |
| Canário | autenticação, protocolo e latência de um provider | 1 | manual e explícito |
| Benchmark | qualidade semântica em amostra congelada | pequena e limitada | só após gates locais |
| Geração de dados | novas famílias e auditoria adversarial | limitada e cacheada | apenas quando amplia cobertura |

`npm start`, `npm test`, `npm run eval` e o smoke normal usam o provider local.
O canário exige `ALLOW_PAID_PROBE=1`. Um modelo Sol exige ainda uma segunda
autorização e recebe um teto de cinco chamadas por processo.

## Ordem dos candidatos

1. simulador determinístico e respostas gravadas;
2. pesos abertos locais;
3. modelo econômico externo;
4. modelo premium como juiz ou referência superior.

O modelo premium não gera toda a massa de testes. Ele avalia uma amostra pequena
e estável, ou resolve somente tarefas cuja melhora de qualidade justifique o
custo medido.

Volume vem de regras, mutações, modelos locais/econômicos, múltiplos TTSs e
transformações acústicas. Modelos premium tratam diversidade difícil, crítica e
oráculos ambíguos. Usar internet nessa etapa não altera o objetivo de o runtime
final operar localmente: geração de laboratório e dependência de produto são
contabilizadas separadamente.

## Referência econômica

Preços padrão de contexto curto consultados em 30/07/2026, por 1 milhão de
tokens:

| Modelo | Entrada | Saída | Relação com Luna |
| --- | ---: | ---: | ---: |
| gpt-5.6-luna | US$ 0,20 | US$ 1,20 | 1× |
| gpt-5.6-terra | US$ 2,00 | US$ 12,00 | 10× |
| gpt-5.6-sol | US$ 5,00 | US$ 30,00 | 25× |

Exemplo meramente operacional: um turno com 500 tokens de entrada e 80 de saída
custaria aproximadamente US$ 0,000196 em Luna, US$ 0,00196 em Terra e
US$ 0,0049 em Sol. Dez mil turnos desse tamanho seriam aproximadamente
US$ 1,96, US$ 19,60 e US$ 49,00, respectivamente. Isso não inclui ferramentas,
contexto longo, processamento regional ou variações de cache.

Fonte: <https://developers.openai.com/api/docs/pricing>.

## Critério para promover um provider

Um provider só entra no caminho padrão se:

1. superar a baseline no mesmo pack;
2. respeitar os gates de latência e cancelamento;
3. registrar tokens, latência e falhas;
4. justificar custo incremental por ganho mensurável;
5. poder ser removido sem alterar navegador, voz ou contrato de traces.
