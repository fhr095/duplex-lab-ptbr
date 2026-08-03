export const CONTEXT_RELEVANCE_SHADOW_VERSION =
  "exp-0019-context-relevance-shadow-v1";

export const CONTEXT_RELEVANCE_CHECKPOINT_VERSION =
  "exp-0019-browser-context-relevance-checkpoint-v1";

export const CONTEXT_RELEVANCE_FEATURE_VERSION =
  "exp-0018-context-relational-features-v1";

export const CONTEXT_RELEVANCE_CLASSES = Object.freeze([
  "BACKGROUND_OR_NOT_DIRECTED",
  "DIRECTED_TO_ASSISTANT"
]);

export const CONTEXT_RELEVANCE_FEATURES = Object.freeze([
  "bias",
  "targetPresent",
  "targetCharacterLength",
  "targetTokenCount",
  "targetHasQuestion",
  "targetHasNegation",
  "targetHasCorrectionMarker",
  "targetHasContinuationMarker",
  "assistantSpeaking",
  "contextMask",
  "assistantHasQuestion",
  "inboundHasQuestion",
  "targetAssistantTokenJaccard",
  "targetInboundTokenJaccard",
  "tokenJaccardDelta",
  "targetAssistantTokenCoverage",
  "targetInboundTokenCoverage",
  "tokenCoverageDelta",
  "targetAssistantCharNgramCosine",
  "targetInboundCharNgramCosine",
  "charNgramCosineDelta"
]);

export const CONTEXT_RELEVANCE_PAYLOAD_KEYS = Object.freeze([
  "assistantAudiblePrefixAtDecision",
  "assistantAudiblePrefixAvailableAtSample",
  "assistantSpeaking",
  "currentSample",
  "recentInbound",
  "recentInboundAvailableAtSample",
  "targetAvailableAtSample",
  "targetText"
]);

export const CONTEXT_RELEVANCE_AVAILABILITY_KEYS = Object.freeze([
  "assistantAudiblePrefixAvailableAtSample",
  "recentInboundAvailableAtSample",
  "targetAvailableAtSample"
]);

export const EXP0019_SOURCE_CHECKPOINT = Object.freeze({
  path: "eval/checkpoints/exp-0018-context-v0.1.json",
  checkpointId: "exp-0018-context-cc87305b86576fb1",
  fileSha256:
    "sha256:3f5080b93b406540d601368dbbfd4d0e05257d3a6171b1d876c636864b0807a8",
  checkpointSha256:
    "sha256:2d6d21adc3a27bebd9aa24a635068ce06be2a62b6c8c7545dce57623af3cb87b",
  modelSha256: Object.freeze({
    B0: "sha256:71ce673efe957d4c3ca782f125f32fc29175f77751bf83a2384ada0ca413b792",
    B1: "sha256:cc87305b86576fb140ad72f5df9f19be2708cc436c03a261bd05bae7ec5c8d86"
  }),
  weightsSha256: Object.freeze({
    B0: "sha256:a7a209544caaba228090ecd4f8e7b5dc8a80eee332d2018dd47441144f49d2dc",
    B1: "sha256:0a2b713f2ce7a14517a60b77152d3ac1519358612b73a7d44b66a62c5e17c9db"
  }),
  threshold: Object.freeze({
    B0: 1,
    B1: 0.9342642684830884
  })
});

const ARM_NAMES = Object.freeze(["B0", "B1"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SHA256_INITIAL_STATE = Object.freeze([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19
]);
const SHA256_ROUND_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
const STOPWORDS = new Set([
  "a", "ao", "aos", "as", "da", "das", "de", "do", "dos", "e",
  "ela", "ele", "eles", "em", "essa", "esse", "esta", "este", "eu",
  "foi", "ja", "la", "na", "nas", "no", "nos", "o", "os", "ou",
  "para", "pela", "pelo", "por", "que", "se", "sem", "um", "uma",
  "voce"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    sameArray(Object.keys(value).sort(), [...expected].sort());
}

function canonicalSerialize(value, path, seen) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contém número não finito`);
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "undefined") {
    throw new TypeError(`${path} contém undefined`);
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contém tipo não serializável`);
  }
  if (seen.has(value)) {
    throw new TypeError(`${path} contém referência circular`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) =>
        canonicalSerialize(item, `${path}[${index}]`, seen)
      ).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(`${path} precisa conter apenas objetos JSON`);
    }
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalSerialize(
        value[key],
        `${path}.${key}`,
        seen
      )}`
    ).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function rotateRight(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function sha256Hex(text) {
  const source = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const bitLength = source.length * 8;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = [...SHA256_INITIAL_STATE];
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = schedule[index - 15];
      const right = schedule[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^
        (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^
        (right >>> 10);
      schedule[index] = (
        schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1
      ) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^
        rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (
        h + sum1 + choose + SHA256_ROUND_CONSTANTS[index] + schedule[index]
      ) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^
        rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function canonicalContextRelevanceSha256(value) {
  return sha256Hex(canonicalSerialize(value, "$", new Set()));
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validWeights(weights) {
  return Array.isArray(weights) &&
    weights.length === CONTEXT_RELEVANCE_CLASSES.length &&
    weights.every((row) =>
      Array.isArray(row) &&
      row.length === CONTEXT_RELEVANCE_FEATURES.length &&
      row.every(Number.isFinite)
    );
}

export function validateContextRelevanceCheckpoint(checkpoint) {
  const errors = [];
  const rootKeys = [
    "adapter",
    "arms",
    "authority",
    "browserCheckpointSha256",
    "checkpointId",
    "classes",
    "featureNames",
    "featureVersion",
    "schemaVersion",
    "shadowVersion",
    "source"
  ];
  if (
    !exactKeys(checkpoint, rootKeys) ||
    checkpoint?.schemaVersion !== CONTEXT_RELEVANCE_CHECKPOINT_VERSION ||
    checkpoint?.shadowVersion !== CONTEXT_RELEVANCE_SHADOW_VERSION ||
    checkpoint?.featureVersion !== CONTEXT_RELEVANCE_FEATURE_VERSION ||
    !nonEmptyText(checkpoint?.checkpointId) ||
    !sameArray(checkpoint?.featureNames, CONTEXT_RELEVANCE_FEATURES) ||
    !sameArray(checkpoint?.classes, CONTEXT_RELEVANCE_CLASSES) ||
    !SHA256_PATTERN.test(checkpoint?.browserCheckpointSha256 ?? "")
  ) {
    errors.push("identidade do checkpoint browser incompatível");
  }
  try {
    const core = {};
    for (const [key, value] of Object.entries(checkpoint ?? {})) {
      if (key !== "browserCheckpointSha256") {
        core[key] = value;
      }
    }
    if (
      checkpoint?.browserCheckpointSha256 !==
        `sha256:${canonicalContextRelevanceSha256(core)}`
    ) {
      errors.push("browserCheckpointSha256 divergente");
    }
  } catch {
    errors.push("checkpoint browser não possui serialização canônica válida");
  }

  if (
    !exactKeys(checkpoint?.source, [
      "checkpointId",
      "checkpointSha256",
      "fileSha256",
      "path"
    ]) ||
    checkpoint?.source?.path !== EXP0019_SOURCE_CHECKPOINT.path ||
    checkpoint?.source?.fileSha256 !== EXP0019_SOURCE_CHECKPOINT.fileSha256 ||
    checkpoint?.source?.checkpointSha256 !==
      EXP0019_SOURCE_CHECKPOINT.checkpointSha256 ||
    checkpoint?.source?.checkpointId !== EXP0019_SOURCE_CHECKPOINT.checkpointId ||
    checkpoint?.checkpointId !== EXP0019_SOURCE_CHECKPOINT.checkpointId
  ) {
    errors.push("binding ao checkpoint EXP-0018 incompatível");
  }

  if (!exactKeys(checkpoint?.arms, ARM_NAMES)) {
    errors.push("braços do checkpoint incompatíveis");
  } else {
    for (const [name, contextEnabled] of [["B0", false], ["B1", true]]) {
      const arm = checkpoint.arms[name];
      const weightsValid = validWeights(arm?.weights);
      let observedWeightsSha256 = null;
      if (weightsValid) {
        observedWeightsSha256 =
          `sha256:${canonicalContextRelevanceSha256(arm.weights)}`;
      }
      if (
        !exactKeys(arm, [
          "algorithm",
          "contextEnabled",
          "modelSha256",
          "threshold",
          "weights",
          "weightsSha256"
        ]) ||
        arm?.algorithm !==
          "full-batch-multinomial-logistic-regression-v1" ||
        arm?.contextEnabled !== contextEnabled ||
        arm?.modelSha256 !== EXP0019_SOURCE_CHECKPOINT.modelSha256[name] ||
        arm?.weightsSha256 !== EXP0019_SOURCE_CHECKPOINT.weightsSha256[name] ||
        arm?.weightsSha256 !== observedWeightsSha256 ||
        arm?.threshold !== EXP0019_SOURCE_CHECKPOINT.threshold[name] ||
        !weightsValid
      ) {
        errors.push(`${name} do checkpoint browser incompatível`);
      }
    }
  }

  if (
    !exactKeys(checkpoint?.adapter, [
      "availabilityKeys",
      "classifierCallsPerProposal",
      "deferStatus",
      "effectsAllowed",
      "payloadKeys",
      "proposalStatus"
    ]) ||
    !sameArray(
      checkpoint?.adapter?.payloadKeys,
      CONTEXT_RELEVANCE_PAYLOAD_KEYS
    ) ||
    !sameArray(
      checkpoint?.adapter?.availabilityKeys,
      CONTEXT_RELEVANCE_AVAILABILITY_KEYS
    ) ||
    checkpoint?.adapter?.classifierCallsPerProposal !== 2 ||
    checkpoint?.adapter?.deferStatus !== "DEFER_CAUSAL_EVIDENCE" ||
    checkpoint?.adapter?.proposalStatus !== "SHADOW_PROPOSAL" ||
    checkpoint?.adapter?.effectsAllowed !== false
  ) {
    errors.push("contrato do adapter incompatível");
  }

  if (
    !exactKeys(checkpoint?.authority, ["canProduceEffects", "mode"]) ||
    checkpoint?.authority?.mode !== "shadow-only" ||
    checkpoint?.authority?.canProduceEffects !== false
  ) {
    errors.push("checkpoint browser não pode receber autoridade");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function validateContextRelevancePayload(payload) {
  const errors = [];
  if (!exactKeys(payload, CONTEXT_RELEVANCE_PAYLOAD_KEYS)) {
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
    samples.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    payload.recentInboundAvailableAtSample >
      payload.assistantAudiblePrefixAvailableAtSample ||
    payload.assistantAudiblePrefixAvailableAtSample >
      payload.targetAvailableAtSample ||
    payload.assistantSpeaking !== true
  ) {
    errors.push("amostras, ordem causal ou assistantSpeaking inválidos");
  }

  const inboundPresent = Array.isArray(payload.recentInbound) &&
    payload.recentInbound.length === 1 &&
    nonEmptyText(payload.recentInbound[0]);
  const inboundAbsent = Array.isArray(payload.recentInbound) &&
    payload.recentInbound.length === 0;
  if (!inboundPresent && !inboundAbsent) {
    errors.push("recentInbound precisa estar ausente ou conter um texto");
  }
  const prefixPresent = nonEmptyText(
    payload.assistantAudiblePrefixAtDecision
  );
  const prefixAbsent = payload.assistantAudiblePrefixAtDecision === null;
  if (!prefixPresent && !prefixAbsent) {
    errors.push("prefixo precisa estar ausente ou conter texto");
  }
  const targetPresent = nonEmptyText(payload.targetText);
  const targetAbsent = payload.targetText === null;
  if (!targetPresent && !targetAbsent) {
    errors.push("target precisa estar ausente ou conter texto");
  }
  for (const [present, boundary, name] of [
    [inboundPresent, payload.recentInboundAvailableAtSample, "inbound"],
    [
      prefixPresent,
      payload.assistantAudiblePrefixAvailableAtSample,
      "prefixo"
    ],
    [targetPresent, payload.targetAvailableAtSample, "target"]
  ]) {
    if (present && payload.currentSample < boundary) {
      errors.push(`${name}: texto futuro no payload`);
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function normalizeContextRelevanceText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function contentTokens(value) {
  return normalizeContextRelevanceText(value)
    .split(" ")
    .filter((token) => token && !STOPWORDS.has(token));
}

function tokenSet(value) {
  return new Set(contentTokens(value));
}

function intersectionSize(left, right) {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }
  return count;
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }
  const intersection = intersectionSize(left, right);
  return intersection / (left.size + right.size - intersection);
}

function targetCoverage(target, context) {
  return target.size === 0 ? 0 :
    intersectionSize(target, context) / target.size;
}

function ngramCounts(value, minimum = 3, maximum = 5) {
  const normalized = `^${normalizeContextRelevanceText(value)}$`;
  const counts = new Map();
  for (let size = minimum; size <= maximum; size += 1) {
    for (let start = 0; start + size <= normalized.length; start += 1) {
      const ngram = normalized.slice(start, start + size);
      counts.set(ngram, (counts.get(ngram) ?? 0) + 1);
    }
  }
  return counts;
}

function cosine(left, right) {
  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (const value of left.values()) {
    leftSquared += value ** 2;
  }
  for (const value of right.values()) {
    rightSquared += value ** 2;
  }
  for (const [key, value] of left) {
    dot += value * (right.get(key) ?? 0);
  }
  return leftSquared === 0 || rightSquared === 0
    ? 0
    : dot / Math.sqrt(leftSquared * rightSquared);
}

function includesAny(normalized, values) {
  return values.some((value) => normalized.includes(value));
}

function assertValidPayload(payload) {
  const validation = validateContextRelevancePayload(payload);
  if (!validation.valid) {
    throw new TypeError(
      `payload contextual inválido: ${validation.errors.join("; ")}`
    );
  }
}

function missingCausalEvidence(payload) {
  const missing = [];
  if (!Array.isArray(payload.recentInbound) || payload.recentInbound.length !== 1) {
    missing.push("recentInbound");
  }
  if (!nonEmptyText(payload.assistantAudiblePrefixAtDecision)) {
    missing.push("assistantAudiblePrefixAtDecision");
  }
  if (!nonEmptyText(payload.targetText)) {
    missing.push("targetText");
  }
  return missing;
}

export function extractBrowserContextRelevanceFeatures(
  payload,
  options = {}
) {
  assertValidPayload(payload);
  const missingEvidence = missingCausalEvidence(payload);
  if (missingEvidence.length > 0) {
    throw new TypeError(
      `features exigem evidência causal liberada: ${missingEvidence.join(", ")}`
    );
  }
  const contextEnabled = options.contextEnabled === true;
  const targetNormalized = normalizeContextRelevanceText(payload.targetText);
  const targetTokens = tokenSet(targetNormalized);
  const targetNgrams = ngramCounts(targetNormalized);
  const base = [
    1,
    targetNormalized ? 1 : 0,
    Math.min([...targetNormalized].length / 120, 1),
    Math.min(targetTokens.size / 20, 1),
    payload.targetText.includes("?") ? 1 : 0,
    includesAny(targetNormalized, ["nao ", "nem ", "nunca "]) ? 1 : 0,
    includesAny(targetNormalized, [
      "na verdade", "corrigindo", "correcao", "quis dizer"
    ]) ? 1 : 0,
    includesAny(targetNormalized, [
      "continua", "continuar", "segue", "prossiga", "retoma", "retome"
    ]) ? 1 : 0,
    payload.assistantSpeaking ? 1 : 0
  ];
  let context = Array(CONTEXT_RELEVANCE_FEATURES.length - base.length).fill(0);
  let assistantNormalized = null;
  let inboundNormalized = null;
  if (contextEnabled) {
    assistantNormalized = normalizeContextRelevanceText(
      payload.assistantAudiblePrefixAtDecision
    );
    const inboundText = payload.recentInbound.join(" ");
    inboundNormalized = normalizeContextRelevanceText(inboundText);
    const assistantTokens = tokenSet(assistantNormalized);
    const inboundTokens = tokenSet(inboundNormalized);
    const assistantJaccard = jaccard(targetTokens, assistantTokens);
    const inboundJaccard = jaccard(targetTokens, inboundTokens);
    const assistantCoverage = targetCoverage(targetTokens, assistantTokens);
    const inboundCoverage = targetCoverage(targetTokens, inboundTokens);
    const assistantCosine = cosine(
      targetNgrams,
      ngramCounts(assistantNormalized)
    );
    const inboundCosine = cosine(
      targetNgrams,
      ngramCounts(inboundNormalized)
    );
    context = [
      1,
      payload.assistantAudiblePrefixAtDecision.includes("?") ? 1 : 0,
      inboundText.includes("?") ? 1 : 0,
      assistantJaccard,
      inboundJaccard,
      assistantJaccard - inboundJaccard,
      assistantCoverage,
      inboundCoverage,
      assistantCoverage - inboundCoverage,
      assistantCosine,
      inboundCosine,
      assistantCosine - inboundCosine
    ];
  }
  const values = [...base, ...context];
  if (
    values.length !== CONTEXT_RELEVANCE_FEATURES.length ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("extrator browser produziu features inválidas");
  }
  return deepFreeze({
    schemaVersion: 1,
    featureVersion: CONTEXT_RELEVANCE_FEATURE_VERSION,
    names: [...CONTEXT_RELEVANCE_FEATURES],
    values,
    contextEnabled,
    normalized: {
      target: targetNormalized,
      assistantAudiblePrefixAtDecision: assistantNormalized,
      recentInbound: inboundNormalized
    }
  });
}

function validateFeatureSet(featureSet, contextEnabled) {
  return featureSet?.schemaVersion === 1 &&
    featureSet?.featureVersion === CONTEXT_RELEVANCE_FEATURE_VERSION &&
    sameArray(featureSet?.names, CONTEXT_RELEVANCE_FEATURES) &&
    Array.isArray(featureSet?.values) &&
    featureSet.values.length === CONTEXT_RELEVANCE_FEATURES.length &&
    featureSet.values.every(Number.isFinite) &&
    featureSet?.contextEnabled === contextEnabled;
}

function softmax(logits) {
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

export function classifyContextRelevanceArm(checkpoint, armName, featureSet) {
  const checkpointValidation = validateContextRelevanceCheckpoint(checkpoint);
  if (!checkpointValidation.valid) {
    throw new TypeError(
      `checkpoint contextual inválido: ${checkpointValidation.errors.join("; ")}`
    );
  }
  if (!ARM_NAMES.includes(armName)) {
    throw new TypeError(`braço contextual desconhecido: ${String(armName)}`);
  }
  const arm = checkpoint.arms[armName];
  if (!validateFeatureSet(featureSet, arm.contextEnabled)) {
    throw new TypeError("features contextuais incompatíveis");
  }
  const logits = arm.weights.map((row) => row.reduce(
    (sum, weight, index) => sum + weight * featureSet.values[index],
    0
  ));
  const values = softmax(logits);
  const probabilities = Object.fromEntries(
    CONTEXT_RELEVANCE_CLASSES.map((label, index) => [label, values[index]])
  );
  let winner = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[winner]) {
      winner = index;
    }
  }
  const backgroundProbability =
    probabilities.BACKGROUND_OR_NOT_DIRECTED;
  return deepFreeze({
    arm: armName,
    contextEnabled: arm.contextEnabled,
    modelSha256: arm.modelSha256,
    threshold: arm.threshold,
    rawPredicted: CONTEXT_RELEVANCE_CLASSES[winner],
    predicted: backgroundProbability >= arm.threshold
      ? "BACKGROUND_OR_NOT_DIRECTED"
      : "DIRECTED_TO_ASSISTANT",
    backgroundProbability,
    probabilities,
    features: featureSet
  });
}

function causalEvidence(payload) {
  return [
    ["recentInbound", payload.recentInboundAvailableAtSample],
    [
      "assistantAudiblePrefixAtDecision",
      payload.assistantAudiblePrefixAvailableAtSample
    ],
    ["targetText", payload.targetAvailableAtSample]
  ];
}

export function evaluateContextRelevanceShadow(
  checkpoint,
  payload,
  options = {}
) {
  const checkpointValidation = validateContextRelevanceCheckpoint(checkpoint);
  if (!checkpointValidation.valid) {
    throw new TypeError(
      `checkpoint contextual inválido: ${checkpointValidation.errors.join("; ")}`
    );
  }
  if (!exactKeys(options, []) && !exactKeys(options, ["classify"])) {
    throw new TypeError("opções do adapter contêm chaves proibidas");
  }
  const classify = options.classify ?? classifyContextRelevanceArm;
  if (typeof classify !== "function") {
    throw new TypeError("classificador shadow precisa ser função");
  }
  const payloadValidation = validateContextRelevancePayload(payload);
  const evidence = payloadValidation.valid ? causalEvidence(payload) : [];
  const missingEvidence = payloadValidation.valid
    ? missingCausalEvidence(payload)
    : [];
  const requiredAvailabilitySample = Math.max(
    0,
    ...evidence.map(([, availableAtSample]) => availableAtSample)
  );
  const envelope = {
    schemaVersion: 1,
    shadowVersion: CONTEXT_RELEVANCE_SHADOW_VERSION,
    checkpointId: checkpoint.checkpointId,
    sourceCheckpointSha256: checkpoint.source.checkpointSha256,
    currentSample: payload?.currentSample ?? null,
    requiredAvailabilitySample,
    authority: { mode: "shadow-only", canProduceEffects: false },
    effects: []
  };
  if (!payloadValidation.valid) {
    return deepFreeze({
      ...envelope,
      status: "INVALID_CAUSAL_PAYLOAD",
      missingEvidence: [],
      errors: [...payloadValidation.errors],
      classifierCalls: 0,
      proposal: null
    });
  }
  if (missingEvidence.length > 0) {
    return deepFreeze({
      ...envelope,
      status: "DEFER_CAUSAL_EVIDENCE",
      missingEvidence,
      errors: [],
      classifierCalls: 0,
      proposal: null
    });
  }

  const arms = {};
  for (const [name, contextEnabled] of [["B0", false], ["B1", true]]) {
    const features = extractBrowserContextRelevanceFeatures(payload, {
      contextEnabled
    });
    arms[name] = classify(checkpoint, name, features);
  }
  return deepFreeze({
    ...envelope,
    status: "SHADOW_PROPOSAL",
    missingEvidence: [],
    errors: [],
    classifierCalls: 2,
    proposal: { arms }
  });
}

export class ContextRelevanceShadow {
  #checkpoint;
  #classifier;
  #deferCount = 0;
  #inferenceCount = 0;
  #invalidCount = 0;
  #proposalCount = 0;

  constructor(checkpoint, options = {}) {
    const validation = validateContextRelevanceCheckpoint(checkpoint);
    if (!validation.valid) {
      throw new TypeError(
        `checkpoint contextual inválido: ${validation.errors.join("; ")}`
      );
    }
    if (!exactKeys(options, []) && !exactKeys(options, ["classify"])) {
      throw new TypeError("opções do shadow contêm chaves proibidas");
    }
    this.#classifier = options.classify ?? classifyContextRelevanceArm;
    if (typeof this.#classifier !== "function") {
      throw new TypeError("classificador shadow precisa ser função");
    }
    this.#checkpoint = structuredClone(checkpoint);
  }

  get snapshot() {
    return deepFreeze({
      state: "ready",
      shadowVersion: CONTEXT_RELEVANCE_SHADOW_VERSION,
      checkpointId: this.#checkpoint.checkpointId,
      sourceCheckpointSha256: this.#checkpoint.source.checkpointSha256,
      deferCount: this.#deferCount,
      inferenceCount: this.#inferenceCount,
      invalidCount: this.#invalidCount,
      proposalCount: this.#proposalCount,
      effectsDispatched: 0,
      authority: { mode: "shadow-only", canProduceEffects: false }
    });
  }

  evaluate(payload) {
    const result = evaluateContextRelevanceShadow(
      this.#checkpoint,
      payload,
      {
        classify: (checkpoint, armName, features) => {
          this.#inferenceCount += 1;
          return this.#classifier(checkpoint, armName, features);
        }
      }
    );
    if (result.status === "INVALID_CAUSAL_PAYLOAD") {
      this.#invalidCount += 1;
    } else if (result.status === "DEFER_CAUSAL_EVIDENCE") {
      this.#deferCount += 1;
    } else {
      this.#proposalCount += 1;
    }
    return result;
  }
}
