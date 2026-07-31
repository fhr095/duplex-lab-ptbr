import assert from "node:assert/strict";
import test from "node:test";

import {
  decodePcmFrame,
  encodePcmFrame,
  PCM_WIRE_PROTOCOL
} from "../web/pcm-wire.mjs";

test("PCM wire preserva relógio, sequência e amostras", () => {
  const pcm16 = new Int16Array([-32_768, -1, 0, 1, 32_767]);
  const packet = encodePcmFrame({
    sequence: 17,
    sampleStart: 5_440,
    pcm16
  });
  const decoded = decodePcmFrame(packet);

  assert.equal(decoded.sequence, 17);
  assert.equal(decoded.sampleStart, 5_440);
  assert.equal(decoded.sampleCount, pcm16.length);
  assert.deepEqual(
    [...new Int16Array(
      decoded.pcmBytes.buffer,
      decoded.pcmBytes.byteOffset,
      decoded.sampleCount
    )],
    [...pcm16]
  );
  assert.equal(PCM_WIRE_PROTOCOL.sampleRate, 16_000);
});

test("PCM wire rejeita corrupção e comprimentos inconsistentes", () => {
  assert.throws(() => decodePcmFrame(new ArrayBuffer(4)), /truncado/u);

  const packet = encodePcmFrame({
    sequence: 0,
    sampleStart: 0,
    pcm16: new Int16Array([1, 2])
  });
  new DataView(packet).setUint32(12, 200, true);
  assert.throws(() => decodePcmFrame(packet), /não confere/u);
});
