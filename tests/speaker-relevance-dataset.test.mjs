import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  finalizeSpeakerRelevanceDataset,
  validateSpeakerRelevanceDataset
} from "../src/eval/speaker-relevance-dataset.mjs";

const dataset = JSON.parse(await readFile(new URL(
  "../eval/datasets/exp-0016-speaker-relevance-v0.1.json",
  import.meta.url
)));

test("dataset EXP-0016 mantém causalidade, proveniência e splits", () => {
  const validation = validateSpeakerRelevanceDataset(dataset);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(dataset.examples.length, 108);
  assert.equal(dataset.source.selectedClips, 36);
  assert.equal(dataset.calibration.fitExamples, 0);
  assert.equal(dataset.calibration.usedForFit, false);
  assert.deepEqual(
    new Set(Object.values(validation.familyOwners)),
    new Set(["train", "development", "holdout"])
  );
});

test("validador rejeita vazamento de clip, futuro e fonte sem licença", () => {
  const leaked = structuredClone(dataset);
  const train = leaked.examples.find((item) => item.split === "train");
  leaked.examples.find((item) => item.split === "holdout").sourceFileName =
    train.sourceFileName;
  assert.match(
    validateSpeakerRelevanceDataset(
      finalizeSpeakerRelevanceDataset(leaked)
    ).errors.join("; "),
    /múltiplos splits/iu
  );

  const future = structuredClone(dataset);
  future.examples[0].causalWindow.futureSamplesUsed = 1;
  assert.equal(
    validateSpeakerRelevanceDataset(
      finalizeSpeakerRelevanceDataset(future)
    ).valid,
    false
  );

  const license = structuredClone(dataset);
  license.source.license = "desconhecida";
  assert.equal(
    validateSpeakerRelevanceDataset(
      finalizeSpeakerRelevanceDataset(license)
    ).valid,
    false
  );
});
