import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeBaseline
} from "../scripts/lib/runtime-baseline.mjs";

function fixture() {
  const fingerprint = {
    algorithm: "sha256-source-tree-v1",
    sha256: "a".repeat(64),
    fileCount: 1,
    roots: ["src"]
  };
  return {
    currentFingerprint: fingerprint,
    health: {
      status: "ok",
      brain: "local",
      process: { runtimeFingerprint: fingerprint },
      models: {
        interaction: "deterministic-mock",
        task: "deterministic-mock"
      },
      vadControl: {
        state: "ready",
        engine: "silero-vad",
        threshold: 0.85,
        onsetWindows: 1
      },
      asr: {
        state: "ready",
        engine: "parakeet",
        partialModel: "tiny",
        finalModel: "nemo-parakeet-tdt-0.6b-v3"
      },
      interaction: { prefinalPolicy: "linguistic-complete" },
      tts: {}
    },
    evidence: {
      factory: {
        path: "factory.json",
        sha256: "b".repeat(64),
        value: { decisions: { factoryToolchain: "promote" } }
      },
      exp0007: {
        path: "7.json",
        sha256: "c".repeat(64),
        value: {
          screening: { decision: "reject-safety" },
          control: { zeroPaidApiCalls: true },
          challenger: { zeroPaidApiCalls: true }
        }
      },
      exp0008: {
        path: "8.json",
        sha256: "d".repeat(64),
        value: {
          decision: "hold-latency",
          authorizedAuthority: "none",
          execution: { paidApiCalls: 0 }
        }
      },
      exp0009: {
        path: "9.json",
        sha256: "e".repeat(64),
        value: {
          decision: "promote-safety-guard",
          pass: true,
          gates: { zeroPaidApiCalls: true }
        }
      }
    }
  };
}

test("congela apenas a combinação explicitamente aceita", () => {
  const baseline = buildRuntimeBaseline(fixture());
  assert.equal(baseline.status, "frozen-development-comparator");
  assert.equal(
    baseline.configuration.interaction.prefinalPolicy,
    "linguistic-complete"
  );
  assert.match(baseline.scope.held.join(" "), /prontidão humana/u);
});

test("falha fechado se challenger ou verificador ganhar autoridade", () => {
  const eager = fixture();
  eager.health.interaction.prefinalPolicy =
    "acoustic-eager-fixed-boundary";
  assert.throws(() => buildRuntimeBaseline(eager), /safePrefinalDefault/u);

  const verifier = fixture();
  verifier.evidence.exp0008.value.authorizedAuthority = "shadow-only";
  assert.throws(() => buildRuntimeBaseline(verifier), /shadowVerifierHeld/u);
});
