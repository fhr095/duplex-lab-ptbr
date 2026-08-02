import { createHash } from "node:crypto";

import {
  SPEAKER_RELEVANCE_CLASSES,
  SPEAKER_RELEVANCE_FEATURES,
  SPEAKER_RELEVANCE_FEATURE_VERSION,
  extractSpeakerRelevanceFeatures
} from "./speaker-relevance-features.mjs";
import {
  predictSpeakerRelevance
} from "../../web/speaker-relevance-shadow.mjs";

function chunkId(buffer, offset) {
  return buffer.subarray(offset, offset + 4).toString("ascii");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function extractPcm16WaveChannel(buffer, channelIndex) {
  if (
    !Buffer.isBuffer(buffer) ||
    chunkId(buffer, 0) !== "RIFF" ||
    chunkId(buffer, 8) !== "WAVE"
  ) {
    throw new TypeError("entrada precisa ser WAV RIFF");
  }
  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = chunkId(buffer, offset);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > buffer.length) {
      throw new RangeError(`chunk WAV inválido: ${id}`);
    }
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(dataOffset),
        channels: buffer.readUInt16LE(dataOffset + 2),
        sampleRate: buffer.readUInt32LE(dataOffset + 4),
        blockAlign: buffer.readUInt16LE(dataOffset + 12),
        bitsPerSample: buffer.readUInt16LE(dataOffset + 14)
      };
    } else if (id === "data") {
      data = { offset: dataOffset, size };
    }
    offset = dataOffset + size + (size % 2);
  }
  if (
    !format ||
    !data ||
    format.audioFormat !== 1 ||
    format.bitsPerSample !== 16 ||
    !Number.isSafeInteger(channelIndex) ||
    channelIndex < 0 ||
    channelIndex >= format.channels
  ) {
    throw new TypeError("WAV PCM16 ou canal incompatível");
  }
  const frames = Math.floor(data.size / format.blockAlign);
  const pcm = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = data.offset + frame * format.blockAlign + channelIndex * 2;
    pcm.writeInt16LE(buffer.readInt16LE(offset), frame * 2);
  }
  return Object.freeze({
    pcm,
    sampleRate: format.sampleRate,
    channels: format.channels,
    sampleCount: frames
  });
}

export function deriveHumanSpeakerRelevanceAnchors(
  pack,
  aggregate
) {
  const minimumVotes = pack?.protocol?.minimumVotesPerScene;
  const minimumShare = pack?.protocol?.minimumConsensusShare;
  if (
    aggregate?.packId !== pack?.packId ||
    aggregate?.packSha256 !== pack?.packSha256 ||
    !Number.isSafeInteger(minimumVotes) ||
    !Number.isFinite(minimumShare)
  ) {
    throw new TypeError("pack e agregado de calibração incompatíveis");
  }
  const byScene = new Map(
    aggregate.speakerRelevance.map((entry) => [entry.sceneId, entry])
  );
  const anchors = [];
  for (const scene of pack.scenes) {
    if (scene.fitEligibility === "control-only") {
      continue;
    }
    const observed = byScene.get(scene.sceneId);
    if (!observed || observed.responses < minimumVotes) {
      continue;
    }
    const total = Object.values(observed.counts).reduce(
      (sum, count) => sum + count,
      0
    );
    if (total !== observed.responses) {
      throw new Error(`${scene.sceneId}: contagens humanas divergentes`);
    }
    const winners = SPEAKER_RELEVANCE_CLASSES.filter(
      (label) => observed.counts[label] / observed.responses >= minimumShare
    );
    if (winners.length !== 1) {
      continue;
    }
    anchors.push(Object.freeze({
      sceneId: scene.sceneId,
      family: scene.family,
      expected: winners[0],
      confidence: observed.counts[winners[0]] / observed.responses,
      responses: observed.responses,
      uncertain: observed.counts.UNCERTAIN,
      fitEligibility: "evaluation-only",
      eligibleForDirectFit: false
    }));
  }
  return Object.freeze(anchors);
}

function summarize(observations, predictedField) {
  const confusion = Object.fromEntries(
    SPEAKER_RELEVANCE_CLASSES.map((expected) => [
      expected,
      Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map(
        (predicted) => [predicted, 0]
      ))
    ])
  );
  for (const item of observations) {
    confusion[item.expected][item[predictedField]] += 1;
  }
  const correct = observations.filter(
    (item) => item[predictedField] === item.expected
  ).length;
  return {
    observations: observations.length,
    correct,
    accuracy: observations.length === 0
      ? null
      : correct / observations.length,
    classRecall: Object.fromEntries(SPEAKER_RELEVANCE_CLASSES.map(
      (label) => {
        const total = Object.values(confusion[label]).reduce(
          (sum, count) => sum + count,
          0
        );
        return [label, total === 0 ? null : confusion[label][label] / total];
      }
    )),
    confusion
  };
}

export async function evaluateHumanSpeakerRelevanceAnchors(input) {
  const anchors = deriveHumanSpeakerRelevanceAnchors(
    input.pack,
    input.aggregate
  );
  const sceneById = new Map(
    input.pack.scenes.map((scene) => [scene.sceneId, scene])
  );
  const observations = [];
  for (const anchor of anchors) {
    const scene = sceneById.get(anchor.sceneId);
    const causalWindows = [];
    for (const [action, artifact] of Object.entries(scene.artifacts)) {
      const wave = await input.readArtifact(artifact.path);
      if (sha256(wave) !== artifact.sha256) {
        throw new Error(`${anchor.sceneId}/${action}: WAV divergente`);
      }
      const right = extractPcm16WaveChannel(wave, 1);
      if (right.sampleRate !== input.pack.audio.sampleRate) {
        throw new Error(`${anchor.sceneId}/${action}: sample rate divergente`);
      }
      causalWindows.push({
        action,
        pcm: right.pcm.subarray(
          scene.timing.userStartSample * 2,
          scene.timing.decisionSample * 2
        )
      });
    }
    const canonicalWindow = causalWindows[0].pcm;
    const variantsInvariant = causalWindows.every(
      (entry) => entry.pcm.equals(canonicalWindow)
    );
    if (!variantsInvariant) {
      throw new Error(
        `${anchor.sceneId}: janela causal varia conforme a ação avaliada`
      );
    }
    const features = extractSpeakerRelevanceFeatures({
      pcm: canonicalWindow,
      sampleRate: input.pack.audio.sampleRate,
      onsetSample: 0,
      decisionSample: canonicalWindow.length / 2
    });
    const prediction = predictSpeakerRelevance(input.checkpoint, features);
    observations.push({
      sceneId: anchor.sceneId,
      family: anchor.family,
      expected: anchor.expected,
      confidence: anchor.confidence,
      responses: anchor.responses,
      uncertain: anchor.uncertain,
      raw: prediction.rawLabel,
      operational: prediction.operationalLabel,
      baseline: "DIRECTED_TO_ASSISTANT",
      backgroundProbability:
        prediction.probabilities.BACKGROUND_OR_NOT_DIRECTED,
      suggestedAction: prediction.suggestedAction,
      causalWindow: {
        durationMs:
          canonicalWindow.length / 2 / input.pack.audio.sampleRate * 1_000,
        sha256: sha256(canonicalWindow),
        variantsInvariant,
        futureSamplesUsed: features.window.futureSamplesUsed
      },
      featureContract: {
        version: SPEAKER_RELEVANCE_FEATURE_VERSION,
        names: [...SPEAKER_RELEVANCE_FEATURES]
      },
      fitEligibility: anchor.fitEligibility,
      eligibleForDirectFit: false
    });
  }
  const baseline = summarize(observations, "baseline");
  const raw = summarize(observations, "raw");
  const safeVeto = summarize(observations, "operational");
  return Object.freeze({
    anchors: observations.length,
    unresolvedOrExcluded:
      input.pack.scenes.filter(
        (scene) => scene.fitEligibility !== "control-only"
      ).length - observations.length,
    rawHumanRecordsUsedForFit: 0,
    actionVariantCausalWindowsInvariant: observations.every(
      (item) => item.causalWindow.variantsInvariant
    ),
    futureSamplesUsed: Math.max(
      0,
      ...observations.map((item) => item.causalWindow.futureSamplesUsed)
    ),
    baseline,
    candidate: { raw, safeVeto },
    gains: {
      rawScenes: raw.correct - baseline.correct,
      safeVetoScenes: safeVeto.correct - baseline.correct,
      rawAccuracy: raw.accuracy - baseline.accuracy,
      safeVetoAccuracy: safeVeto.accuracy - baseline.accuracy
    },
    observations
  });
}
