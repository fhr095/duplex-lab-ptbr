import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXP0019_DEFER_CAUSAL_EVIDENCE,
  EXP0019_FIXED_GAP_SAMPLES,
  EXP0019_FROZEN_SIGNATURE,
  EXP0019_PAYLOAD_KEYS,
  EXP0019_PROPOSAL_BUDGET_SAMPLES,
  EXP0019_SAMPLE_RATE,
  EXP0019_SELECTED_BLOCKS,
  EXP0019_TARGET_OFFSET_SAMPLES,
  createExp0019CausalPayload,
  createExp0019CausalSchedule,
  runExp0019CausalAdapter,
  validateExp0019CausalAudioPlan,
  validateExp0019CausalPayload
} from "../src/eval/exp-0019-causal-audio-bridge.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  buildExp0019CausalAudioPlanArtifact
} from "../scripts/build-exp-0019-causal-audio-plan.mjs";

const PLAN_PATH = new URL(
  "../eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
  import.meta.url
);

async function materializedPlan() {
  return JSON.parse(await readFile(PLAN_PATH, "utf8"));
}

function rehash(plan) {
  const core = structuredClone(plan);
  delete core.planSha256;
  plan.planSha256 = `sha256:${canonicalSha256(core)}`;
  return plan;
}

function fixtureSchedule(targetSampleCount = 16_000) {
  return createExp0019CausalSchedule({
    inboundSlotSamples: 48_000,
    assistantPrefixSlotSamples: 64_000,
    assistantTotalSlotSamples: 96_000,
    targetSampleCount,
    targetOnsetSample: 800
  });
}

test("builder deriva byte a byte os dois blocos e a assinatura congelada", async () => {
  const [built, existing] = await Promise.all([
    buildExp0019CausalAudioPlanArtifact(),
    readFile(PLAN_PATH)
  ]);
  assert.equal(built.bytes.equals(existing), true);
  assert.deepEqual(
    built.plan.selection.crossBlockRootIds,
    EXP0019_SELECTED_BLOCKS
  );
  assert.deepEqual(
    built.plan.summary.frozenSignature,
    EXP0019_FROZEN_SIGNATURE
  );
  assert.deepEqual({
    crossBlocks: built.plan.summary.crossBlocks,
    pairRoots: built.plan.summary.pairRoots,
    scenes: built.plan.summary.scenes,
    targetSurfaces: built.plan.summary.targetSurfaces,
    contextSurfaces: built.plan.summary.contextSurfaces,
    streams: built.plan.summary.streams
  }, {
    crossBlocks: 2,
    pairRoots: 4,
    scenes: 8,
    targetSurfaces: 4,
    contextSurfaces: 4,
    streams: 12
  });
  assert.equal(
    validateExp0019CausalAudioPlan(built.plan, built.sources).valid,
    true
  );
  assert.equal(built.plan.authority.canProduceEffects, false);
  assert.equal(built.plan.audio.materialized, false);
});

test("cada target/context cruza rótulos e cada par reutiliza target e schedule", async () => {
  const plan = await materializedPlan();
  const byKind = Map.groupBy(plan.audio.streams, (stream) => stream.kind);
  assert.deepEqual(
    Object.fromEntries([...byKind].map(([kind, streams]) => [
      kind,
      streams.length
    ])),
    { assistant: 4, inbound: 4, target: 4 }
  );
  for (const field of ["targetSurfaceId", "contextSurfaceId"]) {
    const groups = Map.groupBy(plan.scenes, (scene) => scene.scorer[field]);
    assert.equal(groups.size, 4);
    for (const descendants of groups.values()) {
      assert.equal(descendants.length, 2);
      assert.deepEqual(
        new Set(descendants.map((scene) => scene.scorer.label)),
        new Set([
          "BACKGROUND_OR_NOT_DIRECTED",
          "DIRECTED_TO_ASSISTANT"
        ])
      );
    }
  }
  const pairs = Map.groupBy(
    plan.scenes,
    (scene) => scene.scorer.pairRootId
  );
  assert.equal(pairs.size, 4);
  for (const descendants of pairs.values()) {
    assert.equal(descendants.length, 2);
    assert.equal(
      descendants[0].streamBindings.target,
      descendants[1].streamBindings.target
    );
    assert.equal(
      descendants[0].scheduleBindingKey,
      descendants[1].scheduleBindingKey
    );
    assert.equal(
      descendants[0].oracleText.targetText,
      descendants[1].oracleText.targetText
    );
  }
});

test("schedule 16 kHz preserva inbound→gap→prefix→cauda/target", () => {
  const schedule = fixtureSchedule();
  assert.equal(schedule.sampleRate, EXP0019_SAMPLE_RATE);
  assert.equal(
    schedule.gap.endSample - schedule.gap.startSample,
    EXP0019_FIXED_GAP_SAMPLES
  );
  assert.equal(
    schedule.target.startSample - schedule.assistant.prefixEndSample,
    EXP0019_TARGET_OFFSET_SAMPLES
  );
  assert.equal(EXP0019_TARGET_OFFSET_SAMPLES / EXP0019_SAMPLE_RATE, 0.08);
  assert.equal(
    schedule.assistant.tailStartSample,
    schedule.assistant.prefixEndSample
  );
  assert.ok(schedule.target.startSample < schedule.assistant.endSample);
  assert.ok(
    schedule.assistant.endSample - schedule.target.endSample >=
      EXP0019_PROPOSAL_BUDGET_SAMPLES
  );
  assert.deepEqual(schedule.availability, {
    recentInboundAvailableAtSample: schedule.inbound.endSample,
    assistantAudiblePrefixAvailableAtSample:
      schedule.assistant.prefixEndSample,
    targetAvailableAtSample: schedule.target.endSample
  });
  assert.equal(schedule.futurePcmSamplesUsed, 0);
});

test("probes antes das três evidências deferem sem inferência", async () => {
  const plan = await materializedPlan();
  const scene = plan.scenes[0];
  const schedule = fixtureSchedule();
  let inferences = 0;
  const classify = () => {
    inferences += 1;
    return { predicted: "DIRECTED_TO_ASSISTANT" };
  };
  const probes = [
    schedule.availability.recentInboundAvailableAtSample - 1,
    schedule.availability.recentInboundAvailableAtSample,
    schedule.availability.assistantAudiblePrefixAvailableAtSample - 1,
    schedule.availability.assistantAudiblePrefixAvailableAtSample,
    schedule.availability.targetAvailableAtSample - 1
  ];
  for (const currentSample of probes) {
    const payload = createExp0019CausalPayload(
      scene.oracleText,
      schedule,
      currentSample
    );
    assert.deepEqual(Object.keys(payload).sort(),
      [...EXP0019_PAYLOAD_KEYS].sort());
    const result = runExp0019CausalAdapter(payload, {
      armName: "B1",
      classify,
      expectedAvailability: schedule.availability
    });
    assert.equal(result.status, EXP0019_DEFER_CAUSAL_EVIDENCE);
    assert.equal(result.classifierExecuted, false);
    assert.equal(result.inferenceCountDelta, 0);
  }
  assert.equal(inferences, 0);

  const ready = createExp0019CausalPayload(
    scene.oracleText,
    schedule,
    schedule.availability.targetAvailableAtSample
  );
  const result = runExp0019CausalAdapter(ready, {
    armName: "B1",
    classify,
    expectedAvailability: schedule.availability
  });
  assert.equal(result.status, "SHADOW_PROPOSAL");
  assert.equal(result.classifierExecuted, true);
  assert.equal(result.inferenceCountDelta, 1);
  assert.equal(result.canProduceEffects, false);
  assert.deepEqual(result.modelInput, {
    assistantAudiblePrefixAtDecision:
      scene.oracleText.assistantAudiblePrefixAtDecision,
    assistantSpeaking: true,
    recentInbound: scene.oracleText.recentInbound,
    targetText: scene.oracleText.targetText
  });
  assert.equal(inferences, 1);
});

test("B0 projeta somente target e B1 projeta os três textos", async () => {
  const plan = await materializedPlan();
  const scene = plan.scenes[0];
  const schedule = fixtureSchedule();
  const payload = createExp0019CausalPayload(
    scene.oracleText,
    schedule,
    schedule.target.endSample
  );
  const observed = {};
  for (const armName of ["B0", "B1"]) {
    runExp0019CausalAdapter(payload, {
      armName,
      expectedAvailability: schedule.availability,
      classify(modelInput) {
        observed[armName] = modelInput;
        return null;
      }
    });
  }
  assert.deepEqual(Object.keys(observed.B0).sort(), [
    "assistantSpeaking",
    "targetText"
  ]);
  assert.deepEqual(Object.keys(observed.B1).sort(), [
    "assistantAudiblePrefixAtDecision",
    "assistantSpeaking",
    "recentInbound",
    "targetText"
  ]);
});

test("IDs, rótulos, texto futuro e disponibilidade forjada falham fechados", async () => {
  const plan = await materializedPlan();
  const scene = plan.scenes[0];
  const schedule = fixtureSchedule();
  const beforeTarget = structuredClone(createExp0019CausalPayload(
    scene.oracleText,
    schedule,
    schedule.target.endSample - 1
  ));
  let inferences = 0;
  const classify = () => { inferences += 1; };
  const mutations = [
    (payload) => { payload.label = "DIRECTED_TO_ASSISTANT"; },
    (payload) => { payload.exampleId = "e-hidden"; },
    (payload) => { payload.targetText = scene.oracleText.targetText; },
    (payload) => { payload.targetAvailableAtSample -= 1; }
  ];
  for (const mutate of mutations) {
    const poisoned = structuredClone(beforeTarget);
    mutate(poisoned);
    const result = runExp0019CausalAdapter(poisoned, {
      armName: "B1",
      classify,
      expectedAvailability: schedule.availability
    });
    assert.equal(result.status, "INVALID_CAUSAL_PAYLOAD");
    assert.equal(result.classifierExecuted, false);
    assert.equal(result.inferenceCountDelta, 0);
  }
  assert.equal(inferences, 0);
  const future = structuredClone(beforeTarget);
  future.targetText = scene.oracleText.targetText;
  assert.ok(validateExp0019CausalPayload(future).errors.some(
    (error) => /texto futuro/iu.test(error)
  ));
});

test("tamper coerente de igualdade pareada é detectado além do hash", async () => {
  const plan = structuredClone(await materializedPlan());
  const pair = plan.scenes.filter((scene) =>
    scene.scorer.pairRootId === plan.scenes[0].scorer.pairRootId
  );
  pair[1].scheduleBindingKey = "schedule-drift";
  rehash(plan);
  const validation = validateExp0019CausalAudioPlan(plan);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /pareada/iu.test(error)));
});
