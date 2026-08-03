#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preflightOnly = process.argv.includes("--preflight-only");
const unknownArguments = process.argv.slice(2).filter((argument) =>
  argument !== "--preflight-only");
if (unknownArguments.length > 0) {
  throw new Error(`argumentos desconhecidos: ${unknownArguments.join(", ")}`);
}
const API_BASE = "https://rest.runpod.io/v1";
const EXPERIMENT_ID = "EXP-0025-R";
const CANDIDATE_ID = "E-official-duplexcascade-v0.1";
const POD_NAME_PREFIX = "duplex-exp0025-r-e-d-only-retry-";
const INFRASTRUCTURE_ATTEMPT = 5;
const MAX_GPU_SECONDS = 2 * 60 * 60;
const MAX_COST_USD = 12;
const MAX_DOWNLOAD_BYTES = 70 * 1024 ** 3;
const PRIOR_CUMULATIVE_GPU_SECONDS = 1287.297000169754;
const PRIOR_CUMULATIVE_COST_USD = 1.0334134251362748;
const PRIOR_CUMULATIVE_TRANSFER_BYTES = 37_706_974_907;
const REHYDRATION_TRANSFER_BYTES_UPPER_BOUND = 32_666_833_251;
const REMOTE_RUN_TIMEOUT_SECONDS = 5_700;
const REMAINING_GPU_SECONDS =
  MAX_GPU_SECONDS - PRIOR_CUMULATIVE_GPU_SECONDS;

const AUTHORIZATION =
  "eval/commitments/exp-0025-r-external-d-only-authorization-v0.1.json";
const RETRY_AUTHORIZATION =
  "eval/commitments/exp-0025-r-external-d-only-retry-authorization-v0.1.json";
const PRIOR_SENTINEL_REPORT =
  "eval/reports/exp-0025-r-external-development-v0.1.json";
const DEVELOPMENT_PACK =
  "eval/datasets/exp-0025-r-development-v0.1.json";
const SHARED_PYTHON = "scripts/run_exp_0025_r_external.py";
const D_ONLY_PYTHON = "scripts/run_exp_0025_r_external_d_only_v2.py";
const FROZEN_D_ONLY_PYTHON =
  "scripts/run_exp_0025_r_external_d_only.py";
const PROVIDER_RECEIPT =
  "eval/evidence/exp-0025-r-external-runpod-allocation-v0.5.json";
const REMOTE_LOG =
  "eval/evidence/exp-0025-r-external-development-d-only-runpod-v0.2.log";
const RAW_EVIDENCE =
  "eval/evidence/exp-0025-r-external-development-d-only-raw-v0.1.json";
const RAW_JOURNAL =
  "eval/evidence/exp-0025-r-external-development-d-only-raw-v0.1.journal.ndjson";

const TRANSFERRED_INPUTS = Object.freeze([
  D_ONLY_PYTHON,
  FROZEN_D_ONLY_PYTHON,
  SHARED_PYTHON,
  DEVELOPMENT_PACK,
  PRIOR_SENTINEL_REPORT,
  AUTHORIZATION,
  RETRY_AUTHORIZATION
]);

const EXPECTED_STATIC_INPUT_SHA256 = Object.freeze({
  [D_ONLY_PYTHON]:
    "534397af1280a18034bbe8a9ca6d5d6ee2e3ce5fc37f7bb477170e0dc4322f80",
  [FROZEN_D_ONLY_PYTHON]:
    "2a626c5ee20a8ca2096a8db8ba08b6ce0a14f849a3a391f30cb5f7a804593bf9",
  [SHARED_PYTHON]:
    "e6102a886af69e2bced944d804efca59b82d8825993ea445266609a93507589e",
  [DEVELOPMENT_PACK]:
    "c49b69623bcfccbc836674487bd49ce97f80616a0072e0dc7d7aee76887008b2",
  [PRIOR_SENTINEL_REPORT]:
    "653f4086772c9b3804e96768de543c5c07808439e0fd383240ab64c5cf167d54",
  [AUTHORIZATION]:
    "a4a81c30f56ac45571927cc2002712afe8c565cc9641ecc0731bd50fdaa9c1d2"
});

const PRIOR_PROVIDER_RECEIPTS = Object.freeze([
  {
    path: "eval/evidence/exp-0025-r-external-runpod-allocation-v0.1.json",
    sha256:
      "f2e9c269706fd73f0d15186e52d3421ffd945ee9650954dce816274561f78cd3",
    status: "FAILED"
  },
  {
    path: "eval/evidence/exp-0025-r-external-runpod-allocation-v0.2.json",
    sha256:
      "38111013be902507ad05ec43d7be59dce806592cb72c6341707aed0119e0f502",
    status: "FAILED"
  },
  {
    path: "eval/evidence/exp-0025-r-external-runpod-allocation-v0.3.json",
    sha256:
      "e0bb211fd00d95e0b67d3f7f77cb12c6d5f15e8e1e5b22d1c19d2559093bb343",
    status: "COMPLETED"
  },
  {
    path: "eval/evidence/exp-0025-r-external-runpod-allocation-v0.4.json",
    sha256:
      "0cd74ba2ef97d8a452bab4e504d1b91940ed8ca42f7a3dd239d5ead6ccef0442",
    status: "FAILED"
  }
]);

const OFFICIAL_COMMIT = "42893024ca90c8de8ac3ed624467ebc123512ff8";
const OFFICIAL_HASHES = Object.freeze({
  "model.py":
    "ba4fd852966b67acc909827c55cb436385f01534aa425cce7d72c623829dc077",
  "server.py":
    "404a1b6f51e87c012e1111cc21a712ed8895e9a5ee99328bd1245a7c6a654037",
  "requirements.txt":
    "a7198f886702944bc58c39add0b83906eb2cdf655e11143fb5c75d30aa99eb41"
});

const PACKAGE_PINS = Object.freeze({
  transformers: "4.46.3",
  peft: "0.13.2",
  "huggingface-hub": "0.26.2",
  safetensors: "0.4.5",
  "hf-transfer": "0.1.9"
});

const POD_REQUEST = Object.freeze({
  name: null,
  cloudType: "SECURE",
  computeType: "GPU",
  gpuTypeIds: ["NVIDIA H100 PCIe"],
  gpuTypePriority: "availability",
  gpuCount: 1,
  imageName:
    "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04",
  containerDiskInGb: 30,
  volumeInGb: 60,
  volumeMountPath: "/workspace",
  ports: ["22/tcp"],
  supportPublicIp: true,
  interruptible: false,
  locked: false,
  minRAMPerGPU: 64,
  minVCPUPerGPU: 8,
  dockerEntrypoint: [],
  dockerStartCmd: []
});

function isoNow() {
  return new Date().toISOString();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try {
    await access(resolve(PROJECT_ROOT, path));
    return true;
  } catch {
    return false;
  }
}

async function loadRunpodApiKey() {
  if (process.env.RUNPOD_API_KEY?.trim()) {
    return process.env.RUNPOD_API_KEY.trim();
  }
  const env = await readFile(resolve(PROJECT_ROOT, ".env"), "utf8");
  const line = env.split(/\r?\n/u).find((item) =>
    /^RUNPOD_API_KEY\s*=/u.test(item));
  if (!line) throw new Error("RUNPOD_API_KEY ausente em .env");
  let value = line.slice(line.indexOf("=") + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (!value) throw new Error("RUNPOD_API_KEY vazia em .env");
  return value;
}

async function runpodRequest(apiKey, path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {})
    },
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.text();
  let parsed = null;
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body.slice(0, 1_000);
    }
  }
  if (!response.ok) {
    throw new Error(
      `RunPod ${options.method ?? "GET"} ${path}: HTTP ${response.status} ` +
      `${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`
    );
  }
  return parsed;
}

function waitForChild(child, label, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : null;
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        rejectPromise(new Error(`${label} excedeu o timeout local`));
      } else if (code === 0 || options.allowNonzero === true) {
        resolvePromise({ code, signal });
      } else {
        rejectPromise(
          new Error(`${label} falhou: code=${code} signal=${signal ?? "none"}`)
        );
      }
    });
  });
}

async function runLocal(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    stdio: options.stdio ?? "inherit"
  });
  return waitForChild(child, options.label ?? command, options);
}

function sshArgs(connection, temporary, quiet = false) {
  return [
    "-i", temporary.privateKey,
    "-p", String(connection.port),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${temporary.knownHosts}`,
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=4",
    ...(quiet ? ["-q"] : []),
    `root@${connection.ip}`
  ];
}

function scpArgs(connection, temporary) {
  return [
    "-i", temporary.privateKey,
    "-P", String(connection.port),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${temporary.knownHosts}`,
    "-q"
  ];
}

async function sshStatus(connection, temporary, remoteCommand) {
  const child = spawn(
    "ssh",
    [...sshArgs(connection, temporary, true), remoteCommand],
    { stdio: "ignore" }
  );
  return waitForChild(child, "ssh probe", { allowNonzero: true });
}

async function makeTemporaryAccess() {
  const directory = await mkdtemp(join(tmpdir(), "duplex-exp0025-d-only-"));
  const privateKey = join(directory, "id_ed25519");
  const knownHosts = join(directory, "known_hosts");
  await runLocal(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-C", EXPERIMENT_ID,
      "-f", privateKey],
    { label: "geração da chave SSH efêmera", stdio: "ignore" }
  );
  const publicKey = (await readFile(`${privateKey}.pub`, "utf8")).trim();
  return { directory, privateKey, knownHosts, publicKey };
}

async function terminatePod(apiKey, podId) {
  try {
    await runpodRequest(apiKey, `/pods/${encodeURIComponent(podId)}`, {
      method: "DELETE"
    });
  } catch (error) {
    if (!String(error.message).includes("HTTP 404")) throw error;
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await runpodRequest(apiKey, `/pods/${encodeURIComponent(podId)}`);
    } catch (error) {
      if (String(error.message).includes("HTTP 404")) return true;
      throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  return false;
}

async function waitForConnection(apiKey, podId, temporary, allocationStart) {
  let lastStatus = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const elapsed = Date.now() / 1_000 - allocationStart;
    if (elapsed >= REMAINING_GPU_SECONDS - 300) {
      throw new Error("Pod não ficou acessível dentro do budget temporal");
    }
    const pod = await runpodRequest(apiKey, `/pods/${encodeURIComponent(podId)}`);
    const rate = Number(pod?.adjustedCostPerHr ?? pod?.costPerHr);
    if (Number.isFinite(rate) && rate > 6) {
      throw new Error(`taxa do Pod US$ ${rate}/h excede o teto congelado`);
    }
    const status = pod?.desiredStatus ?? pod?.lastStatusChange ?? "UNKNOWN";
    if (status !== lastStatus) {
      process.stdout.write(`[runpod-d-only] estado: ${status}\n`);
      lastStatus = status;
    }
    const ip = pod?.publicIp;
    const port = Number(pod?.portMappings?.["22"]);
    if (ip && Number.isInteger(port) && port > 0) {
      const connection = { ip, port };
      const probe = await sshStatus(connection, temporary, "true");
      if (probe.code === 0) return { connection, pod, rate };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  throw new Error("SSH do Pod não ficou disponível");
}

async function uploadInputs(connection, temporary) {
  const tar = spawn("tar", ["-cf", "-", ...TRANSFERRED_INPUTS], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "inherit"]
  });
  const ssh = spawn(
    "ssh",
    [
      ...sshArgs(connection, temporary),
      "mkdir -p /workspace/duplex-lab-ptbr && " +
        "tar --no-same-owner -xf - -C /workspace/duplex-lab-ptbr"
    ],
    { stdio: ["pipe", "inherit", "inherit"] }
  );
  tar.stdout.pipe(ssh.stdin);
  await Promise.all([
    waitForChild(tar, "empacotamento dos inputs D-only"),
    waitForChild(ssh, "transferência dos inputs D-only")
  ]);
}

function remoteScript({
  allocationStart,
  hourlyUsd,
  transferredInputSha256
}) {
  const inputChecks = Object.entries(transferredInputSha256)
    .map(([path, digest]) =>
      `test "$(sha256sum ${path} | cut -d' ' -f1)" = "${digest}"`)
    .join("\n");
  const officialChecks = Object.entries(OFFICIAL_HASHES)
    .map(([path, digest]) =>
      `test "$(sha256sum /workspace/DuplexCascade/${path} | cut -d' ' -f1)" = "${digest}"`)
    .join("\n");
  const packages = Object.entries(PACKAGE_PINS)
    .map(([name, version]) => `"${name}==${version}"`)
    .join(" ");
  return `set -Eeuo pipefail
export PYTHONUNBUFFERED=1
export HF_HOME=/workspace/hf-cache
export HF_HUB_ENABLE_HF_TRANSFER=1
export CUDA_VISIBLE_DEVICES=0
cd /workspace/duplex-lab-ptbr
echo '[remote-d-only] verificando hardware e inputs'
test "$(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l)" -eq 1
case "$(nvidia-smi --query-gpu=name --format=csv,noheader)" in *H100*) ;; *) exit 31 ;; esac
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
${inputChecks}
echo '[remote-d-only] fixando código oficial e dependências'
git clone --filter=blob:none https://github.com/sbintuitions/DuplexCascade.git /workspace/DuplexCascade
git -C /workspace/DuplexCascade checkout --detach ${OFFICIAL_COMMIT}
test "$(git -C /workspace/DuplexCascade rev-parse HEAD)" = "${OFFICIAL_COMMIT}"
${officialChecks}
python -m pip install --no-cache-dir --upgrade ${packages}
python -c 'import torch; assert torch.cuda.is_available(); print("[remote-d-only] torch", torch.__version__, "cuda", torch.version.cuda)'
echo '[remote-d-only] iniciando somente 32 falas de D; sentinelas não serão geradas'
mkdir -p eval/evidence
timeout --signal=TERM --kill-after=30s ${REMOTE_RUN_TIMEOUT_SECONDS}s \
  python ${D_ONLY_PYTHON} \
    --output ${RAW_EVIDENCE} \
    --cache-dir /workspace/hf-cache \
    --official-code-dir /workspace/DuplexCascade \
    --authorization ${AUTHORIZATION} \
    --prior-sentinel-report ${PRIOR_SENTINEL_REPORT} \
    --pack ${DEVELOPMENT_PACK} \
    --provider runpod-secure \
    --hourly-usd ${hourlyUsd.toFixed(6)} \
    --allocation-start-epoch ${allocationStart.toFixed(3)} \
  2>&1 | tee ${REMOTE_LOG}
`;
}

async function runRemote(connection, temporary, script, timeoutMs) {
  const child = spawn(
    "ssh",
    [...sshArgs(connection, temporary), "bash -s"],
    { stdio: ["pipe", "inherit", "inherit"] }
  );
  child.stdin.end(script);
  return waitForChild(child, "execução remota E D-only", { timeoutMs });
}

async function retrieveIfPresent(connection, temporary, relativePath) {
  const remotePath = `/workspace/duplex-lab-ptbr/${relativePath}`;
  const status = await sshStatus(
    connection,
    temporary,
    `test -f ${remotePath}`
  );
  if (status.code !== 0) return false;
  const localPath = resolve(PROJECT_ROOT, relativePath);
  await mkdir(dirname(localPath), { recursive: true });
  await runLocal(
    "scp",
    [
      ...scpArgs(connection, temporary),
      `root@${connection.ip}:${remotePath}`,
      localPath
    ],
    { label: `coleta de ${relativePath}` }
  );
  return true;
}

async function writeReceipt(receipt) {
  const destination = resolve(PROJECT_ROOT, PROVIDER_RECEIPT);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx"
  });
}

async function assertLocalInputs(apiKey) {
  const actualInputSha256 = {};
  for (const path of TRANSFERRED_INPUTS) {
    const bytes = await readFile(resolve(PROJECT_ROOT, path));
    actualInputSha256[path] = sha256(bytes);
    const expected = EXPECTED_STATIC_INPUT_SHA256[path];
    if (expected && actualInputSha256[path] !== expected) {
      throw new Error(`hash local divergente antes da alocação: ${path}`);
    }
  }
  for (const prior of PRIOR_PROVIDER_RECEIPTS) {
    const bytes = await readFile(resolve(PROJECT_ROOT, prior.path));
    if (sha256(bytes) !== prior.sha256) {
      throw new Error(`recibo anterior divergiu: ${prior.path}`);
    }
    const receipt = JSON.parse(bytes.toString("utf8"));
    if (receipt.status !== prior.status ||
      receipt.termination?.confirmed !== true) {
      throw new Error(`recibo anterior não está encerrado: ${prior.path}`);
    }
  }
  if (PRIOR_CUMULATIVE_TRANSFER_BYTES +
    REHYDRATION_TRANSFER_BYTES_UPPER_BOUND > MAX_DOWNLOAD_BYTES) {
    throw new Error("rehydration excederia o teto cumulativo de 70 GiB");
  }
  for (const path of [PROVIDER_RECEIPT, REMOTE_LOG, RAW_EVIDENCE, RAW_JOURNAL]) {
    if (await exists(path)) throw new Error(`output já existe: ${path}`);
  }
  const pods = await runpodRequest(apiKey, "/pods");
  if (!Array.isArray(pods)) throw new Error("listagem de Pods inválida");
  const conflicting = pods.filter((pod) =>
    String(pod?.name ?? "").startsWith("duplex-exp0025-r-"));
  if (conflicting.length > 0) {
    throw new Error("já existe Pod EXP-0025-R ativo; alocação recusada");
  }
  return actualInputSha256;
}

async function main() {
  const apiKey = await loadRunpodApiKey();
  await runLocal(
    "node",
    ["scripts/check-exp-0025-r-external-d-only-retry-authorization.mjs",
      "--preflight"],
    { label: "preflight D-only prospectivo" }
  );
  const transferredInputSha256 = await assertLocalInputs(apiKey);
  if (preflightOnly) {
    process.stdout.write(
      "[runpod-d-only-retry] preflight local/provider passou; nenhum Pod criado\n"
    );
    return;
  }
  const temporary = await makeTemporaryAccess();
  const podName = `${POD_NAME_PREFIX}${Date.now()}`;
  const requestedAt = isoNow();
  const allocationStart = Date.now() / 1_000;
  let podId = null;
  let connection = null;
  let observedPod = null;
  let hourlyUsd = null;
  let remoteResult = null;
  let primaryError = null;
  const retrieved = {};
  const termination = {
    requestedAt: null,
    confirmedAt: null,
    confirmed: false,
    error: null
  };

  try {
    process.stdout.write(
      "[runpod-d-only-retry] criando a quinta e última alocação H100...\n"
    );
    const created = await runpodRequest(apiKey, "/pods", {
      method: "POST",
      body: JSON.stringify({
        ...POD_REQUEST,
        name: podName,
        env: {
          PUBLIC_KEY: temporary.publicKey,
          SSH_PUBLIC_KEY: temporary.publicKey
        }
      })
    });
    podId = created?.id;
    if (!podId) throw new Error("RunPod criou resposta sem pod id");
    const ready = await waitForConnection(
      apiKey, podId, temporary, allocationStart
    );
    connection = ready.connection;
    observedPod = ready.pod;
    hourlyUsd = ready.rate;
    if (!Number.isFinite(hourlyUsd) || hourlyUsd < 0 || hourlyUsd > 6) {
      throw new Error("RunPod não informou taxa horária autorizada");
    }
    process.stdout.write(
      `[runpod-d-only] pronto; taxa US$ ${hourlyUsd.toFixed(4)}/h\n`
    );
    await uploadInputs(connection, temporary);
    const elapsedMs = (Date.now() / 1_000 - allocationStart) * 1_000;
    const remainingMs = REMAINING_GPU_SECONDS * 1_000 - elapsedMs - 120_000;
    if (remainingMs <= 0) throw new Error("budget temporal consumido antes de D");
    remoteResult = await runRemote(
      connection,
      temporary,
      remoteScript({
        allocationStart,
        hourlyUsd,
        transferredInputSha256
      }),
      Math.min(remainingMs, (REMOTE_RUN_TIMEOUT_SECONDS + 60) * 1_000)
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (!podId) {
      try {
        const pods = await runpodRequest(apiKey, "/pods");
        const matches = Array.isArray(pods)
          ? pods.filter((pod) => pod?.name === podName)
          : [];
        if (matches.length === 1) podId = matches[0].id;
        if (matches.length > 1) {
          primaryError ??= new Error("mais de um Pod recebeu o nome efêmero");
        }
      } catch (error) {
        primaryError ??= error;
      }
    }
    if (connection) {
      for (const path of [RAW_EVIDENCE, RAW_JOURNAL, REMOTE_LOG]) {
        try {
          retrieved[path] = await retrieveIfPresent(
            connection, temporary, path
          );
        } catch (error) {
          retrieved[path] = false;
          primaryError ??= error;
        }
      }
    }
    if (podId) {
      termination.requestedAt = isoNow();
      try {
        termination.confirmed = await terminatePod(apiKey, podId);
        termination.confirmedAt = termination.confirmed ? isoNow() : null;
        if (!termination.confirmed) {
          throw new Error("RunPod não confirmou a remoção do Pod");
        }
      } catch (error) {
        termination.error = error.message;
        primaryError ??= error;
      }
    }

    const completedAt = isoNow();
    const allocationSeconds = podId
      ? Date.now() / 1_000 - allocationStart
      : 0;
    const estimatedGpuCostUsd = Number.isFinite(hourlyUsd)
      ? hourlyUsd * allocationSeconds / 3_600
      : null;
    const cumulativeAllocationSeconds =
      PRIOR_CUMULATIVE_GPU_SECONDS + allocationSeconds;
    const cumulativeEstimatedGpuCostUsd = Number.isFinite(estimatedGpuCostUsd)
      ? PRIOR_CUMULATIVE_COST_USD + estimatedGpuCostUsd
      : null;
    const projectedCumulativeTransferBytes =
      PRIOR_CUMULATIVE_TRANSFER_BYTES +
      REHYDRATION_TRANSFER_BYTES_UPPER_BOUND;
    const receipt = {
      schemaVersion: "exp-0025-r-runpod-d-only-allocation-receipt-v1",
      experimentId: EXPERIMENT_ID,
      candidateId: CANDIDATE_ID,
      infrastructureAttempt: INFRASTRUCTURE_ATTEMPT,
      modelInferenceAttempt: 2,
      developmentInferencePass: 1,
      requestedAt,
      completedAt,
      status: primaryError ? "FAILED" : "COMPLETED",
      provider: {
        id: "runpod",
        podId,
        podName,
        requested: {
          ...POD_REQUEST,
          name: podName,
          env: {
            PUBLIC_KEY: "EPHEMERAL_REDACTED",
            SSH_PUBLIC_KEY: "EPHEMERAL_REDACTED"
          }
        },
        observed: observedPod
          ? {
              image: observedPod.image ?? null,
              gpu: observedPod.gpu ?? null,
              memoryInGb: observedPod.memoryInGb ?? null,
              vcpuCount: observedPod.vcpuCount ?? null,
              costPerHr: observedPod.costPerHr ?? null,
              adjustedCostPerHr: observedPod.adjustedCostPerHr ?? null
            }
          : null
      },
      dataBoundary: {
        transferredInputs: TRANSFERRED_INPUTS,
        transferredInputSha256,
        holdoutTransferred: false,
        environmentFileTransferred: false,
        accountApiKeyTransferred: false,
        openAiApiKeyTransferred: false
      },
      runtime: {
        packagePins: PACKAGE_PINS,
        remoteTimeoutSeconds: REMOTE_RUN_TIMEOUT_SECONDS,
        remoteExitCode: remoteResult?.code ?? null,
        sentinelGenerationCount: 0,
        retrieved
      },
      budget: {
        allocationSeconds,
        priorCumulativeAllocationSeconds: PRIOR_CUMULATIVE_GPU_SECONDS,
        cumulativeAllocationSeconds,
        maximumGpuSeconds: MAX_GPU_SECONDS,
        hourlyUsd,
        estimatedGpuCostUsd,
        priorCumulativeEstimatedGpuCostUsd: PRIOR_CUMULATIVE_COST_USD,
        cumulativeEstimatedGpuCostUsd,
        maximumExternalCostUsd: MAX_COST_USD,
        priorCumulativeTransferBytesUpperBound:
          PRIOR_CUMULATIVE_TRANSFER_BYTES,
        rehydrationTransferBytesUpperBound:
          REHYDRATION_TRANSFER_BYTES_UPPER_BOUND,
        projectedCumulativeTransferBytes,
        maximumCumulativeDownloadBytes: MAX_DOWNLOAD_BYTES,
        withinFrozenLimits:
          cumulativeAllocationSeconds <= MAX_GPU_SECONDS &&
          Number.isFinite(cumulativeEstimatedGpuCostUsd) &&
          cumulativeEstimatedGpuCostUsd <= MAX_COST_USD &&
          projectedCumulativeTransferBytes <= MAX_DOWNLOAD_BYTES
      },
      termination,
      automaticRetryAuthorized: false,
      error: primaryError?.message ?? null
    };
    try {
      await writeReceipt(receipt);
    } catch (error) {
      primaryError ??= error;
    }
    await rm(temporary.directory, { recursive: true, force: true });
  }

  if (primaryError) throw primaryError;
  if (!retrieved[RAW_EVIDENCE] || !retrieved[RAW_JOURNAL]) {
    throw new Error("D-only terminou sem evidência bruta completa");
  }
  process.stdout.write(
    `[runpod-d-only] D coletado e Pod removido: ${RAW_EVIDENCE}\n`
  );
}

await main();
