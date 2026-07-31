import test from "node:test";
import assert from "node:assert/strict";

import {
  BrowserAudioRenderProbe,
  BrowserPcmCapture,
  buildPcmMediaConstraints,
  DEFAULT_PCM_AUDIO_CONSTRAINTS,
  mapAudioContextTimeToPerformance
} from "../web/pcm-capture.mjs";

class FakeNode extends EventTarget {
  connections = [];
  disconnected = false;

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakePort {
  onmessage = null;
  posted = [];
  closed = false;

  postMessage(message) {
    this.posted.push(message);
  }

  close() {
    this.closed = true;
  }

  emit(data) {
    this.onmessage?.({ data });
  }
}

class FakeAudioWorkletNode extends FakeNode {
  static instances = [];

  constructor(context, name, options) {
    super();
    this.context = context;
    this.name = name;
    this.options = options;
    this.port = new FakePort();
    FakeAudioWorkletNode.instances.push(this);
  }
}

class FakeTrack extends EventTarget {
  enabled = true;
  muted = false;
  readyState = "live";
  stopped = false;

  getSettings() {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48_000
    };
  }

  stop() {
    this.stopped = true;
  }
}

class FakeAudioContext extends EventTarget {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.state = "suspended";
    this.sampleRate = 48_000;
    this.currentTime = 10;
    this.baseLatency = 0.01;
    this.outputLatency = 0.02;
    this.destination = new FakeNode();
    this.loadedModule = null;
    this.audioWorklet = {
      addModule: async (url) => {
        this.loadedModule = url;
      }
    };
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource() {
    return new FakeNode();
  }

  createMediaElementSource() {
    return new FakeNode();
  }

  createGain() {
    const gain = new FakeNode();
    gain.gain = { value: 1 };
    return gain;
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }
}

function fakeBrowserDependencies() {
  FakeAudioContext.instances = [];
  FakeAudioWorkletNode.instances = [];
  const track = new FakeTrack();
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track]
  };
  let requestedConstraints = null;
  const mediaDevices = {
    async getUserMedia(constraints) {
      requestedConstraints = constraints;
      return stream;
    }
  };

  return {
    track,
    mediaDevices,
    get requestedConstraints() {
      return requestedConstraints;
    }
  };
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("constraints pedem AEC, NS e AGC como ideais, não obrigatórios", () => {
  const constraints = buildPcmMediaConstraints();

  assert.deepEqual(constraints, {
    audio: {
      echoCancellation: { ideal: "all" },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48_000 },
      latency: { ideal: 0.02 }
    },
    video: false
  });
  assert.equal(
    Object.hasOwn(constraints.audio.echoCancellation, "exact"),
    false
  );
});

test("override não muta o conjunto default compartilhado", () => {
  const constraints = buildPcmMediaConstraints({
    autoGainControl: { ideal: false },
    deviceId: { exact: "microfone-de-teste" }
  });

  assert.deepEqual(constraints.audio.autoGainControl, { ideal: false });
  assert.deepEqual(
    constraints.audio.deviceId,
    { exact: "microfone-de-teste" }
  );
  assert.deepEqual(
    DEFAULT_PCM_AUDIO_CONSTRAINTS.autoGainControl,
    { ideal: true }
  );
});

test("captura exige consumidor explícito de frames", () => {
  assert.throws(
    () => new BrowserPcmCapture(),
    /onFrame é obrigatório/
  );
});

test("ACK só libera crédito depois que o consumidor termina", async () => {
  const browser = fakeBrowserDependencies();
  let finishDelivery;
  const capture = new BrowserPcmCapture({
    mediaDevices: browser.mediaDevices,
    AudioContextCtor: FakeAudioContext,
    AudioWorkletNodeCtor: FakeAudioWorkletNode,
    onFrame: () => new Promise((resolve) => {
      finishDelivery = resolve;
    })
  });

  await capture.start();
  const node = FakeAudioWorkletNode.instances[0];
  assert.equal(node.options.numberOfOutputs, 1);
  assert.deepEqual(node.options.outputChannelCount, [1]);
  assert.equal(
    node.options.processorOptions.keepAliveAmplitude,
    1e-8
  );
  assert.equal(node.options.processorOptions.maxInFlightFrames, 32);
  assert.equal(capture.stats.clock.contextState, "running");
  assert.equal(capture.stats.clock.contextSampleRate, 48_000);
  assert.equal(capture.stats.track.muted, false);
  assert.equal(capture.stats.track.readyState, "live");
  node.port.emit({
    type: "pcm-frame",
    sequence: 0,
    sampleStart: 0,
    sampleEnd: 320,
    sampleRate: 16_000,
    durationMs: 20,
    pcmBuffer: new Int16Array(320).buffer
  });
  await nextTask();

  assert.equal(capture.stats.pendingDeliveries, 1);
  assert.equal(
    node.port.posted.some((message) => message.type === "pcm-ack"),
    false
  );

  finishDelivery();
  await nextTask();

  assert.equal(capture.stats.deliveredFrames, 1);
  assert.equal(capture.stats.pendingDeliveries, 0);
  assert.deepEqual(
    node.port.posted.find((message) => message.type === "pcm-ack"),
    { type: "pcm-ack", sequence: 0 }
  );

  const telemetryPromise = capture.requestTelemetry();
  assert.equal(
    node.port.posted.findLast(
      (message) => message.type === "pcm-telemetry-request"
    ).type,
    "pcm-telemetry-request"
  );
  node.port.emit({
    type: "pcm-telemetry",
    reason: "requested",
    generatedFrames: 1,
    droppedFrames: 0
  });
  const telemetry = await telemetryPromise;
  assert.equal(telemetry.worklet.reason, "requested");
  assert.equal(telemetry.track.settings.echoCancellation, true);

  await capture.stop("test-finished");
  assert.equal(browser.track.stopped, true);
  assert.equal(FakeAudioContext.instances[0].state, "closed");
});

test("entregas assíncronas preservam a ordem PCM e dos ACKs", async () => {
  const browser = fakeBrowserDependencies();
  let finishFirst;
  const delivered = [];
  const capture = new BrowserPcmCapture({
    mediaDevices: browser.mediaDevices,
    AudioContextCtor: FakeAudioContext,
    AudioWorkletNodeCtor: FakeAudioWorkletNode,
    onFrame(frame) {
      delivered.push(frame.sequence);
      if (frame.sequence === 0) {
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      }
    }
  });
  await capture.start();
  const port = FakeAudioWorkletNode.instances[0].port;
  for (const sequence of [0, 1]) {
    port.emit({
      type: "pcm-frame",
      sequence,
      sampleStart: sequence * 320,
      sampleEnd: (sequence + 1) * 320,
      sampleRate: 16_000,
      durationMs: 20,
      pcmBuffer: new Int16Array(320).buffer
    });
  }
  await nextTask();

  assert.deepEqual(delivered, [0]);
  assert.equal(
    port.posted.some((message) => message.type === "pcm-ack"),
    false
  );

  finishFirst();
  await nextTask();
  await nextTask();

  assert.deepEqual(delivered, [0, 1]);
  assert.deepEqual(
    port.posted
      .filter((message) => message.type === "pcm-ack")
      .map((message) => message.sequence),
    [0, 1]
  );
  await capture.stop("test-finished");
});

test("lacunas de sequência e amostras ficam observáveis", async () => {
  const browser = fakeBrowserDependencies();
  const capture = new BrowserPcmCapture({
    mediaDevices: browser.mediaDevices,
    AudioContextCtor: FakeAudioContext,
    AudioWorkletNodeCtor: FakeAudioWorkletNode,
    onFrame: () => {}
  });
  await capture.start();
  const port = FakeAudioWorkletNode.instances[0].port;

  for (const frame of [
    { sequence: 0, sampleStart: 0, sampleEnd: 320 },
    { sequence: 3, sampleStart: 960, sampleEnd: 1_280 }
  ]) {
    port.emit({
      type: "pcm-frame",
      ...frame,
      sampleRate: 16_000,
      durationMs: 20,
      pcmBuffer: new Int16Array(320).buffer
    });
  }
  await nextTask();

  assert.equal(capture.stats.observedSequenceGaps, 2);
  assert.equal(capture.stats.observedSampleGaps, 640);
  await capture.stop("test-finished");
});

test("AbortSignal externo encerra contexto e microfone", async () => {
  const browser = fakeBrowserDependencies();
  const controller = new AbortController();
  const capture = new BrowserPcmCapture({
    mediaDevices: browser.mediaDevices,
    AudioContextCtor: FakeAudioContext,
    AudioWorkletNodeCtor: FakeAudioWorkletNode,
    signal: controller.signal,
    onFrame: () => {}
  });
  await capture.start();

  controller.abort("fim-da-sessão");
  await capture.stop();

  assert.equal(capture.state, "stopped");
  assert.equal(capture.signal.aborted, true);
  assert.equal(capture.stats.stopReason, "fim-da-sessão");
  assert.equal(browser.track.stopped, true);
  assert.equal(FakeAudioWorkletNode.instances[0].port.closed, true);
});

test("mapeia o relógio do render para performance pelo output timestamp", () => {
  const context = {
    baseLatency: 0.01,
    outputLatency: 0.02,
    currentTime: 10,
    getOutputTimestamp() {
      return {
        contextTime: 10,
        performanceTime: 5_000
      };
    }
  };

  assert.deepEqual(
    mapAudioContextTimeToPerformance(context, 10.025),
    {
      performanceTimeMs: 5_025,
      mapping: "audio-context-output-timestamp",
      baseLatencyMs: 10,
      outputLatencyMs: 20
    }
  );
});

test("render probe mede o último quantum e declara o escopo não físico", async () => {
  FakeAudioContext.instances = [];
  FakeAudioWorkletNode.instances = [];
  const contextTimestamp = {
    contextTime: 10,
    performanceTime: 5_000
  };
  class RenderAudioContext extends FakeAudioContext {
    getOutputTimestamp() {
      return contextTimestamp;
    }
  }
  const events = [];
  const probe = new BrowserAudioRenderProbe({
    AudioContextCtor: RenderAudioContext,
    AudioWorkletNodeCtor: FakeAudioWorkletNode,
    workletModuleUrl: "blob:render-probe-test",
    onEvent: (event) => events.push(event)
  });

  const source = await probe.attachMediaElement({});
  const node = FakeAudioWorkletNode.instances[0];
  node.port.emit({
    type: "render-active",
    activeStartContextTime: 10.01,
    activeEndContextTime: 10.012,
    threshold: 0.0003
  });
  const resultPromise = probe.measureStop(4_990);
  const request = node.port.posted.find(
    (message) => message.type === "render-stop-measure"
  );
  node.port.emit({
    type: "render-stop-observed",
    id: request.id,
    lastActiveEndContextTime: 10.02,
    observedContextTime: 10.026,
    requiredSilenceQuanta: 2,
    threshold: 0.0003
  });
  const result = await resultPromise;

  assert.equal(source.connections[0], node);
  assert.equal(result.latencyMs, 30);
  assert.equal(result.lastRenderedAtMs, 5_020);
  assert.equal(result.renderedThroughTrigger, true);
  assert.equal(result.mapping, "audio-context-output-timestamp");
  assert.match(result.scope, /não mede cauda/u);
  assert.equal(
    events.some((event) => event.type === "assistant.render.active"),
    true
  );
  assert.equal(
    events.some((event) => event.type === "assistant.render.stopped"),
    true
  );

  const staleResultPromise = probe.measureStop(5_010);
  const staleRequest = node.port.posted.findLast(
    (message) => message.type === "render-stop-measure"
  );
  node.port.emit({
    type: "render-stop-observed",
    id: staleRequest.id,
    lastActiveEndContextTime: 10.005,
    observedContextTime: 10.026,
    requiredSilenceQuanta: 2,
    threshold: 0.0003
  });
  const staleResult = await staleResultPromise;
  assert.ok(Math.abs(staleResult.latencyMs + 5) < 0.001);
  assert.equal(staleResult.renderedThroughTrigger, false);

  probe.disconnectSource(source);
  assert.equal(source.disconnected, true);
  await probe.close();
  assert.equal(RenderAudioContext.instances[0].state, "closed");
});
