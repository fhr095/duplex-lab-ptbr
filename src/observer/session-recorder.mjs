import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { freemem, loadavg } from "node:os";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

// Observador de sessão (OBSERVER=1): captura passiva de uma interação real
// para análise perceptiva e técnica posterior. Contrato: NUNCA altera o
// comportamento da engine e NUNCA derruba o servidor — toda escrita falha em
// silêncio contábil (contador de erros no manifesto). Dados ficam locais em
// var/observador/<sessão>/ (fora do Git); exclusão por sessão via
// `node scripts/observador.mjs excluir`.

const AMOSTRAS_POR_SEGUNDO = 16_000;
const BYTES_POR_AMOSTRA = 2;
const QUADROS_POR_ANCORA = 25;

function corrigirTamanhosRiff(audio) {
  // Sidecars de streaming deixam os tamanhos RIFF abertos (0/0xFFFFFFFF);
  // a cópia arquivada precisa ser um WAV fechado e decodificável.
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF") {
    return audio;
  }
  audio.writeUInt32LE(audio.length - 8, 4);
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const id = audio.toString("ascii", offset, offset + 4);
    const declarado = audio.readUInt32LE(offset + 4);
    if (id === "data") {
      audio.writeUInt32LE(audio.length - offset - 8, offset + 4);
      break;
    }
    offset += 8 + declarado + (declarado % 2);
  }
  return audio;
}

export async function createSessionRecorder(options) {
  const raiz = options.root;
  const agora = new Date();
  const carimbo = agora
    .toISOString()
    .replaceAll(/[:T]/gu, "-")
    .slice(0, 19);
  const nome = `${carimbo}-${randomBytes(2).toString("hex")}`;
  const pasta = join(raiz, nome);
  await mkdir(join(pasta, "assistente"), { recursive: true });

  let errosEscrita = 0;
  const anotarErro = () => {
    errosEscrita += 1;
  };

  const fluxos = new Map();
  function fluxo(arquivo) {
    let atual = fluxos.get(arquivo);
    if (!atual) {
      atual = createWriteStream(join(pasta, arquivo), { flags: "a" });
      atual.on("error", anotarErro);
      fluxos.set(arquivo, atual);
    }
    return atual;
  }
  function linha(arquivo, valor) {
    try {
      fluxo(arquivo).write(`${JSON.stringify(valor)}\n`);
    } catch {
      anotarErro();
    }
  }

  const manifesto = {
    versao: "observador-v0.1",
    sessao: nome,
    iniciadoEm: agora.toISOString(),
    encerradoEm: null,
    objetivo:
      process.env.OBSERVER_OBJETIVO?.trim() ||
      "Sessão de teste livre: uma pessoa conversa em PT-BR com o " +
        "assistente de voz.",
    relogio: {
      unidade: "ms",
      referencia: "epoch do servidor (Date.now)",
      nota:
        "beacons trazem âncoras perf/epoch do cliente; o mapeamento " +
        "fica em cada entrada (t = estimado no relógio do servidor)"
    },
    captura: {
      microfone:
        "PCM16 mono 16 kHz como recebido do navegador (AEC/NS/AGC do " +
        "getUserMedia ativos — é o que a engine ouve, não a acústica " +
        "da sala)",
      assistente:
        "WAV por síntese (uid) + beacons de reprodução do cliente " +
        "(início/fim/corte com posição)",
      sala: "opcional, fornecida pela pessoa (anexar depois)"
    },
    privacidade: {
      optIn: "OBSERVER=1 explícito no arranque",
      local: "dados nunca saem desta máquina por ação do gravador",
      envioExterno:
        "escuta por modelo áudio-nativo exige autorização explícita " +
        "no harness (--autorizo-envio)",
      exclusao: "node scripts/observador.mjs excluir --sessao " + nome
    },
    runtime: options.meta ?? null,
    conexoesWs: 0,
    sinteses: 0,
    errosEscrita: 0
  };
  await writeFile(
    join(pasta, "manifesto.json"),
    `${JSON.stringify(manifesto, null, 2)}\n`
  ).catch(anotarErro);

  linha("eventos.jsonl", {
    t: Date.now(),
    canal: "processo",
    tipo: "observador.iniciado",
    pasta: nome
  });

  // Sysmon leve: memória/carga a cada 1 s + atraso do próprio timer como
  // sinal de travamento do event loop.
  let esperadoEm = Date.now() + 1_000;
  const sysmon = setInterval(() => {
    const t = Date.now();
    const uso = process.memoryUsage();
    linha("eventos.jsonl", {
      t,
      canal: "sys",
      rssMb: Math.round(uso.rss / 1_048_576),
      heapMb: Math.round(uso.heapUsed / 1_048_576),
      livreMb: Math.round(freemem() / 1_048_576),
      carga1m: Math.round(loadavg()[0] * 100) / 100,
      atrasoMs: Math.max(0, t - esperadoEm)
    });
    esperadoEm = t + 1_000;
  }, 1_000);
  sysmon.unref();

  let conexoes = 0;
  let sinteses = 0;

  return {
    pasta: nome,
    caminho: pasta,

    evento(canal, valor) {
      linha("eventos.jsonl", { t: Date.now(), canal, ...valor });
    },

    // Uma conexão WS = um arquivo mic-<n>.raw contíguo no relógio de
    // captura (lacunas viram silêncio para manter o alinhamento amostral)
    // + âncoras periódicas amostra↔relógio do servidor.
    iniciarConexaoWs() {
      conexoes += 1;
      const indice = conexoes;
      const bruto = createWriteStream(
        join(pasta, `mic-${indice}.raw`)
      );
      bruto.on("error", anotarErro);
      let primeiraAmostra = null;
      let proximaAmostra = null;
      let quadros = 0;
      let bytes = 0;
      linha("eventos.jsonl", {
        t: Date.now(),
        canal: "ws",
        conexao: indice,
        tipo: "conexao.aberta"
      });
      return {
        conexao: indice,
        evento(valor) {
          linha("eventos.jsonl", {
            t: Date.now(),
            canal: "ws",
            conexao: indice,
            ...valor
          });
        },
        quadroMic(sequencia, amostraInicio, pcm) {
          try {
            const t = Date.now();
            primeiraAmostra ??= amostraInicio;
            if (
              proximaAmostra !== null &&
              amostraInicio > proximaAmostra
            ) {
              const puladas = amostraInicio - proximaAmostra;
              // Limite de sanidade: lacunas absurdas não podem inflar o
              // arquivo (60 s máx de silêncio inserido por lacuna).
              const preencher = Math.min(
                puladas,
                60 * AMOSTRAS_POR_SEGUNDO
              );
              bruto.write(
                Buffer.alloc(preencher * BYTES_POR_AMOSTRA)
              );
              bytes += preencher * BYTES_POR_AMOSTRA;
              linha(`mic-${indice}.indice.jsonl`, {
                t,
                tipo: "lacuna",
                amostrasPuladas: puladas,
                amostrasPreenchidas: preencher,
                amostraInicio
              });
            }
            if (
              proximaAmostra === null ||
              amostraInicio >= proximaAmostra
            ) {
              bruto.write(pcm);
              bytes += pcm.length;
              proximaAmostra =
                amostraInicio + pcm.length / BYTES_POR_AMOSTRA;
            }
            if (quadros % QUADROS_POR_ANCORA === 0) {
              linha(`mic-${indice}.indice.jsonl`, {
                t,
                tipo: "ancora",
                sequencia,
                amostraInicio,
                byteOffset:
                  (amostraInicio - primeiraAmostra) * BYTES_POR_AMOSTRA
              });
            }
            quadros += 1;
          } catch {
            anotarErro();
          }
        },
        encerrar(motivo) {
          linha("eventos.jsonl", {
            t: Date.now(),
            canal: "ws",
            conexao: indice,
            tipo: "conexao.encerrada",
            motivo,
            quadros,
            bytes
          });
          bruto.end();
        }
      };
    },

    // Uma síntese TTS = um WAV arquivado por uid (o cliente gera o uid e
    // o repete nos beacons de reprodução — é a chave de junção).
    iniciarTts({ uid, texto, textoFalado, stream, provider, voz }) {
      sinteses += 1;
      const id = uid || `sem-uid-${sinteses}`;
      const inicio = Date.now();
      const pedacos = [];
      let primeiroByteEm = null;
      const registrar = (extra) => {
        linha("assistente.jsonl", {
          uid: id,
          texto,
          // Registrado só quando a normalização mudou algo — a escuta cega
          // ouve o que foi FALADO, a correlação compara com o original.
          ...(typeof textoFalado === "string" && textoFalado !== texto
            ? { textoFalado }
            : {}),
          ...(voz ? { voz } : {}),
          provider,
          stream: Boolean(stream),
          tInicio: inicio,
          tPrimeiroByte: primeiroByteEm,
          ...extra
        });
      };
      return {
        primeiroByte() {
          primeiroByteEm ??= Date.now();
        },
        pedaco(chunk) {
          primeiroByteEm ??= Date.now();
          pedacos.push(Buffer.from(chunk));
        },
        concluir(completo, extra = {}) {
          const audio = corrigirTamanhosRiff(
            completo ?? Buffer.concat(pedacos)
          );
          writeFile(
            join(pasta, "assistente", `${id}.wav`),
            audio
          ).catch(anotarErro);
          registrar({
            tFim: Date.now(),
            bytes: audio.length,
            ...extra
          });
        },
        falhar(erro) {
          registrar({
            tFim: Date.now(),
            erro: erro?.message ?? String(erro)
          });
        }
      };
    },

    // Lote de beacons do cliente: reproduções, log da página e marcações
    // humanas. O relógio perf do lote ancora cada entrada no relógio do
    // servidor (t estimado = chegada − (perfLote − perfEntrada)).
    beacon(lote, chegadaEm) {
      const perfLote = Number(lote.perfNow);
      const epochCliente = Number(lote.clientEpochMs);
      const sessaoPagina = lote.sessionId ?? null;
      for (const entrada of Array.isArray(lote.entries)
        ? lote.entries
        : []) {
        const perfEntrada = Number(entrada.p);
        const t =
          Number.isFinite(perfLote) && Number.isFinite(perfEntrada)
            ? Math.round(chegadaEm - (perfLote - perfEntrada))
            : chegadaEm;
        const destino =
          entrada.c === "reproducao"
            ? "reproducao.jsonl"
            : entrada.c === "marca"
              ? "marcas.jsonl"
              : "pagina.jsonl";
        linha(destino, {
          t,
          tChegada: chegadaEm,
          sessaoPagina,
          epochClienteLote: epochCliente,
          ...entrada
        });
      }
      linha("eventos.jsonl", {
        t: chegadaEm,
        canal: "beacon",
        tipo: "lote",
        sessaoPagina,
        entradas: Array.isArray(lote.entries) ? lote.entries.length : 0,
        desvioRelogioMs: Number.isFinite(epochCliente)
          ? chegadaEm - epochCliente
          : null
      });
    },

    async fechar() {
      clearInterval(sysmon);
      linha("eventos.jsonl", {
        t: Date.now(),
        canal: "processo",
        tipo: "observador.encerrado"
      });
      for (const atual of fluxos.values()) {
        await new Promise((resolve) => atual.end(resolve));
      }
      manifesto.encerradoEm = new Date().toISOString();
      manifesto.conexoesWs = conexoes;
      manifesto.sinteses = sinteses;
      manifesto.errosEscrita = errosEscrita;
      await writeFile(
        join(pasta, "manifesto.json"),
        `${JSON.stringify(manifesto, null, 2)}\n`
      ).catch(anotarErro);
    }
  };
}
