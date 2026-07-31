const IRREVERSIBLE_AMOUNT_ACTION =
  /\b(?:transf\p{Letter}*|pag\p{Letter}*|pix|deposit\p{Letter}*|envi\p{Letter}*)\b/iu;

export const CRITICAL_CONFIRMATION_POLICY =
  "repeat-critical-value-before-commit";

export function planCriticalConfirmation(text, correction) {
  if (
    correction?.slot !== "amount" ||
    !IRREVERSIBLE_AMOUNT_ACTION.test(String(text ?? ""))
  ) {
    return null;
  }
  return Object.freeze({
    confirmationRequired: true,
    policy: CRITICAL_CONFIRMATION_POLICY,
    reason: "irreversible-corrected-amount",
    slot: "amount",
    proposedValue: correction.current,
    prompt:
      "Só para confirmar com segurança: qual é o valor final da transferência?"
  });
}
