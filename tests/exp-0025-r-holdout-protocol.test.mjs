import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import packageJson from "../package.json" with { type: "json" };
import {
  EXP0025_R_HOLDOUT_OPENING_PATH,
  EXP0025_R_HOLDOUT_RECEIPT_PATH,
  EXP0025_R_HOLDOUT_REPORT_PATH,
  EXP0025_R_HOLDOUT_SEAL_PATH
} from "../scripts/seal-exp-0025-r-holdout.mjs";

test("protocolo H possui seal, abertura, receipt e check separados", () => {
  assert.equal(
    packageJson.scripts["eval:exp:0025:r:holdout:seal"],
    "node scripts/seal-exp-0025-r-holdout.mjs"
  );
  assert.equal(
    packageJson.scripts["eval:exp:0025:r:holdout:open"],
    "node scripts/open-exp-0025-r-holdout.mjs"
  );
  assert.equal(
    packageJson.scripts["eval:exp:0025:r:holdout:run"],
    "node scripts/run-exp-0025-r-local-holdout.mjs"
  );
  assert.match(EXP0025_R_HOLDOUT_SEAL_PATH, /commitments/u);
  assert.match(EXP0025_R_HOLDOUT_OPENING_PATH, /commitments/u);
  assert.match(EXP0025_R_HOLDOUT_RECEIPT_PATH, /generated/u);
  assert.match(EXP0025_R_HOLDOUT_REPORT_PATH, /reports/u);
});

test("runner persiste receipt antes da única chamada candidata", async () => {
  const source = await readFile(
    "scripts/run-exp-0025-r-local-holdout.mjs",
    "utf8"
  );
  const receiptWrite = source.indexOf(
    "resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_RECEIPT_PATH)"
  );
  const officialInference = source.indexOf(
    "const analysis = evaluateExp0025RLocalCandidate(bindings.pack)"
  );
  const reportWrite = source.indexOf(
    "resolve(PROJECT_ROOT, EXP0025_R_HOLDOUT_REPORT_PATH)"
  );
  assert.ok(receiptWrite >= 0);
  assert.ok(officialInference > receiptWrite);
  assert.ok(reportWrite > officialInference);
  assert.equal(
    source.match(/evaluateExp0025RLocalCandidate\(bindings\.pack\)/gu)?.length,
    1
  );
});

test("check do resultado não repete inferência", async () => {
  const source = await readFile(
    "scripts/run-exp-0025-r-local-holdout.mjs",
    "utf8"
  );
  const checkStart = source.indexOf(
    "export async function checkExp0025RLocalHoldout"
  );
  assert.ok(checkStart >= 0);
  assert.doesNotMatch(
    source.slice(checkStart),
    /evaluateExp0025RLocalCandidate/u
  );
});
