import { validateExp0018Dataset } from
  "../src/eval/exp-0018-context.mjs";
import {
  EXP0018_PATHS,
  EXP0018_STAGE_CONTRACTS,
  validateExp0018CheckpointChain,
  validateExp0018PrefitFreeze,
  validateExp0018TrainAttestation
} from "../src/eval/exp-0018-boundary.mjs";
import {
  createExp0018Checkpoint,
  validateExp0018Checkpoint,
  validateExp0018FitCandidate
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

const permissionEvidence = verifyStagePermissions("calibration");
const freezeRecord = await readJsonRecord(EXP0018_PATHS.prefitFreeze);
const freeze = freezeRecord.value;
const freezeValidation = validateExp0018PrefitFreeze(freeze);
assertCondition(freezeValidation.valid,
  `freeze inválido: ${freezeValidation.errors.join("; ")}`);
const launchEvidence = verifySealedLaunch("calibration", freeze);
await verifyCriticalSources(freeze);
const denialProbesPassed = await probeDeniedReads(
  EXP0018_STAGE_CONTRACTS.calibration.prohibitedDataReads
);
const [
  configRecord,
  calibrationRecord,
  candidateRecord,
  attestationRecord
] = await Promise.all([
  readJsonRecord(EXP0018_PATHS.config),
  readJsonRecord(EXP0018_PATHS.calibrationDataset),
  readJsonRecord(EXP0018_PATHS.fitCandidate),
  readJsonRecord(EXP0018_PATHS.trainAttestation)
]);
const candidate = candidateRecord.value;
const attestation = attestationRecord.value;
const candidateValidation = validateExp0018FitCandidate(candidate);
const attestationValidation = validateExp0018TrainAttestation(attestation);
assertCondition(candidateValidation.valid,
  `candidate inválido: ${candidateValidation.errors.join("; ")}`);
assertCondition(attestationValidation.valid,
  `attestation inválida: ${attestationValidation.errors.join("; ")}`);
assertRecordMatches(configRecord, freeze.artifacts.config);
assertRecordMatches(calibrationRecord, freeze.artifacts.calibrationDataset);
assertCondition(calibrationRecord.value.datasetSha256 ===
  freeze.artifacts.calibrationDataset.canonicalSha256,
"dataset de calibração diverge do freeze canônico");
const datasetValidation = validateExp0018Dataset(calibrationRecord.value, {
  experimentConfigFileSha256: configRecord.fileSha256
});
assertCondition(datasetValidation.valid,
  `dataset de calibração inválido: ${datasetValidation.errors.join("; ")}`);
assertCondition(
  candidate.bindings.prefitFreezeSha256 === freeze.prefitFreezeSha256 &&
  candidate.bindings.configFileSha256 === configRecord.fileSha256 &&
  candidate.bindings.fitDatasetFileSha256 ===
    freeze.artifacts.fitDataset.fileSha256 &&
  candidate.bindings.fitDatasetCanonicalSha256 ===
    freeze.artifacts.fitDataset.canonicalSha256 &&
  candidate.bindings.fitExecutionCommit ===
    attestation.bindings.fitExecutionCommit &&
  attestation.bindings.prefitFreezeSha256 === freeze.prefitFreezeSha256 &&
  attestation.bindings.fitCandidateSha256 ===
    candidate.fitCandidateSha256 &&
  attestation.bindings.configFileSha256 === configRecord.fileSha256 &&
  attestation.bindings.configCanonicalSha256 ===
    freeze.artifacts.config.canonicalSha256 &&
  attestation.bindings.fitDatasetFileSha256 ===
    freeze.artifacts.fitDataset.fileSha256 &&
  attestation.bindings.fitDatasetCanonicalSha256 ===
    freeze.artifacts.fitDataset.canonicalSha256 &&
  attestation.bindings.runnerSourceCommit === freeze.runnerSourceCommit &&
  attestation.readSet.readSetSha256 ===
    freeze.artifacts.fitDataset.readSetSha256 &&
  attestation.outputs.fitCandidateSha256 === candidate.fitCandidateSha256 &&
  attestation.outputs.modelSha256.B0 === candidate.arms.B0.modelSha256 &&
  attestation.outputs.modelSha256.B1 === candidate.arms.B1.modelSha256,
  "cadeia freeze→fit→attestation divergiu"
);
const checkpoint = createExp0018Checkpoint({
  config: configRecord.value,
  fitCandidate: candidate,
  calibrationDataset: calibrationRecord.value,
  prefitFreezeSha256: freeze.prefitFreezeSha256,
  fitAttestationSha256: attestation.trainAttestationSha256,
  configFileSha256: configRecord.fileSha256,
  calibrationDatasetFileSha256: calibrationRecord.fileSha256,
  calibrationExecutionCommit: launchEvidence.preflightCommit,
  filesystemBoundary: {
    ...permissionEvidence,
    ...launchEvidence,
    denialProbesPassed
  }
});
const checkpointValidation = validateExp0018Checkpoint(checkpoint);
assertCondition(checkpointValidation.valid,
  `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`);
const chain = validateExp0018CheckpointChain({
  freeze,
  config: configRecord.value,
  attestation,
  checkpoint
});
assertCondition(chain.valid, chain.errors.join("; "));
await writeJsonExclusive(EXP0018_PATHS.checkpoint, checkpoint);
console.log(`EXP-0018 calibrado: ${checkpoint.checkpointSha256}`);
console.log("Checkpoint criado sem leitura de fit ou development.");
