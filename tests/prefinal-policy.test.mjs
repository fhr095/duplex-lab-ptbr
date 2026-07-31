import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePrefinalPolicy,
  PREFINAL_POLICY_ACOUSTIC_FIXED_BOUNDARY,
  PREFINAL_POLICY_LINGUISTIC_COMPLETE
} from "../src/audio/prefinal-policy.mjs";

test("controle linguístico permanece como política padrão", () => {
  assert.equal(
    normalizePrefinalPolicy(),
    PREFINAL_POLICY_LINGUISTIC_COMPLETE
  );
});

test("aceita challenger acústico e recusa configuração ambígua", () => {
  assert.equal(
    normalizePrefinalPolicy("ACOUSTIC-EAGER-FIXED-BOUNDARY"),
    PREFINAL_POLICY_ACOUSTIC_FIXED_BOUNDARY
  );
  assert.throws(
    () => normalizePrefinalPolicy("eager"),
    /política de prefinal inválida/u
  );
});
