import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildTimingCalibrationPack
} from "../src/eval/calibration/pack-builder.mjs";
import {
  closeWindowsSpeechSynthesizer,
  prewarmWindowsSpeech,
  synthesizeWindowsSpeech
} from "../src/tts/windows-system-tts.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULTS = Object.freeze({
  config: "eval/experiments/exp-0015-timing-calibration.pt-BR.json",
  humanManifest: "eval/generated/coraa/manifest.json",
  out: "eval/calibration/exp-0015-timing-pack-v0.1.json",
  audioRoot: "eval/generated/exp-0015/audio"
});

function parseArgs(args) {
  const options = { ...DEFAULTS, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
    } else if (
      ["--config", "--human-manifest", "--out", "--audio-root"]
        .includes(argument)
    ) {
      const field = argument.slice(2).replace(
        /-([a-z])/gu,
        (_, letter) => letter.toUpperCase()
      );
      options[field] = args[++index];
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

async function writeOrCheck(path, bytes, check) {
  const output = resolve(PROJECT_ROOT, path);
  if (check) {
    const existing = await readFile(output).catch(() => null);
    if (existing === null || !existing.equals(bytes)) {
      throw new Error(`artefato ausente ou divergente: ${path}`);
    }
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
}

export async function materializeExp0015(options) {
  const [configBytes, humanBytes] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, options.config)),
    readFile(resolve(PROJECT_ROOT, options.humanManifest)).catch((error) => {
      throw new Error(
        "manifest CORAA ausente; execute npm run fetch:real-audio",
        { cause: error }
      );
    })
  ]);
  const config = JSON.parse(configBytes);
  const humanManifest = JSON.parse(humanBytes);
  const status = await prewarmWindowsSpeech();
  try {
    const result = await buildTimingCalibrationPack({
      config,
      configBytes,
      configPath: options.config,
      humanManifest,
      outputRoot: options.audioRoot,
      engine: {
        id: "windows-system-speech",
        voice: status.worker?.voice ?? "unknown",
        culture: status.worker?.culture ?? "unknown"
      },
      readWave: (path) => readFile(resolve(PROJECT_ROOT, path)),
      synthesize: synthesizeWindowsSpeech
    });
    if (!result.pack.buildGate.pass) {
      throw new Error("pack EXP-0015 falhou seus gates de construção");
    }
    for (const artifact of result.artifacts) {
      await writeOrCheck(artifact.path, artifact.bytes, options.check);
    }
    const packBytes = Buffer.from(
      `${JSON.stringify(result.pack, null, 2)}\n`
    );
    await writeOrCheck(options.out, packBytes, options.check);
    return result;
  } finally {
    await closeWindowsSpeechSynthesizer({ drain: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await materializeExp0015(options);
  console.log(
    `EXP-0015 pack ${options.check ? "CHECK" : "BUILD"}: ` +
      `${result.pack.scenes.length} cenas, ` +
      `${result.artifacts.length} WAVs locais, ` +
      `${result.pack.packSha256}`
  );
  console.log(`Manifest versionado: ${options.out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
