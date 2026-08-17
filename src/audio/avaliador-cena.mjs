// Avaliador de CENA ACÚSTICA — cliente do worker persistente de
// audio-tagging (scripts/cena-tagger-worker.py, protocolo JSONL do
// PersistentAsrWorker). Produz o sinal `cena.avaliada` por janela de
// turno: veredicto adversa|limpa a partir da mediana das fatias.
// Contrato da ação e calibração: notes/percepcao/008-acao-cena.md
// (bancada em var/observador/testes/cena/RELATORIO.md — AUC 1,00,
// vão 0,08×0,97 em torno do limiar 0,50).

import { resolve } from "node:path";

import { PersistentAsrWorker } from "../asr/worker-client.mjs";

export const CENA_VERSION = "cena-v0";

// Limiar titular no meio do vão medido; fallback grátis = limiar de
// FPR 0 no leito (pega ~36% das adversas — degradado, nunca decide
// com o tagger vivo).
export const LIMIAR_MUSIC = 0.5;
export const LIMIAR_GRAVES_VOZ_FALLBACK = 12.4;

export function veredictoCena(resultado) {
  if (!resultado || typeof resultado !== "object") {
    return { veredicto: "limpa", fonte: "indisponivel" };
  }
  if (resultado.modo === "tagger" && Number.isFinite(resultado.music)) {
    return {
      veredicto: resultado.music >= LIMIAR_MUSIC ? "adversa" : "limpa",
      fonte: "tagger"
    };
  }
  if (Number.isFinite(resultado.gravesVoz)) {
    return {
      veredicto:
        resultado.gravesVoz >= LIMIAR_GRAVES_VOZ_FALLBACK
          ? "adversa"
          : "limpa",
      fonte: "gratis"
    };
  }
  return { veredicto: "limpa", fonte: "indisponivel" };
}

export function createAvaliadorCena(options = {}) {
  const projectRoot = options.projectRoot ??
    resolve(import.meta.dirname, "../..");
  const worker = new PersistentAsrWorker({
    command:
      options.python ??
      resolve(projectRoot, ".venv-teste-kroko/bin/python"),
    requestTimeoutMs: options.requestTimeoutMs ?? 2_500,
    startTimeoutMs: options.startTimeoutMs ?? 60_000,
    workerArgs: [
      options.workerPath ??
        resolve(projectRoot, "scripts/cena-tagger-worker.py"),
      "--model-dir",
      options.modelDir ??
        resolve(
          projectRoot,
          "var/observador/testes/cena/modelo/" +
            "sherpa-onnx-zipformer-small-audio-tagging-2024-04-15"
        ),
      "--threads",
      "1"
    ]
  });

  let health = { state: "starting", engine: "cena-tagger" };
  const readyPromise = worker.start().then(
    (ready) => {
      health = {
        state: "ready",
        engine: "cena-tagger",
        model: ready.model ?? null,
        modelLoadMs: ready.modelLoadMs ?? null,
        ...(ready.aviso ? { aviso: ready.aviso } : {})
      };
      return true;
    },
    (error) => {
      health = {
        state: "error",
        engine: "cena-tagger",
        code: error.code ?? "cena_worker_error",
        message: error.message
      };
      return false;
    }
  );

  return {
    get health() {
      return health;
    },

    pronto() {
      return readyPromise;
    },

    // PCM16LE mono 16 kHz do turno → objeto `cena` ou null (sem áudio /
    // worker morto). Nunca rejeita: cena é sinal auxiliar — falha aqui
    // não pode derrubar o caminho de conversa.
    async avaliar({ pcm, turnId }) {
      if (!Buffer.isBuffer(pcm) || pcm.length < 2) {
        return null;
      }
      if (!(await readyPromise)) {
        return null;
      }
      try {
        const resultado = await worker.transcribe({
          pcm,
          sampleRate: 16_000,
          sessionId: turnId ?? "cena"
        });
        const { veredicto, fonte } = veredictoCena(resultado);
        return {
          versao: CENA_VERSION,
          veredicto,
          fonte,
          music: resultado.music ?? null,
          musicMax: resultado.musicMax ?? null,
          speech: resultado.speech ?? null,
          graves_voz: resultado.gravesVoz ?? null,
          flatness: resultado.flatness ?? null,
          dbfs: resultado.dbfs ?? null,
          fatias: resultado.fatias ?? null,
          janelaMs: resultado.janelaMs ?? null,
          audioMs: Math.round((pcm.length / 2 / 16_000) * 1_000),
          ms: resultado.roundTripMs ?? null
        };
      } catch {
        return null;
      }
    },

    async close() {
      await worker.close();
    }
  };
}
