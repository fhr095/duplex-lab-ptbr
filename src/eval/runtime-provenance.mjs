export const RUNTIME_FINGERPRINT_ROOTS = Object.freeze([
  "src",
  "web",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
]);

const USAGE_FIELDS = Object.freeze([
  "requests",
  "inputTokens",
  "outputTokens",
  "totalTokens"
]);

export function measureUsageDelta(before, after) {
  if (
    !before?.process?.runId ||
    before.process.runId !== after?.process?.runId
  ) {
    throw new TypeError("telemetria de custo atravessou processos diferentes");
  }
  const delta = {};
  for (const field of USAGE_FIELDS) {
    const start = before?.usage?.[field];
    const end = after?.usage?.[field];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new TypeError(`telemetria de custo inválida: ${field}`);
    }
    delta[field] = end - start;
  }
  return Object.freeze({
    ...delta,
    paidApiCalls: before.brain === "local" ? 0 : delta.requests,
    externalLlmUsed: before.brain !== "local"
  });
}
