// Probe do challenger de resposta especulativa (dois estágios).
//
// Estágio 1: especula no endpoint.prefinal.started (texto provisório do
//            whisper-tiny) — máxima antecedência, hit incerto.
// Estágio 2: reespecula no endpoint.prefinal.text (final preparada do engine
//            final, emitida ainda na janela de silêncio) — menor antecedência,
//            hit quase certo fora de merges.
// Adoção: somente se o texto especulado igualar a final publicada
//            (normalização de caixa/pontuação); senão, caminho normal.
//
// O cérebro dispara no instante do evento (dirigido a eventos), enquanto o
// PCM continua fluindo — como no cliente real.
//
// Uso: node probes/speculation-probe.mjs [--mode both|control|speculative]
//        [--files a.wav,b.wav] [--out r.json] [--url ws://...]

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { encodePcmFrame } from "../web/pcm-wire.mjs";
import { readNdjson } from "../web/stream-utils.mjs";
import {
  SpeculativeTurn,
  normalizeUtterance,
  speculationMatches
} from "../web/speculative-turn.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

const DEFAULT_FILES = [
  "eval/generated/asr/audio/interrupcao--rate-1.wav",
  "eval/generated/asr/audio/cancelamento--rate-1.wav",
  "eval/generated/asr/audio/correcao--rate-1.wav",
  "eval/generated/asr/audio/delegacao--rate-1.wav",
  "eval/generated/asr/audio/espera-curto--rate-1.wav"
];

function parseArgs(args) {
  const options = {
    files: DEFAULT_FILES,
    frameMs: 20,
    httpBase: null,
    mode: "both",
    out: null,
    silenceMs: 2_500,
    url: process.env.DUPLEX_AUDIO_URL ?? "ws://127.0.0.1:4173/api/audio"
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--files") {
      options.files = args[++index].split(",").map((item) => item.trim());
    } else if (argument === "--mode") {
      options.mode = args[++index];
    } else if (argument === "--url") {
      options.url = args[++index];
    } else if (argument === "--out") {
      options.out = args[++index];
    } else if (argument === "--silence-ms") {
      options.silenceMs = Number.parseInt(args[++index], 10);
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  options.httpBase = options.url
    .replace(/^ws/u, "http")
    .replace(/\/api\/audio$/u, "");
  return options;
}

function connectAudio(url, onEvent) {
  const socket = new WebSocket(url, {
    perMessageDeflate: false,
    maxPayload: 64 * 1024
  });
  const ready = new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => rejectPromise(new Error("timeout conectando ao áudio")),
      10_000
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
        return;
      }
      if (event.type === "audio.started") {
        clearTimeout(timeout);
        resolvePromise();
        return;
      }
      onEvent(event);
    });
  });
  return { socket, ready };
}

async function runBrainTurn(httpBase, body) {
  let firstDeltaAtMs = null;
  let doneAtMs = null;
  let text = "";
  const response = await fetch(`${httpBase}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  for await (const event of readNdjson(response)) {
    if (event.type === "delta") {
      firstDeltaAtMs ??= performance.now();
      text += event.delta;
    } else if (event.type === "done") {
      doneAtMs = performance.now();
    } else if (event.type === "error") {
      throw new Error(event.message);
    }
  }
  return { firstDeltaAtMs, doneAtMs, text };
}

async function probeFile(options, file, mode, sessionSeq) {
  const wave = await readFile(resolve(PROJECT_ROOT, file));
  const decoded = decodeWaveToPcm16(wave);
  const samplesPerFrame =
    (decoded.sampleRate * options.frameMs) / 1_000;
  const bytesPerFrame = samplesPerFrame * 2;
  const silence = Buffer.alloc(
    Math.round((decoded.sampleRate * options.silenceMs) / 1_000) * 2
  );
  const stream = Buffer.concat([decoded.pcm, silence]);

  const sessionId = `spec-probe-${mode}-${sessionSeq}-${Date.now()}`;
  const result = {
    file: file.split("/").at(-1),
    mode,
    provisionalText: null,
    preparedText: null,
    finalText: null,
    adopted: null,
    stage1LeadMs: null,
    stage2LeadMs: null,
    finalToFirstDeltaMs: null,
    finalToDoneMs: null,
    abortedSpeculations: 0,
    responsePreview: null,
    error: null
  };

  let stage1 = null;
  let stage2 = null;
  let attempt = 0;
  let settleTurn;
  let failTurn;
  const turnSettled = new Promise((resolvePromise, rejectPromise) => {
    settleTurn = resolvePromise;
    failTurn = rejectPromise;
  });

  const abortSpeculation = (speculation) => {
    if (speculation && !speculation.settled) {
      speculation.abort();
      result.abortedSpeculations += 1;
    }
  };

  const beginSpeculation = (text) => {
    attempt += 1;
    return new SpeculativeTurn({
      baseUrl: options.httpBase,
      history: [],
      sessionId,
      text,
      turnId: `probe-turn-1-a${attempt}`
    });
  };

  const adoptSpeculation = async (speculation, finalAtMs) => {
    await speculation.commit();
    let text = "";
    for await (const event of speculation.events()) {
      if (event.type === "delta") {
        if (result.finalToFirstDeltaMs === null) {
          result.finalToFirstDeltaMs =
            speculation.firstDeltaAtMs !== null &&
            speculation.firstDeltaAtMs <= finalAtMs
              ? 0
              : performance.now() - finalAtMs;
        }
        text += event.delta;
      }
    }
    result.finalToDoneMs = performance.now() - finalAtMs;
    result.responsePreview = text.slice(0, 70);
  };

  const finishTurn = async (finalEvent) => {
    const finalAtMs = finalEvent.receivedAtMs;
    result.finalText = String(finalEvent.text ?? "").trim();
    try {
      if (mode === "speculative") {
        const candidates = [
          ["prepared", stage2],
          ["provisional", stage1]
        ];
        let chosen = null;
        for (const [label, speculation] of candidates) {
          if (
            speculation &&
            !speculation.aborted &&
            speculationMatches(
              result.finalText,
              speculation.provisionalText
            )
          ) {
            chosen = [label, speculation];
            break;
          }
        }
        if (chosen) {
          const [label, speculation] = chosen;
          result.adopted = label;
          if (label === "provisional") {
            result.stage1LeadMs = finalAtMs - speculation.startedAtMs;
            abortSpeculation(stage2);
          } else {
            result.stage2LeadMs = finalAtMs - speculation.startedAtMs;
            abortSpeculation(stage1);
          }
          await adoptSpeculation(speculation, finalAtMs);
          settleTurn();
          return;
        }
        result.adopted = "none";
        abortSpeculation(stage1);
        abortSpeculation(stage2);
      }

      const turn = await runBrainTurn(options.httpBase, {
        text: result.finalText,
        history: [],
        sessionId,
        turnId: "probe-turn-1-final"
      });
      result.finalToFirstDeltaMs =
        turn.firstDeltaAtMs === null
          ? null
          : turn.firstDeltaAtMs - finalAtMs;
      result.finalToDoneMs =
        turn.doneAtMs === null ? null : turn.doneAtMs - finalAtMs;
      result.responsePreview = turn.text.slice(0, 70);
      settleTurn();
    } catch (error) {
      failTurn(error);
    }
  };

  const { socket, ready } = connectAudio(options.url, (event) => {
    if (mode === "speculative" &&
        event.type === "endpoint.prefinal.started") {
      const provisional = String(event.provisionalText ?? "").trim();
      if (!provisional) {
        return;
      }
      if (stage1 && !stage1.settled &&
          normalizeUtterance(stage1.provisionalText) ===
            normalizeUtterance(provisional)) {
        return;
      }
      abortSpeculation(stage1);
      result.provisionalText = provisional;
      stage1 = beginSpeculation(provisional);
    } else if (mode === "speculative" &&
        event.type === "endpoint.prefinal.text") {
      const prepared = String(event.text ?? "").trim();
      if (!prepared) {
        return;
      }
      result.preparedText = prepared;
      if (stage1 && !stage1.aborted &&
          normalizeUtterance(stage1.provisionalText) ===
            normalizeUtterance(prepared)) {
        return;
      }
      abortSpeculation(stage2);
      stage2 = beginSpeculation(prepared);
    } else if (event.type === "endpoint.prefinal.cancelled") {
      abortSpeculation(stage1);
      abortSpeculation(stage2);
      stage1 = null;
      stage2 = null;
    } else if (event.type === "transcript.final") {
      void finishTurn(event);
    }
  });
  await ready;

  const streamStartedAt = performance.now();
  let sequence = 0;
  let sampleStart = 0;
  for (let offset = 0; offset < stream.length; offset += bytesPerFrame) {
    const pcm = stream.subarray(
      offset,
      Math.min(stream.length, offset + bytesPerFrame)
    );
    if (pcm.length % 2 !== 0 || pcm.length === 0) {
      break;
    }
    const offsetMs = (offset / 2 / decoded.sampleRate) * 1_000;
    await delay(Math.max(
      0,
      streamStartedAt + offsetMs - performance.now()
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
    await Promise.race([
      turnSettled,
      delay(20_000).then(() => {
        throw new Error("turno não concluiu em 20s");
      })
    ]);
  } catch (error) {
    result.error = error.message;
  } finally {
    socket.close();
  }
  return result;
}

function median(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const modes = options.mode === "both"
    ? ["control", "speculative"]
    : [options.mode];
  const results = [];
  let sessionSeq = 0;
  for (const file of options.files) {
    for (const mode of modes) {
      sessionSeq += 1;
      const result = await probeFile(options, file, mode, sessionSeq);
      results.push(result);
      const label = result.error
        ? `ERRO: ${result.error}`
        : `final→1º delta ${Math.round(result.finalToFirstDeltaMs ?? -1)}ms` +
          (mode === "speculative"
            ? ` · adoção=${result.adopted}` +
              (result.stage1LeadMs
                ? ` · lead1 ${Math.round(result.stage1LeadMs)}ms`
                : "") +
              (result.stage2LeadMs
                ? ` · lead2 ${Math.round(result.stage2LeadMs)}ms`
                : "")
            : "");
      console.log(`${result.file} [${mode}]: ${label}`);
      await delay(300);
    }
  }

  const speculative = results.filter(
    (item) => item.mode === "speculative" && !item.error
  );
  const control = results.filter(
    (item) => item.mode === "control" && !item.error
  );
  const summary = {
    generatedAt: new Date().toISOString(),
    adoption: {
      provisional: speculative.filter(
        (item) => item.adopted === "provisional"
      ).length,
      prepared: speculative.filter(
        (item) => item.adopted === "prepared"
      ).length,
      none: speculative.filter((item) => item.adopted === "none").length
    },
    controlMedianFinalToFirstDeltaMs: median(
      control.map((item) => item.finalToFirstDeltaMs)
    ),
    speculativeMedianFinalToFirstDeltaMs: median(
      speculative.map((item) => item.finalToFirstDeltaMs)
    ),
    results
  };
  console.log("\nResumo:", JSON.stringify({
    adoption: summary.adoption,
    controlMedianFinalToFirstDeltaMs:
      summary.controlMedianFinalToFirstDeltaMs,
    speculativeMedianFinalToFirstDeltaMs:
      summary.speculativeMedianFinalToFirstDeltaMs
  }, null, 2));
  if (options.out) {
    await writeFile(options.out, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Relatório: ${options.out}`);
  }
}

await main();
