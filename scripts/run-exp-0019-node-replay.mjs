import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildExp0019NodeReplay,
  validateExp0019NodeReplayArtifact
} from "../src/eval/exp-0019-replay.mjs";
import { verifyExp0019AudioManifest } from
  "./materialize-exp-0019-audio.mjs";
import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_INSTRUMENTATION_FREEZE_PATH
} from
  "../src/eval/exp-0019-boundary.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  plan: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
  instrumentationFreeze: EXP0019_INSTRUMENTATION_FREEZE_PATH,
  audioAttempt: EXP0019_AUDIO_ATTEMPT_PATH,
  manifest: "eval/sources/exp-0019-causal-audio-v0.1.json",
  output: "eval/reports/exp-0019-node-replay-v0.1.json"
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(`runner Node EXP-0019: ${message}`);
  }
}

function projectPath(projectRoot, path, label) {
  assert(typeof path === "string" && path.length > 0 && !isAbsolute(path),
    `${label} precisa ser path relativo`);
  const absolute = resolve(projectRoot, path);
  const fromRoot = relative(projectRoot, absolute);
  assert(
    fromRoot.length > 0 && fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot),
    `${label} precisa permanecer dentro do projeto`
  );
  return absolute;
}

async function jsonRecord(projectRoot, path, label) {
  const bytes = await readFile(projectPath(projectRoot, path, label));
  return Object.freeze({ path, bytes });
}

function replayClock(replay) {
  const durations = replay.scenes.flatMap((scene) => [
    scene.ready.arms.B0.computeMs,
    scene.ready.arms.B1.computeMs
  ]);
  let call = 0;
  return () => {
    const index = Math.floor(call / 2);
    const value = call % 2 === 0 ? 0 : durations[index];
    call += 1;
    return value;
  };
}

export async function runExp0019NodeReplayFiles(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const planPath = options.plan ?? DEFAULTS.plan;
  const instrumentationFreezePath = options.instrumentationFreeze ??
    DEFAULTS.instrumentationFreeze;
  const manifestPath = options.manifest ?? DEFAULTS.manifest;
  const audioAttemptPath = options.audioAttempt ?? DEFAULTS.audioAttempt;
  const outputPath = options.output ?? DEFAULTS.output;
  const [
    planRecord,
    instrumentationFreezeRecord,
    audioAttemptRecord,
    manifestRecord
  ] =
    await Promise.all([
    jsonRecord(projectRoot, planPath, "--plan"),
    jsonRecord(
      projectRoot,
      instrumentationFreezePath,
      "--instrumentation-freeze"
    ),
    jsonRecord(projectRoot, audioAttemptPath, "--audio-attempt"),
    jsonRecord(projectRoot, manifestPath, "--manifest")
  ]);
  const plan = JSON.parse(planRecord.bytes.toString("utf8"));
  const manifest = JSON.parse(manifestRecord.bytes.toString("utf8"));
  const instrumentationFreeze = JSON.parse(
    instrumentationFreezeRecord.bytes.toString("utf8")
  );
  const checkpointPath = options.checkpoint ?? plan?.bindings?.checkpoint?.path;
  assert(typeof checkpointPath === "string",
    "checkpoint não pôde ser derivado do plano");
  const checkpointRecord = await jsonRecord(
    projectRoot,
    checkpointPath,
    "--checkpoint"
  );
  const outputAbsolute = projectPath(projectRoot, outputPath, "--output");
  assert(
    options.verifyAudioManifest === undefined || options.testOnly === true,
    "verificador de manifest injetado exige harness explícito de testes"
  );
  const verifyAudioManifest = options.verifyAudioManifest ??
    verifyExp0019AudioManifest;
  const manifestValidation = await verifyAudioManifest(manifest, {
    projectRoot,
    modelDir: options.modelDir,
    requireEvidenceCommitted: options.testOnly !== true
  });
  assert(
    manifestValidation?.valid === true,
    `manifest de áudio inválido: ${
      manifestValidation?.errors?.join("; ") ?? "verificador sem evidência"
    }`
  );
  let existing = null;
  if (options.check === true) {
    existing = JSON.parse(await readFile(outputAbsolute, "utf8"));
    const validation = validateExp0019NodeReplayArtifact(existing, {
      plan,
      instrumentationFreeze
    });
    assert(validation.valid,
      `replay existente inválido: ${validation.errors.join("; ")}`);
  }
  const replay = await buildExp0019NodeReplay({
    planRecord,
    instrumentationFreezeRecord,
    audioAttemptRecord,
    manifestRecord,
    checkpointRecord,
    criticalSourceRecords: await Promise.all([
      "scripts/run-exp-0019-node-replay.mjs",
      "src/eval/exp-0019-replay.mjs"
    ].map((path) => jsonRecord(projectRoot, path, "critical source"))),
    readWave(relativePath) {
      return readFile(projectPath(projectRoot, relativePath, "WAV"));
    },
    now: options.now ?? (existing ? replayClock(existing) : undefined),
    nodeVersion: options.nodeVersion ?? process.version
  });
  const bytes = `${JSON.stringify(replay, null, 2)}\n`;
  if (options.check === true) {
    const observed = await readFile(outputAbsolute, "utf8");
    assert(observed === bytes, "replay existente não é reproduzível");
  } else {
    await mkdir(dirname(outputAbsolute), { recursive: true });
    await writeFile(outputAbsolute, bytes, { flag: "wx" });
  }
  return replay;
}

function parseArgs(args) {
  const options = { check: false };
  const fields = {
    "--plan": "plan",
    "--instrumentation-freeze": "instrumentationFreeze",
    "--audio-attempt": "audioAttempt",
    "--manifest": "manifest",
    "--checkpoint": "checkpoint",
    "--output": "output"
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const field = fields[argument];
    assert(field && index + 1 < args.length,
      `argumento desconhecido ou sem valor: ${argument}`);
    options[field] = args[++index];
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const replay = await runExp0019NodeReplayFiles(options);
  console.log(
    `EXP-0019 NODE REPLAY ${options.check ? "CHECK" : "BUILD"}: ` +
      replay.replaySha256
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
