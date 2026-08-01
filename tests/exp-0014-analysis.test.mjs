import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACOUSTIC_REFLEX_CLASSES,
  acousticReflexTeacherLabel,
  predictAcousticReflex
} from "../web/acoustic-reflex-shadow.mjs";
import {
  createLocalAudioReflexState,
  reduceLocalAudioReflex
} from "../web/local-audio-reflex.mjs";
import {
  ACOUSTIC_REFLEX_TRACE_SLICE_VERSION,
  TrainingTraceRecorder
} from "../web/training-trace-recorder.mjs";
import {
  replayAcousticReflexShadowTrace
} from "../scripts/lib/exp-0014-analysis.mjs";

const checkpoint = JSON.parse(await readFile(
  new URL("../web/acoustic-reflex-checkpoint.json", import.meta.url),
  "utf8"
));

function createRecorder() {
  const recorder = new TrainingTraceRecorder({
    sessionId: "exp-0014-replay-test",
    startedAtEpochMs: 0,
    locale: "pt-BR",
    candidate: "acoustic-reflex-shadow-m4a-v0.1",
    configHash: `sha256:${"a".repeat(64)}`,
    sliceVersion: ACOUSTIC_REFLEX_TRACE_SLICE_VERSION,
    limitations: ["teste"],
    label: { task: "acoustic-reflex-intent" }
  });
  recorder.registerStream({
    streamId: "stream-1",
    role: "user-input-fixture",
    mediaRef: "fixture.pcm",
    sha256: `sha256:${"b".repeat(64)}`,
    sampleRate: 16_000,
    channels: 1,
    encoding: "pcm_s16le",
    sampleCount: 4_096
  });
  return recorder;
}

function record(recorder, previous, event, atMs) {
  const transition = reduceLocalAudioReflex(previous, event);
  const teacherLabel = acousticReflexTeacherLabel(
    previous,
    event,
    transition
  );
  const prediction = predictAcousticReflex(checkpoint, previous, event);
  const sampleStart = event.triggerSampleStart ?? event.sampleStart;
  recorder.recordDecision({
    atMs,
    turnId: "turn-1",
    epoch: 0,
    event: {
      type: `local-audio-reflex.${event.type.toLowerCase()}`,
      source: "silero-vad-v6.2",
      audioPosition: {
        streamId: "stream-1",
        sampleStart,
        sampleEnd: sampleStart + 512
      },
      payload: { reflexEvent: event }
    },
    context: {
      state: {
        localAudioReflex: previous,
        features: {
          version: prediction.features.featureVersion,
          names: prediction.features.names,
          values: prediction.features.values
        }
      }
    },
    policy: {
      id: "acoustic-reflex-shadow",
      version: `checkpoint-${checkpoint.modelSha256}`,
      mode: "shadow"
    },
    proposal: prediction.proposal,
    intents: ACOUSTIC_REFLEX_CLASSES.map((type) => ({
      type,
      origin: "acoustic-reflex-shadow",
      probability: prediction.probabilities[type]
    })).sort((left, right) => right.probability - left.probability),
    transition: {
      teacherLabel,
      teacherReason: transition.reason,
      teacherPreviousStateVersion: transition.previousStateVersion,
      teacherStateVersion: transition.state.version,
      inferenceMs: 0.1
    },
    label: {
      value: teacherLabel,
      source: {
        kind: "deterministic-invariant",
        ref: "local-audio-reflex",
        version: transition.reflexVersion
      }
    }
  });
  return transition.state;
}

function fixture() {
  const recorder = createRecorder();
  let state = createLocalAudioReflexState({ mode: "evidence-gated" });
  state = record(recorder, state, {
    type: "USER_SPEECH_STARTED",
    turnId: "turn-1",
    assistantAudible: true,
    assistantPending: true,
    detector: "silero-vad-v6.2",
    probability: 0.91,
    triggerSampleStart: 512
  }, 32);
  state = record(recorder, state, {
    type: "VAD_CONTROL_WINDOW",
    turnId: "turn-1",
    probability: 0.8,
    sampleStart: 1_024
  }, 64);
  record(recorder, state, {
    type: "USER_SPEECH_PAUSED",
    turnId: "turn-1",
    probability: 0.1,
    triggerSampleStart: 1_536
  }, 96);
  return recorder.snapshot;
}

test("replay acústico recompõe features, teacher e probabilidades", () => {
  const replay = replayAcousticReflexShadowTrace(fixture(), checkpoint);

  assert.equal(replay.exact, true);
  assert.equal(replay.steps.length, 3);
  assert.deepEqual(
    replay.steps.map((step) => step.teacher),
    ["WAIT_FOR_EVIDENCE", "WAIT_FOR_EVIDENCE", "CONTINUE_OUTPUT"]
  );
});

test("replay acusa adulteração de probabilidade e estado causal", () => {
  const corrupted = structuredClone(fixture());
  corrupted.decisions[0].outputs[0].payload.probability = 0.5;
  corrupted.contexts[1].state.localAudioReflex.supportingWindows = 2;

  const replay = replayAcousticReflexShadowTrace(corrupted, checkpoint);
  assert.equal(replay.exact, false);
  assert.match(replay.errors.join(" | "), /probabilidade|features/iu);
});
