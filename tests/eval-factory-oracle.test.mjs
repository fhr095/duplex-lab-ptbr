import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCorrectionObservation,
  runCorrectionOracleMutationAudit
} from "../src/eval/factory/oracles.mjs";

const definition = {
  id: "corr-weekday-a",
  stimulus: {
    text: "Marca para terça... não, sexta.",
    slots: { obsolete: "terça", current: "sexta" }
  },
  oracle: {
    ref: "correction-last-value-wins@1",
    args: {
      slot: "weekday",
      obsolete: "terça",
      current: "sexta",
      allowProvisionalEffect: false
    }
  }
};

const correctObservation = {
  finalTranscript: "Marca para terça... não, sexta.",
  semanticState: {
    slot: "weekday",
    value: "sexta",
    revisionId: "revision-1"
  },
  rollback: {
    slot: "weekday",
    previous: "terça",
    current: "sexta",
    revisionId: "revision-1"
  },
  userSpeechStartedAtMs: 100,
  userSpeechEndedAtMs: 1_000,
  commitAtMs: 1_050,
  rollbackAtMs: 1_100,
  userSpeechIntervals: [{ startAtMs: 100, endAtMs: 1_000 }],
  assistantSpeechStartsAtMs: [1_250],
  assistantText: "Certo, vou considerar sexta.",
  spokenUtterances: [{
    kind: "direct",
    text: "Certo, vou considerar sexta.",
    semantic: {
      slot: "weekday",
      value: "sexta",
      revisionId: "revision-1"
    }
  }],
  commitCount: 1,
  revisionCount: 1,
  delegations: [],
  effects: []
};

test("oráculo determinístico valida o efeito percebido da correção", () => {
  const result = assessCorrectionObservation(definition, correctObservation);
  assert.equal(result.decision, "pass");
  assert.equal(result.checks.every((check) => check.status === "pass"), true);
});

test("dado ausente não vira verde: fica explicitamente não medido", () => {
  const observation = { ...correctObservation };
  delete observation.semanticState;
  const result = assessCorrectionObservation(definition, observation);

  assert.equal(result.decision, "hold");
  assert.equal(
    result.checks.find((check) => check.id === "final-semantic-state").status,
    "unmeasured"
  );
});

test("valor monetário por extenso é exato e não aceita vizinhos", () => {
  const amountDefinition = structuredClone(definition);
  amountDefinition.oracle.args = {
    ...amountDefinition.oracle.args,
    slot: "amount",
    obsolete: "BRL 1500",
    current: "BRL 1150"
  };
  const amountObservation = {
    ...structuredClone(correctObservation),
    finalTranscript:
      "Sete mil e quinhentos reais. Não, mil centro e cinquenta reais.",
    semanticState: {
      slot: "amount",
      value: "BRL 1150",
      revisionId: "revision-1"
    },
    rollback: {
      slot: "amount",
      previous: "BRL 1500",
      current: "BRL 1150",
      revisionId: "revision-1"
    },
    assistantText: "Entendi. Vou considerar mil cento e cinquenta reais."
    ,
    spokenUtterances: [{
      kind: "direct",
      text: "Entendi. Vou considerar mil cento e cinquenta reais.",
      semantic: {
        slot: "amount", value: "BRL 1150", revisionId: "revision-1"
      }
    }]
  };

  const result = assessCorrectionObservation(
    amountDefinition,
    amountObservation
  );
  assert.equal(
    result.checks.find((check) => check.id === "final-transcript-current")
      .status,
    "pass"
  );
  assert.equal(
    result.checks.find((check) => check.id === "assistant-confirms-current")
      .status,
    "pass"
  );

  amountObservation.assistantText =
    "Vou usar o protocolo 1150 e transferir R$ 1500.";
  amountObservation.spokenUtterances[0].text = amountObservation.assistantText;
  const misleading = assessCorrectionObservation(
    amountDefinition,
    amountObservation
  );
  assert.equal(
    misleading.checks.find(
      (check) => check.id === "assistant-confirms-current"
    ).status,
    "fail"
  );

  amountObservation.finalTranscript = "Transfere cento e cinquenta reais.";
  amountObservation.assistantText = "Vou considerar mil e quinhentos reais.";
  amountObservation.spokenUtterances[0].text = amountObservation.assistantText;
  amountObservation.spokenUtterances[0].semantic.value = "BRL 1500";
  const wrong = assessCorrectionObservation(amountDefinition, amountObservation);
  assert.equal(
    wrong.checks.find((check) => check.id === "final-transcript-current").status,
    "fail"
  );
  assert.equal(
    wrong.checks.find((check) => check.id === "assistant-confirms-current")
      .status,
    "fail"
  );
});

test("menção negada do valor atual não conta como confirmação", () => {
  for (const assistantText of [
    "Não vou considerar sexta; vou manter terça.",
    "Sexta foi recusada; vou considerar terça."
  ]) {
    const result = assessCorrectionObservation(definition, {
      ...correctObservation,
      assistantText
    });
    assert.equal(
      result.checks.find(
        (check) => check.id === "assistant-confirms-current"
      ).status,
      "fail"
    );
  }

  const timeDefinition = structuredClone(definition);
  timeDefinition.oracle.args = {
    ...timeDefinition.oracle.args,
    slot: "time",
    obsolete: "09:00",
    current: "11:00"
  };
  const timeResult = assessCorrectionObservation(timeDefinition, {
    ...structuredClone(correctObservation),
    finalTranscript: "Era às 9 horas, quer dizer, às 11 horas.",
    semanticState: {
      slot: "time",
      value: "11:00",
      revisionId: "revision-1"
    },
    rollback: {
      slot: "time",
      previous: "09:00",
      current: "11:00",
      revisionId: "revision-1"
    },
    assistantText: "Não vou considerar 11 horas; permanecerei em 9 horas."
  });
  assert.equal(
    timeResult.checks.find(
      (check) => check.id === "assistant-confirms-current"
    ).status,
    "fail"
  );

  for (const assistantText of [
    "Vou considerar 11 horas como incorreto e manter 9 horas.",
    "Vou considerar sexta inválida e manter terça."
  ]) {
    const adversarialDefinition = assistantText.includes("11 horas")
      ? timeDefinition
      : definition;
    const adversarialObservation = assistantText.includes("11 horas")
      ? { ...structuredClone(timeResult), ...correctObservation, assistantText }
      : { ...correctObservation, assistantText };
    const result = assessCorrectionObservation(
      adversarialDefinition,
      adversarialDefinition === timeDefinition
        ? {
            ...structuredClone(correctObservation),
            finalTranscript: "Era às 9 horas, quer dizer, às 11 horas.",
            semanticState: {
              slot: "time", value: "11:00", revisionId: "revision-1"
            },
            rollback: {
              slot: "time", previous: "09:00", current: "11:00",
              revisionId: "revision-1"
            },
            assistantText
          }
        : adversarialObservation
    );
    assert.equal(
      result.checks.find(
        (check) => check.id === "assistant-confirms-current"
      ).status,
      "fail"
    );
  }
});

test("resposta antes do rollback causal falha mesmo após o fim da fala", () => {
  const result = assessCorrectionObservation(definition, {
    ...correctObservation,
    userSpeechEndedAtMs: 200,
    commitAtMs: 201,
    rollbackAtMs: 205,
    assistantSpeechStartsAtMs: [202]
  });
  assert.equal(
    result.checks.find((check) => check.id === "causal-event-order").status,
    "fail"
  );
});

test("nova fala e confirmação audível obsoleta não são apagadas depois", () => {
  const overlapping = assessCorrectionObservation(definition, {
    ...structuredClone(correctObservation),
    userSpeechStartedAtMs: 100,
    userSpeechEndedAtMs: 200,
    commitAtMs: 210,
    rollbackAtMs: 220,
    userSpeechIntervals: [
      { startAtMs: 100, endAtMs: 200 },
      { startAtMs: 250, endAtMs: 300 }
    ],
    assistantSpeechStartsAtMs: [260]
  });
  assert.equal(
    overlapping.checks.find(
      (check) => check.id === "no-premature-main-speech"
    ).status,
    "fail"
  );

  const staleThenCorrect = assessCorrectionObservation(definition, {
    ...structuredClone(correctObservation),
    spokenUtterances: [
      {
        kind: "direct",
        text: "Vou considerar terça.",
        semantic: {
          slot: "weekday", value: "sexta", revisionId: "revision-1"
        }
      },
      ...structuredClone(correctObservation.spokenUtterances)
    ]
  });
  assert.equal(
    staleThenCorrect.checks.find(
      (check) => check.id === "audible-confirms-current"
    ).status,
    "fail"
  );
});

test("mutation audit mata estado velho, fala precoce, efeito velho e duplicações", () => {
  const audit = runCorrectionOracleMutationAudit(
    definition,
    correctObservation
  );
  assert.equal(audit.pass, true);
  assert.equal(audit.killed, audit.total);
  assert.deepEqual(
    audit.mutants.map((mutant) => mutant.id).sort(),
    [
      "duplicate-commit",
      "duplicate-semantic-revision",
      "lost-current-transcript",
      "noncausal-rollback",
      "obsolete-effect",
      "obsolete-semantic-state",
      "premature-main-speech",
      "response-before-rollback",
      "rollback-before-commit",
      "stale-assistant-confirmation",
      "stale-audible-confirmation",
      "stale-before-correct"
    ]
  );
});
