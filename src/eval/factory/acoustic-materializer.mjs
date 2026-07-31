import { createHash } from "node:crypto";

import {
  applyPcm16Gain,
  generateSeededWhiteNoisePcm16,
  measurePcm16,
  measureSnrDb,
  renderPcm16Scene
} from "../../audio/acoustic-renderer.mjs";
import { encodePcm16Wave } from "../../audio/wav.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function encodeWaveArtifact(pcm, { sampleRate = 16_000 } = {}) {
  if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new TypeError("pcm precisa ser PCM16 não vazio");
  }
  const wave = encodePcm16Wave(pcm, { sampleRate });
  return {
    wave,
    sha256: sha256(wave),
    pcmSha256: sha256(pcm)
  };
}

export function renderFactoryAcousticVariant({
  pcm,
  condition,
  seed,
  sampleRate = 16_000
}) {
  if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new TypeError("pcm precisa ser PCM16 não vazio");
  }
  if (!condition || !["quiet", "noise"].includes(condition.kind)) {
    throw new TypeError("condition.kind precisa ser quiet ou noise");
  }
  const signalGainDb = condition.signalGainDb ?? 0;
  const tracks = [
    {
      id: "user",
      role: "near-end-user",
      pcm,
      gainDb: signalGainDb
    }
  ];
  if (condition.kind === "noise") {
    if (!Number.isFinite(condition.snrDb)) {
      throw new TypeError("condition.snrDb é obrigatório para noise");
    }
    const gainedSignal = applyPcm16Gain(pcm, signalGainDb);
    const signalRms = measurePcm16(gainedSignal, { sampleRate }).rms;
    const targetNoiseRms = signalRms / (10 ** (condition.snrDb / 20));
    tracks.push({
      id: "noise",
      role: "seeded-white-noise",
      pcm: generateSeededWhiteNoisePcm16({
        sampleCount: pcm.length / 2,
        seed,
        targetRms: targetNoiseRms
      })
    });
  }
  const rendered = renderPcm16Scene({ tracks, sampleRate });
  const signalStem = rendered.stems.find((stem) => stem.id === "user");
  const noiseStem = rendered.stems.find((stem) => stem.id === "noise");
  return {
    ...rendered,
    condition: structuredClone(condition),
    achievedSnrDb: noiseStem
      ? measureSnrDb(signalStem.pcm, noiseStem.pcm)
      : null,
    noisePcm: noiseStem?.pcm ?? null
  };
}
