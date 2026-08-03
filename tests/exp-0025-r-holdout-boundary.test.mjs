import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateExp0025RFloorPack
} from "../src/eval/exp-0025-r-floor-control.mjs";
import {
  assertExp0025RHoldoutBoundary,
  buildExp0025RHoldoutPack
} from "../scripts/build-exp-0025-r-holdout-pack.mjs";
import {
  EXP0025_R_LOCAL_FREEZE_PATH,
  validateExp0025RLocalFreeze
} from "../scripts/freeze-exp-0025-r-local-candidate.mjs";

test("H nasce depois do freeze de L, com 24 pares e oito sessões", async () => {
  const freeze = JSON.parse(await readFile(EXP0025_R_LOCAL_FREEZE_PATH, "utf8"));
  const pack = buildExp0025RHoldoutPack();
  const boundary = await assertExp0025RHoldoutBoundary(pack);

  assert.equal(validateExp0025RLocalFreeze(freeze), true);
  assert.equal(freeze.holdout.status, "NOT_GENERATED_NOT_OPENED");
  assert.equal(validateExp0025RFloorPack(pack).valid, true);
  assert.equal(pack.split, "holdout");
  assert.equal(pack.pairs, 24);
  assert.equal(pack.utterances.length, 48);
  assert.equal(pack.sessions, 8);
  assert.deepEqual(pack.families, {
    "correction-restart": 6,
    "hesitation-filler": 6,
    "lexically-ambiguous-close": 6,
    "syntactic-continuation": 6
  });
  assert.equal(boundary.localFreezeSha256, freeze.freezeSha256);
  assert.equal(boundary.disjointSurfaces, true);
  assert.equal(boundary.pairsPerSession, 3);
});

test("cada família de H recebe a mesma distribuição prospectiva de pausas", () => {
  const pack = buildExp0025RHoldoutPack();
  for (const family of Object.keys(pack.families)) {
    const pairs = new Map(pack.utterances.filter((item) =>
      item.family === family).map((item) => [item.pairId, item.pauseMs]));
    assert.deepEqual(
      [...pairs.values()].toSorted((left, right) => left - right),
      [480, 560, 600, 720, 900, 1_140]
    );
  }
});

test("H preserva prefixo e trace causal idênticos dentro de cada par", () => {
  const pack = buildExp0025RHoldoutPack();
  for (const pairId of new Set(pack.utterances.map((item) => item.pairId))) {
    const pair = pack.utterances.filter((item) => item.pairId === pairId);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].prefix, pair[1].prefix);
    assert.equal(pair[0].criticalBoundaryAtMs, pair[1].criticalBoundaryAtMs);
    assert.equal(pair[0].pauseMs, pair[1].pauseMs);
    assert.deepEqual(pair[0].microturns, pair[1].microturns);
  }
});
