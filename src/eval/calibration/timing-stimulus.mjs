import {
  renderPcm16Scene
} from "../../audio/acoustic-renderer.mjs";

export const TIMING_CALIBRATION_ACTIONS = Object.freeze([
  "WAIT_FOR_EVIDENCE",
  "PAUSE_OUTPUT",
  "CONTINUE_OUTPUT"
]);

function pcm16(value, label) {
  if (!Buffer.isBuffer(value) || value.length % 2 !== 0) {
    throw new TypeError(`${label} precisa ser PCM16 alinhado`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} precisa ser inteiro não negativo`);
  }
  return value;
}

function finiteGain(value, label) {
  if (!Number.isFinite(value) || value < -120 || value > 24) {
    throw new RangeError(`${label} precisa estar entre -120 e 24 dB`);
  }
  return value;
}

function outputStem(source, sampleCount, stopSample, fadeSamples) {
  const output = Buffer.alloc(sampleCount * 2);
  source.copy(output, 0, 0, Math.min(source.length, output.length));
  if (stopSample === null) {
    return output;
  }
  const fadeEnd = Math.min(sampleCount, stopSample + fadeSamples);
  if (fadeSamples > 0) {
    for (let sample = stopSample; sample < fadeEnd; sample += 1) {
      const remaining = fadeEnd - sample;
      const gain = remaining / fadeSamples;
      output.writeInt16LE(
        Math.round(output.readInt16LE(sample * 2) * gain),
        sample * 2
      );
    }
  }
  output.fill(0, fadeEnd * 2);
  return output;
}

function interleaveStereo(left, right) {
  if (left.length !== right.length || left.length % 2 !== 0) {
    throw new RangeError("canais estéreo precisam ter o mesmo PCM16");
  }
  const samples = left.length / 2;
  const output = Buffer.alloc(samples * 4);
  for (let index = 0; index < samples; index += 1) {
    output.writeInt16LE(left.readInt16LE(index * 2), index * 4);
    output.writeInt16LE(right.readInt16LE(index * 2), index * 4 + 2);
  }
  return output;
}

export function renderTimingCalibrationStimulus(input = {}) {
  const action = input.action;
  if (!TIMING_CALIBRATION_ACTIONS.includes(action)) {
    throw new TypeError("action de calibração é inválida");
  }
  const assistantPcm = pcm16(input.assistantPcm, "assistantPcm");
  const userPcm = pcm16(input.userPcm, "userPcm");
  const sampleRate = nonNegativeInteger(
    input.sampleRate ?? 16_000,
    "sampleRate"
  );
  const sceneSampleCount = nonNegativeInteger(
    input.sceneSampleCount,
    "sceneSampleCount"
  );
  const userStartSample = nonNegativeInteger(
    input.userStartSample,
    "userStartSample"
  );
  const decisionSample = nonNegativeInteger(
    input.decisionSample,
    "decisionSample"
  );
  const fadeSamples = nonNegativeInteger(
    input.fadeSamples ?? Math.round(sampleRate * 0.03),
    "fadeSamples"
  );
  const waitStopSample = input.waitStopSample === null
    ? null
    : nonNegativeInteger(input.waitStopSample, "waitStopSample");
  if (sampleRate === 0 || sceneSampleCount === 0) {
    throw new RangeError("sampleRate e sceneSampleCount precisam ser positivos");
  }
  if (decisionSample < userStartSample || decisionSample >= sceneSampleCount) {
    throw new RangeError(
      "decisionSample precisa cair após userStartSample e dentro da cena"
    );
  }
  if (
    waitStopSample !== null &&
    (waitStopSample < decisionSample || waitStopSample >= sceneSampleCount)
  ) {
    throw new RangeError("waitStopSample precisa suceder decisionSample");
  }
  if (userStartSample + userPcm.length / 2 > sceneSampleCount) {
    throw new RangeError("userPcm excede sceneSampleCount");
  }

  const assistantGainDb = finiteGain(
    input.assistantGainDb ?? -8,
    "assistantGainDb"
  );
  const userGainDb = finiteGain(input.userGainDb ?? -6, "userGainDb");
  const crossfeedGainDb = finiteGain(
    input.crossfeedGainDb ?? -24,
    "crossfeedGainDb"
  );
  const outputStopSample = action === "PAUSE_OUTPUT"
    ? decisionSample
    : action === "WAIT_FOR_EVIDENCE"
      ? waitStopSample
      : null;
  const assistantOutput = outputStem(
    assistantPcm,
    sceneSampleCount,
    outputStopSample,
    fadeSamples
  );
  const left = renderPcm16Scene({
    sampleRate,
    sampleCount: sceneSampleCount,
    tracks: [
      {
        id: "assistant-primary",
        role: "assistant-output",
        pcm: assistantOutput,
        gainDb: assistantGainDb
      },
      {
        id: "user-crossfeed",
        role: "near-end-user-crossfeed",
        pcm: userPcm,
        startSample: userStartSample,
        gainDb: userGainDb + crossfeedGainDb
      }
    ]
  });
  const right = renderPcm16Scene({
    sampleRate,
    sampleCount: sceneSampleCount,
    tracks: [
      {
        id: "assistant-crossfeed",
        role: "assistant-output-crossfeed",
        pcm: assistantOutput,
        gainDb: assistantGainDb + crossfeedGainDb
      },
      {
        id: "user-primary",
        role: "near-end-user",
        pcm: userPcm,
        startSample: userStartSample,
        gainDb: userGainDb
      }
    ]
  });
  return Object.freeze({
    schemaVersion: 1,
    action,
    sampleRate,
    channels: 2,
    sampleCount: sceneSampleCount,
    stereoPcm: interleaveStereo(left.mix, right.mix),
    timing: Object.freeze({
      userStartSample,
      decisionSample,
      waitStopSample,
      outputStopSample,
      fadeSamples
    }),
    metrics: Object.freeze({
      left: left.metrics,
      right: right.metrics,
      preClipSamples:
        left.metrics.preClipSamples + right.metrics.preClipSamples
    })
  });
}
