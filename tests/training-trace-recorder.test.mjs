import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERRUPTION_TRACE_SLICE_VERSION,
  TRAINING_TRACE_VERSION,
  TrainingTraceRecorder,
  createTrainingTraceBundle,
  projectTrainingTraceToEvaluationTrace,
  validateTrainingTraceBundle
} from "../web/training-trace-recorder.mjs";
import {
  OutputInterruptionLifecycle
} from "../web/output-interruption-lifecycle.mjs";

const CONFIG_HASH = `sha256:${"a".repeat(64)}`;

function options(overrides = {}) {
  return {
    sessionId: "session-trace-1",
    startedAtEpochMs: 1_785_500_000_000,
    locale: "pt-BR",
    candidate: "duplex-local-v0.1",
    configHash: CONFIG_HASH,
    ...overrides
  };
}

function pauseEvent(overrides = {}) {
  return {
    type: "PAUSE_REQUESTED",
    turnId: "turn-1",
    outputEpoch: 3,
    hasAudibleOutput: true,
    hasAcousticOutput: true,
    hasActiveResponse: false,
    ...overrides
  };
}

function recordLifecycleDecision(recorder, lifecycle, event, atMs = 10) {
  const previous = lifecycle.snapshot;
  const transition = lifecycle.dispatch(event);
  return {
    transition,
    record: recorder.recordDecision({
      atMs,
      turnId: event.turnId ?? null,
      epoch: event.outputEpoch ?? transition.state.outputEpoch ?? 0,
      event: {
        type: `output-interruption.${event.type.toLowerCase()}`,
        source: "local-audio-reflex",
        payload: { lifecycleEvent: event }
      },
      context: {
        state: {
          assistantSpeaking: event.hasAudibleOutput === true,
          lifecycle: previous
        }
      },
      policy: {
        id: "output-interruption-lifecycle",
        version: transition.lifecycleVersion,
        mode: "authority"
      },
      transition: {
        previousStateVersion: transition.previousStateVersion,
        stateVersion: transition.state.version,
        previousPhase: previous.phase,
        phase: transition.state.phase,
        reason: transition.reason
      },
      intents: transition.intents
    })
  };
}

test("bundle mínimo declara sessão, clock e limite acústico", () => {
  const bundle = createTrainingTraceBundle(options());

  assert.equal(bundle.schemaVersion, TRAINING_TRACE_VERSION);
  assert.equal(bundle.sliceVersion, INTERRUPTION_TRACE_SLICE_VERSION);
  assert.equal(bundle.session.configHash, CONFIG_HASH);
  assert.equal(bundle.clocks[0].clockId, "browser-performance");
  assert.deepEqual(bundle.streams, []);
  assert.match(bundle.limitations[0], /sem áudio persistido/iu);
  assert.equal(Object.isFrozen(bundle), true);
});

test("decisão autoritativa liga evento, contexto, rótulo e efeito", () => {
  const recorder = new TrainingTraceRecorder(options());
  const lifecycle = new OutputInterruptionLifecycle();
  const { record } = recordLifecycleDecision(
    recorder,
    lifecycle,
    pauseEvent()
  );
  const effectId = record.effects[0].effectId;

  recorder.recordEffectStage(effectId, {
    stage: "dispatched",
    atMs: 10.4,
    evidence: { command: "HTMLMediaElement.pause" }
  });
  recorder.recordEffectStage(effectId, {
    stage: "player-received",
    atMs: 10.5,
    evidence: { paused: true }
  });
  recorder.recordEffectStage(effectId, {
    stage: "renderer-silent",
    atMs: 48,
    evidence: { latencyMs: 38 }
  });
  recorder.recordEffectStage(effectId, {
    stage: "completed",
    atMs: 48,
    evidence: { observation: "browser-render-stop" }
  });

  const bundle = recorder.snapshot;
  assert.equal(bundle.events.length, 1);
  assert.equal(bundle.contexts[0].eventIds[0], bundle.events[0].eventId);
  assert.equal(
    bundle.decisions[0].decisionContextRef,
    bundle.contexts[0].contextId
  );
  assert.equal(bundle.decisions[0].authorityDecision, "ACCEPT");
  assert.equal(bundle.effects[0].decisionId, bundle.decisions[0].decisionId);
  assert.deepEqual(
    bundle.effects[0].stages.map((stage) => stage.stage),
    [
      "accepted",
      "dispatched",
      "player-received",
      "renderer-silent",
      "completed"
    ]
  );
  assert.deepEqual(bundle.labels[0].source, {
    kind: "deterministic-invariant",
    ref: "output-interruption-lifecycle",
    version: "output-interruption-lifecycle-v0.1"
  });
  assert.deepEqual(validateTrainingTraceBundle(bundle), {
    valid: true,
    errors: [],
    counts: {
      events: 1,
      contexts: 1,
      decisions: 1,
      effects: 1,
      labels: 1
    }
  });
});

test("decisão sem intenção fica observável sem inventar efeito", () => {
  const recorder = new TrainingTraceRecorder(options());
  const lifecycle = new OutputInterruptionLifecycle();
  recordLifecycleDecision(
    recorder,
    lifecycle,
    pauseEvent({
      hasAudibleOutput: false,
      hasAcousticOutput: false,
      hasActiveResponse: false
    })
  );

  const bundle = recorder.snapshot;
  assert.equal(bundle.decisions[0].authorityDecision, "REJECT");
  assert.deepEqual(bundle.decisions[0].outputs, []);
  assert.deepEqual(bundle.effects, []);
  assert.equal(validateTrainingTraceBundle(bundle).valid, true);
});

test("shadow nunca recebe autoridade nem cria efeito", () => {
  const recorder = new TrainingTraceRecorder(options());
  const base = {
    atMs: 12,
    turnId: "turn-shadow",
    epoch: 1,
    event: {
      type: "output-interruption.pause_requested",
      source: "shadow-candidate",
      payload: {}
    },
    context: { state: { assistantSpeaking: true } },
    policy: {
      id: "candidate-shadow",
      version: "checkpoint:test",
      mode: "shadow"
    },
    transition: { proposal: "PAUSE_OUTPUT" },
    intents: [{ type: "PAUSE_OUTPUT", origin: "candidate-shadow" }]
  };
  recorder.recordDecision(base);

  const bundle = recorder.snapshot;
  assert.equal(bundle.decisions[0].authorityDecision, "OBSERVE_ONLY");
  assert.equal(bundle.effects.length, 0);
  assert.equal(validateTrainingTraceBundle(bundle).valid, true);
  assert.throws(
    () => recorder.recordDecision({
      ...base,
      atMs: 13,
      authorityDecision: "ACCEPT"
    }),
    /shadow não pode/iu
  );
});

test("ledger recusa tempo regressivo, estágio duplicado e pós-término", () => {
  const recorder = new TrainingTraceRecorder(options());
  const lifecycle = new OutputInterruptionLifecycle();
  const { record } = recordLifecycleDecision(
    recorder,
    lifecycle,
    pauseEvent()
  );
  const effectId = record.effects[0].effectId;

  assert.throws(
    () => recorder.recordEffectStage(effectId, {
      stage: "dispatched",
      atMs: 9
    }),
    /voltar no tempo/iu
  );
  recorder.recordEffectStage(effectId, {
    stage: "dispatched",
    atMs: 11
  });
  assert.throws(
    () => recorder.recordEffectStage(effectId, {
      stage: "dispatched",
      atMs: 12
    }),
    /já registrou/iu
  );
  recorder.recordEffectStage(effectId, {
    stage: "cancelled",
    atMs: 12
  });
  assert.throws(
    () => recorder.recordEffectStage(effectId, {
      stage: "completed",
      atMs: 13
    }),
    /já terminou/iu
  );
});

test("efeito superado aponta para a decisão que o reconciliou", () => {
  const recorder = new TrainingTraceRecorder(options());
  const lifecycle = new OutputInterruptionLifecycle();
  const paused = recordLifecycleDecision(
    recorder,
    lifecycle,
    pauseEvent(),
    10
  );
  const resumed = recordLifecycleDecision(
    recorder,
    lifecycle,
    {
      type: "DISMISS_REQUESTED",
      currentOutputEpoch: 3,
      hasResumableAudio: true
    },
    20
  );
  const pauseEffectId = paused.record.effects[0].effectId;

  recorder.recordEffectStage(pauseEffectId, {
    stage: "cancelled",
    atMs: 20,
    reconciledByDecisionId: resumed.record.decisionId,
    evidence: { reason: "resume-before-render-silent" }
  });

  const effect = recorder.snapshot.effects[0];
  assert.equal(
    effect.reconciledByDecisionId,
    resumed.record.decisionId
  );
  assert.equal(effect.status, "cancelled");
  assert.equal(validateTrainingTraceBundle(recorder.snapshot).valid, true);
  assert.throws(
    () => recorder.recordEffectStage(
      resumed.record.effects[0].effectId,
      {
        stage: "cancelled",
        atMs: 21,
        reconciledByDecisionId: "decision-ausente"
      }
    ),
    /desconhecido/iu
  );
});

test("projeção v0 usa somente STOP renderizado e retomada audível", () => {
  const recorder = new TrainingTraceRecorder(options());
  const lifecycle = new OutputInterruptionLifecycle();
  const paused = recordLifecycleDecision(
    recorder,
    lifecycle,
    pauseEvent(),
    10
  );
  const pauseEffectId = paused.record.effects[0].effectId;
  recorder.recordEffectStage(pauseEffectId, {
    stage: "dispatched",
    atMs: 11
  });
  recorder.recordEffectStage(pauseEffectId, {
    stage: "player-received",
    atMs: 12
  });
  recorder.recordEffectStage(pauseEffectId, {
    stage: "renderer-silent",
    atMs: 18
  });
  recorder.recordEffectStage(pauseEffectId, {
    stage: "completed",
    atMs: 18
  });
  const resume = recordLifecycleDecision(
    recorder,
    lifecycle,
    {
      type: "DISMISS_REQUESTED",
      currentOutputEpoch: 3,
      hasResumableAudio: true
    },
    30
  );
  const resumeEffectId = resume.record.effects[0].effectId;
  recorder.recordEffectStage(resumeEffectId, {
    stage: "dispatched",
    atMs: 31
  });
  recorder.recordEffectStage(resumeEffectId, {
    stage: "player-received",
    atMs: 32
  });
  recorder.recordEffectStage(resumeEffectId, {
    stage: "audible",
    atMs: 35
  });
  recorder.recordEffectStage(resumeEffectId, {
    stage: "completed",
    atMs: 36
  });

  const projection = projectTrainingTraceToEvaluationTrace(
    recorder.snapshot
  );
  assert.deepEqual(
    projection.events.map((event) => [event.atMs, event.type]),
    [
      [0, "assistant.speech.stopped"],
      [17, "assistant.speech.started"]
    ]
  );
  assert.equal(projection.events[0].payload.measurement, "browser-renderer");
  assert.equal(projection.events[1].payload.kind, "resumed");
});

test("validador detecta referências, autoridade e ledger adulterados", () => {
  const recorder = new TrainingTraceRecorder(options());
  const lifecycle = new OutputInterruptionLifecycle();
  recordLifecycleDecision(recorder, lifecycle, pauseEvent());
  const corrupted = structuredClone(recorder.snapshot);
  corrupted.contexts[0].eventIds = ["event-ausente"];
  corrupted.events[0].atMs = 12;
  corrupted.decisions[0].policy.mode = "shadow";
  corrupted.effects[0].stages[0].atMs = 8;
  corrupted.effects[0].stages.push({
    ...corrupted.effects[0].stages[0],
    atMs: 7
  });
  corrupted.labels[0].source.version = "";
  corrupted.labels[0].targetId = "decision-ausente";
  corrupted.effects[0].status = "completed";
  corrupted.contexts[0].availableAt.atMs = 11;

  const validation = validateTrainingTraceBundle(corrupted);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" | "), /evento ausente/iu);
  assert.match(validation.errors.join(" | "), /autoridade a shadow/iu);
  assert.match(validation.errors.join(" | "), /duplica estágio/iu);
  assert.match(validation.errors.join(" | "), /volta no tempo/iu);
  assert.match(validation.errors.join(" | "), /proveniência/iu);
  assert.match(validation.errors.join(" | "), /status divergente/iu);
  assert.match(validation.errors.join(" | "), /contexto do futuro/iu);
  assert.match(validation.errors.join(" | "), /evento do futuro/iu);
  assert.match(validation.errors.join(" | "), /não nasce/iu);
  assert.match(validation.errors.join(" | "), /não possui rótulo/iu);
});

test("configuração e payload inválidos falham fechados", () => {
  assert.throws(
    () => createTrainingTraceBundle(options({ configHash: "latest" })),
    /sha256/iu
  );
  const recorder = new TrainingTraceRecorder(options());
  assert.throws(
    () => recorder.recordDecision({
      atMs: 1,
      epoch: 0,
      event: {
        type: "event",
        source: "test",
        payload: { invalid: undefined }
      },
      context: { state: {} },
      policy: { id: "p", version: "v", mode: "authority" },
      transition: {},
      intents: []
    }),
    /undefined/iu
  );
});
