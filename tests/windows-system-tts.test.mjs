import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { inspectWave } from "../src/audio/wav.mjs";
import {
  closeWindowsSpeechSynthesizer,
  synthesizeWindowsSpeech,
  WindowsSystemSpeechSynthesizer
} from "../src/tts/windows-system-tts.mjs";

function protocolLine(message) {
  return `${Buffer.from(JSON.stringify(message), "utf8").toString("base64")}\n`;
}

function decodeProtocolLine(line) {
  return JSON.parse(Buffer.from(line, "base64").toString("utf8"));
}

function minimalWave() {
  const wave = Buffer.alloc(12);
  wave.write("RIFF", 0, "ascii");
  wave.writeUInt32LE(4, 4);
  wave.write("WAVE", 8, "ascii");
  return wave;
}

function fakePowerShellFactory(options = {}) {
  const children = [];
  const requests = [];
  const wave = minimalWave().toString("base64");

  class FakePowerShell extends EventEmitter {
    constructor() {
      super();
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.killed = false;
      this.closed = false;
      this.input = "";
      this.stdin = new Writable({
        write: (chunk, _encoding, callback) => {
          this.input += chunk.toString("utf8");
          let newline;
          while ((newline = this.input.indexOf("\n")) !== -1) {
            const line = this.input.slice(0, newline).replace(/\r$/, "");
            this.input = this.input.slice(newline + 1);
            if (line) {
              this.handleRequest(decodeProtocolLine(line));
            }
          }
          callback();
        }
      });

      queueMicrotask(() => {
        if (options.startupError) {
          const error = Object.assign(new Error(options.startupError), {
            code: "ENOENT"
          });
          this.emit("error", error);
          return;
        }
        this.stdout.write(
          protocolLine({
            type: "ready",
            protocol: 1,
            voice: "Microsoft Maria Desktop",
            culture: "pt-BR"
          })
        );
      });
    }

    handleRequest(request) {
      requests.push(request);
      if (request.op === "close") {
        this.stdout.write(
          protocolLine({ type: "closed", id: request.id, ok: true })
        );
        queueMicrotask(() => this.finish(0));
        return;
      }

      if (options.ignore?.(request)) {
        return;
      }

      const delay = options.delay?.(request) ?? 0;
      setTimeout(() => {
        if (this.killed || this.closed) {
          return;
        }
        if (options.error?.(request)) {
          this.stdout.write(
            protocolLine({
              type: "result",
              id: request.id,
              ok: false,
              error: options.error(request)
            })
          );
          return;
        }
        this.stdout.write(
          protocolLine({
            type: "result",
            id: request.id,
            ok: true,
            ...(request.op === "synthesize"
              ? { audio: wave }
              : { warmed: true })
          })
        );
      }, delay);
    }

    finish(code) {
      if (this.closed) {
        return;
      }
      this.closed = true;
      this.stdout.end();
      this.stderr.end();
      this.emit("close", code);
    }

    kill() {
      this.killed = true;
      queueMicrotask(() => this.finish(null));
      return true;
    }

    ref() {}

    unref() {}
  }

  return {
    children,
    requests,
    spawn() {
      const child = new FakePowerShell();
      children.push(child);
      return child;
    }
  };
}

test("Windows TTS produz WAV PT-BR sem depender do dispositivo de saída", async (t) => {
  t.after(() => closeWindowsSpeechSynthesizer({ drain: false }));
  let audio;
  try {
    audio = await synthesizeWindowsSpeech("Teste curto.");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("powershell.exe não está disponível neste ambiente");
      return;
    }
    throw error;
  }

  assert.equal(audio.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(audio.subarray(8, 12).toString("ascii"), "WAVE");
  assert.ok(audio.length > 1_000);
  const wave = inspectWave(audio);
  assert.equal(wave.audioFormat, 1);
  assert.equal(wave.channels, 1);
  assert.ok(wave.durationMs > 100);
  assert.ok(wave.peak > 0);
});

test("worker aquecido reutiliza um processo e preserva a ordem da fila", async () => {
  const fake = fakePowerShellFactory({
    delay: (request) => (request.text === "primeiro" ? 20 : 0)
  });
  const synthesizer = new WindowsSystemSpeechSynthesizer({
    spawn: fake.spawn,
    idleTimeoutMs: 0
  });

  const completionOrder = [];
  const first = synthesizer
    .synthesize("primeiro")
    .then((audio) => completionOrder.push(["primeiro", audio]));
  const second = synthesizer
    .synthesize("segundo")
    .then((audio) => completionOrder.push(["segundo", audio]));

  await Promise.all([first, second]);
  assert.deepEqual(
    completionOrder.map(([name]) => name),
    ["primeiro", "segundo"]
  );
  assert.equal(fake.children.length, 1);
  assert.deepEqual(
    fake.requests
      .filter(({ op }) => op === "synthesize")
      .map(({ text }) => text),
    ["primeiro", "segundo"]
  );
  assert.equal(synthesizer.status.stats.processStarts, 1);
  assert.equal(synthesizer.status.stats.syntheses, 2);

  await synthesizer.close();
  assert.equal(synthesizer.status.state, "closed");
  assert.equal(fake.children[0].closed, true);
});

test("prewarm paga o aquecimento sem reproduzir áudio e mantém a voz carregada", async () => {
  const fake = fakePowerShellFactory();
  const synthesizer = new WindowsSystemSpeechSynthesizer({
    spawn: fake.spawn,
    idleTimeoutMs: 0
  });

  const [firstStatus, secondStatus] = await Promise.all([
    synthesizer.prewarm(),
    synthesizer.prewarm()
  ]);
  assert.equal(firstStatus.primed, true);
  assert.equal(secondStatus.primed, true);
  assert.deepEqual(firstStatus.worker, {
    voice: "Microsoft Maria Desktop",
    culture: "pt-BR"
  });
  assert.equal(
    fake.requests.filter(({ op }) => op === "warm").length,
    1
  );
  assert.equal(fake.children.length, 1);

  await synthesizer.synthesize("fala útil");
  assert.equal(fake.children.length, 1);
  await synthesizer.close();
});

test("cancelamento ativo mata só o worker bloqueado e a fila continua em outro", async () => {
  const fake = fakePowerShellFactory({
    ignore: (request) => request.text === "bloqueado"
  });
  const synthesizer = new WindowsSystemSpeechSynthesizer({
    spawn: fake.spawn,
    idleTimeoutMs: 0
  });
  const controller = new AbortController();

  const blocked = synthesizer.synthesize("bloqueado", {
    signal: controller.signal
  });
  const next = synthesizer.synthesize("continua");
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(blocked, { name: "AbortError", code: "ABORT_ERR" });
  const audio = await next;
  assert.equal(audio.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(fake.children.length, 2);
  assert.equal(fake.children[0].killed, true);
  assert.equal(synthesizer.status.stats.syntheses, 1);
  await synthesizer.close();
});

test("timeout recicla o processo e não envenena solicitações seguintes", async () => {
  const fake = fakePowerShellFactory({
    ignore: (request) => request.text === "sem resposta"
  });
  const synthesizer = new WindowsSystemSpeechSynthesizer({
    spawn: fake.spawn,
    idleTimeoutMs: 0
  });

  const timedOut = synthesizer.synthesize("sem resposta", {
    timeoutMs: 100
  });
  const recovered = synthesizer.synthesize("recuperado");

  await assert.rejects(timedOut, /tempo limite/);
  await recovered;
  assert.equal(fake.children.length, 2);
  assert.equal(synthesizer.status.stats.workerFailures, 1);
  await synthesizer.close();
});

test("close drena a fila e recusa trabalho novo", async () => {
  const fake = fakePowerShellFactory({
    delay: ({ op }) => (op === "synthesize" ? 10 : 0)
  });
  const synthesizer = new WindowsSystemSpeechSynthesizer({
    spawn: fake.spawn,
    idleTimeoutMs: 0
  });

  const first = synthesizer.synthesize("um");
  const second = synthesizer.synthesize("dois");
  const closed = synthesizer.close();
  await assert.rejects(
    synthesizer.synthesize("três"),
    /está fechado/
  );
  await Promise.all([first, second, closed]);

  assert.deepEqual(
    fake.requests
      .filter(({ op }) => op === "synthesize")
      .map(({ text }) => text),
    ["um", "dois"]
  );
  assert.equal(fake.requests.at(-1).op, "close");
  assert.equal(synthesizer.status.state, "closed");
});

test("fila tem limite operacional explícito", async () => {
  const fake = fakePowerShellFactory({
    ignore: ({ op }) => op === "synthesize"
  });
  const synthesizer = new WindowsSystemSpeechSynthesizer({
    spawn: fake.spawn,
    idleTimeoutMs: 0,
    maxQueueDepth: 2
  });

  const first = synthesizer.synthesize("um");
  const second = synthesizer.synthesize("dois");
  await assert.rejects(
    synthesizer.synthesize("três"),
    /fila do Windows TTS excede 2/
  );
  await synthesizer.close({ drain: false });
  await assert.rejects(first, { name: "AbortError" });
  await assert.rejects(second, { name: "AbortError" });
});

test("erro de inicialização é propagado sem travar o fechamento", async () => {
  const fake = fakePowerShellFactory({
    startupError: "powershell.exe ausente"
  });
  const synthesizer = new WindowsSystemSpeechSynthesizer({
    spawn: fake.spawn,
    idleTimeoutMs: 0
  });

  await assert.rejects(
    synthesizer.synthesize("teste"),
    /powershell.exe ausente/
  );
  await synthesizer.close();
  assert.equal(synthesizer.status.state, "closed");
});

test("Windows TTS rejeita texto acima do limite operacional", async () => {
  await assert.rejects(
    synthesizeWindowsSpeech("a".repeat(701)),
    /excede 700 caracteres/
  );
});

test("Windows TTS rejeita velocidade fora do intervalo", async () => {
  await assert.rejects(
    synthesizeWindowsSpeech("Teste.", { rate: 11 }),
    /entre -10 e 10/
  );
});
