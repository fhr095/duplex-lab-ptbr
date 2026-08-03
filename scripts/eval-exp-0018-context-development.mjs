import { validateExp0018Dataset } from
  "../src/eval/exp-0018-context.mjs";
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
  createExp0018DevelopmentReport,
  validateExp0018Checkpoint,
  validateExp0018DevelopmentReport
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

const permissionEvidence = verifyStagePermissions("development");
const freezeRecord = await readJsonRecord(EXP0018_PATHS.prefitFreeze);
const freeze = freezeRecord.value;
const freezeValidation = validateExp0018PrefitFreeze(freeze);
assertCondition(freezeValidation.valid,
  `freeze inválido: ${freezeValidation.errors.join("; ")}`);
const launchEvidence = verifySealedLaunch("development", freeze);
await verifyCriticalSources(freeze);
const denialProbesPassed = await probeDeniedReads(
  EXP0018_STAGE_CONTRACTS.development.prohibitedDataReads
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
const attestationValidation = validateExp0018TrainAttestation(attestation);
const checkpointValidation = validateExp0018Checkpoint(checkpoint);
const activationValidation = validateExp0018DevelopmentActivation(activation);
const openingValidation = validateExp0018DevelopmentOpening(opening);
const attemptValidation = validateExp0018DevelopmentAttempt(attempt);
assertCondition(attestationValidation.valid,
  `attestation inválida: ${attestationValidation.errors.join("; ")}`);
assertCondition(checkpointValidation.valid,
  `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`);
assertCondition(activationValidation.valid,
  `activation inválida: ${activationValidation.errors.join("; ")}`);
assertCondition(openingValidation.valid,
  `opening inválido: ${openingValidation.errors.join("; ")}`);
assertCondition(attemptValidation.valid,
  `tentativa inválida: ${attemptValidation.errors.join("; ")}`);
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
  attempt.bindings.checkpointSha256 === checkpoint.checkpointSha256 &&
  attempt.attempt.preflightCommit === launchEvidence.preflightCommit,
  "cadeia activation→opening divergiu"
);

// O opening já existe e está commitado antes deste processo receber qualquer
// permissão de leitura sobre development.
const developmentRecord = await readJsonRecord(
  EXP0018_PATHS.developmentDataset
);
assertRecordMatches(developmentRecord, freeze.artifacts.developmentDataset);
assertCondition(developmentRecord.value.datasetSha256 ===
  freeze.artifacts.developmentDataset.canonicalSha256,
"dataset development diverge do freeze canônico");
const datasetValidation = validateExp0018Dataset(developmentRecord.value, {
  experimentConfigFileSha256: configRecord.fileSha256
});
assertCondition(datasetValidation.valid,
  `dataset development inválido: ${datasetValidation.errors.join("; ")}`);

const reportInput = {
  config: configRecord.value,
  checkpoint,
  developmentDataset: developmentRecord.value,
  prefitFreezeSha256: freeze.prefitFreezeSha256,
  developmentActivationFileSha256: activationRecord.fileSha256,
  developmentActivationSha256: activation.developmentActivationSha256,
  developmentOpeningFileSha256: openingRecord.fileSha256,
  developmentOpeningSha256: opening.developmentOpeningSha256,
  developmentAttemptFileSha256: attemptRecord.fileSha256,
  developmentAttemptSha256: attempt.developmentAttemptSha256,
  configFileSha256: configRecord.fileSha256,
  developmentDatasetFileSha256: developmentRecord.fileSha256,
  developmentExecutionCommit: launchEvidence.preflightCommit,
  filesystemBoundary: {
    ...permissionEvidence,
    ...launchEvidence,
    denialProbesPassed
  }
};
const report = createExp0018DevelopmentReport(reportInput);
const reportValidation = validateExp0018DevelopmentReport(
  report,
  reportInput
);
assertCondition(reportValidation.valid,
  `report inválido: ${reportValidation.errors.join("; ")}`);
await writeJsonExclusive(EXP0018_PATHS.developmentReport, report);
console.log(`EXP-0018 development: ${report.decision}`);
console.log(`Report: ${report.developmentReportSha256}`);
