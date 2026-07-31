export class RollingSamples {
  #capacity;
  #nextIndex = 0;
  #values = [];

  constructor(capacity = 30_000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("capacity precisa ser um inteiro positivo");
    }
    this.#capacity = capacity;
  }

  get length() {
    return this.#values.length;
  }

  push(value) {
    if (!Number.isFinite(value)) {
      return false;
    }
    if (this.#values.length < this.#capacity) {
      this.#values.push(value);
      return true;
    }
    this.#values[this.#nextIndex] = value;
    this.#nextIndex = (this.#nextIndex + 1) % this.#capacity;
    return true;
  }

  values() {
    return [...this.#values];
  }
}

export function numberDistribution(values, options = {}) {
  const ordered = [...values]
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const rank = (ratio) =>
    ordered.length === 0
      ? null
      : ordered[
          Math.max(0, Math.ceil(ordered.length * ratio) - 1)
        ];
  const round = (value) => {
    if (!Number.isFinite(value)) {
      return null;
    }
    const places = options.places ?? 3;
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
  };
  return Object.freeze({
    n: ordered.length,
    p50: round(rank(0.5)),
    p95: round(rank(0.95)),
    p99: round(rank(0.99)),
    ...(options.includeMax === false
      ? {}
      : { max: round(rank(1)) })
  });
}
