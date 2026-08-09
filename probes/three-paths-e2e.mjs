// Medição E2E dos três caminhos da arbitragem: LOCAL_FINAL, BRIDGE+reasoner
// e PASS. Áudio real entra pelo WebSocket; no transcript.final o probe faz o
// que o cliente faria (POST /api/turn) e busca o primeiro byte de áudio
// SEMÂNTICO no TTS streaming — a métrica é fim-da-fala→áudio-semântico, não
// tempo interno de rota.
//
// Requer servidor com FAST_PATH=1 e TTS sidecar (stream=1).

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { encodePcmFrame } from "../web/pcm-wire.mjs";
import {
  extractSpeechChunks,
  readNdjson
} from "../web/stream-utils.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const MODELS = "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/" +
  "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models";
const HTTP = "http://127.0.0.1:4173";
const WS_URL = "ws://127.0.0.1:4173/api/audio";

const CASES = [
  { file: `${MODELS}/fala-saudacao.wav`, expectedPath: "LOCAL_FINAL" },
  { file: `${MODELS}/fala-correcao.wav`, expectedPath: "BRIDGE" },
  { file: `${MODELS}/fala-pergunta.wav`, expectedPath: "PASS" }
];

async function firstSemanticAudioByte(text, sinceMs) {
  const response = await fetch(
    `${HTTP}/api/tts?stream=1&text=${encodeURIComponent(text)}`
  );
  const HEADER_BYTES = 44;
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > HEADER_BYTES) {
      const at = performance.now();
      // drena o resto sem medir
      void (async () => {
        try {
          for await (const rest of response.body) {
            void rest;
          }
        } catch {
          // stream abortado é aceitável
        }
      })();
      return at - sinceMs;
    }
  }
  return null;
}

async function runCase({ file, expectedPath }, index) {
  const wave = await readFile(file);
  const decoded = decodeWaveToPcm16(wave);
  const bytesPerFrame = (decoded.sampleRate * 20) / 1000 * 2;
  const silence = Buffer.alloc(decoded.sampleRate * 2 * 2);
  const stream = Buffer.concat([decoded.pcm, silence]);

  const result = {
    case: file.split("/").at(-1),
    expectedPath,
    observedPath: null,
    finalText: null,
    speechEndAtMs: null,
    finalAtMs: null,
    bridgeText: null,
    endToSemanticAudioMs: null,
    reasonerText: null,
    error: null
  };

  let settle;
  const done = new Promise((resolvePromise) => {
    settle = resolvePromise;
  });

  const finishTurn = async (finalEvent) => {
    try {
      result.finalAtMs = finalEvent.receivedAtMs;
      result.finalText = String(finalEvent.text ?? "").trim();
      const speechEnd = result.speechEndAtMs ?? result.finalAtMs;
      const response = await fetch(`${HTTP}/api/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: result.finalText,
          history: [],
          sessionId: `three-paths-${index}`,
          turnId: "turn-1"
        })
      });
      let buffered = "";
      let audioMeasured = false;
      for await (const event of readNdjson(response)) {
        if (event.type === "route" && event.fastPath) {
          result.observedPath = event.fastPath.action;
        }
        if (event.type === "bridge" && !audioMeasured) {
          result.bridgeText = event.text;
          audioMeasured = true;
          result.endToSemanticAudioMs =
            await firstSemanticAudioByte(event.text, speechEnd);
        }
        if (event.type === "delta") {
          buffered += event.delta;
          if (!audioMeasured) {
            const split = extractSpeechChunks(buffered);
            if (split.chunks.length > 0) {
              audioMeasured = true;
              result.endToSemanticAudioMs =
                await firstSemanticAudioByte(split.chunks[0], speechEnd);
            }
          }
        }
        if (event.type === "done") {
          result.reasonerText = buffered.trim().slice(0, 120) || null;
          if (!audioMeasured && buffered.trim()) {
            audioMeasured = true;
            result.endToSemanticAudioMs = await firstSemanticAudioByte(
              extractSpeechChunks(buffered, { flush: true }).chunks[0] ??
                buffered.trim(),
              speechEnd
            );
          }
        }
      }
      settle();
    } catch (error) {
      result.error = error.message;
      settle();
    }
  };

  const socket = new WebSocket(WS_URL, {
    perMessageDeflate: false,
    maxPayload: 64 * 1024
  });
  await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => rejectPromise(new Error("timeout de conexão")), 10_000
    );
    socket.once("error", rejectPromise);
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        return;
      }
      const event = JSON.parse(data.toString("utf8"));
      event.receivedAtMs = performance.now();
      if (event.type === "audio.ready") {
        socket.send(JSON.stringify({ type: "audio.start" }));
      } else if (event.type === "audio.started") {
        clearTimeout(timeout);
        resolvePromise();
      } else if (event.type === "endpoint.committed") {
        result.speechEndAtMs = event.receivedAtMs -
          Math.max(0, Number(event.silenceMs) || 0);
      } else if (event.type === "transcript.final") {
        void finishTurn(event);
      }
    });
  });

  const startedAt = performance.now();
  let sequence = 0;
  let sampleStart = 0;
  for (let offset = 0; offset < stream.length; offset += bytesPerFrame) {
    const pcm = stream.subarray(
      offset, Math.min(stream.length, offset + bytesPerFrame)
    );
    if (pcm.length % 2 !== 0 || pcm.length === 0) {
      break;
    }
    await delay(Math.max(
      0,
      startedAt + (offset / 2 / decoded.sampleRate) * 1000 -
        performance.now()
    ));
    socket.send(Buffer.from(encodePcmFrame({
      sequence,
      sampleStart,
      pcm16: pcm
    })), { binary: true });
    sequence += 1;
    sampleStart += pcm.length / 2;
  }

  try {
    await Promise.race([done, delay(25_000).then(() => {
      throw new Error("turno não concluiu em 25s");
    })]);
  } catch (error) {
    result.error = error.message;
  } finally {
    socket.close();
  }
  return result;
}

for (const [index, testCase] of CASES.entries()) {
  const result = await runCase(testCase, index);
  console.log(JSON.stringify({
    caso: result.case,
    esperado: result.expectedPath,
    observado: result.observedPath,
    final: result.finalText,
    ponte: result.bridgeText,
    "fim→áudio-semântico": result.endToSemanticAudioMs === null
      ? null
      : `${Math.round(result.endToSemanticAudioMs)}ms`,
    reasoner: result.reasonerText,
    erro: result.error
  }, null, 1));
  await delay(400);
}
