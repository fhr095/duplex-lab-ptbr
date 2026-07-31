import { spawn } from "node:child_process";

const PROTOCOL_VERSION = 1;
const MAX_TEXT_LENGTH = 700;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_ENCODED_AUDIO_BYTES = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
const MAX_PROTOCOL_LINE_BYTES =
  Math.ceil((MAX_ENCODED_AUDIO_BYTES + 1_024) / 3) * 4 + 64 * 1024;
const SYNTHESIS_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 2_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;
const MAX_QUEUE_DEPTH = 64;

const POWERSHELL_WORKER_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$ProtocolVersion = 1
$MaxTextLength = 700
$MaxAudioBytes = 12582912
$Synth = $null

function Send-Message([hashtable] $Message) {
  $json = $Message | ConvertTo-Json -Compress -Depth 4
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  [Console]::Out.WriteLine([Convert]::ToBase64String($bytes))
}

function Read-Message([string] $Line) {
  $bytes = [Convert]::FromBase64String($Line)
  $json = [Text.Encoding]::UTF8.GetString($bytes)
  return $json | ConvertFrom-Json
}

function Synthesize-Wave([string] $Text, [int] $Rate) {
  $stream = New-Object IO.MemoryStream
  try {
    $Synth.Rate = $Rate
    $Synth.SetOutputToWaveStream($stream)
    $Synth.Speak($Text)
    $Synth.SetOutputToNull()
    $audio = $stream.ToArray()
    if ($audio.Length -gt $MaxAudioBytes) {
      throw "Windows TTS excedeu o limite de saída"
    }
    return $audio
  }
  finally {
    try {
      $Synth.SetOutputToNull()
    }
    catch {
    }
    $stream.Dispose()
  }
}

try {
  $Synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voice = $Synth.GetInstalledVoices() |
    Where-Object {
      $_.Enabled -and $_.VoiceInfo.Culture.Name -eq "pt-BR"
    } |
    Select-Object -First 1

  if ($null -ne $voice) {
    $Synth.SelectVoice($voice.VoiceInfo.Name)
  }

  $selectedVoice = $Synth.Voice
  Send-Message @{
    type = "ready"
    protocol = $ProtocolVersion
    voice = [string]$selectedVoice.Name
    culture = [string]$selectedVoice.Culture.Name
  }

  while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $requestId = $null
    try {
      $request = Read-Message $line
      $requestId = [string]$request.id
      $operation = [string]$request.op

      if ($operation -eq "close") {
        Send-Message @{
          type = "closed"
          id = $requestId
          ok = $true
        }
        break
      }

      if ($operation -eq "warm") {
        $null = Synthesize-Wave "sim" 1
        Send-Message @{
          type = "result"
          id = $requestId
          ok = $true
          warmed = $true
        }
        continue
      }

      if ($operation -ne "synthesize") {
        throw "operação de TTS desconhecida"
      }

      $text = [string]$request.text
      $rate = [int]$request.rate
      if ([string]::IsNullOrWhiteSpace($text)) {
        throw "texto de TTS não pode estar vazio"
      }
      if ($text.Length -gt $MaxTextLength) {
        throw "texto de TTS excede 700 caracteres"
      }
      if ($rate -lt -10 -or $rate -gt 10) {
        throw "rate do Windows TTS precisa estar entre -10 e 10"
      }

      $audio = Synthesize-Wave $text $rate
      Send-Message @{
        type = "result"
        id = $requestId
        ok = $true
        audio = [Convert]::ToBase64String($audio)
      }
    }
    catch {
      Send-Message @{
        type = "result"
        id = $requestId
        ok = $false
        error = [string]$_.Exception.Message
      }
    }
  }
}
finally {
  if ($null -ne $Synth) {
    $Synth.Dispose()
  }
}
`;

const ENCODED_WORKER_COMMAND = Buffer.from(
  POWERSHELL_WORKER_SCRIPT,
  "utf16le"
).toString("base64");

const liveSynthesizers = new Set();

process.once("exit", () => {
  for (const synthesizer of liveSynthesizers) {
    synthesizer.kill();
  }
});

function createAbortError(message = "síntese de voz cancelada") {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function validateText(rawText) {
  const text = rawText?.trim() ?? "";
  if (!text) {
    throw new TypeError("texto de TTS não pode estar vazio");
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new RangeError(`texto de TTS excede ${MAX_TEXT_LENGTH} caracteres`);
  }
  return text;
}

function validateRate(rawRate) {
  const rate = Number.parseInt(rawRate ?? "1", 10);
  if (!Number.isInteger(rate) || rate < -10 || rate > 10) {
    throw new RangeError("rate do Windows TTS precisa estar entre -10 e 10");
  }
  return rate;
}

function validateTimeout(rawTimeout) {
  const timeoutMs = Number(rawTimeout ?? SYNTHESIS_TIMEOUT_MS);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60_000
  ) {
    throw new RangeError("timeoutMs do Windows TTS precisa estar entre 100 e 60000");
  }
  return timeoutMs;
}

function encodeMessage(message) {
  return `${Buffer.from(JSON.stringify(message), "utf8").toString("base64")}\n`;
}

function decodeMessage(line) {
  if (!line || line.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(line)) {
    throw new TypeError("Windows TTS retornou uma mensagem de protocolo inválida");
  }
  return JSON.parse(Buffer.from(line, "base64").toString("utf8"));
}

function decodeWave(encodedAudio) {
  if (
    typeof encodedAudio !== "string" ||
    encodedAudio.length % 4 !== 0 ||
    encodedAudio.length > MAX_ENCODED_AUDIO_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encodedAudio)
  ) {
    throw new RangeError("Windows TTS excedeu o limite de saída");
  }

  const audio = Buffer.from(encodedAudio, "base64");
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new RangeError("Windows TTS excedeu o limite de saída");
  }
  const riff = audio.subarray(0, 4).toString("ascii");
  const wave = audio.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new TypeError("Windows TTS não retornou um WAV válido");
  }
  return audio;
}

function callHandleMethod(handle, method) {
  try {
    handle?.[method]?.();
  } catch {
    // Alguns adaptadores de stdio não implementam ref/unref de forma simétrica.
  }
}

export class WindowsSystemSpeechSynthesizer {
  constructor(options = {}) {
    this.spawn = options.spawn ?? spawn;
    this.executable = options.executable ?? "powershell.exe";
    this.startupTimeoutMs =
      options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.closeTimeoutMs = options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.maxQueueDepth = options.maxQueueDepth ?? MAX_QUEUE_DEPTH;

    this.child = null;
    this.starting = null;
    this.response = null;
    this.active = null;
    this.queue = [];
    this.pumping = false;
    this.accepting = true;
    this.closing = false;
    this.closed = false;
    this.drainOnClose = true;
    this.closePromise = null;
    this.resolveClose = null;
    this.idleTimer = null;
    this.nextRequestId = 1;
    this.primed = false;
    this.prewarmPromise = null;
    this.workerInfo = null;
    this.stderrTail = "";
    this.stats = {
      processStarts: 0,
      syntheses: 0,
      warmups: 0,
      workerFailures: 0
    };

    liveSynthesizers.add(this);
  }

  get status() {
    return {
      state: this.closed
        ? "closed"
        : this.closing
          ? "closing"
          : this.child && this.workerInfo
            ? "ready"
            : this.starting
              ? "starting"
              : "idle",
      primed: this.primed,
      queueDepth: this.queue.length + (this.active ? 1 : 0),
      worker: this.workerInfo ? { ...this.workerInfo } : null,
      stats: { ...this.stats }
    };
  }

  async prewarm(options = {}) {
    if (this.primed && this.child && this.workerInfo) {
      return this.status;
    }
    if (this.prewarmPromise) {
      return this.prewarmPromise;
    }

    this.prewarmPromise = this.#enqueue({
      op: "warm",
      signal: options.signal,
      timeoutMs: validateTimeout(options.timeoutMs)
    }).then(() => this.status);

    try {
      return await this.prewarmPromise;
    } finally {
      this.prewarmPromise = null;
    }
  }

  synthesize(rawText, options = {}) {
    const text = validateText(rawText);
    const rate = validateRate(options.rate);
    const timeoutMs = validateTimeout(options.timeoutMs);
    return this.#enqueue({
      op: "synthesize",
      text,
      rate,
      signal: options.signal,
      timeoutMs
    });
  }

  close(options = {}) {
    const drain = options.drain !== false;
    if (this.closed) {
      return Promise.resolve();
    }
    if (this.closePromise) {
      return this.closePromise;
    }

    this.accepting = false;
    this.closing = true;
    this.drainOnClose = drain;
    this.closePromise = new Promise((resolve) => {
      this.resolveClose = resolve;
    });

    if (!drain) {
      const error = createAbortError("sintetizador Windows TTS fechado");
      for (const request of this.queue.splice(0)) {
        this.#settleRequest(request, "reject", error);
      }
      if (this.active) {
        this.#invalidateWorker(error);
      }
    }

    this.#pump();
    return this.closePromise;
  }

  kill() {
    const error = createAbortError("processo Windows TTS encerrado");
    this.accepting = false;
    this.closing = true;
    this.drainOnClose = false;
    for (const request of this.queue.splice(0)) {
      this.#settleRequest(request, "reject", error);
    }
    if (this.active) {
      this.#settleRequest(this.active, "reject", error);
    }
    this.#invalidateWorker(error);
    this.#markClosed();
  }

  #enqueue(specification) {
    if (!this.accepting || this.closing || this.closed) {
      return Promise.reject(new Error("sintetizador Windows TTS está fechado"));
    }
    if (specification.signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    if (this.queue.length + (this.active ? 1 : 0) >= this.maxQueueDepth) {
      return Promise.reject(
        new RangeError(
          `fila do Windows TTS excede ${this.maxQueueDepth} solicitações`
        )
      );
    }

    const request = {
      ...specification,
      id: String(this.nextRequestId++),
      phase: "queued",
      settled: false,
      timeout: null,
      abortHandler: null,
      resolve: null,
      reject: null
    };
    const promise = new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;
    });

    if (request.signal) {
      request.abortHandler = () => {
        const error = createAbortError();
        if (request === this.active) {
          this.#invalidateWorker(error);
        } else {
          const queueIndex = this.queue.indexOf(request);
          if (queueIndex !== -1) {
            this.queue.splice(queueIndex, 1);
          }
          this.#settleRequest(request, "reject", error);
        }
      };
      request.signal.addEventListener("abort", request.abortHandler, {
        once: true
      });
    }

    this.queue.push(request);
    this.#clearIdleTimer();
    this.#pump();
    return promise;
  }

  async #pump() {
    if (this.pumping) {
      return;
    }
    this.pumping = true;

    try {
      while (this.queue.length > 0) {
        const request = this.queue.shift();
        if (request.settled) {
          continue;
        }
        if (request.signal?.aborted) {
          this.#settleRequest(request, "reject", createAbortError());
          continue;
        }

        this.active = request;
        request.phase = "starting";
        try {
          const child = await this.#ensureWorker();
          if (request.settled) {
            continue;
          }
          if (request.signal?.aborted) {
            throw createAbortError();
          }
          request.phase = "active";
          const result = await this.#dispatch(child, request);
          if (request.op === "synthesize") {
            this.stats.syntheses += 1;
            this.primed = true;
            this.#settleRequest(
              request,
              "resolve",
              decodeWave(result.audio)
            );
          } else {
            this.stats.warmups += 1;
            this.primed = true;
            this.#settleRequest(request, "resolve", undefined);
          }
        } catch (error) {
          this.#settleRequest(request, "reject", error);
        } finally {
          if (this.active === request) {
            this.active = null;
          }
        }
      }
    } finally {
      this.pumping = false;
    }

    if (this.closing && !this.active && this.queue.length === 0) {
      await this.#shutdownWorker();
      this.#markClosed();
      return;
    }

    if (!this.active && this.queue.length === 0) {
      this.#setWorkerReferenced(false);
      this.#scheduleIdleClose();
    }
  }

  #ensureWorker() {
    if (this.child && this.workerInfo) {
      this.#setWorkerReferenced(true);
      return Promise.resolve(this.child);
    }
    if (this.starting) {
      return this.starting.promise;
    }

    this.#clearIdleTimer();
    let child;
    try {
      child = this.spawn(
        this.executable,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          ENCODED_WORKER_COMMAND
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        }
      );
    } catch (error) {
      return Promise.reject(error);
    }

    this.child = child;
    this.workerInfo = null;
    this.primed = false;
    this.stderrTail = "";
    this.stats.processStarts += 1;
    this.#setWorkerReferenced(true);

    let resolveStart;
    let rejectStart;
    const promise = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    const startupTimer = setTimeout(() => {
      this.#invalidateWorker(
        new Error("Windows TTS excedeu o tempo limite de inicialização")
      );
    }, this.startupTimeoutMs);
    this.starting = {
      child,
      promise,
      resolve: resolveStart,
      reject: rejectStart,
      timer: startupTimer
    };

    let stdoutBuffer = "";
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => {
      if (child !== this.child) {
        return;
      }
      stdoutBuffer += String(chunk);
      if (Buffer.byteLength(stdoutBuffer, "utf8") > MAX_PROTOCOL_LINE_BYTES) {
        this.#invalidateWorker(
          new RangeError("Windows TTS excedeu o limite de saída")
        );
        return;
      }

      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        try {
          this.#handleMessage(child, decodeMessage(line));
        } catch (error) {
          this.#invalidateWorker(error);
          return;
        }
      }
    });
    child.stderr?.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-8_192);
    });
    child.stdin?.on("error", (error) => {
      this.#handleWorkerFailure(child, error);
    });
    child.on("error", (error) => {
      this.#handleWorkerFailure(child, error);
    });
    child.on("close", (code) => {
      const detail = this.stderrTail.trim();
      const error = new Error(
        detail ||
          (code === 0
            ? "processo Windows TTS foi encerrado"
            : `PowerShell terminou com código ${code}`)
      );
      this.#handleWorkerFailure(child, error);
    });

    return promise;
  }

  #dispatch(child, request) {
    return new Promise((resolve, reject) => {
      this.response = {
        child,
        id: request.id,
        resolve,
        reject
      };
      request.timeout = setTimeout(() => {
        this.#invalidateWorker(
          new Error("Windows TTS excedeu o tempo limite")
        );
      }, request.timeoutMs);

      const payload =
        request.op === "synthesize"
          ? {
              id: request.id,
              op: request.op,
              text: request.text,
              rate: request.rate
            }
          : { id: request.id, op: request.op };

      try {
        child.stdin.write(encodeMessage(payload), (error) => {
          if (error && this.response?.id === request.id) {
            this.#invalidateWorker(error);
          }
        });
      } catch (error) {
        this.#invalidateWorker(error);
      }
    });
  }

  #handleMessage(child, message) {
    if (child !== this.child || !message || typeof message !== "object") {
      return;
    }

    if (message.type === "ready") {
      if (
        !this.starting ||
        this.starting.child !== child ||
        message.protocol !== PROTOCOL_VERSION
      ) {
        throw new TypeError("versão de protocolo incompatível no Windows TTS");
      }
      clearTimeout(this.starting.timer);
      const starting = this.starting;
      this.starting = null;
      this.workerInfo = {
        voice: String(message.voice ?? ""),
        culture: String(message.culture ?? "")
      };
      starting.resolve(child);
      return;
    }

    if (message.type === "closed") {
      return;
    }

    if (
      message.type !== "result" ||
      !this.response ||
      this.response.child !== child ||
      String(message.id) !== this.response.id
    ) {
      throw new TypeError("resposta fora de ordem no protocolo Windows TTS");
    }

    const response = this.response;
    this.response = null;
    if (message.ok === false) {
      response.reject(
        new Error(String(message.error || "falha desconhecida no Windows TTS"))
      );
      return;
    }
    response.resolve(message);
  }

  #handleWorkerFailure(child, error) {
    if (child !== this.child) {
      return;
    }
    this.stats.workerFailures += 1;
    this.child = null;
    this.workerInfo = null;
    this.primed = false;

    if (this.starting?.child === child) {
      clearTimeout(this.starting.timer);
      const starting = this.starting;
      this.starting = null;
      starting.reject(error);
    }
    if (this.response?.child === child) {
      const response = this.response;
      this.response = null;
      response.reject(error);
    }
  }

  #invalidateWorker(error) {
    const child = this.child;
    if (!child) {
      if (this.starting) {
        clearTimeout(this.starting.timer);
        const starting = this.starting;
        this.starting = null;
        starting.reject(error);
      }
      if (this.response) {
        const response = this.response;
        this.response = null;
        response.reject(error);
      }
      return;
    }

    this.child = null;
    this.workerInfo = null;
    this.primed = false;
    this.stats.workerFailures += 1;
    if (this.starting?.child === child) {
      clearTimeout(this.starting.timer);
      const starting = this.starting;
      this.starting = null;
      starting.reject(error);
    }
    if (this.response?.child === child) {
      const response = this.response;
      this.response = null;
      response.reject(error);
    }
    callHandleMethod(child, "kill");
  }

  #settleRequest(request, method, value) {
    if (!request || request.settled) {
      return;
    }
    request.settled = true;
    clearTimeout(request.timeout);
    if (request.signal && request.abortHandler) {
      request.signal.removeEventListener("abort", request.abortHandler);
    }
    request[method](value);
  }

  async #shutdownWorker() {
    this.#clearIdleTimer();
    const child = this.child;
    if (!child) {
      return;
    }

    this.#setWorkerReferenced(true);
    // Desacopla antes de enviar EOF: uma nova fala pode abrir outro worker sem
    // tentar escrever no stdin que está sendo fechado.
    this.child = null;
    this.workerInfo = null;
    this.primed = false;
    const exit = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        callHandleMethod(child, "kill");
        finish();
      }, this.closeTimeoutMs);
      child.once("close", finish);

      try {
        child.stdin.end(
          encodeMessage({
            id: String(this.nextRequestId++),
            op: "close"
          })
        );
      } catch {
        callHandleMethod(child, "kill");
        finish();
      }
    });
    await exit;
  }

  #setWorkerReferenced(referenced) {
    const child = this.child;
    if (!child) {
      return;
    }
    const method = referenced ? "ref" : "unref";
    callHandleMethod(child, method);
    callHandleMethod(child.stdin, method);
    callHandleMethod(child.stdout, method);
    callHandleMethod(child.stderr, method);
  }

  #scheduleIdleClose() {
    this.#clearIdleTimer();
    if (!this.child || this.idleTimeoutMs <= 0 || this.closing) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.active && this.queue.length === 0 && !this.closing) {
        void this.#shutdownWorker();
      }
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  #clearIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  #markClosed() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closing = false;
    this.accepting = false;
    this.#clearIdleTimer();
    liveSynthesizers.delete(this);
    this.resolveClose?.();
    this.resolveClose = null;
  }
}

let defaultSynthesizer = null;

function getDefaultSynthesizer() {
  if (!defaultSynthesizer || defaultSynthesizer.status.state === "closed") {
    defaultSynthesizer = new WindowsSystemSpeechSynthesizer();
  }
  return defaultSynthesizer;
}

export async function prewarmWindowsSpeech(options = {}) {
  return getDefaultSynthesizer().prewarm(options);
}

export async function closeWindowsSpeechSynthesizer(options = {}) {
  if (!defaultSynthesizer) {
    return;
  }
  const synthesizer = defaultSynthesizer;
  defaultSynthesizer = null;
  await synthesizer.close(options);
}

export async function synthesizeWindowsSpeech(rawText, options = {}) {
  return getDefaultSynthesizer().synthesize(rawText, options);
}
