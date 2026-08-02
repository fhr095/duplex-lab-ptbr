import { createHash } from "node:crypto";

import {
  canonicalSha256
} from "../factory/canonical-hash.mjs";
import {
  TIMING_CALIBRATION_ACTIONS
} from "./timing-stimulus.mjs";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPTION_LABELS = Object.freeze(["A", "B", "C"]);
const NONPRINTABLE_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export const TIMING_CALIBRATION_FIT_ELIGIBILITY = Object.freeze([
  "fit-eligible",
  "development-synthetic",
  "evaluation-only",
  "control-only"
]);
export const TIMING_CALIBRATION_PARTICIPANT_ROLES = Object.freeze([
  "external",
  "internal"
]);
export const TIMING_CALIBRATION_SPEAKER_RELEVANCE = Object.freeze([
  "DIRECTED_TO_ASSISTANT",
  "BACKGROUND_OR_NOT_DIRECTED",
  "UNCERTAIN"
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

function orderedActions(actions) {
  const included = new Set(Array.isArray(actions) ? actions : []);
  return TIMING_CALIBRATION_ACTIONS.filter((action) => included.has(action));
}

function actionSetKey(actions) {
  return orderedActions(actions).join("+");
}

function artifactGroups(scene) {
  const byHash = Map.groupBy(
    TIMING_CALIBRATION_ACTIONS,
    (action) => scene.artifacts[action].sha256
  );
  return [...byHash.entries()].map(([artifactSha256, actions]) => ({
    actions: orderedActions(actions),
    artifactSha256,
    artifact: structuredClone(scene.artifacts[actions[0]])
  }));
}

function normalizeComment(value, maximumCharacters, errors, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    errors.push(`${label} precisa ser texto`);
    return null;
  }
  const normalized = value.trim().replace(/[ \t\r\n]+/gu, " ");
  if (normalized.length === 0) {
    return null;
  }
  if (
    normalized.length > maximumCharacters ||
    NONPRINTABLE_CHARACTER_PATTERN.test(normalized)
  ) {
    errors.push(`${label} é inválido`);
  }
  return normalized;
}

function attentionPassed(
  attentionControl,
  response,
  acceptedSpeakerRelevance = null
) {
  if (!attentionControl || response.uncertain) {
    return false;
  }
  const selectedActions = Array.isArray(response?.selectedActions)
    ? response.selectedActions
    : [];
  const expectedActions = new Set(attentionControl.expectedActions);
  const actionPass = selectedActions.length > 0 &&
    selectedActions.every((action) => expectedActions.has(action));
  const accepted = new Set(
    acceptedSpeakerRelevance ?? [
      attentionControl.expectedSpeakerRelevance
    ]
  );
  return actionPass && accepted.has(response.speakerRelevance);
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
  if (pack?.schemaVersion !== "timing-calibration-pack-v2") {
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
    protocol?.version !== "blind-timing-preference-and-attribution-v2"
  ) {
    errors.push("protocol.version incompatível");
  }
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
  if (
    !Number.isSafeInteger(protocol?.maximumCommentCharacters) ||
    protocol.maximumCommentCharacters < 1 ||
    protocol.maximumCommentCharacters > 1_000
  ) {
    errors.push("maximumCommentCharacters inválido");
  }
  for (const field of [
    "minimumExternalParticipants",
    "minimumVotesPerScene"
  ]) {
    if (!Number.isSafeInteger(protocol?.[field]) || protocol[field] < 3) {
      errors.push(`${field} inválido`);
    }
  }
  if (
    Number.isSafeInteger(protocol?.minimumVotesPerScene) &&
    Number.isSafeInteger(protocol?.minimumExternalParticipants) &&
    protocol.minimumVotesPerScene > protocol.minimumExternalParticipants
  ) {
    errors.push(
      "minimumVotesPerScene excede minimumExternalParticipants"
    );
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
    const attention = scene.attentionControl;
    if (attention !== null && attention !== undefined) {
      if (
        !Array.isArray(attention.expectedActions) ||
        attention.expectedActions.length === 0 ||
        new Set(attention.expectedActions).size !==
          attention.expectedActions.length ||
        attention.expectedActions.some(
          (action) => !TIMING_CALIBRATION_ACTIONS.includes(action)
        )
      ) {
        errors.push(`${scene.sceneId} possui expectedActions inválidas`);
      }
      if (!TIMING_CALIBRATION_SPEAKER_RELEVANCE.includes(
        attention.expectedSpeakerRelevance
      )) {
        errors.push(
          `${scene.sceneId} possui expectedSpeakerRelevance inválida`
        );
      }
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

export function validateTimingCalibrationScoringRubric(pack, rubric) {
  const errors = [];
  const packValidation = validateTimingCalibrationPack(pack);
  errors.push(...packValidation.errors);
  if (
    rubric?.schemaVersion !== "timing-calibration-scoring-rubric-v1"
  ) {
    errors.push("schemaVersion do gabarito é incompatível");
  }
  try {
    identifier(rubric?.rubricId, "rubricId");
  } catch (error) {
    errors.push(error.message);
  }
  if (
    rubric?.packId !== pack?.packId ||
    rubric?.packSha256 !== pack?.packSha256 ||
    rubric?.baseProtocolVersion !== pack?.protocol?.version
  ) {
    errors.push("gabarito não pertence ao pack/protocolo");
  }
  if (rubric?.policy !== "additive-acceptance-only") {
    errors.push("policy do gabarito precisa ser additive-acceptance-only");
  }
  const amendments = Array.isArray(rubric?.amendments)
    ? rubric.amendments
    : [];
  if (!Array.isArray(rubric?.amendments) || amendments.length === 0) {
    errors.push("gabarito precisa conter amendments");
  }
  const amendmentKeys = new Set();
  const sceneById = new Map(
    (pack?.scenes ?? []).map((scene) => [scene.sceneId, scene])
  );
  for (const amendment of amendments) {
    const key = `${amendment?.sceneId}/${amendment?.dimension}`;
    if (amendmentKeys.has(key)) {
      errors.push(`amendment duplicada: ${key}`);
    }
    amendmentKeys.add(key);
    const scene = sceneById.get(amendment?.sceneId);
    if (!scene?.attentionControl) {
      errors.push(`${amendment?.sceneId} não é controle de atenção`);
      continue;
    }
    if (
      amendment?.dimension !== "speaker-relevance-accepted-values"
    ) {
      errors.push(`${amendment.sceneId} possui dimension incompatível`);
    }
    const acceptedValues = Array.isArray(amendment?.acceptedValues)
      ? amendment.acceptedValues
      : [];
    if (
      !Array.isArray(amendment?.acceptedValues) ||
      acceptedValues.length === 0 ||
      acceptedValues.length >=
        TIMING_CALIBRATION_SPEAKER_RELEVANCE.length ||
      new Set(acceptedValues).size !== acceptedValues.length ||
      acceptedValues.some((value) =>
        !TIMING_CALIBRATION_SPEAKER_RELEVANCE.includes(value)
      ) ||
      !acceptedValues.includes(
        scene.attentionControl.expectedSpeakerRelevance
      )
    ) {
      errors.push(`${amendment.sceneId} possui acceptedValues inválidos`);
    }
    if (
      typeof amendment?.rationale !== "string" ||
      amendment.rationale.trim().length < 20
    ) {
      errors.push(`${amendment.sceneId} precisa documentar rationale`);
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors
  });
}

function score(...parts) {
  return sha256(parts.join("/"));
}

function optionId(pack, sessionId, sceneId, actions) {
  return `option-${score(
    pack.packSha256,
    sessionId,
    sceneId,
    actionSetKey(actions)
  ).slice(0, 24)}`;
}

function participantRole(value) {
  if (!TIMING_CALIBRATION_PARTICIPANT_ROLES.includes(value)) {
    throw new TypeError("participantRole é inválido");
  }
  return value;
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
  const role = participantRole(input.participantRole);
  const assignments = pack.scenes
    .map((scene) => {
      const options = artifactGroups(scene).map((group) => ({
        actions: group.actions,
        optionId: optionId(
          pack,
          sessionId,
          scene.sceneId,
          group.actions
        ),
        artifact: group.artifact
      })).sort((left, right) =>
        score(
          sessionId,
          scene.sceneId,
          actionSetKey(left.actions)
        ).localeCompare(score(
          sessionId,
          scene.sceneId,
          actionSetKey(right.actions)
        ))
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
    schemaVersion: "timing-calibration-session-v2",
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
      schemaVersion: "timing-calibration-internal-session-v2",
      sessionId,
      packId: pack.packId,
      packSha256: pack.packSha256,
      participantHash,
      participantRole: role,
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
  const submittedPlaybacks = Array.isArray(response.playbacks)
    ? response.playbacks
    : [];
  const playbackById = new Map(
    submittedPlaybacks.map((entry) => [entry?.optionId, entry])
  );
  if (playbackById.size !== assignment.options.length) {
    errors.push(`${assignment.sceneId} possui playbacks inválidos`);
  }
  for (const option of assignment.options) {
    const completed = playbackById.get(option.optionId)?.completed;
    if (!Number.isSafeInteger(completed) || completed < minimumPlaybacks) {
      errors.push(
        `${assignment.sceneId}/${option.displayLabel} não foi ouvida por completo`
      );
    }
  }
  const uncertain = response.uncertain === true;
  const selectedOptionIds = Array.isArray(response.selectedOptionIds)
    ? response.selectedOptionIds
    : [];
  if (!Array.isArray(response.selectedOptionIds)) {
    errors.push(`${assignment.sceneId} possui selectedOptionIds inválidos`);
  }
  if (new Set(selectedOptionIds).size !== selectedOptionIds.length) {
    errors.push(`${assignment.sceneId} possui seleção duplicada`);
  }
  const optionById = new Map(
    assignment.options.map((option) => [option.optionId, option])
  );
  const selectedOptions = selectedOptionIds
    .map((id) => optionById.get(id))
    .filter(Boolean);
  if (selectedOptions.length !== selectedOptionIds.length) {
    errors.push(`${assignment.sceneId} possui opção desconhecida`);
  }
  if (uncertain && selectedOptionIds.length > 0) {
    errors.push(`${assignment.sceneId} marcou dúvida e opção simultaneamente`);
  }
  if (!uncertain && selectedOptionIds.length === 0) {
    errors.push(`${assignment.sceneId} não possui opção selecionada`);
  }
  if (!TIMING_CALIBRATION_SPEAKER_RELEVANCE.includes(
    response.speakerRelevance
  )) {
    errors.push(`${assignment.sceneId} possui relevância da fala inválida`);
  }
  if (
    !Number.isSafeInteger(response.confidence) ||
    response.confidence < 1 ||
    response.confidence > 5
  ) {
    errors.push(`${assignment.sceneId} possui confiança inválida`);
  }
  const allowedReasons = new Set(pack.protocol?.allowedReasonTags ?? []);
  const reasonTags = Array.isArray(response.reasonTags)
    ? response.reasonTags
    : [];
  if (
    !Array.isArray(response.reasonTags) ||
    new Set(reasonTags).size !== reasonTags.length ||
    reasonTags.some((reason) => !allowedReasons.has(reason))
  ) {
    errors.push(`${assignment.sceneId} possui reasonTags inválidas`);
  }
  const comment = normalizeComment(
    response.comment,
    pack.protocol.maximumCommentCharacters,
    errors,
    `${assignment.sceneId}.comment`
  );
  const selectedOptionActionSets = selectedOptions
    .map((option) => [...option.actions])
    .sort((left, right) =>
      actionSetKey(left).localeCompare(actionSetKey(right), "en")
    );
  const selectedActions = uncertain
    ? []
    : orderedActions(selectedOptionActionSets.flat());
  return {
    sceneId: assignment.sceneId,
    family: assignment.family,
    fitEligibility: assignment.fitEligibility,
    selectedActions,
    selectedOptionActionSets: uncertain ? [] : selectedOptionActionSets,
    uncertain,
    speakerRelevance: response.speakerRelevance,
    confidence: response.confidence,
    reasonTags: [...reasonTags],
    comment,
    playbacks: assignment.options.map((option) => ({
      optionId: option.optionId,
      actions: [...option.actions],
      artifactSha256: option.artifact.sha256,
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
  if (submission?.schemaVersion !== "timing-calibration-submission-v2") {
    errors.push("schemaVersion da submissão é incompatível");
  }
  if (
    submission?.sessionId !== internalSession?.sessionId ||
    submission?.packSha256 !== pack.packSha256 ||
    internalSession?.packSha256 !== pack.packSha256 ||
    internalSession?.schemaVersion !==
      "timing-calibration-internal-session-v2"
  ) {
    errors.push("submissão não pertence à sessão/pack");
  }
  if (!TIMING_CALIBRATION_PARTICIPANT_ROLES.includes(
    internalSession?.participantRole
  )) {
    errors.push("sessão possui participantRole inválido");
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
  const attentionPassedCount = attentionResponses.filter((response) => {
    const scene = internalSession.assignments.find(
      (assignment) => assignment.sceneId === response.sceneId
    );
    return attentionPassed(scene.attentionControl, response);
  }).length;
  const recordCore = {
    schemaVersion: "timing-calibration-record-v2",
    sessionId: internalSession.sessionId,
    participantHash: internalSession.participantHash,
    participantRole: internalSession.participantRole,
    packId: pack.packId,
    packSha256: pack.packSha256,
    source: {
      kind: "human-annotation",
      protocol: "blind-timing-preference-and-attribution-v2"
    },
    responses: normalized,
    attention: {
      total: attentionResponses.length,
      passed: attentionPassedCount
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
  if (record?.schemaVersion !== "timing-calibration-record-v2") {
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
  if (!TIMING_CALIBRATION_PARTICIPANT_ROLES.includes(
    record?.participantRole
  )) {
    errors.push("participantRole persistido inválido");
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
      "blind-timing-preference-and-attribution-v2"
  ) {
    errors.push("proveniência do registro não é humana/cega v2");
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
  let attentionPassedCount = 0;
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
    const selectedActions = Array.isArray(response.selectedActions)
      ? response.selectedActions
      : [];
    const canonicalSelectedActions = orderedActions(selectedActions);
    if (
      !Array.isArray(response.selectedActions) ||
      new Set(selectedActions).size !== selectedActions.length ||
      selectedActions.some(
        (action) => !TIMING_CALIBRATION_ACTIONS.includes(action)
      ) ||
      JSON.stringify(selectedActions) !==
        JSON.stringify(canonicalSelectedActions)
    ) {
      errors.push(`${scene.sceneId} possui selectedActions inválidas`);
    }
    const expectedGroups = new Map(
      artifactGroups(scene).map((group) => [actionSetKey(group.actions), group])
    );
    const selectedSets = Array.isArray(response.selectedOptionActionSets)
      ? response.selectedOptionActionSets
      : [];
    const selectedSetKeys = selectedSets.map(actionSetKey);
    if (
      !Array.isArray(response.selectedOptionActionSets) ||
      selectedSets.some((actions) =>
        !Array.isArray(actions) ||
        JSON.stringify(actions) !== JSON.stringify(orderedActions(actions))
      ) ||
      new Set(selectedSetKeys).size !== selectedSetKeys.length ||
      selectedSetKeys.some((key) => !expectedGroups.has(key)) ||
      JSON.stringify(orderedActions(selectedSets.flat())) !==
        JSON.stringify(selectedActions)
    ) {
      errors.push(`${scene.sceneId} possui conjuntos selecionados inválidos`);
    }
    if (
      (response.uncertain === true && selectedActions.length > 0) ||
      (response.uncertain !== true && selectedSets.length === 0)
    ) {
      errors.push(`${scene.sceneId} possui seleção persistida inválida`);
    }
    if (!TIMING_CALIBRATION_SPEAKER_RELEVANCE.includes(
      response.speakerRelevance
    )) {
      errors.push(`${scene.sceneId} possui relevância persistida inválida`);
    }
    if (
      !Number.isSafeInteger(response.confidence) ||
      response.confidence < 1 ||
      response.confidence > 5
    ) {
      errors.push(`${scene.sceneId} possui confiança persistida inválida`);
    }
    const reasonTags = Array.isArray(response.reasonTags)
      ? response.reasonTags
      : [];
    if (
      !Array.isArray(response.reasonTags) ||
      new Set(reasonTags).size !== reasonTags.length ||
      reasonTags.some(
        (reason) => !allowedReasons.has(reason)
      )
    ) {
      errors.push(`${scene.sceneId} possui reasonTags persistidas inválidas`);
    }
    const normalizedComment = normalizeComment(
      response.comment,
      pack.protocol.maximumCommentCharacters,
      errors,
      `${scene.sceneId}.comment persistido`
    );
    if (normalizedComment !== response.comment) {
      errors.push(`${scene.sceneId} possui comment não canônico`);
    }
    const playbacks = Array.isArray(response.playbacks)
      ? response.playbacks
      : [];
    const playbackByGroup = new Map(
      playbacks.map((playback) => [
        actionSetKey(playback.actions ?? []),
        playback
      ])
    );
    if (
      playbackByGroup.size !== expectedGroups.size ||
      playbacks.some((playback) =>
        !Array.isArray(playback?.actions) ||
        JSON.stringify(playback.actions) !==
          JSON.stringify(orderedActions(playback.actions))
      )
    ) {
      errors.push(`${scene.sceneId} possui playbacks persistidos inválidos`);
    }
    for (const [key, group] of expectedGroups) {
      const playback = playbackByGroup.get(key);
      if (
        !Number.isSafeInteger(playback?.completed) ||
        playback.completed < minimumPlaybacks ||
        playback?.artifactSha256 !== group.artifactSha256
      ) {
        errors.push(`${scene.sceneId}/${key} não foi concluída`);
      }
    }
    if (scene.attentionControl) {
      attentionTotal += 1;
      if (attentionPassed(scene.attentionControl, response)) {
        attentionPassedCount += 1;
      }
    }
  }
  if (
    record?.attention?.total !== attentionTotal ||
    record?.attention?.passed !== attentionPassedCount
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
  if (aggregate?.schemaVersion !== "timing-calibration-aggregate-v2") {
    throw new TypeError("agregado de calibração incompatível");
  }
  return Object.freeze((aggregate.labels ?? [])
    .filter((label) => label.fitEligibility === "fit-eligible")
    .map((label) => Object.freeze(structuredClone(label))));
}

function relevanceCounts(responses) {
  return Object.fromEntries(
    TIMING_CALIBRATION_SPEAKER_RELEVANCE.map((value) => [
      value,
      responses.filter((response) => response.speakerRelevance === value)
        .length
    ])
  );
}

function attentionOverridesByScene(rubric) {
  return new Map((rubric?.amendments ?? []).map((amendment) => [
    amendment.sceneId,
    amendment.acceptedValues
  ]));
}

function summarizeAttention(pack, records, rubric = null) {
  const overrides = attentionOverridesByScene(rubric);
  let total = 0;
  let passed = 0;
  for (const record of records) {
    const responseByScene = new Map(
      (record.responses ?? []).map((response) => [
        response.sceneId,
        response
      ])
    );
    for (const scene of pack.scenes.filter(
      (candidate) => candidate.attentionControl
    )) {
      total += 1;
      if (attentionPassed(
        scene.attentionControl,
        responseByScene.get(scene.sceneId),
        overrides.get(scene.sceneId)
      )) {
        passed += 1;
      }
    }
  }
  return Object.freeze({
    total,
    passed,
    passRate: total === 0 ? 0 : passed / total
  });
}

export function aggregateTimingCalibration(pack, records, options = {}) {
  const minimumExternalParticipants =
    options.minimumExternalParticipants ?? 3;
  const minimumVotesPerScene = options.minimumVotesPerScene ?? 3;
  const minimumConsensusShare = options.minimumConsensusShare ?? 2 / 3;
  const minimumLabelCoverage = options.minimumLabelCoverage ?? 0.6;
  const minimumAttentionPassRate =
    options.minimumAttentionPassRate ?? 0.8;
  const attentionScoringRubric =
    options.attentionScoringRubric ?? null;
  const rubricValidation = attentionScoringRubric === null
    ? { valid: true, errors: [] }
    : validateTimingCalibrationScoringRubric(
        pack,
        attentionScoringRubric
      );
  const activeRubric = rubricValidation.valid
    ? attentionScoringRubric
    : null;
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
  const duplicateParticipantCount = [...participantCounts.values()]
    .filter((entries) => entries.length > 1).length;
  const uniqueRecords = [...participantCounts.values()].map(
    (entries) => entries[0]
  );
  const externalRecords = uniqueRecords.filter(
    (record) => record.participantRole === "external"
  );
  const internalRecords = uniqueRecords.filter(
    (record) => record.participantRole === "internal"
  );
  const baseAttention = summarizeAttention(pack, externalRecords);
  const activeAttention = summarizeAttention(
    pack,
    externalRecords,
    activeRubric
  );
  const attentionPassRate = activeAttention.passRate;
  const eligibleScenes = pack.scenes.filter(
    (scene) => !scene.attentionControl &&
      scene.fitEligibility !== "control-only"
  );
  const sceneResults = eligibleScenes.map((scene) => {
    const allResponses = externalRecords.flatMap((record) =>
      record.responses?.filter(
        (response) => response.sceneId === scene.sceneId
      ) ?? []
    );
    const singleActionResponses = allResponses.filter(
      (response) => !response.uncertain &&
        response.selectedActions.length === 1
    );
    const votes = Object.fromEntries(
      TIMING_CALIBRATION_ACTIONS.map((action) => [
        action,
        singleActionResponses.filter(
          (response) => response.selectedActions[0] === action
        ).length
      ])
    );
    const preferenceSets = Object.fromEntries(
      [...Map.groupBy(
        allResponses.filter((response) => !response.uncertain),
        (response) => actionSetKey(response.selectedActions)
      )].map(([key, entries]) => [key, entries.length])
    );
    const maximumVotes = Math.max(...Object.values(votes));
    const winners = TIMING_CALIBRATION_ACTIONS.filter(
      (action) => votes[action] === maximumVotes
    );
    const winner = singleActionResponses.length > 0 && winners.length === 1
      ? winners[0]
      : null;
    const consensusShare = singleActionResponses.length === 0
      ? 0
      : maximumVotes / singleActionResponses.length;
    const labelled =
      winner !== null &&
      singleActionResponses.length >= minimumVotesPerScene &&
      consensusShare >= minimumConsensusShare;
    return {
      sceneId: scene.sceneId,
      family: scene.family,
      fitEligibility: scene.fitEligibility,
      votes,
      preferenceSets,
      responses: allResponses.length,
      validSingleActionVotes: singleActionResponses.length,
      tiedOrEquivalentPreferences: allResponses.filter(
        (response) => !response.uncertain &&
          response.selectedActions.length > 1
      ).length,
      uncertainPreferences: allResponses.filter(
        (response) => response.uncertain
      ).length,
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
        version: "blind-timing-preference-and-attribution-v2"
      },
      confidence: scene.consensusShare,
      participantCount: scene.validSingleActionVotes,
      fitEligibility: scene.fitEligibility
    })
  );
  const speakerRelevance = pack.scenes.map((scene) => {
    const responses = externalRecords.flatMap((record) =>
      record.responses?.filter(
        (response) => response.sceneId === scene.sceneId
      ) ?? []
    );
    return {
      sceneId: scene.sceneId,
      family: scene.family,
      responses: responses.length,
      counts: relevanceCounts(responses)
    };
  });
  const labelCoverage = eligibleScenes.length === 0
    ? 0
    : labels.length / eligibleScenes.length;
  const gates = {
    packValid: validateTimingCalibrationPack(pack).valid,
    recordsValid: invalidRecords.length === 0,
    minimumExternalParticipants:
      externalRecords.length >= minimumExternalParticipants,
    uniqueParticipants: duplicateParticipantCount === 0,
    attentionScoringRubric: rubricValidation.valid,
    attention: attentionPassRate >= minimumAttentionPassRate,
    labelCoverage: labelCoverage >= minimumLabelCoverage
  };
  const calibrationReady = Object.values(gates).every(Boolean);
  const fitEligibleLabels = labels.filter(
    (label) => label.fitEligibility === "fit-eligible"
  );
  return Object.freeze({
    schemaVersion: "timing-calibration-aggregate-v2",
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
      totalParticipants: uniqueRecords.length,
      externalParticipants: externalRecords.length,
      internalParticipants: internalRecords.length,
      duplicateParticipantCount,
      baseAttentionPassRate: baseAttention.passRate,
      attentionPassRate,
      attentionPassedDelta:
        activeAttention.passed - baseAttention.passed,
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
    scenes: sceneResults,
    speakerRelevance,
    scoring: {
      attention: {
        mode: activeRubric === null
          ? "pack-base-rubric"
          : "versioned-additive-amendment",
        rubricId: activeRubric?.rubricId ?? null,
        rubricValid: rubricValidation.valid,
        rubricErrors: [...rubricValidation.errors],
        base: baseAttention,
        active: activeAttention,
        amendmentsApplied: activeRubric?.amendments.length ?? 0
      }
    }
  });
}
