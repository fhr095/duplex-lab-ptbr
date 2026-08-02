import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateTimingCalibration,
  finalizeTimingCalibrationPack
} from "../src/eval/calibration/blind-session.mjs";
import {
  evaluateExp0015Instrument
} from "../scripts/lib/exp-0015-analysis.mjs";

const pack = JSON.parse(await readFile(
  new URL(
    "../eval/calibration/exp-0015-timing-pack-v0.2.json",
    import.meta.url
  ),
  "utf8"
));
const rubric = JSON.parse(await readFile(
  new URL(
    "../eval/calibration/exp-0015-scoring-rubric-v0.2.1.json",
    import.meta.url
  ),
  "utf8"
));

function fingerprintsFixture() {
  return {
    source: { sha256: "fixture" },
    rubric: { path: "fixture-rubric.json", sha256: "sha256:fixture" }
  };
}

function browserFixture(candidatePack = pack) {
  return {
    pass: true,
    health: {
      packId: candidatePack.packId,
      packSha256: candidatePack.packSha256,
      paidApiCalls: 0
    },
    browser: { product: { product: "Chrome/test" } },
    protocol: {
      realWindowsChrome: true,
      tieSelectionExercised: true,
      annotationSubmitted: false
    },
    observations: {
      sessionReady: {
        packSha256: candidatePack.packSha256,
        sessionOptionCounts: [2, 3]
      },
      exposedTokens: [],
      lockedBeforeListening: true,
      afterListening: { completedOptions: 2, optionCount: 2 },
      unlockedAfterListening: true,
      readyToAdvance: {
        sceneReady: true,
        selectedOptionCount: 2,
        speakerRelevanceAnswered: true
      },
      browserErrors: []
    }
  };
}

test("instrumento promove sem fingir calibração humana", () => {
  const aggregate = aggregateTimingCalibration(pack, [], {
    ...pack.protocol,
    attentionScoringRubric: rubric
  });
  const report = evaluateExp0015Instrument({
    aggregate,
    browser: browserFixture(),
    pack,
    rubric,
    fingerprints: fingerprintsFixture()
  });

  assert.equal(report.instrumentPass, true);
  assert.equal(report.humanCalibrationPass, false);
  assert.equal(report.campaignComplete, false);
  assert.equal(
    report.decisions.instrument,
    "promote-timing-calibration-instrument"
  );
  assert.equal(
    report.decisions.humanCalibration,
    "await-human-calibration"
  );
  assert.equal(report.metrics.externalParticipants, 0);
  assert.equal(report.metrics.fitEligibleLabels, 0);
  assert.ok(report.aggregate.scenes.every((scene) => scene.winner === null));
});

test("instrumento falha se áudio público se declarar elegível a fit", () => {
  const core = structuredClone(pack);
  delete core.packSha256;
  core.scenes[0].fitEligibility = "fit-eligible";
  const unsafePack = finalizeTimingCalibrationPack(core);
  const aggregate = aggregateTimingCalibration(
    unsafePack,
    [],
    { ...unsafePack.protocol, attentionScoringRubric: rubric }
  );
  const report = evaluateExp0015Instrument({
    aggregate,
    browser: browserFixture(unsafePack),
    pack: unsafePack,
    rubric,
    fingerprints: fingerprintsFixture()
  });

  assert.equal(report.instrumentPass, false);
  assert.equal(report.gates.sourceBoundary, false);
});

test("instrumento falha se a decisão anteceder evidência acústica", () => {
  const core = structuredClone(pack);
  delete core.packSha256;
  core.scenes[0].decisionEvidence.activeFrames = 0;
  const misalignedPack = finalizeTimingCalibrationPack(core);
  const aggregate = aggregateTimingCalibration(
    misalignedPack,
    [],
    { ...misalignedPack.protocol, attentionScoringRubric: rubric }
  );
  const report = evaluateExp0015Instrument({
    aggregate,
    browser: browserFixture(misalignedPack),
    pack: misalignedPack,
    rubric,
    fingerprints: fingerprintsFixture()
  });

  assert.equal(report.instrumentPass, false);
  assert.equal(report.gates.audioInventory, false);
});

test("instrumento falha fechado se emenda aceitar fala direcionada", () => {
  const unsafeRubric = structuredClone(rubric);
  unsafeRubric.amendments[0].acceptedValues.push(
    "DIRECTED_TO_ASSISTANT"
  );
  const aggregate = aggregateTimingCalibration(pack, [], {
    ...pack.protocol,
    attentionScoringRubric: unsafeRubric
  });
  const report = evaluateExp0015Instrument({
    aggregate,
    browser: browserFixture(),
    pack,
    rubric: unsafeRubric,
    fingerprints: fingerprintsFixture()
  });

  assert.equal(report.instrumentPass, false);
  assert.equal(report.gates.scoringRubricBinding, false);
});
