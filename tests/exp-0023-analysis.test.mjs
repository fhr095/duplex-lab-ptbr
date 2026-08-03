import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXP0023_ATTEMPT_PATH,
  EXP0023_AUDIT_KEYS,
  EXP0023_CONFIG,
  EXP0023_DECISIONS,
  EXP0023_FREEZE_PATH,
  EXP0023_RECEIPT_PATH,
  analyzeExp0023Campaign,
  createExp0023LegacyCompatibleView,
  createExp0023Report,
  inspectExp0023TimestampPolicy,
  validateExp0023Report
} from "../src/eval/exp-0023-cdp-ordinal-timestamp-semantics.mjs";
import { analyzeExp0022Campaign } from
  "../src/eval/exp-0022-bootstrap-audit-health-binding.mjs";

const reportUrl = new URL(
  "../eval/reports/exp-0022-bootstrap-audit-health-binding-v0.1.json",
  import.meta.url
);

async function fixture() {
  const report = JSON.parse(await readFile(reportUrl, "utf8"));
  const campaign = structuredClone(report.campaign);
  campaign.boundary.freezePath = EXP0023_FREEZE_PATH;
  campaign.boundary.attemptPath = EXP0023_ATTEMPT_PATH;
  campaign.boundary.receiptPath = EXP0023_RECEIPT_PATH;
  campaign.audits = Object.fromEntries(
    EXP0023_AUDIT_KEYS.map((key) => [key, true])
  );
  return { report, campaign };
}

function healthRequests(campaign) {
  return campaign.workerEnvelope.campaign.navigations.flatMap((navigation) =>
    navigation.networkRequests.filter((request) =>
      new URL(request.url).pathname === "/api/health"));
}

test("config herda campanha e congela ordinais como única autoridade", () => {
  assert.equal(EXP0023_CONFIG.orderingAuthority, "cdp-delivery-ordinal-v1");
  assert.equal(
    EXP0023_CONFIG.legacyCompatibilityProjection,
    "tracked-cdp-lifecycle-timestamps-from-delivery-ordinals-v1"
  );
  assert.equal(EXP0023_CONFIG.inheritedExperimentId, "EXP-0022");
  assert.equal(
    EXP0023_CONFIG.timestampPolicy.responseTerminalOrderingRequired,
    false
  );
  assert.equal(EXP0023_CONFIG.timestampPolicy.epsilonMs, null);
  assert.equal(
    EXP0023_CONFIG.timestampPolicy.minimumHealthResponseAfterTerminal,
    1
  );
  assert.equal(EXP0023_CONFIG.authority.canProduceNewEffects, false);
  assert.ok(Object.isFrozen(EXP0023_CONFIG));
});

test("replay diagnóstico vira passe somente sob novo contrato prospectivo", async () => {
  const { report, campaign } = await fixture();
  const before = structuredClone(campaign);
  const original = analyzeExp0022Campaign(report.campaign);
  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(original.decision, "INVALIDATE_BOOTSTRAP_AUDIT_HEALTH_BINDING");
  assert.equal(analysis.decision, EXP0023_DECISIONS.pass);
  assert.equal(analysis.pass, true);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.measurementStatus, "EVALUATED");
  assert.ok(Object.values(analysis.gates).every((value) => value === true));
  assert.ok(Object.values(analysis.structural).every((value) => value === true));
  assert.deepEqual(analysis.metrics.timestampDiagnostics, {
    valid: true,
    trackedRequests: 40,
    recordedEventOrdinals: 120,
    uniqueRecordedEventOrdinals: 120,
    ordinalLedgerUnique: true,
    navigationOrdinalOrderValid: true,
    responseAfterTerminalCount: 40,
    healthResponseAfterTerminalCount: 4,
    skewMs: {
      min: 0.26699999580159783,
      median: 5.021999997552484,
      p95: 36.330999981146306,
      max: 38.792000035755336
    }
  });
  assert.deepEqual(campaign, before, "analisador não pode reescrever o raw");
});

test("view legado projeta só timestamps CDP rastreados sem mutar o raw", async () => {
  const { campaign } = await fixture();
  const before = structuredClone(campaign);
  const view = createExp0023LegacyCompatibleView(campaign);
  assert.equal(view.adjustments.length, 40);
  assert.ok(view.adjustments.every((entry) =>
    entry.to.requestTimestamp < entry.to.responseTimestamp &&
    entry.to.responseTimestamp < entry.to.terminalTimestamp &&
    ["finished", "failed"].includes(entry.kind)));
  const normalized = analyzeExp0022Campaign(view.campaign);
  assert.equal(normalized.instrumentValid, true);
  assert.equal(normalized.decision, "PASS_CDP_TTS_CAPTURE_AFTER_HEALTH_BINDING");
  assert.equal(JSON.stringify(view).includes("base64Body"), false);
  assert.deepEqual(campaign, before);
});

test("timestamps entre requests não concedem nem revogam causalidade", async () => {
  const { campaign } = await fixture();
  const navigation = campaign.workerEnvelope.campaign.navigations[0];
  const [bootstrap, audit] = navigation.networkRequests.filter((request) =>
    new URL(request.url).pathname === "/api/health");
  bootstrap.finishedTimestamp = audit.timestamp + 1;
  navigation.healthBinding.bootstrap.finishedTimestamp =
    bootstrap.finishedTimestamp;
  const tts = navigation.networkRequests.filter((request) =>
    request.url.endsWith("/api/tts"));
  tts[0].finishedTimestamp = tts[1].timestamp + 1;

  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(analysis.structural.timestampPolicyValid, true);
  assert.equal(analysis.structural.bootstrapAuditHealthBindingValid, true);
  assert.equal(analysis.structural.navigationAuditValid, true);
  assert.equal(analysis.decision, EXP0023_DECISIONS.pass);
});

test("projeção não mascara timestamp divergente entre raw e summary", async () => {
  const { campaign } = await fixture();
  campaign.workerEnvelope.campaign.navigations[0]
    .healthBinding.bootstrap.responseTimestamp += 123;
  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(analysis.structural.healthTimestampSummariesBound, false);
  assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
  assert.equal(analysis.instrumentValid, false);
});

test("timestamp invertido passa; timestamp anterior ao request falha", async () => {
  const { campaign } = await fixture();
  const diagnostics = inspectExp0023TimestampPolicy(
    campaign.workerEnvelope.campaign
  );
  assert.equal(diagnostics.valid, true);
  assert.equal(diagnostics.responseAfterTerminalCount, 40);

  const invalid = structuredClone(campaign);
  const first = invalid.workerEnvelope.campaign.navigations[0]
    .networkRequests[0];
  first.timestamp = first.finishedTimestamp + 1;
  const analysis = analyzeExp0023Campaign(invalid);
  assert.equal(analysis.structural.timestampPolicyValid, false);
  assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
});

test("sem inversão de health a tentativa não exercita o delta", async () => {
  const { campaign } = await fixture();
  for (const navigation of campaign.workerEnvelope.campaign.navigations) {
    for (const request of navigation.networkRequests) {
      if (new URL(request.url).pathname !== "/api/health") continue;
      request.responseTimestamp = request.finishedTimestamp;
      for (const name of ["bootstrap", "audit"]) {
        if (navigation.healthBinding[name].requestId === request.requestId) {
          navigation.healthBinding[name].responseTimestamp =
            request.finishedTimestamp;
        }
      }
    }
  }
  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(
    analysis.structural.prospectiveHealthInversionObserved,
    false
  );
  assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
});

test("ordinal invertido continua falhando mesmo com timestamps plausíveis", async () => {
  const { campaign } = await fixture();
  const firstHealth = healthRequests(campaign)[0];
  firstHealth.responseOrdinal = firstHealth.finishedOrdinal + 1;
  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(analysis.structural.timestampPolicyValid, false);
  assert.equal(analysis.structural.bootstrapAuditHealthBindingValid, false);
  assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
});

test("ordinal de evento duplicado no ledger global invalida", async () => {
  const { campaign } = await fixture();
  const requests = campaign.workerEnvelope.campaign.navigations.flatMap(
    (navigation) => navigation.networkRequests
  );
  const target = requests.find((request) =>
    request.tracksLoadingLifecycle === true &&
    new URL(request.url).pathname !== "/api/health" &&
    requests.some((other) =>
      other.requestId !== request.requestId &&
      other.requestOrdinal > request.requestOrdinal &&
      other.requestOrdinal < request.finishedOrdinal)
  );
  const duplicate = requests.find((other) =>
    other.requestId !== target.requestId &&
    other.requestOrdinal > target.requestOrdinal &&
    other.requestOrdinal < target.finishedOrdinal
  );
  target.responseOrdinal = duplicate.requestOrdinal;
  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(analysis.metrics.timestampDiagnostics.ordinalLedgerUnique, false);
  assert.equal(analysis.structural.timestampPolicyValid, false);
  assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
});

test("faixas ordinais das navegações respeitam o stream global", async () => {
  const { campaign } = await fixture();
  campaign.workerEnvelope.campaign.navigations[1]
    .networkRequests[0].requestOrdinal = 2;
  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(analysis.metrics.timestampDiagnostics.ordinalLedgerUnique, true);
  assert.equal(
    analysis.metrics.timestampDiagnostics.navigationOrdinalOrderValid,
    false
  );
  assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
});

test("evento ausente, terceiro health e boundary divergente falham fechados", async (t) => {
  const cases = [
    ["response ausente", async () => {
      const { campaign } = await fixture();
      const request = healthRequests(campaign)[0];
      request.responseReceivedCount = 0;
      request.responseTimestamp = null;
      request.responseOrdinal = null;
      return campaign;
    }],
    ["terceiro health", async () => {
      const { campaign } = await fixture();
      campaign.workerEnvelope.campaign.navigations[0]
        .networkRequests[1].url = "http://localhost:4173/api/health?extra=1";
      return campaign;
    }],
    ["boundary antigo", async () => {
      const { campaign } = await fixture();
      campaign.boundary.freezePath =
        "eval/commitments/exp-0022-instrumentation-freeze-v0.1.json";
      return campaign;
    }]
  ];
  for (const [name, build] of cases) {
    await t.test(name, async () => {
      const analysis = analyzeExp0023Campaign(await build());
      assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
      assert.equal(analysis.instrumentValid, false);
    });
  }
});

test("audit antes do TTS e TTS single-flight continuam normativos", async (t) => {
  await t.test("TTS antes do audit finish", async () => {
    const { campaign } = await fixture();
    const navigation = campaign.workerEnvelope.campaign.navigations[0];
    const firstTts = navigation.networkRequests.find((request) =>
      request.url.endsWith("/api/tts"));
    firstTts.requestOrdinal = navigation.healthBinding.audit.finishedOrdinal;
    const analysis = analyzeExp0023Campaign(campaign);
    assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
  });
  await t.test("TTS sobrepostos", async () => {
    const { campaign } = await fixture();
    const tts = campaign.workerEnvelope.campaign.navigations[0]
      .networkRequests.filter((request) => request.url.endsWith("/api/tts"));
    tts[0].finishedOrdinal = tts[1].requestOrdinal + 1;
    const analysis = analyzeExp0023Campaign(campaign);
    assert.equal(analysis.structural.navigationAuditValid, false);
    assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
  });
});

test("captura divergente é FIX somente quando instrumento permanece válido", async () => {
  const { campaign } = await fixture();
  campaign.workerEnvelope.campaign.navigations[0].units[0].browser.sha256 =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(analysis.instrumentValid, true);
  assert.equal(analysis.gates.browserCdpByteIdentity, false);
  assert.equal(analysis.decision, EXP0023_DECISIONS.fix);
  assert.equal(analysis.nextMove.physicalStopPreregistrationAllowed, false);
});

test("campanha malformada é NOT_EVALUATED e não passa por coleção vazia", async () => {
  const { campaign } = await fixture();
  campaign.extra = true;
  const analysis = analyzeExp0023Campaign(campaign);
  assert.equal(analysis.measurementStatus, "NOT_EVALUATED");
  assert.deepEqual(analysis.units, []);
  for (const gate of [
    "cdpChainAndResponse",
    "browserCdpByteIdentity",
    "payloadStabilityAndDistinction",
    "boundedFailClosedCapture",
    "firstResponsePerNavigation"
  ]) assert.equal(analysis.gates[gate], null);
  assert.equal(analysis.decision, EXP0023_DECISIONS.invalidate);
});

test("report recalcula campanha, hash, claim e zero autoridade", async () => {
  const { campaign } = await fixture();
  const report = createExp0023Report({ campaign });
  assert.equal(report.decision, EXP0023_DECISIONS.pass);
  assert.equal(report.pass, true);
  assert.equal(report.authorityEligible, false);
  assert.match(report.claim, /ordinais do stream CDP/u);
  assert.equal(validateExp0023Report(report).valid, true);

  const reinterpreted = structuredClone(report);
  reinterpreted.analysis.metrics.timestampDiagnostics.trackedRequests = 39;
  assert.equal(validateExp0023Report(reinterpreted).valid, false);

  const rehashedExtra = structuredClone(report);
  rehashedExtra.extra = true;
  assert.equal(validateExp0023Report(rehashedExtra).valid, false);
});
