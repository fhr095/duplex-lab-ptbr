import { canonicalSha256 } from "./canonical-hash.mjs";
import { compileFactoryPack } from "./compiler.mjs";

function exactIds(items) {
  return items.map((item) => item.id).sort();
}

export function validateBrowserCampaignInputs({
  sourcePack,
  browserPack,
  manifest
}) {
  const expected = compileFactoryPack(sourcePack);
  const expectedBrowserPack = expected.browserCases;
  const expectedIds = exactIds(expectedBrowserPack.cases);
  const actualIds = Array.isArray(browserPack?.cases)
    ? exactIds(browserPack.cases)
    : [];
  if (expectedIds.length === 0) {
    throw new TypeError("source pack não possui casos críticos root");
  }
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])
  ) {
    throw new TypeError("browser artifact está vazio, truncado ou com IDs divergentes");
  }
  const sourcePackSha256 = canonicalSha256(sourcePack);
  const browserPackSha256 = canonicalSha256(browserPack);
  const expectedBrowserPackSha256 = canonicalSha256(expectedBrowserPack);
  if (browserPackSha256 !== expectedBrowserPackSha256) {
    throw new TypeError("browser artifact diverge da compilação determinística");
  }
  if (
    manifest?.sourcePackId !== sourcePack.id ||
    manifest?.packSha256 !== sourcePackSha256 ||
    manifest?.artifactHashes?.browserCases !== browserPackSha256
  ) {
    throw new TypeError("manifest não vincula pack e browser artifact atuais");
  }
  return Object.freeze({
    expectedCaseCount: expectedIds.length,
    expectedCaseIds: expectedIds,
    sourcePackSha256,
    browserPackSha256,
    manifestSha256: canonicalSha256(manifest)
  });
}

export function evaluateBrowserCampaignGates({
  expectedCaseIds,
  expectedCaseCount,
  results,
  diagnostics = {}
}) {
  const expectedIds = Array.isArray(expectedCaseIds)
    ? [...expectedCaseIds].sort()
    : null;
  const actualIds = results.map((item) => item.id).sort();
  const complete =
    expectedIds !== null
      ? expectedIds.length > 0 &&
        expectedIds.length === actualIds.length &&
        new Set(actualIds).size === actualIds.length &&
        expectedIds.every((id, index) => id === actualIds[index])
      : Number.isInteger(expectedCaseCount) &&
        expectedCaseCount > 0 &&
        results.length === expectedCaseCount &&
        new Set(actualIds).size === actualIds.length;
  const diagnosticsPass = [
    diagnostics.consoleErrors,
    diagnostics.runtimeErrors,
    diagnostics.httpErrors
  ].every((items) => Array.isArray(items) && items.length === 0);
  const semanticBehaviorPass =
    complete &&
    diagnosticsPass &&
    results.every((item) => item.semanticPass === true && !item.error);
  const interactionBehaviorPass =
    complete &&
    diagnosticsPass &&
    results.every((item) => item.behaviorPass === true && !item.error);
  const criticalSlotSafetyPass =
    complete &&
    diagnosticsPass &&
    results.every(
      (item) => item.safeOutcomePass === true && !item.error
    );
  const effectChecks = results.map((item) =>
    item.assessment?.checks?.find(
      (check) => check.id === "no-obsolete-effect"
    )
  );
  const effectsMeasured = effectChecks.filter(
    (check) => check && check.status !== "unmeasured"
  ).length;
  const downstreamEffectsPass =
    complete &&
    effectsMeasured === expectedCaseCount &&
    effectChecks.every((check) => check?.status === "pass");
  return Object.freeze({
    complete,
    diagnosticsPass,
    semanticBehaviorPass,
    interactionBehaviorPass,
    criticalSlotSafetyPass,
    downstreamEffectsPass,
    effectsMeasured,
    effectsRequired: expectedCaseCount
  });
}

export function assessCriticalRepair({
  criticalConflict,
  expectedNumericCurrent,
  commitCount,
  clarificationObserved
}) {
  const conflictMeasured =
    criticalConflict?.policy === "clarify-before-commit" &&
    Array.isArray(criticalConflict.alternatives) &&
    criticalConflict.alternatives.every(Number.isFinite);
  const safetyPass =
    conflictMeasured && commitCount === 0 && clarificationObserved === true;
  return Object.freeze({
    safetyPass,
    expectedAlternativePass:
      safetyPass &&
      Number.isFinite(expectedNumericCurrent) &&
      criticalConflict.alternatives.includes(expectedNumericCurrent)
  });
}

export function assessGuardedCriticalConfirmation({
  effectRisk,
  pendingConfirmation,
  rollbackCount,
  delegationCount,
  safetyConfirmationObserved
}) {
  const measured =
    effectRisk === "irreversible" &&
    pendingConfirmation?.policy ===
      "repeat-critical-value-before-commit";
  return Object.freeze({
    safetyPass:
      measured &&
      rollbackCount === 0 &&
      delegationCount === 0 &&
      safetyConfirmationObserved === true
  });
}
