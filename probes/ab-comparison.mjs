// Comparação A/B ponta a ponta: baseline vs challenger, mesma conversa de
// 5 turnos em áudio real, mesma máquina, métricas por turno.
//
//   baseline    = Maria (SAPI) + luna, sem fast-path, sem especulação
//   challenger  = Pocket TTS + luna + FAST_PATH (LOCAL_FINAL/BRIDGE) +
//                 prefinal/espec (servidor) — TTS medido em streaming
//
// Métrica principal por turno: fim-da-fala → primeiro byte de áudio
// SEMÂNTICO (ponte ou primeira frase da resposta), do jeito que cada
// configuração realmente entrega (baseline: WAV completo via POST;
// challenger: streaming via GET).
//
// O runner sobe e derruba o servidor por configuração. Requer sidecar
// Pocket já quente em :8321.

import { spawn } from "node:child_process";
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
const PORT = 4191;
const HTTP = `http://127.0.0.1:${PORT}`;

const CONVERSATION = [
  { name: "saudação", file: "fala-saudacao.wav" },
  { name: "informa valor", file: "fala-valor.wav" },
  { name: "corrige valor", file: "fala-corrige-valor.wav" },
  { name: "pergunta conteúdo", file: "fala-pergunta.wav" },
  { name: "agradece", file: "fala-obrigado.wav" }
];

const CONFIGS = {
  baseline: {
    env: { BRAIN_PROVIDER: "openai" },
    ttsMode: "post"
  },
  challenger: {
    env: {
      BRAIN_PROVIDER: "openai",
      FAST_PATH: "1",
      TTS_PROVIDER: "pocket"
    },
    ttsMode: "stream"
  },
  // Reasoner de interação mais rápido na mesma chave (escada TTFT:
  // 5.4-mini mediana 580ms vs luna 971ms); tarefas continuam no luna.
  "challenger-fast": {
    env: {
      BRAIN_PROVIDER: "openai",
      FAST_PATH: "1",
      TTS_PROVIDER: "pocket",
      OPENAI_INTERACTION_MODEL: "gpt-5.4-mini",
      OPENAI_TASK_MODEL: "gpt-5.6-luna"
    },
    ttsMode: "stream"
  }
};
const onlyConfigs = process.argv.slice(2).filter(
  (name) => CONFIGS[name]
);

function startServer(extraEnv) {
  const child = spawn(process.execPath, ["src/cli/serve.mjs"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      VAD_CONTROL: "silero",
      VAD_SHADOW: "silero",
      SILERO_VAD_THRESHOLD: "0.85",
      SILERO_VAD_ONSET_WINDOWS: "1",
      OPENAI_MAX_REQUESTS_PER_PROCESS: "40",
      ...extraEnv
    },
    stdio: "ignore"
  });
  return child;
}

async function waitHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${HTTP}/api/health`, {
        signal: AbortSignal.timeout(2_000)
      });
      if (response.ok) {
        return;
      }
    } catch {
      // ainda subindo
    }
    await delay(2_000);
  }
  throw new Error("servidor não ficou saudável");
}

async function firstSemanticAudioMs(text, sinceMs, ttsMode) {
  if (ttsMode === "stream") {
    const response = await fetch(
      `${HTTP}/api/tts?stream=1&text=${encodeURIComponent(text)}`
    );
    let received = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > 44) {
        const at = performance.now() - sinceMs;
        void (async () => {
          try {
            for await (const rest of response.body) {
              void rest;
            }
          } catch { /* abortado */ }
        })();
        return at;
      }
    }
    return null;
  }
  const response = await fetch(`${HTTP}/api/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  await response.arrayBuffer();
  return performance.now() - sinceMs;
}

async function runConversation(configName) {
  const config = CONFIGS[configName];
  const server = startServer(config.env);
  const results = [];
  try {
    await waitHealth();
    const sessionId = `ab-${configName}-${Date.now()}`;
    const history = [];

    // Uma conexão WS para a conversa inteira (turn ids contínuos).
    const events = [];
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/api/audio`, {
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
        events.push(event);
        if (event.type === "audio.ready") {
          socket.send(JSON.stringify({ type: "audio.start" }));
        } else if (event.type === "audio.started") {
          clearTimeout(timeout);
          resolvePromise();
        }
      });
    });

    let sequence = 0;
    let sampleStart = 0;
    for (const [index, turn] of CONVERSATION.entries()) {
      const wave = await readFile(`${MODELS}/${turn.file}`);
      const decoded = decodeWaveToPcm16(wave);
      const bytesPerFrame = ((decoded.sampleRate * 20) / 1000) * 2;
      const silence = Buffer.alloc(decoded.sampleRate * 2 * 2);
      const stream = Buffer.concat([decoded.pcm, silence]);
      const finalsBefore = events.filter(
        (event) => event.type === "transcript.final"
      ).length;

      const startedAt = performance.now();
      for (let offset = 0; offset < stream.length;
           offset += bytesPerFrame) {
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

      // espera a final deste turno
      const deadline = performance.now() + 15_000;
      let finalEvent = null;
      while (performance.now() < deadline) {
        const finals = events.filter(
          (event) => event.type === "transcript.final"
        );
        if (finals.length > finalsBefore) {
          finalEvent = finals.at(-1);
          break;
        }
        await delay(20);
      }
      if (!finalEvent) {
        results.push({ turn: turn.name, error: "sem final em 15s" });
        continue;
      }
      const committed = events.findLast(
        (event) => event.type === "endpoint.committed"
      );
      const speechEnd = committed
        ? committed.receivedAtMs -
          Math.max(0, Number(committed.silenceMs) || 0)
        : finalEvent.receivedAtMs;

      const finalText = String(finalEvent.text ?? "").trim();
      const result = {
        turn: turn.name,
        finalText,
        path: null,
        bridge: null,
        endToSemanticAudioMs: null,
        preview: null
      };

      const response = await fetch(`${HTTP}/api/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: finalText,
          history: history.slice(),
          sessionId,
          turnId: `turn-${index + 1}`
        })
      });
      let buffered = "";
      let measured = false;
      for await (const event of readNdjson(response)) {
        if (event.type === "route") {
          result.path = event.fastPath?.action ?? "SEM_FASTPATH";
          if (event.mode === "delegate") {
            result.path = "DELEGATE";
          }
        }
        if (event.type === "bridge" && !measured) {
          measured = true;
          result.bridge = event.text;
          result.endToSemanticAudioMs = await firstSemanticAudioMs(
            event.text, speechEnd, config.ttsMode
          );
        }
        if (event.type === "delta") {
          buffered += event.delta;
          if (!measured) {
            const split = extractSpeechChunks(buffered);
            if (split.chunks.length > 0) {
              measured = true;
              result.endToSemanticAudioMs = await firstSemanticAudioMs(
                split.chunks[0], speechEnd, config.ttsMode
              );
            }
          }
        }
        if (event.type === "done" && !measured && buffered.trim()) {
          measured = true;
          result.endToSemanticAudioMs = await firstSemanticAudioMs(
            extractSpeechChunks(buffered, { flush: true }).chunks[0] ??
              buffered.trim(),
            speechEnd, config.ttsMode
          );
        }
      }
      result.preview = buffered.trim().slice(0, 60) ||
        result.bridge;
      history.push({ role: "user", content: finalText });
      history.push({
        role: "assistant",
        content: [result.bridge, buffered.trim()]
          .filter(Boolean).join(" ")
      });
      results.push(result);
      await delay(300);
    }
    socket.close();
  } finally {
    server.kill("SIGTERM");
    await delay(1_500);
  }
  return results;
}

const output = {};
for (const configName of onlyConfigs.length
  ? onlyConfigs
  : ["baseline", "challenger"]) {
  console.error(`\n=== ${configName} ===`);
  output[configName] = await runConversation(configName);
  for (const row of output[configName]) {
    console.error(
      `${row.turn.padEnd(18)} ` +
      (row.error
        ? `ERRO: ${row.error}`
        : `${String(Math.round(row.endToSemanticAudioMs ?? -1))
            .padStart(5)}ms · ${row.path ?? "-"}` +
          (row.bridge ? ` · ponte «${row.bridge}»` : ""))
    );
  }
}

console.log(JSON.stringify(output, null, 1));
