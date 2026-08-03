import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateExp0025RMaterializedPack } from
  "../src/eval/exp-0025-r-floor-control.mjs";
import { canonicalJson } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  EXP0025_R_HOLDOUT_PACK_PATH,
  assertExp0025RHoldoutBoundary,
  buildExp0025RHoldoutPack
} from "./build-exp-0025-r-holdout-pack.mjs";
import { materializeExp0025RPackAudio } from
  "./materialize-exp-0025-r-audio.mjs";

export const EXP0025_R_HOLDOUT_AUDIO_ROOT =
  "eval/generated/exp-0025-r/holdout-audio-v0.1";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}

export async function materializeExp0025RHoldoutAudio(options = {}) {
  const pack = await materializeExp0025RPackAudio(
    buildExp0025RHoldoutPack(),
    { ...options, audioRoot: EXP0025_R_HOLDOUT_AUDIO_ROOT }
  );
  await assertExp0025RHoldoutBoundary(pack);
  const validation = validateExp0025RMaterializedPack(pack);
  if (!validation.valid) {
    throw new Error(`H materializado inválido: ${validation.errors.join("; ")}`);
  }
  await writeAtomic(
    resolve(options.path ?? EXP0025_R_HOLDOUT_PACK_PATH),
    `${canonicalJson(pack)}\n`
  );
  return pack;
}

export async function checkExp0025RHoldoutAudio(options = {}) {
  const path = resolve(options.path ?? EXP0025_R_HOLDOUT_PACK_PATH);
  const bytes = await readFile(path);
  const pack = JSON.parse(bytes.toString("utf8"));
  await assertExp0025RHoldoutBoundary(pack);
  const validation = validateExp0025RMaterializedPack(pack);
  if (!validation.valid) {
    throw new Error(`H materializado inválido: ${validation.errors.join("; ")}`);
  }
  for (const utterance of pack.utterances) {
    const wav = await readFile(resolve(utterance.audioProvenance.wavPath));
    if (`sha256:${sha256(wav)}` !== utterance.audioProvenance.wavSha256 ||
      wav.byteLength !== utterance.audioProvenance.byteLength) {
      throw new Error(`WAV H divergiu para ${utterance.id}`);
    }
  }
  return pack;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--check")) {
    throw new Error(
      "uso: node scripts/materialize-exp-0025-r-holdout-audio.mjs [--check]"
    );
  }
  const pack = args.has("--check")
    ? await checkExp0025RHoldoutAudio()
    : await materializeExp0025RHoldoutAudio();
  process.stdout.write(
    `EXP-0025-R H áudio ${args.has("--check") ? "verificado" : "materializado"}: ` +
      `${pack.utterances.length} WAVs, ${pack.packSha256}; sem inferência\n`
  );
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
