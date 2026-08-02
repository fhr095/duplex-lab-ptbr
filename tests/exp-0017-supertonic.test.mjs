import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateExp0017SupertonicPlan
} from "../src/eval/exp-0017-supertonic.mjs";

const PLAN_URL = new URL(
  "../eval/experiments/exp-0017-supertonic-scenes.pt-BR.json",
  import.meta.url
);

async function planFixture() {
  return JSON.parse(await readFile(PLAN_URL, "utf8"));
}

test("plano Supertonic fecha 60 cenas sem tocar holdout", async () => {
  const plan = await planFixture();
  const validation = validateExp0017SupertonicPlan(plan);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(plan.scenes.train.length, 30);
  assert.equal(plan.scenes.development.length, 30);
  assert.equal(plan.scope.holdoutObserved, false);
  assert.equal(plan.scope.paidApiCalls, 0);
});

test("plano rejeita voz e template atravessando splits", async () => {
  const voiceLeak = await planFixture();
  voiceLeak.scenes.development[0].voiceStyle = "F1";
  let result = validateExp0017SupertonicPlan(voiceLeak);
  assert.match(result.errors.join("; "), /vozes|cena Supertonic/iu);

  const templateLeak = await planFixture();
  templateLeak.scenes.development[0].templateGroupId =
    templateLeak.scenes.train[0].templateGroupId;
  result = validateExp0017SupertonicPlan(templateLeak);
  assert.match(result.errors.join("; "), /templateGroupId/iu);
});

test("plano rejeita classe confundida com voz e claims de execução", async () => {
  const confounded = await planFixture();
  for (const scene of confounded.scenes.train.filter(
    (item) => item.label === "DIRECTED_TO_ASSISTANT"
  )) {
    scene.voiceStyle = "F1";
  }
  let result = validateExp0017SupertonicPlan(confounded);
  assert.match(result.errors.join("; "), /voz/iu);

  const opened = await planFixture();
  opened.scope.holdoutObserved = true;
  result = validateExp0017SupertonicPlan(opened);
  assert.match(result.errors.join("; "), /contrato principal/iu);
});
