import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createSourceFingerprint
} from "../src/eval/source-fingerprint.mjs";

test("fingerprint é determinístico e muda com o conteúdo", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "duplex-fingerprint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "source.mjs");
  await writeFile(path, "export const value = 1;\n");

  const first = await createSourceFingerprint(root, {
    roots: ["source.mjs"]
  });
  const second = await createSourceFingerprint(root, {
    roots: ["source.mjs"]
  });
  assert.deepEqual(first, second);

  await writeFile(path, "export const value = 2;\n");
  const changed = await createSourceFingerprint(root, {
    roots: ["source.mjs"]
  });
  assert.notEqual(changed.sha256, first.sha256);
});
