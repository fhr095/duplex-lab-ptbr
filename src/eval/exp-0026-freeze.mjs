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

export function validateExp0026Roster(roster) {
  const errors = [];
  if (roster?.exampleOnly === true) errors.push("template de roster precisa ser copiado e preenchido");
  if (roster?.schemaVersion !== "exp-0026-private-roster-v1") {
    errors.push("schemaVersion do roster é inválida");
  }
  if (!Array.isArray(roster?.participants) || roster.participants.length !== 6) {
    errors.push("roster precisa conter exatamente seis participantes");
    return { valid: false, errors, summary: null };
  }
  const aliases = [];
  for (const [index, participant] of roster.participants.entries()) {
    const prefix = `participants[${index}]`;
    if (
      !nonEmpty(participant.alias, 64) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/u.test(participant.alias)
    ) errors.push(`${prefix}.alias precisa ser opaco e seguro`);
    else aliases.push(participant.alias);
    if (!AGE_BANDS.has(participant.ageBand)) errors.push(`${prefix}.ageBand inválida`);
    if (!nonEmpty(participant.accentExposureGroup, 80)) errors.push(`${prefix}.accentExposureGroup ausente`);
    if (!VOICE_USE.has(participant.voiceUse)) errors.push(`${prefix}.voiceUse inválido`);
    if (!nonEmpty(participant.socialCluster, 80)) errors.push(`${prefix}.socialCluster ausente`);
    const forbidden = ["name", "email", "phone", "document", "address"]
      .filter((key) => key in participant);
    if (forbidden.length) errors.push(`${prefix} contém identificador civil proibido: ${forbidden.join(", ")}`);
  }
  if (new Set(aliases).size !== aliases.length) errors.push("aliases precisam ser únicos");
  const age = counts(roster.participants.map((item) => item.ageBand));
  if ((age["18-34"] ?? 0) < 2 || (age["35+"] ?? 0) < 2) {
    errors.push("cada faixa etária precisa ter ao menos duas pessoas");
  }
  const accents = counts(roster.participants.map((item) => item.accentExposureGroup));
  const representedAccents = Object.values(accents).filter((count) => count >= 2);
  if (representedAccents.length < 2) {
    errors.push("ao menos dois grupos de exposição de sotaque precisam ter duas pessoas");
  }
  const usage = counts(roster.participants.map((item) => item.voiceUse));
  if ((usage.weekly ?? 0) < 2 || (usage["rare-never"] ?? 0) < 2) {
    errors.push("uso de voz precisa ter ao menos dois weekly e dois rare-never");
  }
  const clusters = counts(roster.participants.map((item) => item.socialCluster));
  if (Object.values(clusters).some((count) => count > 2)) {
    errors.push("um círculo social/domicílio não pode fornecer mais de duas pessoas");
  }
  return {
    valid: errors.length === 0,
    errors,
    summary: {
      participantCount: roster.participants.length,
      participantAliases: aliases,
      ageBandCounts: age,
      accentExposureGroupCount: Object.keys(accents).length,
      accentGroupsWithAtLeastTwo: representedAccents.length,
      voiceUseCounts: usage,
      largestSocialCluster: Math.max(...Object.values(clusters))
    }
  };
}

export function validateExp0026Station(station) {
  const errors = [];
  if (station?.exampleOnly === true) errors.push("template de estação precisa ser copiado e preenchido");
  if (station?.schemaVersion !== "exp-0026-private-station-v1") {
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
  return { valid: errors.length === 0, errors };
}

export function createExp0026SessionFreeze(input) {
  const roster = validateExp0026Roster(input.roster);
  const station = validateExp0026Station(input.station);
  if (!roster.valid || !station.valid) {
    throw new TypeError([...roster.errors, ...station.errors].join("; "));
  }
  const core = {
    schemaVersion: "exp-0026-session-freeze-v1",
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
      })}`
    },
    roster: {
      manifestSha256: input.rosterManifestSha256,
      participantAliases: roster.summary.participantAliases,
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
