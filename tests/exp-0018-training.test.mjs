import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXP0018_CATALOG_VERSION,
  EXP0018_FAMILIES,
  buildExp0018Datasets
} from "../src/eval/exp-0018-context.mjs";
import {
  createExp0018Checkpoint,
  createExp0018DevelopmentInvalidation,
  createExp0018DevelopmentReport,
  createExp0018FitCandidate,
  evaluateExp0018DevelopmentGates,
  predictExp0018Checkpoint,
  selectExp0018Threshold,
  validateExp0018Checkpoint,
  validateExp0018CheckpointAgainstCalibration,
  validateExp0018DevelopmentReport,
  validateExp0018DevelopmentInvalidation,
  validateExp0018FitCandidate
} from "../src/eval/exp-0018-training.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import { EXP0018_STAGE_CONTRACTS } from
  "../src/eval/exp-0018-boundary.mjs";

const CONFIG_URL = new URL(
  "../eval/experiments/exp-0018-context-observability-v0.1.json",
  import.meta.url
);
const SHA = `sha256:${"a".repeat(64)}`;
const COMMIT = "d".repeat(40);

function filesystemBoundary(stage) {
  const contract = EXP0018_STAGE_CONTRACTS[stage];
  return {
    permissionModelEnabled: true,
    environmentSanitized: true,
    nodeVersion: process.version,
    preflightCommit: COMMIT,
    allowedDataReads: [...contract.dataReads],
    deniedDataReads: [...contract.prohibitedDataReads],
    allowedWrites: [...contract.writes],
    denialProbesPassed: true
  };
}

function tokenFor(kind, index) {
  return createHash("sha256")
    .update(`synthetic-unit-test-${kind}-${index}`)
    .digest("hex");
}

function syntheticCatalog(options = {}) {
  const roles = [
    ...Array(12).fill("fit"),
    ...Array(4).fill("calibration"),
    ...Array(8).fill("development")
  ];
  const roleIndex = { fit: 0, calibration: 0, development: 0 };
  const blocks = roles.map((role, globalIndex) => {
    const index = roleIndex[role]++;
    const family = EXP0018_FAMILIES[
      index % EXP0018_FAMILIES.length
    ];
    const a = tokenFor("a", globalIndex);
    const b = tokenFor("b", globalIndex);
    const root = `${role}-unit-${globalIndex}`;
    const targetA = `target-${root}-a`;
    const targetB = `target-${root}-b`;
    return {
      crossBlockRootId: `block-${root}`,
      semanticLineageId: `lineage-${root}`,
      role,
      family,
      targets: {
        a: { targetId: targetA, text: `resposta ${a}` },
        b: { targetId: targetB, text: `resposta ${b}` }
      },
      contexts: {
        a: {
          contextId: `context-${root}-a`,
          assistantAudiblePrefixAtDecision:
            `A escolha é resposta ${a}?`,
          recentInbound: [`A escolha é resposta ${b}?`]
        },
        b: {
          contextId: `context-${root}-b`,
          assistantAudiblePrefixAtDecision:
            `A escolha é resposta ${b}?`,
          recentInbound: [`A escolha é resposta ${a}?`]
        }
      },
      oracle: role === "development" && options.reverseDevelopment === true
        ? {
          a: {
            assistantExpectedTargetId: targetB,
            recentInboundExpectedTargetId: targetA
          },
          b: {
            assistantExpectedTargetId: targetA,
            recentInboundExpectedTargetId: targetB
          }
        }
        : {
        a: {
          assistantExpectedTargetId: targetA,
          recentInboundExpectedTargetId: targetB
        },
        b: {
          assistantExpectedTargetId: targetB,
          recentInboundExpectedTargetId: targetA
        }
        }
    };
  });
  return {
    schemaVersion: EXP0018_CATALOG_VERSION,
    experimentId: "EXP-0018",
    locale: "pt-BR",
    provenance: {
      generationMethod: "coding-agent-authored-controlled-crossed-blocks",
      authoringAssistance:
        "interactive-coding-agent-with-human-project-direction",
      aiCriticsUsed: 2,
      externalProjectApiCallsDuringMaterialization: 0,
      paidApiCallsDuringMaterialization: 0
    },
    blocks
  };
}

async function fixture(options = {}) {
  const configBytes = await readFile(CONFIG_URL);
  const config = JSON.parse(configBytes.toString("utf8"));
  const configFileSha256 = `sha256:${createHash("sha256")
    .update(configBytes).digest("hex")}`;
  const built = buildExp0018Datasets(syntheticCatalog(options), {
    experimentConfigFileSha256: configFileSha256
  });
  return { config, configFileSha256, ...built.datasets };
}

test("seleção de limiar respeita recall dirigido e desempate preregistrados", () => {
  const observations = [
    { exampleId: "d0", expected: "DIRECTED_TO_ASSISTANT",
      backgroundProbability: 0.4 },
    { exampleId: "d1", expected: "DIRECTED_TO_ASSISTANT",
      backgroundProbability: 0.6 },
    { exampleId: "b0", expected: "BACKGROUND_OR_NOT_DIRECTED",
      backgroundProbability: 0.7 },
    { exampleId: "b1", expected: "BACKGROUND_OR_NOT_DIRECTED",
      backgroundProbability: 0.8 }
  ];
  const selected = selectExp0018Threshold(observations);
  assert.equal(selected.safeSolution, true);
  assert.equal(selected.selected.threshold, 0.7);
  assert.equal(selected.selected.directedRecall, 1);
  assert.equal(selected.selected.backgroundRecall, 1);
  assert.deepEqual(
    selected.candidates.map((item) => item.threshold),
    [0.6, 0.7, 0.8, 1]
  );
});

test("gates aceitam os limites exatos e falham imediatamente abaixo", async () => {
  const config = JSON.parse(await readFile(CONFIG_URL, "utf8"));
  const controls = Object.fromEntries([
    "targetOnly",
    "contextOnlyC0",
    "pairRootMetadataOnly",
    "crossBlockMetadataOnly",
    "familyMetadataOnly"
  ].map((name) => [name, {
    ceiling: 0.5,
    oppositeLabelsEverywhere: true
  }]));
  const base = {
    config,
    datasetValid: true,
    b0Identity: true,
    structuralControls: controls,
    summaries: { B1: { classRecall: {
      DIRECTED_TO_ASSISTANT: 1,
      BACKGROUND_OR_NOT_DIRECTED: 0.75
    } } },
    paired: { B1CompletePairShare: 0.75, netWins: 4 },
    crossBlocks: { positiveBlocks: 6, familiesWithPositiveBlock: 4 },
    checkpoint: {
      latency: { deltaB1MinusB0: { p95Ms: 50 } },
      reproducibility: {
        repeatedFitsEqual: true,
        repeatedCalibrationPredictionsEqual: true,
        repeatedCalibrationSelectionsEqual: true
      },
      authority: { canProduceEffects: false }
    }
  };
  assert.equal(
    Object.values(evaluateExp0018DevelopmentGates(base)).every(Boolean),
    true
  );
  const mutations = [
    (item) => { item.summaries.B1.classRecall.BACKGROUND_OR_NOT_DIRECTED = 0.749; },
    (item) => { item.paired.B1CompletePairShare = 0.749; },
    (item) => { item.paired.netWins = 3; },
    (item) => { item.crossBlocks.positiveBlocks = 5; },
    (item) => { item.crossBlocks.familiesWithPositiveBlock = 3; },
    (item) => { item.checkpoint.latency.deltaB1MinusB0.p95Ms = 50.001; },
    (item) => { item.structuralControls.contextOnlyC0.ceiling = 0.51; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(base);
    mutate(candidate);
    assert.equal(
      Object.values(evaluateExp0018DevelopmentGates(candidate)).every(Boolean),
      false
    );
  }
});

test("attempt abortado fecha sem claim, gates ou retry", async () => {
  const config = JSON.parse(await readFile(CONFIG_URL, "utf8"));
  const input = {
    config,
    prefitFreezeSha256: SHA,
    developmentActivationFileSha256: SHA,
    developmentActivationSha256: SHA,
    developmentOpeningFileSha256: SHA,
    developmentOpeningSha256: SHA,
    developmentAttemptFileSha256: SHA,
    developmentAttemptSha256: SHA,
    checkpointSha256: SHA,
    configFileSha256: SHA,
    developmentDatasetFileSha256: SHA,
    developmentDatasetCanonicalSha256: SHA,
    invalidationExecutionCommit: COMMIT,
    filesystemBoundary: filesystemBoundary("invalidation")
  };
  const invalidation = createExp0018DevelopmentInvalidation(input);
  assert.equal(
    validateExp0018DevelopmentInvalidation(invalidation, input).valid,
    true
  );
  assert.equal(invalidation.claim, null);
  assert.equal(invalidation.gates, null);
  assert.equal(invalidation.protocol.retryAuthorized, false);
  const tampered = structuredClone(invalidation);
  tampered.protocol.retryAuthorized = true;
  delete tampered.developmentInvalidationSha256;
  tampered.developmentInvalidationSha256 =
    `sha256:${canonicalSha256(tampered)}`;
  assert.equal(validateExp0018DevelopmentInvalidation(tampered).valid, false);
});

test("fit/calibração determinísticos funcionam só sobre dados sintéticos de teste", async () => {
  const data = await fixture();
  const candidate = createExp0018FitCandidate({
    config: data.config,
    fitDataset: data.fit,
    prefitFreezeSha256: SHA,
    configFileSha256: data.configFileSha256,
    fitDatasetFileSha256: SHA,
    fitExecutionCommit: COMMIT
  });
  assert.equal(validateExp0018FitCandidate(candidate).valid, true);
  assert.equal(candidate.arms.B0.repeatedFitEqual, true);
  assert.equal(candidate.arms.B1.repeatedFitEqual, true);

  let clock = 0;
  const checkpoint = createExp0018Checkpoint({
    config: data.config,
    fitCandidate: candidate,
    calibrationDataset: data.calibration,
    prefitFreezeSha256: SHA,
    fitAttestationSha256: SHA,
    configFileSha256: data.configFileSha256,
    calibrationDatasetFileSha256: SHA,
    calibrationExecutionCommit: COMMIT,
    filesystemBoundary: filesystemBoundary("calibration"),
    now: () => {
      clock += 0.01;
      return clock;
    }
  });
  assert.equal(validateExp0018Checkpoint(checkpoint).valid, true);
  assert.equal(validateExp0018CheckpointAgainstCalibration(checkpoint, {
    config: data.config,
    calibrationDataset: data.calibration
  }).valid, true);
  assert.equal(checkpoint.arms.B0.threshold, 1);
  assert.equal(checkpoint.arms.B1.calibration.selected.directedRecall, 1);
  assert.equal(
    checkpoint.reproducibility.repeatedCalibrationSelectionsEqual,
    true
  );

  const forgedThreshold = structuredClone(checkpoint);
  const forgedCandidates = forgedThreshold.arms.B1.calibration.candidates;
  for (const item of forgedCandidates) {
    item.directedRecall = 1;
    item.backgroundRecall = 1;
    item.accuracy = 1;
  }
  const forgedSelected = forgedCandidates.at(-1);
  forgedThreshold.arms.B1.calibration.safeCandidates =
    forgedCandidates.length;
  forgedThreshold.arms.B1.calibration.selected = {
    threshold: forgedSelected.threshold,
    directedRecall: 1,
    backgroundRecall: 1,
    accuracy: 1
  };
  forgedThreshold.arms.B1.threshold = forgedSelected.threshold;
  delete forgedThreshold.checkpointSha256;
  forgedThreshold.checkpointSha256 =
    `sha256:${canonicalSha256(forgedThreshold)}`;
  assert.equal(validateExp0018Checkpoint(forgedThreshold).valid, true,
    "forge coerente permanece estruturalmente plausível");
  assert.equal(validateExp0018CheckpointAgainstCalibration(
    forgedThreshold,
    { config: data.config, calibrationDataset: data.calibration }
  ).valid, false,
  "limiar precisa ser derivado novamente da calibração congelada");

  const forgedLatency = structuredClone(checkpoint);
  forgedLatency.latency.B0.minimumMs = 0;
  forgedLatency.latency.B0.p95Ms = 0;
  forgedLatency.latency.B0.maximumMs = 0;
  forgedLatency.latency.B1.minimumMs = 0;
  forgedLatency.latency.B1.p95Ms = 0;
  forgedLatency.latency.B1.maximumMs = 0;
  forgedLatency.latency.deltaB1MinusB0.minimumMs = 0;
  forgedLatency.latency.deltaB1MinusB0.p95Ms = 0;
  forgedLatency.latency.deltaB1MinusB0.maximumMs = 0;
  delete forgedLatency.checkpointSha256;
  forgedLatency.checkpointSha256 =
    `sha256:${canonicalSha256(forgedLatency)}`;
  assert.equal(validateExp0018Checkpoint(forgedLatency).valid, false,
    "sumário de latência precisa recomputar do trace bruto");

  let predictionCalls = 0;
  const report = createExp0018DevelopmentReport({
    config: data.config,
    checkpoint,
    developmentDataset: data.development,
    prefitFreezeSha256: SHA,
    developmentActivationFileSha256: SHA,
    developmentActivationSha256: SHA,
    developmentOpeningFileSha256: SHA,
    developmentOpeningSha256: SHA,
    developmentAttemptFileSha256: SHA,
    developmentAttemptSha256: SHA,
    configFileSha256: data.configFileSha256,
    developmentDatasetFileSha256: SHA,
    developmentExecutionCommit: COMMIT,
    filesystemBoundary: filesystemBoundary("development"),
    predict: (...args) => {
      predictionCalls += 1;
      return predictExp0018Checkpoint(...args);
    }
  });
  const expectedReportInput = {
    config: data.config,
    checkpoint,
    developmentDataset: data.development,
    prefitFreezeSha256: SHA,
    developmentActivationFileSha256: SHA,
    developmentActivationSha256: SHA,
    developmentOpeningFileSha256: SHA,
    developmentOpeningSha256: SHA,
    developmentAttemptFileSha256: SHA,
    developmentAttemptSha256: SHA,
    configFileSha256: data.configFileSha256,
    developmentDatasetFileSha256: SHA,
    developmentExecutionCommit: COMMIT,
    filesystemBoundary: filesystemBoundary("development")
  };
  assert.equal(
    validateExp0018DevelopmentReport(report, expectedReportInput).valid,
    true
  );
  assert.equal(predictionCalls, 64);
  assert.equal(report.protocol.predictionRuns, 1);
  assert.equal(report.summaries.B0.accuracy, 0.5);
  assert.ok(report.summaries.B1.accuracy > report.summaries.B0.accuracy);
  assert.equal(report.allGatesPassed, true);
  assert.equal(predictionCalls, 64,
    "validação do trace não pode executar outra predição");

  const tampered = structuredClone(report);
  tampered.gates.familyBreadth = false;
  assert.equal(validateExp0018DevelopmentReport(tampered).valid, false);
  const coherentlyTampered = structuredClone(report);
  coherentlyTampered.summaries.B1.correct -= 1;
  delete coherentlyTampered.developmentReportSha256;
  coherentlyTampered.developmentReportSha256 =
    `sha256:${canonicalSha256(coherentlyTampered)}`;
  assert.equal(
    validateExp0018DevelopmentReport(
      coherentlyTampered,
      expectedReportInput
    ).valid,
    false
  );
  const forgedProbability = structuredClone(report);
  forgedProbability.predictions.B1[0].backgroundProbability += 1e-6;
  delete forgedProbability.developmentReportSha256;
  forgedProbability.developmentReportSha256 =
    `sha256:${canonicalSha256(forgedProbability)}`;
  assert.equal(
    validateExp0018DevelopmentReport(
      forgedProbability,
      expectedReportInput
    ).valid,
    false,
    "trace precisa provar a probabilidade diretamente contra pesos e features"
  );
});

test("falha causal sintética produz CUT e nunca publica claim", async () => {
  const normal = await fixture();
  const reversed = await fixture({ reverseDevelopment: true });
  const candidate = createExp0018FitCandidate({
    config: normal.config,
    fitDataset: normal.fit,
    prefitFreezeSha256: SHA,
    configFileSha256: normal.configFileSha256,
    fitDatasetFileSha256: SHA,
    fitExecutionCommit: COMMIT
  });
  let clock = 0;
  const checkpoint = createExp0018Checkpoint({
    config: normal.config,
    fitCandidate: candidate,
    calibrationDataset: normal.calibration,
    prefitFreezeSha256: SHA,
    fitAttestationSha256: SHA,
    configFileSha256: normal.configFileSha256,
    calibrationDatasetFileSha256: SHA,
    calibrationExecutionCommit: COMMIT,
    filesystemBoundary: filesystemBoundary("calibration"),
    now: () => {
      clock += 0.01;
      return clock;
    }
  });
  const report = createExp0018DevelopmentReport({
    config: normal.config,
    checkpoint,
    developmentDataset: reversed.development,
    prefitFreezeSha256: SHA,
    developmentActivationFileSha256: SHA,
    developmentActivationSha256: SHA,
    developmentOpeningFileSha256: SHA,
    developmentOpeningSha256: SHA,
    developmentAttemptFileSha256: SHA,
    developmentAttemptSha256: SHA,
    configFileSha256: normal.configFileSha256,
    developmentDatasetFileSha256: SHA,
    developmentExecutionCommit: COMMIT,
    filesystemBoundary: filesystemBoundary("development")
  });
  assert.equal(report.allGatesPassed, false);
  assert.equal(report.status, "cut-textual-mechanism-screen");
  assert.equal(report.decision, "CUT_CONTEXT_MATCHER_IN_THIS_DESIGN");
  assert.equal(report.claim, null);
});
