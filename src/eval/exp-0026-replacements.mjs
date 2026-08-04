import { canonicalSha256 } from "./factory/canonical-hash.mjs";

export const EXP0026_REPLACEMENT_REASONS = Object.freeze([
  "PRE_SESSION_NO_SHOW",
  "PRE_SESSION_SCHEDULING_CONFLICT",
  "PRE_SESSION_TECHNICAL_INELIGIBILITY",
  "CONSENT_WITHDRAWN"
]);

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function coreLedger(value) {
  return {
    schemaVersion: value.schemaVersion,
    experimentId: value.experimentId,
    freezeSha256: value.freezeSha256,
    rosterManifestSha256: value.rosterManifestSha256,
    slots: value.slots,
    activations: value.activations
  };
}

export function createExp0026ReplacementLedger(freeze) {
  invariant(
    freeze?.schemaVersion === "exp-0026-session-freeze-v2" &&
      freeze?.experimentId === "EXP-0026",
    "freeze EXP-0026 v2 inválido"
  );
  invariant(Array.isArray(freeze.roster?.slots) && freeze.roster.slots.length === 6, "slots congelados ausentes");
  const core = {
    schemaVersion: "exp-0026-replacement-ledger-v1",
    experimentId: "EXP-0026",
    freezeSha256: freeze.freezeSha256,
    rosterManifestSha256: freeze.roster.manifestSha256,
    slots: freeze.roster.slots.map((slot) => ({
      slotId: slot.slotId,
      orderIndex: slot.orderIndex,
      primaryAlias: slot.primaryAlias,
      activeAlias: slot.primaryAlias
    })),
    activations: []
  };
  return {
    ...core,
    ledgerSha256: `sha256:${canonicalSha256(core)}`
  };
}

export function validateExp0026ReplacementLedger(freeze, ledger) {
  const errors = [];
  if (ledger?.schemaVersion !== "exp-0026-replacement-ledger-v1") errors.push("schema de ledger inválido");
  if (ledger?.freezeSha256 !== freeze?.freezeSha256) errors.push("ledger aponta para outro freeze");
  if (ledger?.rosterManifestSha256 !== freeze?.roster?.manifestSha256) errors.push("ledger aponta para outro roster privado");
  if (!Array.isArray(ledger?.slots) || ledger.slots.length !== 6) errors.push("ledger exige seis slots");
  if (!Array.isArray(ledger?.activations) || ledger.activations.length > 2) errors.push("ledger excede duas ativações");
  if (errors.length === 0) {
    const expectedHash = `sha256:${canonicalSha256(coreLedger(ledger))}`;
    if (ledger.ledgerSha256 !== expectedHash) errors.push("hash do ledger divergiu");
    const slotIds = ledger.slots.map((item) => item.slotId);
    if (new Set(slotIds).size !== 6) errors.push("slots do ledger não são únicos");
    const activeAliases = ledger.slots.map((item) => item.activeAlias);
    if (new Set(activeAliases).size !== 6) errors.push("alias ativo aparece em mais de um slot");
  }
  return { valid: errors.length === 0, errors };
}

export function activateExp0026Reserve(input) {
  const freeze = input.freeze;
  const ledger = input.ledger ?? createExp0026ReplacementLedger(freeze);
  const validation = validateExp0026ReplacementLedger(freeze, ledger);
  invariant(validation.valid, validation.errors.join("; "));
  invariant(
    EXP0026_REPLACEMENT_REASONS.includes(input.reason),
    "motivo de reposição não está congelado"
  );
  invariant(ledger.activations.length < 2, "limite de duas reposições atingido");
  const slot = ledger.slots.find((item) => item.activeAlias === input.replacesAlias);
  invariant(slot, "alias substituído não está ativo em nenhum slot");
  const frozenSlot = freeze.roster.slots.find((item) => item.slotId === slot.slotId);
  invariant(
    frozenSlot.allowedReserveAliases.includes(input.reserveAlias),
    "reserva não foi pré-autorizada para este slot"
  );
  invariant(
    !ledger.slots.some((item) => item.activeAlias === input.reserveAlias) &&
      !ledger.activations.some((item) => item.reserveAlias === input.reserveAlias),
    "reserva já foi ativada"
  );
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const tombstones = Array.isArray(input.tombstones) ? input.tombstones : [];
  const slotSessions = sessions.filter((item) => item.rosterSlotId === slot.slotId);
  let withdrawnSessionId = null;
  if (input.reason === "CONSENT_WITHDRAWN") {
    const eligible = tombstones.filter((item) =>
      item.status === "WITHDRAWN_AND_DELETED" &&
      item.rosterSlotId === slot.slotId &&
      !ledger.activations.some((activation) =>
        activation.withdrawnSessionId === item.sessionId)
    );
    invariant(eligible.length === 1, "retirada exige exatamente um tombstone final não utilizado para o slot");
    withdrawnSessionId = eligible[0].sessionId;
  } else {
    invariant(
      slotSessions.length === 0 &&
        !tombstones.some((item) => item.rosterSlotId === slot.slotId),
      "reposição administrativa só é permitida antes de qualquer sessão do slot ser criada; retirada exige CONSENT_WITHDRAWN"
    );
  }
  const activatedAt = input.activatedAt ?? new Date().toISOString();
  invariant(Number.isFinite(Date.parse(activatedAt)), "activatedAt inválido");
  const nextCore = {
    ...coreLedger(ledger),
    slots: ledger.slots.map((item) => item.slotId === slot.slotId
      ? { ...item, activeAlias: input.reserveAlias }
      : { ...item }),
    activations: [...ledger.activations, {
      sequence: ledger.activations.length + 1,
      slotId: slot.slotId,
      orderIndex: slot.orderIndex,
      replacedAlias: input.replacesAlias,
      reserveAlias: input.reserveAlias,
      reason: input.reason,
      withdrawnSessionId,
      activatedAt
    }]
  };
  return {
    ...nextCore,
    ledgerSha256: `sha256:${canonicalSha256(nextCore)}`
  };
}
