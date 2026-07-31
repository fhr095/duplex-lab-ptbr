import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  SILERO_VAD_MODEL_SHA256,
  SILERO_VAD_MODEL_URL
} from "../src/audio/silero-vad-shadow.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const modelPath = resolve(
  PROJECT_ROOT,
  process.env.SILERO_VAD_MODEL_PATH ??
    "eval/generated/vad/models/silero_vad_v6.2.onnx"
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function validCachedModel() {
  try {
    return sha256(await readFile(modelPath)) ===
      SILERO_VAD_MODEL_SHA256;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

if (await validCachedModel()) {
  console.log(JSON.stringify({
    state: "cached",
    path: modelPath,
    sha256: SILERO_VAD_MODEL_SHA256
  }));
} else {
  const response = await fetch(SILERO_VAD_MODEL_URL, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) {
    throw new Error(
      `download do Silero VAD retornou HTTP ${response.status}`
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== SILERO_VAD_MODEL_SHA256) {
    throw new Error(
      `hash inesperado do Silero VAD: ${actualSha256}`
    );
  }

  await mkdir(dirname(modelPath), { recursive: true });
  const temporaryPath =
    `${modelPath}.download-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    await rename(temporaryPath, modelPath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  }
  console.log(JSON.stringify({
    state: "downloaded",
    path: modelPath,
    bytes: bytes.length,
    sha256: actualSha256,
    source: SILERO_VAD_MODEL_URL
  }));
}
