import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_PYTHON = resolve(PROJECT_ROOT, ".venv/bin/python");
const DEFAULT_WORKER = resolve(
  PROJECT_ROOT,
  "scripts/asr-persistent-worker.py"
);
const DEFAULT_CACHE = resolve(
  PROJECT_ROOT,
  "eval/generated/asr/models"
);

function abortError(message = "operação ASR cancelada") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function workerError(message, code = "asr_worker_error") {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class PersistentAsrWorker extends EventEmitter {
  #child = null;
  #closePromise = null;
  #options;
  #pending = new Map();
  #readyPromise = null;
  #requestSequence = 0;
  #startReject = null;
  #startResolve = null;
  #stderr = "";

  constructor(options = {}) {
    super();
    this.#options = {
      cacheDir: options.cacheDir ?? DEFAULT_CACHE,
      command: options.command ?? DEFAULT_PYTHON,
      computeType: options.computeType ?? "int8",
      device: options.device ?? "cpu",
      engine: options.engine ?? "whisper",
      environment: options.environment ?? {},
      model: options.model ?? "base",
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      spawnProcess: options.spawnProcess ?? spawn,
      startTimeoutMs: options.startTimeoutMs ?? 120_000,
      threads: options.threads ?? 4,
      workers: options.workers ?? 1,
      warmupMs: options.warmupMs ?? 500,
      workerPath: options.workerPath ?? DEFAULT_WORKER,
      workerArgs: options.workerArgs ?? null
    };
  }

  get running() {
    return Boolean(this.#child && this.#child.exitCode === null);
  }

  async start() {
    if (this.#readyPromise) {
      return this.#readyPromise;
    }

    this.#readyPromise = new Promise((resolvePromise, rejectPromise) => {
      this.#startResolve = resolvePromise;
      this.#startReject = rejectPromise;
    });

    const args = this.#options.workerArgs ?? [
      this.#options.workerPath,
      "--engine",
      this.#options.engine,
      "--model",
      this.#options.model,
      "--cache-dir",
      this.#options.cacheDir,
      "--device",
      this.#options.device,
      "--compute-type",
      this.#options.computeType,
      "--threads",
      String(this.#options.threads),
      "--workers",
      String(this.#options.workers),
      "--warmup-ms",
      String(this.#options.warmupMs)
    ];
    this.#child = this.#options.spawnProcess(
      this.#options.command,
      args,
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          HF_HUB_DISABLE_TELEMETRY: "1",
          KMP_BLOCKTIME: process.env.KMP_BLOCKTIME ?? "0",
          OMP_WAIT_POLICY:
            process.env.OMP_WAIT_POLICY ?? "PASSIVE",
          ...this.#options.environment
        },
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    const startTimer = setTimeout(() => {
      const error = workerError(
        "worker ASR não aqueceu dentro do prazo",
        "asr_worker_start_timeout"
      );
      this.#startReject?.(error);
      this.#terminate();
    }, this.#options.startTimeoutMs);
    startTimer.unref?.();

    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#handleLine(line, startTimer));
    this.#child.stderr.on("data", (chunk) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-16_384);
    });
    this.#child.once("error", (error) => {
      clearTimeout(startTimer);
      this.#failAll(error);
    });
    this.#closePromise = new Promise((resolvePromise) => {
      this.#child.once("close", (code, signal) => {
        clearTimeout(startTimer);
        const detail = this.#stderr.trim();
        const error = workerError(
          detail ||
            `worker ASR encerrou (code=${code}, signal=${signal})`,
          "asr_worker_closed"
        );
        this.#failAll(error);
        resolvePromise();
      });
    });

    return this.#readyPromise;
  }

  async transcribe(request, options = {}) {
    await this.start();
    if (!Buffer.isBuffer(request.pcm)) {
      throw new TypeError("pcm precisa ser um Buffer");
    }
    if (options.signal?.aborted) {
      throw abortError();
    }

    const requestId = `asr-${++this.#requestSequence}`;
    const startedAt = performance.now();
    const payload = {
      type: "transcribe",
      requestId,
      sessionId: request.sessionId,
      generation: request.generation,
      mode: request.mode,
      sampleRate: request.sampleRate,
      language: request.language ?? "pt",
      pcmBase64: request.pcm.toString("base64")
    };

    return new Promise((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (!this.#pending.delete(requestId)) {
          return;
        }
        cleanup();
        this.#write({ type: "cancel", requestId }).catch(() => {});
        rejectPromise(abortError());
      };
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(requestId)) {
          return;
        }
        cleanup();
        this.#write({ type: "cancel", requestId }).catch(() => {});
        rejectPromise(
          workerError(
            "transcrição ASR excedeu o prazo",
            "asr_request_timeout"
          )
        );
      }, this.#options.requestTimeoutMs);
      timeout.unref?.();

      this.#pending.set(requestId, {
        cleanup,
        reject: rejectPromise,
        resolve: (value) =>
          resolvePromise({
            ...value,
            roundTripMs:
              Math.round((performance.now() - startedAt) * 100) / 100
          })
      });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.#write(payload).catch((error) => {
        const pending = this.#pending.get(requestId);
        if (!pending) {
          return;
        }
        this.#pending.delete(requestId);
        pending.cleanup();
        pending.reject(error);
      });
    });
  }

  async close() {
    if (!this.#child) {
      return;
    }
    await this.#write({ type: "close" }).catch(() => {});
    await Promise.race([
      this.#closePromise,
      new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 1_000)
      )
    ]);
    if (this.running) {
      this.#terminate();
      await this.#closePromise;
    }
  }

  async #write(message) {
    if (!this.running || !this.#child.stdin.writable) {
      throw workerError("worker ASR indisponível", "asr_worker_closed");
    }
    const line = `${JSON.stringify(message)}\n`;
    if (this.#child.stdin.write(line)) {
      return;
    }
    await new Promise((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        this.#child?.stdin.off("drain", onDrain);
        this.#child?.stdin.off("error", onError);
      };
      const onDrain = () => {
        cleanup();
        resolvePromise();
      };
      const onError = (error) => {
        cleanup();
        rejectPromise(error);
      };
      this.#child.stdin.once("drain", onDrain);
      this.#child.stdin.once("error", onError);
    });
  }

  #handleLine(line, startTimer) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("diagnostic", {
        type: "malformed-output",
        line: line.slice(0, 500)
      });
      return;
    }

    if (message.type === "ready") {
      clearTimeout(startTimer);
      this.#startResolve?.(message);
      this.#startResolve = null;
      this.#startReject = null;
      this.emit("ready", message);
      return;
    }

    const pending = this.#pending.get(message.requestId);
    if (!pending) {
      return;
    }
    this.#pending.delete(message.requestId);
    pending.cleanup();

    if (message.type === "result") {
      pending.resolve(message);
    } else {
      pending.reject(
        workerError(
          message.message ?? `worker retornou ${message.type}`,
          message.code ?? `asr_${message.type}`
        )
      );
    }
  }

  #failAll(error) {
    this.#startReject?.(error);
    this.#startResolve = null;
    this.#startReject = null;
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #terminate() {
    if (this.running) {
      this.#child.kill("SIGTERM");
    }
  }
}
