import {
  EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
  validateExp0018Dataset
} from "../src/eval/exp-0018-context.mjs";
import {
  EXP0018_PATHS,
  EXP0018_STAGE_CONTRACTS,
  createExp0018TrainAttestation,
  validateExp0018PrefitFreeze,
  validateExp0018TrainAttestation
} from "../src/eval/exp-0018-boundary.mjs";
import {
  createExp0018FitCandidate,
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

const permissionEvidence = verifyStagePermissions("fit");
const freezeRecord = await readJsonRecord(EXP0018_PATHS.prefitFreeze);
const freeze = freezeRecord.value;
const freezeValidation = validateExp0018PrefitFreeze(freeze);
assertCondition(freezeValidation.valid,
  `freeze inválido: ${freezeValidation.errors.join("; ")}`);
const launchEvidence = verifySealedLaunch("fit", freeze);
await verifyCriticalSources(freeze);
const denialProbesPassed = await probeDeniedReads(
  EXP0018_STAGE_CONTRACTS.fit.prohibitedDataReads
);
const [configRecord, fitRecord] = await Promise.all([
  readJsonRecord(EXP0018_PATHS.config),
  readJsonRecord(EXP0018_PATHS.fitDataset)
]);
assertRecordMatches(configRecord, freeze.artifacts.config);
assertRecordMatches(fitRecord, freeze.artifacts.fitDataset);
assertCondition(fitRecord.value.datasetSha256 ===
  freeze.artifacts.fitDataset.canonicalSha256,
"dataset fit diverge do freeze canônico");
const datasetValidation = validateExp0018Dataset(fitRecord.value, {
  experimentConfigFileSha256: configRecord.fileSha256
});
assertCondition(datasetValidation.valid,
  `dataset fit inválido: ${datasetValidation.errors.join("; ")}`);
const fitCandidate = createExp0018FitCandidate({
  config: configRecord.value,
  fitDataset: fitRecord.value,
  prefitFreezeSha256: freeze.prefitFreezeSha256,
  configFileSha256: configRecord.fileSha256,
  fitDatasetFileSha256: fitRecord.fileSha256,
  fitExecutionCommit: launchEvidence.preflightCommit
});
const candidateValidation = validateExp0018FitCandidate(fitCandidate);
assertCondition(candidateValidation.valid,
  `fit candidate inválido: ${candidateValidation.errors.join("; ")}`);
const attestation = createExp0018TrainAttestation({
  prefitFreezeSha256: freeze.prefitFreezeSha256,
  fitCandidate,
  configFileSha256: configRecord.fileSha256,
  configCanonicalSha256: EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
  fitDatasetFileSha256: fitRecord.fileSha256,
  fitDataset: fitRecord.value,
  runnerSourceCommit: freeze.runnerSourceCommit,
  fitExecutionCommit: launchEvidence.preflightCommit,
  filesystemBoundary: {
    ...permissionEvidence,
    ...launchEvidence,
    denialProbesPassed
  }
});
const attestationValidation = validateExp0018TrainAttestation(attestation);
assertCondition(attestationValidation.valid,
  `attestation inválida: ${attestationValidation.errors.join("; ")}`);
assertCondition(
  attestation.readSet.readSetSha256 ===
    freeze.artifacts.fitDataset.readSetSha256,
  "readSet efetivo diverge do freeze"
);

await writeJsonExclusive(EXP0018_PATHS.fitCandidate, fitCandidate);
await writeJsonExclusive(EXP0018_PATHS.trainAttestation, attestation);
console.log(`EXP-0018 fit concluído: ${fitCandidate.fitCandidateSha256}`);
console.log("Calibração e development não foram lidos.");
