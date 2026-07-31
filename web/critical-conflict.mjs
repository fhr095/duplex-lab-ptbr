function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

export function createCriticalConflictClarification(conflict) {
  if (
    conflict?.kind !== "numeric-correction-conflict" ||
    !Array.isArray(conflict.alternatives) ||
    conflict.alternatives.length !== 2 ||
    !conflict.alternatives.every(Number.isFinite)
  ) {
    throw new TypeError("conflito numérico crítico inválido");
  }
  const [first, second] = conflict.alternatives;
  return `Só confirmando: ${formatCurrency(first)} ou ` +
    `${formatCurrency(second)}?`;
}
