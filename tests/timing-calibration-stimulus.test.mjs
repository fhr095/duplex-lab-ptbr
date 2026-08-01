import assert from "node:assert/strict";
import test from "node:test";

import {
  TIMING_CALIBRATION_ACTIONS,
  renderTimingCalibrationStimulus
} from "../src/eval/calibration/timing-stimulus.mjs";

function constantPcm(samples, value) {
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    pcm.writeInt16LE(value, index * 2);
  }
  return pcm;
}

function channelSamples(stereoPcm, channel) {
  const values = [];
  for (let offset = channel * 2; offset < stereoPcm.length; offset += 4) {
    values.push(stereoPcm.readInt16LE(offset));
  }
  return values;
}

test("renderiza PAUSE, WAIT e CONTINUE como contrafactuais estéreo distintos", () => {
  const assistantPcm = constantPcm(1_000, 12_000);
  const userPcm = constantPcm(300, 8_000);
  const common = {
    assistantPcm,
    userPcm,
    sampleRate: 1_000,
    sceneSampleCount: 1_000,
    userStartSample: 200,
    decisionSample: 300,
    waitStopSample: 500,
    fadeSamples: 20,
    assistantGainDb: -6,
    userGainDb: -6,
    crossfeedGainDb: -30
  };
  const rendered = Object.fromEntries(
    TIMING_CALIBRATION_ACTIONS.map((action) => [
      action,
      renderTimingCalibrationStimulus({ ...common, action })
    ])
  );

  const pauseLeft = channelSamples(
    rendered.PAUSE_OUTPUT.stereoPcm,
    0
  );
  const waitLeft = channelSamples(
    rendered.WAIT_FOR_EVIDENCE.stereoPcm,
    0
  );
  const continueLeft = channelSamples(
    rendered.CONTINUE_OUTPUT.stereoPcm,
    0
  );

  assert.equal(rendered.PAUSE_OUTPUT.channels, 2);
  assert.equal(rendered.PAUSE_OUTPUT.sampleCount, 1_000);
  assert.ok(Math.abs(pauseLeft[350]) < Math.abs(waitLeft[350]));
  assert.ok(Math.abs(waitLeft[600]) < Math.abs(continueLeft[600]));
  assert.ok(rendered.PAUSE_OUTPUT.metrics.preClipSamples === 0);
  assert.notDeepEqual(
    rendered.PAUSE_OUTPUT.stereoPcm,
    rendered.WAIT_FOR_EVIDENCE.stereoPcm
  );
  assert.notDeepEqual(
    rendered.WAIT_FOR_EVIDENCE.stereoPcm,
    rendered.CONTINUE_OUTPUT.stereoPcm
  );
});

test("WAIT preserva a saída quando a evidência termina sem confirmar pausa", () => {
  const result = renderTimingCalibrationStimulus({
    action: "WAIT_FOR_EVIDENCE",
    assistantPcm: constantPcm(600, 10_000),
    userPcm: constantPcm(80, 5_000),
    sampleRate: 1_000,
    sceneSampleCount: 600,
    userStartSample: 100,
    decisionSample: 150,
    waitStopSample: null,
    fadeSamples: 10
  });
  const left = channelSamples(result.stereoPcm, 0);
  assert.notEqual(left[500], 0);
  assert.equal(result.timing.outputStopSample, null);
});

test("recusa mídia desalinhada e decisões temporalmente impossíveis", () => {
  const valid = {
    action: "PAUSE_OUTPUT",
    assistantPcm: constantPcm(100, 1_000),
    userPcm: constantPcm(20, 1_000),
    sampleRate: 1_000,
    sceneSampleCount: 100,
    userStartSample: 10,
    decisionSample: 20,
    waitStopSample: 30,
    fadeSamples: 5
  };
  assert.throws(
    () => renderTimingCalibrationStimulus({
      ...valid,
      decisionSample: 5
    }),
    /decisionSample/u
  );
  assert.throws(
    () => renderTimingCalibrationStimulus({
      ...valid,
      userPcm: Buffer.alloc(3)
    }),
    /PCM16/u
  );
  assert.throws(
    () => renderTimingCalibrationStimulus({
      ...valid,
      action: "SPEAK"
    }),
    /action/u
  );
});
