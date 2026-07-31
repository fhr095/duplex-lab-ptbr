import assert from "node:assert/strict";
import test from "node:test";

import {
  withinWindowCoverage
} from "../src/eval/window-coverage.mjs";

test("cobertura curta tolera duas janelas concorrentes ao snapshot", () => {
  assert.equal(withinWindowCoverage(158, 156), true);
  assert.equal(withinWindowCoverage(159, 156), false);
});

test("cobertura longa mantém tolerância relativa de um por cento", () => {
  assert.equal(withinWindowCoverage(18_939, 18_752), true);
  assert.equal(withinWindowCoverage(18_940, 18_752), false);
  assert.equal(withinWindowCoverage(null, 156), false);
});
