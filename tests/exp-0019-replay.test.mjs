import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { encodePcm16Wave } from "../src/audio/wav.mjs";
import {
  EXP0019_AUDIO_MANIFEST_SCHEMA,
  EXP0019_NODE_REPLAY_SCHEMA,
  buildExp0019NodeReplay,
  detectExp0019PcmOnset,
  inspectExp0019PcmActivity,
  validateExp0019NodeReplayArtifact
} from "../src/eval/exp-0019-replay.mjs";
import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_AUDIO_ATTEMPT_SCHEMA,
  EXP0019_CRITICAL_SOURCE_PATHS,
  EXP0019_INSTRUMENTATION_FREEZE_PATH,
  EXP0019_TTS_RANDOM_SEED,
  EXP0019_TTS_RANDOM_SEED_STRATEGY,
  EXP0019_TTS_PYTHON_PACKAGES,
  createExp0019InstrumentationFreeze
} from "../src/eval/exp-0019-boundary.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  runExp0019NodeReplayFiles
} from "../scripts/run-exp-0019-node-replay.mjs";

const PLAN_PATH = "eval/experiments/exp-0019-causal-audio-plan-v0.1.json";
const MANIFEST_PATH = "eval/sources/exp-0019-causal-audio-v0.1.json";
const OUTPUT_PATH = "eval/reports/exp-0019-node-replay-v0.1.json";
const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const REPLAY_SOURCE_PATHS = Object.freeze([
  "scripts/run-exp-0019-node-replay.mjs",
  "src/eval/exp-0019-replay.mjs"
]);
const MATERIALIZER_SOURCE_PATHS = Object.freeze([
  "scripts/materialize-exp-0019-audio.mjs",
  "scripts/lib/materialize-exp-0019-supertonic.py"
]);
const MODEL_FILES = Object.freeze([
  "LICENSE",
  "config.json",
  "onnx/duration_predictor.onnx",
  "onnx/text_encoder.onnx",
  "onnx/tts.json",
  "onnx/unicode_indexer.json",
  "onnx/vector_estimator.onnx",
  "onnx/vocoder.onnx",
  "voice_styles/F4.json",
  "voice_styles/M4.json"
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function textSha256(text) {
  return sha256(Buffer.from(text, "utf8"));
}

function segmentSeed(streamId, segmentKind) {
  return createHash("sha256").update(
    `EXP-0019|${EXP0019_TTS_RANDOM_SEED}|${streamId}|${segmentKind}`
  ).digest().readUInt32BE(0);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function pcm(sampleCount, onsetSample = 0) {
  const output = Buffer.alloc(sampleCount * 2);
  for (let sample = onsetSample; sample < sampleCount; sample += 1) {
    output.writeInt16LE(sample % 2 === 0 ? 6_000 : -6_000, sample * 2);
  }
  return output;
}

function fileDescriptor(plan, stream, segmentPcms, wave) {
  const assistant = stream.kind === "assistant";
  const texts = assistant
    ? stream.segments.map((segment) => segment.text)
    : [stream.text];
  const kinds = assistant
    ? ["audible-prefix", "neutral-tail"]
    : ["utterance"];
  const joined = Buffer.concat(segmentPcms);
  return {
    id: stream.streamId,
    role: assistant ? "assistant-output" : stream.kind,
    voiceStyle: assistant
      ? plan.audio.synthesis.voiceStyles.assistant
      : plan.audio.synthesis.voiceStyles.nonAssistant,
    textSha256: textSha256(texts[0]),
    tailTextSha256: assistant ? textSha256(texts[1]) : null,
    relativePath: stream.relativePath,
    waveSha256: sha256(wave),
    pcmSha256: sha256(joined),
    sampleRate: 16_000,
    channels: 1,
    bitsPerSample: 16,
    sampleCount: joined.length / 2,
    prefixEndSample: assistant ? segmentPcms[0].length / 2 : null,
    segments: segmentPcms.map((segment, index) => ({
      kind: kinds[index],
      textSha256: textSha256(texts[index]),
      sampleCount: segment.length / 2,
      pcmSha256: sha256(segment)
    }))
  };
}

function attemptFor(plan, planBytes, freeze, freezeBytes) {
  const core = {
    schemaVersion: EXP0019_AUDIO_ATTEMPT_SCHEMA,
    experimentId: "EXP-0019",
    status: "OPENED_FOR_SINGLE_MATERIALIZATION",
    openedAt: "2026-08-03T00:00:00.000Z",
    executionHeadCommit: freeze.runnerSourceCommit,
    instrumentationFreeze: {
      path: EXP0019_INSTRUMENTATION_FREEZE_PATH,
      fileSha256: sha256(freezeBytes),
      canonicalSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    },
    plan: {
      path: PLAN_PATH,
      fileSha256: sha256(planBytes),
      canonicalSha256: plan.planSha256
    },
    modelArtifactBindingSha256:
      freeze.tts.modelArtifactBinding.canonicalSha256,
    outputs: {
      rawAudioRoot: "eval/generated/exp-0019/audio",
      manifest: MANIFEST_PATH
    },
    allowedSyntheses: {
      streams: 12,
      targets: 4,
      inbounds: 4,
      assistantPrefixes: 4,
      assistantTails: 4,
      rerunAllowed: false
    },
    authority: {
      mode: "offline-shadow-only",
      canProduceEffects: false
    }
  };
  return {
    ...core,
    attemptSha256: `sha256:${canonicalSha256(core)}`
  };
}

function manifestFor(
  plan,
  planBytes,
  files,
  freeze,
  freezeBytes,
  attempt,
  attemptBytes
) {
  const frozenSources = new Map(freeze.criticalSources.map((source) => [
    source.path,
    source.fileSha256
  ]));
  const receipt = {
    schemaVersion: "exp-0019-supertonic-materialization-receipt-v1",
    engine: "supertonic",
    model: "supertonic-3",
    sdkVersion: "1.3.1",
    pythonVersion: "3.12-test",
    pythonExecutableSha256: `sha256:${"e".repeat(64)}`,
    packageVersions: structuredClone(EXP0019_TTS_PYTHON_PACKAGES),
    supertonicPackageSha256: `sha256:${"f".repeat(64)}`,
    language: "pt",
    totalSteps: 8,
    speed: 1.05,
    randomSeedBase: EXP0019_TTS_RANDOM_SEED,
    randomSeedStrategy: EXP0019_TTS_RANDOM_SEED_STRATEGY,
    assistantSegmentsSynthesizedSeparately: true,
    modelSampleRate: 24_000,
    outputSampleRate: 16_000,
    networkAllowed: false,
    autoDownload: false,
    environmentMode: "uvx-offline-existing-cache",
    instrumentationFreezeFileSha256: sha256(freezeBytes),
    attemptFileSha256: sha256(attemptBytes),
    files: files.map((file) => ({
      id: file.id,
      relativePath: file.relativePath,
      sampleCount: file.sampleCount,
      segmentSampleCounts: file.segments.map(
        (segment) => segment.sampleCount
      ),
      segmentSeeds: file.segments.map((segment) =>
        segmentSeed(file.id, segment.kind)
      ),
      prefixEndSample: file.prefixEndSample
    }))
  };
  const core = {
    schemaVersion: EXP0019_AUDIO_MANIFEST_SCHEMA,
    experimentId: "EXP-0019",
    status: "materialized-local-offline",
    instrumentationFreeze: {
      path: EXP0019_INSTRUMENTATION_FREEZE_PATH,
      fileSha256: sha256(freezeBytes),
      canonicalSha256: freeze.instrumentationFreezeSha256,
      runnerSourceCommit: freeze.runnerSourceCommit
    },
    audioAttempt: {
      path: EXP0019_AUDIO_ATTEMPT_PATH,
      fileSha256: sha256(attemptBytes),
      canonicalSha256: attempt.attemptSha256,
      executionHeadCommit: attempt.executionHeadCommit
    },
    plan: {
      path: PLAN_PATH,
      fileSha256: sha256(planBytes),
      canonicalSha256: plan.planSha256
    },
    provenance: {
      execution: "local-offline",
      executionHeadCommit: attempt.executionHeadCommit,
      testHarnessUsed: false,
      networkAllowed: false,
      paidApiCalls: 0,
      gpuRuns: 0,
      engine: "supertonic",
      model: "supertonic-3",
      sdkVersion: "1.3.1",
      pythonVersion: "3.12-test",
      environmentMode: "uvx-offline-existing-cache",
      modelCacheLocation: "local-cache-outside-repository",
      modelArtifactBinding: structuredClone(
        freeze.tts.modelArtifactBinding
      ),
      toolchainBinding: structuredClone(freeze.tts.toolchainBinding),
      sourceFiles: {
        wrapper: {
          path: MATERIALIZER_SOURCE_PATHS[0],
          fileSha256: frozenSources.get(MATERIALIZER_SOURCE_PATHS[0])
        },
        pythonMaterializer: {
          path: MATERIALIZER_SOURCE_PATHS[1],
          fileSha256: frozenSources.get(MATERIALIZER_SOURCE_PATHS[1])
        }
      },
      receiptCanonicalSha256: `sha256:${canonicalSha256(receipt)}`
    },
    materializationReceipt: receipt,
    synthesis: {
      language: "pt",
      totalSteps: 8,
      speed: 1.05,
      modelSampleRate: 24_000,
      randomSeedBase: EXP0019_TTS_RANDOM_SEED,
      randomSeedStrategy: EXP0019_TTS_RANDOM_SEED_STRATEGY,
      assistantSegmentsSynthesizedSeparately: true
    },
    audio: {
      encoding: "PCM_S16LE_WAVE",
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16
    },
    selection: {
      total: 12,
      roles: { target: 4, inbound: 4, "assistant-output": 4 }
    },
    targetReuse: {
      strategy: "one-canonical-wave-per-target-source",
      targetSources: 4,
      synthesesPerTarget: 1,
      byteIdenticalReuseRequiredWithinPair: true
    },
    retention: {
      rawAudioInGit: false,
      rawAudioIgnoredUnder: "eval/generated/exp-0019/audio",
      manifestInGit: true,
      modelWeightsInGit: false
    },
    files
  };
  return {
    ...core,
    manifestSha256: `sha256:${canonicalSha256(core)}`
  };
}

async function freezeFor(plan, planBytes, checkpointPath, checkpointBytes) {
  const actualPaths = [...REPLAY_SOURCE_PATHS, ...MATERIALIZER_SOURCE_PATHS];
  const actualRecords = await Promise.all(actualPaths.map(async (path) => ({
    path,
    bytes: await readFile(resolve(REPOSITORY_ROOT, path))
  })));
  const actualHashes = new Map(actualRecords.map((record) => [
    record.path,
    sha256(record.bytes)
  ]));
  const placeholderHash = `sha256:${"a".repeat(64)}`;
  const modelFiles = Object.fromEntries(MODEL_FILES.map((path) => [
    path,
    placeholderHash
  ]));
  const checkpoint = JSON.parse(checkpointBytes.toString("utf8"));
  const freeze = createExp0019InstrumentationFreeze({
    runnerSourceCommit: "1".repeat(40),
    nodeVersion: "v-test",
    artifacts: {
      preregistration: {
        path: "docs/experiments/EXP-0019-causal-audio-context-bridge.md",
        fileSha256: placeholderHash
      },
      plan: {
        path: PLAN_PATH,
        fileSha256: sha256(planBytes),
        canonicalSha256: plan.planSha256
      },
      browserCheckpoint: {
        path: "web/context-relevance-checkpoint.json",
        fileSha256: placeholderHash,
        canonicalSha256: `sha256:${"b".repeat(64)}`
      },
      sourceCheckpoint: {
        path: checkpointPath,
        fileSha256: sha256(checkpointBytes),
        canonicalSha256: checkpoint.checkpointSha256
      }
    },
    modelArtifactBinding: {
      files: modelFiles,
      canonicalSha256: `sha256:${canonicalSha256(modelFiles)}`
    },
    toolchainBinding: {
      command: "uvx",
      executableSha256: placeholderHash,
      version: "uvx 0.11.18 (test)"
    },
    criticalSources: EXP0019_CRITICAL_SOURCE_PATHS.map((path) => ({
      path,
      fileSha256: actualHashes.get(path) ?? placeholderHash
    }))
  });
  return {
    freeze,
    freezeBytes: jsonBytes(freeze),
    criticalSourceRecords: actualRecords.filter((record) =>
      REPLAY_SOURCE_PATHS.includes(record.path)
    )
  };
}

function rehashManifest(manifest) {
  const core = structuredClone(manifest);
  delete core.manifestSha256;
  manifest.manifestSha256 = `sha256:${canonicalSha256(core)}`;
  return manifest;
}

function rehashPlan(plan) {
  const core = structuredClone(plan);
  delete core.planSha256;
  plan.planSha256 = `sha256:${canonicalSha256(core)}`;
  return plan;
}

function rehashFreeze(freeze) {
  const core = structuredClone(freeze);
  delete core.instrumentationFreezeSha256;
  freeze.instrumentationFreezeSha256 =
    `sha256:${canonicalSha256(core)}`;
  return freeze;
}

function createPack(plan, options = {}) {
  const waves = new Map();
  const files = [];
  const kindIndex = { assistant: 0, inbound: 0, target: 0 };
  for (const stream of plan.audio.streams) {
    const index = kindIndex[stream.kind]++;
    let segmentPcms;
    if (stream.kind === "assistant") {
      segmentPcms = [
        pcm(3_200 + index * 320, 320),
        pcm(options.tailSamples ?? 20_000, 0)
      ];
    } else if (stream.kind === "inbound") {
      segmentPcms = [pcm(3_840 + index * 320, 320)];
    } else {
      segmentPcms = [pcm(3_200 + index * 320, 640)];
    }
    const wave = encodePcm16Wave(Buffer.concat(segmentPcms), {
      sampleRate: 16_000
    });
    waves.set(stream.relativePath, wave);
    files.push(fileDescriptor(plan, stream, segmentPcms, wave));
  }
  return { waves, files };
}

async function sourceFixture(options = {}) {
  const planBytes = options.planBytes ?? await readFile(
    resolve(REPOSITORY_ROOT, PLAN_PATH)
  );
  const plan = JSON.parse(planBytes.toString("utf8"));
  const checkpointPath = plan.bindings.checkpoint.path;
  const checkpointBytes = await readFile(
    resolve(REPOSITORY_ROOT, checkpointPath)
  );
  const frozen = await freezeFor(
    plan,
    planBytes,
    checkpointPath,
    checkpointBytes
  );
  const pack = createPack(plan, options);
  const attempt = attemptFor(
    plan,
    planBytes,
    frozen.freeze,
    frozen.freezeBytes
  );
  const attemptBytes = jsonBytes(attempt);
  const manifest = manifestFor(
    plan,
    planBytes,
    pack.files,
    frozen.freeze,
    frozen.freezeBytes,
    attempt,
    attemptBytes
  );
  return {
    plan,
    planBytes,
    checkpointPath,
    checkpointBytes,
    ...frozen,
    attempt,
    attemptBytes,
    waves: pack.waves,
    manifest,
    manifestBytes: jsonBytes(manifest)
  };
}

function replayInput(fixture, overrides = {}) {
  let tick = 0;
  return {
    planRecord: {
      path: PLAN_PATH,
      bytes: fixture.planBytes
    },
    instrumentationFreezeRecord: {
      path: EXP0019_INSTRUMENTATION_FREEZE_PATH,
      bytes: overrides.freezeBytes ?? fixture.freezeBytes
    },
    audioAttemptRecord: {
      path: EXP0019_AUDIO_ATTEMPT_PATH,
      bytes: overrides.attemptBytes ?? fixture.attemptBytes
    },
    manifestRecord: {
      path: MANIFEST_PATH,
      bytes: overrides.manifestBytes ?? fixture.manifestBytes
    },
    checkpointRecord: {
      path: fixture.checkpointPath,
      bytes: fixture.checkpointBytes
    },
    criticalSourceRecords: fixture.criticalSourceRecords,
    readWave: overrides.readWave ?? (path => fixture.waves.get(path)),
    now: overrides.now ?? (() => {
      const value = tick;
      tick += 0.25;
      return value;
    }),
    nodeVersion: "v-test"
  };
}

test("onset e fim de atividade usam frames RMS fixos e sustentados", () => {
  const voiced = pcm(3_200, 640);
  const activity = inspectExp0019PcmActivity(voiced);
  assert.equal(detectExp0019PcmOnset(voiced), 640);
  assert.equal(activity.onsetSample, 640);
  assert.equal(activity.activeEndSampleExclusive, 3_200);
  assert.equal(inspectExp0019PcmActivity(Buffer.alloc(3_200 * 2)).onsetSample,
    null);
});

test("replay real do plano com WAVs fake fecha 4 schedules e 16 traces", async () => {
  const fixture = await sourceFixture();
  const replay = await buildExp0019NodeReplay(replayInput(fixture));
  assert.equal(replay.schemaVersion, EXP0019_NODE_REPLAY_SCHEMA);
  assert.equal(replay.pairs.length, 4);
  assert.equal(replay.scenes.length, 8);
  assert.equal(replay.summary.proposals, 16);
  assert.equal(replay.summary.preBoundaryArmProbes, 48);
  assert.equal(replay.summary.preBoundaryInferences, 0);
  assert.equal(replay.summary.frozenTraceParity, "16/16");
  assert.match(replay.bindings.runtimeFingerprint.sha256,
    /^sha256:[a-f0-9]{64}$/u);
  for (const pair of replay.pairs) {
    const scenes = replay.scenes.filter(
      (scene) => scene.pairRootId === pair.pairRootId
    );
    assert.equal(scenes.length, 2);
    assert.deepEqual(scenes[0].schedule, scenes[1].schedule);
    assert.equal(scenes[0].normalization.targetWaveSha256,
      scenes[1].normalization.targetWaveSha256);
    assert.equal(
      pair.schedule.assistant.endSample - pair.schedule.target.endSample,
      4_800
    );
  }
  for (const scene of replay.scenes) {
    assert.deepEqual(Object.keys(scene.ready.arms), ["B0", "B1"]);
    for (const armName of ["B0", "B1"]) {
      assert.equal(scene.ready.arms[armName].frozenTraceExact, true);
      assert.deepEqual(
        Object.keys(scene.ready.arms[armName].trace.probabilities).sort(),
        ["BACKGROUND_OR_NOT_DIRECTED", "DIRECTED_TO_ASSISTANT"]
      );
    }
  }
  assert.deepEqual(
    validateExp0019NodeReplayArtifact(replay, {
      plan: fixture.plan,
      instrumentationFreeze: fixture.freeze
    }),
    { valid: true, errors: [] }
  );
});

test("freeze inválido, fonte atual divergente e manifest fora do lacre fecham", async () => {
  const fixture = await sourceFixture();
  const invalidHash = structuredClone(fixture.freeze);
  invalidHash.runnerSourceCommit = "2".repeat(40);
  await assert.rejects(
    buildExp0019NodeReplay(replayInput(fixture, {
      freezeBytes: jsonBytes(invalidHash)
    })),
    /instrumentationFreezeSha256 divergente/iu
  );

  const driftedSource = structuredClone(fixture.freeze);
  driftedSource.criticalSources.find(
    (source) => source.path === "src/eval/exp-0019-replay.mjs"
  ).fileSha256 = `sha256:${"c".repeat(64)}`;
  rehashFreeze(driftedSource);
  await assert.rejects(
    buildExp0019NodeReplay(replayInput(fixture, {
      freezeBytes: jsonBytes(driftedSource)
    })),
    /fonte crítica divergiu do freeze/iu
  );

  const driftedManifest = structuredClone(fixture.manifest);
  driftedManifest.provenance.sourceFiles.wrapper.fileSha256 =
    `sha256:${"d".repeat(64)}`;
  rehashManifest(driftedManifest);
  await assert.rejects(
    buildExp0019NodeReplay(replayInput(fixture, {
      manifestBytes: jsonBytes(driftedManifest)
    })),
    /manifest diverge da fonte congelada/iu
  );
});

test("WAV adulterado e duração coerentemente rehashada falham fechados", async () => {
  const fixture = await sourceFixture();
  const firstPath = fixture.plan.audio.streams[0].relativePath;
  const tampered = Buffer.from(fixture.waves.get(firstPath));
  tampered[tampered.length - 1] ^= 0xff;
  await assert.rejects(
    buildExp0019NodeReplay(replayInput(fixture, {
      readWave(path) {
        return path === firstPath ? tampered : fixture.waves.get(path);
      }
    })),
    /waveSha256 divergente/iu
  );

  const durationManifest = structuredClone(fixture.manifest);
  durationManifest.files[0].sampleCount += 1;
  rehashManifest(durationManifest);
  await assert.rejects(
    buildExp0019NodeReplay(replayInput(fixture, {
      manifestBytes: jsonBytes(durationManifest)
    })),
    /formato ou duração WAV divergente/iu
  );
});

test("cauda curta ou sem fala até o horizonte não pode virar padding", async () => {
  const shortFixture = await sourceFixture({ tailSamples: 3_200 });
  await assert.rejects(
    buildExp0019NodeReplay(replayInput(shortFixture)),
    /cauda termina antes do orçamento causal/iu
  );

  const fixture = await sourceFixture();
  const assistant = fixture.plan.audio.streams.find(
    (stream) => stream.kind === "assistant"
  );
  const fileIndex = fixture.manifest.files.findIndex(
    (file) => file.id === assistant.streamId
  );
  const descriptor = fixture.manifest.files[fileIndex];
  const prefixSamples = descriptor.prefixEndSample;
  const silentTail = Buffer.alloc(descriptor.segments[1].sampleCount * 2);
  const prefixPcm = fixture.waves.get(assistant.relativePath).subarray(
    44,
    44 + prefixSamples * 2
  );
  const wave = encodePcm16Wave(Buffer.concat([prefixPcm, silentTail]));
  const files = structuredClone(fixture.manifest.files);
  files[fileIndex] = fileDescriptor(
    fixture.plan,
    assistant,
    [prefixPcm, silentTail],
    wave
  );
  const manifest = manifestFor(
    fixture.plan,
    fixture.planBytes,
    files,
    fixture.freeze,
    fixture.freezeBytes,
    fixture.attempt,
    fixture.attemptBytes
  );
  const waves = new Map(fixture.waves);
  waves.set(assistant.relativePath, wave);
  await assert.rejects(
    buildExp0019NodeReplay(replayInput({
      ...fixture,
      manifest,
      manifestBytes: jsonBytes(manifest),
      waves
    })),
    /neutral-tail: segmento sem fala sustentada/iu
  );
});

test("drift rehashado do scheduleBindingKey ainda quebra igualdade pareada", async () => {
  const originalPlan = JSON.parse(await readFile(
    resolve(REPOSITORY_ROOT, PLAN_PATH),
    "utf8"
  ));
  const plan = structuredClone(originalPlan);
  const pairRootId = plan.scenes[0].scorer.pairRootId;
  const descendants = plan.scenes.filter(
    (scene) => scene.scorer.pairRootId === pairRootId
  );
  descendants[1].scheduleBindingKey = "target-pair-drift";
  rehashPlan(plan);
  const planBytes = jsonBytes(plan);
  const fixture = await sourceFixture({ planBytes });
  await assert.rejects(
    buildExp0019NodeReplay(replayInput(fixture)),
    /igualdade pareada inválida/iu
  );
});

test("runner escreve e revalida somente árvore temporária", async () => {
  const fixture = await sourceFixture();
  const projectRoot = await mkdtemp(join(tmpdir(), "exp0019-replay-"));
  const records = [
    [PLAN_PATH, fixture.planBytes],
    [EXP0019_INSTRUMENTATION_FREEZE_PATH, fixture.freezeBytes],
    [EXP0019_AUDIO_ATTEMPT_PATH, fixture.attemptBytes],
    [MANIFEST_PATH, fixture.manifestBytes],
    [fixture.checkpointPath, fixture.checkpointBytes],
    ...fixture.criticalSourceRecords.map((record) => [
      record.path,
      record.bytes
    ]),
    ...[...fixture.waves.entries()]
  ];
  for (const [path, bytes] of records) {
    const absolute = resolve(projectRoot, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }
  let tick = 0;
  const replay = await runExp0019NodeReplayFiles({
    projectRoot,
    output: OUTPUT_PATH,
    nodeVersion: "v-test",
    testOnly: true,
    verifyAudioManifest: async () => ({ valid: true, errors: [] }),
    now() {
      const value = tick;
      tick += 0.25;
      return value;
    }
  });
  assert.equal(replay.summary.frozenTraceParity, "16/16");
  assert.deepEqual(
    JSON.parse(await readFile(resolve(projectRoot, OUTPUT_PATH), "utf8")),
    replay
  );
  const checked = await runExp0019NodeReplayFiles({
    projectRoot,
    output: OUTPUT_PATH,
    nodeVersion: "v-test",
    check: true,
    testOnly: true,
    verifyAudioManifest: async () => ({ valid: true, errors: [] })
  });
  assert.deepEqual(checked, replay);
});
