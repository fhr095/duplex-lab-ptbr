import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  evaluateExp0007
} from "./lib/exp-0007-analysis.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  controlWebsocket:
    "eval/reports/exp-0007-control-websocket.json",
  controlBrowser:
    "eval/reports/exp-0007-control-browser.json",
  challengerWebsocket:
    "eval/reports/exp-0007-challenger-websocket.json",
  challengerBrowser:
    "eval/reports/exp-0007-challenger-browser.json",
  out: "eval/reports/exp-0007-screening-latest.json",
  summaryOut: "eval/reports/exp-0007-screening-v1.json"
});

function parseArgs(args) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const field = argument.slice(2).replace(
      /-([a-z])/gu,
      (_, letter) => letter.toUpperCase()
    );
    if (!(field in options)) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    options[field] = args[++index];
  }
  return options;
}

async function readReport(path) {
  const bytes = await readFile(resolve(PROJECT_ROOT, path));
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

function compactPolicy(policy) {
  return {
    policy: policy.policy,
    observations: policy.counts.websocket + policy.counts.chrome,
    complete: policy.complete,
    runtimeComparable: policy.runtimeComparable,
    sourceParity: policy.sourceParity,
    zeroPaidApiCalls: policy.zeroPaidApiCalls,
    browserOutcomeCounts: policy.counts,
    unsafeBrowserOutcomes: policy.browserOutcomes.filter(
      (item) => item.category === "unsafe"
    ),
    latency: policy.latency,
    finalPcmCrossPath: policy.hashParity,
    instrumentation: policy.instrumentation,
    regression: policy.regression
  };
}

function compactReport(report, inputReports) {
  const runtimeFingerprints = [
    inputReports.controlWebsocket.value,
    inputReports.controlBrowser.value,
    inputReports.challengerWebsocket.value,
    inputReports.challengerBrowser.value
  ].map((item) => item.runtime?.currentRuntimeFingerprint?.sha256);
  return {
    schemaVersion: 1,
    experimentId: report.experimentId,
    evidenceLevel: "development-screening",
    generatedAt: report.generatedAt,
    matrix: {
      cases: 5,
      policies: 2,
      paths: ["websocket", "windows-chrome-cdp"],
      repetitionsPerCell: report.screening.repetitionsPerCell,
      observations: report.screening.expectedObservations
    },
    runtime: {
      fingerprintAlgorithm:
        inputReports.controlWebsocket.value.runtime
          ?.currentRuntimeFingerprint?.algorithm,
      sha256: runtimeFingerprints[0],
      allInputsComparable:
        runtimeFingerprints.every(
          (fingerprint) => fingerprint === runtimeFingerprints[0]
        )
    },
    screening: report.screening,
    control: compactPolicy(report.control),
    challenger: compactPolicy(report.challenger),
    interpretation: {
      promoted: false,
      confirmationCampaignAuthorized: false,
      runtimeDefault: "linguistic-complete",
      retainedExperimentalFlag: "acoustic-eager-fixed-boundary",
      decisiveFinding:
        "O challenger tornou o PCM final determinístico nos cinco casos, mas confirmou R$ 150 em uma repetição cujo valor corrente era R$ 1.150.",
      nextDecision:
        "Avaliar um verificador ASR independente e sem autoridade para slots numéricos críticos; não otimizar latência nem promover a fronteira antes de fechar segurança."
    },
    provenance: report.provenance
  };
}

const options = parseArgs(process.argv.slice(2));
const [
  controlWebsocket,
  controlBrowser,
  challengerWebsocket,
  challengerBrowser
] = await Promise.all([
  readReport(options.controlWebsocket),
  readReport(options.controlBrowser),
  readReport(options.challengerWebsocket),
  readReport(options.challengerBrowser)
]);
const report = evaluateExp0007({
  control: {
    websocket: controlWebsocket.value,
    browser: controlBrowser.value
  },
  challenger: {
    websocket: challengerWebsocket.value,
    browser: challengerBrowser.value
  }
});
report.provenance = {
  inputs: [
    controlWebsocket,
    controlBrowser,
    challengerWebsocket,
    challengerBrowser
  ].map(({ path, sha256 }) => ({ path, sha256 }))
};
const output = resolve(PROJECT_ROOT, options.out);
const summaryOutput = resolve(PROJECT_ROOT, options.summaryOut);
await mkdir(dirname(output), { recursive: true });
await Promise.all([
  writeFile(output, `${JSON.stringify(report, null, 2)}\n`),
  mkdir(dirname(summaryOutput), { recursive: true }).then(() =>
    writeFile(
      summaryOutput,
      `${JSON.stringify(compactReport(report, {
        controlWebsocket,
        controlBrowser,
        challengerWebsocket,
        challengerBrowser
      }), null, 2)}\n`
    )
  )
]);
console.log(
  `EXP-0007: ${report.screening.decision.toUpperCase()} · ` +
    `${Object.values(report.screening.gates).filter(Boolean).length}/` +
    `${Object.keys(report.screening.gates).length} gates`
);
console.log(`Relatório: ${options.out}`);
console.log(`Evidência canônica: ${options.summaryOut}`);
