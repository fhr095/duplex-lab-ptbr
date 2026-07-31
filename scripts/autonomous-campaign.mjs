import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = resolve(
  PROJECT_ROOT,
  "eval/reports/autonomous-latest.json"
);
const ASR_ENGINE =
  process.env.ASR_FINAL_ENGINE?.trim() || "parakeet";
const ASR_MODEL =
  process.env.ASR_FINAL_MODEL?.trim() ||
  (ASR_ENGINE === "parakeet"
    ? "nemo-parakeet-tdt-0.6b-v3"
    : process.env.ASR_MODEL?.trim() || "base");
const ASR_SLUG = ASR_ENGINE === "parakeet"
  ? "parakeet"
  : ASR_MODEL.replaceAll(/[^a-z0-9]+/giu, "-").toLowerCase();
const DEEP_CAMPAIGN = process.env.AUTONOMOUS_DEEP === "1";
const VAD_CONTROL =
  process.env.AUTONOMOUS_VAD_CONTROL?.trim() || "energy";
const SILERO_THRESHOLD =
  process.env.AUTONOMOUS_SILERO_THRESHOLD?.trim() || "0.85";
const SILERO_ONSET_WINDOWS =
  process.env.AUTONOMOUS_SILERO_ONSET_WINDOWS?.trim() || "1";
const BROWSER_CAMPAIGN_RUNS = Math.max(
  10,
  Number.parseInt(
    process.env.BROWSER_CAMPAIGN_RUNS ?? "10",
    10
  )
);
const BROWSER_STAGE = DEEP_CAMPAIGN
  ? "windows-chrome-perception-campaign"
  : "windows-chrome-interaction";
const BROWSER_REPORT = DEEP_CAMPAIGN
  ? `eval/reports/browser-${ASR_SLUG}-campaign-latest.json`
  : `eval/reports/browser-${ASR_SLUG}-latest.json`;
const stages = [];

async function findFreePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.once("error", rejectPromise);
    probe.listen(0, "0.0.0.0", () => {
      const address = probe.address();
      const port = typeof address === "object" ? address.port : null;
      probe.close((error) => {
        if (error) {
          rejectPromise(error);
        } else if (!port) {
          rejectPromise(new Error("não foi possível reservar uma porta"));
        } else {
          resolvePromise(port);
        }
      });
    });
  });
}

async function runStage(name, command, args, options = {}) {
  const started = performance.now();
  const result = await new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...options.environment
      },
      stdio: "inherit"
    });
    child.once("error", (error) => {
      resolvePromise({ code: null, error: error.message });
    });
    child.once("close", (code, signal) => {
      resolvePromise({ code, signal: signal ?? null });
    });
  });
  const stage = {
    name,
    pass: (options.allowedExitCodes ?? [0]).includes(result.code),
    durationMs: Math.round(performance.now() - started),
    ...result
  };
  stages.push(stage);
  return stage;
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`servidor local terminou com código ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) {
        const health = await response.json();
        if (health.brain !== "local") {
          throw new Error(`provider inesperado: ${health.brain}`);
        }
        if (health.asr?.state !== "ready") {
          throw new Error(
            `ASR local não está pronto: ${health.asr?.state ?? "ausente"}`
          );
        }
        if (health.vadShadow?.state !== "ready") {
          throw new Error(
            "VAD Silero em modo sombra não está pronto: " +
              `${health.vadShadow?.state ?? "ausente"}`
          );
        }
        if (
          VAD_CONTROL === "silero" &&
          health.vadControl?.engine !== "silero-vad"
        ) {
          throw new Error("VAD de controle Silero não foi selecionado");
        }
        return health;
      }
    } catch {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 100)
      );
    }
  }
  throw new Error("servidor local não ficou pronto em 120 segundos");
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("close", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

async function ensureAsrEnvironment() {
  await runStage("setup-asr", "npm", ["run", "setup:asr"]);
}

const campaignStarted = performance.now();
let server = null;
let health = null;
let fatalError = null;

try {
  await ensureAsrEnvironment();
  await runStage("setup-vad", "npm", ["run", "setup:vad"]);
  await runStage("unit-and-contract-tests", "npm", ["test"]);
  await runStage("policy-evaluation", "node", [
    "src/cli/eval.mjs",
    "--out",
    "eval/reports/policy-latest.json"
  ]);
  await runStage("perception-proxy-evaluation", "node", [
    "scripts/eval-perception.mjs"
  ]);
  await runStage("synthetic-asr", "node", [
    "scripts/eval-asr.mjs",
    "--engine",
    ASR_ENGINE,
    "--model",
    ASR_MODEL,
    "--out",
    `eval/reports/asr-synthetic-${ASR_SLUG}-latest.json`
  ]);
  await runStage("fetch-human-speech", ".venv/bin/python", [
    "scripts/fetch_coraa_sample.py"
  ]);
  await runStage("human-asr-baseline", "node", [
    "scripts/eval-asr.mjs",
    "--pack",
    "eval/generated/coraa/manifest.json",
    "--engine",
    "whisper",
    "--model",
    "base",
    "--out",
    "eval/reports/asr-human-base-latest.json"
  ], {
    allowedExitCodes: [0, 1]
  });
  await runStage("human-asr", "node", [
    "scripts/eval-asr.mjs",
    "--pack",
    "eval/generated/coraa/manifest.json",
    "--engine",
    ASR_ENGINE,
    "--model",
    ASR_MODEL,
    "--out",
    `eval/reports/asr-human-${ASR_SLUG}-latest.json`
  ]);
  await runStage("asr-candidate-comparison", "node", [
    "scripts/compare-asr.mjs",
    "--baseline",
    "eval/reports/asr-human-base-latest.json",
    "--candidate",
    `eval/reports/asr-human-${ASR_SLUG}-latest.json`,
    "--out",
    `eval/reports/asr-comparison-${ASR_SLUG}-latest.json`
  ]);

  const port = await findFreePort();
  server = spawn("node", ["src/cli/serve.mjs"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ASR_FINAL_ENGINE: ASR_ENGINE,
      ASR_FINAL_MODEL: ASR_MODEL,
      BRAIN_PROVIDER: "local",
      HOST: "0.0.0.0",
      PORT: String(port),
      SILERO_VAD_THRESHOLD:
        VAD_CONTROL === "silero" ? SILERO_THRESHOLD : "0.5",
      SILERO_VAD_ONSET_WINDOWS:
        VAD_CONTROL === "silero" ? SILERO_ONSET_WINDOWS : "2",
      VAD_CONTROL,
      VAD_SHADOW: "silero"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  health = await waitForHealth(port, server);
  await runStage("live-local-audio-vertical", "node", [
    "scripts/live-audio-probe.mjs",
    "--url",
    `ws://127.0.0.1:${port}/api/audio`,
    "--out",
    `eval/reports/live-audio-${ASR_SLUG}-latest.json`
  ]);
  await runStage("live-conversation-campaign", "node", [
    "scripts/live-audio-campaign.mjs",
    "--no-fail",
    "--url",
    `ws://127.0.0.1:${port}/api/audio`,
    "--out",
    `eval/reports/live-campaign-${ASR_SLUG}-latest.json`
  ]);
  if (DEEP_CAMPAIGN) {
    await runStage(BROWSER_STAGE, "node", [
      "scripts/browser-perception-campaign.mjs",
      "--runs",
      String(BROWSER_CAMPAIGN_RUNS),
      "--out",
      BROWSER_REPORT,
      "--run-dir",
      `eval/reports/browser-${ASR_SLUG}-campaign`
    ], {
      environment: {
        DUPLEX_URL: `http://localhost:${port}/?automation=1`,
        REQUIRE_VAD_CONTROL:
          VAD_CONTROL === "silero" ? "silero-vad" : "",
        REQUIRE_SILERO_THRESHOLD: SILERO_THRESHOLD,
        REQUIRE_SILERO_ONSET_WINDOWS: SILERO_ONSET_WINDOWS
      }
    });
  } else {
    await runStage(BROWSER_STAGE, "node", [
      "scripts/windows-chrome-smoke.mjs"
    ], {
      environment: {
        BROWSER_REPORT,
        DUPLEX_URL: `http://localhost:${port}/?automation=1`,
        REQUIRE_VAD_CONTROL:
          VAD_CONTROL === "silero" ? "silero-vad" : "",
        REQUIRE_SILERO_THRESHOLD: SILERO_THRESHOLD,
        REQUIRE_SILERO_ONSET_WINDOWS: SILERO_ONSET_WINDOWS,
        REQUIRE_VAD_SHADOW: "1"
      }
    });
  }
} catch (error) {
  fatalError = error.message;
} finally {
  if (server) {
    await stopChild(server);
  }
}

const requiredStages = [
  "setup-asr",
  "setup-vad",
  "unit-and-contract-tests",
  "policy-evaluation",
  "perception-proxy-evaluation",
  "synthetic-asr",
  "human-asr",
  "human-asr-baseline",
  "asr-candidate-comparison",
  "live-local-audio-vertical",
  "live-conversation-campaign",
  BROWSER_STAGE
];
const missingStages = requiredStages.filter(
  (name) => !stages.some((stage) => stage.name === name)
);
const pass =
  !fatalError &&
  missingStages.length === 0 &&
  requiredStages.every(
    (name) => stages.find((stage) => stage.name === name)?.pass
  );
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  candidate: {
    asrEngine: ASR_ENGINE,
    asrModel: ASR_MODEL,
    brainProvider: "local",
    deepCampaign: DEEP_CAMPAIGN,
    vadControl: VAD_CONTROL,
    vadControlThreshold:
      VAD_CONTROL === "silero" ? Number(SILERO_THRESHOLD) : null,
    vadControlOnsetWindows:
      VAD_CONTROL === "silero"
        ? Number(SILERO_ONSET_WINDOWS)
        : null,
    vadShadow: "silero-v6.2",
    paidApiCalls: 0
  },
  pass,
  status: pass ? "promotion-eligible" : "hold",
  durationMs: Math.round(performance.now() - campaignStarted),
  fatalError,
  missingStages,
  health,
  evidence: await (async () => {
    const paths = {
      asrComparison:
        `eval/reports/asr-comparison-${ASR_SLUG}-latest.json`,
      browser: BROWSER_REPORT,
      humanAsr: `eval/reports/asr-human-${ASR_SLUG}-latest.json`,
      liveCampaign:
        `eval/reports/live-campaign-${ASR_SLUG}-latest.json`,
      syntheticAsr:
        `eval/reports/asr-synthetic-${ASR_SLUG}-latest.json`
    };
    const loaded = {};
    for (const [name, path] of Object.entries(paths)) {
      try {
        loaded[name] = JSON.parse(
          await readFile(resolve(PROJECT_ROOT, path), "utf8")
        );
      } catch {
        loaded[name] = null;
      }
    }
    return {
      reports: paths,
      decisions: {
        asrComparison:
          loaded.asrComparison?.decision ?? "not-measured",
        browser: loaded.browser && (
          DEEP_CAMPAIGN
            ? loaded.browser.pass === true
            : Object.values(loaded.browser.gates ?? {}).every(Boolean)
        ) ? "pass" : "hold",
        humanAsr:
          loaded.humanAsr?.gate?.pass ? "pass" : "hold",
        liveCampaign:
          loaded.liveCampaign?.gate?.decision ?? "not-measured",
        syntheticAsr:
          loaded.syntheticAsr?.gate?.pass ? "pass" : "hold"
      }
    };
  })(),
  stages
};
await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    pass,
    status: report.status,
    engine: ASR_ENGINE,
    model: ASR_MODEL,
    paidApiCalls: 0,
    failedStages: stages.filter((stage) => !stage.pass).map(
      (stage) => stage.name
    ),
    fatalError,
    report: REPORT_PATH
  })
);

if (!pass) {
  process.exitCode = 1;
}
