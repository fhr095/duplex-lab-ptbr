import {
  validateExp0018Dataset
} from "./exp-0018-context.mjs";
import {
  predictExp0018Checkpoint,
  validateExp0018Checkpoint
} from "./exp-0018-training.mjs";
import { canonicalSha256 } from "./factory/canonical-hash.mjs";
import {
  EXP0019_TTS_RANDOM_SEED,
  EXP0019_TTS_RANDOM_SEED_STRATEGY
} from "./exp-0019-boundary.mjs";

export const EXP0019_PLAN_SCHEMA =
  "exp-0019-causal-audio-plan-v1";
export const EXP0019_SCHEDULE_SCHEMA =
  "exp-0019-causal-schedule-v1";
export const EXP0019_SAMPLE_RATE = 16_000;
export const EXP0019_FIXED_GAP_SAMPLES = 1_600;
export const EXP0019_TARGET_OFFSET_SAMPLES = 1_280;
export const EXP0019_PROPOSAL_BUDGET_SAMPLES = 4_800;
export const EXP0019_DEFER_CAUSAL_EVIDENCE =
  "DEFER_CAUSAL_EVIDENCE";

export const EXP0019_SELECTED_BLOCKS = Object.freeze([
  "development-correction-version-label",
  "development-short-meeting-shirt"
]);

export const EXP0019_PAYLOAD_KEYS = Object.freeze([
  "assistantAudiblePrefixAtDecision",
  "assistantAudiblePrefixAvailableAtSample",
  "assistantSpeaking",
  "currentSample",
  "recentInbound",
  "recentInboundAvailableAtSample",
  "targetAvailableAtSample",
  "targetText"
]);

export const EXP0019_FROZEN_SIGNATURE = deepFreeze({
  B0: {
    correct: 4,
    observations: 8
  },
  B1: {
    correct: 7,
    observations: 8,
    directedCorrect: 4,
    directedObservations: 4,
    backgroundCorrect: 3,
    backgroundObservations: 4
  },
  paired: {
    pairs: 4,
    wins: 3,
    losses: 0,
    ties: 1
  },
  knownMiss: {
    pairRootId:
      "development-correction-version-label-target-development-green-label",
    targetSurfaceId: "target-development-green-label",
    contextSurfaceId: "context-development-version-over-label",
    expected: "BACKGROUND_OR_NOT_DIRECTED",
    predicted: "DIRECTED_TO_ASSISTANT"
  }
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const LABELS = Object.freeze([
  "BACKGROUND_OR_NOT_DIRECTED",
  "DIRECTED_TO_ASSISTANT"
]);
const ARM_NAMES = Object.freeze(["B0", "B1"]);
const NON_ASSISTANT_VOICE_STYLE = "M4";
const ASSISTANT_VOICE_STYLE = "F4";
const NEUTRAL_TAIL_TEXT =
  "Certo, continuo falando por mais alguns instantes enquanto organizo " +
  "cuidadosamente os próximos detalhes desta explicação até concluir o trecho.";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, expected) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...expected].sort());
}

function validHash(value) {
  return HASH_PATTERN.test(value ?? "");
}

function validText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validSample(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function withoutHash(value, key) {
  const core = structuredClone(value ?? {});
  delete core[key];
  return core;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function streamId(kind, surfaceId) {
  return `exp0019-${kind}-${surfaceId}`;
}

function relativePath(kind, surfaceId) {
  const folder = kind === "assistant" ? "assistants" : `${kind}s`;
  return `eval/generated/exp-0019/audio/${folder}/${surfaceId}.wav`;
}

function predictionById(report, armName) {
  return new Map((report?.predictions?.[armName] ?? []).map(
    (prediction) => [prediction.exampleId, prediction]
  ));
}

function signatureFromScenes(scenes) {
  const observations = Object.fromEntries(ARM_NAMES.map((armName) => [
    armName,
    scenes.map((scene) => ({
      expected: scene.scorer.label,
      predicted: scene.frozenTrace[armName].predicted,
      pairRootId: scene.scorer.pairRootId
    }))
  ]));
  const b0Correct = observations.B0.filter(
    (item) => item.expected === item.predicted
  ).length;
  const b1Correct = observations.B1.filter(
    (item) => item.expected === item.predicted
  ).length;
  const directed = observations.B1.filter(
    (item) => item.expected === "DIRECTED_TO_ASSISTANT"
  );
  const background = observations.B1.filter(
    (item) => item.expected === "BACKGROUND_OR_NOT_DIRECTED"
  );
  const byPair = Map.groupBy(observations.B1, (item) => item.pairRootId);
  const b0ByPair = Map.groupBy(observations.B0, (item) => item.pairRootId);
  const outcomes = [...byPair.entries()].map(([pairRootId, b1]) => {
    const b0 = b0ByPair.get(pairRootId) ?? [];
    const B0Correct = b0.filter(
      (item) => item.expected === item.predicted
    ).length;
    const B1Correct = b1.filter(
      (item) => item.expected === item.predicted
    ).length;
    return B1Correct > B0Correct ? "win" :
      B1Correct < B0Correct ? "loss" : "tie";
  });
  const knownMiss = scenes.find((scene) =>
    scene.scorer.expectedMiss === true
  );
  return {
    B0: { correct: b0Correct, observations: scenes.length },
    B1: {
      correct: b1Correct,
      observations: scenes.length,
      directedCorrect: directed.filter(
        (item) => item.expected === item.predicted
      ).length,
      directedObservations: directed.length,
      backgroundCorrect: background.filter(
        (item) => item.expected === item.predicted
      ).length,
      backgroundObservations: background.length
    },
    paired: {
      pairs: byPair.size,
      wins: outcomes.filter((item) => item === "win").length,
      losses: outcomes.filter((item) => item === "loss").length,
      ties: outcomes.filter((item) => item === "tie").length
    },
    knownMiss: knownMiss ? {
      pairRootId: knownMiss.scorer.pairRootId,
      targetSurfaceId: knownMiss.scorer.targetSurfaceId,
      contextSurfaceId: knownMiss.scorer.contextSurfaceId,
      expected: knownMiss.scorer.label,
      predicted: knownMiss.frozenTrace.B1.predicted
    } : null
  };
}

function sourceBindingsValid(bindings) {
  const records = [
    [bindings?.preregistration, false],
    [bindings?.developmentDataset, true],
    [bindings?.developmentReport, true],
    [bindings?.checkpoint, true]
  ];
  return records.every(([record, canonicalRequired]) =>
    exactKeys(record, canonicalRequired
      ? ["path", "fileSha256", "canonicalSha256"]
      : ["path", "fileSha256"]) &&
    validText(record.path) &&
    validHash(record.fileSha256) &&
    (!canonicalRequired || validHash(record.canonicalSha256))
  );
}

function makeStreams(examples) {
  const targets = new Map();
  const contexts = new Map();
  for (const example of examples) {
    const target = targets.get(example.targetSurfaceId);
    if (target) {
      assert(target.text === example.modelInput.targetText,
        `${example.targetSurfaceId}: texto de target divergiu`);
    } else {
      targets.set(example.targetSurfaceId, {
        text: example.modelInput.targetText
      });
    }
    const context = contexts.get(example.contextSurfaceId);
    const candidate = {
      prefix: example.modelInput.assistantAudiblePrefixAtDecision,
      inbound: example.modelInput.recentInbound[0]
    };
    if (context) {
      assert(same(context, candidate),
        `${example.contextSurfaceId}: textos de contexto divergiram`);
    } else {
      contexts.set(example.contextSurfaceId, candidate);
    }
  }
  const streams = [];
  for (const [surfaceId, target] of targets) {
    streams.push({
      streamId: streamId("target", surfaceId),
      kind: "target",
      surfaceId,
      speakerSlot: "non-assistant",
      relativePath: relativePath("target", surfaceId),
      text: target.text,
      segments: null,
      reuseCount: 2
    });
  }
  for (const [surfaceId, context] of contexts) {
    streams.push(
      {
        streamId: streamId("inbound", surfaceId),
        kind: "inbound",
        surfaceId,
        speakerSlot: "non-assistant",
        relativePath: relativePath("inbound", surfaceId),
        text: context.inbound,
        segments: null,
        reuseCount: 2
      },
      {
        streamId: streamId("assistant", surfaceId),
        kind: "assistant",
        surfaceId,
        speakerSlot: "assistant",
        relativePath: relativePath("assistant", surfaceId),
        text: null,
        segments: [
          {
            kind: "audible-prefix",
            text: context.prefix,
            modelVisible: true
          },
          {
            kind: "neutral-tail",
            text: NEUTRAL_TAIL_TEXT,
            modelVisible: false
          }
        ],
        reuseCount: 2
      }
    );
  }
  return streams.toSorted((left, right) =>
    left.streamId.localeCompare(right.streamId)
  );
}

function planStructureErrors(plan) {
  const errors = [];
  if (
    plan?.schemaVersion !== EXP0019_PLAN_SCHEMA ||
    plan?.experimentId !== "EXP-0019" ||
    plan?.status !== "instrumentation-only-audio-not-materialized"
  ) {
    errors.push("identidade ou status do plano incompatível");
  }
  if (
    plan?.planSha256 !==
      `sha256:${canonicalSha256(withoutHash(plan, "planSha256"))}`
  ) {
    errors.push("planSha256 divergente");
  }
  if (!sourceBindingsValid(plan?.bindings)) {
    errors.push("bindings de fonte inválidas");
  }
  if (
    !same(plan?.selection?.crossBlockRootIds, EXP0019_SELECTED_BLOCKS) ||
    plan?.selection?.independentUnit !== "complete-crossed-2x2-block" ||
    plan?.selection?.replacementAllowed !== false
  ) {
    errors.push("seleção dos dois blocos divergiu");
  }
  if (
    plan?.audio?.format?.container !== "WAV" ||
    plan?.audio?.format?.encoding !== "PCM16" ||
    plan?.audio?.format?.channels !== 1 ||
    plan?.audio?.format?.sampleRate !== EXP0019_SAMPLE_RATE ||
    plan?.audio?.materialized !== false ||
    plan?.audio?.rawAudioCommitAllowed !== false ||
    plan?.audio?.synthesis?.engine !== "Supertonic-cached-local" ||
    plan?.audio?.synthesis?.networkAllowed !== false ||
    plan?.audio?.synthesis?.paidApiCallsAllowed !== 0 ||
    plan?.audio?.synthesis?.randomSeedBase !==
      EXP0019_TTS_RANDOM_SEED ||
    plan?.audio?.synthesis?.randomSeedStrategy !==
      EXP0019_TTS_RANDOM_SEED_STRATEGY ||
    plan?.audio?.synthesis?.speakerSlotsMustDiffer !== true ||
    !same(plan?.audio?.synthesis?.voiceStyles, {
      assistant: ASSISTANT_VOICE_STYLE,
      nonAssistant: NON_ASSISTANT_VOICE_STYLE
    })
  ) {
    errors.push("contrato de áudio incompatível");
  }
  const streams = Array.isArray(plan?.audio?.streams)
    ? plan.audio.streams : [];
  const streamCounts = Object.fromEntries(
    ["target", "inbound", "assistant"].map((kind) => [
      kind,
      streams.filter((stream) => stream?.kind === kind).length
    ])
  );
  if (
    streams.length !== 12 ||
    !same(streamCounts, { target: 4, inbound: 4, assistant: 4 }) ||
    new Set(streams.map((stream) => stream?.streamId)).size !== 12 ||
    new Set(streams.map((stream) => stream?.relativePath)).size !== 12 ||
    streams.some((stream) =>
      stream?.reuseCount !== 2 ||
      !validText(stream?.relativePath) ||
      !stream.relativePath.startsWith("eval/generated/exp-0019/audio/")
    )
  ) {
    errors.push("plano precisa conter doze streams balanceados");
  }
  for (const stream of streams) {
    const commonValid = exactKeys(stream, [
      "kind",
      "relativePath",
      "reuseCount",
      "segments",
      "speakerSlot",
      "streamId",
      "surfaceId",
      "text"
    ]) &&
      validText(stream.surfaceId) &&
      stream.streamId === streamId(stream.kind, stream.surfaceId) &&
      stream.relativePath === relativePath(stream.kind, stream.surfaceId);
    if (!commonValid) {
      errors.push(`${stream?.streamId ?? "stream"}: identidade inválida`);
      continue;
    }
    if (stream.kind === "assistant") {
      if (
        stream.speakerSlot !== "assistant" ||
        stream.text !== null ||
        !Array.isArray(stream.segments) ||
        stream.segments.length !== 2 ||
        !exactKeys(stream.segments[0], ["kind", "modelVisible", "text"]) ||
        stream.segments[0].kind !== "audible-prefix" ||
        stream.segments[0].modelVisible !== true ||
        !validText(stream.segments[0].text) ||
        !exactKeys(stream.segments[1], ["kind", "modelVisible", "text"]) ||
        stream.segments[1].kind !== "neutral-tail" ||
        stream.segments[1].modelVisible !== false ||
        stream.segments[1].text !== NEUTRAL_TAIL_TEXT
      ) {
        errors.push(`${stream.streamId}: stream do assistente inválido`);
      }
    } else if (
      !["target", "inbound"].includes(stream.kind) ||
      stream.speakerSlot !== "non-assistant" ||
      !validText(stream.text) ||
      stream.segments !== null
    ) {
      errors.push(`${stream.streamId}: stream não-assistente inválido`);
    }
  }
  if (
    plan?.schedule?.sampleRate !== EXP0019_SAMPLE_RATE ||
    plan?.schedule?.fixedGapSamples !== EXP0019_FIXED_GAP_SAMPLES ||
    plan?.schedule?.targetAfterPrefixSamples !==
      EXP0019_TARGET_OFFSET_SAMPLES ||
    plan?.schedule?.assistantTailAfterTargetSamplesAtLeast !==
      EXP0019_PROPOSAL_BUDGET_SAMPLES ||
    !same(plan?.schedule?.eventOrder, [
      "inbound",
      "fixed-gap",
      "assistant-prefix",
      "assistant-tail+target-overlap"
    ])
  ) {
    errors.push("schedule causal incompatível");
  }
  if (
    !same(plan?.runtime?.payloadAllowlist, EXP0019_PAYLOAD_KEYS) ||
    plan?.runtime?.deferDecision !== EXP0019_DEFER_CAUSAL_EVIDENCE ||
    plan?.runtime?.futureTextAllowed !== false ||
    plan?.runtime?.futurePcmAllowed !== false ||
    plan?.runtime?.classifierRunsBeforeCompleteEvidence !== 0 ||
    plan?.runtime?.canProduceEffects !== false
  ) {
    errors.push("contrato causal do runtime incompatível");
  }
  const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
  if (
    scenes.length !== 8 ||
    new Set(scenes.map((scene) => scene?.sceneId)).size !== 8 ||
    new Set(scenes.map(
      (scene) => scene?.scorer?.crossBlockRootId
    )).size !== 2 ||
    new Set(scenes.map(
      (scene) => scene?.scorer?.pairRootId
    )).size !== 4 ||
    new Set(scenes.map(
      (scene) => scene?.scorer?.targetSurfaceId
    )).size !== 4 ||
    new Set(scenes.map(
      (scene) => scene?.scorer?.contextSurfaceId
    )).size !== 4
  ) {
    errors.push("matriz precisa conter dois blocos, quatro pares e oito cenas");
  }
  const streamIds = new Set(streams.map((stream) => stream.streamId));
  const streamsById = new Map(streams.map((stream) => [
    stream.streamId,
    stream
  ]));
  for (const scene of scenes) {
    const inboundStream = streamsById.get(scene?.streamBindings?.inbound);
    const assistantStream = streamsById.get(scene?.streamBindings?.assistant);
    const targetStream = streamsById.get(scene?.streamBindings?.target);
    if (
      !EXP0019_SELECTED_BLOCKS.includes(
        scene?.scorer?.crossBlockRootId
      ) ||
      !LABELS.includes(scene?.scorer?.label) ||
      !exactKeys(scene?.oracleText, [
        "assistantAudiblePrefixAtDecision",
        "recentInbound",
        "targetText"
      ]) ||
      !validText(scene.oracleText.assistantAudiblePrefixAtDecision) ||
      !Array.isArray(scene.oracleText.recentInbound) ||
      scene.oracleText.recentInbound.length !== 1 ||
      !validText(scene.oracleText.recentInbound[0]) ||
      !validText(scene.oracleText.targetText) ||
      !Object.values(scene?.streamBindings ?? {}).every(
        (id) => streamIds.has(id)
      ) ||
      inboundStream?.kind !== "inbound" ||
      inboundStream?.surfaceId !== scene?.scorer?.contextSurfaceId ||
      inboundStream?.text !== scene?.oracleText?.recentInbound?.[0] ||
      assistantStream?.kind !== "assistant" ||
      assistantStream?.surfaceId !== scene?.scorer?.contextSurfaceId ||
      assistantStream?.segments?.[0]?.text !==
        scene?.oracleText?.assistantAudiblePrefixAtDecision ||
      targetStream?.kind !== "target" ||
      targetStream?.surfaceId !== scene?.scorer?.targetSurfaceId ||
      targetStream?.text !== scene?.oracleText?.targetText ||
      scene?.scheduleBindingKey !==
        `target-pair-${scene?.scorer?.targetSurfaceId}` ||
      !ARM_NAMES.every((armName) =>
        Array.isArray(scene?.frozenTrace?.[armName]?.featureValues) &&
        scene.frozenTrace[armName].featureValues.length === 21 &&
        Number.isFinite(
          scene.frozenTrace[armName].backgroundProbability
        ) &&
        LABELS.includes(scene.frozenTrace[armName].predicted)
      )
    ) {
      errors.push(`${scene?.sceneId ?? "cena"}: contrato inválido`);
    }
  }
  const pairs = Map.groupBy(scenes, (scene) => scene?.scorer?.pairRootId);
  for (const [pairRootId, descendants] of pairs) {
    if (
      descendants.length !== 2 ||
      new Set(descendants.map((scene) => scene.scorer.label)).size !== 2 ||
      new Set(descendants.map(
        (scene) => scene.scorer.targetSurfaceId
      )).size !== 1 ||
      new Set(descendants.map(
        (scene) => scene.streamBindings.target
      )).size !== 1 ||
      new Set(descendants.map(
        (scene) => scene.scheduleBindingKey
      )).size !== 1 ||
      new Set(descendants.map(
        (scene) => scene.oracleText.targetText
      )).size !== 1
    ) {
      errors.push(`${pairRootId}: igualdade pareada inválida`);
    }
  }
  for (const surfaceKey of ["targetSurfaceId", "contextSurfaceId"]) {
    const groups = Map.groupBy(scenes, (scene) =>
      scene?.scorer?.[surfaceKey]
    );
    if ([...groups.values()].some((descendants) =>
      descendants.length !== 2 ||
      new Set(descendants.map((scene) => scene.scorer.label)).size !== 2
    )) {
      errors.push(`${surfaceKey}: superfície revela rótulo`);
    }
  }
  if (!same(signatureFromScenes(scenes), EXP0019_FROZEN_SIGNATURE)) {
    errors.push("assinatura B0/B1 congelada divergiu");
  }
  if (
    plan?.summary?.crossBlocks !== 2 ||
    plan?.summary?.pairRoots !== 4 ||
    plan?.summary?.scenes !== 8 ||
    plan?.summary?.targetSurfaces !== 4 ||
    plan?.summary?.contextSurfaces !== 4 ||
    plan?.summary?.streams !== 12 ||
    !same(plan?.summary?.frozenSignature, EXP0019_FROZEN_SIGNATURE) ||
    plan?.authority?.mode !== "offline-shadow-only" ||
    plan?.authority?.canProduceEffects !== false
  ) {
    errors.push("sumário ou autoridade incompatível");
  }
  return errors;
}

export function buildExp0019CausalAudioPlan(input = {}) {
  const datasetValidation = validateExp0018Dataset(
    input.developmentDataset
  );
  assert(datasetValidation.valid,
    `dataset EXP-0018 inválido: ${datasetValidation.errors.join("; ")}`);
  assert(input.developmentDataset.role === "development",
    "EXP-0019 exige o dataset development do EXP-0018");
  const checkpointValidation = validateExp0018Checkpoint(input.checkpoint);
  assert(checkpointValidation.valid,
    `checkpoint EXP-0018 inválido: ${checkpointValidation.errors.join("; ")}`);
  assert(
    input.developmentReport?.developmentReportSha256 ===
      `sha256:${canonicalSha256(withoutHash(
        input.developmentReport,
        "developmentReportSha256"
      ))}`,
    "report EXP-0018 tem hash canônico inválido"
  );
  assert(
    input.developmentReport?.decision ===
      "PASS_TO_MINIMAL_CAUSAL_AUDIO_SCREEN" &&
    input.developmentReport?.bindings?.checkpointSha256 ===
      input.checkpoint.checkpointSha256 &&
    input.developmentReport?.bindings
      ?.developmentDatasetCanonicalSha256 ===
      input.developmentDataset.datasetSha256,
    "report EXP-0018 não autoriza ou não vincula este bridge"
  );
  assert(sourceBindingsValid(input.bindings),
    "bindings físicos das fontes são obrigatórios");
  assert(
    input.bindings.developmentDataset.canonicalSha256 ===
      input.developmentDataset.datasetSha256 &&
    input.bindings.developmentReport.canonicalSha256 ===
      input.developmentReport.developmentReportSha256 &&
    input.bindings.checkpoint.canonicalSha256 ===
      input.checkpoint.checkpointSha256,
    "bindings canônicos divergem dos artefatos carregados"
  );
  const preregistrationText = String(input.preregistrationText ?? "");
  for (const token of [
    ...EXP0019_SELECTED_BLOCKS,
    "`B0`: 4/8",
    "`B1`: 7/8",
    "80 ms",
    "DEFER_CAUSAL_EVIDENCE"
  ]) {
    assert(preregistrationText.includes(token),
      `pré-registro não contém compromisso: ${token}`);
  }

  const selected = input.developmentDataset.examples.filter((example) =>
    EXP0019_SELECTED_BLOCKS.includes(example.crossBlockRootId)
  ).toSorted((left, right) => left.exampleId.localeCompare(right.exampleId));
  assert(selected.length === 8,
    "seleção EXP-0019 precisa produzir exatamente oito cenas");
  for (const blockId of EXP0019_SELECTED_BLOCKS) {
    assert(selected.filter(
      (example) => example.crossBlockRootId === blockId
    ).length === 4, `${blockId}: bloco 2x2 incompleto`);
  }
  const reportPredictions = Object.fromEntries(ARM_NAMES.map((armName) => [
    armName,
    predictionById(input.developmentReport, armName)
  ]));
  const streams = makeStreams(selected);
  const scenes = selected.map((example) => {
    const frozenTrace = {};
    for (const armName of ARM_NAMES) {
      const stored = reportPredictions[armName].get(example.exampleId);
      const recomputed = predictExp0018Checkpoint(
        input.checkpoint,
        example,
        armName
      );
      assert(same(stored, recomputed),
        `${example.exampleId}/${armName}: trace report/checkpoint divergiu`);
      const arm = input.checkpoint.arms[armName];
      frozenTrace[armName] = {
        contextEnabled: arm.contextEnabled,
        modelSha256: arm.modelSha256,
        threshold: arm.threshold,
        featureValues: [...stored.featureValues],
        backgroundProbability: stored.backgroundProbability,
        rawPredicted: stored.rawPredicted,
        predicted: stored.predicted
      };
    }
    const expectedMiss =
      example.pairRootId === EXP0019_FROZEN_SIGNATURE.knownMiss.pairRootId &&
      example.contextSurfaceId ===
        EXP0019_FROZEN_SIGNATURE.knownMiss.contextSurfaceId;
    return {
      sceneId: `exp0019-${example.exampleId}`,
      scorer: {
        exampleId: example.exampleId,
        pairRootId: example.pairRootId,
        crossBlockRootId: example.crossBlockRootId,
        family: example.family,
        label: example.label,
        targetSurfaceId: example.targetSurfaceId,
        contextSurfaceId: example.contextSurfaceId,
        expectedMiss
      },
      oracleText: {
        assistantAudiblePrefixAtDecision:
          example.modelInput.assistantAudiblePrefixAtDecision,
        recentInbound: [...example.modelInput.recentInbound],
        targetText: example.modelInput.targetText
      },
      streamBindings: {
        inbound: streamId("inbound", example.contextSurfaceId),
        assistant: streamId("assistant", example.contextSurfaceId),
        target: streamId("target", example.targetSurfaceId)
      },
      scheduleBindingKey: `target-pair-${example.targetSurfaceId}`,
      frozenTrace
    };
  });
  const core = {
    schemaVersion: EXP0019_PLAN_SCHEMA,
    experimentId: "EXP-0019",
    status: "instrumentation-only-audio-not-materialized",
    bindings: structuredClone(input.bindings),
    selection: {
      independentUnit: "complete-crossed-2x2-block",
      crossBlockRootIds: [...EXP0019_SELECTED_BLOCKS],
      replacementAllowed: false
    },
    audio: {
      format: {
        container: "WAV",
        encoding: "PCM16",
        channels: 1,
        sampleRate: EXP0019_SAMPLE_RATE
      },
      materialized: false,
      rawAudioCommitAllowed: false,
      synthesis: {
        engine: "Supertonic-cached-local",
        networkAllowed: false,
        paidApiCallsAllowed: 0,
        randomSeedBase: EXP0019_TTS_RANDOM_SEED,
        randomSeedStrategy: EXP0019_TTS_RANDOM_SEED_STRATEGY,
        targetAndInboundSpeakerSlot: "non-assistant",
        assistantSpeakerSlot: "assistant",
        speakerSlotsMustDiffer: true,
        voiceStyles: {
          assistant: ASSISTANT_VOICE_STYLE,
          nonAssistant: NON_ASSISTANT_VOICE_STYLE
        }
      },
      pairEquality: {
        targetStreamReuse: "same-path-and-future-byte-hash",
        normalizedInboundBoundary: true,
        normalizedAssistantPrefixBoundary: true,
        scheduleMustMatchWithinPair: true
      },
      streams
    },
    schedule: {
      sampleRate: EXP0019_SAMPLE_RATE,
      eventOrder: [
        "inbound",
        "fixed-gap",
        "assistant-prefix",
        "assistant-tail+target-overlap"
      ],
      fixedGapSamples: EXP0019_FIXED_GAP_SAMPLES,
      targetAfterPrefixSamples: EXP0019_TARGET_OFFSET_SAMPLES,
      assistantTailAfterTargetSamplesAtLeast:
        EXP0019_PROPOSAL_BUDGET_SAMPLES,
      inboundTextReleaseBoundary: "inboundEndSample",
      assistantPrefixTextReleaseBoundary: "assistantPrefixEndSample",
      targetTextReleaseBoundary: "targetEndSample"
    },
    runtime: {
      payloadAllowlist: [...EXP0019_PAYLOAD_KEYS],
      deferDecision: EXP0019_DEFER_CAUSAL_EVIDENCE,
      futureTextAllowed: false,
      futurePcmAllowed: false,
      classifierRunsBeforeCompleteEvidence: 0,
      proposalsPerArmPerScene: 1,
      arms: {
        B0: "target-only-frozen-exp-0018",
        B1: "target-plus-context-frozen-exp-0018"
      },
      canProduceEffects: false
    },
    scenes,
    summary: {
      crossBlocks: 2,
      pairRoots: 4,
      scenes: 8,
      targetSurfaces: 4,
      contextSurfaces: 4,
      streams: 12,
      frozenSignature: structuredClone(EXP0019_FROZEN_SIGNATURE)
    },
    authority: {
      mode: "offline-shadow-only",
      canProduceEffects: false
    }
  };
  const plan = deepFreeze({
    ...core,
    planSha256: `sha256:${canonicalSha256(core)}`
  });
  const errors = planStructureErrors(plan);
  assert(errors.length === 0,
    `plano EXP-0019 inválido: ${errors.join("; ")}`);
  return plan;
}

export function validateExp0019CausalAudioPlan(plan, sources = null) {
  let errors;
  try {
    errors = planStructureErrors(plan);
  } catch (error) {
    errors = [`plano malformado: ${error.message}`];
  }
  if (sources) {
    try {
      const rebuilt = buildExp0019CausalAudioPlan(sources);
      if (!same(plan, rebuilt)) {
        errors.push("plano diverge da reconstrução autoritativa");
      }
    } catch (error) {
      errors.push(`reconstrução autoritativa falhou: ${error.message}`);
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function createExp0019CausalSchedule(input = {}) {
  const counts = {
    inboundSlotSamples: input.inboundSlotSamples,
    assistantPrefixSlotSamples: input.assistantPrefixSlotSamples,
    assistantTotalSlotSamples: input.assistantTotalSlotSamples,
    targetSampleCount: input.targetSampleCount,
    targetOnsetSample: input.targetOnsetSample
  };
  for (const [name, value] of Object.entries(counts)) {
    assert(validSample(value), `${name} precisa ser amostra inteira não negativa`);
  }
  assert(counts.inboundSlotSamples > 0,
    "inboundSlotSamples precisa ser positivo");
  assert(counts.assistantPrefixSlotSamples > 0,
    "assistantPrefixSlotSamples precisa ser positivo");
  assert(counts.targetSampleCount > 0,
    "targetSampleCount precisa ser positivo");
  assert(counts.targetOnsetSample < counts.targetSampleCount,
    "targetOnsetSample precisa estar dentro do target");
  assert(
    counts.assistantTotalSlotSamples > counts.assistantPrefixSlotSamples,
    "stream do assistente precisa conter cauda"
  );
  const inboundStartSample = 0;
  const inboundEndSample = counts.inboundSlotSamples;
  const assistantStartSample =
    inboundEndSample + EXP0019_FIXED_GAP_SAMPLES;
  const assistantPrefixEndSample =
    assistantStartSample + counts.assistantPrefixSlotSamples;
  const targetStartSample =
    assistantPrefixEndSample + EXP0019_TARGET_OFFSET_SAMPLES;
  const targetEndSample = targetStartSample + counts.targetSampleCount;
  const assistantEndSample =
    assistantStartSample + counts.assistantTotalSlotSamples;
  assert(
    assistantEndSample >=
      targetEndSample + EXP0019_PROPOSAL_BUDGET_SAMPLES,
    "cauda do assistente não cobre target e orçamento de proposta"
  );
  return deepFreeze({
    schemaVersion: EXP0019_SCHEDULE_SCHEMA,
    sampleRate: EXP0019_SAMPLE_RATE,
    inbound: {
      startSample: inboundStartSample,
      endSample: inboundEndSample
    },
    gap: {
      startSample: inboundEndSample,
      endSample: assistantStartSample
    },
    assistant: {
      startSample: assistantStartSample,
      prefixEndSample: assistantPrefixEndSample,
      tailStartSample: assistantPrefixEndSample,
      endSample: assistantEndSample
    },
    target: {
      startSample: targetStartSample,
      onsetSample: targetStartSample + counts.targetOnsetSample,
      endSample: targetEndSample
    },
    availability: {
      recentInboundAvailableAtSample: inboundEndSample,
      assistantAudiblePrefixAvailableAtSample:
        assistantPrefixEndSample,
      targetAvailableAtSample: targetEndSample
    },
    futurePcmSamplesUsed: 0
  });
}

export function createExp0019CausalPayload(
  oracleText,
  schedule,
  currentSample
) {
  assert(schedule?.schemaVersion === EXP0019_SCHEDULE_SCHEMA,
    "schedule EXP-0019 inválido");
  assert(validSample(currentSample),
    "currentSample precisa ser amostra inteira não negativa");
  assert(
    exactKeys(oracleText, [
      "assistantAudiblePrefixAtDecision",
      "recentInbound",
      "targetText"
    ]) &&
    validText(oracleText.assistantAudiblePrefixAtDecision) &&
    Array.isArray(oracleText.recentInbound) &&
    oracleText.recentInbound.length === 1 &&
    validText(oracleText.recentInbound[0]) &&
    validText(oracleText.targetText),
    "oracleText precisa conter somente os três textos canônicos"
  );
  const availability = schedule.availability;
  return deepFreeze({
    assistantAudiblePrefixAtDecision:
      currentSample >=
        availability.assistantAudiblePrefixAvailableAtSample
        ? oracleText.assistantAudiblePrefixAtDecision : null,
    assistantAudiblePrefixAvailableAtSample:
      availability.assistantAudiblePrefixAvailableAtSample,
    assistantSpeaking: true,
    currentSample,
    recentInbound:
      currentSample >= availability.recentInboundAvailableAtSample
        ? [...oracleText.recentInbound] : [],
    recentInboundAvailableAtSample:
      availability.recentInboundAvailableAtSample,
    targetAvailableAtSample: availability.targetAvailableAtSample,
    targetText:
      currentSample >= availability.targetAvailableAtSample
        ? oracleText.targetText : null
  });
}

export function validateExp0019CausalPayload(payload, options = {}) {
  const errors = [];
  if (!exactKeys(payload, EXP0019_PAYLOAD_KEYS)) {
    errors.push("payload contém chaves ausentes ou proibidas");
    return deepFreeze({ valid: false, errors });
  }
  const samples = [
    payload.recentInboundAvailableAtSample,
    payload.assistantAudiblePrefixAvailableAtSample,
    payload.targetAvailableAtSample,
    payload.currentSample
  ];
  if (
    samples.some((value) => !validSample(value)) ||
    payload.recentInboundAvailableAtSample >
      payload.assistantAudiblePrefixAvailableAtSample ||
    payload.assistantAudiblePrefixAvailableAtSample >
      payload.targetAvailableAtSample ||
    payload.assistantSpeaking !== true
  ) {
    errors.push("amostras, ordem causal ou assistantSpeaking inválidos");
  }
  const expected = options.expectedAvailability;
  if (expected && !same({
    recentInboundAvailableAtSample:
      payload.recentInboundAvailableAtSample,
    assistantAudiblePrefixAvailableAtSample:
      payload.assistantAudiblePrefixAvailableAtSample,
    targetAvailableAtSample: payload.targetAvailableAtSample
  }, expected)) {
    errors.push("disponibilidades divergem do schedule autoritativo");
  }
  const inboundPresent = Array.isArray(payload.recentInbound) &&
    payload.recentInbound.length === 1 &&
    validText(payload.recentInbound[0]);
  const inboundAbsent = Array.isArray(payload.recentInbound) &&
    payload.recentInbound.length === 0;
  if (!inboundPresent && !inboundAbsent) {
    errors.push("recentInbound precisa estar ausente ou conter um texto");
  }
  const prefixPresent = validText(
    payload.assistantAudiblePrefixAtDecision
  );
  const prefixAbsent = payload.assistantAudiblePrefixAtDecision === null;
  if (!prefixPresent && !prefixAbsent) {
    errors.push("prefixo precisa estar ausente ou conter texto");
  }
  const targetPresent = validText(payload.targetText);
  const targetAbsent = payload.targetText === null;
  if (!targetPresent && !targetAbsent) {
    errors.push("target precisa estar ausente ou conter texto");
  }
  for (const [present, boundary, name] of [
    [inboundPresent, payload.recentInboundAvailableAtSample, "inbound"],
    [prefixPresent,
      payload.assistantAudiblePrefixAvailableAtSample, "prefixo"],
    [targetPresent, payload.targetAvailableAtSample, "target"]
  ]) {
    if (present && payload.currentSample < boundary) {
      errors.push(`${name}: texto futuro no payload`);
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function runExp0019CausalAdapter(payload, options = {}) {
  const validation = validateExp0019CausalPayload(payload, options);
  if (!validation.valid) {
    return deepFreeze({
      status: "INVALID_CAUSAL_PAYLOAD",
      classifierExecuted: false,
      inferenceCountDelta: 0,
      canProduceEffects: false,
      errors: [...validation.errors]
    });
  }
  const missingEvidence = [];
  if (payload.recentInbound.length !== 1) {
    missingEvidence.push("recentInbound");
  }
  if (!validText(payload.assistantAudiblePrefixAtDecision)) {
    missingEvidence.push("assistantAudiblePrefixAtDecision");
  }
  if (!validText(payload.targetText)) {
    missingEvidence.push("targetText");
  }
  if (missingEvidence.length > 0) {
    return deepFreeze({
      status: EXP0019_DEFER_CAUSAL_EVIDENCE,
      classifierExecuted: false,
      inferenceCountDelta: 0,
      canProduceEffects: false,
      missingEvidence
    });
  }
  assert(ARM_NAMES.includes(options.armName),
    "armName precisa ser B0 ou B1");
  assert(typeof options.classify === "function",
    "classify precisa ser função");
  const modelInput = options.armName === "B0" ? {
    assistantSpeaking: true,
    targetText: payload.targetText
  } : {
    assistantAudiblePrefixAtDecision:
      payload.assistantAudiblePrefixAtDecision,
    assistantSpeaking: true,
    recentInbound: [...payload.recentInbound],
    targetText: payload.targetText
  };
  const proposal = options.classify(deepFreeze(modelInput));
  return deepFreeze({
    status: "SHADOW_PROPOSAL",
    classifierExecuted: true,
    inferenceCountDelta: 1,
    canProduceEffects: false,
    armName: options.armName,
    modelInput,
    proposal
  });
}
