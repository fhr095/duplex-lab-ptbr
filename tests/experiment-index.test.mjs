import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readExperimentIndex,
  validateExperimentIndex
} from "../src/eval/experiment-index.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(projectRoot, "eval/EXPERIMENT_INDEX.json");

async function fixture() {
  return JSON.parse(await readFile(indexPath, "utf8"));
}

test("índice canônico real referencia evidências existentes", async () => {
  const index = await readExperimentIndex(indexPath);
  assert.equal(index.currentCriticalPath, "EXP-0018");
  assert.equal(index.currentParallelProbe.id, "EXP-0018-R");
  assert.equal(index.currentParallelProbe.blocking, false);
  assert.equal(
    index.entries.at(-1).canonicalReport,
    null
  );
  assert.equal(index.entries.at(-1).authority, "none");
  assert.equal(
    index.entries.at(-1).decision,
    "materialize-context-observability-instrumentation-before-fit"
  );
  assert.deepEqual(index.entries.at(-1).cleanCloneChecks, [
    "node --test tests/exp-0018-context-factory.test.mjs",
    "npm run eval:exp:0018:data:check"
  ]);
  assert.equal(
    index.entries.find(({ id }) => id === "EXP-0017").canonicalReport,
    "eval/reports/exp-0017-summary-v0.1.json"
  );
});

test("rejeita IDs duplicados", async () => {
  const index = await fixture();
  index.entries[1].id = index.entries[0].id;
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /experiment IDs must be unique/u
  );
});

test("rejeita arquivo canônico ausente", async () => {
  const index = await fixture();
  index.entries[0].canonicalReport = "eval/reports/does-not-exist.json";
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /canonicalReport does not exist/u
  );
});

test("rejeita status e autoridade fora do contrato", async () => {
  const invalidStatus = await fixture();
  invalidStatus.entries[0].status = "maybe";
  await assert.rejects(
    validateExperimentIndex(invalidStatus, { projectRoot }),
    /status is invalid/u
  );

  const invalidAuthority = await fixture();
  invalidAuthority.entries[0].authority = "full-control";
  await assert.rejects(
    validateExperimentIndex(invalidAuthority, { projectRoot }),
    /authority is invalid/u
  );
});

test("rejeita mais de um caminho crítico", async () => {
  const index = await fixture();
  index.entries[0].criticalPath = true;
  await assert.rejects(
    validateExperimentIndex(index, { projectRoot }),
    /exactly one critical path is required; found 2/u
  );
});

test("rejeita lacuna na sequência canônica e cobertura legada parcial", async () => {
  const missingEntry = await fixture();
  missingEntry.entries.splice(3, 1);
  await assert.rejects(
    validateExperimentIndex(missingEntry, { projectRoot }),
    /entries must cover the canonical decision range exactly/u
  );

  const partialLegacy = await fixture();
  partialLegacy.coverage.legacyRange = "anything";
  partialLegacy.coverage.legacyExperimentDocs =
    partialLegacy.coverage.legacyExperimentDocs.slice(0, 1);
  await assert.rejects(
    validateExperimentIndex(partialLegacy, { projectRoot }),
    /legacyRange must be an inclusive experiment range/u
  );
});

test("rejeita probe paralelo que bloqueie ou receba autoridade", async () => {
  const blocking = await fixture();
  blocking.currentParallelProbe.blocking = true;
  await assert.rejects(
    validateExperimentIndex(blocking, { projectRoot }),
    /currentParallelProbe must be non-blocking/u
  );

  const authoritative = await fixture();
  authoritative.currentParallelProbe.authority = "shadow-only";
  await assert.rejects(
    validateExperimentIndex(authoritative, { projectRoot }),
    /currentParallelProbe must have zero authority/u
  );

  const unrelated = await fixture();
  unrelated.currentParallelProbe.id = "EXP-9999-R";
  await assert.rejects(
    validateExperimentIndex(unrelated, { projectRoot }),
    /must be the R track of currentCriticalPath/u
  );
});

test("rejeita autoridade sem relatório e drift contra decisão canônica", async () => {
  const activeAuthority = await fixture();
  activeAuthority.entries.at(-1).authority = "runtime-control";
  await assert.rejects(
    validateExperimentIndex(activeAuthority, { projectRoot }),
    /cannot have authority before a canonical report/u
  );

  const cutAuthority = await fixture();
  cutAuthority.entries.find(({ id }) => id === "EXP-0017").authority =
    "runtime-control";
  await assert.rejects(
    validateExperimentIndex(cutAuthority, { projectRoot }),
    /authority contradicts its canonical report contract/u
  );

  const promotedAuthority = await fixture();
  promotedAuthority.entries.find(({ id }) => id === "EXP-0016").authority =
    "runtime-control";
  await assert.rejects(
    validateExperimentIndex(promotedAuthority, { projectRoot }),
    /authority contradicts its canonical report contract/u
  );

  const inventedDecision = await fixture();
  inventedDecision.entries.find(({ id }) => id === "EXP-0016").decision =
    "promote-to-production";
  await assert.rejects(
    validateExperimentIndex(inventedDecision, { projectRoot }),
    /decision contradicts its canonical report/u
  );
});
