import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  reconstructExactPcm
} from "../scripts/lib/exact-pcm-snapshot.mjs";
import { encodePcm16Wave } from "../src/audio/wav.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("reconstrói e valida segmentos exatos antes de concatená-los", () => {
  const source = Buffer.alloc(2_000);
  for (let offset = 0; offset < source.length; offset += 2) {
    source.writeInt16LE(offset / 2, offset);
  }
  const wave = encodePcm16Wave(source);
  const first = source.subarray(100 * 2, 300 * 2);
  const second = source.subarray(600 * 2, 900 * 2);
  const expected = Buffer.concat([first, second]);
  const reconstructed = reconstructExactPcm(wave, {
    id: "fixture",
    sourceWaveSha256: sha256(wave),
    finalPcmSha256: sha256(expected),
    finalPcmSamples: expected.length / 2,
    segments: [
      { sampleStart: 100, sampleEnd: 300, sha256: sha256(first) },
      { sampleStart: 600, sampleEnd: 900, sha256: sha256(second) }
    ]
  });
  assert.deepEqual(reconstructed.pcm, expected);
  assert.equal(reconstructed.evidence.pass, true);
  assert.equal(reconstructed.evidence.sampleCount, 500);
});

test("falha fechado quando a fonte ou um segmento diverge", () => {
  const source = Buffer.alloc(640);
  const wave = encodePcm16Wave(source);
  const base = {
    id: "fixture",
    sourceWaveSha256: sha256(wave),
    finalPcmSha256: sha256(source),
    finalPcmSamples: source.length / 2,
    segments: [
      {
        sampleStart: 0,
        sampleEnd: source.length / 2,
        sha256: sha256(source)
      }
    ]
  };
  assert.throws(
    () => reconstructExactPcm(Buffer.from(wave).fill(1, 50, 52), base),
    /hash do WAV fonte divergente/u
  );
  assert.throws(
    () => reconstructExactPcm(wave, {
      ...base,
      segments: [{ ...base.segments[0], sha256: "0".repeat(64) }]
    }),
    /hash divergente no segmento/u
  );
});
