import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  validateExp0018CheckpointChain,
  validateExp0018DevelopmentActivation,
  validateExp0018DevelopmentAttempt,
  validateExp0018DevelopmentOpening,
  validateExp0018PrefitFreeze,
  validateExp0018TrainAttestation
} from "./exp-0018-boundary.mjs";
import {
  createExp0018FitCandidate,
  validateExp0018Checkpoint,
  validateExp0018CheckpointAgainstCalibration,
  validateExp0018DevelopmentInvalidation,
  validateExp0018DevelopmentReport,
  validateExp0018FitCandidate
} from
  "./exp-0018-training.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";

const execFileAsync = promisify(execFile);

export const EXPERIMENT_INDEX_SCHEMA_VERSION = 1;

export const EXPERIMENT_STATUSES = Object.freeze([
  "active",
  "completed",
  "cut",
  "held",
  "invalidated",
  "planned",
  "promoted",
  "rejected"
]);

export const EXPERIMENT_AUTHORITIES = Object.freeze([
  "none",
  "runtime-control",
  "runtime-guardrail",
  "shadow-only"
]);

const STATUS_SET = new Set(EXPERIMENT_STATUSES);
const AUTHORITY_SET = new Set(EXPERIMENT_AUTHORITIES);
const EXPERIMENT_ID_PATTERN = /^EXP-\d{4}$/u;
const EXPERIMENT_TRACK_ID_PATTERN = /^EXP-\d{4}-[A-Z]$/u;
const EXPERIMENT_RANGE_PATTERN = /^(EXP-\d{4})\.\.(EXP-\d{4})$/u;

export const EXP0018_CANONICAL_OUTCOMES = Object.freeze({
  PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN: Object.freeze({
    status: "completed",
    authority: "none",
    reportStatus: "passed-textual-mechanism-screen",
    allGatesPassed: true,
    claimRequired: true,
    nextDecision:
      "Pré-registrar uma emenda e executar o menor screen causal em áudio do mesmo checkpoint; ASR continua fora até provar disponibilidade.",
    parallelProbeStatus: "planned",
    parallelProbeDecision:
      "Pré-registrar separadamente o menor bridge causal em áudio do checkpoint aprovado; ASR permanece fora até evidência de disponibilidade."
  }),
  CUT_CONTEXT_MATCHER_IN_THIS_DESIGN: Object.freeze({
    status: "cut",
    authority: "none",
    reportStatus: "cut-textual-mechanism-screen",
    allGatesPassed: false,
    claimRequired: false,
    nextDecision:
      "Não levar este matcher a áudio; selecionar o próximo maior gargalo percebido sob novo pré-registro.",
    parallelProbeStatus: "cut",
    parallelProbeDecision:
      "Bridge causal em áudio cancelado porque o matcher textual não venceu seus gates; selecionar outro mecanismo."
  }),
  INVALIDATED_SINGLE_DEVELOPMENT_ATTEMPT: Object.freeze({
    status: "invalidated",
    authority: "none",
    reportStatus: "invalidated-development-attempt",
    allGatesPassed: null,
    claimRequired: false,
    nextDecision:
      "Registrar um novo experimento antes de qualquer nova abertura; esta tentativa não produz conclusão de qualidade.",
    parallelProbeStatus: "planned",
    parallelProbeDecision:
      "Nenhum bridge em áudio foi autorizado; repetir a hipótese somente sob novo experimento e nova abertura."
  })
});

export const EXP0018_CANONICAL_REPORT_PATH =
  "eval/reports/exp-0018-context-development-v0.1.json";
export const EXP0019_CANONICAL_REPORT_PATH =
  "eval/reports/exp-0019-causal-audio-v0.1.json";
export const EXP0020_CANONICAL_REPORT_PATH =
  "eval/reports/exp-0020-stop-order-v0.1.json";
export const EXP0021_CANONICAL_REPORT_PATH =
  "eval/reports/exp-0021-cdp-capture-qualification-v0.1.json";
export const EXP0022_CANONICAL_REPORT_PATH =
  "eval/reports/exp-0022-bootstrap-audit-health-binding-v0.1.json";

export function validateExp0018HistoricalOutcome(entry, index, decision) {
  const outcome = EXP0018_CANONICAL_OUTCOMES[decision];
  assert(outcome, "EXP-0018 outcome histórico não registrado");
  assert(entry.nextDecision === outcome.nextDecision,
    "EXP-0018 nextDecision contradiz o outcome congelado");
  assert(
    entry.parallelProbeOutcome?.status === outcome.parallelProbeStatus &&
    entry.parallelProbeOutcome?.decision === outcome.parallelProbeDecision,
    "EXP-0018 probe paralelo histórico contradiz o outcome congelado"
  );
  if (index.currentCriticalPath === "EXP-0018") {
    assert(
      index.currentParallelProbe.status ===
        entry.parallelProbeOutcome.status &&
      index.currentParallelProbe.decision ===
        entry.parallelProbeOutcome.decision,
      "probe corrente EXP-0018 contradiz seu fechamento histórico"
    );
  }
  return outcome;
}

// Deliberately separate from the editable index: changing one JSON file must
// not be enough to rewrite a historical decision or grant authority.
const CANONICAL_REPORT_CONTRACTS = Object.freeze({
  "EXP-0007": {
    status: "rejected",
    authority: "none",
    decisionPath: "screening.decision",
    assertions: [["interpretation.promoted", false]]
  },
  "EXP-0008": {
    status: "held",
    authority: "none",
    decisionPath: "decision",
    assertions: [["authorizedAuthority", "none"]]
  },
  "EXP-0009": {
    status: "promoted",
    authority: "runtime-guardrail",
    decisionPath: "decision",
    assertions: [["pass", true], ["gates.guardObservedEveryTime", true]]
  },
  "EXP-0010": {
    status: "promoted",
    authority: "runtime-control",
    decisionPath: "decision",
    assertions: [["pass", true], ["gates.singleAuthority", true]]
  },
  "EXP-0011": {
    status: "promoted",
    authority: "runtime-control",
    decisionPath: "decision",
    assertions: [["pass", true], ["gates.lateTranscriptCannotLeak", true]]
  },
  "EXP-0012": {
    status: "promoted",
    authority: "runtime-control",
    decisionPath: "decision",
    assertions: [["pass", true], ["gates.exactBrowserReplay", true]]
  },
  "EXP-0013": {
    status: "promoted",
    authority: "none",
    decisionPath: "decision",
    assertions: [["gates.shadowHasNoAuthority", true]]
  },
  "EXP-0014": {
    status: "promoted",
    authority: "shadow-only",
    decisionPath: "decision",
    assertions: [
      ["evidence.checkpoint.authority.mode", "shadow"],
      ["evidence.checkpoint.authority.canProduceEffects", false]
    ]
  },
  "EXP-0015": {
    status: "completed",
    authority: "none",
    decisionPath: "decisions.humanCalibration",
    assertions: [
      ["gates.noModelAuthority", true],
      ["aggregate.readyForDirectModelFit", false]
    ]
  },
  "EXP-0016": {
    status: "promoted",
    authority: "shadow-only",
    decisionPath: "decision",
    assertions: [
      ["authorityEligible", false],
      ["browserGates.zeroAuthority", true]
    ]
  },
  "EXP-0017": {
    status: "cut",
    authority: "none",
    decisionPath: "decision",
    assertions: [
      ["confirmatory", false],
      ["holdoutRead", false],
      ["core.qualified", false],
      ["core.aRef", "A0"],
      ["semanticProbeR.candidateFitPerformed", false],
      ["semanticProbeR.developmentSemanticMetricsRead", false],
      ["claims.semanticTextHelped", null],
      ["claims.semanticTextFailed", null],
      ["authority.canProduceEffects", false]
    ]
  },
  "EXP-0018": {
    decisionPath: "decision",
    outcomes: EXP0018_CANONICAL_OUTCOMES,
    assertions: [
      ["protocol.developmentOpeningsUsed", 1],
      ["protocol.developmentAttemptsUsed", 1],
      ["protocol.confirmatoryClaimAllowed", false],
      ["authority.canProduceEffects", false]
    ]
  },
  "EXP-0019": {
    status: "cut",
    authority: "none",
    decisionPath: "decision",
    assertions: [
      ["instrumentValid", true],
      ["pass", false],
      ["authorityEligible", false],
      ["gates.cardinalityAndDeterminism", false],
      ["gates.lifecycleAndPhysicalStopIsolated", false],
      ["gates.completeCausalBundle", true],
      ["gates.zeroFutureEvidence", true],
      ["gates.nodeChromeParity", true],
      ["metrics.effectsDispatched", 0],
      ["metrics.paidApiCalls", 0],
      ["metrics.gpuRuns", 0]
    ]
  },
  "EXP-0020": {
    status: "invalidated",
    authority: "none",
    decisionPath: "decision",
    assertions: [
      ["schemaVersion", "exp-0020-stop-order-report-v1"],
      ["analysis.decision", "INVALIDATE_STOP_ORDER_INSTRUMENT"],
      ["pass", false],
      ["instrumentValid", false],
      ["authorityEligible", false],
      ["claim", null],
      ["campaign.boundary.attemptVerified", true],
      ["campaign.boundary.freezeVerified", true],
      ["campaign.boundary.rerunAllowed", false],
      ["campaign.failure.code", "CDP_TTS_RESPONSE_BODY_EMPTY"],
      ["campaign.failure.phase", "navigation-1-trial-1-tts-body-capture"],
      ["campaign.failure.completedNavigationsPersisted", 0],
      ["campaign.failure.completedTrialsPersisted", 0],
      ["campaign.failure.crashConsumedAttempt", true],
      ["campaign.failure.rerunPerformed", false],
      ["campaign.failure.interpretationAllowed", false],
      ["campaign.failure.physicalEvaluation", "NOT_EVALUATED"],
      ["campaign.failure.physicalGateConclusionSupported", false],
      ["campaign.failure.failureBlockEmittedByFrozenRunner", false],
      ["campaign.navigations.length", 0],
      ["analysis.trials.length", 0],
      ["analysis.metrics.aggregate.renderStopLatencyMs.count", 0],
      ["analysis.metrics.aggregate.markerGapMs.count", 0],
      ["gates.classTemporalEquivalence", null],
      ["contract.paidApiCalls", 0],
      ["contract.gpuRuns", 0],
      ["contract.canProduceNewEffects", false],
      ["campaign.authority.canProduceNewEffects", false]
    ]
  },
  "EXP-0021": {
    status: "invalidated",
    authority: "none",
    decisionPath: "decision",
    assertions: [
      ["schemaVersion", "exp-0021-cdp-tts-capture-qualification-report-v1"],
      ["measurementStatus", "EVALUATED"],
      ["analysis.measurementStatus", "EVALUATED"],
      ["analysis.decision", "INVALIDATE_CDP_TTS_CAPTURE_QUALIFICATION"],
      ["pass", false],
      ["instrumentValid", false],
      ["authorityEligible", false],
      ["claim", null],
      ["campaign.boundary.freezeVerified", true],
      ["campaign.boundary.attemptVerified", true],
      ["campaign.boundary.receiptVerified", true],
      ["campaign.boundary.receiptWriteOnce", true],
      ["campaign.boundary.receiptBeforeNetwork", true],
      ["campaign.boundary.rerunAllowed", false],
      ["campaign.audits.rerunRefused", true],
      ["campaign.workerEnvelope.status", "completed"],
      ["campaign.workerEnvelope.failure", null],
      ["campaign.workerEnvelope.campaign.navigations.length", 2],
      ["analysis.units.length", 4],
      ["analysis.metrics.navigationCount", 2],
      ["analysis.metrics.unitCount", 4],
      ["analysis.metrics.successfulCaptures", 4],
      ["analysis.structural.navigationAuditValid", false],
      ["analysis.gates.cdpChainAndResponse", true],
      ["analysis.gates.browserCdpByteIdentity", true],
      ["analysis.gates.boundedFailClosedCapture", true],
      ["analysis.gates.diagnosticsNetworkAndBindings", false],
      ["analysis.nextMove.physicalStopPreregistrationAllowed", false],
      ["analysis.nextMove.physicalStopExecutionAllowed", false],
      ["analysis.nextMove.sameExperimentRerunAllowed", false],
      ["contract.negativeBudget.lifecycle.bargeIn", 0],
      ["contract.negativeBudget.lifecycle.stop", 0],
      ["contract.negativeBudget.lifecycle.transitions", 0],
      ["contract.negativeBudget.trainingTrace.decisions", 0],
      ["contract.negativeBudget.trainingTrace.effects", 0],
      ["contract.negativeBudget.externalRequests", 0],
      ["contract.negativeBudget.gpuRuns", 0],
      ["contract.negativeBudget.challengerRuns", 0],
      ["contract.negativeBudget.backboneRuns", 0],
      ["contract.negativeBudget.canProduceNewEffects", false],
      ["analysis.metrics.usageDelta.paidApiCalls", 0],
      ["analysis.metrics.usageDelta.externalLlmUsed", false]
    ]
  },
  "EXP-0022": {
    status: "invalidated",
    authority: "none",
    decisionPath: "decision",
    assertions: [
      ["schemaVersion", "exp-0022-bootstrap-audit-health-binding-report-v1"],
      ["measurementStatus", "EVALUATED"],
      ["analysis.measurementStatus", "EVALUATED"],
      ["analysis.decision", "INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING"],
      ["pass", false],
      ["instrumentValid", false],
      ["authorityEligible", false],
      ["claim", null],
      ["campaign.boundary.freezeVerified", true],
      ["campaign.boundary.attemptVerified", true],
      ["campaign.boundary.receiptVerified", true],
      ["campaign.boundary.receiptWriteOnce", true],
      ["campaign.boundary.receiptBeforeNetwork", true],
      ["campaign.boundary.rerunAllowed", false],
      ["campaign.audits.rerunRefused", true],
      ["campaign.workerEnvelope.status", "completed"],
      ["campaign.workerEnvelope.failure", null],
      ["campaign.workerEnvelope.campaign.navigations.length", 2],
      ["analysis.units.length", 4],
      ["analysis.metrics.navigationCount", 2],
      ["analysis.metrics.unitCount", 4],
      ["analysis.metrics.successfulCaptures", 4],
      ["analysis.structural.auditsValid", true],
      ["analysis.structural.diagnosticsValid", true],
      ["analysis.structural.bootstrapAuditHealthBindingValid", false],
      ["analysis.structural.navigationAuditValid", false],
      ["analysis.gates.cdpChainAndResponse", true],
      ["analysis.gates.browserCdpByteIdentity", true],
      ["analysis.gates.payloadStabilityAndDistinction", true],
      ["analysis.gates.boundedFailClosedCapture", true],
      ["analysis.gates.firstResponsePerNavigation", true],
      ["analysis.gates.environmentStable", true],
      ["analysis.gates.negativeBudgetExact", true],
      ["analysis.gates.diagnosticsNetworkAndBindings", false],
      ["analysis.nextMove.physicalStopPreregistrationAllowed", false],
      ["analysis.nextMove.physicalStopExecutionAllowed", false],
      ["analysis.nextMove.sameExperimentRerunAllowed", false],
      ["contract.negativeBudget.lifecycle.bargeIn", 0],
      ["contract.negativeBudget.lifecycle.stop", 0],
      ["contract.negativeBudget.lifecycle.transitions", 0],
      ["contract.negativeBudget.trainingTrace.decisions", 0],
      ["contract.negativeBudget.trainingTrace.effects", 0],
      ["contract.negativeBudget.externalRequests", 0],
      ["contract.negativeBudget.gpuRuns", 0],
      ["contract.negativeBudget.challengerRuns", 0],
      ["contract.negativeBudget.backboneRuns", 0],
      ["contract.negativeBudget.canProduceNewEffects", false],
      ["analysis.metrics.usageDelta.paidApiCalls", 0],
      ["analysis.metrics.usageDelta.externalLlmUsed", false]
    ]
  }
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Invalid experiment index: ${message}`);
  }
}

function assertObject(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`
  );
}

function experimentNumber(experimentId) {
  return Number.parseInt(experimentId.slice(4), 10);
}

function experimentId(number) {
  return `EXP-${String(number).padStart(4, "0")}`;
}

function inclusiveExperimentIds(firstId, lastId) {
  const first = experimentNumber(firstId);
  const last = experimentNumber(lastId);
  assert(first <= last, `${firstId} must not come after ${lastId}`);
  return Array.from(
    { length: last - first + 1 },
    (_, offset) => experimentId(first + offset)
  );
}

function valueAtPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function resolveRepositoryPath(projectRoot, repositoryPath, label) {
  assert(
    typeof repositoryPath === "string" && repositoryPath.length > 0,
    `${label} must be a non-empty repository-relative path`
  );
  assert(!isAbsolute(repositoryPath), `${label} must be repository-relative`);

  const root = resolve(projectRoot);
  const target = resolve(root, repositoryPath);
  const fromRoot = relative(root, target);
  assert(
    fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`),
    `${label} must stay inside the repository`
  );
  return target;
}

async function assertFileExists(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`Invalid experiment index: ${label} does not exist`);
  }
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readArtifact(projectRoot, repositoryPath, label) {
  const path = resolveRepositoryPath(projectRoot, repositoryPath, label);
  const bytes = await readFile(path);
  return {
    path: repositoryPath,
    bytes,
    fileSha256: sha256Bytes(bytes),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

async function git(projectRoot, ...args) {
  const result = await execFileAsync("git", args, {
    cwd: projectRoot,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024
  });
  return Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout);
}

async function gitFileAt(projectRoot, commit, repositoryPath) {
  try {
    return await git(projectRoot, "show", `${commit}:${repositoryPath}`);
  } catch (error) {
    if (error?.code === 128) {
      return null;
    }
    throw error;
  }
}

async function assertGitFileMatches(
  projectRoot,
  commit,
  repositoryPath,
  expectedBytes,
  label
) {
  const bytes = await gitFileAt(projectRoot, commit, repositoryPath);
  assert(bytes !== null, `${label} não existia no commit declarado`);
  assert(bytes.equals(expectedBytes),
    `${label} diverge dos bytes no commit declarado`);
}

async function assertGitFileAbsent(
  projectRoot,
  commit,
  repositoryPath,
  label
) {
  assert(await gitFileAt(projectRoot, commit, repositoryPath) === null,
    `${label} já existia antes da abertura autorizada`);
}

async function assertGitAncestor(projectRoot, ancestor, descendant, label) {
  try {
    await git(projectRoot, "merge-base", "--is-ancestor", ancestor, descendant);
  } catch {
    assert(false, `${label} rompe a cronologia de commits`);
  }
}

async function assertCanonicalReport(entry, projectRoot, index) {
  if (entry.canonicalReport === null) {
    assert(
      entry.status === "active" || entry.status === "planned",
      `${entry.id}.canonicalReport may be null only while active or planned`
    );
    assert(
      entry.authority === "none",
      `${entry.id} cannot have authority before a canonical report`
    );
    if (entry.id === "EXP-0018") {
      assert(entry.evidenceCommit === null,
        "EXP-0018 ativo não pode declarar commit de resultado");
      assert(entry.parallelProbeOutcome === null,
        "EXP-0018 ativo não pode declarar desfecho do probe paralelo");
      const reportPath = resolveRepositoryPath(
        projectRoot,
        EXP0018_CANONICAL_REPORT_PATH,
        "EXP-0018 canonical output"
      );
      let reportExists = true;
      try {
        await access(reportPath);
      } catch {
        reportExists = false;
      }
      assert(!reportExists,
        "EXP-0018 report existe mas ainda está órfão do índice");
    }
    return;
  }

  if (entry.id === "EXP-0018") {
    assert(entry.canonicalReport === EXP0018_CANONICAL_REPORT_PATH,
      "EXP-0018 canonicalReport precisa usar o output único do runner");
    assert(/^[a-f0-9]{40}$/u.test(entry.evidenceCommit ?? ""),
      "EXP-0018 terminal exige evidenceCommit");
  }
  if (entry.id === "EXP-0019") {
    assert(entry.canonicalReport === EXP0019_CANONICAL_REPORT_PATH,
      "EXP-0019 canonicalReport precisa usar o output canônico");
    assert(/^[a-f0-9]{40}$/u.test(entry.evidenceCommit ?? ""),
      "EXP-0019 terminal exige evidenceCommit");
  }
  if (entry.id === "EXP-0020") {
    assert(entry.canonicalReport === EXP0020_CANONICAL_REPORT_PATH,
      "EXP-0020 canonicalReport precisa usar o output canônico");
    assert(/^[a-f0-9]{40}$/u.test(entry.evidenceCommit ?? ""),
      "EXP-0020 terminal exige evidenceCommit");
  }
  if (entry.id === "EXP-0021") {
    assert(entry.canonicalReport === EXP0021_CANONICAL_REPORT_PATH,
      "EXP-0021 canonicalReport precisa usar o output canônico");
    assert(/^[a-f0-9]{40}$/u.test(entry.evidenceCommit ?? ""),
      "EXP-0021 terminal exige evidenceCommit");
  }
  if (entry.id === "EXP-0022") {
    assert(entry.canonicalReport === EXP0022_CANONICAL_REPORT_PATH,
      "EXP-0022 canonicalReport precisa usar o output canônico");
    assert(/^[a-f0-9]{40}$/u.test(entry.evidenceCommit ?? ""),
      "EXP-0022 terminal exige evidenceCommit");
  }

  const path = resolveRepositoryPath(
    projectRoot,
    entry.canonicalReport,
    `${entry.id}.canonicalReport`
  );
  await assertFileExists(path, `${entry.id}.canonicalReport`);

  let report;
  try {
    report = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(
      `Invalid experiment index: ${entry.id}.canonicalReport must be valid JSON`
    );
  }
  const reportId = report?.experimentId;
  assert(
    typeof reportId === "string" &&
      reportId.toUpperCase().startsWith(entry.id),
    `${entry.id}.canonicalReport identifies a different experiment`
  );

  const contract = CANONICAL_REPORT_CONTRACTS[entry.id];
  assert(contract, `${entry.id} has no canonical report contract`);
  let resolvedContract = contract;
  if (contract.outcomes) {
    resolvedContract = contract.outcomes[report?.decision];
    assert(resolvedContract,
      `${entry.id}.canonicalReport has an unregistered outcome`);
  }
  assert(
    entry.status === resolvedContract.status,
    `${entry.id}.status contradicts its canonical report contract`
  );
  assert(
    entry.authority === resolvedContract.authority,
    `${entry.id}.authority contradicts its canonical report contract`
  );
  assert(
    valueAtPath(report, contract.decisionPath) === entry.decision,
    `${entry.id}.decision contradicts its canonical report`
  );
  for (const [assertionPath, expected] of contract.assertions) {
    assert(
      valueAtPath(report, assertionPath) === expected,
      `${entry.id}.canonicalReport violates ${assertionPath}`
    );
  }
  if (entry.id === "EXP-0018") {
    const invalidated = report.decision ===
      "INVALIDATED_SINGLE_DEVELOPMENT_ATTEMPT";
    assert(report.status === resolvedContract.reportStatus,
      "EXP-0018 report status contradicts its outcome");
    assert(report.allGatesPassed === resolvedContract.allGatesPassed,
      "EXP-0018 gate aggregate contradicts its outcome");
    assert(
      resolvedContract.claimRequired
        ? typeof report.claim === "string" && report.claim.length > 0
        : report.claim === null,
      "EXP-0018 claim contradicts its outcome"
    );
    assert(
      invalidated
        ? report.protocol?.canonicalPredictionReportProduced === false &&
          report.protocol?.qualityOutcomeAvailable === false &&
          report.protocol?.retryAuthorized === false &&
          report.protocol?.developmentDatasetReadByInvalidator === false
        : report.protocol?.predictionRuns === 1 &&
          report.protocol?.repeatedDevelopmentPredictionRunPerformed === false,
      "EXP-0018 protocolo contradiz o tipo de fechamento"
    );
    validateExp0018HistoricalOutcome(entry, index, report.decision);
    const paths = {
      config: "eval/experiments/exp-0018-context-observability-v0.1.json",
      catalog: "eval/experiments/exp-0018-context-pairs.pt-BR.v0.1.json",
      fit: "eval/datasets/exp-0018-context-fit-v0.1.json",
      calibration:
        "eval/datasets/exp-0018-context-calibration-v0.1.json",
      development:
        "eval/datasets/exp-0018-context-development-v0.1.json",
      freeze: "eval/commitments/exp-0018-prefit-freeze-v0.1.json",
      instrumentationAudit:
        "eval/commitments/exp-0018-instrumentation-audit-v0.1.json",
      blindSemanticReview:
        "eval/commitments/exp-0018-blind-semantic-review-v0.1.json",
      candidate: "eval/checkpoints/exp-0018-fit-candidate-v0.1.json",
      attestation:
        "eval/commitments/exp-0018-train-attestation-v0.1.json",
      checkpoint: "eval/checkpoints/exp-0018-context-v0.1.json",
      activation:
        "eval/commitments/exp-0018-development-activation-v0.1.json",
      opening:
        "eval/commitments/exp-0018-development-opening-v0.1.json",
      attempt:
        "eval/commitments/exp-0018-development-attempt-v0.1.json",
      report: EXP0018_CANONICAL_REPORT_PATH
    };
    const artifacts = Object.fromEntries(await Promise.all(
      Object.entries(paths).map(async ([name, repositoryPath]) => [
        name,
        await readArtifact(projectRoot, repositoryPath, `EXP-0018.${name}`)
      ]))
    );
    const freeze = artifacts.freeze.value;
    const candidate = artifacts.candidate.value;
    const attestation = artifacts.attestation.value;
    const checkpoint = artifacts.checkpoint.value;
    const activation = artifacts.activation.value;
    const opening = artifacts.opening.value;
    const attempt = artifacts.attempt.value;
    const validations = [
      ["freeze", validateExp0018PrefitFreeze(freeze)],
      ["candidate", validateExp0018FitCandidate(candidate)],
      ["attestation", validateExp0018TrainAttestation(attestation)],
      ["checkpoint", validateExp0018Checkpoint(checkpoint)],
      ["checkpoint calibration", validateExp0018CheckpointAgainstCalibration(
        checkpoint,
        {
          config: artifacts.config.value,
          calibrationDataset: artifacts.calibration.value
        }
      )],
      ["checkpoint chain", validateExp0018CheckpointChain({
        freeze,
        config: artifacts.config.value,
        attestation,
        checkpoint
      })],
      ["activation", validateExp0018DevelopmentActivation(activation)],
      ["opening", validateExp0018DevelopmentOpening(opening)],
      ["attempt", validateExp0018DevelopmentAttempt(attempt)]
    ];
    for (const [name, validation] of validations) {
      assert(validation.valid,
        `EXP-0018 ${name} inválido: ${validation.errors.join("; ")}`);
    }
    const authoritativeCandidate = createExp0018FitCandidate({
      config: artifacts.config.value,
      fitDataset: artifacts.fit.value,
      prefitFreezeSha256: freeze.prefitFreezeSha256,
      configFileSha256: artifacts.config.fileSha256,
      fitDatasetFileSha256: artifacts.fit.fileSha256,
      fitExecutionCommit: attestation.bindings.fitExecutionCommit
    });
    assert(
      authoritativeCandidate.fitCandidateSha256 ===
        candidate.fitCandidateSha256,
      "EXP-0018 candidate diverge do refit autoritativo"
    );
    assert(
      artifacts.config.fileSha256 === freeze.artifacts.config.fileSha256 &&
      `sha256:${canonicalSha256(artifacts.config.value)}` ===
        freeze.artifacts.config.canonicalSha256 &&
      artifacts.catalog.fileSha256 ===
        freeze.artifacts.catalog.fileSha256 &&
      `sha256:${canonicalSha256(artifacts.catalog.value)}` ===
        freeze.artifacts.catalog.canonicalSha256 &&
      artifacts.fit.fileSha256 === freeze.artifacts.fitDataset.fileSha256 &&
      artifacts.fit.value.datasetSha256 ===
        freeze.artifacts.fitDataset.canonicalSha256 &&
      artifacts.calibration.fileSha256 ===
        freeze.artifacts.calibrationDataset.fileSha256 &&
      artifacts.calibration.value.datasetSha256 ===
        freeze.artifacts.calibrationDataset.canonicalSha256 &&
      artifacts.development.fileSha256 ===
        freeze.artifacts.developmentDataset.fileSha256 &&
      artifacts.development.value.datasetSha256 ===
        freeze.artifacts.developmentDataset.canonicalSha256 &&
      artifacts.instrumentationAudit.fileSha256 ===
        freeze.artifacts.instrumentationAudit.fileSha256 &&
      artifacts.instrumentationAudit.value.instrumentationAuditSha256 ===
        freeze.artifacts.instrumentationAudit.canonicalSha256 &&
      artifacts.blindSemanticReview.fileSha256 ===
        freeze.artifacts.blindSemanticReview.fileSha256 &&
      artifacts.blindSemanticReview.value.reviewSha256 ===
        freeze.artifacts.blindSemanticReview.canonicalSha256,
      "EXP-0018 artefatos prefit divergem do freeze"
    );
    assert(
      attestation.bindings.fitCandidateSha256 ===
        candidate.fitCandidateSha256 &&
      attestation.outputs.modelSha256.B0 === candidate.arms.B0.modelSha256 &&
      attestation.outputs.modelSha256.B1 === candidate.arms.B1.modelSha256 &&
      activation.bindings.prefitFreezeFileSha256 ===
        artifacts.freeze.fileSha256 &&
      activation.bindings.prefitFreezeSha256 === freeze.prefitFreezeSha256 &&
      activation.bindings.trainAttestationFileSha256 ===
        artifacts.attestation.fileSha256 &&
      activation.bindings.trainAttestationSha256 ===
        attestation.trainAttestationSha256 &&
      activation.bindings.checkpointFileSha256 ===
        artifacts.checkpoint.fileSha256 &&
      activation.bindings.checkpointSha256 === checkpoint.checkpointSha256 &&
      activation.bindings.configFileSha256 === artifacts.config.fileSha256 &&
      opening.bindings.developmentActivationSha256 ===
        activation.developmentActivationSha256 &&
      opening.bindings.checkpointSha256 === checkpoint.checkpointSha256 &&
      opening.bindings.developmentDatasetFileSha256 ===
        artifacts.development.fileSha256 &&
      opening.bindings.developmentDatasetCanonicalSha256 ===
        artifacts.development.value.datasetSha256 &&
      attempt.bindings.developmentOpeningFileSha256 ===
        artifacts.opening.fileSha256 &&
      attempt.bindings.developmentOpeningSha256 ===
        opening.developmentOpeningSha256 &&
      attempt.bindings.checkpointSha256 === checkpoint.checkpointSha256 &&
      (invalidated || attempt.attempt.preflightCommit ===
        report.bindings.developmentExecutionCommit),
      "EXP-0018 cadeia de artefatos divergiu"
    );
    const commonReportInput = {
      config: artifacts.config.value,
      prefitFreezeSha256: freeze.prefitFreezeSha256,
      developmentActivationFileSha256: artifacts.activation.fileSha256,
      developmentActivationSha256:
        activation.developmentActivationSha256,
      developmentOpeningFileSha256: artifacts.opening.fileSha256,
      developmentOpeningSha256: opening.developmentOpeningSha256,
      developmentAttemptFileSha256: artifacts.attempt.fileSha256,
      developmentAttemptSha256: attempt.developmentAttemptSha256,
      configFileSha256: artifacts.config.fileSha256,
      developmentDatasetFileSha256: artifacts.development.fileSha256,
      filesystemBoundary: report.filesystemBoundary
    };
    const validation = invalidated
      ? validateExp0018DevelopmentInvalidation(report, {
        ...commonReportInput,
        checkpointSha256: checkpoint.checkpointSha256,
        developmentDatasetCanonicalSha256:
          artifacts.development.value.datasetSha256,
        invalidationExecutionCommit:
          report.bindings.invalidationExecutionCommit
      })
      : validateExp0018DevelopmentReport(report, {
        ...commonReportInput,
        checkpoint,
        developmentDataset: artifacts.development.value,
        developmentExecutionCommit:
          report.bindings.developmentExecutionCommit
      });
    assert(validation.valid,
      `EXP-0018 canonical report failed validation: ` +
      validation.errors.join("; "));
    for (const source of freeze.criticalSources) {
      const sourceBytes = await gitFileAt(
        projectRoot,
        freeze.runnerSourceCommit,
        source.path
      );
      assert(
        sourceBytes !== null && sha256Bytes(sourceBytes) === source.fileSha256,
        `EXP-0018 fonte congelada não corresponde ao commit: ${source.path}`
      );
    }
    const commits = [
      freeze.runnerSourceCommit,
      attestation.bindings.fitExecutionCommit,
      checkpoint.bindings.calibrationExecutionCommit,
      activation.checkpointSourceCommit,
      opening.opening.openingExecutionCommit,
      attempt.attempt.preflightCommit,
      ...(invalidated
        ? [report.bindings.invalidationExecutionCommit]
        : []),
      entry.evidenceCommit
    ];
    for (let position = 1; position < commits.length; position += 1) {
      await assertGitAncestor(
        projectRoot,
        commits[position - 1],
        commits[position],
        `EXP-0018 commit ${position}`
      );
    }
    const headCommit = (await git(projectRoot, "rev-parse", "HEAD"))
      .toString("utf8").trim();
    await assertGitAncestor(
      projectRoot,
      entry.evidenceCommit,
      headCommit,
      "EXP-0018 evidenceCommit→HEAD"
    );
    await assertGitFileAbsent(projectRoot, freeze.runnerSourceCommit,
      paths.freeze, "freeze");
    for (const name of [
      "config",
      "catalog",
      "fit",
      "calibration",
      "development",
      "instrumentationAudit",
      "blindSemanticReview"
    ]) {
      await assertGitFileMatches(
        projectRoot,
        freeze.runnerSourceCommit,
        paths[name],
        artifacts[name].bytes,
        `prefit ${name}`
      );
    }
    await assertGitFileMatches(projectRoot,
      attestation.bindings.fitExecutionCommit,
      paths.freeze, artifacts.freeze.bytes, "freeze");
    await assertGitFileAbsent(projectRoot,
      attestation.bindings.fitExecutionCommit,
      paths.candidate, "candidate");
    await assertGitFileAbsent(projectRoot,
      attestation.bindings.fitExecutionCommit,
      paths.attestation, "attestation");
    await assertGitFileMatches(projectRoot,
      checkpoint.bindings.calibrationExecutionCommit,
      paths.candidate, artifacts.candidate.bytes, "candidate");
    await assertGitFileMatches(projectRoot,
      checkpoint.bindings.calibrationExecutionCommit,
      paths.attestation, artifacts.attestation.bytes, "attestation");
    await assertGitFileAbsent(projectRoot,
      checkpoint.bindings.calibrationExecutionCommit,
      paths.checkpoint, "checkpoint");
    await assertGitFileMatches(projectRoot, activation.checkpointSourceCommit,
      paths.checkpoint, artifacts.checkpoint.bytes, "checkpoint");
    await assertGitFileAbsent(projectRoot, activation.checkpointSourceCommit,
      paths.activation, "activation");
    await assertGitFileMatches(projectRoot,
      opening.opening.openingExecutionCommit,
      paths.activation, artifacts.activation.bytes, "activation");
    await assertGitFileAbsent(projectRoot,
      opening.opening.openingExecutionCommit,
      paths.opening, "opening");
    await assertGitFileMatches(projectRoot,
      attempt.attempt.preflightCommit,
      paths.opening, artifacts.opening.bytes, "opening");
    await assertGitFileAbsent(projectRoot,
      attempt.attempt.preflightCommit,
      paths.attempt, "development attempt");
    await assertGitFileAbsent(projectRoot,
      attempt.attempt.preflightCommit,
      paths.report, "development report");
    if (invalidated) {
      await assertGitFileMatches(
        projectRoot,
        report.bindings.invalidationExecutionCommit,
        paths.attempt,
        artifacts.attempt.bytes,
        "committed invalidated attempt"
      );
      await assertGitFileAbsent(
        projectRoot,
        report.bindings.invalidationExecutionCommit,
        paths.report,
        "invalidation report"
      );
    }
    await assertGitFileMatches(projectRoot, entry.evidenceCommit,
      paths.attempt, artifacts.attempt.bytes, "development attempt");
    await assertGitFileMatches(projectRoot, entry.evidenceCommit,
      paths.report, artifacts.report.bytes, "development report");
  }
  if (entry.id === "EXP-0019") {
    const core = structuredClone(report);
    delete core.reportSha256;
    assert(
      report.reportSha256 === `sha256:${canonicalSha256(core)}`,
      "EXP-0019 reportSha256 diverge do conteúdo canônico"
    );
    const headCommit = (await git(projectRoot, "rev-parse", "HEAD"))
      .toString("utf8").trim();
    await assertGitAncestor(
      projectRoot,
      entry.evidenceCommit,
      headCommit,
      "EXP-0019 evidenceCommit→HEAD"
    );
    await assertGitFileMatches(
      projectRoot,
      entry.evidenceCommit,
      EXP0019_CANONICAL_REPORT_PATH,
      await readFile(path),
      "EXP-0019 canonical report"
    );
  }
  if (entry.id === "EXP-0020") {
    const core = structuredClone(report);
    delete core.reportSha256;
    assert(
      report.reportSha256 === `sha256:${canonicalSha256(core)}`,
      "EXP-0020 reportSha256 diverge do conteúdo canônico"
    );
    const headCommit = (await git(projectRoot, "rev-parse", "HEAD"))
      .toString("utf8").trim();
    await assertGitAncestor(
      projectRoot,
      entry.evidenceCommit,
      headCommit,
      "EXP-0020 evidenceCommit→HEAD"
    );
    await assertGitFileMatches(
      projectRoot,
      entry.evidenceCommit,
      EXP0020_CANONICAL_REPORT_PATH,
      await readFile(path),
      "EXP-0020 canonical report"
    );
  }
  if (entry.id === "EXP-0021") {
    const navigations = report.campaign?.workerEnvelope?.campaign?.navigations;
    assert(
      Array.isArray(navigations) && navigations.length === 2 &&
        navigations.every((navigation) =>
          Array.isArray(navigation.networkRequests) &&
          navigation.networkRequests.filter((request) =>
            request.method === "GET" &&
            request.url === "http://localhost:4173/api/health"
          ).length === 2
        ),
      "EXP-0021 precisa preservar dois health GETs observados por navegação"
    );
    assert(
      Array.isArray(report.analysis?.units) &&
        report.analysis.units.length === 4 &&
        report.analysis.units.every((unit) =>
          unit.captureQualified === true && unit.byteIdentity === true
        ),
      "EXP-0021 precisa preservar as quatro capturas avaliadas"
    );
    const core = structuredClone(report);
    delete core.reportSha256;
    assert(
      report.reportSha256 === `sha256:${canonicalSha256(core)}`,
      "EXP-0021 reportSha256 diverge do conteúdo canônico"
    );
    const headCommit = (await git(projectRoot, "rev-parse", "HEAD"))
      .toString("utf8").trim();
    await assertGitAncestor(
      projectRoot,
      entry.evidenceCommit,
      headCommit,
      "EXP-0021 evidenceCommit→HEAD"
    );
    await assertGitFileMatches(
      projectRoot,
      entry.evidenceCommit,
      EXP0021_CANONICAL_REPORT_PATH,
      await readFile(path),
      "EXP-0021 canonical report"
    );
  }
  if (entry.id === "EXP-0022") {
    const navigations = report.campaign?.workerEnvelope?.campaign?.navigations;
    const requests = Array.isArray(navigations)
      ? navigations.flatMap((navigation) => navigation.networkRequests ?? [])
      : [];
    assert(
      Array.isArray(navigations) && navigations.length === 2 &&
        navigations.every((navigation) =>
          Array.isArray(navigation.networkRequests) &&
          navigation.networkRequests.filter((request) => {
            try {
              return request.method === "GET" &&
                new URL(request.url).pathname === "/api/health";
            } catch {
              return false;
            }
          }).length === 2
        ),
      "EXP-0022 precisa preservar dois health GETs por navegação"
    );
    assert(
      requests.length === 40 && requests.every((request) =>
        request.tracksLoadingLifecycle === true &&
        request.requestOrdinal < request.responseOrdinal &&
        request.responseOrdinal < request.finishedOrdinal &&
        request.timestamp <= request.responseTimestamp &&
        request.timestamp <= request.finishedTimestamp &&
        request.responseTimestamp > request.finishedTimestamp
      ),
      "EXP-0022 precisa preservar 40 inversões de timestamp sob ordinais válidos"
    );
    assert(
      Array.isArray(report.analysis?.units) &&
        report.analysis.units.length === 4 &&
        report.analysis.units.every((unit) =>
          unit.captureQualified === true && unit.byteIdentity === true
        ),
      "EXP-0022 precisa preservar as quatro capturas avaliadas"
    );
    const core = structuredClone(report);
    delete core.reportSha256;
    assert(
      report.reportSha256 === `sha256:${canonicalSha256(core)}`,
      "EXP-0022 reportSha256 diverge do conteúdo canônico"
    );
    const headCommit = (await git(projectRoot, "rev-parse", "HEAD"))
      .toString("utf8").trim();
    await assertGitAncestor(
      projectRoot,
      entry.evidenceCommit,
      headCommit,
      "EXP-0022 evidenceCommit→HEAD"
    );
    await assertGitFileMatches(
      projectRoot,
      entry.evidenceCommit,
      EXP0022_CANONICAL_REPORT_PATH,
      await readFile(path),
      "EXP-0022 canonical report"
    );
  }
}

function validateEntryShape(entry, index) {
  assertObject(entry, `entries[${index}]`);
  assert(
    typeof entry.id === "string" && EXPERIMENT_ID_PATTERN.test(entry.id),
    `entries[${index}].id must match EXP-0000`
  );
  assert(
    STATUS_SET.has(entry.status),
    `${entry.id}.status is invalid: ${String(entry.status)}`
  );
  assert(
    AUTHORITY_SET.has(entry.authority),
    `${entry.id}.authority is invalid: ${String(entry.authority)}`
  );
  assert(
    typeof entry.decision === "string" && entry.decision.length > 0,
    `${entry.id}.decision must be a non-empty string`
  );
  assert(
    typeof entry.criticalPath === "boolean",
    `${entry.id}.criticalPath must be boolean`
  );
  assert(
    Array.isArray(entry.cleanCloneChecks) &&
      entry.cleanCloneChecks.every(
        (command) => typeof command === "string" && command.length > 0
      ),
    `${entry.id}.cleanCloneChecks must contain only non-empty strings`
  );
  assert(
    Array.isArray(entry.localReproductionCommands) &&
      entry.localReproductionCommands.every(
        (command) => typeof command === "string" && command.length > 0
      ),
    `${entry.id}.localReproductionCommands must contain only non-empty strings`
  );
  assert(
    Array.isArray(entry.supersedes) &&
      entry.supersedes.every(
        (experimentId) =>
          typeof experimentId === "string" &&
          EXPERIMENT_ID_PATTERN.test(experimentId)
      ),
    `${entry.id}.supersedes must contain only experiment IDs`
  );
  assert(
    typeof entry.nextDecision === "string" && entry.nextDecision.length > 0,
    `${entry.id}.nextDecision must be a non-empty string`
  );
  if (entry.id === "EXP-0018") {
    assert(
      entry.evidenceCommit === null ||
        /^[a-f0-9]{40}$/u.test(entry.evidenceCommit),
      "EXP-0018.evidenceCommit precisa ser null ou commit completo"
    );
    assert(
      entry.parallelProbeOutcome === null ||
        (typeof entry.parallelProbeOutcome === "object" &&
          !Array.isArray(entry.parallelProbeOutcome) &&
          typeof entry.parallelProbeOutcome.status === "string" &&
          typeof entry.parallelProbeOutcome.decision === "string" &&
          entry.parallelProbeOutcome.decision.length > 0),
      "EXP-0018.parallelProbeOutcome é inválido"
    );
  }
  if (entry.id === "EXP-0019") {
    assert(
      entry.evidenceCommit === null ||
        /^[a-f0-9]{40}$/u.test(entry.evidenceCommit),
      "EXP-0019.evidenceCommit precisa ser null ou commit completo"
    );
  }
  if (entry.id === "EXP-0020") {
    assert(
      entry.evidenceCommit === null ||
        /^[a-f0-9]{40}$/u.test(entry.evidenceCommit),
      "EXP-0020.evidenceCommit precisa ser null ou commit completo"
    );
  }
  if (entry.id === "EXP-0021") {
    assert(
      entry.evidenceCommit === null ||
        /^[a-f0-9]{40}$/u.test(entry.evidenceCommit),
      "EXP-0021.evidenceCommit precisa ser null ou commit completo"
    );
  }
}

export async function validateExperimentIndex(index, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  assertObject(index, "root");
  assert(
    index.schemaVersion === EXPERIMENT_INDEX_SCHEMA_VERSION,
    `schemaVersion must be ${EXPERIMENT_INDEX_SCHEMA_VERSION}`
  );
  assert(
    typeof index.updatedAt === "string" &&
      Number.isFinite(Date.parse(index.updatedAt)),
    "updatedAt must be an ISO-compatible timestamp"
  );
  assert(
    index.transitionState === "active" ||
      index.transitionState === "terminal-awaiting-next-registration",
    "transitionState is invalid"
  );

  assertObject(index.coverage, "coverage");
  assert(
    typeof index.coverage.canonicalDecisionEntriesFrom === "string" &&
      EXPERIMENT_ID_PATTERN.test(index.coverage.canonicalDecisionEntriesFrom),
    "coverage.canonicalDecisionEntriesFrom must be an experiment ID"
  );
  assert(
    typeof index.coverage.legacyRange === "string" &&
      EXPERIMENT_RANGE_PATTERN.test(index.coverage.legacyRange),
    "coverage.legacyRange must be an inclusive experiment range"
  );
  assert(
    Array.isArray(index.coverage.legacyExperimentDocs) &&
      index.coverage.legacyExperimentDocs.length > 0,
    "coverage.legacyExperimentDocs must not be empty"
  );
  const legacyRangeMatch = index.coverage.legacyRange.match(
    EXPERIMENT_RANGE_PATTERN
  );
  const expectedLegacyIds = inclusiveExperimentIds(
    legacyRangeMatch[1],
    legacyRangeMatch[2]
  );
  assert(
    experimentNumber(index.coverage.canonicalDecisionEntriesFrom) ===
      experimentNumber(legacyRangeMatch[2]) + 1,
    "canonical decision coverage must begin immediately after legacyRange"
  );
  const legacyDocIds = [];
  for (const [position, repositoryPath] of
    index.coverage.legacyExperimentDocs.entries()) {
    const path = resolveRepositoryPath(
      projectRoot,
      repositoryPath,
      `coverage.legacyExperimentDocs[${position}]`
    );
    await assertFileExists(
      path,
      `coverage.legacyExperimentDocs[${position}]`
    );
    const idMatch = repositoryPath.match(
      /(?:^|\/)(EXP-\d{4})-[^/]+\.md$/u
    );
    assert(
      idMatch,
      `coverage.legacyExperimentDocs[${position}] must identify an experiment`
    );
    legacyDocIds.push(idMatch[1]);
  }
  assert(
    JSON.stringify(legacyDocIds) === JSON.stringify(expectedLegacyIds),
    "legacyExperimentDocs must cover legacyRange exactly and in order"
  );

  assertObject(index.currentBaseline, "currentBaseline");
  assert(
    typeof index.currentBaseline.id === "string" &&
      index.currentBaseline.id.length > 0,
    "currentBaseline.id must be a non-empty string"
  );
  const baselinePath = resolveRepositoryPath(
    projectRoot,
    index.currentBaseline.manifest,
    "currentBaseline.manifest"
  );
  await assertFileExists(baselinePath, "currentBaseline.manifest");
  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  } catch {
    throw new Error(
      "Invalid experiment index: currentBaseline.manifest must be valid JSON"
    );
  }
  assert(
    baseline?.id === index.currentBaseline.id,
    "currentBaseline.id must match its manifest"
  );

  assert(
    typeof index.currentCriticalPath === "string" &&
      EXPERIMENT_ID_PATTERN.test(index.currentCriticalPath),
    "currentCriticalPath must be an experiment ID"
  );
  assertObject(index.currentParallelProbe, "currentParallelProbe");
  assert(
    typeof index.currentParallelProbe.id === "string" &&
      EXPERIMENT_TRACK_ID_PATTERN.test(index.currentParallelProbe.id),
    "currentParallelProbe.id must be an experiment track ID"
  );
  assert(
    index.currentParallelProbe.id === `${index.currentCriticalPath}-R`,
    "currentParallelProbe.id must be the R track of currentCriticalPath"
  );
  assert(
    index.currentParallelProbe.parent === index.currentCriticalPath,
    "currentParallelProbe.parent must match currentCriticalPath"
  );
  assert(
    index.currentParallelProbe.status === "active" ||
      index.currentParallelProbe.status === "planned" ||
      index.currentParallelProbe.status === "deferred" ||
      index.currentParallelProbe.status === "cut",
    "currentParallelProbe.status must be active, planned, deferred or cut"
  );
  assert(
    index.currentParallelProbe.blocking === false,
    "currentParallelProbe must be non-blocking"
  );
  assert(
    index.currentParallelProbe.authority === "none",
    "currentParallelProbe must have zero authority"
  );
  const probePreRegistration = resolveRepositoryPath(
    projectRoot,
    index.currentParallelProbe.preRegistration,
    "currentParallelProbe.preRegistration"
  );
  await assertFileExists(
    probePreRegistration,
    "currentParallelProbe.preRegistration"
  );
  assert(
    typeof index.currentParallelProbe.decision === "string" &&
      index.currentParallelProbe.decision.length > 0,
    "currentParallelProbe.decision must be a non-empty string"
  );
  assert(Array.isArray(index.entries), "entries must be an array");
  assert(index.entries.length > 0, "entries must not be empty");

  index.entries.forEach(validateEntryShape);
  const ids = index.entries.map((entry) => entry.id);
  assert(
    new Set(ids).size === ids.length,
    "experiment IDs must be unique"
  );
  const expectedIds = inclusiveExperimentIds(
    index.coverage.canonicalDecisionEntriesFrom,
    index.currentCriticalPath
  );
  assert(
    JSON.stringify(ids) === JSON.stringify(expectedIds),
    "entries must cover the canonical decision range exactly and in order"
  );

  const criticalEntries = index.entries.filter((entry) => entry.criticalPath);
  assert(
    criticalEntries.length === 1,
    `exactly one critical path is required; found ${criticalEntries.length}`
  );
  assert(
    criticalEntries[0].id === index.currentCriticalPath,
    "currentCriticalPath must match the entry marked criticalPath"
  );
  assert(
    criticalEntries[0].status === "active" ||
      criticalEntries[0].status === "planned" ||
      (criticalEntries[0].canonicalReport !== null &&
        (criticalEntries[0].status === "completed" ||
          criticalEntries[0].status === "cut" ||
          criticalEntries[0].status === "invalidated")),
    "currentCriticalPath must be active/planned or just terminally reported"
  );
  const criticalIsTerminal =
    criticalEntries[0].canonicalReport !== null &&
    (criticalEntries[0].status === "completed" ||
      criticalEntries[0].status === "cut" ||
      criticalEntries[0].status === "invalidated");
  assert(
    index.transitionState === (criticalIsTerminal
      ? "terminal-awaiting-next-registration"
      : "active"),
    "transitionState contradicts currentCriticalPath"
  );
  assert(
    index.currentParallelProbe.status !== "cut" || criticalIsTerminal,
    "parallel probe may be cut only after terminal evidence"
  );

  const knownIds = new Set(ids);
  for (const entry of index.entries) {
    if (entry.id !== index.currentCriticalPath) {
      assert(
        entry.status !== "active" && entry.status !== "planned" &&
          entry.canonicalReport !== null,
        `${entry.id} não pode permanecer aberto fora do caminho crítico`
      );
    }
    assert(
      !entry.supersedes.includes(entry.id),
      `${entry.id} cannot supersede itself`
    );
    for (const supersededId of entry.supersedes) {
      assert(
        knownIds.has(supersededId),
        `${entry.id}.supersedes references unknown ${supersededId}`
      );
    }
    if (entry.canonicalReport !== null) {
      assert(
        entry.cleanCloneChecks.length > 0,
        `${entry.id} must provide at least one clean-clone check`
      );
      for (const command of entry.cleanCloneChecks) {
        const commandMatch = command.match(
          /^node --test (tests\/[A-Za-z0-9._-]+\.test\.mjs)$/u
        );
        assert(
          commandMatch,
          `${entry.id}.cleanCloneChecks must be direct Node test commands`
        );
        const testPath = resolveRepositoryPath(
          projectRoot,
          commandMatch[1],
          `${entry.id}.cleanCloneChecks`
        );
        await assertFileExists(testPath, `${entry.id}.cleanCloneChecks`);
      }
    }
    await assertCanonicalReport(entry, projectRoot, index);
  }

  return index;
}

export async function readExperimentIndex(path, options = {}) {
  const indexPath = resolve(path);
  let index;
  try {
    index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read experiment index at ${indexPath}`, {
      cause: error
    });
  }
  return validateExperimentIndex(index, {
    projectRoot: options.projectRoot ?? resolve(dirname(indexPath), "..")
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const indexPath = resolve(
    process.argv[2] ?? "eval/EXPERIMENT_INDEX.json"
  );
  const index = await readExperimentIndex(indexPath);
  const canonicalReports = index.entries.filter(
    ({ canonicalReport }) => canonicalReport !== null
  ).length;
  process.stdout.write(
    `Experiment index PASS: indexed=${index.entries.length}, ` +
      `canonicalReports=${canonicalReports}, ` +
      `critical=${index.currentCriticalPath}, ` +
      `parallel=${index.currentParallelProbe.id}\n`
  );
}
