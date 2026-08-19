# 011 — Marco: propriedade e endereçamento da fala (mandato 2026-08-18)

Mandato do usuário após revisão dos registros 003–010: prosseguir
autonomamente para decidir COMO evitar turnos-fantasma sem rejeitar
participantes legítimos. Restrições: nenhuma identidade persistente ou
enrollment (representação de voz = efêmera, local, descartada com a
sessão); não reabrir endpoint/emoção/nativos sem gatilho novo; política
para incerteza SEM bloqueio inicial; alvo de hardware corrigido no
plano diretor = 16 GB (8 GB é a máquina de dev, piso e não teto).

## 1. O contrato proposto (a leitura pedida)

**Tese: propriedade da fala se decide por CONTINGÊNCIA INTERACIONAL,
não por identidade.** Identidade sozinha não separa os cinco casos —
segunda pessoa legítima e transeunte são ambos "voz diferente da
âncora". O que os separa é o COMPORTAMENTO no tempo do diálogo:

- **Sessão = grupo ABERTO de participantes**, não um dono. Admissão de
  uma voz nova é por engajamento: fala nos "slots" do diálogo
  (começa a falar quando a engine termina/pergunta; responde ao
  conteúdo; campo-próximo do mic). Uma vez admitida, a voz entra no
  CONJUNTO efêmero de participantes da sessão.
- **Fala alheia é indiferente à linha do tempo do assistente**: o
  rádio/TV atravessa as falas da engine sem reagir, não responde
  perguntas, tem registro de broadcast contínuo; a conversa alheia
  próxima também não se alinha aos slots. Indiferença temporal +
  campo-distante = fora.
- **Embedding de voz = ACELERADOR, não porteiro.** A admissão é
  comportamental; o embedding efêmero (RAM, morre com a sessão) só
  memoriza a decisão — permite atribuir o próximo turno de uma voz já
  admitida instantaneamente, sem re-esperar evidência comportamental.
  Com isso: troca de interlocutor e segunda pessoa legítima entram
  sozinhas (pelo comportamento), e a engine nunca vira "usuário
  único".
- **Âncora errada se auto-corrige**: se a sessão "começar" pelo rádio,
  o rádio segue não-contingente (nunca responde, atravessa tudo) e
  decai do conjunto, enquanto o usuário real acumula turnos
  contingentes. Com sinal de presença do produto (toque/proximidade/
  câmera — existe na camada de aplicação do totem), o problema quase
  desaparece: presença ancora o início; a engine expõe a interface
  (dica de sessão) e NÃO decide sozinha quando o produto sabe mais.
- **Casos incertos**: a resposta NÃO bloqueia — muda a fala (o
  vocabulário da cena se estende: ação com efeito sob voz incerta →
  confirma antes de agir; conversa leve → responde normal). Tudo
  primeiro em SHADOW (sinal no trace, zero autoridade).

Resposta direta aos cinco casos: rádio/TV → indiferença temporal +
campo-distante; segunda pessoa legítima → contingência (admitida);
pessoa próxima falando com OUTRA → não-contingente (fala nos slots
errados, não responde à engine); troca de interlocutor → admissão
contínua por comportamento; sessão iniciada pela voz errada →
decaimento por não-contingência + âncora de presença do produto.

## 2. Leito do marco (a construir; rótulo perfeito por construção)

Cenários sintéticos sobre a infra de fundos (010) + gravações reais:
(a) usuário só (referência); (b) usuário + rádio-falado/anúncios
(fantasma puro já medido: 13/120 s); (c) SEGUNDA PESSOA LEGÍTIMA
sintética — voz TTS/CORAA em campo-próximo respondendo NOS SLOTS
(pós-fala da engine), alternando com o usuário; (d) conversa alheia —
mesmas vozes em campo-distante falando ENTRE SI, indiferentes aos
slots; (e) sobreposições. Métricas por caso: atribuição correta
(participante × alheia), fantasmas respondidos, participantes
legítimos rejeitados (o erro que o mandato proíbe).

Baselines GRÁTIS antes de modelo (regra 3 da doutrina):
1. campo-próximo: energia/dBFS do turno (usuário no totem × fundo);
2. contingência temporal: latência do onset do turno vs fim da fala da
   engine (distribuição de slots) + taxa de resposta a perguntas;
3. indiferença: fração da fala que atravessa a fala da engine sem
   ceder (o leito 004 já mede sobreposição por canal duplo).
Depois, em SHADOW: 1-2 modelos de speaker embedding pequenos
(ONNX/CPU, ~5-30 MB; candidatos da varredura a qualificar) medidos
contra os MESMOS casos, custo sob pilha completa na máquina de dev.
Comparação com sinal de presença: simulado como bit-oráculo no leito
(quanto a âncora não-acústica reduz o erro residual).

## 3. Correções de auditoria aplicadas junto (mandato 2026-08-18)

1. **Cena triestada/vetor**: `indisponivel` não cai mais em `limpa`
   (avaliador + testes; obs). "Limpa" documentado como "sem
   adversidade detectada no eixo avaliado", nunca "entrada confiável";
   cena é vetor de eixos (`eixo: "musica"` explícito; vozes e
   propriedade entram como eixos irmãos).
2. **Commit-revisável, guarda semântica de mudança de assunto**: o
   contrato (003) previa "mudança clara de assunto NÃO é absorvida";
   a implementação guarda janela/audibilidade/modo/tamanho, SEM guarda
   semântica — lacuna reconhecida. Telemetria de falso-merge sozinha
   NÃO cobre (não tem verdade de assunto). Entra no leito: casos de
   mudança-de-assunto na bateria de absorção; heurística semântica só
   se o leito mostrar dano real (hoje: zero falso-merge observado).
3. **Gate-de-entrada sob burburinho**: existe teto de 8 s (rede de
   segurança já implementada — web/app.mjs); sob fundo de vozes o
   gate degrada para +8 s de latência, não mudez. Conserto fino:
   quando o eixo de vozes/propriedade existir, cauda de fala atribuída
   a alheia não segura o gate.
4. **Metodologia corrigida no plano diretor**: o ciclo é descoberta
   humana → reprodução sintética → correção → promoção humana (a
   formulação "humano nunca descobre" contradizia a própria história
   da frente).
5. **Hardware**: alvo 16 GB registrado; challengers não são cortados
   pelo equipamento incidental de dev.

## 4. Pendências humanas (inalteradas, não bloqueiam)

T4 vivo da ação de música; gravação real de ambiente de vozes;
**evidência com um segundo falante real** (promoção do marco); voz
F4×M1.

## 5. Critério de retorno do marco

Decisão CAUSAL sobre evitar fantasmas sem rejeitar participantes
legítimos — sustentada pelo leito §2 com baselines grátis × embeddings
em shadow × oráculo de presença — ou evidência de que outra formulação
é superior. Nada promove sem a régua de sempre.
