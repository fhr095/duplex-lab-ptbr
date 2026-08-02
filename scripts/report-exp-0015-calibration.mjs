import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  aggregateTimingCalibration
} from "../src/eval/calibration/blind-session.mjs";
import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";
import {
  evaluateExp0015Instrument
} from "./lib/exp-0015-analysis.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  annotations: "eval/generated/exp-0015/v0.2/annotations",
  browser: "eval/reports/exp-0015-calibration-browser-current.json",
  out: "eval/reports/exp-0015-timing-calibration-instrument-v4.json",
  pack: "eval/calibration/exp-0015-timing-pack-v0.2.json",
  rubric: "eval/calibration/exp-0015-scoring-rubric-v0.2.1.json",
  resolutionRubric:
    "eval/calibration/" +
    "exp-0015-preference-resolution-rubric-v0.2.2.json"
});

function parseArgs(args) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (![
      "--annotations",
      "--browser",
      "--out",
      "--pack",
      "--rubric",
      "--resolution-rubric"
    ].includes(
      argument
    )) {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
    const field = argument === "--resolution-rubric"
      ? "resolutionRubric"
      : argument.slice(2);
    options[field] = args[++index];
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(relativePath) {
  const bytes = await readFile(resolve(PROJECT_ROOT, relativePath));
  return {
    path: relativePath,
    sha256: `sha256:${sha256(bytes)}`,
    value: JSON.parse(bytes.toString("utf8"))
  };
}

async function readAnnotations(relativeRoot) {
  const root = resolve(PROJECT_ROOT, relativeRoot);
  const entries = await readdir(root, { withFileTypes: true })
    .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const records = [];
  const provenance = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en")
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const bytes = await readFile(resolve(root, entry.name));
    const value = JSON.parse(bytes.toString("utf8"));
    if (entry.name !== `${value.annotationId}.json`) {
      throw new Error(`arquivo de anotação divergente: ${entry.name}`);
    }
    records.push(value);
    provenance.push({
      annotationId: value.annotationId ?? null,
      sha256: `sha256:${sha256(bytes)}`
    });
  }
  return { records, provenance };
}

const options = parseArgs(process.argv.slice(2));
const [
  packSource,
  rubricSource,
  resolutionRubricSource,
  browserSource,
  annotationSource,
  sourceFingerprint
] =
  await Promise.all([
    readJson(options.pack),
    readJson(options.rubric),
    readJson(options.resolutionRubric),
    readJson(options.browser),
    readAnnotations(options.annotations),
    createSourceFingerprint(PROJECT_ROOT)
  ]);
const pack = packSource.value;
const protocol = pack.protocol;
const aggregate = aggregateTimingCalibration(
  pack,
  annotationSource.records,
  {
    minimumExternalParticipants: protocol.minimumExternalParticipants,
    minimumVotesPerScene: protocol.minimumVotesPerScene,
    minimumConsensusShare: protocol.minimumConsensusShare,
    minimumLabelCoverage: protocol.minimumLabelCoverage,
    minimumAttentionPassRate: protocol.minimumAttentionPassRate,
    attentionScoringRubric: rubricSource.value,
    preferenceResolutionRubric: resolutionRubricSource.value
  }
);
const report = evaluateExp0015Instrument({
  aggregate,
  browser: browserSource.value,
  pack,
  rubric: rubricSource.value,
  resolutionRubric: resolutionRubricSource.value,
  fingerprints: {
    source: sourceFingerprint,
    pack: {
      path: packSource.path,
      sha256: packSource.sha256
    },
    rubric: {
      path: rubricSource.path,
      sha256: rubricSource.sha256
    },
    resolutionRubric: {
      path: resolutionRubricSource.path,
      sha256: resolutionRubricSource.sha256
    },
    browser: {
      path: browserSource.path,
      sha256: browserSource.sha256
    },
    annotations: {
      root: options.annotations,
      count: annotationSource.records.length,
      records: annotationSource.provenance
    }
  }
});
const output = resolve(PROJECT_ROOT, options.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `EXP-0015 instrumento: ${report.instrumentPass ? "PROMOTE" : "HOLD"} · ` +
    `${report.metrics.scenes} cenas / ${report.metrics.audioArtifacts} WAVs`
);
console.log(
  `Calibração humana: ${report.humanCalibrationPass ? "READY" : "AWAIT"} · ` +
    `${report.metrics.externalParticipants}/` +
    `${protocol.minimumExternalParticipants} participantes externos`
);
console.log(
  `Atenção externa: ` +
    `${(report.metrics.baseAttentionPassRate * 100).toFixed(1)}% base → ` +
    `${(report.metrics.amendedAttentionPassRate * 100).toFixed(1)}% emendada`
);
console.log(
  `Cobertura: ` +
    `${(report.metrics.singularLabelCoverage * 100).toFixed(1)}% singular → ` +
    `${(report.metrics.resolutionCoverage * 100).toFixed(1)}% resolvida`
);
console.log(`Evidência canônica: ${options.out}`);
if (!report.instrumentPass) {
  process.exitCode = 1;
}
