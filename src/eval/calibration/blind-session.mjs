import { createHash } from "node:crypto";

import {
  canonicalSha256
} from "../factory/canonical-hash.mjs";
import {
  TIMING_CALIBRATION_ACTIONS
} from "./timing-stimulus.mjs";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPTION_LABELS = Object.freeze(["A", "B", "C"]);
export const TIMING_CALIBRATION_FIT_ELIGIBILITY = Object.freeze([
  "fit-eligible",
  "development-synthetic",
  "evaluation-only",
  "control-only"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function identifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 180 ||
    !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) {
    throw new TypeError(`${label} é inválido`);
  }
  return value;
}

function packCore(pack) {
  const core = structuredClone(pack);
  delete core.packSha256;
  return core;
}

export function finalizeTimingCalibrationPack(core) {
  const value = structuredClone(core);
  delete value.packSha256;
  return Object.freeze({
    ...value,
    packSha256: `sha256:${canonicalSha256(value)}`
  });
}

export function validateTimingCalibrationPack(pack) {
  const errors = [];
  if (pack?.schemaVersion !== "timing-calibration-pack-v1") {
    errors.push("schemaVersion incompatível");
  }
  try {
    identifier(pack?.packId, "packId");
  } catch (error) {
    errors.push(error.message);
  }
  const observedHash = `sha256:${canonicalSha256(packCore(pack ?? {}))}`;
  if (pack?.packSha256 !== observedHash) {
    errors.push("packSha256 divergente");
  }
  if (
    JSON.stringify(pack?.actions) !==
    JSON.stringify(TIMING_CALIBRATION_ACTIONS)
  ) {
    errors.push("actions incompatíveis");
  }
  const protocol = pack?.protocol;
  if (
    !Number.isSafeInteger(protocol?.minimumCompletedPlaybacksPerOption) ||
    protocol.minimumCompletedPlaybacksPerOption < 1
  ) {
    errors.push("minimumCompletedPlaybacksPerOption inválido");
  }
  if (
    !Array.isArray(protocol?.allowedReasonTags) ||
    new Set(protocol.allowedReasonTags).size !==
      protocol.allowedReasonTags.length ||
    protocol.allowedReasonTags.some((tag) =>
      typeof tag !== "string" || !/^[a-z0-9-]{1,80}$/u.test(tag)
    )
  ) {
    errors.push("allowedReasonTags inválidas");
  }
  for (const field of ["minimumParticipants", "minimumVotesPerScene"]) {
    if (!Number.isSafeInteger(protocol?.[field]) || protocol[field] < 3) {
      errors.push(`${field} inválido`);
    }
  }
  if (
    Number.isSafeInteger(protocol?.minimumVotesPerScene) &&
    Number.isSafeInteger(protocol?.minimumParticipants) &&
    protocol.minimumVotesPerScene > protocol.minimumParticipants
  ) {
    errors.push("minimumVotesPerScene excede minimumParticipants");
  }
  for (const field of [
    "minimumConsensusShare",
    "minimumLabelCoverage",
    "minimumAttentionPassRate"
  ]) {
    if (
      !Number.isFinite(protocol?.[field]) ||
      protocol[field] <= (field === "minimumLabelCoverage" ? 0 : 0.5) ||
      protocol[field] > 1
    ) {
      errors.push(`${field} inválido`);
    }
  }
  if (protocol?.unitOfAnalysis !== "participant") {
    errors.push("unitOfAnalysis precisa ser participant");
  }
  if (
    protocol?.identityPolicy !==
    "pseudonymous-local-token-hashed-before-persistence"
  ) {
    errors.push("identityPolicy incompatível");
  }
  const sceneIds = new Set();
  for (const scene of pack?.scenes ?? []) {
    try {
      identifier(scene.sceneId, "sceneId");
      identifier(scene.family, "family");
    } catch (error) {
      errors.push(error.message);
    }
    if (sceneIds.has(scene.sceneId)) {
      errors.push(`sceneId duplicado: ${scene.sceneId}`);
    }
    sceneIds.add(scene.sceneId);
    if (!TIMING_CALIBRATION_FIT_ELIGIBILITY.includes(
      scene.fitEligibility
    )) {
      errors.push(`${scene.sceneId} possui fitEligibility inválida`);
    }
    for (const action of TIMING_CALIBRATION_ACTIONS) {
      const artifact = scene.artifacts?.[action];
      if (
        typeof artifact?.path !== "string" ||
        !HASH_PATTERN.test(artifact?.sha256 ?? "") ||
        artifact?.channels !== 2 ||
        !Number.isFinite(artifact?.durationMs) ||
        artifact.durationMs <= 0
      ) {
        errors.push(`${scene.sceneId}/${action} possui artefato inválido`);
      }
    }
    const expected = scene.attentionControl?.expectedActions;
    if (
      expected !== null &&
      expected !== undefined &&
      (
        !Array.isArray(expected) ||
        expected.length === 0 ||
        expected.some(
          (action) => !TIMING_CALIBRATION_ACTIONS.includes(action)
        )
      )
    ) {
      errors.push(`${scene.sceneId} possui attentionControl inválido`);
    }
  }
  if (sceneIds.size === 0) {
    errors.push("pack precisa conter cenas");
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors,
    observedHash
  });
}

function score(...parts) {
  return sha256(parts.join("/"));
}

function optionId(pack, sessionId, sceneId, action) {
  return `option-${score(
    pack.packSha256,
    sessionId,
    sceneId,
    action
  ).slice(0, 24)}`;
}

export function createBlindCalibrationSession(pack, input = {}) {
  const validation = validateTimingCalibrationPack(pack);
  if (!validation.valid) {
    throw new TypeError(`pack inválido: ${validation.errors.join("; ")}`);
  }
  const sessionId = identifier(input.sessionId, "sessionId");
  const participantToken = identifier(
    input.participantToken,
    "participantToken"
  );
  const assignments = pack.scenes
    .map((scene) => {
      const options = TIMING_CALIBRATION_ACTIONS.map((action) => ({
        action,
        optionId: optionId(pack, sessionId, scene.sceneId, action),
        artifact: structuredClone(scene.artifacts[action])
      })).sort((left, right) =>
        score(sessionId, scene.sceneId, left.action).localeCompare(
          score(sessionId, scene.sceneId, right.action)
        )
      ).map((option, index) => ({
        ...option,
        displayLabel: OPTION_LABELS[index]
      }));
      return {
        sceneId: scene.sceneId,
        publicSceneId: `scene-${score(
          pack.packSha256,
          sessionId,
          scene.sceneId
        ).slice(0, 20)}`,
        family: scene.family,
        fitEligibility: scene.fitEligibility,
        attentionControl: structuredClone(scene.attentionControl),
        options
      };
    })
    .sort((left, right) =>
      score(sessionId, left.sceneId).localeCompare(
        score(sessionId, right.sceneId)
      )
    );
  const participantHash = `sha256:${sha256(
    `${pack.packSha256}/${participantToken}`
  )}`;
  const publicSession = {
    schemaVersion: "timing-calibration-session-v1",
    sessionId,
    packId: pack.packId,
    packSha256: pack.packSha256,
    sceneCount: assignments.length,
    scenes: assignments.map((assignment, index) => ({
      sceneId: assignment.publicSceneId,
      presentationIndex: index,
      options: assignment.options.map((option) => ({
        optionId: option.optionId,
        displayLabel: option.displayLabel,
        audioUrl:
          `/api/audio/${encodeURIComponent(sessionId)}/` +
          `${encodeURIComponent(assignment.publicSceneId)}/` +
          `${encodeURIComponent(option.optionId)}`
      }))
    }))
  };
  return Object.freeze({
    publicSession,
    internalSession: {
      schemaVersion: "timing-calibration-internal-session-v1",
      sessionId,
      packId: pack.packId,
      packSha256: pack.packSha256,
      participantHash,
      assignments
    }
  });
}

function validateResponse(assignment, response, pack, errors) {
  if (!response || response.sceneId !== assignment.publicSceneId) {
    errors.push(`${assignment.sceneId} possui resposta ausente ou divergente`);
    return null;
  }
  const minimumPlaybacks =
    pack.protocol?.minimumCompletedPlaybacksPerOption ?? 1;
  const playbackById = new Map(
    (response.playbacks ?? []).map((entry) => [entry.optionId, entry])
  );
  for (const option of assignment.options) {
    const completed = playbackById.get(option.optionId)?.completed;
    if (!Number.isSafeInteger(completed) || completed < minimumPlaybacks) {
      errors.push(
        `${assignment.sceneId}/${option.displayLabel} não foi ouvida por completo`
      );
    }
  }
  const uncertain = response.uncertain === true;
  const selected = assignment.options.find(
    (option) => option.optionId === response.selectedOptionId
  );
  if (uncertain && response.selectedOptionId !== null) {
    errors.push(`${assignment.sceneId} marcou dúvida e opção simultaneamente`);
  }
  if (!uncertain && !selected) {
    errors.push(`${assignment.sceneId} não possui opção selecionada`);
  }
  if (
    !Number.isSafeInteger(response.confidence) ||
    response.confidence < 1 ||
    response.confidence > 5
  ) {
    errors.push(`${assignment.sceneId} possui confiança inválida`);
  }
  const allowedReasons = new Set(pack.protocol?.allowedReasonTags ?? []);
  if (
    !Array.isArray(response.reasonTags) ||
    response.reasonTags.some((reason) => !allowedReasons.has(reason))
  ) {
    errors.push(`${assignment.sceneId} possui reasonTags inválidas`);
  }
  return {
    sceneId: assignment.sceneId,
    family: assignment.family,
    fitEligibility: assignment.fitEligibility,
    selectedAction: uncertain ? null : selected?.action ?? null,
    uncertain,
    confidence: response.confidence,
    reasonTags: [...(response.reasonTags ?? [])],
    playbacks: assignment.options.map((option) => ({
      optionId: option.optionId,
      action: option.action,
      displayLabel: option.displayLabel,
      completed: playbackById.get(option.optionId)?.completed ?? 0
    }))
  };
}

export function validateTimingCalibrationSubmission(
  pack,
  internalSession,
  submission
) {
  const errors = [];
  const packValidation = validateTimingCalibrationPack(pack);
  errors.push(...packValidation.errors);
  if (submission?.schemaVersion !== "timing-calibration-submission-v1") {
    errors.push("schemaVersion da submissão é incompatível");
  }
  if (
    submission?.sessionId !== internalSession?.sessionId ||
    submission?.packSha256 !== pack.packSha256 ||
    internalSession?.packSha256 !== pack.packSha256
  ) {
    errors.push("submissão não pertence à sessão/pack");
  }
  const responses = submission?.responses ?? [];
  if (!Array.isArray(responses)) {
    errors.push("responses precisa ser array");
  }
  const byScene = new Map();
  for (const response of Array.isArray(responses) ? responses : []) {
    if (byScene.has(response?.sceneId)) {
      errors.push(`resposta duplicada: ${response?.sceneId}`);
    }
    byScene.set(response?.sceneId, response);
  }
  if (byScene.size !== internalSession.assignments.length) {
    errors.push("submissão não cobre todas as cenas");
  }
  const normalized = internalSession.assignments.map((assignment) =>
    validateResponse(
      assignment,
      byScene.get(assignment.publicSceneId),
      pack,
      errors
    )
  ).filter(Boolean);
  const attentionResponses = normalized.filter((response) => {
    const scene = internalSession.assignments.find(
      (assignment) => assignment.sceneId === response.sceneId
    );
    return scene.attentionControl !== null &&
      scene.attentionControl !== undefined;
  });
  const attentionPassed = attentionResponses.filter((response) => {
    const scene = internalSession.assignments.find(
      (assignment) => assignment.sceneId === response.sceneId
    );
    return scene.attentionControl.expectedActions.includes(
      response.selectedAction
    );
  }).length;
  const recordCore = {
    schemaVersion: "timing-calibration-record-v1",
    sessionId: internalSession.sessionId,
    participantHash: internalSession.participantHash,
    packId: pack.packId,
    packSha256: pack.packSha256,
    source: {
      kind: "human-annotation",
      protocol: "blind-three-way-timing-preference-v1"
    },
    responses: normalized,
    attention: {
      total: attentionResponses.length,
      passed: attentionPassed
    }
  };
  return Object.freeze({
    valid: errors.length === 0,
    errors,
    record: errors.length === 0
      ? {
          ...recordCore,
          annotationId: `annotation-${canonicalSha256(recordCore).slice(0, 24)}`
        }
      : null
  });
}

export function validateTimingCalibrationRecord(pack, record) {
  const errors = [];
  const packValidation = validateTimingCalibrationPack(pack);
  errors.push(...packValidation.errors);
  if (record?.schemaVersion !== "timing-calibration-record-v1") {
    errors.push("schemaVersion do registro é incompatível");
  }
  try {
    identifier(record?.sessionId, "sessionId");
  } catch (error) {
    errors.push(error.message);
  }
  if (!HASH_PATTERN.test(record?.participantHash ?? "")) {
    errors.push("participantHash inválido");
  }
  if (
    record?.packId !== pack.packId ||
    record?.packSha256 !== pack.packSha256
  ) {
    errors.push("registro não pertence ao pack");
  }
  if (
    record?.source?.kind !== "human-annotation" ||
    record?.source?.protocol !==
      "blind-three-way-timing-preference-v1"
  ) {
    errors.push("proveniência do registro não é humana/cega");
  }
  if (JSON.stringify(record ?? {}).includes("participantToken")) {
    errors.push("registro contém participantToken proibido");
  }
  const responses = Array.isArray(record?.responses)
    ? record.responses
    : [];
  if (!Array.isArray(record?.responses)) {
    errors.push("responses do registro precisa ser array");
  }
  const byScene = new Map();
  const knownSceneIds = new Set(pack.scenes.map((scene) => scene.sceneId));
  for (const response of responses) {
    if (byScene.has(response?.sceneId)) {
      errors.push(`resposta persistida duplicada: ${response?.sceneId}`);
    }
    if (!knownSceneIds.has(response?.sceneId)) {
      errors.push(`resposta persistida desconhecida: ${response?.sceneId}`);
    }
    byScene.set(response?.sceneId, response);
  }
  if (byScene.size !== pack.scenes.length) {
    errors.push("registro não cobre todas as cenas do pack");
  }
  const allowedReasons = new Set(pack.protocol?.allowedReasonTags ?? []);
  const minimumPlaybacks =
    pack.protocol?.minimumCompletedPlaybacksPerOption ?? 1;
  let attentionTotal = 0;
  let attentionPassed = 0;
  for (const scene of pack.scenes) {
    const response = byScene.get(scene.sceneId);
    if (!response) {
      errors.push(`resposta persistida ausente: ${scene.sceneId}`);
      continue;
    }
    if (
      response.family !== scene.family ||
      response.fitEligibility !== scene.fitEligibility
    ) {
      errors.push(`${scene.sceneId} diverge da taxonomia do pack`);
    }
    const selectedIsValid = TIMING_CALIBRATION_ACTIONS.includes(
      response.selectedAction
    );
    if (
      (response.uncertain === true && response.selectedAction !== null) ||
      (response.uncertain !== true && !selectedIsValid)
    ) {
      errors.push(`${scene.sceneId} possui seleção persistida inválida`);
    }
    if (
      !Number.isSafeInteger(response.confidence) ||
      response.confidence < 1 ||
      response.confidence > 5
    ) {
      errors.push(`${scene.sceneId} possui confiança persistida inválida`);
    }
    if (
      !Array.isArray(response.reasonTags) ||
      response.reasonTags.some((reason) => !allowedReasons.has(reason))
    ) {
      errors.push(`${scene.sceneId} possui reasonTags persistidas inválidas`);
    }
    const playbackByAction = new Map(
      (response.playbacks ?? []).map((playback) => [
        playback.action,
        playback
      ])
    );
    if (
      !Array.isArray(response.playbacks) ||
      playbackByAction.size !== TIMING_CALIBRATION_ACTIONS.length
    ) {
      errors.push(`${scene.sceneId} possui playbacks persistidos inválidos`);
    }
    for (const action of TIMING_CALIBRATION_ACTIONS) {
      const playback = playbackByAction.get(action);
      if (
        !Number.isSafeInteger(playback?.completed) ||
        playback.completed < minimumPlaybacks
      ) {
        errors.push(`${scene.sceneId}/${action} não foi concluída`);
      }
    }
    if (scene.attentionControl) {
      attentionTotal += 1;
      if (scene.attentionControl.expectedActions.includes(
        response.selectedAction
      )) {
        attentionPassed += 1;
      }
    }
  }
  if (
    record?.attention?.total !== attentionTotal ||
    record?.attention?.passed !== attentionPassed
  ) {
    errors.push("sumário de atenção divergente");
  }
  if (
    record?.submittedAtEpochMs !== undefined &&
    (
      !Number.isSafeInteger(record.submittedAtEpochMs) ||
      record.submittedAtEpochMs < 0
    )
  ) {
    errors.push("submittedAtEpochMs inválido");
  }
  if (record && typeof record === "object") {
    const core = structuredClone(record);
    delete core.annotationId;
    delete core.submittedAtEpochMs;
    const expectedAnnotationId =
      `annotation-${canonicalSha256(core).slice(0, 24)}`;
    if (record.annotationId !== expectedAnnotationId) {
      errors.push("annotationId divergente do conteúdo");
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors
  });
}

export function selectFitEligibleTimingLabels(aggregate) {
  if (aggregate?.schemaVersion !== "timing-calibration-aggregate-v1") {
    throw new TypeError("agregado de calibração incompatível");
  }
  return Object.freeze((aggregate.labels ?? [])
    .filter((label) => label.fitEligibility === "fit-eligible")
    .map((label) => Object.freeze(structuredClone(label))));
}

export function aggregateTimingCalibration(pack, records, options = {}) {
  const minimumParticipants = options.minimumParticipants ?? 3;
  const minimumVotesPerScene = options.minimumVotesPerScene ?? 3;
  const minimumConsensusShare = options.minimumConsensusShare ?? 2 / 3;
  const minimumLabelCoverage = options.minimumLabelCoverage ?? 0.6;
  const minimumAttentionPassRate =
    options.minimumAttentionPassRate ?? 0.8;
  const recordValidations = (records ?? []).map((record, index) => ({
    index,
    annotationId: record?.annotationId ?? null,
    validation: validateTimingCalibrationRecord(pack, record)
  }));
  const invalidRecords = recordValidations.filter(
    (entry) => !entry.validation.valid
  );
  const validRecords = (records ?? []).filter(
    (_, index) => recordValidations[index].validation.valid
  );
  const participantCounts = Map.groupBy(
    validRecords,
    (record) => record.participantHash
  );
  const uniqueParticipants = participantCounts.size;
  const duplicateParticipants = [...participantCounts.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([participantHash]) => participantHash);
  const attention = validRecords.reduce(
    (summary, record) => ({
      total: summary.total + (record.attention?.total ?? 0),
      passed: summary.passed + (record.attention?.passed ?? 0)
    }),
    { total: 0, passed: 0 }
  );
  const attentionPassRate = attention.total === 0
    ? 0
    : attention.passed / attention.total;
  const eligibleScenes = pack.scenes.filter(
    (scene) => !scene.attentionControl &&
      scene.fitEligibility !== "control-only"
  );
  const sceneResults = eligibleScenes.map((scene) => {
    const responses = validRecords.flatMap((record) =>
      record.responses?.filter(
        (response) => response.sceneId === scene.sceneId
      ) ?? []
    ).filter((response) => response.selectedAction !== null);
    const votes = Object.fromEntries(
      TIMING_CALIBRATION_ACTIONS.map((action) => [
        action,
        responses.filter((response) => response.selectedAction === action)
          .length
      ])
    );
    const maximumVotes = Math.max(...Object.values(votes));
    const winners = TIMING_CALIBRATION_ACTIONS.filter(
      (action) => votes[action] === maximumVotes
    );
    const winner = responses.length > 0 && winners.length === 1
      ? winners[0]
      : null;
    const consensusShare = responses.length === 0
      ? 0
      : maximumVotes / responses.length;
    const labelled =
      winner !== null &&
      responses.length >= minimumVotesPerScene &&
      consensusShare >= minimumConsensusShare;
    return {
      sceneId: scene.sceneId,
      family: scene.family,
      fitEligibility: scene.fitEligibility,
      votes,
      validVotes: responses.length,
      winner,
      consensusShare,
      labelled
    };
  });
  const labels = sceneResults.filter((scene) => scene.labelled).map(
    (scene) => ({
      sceneId: scene.sceneId,
      task: "acoustic-reflex-intent",
      value: scene.winner,
      source: {
        kind: "human-annotation",
        ref: pack.packId,
        version: "blind-three-way-timing-preference-v1"
      },
      confidence: scene.consensusShare,
      participantCount: scene.validVotes,
      fitEligibility: scene.fitEligibility
    })
  );
  const labelCoverage = eligibleScenes.length === 0
    ? 0
    : labels.length / eligibleScenes.length;
  const gates = {
    packValid: validateTimingCalibrationPack(pack).valid,
    recordsValid: invalidRecords.length === 0,
    minimumParticipants: uniqueParticipants >= minimumParticipants,
    uniqueParticipants: duplicateParticipants.length === 0,
    attention: attentionPassRate >= minimumAttentionPassRate,
    labelCoverage: labelCoverage >= minimumLabelCoverage
  };
  const calibrationReady = Object.values(gates).every(Boolean);
  const fitEligibleLabels = labels.filter(
    (label) => label.fitEligibility === "fit-eligible"
  );
  return Object.freeze({
    schemaVersion: "timing-calibration-aggregate-v1",
    packId: pack.packId,
    packSha256: pack.packSha256,
    calibrationReady,
    readyToFreezeM4bExperiment: calibrationReady,
    readyForDirectModelFit:
      calibrationReady && fitEligibleLabels.length > 0,
    authority: "none-shadow-only",
    gates,
    metrics: {
      records: records?.length ?? 0,
      validRecords: validRecords.length,
      invalidRecords: invalidRecords.length,
      participants: uniqueParticipants,
      duplicateParticipants,
      attentionPassRate,
      labelledScenes: labels.length,
      eligibleScenes: eligibleScenes.length,
      labelCoverage,
      fitEligibleLabels: fitEligibleLabels.length
    },
    invalidRecords: invalidRecords.map((entry) => ({
      index: entry.index,
      annotationId: entry.annotationId,
      errors: entry.validation.errors
    })),
    labels,
    scenes: sceneResults
  });
}
