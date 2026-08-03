import {
  EXP0018_PATHS,
  EXP0018_STAGE_CONTRACTS,
  validateExp0018CheckpointChain,
  validateExp0018DevelopmentActivation,
  validateExp0018DevelopmentAttempt,
  validateExp0018DevelopmentOpening,
  validateExp0018PrefitFreeze,
  validateExp0018TrainAttestation
} from "../src/eval/exp-0018-boundary.mjs";
import {
  createExp0018DevelopmentInvalidation,
  validateExp0018Checkpoint,
  validateExp0018DevelopmentInvalidation
} from "../src/eval/exp-0018-training.mjs";
import {
  assertCondition,
  assertRecordMatches,
  probeDeniedReads,
  readJsonRecord,
  verifyCriticalSources,
  verifySealedLaunch,
  verifyStagePermissions,
  writeJsonExclusive
} from "./lib/exp-0018-io.mjs";

const permissionEvidence = verifyStagePermissions("invalidation");
const freezeRecord = await readJsonRecord(EXP0018_PATHS.prefitFreeze);
const freeze = freezeRecord.value;
const freezeValidation = validateExp0018PrefitFreeze(freeze);
assertCondition(freezeValidation.valid,
  `freeze inválido: ${freezeValidation.errors.join("; ")}`);
const launchEvidence = verifySealedLaunch("invalidation", freeze);
await verifyCriticalSources(freeze);
const denialProbesPassed = await probeDeniedReads(
  EXP0018_STAGE_CONTRACTS.invalidation.prohibitedDataReads
);

const [
  configRecord,
  attestationRecord,
  checkpointRecord,
  activationRecord,
  openingRecord,
  attemptRecord
] = await Promise.all([
  readJsonRecord(EXP0018_PATHS.config),
  readJsonRecord(EXP0018_PATHS.trainAttestation),
  readJsonRecord(EXP0018_PATHS.checkpoint),
  readJsonRecord(EXP0018_PATHS.developmentActivation),
  readJsonRecord(EXP0018_PATHS.developmentOpening),
  readJsonRecord(EXP0018_PATHS.developmentAttempt)
]);
const attestation = attestationRecord.value;
const checkpoint = checkpointRecord.value;
const activation = activationRecord.value;
const opening = openingRecord.value;
const attempt = attemptRecord.value;
const validations = [
  ["attestation", validateExp0018TrainAttestation(attestation)],
  ["checkpoint", validateExp0018Checkpoint(checkpoint)],
  ["activation", validateExp0018DevelopmentActivation(activation)],
  ["opening", validateExp0018DevelopmentOpening(opening)],
  ["attempt", validateExp0018DevelopmentAttempt(attempt)]
];
for (const [name, validation] of validations) {
  assertCondition(validation.valid,
    `${name} inválido: ${validation.errors.join("; ")}`);
}
assertRecordMatches(configRecord, freeze.artifacts.config);
const chain = validateExp0018CheckpointChain({
  freeze,
  config: configRecord.value,
  attestation,
  checkpoint
});
assertCondition(chain.valid, chain.errors.join("; "));
assertCondition(
  activation.bindings.prefitFreezeFileSha256 === freezeRecord.fileSha256 &&
  activation.bindings.prefitFreezeSha256 === freeze.prefitFreezeSha256 &&
  activation.bindings.trainAttestationFileSha256 ===
    attestationRecord.fileSha256 &&
  activation.bindings.trainAttestationSha256 ===
    attestation.trainAttestationSha256 &&
  activation.bindings.checkpointFileSha256 === checkpointRecord.fileSha256 &&
  activation.bindings.checkpointSha256 === checkpoint.checkpointSha256 &&
  activation.bindings.configFileSha256 === configRecord.fileSha256 &&
  opening.bindings.developmentActivationSha256 ===
    activation.developmentActivationSha256 &&
  opening.bindings.checkpointSha256 === checkpoint.checkpointSha256 &&
  opening.bindings.developmentDatasetFileSha256 ===
    freeze.artifacts.developmentDataset.fileSha256 &&
  opening.bindings.developmentDatasetCanonicalSha256 ===
    freeze.artifacts.developmentDataset.canonicalSha256 &&
  attempt.bindings.developmentOpeningFileSha256 === openingRecord.fileSha256 &&
  attempt.bindings.developmentOpeningSha256 ===
    opening.developmentOpeningSha256 &&
  attempt.bindings.checkpointSha256 === checkpoint.checkpointSha256,
  "cadeia activation→opening→attempt divergiu"
);

const reportInput = {
  config: configRecord.value,
  prefitFreezeSha256: freeze.prefitFreezeSha256,
  developmentActivationFileSha256: activationRecord.fileSha256,
  developmentActivationSha256: activation.developmentActivationSha256,
  developmentOpeningFileSha256: openingRecord.fileSha256,
  developmentOpeningSha256: opening.developmentOpeningSha256,
  developmentAttemptFileSha256: attemptRecord.fileSha256,
  developmentAttemptSha256: attempt.developmentAttemptSha256,
  checkpointSha256: checkpoint.checkpointSha256,
  configFileSha256: configRecord.fileSha256,
  developmentDatasetFileSha256:
    freeze.artifacts.developmentDataset.fileSha256,
  developmentDatasetCanonicalSha256:
    freeze.artifacts.developmentDataset.canonicalSha256,
  invalidationExecutionCommit: launchEvidence.preflightCommit,
  filesystemBoundary: {
    ...permissionEvidence,
    ...launchEvidence,
    denialProbesPassed
  }
};
const invalidation = createExp0018DevelopmentInvalidation(reportInput);
const validation = validateExp0018DevelopmentInvalidation(
  invalidation,
  reportInput
);
assertCondition(validation.valid,
  `invalidação inválida: ${validation.errors.join("; ")}`);
await writeJsonExclusive(EXP0018_PATHS.developmentReport, invalidation);
console.log("EXP-0018 invalidado sem conclusão de qualidade.");
console.log(`Report: ${invalidation.developmentInvalidationSha256}`);
