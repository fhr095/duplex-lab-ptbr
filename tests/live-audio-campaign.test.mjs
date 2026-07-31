import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  analyzeObservedCase,
  applyPcmGain,
  evaluateCampaign,
  isUsefulPartial,
  phraseIncluded,
  percentile
} from "../scripts/live-audio-campaign.mjs";

const fixture = JSON.parse(await readFile(resolve(
  import.meta.dirname,
  "fixtures/live-audio-campaign-observations.json"
), "utf8"));

function analyzedCases() {
  return ["synthetic", "human", "control"].map((key) =>
    analyzeObservedCase(
      fixture.definitions[key],
      fixture.observations[key]
    )
  );
}

test("parcial útil ignora hesitação/conectivo isolado", () => {
  assert.equal(isUsefulPartial("E..."), false);
  assert.equal(isUsefulPartial("ahn"), false);
  assert.equal(isUsefulPartial("Oi"), true);
  assert.equal(isUsefulPartial("eu queria mudar"), true);
});

test("frases críticas aceitam realização equivalente, mas não outro nome", () => {
  assert.equal(phraseIncluded("custou 80 reais", "R$ 80"), true);
  assert.equal(
    phraseIncluded("custou sete mil e quinhentos reais", "R$ 1500"),
    false
  );
  assert.equal(
    phraseIncluded("ficou mil centro e cinquenta reais", "R$ 1150"),
    true
  );
  assert.equal(phraseIncluded("agenda às 14 horas", "14h"), true);
  assert.equal(phraseIncluded("fala com Luísa", "Luiza"), false);
});

test("percentil usa nearest-rank e não mascara amostra vazia", () => {
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40);
  assert.equal(percentile([40, 10, 30, 20], 0.5), 20);
  assert.equal(percentile([], 0.95), null);
});

test("ganho PCM preserva duração, escala e satura amostras", () => {
  const pcm = Buffer.alloc(6);
  pcm.writeInt16LE(20_000, 0);
  pcm.writeInt16LE(-20_000, 2);
  pcm.writeInt16LE(1_000, 4);

  const quieter = applyPcmGain(pcm, 0.25);
  assert.deepEqual(
    [0, 2, 4].map((offset) => quieter.readInt16LE(offset)),
    [5_000, -5_000, 250]
  );
  const clipped = applyPcmGain(pcm, 4);
  assert.deepEqual(
    [0, 2, 4].map((offset) => clipped.readInt16LE(offset)),
    [32_767, -32_768, 4_000]
  );
  assert.notEqual(quieter, pcm);
});

test("análise mede percepção no relógio do cliente e preserva WER", () => {
  const result = analyzeObservedCase(
    fixture.definitions.synthetic,
    fixture.observations.synthetic
  );

  assert.equal(result.timing.onsetDetectionMs, 40);
  assert.equal(result.timing.firstPartialAfterSpeechStartMs, 320);
  assert.equal(
    result.timing.firstUsefulPartialAfterSpeechStartMs,
    720
  );
  assert.equal(result.timing.endpointAfterLastActiveMs, 550);
  assert.equal(result.timing.finalAfterEndpointMs, 200);
  assert.equal(result.transcript.wer, 0);
  assert.equal(result.criticalPhrases.recall, 1);
  assert.equal(result.turnIntegrity.coherentSingleTurn, true);
});

test("fala curta finalizada não exige parcial artificial", () => {
  const definition = {
    ...fixture.definitions.synthetic,
    expected: "Não."
  };
  const observation = structuredClone(fixture.observations.synthetic);
  observation.activeStartOffsetMs = 100;
  observation.activeEndOffsetMs = 500;
  observation.events = observation.events.filter(
    (event) => event.type !== "transcript.partial"
  );
  const result = analyzeObservedCase(definition, observation);

  assert.equal(result.partialExpectation.required, false);
  assert.equal(
    result.timing.firstUsefulPartialAfterSpeechStartMs,
    null
  );
});

test("gates separam regressão sintética de qualidade humana", () => {
  const result = evaluateCampaign(fixture.pack, analyzedCases());

  assert.equal(result.cohorts.synthetic.status, "promote");
  assert.equal(result.cohorts.human.status, "hold");
  assert.equal(result.cohorts.human.checks.corpusWer, false);
  assert.equal(result.cohorts.control.status, "promote");
  assert.equal(result.operability.pass, true);
  assert.equal(result.decision, "hold");
  assert.equal(result.userFacingReadiness.decision, "hold");
});

test("endpoint precoce e fragmentação falham mesmo com texto perfeito", () => {
  const observation = structuredClone(fixture.observations.synthetic);
  observation.events.splice(3, 0, {
    type: "endpoint.committed",
    turnId: "turn-0",
    receivedAtMs: 900
  });
  const analyzed = analyzeObservedCase(
    fixture.definitions.synthetic,
    observation
  );
  const result = evaluateCampaign(
    fixture.pack,
    [
      analyzed,
      analyzeObservedCase(
        fixture.definitions.human,
        fixture.observations.human
      ),
      analyzeObservedCase(
        fixture.definitions.control,
        fixture.observations.control
      )
    ]
  );

  assert.equal(analyzed.turnIntegrity.coherentSingleTurn, false);
  assert.equal(analyzed.turnIntegrity.prematureEndpoint, true);
  assert.equal(analyzed.timing.endpointAfterLastActiveMs, 550);
  assert.equal(analyzed.timing.finalAfterEndpointMs, 200);
  assert.equal(result.cohorts.synthetic.checks.coherentSingleTurn, false);
  assert.equal(result.cohorts.synthetic.checks.noPrematureEndpoint, false);
  assert.equal(result.operability.pass, false);
});

test("merge comprovado recupera endpoint interno sem esconder o evento bruto", () => {
  const definition = structuredClone(fixture.definitions.synthetic);
  const observation = structuredClone(fixture.observations.synthetic);
  const final = observation.events.find(
    (event) => event.type === "transcript.final"
  );
  const firstEndpoint = observation.events.find(
    (event) => event.type === "endpoint.committed"
  );
  firstEndpoint.receivedAtMs = 900;
  observation.events.push(
    {
      type: "user.speech.started",
      turnId: "turn-2",
      receivedAtMs: 1_000
    },
    {
      type: "endpoint.committed",
      turnId: "turn-2",
      receivedAtMs: 1_500
    }
  );
  final.turnId = "turn-2";
  final.mergedTurnIds = ["turn-1", "turn-2"];
  final.receivedAtMs = 1_700;
  observation.events.sort(
    (left, right) => left.receivedAtMs - right.receivedAtMs
  );

  const analyzed = analyzeObservedCase(definition, observation);
  assert.equal(analyzed.turnIntegrity.rawPrematureEndpoint, true);
  assert.equal(analyzed.turnIntegrity.recoveredByMerge, true);
  assert.equal(analyzed.turnIntegrity.prematureEndpoint, false);
  assert.equal(analyzed.turnIntegrity.coherentSingleTurn, true);
});

test("backlog sem perda explícita também bloqueia latência acumulada", () => {
  const observation = structuredClone(fixture.observations.synthetic);
  observation.maxBufferedAmountBytes = 32_768;
  const cases = analyzedCases();
  cases[0] = analyzeObservedCase(
    fixture.definitions.synthetic,
    observation
  );
  const result = evaluateCampaign(fixture.pack, cases);

  assert.equal(cases[0].transport.serverLostFrames, 0);
  assert.equal(
    result.cohorts.synthetic.checks.boundedClientBacklog,
    false
  );
  assert.equal(result.operability.pass, false);
});

test("modo acelerado não pode passar como evidência de latência", () => {
  const observation = structuredClone(fixture.observations.synthetic);
  observation.realtime = false;
  const cases = analyzedCases();
  cases[0] = analyzeObservedCase(
    fixture.definitions.synthetic,
    observation
  );
  const result = evaluateCampaign(fixture.pack, cases);

  assert.equal(
    result.cohorts.synthetic.checks.realtimeLatencyEvidence,
    false
  );
  assert.equal(result.cohorts.synthetic.checks.onsetP95, false);
});

test("perda declarada pelo servidor bloqueia operabilidade", () => {
  const observation = structuredClone(fixture.observations.synthetic);
  observation.events.push({
    type: "audio.frames.dropped",
    lostFrames: 2,
    lostSamples: 640,
    receivedAtMs: 950
  });
  const cases = analyzedCases();
  cases[0] = analyzeObservedCase(
    fixture.definitions.synthetic,
    observation
  );
  const result = evaluateCampaign(fixture.pack, cases);

  assert.equal(cases[0].transport.serverLostFrames, 2);
  assert.equal(result.cohorts.synthetic.checks.zeroServerLoss, false);
  assert.equal(result.operability.pass, false);
});

test("watermark não drenado bloqueia a campanha sem depender de timeout", () => {
  const observation = structuredClone(fixture.observations.synthetic);
  observation.audioFlush.watermark.receivedSequence = 98;
  const cases = analyzedCases();
  cases[0] = analyzeObservedCase(
    fixture.definitions.synthetic,
    observation
  );
  const result = evaluateCampaign(fixture.pack, cases);

  assert.equal(cases[0].transport.audioDrainVerified, false);
  assert.equal(
    result.cohorts.synthetic.checks.drainedServerPipeline,
    false
  );
  assert.equal(result.operability.pass, false);
});

test("timeout vira evidência de finalização ausente sem quebrar análise", () => {
  const observation = structuredClone(fixture.observations.synthetic);
  observation.events = observation.events.filter(
    (event) => event.type !== "transcript.final"
  );
  observation.events.push({
    type: "client.observation.timeout",
    awaitedEvent: "transcript.final",
    receivedAtMs: 17_000
  });
  const cases = analyzedCases();
  cases[0] = analyzeObservedCase(
    fixture.definitions.synthetic,
    observation
  );
  const result = evaluateCampaign(fixture.pack, cases);

  assert.equal(cases[0].eventCounts.observationTimeouts, 1);
  assert.equal(cases[0].eventCounts.finals, 0);
  assert.equal(result.cohorts.synthetic.checks.finalizedEveryCase, false);
  assert.equal(result.decision, "hold");
});
