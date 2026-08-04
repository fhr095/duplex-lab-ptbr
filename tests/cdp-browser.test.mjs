import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCdpWebSocketUrl } from
  "../scripts/lib/cdp-browser.mjs";

test("CDP reescreve endpoint loopback do Chrome para o relay visível ao WSL", () => {
  assert.equal(
    normalizeCdpWebSocketUrl(
      "ws://127.0.0.1:9223/devtools/browser/opaque-id",
      "http://172.24.240.1:9223"
    ),
    "ws://172.24.240.1:9223/devtools/browser/opaque-id"
  );
});
