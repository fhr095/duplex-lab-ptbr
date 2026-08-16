import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAsrWarmupDurations
} from "../src/asr/cpu-runtime.mjs";

test("workers parcial e final podem aquecer durações representativas distintas", () => {
  assert.deepEqual(
    resolveAsrWarmupDurations({
      warmupMs: 500,
      partialWarmupMs: 2_000,
      finalWarmupMs: 6_000
    }),
    { partial: 2_000, final: 6_000 }
  );
  assert.deepEqual(resolveAsrWarmupDurations({ warmupMs: 750 }), {
    partial: 750,
    final: 750
  });
});

test("partialEngine=kroko monta o worker streaming próprio (venv + script + modelo)", async () => {
  const { createCpuStreamingAsr } = await import("../src/asr/cpu-runtime.mjs");
  const spawns = [];
  const fakeSpawn = (command, args) => {
    spawns.push({ command, args });
    // Processo fake mínimo: registra o spawn; handshake nunca completa.
    return {
      exitCode: 0,
      stdout: { on() {} },
      stderr: { on() {} },
      stdin: { writable: false },
      once() {},
      kill() {}
    };
  };
  const runtime = createCpuStreamingAsr({
    partialEngine: "kroko",
    krokoModelDir: "/tmp/modelos/pt-64L",
    krokoPython: "/tmp/venv/bin/python",
    partialThreads: 1,
    partialWarmupMs: 500,
    finalEngine: "parakeet",
    finalModel: "modelo-final",
    spawnProcess: fakeSpawn
  });
  void runtime.partialWorker.start().catch(() => {});
  void runtime.finalWorker.start().catch(() => {});
  assert.equal(spawns.length, 2);
  const kroko = spawns.find((s) => s.command === "/tmp/venv/bin/python");
  assert.ok(kroko, "worker kroko usa o python do venv configurado");
  assert.ok(
    kroko.args[0].endsWith("scripts/asr-kroko-worker.py"),
    "primeiro arg é o script do worker kroko"
  );
  assert.deepEqual(
    kroko.args.slice(1, 3),
    ["--model-dir", "/tmp/modelos/pt-64L"]
  );
  const finalSpawn = spawns.find((s) => s !== kroko);
  assert.ok(
    finalSpawn.args.includes("parakeet"),
    "perna final continua no worker clássico parakeet"
  );
});
