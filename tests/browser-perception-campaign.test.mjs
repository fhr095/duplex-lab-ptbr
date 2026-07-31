import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateBrowserPerceptionReports
} from "../src/eval/browser-perception-campaign.mjs";

function report(index, overrides = {}) {
  return {
    generatedAt: `2026-07-30T00:00:${String(index).padStart(2, "0")}Z`,
    sourceFingerprint: {
      algorithm: "sha256-source-tree-v1",
      sha256: "fingerprint-estavel"
    },
    fixtures: {
      backchannelPcmSha256: "fixture-a",
      bargeInWaveSha256: "fixture-b",
      correctionWaveSha256: "fixture-c"
    },
    ok: overrides.ok ?? true,
    gates: {
      stable: overrides.ok ?? true,
      naturalTurn: true
    },
    directTurn: {
      metrics: { responseStartMs: 700 + index }
    },
    localAudio: {
      metrics: {
        responseStartMs: 850 + index,
        responseAfterEndpointMs: 330 + index
      }
    },
    realBackchannel: {
      recovery: {
        pauseToResumeMs: 800 + index,
        speechEndToResumeMs: 350 + index
      }
    },
    bargeIn: {
      metrics: {
        stopCommandMs: 1,
        stopRenderedMs: 45,
        responseAfterEndpointMs: 380
      },
      closedLoop: {
        speechOnsetToLastRenderMs: 120 + index
      }
    },
    longCorrection: {
      transcript: {
        wer: overrides.correctionWer ?? 0.125
      },
      completed: {
        metrics: {
          responseStartMs: 1_050 + index,
          responseAfterEndpointMs: 920 + index
        },
        trace: [
          { type: "turn.committed" }
        ]
      }
    },
    microphoneCapture: {
      audio: {
        capture: {
          clock: { realtimeRatio: 1 }
        }
      },
      falseActivationProbe: {
        observedDurationMs: 5_000,
        captureFramesDuringProbe: 250,
        unexpectedUserSpeechEvents: 0,
        captureIntegrity: {
          deliveryErrors: 0,
          protocolErrors: 0,
          observedSequenceGaps: 0,
          observedSampleGaps: 0,
          processorErrors: 0,
          droppedFrames: 0,
          emptyInputQuanta: 0
        },
        captureContinuity: {
          maxFrameArrivalGapMs: 31
        },
        drain: {
          server: {
            pipeline: {
              maximumPendingFrames: 1,
              overflowCount: 0,
              processingErrorCount: 0,
              queueDelayMs: { p99: 1 }
            }
          }
        },
        vadShadow: {
          windowsDuringProbe: 156,
          startsDuringProbe: overrides.shadowFalseStarts ?? 0,
          resetsDuringProbe: 0,
          errorsDuringProbe: 0,
          telemetry: {
            inferenceMs: { p95: 1, p99: 1.2 },
            queueDelayMs: { p99: 1.1 }
          }
        },
        vadControl: {
          health: {
            engine: "silero-vad",
            threshold: 0.85,
            onsetWindows: 1,
            sha256: "modelo-estavel"
          },
          telemetry: {
            gapResetCount: 0,
            inferenceErrorCount: 0,
            inferenceMs: { p95: 0.9, p99: 1.1 }
          }
        }
      }
    }
  };
}

test("dez repetições verdes promovem apenas a evidência de engenharia", () => {
  const reports = Array.from(
    { length: 10 },
    (_, index) => report(index)
  );
  const result = aggregateBrowserPerceptionReports(reports, {
    minimumRuns: 10,
    requestedRuns: 10
  });

  assert.equal(result.pass, true);
  assert.equal(result.decision, "engineering-promote");
  assert.equal(result.summary.runPassRate, 1);
  assert.equal(result.metrics.pcmOnsetToLastRenderMs.p95, 129);
  assert.equal(result.userFacingReadiness.decision, "hold");
  assert.ok(result.userFacingReadiness.blockers.length >= 3);
});

test("falso início do shadow bloqueia a campanha", () => {
  const reports = Array.from(
    { length: 10 },
    (_, index) =>
      report(index, {
        shadowFalseStarts: index === 4 ? 1 : 0
      })
  );
  const result = aggregateBrowserPerceptionReports(reports, {
    minimumRuns: 10,
    requestedRuns: 10
  });

  assert.equal(result.pass, false);
  assert.equal(result.decision, "hold");
  assert.equal(
    result.checks.find(
      (check) => check.id === "silero-shadow-safety"
    ).pass,
    false
  );
});

test("amostra incompleta não vira evidência estatística", () => {
  const reports = Array.from(
    { length: 9 },
    (_, index) => report(index)
  );
  const result = aggregateBrowserPerceptionReports(reports, {
    minimumRuns: 10,
    requestedRuns: 10,
    runnerFailures: [{ index: 10, error: "CDP indisponível" }]
  });

  assert.equal(result.pass, false);
  assert.equal(
    result.checks.find((check) => check.id === "sample-size").pass,
    false
  );
});

test("fixtures diferentes invalidam repetição estatística", () => {
  const reports = Array.from(
    { length: 10 },
    (_, index) => report(index)
  );
  reports[7].fixtures.bargeInWaveSha256 = "fixture-alterada";
  const result = aggregateBrowserPerceptionReports(reports, {
    minimumRuns: 10,
    requestedRuns: 10
  });

  assert.equal(result.pass, false);
  assert.equal(
    result.checks.find(
      (check) => check.id === "same-evidence-fixtures"
    ).pass,
    false
  );
});
