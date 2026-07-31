import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import { scoreTranscript } from "../src/eval/transcript-metrics.mjs";
import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import { encodePcmFrame } from "../web/pcm-wire.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function parseArgs(args) {
  const options = {
    file: "eval/generated/asr/audio/interrupcao--rate-1.wav",
    expected: "Espera, eu quis dizer outra coisa.",
    frameMs: 20,
    out: null,
    realtime: true,
    silenceMs: 1_800,
    url: process.env.DUPLEX_AUDIO_URL ??
      "ws://127.0.0.1:4173/api/audio"
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--no-realtime") {
      options.realtime = false;
    } else if (
      ["--file", "--expected", "--frame-ms", "--out", "--silence-ms",
        "--url"].includes(argument)
    ) {
      const field = argument.slice(2).replace(
        /-([a-z])/gu,
        (_, letter) => letter.toUpperCase()
      );
      const value = args[++index];
      options[field] = ["frameMs", "silenceMs"].includes(field)
        ? Number.parseInt(value, 10)
        : value;
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

function frameRms(buffer) {
  let sum = 0;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    const value = buffer.readInt16LE(offset) / 32_768;
    sum += value * value;
  }
  return Math.sqrt(sum / (buffer.length / 2));
}

async function connect(url, events) {
  const socket = new WebSocket(url, {
    perMessageDeflate: false,
    maxPayload: 64 * 1024
  });
  await new Promise((resolvePromise, rejectPromise) => {
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
      events.push({ ...event, receivedAtMs: performance.now() });
      if (event.type === "audio.ready") {
        socket.send(JSON.stringify({ type: "audio.start" }));
      } else if (event.type === "audio.started") {
        clearTimeout(timeout);
        resolvePromise();
      }
    });
  });
  return socket;
}

async function readHealth(audioUrl) {
  const url = new URL(audioUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/api/health";
  url.search = "";
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) {
    throw new Error(`health local retornou HTTP ${response.status}`);
  }
  return response.json();
}

function waitForEvent(events, type, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const deadline = performance.now() + timeoutMs;
    const poll = () => {
      const event = events.find((item) => item.type === type);
      if (event) {
        resolvePromise(event);
      } else if (performance.now() >= deadline) {
        rejectPromise(new Error(`evento ausente: ${type}`));
      } else {
        setTimeout(poll, 20);
      }
    };
    poll();
  });
}

async function flushAudio(
  socket,
  events,
  expectedSequence,
  expectedSampleEnd
) {
  const requestId = `probe-${process.pid}-${Date.now()}`;
  socket.send(JSON.stringify({
    type: "audio.flush",
    requestId,
    expectedSequence,
    expectedSampleEnd
  }));
  const event = await waitForEvent(events, "audio.flushed", 15_000);
  if (event.requestId !== requestId) {
    throw new Error("audio.flush respondeu a outro requestId");
  }
  return event;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const health = await readHealth(options.url);
  const sourceFingerprint = await createSourceFingerprint(
    PROJECT_ROOT
  );
  const wave = await readFile(resolve(PROJECT_ROOT, options.file));
  const decoded = decodeWaveToPcm16(wave);
  const samplesPerFrame = decoded.sampleRate * options.frameMs / 1_000;
  if (!Number.isInteger(samplesPerFrame)) {
    throw new RangeError("frame-ms não produz quantidade inteira de amostras");
  }
  const bytesPerFrame = samplesPerFrame * 2;
  const silence = Buffer.alloc(
    Math.round(decoded.sampleRate * options.silenceMs / 1_000) * 2
  );
  const stream = Buffer.concat([decoded.pcm, silence]);
  const events = [];
  const socket = await connect(options.url, events);
  const streamStartedAt = performance.now();
  let firstActiveOffsetMs = null;
  let lastActiveOffsetMs = null;
  let sequence = 0;
  let sampleStart = 0;

  for (let offset = 0; offset < stream.length; offset += bytesPerFrame) {
    const pcm = stream.subarray(
      offset,
      Math.min(stream.length, offset + bytesPerFrame)
    );
    if (pcm.length % 2 !== 0) {
      break;
    }
    const offsetMs = offset / 2 / decoded.sampleRate * 1_000;
    if (frameRms(pcm) >= 0.014) {
      firstActiveOffsetMs ??= offsetMs;
      lastActiveOffsetMs = offsetMs + pcm.length / 2 /
        decoded.sampleRate * 1_000;
    }
    if (options.realtime) {
      await delay(Math.max(
        0,
        streamStartedAt + offsetMs - performance.now()
      ));
    }
    socket.send(Buffer.from(encodePcmFrame({
      sequence,
      sampleStart,
      pcm16: pcm
    })));
    sequence += 1;
    sampleStart += pcm.length / 2;
  }

  const audioFlush = await flushAudio(
    socket,
    events,
    sequence - 1,
    sampleStart
  );
  const final = await waitForEvent(events, "transcript.final", 10_000);
  const speechStarted = events.find(
    (event) => event.type === "user.speech.started"
  );
  const firstPartial = events.find(
    (event) => event.type === "transcript.partial" && event.text
  );
  const endpoint = events.find(
    (event) => event.type === "endpoint.committed"
  );
  const transcript = scoreTranscript(options.expected, final.text);
  const metrics = {
    onsetDetectionMs:
      speechStarted && firstActiveOffsetMs !== null
        ? Math.round(
            speechStarted.receivedAtMs -
            (streamStartedAt + firstActiveOffsetMs)
          )
        : null,
    firstPartialAfterSpeechStartMs:
      firstPartial && speechStarted
        ? Math.round(
            firstPartial.receivedAtMs - speechStarted.receivedAtMs
          )
        : null,
    endpointAfterLastActiveMs:
      endpoint && lastActiveOffsetMs !== null
        ? Math.round(
            endpoint.receivedAtMs -
            (streamStartedAt + lastActiveOffsetMs)
          )
        : null,
    finalAfterEndpointMs:
      endpoint
        ? Math.round(final.receivedAtMs - endpoint.receivedAtMs)
        : null,
    totalUntilFinalMs: Math.round(
      final.receivedAtMs - streamStartedAt
    ),
    droppedFrameEvents: events.filter(
      (event) => event.type === "audio.frames.dropped"
    ).length
  };
  const pass =
    transcript.wer <= 0.35 &&
    metrics.onsetDetectionMs !== null &&
    metrics.onsetDetectionMs <= 180 &&
    metrics.finalAfterEndpointMs !== null &&
    metrics.finalAfterEndpointMs <= 2_000 &&
    metrics.droppedFrameEvents === 0 &&
    audioFlush.watermark?.receivedSequence >=
      audioFlush.watermark?.expectedSequence &&
    audioFlush.watermark?.receivedSampleEnd >=
      audioFlush.watermark?.expectedSampleEnd &&
    audioFlush.pipeline?.overflowCount === 0 &&
    audioFlush.pipeline?.processingErrorCount === 0 &&
    audioFlush.pipeline?.lastProcessedSequence >=
      audioFlush.watermark?.expectedSequence &&
    audioFlush.pipeline?.lastProcessedSampleEnd >=
      audioFlush.watermark?.expectedSampleEnd &&
    audioFlush.pipeline?.queueDelayMs?.p99 < 10 &&
    (
      audioFlush.vadControl?.health?.engine !== "silero-vad" ||
      (
        audioFlush.vadControl?.telemetry?.inferenceErrorCount === 0 &&
        audioFlush.vadControl?.telemetry?.gapResetCount === 0 &&
        audioFlush.vadControl?.telemetry?.lastProcessedSampleEnd >=
          audioFlush.watermark?.expectedFullWindowEnd
      )
    );
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceFingerprint,
    candidate: {
      transport: "websocket-pcm-v1",
      vad: health.vadControl ?? { state: "unknown" },
      vadShadow: health.vadShadow ?? { state: "unknown" },
      partialAsr: health.asr?.partialModel ?? "unknown",
      finalAsrEngine: health.asr?.engine ?? "unknown",
      finalAsr: health.asr?.finalModel ?? "unknown"
    },
    configuration: {
      asr: health.asr,
      interaction: health.interaction
    },
    source: {
      audio: options.file,
      expected: options.expected,
      realtime: options.realtime
    },
    actual: final.text,
    transcript,
    metrics,
    audioFlush,
    pass,
    events
  };

  socket.send(JSON.stringify({ type: "audio.stop" }));
  socket.close();
  if (options.out) {
    const outputPath = resolve(PROJECT_ROOT, options.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    pass,
    expected: options.expected,
    actual: final.text,
    wer: transcript.wer,
    metrics,
    report: options.out
  }, null, 2));
  if (!pass) {
    process.exitCode = 1;
  }
}

await main();
