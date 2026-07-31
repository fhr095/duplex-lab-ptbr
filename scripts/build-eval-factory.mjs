import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assembleFactoryPack
} from "../src/eval/factory/assembler.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";
import { compileFactoryPack } from "../src/eval/factory/compiler.mjs";
import { evaluateFactoryCoverage } from "../src/eval/factory/coverage.mjs";
import {
  assessCorrectionObservation,
  runCorrectionOracleMutationAudit
} from "../src/eval/factory/oracles.mjs";
import { evaluatePerception } from "../src/eval/perception-runner.mjs";
import { evaluateBaseline } from "../src/eval/runner.mjs";
import { createSourceFingerprint } from "../src/eval/source-fingerprint.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PATHS = Object.freeze({
  ontology: "eval/factory/ontology.pt-BR.v1.json",
  blueprints: "eval/factory/blueprints/corrections.v1.json",
  prompt: "eval/factory/prompts/correction-surfaces.v1.md",
  proposal: "eval/factory/proposals/correction-surfaces.bootstrap.json",
  frozenPack: "eval/factory/packs/corrections.pt-BR.v0.2.json",
  latestReport: "eval/reports/eval-factory-latest.json"
});

function parseArgs(args) {
  const options = { check: false, json: false };
  for (const argument of args) {
    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(PROJECT_ROOT, relativePath), "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function materializeJson(relativePath, value, check) {
  const path = resolve(PROJECT_ROOT, relativePath);
  const content = stableJson(value);
  if (check) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== content) {
      throw new Error(`artefato ausente ou divergente: ${relativePath}`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function canonicalObservation(item) {
  return {
    finalTranscript: item.stimulus.text,
    semanticState: {
      slot: item.oracle.args.slot,
      value: item.oracle.args.current,
      revisionId: `${item.id}-revision-1`
    },
    rollback: {
      slot: item.oracle.args.slot,
      previous: item.oracle.args.obsolete,
      current: item.oracle.args.current,
      revisionId: `${item.id}-revision-1`
    },
    userSpeechStartedAtMs: 100,
    userSpeechEndedAtMs: 1_000,
    commitAtMs: 1_050,
    rollbackAtMs: 1_100,
    userSpeechIntervals: [{ startAtMs: 100, endAtMs: 1_000 }],
    assistantSpeechStartsAtMs: [1_200],
    assistantText: `Certo, vou considerar ${item.oracle.args.current}.`,
    spokenUtterances: [{
      kind: "direct",
      text: `Certo, vou considerar ${item.oracle.args.current}.`,
      semantic: {
        slot: item.oracle.args.slot,
        value: item.oracle.args.current,
        revisionId: `${item.id}-revision-1`
      }
    }],
    commitCount: 1,
    revisionCount: 1,
    delegations: [],
    effects: []
  };
}

export async function buildEvaluationFactory(options = {}) {
  const [ontology, blueprintSet, proposalBatch, prompt] = await Promise.all([
    readJson(PATHS.ontology),
    readJson(PATHS.blueprints),
    readJson(PATHS.proposal),
    readFile(resolve(PROJECT_ROOT, PATHS.prompt))
  ]);
  const actualPromptHash = createHash("sha256").update(prompt).digest("hex");
  if (proposalBatch.provider.promptSha256 !== actualPromptHash) {
    throw new Error("promptSha256 da proposta diverge do prompt versionado");
  }

  const pack = assembleFactoryPack({
    ontology,
    blueprintSet,
    proposalBatches: [proposalBatch]
  });
  const artifacts = compileFactoryPack(pack);
  const coverage = evaluateFactoryCoverage(pack);
  const trace = evaluateBaseline(artifacts.tracePack, {
    id: "factory-trace-integrity-v1",
    requiredPassRate: 1,
    maxFailedExpectations: 0,
    metricLimits: {}
  });
  const perception = evaluatePerception(
    artifacts.perceptionPack,
    {
      schemaVersion: 1,
      id: "factory-perception-integrity-v1",
      decisionScope: "compiled-semantic-event-proxy",
      minAutomatedPassRate: 1,
      maxFailedGuardrails: 0,
      requiredMetricSamples: {},
      metricLimits: {}
    },
    {
      candidate: trace.candidate,
      packId: artifacts.tracePack.id,
      traces: Object.fromEntries(
        trace.scenarios.map((scenario) => [scenario.id, scenario.trace])
      )
    }
  );
  const oracleCases = pack.cases.map((item) => {
    const observation = canonicalObservation(item);
    return {
      id: item.id,
      control: assessCorrectionObservation(item, observation),
      mutationAudit: runCorrectionOracleMutationAudit(item, observation)
    };
  });
  const mutationAuditPass = oracleCases.every(
    (item) =>
      item.control.decision === "pass" && item.mutationAudit.pass
  );
  const factoryPass =
    coverage.pass &&
    trace.gate.pass &&
    perception.gate.pass &&
    mutationAuditPass;
  const oracleMutationAudit = {
    pass: mutationAuditPass,
    killed: oracleCases.reduce(
      (sum, item) => sum + item.mutationAudit.killed,
      0
    ),
    total: oracleCases.reduce(
      (sum, item) => sum + item.mutationAudit.total,
      0
    ),
    cases: oracleCases
  };
  const toolchainFingerprint = await createSourceFingerprint(PROJECT_ROOT, {
    roots: [
      "src/eval/factory",
      "src/interaction/ptbr-number.mjs",
      "src/eval/runner.mjs",
      "src/eval/perception-runner.mjs",
      "scripts/build-eval-factory.mjs"
    ]
  });
  const evidenceHashes = {
    coverage: canonicalSha256(coverage),
    oracleMutationAudit: canonicalSha256(oracleMutationAudit)
  };
  const buildSha256 = canonicalSha256({
    artifactManifest: artifacts.manifest,
    evidenceHashes,
    toolchainFingerprint
  });
  const shortHash = buildSha256.slice(0, 16);
  const artifactRoot = `eval/generated/factory/builds/${shortHash}`;
  const bundleManifest = {
    ...artifacts.manifest,
    buildSha256,
    toolchainFingerprint,
    evidenceHashes
  };
  const report = {
    schemaVersion: 1,
    id: "evaluation-factory-v0.2-build",
    build: {
      packId: pack.id,
      packSha256: artifacts.manifest.packSha256,
      buildSha256,
      toolchainFingerprint,
      artifactRoot,
      caseCount: pack.cases.length,
      traceCaseCount: artifacts.tracePack.scenarios.length,
      liveAudioCaseCount: artifacts.liveAudioPack.cases.filter(
        (item) => item.expectSpeech !== false
      ).length,
      browserCaseCount: artifacts.browserCases.cases.length
    },
    gates: {
      factoryIntegrity: {
        decision: factoryPass ? "promote" : "hold",
        pass: factoryPass,
        coverage: coverage.pass,
        trace: trace.gate.pass,
        perceptionProxy: perception.gate.pass,
        mutationAudit: mutationAuditPass
      },
      runtimeCandidate: {
        decision: "hold",
        reason:
          "áudio e Chrome precisam produzir observações reais deste build"
      },
      userFacingReadiness: {
        decision: "hold",
        reason:
          "efeitos externos, diversidade acústica e validade humana ainda não estão medidos"
      }
    },
    coverage,
    trace: {
      summary: trace.summary,
      gate: trace.gate
    },
    perceptionProxy: {
      summary: perception.summary,
      gate: perception.gate
    },
    oracleMutationAudit
  };

  const outputs = [
    [PATHS.frozenPack, pack],
    [`${artifactRoot}/trace-pack.json`, artifacts.tracePack],
    [`${artifactRoot}/perception-pack.json`, artifacts.perceptionPack],
    [`${artifactRoot}/live-audio-pack.json`, artifacts.liveAudioPack],
    [`${artifactRoot}/browser-cases.json`, artifacts.browserCases],
    [`${artifactRoot}/artifact-manifest.json`, bundleManifest],
    [`${artifactRoot}/coverage-report.json`, coverage],
    [`${artifactRoot}/oracle-mutation-report.json`, report.oracleMutationAudit],
    [PATHS.latestReport, report]
  ];
  for (const [path, value] of outputs) {
    await materializeJson(path, value, options.check === true);
  }
  return report;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildEvaluationFactory(options);
  if (options.json) {
    process.stdout.write(stableJson(report));
  } else {
    console.log(
      `Fábrica ${report.gates.factoryIntegrity.decision}: ` +
        `${report.build.caseCount} casos, ` +
        `${report.oracleMutationAudit.killed}/` +
        `${report.oracleMutationAudit.total} mutantes mortos, ` +
        `pairwise ${(report.coverage.pairwise.ratio * 100).toFixed(1)}%.`
    );
    console.log(`Artefatos: ${report.build.artifactRoot}`);
  }
  if (!report.gates.factoryIntegrity.pass) {
    process.exitCode = 1;
  }
}
