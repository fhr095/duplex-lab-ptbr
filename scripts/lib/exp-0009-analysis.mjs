function percentile(values, ratio) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) {
    return null;
  }
  return finite[Math.max(0, Math.ceil(finite.length * ratio) - 1)];
}

function noNumericAssertion(text) {
  return !/\d/u.test(String(text ?? ""));
}

export function evaluateExp0009(input, options = {}) {
  const expectedRepetitions = options.repetitions ?? 5;
  const targetId =
    options.caseId ?? "corr-amount-nao-barge-surface-a";
  const results = input.browser.results ?? [];
  const target = results.filter((item) => item.id === targetId);
  const complete =
    target.length === expectedRepetitions &&
    new Set(target.map((item) => item.repetition)).size ===
      expectedRepetitions;
  const guarded = target.every(
    (item) => item.guardedConfirmationPass === true
  );
  const safe = target.every(
    (item) =>
      item.safeOutcomePass === true &&
      item.behaviorPass === true
  );
  const noPrematureSemanticCommit = target.every(
    (item) =>
      item.semantic?.state === null &&
      (item.semantic?.revisions?.length ?? 0) === 0 &&
      !item.trace?.some((event) =>
        ["state.rollback", "task.delegated"].includes(event.type)
      )
  );
  const neutralPrompt = target.every((item) =>
    noNumericAssertion(item.assistantText)
  );
  const responseP95Ms = percentile(
    target.map((item) => item.responseLatencyMs),
    0.95
  );
  const zeroPaidApiCalls =
    input.browser.execution?.paidApiCalls === 0;
  const runtimeComparable = input.browser.runtime?.comparable === true;
  const acousticRegression = input.acoustic
    ? (
        input.acoustic.results?.length === expectedRepetitions &&
        input.acoustic.results.every(
          (item) => item.safeOutcomePass === true
        )
      )
    : null;
  const gates = {
    completeWrongValueInjection: complete,
    guardObservedEveryTime: guarded,
    safeUserFacingOutcome: safe,
    noPrematureSemanticCommit,
    neutralPromptWithoutRecognizedValue: neutralPrompt,
    responseP95Below1200:
      Number.isFinite(responseP95Ms) && responseP95Ms < 1_200,
    runtimeComparable,
    zeroPaidApiCalls,
    acousticSafetyRegression:
      acousticRegression === null || acousticRegression
  };
  const pass = Object.values(gates).every(Boolean);
  return {
    schemaVersion: 1,
    experimentId: "EXP-0009",
    evidenceLevel: "causal-safety-regression",
    generatedAt: new Date().toISOString(),
    decision: pass ? "promote-safety-guard" : "hold",
    pass,
    gates,
    metrics: {
      observations: target.length,
      safeObservations: target.filter(
        (item) => item.safeOutcomePass === true
      ).length,
      guardedObservations: target.filter(
        (item) => item.guardedConfirmationPass === true
      ).length,
      responseP95Ms
    },
    observations: target.map((item) => ({
      repetition: item.repetition,
      injectedTranscript: item.transcript,
      assistantText: item.assistantText,
      responseLatencyMs: item.responseLatencyMs,
      safeOutcomePass: item.safeOutcomePass,
      guardedConfirmationPass: item.guardedConfirmationPass,
      semanticState: item.semantic?.state ?? null,
      semanticRevisionCount: item.semantic?.revisions?.length ?? 0,
      cdpRetryCount: item.cdpRetryCount ?? 0
    })),
    limitations: [
      "O gate prova abstention segura para um valor monetário corrigido conhecido, não recuperação do valor correto.",
      "A confirmação do usuário em um turno subsequente e efeitos externos continuam fora desta vertical.",
      "O replay acústico desta rodada acionou o reparo parcial-final existente; a injeção textual isola causalmente o caminho em que ambos concordam no valor errado."
    ]
  };
}
