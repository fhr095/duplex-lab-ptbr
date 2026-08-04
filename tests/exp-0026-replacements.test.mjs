import assert from "node:assert/strict";
import test from "node:test";

import {
  activateExp0026Reserve,
  createExp0026ReplacementLedger,
  validateExp0026ReplacementLedger
} from "../src/eval/exp-0026-replacements.mjs";

function freeze() {
  return {
    schemaVersion: "exp-0026-session-freeze-v2",
    experimentId: "EXP-0026",
    freezeSha256: `sha256:${"a".repeat(64)}`,
    roster: {
      manifestSha256: `sha256:${"b".repeat(64)}`,
      slots: Array.from({ length: 6 }, (_, index) => ({
        slotId: `SLOT-${index + 1}`,
        orderIndex: index,
        primaryAlias: `P0${index + 1}`,
        allowedReserveAliases: index < 2
          ? ["R01"]
          : index < 4
            ? ["R02"]
            : ["R01", "R02"]
      }))
    }
  };
}

test("reposição administrativa só ocorre antes de qualquer sessão do slot", () => {
  const frozen = freeze();
  const initial = createExp0026ReplacementLedger(frozen);
  assert.equal(validateExp0026ReplacementLedger(frozen, initial).valid, true);
  const activated = activateExp0026Reserve({
    freeze: frozen,
    ledger: initial,
    reserveAlias: "R01",
    replacesAlias: "P01",
    reason: "PRE_SESSION_NO_SHOW",
    sessions: [],
    activatedAt: "2026-08-03T12:00:00.000Z"
  });
  assert.equal(activated.slots[0].activeAlias, "R01");
  assert.equal(activated.slots[0].orderIndex, 0);
  assert.throws(() => activateExp0026Reserve({
    freeze: frozen,
    ledger: initial,
    reserveAlias: "R01",
    replacesAlias: "P01",
    reason: "PRE_SESSION_NO_SHOW",
    sessions: [{ rosterSlotId: "SLOT-1", phase: "CONSENT" }]
  }), /antes de qualquer sessão/iu);
  assert.throws(() => activateExp0026Reserve({
    freeze: frozen,
    ledger: initial,
    reserveAlias: "R01",
    replacesAlias: "P01",
    reason: "PRE_SESSION_NO_SHOW",
    sessions: [],
    tombstones: [{
      sessionId: "exp0026-prior-0001",
      rosterSlotId: "SLOT-1",
      status: "WITHDRAWN_AND_DELETED"
    }]
  }), /CONSENT_WITHDRAWN/u);
  assert.throws(() => activateExp0026Reserve({
    freeze: frozen,
    ledger: initial,
    reserveAlias: "R02",
    replacesAlias: "P01",
    reason: "PRE_SESSION_NO_SHOW",
    sessions: []
  }), /não foi pré-autorizada/iu);
});

test("sessão iniciada só admite reserva depois de retirada consentida comprovada", () => {
  const frozen = freeze();
  const ledger = createExp0026ReplacementLedger(frozen);
  const next = activateExp0026Reserve({
    freeze: frozen,
    ledger,
    reserveAlias: "R02",
    replacesAlias: "P03",
    reason: "CONSENT_WITHDRAWN",
    sessions: [],
    tombstones: [{
      sessionId: "exp0026-withdrawn-0001",
      rosterSlotId: "SLOT-3",
      status: "WITHDRAWN_AND_DELETED"
    }],
    activatedAt: "2026-08-03T12:00:00.000Z"
  });
  assert.equal(next.activations[0].withdrawnSessionId, "exp0026-withdrawn-0001");
  assert.throws(() => activateExp0026Reserve({
    freeze: frozen,
    ledger,
    reserveAlias: "R02",
    replacesAlias: "P03",
    reason: "CONSENT_WITHDRAWN",
    tombstones: []
  }), /tombstone final/iu);
});

test("duas ativações são o teto e aliases ativos não podem ser escolhidos por resultado", () => {
  const frozen = freeze();
  let ledger = activateExp0026Reserve({
    freeze: frozen,
    reserveAlias: "R01",
    replacesAlias: "P01",
    reason: "PRE_SESSION_SCHEDULING_CONFLICT",
    sessions: []
  });
  ledger = activateExp0026Reserve({
    freeze: frozen,
    ledger,
    reserveAlias: "R02",
    replacesAlias: "P03",
    reason: "PRE_SESSION_TECHNICAL_INELIGIBILITY",
    sessions: []
  });
  assert.equal(ledger.activations.length, 2);
  assert.throws(() => activateExp0026Reserve({
    freeze: frozen,
    ledger,
    reserveAlias: "R01",
    replacesAlias: "P05",
    reason: "PRE_SESSION_NO_SHOW",
    sessions: []
  }), /limite de duas/iu);
  const tampered = structuredClone(ledger);
  tampered.slots[0].activeAlias = "P01";
  assert.equal(validateExp0026ReplacementLedger(frozen, tampered).valid, false);
});
