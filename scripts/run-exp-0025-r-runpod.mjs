#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_BASE = "https://rest.runpod.io/v1";
const EXPERIMENT_ID = "EXP-0025-R";
const CANDIDATE_ID = "E-official-duplexcascade-v0.1";
const POD_NAME_PREFIX = "duplex-exp0025-r-e-";
const MAX_GPU_SECONDS = 2 * 60 * 60;
const MAX_COST_USD = 12;
const REMOTE_RUN_TIMEOUT_SECONDS = 6_000;
const MAX_DOWNLOAD_BYTES = 40 * 1024 ** 3;
const FROZEN_ARTIFACT_BYTES = 32_662_348_987;
const PRIOR_TRANSFER_BYTES_UPPER_BOUND = 3_400_000_000;
const INFRASTRUCTURE_ATTEMPT = 3;
const PRIOR_ALLOCATION_SECONDS = 907.2149999141693;
const PRIOR_COST_USD = 0.7282920415977637;
const REMAINING_GPU_SECONDS = MAX_GPU_SECONDS - PRIOR_ALLOCATION_SECONDS;
const PRIOR_PROVIDER_RECEIPTS = Object.freeze([
  {
    path: "eval/evidence/exp-0025-r-external-runpod-allocation-v0.1.json",
    sha256:
      "f2e9c269706fd73f0d15186e52d3421ffd945ee9650954dce816274561f78cd3"
  },
  {
    path: "eval/evidence/exp-0025-r-external-runpod-allocation-v0.2.json",
    sha256:
      "38111013be902507ad05ec43d7be59dce806592cb72c6341707aed0119e0f502"
  }
]);
const PROVIDER_RECEIPT =
  "eval/evidence/exp-0025-r-external-runpod-allocation-v0.3.json";
const REMOTE_LOG =
  "eval/evidence/exp-0025-r-external-development-runpod-v0.1.log";
const RAW_EVIDENCE =
  "eval/evidence/exp-0025-r-external-development-raw-v0.1.json";
const RAW_JOURNAL =
  "eval/evidence/exp-0025-r-external-development-raw-v0.1.journal.ndjson";

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

const PACKAGE_PINS = Object.freeze({
  transformers: "4.46.3",
  peft: "0.13.2",
  "huggingface-hub": "0.26.2",
  safetensors: "0.4.5",
  "hf-transfer": "0.1.9"
});

const TRANSFERRED_INPUTS = Object.freeze([
  "scripts/run_exp_0025_r_external.py",
  "eval/datasets/exp-0025-r-development-v0.1.json",
  "eval/scenarios/exp-0025-r-external-sentinels-v0.1.json"
]);

const EXPECTED_INPUT_SHA256 = Object.freeze({
  "scripts/run_exp_0025_r_external.py":
    "e6102a886af69e2bced944d804efca59b82d8825993ea445266609a93507589e",
  "eval/datasets/exp-0025-r-development-v0.1.json":
    "c49b69623bcfccbc836674487bd49ce97f80616a0072e0dc7d7aee76887008b2",
  "eval/scenarios/exp-0025-r-external-sentinels-v0.1.json":
    "4a1ff37504bb1eb1f19a2cc3cfea7374ac14aff11eb0b49e92929c1adba55110"
});

const OFFICIAL_COMMIT = "42893024ca90c8de8ac3ed624467ebc123512ff8";
const OFFICIAL_HASHES = Object.freeze({
  "model.py":
    "ba4fd852966b67acc909827c55cb436385f01534aa425cce7d72c623829dc077",
  "server.py":
    "404a1b6f51e87c012e1111cc21a712ed8895e9a5ee99328bd1245a7c6a654037",
  "requirements.txt":
    "a7198f886702944bc58c39add0b83906eb2cdf655e11143fb5c75d30aa99eb41"
});

function isoNow() {
  return new Date().toISOString();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try {
    await access(path);
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
  const directory = await mkdtemp(join(tmpdir(), "duplex-exp0025-runpod-"));
  const privateKey = join(directory, "id_ed25519");
  const knownHosts = join(directory, "known_hosts");
  await runLocal(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-C", EXPERIMENT_ID, "-f", privateKey],
    { label: "geração da chave SSH efêmera", stdio: "ignore" }
  );
  const publicKey = (await readFile(`${privateKey}.pub`, "utf8")).trim();
  return { directory, privateKey, knownHosts, publicKey };
}

async function findPodsByName(apiKey, name) {
  const pods = await runpodRequest(apiKey, "/pods");
  if (!Array.isArray(pods)) throw new Error("resposta inesperada ao listar Pods");
  return pods.filter((pod) => pod?.name === name);
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

async function waitForConnection(apiKey, podId, temporary, allocationStartEpoch) {
  let lastStatus = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const elapsed = Date.now() / 1_000 - allocationStartEpoch;
    if (elapsed >= REMAINING_GPU_SECONDS - 300) {
      throw new Error("Pod não ficou acessível dentro do budget temporal");
    }
    const pod = await runpodRequest(
      apiKey,
      `/pods/${encodeURIComponent(podId)}`
    );
    const rate = Number(pod?.adjustedCostPerHr ?? pod?.costPerHr);
    if (Number.isFinite(rate) &&
      PRIOR_COST_USD + rate * REMAINING_GPU_SECONDS / 3_600 > MAX_COST_USD) {
      throw new Error(`taxa do Pod US$ ${rate}/h excede o budget congelado`);
    }
    const status = pod?.desiredStatus ?? pod?.lastStatusChange ?? "UNKNOWN";
    if (status !== lastStatus) {
      process.stdout.write(`[runpod] estado: ${status}\n`);
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
    waitForChild(tar, "empacotamento dos inputs"),
    waitForChild(ssh, "transferência dos inputs")
  ]);
}

function remoteScript({ allocationStartEpoch, hourlyUsd }) {
  const inputChecks = Object.entries(EXPECTED_INPUT_SHA256)
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
echo '[remote] verificando hardware e inputs'
test "$(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l)" -eq 1
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
case "$(nvidia-smi --query-gpu=name --format=csv,noheader)" in *H100*) ;; *) exit 31 ;; esac
${inputChecks}
echo '[remote] fixando código oficial e dependências'
git clone --filter=blob:none https://github.com/sbintuitions/DuplexCascade.git /workspace/DuplexCascade
git -C /workspace/DuplexCascade checkout --detach ${OFFICIAL_COMMIT}
test "$(git -C /workspace/DuplexCascade rev-parse HEAD)" = "${OFFICIAL_COMMIT}"
${officialChecks}
python -m pip install --no-cache-dir --upgrade ${packages}
python -c 'import torch; assert torch.cuda.is_available(); print("[remote] torch", torch.__version__, "cuda", torch.version.cuda)'
echo '[remote] iniciando quatro sentinelas; D só roda se todas passarem'
mkdir -p eval/evidence
timeout --signal=TERM --kill-after=30s ${REMOTE_RUN_TIMEOUT_SECONDS}s \
  python scripts/run_exp_0025_r_external.py \
    --output ${RAW_EVIDENCE} \
    --cache-dir /workspace/hf-cache \
    --official-code-dir /workspace/DuplexCascade \
    --provider runpod-secure \
    --hourly-usd ${hourlyUsd.toFixed(6)} \
    --allocation-start-epoch ${allocationStartEpoch.toFixed(3)} \
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
  return waitForChild(child, "execução remota E", { timeoutMs });
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
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx"
  });
  await rename(temporary, destination);
}

async function assertLocalInputs() {
  for (const [path, expected] of Object.entries(EXPECTED_INPUT_SHA256)) {
    const bytes = await readFile(resolve(PROJECT_ROOT, path));
    if (sha256(bytes) !== expected) {
      throw new Error(`hash local divergente antes da alocação: ${path}`);
    }
  }
  for (const prior of PRIOR_PROVIDER_RECEIPTS) {
    const priorReceiptBytes = await readFile(resolve(PROJECT_ROOT, prior.path));
    if (sha256(priorReceiptBytes) !== prior.sha256) {
      throw new Error(`recibo de infraestrutura divergiu: ${prior.path}`);
    }
    const priorReceipt = JSON.parse(priorReceiptBytes.toString("utf8"));
    if (priorReceipt.status !== "FAILED" ||
      priorReceipt.termination?.confirmed !== true ||
      priorReceipt.runtime?.retrieved?.[RAW_EVIDENCE] !== false ||
      priorReceipt.runtime?.retrieved?.[RAW_JOURNAL] !== false) {
      throw new Error(`tentativa anterior não é elegível: ${prior.path}`);
    }
  }
  if (PRIOR_TRANSFER_BYTES_UPPER_BOUND + FROZEN_ARTIFACT_BYTES >
    MAX_DOWNLOAD_BYTES) {
    throw new Error("retry excederia o budget cumulativo de download");
  }
  for (const path of [PROVIDER_RECEIPT, REMOTE_LOG]) {
    if (await exists(resolve(PROJECT_ROOT, path))) {
      throw new Error(`execução anterior detectada: ${path}`);
    }
  }
}

async function main() {
  const apiKey = await loadRunpodApiKey();
  await assertLocalInputs();
  await runLocal(
    "node",
    ["scripts/check-exp-0025-r-external-authorization.mjs", "--preflight"],
    { label: "preflight prospectivo" }
  );

  const temporary = await makeTemporaryAccess();
  const podName = `${POD_NAME_PREFIX}${Date.now()}`;
  const requestedAt = isoNow();
  const allocationStartEpoch = Date.now() / 1_000;
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
    process.stdout.write("[runpod] criando um único Pod H100 PCIe...\n");
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
      apiKey,
      podId,
      temporary,
      allocationStartEpoch
    );
    connection = ready.connection;
    observedPod = ready.pod;
    hourlyUsd = ready.rate;
    if (!Number.isFinite(hourlyUsd) || hourlyUsd < 0) {
      throw new Error("RunPod não informou taxa horária válida");
    }
    process.stdout.write(
      `[runpod] pronto; taxa observada US$ ${hourlyUsd.toFixed(4)}/h\n`
    );
    await uploadInputs(connection, temporary);
    const elapsedMs = (Date.now() / 1_000 - allocationStartEpoch) * 1_000;
    const remainingMs = REMAINING_GPU_SECONDS * 1_000 - elapsedMs - 120_000;
    if (remainingMs <= 0) throw new Error("budget temporal consumido antes de E");
    remoteResult = await runRemote(
      connection,
      temporary,
      remoteScript({ allocationStartEpoch, hourlyUsd }),
      remainingMs
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (!podId) {
      try {
        const matches = await findPodsByName(apiKey, podName);
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
            connection,
            temporary,
            path
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
      ? Date.now() / 1_000 - allocationStartEpoch
      : 0;
    const estimatedGpuCostUsd = Number.isFinite(hourlyUsd)
      ? hourlyUsd * allocationSeconds / 3_600
      : null;
    const receipt = {
      schemaVersion: "exp-0025-r-runpod-allocation-receipt-v1",
      experimentId: EXPERIMENT_ID,
      candidateId: CANDIDATE_ID,
      infrastructureAttempt: INFRASTRUCTURE_ATTEMPT,
      modelInferenceAttempt: 1,
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
        transferredInputSha256: EXPECTED_INPUT_SHA256,
        holdoutTransferred: false,
        environmentFileTransferred: false,
        accountApiKeyTransferred: false,
        openAiApiKeyTransferred: false
      },
      runtime: {
        packagePins: PACKAGE_PINS,
        remoteTimeoutSeconds: REMOTE_RUN_TIMEOUT_SECONDS,
        remoteExitCode: remoteResult?.code ?? null,
        retrieved
      },
      budget: {
        allocationSeconds,
        priorAllocationSeconds: PRIOR_ALLOCATION_SECONDS,
        cumulativeAllocationSeconds:
          PRIOR_ALLOCATION_SECONDS + allocationSeconds,
        maximumGpuSeconds: MAX_GPU_SECONDS,
        hourlyUsd,
        estimatedGpuCostUsd,
        priorEstimatedGpuCostUsd: PRIOR_COST_USD,
        cumulativeEstimatedGpuCostUsd:
          Number.isFinite(estimatedGpuCostUsd)
            ? PRIOR_COST_USD + estimatedGpuCostUsd
            : null,
        maximumExternalCostUsd: MAX_COST_USD,
        priorTransferBytesUpperBound: PRIOR_TRANSFER_BYTES_UPPER_BOUND,
        frozenArtifactBytes: FROZEN_ARTIFACT_BYTES,
        projectedCumulativeTransferBytes:
          PRIOR_TRANSFER_BYTES_UPPER_BOUND + FROZEN_ARTIFACT_BYTES,
        maximumDownloadBytes: MAX_DOWNLOAD_BYTES,
        withinFrozenLimits:
          PRIOR_ALLOCATION_SECONDS + allocationSeconds <= MAX_GPU_SECONDS &&
          Number.isFinite(estimatedGpuCostUsd) &&
          PRIOR_COST_USD + estimatedGpuCostUsd <= MAX_COST_USD &&
          PRIOR_TRANSFER_BYTES_UPPER_BOUND + FROZEN_ARTIFACT_BYTES <=
            MAX_DOWNLOAD_BYTES
      },
      termination,
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
    throw new Error("execução terminou sem evidência bruta completa");
  }
  process.stdout.write(
    `[runpod] evidência coletada e Pod removido: ${RAW_EVIDENCE}\n`
  );
}

await main();
