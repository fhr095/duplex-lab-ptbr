import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_SUPERTONIC_REQUIRED_MODEL_FILES,
  createExp0019PythonInvocation,
  describeExp0019SupertonicModel,
  exp0019SegmentSeed,
  materializeExp0019Audio,
  validateExp0019AudioPlan,
  verifyExp0019AudioManifest
} from "../scripts/materialize-exp-0019-audio.mjs";
import { encodePcm16Wave } from "../src/audio/wav.mjs";
import {
  EXP0019_CRITICAL_SOURCE_PATHS,
  EXP0019_FROZEN_ARTIFACT_PATHS,
  EXP0019_TTS_RANDOM_SEED,
  EXP0019_TTS_RANDOM_SEED_STRATEGY,
  EXP0019_TTS_PYTHON_PACKAGES,
  createExp0019InstrumentationFreeze
} from "../src/eval/exp-0019-boundary.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const OUTPUT_ROOT = "eval/generated/exp-0019/audio";
const PLAN_PATH = "eval/experiments/exp-0019-causal-audio-plan-v0.1.json";
const MANIFEST_PATH = "eval/sources/exp-0019-causal-audio-v0.1.json";
const FREEZE_PATH =
  "eval/commitments/exp-0019-instrumentation-freeze-v0.1.json";
const HASH_A = `sha256:${"a".repeat(64)}`;
const PLACEHOLDER_SOURCE_BYTES = Buffer.from(
  "exp-0019-critical-source-test-placeholder\n",
  "utf8"
);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function planFixture() {
  const streams = [];
  for (const kind of ["target", "inbound", "assistant"]) {
    for (let index = 1; index <= 4; index += 1) {
      const assistant = kind === "assistant";
      streams.push({
        streamId: `${kind}-${index}`,
        kind,
        speakerSlot: assistant ? "assistant" : "non-assistant",
        relativePath: `${OUTPUT_ROOT}/${kind}-${index}.wav`,
        text: assistant ? null : `${kind} texto ${index}`,
        segments: assistant
          ? [
              { kind: "audible-prefix", text: `prefixo ${index}` },
              { kind: "neutral-tail", text: `cauda neutra ${index}` }
            ]
          : null
      });
    }
  }
  return {
    schemaVersion: "exp-0019-causal-audio-plan-v1",
    experimentId: "EXP-0019",
    audio: {
      synthesis: {
        voiceStyles: { assistant: "F1", nonAssistant: "M1" },
        randomSeedBase: EXP0019_TTS_RANDOM_SEED,
        randomSeedStrategy: EXP0019_TTS_RANDOM_SEED_STRATEGY
      },
      streams
    }
  };
}

async function readRealPlan() {
  const path = resolve(import.meta.dirname, "..", PLAN_PATH);
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeFixtureTree(plan = planFixture()) {
  const projectRoot = await mkdtemp(join(tmpdir(), "exp0019-audio-"));
  const frozenBytes = new Map();
  const planPath = resolve(projectRoot, PLAN_PATH);
  await mkdir(dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const modelDir = await mkdtemp(join(tmpdir(), "exp0019-model-"));
  const modelFiles = [
    ...EXP0019_SUPERTONIC_REQUIRED_MODEL_FILES,
    ...Object.values(plan.audio.synthesis.voiceStyles).map(
      (style) => `voice_styles/${style}.json`
    )
  ];
  for (const path of modelFiles) {
    const absolute = resolve(modelDir, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `fixture:${path}\n`);
  }
  if (typeof plan.planSha256 === "string") {
    const modelArtifactBinding = await describeExp0019SupertonicModel(
      modelDir,
      Object.values(plan.audio.synthesis.voiceStyles)
    );
    const sourceRoot = resolve(import.meta.dirname, "..");
    for (const path of [
      "scripts/materialize-exp-0019-audio.mjs",
      "scripts/lib/materialize-exp-0019-supertonic.py"
    ]) {
      frozenBytes.set(
        path,
        await readFile(resolve(sourceRoot, path))
      );
    }
    const planBytes = await readFile(planPath);
    const freeze = createExp0019InstrumentationFreeze({
      runnerSourceCommit: "1".repeat(40),
      nodeVersion: process.version,
      artifacts: {
        preregistration: {
          path: EXP0019_FROZEN_ARTIFACT_PATHS.preregistration,
          fileSha256: HASH_A
        },
        plan: {
          path: PLAN_PATH,
          fileSha256: sha256(planBytes),
          canonicalSha256: plan.planSha256
        },
        browserCheckpoint: {
          path: EXP0019_FROZEN_ARTIFACT_PATHS.browserCheckpoint,
          fileSha256: HASH_A,
          canonicalSha256: HASH_A
        },
        sourceCheckpoint: {
          path: EXP0019_FROZEN_ARTIFACT_PATHS.sourceCheckpoint,
          fileSha256: HASH_A,
          canonicalSha256: HASH_A
        }
      },
      modelArtifactBinding,
      toolchainBinding: {
        command: "uvx",
        executableSha256: HASH_A,
        version: "uvx 0.11.18 (test)"
      },
      criticalSources: EXP0019_CRITICAL_SOURCE_PATHS.map((path) => ({
        path,
        fileSha256: sha256(
          frozenBytes.get(path) ?? PLACEHOLDER_SOURCE_BYTES
        )
      }))
    });
    const freezePath = resolve(projectRoot, FREEZE_PATH);
    await mkdir(dirname(freezePath), { recursive: true });
    await writeFile(freezePath, `${JSON.stringify(freeze, null, 2)}\n`);
  }
  return {
    projectRoot,
    plan,
    modelDir,
    readCriticalSource(_absolutePath, repositoryPath) {
      return Promise.resolve(Buffer.from(
        frozenBytes?.get(repositoryPath) ?? PLACEHOLDER_SOURCE_BYTES
      ));
    }
  };
}

function pcmFixture(sampleCount, seed) {
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    pcm.writeInt16LE((index + seed) % 2 === 0 ? 2_000 : -2_000, index * 2);
  }
  return pcm;
}

function fakeRunner(synthesisCounts) {
  return async ({
    plan,
    projectRoot,
    freezeFileSha256,
    attemptBytes
  }) => {
    const files = [];
    for (const [index, stream] of plan.audio.streams.entries()) {
      const assistant = stream.kind === "assistant";
      const segments = assistant
        ? [pcmFixture(900 + index, index), pcmFixture(2_400 + index, index + 1)]
        : [pcmFixture(1_200 + index, index)];
      synthesisCounts.set(stream.streamId, segments.length);
      const pcm = Buffer.concat(segments);
      const absolute = resolve(projectRoot, stream.relativePath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, encodePcm16Wave(pcm, { sampleRate: 16_000 }));
      files.push({
        id: stream.streamId,
        relativePath: stream.relativePath,
        sampleCount: pcm.length / 2,
        segmentSampleCounts: segments.map((segment) => segment.length / 2),
        segmentSeeds: (assistant
          ? ["audible-prefix", "neutral-tail"]
          : ["utterance"]
        ).map((kind) => exp0019SegmentSeed(stream.streamId, kind)),
        prefixEndSample: assistant
          ? segments[0].length / 2
          : null
      });
    }
    return {
      schemaVersion: "exp-0019-supertonic-materialization-receipt-v1",
      engine: "supertonic",
      model: "supertonic-3",
      sdkVersion: "1.3.1",
      pythonVersion: "3.12-test",
      pythonExecutableSha256: HASH_A,
      packageVersions: structuredClone(EXP0019_TTS_PYTHON_PACKAGES),
      supertonicPackageSha256: HASH_A,
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
      instrumentationFreezeFileSha256: freezeFileSha256,
      attemptFileSha256: sha256(attemptBytes),
      files
    };
  };
}

test("plano exige 12 streams, slots e segmentos canônicos", () => {
  const plan = planFixture();
  assert.equal(validateExp0019AudioPlan(plan).valid, true);

  const missingTail = structuredClone(plan);
  missingTail.audio.streams.find(
    (stream) => stream.kind === "assistant"
  ).segments.pop();
  assert.match(
    validateExp0019AudioPlan(missingTail).errors.join("; "),
    /segments/iu
  );

  const voiceLeak = structuredClone(plan);
  voiceLeak.audio.synthesis.voiceStyles.nonAssistant = "F1";
  assert.match(
    validateExp0019AudioPlan(voiceLeak).errors.join("; "),
    /precisam ser distintas/iu
  );

  const wrongShape = structuredClone(plan);
  wrongShape.audio.streams = wrongShape.audio.streams.slice(0, 11);
  assert.match(
    validateExp0019AudioPlan(wrongShape).errors.join("; "),
    /exatamente 12/iu
  );
});

test("plano real usa somente audio.streams e passa a validação", async () => {
  const plan = await readRealPlan();
  assert.equal(Object.hasOwn(plan, "audioSources"), false);
  assert.deepEqual(validateExp0019AudioPlan(plan), {
    valid: true,
    errors: []
  });
});

test("invocação real fica presa ao ambiente cacheado e offline", () => {
  const invocation = createExp0019PythonInvocation({
    planPath: "/repo/plan.json",
    freezePath: "/repo/freeze.json",
    freezeFileSha256: HASH_A,
    attemptPath: "/repo/attempt.json",
    projectRoot: "/repo",
    outputRoot: "/repo/eval/generated/exp-0019/audio",
    modelDir: "/cache/supertonic3",
    uvxExecutablePath: "/tools/uvx",
    receiptPath: "/repo/eval/generated/exp-0019/audio/receipt.json"
  });
  assert.equal(invocation.command, "/tools/uvx");
  assert.deepEqual(invocation.args.slice(0, 3), [
    "--offline", "--from", "supertonic==1.3.1"
  ]);
  assert.ok(invocation.args.includes("python"));
  assert.ok(invocation.args.includes("numpy==2.5.1"));
  assert.ok(invocation.args.includes("/cache/supertonic3"));
  assert.ok(invocation.args.includes("/repo/freeze.json"));
  assert.ok(invocation.args.includes("/repo/attempt.json"));
  assert.equal(invocation.environmentMode, "uvx-offline-existing-cache");
});

test("seed por stream e segmento é estável e separa sínteses", () => {
  const first = exp0019SegmentSeed("assistant-1", "audible-prefix");
  assert.equal(
    first,
    exp0019SegmentSeed("assistant-1", "audible-prefix")
  );
  assert.notEqual(
    first,
    exp0019SegmentSeed("assistant-1", "neutral-tail")
  );
  assert.notEqual(
    first,
    exp0019SegmentSeed("assistant-2", "audible-prefix")
  );
});

test("execFile arbitrário é recusado fora do harness de testes", async () => {
  await assert.rejects(
    materializeExp0019Audio({ execFileImpl() {} }),
    /execFile injetado.*somente.*testes/iu
  );
});

test("abertura canônica de tentativa não pode usar harness", async () => {
  await assert.rejects(
    materializeExp0019Audio({
      openAttemptOnly: true,
      testOnly: true
    }),
    /abertura de tentativa.*não um harness/iu
  );
});

test("cache de pesos dentro do repositório é recusado antes do runner", async () => {
  const fixture = await writeFixtureTree(await readRealPlan());
  const internalModelDir = resolve(fixture.projectRoot, "model-cache");
  await mkdir(internalModelDir, { recursive: true });
  let runnerCalls = 0;
  await assert.rejects(
    materializeExp0019Audio({
      projectRoot: fixture.projectRoot,
      plan: PLAN_PATH,
      manifest: MANIFEST_PATH,
      outputRoot: OUTPUT_ROOT,
      modelDir: internalModelDir,
      runner: async () => {
        runnerCalls += 1;
      },
      testOnly: true,
      readCriticalSource: fixture.readCriticalSource
    }),
    /cache Supertonic.*fora do repositório/iu
  );
  assert.equal(runnerCalls, 0);
});

test("fake runner produz 12 WAVs exatos e manifest commitável", async () => {
  const { projectRoot, modelDir, readCriticalSource } = await writeFixtureTree(
    await readRealPlan()
  );
  const synthesisCounts = new Map();
  const manifest = await materializeExp0019Audio({
    projectRoot,
    plan: PLAN_PATH,
    manifest: MANIFEST_PATH,
    outputRoot: OUTPUT_ROOT,
    modelDir,
    runner: fakeRunner(synthesisCounts),
    testOnly: true,
    readCriticalSource
  });

  assert.equal(manifest.files.length, 12);
  assert.deepEqual(manifest.selection.roles, {
    target: 4,
    inbound: 4,
    "assistant-output": 4
  });
  assert.equal(manifest.provenance.networkAllowed, false);
  assert.equal(manifest.provenance.paidApiCalls, 0);
  assert.equal(
    manifest.provenance.modelCacheLocation,
    "local-cache-outside-repository"
  );
  assert.equal(Object.hasOwn(manifest.provenance, "modelCachePath"), false);
  assert.equal(manifest.targetReuse.synthesesPerTarget, 1);
  assert.ok(manifest.files.filter((file) => file.role === "target")
    .every((file) => synthesisCounts.get(file.id) === 1));
  assert.ok(manifest.files.filter((file) => file.role === "assistant-output")
    .every((file) =>
      synthesisCounts.get(file.id) === 2 &&
      file.segments.length === 2 &&
      file.prefixEndSample === file.segments[0].sampleCount &&
      file.sampleCount === file.segments[0].sampleCount +
        file.segments[1].sampleCount
    ));
  assert.equal(
    (await verifyExp0019AudioManifest(manifest, {
      projectRoot,
      allowTestHarness: true,
      readCriticalSource
    })).valid,
    true
  );
  assert.deepEqual(
    JSON.parse(await readFile(resolve(projectRoot, MANIFEST_PATH), "utf8")),
    manifest
  );
});

test("check falha fechado para WAV adulterado sem chamar modelo", async () => {
  const { projectRoot, modelDir, readCriticalSource } = await writeFixtureTree(
    await readRealPlan()
  );
  const manifest = await materializeExp0019Audio({
    projectRoot,
    plan: PLAN_PATH,
    manifest: MANIFEST_PATH,
    outputRoot: OUTPUT_ROOT,
    modelDir,
    runner: fakeRunner(new Map()),
    testOnly: true,
    readCriticalSource
  });
  const target = resolve(projectRoot, manifest.files[0].relativePath);
  const bytes = await readFile(target);
  bytes[bytes.length - 1] ^= 0xff;
  await writeFile(target, bytes);
  const validation = await verifyExp0019AudioManifest(manifest, {
    projectRoot,
    allowTestHarness: true,
    readCriticalSource
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /WAV ausente ou divergente/iu);
});

test("freeze divergente bloqueia o modelo antes de criar áudio", async () => {
  const { projectRoot, modelDir, readCriticalSource } = await writeFixtureTree(
    await readRealPlan()
  );
  await writeFile(resolve(projectRoot, FREEZE_PATH), "{}\n");
  let runnerCalls = 0;
  await assert.rejects(
    materializeExp0019Audio({
      projectRoot,
      plan: PLAN_PATH,
      freeze: FREEZE_PATH,
      manifest: MANIFEST_PATH,
      outputRoot: OUTPUT_ROOT,
      modelDir,
      testOnly: true,
      readCriticalSource,
      runner: async () => {
        runnerCalls += 1;
        throw new Error("runner não deveria ser chamado");
      }
    }),
    /freeze incompatível/iu
  );
  assert.equal(runnerCalls, 0);
});

test("tentativa exclusiva impede uma segunda síntese silenciosa", async () => {
  const { projectRoot, modelDir, readCriticalSource } = await writeFixtureTree(
    await readRealPlan()
  );
  let runnerCalls = 0;
  const runner = async (input) => {
    runnerCalls += 1;
    return fakeRunner(new Map())(input);
  };
  await materializeExp0019Audio({
    projectRoot,
    plan: PLAN_PATH,
    manifest: MANIFEST_PATH,
    outputRoot: OUTPUT_ROOT,
    modelDir,
    runner,
    testOnly: true,
    readCriticalSource
  });
  await assert.rejects(
    materializeExp0019Audio({
      projectRoot,
      plan: PLAN_PATH,
      manifest: MANIFEST_PATH,
      outputRoot: OUTPUT_ROOT,
      modelDir,
      runner,
      testOnly: true,
      readCriticalSource
    }),
    /tentativa já existe|reexecução silenciosa/iu
  );
  assert.equal(runnerCalls, 1);
  assert.ok(await readFile(resolve(projectRoot, EXP0019_AUDIO_ATTEMPT_PATH)));
});

test("drift em qualquer fonte crítica bloqueia antes do runner", async () => {
  const fixture = await writeFixtureTree(await readRealPlan());
  let runnerCalls = 0;
  await assert.rejects(
    materializeExp0019Audio({
      projectRoot: fixture.projectRoot,
      plan: PLAN_PATH,
      manifest: MANIFEST_PATH,
      outputRoot: OUTPUT_ROOT,
      modelDir: fixture.modelDir,
      testOnly: true,
      readCriticalSource(absolutePath, repositoryPath) {
        if (repositoryPath === "src/audio/wav.mjs") {
          return Promise.resolve(Buffer.from("drift coerente\n"));
        }
        return fixture.readCriticalSource(absolutePath, repositoryPath);
      },
      runner: async () => {
        runnerCalls += 1;
        throw new Error("runner não deveria ser chamado");
      }
    }),
    /fonte crítica divergiu do freeze/iu
  );
  assert.equal(runnerCalls, 0);
  await assert.rejects(
    readFile(resolve(fixture.projectRoot, EXP0019_AUDIO_ATTEMPT_PATH)),
    /ENOENT/u
  );
});

test("receipt incompatível consome a tentativa e não permite cherry-pick", async () => {
  const fixture = await writeFixtureTree(await readRealPlan());
  const runner = async (input) => {
    const receipt = await fakeRunner(new Map())(input);
    return { ...receipt, networkAllowed: true };
  };
  await assert.rejects(
    materializeExp0019Audio({
      projectRoot: fixture.projectRoot,
      plan: PLAN_PATH,
      manifest: MANIFEST_PATH,
      outputRoot: OUTPUT_ROOT,
      modelDir: fixture.modelDir,
      runner,
      testOnly: true,
      readCriticalSource: fixture.readCriticalSource
    }),
    /receipt do runner Supertonic é incompatível/iu
  );
  assert.ok(await readFile(resolve(
    fixture.projectRoot,
    EXP0019_AUDIO_ATTEMPT_PATH
  )));
  await assert.rejects(
    materializeExp0019Audio({
      projectRoot: fixture.projectRoot,
      plan: PLAN_PATH,
      manifest: MANIFEST_PATH,
      outputRoot: OUTPUT_ROOT,
      modelDir: fixture.modelDir,
      runner: fakeRunner(new Map()),
      testOnly: true,
      readCriticalSource: fixture.readCriticalSource
    }),
    /tentativa já existe|reexecução silenciosa/iu
  );
});

test("rehash coerente não transforma tentativa única em rerun", async () => {
  const fixture = await writeFixtureTree(await readRealPlan());
  const manifest = await materializeExp0019Audio({
    projectRoot: fixture.projectRoot,
    plan: PLAN_PATH,
    manifest: MANIFEST_PATH,
    outputRoot: OUTPUT_ROOT,
    modelDir: fixture.modelDir,
    runner: fakeRunner(new Map()),
    testOnly: true,
    readCriticalSource: fixture.readCriticalSource
  });
  const attemptPath = resolve(
    fixture.projectRoot,
    EXP0019_AUDIO_ATTEMPT_PATH
  );
  const attempt = JSON.parse(await readFile(attemptPath, "utf8"));
  attempt.allowedSyntheses.rerunAllowed = true;
  const attemptCore = structuredClone(attempt);
  delete attemptCore.attemptSha256;
  attempt.attemptSha256 = `sha256:${canonicalSha256(attemptCore)}`;
  const attemptBytes = Buffer.from(`${JSON.stringify(attempt, null, 2)}\n`);
  await writeFile(attemptPath, attemptBytes);

  const rehashedManifest = structuredClone(manifest);
  rehashedManifest.audioAttempt.fileSha256 = sha256(attemptBytes);
  rehashedManifest.audioAttempt.canonicalSha256 = attempt.attemptSha256;
  rehashedManifest.materializationReceipt.attemptFileSha256 =
    sha256(attemptBytes);
  rehashedManifest.provenance.receiptCanonicalSha256 =
    `sha256:${canonicalSha256(rehashedManifest.materializationReceipt)}`;
  const manifestCore = structuredClone(rehashedManifest);
  delete manifestCore.manifestSha256;
  rehashedManifest.manifestSha256 =
    `sha256:${canonicalSha256(manifestCore)}`;
  const validation = await verifyExp0019AudioManifest(rehashedManifest, {
    projectRoot: fixture.projectRoot,
    allowTestHarness: true,
    readCriticalSource: fixture.readCriticalSource
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /tentativa única|contrato/iu);
});

test("checker real recusa commits Git inventados mesmo com rehash coerente", async () => {
  const fixture = await writeFixtureTree(await readRealPlan());
  const manifest = structuredClone(await materializeExp0019Audio({
    projectRoot: fixture.projectRoot,
    plan: PLAN_PATH,
    manifest: MANIFEST_PATH,
    outputRoot: OUTPUT_ROOT,
    modelDir: fixture.modelDir,
    runner: fakeRunner(new Map()),
    testOnly: true,
    readCriticalSource: fixture.readCriticalSource
  }));
  manifest.provenance.testHarnessUsed = false;
  const core = structuredClone(manifest);
  delete core.manifestSha256;
  manifest.manifestSha256 = `sha256:${canonicalSha256(core)}`;
  const validation = await verifyExp0019AudioManifest(manifest, {
    projectRoot: fixture.projectRoot,
    readCriticalSource: fixture.readCriticalSource
  });
  assert.equal(validation.valid, false);
  assert.match(
    validation.errors.join("; "),
    /freeze canônico|commit|Git/iu
  );
});
