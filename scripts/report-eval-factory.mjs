import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  aggregateFactoryCampaign
} from "../src/eval/factory/campaign-summary.mjs";
import { canonicalSha256 } from "../src/eval/factory/canonical-hash.mjs";
import { createSourceFingerprint } from "../src/eval/source-fingerprint.mjs";
import {
  RUNTIME_FINGERPRINT_ROOTS
} from "../src/eval/runtime-provenance.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PATHS = Object.freeze({
  build: "eval/reports/eval-factory-latest.json",
  audio: "eval/reports/eval-factory-audio-latest.json",
  acousticBuild: "eval/reports/eval-factory-acoustic-latest.json",
  live: "eval/reports/eval-factory-live-audio-current.json",
  acousticLive: "eval/reports/eval-factory-acoustic-live-latest.json",
  browserText: "eval/reports/eval-factory-browser-latest.json",
  browserPcm: "eval/reports/eval-factory-browser-pcm-latest.json",
  browserPcmNoise:
    "eval/reports/eval-factory-browser-pcm-noise-10db-latest.json",
  output: "eval/reports/eval-factory-campaign-v0.2.json"
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readArtifact(path) {
  const bytes = await readFile(resolve(PROJECT_ROOT, path));
  return {
    path,
    bytes,
    fileSha256: sha256(bytes),
    value: JSON.parse(bytes.toString("utf8"))
  };
}

async function readRuntimeHealth() {
  const base = process.env.DUPLEX_URL ?? "http://127.0.0.1:4173";
  const response = await fetch(new URL("/api/health", base), {
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`health do runtime retornou HTTP ${response.status}`);
  }
  return response.json();
}

function runtimeEvidence(report) {
  return {
    process: report.runtime?.process ?? report.runtime?.health?.process,
    processAfter:
      report.runtime?.processAfter ?? report.runtime?.healthAfter?.process,
    current: report.runtime?.currentRuntimeFingerprint,
    comparable: report.runtime?.comparable
  };
}

async function main() {
  const reports = Object.fromEntries(
    await Promise.all(
      Object.entries(PATHS)
        .filter(([id]) => id !== "output")
        .map(async ([id, path]) => [id, await readArtifact(path)])
    )
  );
  const build = reports.build.value;
  const manifestPath = `${build.build.artifactRoot}/artifact-manifest.json`;
  const livePackPath = `${build.build.artifactRoot}/live-audio-pack.json`;
  const browserPackPath = `${build.build.artifactRoot}/browser-cases.json`;
  const [manifest, livePack, browserPack, acousticPack] = await Promise.all([
    readArtifact(manifestPath),
    readArtifact(livePackPath),
    readArtifact(browserPackPath),
    readArtifact(reports.acousticBuild.value.liveAudioPack.path)
  ]);
  const audioHashesPass = (
    await Promise.all(
      reports.audio.value.entries.map(async (entry) => {
        const wave = await readFile(resolve(PROJECT_ROOT, entry.relativePath));
        return sha256(wave) === entry.waveSha256;
      })
    )
  ).every(Boolean);
  const acousticFiles = [
    ...reports.acousticBuild.value.entries.map((entry) => ({
      id: entry.id,
      path: entry.relativePath,
      sha256: entry.outputWaveSha256
    })),
    {
      id: "noise-only-control",
      path: reports.acousticBuild.value.noiseControl.path,
      sha256: reports.acousticBuild.value.noiseControl.sha256
    }
  ];
  const acousticHashesPass = (
    await Promise.all(
      acousticFiles.map(async (entry) => {
        const wave = await readFile(resolve(PROJECT_ROOT, entry.path));
        return sha256(wave) === entry.sha256;
      })
    )
  ).every(Boolean);
  const cleanAudioById = new Map(
    reports.audio.value.entries.map((entry) => [entry.id, {
      path: entry.relativePath,
      sha256: entry.waveSha256
    }])
  );
  const acousticAudioById = new Map(
    acousticFiles.map((entry) => [entry.id, entry])
  );
  const cleanLiveAudioBound = reports.live.value.cases
    .filter((item) => item.expectSpeech !== false)
    .every(
      (item) => item.audioSha256 === cleanAudioById.get(item.id)?.sha256
    );
  const acousticLiveAudioBound = reports.acousticLive.value.cases.every(
    (item) => item.audioSha256 === acousticAudioById.get(item.id)?.sha256
  );
  const browserCleanAudioBound = reports.browserPcm.value.results.every(
    (item) => {
      const expected = cleanAudioById.get(item.id);
      return item.acousticInput?.path === expected?.path &&
        item.acousticInput?.waveSha256 === expected?.sha256;
    }
  );
  const browserNoiseAudioBound = reports.browserPcmNoise.value.results.every(
    (item) => {
      const expected = acousticAudioById.get(`${item.id}--noise-10db`);
      return item.acousticInput?.path === expected?.path &&
        item.acousticInput?.waveSha256 === expected?.sha256;
    }
  );
  const acousticPackAudioBound = acousticPack.value.cases.every(
    (item) => item.audio === acousticAudioById.get(item.id)?.path
  );
  const campaignReports = [
    reports.live.value,
    reports.acousticLive.value,
    reports.browserText.value,
    reports.browserPcm.value,
    reports.browserPcmNoise.value
  ];
  const [runtimeHealth, currentRuntimeFingerprint, currentEvaluatorFingerprint,
    currentToolchainFingerprint] = await Promise.all([
    readRuntimeHealth(),
    createSourceFingerprint(PROJECT_ROOT, {
      roots: RUNTIME_FINGERPRINT_ROOTS
    }),
    createSourceFingerprint(PROJECT_ROOT),
    createSourceFingerprint(PROJECT_ROOT, {
      roots: build.build.toolchainFingerprint.roots
    })
  ]);
  const runtimeCurrent = campaignReports.every((campaign) => {
    const evidence = runtimeEvidence(campaign);
    return evidence.comparable === true &&
      evidence.process?.runId === runtimeHealth.process?.runId &&
      evidence.processAfter?.runId === runtimeHealth.process?.runId &&
      evidence.process?.runtimeFingerprint?.sha256 ===
        currentRuntimeFingerprint.sha256 &&
      evidence.current?.sha256 === currentRuntimeFingerprint.sha256;
  });
  const evaluatorCurrent = campaignReports.every(
    (campaign) =>
      campaign.sourceFingerprint?.sha256 ===
        currentEvaluatorFingerprint.sha256
  );
  const costTelemetryPass = campaignReports.every((campaign) =>
    [
      "paidApiCalls",
      "requests",
      "inputTokens",
      "outputTokens",
      "totalTokens"
    ].every((field) => Number.isFinite(campaign.execution?.[field]))
  );
  const integrity = {
    manifest:
      manifest.value.buildSha256 === build.build.buildSha256 &&
      manifest.value.packSha256 === build.build.packSha256,
    livePack:
      canonicalSha256(livePack.value) ===
        manifest.value.artifactHashes.liveAudioPack &&
      reports.live.value.pack.fileSha256 === livePack.fileSha256,
    browserPack:
      canonicalSha256(browserPack.value) ===
        manifest.value.artifactHashes.browserCases,
    acousticPack:
      canonicalSha256(acousticPack.value) ===
        reports.acousticBuild.value.liveAudioPack.sha256 &&
      reports.acousticLive.value.pack.fileSha256 === acousticPack.fileSha256,
    browserText:
      reports.browserText.value.provenance.manifestSha256 ===
        canonicalSha256(manifest.value) &&
      reports.browserText.value.runtime.comparable === true,
    browserPcm:
      reports.browserPcm.value.provenance.manifestSha256 ===
        canonicalSha256(manifest.value) &&
      reports.browserPcm.value.runtime.comparable === true,
    browserPcmNoise:
      reports.browserPcmNoise.value.provenance.manifestSha256 ===
        canonicalSha256(manifest.value) &&
      reports.browserPcmNoise.value.runtime.comparable === true,
    audio: audioHashesPass,
    acousticAudio: acousticHashesPass && acousticPackAudioBound,
    executionAudio:
      cleanLiveAudioBound &&
      acousticLiveAudioBound &&
      browserCleanAudioBound &&
      browserNoiseAudioBound,
    toolchain:
      currentToolchainFingerprint.sha256 ===
        build.build.toolchainFingerprint.sha256,
    evaluator: evaluatorCurrent,
    runtime: runtimeCurrent,
    costTelemetry: costTelemetryPass
  };
  const inputArtifacts = [
    ...Object.values(reports),
    manifest,
    livePack,
    browserPack,
    acousticPack
  ].map((item) => ({ path: item.path, fileSha256: item.fileSha256 }));
  const report = aggregateFactoryCampaign({
    build,
    audio: reports.audio.value,
    acousticBuild: reports.acousticBuild.value,
    live: reports.live.value,
    acousticLive: reports.acousticLive.value,
    browserText: reports.browserText.value,
    browserPcm: reports.browserPcm.value,
    browserPcmNoise: reports.browserPcmNoise.value,
    expectedBrowserCaseIds: browserPack.value.cases.map((item) => item.id),
    expectedLiveCaseIds: livePack.value.cases.map((item) => item.id),
    expectedAcousticCaseIds: acousticPack.value.cases.map((item) => item.id),
    integrity,
    inputArtifacts
  });
  const output = resolve(PROJECT_ROOT, PATHS.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Agregado: toolchain=${report.decisions.factoryToolchain}; ` +
      `runtime=${report.decisions.runtimeEngineering}; ` +
      `usuário=${report.decisions.userFacingReadiness}.`
  );
  console.log(`Relatório: ${PATHS.output}`);
}

await main();
