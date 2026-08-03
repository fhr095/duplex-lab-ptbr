import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { validateExp0017ROraclePrefixMap } from
  "../src/eval/exp-0017-r-oracle.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const URLS = Object.freeze({
  config: new URL(
    "../eval/experiments/exp-0017-r-oracle-v0.1.json",
    import.meta.url
  ),
  plan: new URL(
    "../eval/experiments/exp-0017-supertonic-scenes.pt-BR.json",
    import.meta.url
  ),
  source: new URL(
    "../eval/sources/exp-0017-supertonic-v0.1.json",
    import.meta.url
  ),
  map: new URL(
    "../eval/datasets/exp-0017-r-oracle-prefixes-v0.1.json",
    import.meta.url
  ),
  cut: new URL(
    "../eval/invalidations/exp-0017-r-insufficient-causal-prefix-coverage-v0.1.json",
    import.meta.url
  ),
  summary: new URL(
    "../eval/reports/exp-0017-summary-v0.1.json",
    import.meta.url
  ),
  coreReport: new URL(
    "../eval/reports/exp-0017-core-development-v0.1.json",
    import.meta.url
  ),
  package: new URL("../package.json", import.meta.url)
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function bundle(url) {
  const bytes = await readFile(url);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

test("cut de R recomputa a fronteira causal e a inviabilidade por classe", async () => {
  const [config, plan, source, map, cut] = await Promise.all([
    bundle(URLS.config),
    bundle(URLS.plan),
    bundle(URLS.source),
    bundle(URLS.map),
    bundle(URLS.cut)
  ]);
  const mapValidation = validateExp0017ROraclePrefixMap(map.value, {
    sourceManifest: source.value,
    planFileSha256: sha256(plan.bytes),
    sourceManifestFileSha256: sha256(source.bytes)
  });
  assert.equal(
    mapValidation.valid,
    true,
    mapValidation.errors.join("; ")
  );
  assert.equal(config.value.executionAllowed, false);
  assert.equal(
    config.value.status,
    "cut-before-fit-insufficient-independent-causal-prefix-lineages"
  );
  assert.equal(cut.value.config.fileSha256, sha256(config.bytes));
  assert.equal(cut.value.evidence.prefixMapFileSha256, sha256(map.bytes));
  assert.equal(
    cut.value.evidence.prefixMapCanonicalSha256,
    map.value.mapSha256
  );
  for (const field of [
    "crossSplitLineagesAllowed",
    "eligibleCalibrationLineagesPerClass",
    "minimumEligibleFitLineagesPerClass",
    "minimumIndependentEligibleLineagesPerClass"
  ]) {
    assert.equal(
      config.value.frozenFeasibilityRequirements[field],
      cut.value.frozenRequirements[field]
    );
  }

  const labels = new Map(plan.value.scenes.train.map((scene) => [
    scene.id,
    scene.label
  ]));
  const accepted = map.value.sources.filter((sourceEntry) =>
    sourceEntry.partition === "train" && sourceEntry.status === "accepted"
  );
  assert.equal(accepted.length, 21);
  for (const label of [
    "BACKGROUND_OR_NOT_DIRECTED",
    "DIRECTED_TO_ASSISTANT"
  ]) {
    const observed = accepted.filter((entry) =>
      labels.get(entry.sceneId) === label
    ).length;
    const recorded = cut.value.evidence.train.byClass[label];
    assert.equal(observed, recorded.accepted);
    assert.equal(
      recorded.maximumFitAfterRequiredCalibration,
      observed - cut.value.frozenRequirements
        .eligibleCalibrationLineagesPerClass
    );
    assert.ok(
      observed < cut.value.frozenRequirements
        .minimumIndependentEligibleLineagesPerClass
    );
    const shortfallField = label === "BACKGROUND_OR_NOT_DIRECTED"
      ? "backgroundShortfall"
      : "directedShortfall";
    assert.equal(
      cut.value.infeasibility[shortfallField],
      cut.value.frozenRequirements.minimumIndependentEligibleLineagesPerClass -
        observed
    );
    assert.ok(
      recorded.maximumFitAfterRequiredCalibration <
        cut.value.frozenRequirements.minimumEligibleFitLineagesPerClass
    );
  }
  assert.equal(cut.value.executionBoundary.modelFitPerformed, false);
  assert.equal(cut.value.executionBoundary.thresholdSelected, false);
  assert.equal(
    cut.value.executionBoundary.developmentSemanticMetricsRead,
    false
  );
  assert.equal(cut.value.infeasibility.minimumFloorWeakened, false);
  assert.equal(cut.value.infeasibility.lineageOverlapIntroduced, false);
  assert.equal(cut.value.infeasibility.alternativeAlignmentModelTried, false);
});

test("resumo canônico fecha Core e R sem inventar conclusão semântica", async () => {
  const [summary, config, map, cut, coreReport] = await Promise.all([
    bundle(URLS.summary),
    bundle(URLS.config),
    bundle(URLS.map),
    bundle(URLS.cut),
    bundle(URLS.coreReport)
  ]);
  const core = structuredClone(summary.value);
  delete core.summarySha256;
  assert.equal(
    summary.value.summarySha256,
    `sha256:${canonicalSha256(core)}`
  );
  assert.equal(
    summary.value.semanticProbeR.configFileSha256,
    sha256(config.bytes)
  );
  assert.equal(
    summary.value.semanticProbeR.prefixMapFileSha256,
    sha256(map.bytes)
  );
  assert.equal(
    summary.value.semanticProbeR.cutRecordFileSha256,
    sha256(cut.bytes)
  );
  assert.equal(
    summary.value.core.reportFileSha256,
    sha256(coreReport.bytes)
  );
  assert.equal(summary.value.core.decision, coreReport.value.core.decision);
  assert.equal(summary.value.semanticProbeR.candidateFitPerformed, false);
  assert.equal(summary.value.semanticProbeR.qualityConclusionAvailable, false);
  assert.equal(summary.value.claims.semanticTextHelped, null);
  assert.equal(summary.value.claims.semanticTextFailed, null);
  assert.equal(summary.value.authority.canProduceEffects, false);
});

test("downstream inválido ou nunca executado não permanece no repositório", async () => {
  for (const relative of [
    "../eval/datasets/exp-0017-r-train-v0.1.json",
    "../eval/datasets/exp-0017-r-train-attestation-v0.1.json",
    "../eval/datasets/exp-0017-r-development-v0.1.json",
    "../eval/datasets/exp-0017-r-freeze-v0.1.json",
    "../eval/checkpoints/exp-0017-r-oracle-v0.1.json",
    "../eval/reports/exp-0017-r-development-v0.1.json"
  ]) {
    await assert.rejects(access(new URL(relative, import.meta.url)));
  }
  const packageValue = (await bundle(URLS.package)).value;
  for (const suffix of ["data", "data:check", "train", "train:check", "dev",
    "dev:check"]) {
    assert.equal(packageValue.scripts[`eval:exp:0017:r:${suffix}`], undefined);
  }
});
