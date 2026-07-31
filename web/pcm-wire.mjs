const MAGIC = 0x44585031;
const HEADER_BYTES = 16;

function asArrayBufferView(value) {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new TypeError("PCM precisa ser ArrayBuffer ou ArrayBufferView.");
}

export function encodePcmFrame(frame) {
  const pcm = asArrayBufferView(frame.pcm16);
  if (
    !Number.isSafeInteger(frame.sequence) ||
    frame.sequence < 0 ||
    frame.sequence > 0xffff_ffff
  ) {
    throw new RangeError("sequence precisa caber em uint32.");
  }
  if (
    !Number.isSafeInteger(frame.sampleStart) ||
    frame.sampleStart < 0 ||
    frame.sampleStart > 0xffff_ffff
  ) {
    throw new RangeError("sampleStart precisa caber em uint32.");
  }
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
    throw new RangeError("PCM16 precisa ser não vazio e alinhado.");
  }

  const packet = new ArrayBuffer(HEADER_BYTES + pcm.byteLength);
  const view = new DataView(packet);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, frame.sequence, true);
  view.setUint32(8, frame.sampleStart, true);
  view.setUint32(12, pcm.byteLength / 2, true);
  new Uint8Array(packet, HEADER_BYTES).set(pcm);
  return packet;
}

export function decodePcmFrame(packet) {
  const bytes = asArrayBufferView(packet);
  if (bytes.byteLength < HEADER_BYTES + 2) {
    throw new RangeError("pacote PCM truncado.");
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );
  if (view.getUint32(0, true) !== MAGIC) {
    throw new TypeError("assinatura de pacote PCM inválida.");
  }

  const sampleCount = view.getUint32(12, true);
  const expectedBytes = HEADER_BYTES + sampleCount * 2;
  if (bytes.byteLength !== expectedBytes || sampleCount === 0) {
    throw new RangeError("tamanho declarado do PCM não confere.");
  }

  return {
    sequence: view.getUint32(4, true),
    sampleStart: view.getUint32(8, true),
    sampleCount,
    pcmBytes: bytes.slice(HEADER_BYTES)
  };
}

export const PCM_WIRE_PROTOCOL = Object.freeze({
  version: 1,
  sampleRate: 16_000,
  encoding: "pcm_s16le",
  headerBytes: HEADER_BYTES
});
