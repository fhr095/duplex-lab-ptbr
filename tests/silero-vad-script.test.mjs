import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("CLI do Silero VAD documenta o contrato sem carregar o modelo", async () => {
  const { stdout } = await execute(
    ".venv/bin/python",
    ["scripts/eval_silero_vad.py", "--help"],
    { cwd: import.meta.dirname + "/.." }
  );

  assert.match(stdout, /Silero VAD v6\.2/u);
  assert.match(stdout, /--cache-dir/u);
  assert.match(stdout, /--out/u);
});
