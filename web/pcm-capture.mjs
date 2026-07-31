const PROCESSOR_NAME = "pcm-capture-processor";
const RENDER_PROBE_PROCESSOR_NAME = "assistant-render-probe";
const DEFAULT_WORKLET_URL = new URL(
  "./pcm-capture-worklet.js",
  import.meta.url
);
const DEFAULT_RENDER_THRESHOLD = 0.0003;
const DEFAULT_RENDER_SILENCE_QUANTA = 2;
const DEFAULT_RENDER_STOP_TIMEOUT_MS = 1_000;
const DEFAULT_CAPTURE_KEEP_ALIVE_AMPLITUDE = 1e-8;

const RENDER_PROBE_WORKLET_SOURCE = `
class AssistantRenderProbeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options.processorOptions ?? {};
    this.threshold = Number.isFinite(config.threshold)
      ? Math.max(0, config.threshold)
      : ${DEFAULT_RENDER_THRESHOLD};
    this.requiredSilenceQuanta = Number.isSafeInteger(
      config.requiredSilenceQuanta
    )
      ? Math.max(1, config.requiredSilenceQuanta)
      : ${DEFAULT_RENDER_SILENCE_QUANTA};
    this.renderActive = false;
    this.lastActiveEndContextTime = null;
    this.pendingMeasurement = null;

    this.port.onmessage = ({ data }) => {
      if (data?.type === "render-stop-measure") {
        this.pendingMeasurement = {
          id: data.id,
          silenceQuanta: 0
        };
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const frameCount = output[0]?.length ?? input[0]?.length ?? 128;
    let peak = 0;

    for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
      const target = output[channelIndex];
      const source = input[channelIndex] ?? input[0];
      if (!source) {
        target.fill(0);
        continue;
      }
      for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
        const value = source[sampleIndex] ?? 0;
        target[sampleIndex] = value;
        peak = Math.max(peak, Math.abs(value));
      }
    }

    const renderActive = peak >= this.threshold;
    if (renderActive) {
      this.lastActiveEndContextTime =
        currentTime + frameCount / sampleRate;
      if (!this.renderActive) {
        this.port.postMessage({
          type: "render-active",
          activeStartContextTime: currentTime,
          activeEndContextTime: this.lastActiveEndContextTime,
          threshold: this.threshold
        });
      }
      if (this.pendingMeasurement) {
        this.pendingMeasurement.silenceQuanta = 0;
      }
    } else if (this.pendingMeasurement) {
      this.pendingMeasurement.silenceQuanta += 1;
      if (
        this.pendingMeasurement.silenceQuanta >=
        this.requiredSilenceQuanta
      ) {
        this.port.postMessage({
          type: "render-stop-observed",
          id: this.pendingMeasurement.id,
          lastActiveEndContextTime: this.lastActiveEndContextTime,
          observedContextTime: currentTime + frameCount / sampleRate,
          requiredSilenceQuanta: this.requiredSilenceQuanta,
          threshold: this.threshold
        });
        this.pendingMeasurement = null;
      }
    }
    this.renderActive = renderActive;

    return true;
  }
}

registerProcessor(
  "${RENDER_PROBE_PROCESSOR_NAME}",
  AssistantRenderProbeProcessor
);
`;

export const DEFAULT_PCM_AUDIO_CONSTRAINTS = Object.freeze({
  // "all" pede ao navegador que remova também áudio local do sistema
  // (incluindo a própria voz sintetizada), e não apenas mídia WebRTC remota.
  // É ideal, portanto navegadores sem esse modo ainda podem selecionar o
  // melhor cancelamento de eco que suportarem.
  echoCancellation: Object.freeze({ ideal: "all" }),
  noiseSuppression: Object.freeze({ ideal: true }),
  autoGainControl: Object.freeze({ ideal: true }),
  channelCount: Object.freeze({ ideal: 1 }),
  sampleRate: Object.freeze({ ideal: 48_000 }),
  latency: Object.freeze({ ideal: 0.02 })
});

function abortError(reason = "Captura cancelada.") {
  return new DOMException(String(reason), "AbortError");
}

function cloneAudioConstraints(overrides = {}) {
  return {
    ...DEFAULT_PCM_AUDIO_CONSTRAINTS,
    ...overrides
  };
}

function safeCall(callback, value) {
  try {
    callback?.(value);
  } catch {
    // Telemetria nunca deve derrubar o caminho crítico de áudio.
  }
}

function safelyDisconnect(node) {
  try {
    node?.disconnect();
  } catch {
    // O nó pode não ter sido conectado se start falhou no meio.
  }
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function mapAudioContextTimeToPerformance(
  context,
  contextTime,
  options = {}
) {
  if (!context || !Number.isFinite(contextTime)) {
    throw new TypeError("context e contextTime finito são obrigatórios");
  }

  const performanceNow =
    options.performanceNow ??
    globalThis.performance?.now?.() ??
    Date.now();
  let timestamp = null;
  try {
    timestamp = context.getOutputTimestamp?.() ?? null;
  } catch {
    // Alguns drivers expõem o método, mas falham temporariamente ao consultá-lo.
  }

  if (
    Number.isFinite(timestamp?.contextTime) &&
    Number.isFinite(timestamp?.performanceTime)
  ) {
    return Object.freeze({
      performanceTimeMs:
        timestamp.performanceTime +
        (contextTime - timestamp.contextTime) * 1_000,
      mapping: "audio-context-output-timestamp",
      baseLatencyMs: finiteOrNull(context.baseLatency * 1_000),
      outputLatencyMs: finiteOrNull(context.outputLatency * 1_000)
    });
  }

  const currentContextTime = Number(context.currentTime);
  if (!Number.isFinite(currentContextTime)) {
    throw new TypeError("AudioContext não expôs currentTime finito");
  }
  const deviceLatencySeconds = Number.isFinite(context.outputLatency)
    ? context.outputLatency
    : Number.isFinite(context.baseLatency)
      ? context.baseLatency
      : 0;

  return Object.freeze({
    performanceTimeMs:
      performanceNow +
      (contextTime - currentContextTime + deviceLatencySeconds) * 1_000,
    mapping: "audio-context-clock-estimate",
    baseLatencyMs: finiteOrNull(context.baseLatency * 1_000),
    outputLatencyMs: finiteOrNull(context.outputLatency * 1_000)
  });
}

/**
 * Observa a saída do assistente no render thread do Chrome.
 *
 * O resultado inclui o último quantum acima do limiar mapeado para o relógio
 * de apresentação do AudioContext. Isso cobre o grafo Web Audio e a estimativa
 * do dispositivo fornecida pelo navegador, mas não mede o transdutor, a sala
 * nem uma cauda acústica física.
 */
export class BrowserAudioRenderProbe {
  #context = null;
  #node = null;
  #nextMeasurementId = 0;
  #options;
  #pending = new Map();
  #startPromise = null;
  #state = "idle";

  constructor(options = {}) {
    this.#options = {
      threshold: options.threshold ?? DEFAULT_RENDER_THRESHOLD,
      requiredSilenceQuanta:
        options.requiredSilenceQuanta ??
        DEFAULT_RENDER_SILENCE_QUANTA,
      stopTimeoutMs:
        options.stopTimeoutMs ?? DEFAULT_RENDER_STOP_TIMEOUT_MS,
      latencyHint: options.latencyHint ?? "interactive",
      onEvent: options.onEvent,
      AudioContextCtor:
        options.AudioContextCtor ??
        globalThis.AudioContext ??
        globalThis.webkitAudioContext,
      AudioWorkletNodeCtor:
        options.AudioWorkletNodeCtor ?? globalThis.AudioWorkletNode,
      BlobCtor: options.BlobCtor ?? globalThis.Blob,
      URLApi: options.URLApi ?? globalThis.URL,
      workletModuleUrl: options.workletModuleUrl ?? null
    };
  }

  get state() {
    return this.#state;
  }

  get snapshot() {
    return Object.freeze({
      state: this.#state,
      sampleRate: finiteOrNull(this.#context?.sampleRate),
      baseLatencyMs: finiteOrNull(this.#context?.baseLatency * 1_000),
      outputLatencyMs: finiteOrNull(this.#context?.outputLatency * 1_000),
      outputTimestampAvailable:
        typeof this.#context?.getOutputTimestamp === "function",
      pendingMeasurements: this.#pending.size,
      threshold: this.#options.threshold,
      requiredSilenceQuanta: this.#options.requiredSilenceQuanta,
      scope:
        "último quantum não silencioso no grafo Web Audio; " +
        "não mede alto-falante ou ambiente"
    });
  }

  #emit(type, detail = {}) {
    safeCall(this.#options.onEvent, Object.freeze({
      type,
      atMs: globalThis.performance?.now?.() ?? Date.now(),
      ...detail
    }));
  }

  async start() {
    if (this.#state === "ready") {
      return this;
    }
    if (this.#startPromise) {
      return this.#startPromise;
    }
    if (!this.#options.AudioContextCtor) {
      throw new Error("AudioContext não está disponível para medir render");
    }
    if (!this.#options.AudioWorkletNodeCtor) {
      throw new Error("AudioWorkletNode não está disponível para medir render");
    }

    this.#state = "starting";
    this.#startPromise = this.#performStart();
    try {
      await this.#startPromise;
      return this;
    } catch (error) {
      this.#state = "error";
      throw error;
    } finally {
      this.#startPromise = null;
    }
  }

  async #performStart() {
    this.#context = new this.#options.AudioContextCtor({
      latencyHint: this.#options.latencyHint
    });
    let moduleUrl = this.#options.workletModuleUrl;
    let generatedModuleUrl = false;

    if (!moduleUrl) {
      if (!this.#options.BlobCtor || !this.#options.URLApi?.createObjectURL) {
        throw new Error("Blob URL não está disponível para o render probe");
      }
      moduleUrl = this.#options.URLApi.createObjectURL(
        new this.#options.BlobCtor(
          [RENDER_PROBE_WORKLET_SOURCE],
          { type: "text/javascript" }
        )
      );
      generatedModuleUrl = true;
    }

    try {
      await this.#context.audioWorklet.addModule(moduleUrl);
    } finally {
      if (generatedModuleUrl) {
        this.#options.URLApi.revokeObjectURL(moduleUrl);
      }
    }

    this.#node = new this.#options.AudioWorkletNodeCtor(
      this.#context,
      RENDER_PROBE_PROCESSOR_NAME,
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: "max",
        channelInterpretation: "speakers",
        processorOptions: {
          threshold: this.#options.threshold,
          requiredSilenceQuanta: this.#options.requiredSilenceQuanta
        }
      }
    );
    this.#node.port.onmessage = this.#handleMessage;
    this.#node.connect(this.#context.destination);
    if (this.#context.state !== "running") {
      await this.#context.resume();
    }
    this.#state = "ready";
    this.#emit("assistant.render.probe.ready", this.snapshot);
  }

  async attachMediaElement(element) {
    if (!element) {
      throw new TypeError("elemento de áudio é obrigatório");
    }
    await this.start();
    const source = this.#context.createMediaElementSource(element);
    source.connect(this.#node);
    if (this.#context.state !== "running") {
      await this.#context.resume();
    }
    this.#emit("assistant.render.source.attached");
    return source;
  }

  disconnectSource(source) {
    safelyDisconnect(source);
  }

  measureStop(triggerAtMs, options = {}) {
    if (this.#state !== "ready" || !this.#node) {
      return Promise.reject(
        new Error("render probe precisa estar pronto antes do STOP")
      );
    }
    if (!Number.isFinite(triggerAtMs)) {
      return Promise.reject(new TypeError("triggerAtMs precisa ser finito"));
    }

    const id = `render-stop-${++this.#nextMeasurementId}`;
    const timeoutMs = options.timeoutMs ?? this.#options.stopTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`render STOP não foi observado em ${timeoutMs} ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        reject,
        resolve,
        timer,
        triggerAtMs
      });
      this.#node.port.postMessage({
        type: "render-stop-measure",
        id
      });
    });
  }

  #handleMessage = ({ data }) => {
    if (data?.type === "render-active") {
      if (!Number.isFinite(data.activeEndContextTime)) {
        return;
      }
      const activeEnd = mapAudioContextTimeToPerformance(
        this.#context,
        data.activeEndContextTime
      );
      this.#emit("assistant.render.active", {
        kind: "browser-render-active",
        activeAtMs: activeEnd.performanceTimeMs,
        mapping: activeEnd.mapping,
        activeStartContextTime: data.activeStartContextTime,
        activeEndContextTime: data.activeEndContextTime,
        threshold: data.threshold,
        scope: "quantum não silencioso observado no grafo Web Audio"
      });
      return;
    }
    if (data?.type !== "render-stop-observed") {
      return;
    }
    const pending = this.#pending.get(data.id);
    if (!pending) {
      return;
    }
    this.#pending.delete(data.id);
    clearTimeout(pending.timer);

    if (!Number.isFinite(data.lastActiveEndContextTime)) {
      pending.reject(
        new Error("render probe não observou sample ativo antes do STOP")
      );
      return;
    }

    const lastRendered = mapAudioContextTimeToPerformance(
      this.#context,
      data.lastActiveEndContextTime
    );
    const observed = mapAudioContextTimeToPerformance(
      this.#context,
      data.observedContextTime
    );
    const evidence = Object.freeze({
      kind: "browser-render-stop",
      triggerAtMs: pending.triggerAtMs,
      lastRenderedAtMs: lastRendered.performanceTimeMs,
      observedAtMs: observed.performanceTimeMs,
      latencyMs:
        lastRendered.performanceTimeMs - pending.triggerAtMs,
      renderedThroughTrigger:
        lastRendered.performanceTimeMs >= pending.triggerAtMs,
      mapping: lastRendered.mapping,
      baseLatencyMs: lastRendered.baseLatencyMs,
      outputLatencyMs: lastRendered.outputLatencyMs,
      lastActiveEndContextTime: data.lastActiveEndContextTime,
      observedContextTime: data.observedContextTime,
      requiredSilenceQuanta: data.requiredSilenceQuanta,
      threshold: data.threshold,
      scope:
        "último quantum não silencioso no grafo Web Audio; " +
        "não mede cauda do alto-falante ou da sala"
    });
    this.#emit("assistant.render.stopped", evidence);
    pending.resolve(evidence);
  };

  async close() {
    if (this.#state === "closed") {
      return;
    }
    this.#state = "closing";
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("render probe encerrado"));
    }
    this.#pending.clear();
    safelyDisconnect(this.#node);
    if (this.#node?.port) {
      this.#node.port.onmessage = null;
      this.#node.port.close?.();
    }
    if (this.#context && this.#context.state !== "closed") {
      await this.#context.close();
    }
    this.#state = "closed";
  }
}

export function buildPcmMediaConstraints(audioOverrides = {}) {
  return {
    audio: cloneAudioConstraints(audioOverrides),
    video: false
  };
}

/**
 * Captura PCM full-duplex no navegador.
 *
 * `onFrame` pode ser assíncrono. O ACK ao AudioWorklet só é enviado quando
 * essa Promise termina; isso torna lentidão do consumidor observável no
 * próprio worklet, que limita memória e contabiliza os frames descartados.
 */
export class BrowserPcmCapture {
  #options;
  #state = "idle";
  #stream = null;
  #context = null;
  #source = null;
  #workletNode = null;
  #track = null;
  #contextStartedAtMs = null;
  #contextStartedAtSeconds = null;
  #contextStateChanges = 0;
  #contextStateListener = null;
  #trackMuteListener = null;
  #trackUnmuteListener = null;
  #trackMuteEvents = 0;
  #trackUnmuteEvents = 0;
  #internalAbortController = new AbortController();
  #externalAbortListener = null;
  #trackEndedListener = null;
  #pendingDeliveries = new Set();
  #deliveryChain = Promise.resolve();
  #pendingTelemetryRequests = new Set();
  #lastReceivedSequence = -1;
  #lastReceivedSampleEnd = -1;
  #lastFrameArrivalAtMs = null;
  #workletTelemetry = null;
  #stopPromise = null;
  #stopReason = null;
  #stats = {
    receivedFrames: 0,
    deliveredFrames: 0,
    deliveryErrors: 0,
    protocolErrors: 0,
    observedSequenceGaps: 0,
    observedSampleGaps: 0,
    processorErrors: 0,
    maxFrameArrivalGapMs: 0
  };

  constructor(options = {}) {
    if (typeof options.onFrame !== "function") {
      throw new TypeError("onFrame é obrigatório.");
    }

    this.#options = {
      targetSampleRate: options.targetSampleRate ?? 16_000,
      frameDurationMs: options.frameDurationMs ?? 20,
      // 32 frames cobrem até 640 ms de pausa ou reconexão transitória.
      // O servidor continua limitando e medindo backlog separadamente.
      maxInFlightFrames: options.maxInFlightFrames ?? 32,
      telemetryEveryFrames: options.telemetryEveryFrames ?? 50,
      keepAliveAmplitude:
        options.keepAliveAmplitude ??
        DEFAULT_CAPTURE_KEEP_ALIVE_AMPLITUDE,
      audioConstraints: options.audioConstraints ?? {},
      workletUrl: options.workletUrl ?? DEFAULT_WORKLET_URL,
      latencyHint: options.latencyHint ?? "interactive",
      onFrame: options.onFrame,
      onEvent: options.onEvent,
      onTelemetry: options.onTelemetry,
      signal: options.signal,
      mediaDevices:
        options.mediaDevices ?? globalThis.navigator?.mediaDevices,
      AudioContextCtor:
        options.AudioContextCtor ??
        globalThis.AudioContext ??
        globalThis.webkitAudioContext,
      AudioWorkletNodeCtor:
        options.AudioWorkletNodeCtor ?? globalThis.AudioWorkletNode
    };
  }

  get state() {
    return this.#state;
  }

  get signal() {
    return this.#internalAbortController.signal;
  }

  get stream() {
    return this.#stream;
  }

  get stats() {
    const observedAtMs =
      globalThis.performance?.now?.() ?? Date.now();
    const contextTimeSeconds = finiteOrNull(this.#context?.currentTime);
    const contextElapsedMs =
      contextTimeSeconds === null ||
      this.#contextStartedAtSeconds === null
        ? null
        : Math.max(
            0,
            (contextTimeSeconds - this.#contextStartedAtSeconds) * 1_000
          );
    const wallElapsedMs =
      this.#contextStartedAtMs === null
        ? null
        : Math.max(0, observedAtMs - this.#contextStartedAtMs);
    return Object.freeze({
      ...this.#stats,
      state: this.#state,
      stopReason: this.#stopReason,
      pendingDeliveries: this.#pendingDeliveries.size,
      clock: Object.freeze({
        contextState: this.#context?.state ?? null,
        contextSampleRate: finiteOrNull(this.#context?.sampleRate),
        contextTimeSeconds,
        contextElapsedMs,
        wallElapsedMs,
        realtimeRatio:
          contextElapsedMs === null ||
          wallElapsedMs === null ||
          wallElapsedMs === 0
            ? null
            : contextElapsedMs / wallElapsedMs,
        stateChanges: this.#contextStateChanges
      }),
      track: Object.freeze({
        enabled: this.#track?.enabled ?? null,
        muted: this.#track?.muted ?? null,
        readyState: this.#track?.readyState ?? null,
        muteEvents: this.#trackMuteEvents,
        unmuteEvents: this.#trackUnmuteEvents,
        settings: Object.freeze({
          ...(this.#track?.getSettings?.() ?? {})
        })
      }),
      worklet: this.#workletTelemetry
        ? Object.freeze({ ...this.#workletTelemetry })
        : null
    });
  }

  #emit(type, detail = {}) {
    safeCall(this.#options.onEvent, Object.freeze({
      type,
      atMs: globalThis.performance?.now?.() ?? Date.now(),
      ...detail
    }));
  }

  #postToWorklet(message) {
    try {
      this.#workletNode?.port.postMessage(message);
    } catch {
      // stop() pode fechar a porta enquanto entregas assíncronas terminam.
    }
  }

  #handleTelemetry(message) {
    this.#workletTelemetry = Object.freeze({ ...message });
    safeCall(this.#options.onTelemetry, this.stats);
    for (const request of this.#pendingTelemetryRequests) {
      clearTimeout(request.timer);
      request.resolve(this.stats);
    }
    this.#pendingTelemetryRequests.clear();
    if (message.reason === "backpressure") {
      this.#emit("capture.backpressure", {
        droppedFrames: message.droppedFrames,
        inFlightFrames: message.inFlightFrames
      });
    }
  }

  #validateFrame(message) {
    if (
      !Number.isSafeInteger(message.sequence) ||
      !Number.isSafeInteger(message.sampleStart) ||
      !Number.isSafeInteger(message.sampleEnd) ||
      !(message.pcmBuffer instanceof ArrayBuffer)
    ) {
      this.#stats.protocolErrors += 1;
      return false;
    }

    if (message.sequence <= this.#lastReceivedSequence) {
      this.#stats.protocolErrors += 1;
      return false;
    }

    if (this.#lastReceivedSequence >= 0) {
      this.#stats.observedSequenceGaps +=
        message.sequence - this.#lastReceivedSequence - 1;
      this.#stats.observedSampleGaps += Math.max(
        0,
        message.sampleStart - this.#lastReceivedSampleEnd
      );
    }

    this.#lastReceivedSequence = message.sequence;
    this.#lastReceivedSampleEnd = message.sampleEnd;
    return true;
  }

  #handleFrame(message) {
    if (!this.#validateFrame(message)) {
      this.#postToWorklet({
        type: "pcm-ack",
        sequence: message.sequence
      });
      return;
    }

    const arrivedAtMs =
      globalThis.performance?.now?.() ?? Date.now();
    if (this.#lastFrameArrivalAtMs !== null) {
      this.#stats.maxFrameArrivalGapMs = Math.max(
        this.#stats.maxFrameArrivalGapMs,
        arrivedAtMs - this.#lastFrameArrivalAtMs
      );
    }
    this.#lastFrameArrivalAtMs = arrivedAtMs;
    this.#stats.receivedFrames += 1;
    const frame = Object.freeze({
      sequence: message.sequence,
      sampleStart: message.sampleStart,
      sampleEnd: message.sampleEnd,
      sampleRate: message.sampleRate,
      durationMs: message.durationMs,
      pcm16: new Int16Array(message.pcmBuffer)
    });

    const delivery = this.#deliveryChain
      .then(() => this.#options.onFrame(frame, {
        signal: this.signal,
        capture: this
      }))
      .then(() => {
        this.#stats.deliveredFrames += 1;
      })
      .catch((error) => {
        this.#stats.deliveryErrors += 1;
        this.#emit("capture.delivery.error", {
          message: error?.message ?? String(error),
          sequence: frame.sequence
        });
      })
      .finally(() => {
        this.#pendingDeliveries.delete(delivery);
        this.#postToWorklet({
          type: "pcm-ack",
          sequence: frame.sequence
        });
      });

    this.#pendingDeliveries.add(delivery);
    this.#deliveryChain = delivery;
  }

  #handleWorkletMessage = ({ data }) => {
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.type === "pcm-frame") {
      this.#handleFrame(data);
    } else if (data.type === "pcm-telemetry") {
      this.#handleTelemetry(data);
    }
  };

  async start() {
    if (this.#state !== "idle") {
      throw new Error(`Não é possível iniciar no estado ${this.#state}.`);
    }
    if (this.#options.signal?.aborted) {
      throw abortError(this.#options.signal.reason);
    }
    if (!this.#options.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia não está disponível.");
    }
    if (!this.#options.AudioContextCtor) {
      throw new Error("AudioContext não está disponível.");
    }
    if (!this.#options.AudioWorkletNodeCtor) {
      throw new Error("AudioWorkletNode não está disponível.");
    }

    this.#state = "starting";
    this.#emit("capture.starting");

    try {
      this.#stream = await this.#options.mediaDevices.getUserMedia(
        buildPcmMediaConstraints(this.#options.audioConstraints)
      );
      if (this.#options.signal?.aborted) {
        throw abortError(this.#options.signal.reason);
      }

      this.#context = new this.#options.AudioContextCtor({
        latencyHint: this.#options.latencyHint
      });
      await this.#context.audioWorklet.addModule(
        this.#options.workletUrl
      );

      this.#source = this.#context.createMediaStreamSource(this.#stream);
      this.#workletNode = new this.#options.AudioWorkletNodeCtor(
        this.#context,
        PROCESSOR_NAME,
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: {
            targetSampleRate: this.#options.targetSampleRate,
            frameDurationMs: this.#options.frameDurationMs,
            maxInFlightFrames: this.#options.maxInFlightFrames,
            telemetryEveryFrames: this.#options.telemetryEveryFrames,
            // A saída contém somente um impulso subaudível por quantum. O
            // Chromium considera o grafo ativo e não troca o relógio por um
            // sink econômico após 30 s; manter a conexão ao destination
            // preserva o caminho que apresentou AEC estável no Chrome/Windows.
            keepAliveAmplitude: this.#options.keepAliveAmplitude
          }
        }
      );

      this.#workletNode.port.onmessage = this.#handleWorkletMessage;
      this.#workletNode.addEventListener("processorerror", () => {
        this.#stats.processorErrors += 1;
        this.#emit("capture.processor.error");
        void this.stop("processor-error");
      });

      this.#source
        .connect(this.#workletNode)
        .connect(this.#context.destination);

      if (this.#context.state !== "running") {
        await this.#context.resume();
      }

      const [track] = this.#stream.getAudioTracks();
      if (!track) {
        throw new Error("O stream não contém uma faixa de áudio.");
      }
      this.#track = track;
      this.#contextStartedAtMs =
        globalThis.performance?.now?.() ?? Date.now();
      this.#contextStartedAtSeconds = this.#context.currentTime;
      this.#contextStateListener = () => {
        this.#contextStateChanges += 1;
        this.#emit("capture.context.state", {
          state: this.#context?.state ?? null,
          currentTimeSeconds: finiteOrNull(this.#context?.currentTime)
        });
      };
      this.#context.addEventListener?.(
        "statechange",
        this.#contextStateListener
      );
      this.#trackMuteListener = () => {
        this.#trackMuteEvents += 1;
        this.#emit("capture.track.muted");
      };
      this.#trackUnmuteListener = () => {
        this.#trackUnmuteEvents += 1;
        this.#emit("capture.track.unmuted");
      };
      track.addEventListener("mute", this.#trackMuteListener);
      track.addEventListener("unmute", this.#trackUnmuteListener);

      this.#trackEndedListener = () => {
        void this.stop("track-ended");
      };
      track.addEventListener(
        "ended",
        this.#trackEndedListener,
        { once: true }
      );

      if (this.#options.signal) {
        this.#externalAbortListener = () => {
          void this.stop(
            this.#options.signal.reason ?? "external-abort"
          );
        };
        this.#options.signal.addEventListener(
          "abort",
          this.#externalAbortListener,
          { once: true }
        );
        if (this.#options.signal.aborted) {
          throw abortError(this.#options.signal.reason);
        }
      }

      this.#state = "running";
      this.#emit("capture.started", {
        contextSampleRate: this.#context.sampleRate,
        trackSettings: track.getSettings?.() ?? {}
      });
      return this;
    } catch (error) {
      await this.stop(error?.name === "AbortError" ? "aborted" : "start-error");
      throw error;
    }
  }

  requestTelemetry(options = {}) {
    if (this.#state !== "running") {
      return Promise.reject(
        new Error(`captura não está ativa: ${this.#state}`)
      );
    }
    const timeoutMs = options.timeoutMs ?? 1_000;
    const result = new Promise((resolve, reject) => {
      const request = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pendingTelemetryRequests.delete(request);
          reject(new Error("telemetria do AudioWorklet expirou"));
        }, timeoutMs)
      };
      this.#pendingTelemetryRequests.add(request);
    });
    this.#postToWorklet({ type: "pcm-telemetry-request" });
    return result;
  }

  async stop(reason = "requested") {
    if (this.#stopPromise) {
      return this.#stopPromise;
    }

    this.#stopReason = String(reason);
    this.#stopPromise = this.#performStop();
    return this.#stopPromise;
  }

  async #performStop() {
    const previousState = this.#state;
    this.#state = "stopping";
    this.#emit("capture.stopping", {
      reason: this.#stopReason
    });
    this.#internalAbortController.abort(this.#stopReason);
    for (const request of this.#pendingTelemetryRequests) {
      clearTimeout(request.timer);
      request.reject(new Error("captura encerrada"));
    }
    this.#pendingTelemetryRequests.clear();
    this.#postToWorklet({ type: "pcm-stop" });

    if (this.#options.signal && this.#externalAbortListener) {
      this.#options.signal.removeEventListener(
        "abort",
        this.#externalAbortListener
      );
    }

    const [track] = this.#stream?.getAudioTracks?.() ?? [];
    if (track && this.#trackEndedListener) {
      track.removeEventListener("ended", this.#trackEndedListener);
    }
    if (track && this.#trackMuteListener) {
      track.removeEventListener("mute", this.#trackMuteListener);
    }
    if (track && this.#trackUnmuteListener) {
      track.removeEventListener("unmute", this.#trackUnmuteListener);
    }
    if (this.#context && this.#contextStateListener) {
      this.#context.removeEventListener?.(
        "statechange",
        this.#contextStateListener
      );
    }

    safelyDisconnect(this.#source);
    safelyDisconnect(this.#workletNode);

    for (const mediaTrack of this.#stream?.getTracks?.() ?? []) {
      mediaTrack.stop();
    }

    if (this.#workletNode?.port) {
      this.#workletNode.port.onmessage = null;
      this.#workletNode.port.close?.();
    }

    if (
      this.#context &&
      this.#context.state !== "closed"
    ) {
      try {
        await this.#context.close();
      } catch (error) {
        this.#emit("capture.cleanup.error", {
          message: error?.message ?? String(error)
        });
      }
    }

    this.#state = "stopped";
    this.#emit("capture.stopped", {
      previousState,
      reason: this.#stopReason,
      stats: this.stats
    });
  }
}

export async function startPcmCapture(options) {
  const capture = new BrowserPcmCapture(options);
  await capture.start();
  return capture;
}
