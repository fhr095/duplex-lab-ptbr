import assert from "node:assert/strict";
import test from "node:test";

import {
  compareVadControlCandidate
} from "../src/eval/vad-control-comparison.mjs";

function browser(falseActivations, ok = true) {
  return {
    schemaVersion: 2,
    sourceFingerprint: { sha256: "source-estavel" },
    ok,
    gates: {
      stable: ok,
      correction: true,
      sileroControlIntegrity: true,
      audioDrainedThroughWatermark: true,
      sileroShadowIntegrity: true,
      longSessionNoFalseActivation: true,
      delegatedTaskCancelled: true,
      delegatedTaskSurvivesConversation: true,
      noAudioPipelineErrors: true
    },
    microphoneCapture: {
      falseActivationProbe: {
        observedDurationMs: 600_000,
        unexpectedUserSpeechEvents: falseActivations,
        vadControl: {
          health: {
            engine: "silero-vad",
            threshold: 0.85,
            onsetWindows: 1
          },
          telemetry: {
            inferenceErrorCount: 0
          }
        },
        drain: {
          server: {
            watermark: {
              expectedFullWindowEnd: 9_600_000
            },
            vadControl: {
              health: {
                engine: "silero-vad",
                threshold: 0.85,
                onsetWindows: 1
              },
              telemetry: {
                inferenceErrorCount: 0,
                lastProcessedSampleEnd: 9_600_000
              }
            }
          }
        }
      }
    },
    bargeIn: {
      closedLoop: { speechOnsetToLastRenderMs: 145 }
    },
    realBackchannel: {
      recovery: { speechEndToResumeMs: 280 }
    },
    longCorrection: {
      transcript: { wer: 0.125 }
    }
  };
}

const offline = {
  sourceFingerprint: { sha256: "source-estavel" },
  aggregate: {
    policies: [{
      policy: "silero-0.85-1",
      speechByGain: {
        "0.125": {
          observations: 12,
          detected: 12,
          recall: 1
        }
      },
      controlObservations: 4,
      falsePositives: 0,
      controlSpecificity: 1
    }]
  }
};

const liveCampaign = {
  schemaVersion: 2,
  sourceFingerprint: { sha256: "source-estavel" },
  candidate: {
    vad: {
      threshold: 0.85,
      onsetWindows: 1
    }
  },
  gate: {
    operability: { pass: true },
    summaries: {
      control: { detectedCases: 0 }
    }
  },
  cases: [
    "nao-curto-baixo",
    "espera-curto-baixo",
    "muda-terca-baixo"
  ].map((id) => ({
    id,
    category: "short-soft-command",
    eventCounts: {
      speechStarts: 1,
      finals: 1
    },
    timing: { onsetDetectionMs: 100 },
    transport: { audioDrainVerified: true }
  }))
};

test("comparador exige sessão longa e dez repetições", () => {
  const hold = compareVadControlCandidate({
    baseline: browser(3, false),
    candidate: browser(0),
    offline,
    liveCampaign
  });
  assert.equal(hold.pass, false);
  assert.equal(hold.decision, "hold");
  assert.equal(
    hold.checks.find(
      (item) => item.id === "statistical-browser-campaign"
    ).pass,
    false
  );

  const promote = compareVadControlCandidate({
    baseline: browser(3, false),
    candidate: browser(0),
    offline,
    browserCampaign: {
      pass: true,
      sourceFingerprint: { sha256: "source-estavel" },
      summary: { validRuns: 10 }
    },
    liveCampaign
  });
  assert.equal(promote.pass, true);
  assert.equal(promote.decision, "engineering-promote");
  assert.equal(promote.userFacingReadiness.decision, "hold");
});

test("um falso início do candidato bloqueia promoção", () => {
  const result = compareVadControlCandidate({
    baseline: browser(3, false),
    candidate: browser(1),
    offline,
    browserCampaign: {
      pass: true,
      sourceFingerprint: { sha256: "source-estavel" },
      summary: { validRuns: 10 }
    },
    liveCampaign
  });

  assert.equal(result.pass, false);
  assert.equal(
    result.checks.find(
      (item) => item.id === "fewer-false-activations"
    ).pass,
    false
  );
});

test("sem campanha live de fala suave não há promoção", () => {
  const result = compareVadControlCandidate({
    baseline: browser(3, false),
    candidate: browser(0),
    offline,
    browserCampaign: {
      pass: true,
      sourceFingerprint: { sha256: "source-estavel" },
      summary: { validRuns: 10 }
    }
  });

  assert.equal(result.pass, false);
  assert.equal(
    result.checks.find(
      (item) =>
        item.id === "live-audio-operability-and-soft-speech"
    ).pass,
    false
  );
});
