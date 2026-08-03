import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXP0018_CLASSES,
  EXP0018_FEATURE_NAMES,
  EXP0018_PREFIT_CONFIG_CANONICAL_SHA256,
  EXP0018_ROLE_CONTRACT,
  auditExp0018Catalog,
  blindExp0018CatalogProjection,
  buildExp0018Datasets,
  extractExp0018ContextFeatures,
  normalizeExp0018Text,
  projectExp0018ModelInput,
  validateExp0018Dataset,
  validateExp0018ModelInput
} from "../src/eval/exp-0018-context.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";
import {
  predictSoftmaxClassifier,
  trainSoftmaxClassifier
} from "../src/learning/softmax-classifier.mjs";
import {
  buildExp0018ContextDatasets,
  validateExp0018InstrumentationConfig
} from
  "../scripts/build-exp-0018-context-datasets.mjs";

const PATHS = Object.freeze({
  config: new URL(
    "../eval/experiments/exp-0018-context-observability-v0.1.json",
    import.meta.url
  ),
  catalog: new URL(
    "../eval/experiments/exp-0018-context-pairs.pt-BR.v0.1.json",
    import.meta.url
  ),
  fit: new URL(
    "../eval/datasets/exp-0018-context-fit-v0.1.json",
    import.meta.url
  ),
  calibration: new URL(
    "../eval/datasets/exp-0018-context-calibration-v0.1.json",
    import.meta.url
  ),
  development: new URL(
    "../eval/datasets/exp-0018-context-development-v0.1.json",
    import.meta.url
  ),
  audit: new URL(
    "../eval/commitments/exp-0018-instrumentation-audit-v0.1.json",
    import.meta.url
  ),
  blindReview: new URL(
    "../eval/commitments/exp-0018-blind-semantic-review-v0.1.json",
    import.meta.url
  )
});

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function fileSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function viewCeiling(examples, projection) {
  const groups = Map.groupBy(examples, projection);
  let bestCorrect = 0;
  for (const descendants of groups.values()) {
    const counts = EXP0018_CLASSES.map((label) =>
      descendants.filter((item) => item.label === label).length
    );
    bestCorrect += Math.max(...counts);
  }
  return bestCorrect / examples.length;
}

test("catálogo congela 24 blocos 2x2 e a maior unidade independente", async () => {
  const catalog = await json(PATHS.catalog);
  const audit = auditExp0018Catalog(catalog);

  assert.equal(audit.valid, true, audit.errors.join("; "));
  assert.equal(
    catalog.provenance.generationMethod,
    "coding-agent-authored-controlled-crossed-blocks"
  );
  assert.equal(catalog.provenance.aiCriticsUsed, 2);
  assert.equal(
    catalog.provenance.externalProjectApiCallsDuringMaterialization,
    0
  );
  assert.equal(audit.counts.crossBlocks, 24);
  assert.equal(audit.counts.pairRoots, 48);
  assert.equal(audit.counts.examples, 96);
  assert.deepEqual(audit.counts.byRole, {
    fit: {
      crossBlocks: 12,
      pairRoots: 24,
      examples: 48,
      labels: {
        BACKGROUND_OR_NOT_DIRECTED: 24,
        DIRECTED_TO_ASSISTANT: 24
      }
    },
    calibration: {
      crossBlocks: 4,
      pairRoots: 8,
      examples: 16,
      labels: {
        BACKGROUND_OR_NOT_DIRECTED: 8,
        DIRECTED_TO_ASSISTANT: 8
      }
    },
    development: {
      crossBlocks: 8,
      pairRoots: 16,
      examples: 32,
      labels: {
        BACKGROUND_OR_NOT_DIRECTED: 16,
        DIRECTED_TO_ASSISTANT: 16
      }
    }
  });
  assert.equal(audit.distinct.semanticLineages, 24);
  assert.equal(audit.distinct.targetSurfaces, 48);
  assert.equal(audit.distinct.contextSurfaces, 48);
  assert.deepEqual(audit.nearDuplicates, []);
  assert.deepEqual(audit.crossRoleNearDuplicates, []);
  assert.ok(Object.values(audit.leakageChecks).every(Boolean));
});

test("duas críticas cegas vinculam a projeção sem oracle e aprovam o reparo", async () => {
  const [catalogBytes, review] = await Promise.all([
    readFile(PATHS.catalog),
    json(PATHS.blindReview)
  ]);
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  const projection = blindExp0018CatalogProjection(catalog);
  assert.equal(review.catalog.fileSha256, fileSha256(catalogBytes));
  assert.equal(
    review.catalog.canonicalSha256,
    `sha256:${canonicalSha256(catalog)}`
  );
  assert.equal(
    review.blindProjection.canonicalSha256,
    `sha256:${canonicalSha256(projection)}`
  );
  assert.equal("oracle" in projection.blocks[0], false);
  assert.equal(review.chronology.finalCatalog.criticA.blockers, 0);
  assert.equal(review.chronology.finalCatalog.criticB.blockers, 0);
  assert.equal(review.chronology.finalCatalog.criticB.passed, 24);
  assert.equal(review.reviewers.humanReviewers, 0);
  assert.equal(review.boundary.fitAuthorized, false);
  const core = structuredClone(review);
  delete core.reviewSha256;
  assert.equal(
    review.reviewSha256,
    `sha256:${canonicalSha256(core)}`
  );
});

test("cada bloco é cartesiano e target/context isolados têm teto exato de 50%", async () => {
  const catalog = await json(PATHS.catalog);
  const { datasets } = buildExp0018Datasets(catalog, {
    experimentConfigFileSha256: `sha256:${"0".repeat(64)}`
  });

  for (const [role, dataset] of Object.entries(datasets)) {
    const expected = EXP0018_ROLE_CONTRACT[role];
    assert.equal(dataset.summary.crossBlocks, expected.crossBlocks);
    assert.equal(dataset.summary.pairRoots, expected.pairRoots);
    assert.equal(dataset.summary.examples, expected.examples);
    assert.equal(
      viewCeiling(dataset.examples, (item) => item.targetSurfaceId),
      0.5
    );
    assert.equal(
      viewCeiling(dataset.examples, (item) => item.contextSurfaceId),
      0.5
    );
    assert.equal(
      viewCeiling(dataset.examples, (item) => item.pairRootId),
      0.5
    );
    assert.equal(
      viewCeiling(dataset.examples, (item) => item.crossBlockRootId),
      0.5
    );

    const blocks = Map.groupBy(
      dataset.examples,
      (item) => item.crossBlockRootId
    );
    for (const descendants of blocks.values()) {
      assert.equal(descendants.length, 4);
      assert.equal(new Set(descendants.map(
        (item) => `${item.targetSurfaceId}|${item.contextSurfaceId}`
      )).size, 4);
      assert.deepEqual(
        Object.fromEntries(EXP0018_CLASSES.map((label) => [
          label,
          descendants.filter((item) => item.label === label).length
        ])),
        {
          BACKGROUND_OR_NOT_DIRECTED: 2,
          DIRECTED_TO_ASSISTANT: 2
        }
      );
    }
  }
});

test("datasets materializados fecham hashes, papéis e config prefit", async () => {
  const [configBytes, catalogBytes, audit, ...datasets] = await Promise.all([
    readFile(PATHS.config),
    readFile(PATHS.catalog),
    json(PATHS.audit),
    json(PATHS.fit),
    json(PATHS.calibration),
    json(PATHS.development)
  ]);
  const config = JSON.parse(configBytes.toString("utf8"));
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  assert.equal(config.executionAllowed, false);
  assert.equal(config.status, "instrumentation-only-prefit-audit-required");
  assert.equal(config.independentUnit, "crossBlockRootId");
  assert.equal(config.budget.developmentStructuralAuditRuns, 1);
  assert.equal(config.budget.developmentCandidateMetricRuns, 0);
  assert.equal(config.budget.experimentRuntimeExternalModelCalls, 0);
  assert.equal(config.budget.experimentRuntimePaidApiCalls, 0);
  assert.equal(config.authority.canProduceEffects, false);
  assert.deepEqual(config.features.names, EXP0018_FEATURE_NAMES);
  assert.equal(
    `sha256:${canonicalSha256(config)}`,
    EXP0018_PREFIT_CONFIG_CANONICAL_SHA256
  );

  for (const dataset of datasets) {
    const validation = validateExp0018Dataset(dataset, {
      catalog,
      experimentConfigFileSha256: fileSha256(configBytes)
    });
    assert.equal(validation.valid, true, validation.errors.join("; "));
    assert.equal(
      dataset.provenance.experimentConfigFileSha256,
      fileSha256(configBytes)
    );
    assert.equal(
      dataset.provenance.catalogSha256,
      `sha256:${canonicalSha256(JSON.parse(catalogBytes.toString("utf8")))}`
    );
  }
  const auditCore = structuredClone(audit);
  delete auditCore.instrumentationAuditSha256;
  assert.equal(
    audit.instrumentationAuditSha256,
    `sha256:${canonicalSha256(auditCore)}`
  );
  assert.ok(Object.values(audit.gates).every(Boolean));
  assert.deepEqual(audit.boundary, {
    modelFitPerformed: false,
    thresholdSelected: false,
    developmentStructuralAuditPerformed: true,
    developmentCandidatePredictionsRead: false,
    developmentCandidateMetricsRead: false,
    fitAuthorized: false,
    canProduceEffects: false
  });
});

test("qualquer drift decisório da configuração inteira bloqueia o builder", async () => {
  const config = await json(PATHS.config);
  validateExp0018InstrumentationConfig(config);
  const mutations = [
    (value) => { value.trainer.epochs += 1; },
    (value) => { value.calibration.tieBreak = "lowest-threshold"; },
    (value) => { value.development.openingsAllowed = 2; },
    (value) => { value.gates.minimumB1BackgroundRecall = 0.5; },
    (value) => { value.independentUnit = "pairRootId"; },
    (value) => { value.authority.canProduceEffects = true; }
  ];
  for (const mutate of mutations) {
    const poisoned = structuredClone(config);
    mutate(poisoned);
    assert.throws(
      () => validateExp0018InstrumentationConfig(poisoned),
      /compromisso prefit/iu
    );
  }
});

test("builder reproduz byte a byte sem avaliar candidato em development", async () => {
  const result = await buildExp0018ContextDatasets();
  const expected = await Promise.all([
    readFile(PATHS.fit),
    readFile(PATHS.calibration),
    readFile(PATHS.development),
    readFile(PATHS.audit)
  ]);
  assert.equal(result.bytes.fit.equals(expected[0]), true);
  assert.equal(result.bytes.calibration.equals(expected[1]), true);
  assert.equal(result.bytes.development.equals(expected[2]), true);
  assert.equal(result.bytes.audit.equals(expected[3]), true);
  assert.equal(result.audit.boundary.modelFitPerformed, false);
  assert.equal(
    result.audit.boundary.developmentCandidateMetricsRead,
    false
  );
});

test("payload visível falha fechado para label, identidade e metadados", async () => {
  const dataset = await json(PATHS.fit);
  const clean = dataset.examples[0].modelInput;
  assert.equal(validateExp0018ModelInput(clean).valid, true);

  for (const [key, value] of [
    ["label", "DIRECTED_TO_ASSISTANT"],
    ["pairRole", "diagonal"],
    ["intendedContext", "assistant"],
    ["speakerId", "human-1"],
    ["crossBlockRootId", "hidden-lineage"]
  ]) {
    const poisoned = { ...clean, [key]: value };
    assert.equal(validateExp0018ModelInput(poisoned).valid, false);
    assert.throws(
      () => extractExp0018ContextFeatures(poisoned, {
        contextEnabled: true
      }),
      /modelInput inválido/iu
    );
  }
});

test("B0 preserva dimensão e zera somente os slots contextuais", async () => {
  const dataset = await json(PATHS.fit);
  const pairs = Map.groupBy(dataset.examples, (item) => item.pairRootId);
  const contextMask = EXP0018_FEATURE_NAMES.indexOf("contextMask");
  for (const descendants of pairs.values()) {
    const b0 = descendants.map((item) =>
      extractExp0018ContextFeatures(projectExp0018ModelInput(
        item.modelInput,
        { contextEnabled: false }
      ), {
        contextEnabled: false
      })
    );
    const b1 = descendants.map((item) =>
      extractExp0018ContextFeatures(projectExp0018ModelInput(
        item.modelInput,
        { contextEnabled: true }
      ), {
        contextEnabled: true
      })
    );
    assert.deepEqual(b0[0].values, b0[1].values);
    assert.equal(b0[0].values.length, EXP0018_FEATURE_NAMES.length);
    assert.ok(b0[0].values.slice(contextMask).every((value) => value === 0));
    assert.deepEqual(
      b0[0].values.slice(0, contextMask),
      b1[0].values.slice(0, contextMask)
    );
    assert.equal(b1[0].values[contextMask], 1);
  }
});

test("B0 recebe projeção target-only e não acessa nenhum campo contextual", () => {
  const targetOnly = {
    assistantSpeaking: true,
    targetText: "sábado de manhã"
  };
  assert.equal(validateExp0018ModelInput(targetOnly, {
    contextEnabled: false
  }).valid, true);
  const features = extractExp0018ContextFeatures(targetOnly, {
    contextEnabled: false
  });
  const contextMask = EXP0018_FEATURE_NAMES.indexOf("contextMask");
  assert.ok(features.values.slice(contextMask).every((value) => value === 0));
  assert.equal(features.normalized.assistantAudiblePrefixAtDecision, null);
  assert.equal(features.normalized.recentInbound, null);

  const forbiddenContext = { ...targetOnly };
  Object.defineProperty(forbiddenContext, "assistantAudiblePrefixAtDecision", {
    enumerable: false,
    get() {
      throw new Error("B0 tentou ler contexto");
    }
  });
  Object.defineProperty(forbiddenContext, "recentInbound", {
    enumerable: false,
    get() {
      throw new Error("B0 tentou ler inbound");
    }
  });
  assert.doesNotThrow(() => extractExp0018ContextFeatures(
    forbiddenContext,
    { contextEnabled: false }
  ));
});

function toyInput(target, assistantTopic, inboundTopic) {
  return {
    assistantAudiblePrefixAtDecision:
      `Você escolhe ${assistantTopic} para esta resposta?`,
    assistantSpeaking: true,
    recentInbound: [`A outra conversa perguntou por ${inboundTopic}.`],
    targetText: target
  };
}

function toyBlock(left, right) {
  return [
    { label: "DIRECTED_TO_ASSISTANT",
      input: toyInput(left, left, right) },
    { label: "BACKGROUND_OR_NOT_DIRECTED",
      input: toyInput(left, right, left) },
    { label: "BACKGROUND_OR_NOT_DIRECTED",
      input: toyInput(right, left, right) },
    { label: "DIRECTED_TO_ASSISTANT",
      input: toyInput(right, right, left) }
  ];
}

test("feature relacional resolve checkerboard novo; concatenação marginal não é necessária", () => {
  const fit = [
    ...toyBlock("âmbar", "violino"),
    ...toyBlock("cacto", "planeta"),
    ...toyBlock("neblina", "martelo")
  ];
  const classifier = trainSoftmaxClassifier({
    examples: fit.map((item) => ({
      label: item.label,
      features: extractExp0018ContextFeatures(projectExp0018ModelInput(
        item.input,
        { contextEnabled: true }
      ), {
        contextEnabled: true
      }).values
    })),
    classNames: EXP0018_CLASSES,
    featureCount: EXP0018_FEATURE_NAMES.length,
    epochs: 3000,
    learningRate: 0.25,
    l2: 0.001
  });
  const unseen = toyBlock("safira", "trompete");
  const predicted = unseen.map((item) => predictSoftmaxClassifier(
    classifier,
    extractExp0018ContextFeatures(projectExp0018ModelInput(
      item.input,
      { contextEnabled: true }
    ), {
      contextEnabled: true
    }).values
  ).label);
  assert.deepEqual(predicted, unseen.map((item) => item.label));

  const b0Fit = trainSoftmaxClassifier({
    examples: fit.map((item) => ({
      label: item.label,
      features: extractExp0018ContextFeatures(projectExp0018ModelInput(
        item.input,
        { contextEnabled: false }
      ), {
        contextEnabled: false
      }).values
    })),
    classNames: EXP0018_CLASSES,
    featureCount: EXP0018_FEATURE_NAMES.length,
    epochs: 3000,
    learningRate: 0.25,
    l2: 0.001
  });
  const sameTarget = unseen.slice(0, 2).map((item) =>
    predictSoftmaxClassifier(
      b0Fit,
      extractExp0018ContextFeatures(projectExp0018ModelInput(
        item.input,
        { contextEnabled: false }
      ), {
        contextEnabled: false
      }).values
    )
  );
  assert.deepEqual(sameTarget[0], sameTarget[1]);
});

test("tampering de hash, papel, oracle e ancestral falha antes do fit", async () => {
  const [catalog, fit, configBytes] = await Promise.all([
    json(PATHS.catalog),
    json(PATHS.fit),
    readFile(PATHS.config)
  ]);
  const poisonedHash = structuredClone(fit);
  poisonedHash.examples[0].modelInput.targetText += " alterado";
  assert.equal(validateExp0018Dataset(poisonedHash).valid, false);

  const coherentTamper = structuredClone(fit);
  coherentTamper.examples[0].modelInput.targetText += " alterado";
  coherentTamper.examples[0].exampleId = `e-${canonicalSha256({
    pairRootId: coherentTamper.examples[0].pairRootId,
    modelInput: coherentTamper.examples[0].modelInput
  }).slice(0, 20)}`;
  const tamperedCore = structuredClone(coherentTamper);
  delete tamperedCore.datasetSha256;
  coherentTamper.datasetSha256 = `sha256:${canonicalSha256(tamperedCore)}`;
  const coherentValidation = validateExp0018Dataset(coherentTamper, {
    catalog,
    experimentConfigFileSha256: fileSha256(configBytes)
  });
  assert.equal(coherentValidation.valid, false);
  assert.ok(coherentValidation.errors.some((error) =>
    /reconstrução autoritativa/iu.test(error)
  ));

  const crossedTarget = structuredClone(catalog);
  crossedTarget.blocks.find((item) => item.role === "development")
    .targets.a.text = crossedTarget.blocks.find((item) => item.role === "fit")
      .targets.a.text;
  assert.equal(auditExp0018Catalog(crossedTarget).valid, false);

  const duplicatedLineage = structuredClone(catalog);
  duplicatedLineage.blocks[1].semanticLineageId =
    duplicatedLineage.blocks[0].semanticLineageId;
  assert.equal(auditExp0018Catalog(duplicatedLineage).valid, false);

  const brokenOracle = structuredClone(catalog);
  brokenOracle.blocks[0].oracle.b = structuredClone(
    brokenOracle.blocks[0].oracle.a
  );
  const oracleAudit = auditExp0018Catalog(brokenOracle);
  assert.equal(oracleAudit.valid, false);
  assert.ok(oracleAudit.errors.some((error) => /checkerboard/iu.test(error)));

  const wrongChannelDuplicate = structuredClone(catalog);
  wrongChannelDuplicate.blocks[0].contexts.a
    .assistantAudiblePrefixAtDecision =
      wrongChannelDuplicate.blocks[0].contexts.a.recentInbound[0];
  const channelAudit = auditExp0018Catalog(wrongChannelDuplicate);
  assert.equal(channelAudit.valid, false);
  assert.ok(channelAudit.nearDuplicates.some((item) =>
    item.leftCrossBlockRootId ===
      wrongChannelDuplicate.blocks[0].crossBlockRootId &&
    item.rightCrossBlockRootId ===
      wrongChannelDuplicate.blocks[0].crossBlockRootId
  ));

  const sameRoleShortNearDuplicate = structuredClone(catalog);
  sameRoleShortNearDuplicate.blocks[1].targets.a.text = "sábado pela manhã";
  assert.notEqual(
    normalizeExp0018Text(
      sameRoleShortNearDuplicate.blocks[1].targets.a.text
    ),
    normalizeExp0018Text(
      sameRoleShortNearDuplicate.blocks[0].targets.a.text
    )
  );
  const shortAudit = auditExp0018Catalog(sameRoleShortNearDuplicate);
  assert.equal(shortAudit.valid, false);
  assert.ok(shortAudit.withinRoleNearDuplicates.length > 0);
});

test("auditor retorna invalid em vez de lançar para catálogo malformado", async () => {
  const catalog = await json(PATHS.catalog);
  const mutations = [
    (value) => { value.blocks = [null]; },
    (value) => { value.blocks[0].targets = null; },
    (value) => { value.blocks[0].contexts = null; },
    (value) => { value.blocks[0].oracle = null; },
    (value) => { value.blocks[0].contexts.a.recentInbound = null; }
  ];
  for (const mutate of mutations) {
    const poisoned = structuredClone(catalog);
    mutate(poisoned);
    let audit;
    assert.doesNotThrow(() => {
      audit = auditExp0018Catalog(poisoned);
    });
    assert.equal(audit.valid, false);
    assert.ok(audit.errors.length > 0);
  }
});

test("normalização PT-BR é determinística sem apagar distinção de conteúdo", () => {
  assert.equal(
    normalizeExp0018Text("  NÃO — Sábado, às 8h! "),
    "nao sabado as 8h"
  );
  assert.notEqual(
    normalizeExp0018Text("sala quatro"),
    normalizeExp0018Text("três caixas")
  );
});
