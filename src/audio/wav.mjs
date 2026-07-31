function readChunkId(buffer, offset) {
  return buffer.subarray(offset, offset + 4).toString("ascii");
}

export function encodePcm16Wave(
  pcm,
  options = {}
) {
  if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0) {
    throw new TypeError("PCM16 precisa ser um Buffer alinhado");
  }
  const sampleRate = options.sampleRate ?? 16_000;
  const channels = options.channels ?? 1;
  if (
    !Number.isSafeInteger(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isSafeInteger(channels) ||
    channels <= 0
  ) {
    throw new RangeError("sampleRate e channels precisam ser positivos");
  }

  const headerBytes = 44;
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const wave = Buffer.alloc(headerBytes + pcm.length);
  wave.write("RIFF", 0, "ascii");
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVE", 8, "ascii");
  wave.write("fmt ", 12, "ascii");
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(channels, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(byteRate, 28);
  wave.writeUInt16LE(blockAlign, 32);
  wave.writeUInt16LE(bitsPerSample, 34);
  wave.write("data", 36, "ascii");
  wave.writeUInt32LE(pcm.length, 40);
  pcm.copy(wave, headerBytes);
  return wave;
}

export function inspectWave(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("WAV precisa ser um Buffer");
  }
  if (
    readChunkId(buffer, 0) !== "RIFF" ||
    readChunkId(buffer, 8) !== "WAVE"
  ) {
    throw new TypeError("arquivo não é RIFF/WAVE");
  }

  let format = null;
  let data = null;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const id = readChunkId(buffer, offset);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + size + (size % 2);
    if (nextOffset > buffer.length + 1) {
      throw new RangeError(`chunk WAV inválido: ${id}`);
    }

    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(dataOffset),
        channels: buffer.readUInt16LE(dataOffset + 2),
        sampleRate: buffer.readUInt32LE(dataOffset + 4),
        byteRate: buffer.readUInt32LE(dataOffset + 8),
        blockAlign: buffer.readUInt16LE(dataOffset + 12),
        bitsPerSample: buffer.readUInt16LE(dataOffset + 14)
      };
    }

    if (id === "data") {
      data = {
        offset: dataOffset,
        size: Math.min(size, buffer.length - dataOffset)
      };
    }

    offset = nextOffset;
  }

  if (!format || !data) {
    throw new TypeError("WAV não contém fmt e data");
  }

  const durationMs = (data.size / format.byteRate) * 1_000;
  const summary = {
    ...format,
    dataBytes: data.size,
    durationMs: Math.round(durationMs * 100) / 100
  };

  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    return {
      ...summary,
      peak: null,
      rms: null,
      activeStartMs: null,
      activeEndMs: null
    };
  }

  const sampleCount = Math.floor(data.size / 2);
  let peak = 0;
  let sumSquares = 0;
  let firstActiveSample = null;
  let lastActiveSample = null;
  const activeThreshold = 256;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = buffer.readInt16LE(data.offset + index * 2);
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    sumSquares += sample * sample;
    if (magnitude >= activeThreshold) {
      firstActiveSample ??= index;
      lastActiveSample = index;
    }
  }

  const samplesPerChannel = sampleCount / format.channels;
  const toMs = (sampleIndex) =>
    ((sampleIndex / format.channels) / format.sampleRate) * 1_000;

  return {
    ...summary,
    peak,
    rms:
      sampleCount === 0
        ? 0
        : Math.round(Math.sqrt(sumSquares / sampleCount) * 100) / 100,
    activeStartMs:
      firstActiveSample === null
        ? null
        : Math.round(toMs(firstActiveSample) * 100) / 100,
    activeEndMs:
      lastActiveSample === null
        ? null
        : Math.round(toMs(lastActiveSample) * 100) / 100,
    samplesPerChannel
  };
}
