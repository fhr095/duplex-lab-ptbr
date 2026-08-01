function validateExamples(examples, classNames, featureCount) {
  if (!Array.isArray(examples) || examples.length === 0) {
    throw new TypeError("examples precisa conter observações");
  }
  const classSet = new Set(classNames);
  for (const [index, example] of examples.entries()) {
    if (
      !classSet.has(example.label) ||
      !Array.isArray(example.features) ||
      example.features.length !== featureCount ||
      example.features.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError(`example[${index}] é incompatível`);
    }
  }
}

function softmax(logits) {
  const maximum = Math.max(...logits);
  const values = logits.map((value) => Math.exp(value - maximum));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

function logitsFor(weights, features) {
  return weights.map((row) =>
    row.reduce(
      (sum, weight, index) => sum + weight * features[index],
      0
    )
  );
}

export function trainSoftmaxClassifier(input = {}) {
  const classNames = input.classNames;
  const featureCount = input.featureCount;
  if (
    !Array.isArray(classNames) ||
    classNames.length < 2 ||
    new Set(classNames).size !== classNames.length ||
    !Number.isSafeInteger(featureCount) ||
    featureCount < 1
  ) {
    throw new TypeError("classes e featureCount são obrigatórios");
  }
  validateExamples(input.examples, classNames, featureCount);
  const epochs = input.epochs ?? 1_500;
  const learningRate = input.learningRate ?? 0.35;
  const l2 = input.l2 ?? 0.0005;
  if (
    !Number.isSafeInteger(epochs) ||
    epochs < 1 ||
    !Number.isFinite(learningRate) ||
    learningRate <= 0 ||
    !Number.isFinite(l2) ||
    l2 < 0
  ) {
    throw new TypeError("hiperparâmetros inválidos");
  }
  const classIndexes = new Map(
    classNames.map((label, index) => [label, index])
  );
  const classCounts = Object.fromEntries(
    classNames.map((label) => [label, 0])
  );
  for (const example of input.examples) {
    classCounts[example.label] += 1;
  }
  if (Object.values(classCounts).some((count) => count === 0)) {
    throw new TypeError("todas as classes precisam aparecer no treino");
  }
  const classWeights = Object.fromEntries(
    classNames.map((label) => [
      label,
      input.examples.length /
        (classNames.length * classCounts[label])
    ])
  );
  const weights = classNames.map(() => Array(featureCount).fill(0));
  let loss = null;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = classNames.map(() => Array(featureCount).fill(0));
    loss = 0;
    let totalWeight = 0;
    for (const example of input.examples) {
      const expected = classIndexes.get(example.label);
      const sampleWeight = classWeights[example.label];
      const probabilities = softmax(logitsFor(weights, example.features));
      loss -= sampleWeight * Math.log(
        Math.max(probabilities[expected], Number.EPSILON)
      );
      totalWeight += sampleWeight;
      for (let classIndex = 0;
        classIndex < classNames.length;
        classIndex += 1) {
        const error = sampleWeight * (
          probabilities[classIndex] -
          (classIndex === expected ? 1 : 0)
        );
        for (let featureIndex = 0;
          featureIndex < featureCount;
          featureIndex += 1) {
          gradient[classIndex][featureIndex] +=
            error * example.features[featureIndex];
        }
      }
    }
    loss /= totalWeight;
    for (let classIndex = 0;
      classIndex < classNames.length;
      classIndex += 1) {
      for (let featureIndex = 0;
        featureIndex < featureCount;
        featureIndex += 1) {
        const regularization = featureIndex === 0
          ? 0
          : l2 * weights[classIndex][featureIndex];
        weights[classIndex][featureIndex] -= learningRate * (
          gradient[classIndex][featureIndex] / totalWeight + regularization
        );
      }
    }
  }
  return Object.freeze({
    algorithm: "full-batch-multinomial-logistic-regression-v1",
    classNames: Object.freeze([...classNames]),
    featureCount,
    weights: Object.freeze(weights.map((row) => Object.freeze(
      row.map((value) => Number(value.toFixed(12)))
    ))),
    training: Object.freeze({
      epochs,
      learningRate,
      l2,
      classCounts: Object.freeze(classCounts),
      classWeights: Object.freeze(classWeights),
      finalLoss: Number(loss.toFixed(12)),
      ordering: "input-order/full-batch",
      initialization: "all-zero"
    })
  });
}

export function predictSoftmaxClassifier(model, features) {
  if (
    !Array.isArray(model?.weights) ||
    !Array.isArray(features) ||
    model.weights.some((row) => row.length !== features.length)
  ) {
    throw new TypeError("modelo ou features incompatíveis");
  }
  const probabilities = softmax(logitsFor(model.weights, features));
  let winner = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[winner]) {
      winner = index;
    }
  }
  return {
    label: model.classNames[winner],
    probabilities: Object.fromEntries(
      model.classNames.map((label, index) => [label, probabilities[index]])
    )
  };
}
