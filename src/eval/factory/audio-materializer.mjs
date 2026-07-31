import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { inspectWave } from "../../audio/wav.mjs";
import { canonicalSha256 } from "./canonical-hash.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function createTtsRecipe(item, engine) {
  if (item?.phenomenon !== "correction") {
    throw new TypeError("materializador v1 aceita apenas correction");
  }
  return {
    schemaVersion: 1,
    engine: {
      id: engine.id,
      voice: engine.voice,
      culture: engine.culture
    },
    text: item.stimulus.text,
    rate: item.audioPlan.rate,
    output: {
      container: "wav",
      purpose: "near-end-user-evaluation"
    }
  };
}

export function ttsCacheKey(recipe) {
  return canonicalSha256(recipe);
}

export async function materializeFactoryAudio({
  cases,
  projectRoot,
  engine,
  synthesize,
  refresh = false,
  verifyDeterminism = true
}) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new TypeError("cases não pode estar vazio");
  }
  if (typeof synthesize !== "function") {
    throw new TypeError("synthesize precisa ser função");
  }
  const root = resolve(projectRoot);
  const entries = [];
  for (const [index, item] of cases.entries()) {
    const recipe = createTtsRecipe(item, engine);
    const recipeSha256 = ttsCacheKey(recipe);
    const cachePath = resolve(
      root,
      `eval/generated/factory/tts-cache/${recipeSha256}.wav`
    );
    const outputPath = resolve(
      root,
      `eval/generated/factory/audio/${item.id}.wav`
    );
    let wave = refresh
      ? null
      : await readFile(cachePath).catch(() => null);
    const cacheHit = wave !== null;
    if (!wave) {
      wave = await synthesize(recipe.text, { rate: recipe.rate });
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, wave);
    }
    if (verifyDeterminism && index === 0) {
      const repeated = await synthesize(recipe.text, { rate: recipe.rate });
      if (sha256(repeated) !== sha256(wave)) {
        throw new Error("TTS não foi determinístico na repetição de controle");
      }
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, wave);
    const waveInfo = inspectWave(wave);
    entries.push({
      id: item.id,
      familyRootId: item.familyRootId,
      split: item.split,
      recipe,
      recipeSha256,
      waveSha256: sha256(wave),
      relativePath: `eval/generated/factory/audio/${item.id}.wav`,
      cacheHit,
      wave: waveInfo
    });
  }
  return {
    schemaVersion: 1,
    engine,
    deterministicControl: verifyDeterminism
      ? { caseId: cases[0].id, pass: true }
      : { caseId: null, pass: null },
    entries,
    summary: {
      caseCount: entries.length,
      cacheHits: entries.filter((item) => item.cacheHit).length,
      uniqueRecipeCount: new Set(
        entries.map((item) => item.recipeSha256)
      ).size,
      uniqueWaveCount: new Set(entries.map((item) => item.waveSha256)).size
    }
  };
}

