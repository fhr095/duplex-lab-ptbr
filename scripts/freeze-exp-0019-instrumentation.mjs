import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  validateExp0018Checkpoint
} from "../src/eval/exp-0018-training.mjs";
import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_CRITICAL_SOURCE_PATHS,
  EXP0019_INSTRUMENTATION_FREEZE_PATH,
  EXP0019_TTS_CONFIG,
  createExp0019InstrumentationFreeze
} from "../src/eval/exp-0019-boundary.mjs";
import {
  validateExp0019CausalAudioPlan
} from "../src/eval/exp-0019-causal-audio-bridge.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  assertExp0019ModelCacheOutsideRepository,
  describeExp0019SupertonicModel,
  describeExp0019UvxToolchain
} from "./materialize-exp-0019-audio.mjs";
import {
  validateContextRelevanceCheckpoint
} from "../web/context-relevance-shadow.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PATHS = Object.freeze({
  preregistration:
    "docs/experiments/EXP-0019-causal-audio-context-bridge.md",
  plan: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
  browserCheckpoint: "web/context-relevance-checkpoint.json",
  sourceCheckpoint: "eval/checkpoints/exp-0018-context-v0.1.json",
  audioRoot: "eval/generated/exp-0019/audio",
  audioManifest: "eval/sources/exp-0019-causal-audio-v0.1.json",
  nodeReplay: "eval/reports/exp-0019-node-replay-v0.1.json",
  browserReport: "eval/reports/exp-0019-browser-v0.1.json"
});

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`EXP-0019 freeze: ${message}`);
  }
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function git(...args) {
  const result = await execFile("git", args, { cwd: PROJECT_ROOT });
  return result.stdout.trim();
}

async function readRecord(path, parseJson = true) {
  const bytes = await readFile(resolve(PROJECT_ROOT, path));
  return {
    path,
    bytes,
    fileSha256: sha256(bytes),
    value: parseJson ? JSON.parse(bytes.toString("utf8")) : null
  };
}

async function assertAbsent(path, label) {
  const exists = await access(resolve(PROJECT_ROOT, path)).then(
    () => true,
    () => false
  );
  invariant(!exists, `${label} já existe antes do freeze: ${path}`);
}

async function main() {
  const status = await git("status", "--porcelain=v1", "--untracked-files=all");
  invariant(status === "", "worktree precisa estar limpo e commitado");
  await git(
    "check-ignore",
    "--quiet",
    `${PATHS.audioRoot}/future-probe.wav`
  ).catch(() => {
    invariant(false, "output bruto não está coberto pelo .gitignore");
  });
  invariant(
    await git("ls-files", "--", PATHS.audioRoot) === "",
    "output bruto já contém arquivos rastreados pelo Git"
  );
  const runnerSourceCommit = await git("rev-parse", "HEAD");
  for (const path of EXP0019_CRITICAL_SOURCE_PATHS) {
    await git("ls-files", "--error-unmatch", path);
  }
  await Promise.all([
    assertAbsent(PATHS.audioRoot, "áudio materializado"),
    assertAbsent(PATHS.audioManifest, "manifest de áudio"),
    assertAbsent(EXP0019_AUDIO_ATTEMPT_PATH, "tentativa de materialização"),
    assertAbsent(PATHS.nodeReplay, "replay Node"),
    assertAbsent(PATHS.browserReport, "campanha Chrome"),
    assertAbsent(
      EXP0019_INSTRUMENTATION_FREEZE_PATH,
      "commitment de freeze"
    )
  ]);

  const [preregistration, plan, browserCheckpoint, sourceCheckpoint] =
    await Promise.all([
      readRecord(PATHS.preregistration, false),
      readRecord(PATHS.plan),
      readRecord(PATHS.browserCheckpoint),
      readRecord(PATHS.sourceCheckpoint)
    ]);
  const planValidation = validateExp0019CausalAudioPlan(plan.value);
  const browserValidation = validateContextRelevanceCheckpoint(
    browserCheckpoint.value
  );
  const sourceValidation = validateExp0018Checkpoint(sourceCheckpoint.value);
  invariant(planValidation.valid,
    `plano inválido: ${planValidation.errors.join("; ")}`);
  invariant(browserValidation.valid,
    `checkpoint browser inválido: ${browserValidation.errors.join("; ")}`);
  invariant(sourceValidation.valid,
    `checkpoint fonte inválido: ${sourceValidation.errors.join("; ")}`);
  invariant(
    plan.value.bindings.checkpoint.fileSha256 === sourceCheckpoint.fileSha256 &&
    plan.value.bindings.checkpoint.canonicalSha256 ===
      sourceCheckpoint.value.checkpointSha256 &&
    browserCheckpoint.value.source.fileSha256 === sourceCheckpoint.fileSha256 &&
    browserCheckpoint.value.source.checkpointSha256 ===
      sourceCheckpoint.value.checkpointSha256,
    "plano/browser não estão vinculados ao mesmo checkpoint fonte"
  );
  invariant(
    JSON.stringify(plan.value.audio.synthesis.voiceStyles) ===
      JSON.stringify(EXP0019_TTS_CONFIG.voiceStyles) &&
      plan.value.audio.synthesis.randomSeedBase ===
        EXP0019_TTS_CONFIG.randomness.baseSeed &&
      plan.value.audio.synthesis.randomSeedStrategy ===
        EXP0019_TTS_CONFIG.randomness.strategy,
    "vozes ou seed do plano divergem da configuração TTS congelável"
  );

  const modelDir = resolve(
    process.env.SUPERTONIC_MODEL_DIR ??
      resolve(process.env.XDG_CACHE_HOME ?? resolve(
        homedir(),
        ".cache"
      ), "supertonic3")
  );
  await assertExp0019ModelCacheOutsideRepository(PROJECT_ROOT, modelDir);
  const [modelArtifactBinding, toolchain] = await Promise.all([
    describeExp0019SupertonicModel(
      modelDir,
      Object.values(EXP0019_TTS_CONFIG.voiceStyles)
    ),
    describeExp0019UvxToolchain()
  ]);
  const criticalSources = await Promise.all(
    EXP0019_CRITICAL_SOURCE_PATHS.map(async (path) => ({
      path,
      fileSha256: sha256(await readFile(resolve(PROJECT_ROOT, path)))
    }))
  );
  const freeze = createExp0019InstrumentationFreeze({
    runnerSourceCommit,
    nodeVersion: process.version,
    artifacts: {
      preregistration: {
        path: preregistration.path,
        fileSha256: preregistration.fileSha256
      },
      plan: {
        path: plan.path,
        fileSha256: plan.fileSha256,
        canonicalSha256: plan.value.planSha256
      },
      browserCheckpoint: {
        path: browserCheckpoint.path,
        fileSha256: browserCheckpoint.fileSha256,
        canonicalSha256: browserCheckpoint.value.browserCheckpointSha256
      },
      sourceCheckpoint: {
        path: sourceCheckpoint.path,
        fileSha256: sourceCheckpoint.fileSha256,
        canonicalSha256: sourceCheckpoint.value.checkpointSha256
      }
    },
    modelArtifactBinding,
    toolchainBinding: toolchain.binding,
    criticalSources
  });
  invariant(
    freeze.instrumentationFreezeSha256 ===
      `sha256:${canonicalSha256((() => {
        const core = structuredClone(freeze);
        delete core.instrumentationFreezeSha256;
        return core;
      })())}`,
    "hash final não é canônico"
  );
  await writeFile(
    resolve(PROJECT_ROOT, EXP0019_INSTRUMENTATION_FREEZE_PATH),
    `${JSON.stringify(freeze, null, 2)}\n`,
    { flag: "wx" }
  );
  console.log(
    `EXP-0019 instrumentação congelada: ${freeze.instrumentationFreezeSha256}`
  );
  console.log("Zero áudio, replay, Chrome, API paga ou autoridade antes do freeze.");
}

await main();
