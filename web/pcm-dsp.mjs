const DEFAULT_TARGET_SAMPLE_RATE = 16_000;
const DEFAULT_FRAME_DURATION_MS = 20;
const DEFAULT_FILTER_TAPS = 31;

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} deve ser um inteiro positivo.`);
  }
}

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} deve ser um número finito.`);
  }
}

function createLowPassFilter({
  inputSampleRate,
  outputSampleRate,
  filterTaps
}) {
  if (inputSampleRate === outputSampleRate || filterTaps === 1) {
    return Float64Array.of(1);
  }
  if (
    !Number.isSafeInteger(filterTaps) ||
    filterTaps < 3 ||
    filterTaps % 2 === 0
  ) {
    throw new RangeError("filterTaps deve ser 1 ou um inteiro ímpar >= 3.");
  }

  // 92% do Nyquist de saída deixa uma faixa de transição antes do alias.
  const cutoff = 0.46 * outputSampleRate / inputSampleRate;
  const order = filterTaps - 1;
  const center = order / 2;
  const coefficients = new Float64Array(filterTaps);
  let coefficientSum = 0;

  for (let index = 0; index < filterTaps; index += 1) {
    const distance = index - center;
    const sinc =
      distance === 0
        ? 2 * cutoff
        : Math.sin(2 * Math.PI * cutoff * distance) /
          (Math.PI * distance);
    const window =
      0.42 -
      0.5 * Math.cos(2 * Math.PI * index / order) +
      0.08 * Math.cos(4 * Math.PI * index / order);
    coefficients[index] = sinc * window;
    coefficientSum += coefficients[index];
  }

  for (let index = 0; index < coefficients.length; index += 1) {
    coefficients[index] /= coefficientSum;
  }
  return coefficients;
}

/**
 * Reduz N canais Float32 a mono sem privilegiar um canal.
 *
 * AudioWorklet entrega canais de mesmo comprimento. Falhar cedo quando esse
 * contrato é violado evita produzir áudio temporalmente desalinhado.
 */
export function downmixToMono(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return new Float32Array(0);
  }

  const length = channels[0]?.length;
  if (!Number.isSafeInteger(length)) {
    throw new TypeError("Cada canal deve ser um array de amostras.");
  }

  for (const channel of channels) {
    if (!channel || channel.length !== length) {
      throw new RangeError("Todos os canais devem ter o mesmo comprimento.");
    }
  }

  if (channels.length === 1) {
    return Float32Array.from(
      channels[0],
      (sample) => (Number.isFinite(sample) ? sample : 0)
    );
  }

  const mono = new Float32Array(length);
  const scale = 1 / channels.length;

  for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
    let sum = 0;
    for (const channel of channels) {
      const sample = channel[sampleIndex];
      sum += Number.isFinite(sample) ? sample : 0;
    }
    mono[sampleIndex] = sum * scale;
  }

  return mono;
}

/**
 * Converte Float32 [-1, 1] para PCM linear signed de 16 bits.
 */
export function floatToPcm16(samples) {
  if (!samples || !Number.isSafeInteger(samples.length)) {
    throw new TypeError("samples deve ser um array de amostras.");
  }

  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const finiteSample = Number.isFinite(samples[index]) ? samples[index] : 0;
    const clamped = Math.max(-1, Math.min(1, finiteSample));
    pcm[index] =
      clamped < 0
        ? Math.round(clamped * 32_768)
        : Math.round(clamped * 32_767);
  }
  return pcm;
}

/**
 * Downsampler causal e incremental.
 *
 * Trata cada amostra de entrada como uma região constante e calcula a média
 * ponderada de cada intervalo de saída. A aritmética de fase usa inteiros
 * (taxas em "ticks"), então dividir o áudio em quanta diferentes não altera
 * a saída e um segundo de entrada sempre gera exatamente targetRate amostras.
 *
 * O filtro de integração/box é deliberadamente barato para o caminho de baixa
 * latência. Ele reduz aliasing, mas não substitui um resampler FIR de alta
 * rejeição quando fidelidade musical for requisito.
 */
export class StreamingPcmDownsampler {
  #inputSampleRate;
  #outputSampleRate;
  #remainingOutputTicks;
  #weightedSum = 0;
  #inputSamples = 0;
  #outputSamples = 0;
  #filter;
  #filterHistory;
  #filterWriteIndex = 0;

  constructor({
    inputSampleRate,
    outputSampleRate = DEFAULT_TARGET_SAMPLE_RATE,
    filterTaps = DEFAULT_FILTER_TAPS
  }) {
    assertPositiveInteger(inputSampleRate, "inputSampleRate");
    assertPositiveInteger(outputSampleRate, "outputSampleRate");
    if (outputSampleRate > inputSampleRate) {
      throw new RangeError(
        "StreamingPcmDownsampler não faz upsampling."
      );
    }

    this.#inputSampleRate = inputSampleRate;
    this.#outputSampleRate = outputSampleRate;
    this.#remainingOutputTicks = inputSampleRate;
    this.#filter = createLowPassFilter({
      inputSampleRate,
      outputSampleRate,
      filterTaps
    });
    this.#filterHistory = new Float32Array(this.#filter.length);
  }

  get inputSampleRate() {
    return this.#inputSampleRate;
  }

  get outputSampleRate() {
    return this.#outputSampleRate;
  }

  get stats() {
    return Object.freeze({
      inputSamples: this.#inputSamples,
      outputSamples: this.#outputSamples,
      filterTaps: this.#filter.length,
      groupDelayInputSamples: (this.#filter.length - 1) / 2,
      partialOutputProgress:
        1 - this.#remainingOutputTicks / this.#inputSampleRate
    });
  }

  #filterSample(sample) {
    this.#filterHistory[this.#filterWriteIndex] = sample;
    let historyIndex = this.#filterWriteIndex;
    let filtered = 0;

    for (let tapIndex = 0; tapIndex < this.#filter.length; tapIndex += 1) {
      filtered +=
        this.#filter[tapIndex] * this.#filterHistory[historyIndex];
      historyIndex -= 1;
      if (historyIndex < 0) {
        historyIndex = this.#filter.length - 1;
      }
    }

    this.#filterWriteIndex += 1;
    if (this.#filterWriteIndex === this.#filter.length) {
      this.#filterWriteIndex = 0;
    }
    return filtered;
  }

  push(samples) {
    if (!samples || !Number.isSafeInteger(samples.length)) {
      throw new TypeError("samples deve ser um array de amostras.");
    }

    const output = [];
    const sourceSampleTicks = this.#outputSampleRate;

    for (let index = 0; index < samples.length; index += 1) {
      const finiteSample = Number.isFinite(samples[index]) ? samples[index] : 0;
      const filteredSample = this.#filterSample(finiteSample);
      let availableTicks = sourceSampleTicks;

      while (availableTicks > 0) {
        const consumedTicks = Math.min(
          availableTicks,
          this.#remainingOutputTicks
        );
        this.#weightedSum += filteredSample * consumedTicks;
        availableTicks -= consumedTicks;
        this.#remainingOutputTicks -= consumedTicks;

        if (this.#remainingOutputTicks === 0) {
          output.push(this.#weightedSum / this.#inputSampleRate);
          this.#weightedSum = 0;
          this.#remainingOutputTicks = this.#inputSampleRate;
          this.#outputSamples += 1;
        }
      }
    }

    this.#inputSamples += samples.length;
    return Float32Array.from(output);
  }
}

/**
 * Pipeline pura usada dentro do AudioWorklet: downmix, downsample e frames
 * PCM16 de duração fixa com sequência e cursor de amostras monotônicos.
 */
export class StreamingPcmFramer {
  #downsampler;
  #frameBuffer;
  #frameDurationMs;
  #frameSamples;
  #bufferedSamples = 0;
  #nextSequence;
  #nextSampleStart = 0;
  #generatedFrames = 0;
  #downmixedInputSamples = 0;

  constructor({
    inputSampleRate,
    targetSampleRate = DEFAULT_TARGET_SAMPLE_RATE,
    frameDurationMs = DEFAULT_FRAME_DURATION_MS,
    sequenceStart = 0
  }) {
    assertPositiveInteger(inputSampleRate, "inputSampleRate");
    assertPositiveInteger(targetSampleRate, "targetSampleRate");
    assertFiniteNumber(frameDurationMs, "frameDurationMs");
    assertPositiveInteger(sequenceStart + 1, "sequenceStart + 1");

    const frameSamples = (targetSampleRate * frameDurationMs) / 1_000;
    if (!Number.isSafeInteger(frameSamples) || frameSamples <= 0) {
      throw new RangeError(
        "frameDurationMs deve resultar em um número inteiro de amostras."
      );
    }

    this.#downsampler = new StreamingPcmDownsampler({
      inputSampleRate,
      outputSampleRate: targetSampleRate
    });
    this.#frameDurationMs = frameDurationMs;
    this.#frameSamples = frameSamples;
    this.#frameBuffer = new Float32Array(frameSamples);
    this.#nextSequence = sequenceStart;
  }

  get targetSampleRate() {
    return this.#downsampler.outputSampleRate;
  }

  get frameDurationMs() {
    return this.#frameDurationMs;
  }

  get frameSamples() {
    return this.#frameSamples;
  }

  get stats() {
    return Object.freeze({
      ...this.#downsampler.stats,
      downmixedInputSamples: this.#downmixedInputSamples,
      generatedFrames: this.#generatedFrames,
      framedOutputSamples: this.#nextSampleStart,
      bufferedOutputSamples: this.#bufferedSamples,
      nextSequence: this.#nextSequence
    });
  }

  pushChannels(channels) {
    const mono = downmixToMono(channels);
    this.#downmixedInputSamples += mono.length;
    return this.pushMono(mono);
  }

  pushMono(monoSamples) {
    const resampled = this.#downsampler.push(monoSamples);
    const frames = [];

    for (const sample of resampled) {
      this.#frameBuffer[this.#bufferedSamples] = sample;
      this.#bufferedSamples += 1;

      if (this.#bufferedSamples !== this.#frameSamples) {
        continue;
      }

      const sequence = this.#nextSequence;
      const sampleStart = this.#nextSampleStart;
      const pcm16 = floatToPcm16(this.#frameBuffer);

      frames.push(Object.freeze({
        sequence,
        sampleStart,
        sampleEnd: sampleStart + this.#frameSamples,
        sampleRate: this.targetSampleRate,
        durationMs: this.#frameDurationMs,
        pcm16
      }));

      this.#generatedFrames += 1;
      this.#nextSequence += 1;
      this.#nextSampleStart += this.#frameSamples;
      this.#bufferedSamples = 0;
    }

    return frames;
  }
}

export const PCM_DSP_DEFAULTS = Object.freeze({
  targetSampleRate: DEFAULT_TARGET_SAMPLE_RATE,
  frameDurationMs: DEFAULT_FRAME_DURATION_MS,
  filterTaps: DEFAULT_FILTER_TAPS
});
