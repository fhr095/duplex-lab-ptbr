function finiteProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateExp0016BrowserReport(report, expected = {}) {
  const errors = [];
  if (report?.schemaVersion !== "exp-0016-browser-shadow-report-v1") {
    errors.push("schemaVersion incompatível");
  }
  if (
    expected.experimentId &&
    report?.experimentId !== expected.experimentId
  ) {
    errors.push("experimentId divergente");
  }
  if (
    expected.datasetSha256 &&
    report?.dataset?.sha256 !== expected.datasetSha256
  ) {
    errors.push("dataset divergente");
  }
  if (
    expected.modelSha256 &&
    report?.checkpoint?.modelSha256 !== expected.modelSha256
  ) {
    errors.push("checkpoint divergente");
  }
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  if (cases.length !== 4) {
    errors.push("quatro casos são obrigatórios");
  }
  const hashes = new Set();
  for (const item of cases) {
    const probabilities = item?.browser?.probabilities ?? {};
    const nodeProbabilities = item?.node?.probabilities ?? {};
    const probabilityLabels = [
      "BACKGROUND_OR_NOT_DIRECTED",
      "DIRECTED_TO_ASSISTANT"
    ];
    if (
      item?.evaluationRole !== "browser-runtime-contract-only" ||
      item?.fitEligibility !== "excluded-from-fit" ||
      !/^sha256:[a-f0-9]{64}$/u.test(
        item?.artifact?.waveSha256 ?? ""
      ) ||
      item?.browser?.futureSamplesUsed !== 0 ||
      item?.browser?.authority !== false ||
      item?.parity?.labels !== true ||
      item?.parity?.probabilities !== true ||
      !probabilityLabels.every(
        (label) => finiteProbability(probabilities[label]) &&
          finiteProbability(nodeProbabilities[label]) &&
          probabilities[label] === nodeProbabilities[label]
      ) ||
      Math.abs(
        Object.values(probabilities).reduce(
          (sum, value) => sum + value,
          0
        ) - 1
      ) > 1e-12
    ) {
      errors.push(`${item?.probeId ?? "caso"} é incompatível`);
    }
    hashes.add(item?.artifact?.waveSha256);
  }
  if (hashes.size !== cases.length) {
    errors.push("áudios de probe precisam ser distintos");
  }
  const derivedGates = {
    checkpointLoaded:
      report?.checkpoint?.modelSha256 === expected.modelSha256,
    fourRuntimeCases: cases.length === 4,
    distinctAudio: hashes.size === 4,
    causal: cases.every(
      (item) => item?.browser?.futureSamplesUsed === 0
    ),
    nodeBrowserParity: cases.every(
      (item) => item?.parity?.labels && item?.parity?.probabilities
    ),
    noAuthority: cases.every(
      (item) => item?.browser?.authority === false
    )
  };
  for (const [gate, value] of Object.entries(derivedGates)) {
    if (report?.gates?.[gate] !== value || value !== true) {
      errors.push(`gate browser divergente: ${gate}`);
    }
  }
  if (
    report?.dataset?.fitExamplesFromBrowserProbes !== 0 ||
    report?.metrics?.cases !== cases.length ||
    report?.metrics?.maximumFutureSamplesUsed !== 0 ||
    report?.authorityEligible !== false ||
    report?.pass !== true
  ) {
    errors.push("sumário ou fronteira de autoridade divergente");
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}

export function validateExp0016CanonicalReport(report) {
  const errors = [];
  if (report?.schemaVersion !== "exp-0016-speaker-relevance-m4b-report-v1") {
    errors.push("schemaVersion incompatível");
  }
  const gates = Object.values(report?.gates ?? {});
  if (
    gates.length < 20 ||
    gates.some((value) => value !== true) ||
    report?.pass !== true ||
    report?.shadowCandidateReady !== true ||
    report?.decision !== "promote-m4b-speaker-relevance-shadow-candidate"
  ) {
    errors.push("promoção shadow não corresponde aos gates");
  }
  if (
    report?.safeVetoOfflineReady !== false ||
    report?.authorityEligible !== false ||
    !report?.authorityBlockers?.some((value) =>
      value.includes("veto conservador")
    )
  ) {
    errors.push("limite de autoridade não está preservado");
  }
  if (
    report?.metrics?.dataset?.humanFitExamples !== 0 ||
    report?.metrics?.humanAnchor?.rawHumanRecordsUsedForFit !== 0 ||
    report?.metrics?.humanAnchor?.futureSamplesUsed !== 0 ||
    report?.metrics?.browserShadow?.maximumFutureSamplesUsed !== 0
  ) {
    errors.push("fronteira causal ou de fit humano divergente");
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}
