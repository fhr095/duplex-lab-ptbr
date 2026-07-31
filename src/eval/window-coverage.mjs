export function withinWindowCoverage(
  actual,
  expected,
  options = {}
) {
  if (
    !Number.isFinite(actual) ||
    !Number.isFinite(expected) ||
    actual < 0 ||
    expected <= 0
  ) {
    return false;
  }
  const absoluteTolerance = options.absoluteTolerance ?? 2;
  const relativeTolerance = options.relativeTolerance ?? 0.01;
  if (
    !Number.isFinite(absoluteTolerance) ||
    absoluteTolerance < 0 ||
    !Number.isFinite(relativeTolerance) ||
    relativeTolerance < 0
  ) {
    throw new RangeError("tolerância de cobertura inválida");
  }
  const tolerance = Math.max(
    absoluteTolerance,
    expected * relativeTolerance
  );
  return Math.abs(actual - expected) <= tolerance;
}
