import { canonicalSha256 } from "./factory/canonical-hash.mjs";

const AGE_BANDS = new Set(["18-34", "35+"]);
const VOICE_USE = new Set(["weekly", "monthly", "rare-never"]);

function nonEmpty(value, maximum = 160) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maximum;
}

function qualifiedText(value, maximum = 160) {
  return nonEmpty(value, maximum) && !String(value).includes("REPLACE_");
}

function counts(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

const ADMIN_REPLACEMENT_REASONS = Object.freeze([
  "PRE_SESSION_NO_SHOW",
  "PRE_SESSION_SCHEDULING_CONFLICT",
  "PRE_SESSION_TECHNICAL_INELIGIBILITY",
  "CONSENT_WITHDRAWN"
]);

function validatePerson(participant, prefix, errors) {
  if (
    !nonEmpty(participant?.alias, 64) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/u.test(participant.alias)
  ) errors.push(`${prefix}.alias precisa ser opaco e seguro`);
  if (!AGE_BANDS.has(participant?.ageBand)) errors.push(`${prefix}.ageBand inválida`);
  if (!nonEmpty(participant?.accentExposureGroup, 80)) errors.push(`${prefix}.accentExposureGroup ausente`);
  if (!VOICE_USE.has(participant?.voiceUse)) errors.push(`${prefix}.voiceUse inválido`);
  if (!nonEmpty(participant?.socialCluster, 80)) errors.push(`${prefix}.socialCluster ausente`);
  const forbidden = ["name", "email", "phone", "document", "address"]
    .filter((key) => key in (participant ?? {}));
  if (forbidden.length) errors.push(`${prefix} contém identificador civil proibido: ${forbidden.join(", ")}`);
}

function diversitySummary(participants) {
  const age = counts(participants.map((item) => item.ageBand));
  const accents = counts(participants.map((item) => item.accentExposureGroup));
  const representedAccents = Object.values(accents).filter((count) => count >= 2);
  const usage = counts(participants.map((item) => item.voiceUse));
  const clusters = counts(participants.map((item) => item.socialCluster));
  return {
    participantCount: participants.length,
    participantAliases: participants.map((item) => item.alias),
    ageBandCounts: age,
    accentExposureGroupCount: Object.keys(accents).length,
    accentGroupsWithAtLeastTwo: representedAccents.length,
    voiceUseCounts: usage,
    largestSocialCluster: Math.max(...Object.values(clusters)),
    valid:
      (age["18-34"] ?? 0) >= 2 &&
      (age["35+"] ?? 0) >= 2 &&
      representedAccents.length >= 2 &&
      (usage.weekly ?? 0) >= 2 &&
      (usage["rare-never"] ?? 0) >= 2 &&
      Object.values(clusters).every((count) => count <= 2)
  };
}

function replacementCombinations(slots, reserves) {
  const singles = reserves.flatMap((reserve) => reserve.allowedSlotIds.map((slotId) => ([{
    slotId,
    reserveAlias: reserve.alias
  }])));
  const doubles = [];
  for (let left = 0; left < singles.length; left += 1) {
    for (let right = left + 1; right < singles.length; right += 1) {
      const a = singles[left][0];
      const b = singles[right][0];
      if (a.slotId !== b.slotId && a.reserveAlias !== b.reserveAlias) {
        doubles.push([a, b].sort((x, y) => x.slotId.localeCompare(y.slotId)));
      }
    }
  }
  const unique = new Map(
    [[], ...singles, ...doubles].map((mapping) => [JSON.stringify(mapping), mapping])
  );
  return [...unique.values()];
}

export function validateExp0026Roster(roster) {
  const errors = [];
  if (roster?.exampleOnly === true) errors.push("template de roster precisa ser copiado e preenchido");
  if (roster?.schemaVersion !== "exp-0026-private-roster-v2") {
    errors.push("schemaVersion do roster é inválida");
  }
  if (!Array.isArray(roster?.slots) || roster.slots.length !== 6) {
    errors.push("roster precisa conter exatamente seis slots primários");
    return { valid: false, errors, summary: null };
  }
  const slotIds = [];
  const orderIndices = [];
  const primary = [];
  for (const [index, slot] of roster.slots.entries()) {
    const prefix = `slots[${index}]`;
    if (!/^SLOT-[1-6]$/u.test(slot?.slotId ?? "")) errors.push(`${prefix}.slotId inválido`);
    else slotIds.push(slot.slotId);
    if (!Number.isSafeInteger(slot?.orderIndex) || slot.orderIndex < 0 || slot.orderIndex > 5) {
      errors.push(`${prefix}.orderIndex inválido`);
    } else orderIndices.push(slot.orderIndex);
    validatePerson(slot?.primary, `${prefix}.primary`, errors);
    if (slot?.primary) primary.push(slot.primary);
  }
  if (new Set(slotIds).size !== 6) errors.push("slotIds precisam ser SLOT-1 a SLOT-6 únicos");
  if (new Set(orderIndices).size !== 6) errors.push("orderIndex precisa cobrir 0 a 5 uma vez");
  if (!Array.isArray(roster?.reserves) || roster.reserves.length !== 2) {
    errors.push("roster precisa conter exatamente duas reservas");
    return { valid: false, errors, summary: null };
  }
  for (const [index, reserve] of roster.reserves.entries()) {
    const prefix = `reserves[${index}]`;
    validatePerson(reserve, prefix, errors);
    if (
      !Array.isArray(reserve?.allowedSlotIds) ||
      reserve.allowedSlotIds.length === 0 ||
      new Set(reserve.allowedSlotIds).size !== reserve.allowedSlotIds.length ||
      reserve.allowedSlotIds.some((slotId) => !slotIds.includes(slotId))
    ) errors.push(`${prefix}.allowedSlotIds inválido`);
  }
  const allAliases = [...primary, ...roster.reserves]
    .map((participant) => participant.alias);
  if (new Set(allAliases).size !== allAliases.length) errors.push("aliases primários e reservas precisam ser únicos");
  if (
    roster?.replacementPolicy?.maxActivations !== 2 ||
    roster?.replacementPolicy?.startedSessionReplacementRequiresWithdrawal !== true ||
    JSON.stringify(roster?.replacementPolicy?.allowedReasons) !==
      JSON.stringify(ADMIN_REPLACEMENT_REASONS)
  ) errors.push("replacementPolicy diverge da política administrativa congelada");
  const mappings = errors.length === 0
    ? replacementCombinations(roster.slots, roster.reserves)
    : [];
  if (!mappings.some((mapping) => mapping.length === 2)) {
    errors.push("reservas precisam permitir ao menos uma composição válida com duas reposições");
  }
  const bySlot = new Map(roster.slots.map((slot) => [slot.slotId, slot.primary]));
  const byReserve = new Map(roster.reserves.map((item) => [item.alias, item]));
  const summaries = mappings.map((mapping) => {
    const selected = new Map(bySlot);
    for (const replacement of mapping) {
      selected.set(replacement.slotId, byReserve.get(replacement.reserveAlias));
    }
    return { mapping, diversity: diversitySummary([...selected.values()]) };
  });
  for (const item of summaries.filter((candidate) => !candidate.diversity.valid)) {
    errors.push(`reposição permitida rompe diversidade: ${JSON.stringify(item.mapping)}`);
  }
  const primarySummary = summaries.find((item) => item.mapping.length === 0)?.diversity ??
    diversitySummary(primary);
  if (!primarySummary.valid) errors.push("composição primária rompe diversidade mínima");
  return {
    valid: errors.length === 0,
    errors,
    summary: {
      ...primarySummary,
      primaryAliases: primary.map((item) => item.alias),
      reserveAliases: roster.reserves.map((item) => item.alias),
      slots: roster.slots.map((slot) => ({
        slotId: slot.slotId,
        orderIndex: slot.orderIndex,
        primaryAlias: slot.primary.alias,
        allowedReserveAliases: roster.reserves
          .filter((item) => item.allowedSlotIds.includes(slot.slotId))
          .map((item) => item.alias)
      })),
      reachableReplacementCompositions: summaries.length,
      everyReachableCompositionPreservesDiversity:
        summaries.every((item) => item.diversity.valid)
    }
  };
}

export function validateExp0026Station(station) {
  const errors = [];
  if (station?.exampleOnly === true) errors.push("template de estação precisa ser copiado e preenchido");
  if (station?.schemaVersion !== "exp-0026-private-station-v2") {
    errors.push("schemaVersion da estação é inválida");
  }
  for (const field of [
    "stationId",
    "windowsBuild",
    "wslBuild",
    "chromeBuild",
    "roomId",
    "networkCondition",
    "clockSynchronization"
  ]) {
    if (!qualifiedText(station?.[field])) errors.push(`${field} é obrigatório`);
  }
  for (const field of ["microphone", "output", "noiseDevice"]) {
    const device = station?.[field];
    if (!device || typeof device !== "object") {
      errors.push(`${field} é obrigatório`);
      continue;
    }
    if (!qualifiedText(device.opaqueId)) errors.push(`${field}.opaqueId é obrigatório`);
    if (!qualifiedText(device.model)) errors.push(`${field}.model é obrigatório`);
    if (!Number.isFinite(device.volume) || device.volume < 0 || device.volume > 1) {
      errors.push(`${field}.volume precisa estar entre 0 e 1`);
    }
    if (!qualifiedText(device.position)) errors.push(`${field}.position é obrigatório`);
  }
  const microphone = station?.microphone;
  if (microphone && (
    !Number.isSafeInteger(microphone.sampleRate) || microphone.sampleRate <= 0 ||
    !Number.isSafeInteger(microphone.channels) || microphone.channels <= 0 ||
    typeof microphone.echoCancellation !== "boolean" ||
    typeof microphone.noiseSuppression !== "boolean" ||
    typeof microphone.autoGainControl !== "boolean"
  )) errors.push("configuração técnica do microfone é inválida");
  if (
    station?.tts?.engine !== "windows-system-speech" ||
    station?.tts?.voice !== "Microsoft Maria Desktop" ||
    station?.tts?.culture !== "pt-BR" ||
    station?.tts?.rate !== 1 ||
    !qualifiedText(station?.tts?.format)
  ) errors.push("TTS da estação diverge da condição congelada");
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(
      station?.operationalReadiness?.reportFileSha256 ?? ""
    ) ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      station?.operationalReadiness?.acousticQualificationSha256 ?? ""
    )
  ) errors.push("estação não está ligada à qualificação acústica terminal");
  return { valid: errors.length === 0, errors };
}

export function createExp0026SessionFreeze(input) {
  const roster = validateExp0026Roster(input.roster);
  const station = validateExp0026Station(input.station);
  if (!roster.valid || !station.valid) {
    throw new TypeError([...roster.errors, ...station.errors].join("; "));
  }
  const core = {
    schemaVersion: "exp-0026-session-freeze-v2",
    experimentId: "EXP-0026",
    status: "OPEN_FOR_SIX_EXTERNAL_SESSIONS",
    createdAt: input.createdAt,
    closesAt: input.closesAt,
    sourceCommit: input.sourceCommit,
    runtimeBinding: input.runtimeBinding,
    brain: {
      provider: "openai",
      interactionModel: "gpt-5.6-luna",
      taskModel: "gpt-5.6-luna",
      reasoningEffort: "none",
      maxOutputTokens: 160,
      maxRequestsPerProcess: 25,
      store: false,
      stream: true,
      textVerbosity: "low",
      temperatureParameter: "absent",
      premiumAllowed: false
    },
    commercialReference: {
      available: false,
      disposition: "NOT_EVALUATED_REFERENCE_NOT_QUALIFIED_IN_DRY_RUN"
    },
    pack: input.pack,
    noise: input.noise,
    tts: input.tts,
    station: {
      manifestSha256: input.stationManifestSha256,
      stationId: input.station.stationId,
      windowsBuild: input.station.windowsBuild,
      wslBuild: input.station.wslBuild,
      chromeBuild: input.station.chromeBuild,
      deviceBindingSha256: `sha256:${canonicalSha256({
        microphone: input.station.microphone,
        output: input.station.output,
        noiseDevice: input.station.noiseDevice,
        roomId: input.station.roomId,
        networkCondition: input.station.networkCondition,
        clockSynchronization: input.station.clockSynchronization
      })}`,
      operationalReadiness: {
        ...input.station.operationalReadiness
      }
    },
    roster: {
      manifestSha256: input.rosterManifestSha256,
      participantAliases: roster.summary.primaryAliases,
      reserveAliases: roster.summary.reserveAliases,
      slots: roster.summary.slots,
      replacementPolicy: {
        maxActivations: 2,
        allowedReasons: [...ADMIN_REPLACEMENT_REASONS],
        startedSessionReplacementRequiresWithdrawal: true,
        reachableCompositionCount:
          roster.summary.reachableReplacementCompositions,
        everyReachableCompositionPreservesDiversity:
          roster.summary.everyReachableCompositionPreservesDiversity
      },
      diversityGate: {
        participantCount: roster.summary.participantCount,
        ageBandsSatisfied:
          roster.summary.ageBandCounts["18-34"] >= 2 &&
          roster.summary.ageBandCounts["35+"] >= 2,
        accentExposureSatisfied:
          roster.summary.accentGroupsWithAtLeastTwo >= 2,
        voiceUseSatisfied:
          roster.summary.voiceUseCounts.weekly >= 2 &&
          roster.summary.voiceUseCounts["rare-never"] >= 2,
        socialClusterSatisfied: roster.summary.largestSocialCluster <= 2
      },
      rawDiversityMetadataCommitted: false
    },
    qualification: input.qualification,
    privacy: {
      fitEligibility: "evaluation-only",
      rawRootTrackedByGit: false,
      retentionDaysAfterCloseout: 30,
      civilIdentifiersAllowed: false
    },
    prohibited: {
      secondDryRun: true,
      externalChallengerRunner: true,
      gpuOrPod: true,
      duplexCascade: true,
      runtimeOrDominanceGateChange: true
    }
  };
  return {
    ...core,
    freezeSha256: `sha256:${canonicalSha256(core)}`
  };
}
