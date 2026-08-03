import {
  EXP0018_PATHS,
  EXP0018_STAGE_CONTRACTS,
  createExp0018DevelopmentOpening,
  validateExp0018CheckpointChain,
  validateExp0018DevelopmentActivation,
  validateExp0018DevelopmentOpening,
  validateExp0018PrefitFreeze,
  validateExp0018TrainAttestation
} from "../src/eval/exp-0018-boundary.mjs";
import { validateExp0018Checkpoint } from
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

const permissionEvidence = verifyStagePermissions("opening");
const freezeRecord = await readJsonRecord(EXP0018_PATHS.prefitFreeze);
const freeze = freezeRecord.value;
const freezeValidation = validateExp0018PrefitFreeze(freeze);
assertCondition(freezeValidation.valid,
  `freeze inválido: ${freezeValidation.errors.join("; ")}`);
const launchEvidence = verifySealedLaunch("opening", freeze);
await verifyCriticalSources(freeze);
const denialProbesPassed = await probeDeniedReads(
  EXP0018_STAGE_CONTRACTS.opening.prohibitedDataReads
);

const [configRecord, attestationRecord, checkpointRecord, activationRecord] =
  await Promise.all([
    readJsonRecord(EXP0018_PATHS.config),
    readJsonRecord(EXP0018_PATHS.trainAttestation),
    readJsonRecord(EXP0018_PATHS.checkpoint),
    readJsonRecord(EXP0018_PATHS.developmentActivation)
  ]);
const attestation = attestationRecord.value;
const checkpoint = checkpointRecord.value;
const activation = activationRecord.value;
const attestationValidation = validateExp0018TrainAttestation(attestation);
const checkpointValidation = validateExp0018Checkpoint(checkpoint);
const activationValidation = validateExp0018DevelopmentActivation(activation);
assertCondition(attestationValidation.valid,
  `attestation inválida: ${attestationValidation.errors.join("; ")}`);
assertCondition(checkpointValidation.valid,
  `checkpoint inválido: ${checkpointValidation.errors.join("; ")}`);
assertCondition(activationValidation.valid,
  `activation inválida: ${activationValidation.errors.join("; ")}`);
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
  activation.bindings.configFileSha256 === configRecord.fileSha256,
  "cadeia de activation divergiu"
);

const opening = createExp0018DevelopmentOpening({
  developmentActivationSha256: activation.developmentActivationSha256,
  checkpointSha256: checkpoint.checkpointSha256,
  developmentDatasetFileSha256:
    freeze.artifacts.developmentDataset.fileSha256,
  developmentDatasetCanonicalSha256:
    freeze.artifacts.developmentDataset.canonicalSha256,
  openingExecutionCommit: launchEvidence.preflightCommit,
  filesystemBoundary: {
    ...permissionEvidence,
    ...launchEvidence,
    denialProbesPassed
  }
});
const openingValidation = validateExp0018DevelopmentOpening(opening);
assertCondition(openingValidation.valid,
  `opening inválido: ${openingValidation.errors.join("; ")}`);
await writeJsonExclusive(EXP0018_PATHS.developmentOpening, opening);
console.log(`Abertura EXP-0018 consumida: ${opening.developmentOpeningSha256}`);
console.log("Development não foi legível; commite o recibo antes do evaluator.");
