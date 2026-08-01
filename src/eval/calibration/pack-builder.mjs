import { createHash } from "node:crypto";

import {
  generateSeededWhiteNoisePcm16
} from "../../audio/acoustic-renderer.mjs";
import { encodePcm16Wave } from "../../audio/wav.mjs";
import { decodeWaveToPcm16 } from "../../asr/pcm.mjs";
import {
  canonicalSha256
} from "../factory/canonical-hash.mjs";
import {
  finalizeTimingCalibrationPack,
  validateTimingCalibrationPack
} from "./blind-session.mjs";
import {
  TIMING_CALIBRATION_ACTIONS,
  renderTimingCalibrationStimulus
} from "./timing-stimulus.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function msToSamples(milliseconds, sampleRate, label) {
  const samples = milliseconds / 1_000 * sampleRate;
  if (!Number.isSafeInteger(samples) || samples < 0) {
    throw new RangeError(`${label} precisa alinhar ao sample rate`);
  }
  return samples;
}

function fadeTail(pcm, fadeSamples) {
  if (fadeSamples === 0 || pcm.length === 0) {
    return Buffer.from(pcm);
  }
  const output = Buffer.from(pcm);
  const sampleCount = output.length / 2;
  const start = Math.max(0, sampleCount - fadeSamples);
  for (let index = start; index < sampleCount; index += 1) {
    const gain = (sampleCount - index - 1) /
      Math.max(1, sampleCount - start);
    output.writeInt16LE(
      Math.round(output.readInt16LE(index * 2) * gain),
      index * 2
    );
  }
  return output;
}

function cropPcm(pcm, maximumSamples, fadeSamples) {
  if (pcm.length / 2 <= maximumSamples) {
    return Buffer.from(pcm);
  }
  return fadeTail(pcm.subarray(0, maximumSamples * 2), fadeSamples);
}

function measureDecisionEvidence(pcm, decisionSample, sampleRate, audio) {
  const frameSamples = msToSamples(
    audio.decisionEvidenceFrameMs,
    sampleRate,
    "audio.decisionEvidenceFrameMs"
  );
  const lookbackSamples = msToSamples(
    audio.decisionEvidenceLookbackMs,
    sampleRate,
    "audio.decisionEvidenceLookbackMs"
  );
  const lookaheadSamples = msToSamples(
    audio.decisionEvidenceLookaheadMs,
    sampleRate,
    "audio.decisionEvidenceLookaheadMs"
  );
  if (frameSamples === 0 || !Number.isFinite(
    audio.decisionEvidenceMinimumRmsDb
  )) {
    throw new RangeError("configuração de evidência acústica é inválida");
  }
  const sampleCount = pcm.length / 2;
  const startSample = Math.max(0, decisionSample - lookbackSamples);
  const endSample = Math.min(sampleCount, decisionSample + lookaheadSamples);
  let activeFrames = 0;
  let peakRmsDb = -Infinity;
  for (
    let start = startSample;
    start + frameSamples <= endSample;
    start += frameSamples
  ) {
    let energy = 0;
    for (let sample = start; sample < start + frameSamples; sample += 1) {
      const normalized = pcm.readInt16LE(sample * 2) / 32_768;
      energy += normalized * normalized;
    }
    const rms = Math.sqrt(energy / frameSamples);
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
    peakRmsDb = Math.max(peakRmsDb, rmsDb);
    if (rmsDb >= audio.decisionEvidenceMinimumRmsDb) {
      activeFrames += 1;
    }
  }
  return Object.freeze({
    frameSamples,
    startSample,
    endSample,
    activeFrames,
    peakRmsDb,
    minimumRmsDb: audio.decisionEvidenceMinimumRmsDb
  });
}

function validateConfig(config) {
  if (
    config?.schemaVersion !== 1 ||
    typeof config?.id !== "string" ||
    config?.locale !== "pt-BR" ||
    config?.audio?.sampleRate !== 16_000 ||
    !Array.isArray(config?.assistantPrompts) ||
    config.assistantPrompts.length === 0 ||
    !Array.isArray(config?.scenes) ||
    config.scenes.length === 0
  ) {
    throw new TypeError("configuração EXP-0015 incompatível");
  }
  const promptIds = new Set(config.assistantPrompts.map((item) => item.id));
  if (promptIds.size !== config.assistantPrompts.length) {
    throw new TypeError("assistantPrompt duplicado");
  }
  const sceneIds = new Set(config.scenes.map((item) => item.id));
  if (sceneIds.size !== config.scenes.length) {
    throw new TypeError("scene id duplicado");
  }
  if (config.scenes.some((scene) => !promptIds.has(scene.assistantPromptId))) {
    throw new TypeError("scene referencia assistantPrompt ausente");
  }
}

async function synthesizeDecoded(synthesize, text, rate, sampleRate) {
  const wave = await synthesize(text, { rate });
  const decoded = decodeWaveToPcm16(wave, { targetSampleRate: sampleRate });
  return {
    wave,
    pcm: decoded.pcm,
    waveSha256: sha256(wave),
    pcmSha256: sha256(decoded.pcm)
  };
}

async function resolveUserSource(input) {
  const {
    config,
    humanById,
    humanManifest,
    readWave,
    scene,
    synthesize,
    syntheticCache
  } = input;
  const sampleRate = config.audio.sampleRate;
  const source = scene.userSource;
  if (source.kind === "coraa") {
    const definition = humanById.get(source.caseId);
    if (!definition) {
      throw new Error(`${scene.id}: caso CORAA ausente: ${source.caseId}`);
    }
    const wave = await readWave(definition.audio);
    const decoded = decodeWaveToPcm16(wave, { targetSampleRate: sampleRate });
    return {
      pcm: decoded.pcm,
      descriptor: {
        kind: "human-public-evaluation-anchor",
        ref: definition.id,
        category: definition.category,
        dataset: definition.metadata?.dataset ?? null,
        license: humanManifest.source?.license ?? null,
        waveSha256: `sha256:${sha256(wave)}`,
        decodedPcmSha256: `sha256:${sha256(decoded.pcm)}`,
        transcriptSha256: `sha256:${sha256(definition.expected ?? "")}`,
        redistribution: "source audio and local mixes are not committed"
      }
    };
  }
  if (source.kind === "tts") {
    const cacheKey = canonicalSha256({
      text: source.text,
      rate: source.rate ?? 1
    });
    if (!syntheticCache.has(cacheKey)) {
      syntheticCache.set(
        cacheKey,
        await synthesizeDecoded(
          synthesize,
          source.text,
          source.rate ?? 1,
          sampleRate
        )
      );
    }
    const generated = syntheticCache.get(cacheKey);
    return {
      pcm: generated.pcm,
      descriptor: {
        kind: "local-synthetic-speech",
        engine: "windows-system-speech",
        recipeSha256: `sha256:${cacheKey}`,
        textSha256: `sha256:${sha256(source.text)}`,
        waveSha256: `sha256:${generated.waveSha256}`,
        decodedPcmSha256: `sha256:${generated.pcmSha256}`,
        redistribution: "generated wave is not committed"
      }
    };
  }
  const durationSamples = msToSamples(
    source.durationMs,
    sampleRate,
    `${scene.id}.userSource.durationMs`
  );
  if (source.kind === "silence") {
    return {
      pcm: Buffer.alloc(durationSamples * 2),
      descriptor: {
        kind: "deterministic-silence-control",
        durationSamples
      }
    };
  }
  if (source.kind === "noise") {
    const pcm = generateSeededWhiteNoisePcm16({
      sampleCount: durationSamples,
      seed: source.seed,
      targetRms: source.targetRms
    });
    return {
      pcm: fadeTail(
        pcm,
        msToSamples(20, sampleRate, "noise.fade")
      ),
      descriptor: {
        kind: "seeded-white-noise-control",
        durationSamples,
        seed: source.seed,
        targetRms: source.targetRms,
        pcmSha256: `sha256:${sha256(pcm)}`
      }
    };
  }
  throw new TypeError(`${scene.id}: userSource.kind desconhecido`);
}

export async function buildTimingCalibrationPack(input = {}) {
  const {
    config,
    configBytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`),
    configPath = "inline:exp-0015-config",
    engine,
    humanManifest = { cases: [], source: {} },
    outputRoot = "eval/generated/exp-0015/v0.2/audio",
    readWave,
    synthesize
  } = input;
  validateConfig(config);
  if (typeof synthesize !== "function" || typeof readWave !== "function") {
    throw new TypeError("synthesize e readWave são obrigatórios");
  }
  const sampleRate = config.audio.sampleRate;
  const fadeSamples = msToSamples(
    config.audio.fadeMs,
    sampleRate,
    "audio.fadeMs"
  );
  const assistantCache = new Map();
  for (const prompt of config.assistantPrompts) {
    assistantCache.set(
      prompt.id,
      await synthesizeDecoded(
        synthesize,
        prompt.text,
        prompt.rate ?? 1,
        sampleRate
      )
    );
  }
  const humanById = new Map(
    (humanManifest.cases ?? []).map((item) => [item.id, item])
  );
  const syntheticCache = new Map();
  const artifacts = [];
  const scenes = [];
  for (const scene of config.scenes) {
    const sceneSampleCount = msToSamples(
      scene.durationMs,
      sampleRate,
      `${scene.id}.durationMs`
    );
    const userStartSample = msToSamples(
      scene.userStartMs,
      sampleRate,
      `${scene.id}.userStartMs`
    );
    const decisionSample = userStartSample + msToSamples(
      scene.decisionOffsetMs,
      sampleRate,
      `${scene.id}.decisionOffsetMs`
    );
    const waitStopSample = scene.waitTrajectory === "continue"
      ? null
      : decisionSample + msToSamples(
          scene.waitDelayMs,
          sampleRate,
          `${scene.id}.waitDelayMs`
        );
    const assistant = assistantCache.get(scene.assistantPromptId);
    if (assistant.pcm.length / 2 < sceneSampleCount) {
      throw new Error(
        `${scene.id}: assistantPrompt termina antes da cena`
      );
    }
    const resolvedUser = await resolveUserSource({
      config,
      humanById,
      humanManifest,
      readWave,
      scene,
      synthesize,
      syntheticCache
    });
    const maximumUserSamples = sceneSampleCount - userStartSample;
    const configuredMaximum = msToSamples(
      scene.maximumUserMs,
      sampleRate,
      `${scene.id}.maximumUserMs`
    );
    const userPcm = cropPcm(
      resolvedUser.pcm,
      Math.min(maximumUserSamples, configuredMaximum),
      fadeSamples
    );
    const decisionEvidence = measureDecisionEvidence(
      userPcm,
      decisionSample - userStartSample,
      sampleRate,
      config.audio
    );
    const sceneArtifacts = {};
    const artifactHashes = new Set();
    let preClipSamples = 0;
    for (const action of TIMING_CALIBRATION_ACTIONS) {
      const rendered = renderTimingCalibrationStimulus({
        action,
        assistantPcm: assistant.pcm,
        userPcm,
        sampleRate,
        sceneSampleCount,
        userStartSample,
        decisionSample,
        waitStopSample,
        fadeSamples,
        assistantGainDb: config.audio.assistantGainDb,
        userGainDb: config.audio.userGainDb,
        crossfeedGainDb: config.audio.crossfeedGainDb
      });
      const wave = encodePcm16Wave(rendered.stereoPcm, {
        sampleRate,
        channels: 2
      });
      const path = `${outputRoot}/${scene.id}--${action.toLowerCase()}.wav`;
      const waveSha256 = sha256(wave);
      artifactHashes.add(waveSha256);
      preClipSamples += rendered.metrics.preClipSamples;
      const descriptor = {
        path,
        sha256: `sha256:${waveSha256}`,
        pcmSha256: `sha256:${sha256(rendered.stereoPcm)}`,
        durationMs: scene.durationMs,
        sampleRate,
        channels: 2,
        timing: rendered.timing,
        preClipSamples: rendered.metrics.preClipSamples
      };
      sceneArtifacts[action] = descriptor;
      artifacts.push({ path, bytes: wave, descriptor });
    }
    scenes.push({
      sceneId: scene.id,
      family: scene.family,
      fitEligibility: scene.fitEligibility,
      assistant: {
        promptId: scene.assistantPromptId,
        textSha256: `sha256:${sha256(
          config.assistantPrompts.find(
            (prompt) => prompt.id === scene.assistantPromptId
          ).text
        )}`,
        waveSha256: `sha256:${assistant.waveSha256}`,
        decodedPcmSha256: `sha256:${assistant.pcmSha256}`
      },
      userSource: resolvedUser.descriptor,
      timing: {
        sceneSampleCount,
        userStartSample,
        decisionSample,
        waitStopSample,
        userSampleCount: userPcm.length / 2,
        fadeSamples
      },
      decisionEvidence,
      artifacts: sceneArtifacts,
      attentionControl: scene.attentionControl ?? null,
      checks: {
        noClipping: preClipSamples === 0,
        decisionHasAcousticEvidence:
          scene.fitEligibility === "control-only" ||
          decisionEvidence.activeFrames > 0,
        minimumDistinctTrajectories: artifactHashes.size >= 2,
        allActionsMaterialized:
          Object.keys(sceneArtifacts).length ===
          TIMING_CALIBRATION_ACTIONS.length
      }
    });
  }
  const gates = {
    expectedScenes: scenes.length === config.gates.expectedScenes,
    allChecks: scenes.every(
      (scene) => Object.values(scene.checks).every(Boolean)
    ),
    humanAnchors: scenes.filter(
      (scene) => scene.userSource.kind ===
        "human-public-evaluation-anchor"
    ).length >= config.gates.minimumHumanAnchorScenes,
    attentionControls: scenes.filter(
      (scene) => scene.attentionControl !== null
    ).length >= config.gates.minimumAttentionControls,
    noPaidApi: true
  };
  const packCore = {
    schemaVersion: "timing-calibration-pack-v2",
    packId: config.id,
    locale: config.locale,
    purpose: "small-human-timing-label-calibration-before-m4b",
    experimentConfig: {
      path: configPath,
      sha256: `sha256:${sha256(configBytes)}`
    },
    actions: [...TIMING_CALIBRATION_ACTIONS],
    protocol: structuredClone(config.protocol),
    audio: {
      sampleRate,
      channels: 2,
      channelMeaning: {
        left: "assistant-dominant",
        right: "near-end-user-dominant"
      },
      engine: structuredClone(engine)
    },
    sources: {
      humanManifestSha256: `sha256:${canonicalSha256(humanManifest)}`,
      humanLicense: humanManifest.source?.license ?? null,
      boundary:
        "public human audio is evaluation-only and never enters model fit"
    },
    scenes,
    retention: {
      audioInGit: false,
      annotationsContainRawAudio: false,
      annotationsMayContainOptionalComment: true,
      publicHumanMixesRedistributed: false,
      committedArtifacts:
        "recipes, hashes, pack and comment-free aggregate only"
    },
    limitations: [
      "instrumento de calibração pequena, não avaliação humana de produto",
      "cenas CORAA são âncoras evaluation-only por licença CC BY-NC-ND 4.0",
      "TTS sintético atual usa uma única voz PT-BR",
      "comentários opcionais ficam somente na coleta local ignorada pelo Git",
      "preferência humana futura não concede autoridade ao modelo"
    ],
    paidApiCalls: 0,
    buildGate: {
      ...gates,
      pass: Object.values(gates).every(Boolean)
    }
  };
  const pack = finalizeTimingCalibrationPack(packCore);
  const validation = validateTimingCalibrationPack(pack);
  if (!validation.valid) {
    throw new TypeError(
      `pack de calibração construído é inválido: ` +
        validation.errors.join("; ")
    );
  }
  return {
    pack,
    artifacts
  };
}
