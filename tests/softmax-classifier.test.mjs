import assert from "node:assert/strict";
import test from "node:test";

import {
  predictSoftmaxClassifier,
  trainSoftmaxClassifier
} from "../src/learning/softmax-classifier.mjs";

const examples = [
  { label: "left", features: [1, -1] },
  { label: "left", features: [1, -0.8] },
  { label: "right", features: [1, 0.8] },
  { label: "right", features: [1, 1] }
];

test("treino full-batch é reproduzível e separa observações simples", () => {
  const options = {
    examples,
    classNames: ["left", "right"],
    featureCount: 2,
    epochs: 400,
    learningRate: 0.3,
    l2: 0.0001
  };
  const first = trainSoftmaxClassifier(options);
  const second = trainSoftmaxClassifier(options);

  assert.deepEqual(first, second);
  assert.equal(
    predictSoftmaxClassifier(first, [1, -0.9]).label,
    "left"
  );
  assert.equal(
    predictSoftmaxClassifier(first, [1, 0.9]).label,
    "right"
  );
});

test("treinador rejeita classe ausente e observação incompatível", () => {
  assert.throws(
    () => trainSoftmaxClassifier({
      examples: [{ label: "left", features: [1] }],
      classNames: ["left", "right"],
      featureCount: 1
    }),
    /todas as classes/iu
  );
  assert.throws(
    () => trainSoftmaxClassifier({
      examples: [{ label: "missing", features: [1] }],
      classNames: ["left", "right"],
      featureCount: 1
    }),
    /incompatível/iu
  );
});
