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
