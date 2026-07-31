import assert from "node:assert/strict";
import test from "node:test";

import {
  browserSnapshotToCorrectionObservation
} from "../src/eval/factory/browser-observation.mjs";

test("snapshot real vira observação causal sem contar turno anterior", () => {
  const definition = {
    text: "Marca para terça... não, sexta."
  };
  const snapshot = {
    text: {
      user: definition.text,
      assistant: "Entendi. Vou considerar sexta."
    },
    semantic: {
      state: {
        slot: "weekday",
        value: "sexta",
        revisionId: "revision-1"
      }
    },
    trace: [
      { atMs: 100, type: "turn.committed", detail: "Considere terça." },
      { atMs: 200, type: "assistant.speech.started", detail: "direct" },
      { atMs: 250, type: "user.speech.started", detail: "automation" },
      { atMs: 280, type: "assistant.speech.started", detail: "backchannel" },
      { atMs: 300, type: "user.speech.ended", detail: "automation" },
      { atMs: 310, type: "turn.committed", detail: definition.text },
      { atMs: 320, type: "state.rollback", detail: "{}" },
      { atMs: 500, type: "assistant.speech.started", detail: "direct" }
    ]
  };
  const observation = browserSnapshotToCorrectionObservation(
    definition,
    snapshot,
    { effectsMeasured: true, effects: [] }
  );

  assert.equal(observation.commitCount, 1);
  assert.equal(observation.revisionCount, 1);
  assert.equal(observation.userSpeechEndedAtMs, 300);
  assert.deepEqual(observation.assistantSpeechStartsAtMs, [500]);
  assert.deepEqual(observation.effects, []);
});

test("fala durante o turno, rollback não causal e commit extra não ficam verdes", () => {
  const definition = {
    text: "Marca para terça... não, sexta."
  };
  const snapshot = {
    text: {
      user: definition.text,
      assistant: "Vou considerar sexta."
    },
    semantic: {
      state: {
        slot: "weekday",
        value: "sexta",
        revisionId: "revision-1"
      }
    },
    trace: [
      { atMs: 100, type: "user.speech.started", detail: "automation" },
      { atMs: 110, type: "assistant.speech.started", detail: "direct" },
      { atMs: 200, type: "user.speech.ended", detail: "automation" },
      { atMs: 210, type: "turn.committed", detail: definition.text },
      { atMs: 215, type: "state.rollback", detail: "{}" },
      { atMs: 220, type: "turn.committed", detail: "commit espúrio" },
      { atMs: 230, type: "task.delegated", detail: "task-2 · terça" },
      { atMs: 300, type: "assistant.speech.started", detail: "direct" }
    ]
  };

  const observation = browserSnapshotToCorrectionObservation(
    definition,
    snapshot
  );

  assert.equal(observation.commitCount, 2);
  assert.deepEqual(observation.rollback, {});
  assert.deepEqual(observation.assistantSpeechStartsAtMs, [110, 300]);
  assert.equal(observation.delegations.length, 1);
});

test("escopo causal conta o commit acústico mesmo com transcrição não idêntica", () => {
  const definition = {
    text: "Autoriza no nome de Luiza... não, no nome de Marina."
  };
  const snapshot = {
    text: {
      user: "Autoriza no nome de Luísa, não, no nome de Marina.",
      assistant: "Entendi. Vou considerar Marina."
    },
    semantic: {
      state: {
        slot: "name",
        value: "Marina",
        revisionId: "revision-1"
      }
    },
    trace: [
      { atMs: 100, type: "turn.committed", detail: "Considere Luiza." },
      { atMs: 200, type: "assistant.speech.started", detail: "direct" },
      { atMs: 300, type: "user.speech.started", detail: "local PCM" },
      { atMs: 900, type: "user.speech.ended", detail: "local PCM" },
      {
        atMs: 950,
        type: "turn.committed",
        detail: "Autoriza no nome de Luísa, não, no nome de Marina."
      },
      { atMs: 960, type: "state.rollback", detail: "{}" },
      { atMs: 1_100, type: "assistant.speech.started", detail: "direct" }
    ]
  };

  const observation = browserSnapshotToCorrectionObservation(
    definition,
    snapshot
  );

  assert.equal(
    observation.finalTranscript,
    "Autoriza no nome de Luísa, não, no nome de Marina."
  );
  assert.equal(observation.commitCount, 1);
  assert.equal(observation.revisionCount, 1);
  assert.deepEqual(observation.assistantSpeechStartsAtMs, [1_100]);
});

test("execução duplicada inteira permanece visível no escopo explícito", () => {
  const definition = { text: "Marca terça, não, sexta." };
  const snapshot = {
    text: { user: definition.text, assistant: "Vou considerar sexta." },
    semantic: {
      state: { slot: "weekday", value: "sexta", revisionId: "revision-2" }
    },
    trace: [
      { atMs: 100, type: "user.speech.started", detail: "pcm" },
      { atMs: 200, type: "user.speech.ended", detail: "pcm" },
      { atMs: 220, type: "turn.committed", detail: definition.text },
      { atMs: 230, type: "state.rollback", detail: "{}" },
      { atMs: 300, type: "user.speech.started", detail: "pcm duplicado" },
      { atMs: 400, type: "user.speech.ended", detail: "pcm duplicado" },
      { atMs: 420, type: "turn.committed", detail: definition.text },
      { atMs: 430, type: "state.rollback", detail: "{}" }
    ]
  };

  const observation = browserSnapshotToCorrectionObservation(
    definition,
    snapshot,
    { scopeStartAtMs: 90 }
  );
  assert.equal(observation.commitCount, 2);
  assert.equal(observation.revisionCount, 2);

  const inferred = browserSnapshotToCorrectionObservation(definition, snapshot);
  assert.equal(inferred.commitCount, 2);
});
