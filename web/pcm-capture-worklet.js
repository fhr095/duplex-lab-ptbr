import { StreamingPcmFramer } from "./pcm-dsp.mjs";

const PROCESSOR_NAME = "pcm-capture-processor";

function positiveIntegerOr(value, fallback) {
  const integer = Math.trunc(value);
  return Number.isSafeInteger(integer) && integer > 0
    ? integer
    : fallback;
}

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = options.processorOptions ?? {};
    this.maxInFlightFrames = positiveIntegerOr(
      processorOptions.maxInFlightFrames,
      32
    );
    this.telemetryEveryFrames = positiveIntegerOr(
      processorOptions.telemetryEveryFrames,
      50
    );
    this.keepAliveAmplitude = Number.isFinite(
      processorOptions.keepAliveAmplitude
    )
      ? Math.max(
          0,
          Math.min(1e-5, processorOptions.keepAliveAmplitude)
        )
      : 0;
    this.keepAlivePolarity = 1;
    this.framer = new StreamingPcmFramer({
      inputSampleRate: sampleRate,
      targetSampleRate: processorOptions.targetSampleRate ?? 16_000,
      frameDurationMs: processorOptions.frameDurationMs ?? 20
    });

    this.running = true;
    this.pendingSequences = new Set();
    this.sentFrames = 0;
    this.droppedFrames = 0;
    this.droppedSamples = 0;
    this.highWatermark = 0;
    this.lastGeneratedSequence = -1;
    this.lastTelemetryGeneratedFrames = 0;
    this.reportedDropSinceTelemetry = false;
    this.processCalls = 0;
    this.quantaWithInput = 0;
    this.emptyInputQuanta = 0;
    this.inputSamples = 0;
    this.firstProcessContextTime = null;
    this.lastProcessContextTime = null;
    this.lastInputContextTime = null;

    this.port.onmessage = ({ data }) => this.handleControl(data);
    this.postTelemetry("ready");
  }

  handleControl(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "pcm-ack") {
      this.pendingSequences.delete(message.sequence);
      return;
    }

    if (message.type === "pcm-telemetry-request") {
      this.postTelemetry("requested");
      return;
    }

    if (message.type === "pcm-stop") {
      this.running = false;
      this.postTelemetry("stopped");
    }
  }

  snapshotTelemetry(reason) {
    const framerStats = this.framer.stats;
    return {
      type: "pcm-telemetry",
      reason,
      inputSampleRate: sampleRate,
      targetSampleRate: this.framer.targetSampleRate,
      frameSamples: this.framer.frameSamples,
      frameDurationMs: this.framer.frameDurationMs,
      generatedFrames: framerStats.generatedFrames,
      sentFrames: this.sentFrames,
      droppedFrames: this.droppedFrames,
      droppedSamples: this.droppedSamples,
      inFlightFrames: this.pendingSequences.size,
      maxInFlightFrames: this.maxInFlightFrames,
      highWatermark: this.highWatermark,
      lastGeneratedSequence: this.lastGeneratedSequence,
      nextSampleStart: framerStats.framedOutputSamples,
      bufferedOutputSamples: framerStats.bufferedOutputSamples,
      processCalls: this.processCalls,
      quantaWithInput: this.quantaWithInput,
      emptyInputQuanta: this.emptyInputQuanta,
      inputSamples: this.inputSamples,
      firstProcessContextTime: this.firstProcessContextTime,
      lastProcessContextTime: this.lastProcessContextTime,
      lastInputContextTime: this.lastInputContextTime,
      keepAliveAmplitude: this.keepAliveAmplitude
    };
  }

  postTelemetry(reason) {
    this.port.postMessage(this.snapshotTelemetry(reason));
    this.lastTelemetryGeneratedFrames = this.framer.stats.generatedFrames;
    this.reportedDropSinceTelemetry = false;
  }

  maybePostTelemetry() {
    const generatedFrames = this.framer.stats.generatedFrames;
    if (
      generatedFrames - this.lastTelemetryGeneratedFrames >=
      this.telemetryEveryFrames
    ) {
      this.postTelemetry("periodic");
    }
  }

  postFrame(frame) {
    this.lastGeneratedSequence = frame.sequence;

    if (this.pendingSequences.size >= this.maxInFlightFrames) {
      this.droppedFrames += 1;
      this.droppedSamples += frame.pcm16.length;

      if (!this.reportedDropSinceTelemetry) {
        this.reportedDropSinceTelemetry = true;
        this.port.postMessage(this.snapshotTelemetry("backpressure"));
      }
      return;
    }

    this.pendingSequences.add(frame.sequence);
    this.highWatermark = Math.max(
      this.highWatermark,
      this.pendingSequences.size
    );
    this.sentFrames += 1;

    const pcmBuffer = frame.pcm16.buffer;
    this.port.postMessage({
      type: "pcm-frame",
      sequence: frame.sequence,
      sampleStart: frame.sampleStart,
      sampleEnd: frame.sampleEnd,
      sampleRate: frame.sampleRate,
      durationMs: frame.durationMs,
      pcmBuffer
    }, [pcmBuffer]);
  }

  process(inputs, outputs) {
    this.processCalls += 1;
    this.firstProcessContextTime ??= currentTime;
    this.lastProcessContextTime = currentTime;

    // Nunca reproduz o microfone. Um único impulso de amplitude muito abaixo
    // do piso audível mantém o sink de tempo real do Chromium ativo.
    for (const output of outputs) {
      for (const channel of output) {
        channel.fill(0);
        if (channel.length > 0 && this.keepAliveAmplitude > 0) {
          channel[0] =
            this.keepAliveAmplitude * this.keepAlivePolarity;
        }
      }
    }
    this.keepAlivePolarity *= -1;

    if (!this.running) {
      return false;
    }

    const inputChannels = inputs[0];
    if (!inputChannels || inputChannels.length === 0) {
      this.emptyInputQuanta += 1;
      return true;
    }

    this.quantaWithInput += 1;
    this.inputSamples += inputChannels[0]?.length ?? 0;
    this.lastInputContextTime = currentTime;
    const frames = this.framer.pushChannels(inputChannels);
    for (const frame of frames) {
      this.postFrame(frame);
    }
    this.maybePostTelemetry();

    return true;
  }
}

registerProcessor(PROCESSOR_NAME, PcmCaptureProcessor);
