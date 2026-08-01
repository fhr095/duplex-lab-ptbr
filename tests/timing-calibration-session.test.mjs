import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateTimingCalibration,
  createBlindCalibrationSession,
  finalizeTimingCalibrationPack,
  selectFitEligibleTimingLabels,
  validateTimingCalibrationRecord,
  validateTimingCalibrationSubmission
} from "../src/eval/calibration/blind-session.mjs";

const ACTIONS = [
  "WAIT_FOR_EVIDENCE",
  "PAUSE_OUTPUT",
  "CONTINUE_OUTPUT"
];

function packFixture() {
  const artifact = (sceneId, action) => ({
    path: `eval/generated/${sceneId}-${action}.wav`,
    sha256: `sha256:${"a".repeat(63)}${ACTIONS.indexOf(action)}`,
    durationMs: 1_000,
    channels: 2
  });
  return finalizeTimingCalibrationPack({
    schemaVersion: "timing-calibration-pack-v1",
    packId: "timing-pack-test-v1",
    locale: "pt-BR",
    actions: ACTIONS,
    protocol: {
      minimumCompletedPlaybacksPerOption: 1,
      allowedReasonTags: ["cortou-cedo", "ignorou-fala", "dificil"],
      minimumParticipants: 3,
      minimumVotesPerScene: 3,
      minimumConsensusShare: 2 / 3,
      minimumLabelCoverage: 1,
      minimumAttentionPassRate: 0.8,
      unitOfAnalysis: "participant",
      identityPolicy:
        "pseudonymous-local-token-hashed-before-persistence"
    },
    scenes: [
      {
        sceneId: "scene-clear",
        family: "clear-speech",
        fitEligibility: "development-synthetic",
        artifacts: Object.fromEntries(
          ACTIONS.map((action) => [action, artifact("clear", action)])
        ),
        attentionControl: null
      },
      {
        sceneId: "scene-silence",
        family: "silence-control",
        fitEligibility: "control-only",
        artifacts: Object.fromEntries(
          ACTIONS.map((action) => [action, artifact("silence", action)])
        ),
        attentionControl: { expectedActions: ["CONTINUE_OUTPUT"] }
      }
    ],
    retention: {
      audioInGit: false,
      annotationsContainRawAudio: false
    }
  });
}

function completedSubmission(session, selections = {}) {
  return {
    schemaVersion: "timing-calibration-submission-v1",
    sessionId: session.publicSession.sessionId,
    packSha256: session.publicSession.packSha256,
    responses: session.publicSession.scenes.map((scene) => {
      const assignment = session.internalSession.assignments
        .find((entry) => entry.publicSceneId === scene.sceneId);
      const selectedAction = selections[assignment.sceneId] ??
        (assignment.sceneId === "scene-silence"
          ? "CONTINUE_OUTPUT"
          : "WAIT_FOR_EVIDENCE");
      const selected = assignment.options.find(
        (option) => option.action === selectedAction
      );
      return {
        sceneId: scene.sceneId,
        selectedOptionId: selected.optionId,
        uncertain: false,
        confidence: 4,
        reasonTags: [],
        playbacks: scene.options.map((option) => ({
          optionId: option.optionId,
          completed: 1
        }))
      };
    })
  };
}

test("sessão cega randomiza deterministicamente sem expor a ação", () => {
  const pack = packFixture();
  const first = createBlindCalibrationSession(pack, {
    sessionId: "session-0001",
    participantToken: "participant-local-1"
  });
  const repeated = createBlindCalibrationSession(pack, {
    sessionId: "session-0001",
    participantToken: "participant-local-1"
  });

  assert.deepEqual(first, repeated);
  assert.equal(first.publicSession.scenes.length, 2);
  assert.equal(first.publicSession.scenes[0].options.length, 3);
  assert.equal(
    JSON.stringify(first.publicSession).includes("PAUSE_OUTPUT"),
    false
  );
  assert.match(first.internalSession.participantHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    first.internalSession.participantHash.includes("participant-local-1"),
    false
  );
});

test("submissão exige ouvir todas as opções e materializa proveniência humana", () => {
  const pack = packFixture();
  const session = createBlindCalibrationSession(pack, {
    sessionId: "session-0002",
    participantToken: "participant-local-2"
  });
  const submission = completedSubmission(session);
  const validation = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    submission
  );

  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(validation.record.responses[0].selectedAction,
    "WAIT_FOR_EVIDENCE");
  assert.equal(validation.record.attention.passed, 1);
  assert.equal(validation.record.source.kind, "human-annotation");
  assert.equal("participantToken" in validation.record, false);

  const incomplete = structuredClone(submission);
  incomplete.responses[0].playbacks.pop();
  const rejected = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    incomplete
  );
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((error) => /ouvida/u.test(error)));
});

test("agregado conta participantes, atenção, consenso e ambiguidade", () => {
  const pack = packFixture();
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    const session = createBlindCalibrationSession(pack, {
      sessionId: `session-aggregate-${index}`,
      participantToken: `participant-${index}`
    });
    const validation = validateTimingCalibrationSubmission(
      pack,
      session.internalSession,
      completedSubmission(session, {
        "scene-clear": index === 2
          ? "PAUSE_OUTPUT"
          : "WAIT_FOR_EVIDENCE"
      })
    );
    assert.equal(validation.valid, true);
    records.push(validation.record);
  }

  const aggregate = aggregateTimingCalibration(pack, records, {
    minimumParticipants: 3,
    minimumVotesPerScene: 3,
    minimumConsensusShare: 2 / 3,
    minimumLabelCoverage: 1,
    minimumAttentionPassRate: 0.8
  });
  assert.equal(aggregate.calibrationReady, true);
  assert.equal(aggregate.readyToFreezeM4bExperiment, true);
  assert.equal(aggregate.readyForDirectModelFit, false);
  assert.equal(selectFitEligibleTimingLabels(aggregate).length, 0);
  assert.equal(aggregate.labels.length, 1);
  assert.equal(aggregate.labels[0].value, "WAIT_FOR_EVIDENCE");
  assert.equal(aggregate.metrics.participants, 3);
  assert.equal(aggregate.metrics.attentionPassRate, 1);

  const duplicate = aggregateTimingCalibration(
    pack,
    [...records, structuredClone(records[0])],
    { minimumParticipants: 3 }
  );
  assert.equal(duplicate.calibrationReady, false);
  assert.equal(duplicate.gates.uniqueParticipants, false);
});

test("registro persistido é validado e adulteração falha fechado", () => {
  const pack = packFixture();
  const session = createBlindCalibrationSession(pack, {
    sessionId: "session-integrity-1",
    participantToken: "participant-integrity-1"
  });
  const validation = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    completedSubmission(session)
  );
  assert.equal(validateTimingCalibrationRecord(
    pack,
    validation.record
  ).valid, true);

  const tampered = structuredClone(validation.record);
  tampered.responses[0].confidence = 1;
  const recordValidation = validateTimingCalibrationRecord(pack, tampered);
  assert.equal(recordValidation.valid, false);
  assert.ok(recordValidation.errors.includes(
    "annotationId divergente do conteúdo"
  ));

  const aggregate = aggregateTimingCalibration(pack, [tampered]);
  assert.equal(aggregate.calibrationReady, false);
  assert.equal(aggregate.gates.recordsValid, false);
  assert.equal(aggregate.metrics.invalidRecords, 1);

  const unknownScene = structuredClone(validation.record);
  unknownScene.responses[0].sceneId = "scene-forged";
  const unknownValidation = validateTimingCalibrationRecord(
    pack,
    unknownScene
  );
  assert.equal(unknownValidation.valid, false);
  assert.match(unknownValidation.errors.join(" | "), /desconhecida|ausente/u);
});
