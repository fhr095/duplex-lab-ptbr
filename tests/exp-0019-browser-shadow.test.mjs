import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  extractExp0018ContextFeatures,
  projectExp0018ModelInput
} from "../src/eval/exp-0018-context.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { predictSoftmaxClassifier } from
  "../src/learning/softmax-classifier.mjs";
import { deriveExp0019WebCheckpoint } from
  "../scripts/build-exp-0019-web-checkpoint.mjs";
import {
  CONTEXT_RELEVANCE_AVAILABILITY_KEYS,
  CONTEXT_RELEVANCE_CLASSES,
  CONTEXT_RELEVANCE_FEATURES,
  CONTEXT_RELEVANCE_PAYLOAD_KEYS,
  ContextRelevanceShadow,
  EXP0019_SOURCE_CHECKPOINT,
  canonicalContextRelevanceSha256,
  classifyContextRelevanceArm,
  validateContextRelevanceCheckpoint
} from "../web/context-relevance-shadow.mjs";

const SELECTED_BLOCKS = new Set([
  "development-correction-version-label",
  "development-short-meeting-shirt"
]);

const SOURCE_CHECKPOINT_PATH = new URL(
  "../eval/checkpoints/exp-0018-context-v0.1.json",
  import.meta.url
);
const WEB_CHECKPOINT_PATH = new URL(
  "../web/context-relevance-checkpoint.json",
  import.meta.url
);
const DEVELOPMENT_PATH = new URL(
  "../eval/datasets/exp-0018-context-development-v0.1.json",
  import.meta.url
);
const REPORT_PATH = new URL(
  "../eval/reports/exp-0018-context-development-v0.1.json",
  import.meta.url
);

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fixture() {
  const [sourceBytes, webBytes, developmentBytes, reportBytes] =
    await Promise.all([
      readFile(SOURCE_CHECKPOINT_PATH),
      readFile(WEB_CHECKPOINT_PATH),
      readFile(DEVELOPMENT_PATH),
      readFile(REPORT_PATH)
    ]);
  const development = JSON.parse(developmentBytes.toString("utf8"));
  return {
    sourceBytes,
    source: JSON.parse(sourceBytes.toString("utf8")),
    web: JSON.parse(webBytes.toString("utf8")),
    report: JSON.parse(reportBytes.toString("utf8")),
    examples: development.examples
      .filter((example) => SELECTED_BLOCKS.has(example.crossBlockRootId))
      .sort((left, right) => left.exampleId.localeCompare(right.exampleId))
  };
}

function availability() {
  return {
    recentInboundAvailableAtSample: 16_000,
    assistantAudiblePrefixAvailableAtSample: 32_000,
    targetAvailableAtSample: 48_000
  };
}

function payloadFor(example, currentSample = 48_000) {
  const availableAt = availability();
  return {
    assistantAudiblePrefixAtDecision: currentSample >=
      availableAt.assistantAudiblePrefixAvailableAtSample
      ? example.modelInput.assistantAudiblePrefixAtDecision
      : null,
    assistantAudiblePrefixAvailableAtSample:
      availableAt.assistantAudiblePrefixAvailableAtSample,
    assistantSpeaking: example.modelInput.assistantSpeaking,
    currentSample,
    recentInbound: currentSample >=
      availableAt.recentInboundAvailableAtSample
      ? [...example.modelInput.recentInbound]
      : [],
    recentInboundAvailableAtSample:
      availableAt.recentInboundAvailableAtSample,
    targetAvailableAtSample: availableAt.targetAvailableAtSample,
    targetText: currentSample >= availableAt.targetAvailableAtSample
      ? example.modelInput.targetText
      : null
  };
}

test("checkpoint browser é derivação compacta exata do EXP-0018", async () => {
  const data = await fixture();
  assert.equal(validateContextRelevanceCheckpoint(data.web).valid, true);
  assert.equal(
    sha256Bytes(data.sourceBytes),
    EXP0019_SOURCE_CHECKPOINT.fileSha256
  );
  assert.deepEqual(
    deriveExp0019WebCheckpoint(data.source, sha256Bytes(data.sourceBytes)),
    data.web
  );
  const core = structuredClone(data.web);
  delete core.browserCheckpointSha256;
  assert.equal(
    data.web.browserCheckpointSha256,
    `sha256:${canonicalSha256(core)}`
  );
  assert.equal(
    canonicalContextRelevanceSha256(core),
    canonicalSha256(core),
    "hash browser síncrono precisa coincidir com o hash Node congelado"
  );
  assert.deepEqual(data.web.featureNames, data.source.featureNames);
  assert.deepEqual(data.web.featureNames, CONTEXT_RELEVANCE_FEATURES);
  assert.deepEqual(data.web.classes, data.source.classes);
  assert.deepEqual(data.web.classes, CONTEXT_RELEVANCE_CLASSES);
  for (const name of ["B0", "B1"]) {
    assert.deepEqual(
      data.web.arms[name].weights,
      data.source.arms[name].model.weights
    );
    assert.equal(
      data.web.arms[name].threshold,
      data.source.arms[name].threshold
    );
    assert.equal(
      data.web.arms[name].modelSha256,
      data.source.arms[name].modelSha256
    );
    assert.equal(
      data.web.arms[name].weightsSha256,
      `sha256:${canonicalSha256(data.source.arms[name].model.weights)}`
    );
  }

  const authority = structuredClone(data.web);
  authority.authority.canProduceEffects = true;
  assert.equal(validateContextRelevanceCheckpoint(authority).valid, false);
  const rebound = structuredClone(data.web);
  rebound.source.checkpointSha256 = `sha256:${"0".repeat(64)}`;
  assert.equal(validateContextRelevanceCheckpoint(rebound).valid, false);

  const tamperedWeight = structuredClone(data.web);
  tamperedWeight.arms.B1.weights[0][0] += 1e-9;
  assert.equal(
    validateContextRelevanceCheckpoint(tamperedWeight).valid,
    false,
    "peso adulterado não pode reutilizar hashes congelados"
  );
  const rehashedArtifact = structuredClone(tamperedWeight);
  const rehashedCore = structuredClone(rehashedArtifact);
  delete rehashedCore.browserCheckpointSha256;
  rehashedArtifact.browserCheckpointSha256 =
    `sha256:${canonicalContextRelevanceSha256(rehashedCore)}`;
  assert.equal(
    validateContextRelevanceCheckpoint(rehashedArtifact).valid,
    false,
    "rehash do artefato não pode ocultar divergência dos pesos"
  );
  const coherentlyRehashed = structuredClone(rehashedArtifact);
  coherentlyRehashed.arms.B1.weightsSha256 =
    `sha256:${canonicalContextRelevanceSha256(
      coherentlyRehashed.arms.B1.weights
    )}`;
  const coherentCore = structuredClone(coherentlyRehashed);
  delete coherentCore.browserCheckpointSha256;
  coherentlyRehashed.browserCheckpointSha256 =
    `sha256:${canonicalContextRelevanceSha256(coherentCore)}`;
  assert.equal(
    validateContextRelevanceCheckpoint(coherentlyRehashed).valid,
    false,
    "hash de pesos novo não pode substituir o binding congelado do EXP-0018"
  );
});

test("probes pré-fronteira deferem sem executar o classificador", async () => {
  const data = await fixture();
  assert.equal(data.examples.length, 8);
  let calls = 0;
  const shadow = new ContextRelevanceShadow(data.web, {
    classify: (...args) => {
      calls += 1;
      return classifyContextRelevanceArm(...args);
    }
  });
  const boundaries = CONTEXT_RELEVANCE_AVAILABILITY_KEYS.map(
    (key) => availability()[key]
  );
  for (const example of data.examples) {
    for (const boundary of boundaries) {
      const payload = payloadFor(example, boundary - 1);
      assert.equal(
        payload.recentInbound.length > 0,
        payload.currentSample >= payload.recentInboundAvailableAtSample
      );
      assert.equal(
        payload.assistantAudiblePrefixAtDecision !== null,
        payload.currentSample >=
          payload.assistantAudiblePrefixAvailableAtSample
      );
      assert.equal(
        payload.targetText !== null,
        payload.currentSample >= payload.targetAvailableAtSample
      );
      const result = shadow.evaluate(payload);
      assert.equal(result.status, "DEFER_CAUSAL_EVIDENCE");
      assert.equal(result.classifierCalls, 0);
      assert.equal(result.proposal, null);
      assert.equal(result.effects.length, 0);
      assert.equal(result.authority.canProduceEffects, false);
    }
  }
  assert.equal(calls, 0);
  assert.equal(shadow.snapshot.inferenceCount, 0);
  assert.equal(shadow.snapshot.deferCount, 24);
  assert.equal(shadow.snapshot.effectsDispatched, 0);

  const example = data.examples[0];
  const availableAt = availability();
  for (const forbiddenKey of [
    "label",
    "exampleId",
    "pairRootId",
    "crossBlockRootId",
    "family",
    "expectedAction"
  ]) {
    const result = shadow.evaluate({
      ...payloadFor(example, availableAt.targetAvailableAtSample),
      [forbiddenKey]: "forbidden"
    });
    assert.equal(result.status, "INVALID_CAUSAL_PAYLOAD");
    assert.match(result.errors.join("; "), /chaves ausentes ou proibidas/iu);
    assert.equal(result.classifierCalls, 0);
    assert.equal(result.proposal, null);
  }
  const nestedAvailability = shadow.evaluate({
    ...payloadFor(example),
    availability: { ...availableAt }
  });
  assert.equal(nestedAvailability.status, "INVALID_CAUSAL_PAYLOAD");
  assert.match(
    nestedAvailability.errors.join("; "),
    /chaves ausentes ou proibidas/iu
  );

  const malformed = shadow.evaluate(null);
  assert.equal(malformed.status, "INVALID_CAUSAL_PAYLOAD");
  assert.equal(malformed.currentSample, null);
  assert.equal(malformed.classifierCalls, 0);
  assert.equal(malformed.proposal, null);
  assert.equal(nestedAvailability.classifierCalls, 0);
  assert.equal(nestedAvailability.proposal, null);

  const beforeTarget = payloadFor(
    example,
    availableAt.targetAvailableAtSample - 1
  );
  assert.equal(beforeTarget.targetText, null);
  const futureSmuggling = shadow.evaluate({
    ...beforeTarget,
    targetText: example.modelInput.targetText
  });
  assert.equal(futureSmuggling.status, "INVALID_CAUSAL_PAYLOAD");
  assert.match(futureSmuggling.errors.join("; "), /target: texto futuro/iu);
  assert.equal(futureSmuggling.classifierCalls, 0);
  assert.equal(futureSmuggling.proposal, null);

  const readyPayload = payloadFor(
    example,
    availableAt.targetAvailableAtSample
  );
  for (const [field, missingValue] of [
    ["recentInbound", []],
    ["assistantAudiblePrefixAtDecision", null],
    ["targetText", null]
  ]) {
    const result = shadow.evaluate({ ...readyPayload, [field]: missingValue });
    assert.equal(result.status, "DEFER_CAUSAL_EVIDENCE");
    assert.deepEqual(result.missingEvidence, [field]);
    assert.equal(result.classifierCalls, 0);
    assert.equal(result.proposal, null);
  }
  assert.equal(calls, 0);
  assert.equal(shadow.snapshot.deferCount, 27);
  assert.equal(shadow.snapshot.invalidCount, 9);
  assert.equal(shadow.snapshot.inferenceCount, 0);
  assert.equal(shadow.snapshot.proposalCount, 0);
});

test("oito cenas preservam features, probabilidades e assinatura textual", async () => {
  const data = await fixture();
  const shadow = new ContextRelevanceShadow(data.web);
  const correct = { B0: 0, B1: 0 };
  const classCorrect = {
    B0: Object.fromEntries(CONTEXT_RELEVANCE_CLASSES.map((label) => [label, 0])),
    B1: Object.fromEntries(CONTEXT_RELEVANCE_CLASSES.map((label) => [label, 0]))
  };
  const pairScores = new Map();
  const knownErrors = [];

  assert.equal(data.examples.length, 8);
  for (const example of data.examples) {
    const payload = payloadFor(example);
    assert.deepEqual(
      Object.keys(payload).sort(),
      [...CONTEXT_RELEVANCE_PAYLOAD_KEYS].sort()
    );
    const result = shadow.evaluate(payload);
    assert.equal(result.status, "SHADOW_PROPOSAL");
    assert.equal(result.classifierCalls, 2);
    assert.equal(result.effects.length, 0);
    assert.equal(result.authority.canProduceEffects, false);

    const scores = pairScores.get(example.pairRootId) ?? { B0: 0, B1: 0 };
    for (const [name, contextEnabled] of [["B0", false], ["B1", true]]) {
      const expectedFeatures = extractExp0018ContextFeatures(
        projectExp0018ModelInput(example.modelInput, { contextEnabled }),
        { contextEnabled }
      );
      const expectedRaw = predictSoftmaxClassifier(
        data.source.arms[name].model,
        expectedFeatures.values
      );
      const expectedBackground =
        expectedRaw.probabilities.BACKGROUND_OR_NOT_DIRECTED;
      const expectedPredicted = expectedBackground >=
        data.source.arms[name].threshold
        ? "BACKGROUND_OR_NOT_DIRECTED"
        : "DIRECTED_TO_ASSISTANT";
      const arm = result.proposal.arms[name];
      assert.deepEqual(arm.features, expectedFeatures);
      assert.deepEqual(arm.probabilities, expectedRaw.probabilities);
      assert.equal(arm.backgroundProbability, expectedBackground);
      assert.equal(arm.rawPredicted, expectedRaw.label);
      assert.equal(arm.predicted, expectedPredicted);

      const frozenTrace = data.report.predictions[name].find(
        (item) => item.exampleId === example.exampleId
      );
      assert.deepEqual(arm.features.values, frozenTrace.featureValues);
      assert.equal(
        arm.backgroundProbability,
        frozenTrace.backgroundProbability
      );
      assert.equal(arm.rawPredicted, frozenTrace.rawPredicted);
      assert.equal(arm.predicted, frozenTrace.predicted);

      if (arm.predicted === example.label) {
        correct[name] += 1;
        classCorrect[name][example.label] += 1;
        scores[name] += 1;
      } else if (name === "B1") {
        knownErrors.push({
          pairRootId: example.pairRootId,
          expected: example.label,
          predicted: arm.predicted
        });
      }
    }
    pairScores.set(example.pairRootId, scores);
  }

  assert.deepEqual(correct, { B0: 4, B1: 7 });
  assert.deepEqual(classCorrect.B1, {
    BACKGROUND_OR_NOT_DIRECTED: 3,
    DIRECTED_TO_ASSISTANT: 4
  });
  const pairOutcomes = [...pairScores.values()].map((score) =>
    score.B1 > score.B0 ? "WIN" : score.B1 < score.B0 ? "LOSS" : "TIE"
  );
  assert.equal(pairOutcomes.filter((value) => value === "WIN").length, 3);
  assert.equal(pairOutcomes.filter((value) => value === "LOSS").length, 0);
  assert.equal(pairOutcomes.filter((value) => value === "TIE").length, 1);
  assert.deepEqual(knownErrors, [{
    pairRootId:
      "development-correction-version-label-target-development-green-label",
    expected: "BACKGROUND_OR_NOT_DIRECTED",
    predicted: "DIRECTED_TO_ASSISTANT"
  }]);
  assert.equal(shadow.snapshot.proposalCount, 8);
  assert.equal(shadow.snapshot.inferenceCount, 16);
  assert.equal(shadow.snapshot.effectsDispatched, 0);
  assert.equal(shadow.snapshot.authority.canProduceEffects, false);
});
