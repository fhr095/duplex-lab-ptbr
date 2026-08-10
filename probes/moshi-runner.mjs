// B1 — runner RunPod para Moshi (qualificação em CPU antes de GPU).
//
//   node probes/moshi-runner.mjs qual   → pod CPU barato valida o ciclo
//   node probes/moshi-runner.mjs gpu    → A40: moshi.run_inference offline
//
// Ciclo: criar pod → aguardar proxy → PUT estímulo + GO → poll DONE →
// GET saídas → terminar pod → listar pods (recibo de zero ativos).
// Kill switch: término SEMPRE no finally + teto de tempo.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { loadEnvFile } from "../src/config/load-env.mjs";

await loadEnvFile();
const KEY = process.env.RUNPOD_API_KEY;
if (!KEY) {
  throw new Error("RUNPOD_API_KEY ausente");
}
const MODE = process.argv[2] ?? "qual";
const MODELS = "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/" +
  "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models";
const OUT = resolve(import.meta.dirname, "../notes/evidencia/moshi");
await mkdir(OUT, { recursive: true });
const MAX_MINUTES = MODE === "gpu" ? 75 : 20;

const SCRIPT = `#!/bin/bash
set -x
mkdir -p /workspace/in /workspace/out
python3 - <<'PY' &
from http.server import BaseHTTPRequestHandler, HTTPServer
import pathlib
class H(BaseHTTPRequestHandler):
    def do_PUT(self):
        n = int(self.headers['Content-Length'])
        p = pathlib.Path('/workspace/in') / self.path.split('/')[-1]
        p.write_bytes(self.rfile.read(n))
        self.send_response(200); self.end_headers()
    def do_POST(self):
        self.do_PUT()
    def do_GET(self):
        if self.path == '/saude':
            self.send_response(200)
            self.send_header('Content-Length', '2')
            self.end_headers(); self.wfile.write(b'ok'); return
        p = pathlib.Path('/workspace/out') / self.path.split('/')[-1]
        if p.exists():
            b = p.read_bytes()
            self.send_response(200)
            self.send_header('Content-Length', str(len(b)))
            self.end_headers(); self.wfile.write(b)
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a):
        pass
HTTPServer(('0.0.0.0', 8000), H).serve_forever()
PY
while [ ! -f /workspace/in/GO ]; do sleep 2; done
( RUN_PLACEHOLDER ) > /workspace/out/run.log 2>&1
touch /workspace/out/DONE
sleep infinity
`;

const RUN_QUAL = "cp /workspace/in/convo.wav /workspace/out/reply.wav";
const RUN_GPU = [
  "pip install -q moshi sphn soundfile",
  ...["en", "bargein", "backchannel"].map((name) =>
    "python -m moshi.run_inference --hf-repo " +
    "kyutai/moshiko-pytorch-bf16 --batch-size 1 " +
    `/workspace/in/moshi-${name}.wav /workspace/out/reply-${name}.wav`
  ),
  "ls -la /workspace/out >> /workspace/out/run.log"
].join(" && ");

const script = SCRIPT.replace(
  "RUN_PLACEHOLDER", MODE === "gpu" ? RUN_GPU : RUN_QUAL
);
const scriptB64 = Buffer.from(script).toString("base64");

async function api(method, path, body) {
  const response = await fetch(`https://rest.runpod.io/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${
      text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

const podSpec = {
  name: `caminho-ouro-b1-${MODE}-${Date.now()}`,
  imageName: "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04",
  containerDiskInGb: MODE === "gpu" ? 60 : 15,
  volumeInGb: 0,
  ports: ["8000/http"],
  env: {},
  dockerStartCmd: [
    "bash", "-c",
    `echo ${scriptB64} | base64 -d > /r.sh && bash /r.sh`
  ],
  ...(MODE === "gpu"
    ? {
        cloudType: "SECURE",
        gpuTypeIds: ["NVIDIA A40"],
        gpuCount: 1
      }
    : {
        cloudType: "SECURE",
        computeType: "CPU",
        vcpuCount: 2,
        cpuFlavorIds: ["cpu3c"]
      })
};

const startedAt = Date.now();
let pod = null;
try {
  console.log(`criando pod (${MODE})…`);
  pod = await api("POST", "/pods", podSpec);
  console.log("pod:", pod.id, pod.machineId ?? "");
  const proxy = `https://${pod.id}-8000.proxy.runpod.net`;

  // aguarda proxy responder (recebedor de upload no ar)
  let up = false;
  while (Date.now() - startedAt < MAX_MINUTES * 60_000) {
    try {
      const probe = await fetch(`${proxy}/saude`, {
        signal: AbortSignal.timeout(5_000)
      });
      if (probe.ok && (await probe.text()) === "ok") {
        up = true;
        break;
      }
    } catch { /* subindo */ }
    await delay(5_000);
  }
  if (!up) {
    throw new Error("proxy do pod não respondeu no prazo");
  }
  console.log("proxy no ar; enviando estímulo…");
  const STIM = resolve(import.meta.dirname, "data/stimuli");
  const uploads = MODE === "gpu"
    ? ["moshi-en.wav", "moshi-bargein.wav", "moshi-backchannel.wav"]
    : ["convo.wav"];
  const postWithRetry = async (path, body) => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        const response = await fetch(`${proxy}${path}`, {
          method: "POST",
          body,
          signal: AbortSignal.timeout(30_000)
        });
        if (response.ok) {
          return true;
        }
        console.log(`${path} tentativa ${attempt}: HTTP ${
          response.status}`);
      } catch (error) {
        console.log(`${path} tentativa ${attempt}: ${error.message}`);
      }
      await delay(5_000);
    }
    return false;
  };
  for (const name of uploads) {
    const body = await readFile(
      MODE === "gpu"
        ? resolve(STIM, name)
        : `${MODELS}/moshi-convo.wav`
    );
    if (!await postWithRetry(`/${name}`, body)) {
      throw new Error(`upload de ${name} falhou pelo proxy`);
    }
  }
  if (!await postWithRetry("/GO", "go")) {
    throw new Error("GO falhou pelo proxy");
  }
  console.log("estímulos enviados e GO confirmado");

  console.log("aguardando DONE…");
  let done = false;
  while (Date.now() - startedAt < MAX_MINUTES * 60_000) {
    try {
      const probe = await fetch(`${proxy}/DONE`, {
        signal: AbortSignal.timeout(5_000)
      });
      if (probe.ok) {
        done = true;
        break;
      }
    } catch { /* segue */ }
    await delay(10_000);
  }
  const downloads = MODE === "gpu"
    ? ["run.log", "reply-en.wav", "reply-bargein.wav",
       "reply-backchannel.wav"]
    : ["run.log", "reply.wav"];
  for (const name of downloads) {
    try {
      const response = await fetch(`${proxy}/${name}`, {
        signal: AbortSignal.timeout(120_000)
      });
      if (response.ok) {
        const body = Buffer.from(await response.arrayBuffer());
        await writeFile(resolve(OUT, `${MODE}-${name}`), body);
        console.log(`baixado ${name} (${body.length}B)`);
      } else {
        console.log(`sem ${name}: HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`sem ${name}: ${error.message}`);
    }
  }
  if (!done) {
    console.log("AVISO: DONE não observado no prazo");
  }
} finally {
  if (pod?.id) {
    console.log("terminando pod…");
    await api("DELETE", `/pods/${pod.id}`).catch((error) =>
      console.log("falha ao terminar:", error.message)
    );
  }
  const pods = await api("GET", "/pods").catch(() => null);
  console.log(
    "recibo pods ativos:",
    JSON.stringify(pods?.map?.((p) => p.id) ?? pods)
  );
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`duração total: ${minutes}min`);
}
