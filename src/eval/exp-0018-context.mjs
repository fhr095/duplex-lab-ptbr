import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0018_CATALOG_VERSION =
  "exp-0018-context-pair-catalog-v1";
export const EXP0018_DATASET_VERSION =
  "exp-0018-context-dataset-v1";
export const EXP0018_FEATURE_VERSION =
  "exp-0018-context-relational-features-v1";

export const EXP0018_CLASSES = Object.freeze([
  "BACKGROUND_OR_NOT_DIRECTED",
  "DIRECTED_TO_ASSISTANT"
]);

export const EXP0018_FAMILIES = Object.freeze([
  "short-response",
  "correction",
  "continuation",
  "instruction-negation"
]);

export const EXP0018_ROLE_CONTRACT = Object.freeze({
  fit: Object.freeze({ crossBlocks: 12, pairRoots: 24, examples: 48 }),
  calibration: Object.freeze({ crossBlocks: 4, pairRoots: 8, examples: 16 }),
  development: Object.freeze({ crossBlocks: 8, pairRoots: 16, examples: 32 })
});

const BASE_FEATURE_NAMES = Object.freeze([
  "bias",
  "targetPresent",
  "targetCharacterLength",
  "targetTokenCount",
  "targetHasQuestion",
  "targetHasNegation",
  "targetHasCorrectionMarker",
  "targetHasContinuationMarker",
  "assistantSpeaking"
]);

const CONTEXT_FEATURE_NAMES = Object.freeze([
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

export const EXP0018_FEATURE_NAMES = Object.freeze([
  ...BASE_FEATURE_NAMES,
  ...CONTEXT_FEATURE_NAMES
]);

const ROLE_SET = new Set(Object.keys(EXP0018_ROLE_CONTRACT));
const FAMILY_SET = new Set(EXP0018_FAMILIES);
const CLASS_SET = new Set(EXP0018_CLASSES);
const MODEL_INPUT_KEYS = Object.freeze([
  "assistantAudiblePrefixAtDecision",
  "assistantSpeaking",
  "recentInbound",
  "targetText"
]);
const TARGET_ONLY_INPUT_KEYS = Object.freeze([
  "assistantSpeaking",
  "targetText"
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
  return JSON.stringify(left) === JSON.stringify(right);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalCore(value, hashKey) {
  const core = structuredClone(value ?? {});
  delete core[hashKey];
  return core;
}

function validId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function countBy(values, keyOf) {
  const counts = new Map();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function objectFromSortedMap(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

export function normalizeExp0018Text(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function contentTokens(value) {
  return normalizeExp0018Text(value)
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
  return target.size === 0 ? 0 : intersectionSize(target, context) / target.size;
}

function ngramCounts(value, minimum = 3, maximum = 5) {
  const normalized = `^${normalizeExp0018Text(value)}$`;
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

export function validateExp0018ModelInput(input, options = {}) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push("modelInput precisa ser objeto");
    return deepFreeze({ valid: false, errors });
  }
  const observedKeys = Object.keys(input).sort();
  const contextEnabled = options.contextEnabled !== false;
  const expectedKeys = contextEnabled
    ? MODEL_INPUT_KEYS
    : TARGET_ONLY_INPUT_KEYS;
  if (!sameArray(observedKeys, [...expectedKeys].sort())) {
    errors.push("modelInput contém chaves ausentes ou proibidas");
  }
  if (
    !nonEmptyText(input.targetText) ||
    input.assistantSpeaking !== true
  ) {
    errors.push("conteúdo observável de modelInput é inválido");
  }
  if (
    contextEnabled &&
    (
      !nonEmptyText(input.assistantAudiblePrefixAtDecision) ||
      !Array.isArray(input.recentInbound) ||
      input.recentInbound.length !== 1 ||
      input.recentInbound.some((item) => !nonEmptyText(item))
    )
  ) {
    errors.push("conteúdo contextual observável é inválido");
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function projectExp0018ModelInput(input, options = {}) {
  const validation = validateExp0018ModelInput(input, {
    contextEnabled: true
  });
  if (!validation.valid) {
    throw new TypeError(
      `observação EXP-0018 inválida: ${validation.errors.join("; ")}`
    );
  }
  if (options.contextEnabled === true) {
    return deepFreeze({
      assistantAudiblePrefixAtDecision:
        input.assistantAudiblePrefixAtDecision,
      assistantSpeaking: input.assistantSpeaking,
      recentInbound: [...input.recentInbound],
      targetText: input.targetText
    });
  }
  return deepFreeze({
    assistantSpeaking: input.assistantSpeaking,
    targetText: input.targetText
  });
}

export function extractExp0018ContextFeatures(input, options = {}) {
  const contextEnabled = options.contextEnabled === true;
  const validation = validateExp0018ModelInput(input, { contextEnabled });
  if (!validation.valid) {
    throw new TypeError(`modelInput inválido: ${validation.errors.join("; ")}`);
  }
  const targetNormalized = normalizeExp0018Text(input.targetText);
  const targetTokens = tokenSet(targetNormalized);
  const targetNgrams = ngramCounts(targetNormalized);
  const base = [
    1,
    targetNormalized ? 1 : 0,
    Math.min([...targetNormalized].length / 120, 1),
    Math.min(targetTokens.size / 20, 1),
    input.targetText.includes("?") ? 1 : 0,
    includesAny(targetNormalized, ["nao ", "nem ", "nunca "]) ? 1 : 0,
    includesAny(targetNormalized, [
      "na verdade", "corrigindo", "correcao", "quis dizer"
    ]) ? 1 : 0,
    includesAny(targetNormalized, [
      "continua", "continuar", "segue", "prossiga", "retoma", "retome"
    ]) ? 1 : 0,
    input.assistantSpeaking ? 1 : 0
  ];
  let context = Array(CONTEXT_FEATURE_NAMES.length).fill(0);
  let assistantNormalized = null;
  let inboundNormalized = null;
  if (contextEnabled) {
    assistantNormalized = normalizeExp0018Text(
      input.assistantAudiblePrefixAtDecision
    );
    const inboundText = input.recentInbound.join(" ");
    inboundNormalized = normalizeExp0018Text(inboundText);
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
        input.assistantAudiblePrefixAtDecision.includes("?") ? 1 : 0,
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
    values.length !== EXP0018_FEATURE_NAMES.length ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("extrator EXP-0018 produziu features inválidas");
  }
  return deepFreeze({
    schemaVersion: 1,
    featureVersion: EXP0018_FEATURE_VERSION,
    names: [...EXP0018_FEATURE_NAMES],
    values,
    contextEnabled,
    normalized: {
      target: targetNormalized,
      assistantAudiblePrefixAtDecision: assistantNormalized,
      recentInbound: inboundNormalized
    }
  });
}

function contextFingerprint(context) {
  return `assistant:${normalizeExp0018Text(
    context.assistantAudiblePrefixAtDecision
  )}|` +
    `inbound:${context.recentInbound.map(normalizeExp0018Text).join("|")}`;
}

function modelInput(targetText, context) {
  return deepFreeze({
    assistantAudiblePrefixAtDecision:
      context.assistantAudiblePrefixAtDecision,
    assistantSpeaking: true,
    recentInbound: [...context.recentInbound],
    targetText
  });
}

function exampleId(pairRootId, input) {
  return `e-${canonicalSha256({ pairRootId, modelInput: input }).slice(0, 20)}`;
}

function examplesForBlock(block) {
  const definitions = [];
  for (const target of Object.values(block.targets ?? {})) {
    for (const [contextKey, context] of Object.entries(block.contexts ?? {})) {
      const binding = block.oracle?.[contextKey];
      let label = null;
      if (binding?.assistantExpectedTargetId === target?.targetId) {
        label = "DIRECTED_TO_ASSISTANT";
      } else if (binding?.recentInboundExpectedTargetId === target?.targetId) {
        label = "BACKGROUND_OR_NOT_DIRECTED";
      }
      definitions.push({ target, context, label });
    }
  }
  return definitions.map((definition) => {
    const pairRootId =
      `${block.crossBlockRootId}-${definition.target.targetId}`;
    const input = modelInput(definition.target.text, definition.context);
    return deepFreeze({
      exampleId: exampleId(pairRootId, input),
      pairRootId,
      crossBlockRootId: block.crossBlockRootId,
      semanticLineageId: block.semanticLineageId,
      family: block.family,
      label: definition.label,
      targetSurfaceId: definition.target.targetId,
      contextSurfaceId: definition.context.contextId,
      modelInput: input
    });
  });
}

function labelBalance(examples, fingerprintOf) {
  const values = new Map();
  for (const example of examples) {
    const fingerprint = fingerprintOf(example);
    const counts = values.get(fingerprint) ?? Object.fromEntries(
      EXP0018_CLASSES.map((label) => [label, 0])
    );
    counts[example.label] += 1;
    values.set(fingerprint, counts);
  }
  return values;
}

function lexemeCounts(examples, textOf, label) {
  const counts = new Map();
  for (const example of examples.filter((item) => item.label === label)) {
    for (const token of normalizeExp0018Text(textOf(example)).split(" ")) {
      if (token) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }
  return objectFromSortedMap(counts);
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function editSimilarity(left, right) {
  const leftNormalized = normalizeExp0018Text(left);
  const rightNormalized = normalizeExp0018Text(right);
  const maximum = Math.max(leftNormalized.length, rightNormalized.length);
  return maximum === 0
    ? 1
    : 1 - editDistance(leftNormalized, rightNormalized) / maximum;
}

function findNearDuplicates(items, options = {}) {
  const threshold = options.threshold ?? 0.85;
  const findings = [];
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex];
    const leftTokens = tokenSet(left.text);
    const leftNgrams = new Set(ngramCounts(left.text, 3, 5).keys());
    for (let rightIndex = leftIndex + 1;
      rightIndex < items.length;
      rightIndex += 1) {
      const right = items[rightIndex];
      if (
        options.skipSameCrossBlock === true &&
        left.crossBlockRootId === right.crossBlockRootId
      ) {
        continue;
      }
      if (
        options.allowExpectedSameSemanticTarget === true &&
        left.crossBlockRootId === right.crossBlockRootId &&
        left.semanticTargetId === right.semanticTargetId
      ) {
        continue;
      }
      const similarities = {
        tokenJaccard: jaccard(leftTokens, tokenSet(right.text)),
        charNgramJaccard: jaccard(
          leftNgrams,
          new Set(ngramCounts(right.text, 3, 5).keys())
        ),
        normalizedEdit: editSimilarity(left.text, right.text)
      };
      const similarity = Math.max(...Object.values(similarities));
      if (similarity >= threshold) {
        findings.push({
          leftKind: left.kind,
          leftId: left.id,
          leftRole: left.role,
          leftCrossBlockRootId: left.crossBlockRootId,
          rightKind: right.kind,
          rightId: right.id,
          rightRole: right.role,
          rightCrossBlockRootId: right.crossBlockRootId,
          similarity,
          similarities
        });
      }
    }
  }
  return findings;
}

export function auditExp0018Catalog(catalog) {
  const errors = [];
  if (catalog?.schemaVersion !== EXP0018_CATALOG_VERSION) {
    errors.push("schemaVersion do catálogo incompatível");
  }
  if (catalog?.locale !== "pt-BR" || catalog?.experimentId !== "EXP-0018") {
    errors.push("identidade ou locale do catálogo incompatível");
  }
  if (
    catalog?.provenance?.generationMethod !==
      "human-authored-controlled-crossed-blocks" ||
    catalog?.provenance?.externalModelCalls !== 0 ||
    catalog?.provenance?.paidApiCalls !== 0
  ) {
    errors.push("proveniência do catálogo incompatível");
  }
  const blocks = Array.isArray(catalog?.blocks) ? catalog.blocks : [];
  if (blocks.length !== 24) {
    errors.push("catálogo precisa conter exatamente 24 blocos");
  }
  const seenCrossBlockIds = new Set();
  const seenLineages = new Set();
  const seenTargetIds = new Set();
  const seenContextIds = new Set();
  const roleByTarget = new Map();
  const roleByContext = new Map();
  const targetItems = [];
  const contextItems = [];
  const antecedentItems = [];
  for (const block of blocks) {
    if (
      !validId(block?.crossBlockRootId) ||
      !validId(block?.semanticLineageId) ||
      !ROLE_SET.has(block?.role) ||
      !FAMILY_SET.has(block?.family)
    ) {
      errors.push(
        `${block?.crossBlockRootId ?? "bloco"}: metadados inválidos`
      );
      continue;
    }
    if (seenCrossBlockIds.has(block.crossBlockRootId)) {
      errors.push(`crossBlockRootId duplicado: ${block.crossBlockRootId}`);
    }
    if (seenLineages.has(block.semanticLineageId)) {
      errors.push(`linhagem semântica duplicada: ${block.semanticLineageId}`);
    }
    seenCrossBlockIds.add(block.crossBlockRootId);
    seenLineages.add(block.semanticLineageId);
    const targets = [block.targets?.a, block.targets?.b];
    const contexts = [block.contexts?.a, block.contexts?.b];
    if (
      targets.some((target) =>
        !validId(target?.targetId) || !nonEmptyText(target?.text)
      ) ||
      normalizeExp0018Text(targets[0]?.text) ===
        normalizeExp0018Text(targets[1]?.text)
    ) {
      errors.push(`${block.crossBlockRootId}: alvos inválidos ou iguais`);
    }
    if (contexts.some((context) =>
      !validId(context?.contextId) ||
      !nonEmptyText(context?.assistantAudiblePrefixAtDecision) ||
      !Array.isArray(context?.recentInbound) ||
      context.recentInbound.length !== 1 ||
      context.recentInbound.some((item) => !nonEmptyText(item))
    )) {
      errors.push(`${block.crossBlockRootId}: contextos inválidos`);
    } else if (contextFingerprint(contexts[0]) === contextFingerprint(contexts[1])) {
      errors.push(`${block.crossBlockRootId}: contextos iguais`);
    }
    const targetIds = new Set(targets.map((target) => target?.targetId));
    for (const contextKey of ["a", "b"]) {
      const binding = block.oracle?.[contextKey];
      if (
        !binding ||
        Object.keys(binding).sort().join("|") !==
          "assistantExpectedTargetId|recentInboundExpectedTargetId" ||
        !targetIds.has(binding.assistantExpectedTargetId) ||
        !targetIds.has(binding.recentInboundExpectedTargetId) ||
        binding.assistantExpectedTargetId ===
          binding.recentInboundExpectedTargetId
      ) {
        errors.push(
          `${block.crossBlockRootId}: oracle ${contextKey} inválido`
        );
      }
    }
    if (
      block.oracle?.a?.assistantExpectedTargetId !==
        block.oracle?.b?.recentInboundExpectedTargetId ||
      block.oracle?.a?.recentInboundExpectedTargetId !==
        block.oracle?.b?.assistantExpectedTargetId
    ) {
      errors.push(`${block.crossBlockRootId}: oracle não forma checkerboard`);
    }
    for (const target of targets.filter(Boolean)) {
      if (!validId(target?.targetId) || !nonEmptyText(target?.text)) {
        continue;
      }
      if (seenTargetIds.has(target.targetId)) {
        errors.push(`targetId duplicado: ${target.targetId}`);
      }
      seenTargetIds.add(target.targetId);
      const fingerprint = normalizeExp0018Text(target.text);
      const owner = roleByTarget.get(fingerprint);
      if (owner && owner !== block.role) {
        errors.push(`alvo cruza papéis: ${target.targetId}`);
      }
      roleByTarget.set(fingerprint, block.role);
      targetItems.push({
        kind: "target",
        id: target.targetId,
        role: block.role,
        crossBlockRootId: block.crossBlockRootId,
        text: target.text
      });
    }
    for (const context of contexts.filter(Boolean)) {
      if (
        !validId(context?.contextId) ||
        !nonEmptyText(context?.assistantAudiblePrefixAtDecision) ||
        !Array.isArray(context?.recentInbound) ||
        context.recentInbound.length !== 1 ||
        context.recentInbound.some((item) => !nonEmptyText(item))
      ) {
        continue;
      }
      const contextKey = context === block.contexts.a ? "a" : "b";
      const binding = block.oracle?.[contextKey] ?? {};
      if (seenContextIds.has(context.contextId)) {
        errors.push(`contextId duplicado: ${context.contextId}`);
      }
      seenContextIds.add(context.contextId);
      const fingerprint = contextFingerprint(context);
      const owner = roleByContext.get(fingerprint);
      if (owner && owner !== block.role) {
        errors.push(`contexto cruza papéis: ${context.contextId}`);
      }
      roleByContext.set(fingerprint, block.role);
      contextItems.push({
        kind: "combined-context",
        id: context.contextId,
        role: block.role,
        crossBlockRootId: block.crossBlockRootId,
        text: `${context.assistantAudiblePrefixAtDecision} ` +
          context.recentInbound.join(" ")
      });
      antecedentItems.push(
        {
          kind: "assistant-antecedent",
          id: `${context.contextId}-assistant`,
          role: block.role,
          crossBlockRootId: block.crossBlockRootId,
          semanticTargetId: binding.assistantExpectedTargetId ?? null,
          text: context.assistantAudiblePrefixAtDecision
        },
        {
          kind: "inbound-antecedent",
          id: `${context.contextId}-inbound`,
          role: block.role,
          crossBlockRootId: block.crossBlockRootId,
          semanticTargetId: binding.recentInboundExpectedTargetId ?? null,
          text: context.recentInbound.join(" ")
        }
      );
    }
  }

  const examples = [];
  for (const block of blocks) {
    try {
      examples.push(...examplesForBlock(block));
    } catch (error) {
      errors.push(
        `${block?.crossBlockRootId ?? "bloco"}: expansão falhou: ` +
          error.message
      );
    }
  }
  const exampleIds = new Set(examples.map((example) => example.exampleId));
  if (exampleIds.size !== examples.length) {
    errors.push("exampleId colide no catálogo");
  }
  for (const role of ROLE_SET) {
    const expected = EXP0018_ROLE_CONTRACT[role];
    const roleBlocks = blocks.filter((block) => block?.role === role);
    const roleExamples = examples.filter((example) =>
      roleBlocks.some((block) =>
        block.crossBlockRootId === example.crossBlockRootId
      )
    );
    const roots = new Set(roleExamples.map((example) => example.pairRootId));
    if (
      roleBlocks.length !== expected.crossBlocks ||
      roots.size !== expected.pairRoots ||
      roleExamples.length !== expected.examples
    ) {
      errors.push(`${role}: pisos de blocos, raízes ou exemplos divergentes`);
    }
    const expectedBlocksPerFamily =
      expected.crossBlocks / EXP0018_FAMILIES.length;
    const familyCounts = countBy(roleBlocks, (block) => block.family);
    for (const family of EXP0018_FAMILIES) {
      if (familyCounts.get(family) !== expectedBlocksPerFamily) {
        errors.push(`${role}: família ${family} está desbalanceada`);
      }
    }
    const pairGroups = Map.groupBy(roleExamples, (example) => example.pairRootId);
    for (const [pairRootId, descendants] of pairGroups) {
      if (
        descendants.length !== 2 ||
        new Set(descendants.map((item) => item.label)).size !== 2 ||
        new Set(descendants.map(
          (item) => normalizeExp0018Text(item.modelInput.targetText)
        )).size !== 1
      ) {
        errors.push(`${pairRootId}: integridade pareada inválida`);
      }
    }
    const targetBalance = labelBalance(
      roleExamples,
      (example) => normalizeExp0018Text(example.modelInput.targetText)
    );
    const contextBalance = labelBalance(
      roleExamples,
      (example) => contextFingerprint({
        assistantAudiblePrefixAtDecision:
          example.modelInput.assistantAudiblePrefixAtDecision,
        recentInbound: example.modelInput.recentInbound
      })
    );
    for (const [fingerprint, counts] of [
      ...targetBalance.entries(),
      ...contextBalance.entries()
    ]) {
      if (counts[EXP0018_CLASSES[0]] !== 1 || counts[EXP0018_CLASSES[1]] !== 1) {
        errors.push(`${role}: superfície não cruzada ${fingerprint}`);
      }
    }
    const targetLexemes = EXP0018_CLASSES.map((label) =>
      lexemeCounts(roleExamples, (item) => item.modelInput.targetText, label)
    );
    const contextLexemes = EXP0018_CLASSES.map((label) =>
      lexemeCounts(
        roleExamples,
        (item) =>
          `${item.modelInput.assistantAudiblePrefixAtDecision} ` +
          item.modelInput.recentInbound.join(" "),
        label
      )
    );
    if (JSON.stringify(targetLexemes[0]) !== JSON.stringify(targetLexemes[1])) {
      errors.push(`${role}: lexemas de alvo predizem a classe`);
    }
    if (JSON.stringify(contextLexemes[0]) !== JSON.stringify(contextLexemes[1])) {
      errors.push(`${role}: lexemas de contexto predizem a classe`);
    }
    for (const example of roleExamples) {
      const inputValidation = validateExp0018ModelInput(example.modelInput);
      if (!inputValidation.valid) {
        errors.push(`${example.exampleId}: ${inputValidation.errors.join("; ")}`);
      }
    }
  }
  const nearDuplicates = [
    ...findNearDuplicates(targetItems),
    ...findNearDuplicates(contextItems, { skipSameCrossBlock: true }),
    ...findNearDuplicates(antecedentItems, {
      allowExpectedSameSemanticTarget: true
    })
  ];
  if (nearDuplicates.length > 0) {
    errors.push("há quase-duplicatas cruzando papéis");
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    counts: {
      crossBlocks: blocks.length,
      pairRoots: new Set(examples.map((example) => example.pairRootId)).size,
      examples: examples.length,
      byRole: Object.fromEntries([...ROLE_SET].map((role) => {
        const roleExamples = examples.filter((example) =>
          blocks.find((block) =>
            block?.crossBlockRootId === example.crossBlockRootId
          )?.role === role
        );
        return [role, {
          crossBlocks: blocks.filter((block) => block?.role === role).length,
          pairRoots: new Set(roleExamples.map((item) => item.pairRootId)).size,
          examples: roleExamples.length,
          labels: objectFromSortedMap(countBy(roleExamples, (item) => item.label))
        }];
      }))
    },
    distinct: {
      crossBlockRootIds: seenCrossBlockIds.size,
      semanticLineages: seenLineages.size,
      targetSurfaces: seenTargetIds.size,
      contextSurfaces: seenContextIds.size
    },
    nearDuplicateThreshold: 0.85,
    nearDuplicates,
    crossRoleNearDuplicates: nearDuplicates.filter(
      (item) => item.leftRole !== item.rightRole
    ),
    withinRoleNearDuplicates: nearDuplicates.filter(
      (item) => item.leftRole === item.rightRole
    ),
    leakageChecks: {
      targetSurfaceClassBalancedWithinRole: !errors.some((error) =>
        error.includes("superfície não cruzada") ||
        error.includes("lexemas de alvo")
      ),
      contextSurfaceClassBalancedWithinRole: !errors.some((error) =>
        error.includes("superfície não cruzada") ||
        error.includes("lexemas de contexto")
      ),
      modelInputAllowlistExact: !errors.some((error) =>
        error.includes("modelInput") || error.includes("proxy proibido")
      ),
      crossRoleLineagesDisjoint: !errors.some((error) =>
        error.includes("cruza papéis") || error.includes("duplicada")
      )
    }
  });
}

export function blindExp0018CatalogProjection(catalog) {
  const audit = auditExp0018Catalog(catalog);
  if (!audit.valid) {
    throw new TypeError(
      `catálogo EXP-0018 inválido: ${audit.errors.join("; ")}`
    );
  }
  return deepFreeze({
    schemaVersion: "exp-0018-blind-semantic-projection-v1",
    experimentId: catalog.experimentId,
    locale: catalog.locale,
    blocks: catalog.blocks.map((block) => ({
      crossBlockRootId: block.crossBlockRootId,
      role: block.role,
      family: block.family,
      targets: structuredClone(block.targets),
      contexts: structuredClone(block.contexts)
    }))
  });
}

export function buildExp0018Datasets(catalog, provenance = {}) {
  const audit = auditExp0018Catalog(catalog);
  if (!audit.valid) {
    throw new TypeError(`catálogo EXP-0018 inválido: ${audit.errors.join("; ")}`);
  }
  const catalogSha256 = `sha256:${canonicalSha256(catalog)}`;
  const datasets = {};
  for (const role of ROLE_SET) {
    const roleBlockIds = new Set(catalog.blocks
      .filter((block) => block.role === role)
      .map((block) => block.crossBlockRootId));
    const examples = catalog.blocks
      .filter((block) => roleBlockIds.has(block.crossBlockRootId))
      .flatMap(examplesForBlock)
      .toSorted((left, right) => left.exampleId.localeCompare(right.exampleId));
    const core = {
      schemaVersion: EXP0018_DATASET_VERSION,
      datasetId: `exp-0018-context-${role}-v0.1`,
      experimentId: "EXP-0018",
      locale: "pt-BR",
      role,
      fitEligibility: role === "fit" ? "fit" :
        role === "calibration" ? "threshold-only" : "evaluation-only",
      classes: [...EXP0018_CLASSES],
      featureVersion: EXP0018_FEATURE_VERSION,
      featureNames: [...EXP0018_FEATURE_NAMES],
      provenance: {
        catalogSha256,
        experimentConfigFileSha256:
          provenance.experimentConfigFileSha256 ?? null,
        generationMethod: "deterministic-crossed-2x2",
        externalModelCalls: 0,
        paidApiCalls: 0
      },
      summary: {
        crossBlocks: roleBlockIds.size,
        pairRoots: new Set(examples.map((item) => item.pairRootId)).size,
        examples: examples.length,
        labels: objectFromSortedMap(countBy(examples, (item) => item.label)),
        families: objectFromSortedMap(countBy(examples, (item) => item.family))
      },
      examples
    };
    datasets[role] = deepFreeze({
      ...core,
      datasetSha256: `sha256:${canonicalSha256(core)}`
    });
  }
  return deepFreeze({ audit, catalogSha256, datasets });
}

export function validateExp0018Dataset(dataset, options = {}) {
  const errors = [];
  const core = canonicalCore(dataset, "datasetSha256");
  const observedHash = `sha256:${canonicalSha256(core)}`;
  if (dataset?.schemaVersion !== EXP0018_DATASET_VERSION) {
    errors.push("schemaVersion de dataset incompatível");
  }
  if (dataset?.datasetSha256 !== observedHash) {
    errors.push("datasetSha256 divergente");
  }
  if (
    !ROLE_SET.has(dataset?.role) ||
    dataset?.experimentId !== "EXP-0018" ||
    dataset?.locale !== "pt-BR" ||
    dataset?.datasetId !== `exp-0018-context-${dataset?.role}-v0.1` ||
    !sameArray(dataset?.classes, EXP0018_CLASSES) ||
    dataset?.featureVersion !== EXP0018_FEATURE_VERSION ||
    !sameArray(dataset?.featureNames, EXP0018_FEATURE_NAMES)
  ) {
    errors.push("identidade, papel, classes ou features incompatíveis");
  }
  const expected = EXP0018_ROLE_CONTRACT[dataset?.role];
  const examples = Array.isArray(dataset?.examples) ? dataset.examples : [];
  const expectedFitEligibility = dataset?.role === "fit" ? "fit" :
    dataset?.role === "calibration" ? "threshold-only" : "evaluation-only";
  if (dataset?.fitEligibility !== expectedFitEligibility) {
    errors.push("fitEligibility diverge do papel");
  }
  const observedSummary = {
    crossBlocks: new Set(examples.map((item) => item.crossBlockRootId)).size,
    pairRoots: new Set(examples.map((item) => item.pairRootId)).size,
    examples: examples.length,
    labels: objectFromSortedMap(countBy(examples, (item) => item.label)),
    families: objectFromSortedMap(countBy(examples, (item) => item.family))
  };
  if (
    !expected ||
    dataset?.summary?.crossBlocks !== expected.crossBlocks ||
    dataset?.summary?.pairRoots !== expected.pairRoots ||
    dataset?.summary?.examples !== expected.examples ||
    examples.length !== expected.examples ||
    !same(dataset?.summary, observedSummary)
  ) {
    errors.push("pisos ou sumário do dataset divergentes");
  }
  if (
    dataset?.provenance?.generationMethod !== "deterministic-crossed-2x2" ||
    !/^sha256:[a-f0-9]{64}$/u.test(dataset?.provenance?.catalogSha256 ?? "") ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      dataset?.provenance?.experimentConfigFileSha256 ?? ""
    ) ||
    dataset?.provenance?.externalModelCalls !== 0 ||
    dataset?.provenance?.paidApiCalls !== 0
  ) {
    errors.push("proveniência do dataset incompatível");
  }
  if (new Set(examples.map((item) => item.exampleId)).size !== examples.length) {
    errors.push("exampleId duplicado");
  }
  const pairGroups = Map.groupBy(examples, (example) => example.pairRootId);
  for (const [pairRootId, descendants] of pairGroups) {
    if (
      descendants.length !== 2 ||
      new Set(descendants.map((item) => item.label)).size !== 2 ||
      new Set(descendants.map(
        (item) => normalizeExp0018Text(item.modelInput?.targetText)
      )).size !== 1
    ) {
      errors.push(`${pairRootId}: par inválido`);
    }
  }
  const crossBlocks = Map.groupBy(
    examples,
    (example) => example.crossBlockRootId
  );
  for (const [crossBlockRootId, descendants] of crossBlocks) {
    if (
      descendants.length !== 4 ||
      new Set(descendants.map((item) =>
        `${item.targetSurfaceId}|${item.contextSurfaceId}`
      )).size !== 4 ||
      EXP0018_CLASSES.some((label) =>
        descendants.filter((item) => item.label === label).length !== 2
      )
    ) {
      errors.push(`${crossBlockRootId}: cartesiano 2x2 inválido`);
    }
  }
  for (const example of examples) {
    if (
      !validId(example?.exampleId) ||
      !validId(example?.pairRootId) ||
      !validId(example?.crossBlockRootId) ||
      !validId(example?.semanticLineageId) ||
      !validId(example?.targetSurfaceId) ||
      !validId(example?.contextSurfaceId) ||
      !FAMILY_SET.has(example?.family) ||
      !CLASS_SET.has(example?.label)
    ) {
      errors.push(`${example?.exampleId ?? "exemplo"}: metadados inválidos`);
    }
    const validation = validateExp0018ModelInput(example?.modelInput);
    if (!validation.valid) {
      errors.push(`${example?.exampleId ?? "exemplo"}: ${validation.errors.join("; ")}`);
    }
    try {
      if (
        example?.exampleId !==
          exampleId(example?.pairRootId, example?.modelInput)
      ) {
        errors.push(`${example?.exampleId ?? "exemplo"}: exampleId divergente`);
      }
    } catch {
      errors.push(`${example?.exampleId ?? "exemplo"}: exampleId irrecomputável`);
    }
  }
  if (
    options.experimentConfigFileSha256 !== undefined &&
    dataset?.provenance?.experimentConfigFileSha256 !==
      options.experimentConfigFileSha256
  ) {
    errors.push("dataset diverge da configuração autoritativa");
  }
  if (options.catalog !== undefined && ROLE_SET.has(dataset?.role)) {
    try {
      const expectedDataset = buildExp0018Datasets(options.catalog, {
        experimentConfigFileSha256:
          options.experimentConfigFileSha256 ??
          dataset?.provenance?.experimentConfigFileSha256
      }).datasets[dataset.role];
      if (!same(dataset, expectedDataset)) {
        errors.push("dataset diverge da reconstrução autoritativa do catálogo");
      }
    } catch (error) {
      errors.push(`catálogo autoritativo inválido: ${error.message}`);
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors, observedHash });
}
