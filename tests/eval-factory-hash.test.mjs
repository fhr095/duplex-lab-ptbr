import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJson,
  canonicalSha256
} from "../src/eval/factory/canonical-hash.mjs";

test("hash canônico ignora ordem de chaves, mas detecta mudança de conteúdo", () => {
  const first = { z: 2, nested: { b: true, a: "á" }, a: [3, 1] };
  const reordered = { a: [3, 1], nested: { a: "á", b: true }, z: 2 };
  const changed = { a: [3, 2], nested: { a: "á", b: true }, z: 2 };

  assert.equal(canonicalJson(first), canonicalJson(reordered));
  assert.equal(canonicalSha256(first), canonicalSha256(reordered));
  assert.notEqual(canonicalSha256(first), canonicalSha256(changed));
  assert.throws(() => canonicalJson({ invalid: undefined }), /undefined/iu);
});

