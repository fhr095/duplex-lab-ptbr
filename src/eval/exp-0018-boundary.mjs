import { isDeepStrictEqual } from "node:util";

import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0018_PREFIT_FREEZE_VERSION =
  "exp-0018-prefit-freeze-v1";
export const EXP0018_TRAIN_ATTESTATION_VERSION =
  "exp-0018-train-attestation-v1";
export const EXP0018_DEVELOPMENT_ACTIVATION_VERSION =
  "exp-0018-development-activation-v1";
export const EXP0018_DEVELOPMENT_OPENING_VERSION =
  "exp-0018-development-opening-v1";
export const EXP0018_DEVELOPMENT_ATTEMPT_VERSION =
  "exp-0018-development-attempt-v1";

export const EXP0018_PATHS = Object.freeze({
  config: "eval/experiments/exp-0018-context-observability-v0.1.json",
  catalog: "eval/experiments/exp-0018-context-pairs.pt-BR.v0.1.json",
  fitDataset: "eval/datasets/exp-0018-context-fit-v0.1.json",
  calibrationDataset:
    "eval/datasets/exp-0018-context-calibration-v0.1.json",
  developmentDataset:
    "eval/datasets/exp-0018-context-development-v0.1.json",
  instrumentationAudit:
    "eval/commitments/exp-0018-instrumentation-audit-v0.1.json",
  blindSemanticReview:
    "eval/commitments/exp-0018-blind-semantic-review-v0.1.json",
  prefitFreeze:
    "eval/commitments/exp-0018-prefit-freeze-v0.1.json",
  fitCandidate:
    "eval/checkpoints/exp-0018-fit-candidate-v0.1.json",
  trainAttestation:
    "eval/commitments/exp-0018-train-attestation-v0.1.json",
  checkpoint: "eval/checkpoints/exp-0018-context-v0.1.json",
  developmentActivation:
    "eval/commitments/exp-0018-development-activation-v0.1.json",
  developmentOpening:
    "eval/commitments/exp-0018-development-opening-v0.1.json",
  developmentAttempt:
    "eval/commitments/exp-0018-development-attempt-v0.1.json",
  developmentReport:
    "eval/reports/exp-0018-context-development-v0.1.json"
});

export const EXP0018_CRITICAL_SOURCE_PATHS = Object.freeze([
  "docs/experiments/EXP-0018-context-observability-screen.md",
  "package.json",
  "scripts/activate-exp-0018-development.mjs",
  "scripts/calibrate-exp-0018-context.mjs",
  "scripts/consume-exp-0018-development-opening.mjs",
  "scripts/eval-exp-0018-context-development.mjs",
  "scripts/fit-exp-0018-context.mjs",
  "scripts/freeze-exp-0018-prefit.mjs",
  "scripts/invalidate-exp-0018-development.mjs",
  "scripts/lib/exp-0018-io.mjs",
  "scripts/run-exp-0018-sealed-stage.mjs",
  "src/eval/exp-0018-boundary.mjs",
  "src/eval/exp-0018-context.mjs",
  "src/eval/exp-0018-training.mjs",
  "src/eval/experiment-index.mjs",
  "src/eval/factory/canonical-hash.mjs",
  "src/learning/softmax-classifier.mjs",
  "tests/exp-0018-boundary.test.mjs",
  "tests/exp-0018-training.test.mjs",
  "tests/experiment-index.test.mjs"
]);

export const EXP0018_STAGE_CONTRACTS = Object.freeze({
  fit: Object.freeze({
    dataReads: Object.freeze([
      EXP0018_PATHS.config,
      EXP0018_PATHS.fitDataset,
      EXP0018_PATHS.prefitFreeze
    ]),
    prohibitedDataReads: Object.freeze([
      EXP0018_PATHS.catalog,
      EXP0018_PATHS.calibrationDataset,
      EXP0018_PATHS.developmentDataset
    ]),
    writes: Object.freeze([
      EXP0018_PATHS.fitCandidate,
      EXP0018_PATHS.trainAttestation
    ])
  }),
  calibration: Object.freeze({
    dataReads: Object.freeze([
      EXP0018_PATHS.config,
      EXP0018_PATHS.calibrationDataset,
      EXP0018_PATHS.prefitFreeze,
      EXP0018_PATHS.fitCandidate,
      EXP0018_PATHS.trainAttestation
    ]),
    prohibitedDataReads: Object.freeze([
      EXP0018_PATHS.catalog,
      EXP0018_PATHS.fitDataset,
      EXP0018_PATHS.developmentDataset
    ]),
    writes: Object.freeze([EXP0018_PATHS.checkpoint])
  }),
  activation: Object.freeze({
    dataReads: Object.freeze([
      EXP0018_PATHS.config,
      EXP0018_PATHS.calibrationDataset,
      EXP0018_PATHS.prefitFreeze,
      EXP0018_PATHS.trainAttestation,
      EXP0018_PATHS.checkpoint
    ]),
    prohibitedDataReads: Object.freeze([
      EXP0018_PATHS.catalog,
      EXP0018_PATHS.fitDataset,
      EXP0018_PATHS.developmentDataset,
      EXP0018_PATHS.fitCandidate
    ]),
    writes: Object.freeze([EXP0018_PATHS.developmentActivation])
  }),
  opening: Object.freeze({
    dataReads: Object.freeze([
      EXP0018_PATHS.config,
      EXP0018_PATHS.prefitFreeze,
      EXP0018_PATHS.trainAttestation,
      EXP0018_PATHS.checkpoint,
      EXP0018_PATHS.developmentActivation
    ]),
    prohibitedDataReads: Object.freeze([
      EXP0018_PATHS.catalog,
      EXP0018_PATHS.fitDataset,
      EXP0018_PATHS.calibrationDataset,
      EXP0018_PATHS.developmentDataset,
      EXP0018_PATHS.fitCandidate
    ]),
    writes: Object.freeze([EXP0018_PATHS.developmentOpening])
  }),
  invalidation: Object.freeze({
    dataReads: Object.freeze([
      EXP0018_PATHS.config,
      EXP0018_PATHS.prefitFreeze,
      EXP0018_PATHS.trainAttestation,
      EXP0018_PATHS.checkpoint,
      EXP0018_PATHS.developmentActivation,
      EXP0018_PATHS.developmentOpening,
      EXP0018_PATHS.developmentAttempt
    ]),
    prohibitedDataReads: Object.freeze([
      EXP0018_PATHS.catalog,
      EXP0018_PATHS.fitDataset,
      EXP0018_PATHS.calibrationDataset,
      EXP0018_PATHS.developmentDataset,
      EXP0018_PATHS.fitCandidate
    ]),
    writes: Object.freeze([EXP0018_PATHS.developmentReport])
  }),
  development: Object.freeze({
    dataReads: Object.freeze([
      EXP0018_PATHS.config,
      EXP0018_PATHS.developmentDataset,
      EXP0018_PATHS.prefitFreeze,
      EXP0018_PATHS.trainAttestation,
      EXP0018_PATHS.checkpoint,
      EXP0018_PATHS.developmentActivation,
      EXP0018_PATHS.developmentOpening,
      EXP0018_PATHS.developmentAttempt
    ]),
    prohibitedDataReads: Object.freeze([
      EXP0018_PATHS.catalog,
      EXP0018_PATHS.fitDataset,
      EXP0018_PATHS.calibrationDataset,
      EXP0018_PATHS.fitCandidate
    ]),
    writes: Object.freeze([EXP0018_PATHS.developmentReport])
  })
});

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function same(left, right) {
  return isDeepStrictEqual(left, right);
}

function validSha256(value) {
  return SHA256_PATTERN.test(value ?? "");
}

function validCommit(value) {
  return COMMIT_PATTERN.test(value ?? "");
}

function validStageBoundary(boundary, stageName, executionCommit) {
  const contract = EXP0018_STAGE_CONTRACTS[stageName];
  return boundary?.permissionModelEnabled === true &&
    boundary?.environmentSanitized === true &&
    boundary?.denialProbesPassed === true &&
    boundary?.preflightCommit === executionCommit &&
    typeof boundary?.nodeVersion === "string" &&
    same(boundary?.allowedDataReads, contract.dataReads) &&
    same(boundary?.deniedDataReads, contract.prohibitedDataReads) &&
    same(boundary?.allowedWrites, contract.writes);
}

function withoutHash(value, hashKey) {
  const core = structuredClone(value ?? {});
  delete core[hashKey];
  return core;
}

function finalize(core, hashKey) {
  return deepFreeze({
    ...core,
    [hashKey]: `sha256:${canonicalSha256(core)}`
  });
}

function validSelfHash(value, hashKey) {
  return value?.[hashKey] === `sha256:${canonicalSha256(
    withoutHash(value, hashKey)
  )}`;
}

function validateArtifact(record, expectedPath, canonicalRequired = true) {
  return record?.path === expectedPath &&
    validSha256(record?.fileSha256) &&
    (!canonicalRequired || validSha256(record?.canonicalSha256));
}

export function createExp0018PrefitFreeze(input = {}) {
  const core = {
    schemaVersion: EXP0018_PREFIT_FREEZE_VERSION,
    experimentId: "EXP-0018",
    status: "fit-authorized-development-sealed",
    runnerSourceCommit: input.runnerSourceCommit,
    nodeVersion: input.nodeVersion,
    artifacts: structuredClone(input.artifacts),
    criticalSources: structuredClone(input.criticalSources),
    stageContracts: structuredClone(EXP0018_STAGE_CONTRACTS),
    boundary: {
      instrumentationPassed: true,
      blindSemanticReviewPassed: true,
      modelFitPerformed: false,
      calibrationPerformed: false,
      developmentCandidateMetricsRead: false,
      fitAuthorized: true,
      developmentAuthorized: false,
      canProduceEffects: false
    },
    budget: {
      externalModelCalls: 0,
      paidApiCalls: 0,
      paidGpuRuns: 0,
      asrRuns: 0,
      audioMaterializations: 0
    },
    authority: { mode: "offline-shadow-only", canProduceEffects: false }
  };
  return finalize(core, "prefitFreezeSha256");
}

export function validateExp0018PrefitFreeze(freeze) {
  const errors = [];
  if (
    freeze?.schemaVersion !== EXP0018_PREFIT_FREEZE_VERSION ||
    freeze?.experimentId !== "EXP-0018" ||
    freeze?.status !== "fit-authorized-development-sealed" ||
    !validCommit(freeze?.runnerSourceCommit) ||
    typeof freeze?.nodeVersion !== "string" ||
    !validSelfHash(freeze, "prefitFreezeSha256")
  ) {
    errors.push("identidade ou hash do freeze incompatível");
  }
  const artifacts = freeze?.artifacts ?? {};
  const artifactContract = [
    ["config", EXP0018_PATHS.config],
    ["catalog", EXP0018_PATHS.catalog],
    ["fitDataset", EXP0018_PATHS.fitDataset],
    ["calibrationDataset", EXP0018_PATHS.calibrationDataset],
    ["developmentDataset", EXP0018_PATHS.developmentDataset],
    ["instrumentationAudit", EXP0018_PATHS.instrumentationAudit],
    ["blindSemanticReview", EXP0018_PATHS.blindSemanticReview]
  ];
  if (artifactContract.some(([name, path]) =>
    !validateArtifact(artifacts[name], path)
  )) {
    errors.push("artefatos congelados incompatíveis");
  }
  if (!validSha256(artifacts?.fitDataset?.readSetSha256)) {
    errors.push("digest do readSet de fit não foi congelado");
  }
  const sources = Array.isArray(freeze?.criticalSources)
    ? freeze.criticalSources
    : [];
  if (
    !same(sources.map((item) => item.path), EXP0018_CRITICAL_SOURCE_PATHS) ||
    sources.some((item) => !validSha256(item?.fileSha256))
  ) {
    errors.push("fontes críticas congeladas incompatíveis");
  }
  if (!same(freeze?.stageContracts, EXP0018_STAGE_CONTRACTS)) {
    errors.push("contratos físicos de estágio incompatíveis");
  }
  if (
    freeze?.boundary?.instrumentationPassed !== true ||
    freeze?.boundary?.blindSemanticReviewPassed !== true ||
    freeze?.boundary?.modelFitPerformed !== false ||
    freeze?.boundary?.calibrationPerformed !== false ||
    freeze?.boundary?.developmentCandidateMetricsRead !== false ||
    freeze?.boundary?.fitAuthorized !== true ||
    freeze?.boundary?.developmentAuthorized !== false ||
    freeze?.boundary?.canProduceEffects !== false ||
    freeze?.authority?.canProduceEffects !== false
  ) {
    errors.push("fronteira ou autoridade do freeze incompatível");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function createExp0018TrainAttestation(input = {}) {
  const readSetCore = {
    orderedExampleIds: input.fitDataset.examples.map(
      (item) => item.exampleId
    ),
    orderedExampleCanonicalSha256: input.fitDataset.examples.map(
      (item) => `sha256:${canonicalSha256(item)}`
    )
  };
  const core = {
    schemaVersion: EXP0018_TRAIN_ATTESTATION_VERSION,
    experimentId: "EXP-0018",
    status: "fit-complete-calibration-unread-development-sealed",
    bindings: {
      prefitFreezeSha256: input.prefitFreezeSha256,
      fitCandidateSha256: input.fitCandidate.fitCandidateSha256,
      configFileSha256: input.configFileSha256,
      configCanonicalSha256: input.configCanonicalSha256,
      fitDatasetFileSha256: input.fitDatasetFileSha256,
      fitDatasetCanonicalSha256: input.fitDataset.datasetSha256,
      runnerSourceCommit: input.runnerSourceCommit,
      fitExecutionCommit: input.fitExecutionCommit
    },
    readSet: {
      role: "fit",
      examples: input.fitDataset.examples.length,
      ...readSetCore,
      readSetSha256: `sha256:${canonicalSha256(readSetCore)}`
    },
    outputs: {
      fitCandidateSha256: input.fitCandidate.fitCandidateSha256,
      modelSha256: {
        B0: input.fitCandidate.arms.B0.modelSha256,
        B1: input.fitCandidate.arms.B1.modelSha256
      }
    },
    filesystemBoundary: structuredClone(input.filesystemBoundary),
    boundary: {
      fitRead: true,
      calibrationRead: false,
      developmentRead: false,
      thresholdSelected: false,
      canProduceEffects: false
    },
    authority: { mode: "offline-shadow-only", canProduceEffects: false }
  };
  return finalize(core, "trainAttestationSha256");
}

export function validateExp0018TrainAttestation(attestation) {
  const errors = [];
  if (
    attestation?.schemaVersion !== EXP0018_TRAIN_ATTESTATION_VERSION ||
    attestation?.experimentId !== "EXP-0018" ||
    attestation?.status !==
      "fit-complete-calibration-unread-development-sealed" ||
    !validSelfHash(attestation, "trainAttestationSha256")
  ) {
    errors.push("identidade ou hash da attestation incompatível");
  }
  const bindings = attestation?.bindings ?? {};
  if (
    !validSha256(bindings.prefitFreezeSha256) ||
    !validSha256(bindings.fitCandidateSha256) ||
    !validSha256(bindings.configFileSha256) ||
    !validSha256(bindings.configCanonicalSha256) ||
    !validSha256(bindings.fitDatasetFileSha256) ||
    !validSha256(bindings.fitDatasetCanonicalSha256) ||
    !validCommit(bindings.runnerSourceCommit) ||
    !validCommit(bindings.fitExecutionCommit)
  ) {
    errors.push("bindings da attestation incompatíveis");
  }
  if (
    attestation?.readSet?.role !== "fit" ||
    attestation?.readSet?.examples !== 48 ||
    !Array.isArray(attestation?.readSet?.orderedExampleIds) ||
    attestation.readSet.orderedExampleIds.length !== 48 ||
    new Set(attestation.readSet.orderedExampleIds).size !== 48 ||
    !Array.isArray(attestation?.readSet?.orderedExampleCanonicalSha256) ||
    attestation.readSet.orderedExampleCanonicalSha256.length !== 48 ||
    attestation.readSet.orderedExampleCanonicalSha256.some(
      (value) => !validSha256(value)
    ) ||
    attestation?.readSet?.readSetSha256 !== `sha256:${canonicalSha256({
      orderedExampleIds: attestation?.readSet?.orderedExampleIds,
      orderedExampleCanonicalSha256:
        attestation?.readSet?.orderedExampleCanonicalSha256
    })}`
  ) {
    errors.push("readSet integral da attestation incompatível");
  }
  const boundary = attestation?.filesystemBoundary ?? {};
  if (
    boundary.permissionModelEnabled !== true ||
    boundary.environmentSanitized !== true ||
    boundary.preflightCommit !== bindings.fitExecutionCommit ||
    typeof boundary.nodeVersion !== "string" ||
    !same(boundary.allowedDataReads, EXP0018_STAGE_CONTRACTS.fit.dataReads) ||
    !same(
      boundary.deniedDataReads,
      EXP0018_STAGE_CONTRACTS.fit.prohibitedDataReads
    ) ||
    !same(boundary.allowedWrites, EXP0018_STAGE_CONTRACTS.fit.writes) ||
    boundary.denialProbesPassed !== true ||
    attestation?.boundary?.fitRead !== true ||
    attestation?.boundary?.calibrationRead !== false ||
    attestation?.boundary?.developmentRead !== false ||
    attestation?.boundary?.thresholdSelected !== false ||
    attestation?.boundary?.canProduceEffects !== false ||
    attestation?.authority?.canProduceEffects !== false
  ) {
    errors.push("fronteira física ou autoridade da attestation incompatível");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function validateExp0018CheckpointChain(input = {}) {
  const errors = [];
  const { freeze, config, attestation, checkpoint } = input;
  if (
    attestation?.bindings?.prefitFreezeSha256 !==
      freeze?.prefitFreezeSha256 ||
    attestation?.bindings?.configFileSha256 !==
      freeze?.artifacts?.config?.fileSha256 ||
    attestation?.bindings?.configCanonicalSha256 !==
      freeze?.artifacts?.config?.canonicalSha256 ||
    attestation?.bindings?.fitDatasetFileSha256 !==
      freeze?.artifacts?.fitDataset?.fileSha256 ||
    attestation?.bindings?.fitDatasetCanonicalSha256 !==
      freeze?.artifacts?.fitDataset?.canonicalSha256 ||
    attestation?.bindings?.runnerSourceCommit !==
      freeze?.runnerSourceCommit ||
    attestation?.readSet?.readSetSha256 !==
      freeze?.artifacts?.fitDataset?.readSetSha256
  ) {
    errors.push("attestation diverge integralmente do freeze");
  }
  if (
    checkpoint?.bindings?.prefitFreezeSha256 !==
      freeze?.prefitFreezeSha256 ||
    checkpoint?.bindings?.fitCandidateSha256 !==
      attestation?.outputs?.fitCandidateSha256 ||
    checkpoint?.bindings?.fitAttestationSha256 !==
      attestation?.trainAttestationSha256 ||
    checkpoint?.bindings?.configFileSha256 !==
      freeze?.artifacts?.config?.fileSha256 ||
    checkpoint?.bindings?.configCanonicalSha256 !==
      freeze?.artifacts?.config?.canonicalSha256 ||
    checkpoint?.bindings?.fitDatasetCanonicalSha256 !==
      freeze?.artifacts?.fitDataset?.canonicalSha256 ||
    checkpoint?.bindings?.calibrationDatasetFileSha256 !==
      freeze?.artifacts?.calibrationDataset?.fileSha256 ||
    checkpoint?.bindings?.calibrationDatasetCanonicalSha256 !==
      freeze?.artifacts?.calibrationDataset?.canonicalSha256 ||
    checkpoint?.arms?.B0?.modelSha256 !==
      attestation?.outputs?.modelSha256?.B0 ||
    checkpoint?.arms?.B1?.modelSha256 !==
      attestation?.outputs?.modelSha256?.B1 ||
    checkpoint?.claims?.maximumClaim !== config?.maximumClaim
  ) {
    errors.push("checkpoint diverge da cadeia freeze→fit→calibração");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function createExp0018DevelopmentActivation(input = {}) {
  const core = {
    schemaVersion: EXP0018_DEVELOPMENT_ACTIVATION_VERSION,
    experimentId: "EXP-0018",
    status: "development-authorized-for-one-opening",
    checkpointSourceCommit: input.checkpointSourceCommit,
    bindings: {
      prefitFreezeFileSha256: input.prefitFreezeFileSha256,
      prefitFreezeSha256: input.prefitFreezeSha256,
      trainAttestationFileSha256: input.trainAttestationFileSha256,
      trainAttestationSha256: input.trainAttestationSha256,
      checkpointFileSha256: input.checkpointFileSha256,
      checkpointSha256: input.checkpointSha256,
      configFileSha256: input.configFileSha256
    },
    execution: {
      openingsAllowed: 1,
      openingsUsedBeforeActivation: 0,
      reportMustNotExistBeforeOpening: true,
      openingReceiptCreatedBeforeDevelopmentRead: true,
      calibrationDerivationRevalidated: true,
      predictionRuns: 1
    },
    filesystemBoundary: structuredClone(input.filesystemBoundary),
    authority: { mode: "offline-shadow-only", canProduceEffects: false }
  };
  return finalize(core, "developmentActivationSha256");
}

export function validateExp0018DevelopmentActivation(activation) {
  const errors = [];
  if (
    activation?.schemaVersion !== EXP0018_DEVELOPMENT_ACTIVATION_VERSION ||
    activation?.experimentId !== "EXP-0018" ||
    activation?.status !== "development-authorized-for-one-opening" ||
    !validCommit(activation?.checkpointSourceCommit) ||
    !validSelfHash(activation, "developmentActivationSha256")
  ) {
    errors.push("identidade ou hash da activation incompatível");
  }
  const expectedBindingKeys = [
    "checkpointFileSha256",
    "checkpointSha256",
    "configFileSha256",
    "prefitFreezeFileSha256",
    "prefitFreezeSha256",
    "trainAttestationFileSha256",
    "trainAttestationSha256"
  ];
  if (
    !same(
      Object.keys(activation?.bindings ?? {}).sort(),
      expectedBindingKeys
    ) ||
    Object.values(activation?.bindings ?? {}).some(
      (value) => !validSha256(value)
    )
  ) {
    errors.push("bindings da activation incompatíveis");
  }
  if (
    activation?.execution?.openingsAllowed !== 1 ||
    activation?.execution?.openingsUsedBeforeActivation !== 0 ||
    activation?.execution?.reportMustNotExistBeforeOpening !== true ||
    activation?.execution?.openingReceiptCreatedBeforeDevelopmentRead !== true ||
    activation?.execution?.calibrationDerivationRevalidated !== true ||
    activation?.execution?.predictionRuns !== 1 ||
    !validStageBoundary(
      activation?.filesystemBoundary,
      "activation",
      activation?.checkpointSourceCommit
    ) ||
    activation?.authority?.canProduceEffects !== false
  ) {
    errors.push("execução ou autoridade da activation incompatível");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function createExp0018DevelopmentOpening(input = {}) {
  const core = {
    schemaVersion: EXP0018_DEVELOPMENT_OPENING_VERSION,
    experimentId: "EXP-0018",
    status: "opening-consumed-report-pending",
    bindings: {
      developmentActivationSha256: input.developmentActivationSha256,
      checkpointSha256: input.checkpointSha256,
      developmentDatasetFileSha256: input.developmentDatasetFileSha256,
      developmentDatasetCanonicalSha256:
        input.developmentDatasetCanonicalSha256
    },
    opening: {
      ordinal: 1,
      receiptCreatedBeforeDevelopmentRead: true,
      predictionRunsAuthorized: 1,
      openingExecutionCommit: input.openingExecutionCommit
    },
    filesystemBoundary: structuredClone(input.filesystemBoundary),
    authority: { mode: "offline-shadow-only", canProduceEffects: false }
  };
  return finalize(core, "developmentOpeningSha256");
}

export function validateExp0018DevelopmentOpening(opening) {
  const errors = [];
  if (
    opening?.schemaVersion !== EXP0018_DEVELOPMENT_OPENING_VERSION ||
    opening?.experimentId !== "EXP-0018" ||
    opening?.status !== "opening-consumed-report-pending" ||
    !validSelfHash(opening, "developmentOpeningSha256")
  ) {
    errors.push("identidade ou hash do opening incompatível");
  }
  const expectedBindingKeys = [
    "checkpointSha256",
    "developmentActivationSha256",
    "developmentDatasetCanonicalSha256",
    "developmentDatasetFileSha256"
  ];
  if (
    !same(
      Object.keys(opening?.bindings ?? {}).sort(),
      expectedBindingKeys
    ) ||
    Object.values(opening?.bindings ?? {}).some(
      (value) => !validSha256(value)
    )
  ) {
    errors.push("bindings do opening incompatíveis");
  }
  if (
    opening?.opening?.ordinal !== 1 ||
    opening?.opening?.receiptCreatedBeforeDevelopmentRead !== true ||
    opening?.opening?.predictionRunsAuthorized !== 1 ||
    !validCommit(opening?.opening?.openingExecutionCommit) ||
    !validStageBoundary(
      opening?.filesystemBoundary,
      "opening",
      opening?.opening?.openingExecutionCommit
    ) ||
    opening?.authority?.canProduceEffects !== false
  ) {
    errors.push("protocolo ou autoridade do opening incompatível");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function validateExp0018DevelopmentAttempt(attempt) {
  const errors = [];
  if (
    attempt?.schemaVersion !== EXP0018_DEVELOPMENT_ATTEMPT_VERSION ||
    attempt?.experimentId !== "EXP-0018" ||
    attempt?.status !== "development-attempt-consumed" ||
    !validSelfHash(attempt, "developmentAttemptSha256")
  ) {
    errors.push("identidade ou hash da tentativa incompatível");
  }
  const expectedBindingKeys = [
    "checkpointSha256",
    "developmentOpeningFileSha256",
    "developmentOpeningSha256"
  ];
  if (
    !same(Object.keys(attempt?.bindings ?? {}).sort(), expectedBindingKeys) ||
    Object.values(attempt?.bindings ?? {}).some(
      (value) => !validSha256(value)
    )
  ) {
    errors.push("bindings da tentativa incompatíveis");
  }
  if (
    attempt?.attempt?.ordinal !== 1 ||
    attempt?.attempt?.createdBeforeDevelopmentPermission !== true ||
    !validCommit(attempt?.attempt?.preflightCommit) ||
    attempt?.authority?.canProduceEffects !== false
  ) {
    errors.push("protocolo ou autoridade da tentativa incompatível");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}
