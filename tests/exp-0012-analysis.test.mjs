import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_REPLAY_LABELS,
  REQUIRED_BROWSER_GATES,
  REQUIRED_INTENTS,
  REQUIRED_PHASES,
  auditOutputInterruptionContract,
  evaluateExp0012
} from "../scripts/lib/exp-0012-analysis.mjs";
import {
  OUTPUT_INTERRUPTION_LIFECYCLE_VERSION
} from "../web/output-interruption-lifecycle.mjs";

function candidateFixture() {
  const gates = Object.fromEntries(
    REQUIRED_BROWSER_GATES.map((name) => [name, true])
  );
  gates.noSelfInterruptionUnderDeviceAec = false;
  gates.longSessionNoFalseActivation = false;
  gates.sileroControlIntegrity = false;
  gates.sileroShadowIntegrity = false;
  return {
    ok: false,
    sourceFingerprint: { sha256: "same-source" },
    page: {
      outputInterruptionLifecycle: {
        lifecycleVersion: OUTPUT_INTERRUPTION_LIFECYCLE_VERSION
      }
    },
    gates,
    outputInterruptionLifecycle: {
      version: OUTPUT_INTERRUPTION_LIFECYCLE_VERSION,
      replays: EXPECTED_REPLAY_LABELS.map((label, index) => ({
        label,
        ok: true,
        errors: [],
        terminalPhase: "idle",
        steps: [{
          eventType: index % 2 === 0
            ? "PAUSE_REQUESTED"
            : "DISMISS_REQUESTED",
          previousPhase: "idle",
          phase: "held",
          stateVersion: index + 1,
          intents: [index === 0 ? "HOLD_OUTPUT" : "PAUSE_OUTPUT"],
          equivalent: true
        }]
      })),
      coverage: {
        phases: [...REQUIRED_PHASES],
        intents: [...REQUIRED_INTENTS],
        transitions: ["idle->held", "held->resuming", "resuming->idle"]
      }
    },
    microphoneCapture: {
      falseActivationProbe: {
        preflight: {
          status: "probe-start-unresolved",
          error: "probe não iniciou"
        }
      }
    },
    directTurn: { metrics: { responseStartMs: 163 } },
    bargeIn: {
      metrics: { stopCommandMs: 0, stopRenderedMs: 45 },
      closedLoop: { speechOnsetToLastRenderMs: 179.48 }
    },
    realBackchannel: {
      recovery: { speechEndToResumeMs: 248 }
    }
  };
}

function inputFixture(candidate = candidateFixture()) {
  return {
    candidate,
    contractAudit: auditOutputInterruptionContract(),
    fingerprints: {
      campaign: { sha256: "same-source" },
      runtime: { sha256: "same-runtime" }
    },
    health: {
      status: "ok",
      brain: "local",
      usage: { requests: 0 },
      process: {
        runtimeFingerprint: { sha256: "same-runtime" }
      }
    }
  };
}

test("promove lifecycle mesmo com probe físico honestamente não resolvido", () => {
  const report = evaluateExp0012(inputFixture());

  assert.equal(report.pass, true);
  assert.equal(
    report.decision,
    "promote-output-interruption-lifecycle-slice"
  );
  assert.equal(report.gates.exactBrowserReplay, true);
  assert.equal(report.gates.physicalBoundaryHonest, true);
  assert.equal(
    report.globalRuntimeStatus,
    "hold-labelled-physical-specificity"
  );
  assert.equal(report.contextGates.fullSmokePass, false);
});

test("replay divergente ou decisão vazia bloqueia a promoção", () => {
  const candidate = candidateFixture();
  candidate.outputInterruptionLifecycle.replays[2].steps[0].equivalent =
    false;
  candidate.outputInterruptionLifecycle.replays[3].steps[0].intents = [];
  const report = evaluateExp0012(inputFixture(candidate));

  assert.equal(report.pass, false);
  assert.equal(report.gates.exactBrowserReplay, false);
  assert.equal(report.gates.noRedundantLifecycleDecisions, false);
});

test("falha não física não pode ser escondida como limitação do ambiente", () => {
  const candidate = candidateFixture();
  candidate.gates.stoppedOnBargeIn = false;
  const report = evaluateExp0012(inputFixture(candidate));

  assert.equal(report.pass, false);
  assert.equal(report.gates.browserInteractionRegression, false);
  assert.equal(report.gates.physicalBoundaryHonest, false);
  assert.equal(
    report.observations.physical.classification,
    "unexpected-regression"
  );
});

test("fingerprints e execução local sem custo são gates, não metadados", () => {
  const sourceMismatch = inputFixture();
  sourceMismatch.fingerprints.campaign.sha256 = "other";
  assert.equal(
    evaluateExp0012(sourceMismatch).gates.sourceAndRuntimeComparable,
    false
  );

  const paid = inputFixture();
  paid.health.usage.requests = 1;
  assert.equal(
    evaluateExp0012(paid).gates.localZeroPaidExecution,
    false
  );
});

test("auditoria direta cobre corridas de play e falha fechada", () => {
  const audit = auditOutputInterruptionContract();

  assert.equal(audit.pass, true);
  assert.equal(
    audit.version,
    OUTPUT_INTERRUPTION_LIFECYCLE_VERSION
  );
  assert.equal(Object.keys(audit.checks).length, 6);
  assert.equal(Object.values(audit.checks).every(Boolean), true);
});
