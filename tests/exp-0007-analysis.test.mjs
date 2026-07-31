import assert from "node:assert/strict";
import test from "node:test";

import {
  CASE_IDS,
  CHALLENGER_POLICY,
  CONTROL_POLICY,
  evaluateExp0007
} from "../scripts/lib/exp-0007-analysis.mjs";

function sha(character) {
  return character.repeat(64);
}

function fakeReports(policy) {
  const challenger = policy === CHALLENGER_POLICY;
  const websocketCases = [];
  const browserResults = [];
  for (let repetition = 1; repetition <= 5; repetition += 1) {
    for (const [index, id] of CASE_IDS.entries()) {
      const hash = sha(String((index + 1) % 10));
      const waveHash = sha(String((index + 6) % 10));
      const boundary = 10_000 + index * 1_000;
      const prefinal = {
        type: "endpoint.prefinal.started",
        prefinalPolicy: policy,
        acousticBoundarySample: boundary,
        audioSnapshot: {
          sha256: hash,
          sampleEnd: boundary,
          requestedSampleEnd: boundary,
          boundaryMatched: true,
          contiguous: true,
          tailExcludedSamples: 3_200
        }
      };
      const final = {
        type: "transcript.final",
        text: "valor correto",
        finalSource: "prepared",
        audioSnapshot: {
          sha256: hash,
          sampleCount: boundary
        },
        observedAtMs: 1_000,
        receivedAtMs: 1_000
      };
      websocketCases.push({
        id,
        repetition,
        observationId: `${id}#r${repetition}`,
        audioSha256: waveHash,
        events: [
          { type: "transcript.partial", text: "fala parcial" },
          prefinal,
          final
        ],
        timing: { finalAfterEndpointMs: challenger ? 250 : 700 },
        transport: {
          audioDrainVerified: true,
          audioDrainChecks: {
            transportPass: true,
            pipelinePass: true
          },
          audioFlush: {
            watermark: { expectedFullWindowEnd: 10_000 },
            vadControl: {
              telemetry: {
                inferenceErrorCount: 0,
                gapResetCount: 0,
                lastProcessedSampleEnd: 10_000,
                inferenceMs: { p95: 2 }
              }
            },
            vadShadow: {
              health: { state: "disabled" }
            },
            pipeline: {
              queueDelayMs: { p99: 1 }
            }
          },
          clientUnsentFrames: 0,
          serverLostFrames: 0,
          rejectedFrames: 0,
          protocolErrors: 0
        },
        turnIntegrity: { prematureEndpoint: false }
      });
      const slow = [
        "corr-amount-nao-barge-surface-a",
        "corr-name-na-verdade-pause-surface-a"
      ].includes(id);
      browserResults.push({
        id,
        repetition,
        observationId: `${id}#r${repetition}`,
        acousticInput: { waveSha256: waveHash },
        audioRuntimeEvidence: [
          { type: "transcript.partial", text: "fala parcial" },
          prefinal,
          final
        ],
        responseLatencyMs: challenger
          ? 800
          : slow ? 1_600 : 1_000,
        safeOutcomePass: true,
        transcript: "valor correto",
        assistantText: "Confirmação correta.",
        browserErrors: [],
        renderStopPass: true,
        bargeInPass: true,
        trace: [
          { type: "assistant.render.active", atMs: 1_120 }
        ]
      });
    }
  }
  const fingerprint = sha("a");
  return {
    websocket: {
      effectiveInteractionConfig: { prefinalPolicy: policy },
      runtime: {
        comparable: true,
        currentRuntimeFingerprint: { sha256: fingerprint }
      },
      execution: { paidApiCalls: 0 },
      cases: websocketCases
    },
    browser: {
      runtime: {
        comparable: true,
        currentRuntimeFingerprint: { sha256: fingerprint },
        health: {
          interaction: { prefinalPolicy: policy }
        }
      },
      execution: { paidApiCalls: 0 },
      results: browserResults
    }
  };
}

function passingInput() {
  return {
    control: fakeReports(CONTROL_POLICY),
    challenger: fakeReports(CHALLENGER_POLICY)
  };
}

test("promove screening completo, seguro, idêntico e 25% mais rápido", () => {
  const result = evaluateExp0007(passingInput());

  assert.equal(result.screening.expectedObservations, 100);
  assert.equal(result.screening.decision, "confirm");
  assert.equal(result.screening.pass, true);
  assert.equal(
    Object.values(result.screening.gates).every(Boolean),
    true
  );
});

test("divergência de hash entre WebSocket e Chrome bloqueia confirmação", () => {
  const input = passingInput();
  input.challenger.browser.results[0]
    .audioRuntimeEvidence.at(-1).audioSnapshot.sha256 = sha("f");

  const result = evaluateExp0007(input);

  assert.equal(result.screening.pass, false);
  assert.equal(result.screening.decision, "hold-path-divergence");
  assert.equal(
    result.screening.gates.crossPathFinalPcmIdentity,
    false
  );
});

test("falha nova no caso crítico rejeita challenger por segurança", () => {
  const input = passingInput();
  const critical = input.challenger.browser.results.find(
    (item) => item.id === "corr-time-na-verdade-cross-surface-a"
  );
  critical.safeOutcomePass = false;
  critical.transcript = "horário incorreto";

  const result = evaluateExp0007(input);

  assert.equal(result.screening.pass, false);
  assert.equal(result.screening.decision, "reject-safety");
  assert.equal(result.screening.gates.primaryChromeSafety, false);
});

test("limitação domingo para mundo só é tolerada se não crescer", () => {
  const input = passingInput();
  for (const branch of [input.control, input.challenger]) {
    for (const item of branch.browser.results.filter(
      (candidate) =>
        candidate.id ===
          "corr-weekday-quer-dizer-cross-surface-a"
    )) {
      item.safeOutcomePass = false;
      item.transcript = "A reserva fica para mundo";
    }
  }

  const result = evaluateExp0007(input);

  assert.equal(
    result.screening.gates.noNewIncorrectConfirmation,
    true
  );
  assert.equal(result.screening.decision, "confirm");
});

test("slot atual preservado sem efeito conta como correto no escopo acústico", () => {
  const input = passingInput();
  const item = input.challenger.browser.results.find(
    (candidate) =>
      candidate.id === "corr-time-na-verdade-cross-surface-a"
  );
  item.safeOutcomePass = false;
  item.assessment = {
    checks: [
      ["final-transcript-current", "pass"],
      ["single-commit", "pass"],
      ["no-premature-main-speech", "pass"],
      ["no-obsolete-delegation", "pass"]
    ].map(([id, status]) => ({ id, status }))
  };

  const result = evaluateExp0007(input);

  assert.equal(result.screening.gates.primaryChromeSafety, true);
  assert.equal(result.screening.decision, "confirm");
});
