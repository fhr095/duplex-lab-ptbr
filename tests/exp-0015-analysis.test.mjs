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
    "../eval/calibration/exp-0015-timing-pack-v0.1.json",
    import.meta.url
  ),
  "utf8"
));

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
      annotationSubmitted: false
    },
    observations: {
      sessionReady: { packSha256: candidatePack.packSha256 },
      exposedTokens: [],
      lockedBeforeListening: true,
      afterListening: { completedOptions: 3 },
      unlockedAfterListening: true,
      readyToAdvance: { sceneReady: true },
      browserErrors: []
    }
  };
}

test("instrumento promove sem fingir calibração humana", () => {
  const aggregate = aggregateTimingCalibration(pack, [], pack.protocol);
  const report = evaluateExp0015Instrument({
    aggregate,
    browser: browserFixture(),
    pack,
    fingerprints: { source: { sha256: "fixture" } }
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
  assert.equal(report.metrics.participants, 0);
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
    unsafePack.protocol
  );
  const report = evaluateExp0015Instrument({
    aggregate,
    browser: browserFixture(unsafePack),
    pack: unsafePack,
    fingerprints: {}
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
    misalignedPack.protocol
  );
  const report = evaluateExp0015Instrument({
    aggregate,
    browser: browserFixture(misalignedPack),
    pack: misalignedPack,
    fingerprints: {}
  });

  assert.equal(report.instrumentPass, false);
  assert.equal(report.gates.audioInventory, false);
});
