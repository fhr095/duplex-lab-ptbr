import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

import { createExp0026WithdrawalCode } from
  "../../src/eval/exp-0026-data-lifecycle.mjs";

export function privateIpv4() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  throw new Error("IP privado do WSL não encontrado");
}

export async function reservePort() {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once("error", rejectListen);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

async function waitForHealth(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`servidor EXP-0026 encerrou com código ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000)
      });
      if (response.ok) return response.json();
    } catch {
      // O ASR e o TTS podem levar alguns segundos para aquecer.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`health EXP-0026 não ficou pronto em ${timeoutMs} ms`);
}

export async function startExp0026Server(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? import.meta.dirname, options.projectRoot ? "" : "../..");
  const port = options.port ?? await reservePort();
  const accessToken = options.accessToken ?? randomBytes(32).toString("hex");
  const withdrawalCode = options.withdrawalCode ??
    createExp0026WithdrawalCode();
  const fullRuntime = options.runtime !== "lifecycle";
  const environment = {
    ...process.env,
    HOST: "0.0.0.0",
    PORT: String(port),
    BRAIN_PROVIDER: "openai",
    OPENAI_INTERACTION_MODEL: "gpt-5.6-luna",
    OPENAI_TASK_MODEL: "gpt-5.6-luna",
    OPENAI_REASONING_EFFORT: "none",
    OPENAI_MAX_OUTPUT_TOKENS: "160",
    OPENAI_MAX_REQUESTS_PER_PROCESS: "25",
    ...(options.openaiApiUrl
      ? { OPENAI_RESPONSES_URL: options.openaiApiUrl }
      : {}),
    EXP0026_INSTRUMENT: "1",
    EXP0026_SESSION_ROLE: options.role,
    EXP0026_PARTICIPANT_ALIAS: options.participantAlias,
    EXP0026_ORDER_INDEX: String(options.orderIndex),
    EXP0026_ROSTER_SLOT_ID: options.rosterSlotId ?? "",
    EXP0026_ACCESS_TOKEN: accessToken,
    EXP0026_WITHDRAWAL_CODE: withdrawalCode,
    EXP0026_DATA_ROOT:
      options.dataRoot ?? "eval/generated/exp-0026/private",
    EXP0026_COMMERCIAL_AVAILABLE:
      options.commercialAvailable === true ? "1" : "0",
    ...(fullRuntime
      ? {
          VAD_CONTROL: "silero",
          VAD_SHADOW: "silero",
          SILERO_VAD_THRESHOLD: "0.85",
          SILERO_VAD_ONSET_WINDOWS: "1"
        }
      : {
          ASR_ENABLED: "0",
          VAD_CONTROL: "energy",
          VAD_SHADOW: "disabled",
          OPENAI_API_KEY:
            process.env.OPENAI_API_KEY ?? "exp0026-lifecycle-not-called"
        })
  };
  const child = spawn(process.execPath, ["src/cli/serve.mjs"], {
    cwd: projectRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  const collect = (stream, name) => stream.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    logs.push({ stream: name, text });
    if (options.mirrorLogs) {
      (name === "stderr" ? process.stderr : process.stdout).write(text);
    }
  });
  collect(child.stdout, "stdout");
  collect(child.stderr, "stderr");
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  let health;
  try {
    health = await waitForHealth(
      healthUrl,
      child,
      options.timeoutMs ?? (fullRuntime ? 180_000 : 45_000)
    );
  } catch (error) {
    child.kill("SIGTERM");
    error.message += `\n${logs.map((entry) => entry.text).join("").slice(-4_000)}`;
    throw error;
  }
  let stopped = false;
  return Object.freeze({
    child,
    port,
    accessToken,
    withdrawalCode,
    health,
    healthUrl,
    localUrl: `http://127.0.0.1:${port}`,
    windowsUrl: `http://${privateIpv4()}:${port}`,
    logs,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null) child.kill("SIGTERM");
      await new Promise((resolveExit) => {
        if (child.exitCode !== null) resolveExit();
        else child.once("exit", resolveExit);
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          resolveExit();
        }, 5_000).unref();
      });
    }
  });
}
