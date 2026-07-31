function readChunkId(buffer, offset) {
  return buffer.subarray(offset, offset + 4).toString("ascii");
}

function clampSample(value) {
  return Math.max(-1, Math.min(1, value));
}

export function float32ToPcm16(samples, options) {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError("samples precisa ser Float32Array");
  }
  const sourceSampleRate = options?.sourceSampleRate;
  const targetSampleRate = options?.targetSampleRate ?? 16_000;
  if (
    !Number.isFinite(sourceSampleRate) ||
    sourceSampleRate <= 0 ||
    !Number.isFinite(targetSampleRate) ||
    targetSampleRate <= 0
  ) {
    throw new RangeError("sample rates precisam ser positivos");
  }

  const targetLength = Math.max(
    0,
    Math.round(samples.length * targetSampleRate / sourceSampleRate)
  );
  const output = Buffer.alloc(targetLength * 2);
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * sourceSampleRate / targetSampleRate;
    const leftIndex = Math.min(
      samples.length - 1,
      Math.floor(sourcePosition)
    );
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const ratio = sourcePosition - leftIndex;
    const value =
      samples[leftIndex] * (1 - ratio) + samples[rightIndex] * ratio;
    const clamped = clampSample(value);
    output.writeInt16LE(
      clamped < 0
        ? Math.round(clamped * 32_768)
        : Math.round(clamped * 32_767),
      index * 2
    );
  }
  return output;
}

export function decodeWaveToPcm16(buffer, options = {}) {
  if (
    !Buffer.isBuffer(buffer) ||
    readChunkId(buffer, 0) !== "RIFF" ||
    readChunkId(buffer, 8) !== "WAVE"
  ) {
    throw new TypeError("entrada precisa ser um WAV RIFF");
  }

  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = readChunkId(buffer, offset);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > buffer.length) {
      throw new RangeError(`chunk WAV inválido: ${id}`);
    }
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(dataOffset),
        channels: buffer.readUInt16LE(dataOffset + 2),
        sampleRate: buffer.readUInt32LE(dataOffset + 4),
        blockAlign: buffer.readUInt16LE(dataOffset + 12),
        bitsPerSample: buffer.readUInt16LE(dataOffset + 14)
      };
    } else if (id === "data") {
      data = { offset: dataOffset, size };
    }
    offset = dataOffset + size + (size % 2);
  }

  if (!format || !data || format.channels < 1) {
    throw new TypeError("WAV não contém formato e áudio válidos");
  }
  const supported =
    (format.audioFormat === 1 && format.bitsPerSample === 16) ||
    (format.audioFormat === 3 && format.bitsPerSample === 32);
  if (!supported) {
    throw new TypeError(
      `WAV ${format.audioFormat}/${format.bitsPerSample} não suportado`
    );
  }

  const frameCount = Math.floor(data.size / format.blockAlign);
  const mono = new Float32Array(frameCount);
  const bytesPerSample = format.bitsPerSample / 8;
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      const offset =
        data.offset +
        frame * format.blockAlign +
        channel * bytesPerSample;
      sum += format.audioFormat === 1
        ? buffer.readInt16LE(offset) / 32_768
        : buffer.readFloatLE(offset);
    }
    mono[frame] = clampSample(sum / format.channels);
  }

  const targetSampleRate = options.targetSampleRate ?? 16_000;
  return {
    pcm: float32ToPcm16(mono, {
      sourceSampleRate: format.sampleRate,
      targetSampleRate
    }),
    source: format,
    sampleRate: targetSampleRate
  };
}
