import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

import {
  createTimingCalibrationServer
} from "../src/eval/calibration/server.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const PACK_PATH = resolve(
  PROJECT_ROOT,
  "eval/calibration/exp-0015-timing-pack-v0.1.json"
);
const WEB_ROOT = resolve(PROJECT_ROOT, "web/calibration");
const ANNOTATIONS_ROOT = resolve(
  PROJECT_ROOT,
  "eval/generated/exp-0015/annotations"
);
const port = Number.parseInt(
  process.env.CALIBRATION_PORT ?? "4174",
  10
);
const host = process.env.CALIBRATION_HOST ?? "0.0.0.0";

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new RangeError("CALIBRATION_PORT precisa estar entre 1 e 65535");
}

function findPrivateIpv4() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return null;
}

const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
const calibration = await createTimingCalibrationServer({
  pack,
  projectRoot: PROJECT_ROOT,
  webRoot: WEB_ROOT,
  annotationsRoot: ANNOTATIONS_ROOT
});
await calibration.listen({ port, host });

const wslIp = findPrivateIpv4();
console.log(`Calibração EXP-0015 disponível em http://localhost:${port}`);
if (wslIp) {
  console.log(`Acesso direto pelo Windows: http://${wslIp}:${port}`);
}
console.log(
  `${pack.scenes.length} cenas · ${calibration.snapshot.artifacts} WAVs · ` +
    `${calibration.snapshot.participants} participantes já registrados`
);
console.log(`Pack: ${pack.packSha256}`);
console.log("Execução local; nenhuma API paga é chamada.");

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Encerrando calibração (${signal})...`);
  await calibration.close().catch(() => {});
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
