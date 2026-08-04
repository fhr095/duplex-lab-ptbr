import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  generateSeededWhiteNoisePcm16,
  measurePcm16
} from "../src/audio/acoustic-renderer.mjs";
import { encodePcm16Wave, inspectWave } from "../src/audio/wav.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const packPath = resolve(
  projectRoot,
  "eval/experiments/exp-0026-experience-pack.pt-BR.json"
);
const pack = JSON.parse(await readFile(packPath, "utf8"));
const recipe = pack.noise;
if (
  recipe.kind !== "seeded-white-noise" ||
  recipe.speechPresent !== false ||
  recipe.channels !== 1
) {
  throw new TypeError("receita S5 precisa ser ruído branco mono sem fala");
}
const sampleCount = Math.round(
  recipe.sampleRate * recipe.durationMs / 1_000
);
const pcm = generateSeededWhiteNoisePcm16({
  sampleCount,
  seed: recipe.seed,
  targetRms: recipe.targetRms
});
const wave = encodePcm16Wave(pcm, {
  sampleRate: recipe.sampleRate,
  channels: recipe.channels
});
const digest = createHash("sha256").update(wave).digest("hex");
if (recipe.sha256 && recipe.sha256 !== digest) {
  throw new Error(`SHA do ruído divergiu: esperado ${recipe.sha256}, obtido ${digest}`);
}
const outputPath = resolve(projectRoot, recipe.artifactPath);
const check = process.argv.includes("--check");
if (check) {
  if (!recipe.sha256) throw new Error("pack ainda não congela noise.sha256");
  const existing = await readFile(outputPath);
  const existingSha = createHash("sha256").update(existing).digest("hex");
  if (existingSha !== digest) throw new Error("artefato S5 materializado divergiu");
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, wave);
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "exp-0026-s5-noise-materialization-v1",
  check,
  path: recipe.artifactPath,
  sha256: digest,
  recipe: {
    kind: recipe.kind,
    speechPresent: recipe.speechPresent,
    seed: recipe.seed,
    sampleRate: recipe.sampleRate,
    channels: recipe.channels,
    durationMs: recipe.durationMs,
    targetRms: recipe.targetRms
  },
  pcm: measurePcm16(pcm, { sampleRate: recipe.sampleRate }),
  wave: inspectWave(wave)
}, null, 2)}\n`);
