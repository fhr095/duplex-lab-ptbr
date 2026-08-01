import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeWaveToPcm16 } from "../src/asr/pcm.mjs";
import {
  SILERO_VAD_MODEL_SHA256,
  createSileroVadShadowRuntime
} from "../src/audio/silero-vad-shadow.mjs";
import {
  canonicalSha256
} from "../src/eval/factory/canonical-hash.mjs";
import {
  ACOUSTIC_REFLEX_CLASSES,
  ACOUSTIC_REFLEX_FEATURES,
  acousticReflexTeacherLabel,
  extractAcousticReflexFeatures,
  isAcousticReflexDecisionPoint
} from "../web/acoustic-reflex-shadow.mjs";
import {
  LOCAL_AUDIO_REFLEX_VERSION,
  createLocalAudioReflexState,
  reduceLocalAudioReflex
} from "../web/local-audio-reflex.mjs";
import {
  ACOUSTIC_REFLEX_TRACE_SLICE_VERSION,
  TrainingTraceRecorder,
  validateTrainingTraceBundle
} from "../web/training-trace-recorder.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_CONFIG =
  "eval/experiments/exp-0014-acoustic-reflex.pt-BR.json";
const DEFAULT_DATASET =
  "eval/datasets/exp-0014-acoustic-reflex-v0.1.json";
const DEFAULT_TRACES =
  "eval/generated/exp-0014/training-traces.json";

function parseArgs(args) {
  const options = {
    config: DEFAULT_CONFIG,
    out: DEFAULT_DATASET,
    tracesOut: DEFAULT_TRACES,
    check: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
    } else if (["--config", "--out", "--traces-out"].includes(argument)) {
      const field = argument.slice(2).replace(
        /-([a-z])/gu,
        (_, letter) => letter.toUpperCase()
      );
      options[field] = args[++index];
    } else {
      throw new TypeError(`argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rateToken(rate) {
  return String(rate).replace("-", "m");
}

function splitFamilies(config) {
  const entries = Object.entries(config.splits).flatMap(
    ([split, families]) => families.map((family) => ({ split, family }))
  );
  const unique = new Set(entries.map((entry) => entry.family));
  if (unique.size !== entries.length) {
    throw new TypeError("famílias precisam pertencer a um único split");
  }
  return entries;
}

function appendSilence(pcm, samples) {
  return Buffer.concat([pcm, Buffer.alloc(samples * 2)]);
}

async function controllerEvents(runtime, pcm, config) {
  const controller = runtime.createController({
    threshold: config.vad.threshold,
    onsetWindows: config.vad.onsetWindows,
    offThreshold: config.vad.offThreshold,
    offsetWindows: config.vad.offsetWindows
  });
  const events = [];
  const frameSamples = config.audio.transportFrameSamples;
  let sequence = 0;
  for (
    let sampleStart = 0;
    sampleStart < pcm.byteLength / 2;
    sampleStart += frameSamples
  ) {
    const sampleCount = Math.min(
      frameSamples,
      pcm.byteLength / 2 - sampleStart
    );
    const frame = Buffer.alloc(sampleCount * 2);
    pcm.copy(
      frame,
      0,
      sampleStart * 2,
      (sampleStart + sampleCount) * 2
    );
    const emitted = await controller.push({
      pcm: frame,
      sampleStart,
      sequence,
      atMs: sampleStart / config.audio.sampleRate * 1_000
    });
    events.push(...emitted);
    sequence += 1;
  }
  return events;
}

function reflexEvent(event) {
  if (event.type === "user.speech.started") {
    return {
      type: "USER_SPEECH_STARTED",
      turnId: "turn-1",
      assistantAudible: true,
      assistantPending: true,
      detector: event.payload.detector,
      probability: event.payload.probability,
      triggerSampleStart: event.payload.triggerSampleStart
    };
  }
  if (event.type === "vad.control.window") {
    return {
      type: "VAD_CONTROL_WINDOW",
      turnId: "turn-1",
      probability: event.payload.probability,
      sampleStart: event.payload.sampleStart
    };
  }
  if (event.type === "user.speech.paused") {
    return {
      type: "USER_SPEECH_PAUSED",
      turnId: "turn-1",
      probability: event.payload.probability,
      triggerSampleStart: event.payload.triggerSampleStart
    };
  }
  return null;
}

function audioPosition(event, streamId, sampleCount, windowSamples) {
  const sampleStart = event.type === "USER_SPEECH_STARTED"
    ? event.triggerSampleStart
    : event.type === "VAD_CONTROL_WINDOW"
      ? event.sampleStart
      : event.triggerSampleStart;
  if (!Number.isSafeInteger(sampleStart)) {
    throw new TypeError(`posição acústica ausente em ${event.type}`);
  }
  return {
    streamId,
    sampleStart,
    sampleEnd: Math.min(sampleCount, sampleStart + windowSamples)
  };
}

function buildTraceAndExamples(input) {
  const {
    config,
    configHash,
    events,
    family,
    split,
    stream,
    variant
  } = input;
  const recorder = new TrainingTraceRecorder({
    sessionId: `${family}-${variant.id}-${stream.rateToken}`,
    startedAtEpochMs: 0,
    locale: config.locale,
    candidate: "local-audio-reflex-deterministic-teacher-v0.1",
    configHash: `sha256:${configHash}`,
    sliceVersion: ACOUSTIC_REFLEX_TRACE_SLICE_VERSION,
    limitations: [
      "PCM gerado localmente por receita; mídia pesada permanece ignorada no Git",
      "rótulos imitam uma política determinística e não preferência humana"
    ],
    clock: {
      clockId: "fixture-sample-clock",
      processId: "offline-exp-0014",
      resolutionMs: 1000 / config.audio.sampleRate,
      mappingMethod: "sampleStart/sampleRate"
    },
    label: { task: "acoustic-reflex-intent" }
  });
  recorder.registerStream({
    streamId: stream.streamId,
    role: "user-input-fixture",
    mediaRef: stream.mediaRef,
    sha256: `sha256:${stream.sha256}`,
    sampleRate: config.audio.sampleRate,
    channels: config.audio.channels,
    encoding: config.audio.encoding,
    sampleCount: stream.sampleCount
  });
  const featureManifestId = `features-${stream.streamId}`;
  const acousticEvents = events.filter((event) =>
    [
      "user.speech.started",
      "vad.control.window",
      "user.speech.paused"
    ].includes(event.type)
  );
  recorder.registerDerivedFeatureManifest({
    manifestId: featureManifestId,
    sourceStreamId: stream.streamId,
    extractor: {
      name: config.vad.name,
      version: config.vad.version,
      artifactHash: `sha256:${config.vad.modelSha256}`
    },
    artifactRef: "inline:training-trace.events",
    sha256: `sha256:${canonicalSha256(acousticEvents)}`
  });

  let state = createLocalAudioReflexState(config.reflex);
  const examples = [];
  for (const sourceEvent of acousticEvents) {
    const event = reflexEvent(sourceEvent);
    if (!event) {
      continue;
    }
    const previous = state;
    const decisionPoint = isAcousticReflexDecisionPoint(previous, event);
    const transition = reduceLocalAudioReflex(previous, event);
    state = transition.state;
    if (!decisionPoint) {
      continue;
    }
    const label = acousticReflexTeacherLabel(
      previous,
      event,
      transition
    );
    if (label === null) {
      continue;
    }
    const features = extractAcousticReflexFeatures(previous, event);
    const position = audioPosition(
      event,
      stream.streamId,
      stream.sampleCount,
      config.audio.vadWindowSamples
    );
    const atMs = position.sampleStart /
      config.audio.sampleRate * 1_000;
    const record = recorder.recordDecision({
      atMs,
      turnId: "turn-1",
      epoch: 0,
      event: {
        type: `local-audio-reflex.${event.type.toLowerCase()}`,
        source: "silero-vad-v6.2",
        audioPosition: position,
        payload: { reflexEvent: event }
      },
      context: {
        state: {
          assistantAudible: true,
          assistantPending: true,
          localAudioReflex: previous,
          features: {
            version: features.featureVersion,
            names: features.names,
            values: features.values
          }
        },
        derivedFeatureRefs: [featureManifestId]
      },
      policy: {
        id: "local-audio-reflex-deterministic-teacher",
        version: LOCAL_AUDIO_REFLEX_VERSION,
        mode: "shadow"
      },
      proposal: label,
      intents: [{
        type: label,
        origin: "local-audio-reflex-deterministic-teacher"
      }],
      transition: {
        previousStateVersion: transition.previousStateVersion,
        stateVersion: transition.state.version,
        reason: transition.reason
      },
      label: {
        value: label,
        source: {
          kind: "deterministic-invariant",
          ref: "local-audio-reflex",
          version: LOCAL_AUDIO_REFLEX_VERSION
        }
      }
    });
    examples.push({
      exampleId: `${stream.streamId}/${record.decisionId}`,
      family,
      split,
      rate: stream.rate,
      variant: variant.id,
      streamId: stream.streamId,
      eventId: record.eventId,
      contextId: record.contextId,
      decisionId: record.decisionId,
      sampleStart: position.sampleStart,
      sampleEnd: position.sampleEnd,
      eventType: event.type,
      features: [...features.values],
      label,
      labelSource: {
        kind: "deterministic-invariant",
        ref: "local-audio-reflex",
        version: LOCAL_AUDIO_REFLEX_VERSION
      }
    });
  }
  const trace = recorder.snapshot;
  const validation = validateTrainingTraceBundle(trace);
  if (!validation.valid) {
    throw new Error(
      `${stream.streamId}: trace inválido: ${validation.errors.join("; ")}`
    );
  }
  return { examples, trace, validation };
}

async function writeDeterministic(path, value, check) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    const observed = await readFile(path, "utf8").catch(() => null);
    if (observed !== content) {
      throw new Error(`artefato ausente ou divergente: ${path}`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function buildExp0014Dataset(options = {}) {
  const configPath = resolve(PROJECT_ROOT, options.config ?? DEFAULT_CONFIG);
  const configBytes = await readFile(configPath);
  const config = JSON.parse(configBytes.toString("utf8"));
  if (config.vad.modelSha256 !== SILERO_VAD_MODEL_SHA256) {
    throw new Error("hash Silero do experimento diverge do runtime");
  }
  const sourcePack = JSON.parse(await readFile(
    resolve(PROJECT_ROOT, config.source.pack),
    "utf8"
  ));
  const rates = sourcePack.rates;
  const declaredFamilies = new Set(
    sourcePack.utterances.map((item) => item.id)
  );
  const families = splitFamilies(config);
  if (families.some((entry) => !declaredFamilies.has(entry.family))) {
    throw new Error("split referencia família ausente do pack fonte");
  }
  const configHash = sha256(configBytes);
  const runtime = await createSileroVadShadowRuntime({
    mode: "offline-exp-0014",
    threshold: config.vad.threshold,
    onsetWindows: config.vad.onsetWindows,
    offThreshold: config.vad.offThreshold,
    offsetWindows: config.vad.offsetWindows
  });
  const examples = [];
  const streams = [];
  const traces = [];
  try {
    for (const { split, family } of families) {
      for (const rate of rates) {
        const token = rateToken(rate);
        const relativeSource = config.source.audioPattern
          .replace("{family}", family)
          .replace("{rateToken}", token);
        const sourceWave = await readFile(resolve(PROJECT_ROOT, relativeSource));
        const decoded = decodeWaveToPcm16(sourceWave, {
          targetSampleRate: config.audio.sampleRate
        });
        const tailSamples = config.audio.tailSilenceWindows *
          config.audio.vadWindowSamples;
        const sustainedPcm = appendSilence(decoded.pcm, tailSamples);
        const probeEvents = await controllerEvents(
          runtime,
          sustainedPcm,
          config
        );
        const start = probeEvents.find(
          (event) => event.type === "user.speech.started"
        );
        if (!start) {
          throw new Error(`${family}/${rate}: Silero não detectou fala`);
        }
        const marginalCutSample =
          start.payload.triggerSampleStart + config.audio.vadWindowSamples;
        const marginalPcm = appendSilence(
          decoded.pcm.subarray(0, marginalCutSample * 2),
          tailSamples
        );
        const variants = new Map([
          ["sustained", sustainedPcm],
          ["marginal", marginalPcm]
        ]);
        for (const variant of config.variants) {
          const pcm = variants.get(variant.id);
          if (!pcm) {
            throw new Error(`variante sem materializador: ${variant.id}`);
          }
          const streamId = `${family}-rate-${token}-${variant.id}`;
          const mediaRef =
            `eval/generated/exp-0014/audio/${streamId}.pcm`;
          const mediaPath = resolve(PROJECT_ROOT, mediaRef);
          await mkdir(dirname(mediaPath), { recursive: true });
          await writeFile(mediaPath, pcm);
          const stream = {
            streamId,
            family,
            split,
            rate,
            rateToken: token,
            variant: variant.id,
            mediaRef,
            sha256: sha256(pcm),
            sampleCount: pcm.byteLength / 2,
            source: {
              mediaRef: relativeSource,
              sha256: sha256(sourceWave),
              decodedPcmSha256: sha256(decoded.pcm),
              sourceSampleRate: decoded.source.sampleRate,
              sourceChannels: decoded.source.channels
            },
            recipe: {
              id: variant.recipe,
              triggerSampleStart: start.payload.triggerSampleStart,
              cutSample: variant.id === "marginal"
                ? marginalCutSample
                : null,
              tailSilenceSamples: tailSamples
            }
          };
          const events = await controllerEvents(runtime, pcm, config);
          const built = buildTraceAndExamples({
            config,
            configHash,
            events,
            family,
            split,
            stream,
            variant
          });
          const terminalLabels = new Set(
            built.examples.map((example) => example.label)
          );
          if (!terminalLabels.has(variant.expectedTerminalLabel)) {
            throw new Error(
              `${streamId}: não produziu ${variant.expectedTerminalLabel}`
            );
          }
          examples.push(...built.examples);
          streams.push({
            ...stream,
            traceSha256: canonicalSha256(built.trace),
            traceCounts: built.validation.counts,
            labels: Object.fromEntries(
              ACOUSTIC_REFLEX_CLASSES.map((label) => [
                label,
                built.examples.filter((example) => example.label === label)
                  .length
              ])
            )
          });
          traces.push(built.trace);
        }
      }
    }
  } finally {
    await runtime.close();
  }

  const splitSummary = Object.fromEntries(
    Object.keys(config.splits).map((split) => {
      const selected = examples.filter((example) => example.split === split);
      return [split, {
        families: [...config.splits[split]],
        streams: streams.filter((stream) => stream.split === split).length,
        examples: selected.length,
        labels: Object.fromEntries(
          ACOUSTIC_REFLEX_CLASSES.map((label) => [
            label,
            selected.filter((example) => example.label === label).length
          ])
        )
      }];
    })
  );
  const datasetCore = {
    schemaVersion: "acoustic-reflex-dataset-v1",
    datasetId: config.id,
    locale: config.locale,
    experimentConfig: {
      path: options.config ?? DEFAULT_CONFIG,
      sha256: `sha256:${configHash}`
    },
    sourcePack: {
      path: config.source.pack,
      sha256: `sha256:${canonicalSha256(sourcePack)}`,
      rates
    },
    retention: {
      policy: config.source.retention,
      rawAudioInGit: false,
      exactCheckpointReproducibleFromCommittedFeatures: true
    },
    extractor: {
      ...config.vad,
      modelSha256: `sha256:${config.vad.modelSha256}`
    },
    reflex: {
      version: LOCAL_AUDIO_REFLEX_VERSION,
      ...config.reflex
    },
    featureVersion: "acoustic-reflex-shadow-v0.1",
    featureNames: [...ACOUSTIC_REFLEX_FEATURES],
    classes: [...ACOUSTIC_REFLEX_CLASSES],
    splits: splitSummary,
    streams,
    examples
  };
  const dataset = {
    ...datasetCore,
    datasetSha256: `sha256:${canonicalSha256(datasetCore)}`
  };
  return { config, dataset, traces };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildExp0014Dataset(options);
  await writeDeterministic(
    resolve(PROJECT_ROOT, options.out),
    result.dataset,
    options.check
  );
  if (!options.check) {
    await writeDeterministic(
      resolve(PROJECT_ROOT, options.tracesOut),
      {
        schemaVersion: "acoustic-reflex-trace-pack-v1",
        datasetSha256: result.dataset.datasetSha256,
        traces: result.traces
      },
      false
    );
  }
  console.log(
    `EXP-0014 dataset: ${result.dataset.examples.length} exemplos, ` +
      `${result.dataset.streams.length} streams, ` +
      `${result.dataset.datasetSha256}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
