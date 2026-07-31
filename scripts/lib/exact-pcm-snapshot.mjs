import { createHash } from "node:crypto";

import { decodeWaveToPcm16 } from "../../src/asr/pcm.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertSha256(value, field) {
  if (!/^[a-f0-9]{64}$/u.test(String(value ?? ""))) {
    throw new TypeError(`${field} precisa ser SHA-256 hexadecimal`);
  }
}

export function reconstructExactPcm(wave, definition, options = {}) {
  if (!Buffer.isBuffer(wave)) {
    throw new TypeError("wave precisa ser Buffer");
  }
  if (!definition || !Array.isArray(definition.segments)) {
    throw new TypeError("definição precisa conter segments");
  }
  assertSha256(definition.sourceWaveSha256, "sourceWaveSha256");
  assertSha256(definition.finalPcmSha256, "finalPcmSha256");

  const sourceWaveSha256 = sha256(wave);
  if (sourceWaveSha256 !== definition.sourceWaveSha256) {
    throw new Error(
      `${definition.id}: hash do WAV fonte divergente ` +
        `(${sourceWaveSha256})`
    );
  }

  const sampleRate = options.sampleRate ?? 16_000;
  const decoded = decodeWaveToPcm16(wave, {
    targetSampleRate: sampleRate
  });
  const segmentEvidence = definition.segments.map((segment, index) => {
    const { sampleStart, sampleEnd } = segment;
    if (
      !Number.isSafeInteger(sampleStart) ||
      !Number.isSafeInteger(sampleEnd) ||
      sampleStart < 0 ||
      sampleEnd <= sampleStart ||
      sampleEnd > decoded.pcm.length / 2
    ) {
      throw new RangeError(
        `${definition.id}: range inválido no segmento ${index + 1}`
      );
    }
    assertSha256(segment.sha256, `segments[${index}].sha256`);
    const pcm = decoded.pcm.subarray(sampleStart * 2, sampleEnd * 2);
    const segmentSha256 = sha256(pcm);
    if (segmentSha256 !== segment.sha256) {
      throw new Error(
        `${definition.id}: hash divergente no segmento ${index + 1}`
      );
    }
    return {
      pcm,
      evidence: {
        sampleStart,
        sampleEnd,
        sampleCount: pcm.length / 2,
        sha256: segmentSha256
      }
    };
  });
  const pcm = Buffer.concat(segmentEvidence.map((item) => item.pcm));
  const finalPcmSha256 = sha256(pcm);
  if (pcm.length / 2 !== definition.finalPcmSamples) {
    throw new Error(`${definition.id}: número de amostras finais divergente`);
  }
  if (finalPcmSha256 !== definition.finalPcmSha256) {
    throw new Error(`${definition.id}: hash do PCM final divergente`);
  }
  return {
    pcm,
    evidence: {
      id: definition.id,
      sourceWaveSha256,
      sourceSampleRate: decoded.source.sampleRate,
      sampleRate,
      sampleCount: pcm.length / 2,
      finalPcmSha256,
      segments: segmentEvidence.map((item) => item.evidence),
      pass: true
    }
  };
}
