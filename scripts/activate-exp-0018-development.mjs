import {
  EXP0018_PATHS,
  EXP0018_STAGE_CONTRACTS,
  createExp0018DevelopmentActivation,
  validateExp0018CheckpointChain,
  validateExp0018DevelopmentActivation,
  validateExp0018PrefitFreeze,
  validateExp0018TrainAttestation
} from "../src/eval/exp-0018-boundary.mjs";
import {
  validateExp0018Checkpoint,
  validateExp0018CheckpointAgainstCalibration
} from
  "../src/eval/exp-0018-training.mjs";
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

const permissionEvidence = verifyStagePermissions("activation");
const freezeRecord = await readJsonRecord(EXP0018_PATHS.prefitFreeze);
const freeze = freezeRecord.value;
const freezeValidation = validateExp0018PrefitFreeze(freeze);
assertCondition(freezeValidation.valid,
  `freeze inválido: ${freezeValidation.errors.join("; ")}`);
const launchEvidence = verifySealedLaunch("activation", freeze);
await verifyCriticalSources(freeze);
const denialProbesPassed = await probeDeniedReads(
  EXP0018_STAGE_CONTRACTS.activation.prohibitedDataReads
);

const [
  configRecord,
  calibrationRecord,
  attestationRecord,
  checkpointRecord
] = await Promise.all([
  readJsonRecord(EXP0018_PATHS.config),
  readJsonRecord(EXP0018_PATHS.calibrationDataset),
  readJsonRecord(EXP0018_PATHS.trainAttestation),
  readJsonRecord(EXP0018_PATHS.checkpoint)
]);
const attestation = attestationRecord.value;
const checkpoint = checkpointRecord.value;
const attestationValidation = validateExp0018TrainAttestation(attestation);
const checkpointValidation = validateExp0018Checkpoint(checkpoint);
assertCondition(attestationValidation.valid,
  `attestation inválida: ${attestationValidation.errors.join("; ")}`);
assertCondition(checkpointValidation.valid,
  `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`);
assertRecordMatches(configRecord, freeze.artifacts.config);
assertRecordMatches(
  calibrationRecord,
  freeze.artifacts.calibrationDataset
);
const calibrationDerivation = validateExp0018CheckpointAgainstCalibration(
  checkpoint,
  {
    config: configRecord.value,
    calibrationDataset: calibrationRecord.value
  }
);
assertCondition(calibrationDerivation.valid,
  `derivação de calibração inválida: ${calibrationDerivation.errors.join("; ")}`);
const chain = validateExp0018CheckpointChain({
  freeze,
  config: configRecord.value,
  attestation,
  checkpoint
});
assertCondition(chain.valid, chain.errors.join("; "));

const activation = createExp0018DevelopmentActivation({
  checkpointSourceCommit: launchEvidence.preflightCommit,
  prefitFreezeFileSha256: freezeRecord.fileSha256,
  prefitFreezeSha256: freeze.prefitFreezeSha256,
  trainAttestationFileSha256: attestationRecord.fileSha256,
  trainAttestationSha256: attestation.trainAttestationSha256,
  checkpointFileSha256: checkpointRecord.fileSha256,
  checkpointSha256: checkpoint.checkpointSha256,
  configFileSha256: configRecord.fileSha256,
  filesystemBoundary: {
    ...permissionEvidence,
    ...launchEvidence,
    denialProbesPassed
  }
});
const validation = validateExp0018DevelopmentActivation(activation);
assertCondition(validation.valid,
  `activation inválida: ${validation.errors.join("; ")}`);
await writeJsonExclusive(EXP0018_PATHS.developmentActivation, activation);
console.log(
  `Development autorizado para uma abertura: ` +
  activation.developmentActivationSha256
);
console.log("Faça commit da activation antes de consumir a abertura.");
