import test from "node:test";
import assert from "node:assert/strict";

import {
  loadEnvFile,
  parseEnvText
} from "../src/config/load-env.mjs";

test("parser de .env aceita aspas, export e comentário", () => {
  const values = parseEnvText(`
    # comentário
    SIMPLE=valor
    QUOTED="valor com espaços"
    export WITH_COMMENT=preservado # removido
  `);

  assert.deepEqual(values, {
    SIMPLE: "valor",
    QUOTED: "valor com espaços",
    WITH_COMMENT: "preservado"
  });
});

test("carregador não sobrescreve variáveis já definidas", async () => {
  const environment = { EXISTING_VALUE: "processo" };
  const result = await loadEnvFile({
    environment,
    url: new URL("./fixtures/example.env", import.meta.url)
  });

  assert.equal(result.loaded, true);
  assert.equal(environment.EXISTING_VALUE, "processo");
  assert.equal(environment.QUOTED_VALUE, "valor com espaços");
  assert.equal(environment.INLINE_COMMENT, "mantido");
  assert.deepEqual(result.keys.sort(), ["INLINE_COMMENT", "QUOTED_VALUE"]);
});
