import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  validateTimingCalibrationPack
} from "../src/eval/calibration/blind-session.mjs";
import {
  canonicalSha256
} from "../src/eval/factory/canonical-hash.mjs";
import {
  validateSpeakerRelevanceDataset
} from "../src/eval/speaker-relevance-dataset.mjs";
import {
  evaluateHumanSpeakerRelevanceAnchors
} from "../src/eval/speaker-relevance-human-anchor.mjs";
import {
  validateSpeakerRelevanceCheckpoint
} from "../web/speaker-relevance-shadow.mjs";
import {
  trainExp0016
} from "./train-exp-0016-speaker-relevance.mjs";
import {
  validateExp0016BrowserReport,
  validateExp0016CanonicalReport
} from "./lib/exp-0016-analysis.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  config: "eval/experiments/exp-0016-speaker-relevance-m4b.pt-BR.json",
  dataset: "eval/datasets/exp-0016-speaker-relevance-v0.1.json",
  checkpoint: "web/speaker-relevance-checkpoint.json",
  offline: "eval/generated/exp-0016/offline-training-report.json",
  browser: "eval/generated/exp-0016/browser-shadow-report.json",
  calibrationPack: "eval/calibration/exp-0015-timing-pack-v0.2.json",
  calibrationReport:
    "eval/reports/exp-0015-timing-calibration-instrument-v4.json",
  out: "eval/reports/exp-0016-speaker-relevance-m4b-v1.json"
});

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const allowed = Object.keys(DEFAULTS).map((name) =>
      `--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`
    );
    if (!allowed.includes(argument)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const name = argument.slice(2).replace(
      /-([a-z])/gu,
      (_, letter) => letter.toUpperCase()
    );
    options[name] = args[++index];
  }
  return options;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readJson(relativePath) {
  const bytes = await readFile(resolve(PROJECT_ROOT, relativePath));
  return {
    path: relativePath,
    bytes,
    sha256: sha256(bytes),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

async function writeOrCheck(path, value, check) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== content) {
      throw new Error(`relatório ausente ou divergente: ${path}`);
    }
    return;
  }
  await writeFile(path, content);
}

export async function reportExp0016(options = {}) {
  const paths = { ...DEFAULTS, ...options };
  const [
    config,
    dataset,
    checkpoint,
    offline,
    browser,
    calibrationPack,
    calibration
  ] =
    await Promise.all([
      readJson(paths.config),
      readJson(paths.dataset),
      readJson(paths.checkpoint),
      readJson(paths.offline),
      readJson(paths.browser),
      readJson(paths.calibrationPack),
      readJson(paths.calibrationReport)
    ]);
  const datasetValidation = validateSpeakerRelevanceDataset(dataset.value);
  const checkpointValidation = validateSpeakerRelevanceCheckpoint(
    checkpoint.value
  );
  const packValidation = validateTimingCalibrationPack(
    calibrationPack.value
  );
  const reproduced = await trainExp0016({
    config: paths.config,
    dataset: paths.dataset,
    out: paths.checkpoint,
    report: paths.offline
  });
  const checkpointReproduced = isDeepStrictEqual(
    reproduced.checkpoint,
    checkpoint.value
  );
  const offlineReportReproduced = isDeepStrictEqual(
    reproduced.report,
    offline.value
  );
  const human = await evaluateHumanSpeakerRelevanceAnchors({
    pack: calibrationPack.value,
    aggregate: calibration.value.aggregate,
    checkpoint: checkpoint.value,
    readArtifact: (path) => readFile(resolve(PROJECT_ROOT, path))
  });
  const humanGates = {
    minimumResolvedAnchors: human.anchors >= 9,
    calibrationNeverUsedForFit:
      human.rawHumanRecordsUsedForFit === 0 &&
      dataset.value.calibration.fitExamples === 0,
    actionVariantCausalWindowsInvariant:
      human.actionVariantCausalWindowsInvariant,
    zeroFutureSamples: human.futureSamplesUsed === 0,
    gainOverBaseline:
      human.gains.safeVetoScenes >=
        config.value.gates.minimumHumanAnchorGainScenes,
    directedRecallForAuthority:
      human.candidate.safeVeto.classRecall.DIRECTED_TO_ASSISTANT >=
        config.value.gates.minimumHumanDirectedRecallForAuthority
  };
  const browserGates = {
    reportValid: validateExp0016BrowserReport(browser.value, {
      experimentId: config.value.id,
      datasetSha256: dataset.value.datasetSha256,
      modelSha256: checkpoint.value.modelSha256
    }).valid,
    experimentBound:
      browser.value.experimentId === config.value.id &&
      browser.value.dataset.sha256 === dataset.value.datasetSha256,
    checkpointBound:
      browser.value.checkpoint.modelSha256 === checkpoint.value.modelSha256,
    fourDistinctCases:
      browser.value.metrics.cases === 4 &&
      browser.value.gates.fourRuntimeCases === true &&
      browser.value.gates.distinctAudio === true,
    zeroFutureSamples:
      browser.value.metrics.maximumFutureSamplesUsed === 0 &&
      browser.value.gates.causal === true,
    nodeBrowserParity: browser.value.gates.nodeBrowserParity === true,
    zeroAuthority:
      browser.value.authorityEligible === false &&
      browser.value.gates.noAuthority === true,
    zeroFitExamples: browser.value.dataset.fitExamplesFromBrowserProbes === 0
  };
  const evidenceGates = {
    datasetValid: datasetValidation.valid,
    calibrationPackValid: packValidation.valid,
    calibrationCampaignComplete:
      calibration.value.campaignComplete === true &&
      calibration.value.aggregate.readyForDirectModelFit === false,
    calibrationBinding:
      calibration.value.aggregate.packSha256 ===
        config.value.calibration.packSha256 &&
      calibration.value.aggregate.scoring.preferenceResolution.rubricId ===
        config.value.calibration.resolutionRubricId,
    checkpointValid: checkpointValidation.valid,
    checkpointModelHashBound:
      `sha256:${canonicalSha256(checkpoint.value.model)}` ===
        checkpoint.value.modelSha256,
    checkpointReproduced,
    offlineReportReproduced,
    offlineShadowCapacity: offline.value.shadowCandidatePass === true,
    ...Object.fromEntries(Object.entries(humanGates).map(
      ([name, value]) => [`human.${name}`, value]
    )),
    ...Object.fromEntries(Object.entries(browserGates).map(
      ([name, value]) => [`browser.${name}`, value]
    ))
  };
  const shadowCandidateReady = Object.values(evidenceGates).every(Boolean);
  const authorityBlockers = [
    ...(offline.value.safeVetoOfflineReady
      ? []
      : ["veto conservador não passa todos os gates procedurais"]),
    "os quatro probes de navegador validam o contrato, mas não têm rótulo humano de relevância",
    "nenhuma decisão aprendida possui efeitos no runtime"
  ];
  const report = {
    schemaVersion: "exp-0016-speaker-relevance-m4b-report-v1",
    experimentId: config.value.id,
    question:
      "Uma capacidade acústica causal estreita supera a regra que trata " +
      "toda fala como dirigida sem receber autoridade prematura?",
    decision: shadowCandidateReady
      ? "promote-m4b-speaker-relevance-shadow-candidate"
      : "hold-m4b-speaker-relevance-candidate",
    pass: shadowCandidateReady,
    shadowCandidateReady,
    safeVetoOfflineReady: offline.value.safeVetoOfflineReady,
    authorityEligible: false,
    gates: evidenceGates,
    humanGates,
    browserGates,
    metrics: {
      dataset: {
        examples: dataset.value.examples.length,
        sourceClips: dataset.value.source.selectedClips,
        trainExamples: dataset.value.splits.train.examples,
        developmentExamples: dataset.value.splits.development.examples,
        holdoutExamples: dataset.value.splits.holdout.examples,
        humanFitExamples: dataset.value.calibration.fitExamples
      },
      offline: offline.value.metrics,
      humanAnchor: human,
      browserShadow: browser.value.metrics
    },
    evidence: {
      config: { path: config.path, sha256: config.sha256 },
      dataset: {
        path: dataset.path,
        fileSha256: dataset.sha256,
        datasetSha256: dataset.value.datasetSha256
      },
      checkpoint: {
        path: checkpoint.path,
        fileSha256: checkpoint.sha256,
        modelSha256: checkpoint.value.modelSha256
      },
      offlineReport: { path: offline.path, sha256: offline.sha256 },
      browserReport: { path: browser.path, sha256: browser.sha256 },
      calibrationPack: {
        path: calibrationPack.path,
        fileSha256: calibrationPack.sha256,
        packSha256: calibrationPack.value.packSha256
      },
      calibrationReport: {
        path: calibration.path,
        sha256: calibration.sha256
      }
    },
    promoted: shadowCandidateReady
      ? "capacidade M4b estreita de relevância da fala em shadow"
      : "nenhuma capacidade aprendida",
    notPromoted: [
      "autoridade para continuar falando diante de voz humana",
      "generalização ampla por falante, gênero, sala ou conteúdo",
      "detecção semântica de correção ou backchannel",
      "qualidade full-duplex de produto"
    ],
    authorityBlockers,
    nextExperiment:
      "Melhorar a calibração do veto conservador em famílias acústicas mais " +
      "diversas, congelar novo holdout e só então reavaliar autoridade limitada.",
    limitations: [
      ...offline.value.limitations,
      "o ganho humano é um reencontro pequeno de nove cenas, não validação de produto",
      "a mesma calibração orientou as famílias procedurais e serve apenas como âncora de avaliação; não é holdout independente de formulação",
      "a baseline é deliberadamente simples e representa a regra atual, não o estado da arte",
      "os quatro probes no Chrome validam integração e paridade, não qualidade perceptiva"
    ],
    paidApiCalls: 0
  };
  const reportValidation = validateExp0016CanonicalReport(report);
  if (!reportValidation.valid) {
    throw new Error(
      `relatório EXP-0016 inválido: ${reportValidation.errors.join("; ")}`
    );
  }
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await reportExp0016(options);
  await writeOrCheck(
    resolve(PROJECT_ROOT, options.out),
    report,
    options.check
  );
  console.log(
    `EXP-0016 relatório ${report.pass ? "SHADOW PASS" : "HOLD"}: ` +
      `holdout=${report.metrics.offline.holdout.candidate.raw.accuracy}, ` +
      `humano=${report.metrics.humanAnchor.candidate.safeVeto.accuracy}, ` +
      `baselineHumana=${report.metrics.humanAnchor.baseline.accuracy}, ` +
      `autoridade=${report.authorityEligible}`
  );
  if (!report.pass) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
