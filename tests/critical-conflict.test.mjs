import assert from "node:assert/strict";
import test from "node:test";

import {
  createCriticalConflictClarification
} from "../web/critical-conflict.mjs";

test("conflito numérico vira pergunta curta com as duas alternativas", () => {
  assert.equal(
    createCriticalConflictClarification({
      kind: "numeric-correction-conflict",
      alternatives: [150, 1150]
    }),
    "Só confirmando: R$ 150 ou R$ 1.150?"
  );
});

test("não cria reparo a partir de payload incompleto", () => {
  assert.throws(
    () => createCriticalConflictClarification({ alternatives: [150] }),
    /inválido/u
  );
});
