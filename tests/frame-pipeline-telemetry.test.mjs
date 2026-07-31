import assert from "node:assert/strict";
import test from "node:test";

import {
  FramePipelineTelemetry
} from "../src/audio/frame-pipeline-telemetry.mjs";
import {
  numberDistribution,
  RollingSamples
} from "../src/audio/rolling-samples.mjs";

test("janela circular mantém custo e memória constantes", () => {
  const samples = new RollingSamples(3);
  samples.push(1);
  samples.push(2);
  samples.push(3);
  samples.push(4);
  assert.equal(samples.push(Number.NaN), false);

  assert.equal(samples.length, 3);
  assert.deepEqual(samples.values().sort((a, b) => a - b), [2, 3, 4]);
  assert.deepEqual(numberDistribution(samples.values()), {
    n: 3,
    p50: 3,
    p95: 4,
    p99: 4,
    max: 4
  });
});

test("pipeline mede backlog e watermark processado", () => {
  const pipeline = new FramePipelineTelemetry({ maxDepth: 3 });
  const first = pipeline.enqueue(
    { sequence: 0, sampleEnd: 320 },
    100
  );
  const second = pipeline.enqueue(
    { sequence: 1, sampleEnd: 640 },
    101
  );

  pipeline.start(first, 103);
  pipeline.complete(first);
  pipeline.start(second, 109);
  pipeline.complete(second);
  const snapshot = pipeline.snapshot(110);

  assert.equal(snapshot.maximumPendingFrames, 2);
  assert.equal(snapshot.pendingFrames, 0);
  assert.equal(snapshot.processedFrames, 2);
  assert.equal(snapshot.lastProcessedSequence, 1);
  assert.equal(snapshot.lastProcessedSampleEnd, 640);
  assert.equal(snapshot.queueDelayMs.p50, 3);
  assert.equal(snapshot.queueDelayMs.p99, 8);
});

test("pipeline recusa overflow e contabiliza erro de processamento", () => {
  const pipeline = new FramePipelineTelemetry({ maxDepth: 1 });
  const token = pipeline.enqueue(
    { sequence: 0, sampleEnd: 320 },
    100
  );
  assert.throws(
    () => pipeline.enqueue(
      { sequence: 1, sampleEnd: 640 },
      101
    ),
    (error) => error.code === "audio_pipeline_overflow"
  );
  pipeline.start(token, 105);
  pipeline.complete(token, { success: false });

  const snapshot = pipeline.snapshot(110);
  assert.equal(snapshot.overflowCount, 1);
  assert.equal(snapshot.processingErrorCount, 1);
  assert.equal(snapshot.processedFrames, 0);
  assert.equal(snapshot.pendingFrames, 0);
});
