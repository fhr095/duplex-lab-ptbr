export const PREFINAL_POLICY_LINGUISTIC_COMPLETE =
  "linguistic-complete";
export const PREFINAL_POLICY_ACOUSTIC_FIXED_BOUNDARY =
  "acoustic-eager-fixed-boundary";

export const PREFINAL_POLICIES = Object.freeze([
  PREFINAL_POLICY_LINGUISTIC_COMPLETE,
  PREFINAL_POLICY_ACOUSTIC_FIXED_BOUNDARY
]);

export function normalizePrefinalPolicy(
  value = PREFINAL_POLICY_LINGUISTIC_COMPLETE
) {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();
  if (!PREFINAL_POLICIES.includes(normalized)) {
    throw new TypeError(
      `política de prefinal inválida: ${value}; use ` +
        PREFINAL_POLICIES.join(" ou ")
    );
  }
  return normalized;
}
