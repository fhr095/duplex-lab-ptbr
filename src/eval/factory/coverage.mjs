function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function combinations(left, right) {
  return left.flatMap((leftValue) =>
    right.map((rightValue) => `${leftValue}\u0000${rightValue}`)
  );
}

export function evaluateFactoryCoverage(pack) {
  const requirements = pack.coverage;
  const cases = pack.cases ?? [];
  const failures = [];
  const uniqueTextCount = new Set(
    cases.map((item) => normalizeText(item.stimulus?.text))
  ).size;
  const uniqueTextRatio = cases.length === 0
    ? 0
    : uniqueTextCount / cases.length;

  if (cases.length < requirements.minCases) {
    failures.push({
      id: "minimum-cases",
      actual: cases.length,
      expected: requirements.minCases
    });
  }
  if (uniqueTextRatio < requirements.minUniqueTextRatio) {
    failures.push({
      id: "unique-text",
      actual: uniqueTextRatio,
      expected: requirements.minUniqueTextRatio
    });
  }

  const dimensions = {};
  for (const [path, expectedValues] of Object.entries(
    requirements.dimensions
  )) {
    const counts = Object.fromEntries(
      expectedValues.map((value) => [value, 0])
    );
    for (const item of cases) {
      const value = getPath(item, path);
      if (Object.hasOwn(counts, value)) {
        counts[value] += 1;
      }
    }
    const missing = Object.entries(counts)
      .filter(([, count]) => count < requirements.minPerValue)
      .map(([value, count]) => ({ value, count }));
    dimensions[path] = { counts, missing };
    if (missing.length > 0) {
      failures.push({ id: `dimension:${path}`, missing });
    }
  }

  const entries = Object.entries(requirements.dimensions);
  let expectedPairs = 0;
  let observedPairs = 0;
  const missingPairs = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      const [leftPath, leftValues] = entries[leftIndex];
      const [rightPath, rightValues] = entries[rightIndex];
      const expected = combinations(leftValues, rightValues);
      const observed = new Set(
        cases.map(
          (item) =>
            `${getPath(item, leftPath)}\u0000${getPath(item, rightPath)}`
        )
      );
      expectedPairs += expected.length;
      for (const pair of expected) {
        if (observed.has(pair)) {
          observedPairs += 1;
        } else {
          const [left, right] = pair.split("\u0000");
          missingPairs.push({ leftPath, left, rightPath, right });
        }
      }
    }
  }
  const pairwiseRatio = expectedPairs === 0 ? 1 : observedPairs / expectedPairs;
  if (pairwiseRatio < requirements.minPairwiseRatio) {
    failures.push({
      id: "pairwise",
      actual: pairwiseRatio,
      expected: requirements.minPairwiseRatio
    });
  }

  return {
    pass: failures.length === 0,
    caseCount: cases.length,
    uniqueTextCount,
    uniqueTextRatio,
    dimensions,
    pairwise: {
      expected: expectedPairs,
      observed: observedPairs,
      ratio: pairwiseRatio,
      missing: missingPairs
    },
    failures
  };
}

