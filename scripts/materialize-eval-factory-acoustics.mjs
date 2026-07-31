import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import {
  encodeWaveArtifact,
  renderFactoryAcousticVariant
} from "../src/eval/factory/acoustic-materializer.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const BUILD_REPORT = "eval/reports/eval-factory-latest.json";
const SOURCE_PACK = "eval/factory/packs/corrections.pt-BR.v0.2.json";
const OUTPUT_ROOT = "eval/generated/factory/acoustic";
const REPORT = "eval/reports/eval-factory-acoustic-latest.json";
const CONDITIONS = Object.freeze([
  Object.freeze({ id: "quiet-12db", kind: "quiet", signalGainDb: -12 }),
  Object.freeze({
    id: "noise-10db",
    kind: "noise",
    signalGainDb: -6,
    snrDb: 10
  })
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(PROJECT_ROOT, path), "utf8"));
}

async function main() {
  const build = await readJson(BUILD_REPORT);
  const browserPath = `${build.build.artifactRoot}/browser-cases.json`;
  const [browserPack, sourcePack] = await Promise.all([
    readJson(browserPath),
    readJson(SOURCE_PACK)
  ]);
  const sourceById = new Map(sourcePack.cases.map((item) => [item.id, item]));
  const entries = [];
  const liveCases = [];
  let noiseControl = null;
  for (const definition of browserPack.cases) {
    const sourceCase = sourceById.get(definition.id);
    const wave = await readFile(resolve(PROJECT_ROOT, definition.audio));
    const pcm = decodeWaveToPcm16(wave, { targetSampleRate: 16_000 }).pcm;
    for (const [conditionIndex, condition] of CONDITIONS.entries()) {
      const seed = (sourceCase.seed + conditionIndex * 1_000_003) >>> 0;
      const rendered = renderFactoryAcousticVariant({
        pcm,
        condition,
        seed
      });
      const repeated = renderFactoryAcousticVariant({
        pcm,
        condition,
        seed
      });
      const id = `${definition.id}--${condition.id}`;
      const relativePath = `${OUTPUT_ROOT}/${id}.wav`;
      const outputArtifact = encodeWaveArtifact(rendered.mix);
      const outputWave = outputArtifact.wave;
      const deterministic = sha256(rendered.mix) === sha256(repeated.mix);
      await mkdir(dirname(resolve(PROJECT_ROOT, relativePath)), {
        recursive: true
      });
      await writeFile(resolve(PROJECT_ROOT, relativePath), outputWave);
      if (!noiseControl && rendered.noisePcm) {
        const controlPath = `${OUTPUT_ROOT}/noise-only-control.wav`;
        const controlArtifact = encodeWaveArtifact(rendered.noisePcm);
        await writeFile(
          resolve(PROJECT_ROOT, controlPath),
          controlArtifact.wave
        );
        noiseControl = {
          path: controlPath,
          sha256: controlArtifact.sha256,
          pcmSha256: controlArtifact.pcmSha256
        };
      }
      const snrPass = condition.kind !== "noise" ||
        Math.abs(rendered.achievedSnrDb - condition.snrDb) <= 0.5;
      entries.push({
        id,
        sourceCaseId: definition.id,
        condition,
        seed,
        inputWaveSha256: sha256(wave),
        outputWaveSha256: outputArtifact.sha256,
        deterministic,
        relativePath,
        metrics: rendered.metrics,
        achievedSnrDb: rendered.achievedSnrDb,
        checks: {
          deterministic,
          noPreClipping: rendered.metrics.preClipSamples === 0,
          noOutputClipping: rendered.metrics.clippedSamples === 0,
          snr: snrPass
        }
      });
      liveCases.push({
        id,
        cohort: "synthetic",
        evidence: `windows-maria-local+${condition.id}`,
        category: "correction-acoustic",
        audio: relativePath,
        expected: sourceCase.stimulus.text,
        requiredPhrases: [
          sourceCase.stimulus.slots.obsolete,
          sourceCase.stimulus.marker,
          sourceCase.stimulus.slots.current
        ],
        metadata: {
          sourceCaseId: definition.id,
          condition,
          split: sourceCase.split
        }
      });
    }
  }
  if (!noiseControl) {
    throw new Error("nenhum stem de ruído foi produzido");
  }
  const livePack = {
    schemaVersion: 1,
    id: `${sourcePack.id}-acoustic-v1`,
    locale: "pt-BR",
    description: "Matriz acústica determinística da fábrica v0.2.",
    sources: {
      synthetic: "Maria local com ganho e ruído seeded determinísticos"
    },
    gate: {
      id: `${sourcePack.id}-acoustic-gate`,
      maxOnsetP95Ms: 180,
      maxFirstUsefulPartialP95Ms: 2_500,
      maxEndpointP95Ms: 1_300,
      maxFinalAfterEndpointP95Ms: 2_000,
      maxSyntheticCorpusWer: 0.25,
      maxHumanCorpusWer: 0.25,
      maxPerCaseWer: 0.5,
      minCriticalPhraseRecall: 1,
      maxLostFrames: 0,
      maxBufferedAmountBytes: 16_384,
      maxRejectedFrames: 0,
      maxProtocolErrors: 0,
      requireSilenceControl: true
    },
    cases: [
      {
        id: "noise-only-control",
        cohort: "control",
        evidence: "seeded-white-noise",
        category: "false-activation",
        audio: noiseControl.path,
        expectSpeech: false
      },
      ...liveCases
    ]
  };
  const packPath = `${OUTPUT_ROOT}/live-audio-pack.json`;
  await writeFile(
    resolve(PROJECT_ROOT, packPath),
    `${JSON.stringify(livePack, null, 2)}\n`
  );
  const gatePass =
    entries.length === browserPack.cases.length * CONDITIONS.length &&
    entries.every((entry) => Object.values(entry.checks).every(Boolean));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      buildSha256: build.build.buildSha256,
      packId: sourcePack.id,
      packSha256: canonicalSha256(sourcePack),
      browserPackPath: browserPath,
      browserPackSha256: canonicalSha256(browserPack)
    },
    conditions: CONDITIONS,
    entries,
    noiseControl,
    liveAudioPack: {
      path: packPath,
      sha256: canonicalSha256(livePack),
      caseCount: livePack.cases.length
    },
    gate: {
      decision: gatePass ? "promote" : "hold",
      pass: gatePass,
      scope: "integridade determinística da matriz acústica; não mede ASR"
    },
    execution: { paidApiCalls: 0, externalLlmUsed: false }
  };
  await writeFile(
    resolve(PROJECT_ROOT, REPORT),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(
    `Matriz acústica ${report.gate.decision}: ${entries.length} cenas; ` +
      `pack: ${packPath}`
  );
  if (!gatePass) {
    process.exitCode = 1;
  }
}

await main();
