import { WebSocketServer, WebSocket } from "ws";

import { decodePcmFrame, PCM_WIRE_PROTOCOL } from "../../web/pcm-wire.mjs";
import {
  FramePipelineTelemetry
} from "./frame-pipeline-telemetry.mjs";
import { LiveAudioSession } from "./live-audio-session.mjs";

function safeSend(socket, value) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}

export function attachAudioWebSocket(options) {
  const { server, asrRuntime } = options;
  if (!server?.on || !asrRuntime?.createSession) {
    throw new TypeError("server e asrRuntime são obrigatórios");
  }
  const telemetryIntervalFrames =
    options.telemetryIntervalFrames ?? 50;
  if (
    !Number.isSafeInteger(telemetryIntervalFrames) ||
    telemetryIntervalFrames < 1
  ) {
    throw new RangeError(
      "telemetryIntervalFrames precisa ser um inteiro positivo"
    );
  }

  const sockets = new Set();
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayload ?? 64 * 1024,
    perMessageDeflate: false
  });

  const onUpgrade = (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(
        request.url,
        `http://${request.headers.host ?? "localhost"}`
      ).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/api/audio") {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  };
  server.on("upgrade", onUpgrade);

  webSocketServer.on("connection", (socket) => {
    sockets.add(socket);
    let started = false;
    let frameProcessing = Promise.resolve();
    let firstReceivedSampleStart = null;
    let lastReceivedSampleEnd = null;
    let lastReceivedSequence = -1;
    let transportContiguous = true;
    let flushing = false;
    let processedFramesSinceTelemetry = 0;
    const pendingFlushes = new Map();
    const pipeline = new FramePipelineTelemetry({
      maxDepth: options.maxPipelineFrames ?? 16
    });
    const vadShadow = options.vadShadowRuntime?.createStream({
      onEvent: (event) => safeSend(socket, event)
    }) ?? null;
    const vadController =
      options.vadControlRuntime?.createController() ?? null;
    const session = new LiveAudioSession({
      asrRuntime,
      effectfulFinalCommitGraceMs:
        options.effectfulFinalCommitGraceMs,
      criticalFinalCommitGraceMs:
        options.criticalFinalCommitGraceMs,
      endpointConfig: options.endpointConfig,
      finalCommitGraceMs: options.finalCommitGraceMs,
      prefinalPolicy: options.prefinalPolicy,
      vadConfig: options.vadConfig,
      vad: vadController,
      mergeWindowMs: options.mergeWindowMs,
      onEvent: (event) => safeSend(socket, event)
    });
    const emitTelemetry = () => {
      if (vadController) {
        safeSend(socket, {
          type: "vad.control.telemetry",
          snapshot: vadController.snapshot
        });
      }
      safeSend(socket, {
        type: "audio.pipeline.telemetry",
        snapshot: pipeline.snapshot()
      });
    };

    const drainFlushes = () => {
      if (flushing || pendingFlushes.size === 0) {
        return;
      }
      const ready = [...pendingFlushes.values()].filter(
        (request) =>
          lastReceivedSequence >= request.expectedSequence &&
          lastReceivedSampleEnd >= request.expectedSampleEnd
      );
      if (ready.length === 0) {
        return;
      }
      flushing = true;
      const processingAtWatermark = frameProcessing;
      void (async () => {
        await processingAtWatermark;
        const shadowTelemetry = await vadShadow?.flush() ?? null;
        for (const request of ready) {
          if (!pendingFlushes.has(request.requestId)) {
            continue;
          }
          const coveredSamples = Math.max(
            0,
            request.expectedSampleEnd -
              (firstReceivedSampleStart ?? 0)
          );
          const expectedFullWindowEnd =
            (firstReceivedSampleStart ?? 0) +
            Math.floor(coveredSamples / 512) * 512;
          if (!transportContiguous) {
            safeSend(socket, {
              type: "audio.error",
              code: "audio_flush_non_contiguous",
              message:
                "audio.flush recusado: frames anteriores não são contíguos",
              requestId: request.requestId
            });
            pendingFlushes.delete(request.requestId);
            continue;
          }
          safeSend(socket, {
            type: "audio.flushed",
            requestId: request.requestId,
            watermark: {
              expectedSequence: request.expectedSequence,
              expectedSampleEnd: request.expectedSampleEnd,
              expectedFullWindowEnd,
              firstReceivedSampleStart,
              receivedSequence: lastReceivedSequence,
              receivedSampleEnd: lastReceivedSampleEnd
            },
            vadControl: {
              health: options.vadControlRuntime?.health ?? {
                state: "ready",
                engine: "adaptive-energy-vad"
              },
              telemetry: vadController?.snapshot ?? null
            },
            vadShadow: {
              health: options.vadShadowRuntime?.health ?? {
                state: "disabled"
              },
              telemetry: shadowTelemetry
            },
            pipeline: pipeline.snapshot()
          });
          pendingFlushes.delete(request.requestId);
        }
      })().catch((error) => {
        for (const request of ready) {
          safeSend(socket, {
            type: "audio.error",
            code: error.code ?? "audio_flush_error",
            message: error.message,
            requestId: request.requestId
          });
          pendingFlushes.delete(request.requestId);
        }
      }).finally(() => {
        flushing = false;
        queueMicrotask(drainFlushes);
      });
    };

    safeSend(socket, {
      type: "audio.ready",
      protocol: PCM_WIRE_PROTOCOL,
      vadShadow: options.vadShadowRuntime?.health ?? {
        state: "disabled"
      },
      vadControl: options.vadControlRuntime?.health ?? {
        state: "ready",
        engine: "adaptive-energy-vad"
      },
      audioPipeline: pipeline.snapshot(),
      prefinalPolicy: options.prefinalPolicy,
      telemetryIntervalFrames
    });

    socket.on("message", (data, isBinary) => {
      try {
        if (!isBinary) {
          const message = JSON.parse(data.toString("utf8"));
          if (message.type === "audio.start") {
            started = true;
            safeSend(socket, {
              type: "audio.started",
              sampleRate: PCM_WIRE_PROTOCOL.sampleRate
            });
            return;
          }
          if (message.type === "audio.stop") {
            void frameProcessing.finally(() =>
              session.close("client-stop")
            );
            safeSend(socket, { type: "audio.stopped" });
            return;
          }
          if (message.type === "audio.flush") {
            const requestId = String(message.requestId ?? "");
            if (
              !requestId ||
              requestId.length > 100 ||
              !Number.isSafeInteger(message.expectedSequence) ||
              message.expectedSequence < 0 ||
              !Number.isSafeInteger(message.expectedSampleEnd) ||
              message.expectedSampleEnd <= 0 ||
              pendingFlushes.has(requestId)
            ) {
              throw new TypeError("watermark de audio.flush inválido");
            }
            pendingFlushes.set(requestId, {
              requestId,
              expectedSequence: message.expectedSequence,
              expectedSampleEnd: message.expectedSampleEnd
            });
            drainFlushes();
            return;
          }
          throw new TypeError(`mensagem desconhecida: ${message.type}`);
        }
        if (!started) {
          throw new Error("audio.start precisa preceder frames PCM");
        }
        const decoded = decodePcmFrame(data);
        const frame = {
          sequence: decoded.sequence,
          sampleStart: decoded.sampleStart,
          pcm: Buffer.from(
            decoded.pcmBytes.buffer,
            decoded.pcmBytes.byteOffset,
            decoded.pcmBytes.byteLength
          )
        };
        const sampleEnd =
          decoded.sampleStart + decoded.pcmBytes.byteLength / 2;
        let pipelineToken;
        try {
          pipelineToken = pipeline.enqueue({
            sequence: decoded.sequence,
            sampleEnd
          });
        } catch (error) {
          const pipelineSnapshot = pipeline.snapshot();
          if (vadController) {
            safeSend(socket, {
              type: "vad.control.telemetry",
              snapshot: vadController.snapshot
            });
          }
          safeSend(socket, {
            type: "audio.pipeline.telemetry",
            snapshot: pipelineSnapshot
          });
          safeSend(socket, {
            type: "audio.error",
            code: error.code ?? "audio_pipeline_error",
            message: error.message,
            pipeline: pipelineSnapshot
          });
          socket.close(1013, "audio-pipeline-overflow");
          return;
        }
        if (
          (
            lastReceivedSequence >= 0 &&
            (
              decoded.sequence !== lastReceivedSequence + 1 ||
              decoded.sampleStart !== lastReceivedSampleEnd
            )
          )
        ) {
          transportContiguous = false;
        }
        firstReceivedSampleStart ??= decoded.sampleStart;
        lastReceivedSequence = Math.max(
          lastReceivedSequence,
          decoded.sequence
        );
        lastReceivedSampleEnd = Math.max(
          lastReceivedSampleEnd ?? 0,
          sampleEnd
        );
        vadShadow?.pushFrame(frame);
        frameProcessing = frameProcessing
          .then(async () => {
            pipeline.start(pipelineToken);
            try {
              await session.pushFrame(frame);
              pipeline.complete(pipelineToken);
            } catch (error) {
              pipeline.complete(pipelineToken, { success: false });
              throw error;
            }
          })
          .then(() => {
            processedFramesSinceTelemetry += 1;
            if (
              processedFramesSinceTelemetry >=
              telemetryIntervalFrames
            ) {
              processedFramesSinceTelemetry = 0;
              emitTelemetry();
            }
          })
          .catch((error) => {
            emitTelemetry();
            safeSend(socket, {
              type: "audio.error",
              code: error.code ?? "audio_processing_error",
              message: error.message
            });
          });
        drainFlushes();
      } catch (error) {
        safeSend(socket, {
          type: "audio.error",
          code: error.code ?? "audio_protocol_error",
          message: error.message
        });
      }
    });
    socket.once("close", () => {
      sockets.delete(socket);
      pendingFlushes.clear();
      vadShadow?.close("socket-closed");
      session.close("socket-closed");
    });
    socket.once("error", () => {
      pendingFlushes.clear();
      vadShadow?.close("socket-error");
      session.close("socket-error");
    });
  });

  return {
    async close() {
      server.off("upgrade", onUpgrade);
      for (const socket of sockets) {
        socket.close(1001, "server-shutdown");
      }
      await new Promise((resolvePromise) => {
        webSocketServer.close(() => resolvePromise());
      });
    }
  };
}
