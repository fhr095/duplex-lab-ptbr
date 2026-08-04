import assert from "node:assert/strict";
import test from "node:test";

import {
  createExp0026SessionFreeze,
  validateExp0026Roster,
  validateExp0026Station
} from "../src/eval/exp-0026-freeze.mjs";

function roster() {
  const people = [
    ["P01", "18-34", "A", "weekly", "C1"],
    ["P02", "18-34", "A", "weekly", "C1"],
    ["P03", "35+", "B", "rare-never", "C2"],
    ["P04", "35+", "B", "rare-never", "C2"],
    ["P05", "18-34", "C", "monthly", "C3"],
    ["P06", "35+", "C", "monthly", "C3"]
  ].map(([alias, ageBand, accentExposureGroup, voiceUse, socialCluster]) => ({
    alias,
    ageBand,
    accentExposureGroup,
    voiceUse,
    socialCluster
  }));
  return {
    schemaVersion: "exp-0026-private-roster-v2",
    slots: people.map((primary, index) => ({
      slotId: `SLOT-${index + 1}`,
      orderIndex: index,
      primary
    })),
    reserves: [
      {
        alias: "R01", ageBand: "18-34", accentExposureGroup: "A",
        voiceUse: "weekly", socialCluster: "C4",
        allowedSlotIds: ["SLOT-1", "SLOT-2", "SLOT-5", "SLOT-6"]
      },
      {
        alias: "R02", ageBand: "35+", accentExposureGroup: "B",
        voiceUse: "rare-never", socialCluster: "C5",
        allowedSlotIds: ["SLOT-3", "SLOT-4", "SLOT-5", "SLOT-6"]
      }
    ],
    replacementPolicy: {
      maxActivations: 2,
      allowedReasons: [
        "PRE_SESSION_NO_SHOW",
        "PRE_SESSION_SCHEDULING_CONFLICT",
        "PRE_SESSION_TECHNICAL_INELIGIBILITY",
        "CONSENT_WITHDRAWN"
      ],
      startedSessionReplacementRequiresWithdrawal: true
    }
  };
}

function station() {
  const device = (id) => ({
    opaqueId: id,
    model: `${id}-model`,
    volume: 0.5,
    position: `${id}-position`
  });
  return {
    schemaVersion: "exp-0026-private-station-v2",
    stationId: "station-a",
    windowsBuild: "windows-build",
    wslBuild: "wsl-build",
    chromeBuild: "chrome-build",
    roomId: "room-a",
    networkCondition: "wired-stable",
    clockSynchronization: "performance.now + server ISO",
    operationalReadiness: {
      reportFileSha256: `sha256:${"f".repeat(64)}`,
      acousticQualificationSha256: `sha256:${"e".repeat(64)}`
    },
    microphone: {
      ...device("mic-a"),
      sampleRate: 48_000,
      channels: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    output: device("output-a"),
    noiseDevice: device("noise-a"),
    tts: {
      engine: "windows-system-speech",
      voice: "Microsoft Maria Desktop",
      culture: "pt-BR",
      rate: 1,
      format: "pcm-s16le-16khz-mono"
    }
  };
}

test("roster exige diversidade mínima sem identificador civil", () => {
  const valid = validateExp0026Roster(roster());
  assert.equal(valid.valid, true);
  assert.equal(valid.summary.participantCount, 6);
  assert.equal(valid.summary.accentGroupsWithAtLeastTwo, 3);
  assert.equal(valid.summary.reserveAliases.length, 2);
  assert.equal(valid.summary.everyReachableCompositionPreservesDiversity, true);
  const invalid = roster();
  invalid.slots[0].primary.name = "Nome civil proibido";
  invalid.slots.forEach(({ primary: participant }) => {
    participant.ageBand = "18-34";
    participant.socialCluster = "mesmo-circulo";
  });
  const result = validateExp0026Roster(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /identificador civil proibido/iu);
  assert.match(result.errors.join(" "), /diversidade/iu);
});

test("templates e estação divergente falham fechado", () => {
  assert.equal(validateExp0026Roster({
    ...roster(),
    exampleOnly: true
  }).valid, false);
  assert.equal(validateExp0026Station(station()).valid, true);
  const template = station();
  template.exampleOnly = true;
  template.microphone.model = "REPLACE_MIC_MODEL";
  assert.equal(validateExp0026Station(template).valid, false);
});

test("freeze público preserva aliases e gates, não metadados brutos", () => {
  const value = createExp0026SessionFreeze({
    roster: roster(),
    station: station(),
    rosterManifestSha256: `sha256:${"a".repeat(64)}`,
    stationManifestSha256: `sha256:${"b".repeat(64)}`,
    createdAt: "2026-08-03T12:00:00.000Z",
    closesAt: "2026-08-10T12:00:00.000Z",
    sourceCommit: "c".repeat(40),
    runtimeBinding: { sha256: "d".repeat(64) },
    pack: { packId: "pack", fileSha256: `sha256:${"e".repeat(64)}` },
    noise: { kind: "seeded-white-noise", speechPresent: false },
    tts: station().tts,
    qualification: [{ path: "report", pass: true }]
  });
  assert.equal(value.status, "OPEN_FOR_SIX_EXTERNAL_SESSIONS");
  assert.equal(value.schemaVersion, "exp-0026-session-freeze-v2");
  assert.deepEqual(value.roster.participantAliases, [
    "P01", "P02", "P03", "P04", "P05", "P06"
  ]);
  assert.equal(Object.values(value.roster.diversityGate).every(Boolean), true);
  assert.equal(value.roster.rawDiversityMetadataCommitted, false);
  assert.deepEqual(value.roster.reserveAliases, ["R01", "R02"]);
  assert.equal(
    value.roster.replacementPolicy.everyReachableCompositionPreservesDiversity,
    true
  );
  assert.equal(JSON.stringify(value).includes("accentExposureGroup"), false);
  assert.match(value.freezeSha256, /^sha256:[a-f0-9]{64}$/u);
});
