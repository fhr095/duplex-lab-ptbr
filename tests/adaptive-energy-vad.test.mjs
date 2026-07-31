import test from "node:test";
import assert from "node:assert/strict";

import { AdaptiveEnergyVad } from "../src/audio/adaptive-energy-vad.mjs";

function pushFrames(vad, values, startAtMs = 0) {
  return values.flatMap((rms, index) =>
    vad.push({ atMs: startAtMs + index * 20, durationMs: 20, rms })
  );
}

test("ignora ruído baixo e detecta voz após onset sustentado", () => {
  const vad = new AdaptiveEnergyVad();
  const events = pushFrames(
    vad,
    [0.003, 0.004, 0.003, 0.03, 0.032, 0.035]
  );

  assert.deepEqual(events.map((event) => event.type), [
    "user.speech.started"
  ]);
  assert.equal(events[0].atMs, 60);
});

test("preserva a posição acústica do onset e do frame que confirmou fala", () => {
  const vad = new AdaptiveEnergyVad({ onsetFrames: 3 });
  const events = [0.04, 0.04, 0.04].flatMap((rms, index) =>
    vad.push({
      atMs: 200 + index * 20,
      durationMs: 20,
      rms,
      sequence: 40 + index,
      sampleStart: 12_800 + index * 320
    })
  );

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload, {
    detector: "adaptive-energy-vad",
    rms: 0.04,
    threshold: 0.014,
    onsetSequence: 40,
    onsetSampleStart: 12_800,
    triggerSequence: 42,
    triggerSampleStart: 13_440
  });
});

test("não transforma um pico isolado em fala", () => {
  const vad = new AdaptiveEnergyVad();
  const events = pushFrames(vad, [0.003, 0.05, 0.003, 0.003]);
  assert.equal(events.length, 0);
});

test("emite pausa e retomada sem encerrar o turno", () => {
  const vad = new AdaptiveEnergyVad();
  pushFrames(vad, [0.04, 0.04, 0.04]);
  const paused = pushFrames(vad, Array(10).fill(0.002), 60);
  const resumed = pushFrames(vad, [0.04, 0.04], 260);

  assert.equal(paused.at(-1).type, "user.speech.paused");
  assert.equal(resumed.at(-1).type, "user.speech.resumed");
});

test("pausa informa a primeira amostra classificada como silêncio", () => {
  const vad = new AdaptiveEnergyVad();
  const values = [
    ...Array(3).fill(0.04),
    ...Array(10).fill(0.002)
  ];
  const events = values.flatMap((rms, index) =>
    vad.push({
      atMs: index * 20,
      durationMs: 20,
      rms,
      sequence: index,
      sampleStart: 5_000 + index * 320
    })
  );
  const pause = events.find(
    (event) => event.type === "user.speech.paused"
  );

  assert.equal(pause.atMs, 60);
  assert.equal(pause.payload.pauseSampleStart, 5_960);
});

test("adapta o piso de ruído sem aprender a voz como ruído", () => {
  const vad = new AdaptiveEnergyVad({ noiseAlpha: 0.2 });
  pushFrames(vad, Array(20).fill(0.007));
  const beforeSpeech = vad.noiseFloor;
  pushFrames(vad, [0.05, 0.05, 0.05], 400);

  assert.ok(beforeSpeech > 0.006);
  assert.ok(vad.noiseFloor < 0.01);
  assert.equal(vad.state, "speaking");
});
