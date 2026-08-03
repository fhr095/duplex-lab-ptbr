import assert from "node:assert/strict";
import test from "node:test";

import {
  EXP0019_AUDIO_ATTEMPT_PATH,
  EXP0019_INSTRUMENTATION_FREEZE_PATH
} from "../src/eval/exp-0019-boundary.mjs";
import {
  EXP0019_DECISIONS,
  buildExp0019CanonicalReport,
  exp0019EvidenceChainBound,
  validateExp0019CanonicalReport
} from "../src/eval/exp-0019-analysis.mjs";
import { canonicalSha256 } from
  "../src/eval/factory/canonical-hash.mjs";

const hash = (character) => `sha256:${character.repeat(64)}`;
const paths = {
  preregistration:
    "docs/experiments/EXP-0019-causal-audio-context-bridge.md",
  plan: "eval/experiments/exp-0019-causal-audio-plan-v0.1.json",
  freeze: EXP0019_INSTRUMENTATION_FREEZE_PATH,
  attempt: EXP0019_AUDIO_ATTEMPT_PATH,
  manifest: "eval/sources/exp-0019-causal-audio-v0.1.json",
  replay: "eval/reports/exp-0019-node-replay-v0.1.json",
  browser: "eval/reports/exp-0019-browser-v0.1.json",
  sourceCheckpoint: "eval/checkpoints/exp-0018-context-v0.1.json",
  browserCheckpoint: "web/context-relevance-checkpoint.json"
};
const payloadKeys = [
  "assistantAudiblePrefixAtDecision",
  "assistantAudiblePrefixAvailableAtSample",
  "assistantSpeaking",
  "currentSample",
  "recentInbound",
  "recentInboundAvailableAtSample",
  "targetAvailableAtSample",
  "targetText"
];
const frozenSignature = {
  B0: { correct: 4, observations: 8 },
  B1: {
    correct: 7,
    observations: 8,
    directedCorrect: 4,
    directedObservations: 4,
    backgroundCorrect: 3,
    backgroundObservations: 4
  },
  paired: { pairs: 4, wins: 3, losses: 0, ties: 1 },
  knownMiss: {
    pairRootId:
      "development-correction-version-label-target-development-green-label",
    targetSurfaceId: "target-development-green-label",
    contextSurfaceId: "context-development-version-over-label",
    expected: "BACKGROUND_OR_NOT_DIRECTED",
    predicted: "DIRECTED_TO_ASSISTANT"
  }
};

function payload(currentSample) {
  return {
    assistantAudiblePrefixAtDecision: currentSample >= 2 ? "prefixo" : null,
    assistantAudiblePrefixAvailableAtSample: 2,
    assistantSpeaking: true,
    currentSample,
    recentInbound: currentSample >= 1 ? ["inbound"] : [],
    recentInboundAvailableAtSample: 1,
    targetAvailableAtSample: 3,
    targetText: currentSample >= 3 ? "target" : null
  };
}

function validInput() {
  const planSha = hash("1");
  const freezeSha = hash("2");
  const attemptSha = hash("3");
  const manifestSha = hash("4");
  const replaySha = hash("5");
  const browserSha = hash("6");
  const sourceCheckpointSha = hash("7");
  const browserCheckpointSha = hash("8");
  const schedule = {
    target: { startSample: 100, endSample: 200 },
    assistant: { startSample: 50, endSample: 500 }
  };
  const pairs = Array.from({ length: 4 }, (_, index) => ({
    pairRootId: `pair-${index}`,
    schedule,
    scheduleSha256: hash(String(index + 1))
  }));
  const scenes = Array.from({ length: 8 }, (_, index) => {
    const pair = pairs[Math.floor(index / 2)];
    return {
      sceneId: `scene-${index}`,
      pairRootId: pair.pairRootId,
      scorer: {
        label: index < 4
          ? "BACKGROUND_OR_NOT_DIRECTED"
          : "DIRECTED_TO_ASSISTANT"
      },
      streamBindings: { target: "target-stream" },
      schedule,
      scheduleSha256: pair.scheduleSha256,
      probes: [0, 1, 2].map((currentSample) => ({
        payload: payload(currentSample),
        arms: {
          B0: {
            status: "DEFER_CAUSAL_EVIDENCE",
            classifierExecuted: false,
            inferenceCountDelta: 0
          },
          B1: {
            status: "DEFER_CAUSAL_EVIDENCE",
            classifierExecuted: false,
            inferenceCountDelta: 0
          }
        }
      })),
      ready: {
        payload: payload(3),
        arms: {
          B0: { frozenTraceExact: true },
          B1: { frozenTraceExact: true }
        }
      }
    };
  });
  const records = {
    preregistration: { path: paths.preregistration, fileSha256: hash("a") },
    plan: {
      path: paths.plan,
      fileSha256: hash("b"),
      value: {
        planSha256: planSha,
        bindings: {
          preregistration: {
            path: paths.preregistration,
            fileSha256: hash("a")
          }
        },
        summary: {
          scenes: 8,
          pairRoots: 4,
          streams: 12,
          frozenSignature
        },
        runtime: {
          payloadAllowlist: payloadKeys,
          futureTextAllowed: false,
          futurePcmAllowed: false
        }
      }
    },
    instrumentationFreeze: {
      path: paths.freeze,
      fileSha256: hash("c"),
      value: {
        instrumentationFreezeSha256: freezeSha,
        artifacts: {
          preregistration: {
            path: paths.preregistration,
            fileSha256: hash("a")
          },
          plan: {
            path: paths.plan,
            fileSha256: hash("b"),
            canonicalSha256: planSha
          },
          sourceCheckpoint: {
            path: paths.sourceCheckpoint,
            fileSha256: hash("d"),
            canonicalSha256: sourceCheckpointSha
          },
          browserCheckpoint: {
            path: paths.browserCheckpoint,
            fileSha256: hash("e"),
            canonicalSha256: browserCheckpointSha
          }
        },
        boundary: {
          audioMaterializationsBeforeFreeze: 0,
          nodeReplaysBeforeFreeze: 0,
          browserCampaignsBeforeFreeze: 0,
          paidApiCalls: 0
        },
        authority: { canProduceEffects: false }
      }
    },
    audioAttempt: {
      path: paths.attempt,
      fileSha256: hash("f"),
      value: {
        attemptSha256: attemptSha,
        instrumentationFreeze: {
          path: paths.freeze,
          fileSha256: hash("c")
        },
        plan: { path: paths.plan, fileSha256: hash("b") }
      }
    },
    audioManifest: {
      path: paths.manifest,
      fileSha256: hash("0"),
      value: {
        manifestSha256: manifestSha,
        instrumentationFreeze: {
          path: paths.freeze,
          fileSha256: hash("c")
        },
        audioAttempt: { path: paths.attempt, fileSha256: hash("f") },
        plan: { path: paths.plan, fileSha256: hash("b") },
        files: Array.from({ length: 12 }, (_, index) => ({ id: index })),
        targetReuse: {
          synthesesPerTarget: 1,
          byteIdenticalReuseRequiredWithinPair: true
        },
        provenance: {
          testHarnessUsed: false,
          networkAllowed: false,
          paidApiCalls: 0,
          gpuRuns: 0
        }
      }
    },
    nodeReplay: {
      path: paths.replay,
      fileSha256: hash("9"),
      value: {
        replaySha256: replaySha,
        bindings: {
          audioAttempt: { path: paths.attempt, fileSha256: hash("f") },
          manifest: { path: paths.manifest, fileSha256: hash("0") },
          instrumentationFreeze: {
            path: paths.freeze,
            fileSha256: hash("c")
          },
          checkpoint: { canonicalSha256: sourceCheckpointSha }
        },
        audio: {
          streams: [
            {
              streamId: "target-stream",
              onsetSample: 10
            },
            ...Array.from({ length: 11 }, (_, index) => ({
              streamId: `stream-${index}`,
              onsetSample: 0
            }))
          ],
          targetPairEqualityExact: true
        },
        pairs,
        scenes,
        summary: {
          proposals: 16,
          preBoundaryArmProbes: 48,
          preBoundaryInferences: 0,
          frozenTraceParity: "16/16",
          nodeComputeP95Ms: 1,
          nodeComputeWithinBudget: true
        },
        authority: { canProduceEffects: false, effectsDispatched: 0 }
      }
    },
    browserReport: {
      path: paths.browser,
      fileSha256: hash("a"),
      value: {
        browserReportSha256: browserSha,
        source: {
          nodeReplay: { path: paths.replay, fileSha256: hash("9") },
          instrumentationFreeze: {
            path: paths.freeze,
            fileSha256: hash("c")
          },
          checkpoint: {
            path: paths.browserCheckpoint,
            fileSha256: hash("e")
          }
        },
        repetitions: [{ index: 1 }, { index: 2 }],
        metrics: {
          scenesPerRepetition: 8,
          readyEvaluations: 16,
          maximumFeatureRelativeError: 0,
          maximumProbabilityRelativeError: 0,
          proposalLatencyP95Ms: 2,
          calculationP95Ms: 1,
          rendererStopP95Ms: 80,
          effectsDispatched: 0,
          paidApiCalls: 0,
          gpuRuns: 0
        },
        gates: {
          causalProbes: true,
          frozenSignature: true,
          nodeBrowserParity: true,
          oneProposalPerArmPerScene: true,
          exactlyTwoRepetitions: true,
          deterministicNormalizedTrace: true,
          proposalP95WithinBudget: true,
          calculationP95WithinBudget: true,
          lifecycleUnchanged: true,
          lifecycleShadowOnOffEquivalent: true,
          rendererStopP95WithinBudget: true,
          physicalStopContextIsolation: true,
          zeroEffects: true,
          zeroAuthority: true
        }
      }
    },
    sourceCheckpoint: {
      path: paths.sourceCheckpoint,
      fileSha256: hash("d"),
      value: { checkpointSha256: sourceCheckpointSha }
    },
    browserCheckpoint: {
      path: paths.browserCheckpoint,
      fileSha256: hash("e"),
      value: { browserCheckpointSha256: browserCheckpointSha }
    }
  };
  const validations = {
    planValid: true,
    instrumentationFreezeValid: true,
    audioAttemptValid: true,
    audioManifestValid: true,
    nodeReplayValid: true,
    browserReportValid: true,
    sourceCheckpointValid: true,
    browserCheckpointValid: true,
    evidenceChainBound: exp0019EvidenceChainBound(records)
  };
  return { records, validations };
}

function rehash(report) {
  const core = structuredClone(report);
  delete core.reportSha256;
  report.reportSha256 = `sha256:${canonicalSha256(core)}`;
}

test("todos os gates promovem somente o bridge causal em shadow", () => {
  const input = validInput();
  const report = buildExp0019CanonicalReport(input);
  assert.equal(input.validations.evidenceChainBound, true);
  assert.equal(report.decision, EXP0019_DECISIONS.pass);
  assert.equal(report.pass, true);
  assert.equal(report.authorityEligible, false);
  assert.equal(Object.values(report.gates).every(Boolean), true);
  assert.equal(report.metrics.exploratory.onsetToProposalMs.length, 8);
  assert.equal(
    report.metrics.exploratory.backgroundCounterfactualHoldMs.length,
    4
  );
  assert.deepEqual(
    validateExp0019CanonicalReport(report, input),
    { valid: true, errors: [] }
  );
});

test("instrumento inválido vence qualquer aparência de gate verde", () => {
  const input = validInput();
  input.validations.audioManifestValid = false;
  const report = buildExp0019CanonicalReport(input);
  assert.equal(report.decision, EXP0019_DECISIONS.invalidate);
  assert.equal(report.pass, false);
});

test("instrumento válido com latência falha corta antes de ASR", () => {
  const input = validInput();
  input.records.browserReport.value.metrics.proposalLatencyP95Ms = 301;
  const report = buildExp0019CanonicalReport(input);
  assert.equal(report.instrumentValid, true);
  assert.equal(report.gates.latencyWithinBudget, false);
  assert.equal(report.decision, EXP0019_DECISIONS.cut);
});

test("rehash não permite editar gate derivado ou vínculo de evidência", () => {
  const input = validInput();
  const report = structuredClone(buildExp0019CanonicalReport(input));
  report.gates.zeroFutureEvidence = false;
  report.decision = EXP0019_DECISIONS.cut;
  report.pass = false;
  rehash(report);
  const validation = validateExp0019CanonicalReport(report, input);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /evidência recalculada/iu);

  input.records.browserReport.value.source.nodeReplay.fileSha256 = hash("z");
  assert.equal(exp0019EvidenceChainBound(input.records), false);
});
