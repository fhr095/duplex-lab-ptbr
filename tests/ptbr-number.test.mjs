import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPtBrCurrencyAmounts,
  parsePtBrNumberPhrase
} from "../src/interaction/ptbr-number.mjs";

test("converte números falados em português e tolera centro no contexto numérico", () => {
  assert.equal(parsePtBrNumberPhrase("mil cento e cinquenta"), 1150);
  assert.equal(parsePtBrNumberPhrase("mil centro e cinquenta"), 1150);
  assert.equal(parsePtBrNumberPhrase("sete mil e quinhentos"), 7500);
});

test("extrai valores em reais com posição e sem confundir 1500 com 7500", () => {
  assert.deepEqual(
    extractPtBrCurrencyAmounts(
      "Sete mil e quinhentos reais. Não, mil centro e cinquenta reais."
    ).map((item) => item.value),
    [7500, 1150]
  );
  assert.deepEqual(
    extractPtBrCurrencyAmounts("Transfere R$ 1.500, não R$ 1.150.")
      .map((item) => item.value),
    [1500, 1150]
  );
  assert.deepEqual(
    extractPtBrCurrencyAmounts(
      "Era só uma estimativa de 80 reais; agora são 18 reais."
    ).map((item) => item.value),
    [80, 18]
  );
  assert.deepEqual(
    extractPtBrCurrencyAmounts("O valor correto é 1.150 reais.")
      .map((item) => item.value),
    [1150]
  );
});
