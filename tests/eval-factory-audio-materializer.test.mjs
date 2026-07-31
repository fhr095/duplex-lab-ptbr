import assert from "node:assert/strict";
import test from "node:test";

import {
  createTtsRecipe,
  ttsCacheKey
} from "../src/eval/factory/audio-materializer.mjs";

const item = {
  phenomenon: "correction",
  stimulus: { text: "Terça... não, sexta." },
  audioPlan: { rate: 1 }
};
const engine = {
  id: "windows-system-speech",
  voice: "Microsoft Maria Desktop",
  culture: "pt-BR"
};

test("cache de TTS inclui texto, voz, engine e rate", () => {
  const recipe = createTtsRecipe(item, engine);
  const key = ttsCacheKey(recipe);

  assert.match(key, /^[a-f0-9]{64}$/u);
  assert.equal(key, ttsCacheKey(createTtsRecipe(item, engine)));
  assert.notEqual(
    key,
    ttsCacheKey(
      createTtsRecipe(
        { ...item, audioPlan: { rate: 3 } },
        engine
      )
    )
  );
  assert.notEqual(
    key,
    ttsCacheKey(
      createTtsRecipe(item, { ...engine, voice: "Microsoft Daniel" })
    )
  );
});

