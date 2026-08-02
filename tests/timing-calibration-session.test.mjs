import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateTimingCalibration,
  createBlindCalibrationSession,
  finalizeTimingCalibrationPack,
  selectFitEligibleTimingLabels,
  validateTimingCalibrationRecord,
  validateTimingCalibrationResolutionRubric,
  validateTimingCalibrationScoringRubric,
  validateTimingCalibrationSubmission
} from "../src/eval/calibration/blind-session.mjs";

const ACTIONS = [
  "WAIT_FOR_EVIDENCE",
  "PAUSE_OUTPUT",
  "CONTINUE_OUTPUT"
];

function packFixture() {
  const artifact = (sceneId, action, suffix) => ({
    path: `eval/generated/${sceneId}-${action}.wav`,
    sha256: `sha256:${"a".repeat(63)}${suffix}`,
    durationMs: 1_000,
    channels: 2
  });
  return finalizeTimingCalibrationPack({
    schemaVersion: "timing-calibration-pack-v2",
    packId: "timing-pack-test-v2",
    locale: "pt-BR",
    actions: ACTIONS,
    protocol: {
      version: "blind-timing-preference-and-attribution-v2",
      minimumCompletedPlaybacksPerOption: 1,
      maximumCommentCharacters: 280,
      allowedReasonTags: [
        "cortou-cedo",
        "ignorou-fala",
        "dificil",
        "opcoes-pareciam-iguais"
      ],
      minimumExternalParticipants: 3,
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
        artifacts: {
          WAIT_FOR_EVIDENCE: artifact("clear", "wait", "0"),
          PAUSE_OUTPUT: artifact("clear", "pause", "1"),
          CONTINUE_OUTPUT: artifact("clear", "continue", "2")
        },
        attentionControl: null
      },
      {
        sceneId: "scene-silence",
        family: "silence-control",
        fitEligibility: "control-only",
        artifacts: {
          WAIT_FOR_EVIDENCE: artifact("silence", "wait", "3"),
          PAUSE_OUTPUT: artifact("silence", "pause", "4"),
          CONTINUE_OUTPUT: artifact("silence", "continue", "3")
        },
        attentionControl: {
          expectedActions: ["WAIT_FOR_EVIDENCE", "CONTINUE_OUTPUT"],
          expectedSpeakerRelevance: "BACKGROUND_OR_NOT_DIRECTED"
        }
      }
    ],
    retention: {
      audioInGit: false,
      annotationsContainRawAudio: false,
      annotationsMayContainOptionalComment: true
    }
  });
}

function resolutionRubricFixture(pack) {
  return {
    schemaVersion:
      "timing-calibration-preference-resolution-rubric-v1",
    rubricId: "timing-pack-test-preference-resolution-v0.2.2",
    packId: pack.packId,
    packSha256: pack.packSha256,
    baseProtocolVersion: pack.protocol.version,
    policy: "additive-set-valued-resolution-only",
    thresholds: {
      minimumVotesPerResolution: pack.protocol.minimumVotesPerScene,
      minimumConsensusShare: pack.protocol.minimumConsensusShare,
      minimumResolutionCoverage: pack.protocol.minimumLabelCoverage
    },
    safeguards: {
      singularLabelsRemainUnchanged: true,
      setValuedResolutionsCreateSingularLabels: false,
      setValuedResolutionsEligibleForDirectFit: false,
      uncertainResponsesCountAsPreferenceVotes: false,
      rawRecordsMutated: false,
      stimuliOrQuestionsChanged: false
    },
    rationale:
      "Conjuntos de preferência consensuais resolvem a calibração sem " +
      "inventar um rótulo singular ou autorizar ajuste direto de pesos."
  };
}

function completedSubmission(session, input = {}) {
  return {
    schemaVersion: "timing-calibration-submission-v2",
    sessionId: session.publicSession.sessionId,
    packSha256: session.publicSession.packSha256,
    responses: session.publicSession.scenes.map((scene) => {
      const assignment = session.internalSession.assignments
        .find((entry) => entry.publicSceneId === scene.sceneId);
      const desiredActions = input.selections?.[assignment.sceneId] ??
        (assignment.sceneId === "scene-silence"
          ? ["CONTINUE_OUTPUT"]
          : ["WAIT_FOR_EVIDENCE"]);
      const selectedOptions = assignment.options.filter((option) =>
        desiredActions.some((action) => option.actions.includes(action))
      );
      return {
        sceneId: scene.sceneId,
        selectedOptionIds: selectedOptions.map((option) => option.optionId),
        uncertain: false,
        speakerRelevance: input.relevance?.[assignment.sceneId] ??
          (assignment.sceneId === "scene-silence"
            ? "BACKGROUND_OR_NOT_DIRECTED"
            : "DIRECTED_TO_ASSISTANT"),
        confidence: 4,
        reasonTags: input.reasonTags ?? [],
        comment: input.comments?.[assignment.sceneId] ?? null,
        playbacks: scene.options.map((option) => ({
          optionId: option.optionId,
          completed: 1
        }))
      };
    })
  };
}

function completedRecord(pack, index, input = {}) {
  const session = createBlindCalibrationSession(pack, {
    sessionId: `session-record-${index}`,
    participantToken: `participant-${index}`,
    participantRole: input.participantRole ?? "external"
  });
  const validation = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    completedSubmission(session, input)
  );
  assert.equal(validation.valid, true, validation.errors.join("; "));
  return validation.record;
}

function scoringRubricFixture(pack) {
  return {
    schemaVersion: "timing-calibration-scoring-rubric-v1",
    rubricId: "timing-pack-test-scoring-v0.2.1",
    packId: pack.packId,
    packSha256: pack.packSha256,
    baseProtocolVersion: pack.protocol.version,
    policy: "additive-acceptance-only",
    amendments: [{
      sceneId: "scene-silence",
      dimension: "speaker-relevance-accepted-values",
      acceptedValues: ["BACKGROUND_OR_NOT_DIRECTED", "UNCERTAIN"],
      rationale:
        "Silêncio admite ausência de evidência sem tornar a fala direcionada."
    }]
  };
}

test("sessão cega agrupa WAVs idênticos sem expor ações", () => {
  const pack = packFixture();
  const first = createBlindCalibrationSession(pack, {
    sessionId: "session-0001",
    participantToken: "participant-local-1",
    participantRole: "external"
  });
  const repeated = createBlindCalibrationSession(pack, {
    sessionId: "session-0001",
    participantToken: "participant-local-1",
    participantRole: "external"
  });

  assert.deepEqual(first, repeated);
  assert.equal(first.publicSession.scenes.length, 2);
  assert.deepEqual(
    first.publicSession.scenes.map((scene) => scene.options.length).sort(),
    [2, 3]
  );
  assert.equal(
    JSON.stringify(first.publicSession).includes("PAUSE_OUTPUT"),
    false
  );
  assert.match(first.internalSession.participantHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.internalSession.participantRole, "external");
  assert.equal(
    first.internalSession.participantHash.includes("participant-local-1"),
    false
  );
  const equivalent = first.internalSession.assignments.find(
    (assignment) => assignment.sceneId === "scene-silence"
  ).options.find((option) => option.actions.length === 2);
  assert.deepEqual(
    equivalent.actions,
    ["WAIT_FOR_EVIDENCE", "CONTINUE_OUTPUT"]
  );
});

test("submissão preserva equivalência, empate, atribuição e comentário", () => {
  const pack = packFixture();
  const session = createBlindCalibrationSession(pack, {
    sessionId: "session-0002",
    participantToken: "participant-local-2",
    participantRole: "external"
  });
  const submission = completedSubmission(session, {
    comments: {
      "scene-clear": "As duas pausas\nsoaram próximas."
    },
    reasonTags: ["opcoes-pareciam-iguais"]
  });
  const validation = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    submission
  );

  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.deepEqual(
    validation.record.responses.find(
      (response) => response.sceneId === "scene-silence"
    ).selectedActions,
    ["WAIT_FOR_EVIDENCE", "CONTINUE_OUTPUT"]
  );
  assert.equal(validation.record.attention.passed, 1);
  assert.equal(validation.record.source.kind, "human-annotation");
  assert.equal("participantToken" in validation.record, false);
  assert.equal(
    validation.record.responses.find(
      (response) => response.sceneId === "scene-clear"
    ).comment,
    "As duas pausas soaram próximas."
  );

  const tied = completedSubmission(session, {
    selections: {
      "scene-clear": ["WAIT_FOR_EVIDENCE", "PAUSE_OUTPUT"]
    }
  });
  const tiedValidation = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    tied
  );
  assert.equal(tiedValidation.valid, true, tiedValidation.errors.join("; "));
  assert.deepEqual(
    tiedValidation.record.responses.find(
      (response) => response.sceneId === "scene-clear"
    ).selectedActions,
    ["WAIT_FOR_EVIDENCE", "PAUSE_OUTPUT"]
  );

  const incomplete = structuredClone(submission);
  incomplete.responses[0].playbacks.pop();
  const rejected = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    incomplete
  );
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((error) => /ouvida|playbacks/u.test(error)));

  const unsafeComment = structuredClone(submission);
  unsafeComment.responses[0].comment = "controle\u0000invisível";
  const unsafeValidation = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    unsafeComment
  );
  assert.equal(unsafeValidation.valid, false);
  assert.match(unsafeValidation.errors.join(" | "), /comment/u);

  const oversizedComment = structuredClone(submission);
  oversizedComment.responses[0].comment = "a".repeat(281);
  const oversizedValidation = validateTimingCalibrationSubmission(
    pack,
    session.internalSession,
    oversizedComment
  );
  assert.equal(oversizedValidation.valid, false);
  assert.match(oversizedValidation.errors.join(" | "), /comment/u);
});

test("agregado usa apenas externos e só cria rótulo com votos singulares", () => {
  const pack = packFixture();
  const records = [
    completedRecord(pack, 0),
    completedRecord(pack, 1),
    completedRecord(pack, 2, {
      selections: { "scene-clear": ["PAUSE_OUTPUT"] }
    }),
    completedRecord(pack, 3, {
      participantRole: "internal",
      selections: { "scene-clear": ["CONTINUE_OUTPUT"] }
    })
  ];

  const aggregate = aggregateTimingCalibration(pack, records, pack.protocol);
  assert.equal(aggregate.calibrationReady, true);
  assert.equal(aggregate.readyToFreezeM4bExperiment, true);
  assert.equal(aggregate.readyForDirectModelFit, false);
  assert.equal(selectFitEligibleTimingLabels(aggregate).length, 0);
  assert.equal(aggregate.labels.length, 1);
  assert.equal(aggregate.labels[0].value, "WAIT_FOR_EVIDENCE");
  assert.equal(aggregate.metrics.totalParticipants, 4);
  assert.equal(aggregate.metrics.externalParticipants, 3);
  assert.equal(aggregate.metrics.internalParticipants, 1);
  assert.equal(aggregate.metrics.attentionPassRate, 1);
  assert.equal(
    aggregate.speakerRelevance.find(
      (scene) => scene.sceneId === "scene-clear"
    ).counts.DIRECTED_TO_ASSISTANT,
    3
  );

  const tiedRecords = [
    completedRecord(pack, 10, {
      selections: {
        "scene-clear": ["WAIT_FOR_EVIDENCE", "PAUSE_OUTPUT"]
      }
    }),
    completedRecord(pack, 11),
    completedRecord(pack, 12)
  ];
  const tiedAggregate = aggregateTimingCalibration(
    pack,
    tiedRecords,
    pack.protocol
  );
  const clear = tiedAggregate.scenes.find(
    (scene) => scene.sceneId === "scene-clear"
  );
  assert.equal(clear.validSingleActionVotes, 2);
  assert.equal(clear.tiedOrEquivalentPreferences, 1);
  assert.equal(clear.labelled, false);
  assert.equal(tiedAggregate.calibrationReady, false);

  const internalOnly = aggregateTimingCalibration(
    pack,
    [completedRecord(pack, 20, { participantRole: "internal" })],
    pack.protocol
  );
  assert.equal(internalOnly.gates.minimumExternalParticipants, false);
  assert.equal(internalOnly.metrics.externalParticipants, 0);
});

test("resolução consensual preserva equivalência sem criar rótulo singular", () => {
  const pack = packFixture();
  const records = [40, 41, 42].map((index) =>
    completedRecord(pack, index, {
      selections: {
        "scene-clear": ["WAIT_FOR_EVIDENCE", "PAUSE_OUTPUT"]
      }
    })
  );
  const rubric = resolutionRubricFixture(pack);
  assert.equal(
    validateTimingCalibrationResolutionRubric(pack, rubric).valid,
    true
  );

  const base = aggregateTimingCalibration(pack, records, pack.protocol);
  const amended = aggregateTimingCalibration(pack, records, {
    ...pack.protocol,
    preferenceResolutionRubric: rubric
  });
  assert.equal(base.calibrationReady, false);
  assert.equal(base.metrics.labelCoverage, 0);
  assert.equal(amended.calibrationReady, true);
  assert.equal(amended.readyToFreezeM4bExperiment, true);
  assert.equal(amended.readyForDirectModelFit, false);
  assert.equal(amended.labels.length, 0);
  assert.equal(amended.resolutions.length, 1);
  assert.deepEqual(amended.resolutions[0].acceptableActions, [
    "WAIT_FOR_EVIDENCE",
    "PAUSE_OUTPUT"
  ]);
  assert.equal(
    amended.resolutions[0].resolutionKind,
    "set-valued-preference"
  );
  assert.equal(amended.metrics.resolutionCoverage, 1);
  assert.equal(amended.metrics.setValuedResolvedScenes, 1);
  assert.equal(
    amended.scoring.preferenceResolution.singularBase.pass,
    false
  );
  assert.equal(amended.scoring.preferenceResolution.active.pass, true);

  const unsafe = structuredClone(rubric);
  unsafe.safeguards.setValuedResolutionsEligibleForDirectFit = true;
  assert.equal(
    validateTimingCalibrationResolutionRubric(pack, unsafe).valid,
    false
  );
  const failedClosed = aggregateTimingCalibration(pack, records, {
    ...pack.protocol,
    preferenceResolutionRubric: unsafe
  });
  assert.equal(failedClosed.calibrationReady, false);
  assert.equal(failedClosed.gates.preferenceResolutionRubric, false);
});

test("emenda aditiva reclassifica silêncio sem alterar registro bruto", () => {
  const pack = packFixture();
  const uncertainRecord = completedRecord(pack, 25, {
    relevance: { "scene-silence": "UNCERTAIN" }
  });
  const directedRecord = completedRecord(pack, 26, {
    relevance: { "scene-silence": "DIRECTED_TO_ASSISTANT" }
  });
  const rubric = scoringRubricFixture(pack);

  assert.equal(
    validateTimingCalibrationScoringRubric(pack, rubric).valid,
    true
  );
  assert.equal(uncertainRecord.attention.passed, 0);
  assert.equal(
    validateTimingCalibrationRecord(pack, uncertainRecord).valid,
    true
  );

  const base = aggregateTimingCalibration(
    pack,
    [uncertainRecord],
    pack.protocol
  );
  const amended = aggregateTimingCalibration(
    pack,
    [uncertainRecord],
    { ...pack.protocol, attentionScoringRubric: rubric }
  );
  assert.equal(base.metrics.attentionPassRate, 0);
  assert.equal(amended.metrics.baseAttentionPassRate, 0);
  assert.equal(amended.metrics.attentionPassRate, 1);
  assert.equal(amended.metrics.attentionPassedDelta, 1);
  assert.equal(
    amended.scoring.attention.rubricId,
    "timing-pack-test-scoring-v0.2.1"
  );
  assert.equal(uncertainRecord.attention.passed, 0);

  const directed = aggregateTimingCalibration(
    pack,
    [directedRecord],
    { ...pack.protocol, attentionScoringRubric: rubric }
  );
  assert.equal(directed.metrics.attentionPassRate, 0);

  const unsafeRubric = structuredClone(rubric);
  unsafeRubric.amendments[0].acceptedValues.push("DIRECTED_TO_ASSISTANT");
  const unsafeValidation = validateTimingCalibrationScoringRubric(
    pack,
    unsafeRubric
  );
  assert.equal(unsafeValidation.valid, false);
  const failedClosed = aggregateTimingCalibration(
    pack,
    [uncertainRecord],
    { ...pack.protocol, attentionScoringRubric: unsafeRubric }
  );
  assert.equal(failedClosed.gates.attentionScoringRubric, false);
  assert.equal(failedClosed.calibrationReady, false);
});

test("registro persistido é validado e adulteração falha fechado", () => {
  const pack = packFixture();
  const record = completedRecord(pack, 30);
  assert.equal(validateTimingCalibrationRecord(pack, record).valid, true);

  const tampered = structuredClone(record);
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

  const structurallyMalformed = structuredClone(record);
  structurallyMalformed.responses[0].selectedOptionActionSets = [null];
  structurallyMalformed.responses[0].playbacks = {};
  const malformedValidation = validateTimingCalibrationRecord(
    pack,
    structurallyMalformed
  );
  assert.equal(malformedValidation.valid, false);
  assert.match(
    malformedValidation.errors.join(" | "),
    /conjuntos selecionados|playbacks persistidos/u
  );

  const duplicate = aggregateTimingCalibration(pack, [record, record], {
    ...pack.protocol,
    minimumExternalParticipants: 1
  });
  assert.equal(duplicate.calibrationReady, false);
  assert.equal(duplicate.gates.uniqueParticipants, false);

  const unknownScene = structuredClone(record);
  unknownScene.responses[0].sceneId = "scene-forged";
  const unknownValidation = validateTimingCalibrationRecord(
    pack,
    unknownScene
  );
  assert.equal(unknownValidation.valid, false);
  assert.match(unknownValidation.errors.join(" | "), /desconhecida|ausente/u);
});
